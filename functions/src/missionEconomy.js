"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { stageActivityLog, stageCreditLog } = require("../utils/logUtils");
const { getUserData, hasPermission } = require("../utils/permissions");
const { getGlobalConfig } = require("../utils/planManager");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const DEFAULT_MISSION_TOKEN_CREDIT_CONFIG = Object.freeze({
    enabled: false,
    tokenUnit: 10,
    creditUnit: 1,
    tierRules: {},
});

function parsePositiveInteger(value, fieldLabel) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new HttpsError(
            "invalid-argument",
            `${fieldLabel}는 1 이상의 정수여야 합니다.`,
        );
    }

    return parsed;
}

function normalizePositiveInteger(value, fallbackValue) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function normalizeTierInfo(rawTier = null) {
    if (!rawTier) return null;

    if (typeof rawTier === "string") {
        const value = rawTier.trim();
        if (!value) return null;

        return {
            id: value,
            name: value,
        };
    }

    const id = String(rawTier?.id || rawTier?.name || "").trim();
    if (!id) return null;

    return {
        id,
        name: String(rawTier?.name || id).trim(),
    };
}

function normalizeStoredTierRules(rawTierRules = {}) {
    if (
        !rawTierRules ||
        typeof rawTierRules !== "object" ||
        Array.isArray(rawTierRules)
    ) {
        return {};
    }

    return Object.entries(rawTierRules).reduce((accumulator, [rawTierId, rawRule]) => {
        const tierId = String(rawTierId || "").trim();
        if (!tierId || !rawRule || typeof rawRule !== "object") {
            return accumulator;
        }

        const tokenUnit = normalizePositiveInteger(
            rawRule?.tokenUnit ?? rawRule?.tokensPerCredit,
            null,
        );
        const creditUnit = normalizePositiveInteger(
            rawRule?.creditUnit ?? (rawRule?.tokensPerCredit !== undefined ? 1 : null),
            null,
        );

        if (!tokenUnit || !creditUnit) {
            return accumulator;
        }

        accumulator[tierId] = {
            tokenUnit,
            creditUnit,
        };
        return accumulator;
    }, {});
}

function normalizeStoredConfig(raw = {}) {
    const usesNewModel =
        raw?.tokenUnit !== undefined || raw?.creditUnit !== undefined;
    const legacyTokenUnit = normalizePositiveInteger(
        raw?.tokensPerCredit,
        DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.tokenUnit,
    );

    return {
        enabled: raw?.enabled === true,
        tokenUnit: normalizePositiveInteger(
            usesNewModel ? raw?.tokenUnit : legacyTokenUnit,
            DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.tokenUnit,
        ),
        creditUnit: normalizePositiveInteger(
            usesNewModel ? raw?.creditUnit : 1,
            DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.creditUnit,
        ),
        tierRules: normalizeStoredTierRules(raw?.tierRules),
        updatedAt: raw?.updatedAt || null,
        updatedByUid: raw?.updatedByUid || null,
        updatedByName: raw?.updatedByName || "",
    };
}

function normalizeRequestedTierRules(rawTierRules = {}) {
    if (
        !rawTierRules ||
        typeof rawTierRules !== "object" ||
        Array.isArray(rawTierRules)
    ) {
        return {};
    }

    return Object.entries(rawTierRules).reduce((accumulator, [rawTierId, rawRule]) => {
        const tierId = String(rawTierId || "").trim();
        if (!tierId || !rawRule || typeof rawRule !== "object") {
            return accumulator;
        }

        accumulator[tierId] = {
            tokenUnit: parsePositiveInteger(
                rawRule?.tokenUnit ?? rawRule?.tokensPerCredit,
                `${tierId} 등급 차감 토큰 수`,
            ),
            creditUnit: parsePositiveInteger(
                rawRule?.creditUnit ?? (rawRule?.tokensPerCredit !== undefined ? 1 : null),
                `${tierId} 등급 지급 신용점수 수`,
            ),
        };

        return accumulator;
    }, {});
}

function resolveRequestedConfig(raw = {}) {
    const usesNewModel =
        raw?.tokenUnit !== undefined || raw?.creditUnit !== undefined;
    const usesLegacyModel = raw?.tokensPerCredit !== undefined;

    return {
        enabled: raw?.enabled === true,
        tokenUnit: usesNewModel
            ? parsePositiveInteger(raw?.tokenUnit, "기본 차감 토큰 수")
            : usesLegacyModel
                ? parsePositiveInteger(raw?.tokensPerCredit, "기본 차감 토큰 수")
                : DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.tokenUnit,
        creditUnit: usesNewModel
            ? parsePositiveInteger(raw?.creditUnit, "기본 지급 신용점수 수")
            : usesLegacyModel
                ? 1
                : DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.creditUnit,
        tierRules: normalizeRequestedTierRules(raw?.tierRules),
    };
}

