"use strict";

const admin = require("../firebaseAdminCompat");
const { HttpsError } = require("firebase-functions/v2/https");
const { assertTeacherClassScope } = require("./permissionScope");
const db = admin.firestore();

// 함수 인스턴스 생존 시간 동안만 유지되는 짧은 캐시
const userCache = new Map();
const USER_CACHE_TTL = 30 * 1000;

/**
 * 학급 학생 문서를 조회합니다. (짧은 TTL 캐시 포함)
 */
const getUserData = async (classId, uid) => {
    const cacheKey = `${classId}:${uid}`;
    const now = Date.now();
    const cached = userCache.get(cacheKey);

    if (cached && now - cached.ts < USER_CACHE_TTL) {
        return cached.data;
    }

    const userSnap = await db.doc(`classes/${classId}/students/${uid}`).get();
    if (!userSnap.exists) {
        userCache.delete(cacheKey);
        return null;
    }

    const data = userSnap.data();
    userCache.set(cacheKey, { data, ts: now });
    return data;
};

/**
 * 특정 사용자 캐시를 비웁니다.
 */
const clearUserCache = (classId, uid) => {
    const cacheKey = `${classId}:${uid}`;
    userCache.delete(cacheKey);
    console.log(`[Cache] Cleared permission cache for: ${uid}`);
};

/**
 * 사용자에게 특정 권한 키가 있는지 확인합니다.
 */
const hasPermission = async (uid, classId, requiredKey) => {
    try {
        const userData = await getUserData(classId, uid);
        if (!userData) return false;

        const permissions =
            typeof userData.permissions === "object" && userData.permissions !== null
                ? userData.permissions
                : {};

        return permissions[requiredKey] === true;
    } catch (error) {
        console.error("[hasPermission] 권한 확인 중 오류:", error);
        return false;
    }
};

/**
 * 세금/노동 관련 권한(교사/관리자 또는 tax_admin/labor_admin)을 확인합니다.
 */
const mustBeTeacherOrTaxAdmin = async (
    classId,
    uid,
    { teacherOnly = false, requireSalaryPower = false } = {},
) => {
    const userData = await getUserData(classId, uid);
    if (!userData) {
        throw new HttpsError("not-found", "사용자 정보를 찾을 수 없습니다.");
    }

    const isTeacher = userData.role === "teacher" || userData.role === "admin";
    const hasTaxAdmin = !!userData.permissions?.tax_admin;
    const hasSalaryPower = !!userData.permissions?.labor_admin;
    const permissionInfo = {
        role: userData.role || null,
        isTeacher,
        hasTaxAdmin,
        hasSalaryPower,
    };

    if (isTeacher) return permissionInfo;

    if (teacherOnly) {
        throw new HttpsError("permission-denied", "해당 작업은 교사만 가능합니다.");
    }

    if (requireSalaryPower) {
        if (!hasSalaryPower) {
            throw new HttpsError("permission-denied", "급여 지급 권한이 없습니다.");
        }
        return permissionInfo;
    }

    if (!hasTaxAdmin && !hasSalaryPower) {
        throw new HttpsError("permission-denied", "관리 권한이 없습니다.");
    }

    return permissionInfo;
};

const mustBeTeacherOrBankOrTaxAdmin = async (classId, uid) => {
    const userData = await getUserData(classId, uid);
    if (!userData) {
        throw new HttpsError("not-found", "사용자 정보를 찾을 수 없습니다.");
    }

    const isTeacher = userData.role === "teacher" || userData.role === "admin";
    const hasBankAdmin = userData.permissions?.bank_admin === true;
    const hasTaxAdmin = userData.permissions?.tax_admin === true;
    if (isTeacher || hasBankAdmin || hasTaxAdmin) {
        return { role: userData.role || null, isTeacher, hasBankAdmin, hasTaxAdmin };
    }

    throw new HttpsError("permission-denied", "은행 또는 세금 관리 권한이 없습니다.");
};
const canOperateClassFund = ({ userData, fundData, uid }) => {
    const role = userData?.role || null;
    if (role === "teacher" || role === "admin") return true;
    return Array.isArray(fundData?.operatorUids) &&
        fundData.operatorUids.includes(uid);
};