function resolveCreditScoreMax(rawCriteria = {}) {
    const rawValue = rawCriteria?.maxScore;
    if (rawValue === null || rawValue === undefined || rawValue === "") {
        return null;
    }

    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) && numericValue > 0
        ? numericValue
        : null;
}

function getMissionTokenBalance(studentData = {}) {
    return Number(
        studentData?.assets?.missionToken ?? studentData?.assets?.token ?? 0,
    ) || 0;
}

function hasOwnMissionTokenField(studentData = {}) {
    return Object.prototype.hasOwnProperty.call(
        studentData?.assets || {},
        "missionToken",
    );
}

function hasLegacyTokenField(studentData = {}) {
    return Object.prototype.hasOwnProperty.call(studentData?.assets || {}, "token");
}

function resolveActorName(auth, callerData = null) {
    const name = String(
        callerData?.name ||
            auth?.token?.name ||
            auth?.token?.email ||
            "교사",
    ).trim();

    return name || "교사";
}

function resolveActiveRule(config = {}, studentData = {}) {
    const tier = normalizeTierInfo(studentData?.creditTier);
    const tierRule = tier?.id ? config?.tierRules?.[tier.id] : null;

    return {
        tokenUnit: Number(
            tierRule?.tokenUnit ?? config?.tokenUnit ?? DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.tokenUnit,
        ),
        creditUnit: Number(
            tierRule?.creditUnit ?? config?.creditUnit ?? DEFAULT_MISSION_TOKEN_CREDIT_CONFIG.creditUnit,
        ),
        tier,
        usesTierOverride: Boolean(tierRule),
    };
}

async function assertCanManageMissionEconomy(request, classId) {
    if (!request?.auth?.uid) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const callerRole = request.auth.token?.role || null;
    const callerClassId = request.auth.token?.classId || null;

    if (callerRole === "admin") {
        return;
    }

    if (callerRole === "teacher") {
        if (classId && callerClassId && callerClassId !== classId) {
            throw new HttpsError(
                "permission-denied",
                "다른 학급의 설정을 수정할 수 없습니다.",
            );
        }
        return;
    }

    const canManageMission = await hasPermission(
        request.auth.uid,
        classId,
        "mission_admin",
    );

    if (!canManageMission) {
        throw new HttpsError(
            "permission-denied",
            "미션 전환 설정을 수정할 권한이 없습니다.",
        );
    }
}

exports.updateMissionTokenCreditConfig = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "학급 정보가 필요합니다.");
        }

        await assertCanManageMissionEconomy(request, classId);

        const nextConfig = resolveRequestedConfig(request.data || {});
        const callerData = await getUserData(classId, request.auth.uid).catch(() => null);

        await db.doc(`classes/${classId}/config/missionEconomy`).set({
            enabled: nextConfig.enabled,
            tokenUnit: nextConfig.tokenUnit,
            creditUnit: nextConfig.creditUnit,
            tierRules: nextConfig.tierRules,
            updatedAt: FieldValue.serverTimestamp(),
            updatedByUid: request.auth.uid,
            updatedByName: resolveActorName(request.auth, callerData),
        });

        return {
            success: true,
            config: nextConfig,
            message: nextConfig.enabled
                ? "미션토큰 전환 규칙을 저장했습니다."
                : "학생 전환 기능을 비활성화하고 규칙을 저장했습니다.",
        };
    },
);