const assertCanOperateClassFund = ({ userData, fundData, uid }) => {
    if (!userData) {
        throw new HttpsError("not-found", "사용자 정보를 찾을 수 없습니다.");
    }
    if (!canOperateClassFund({ userData, fundData, uid })) {
        throw new HttpsError(
            "permission-denied",
            "이 기금의 운용 담당자가 아닙니다.",
        );
    }
    return true;
};

/**
 * callable 요청의 공통 인증 클레임을 파싱/검증합니다.
 */
const getAuthContext = (request) => {
    const auth = request?.auth;
    if (!auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    return {
        uid: auth.uid,
        role: auth.token?.role || null,
        classId: auth.token?.classId || null,
        token: auth.token || {},
    };
};

/**
 * 커스텀 클레임 기준으로 허용된 역할인지 검사합니다.
 */
const assertRoleFromClaims = (
    request,
    allowedRoles,
    { requireClassForTeacher = true } = {},
) => {
    const ctx = getAuthContext(request);
    if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
        throw new HttpsError("internal", "allowedRoles 설정이 필요합니다.");
    }

    if (!allowedRoles.includes(ctx.role)) {
        throw new HttpsError("permission-denied", "권한이 없습니다.");
    }

    if (requireClassForTeacher && ctx.role === "teacher" && !ctx.classId) {
        throw new HttpsError(
            "failed-precondition",
            "교사 계정에는 classId 클레임이 필요합니다.",
        );
    }

    return ctx;
};

/**
 * 관리자 전용 callable 권한을 검사합니다.
 */
const assertAdminFromClaims = (request) =>
    assertRoleFromClaims(
        request,
        ["admin"],
        { requireClassForTeacher: false },
    );

/**
 * 교사/관리자 권한을 검사하고, 필요 시 교사의 학급 일치 여부를 확인합니다.
 */
const assertTeacherOrAdminFromClaims = (
    request,
    { classId = null, requireClassForTeacher = true } = {},
) => {
    const ctx = assertRoleFromClaims(
        request,
        ["teacher", "admin"],
        { requireClassForTeacher },
    );

    if (
        classId &&
        ctx.role === "teacher" &&
        ctx.classId &&
        ctx.classId !== classId
    ) {
        throw new HttpsError(
            "permission-denied",
            "다른 학급 데이터에는 접근할 수 없습니다.",
        );
    }

    return ctx;
};

/**
 * 교사/관리자는 기존 범위를 유지하고, 학생 페이지 관리자는 지정된 한
 * 권한과 현재 학급 범위 안에서만 callable을 실행하도록 검사합니다.
 */
const assertTeacherAdminOrDelegatedPermissionFromClaims = async (
    request,
    { classId, permissionKey } = {},
) => {
    const ctx = getAuthContext(request);

    if (ctx.role === "admin") return ctx;

    if (ctx.role === "teacher") {
        assertTeacherClassScope(ctx, classId);
        return ctx;
    }

    if (!classId || !permissionKey) {
        throw new HttpsError(
            "failed-precondition",
            "위임 권한 확인에 classId와 permissionKey가 필요합니다.",
        );
    }

    if (ctx.classId !== classId) {
        throw new HttpsError(
            "permission-denied",
            "다른 학급 데이터에는 접근할 수 없습니다.",
        );
    }

    if (await hasPermission(ctx.uid, classId, permissionKey)) {
        return ctx;
    }

    throw new HttpsError("permission-denied", "권한이 없습니다.");
};

/**
 * 교사/관리자 또는 credit_admin(a_crd) 권한을 커스텀 클레임으로 검증합니다.
 * - admin: 전체 허용
 * - teacher: 본인 classId 범위 허용
 * - credit_admin: 본인 classId 범위에서만 허용
 */
const assertTeacherAdminOrCreditAdminFromClaims = async (
    request,
    { classId = null, allowCreditAdmin = false } = {},
) => {
    const ctx = getAuthContext(request);

    if (ctx.role === "admin") return ctx;

    if (ctx.role === "teacher") {
        assertTeacherClassScope(ctx, classId);
        if (classId && ctx.classId && ctx.classId !== classId) {
            throw new HttpsError(
                "permission-denied",
                "다른 학급 데이터에는 접근할 수 없습니다.",
            );
        }
        return ctx;
    }

    if (allowCreditAdmin) {
        const effectiveClassId = classId || ctx.classId || null;
        if (!effectiveClassId) {
            throw new HttpsError(
                "failed-precondition",
                "credit_admin 권한 확인에 classId가 필요합니다.",
            );
        }

        const callerData = await getUserData(effectiveClassId, ctx.uid);
        const hasCreditAdmin =
            callerData?.role === "student" &&
            callerData?.permissions?.credit_admin === true;

        if (hasCreditAdmin) {
            const callerClassId = ctx.classId || callerData.classId || null;
            if (classId && callerClassId && callerClassId !== classId) {
                throw new HttpsError(
                    "permission-denied",
                    "다른 학급 데이터에는 접근할 수 없습니다.",
                );
            }
            return ctx;
        }
    }

    throw new HttpsError("permission-denied", "권한이 없습니다.");
};

const assertTeacherAdminOrCredentialsAdminFromClaims = async (
    request,
    { classId = null } = {},
) => {
    const ctx = getAuthContext(request);

    if (ctx.role === "admin") return ctx;

    if (ctx.role === "teacher") {
        assertTeacherClassScope(ctx, classId);
        if (classId && ctx.classId && ctx.classId !== classId) {
            throw new HttpsError(
                "permission-denied",
                "?ㅻⅨ ?숆툒 ?곗씠?곗뿉???묎렐?????놁뒿?덈떎.",
            );
        }
        return ctx;
    }

    const effectiveClassId = classId || ctx.classId || null;
    if (!effectiveClassId) {
        throw new HttpsError(
            "failed-precondition",
            "credentials_admin 沅뚰븳 ?뺤씤??classId媛 ?꾩슂?⑸땲??",
        );
    }

    const callerData = await getUserData(effectiveClassId, ctx.uid);
    const callerClassId = ctx.classId || callerData?.classId || null;
    if (classId && callerClassId && callerClassId !== classId) {
        throw new HttpsError(
            "permission-denied",
            "?ㅻⅨ ?숆툒 ?곗씠?곗뿉???묎렐?????놁뒿?덈떎.",
        );
    }

    const hasCredentialsAdmin =
        callerData?.role === "student" &&
        callerData?.permissions?.credentials_admin === true;

    if (hasCredentialsAdmin) {
        return ctx;
    }

    throw new HttpsError("permission-denied", "沅뚰븳???놁뒿?덈떎.");
};

const assertTeacherAdminOrAssetManagerFromClaims = async (
    request,
    { classId = null } = {},
) => {
    const ctx = getAuthContext(request);

    if (ctx.role === "admin") return ctx;

    if (ctx.role === "teacher") {
        assertTeacherClassScope(ctx, classId);
        if (classId && ctx.classId && ctx.classId !== classId) {
            throw new HttpsError(
                "permission-denied",
                "다른 학급 데이터에는 접근할 수 없습니다.",
            );
        }
        return ctx;
    }

    const effectiveClassId = classId || ctx.classId || null;
    if (!effectiveClassId) {
        throw new HttpsError(
            "failed-precondition",
            "asset manager permission check requires classId.",
        );
    }

    const callerData = await getUserData(effectiveClassId, ctx.uid);
    const callerClassId = ctx.classId || callerData?.classId || null;
    if (classId && callerClassId && callerClassId !== classId) {
        throw new HttpsError(
            "permission-denied",
            "다른 학급 데이터에는 접근할 수 없습니다.",
        );
    }

    const hasAssetManager =
        callerData?.role === "student" &&
        callerData?.permissions?.asset_manager_manage === true;

    if (hasAssetManager) {
        return ctx;
    }

    throw new HttpsError("permission-denied", "권한이 없습니다.");
};

module.exports = {
    getUserData,
    hasPermission,
    mustBeTeacherOrTaxAdmin,
    mustBeTeacherOrBankOrTaxAdmin,
    canOperateClassFund,
    assertCanOperateClassFund,
    getAuthContext,
    assertRoleFromClaims,
    assertAdminFromClaims,
    assertTeacherOrAdminFromClaims,
    assertTeacherAdminOrDelegatedPermissionFromClaims,
    assertTeacherAdminOrCreditAdminFromClaims,
    assertTeacherAdminOrCredentialsAdminFromClaims,
    assertTeacherAdminOrAssetManagerFromClaims,
    clearUserCache,
};