exports.convertMissionTokenToCredit = onCall(
    { region: "asia-northeast3", timeoutSeconds: 30 },
    async (request) => {
        const callerUid = request.auth?.uid || null;
        if (!callerUid) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "학급 정보가 필요합니다.");
        }

        const tokenAmount = Number(request.data?.amount);
        if (!Number.isInteger(tokenAmount) || tokenAmount <= 0) {
            throw new HttpsError(
                "invalid-argument",
                "전환할 미션토큰은 1 이상의 정수여야 합니다.",
            );
        }

        const [globalConfig, classSnap] = await Promise.all([
            getGlobalConfig(),
            db.doc(`classes/${classId}`).get(),
        ]);

        const classData = classSnap.exists ? classSnap.data() || {} : {};
        const logContext = {
            config: globalConfig,
            planType: classData.planType || "FREE",
            serviceName: "mission",
        };

        const configRef = db.doc(`classes/${classId}/config/missionEconomy`);
        const studentRef = db.doc(`classes/${classId}/students/${callerUid}`);
        const tierRef = db.doc(`classes/${classId}/tierCriteria/default`);

        let responsePayload = null;

        await db.runTransaction(async (tx) => {
            const [configSnap, studentSnap, tierSnap] = await tx.getAll(
                configRef,
                studentRef,
                tierRef,
            );

            if (!studentSnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "학생 정보를 찾을 수 없어 전환할 수 없습니다.",
                );
            }

            const studentData = studentSnap.data() || {};
            if (studentData?.role === "teacher" || studentData?.role === "admin") {
                throw new HttpsError(
                    "permission-denied",
                    "학생 계정만 미션토큰을 전환할 수 있습니다.",
                );
            }

            const config = normalizeStoredConfig(
                configSnap.exists ? configSnap.data() || {} : {},
            );

            if (!config.enabled) {
                throw new HttpsError(
                    "failed-precondition",
                    "현재 미션토큰 전환 기능이 비활성화되어 있습니다.",
                );
            }

            const activeRule = resolveActiveRule(config, studentData);

            if (tokenAmount % activeRule.tokenUnit !== 0) {
                throw new HttpsError(
                    "invalid-argument",
                    `${activeRule.tokenUnit}토큰 단위로만 전환할 수 있습니다.`,
                );
            }

            const currentMissionTokenBalance = Math.floor(
                getMissionTokenBalance(studentData),
            );
            if (tokenAmount > currentMissionTokenBalance) {
                throw new HttpsError(
                    "failed-precondition",
                    "보유한 미션토큰보다 많이 전환할 수 없습니다.",
                );
            }

            const currentCreditScore = Number(studentData?.creditScore || 0);
            const creditScoreMax = resolveCreditScoreMax(
                tierSnap.exists ? tierSnap.data() || {} : {},
            );
            const conversionCycles = tokenAmount / activeRule.tokenUnit;
            const creditDelta = conversionCycles * activeRule.creditUnit;

            if (Number.isFinite(creditScoreMax)) {
                const remainingCreditCapacity = Math.max(
                    creditScoreMax - currentCreditScore,
                    0,
                );
                const maxCyclesByCredit = Math.floor(
                    remainingCreditCapacity / activeRule.creditUnit,
                );

                if (maxCyclesByCredit <= 0) {
                    throw new HttpsError(
                        "failed-precondition",
                        "현재 신용점수 상한에 도달해 더 이상 전환할 수 없습니다.",
                    );
                }

                if (conversionCycles > maxCyclesByCredit) {
                    const maxTokenAmount = maxCyclesByCredit * activeRule.tokenUnit;
                    const maxCreditAmount = maxCyclesByCredit * activeRule.creditUnit;

                    throw new HttpsError(
                        "failed-precondition",
                        `현재는 최대 ${maxTokenAmount}토큰을 전환해 신용점수 ${maxCreditAmount}점까지만 받을 수 있습니다.`,
                    );
                }
            }

            const nextMissionTokenBalance = currentMissionTokenBalance - tokenAmount;
            const nextCreditScore = Number.isFinite(creditScoreMax)
                ? Math.min(currentCreditScore + creditDelta, creditScoreMax)
                : currentCreditScore + creditDelta;

            const studentUpdates = {
                creditScore: FieldValue.increment(creditDelta),
            };

            if (hasOwnMissionTokenField(studentData) || !hasLegacyTokenField(studentData)) {
                studentUpdates["assets.missionToken"] = FieldValue.increment(-tokenAmount);
            } else {
                studentUpdates["assets.missionToken"] = nextMissionTokenBalance;
                studentUpdates["assets.token"] = FieldValue.delete();
            }

            tx.update(studentRef, studentUpdates);

            stageActivityLog(
                tx,
                classId,
                {
                    studentUid: callerUid,
                    type: "exchange",
                    category: "mission_token_conversion",
                    subCategory: "mission_token_to_credit",
                    amount: tokenAmount,
                    description: `미션토큰 ${tokenAmount}개를 신용점수 ${creditDelta}점으로 전환`,
                    currency: "mission_token",
                    missionTokenDelta: -tokenAmount,
                    creditDelta,
                    conversionCycles,
                    tokenUnit: activeRule.tokenUnit,
                    creditUnit: activeRule.creditUnit,
                    appliedTierId: activeRule.tier?.id || null,
                    appliedTierName: activeRule.tier?.name || "",
                    usesTierOverride: activeRule.usesTierOverride,
                },
                logContext,
            );

            stageCreditLog(
                tx,
                classId,
                {
                    studentUid: callerUid,
                    delta: creditDelta,
                    reason: `미션토큰 ${tokenAmount}개 전환`,
                    source: "mission_token_conversion",
                    issuedByUid: callerUid,
                },
                logContext,
            );

            responsePayload = {
                success: true,
                convertedTokens: tokenAmount,
                creditDelta,
                conversionCycles,
                nextMissionTokenBalance,
                nextCreditScore,
                tokenUnit: activeRule.tokenUnit,
                creditUnit: activeRule.creditUnit,
                appliedTierId: activeRule.tier?.id || null,
                appliedTierName: activeRule.tier?.name || "",
                usesTierOverride: activeRule.usesTierOverride,
                message: `미션토큰 ${tokenAmount}개를 신용점수 ${creditDelta}점으로 전환했습니다.`,
            };
        });

        return responsePayload || { success: true };
    },
);
