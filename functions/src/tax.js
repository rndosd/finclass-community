const admin = require("../firebaseAdminCompat");
const {
    onDocumentCreated,
    onDocumentDeleted,
    onDocumentWritten, // 문서 변경 감시 트리거
} = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

// 주요 유틸 import (이름 충돌 방지를 위해 별칭 사용)
const { stageActivityLog } = require("../utils/logUtils");
const {
    stageTaxIncome,
    recordTaxIncome: recordTaxIncomeUtil,
} = require("../utils/taxIncome");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { stageTaxExpense } = require("../utils/taxExpense");
const { mustBeTeacherOrTaxAdmin } = require("../utils/permissions");
const { formatDateKeyInKST } = require("../utils/dateUtils");

const db = admin.firestore();
const inc = (n) => admin.firestore.FieldValue.increment(n);
const now = () => admin.firestore.FieldValue.serverTimestamp();
const TAX_LINE_COLLECTION = "lines";

const INCOME_PATH = "classes/{classId}/taxIncomes/{taxIncomeId}";
const EXPENSE_PATH = "classes/{classId}/taxExpenses/{expenseId}";

const toSafeId = (value, fallback = "na") => {
    const normalized = String(value ?? "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized || fallback;
};

const resolveAggregateBatchKey = (data, fallbackSeed) =>
    toSafeId(
        data?.aggregateBatchKey ||
            data?.requestId ||
            fallbackSeed ||
            db.collection("_").doc().id,
    );

const buildTaxRecordPointer = (collection, id, lineId) => ({
    collection,
    id,
    lineCollection: TAX_LINE_COLLECTION,
    lineId,
    detailStorage: "inline",
    aggregated: true,
});

const isTaxRecordCancelled = (data = {}) =>
    data?.isCancelled === true ||
    String(data?.status || "").toLowerCase() === "cancelled";

const toSafeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toTaxBillDate = (value) => {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") {
        const nanos = typeof value.nanoseconds === "number" ? value.nanoseconds : 0;
        return new Date(value.seconds * 1000 + Math.floor(nanos / 1000000));
    }
    if (typeof value._seconds === "number") {
        const nanos = typeof value._nanoseconds === "number" ? value._nanoseconds : 0;
        return new Date(value._seconds * 1000 + Math.floor(nanos / 1000000));
    }
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTaxBillDueDate = (bill = {}) =>
    toTaxBillDate(bill.dueAt || bill.dueDate);

const getTaxBillOverdueDays = (bill = {}, referenceDate = new Date()) => {
    if (bill?.isPaid === true || bill?.status === "paid") return 0;

    const dueDate = getTaxBillDueDate(bill);
    if (!dueDate) return 0;

    const diffMs = referenceDate.getTime() - dueDate.getTime();
    if (diffMs <= 0) return 0;

    return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
};

const normalizeTaxBillLateFeePolicy = (policy = {}) => {
    const mode = policy.mode === "rate" ? "rate" : "fixed";
    return {
        enabled: policy.enabled === true,
        mode,
        dailyAmount: Math.max(0, toSafeNumber(policy.dailyAmount)),
        dailyRate: Math.max(0, toSafeNumber(policy.dailyRate)),
        graceDays: Math.max(0, Math.floor(toSafeNumber(policy.graceDays))),
    };
};

const calculateTaxBillLateFee = (bill = {}, referenceDate = new Date()) => {
    const policy = normalizeTaxBillLateFeePolicy(bill.lateFeePolicy);
    const overdueDays = getTaxBillOverdueDays(bill, referenceDate);
    const chargeableDays = policy.enabled
        ? Math.max(0, overdueDays - policy.graceDays)
        : 0;
    const principalAmount = Math.max(
        0,
        toSafeNumber(bill.amount) - toSafeNumber(bill.amountPaid),
    );
    const rawAmount = policy.mode === "rate"
        ? principalAmount * (policy.dailyRate / 100) * chargeableDays
        : policy.dailyAmount * chargeableDays;

    return {
        ...policy,
        amount: policy.enabled ? Math.max(0, Math.round(rawAmount)) : 0,
        overdueDays,
        chargeableDays,
        principalAmount,
    };
};

/* -------------------------------------------
 * 날짜 유틸 (로컬 자정 기준 통일)
 * ----------------------------------------- */
const toDate = (tsOrDate) => {
    try {
        if (!tsOrDate) return new Date();
        if (typeof tsOrDate.toDate === "function") return tsOrDate.toDate(); // Firestore 타임스탬프
        return new Date(tsOrDate); // ISO 문자열/숫자/Date
    } catch {
        return new Date();
    }
};

const toLocalDateKey = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0); // 로컬 자정 고정
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`; // YYYY-MM-DD
};
void toLocalDateKey;

/* -------------------------------------------
 * 경로 안전 유틸 (byTaxType/byCategory 경로 보호)
 * ----------------------------------------- */
const safePathKey = (s) =>
    String(s ?? 'unknown')
        .toLowerCase()
        .trim()
        .replace(/[.$[\]#/ ]+/g, '_'); // 위험 문자 -> '_'

const safeTaxType = (data) => safePathKey(data.type || data.taxType || 'etc');
const safeCategory = (data) => safePathKey(data.category || data.expenseType || 'general');

async function applyTaxDelta({
    classId,
    dateKey,
    amountDelta,
    mode, // "income"(세입) | "expense"(세출)
    bucketKey,
}) {
    const summaryRef = db.doc(`classes/${classId}/dashboardSummary/taxSummary`);
    const dailyRef = db.doc(`classes/${classId}/taxDaily/${dateKey}`);

    const dailyPayload =
        mode === "income"
            ? {
                dateKey,
                incomeTotal: inc(amountDelta),
                [`byTaxType.${bucketKey}`]: inc(amountDelta),
                updatedAt: now(),
            }
            : {
                dateKey,
                expenseTotal: inc(amountDelta),
                [`byCategory.${bucketKey}`]: inc(amountDelta),
                updatedAt: now(),
            };

    const summaryPayload =
        mode === "income"
            ? {
                totalIncome: inc(amountDelta),
                [`byTaxType.${bucketKey}`]: inc(amountDelta),
                lastUpdated: now(),
            }
            : {
                totalExpense: inc(amountDelta),
                [`byCategory.${bucketKey}`]: inc(amountDelta),
                lastUpdated: now(),
            };

    const batch = db.batch();
    batch.set(dailyRef, dailyPayload, { merge: true });
    batch.set(summaryRef, summaryPayload, { merge: true });
    await batch.commit();
}

/* -------------------------------------------
 * 메모리 기반 보조 중복 방지 (트랜잭션 없는 경로 대비)
 * ----------------------------------------- */
const pendingPayments = new Map();
const PAYMENT_TIMEOUT = 30000; // 30초

setInterval(() => {
    const ts = Date.now();
    for (const [key, startedAt] of pendingPayments.entries()) {
        if (ts - startedAt > PAYMENT_TIMEOUT) pendingPayments.delete(key);
    }
}, 60000);
// rebuildTaxSummary 핵심 로직
async function rebuildTaxSummaryCore({ classId, startDate, endDate }) {
    const col = db.collection(`classes/${classId}/taxDaily`);

    // docId가 YYYY-MM-DD 형식이라 documentId 기준 범위 쿼리 사용
    let q = col;
    if (startDate && endDate) {
        const FieldPath = admin.firestore.FieldPath;
        q = col.orderBy(FieldPath.documentId()).startAt(startDate).endAt(endDate);
    }

    const snap = await q.get();

    let totalIncome = 0;
    let totalExpense = 0;
    const byTaxType = {};
    const byCategory = {};

    snap.forEach((doc) => {
        const d = doc.data() || {};
        totalIncome += Number(d.incomeTotal || 0);
        totalExpense += Number(d.expenseTotal || 0);

        const tmap = d.byTaxType || {};
        for (const k of Object.keys(tmap)) {
            byTaxType[k] = (byTaxType[k] || 0) + Number(tmap[k] || 0);
        }

        const cmap = d.byCategory || {};
        for (const k of Object.keys(cmap)) {
            byCategory[k] = (byCategory[k] || 0) + Number(cmap[k] || 0);
        }
    });

    await db.doc(`classes/${classId}/dashboardSummary/taxSummary`).set({
        totalIncome,
        totalExpense,
        byTaxType,
        byCategory,
        lastRebuiltAt: now(),
        rebuiltRange: startDate && endDate ? { startDate, endDate } : null,
    });

    return { totalIncome, totalExpense, byTaxType, byCategory, daysCount: snap.size };
}


/**
 * 세금 수입 생성 트리거
 */
exports.onTaxIncomeCreate = onDocumentCreated(
    { document: INCOME_PATH, region: "asia-northeast3" },
    async (event) => {
        const snap = event.data;
        if (!snap) return;
        const data = snap.data() || {};
        const classId = event.params.classId;
        const amount = Number(data.amount) || 0;
        if (!amount || isTaxRecordCancelled(data)) return;

        console.log(`[onTaxIncomeCreate] 시작 - 문서 ID: ${snap.id}, 금액: ${amount}`);

        const baseDate = toDate(data.timestamp || data.createdAt || new Date());
        const dateKey = formatDateKeyInKST(baseDate);
        const taxTypeKey = safeTaxType(data);

        try {
            await applyTaxDelta({
                classId,
                dateKey,
                amountDelta: amount,
                mode: "income",
                bucketKey: taxTypeKey,
            });
            console.log(`[onTaxIncomeCreate] 완료 - 문서 ID: ${snap.id}`);
        } catch (error) {
            console.error(`[onTaxIncomeCreate] 오류 - 문서 ID: ${snap.id}`, error);
        }
    }
);
exports.onTaxIncomeDelete = onDocumentDeleted(
    { document: INCOME_PATH, region: "asia-northeast3" },
    async (event) => {
        const snap = event.data;
        if (!snap) return;
        const data = snap.data() || {};
        const classId = event.params.classId;
        const amount = Number(data.amount) || 0;
        if (!amount || isTaxRecordCancelled(data)) return;

        console.log(`[onTaxIncomeDelete] 시작 - 문서 ID: ${snap.id}, 금액: ${amount}`);

        const baseDate = toDate(data.timestamp || data.createdAt || new Date());
        const dateKey = formatDateKeyInKST(baseDate);
        const taxTypeKey = safeTaxType(data);

        try {
            await applyTaxDelta({
                classId,
                dateKey,
                amountDelta: -amount,
                mode: "income",
                bucketKey: taxTypeKey,
            });
            console.log(`[onTaxIncomeDelete] 완료 - 문서 ID: ${snap.id}`);
        } catch (error) {
            console.error(`[onTaxIncomeDelete] 오류 - 문서 ID: ${snap.id}`, error);
        }
    }
);
exports.onTaxExpenseCreate = onDocumentCreated(
    { document: EXPENSE_PATH, region: "asia-northeast3" },
    async (event) => {
        const snap = event.data;
        if (!snap) return;
        const data = snap.data() || {};
        const classId = event.params.classId;
        const amount = Number(data.amount) || 0;
        if (!amount || isTaxRecordCancelled(data)) return;

        console.log(`[onTaxExpenseCreate] 시작 - 문서 ID: ${snap.id}, 금액: ${amount}`);

        const baseDate = toDate(data.timestamp || data.createdAt || new Date());
        const dateKey = formatDateKeyInKST(baseDate);
        const categoryKey = safeCategory(data);

        try {
            await applyTaxDelta({
                classId,
                dateKey,
                amountDelta: amount,
                mode: "expense",
                bucketKey: categoryKey,
            });
            console.log(`[onTaxExpenseCreate] 완료 - 문서 ID: ${snap.id}`);
        } catch (error) {
            console.error(`[onTaxExpenseCreate] 오류 - 문서 ID: ${snap.id}`, error);
        }
    }
);
exports.onTaxExpenseDelete = onDocumentDeleted(
    { document: EXPENSE_PATH, region: "asia-northeast3" },
    async (event) => {
        const snap = event.data;
        if (!snap) return;
        const data = snap.data() || {};
        const classId = event.params.classId;
        const amount = Number(data.amount) || 0;
        if (!amount || isTaxRecordCancelled(data)) return;

        console.log(`[onTaxExpenseDelete] 시작 - 문서 ID: ${snap.id}, 금액: ${amount}`);

        const baseDate = toDate(data.timestamp || data.createdAt || new Date());
        const dateKey = formatDateKeyInKST(baseDate);
        const categoryKey = safeCategory(data);

        try {
            await applyTaxDelta({
                classId,
                dateKey,
                amountDelta: -amount,
                mode: "expense",
                bucketKey: categoryKey,
            });
            console.log(`[onTaxExpenseDelete] 완료 - 문서 ID: ${snap.id}`);
        } catch (error) {
            console.error(`[onTaxExpenseDelete] 오류 - 문서 ID: ${snap.id}`, error);
        }
    }
);
// 요약 수동 집계: 기간 지원
const buildTaxDeltaMeta = (data = {}, bucketResolver) => ({
    amount: Number(data.amount) || 0,
    cancelled: isTaxRecordCancelled(data),
    dateKey: formatDateKeyInKST(toDate(data.timestamp || data.createdAt || new Date())),
    bucketKey: bucketResolver(data),
});

async function applyTaxWriteDelta({
    classId,
    mode,
    beforeData,
    afterData,
    bucketResolver,
}) {
    const beforeMeta = buildTaxDeltaMeta(beforeData || {}, bucketResolver);
    const afterMeta = buildTaxDeltaMeta(afterData || {}, bucketResolver);

    if (!beforeMeta.cancelled && afterMeta.cancelled) {
        if (beforeMeta.amount !== 0) {
            await applyTaxDelta({
                classId,
                dateKey: beforeMeta.dateKey,
                amountDelta: -beforeMeta.amount,
                mode,
                bucketKey: beforeMeta.bucketKey,
            });
        }
        return;
    }

    if (beforeMeta.cancelled && !afterMeta.cancelled) {
        if (afterMeta.amount !== 0) {
            await applyTaxDelta({
                classId,
                dateKey: afterMeta.dateKey,
                amountDelta: afterMeta.amount,
                mode,
                bucketKey: afterMeta.bucketKey,
            });
        }
        return;
    }

    if (beforeMeta.cancelled && afterMeta.cancelled) return;

    const sameBucketAndDate =
        beforeMeta.dateKey === afterMeta.dateKey &&
        beforeMeta.bucketKey === afterMeta.bucketKey;

    if (sameBucketAndDate) {
        const diff = afterMeta.amount - beforeMeta.amount;
        if (diff !== 0) {
            await applyTaxDelta({
                classId,
                dateKey: afterMeta.dateKey,
                amountDelta: diff,
                mode,
                bucketKey: afterMeta.bucketKey,
            });
        }
        return;
    }

    if (beforeMeta.amount !== 0) {
        await applyTaxDelta({
            classId,
            dateKey: beforeMeta.dateKey,
            amountDelta: -beforeMeta.amount,
            mode,
            bucketKey: beforeMeta.bucketKey,
        });
    }
    if (afterMeta.amount !== 0) {
        await applyTaxDelta({
            classId,
            dateKey: afterMeta.dateKey,
            amountDelta: afterMeta.amount,
            mode,
            bucketKey: afterMeta.bucketKey,
        });
    }
}

exports.onTaxIncomeWrite = onDocumentWritten(
    { document: INCOME_PATH, region: "asia-northeast3" },
    async (event) => {
        if (!event.data.before.exists || !event.data.after.exists) return;
        const classId = event.params.classId;
        const beforeData = event.data.before.data() || {};
        const afterData = event.data.after.data() || {};

        try {
            await applyTaxWriteDelta({
                classId,
                mode: "income",
                beforeData,
                afterData,
                bucketResolver: safeTaxType,
            });
        } catch (error) {
            console.error("[onTaxIncomeWrite] error", error);
        }
    }
);

exports.onTaxExpenseWrite = onDocumentWritten(
    { document: EXPENSE_PATH, region: "asia-northeast3" },
    async (event) => {
        if (!event.data.before.exists || !event.data.after.exists) return;
        const classId = event.params.classId;
        const beforeData = event.data.before.data() || {};
        const afterData = event.data.after.data() || {};

        try {
            await applyTaxWriteDelta({
                classId,
                mode: "expense",
                beforeData,
                afterData,
                bucketResolver: safeCategory,
            });
        } catch (error) {
            console.error("[onTaxExpenseWrite] error", error);
        }
    }
);

exports.rebuildTaxSummary = onCall(
    { region: "asia-northeast3", timeoutSeconds: 540 },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, startDate, endDate } = data || {};
        if (!classId) throw new HttpsError("invalid-argument", "classId가 필요합니다.");

        // 권한: 교사 또는 세금 관리자(tax_admin)
        await mustBeTeacherOrTaxAdmin(classId, auth.uid);

        // 기간 검증
        if ((startDate && !endDate) || (!startDate && endDate)) {
            throw new HttpsError(
                "invalid-argument",
                "startDate와 endDate를 함께 보내주세요.",
            );
        }
        if (startDate && endDate && startDate > endDate) {
            throw new HttpsError("invalid-argument", "기간 범위가 올바르지 않습니다.");
        }

        const result = await rebuildTaxSummaryCore({ classId, startDate, endDate });
        return { success: true, ...result };
    }
);

// taxDaily 합산값과 현재 요약값의 차이를 반환
exports.verifyTaxIntegrity = onCall(
    { region: "asia-northeast3", timeoutSeconds: 300 },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, startDate, endDate } = data || {};
        if (!classId) throw new HttpsError("invalid-argument", "classId가 필요합니다.");

        await mustBeTeacherOrTaxAdmin(classId, auth.uid);

        // taxDaily 일자 문서 합산
        const col = db.collection(`classes/${classId}/taxDaily`);
        let q = col;
        if (startDate && endDate) {
            if (startDate > endDate) {
                throw new HttpsError("invalid-argument", "기간 범위가 올바르지 않습니다.");
            }
            const FieldPath = admin.firestore.FieldPath;
            q = col
                .orderBy(FieldPath.documentId())
                .startAt(startDate)
                .endAt(endDate);
        }
        const snap = await q.get();

        let calcIncome = 0;
        let calcExpense = 0;
        const calcByType = {};
        const calcByCat = {};

        snap.forEach((doc) => {
            const d = doc.data() || {};
            calcIncome += Number(d.incomeTotal || 0);
            calcExpense += Number(d.expenseTotal || 0);

            const tmap = d.byTaxType || {};
            for (const k of Object.keys(tmap)) {
                calcByType[k] = (calcByType[k] || 0) + Number(tmap[k] || 0);
            }
            const cmap = d.byCategory || {};
            for (const k of Object.keys(cmap)) {
                calcByCat[k] = (calcByCat[k] || 0) + Number(cmap[k] || 0);
            }
        });

        // 현재 요약 읽기
        const summaryRef = db.doc(`classes/${classId}/dashboardSummary/taxSummary`);
        const summarySnap = await summaryRef.get();
        const sum = summarySnap.exists ? summarySnap.data() : {};
        const curIncome = Number(sum.totalIncome || 0);
        const curExpense = Number(sum.totalExpense || 0);
        const curByType = sum.byTaxType || {};
        const curByCat = sum.byCategory || {};

        // 차이 계산
        const diffByType = {};
        const allTypes = new Set([...Object.keys(calcByType), ...Object.keys(curByType)]);
        for (const k of allTypes) {
            diffByType[k] = Number(calcByType[k] || 0) - Number(curByType[k] || 0);
        }

        const diffByCat = {};
        const allCats = new Set([...Object.keys(calcByCat), ...Object.keys(curByCat)]);
        for (const k of allCats) {
            diffByCat[k] = Number(calcByCat[k] || 0) - Number(curByCat[k] || 0);
        }

        return {
            success: true,
            range: startDate && endDate ? { startDate, endDate } : null,
            current: { totalIncome: curIncome, totalExpense: curExpense, byTaxType: curByType, byCategory: curByCat },
            recomputed: { totalIncome: calcIncome, totalExpense: calcExpense, byTaxType: calcByType, byCategory: calcByCat },
            diff: {
                totalIncome: calcIncome - curIncome,
                totalExpense: calcExpense - curExpense,
                byTaxType: diffByType,
                byCategory: diffByCat,
            },
            daysCount: snap.size,
        };
    }
);

/* -------------------------------------------
 * 3) 수동 세금 기록 (TaxRecordModal)
 * ----------------------------------------- */

/**
 * 1) 수동 세금 수입 기록 (recordTaxIncome)
 * 마스터 플랜 기반 권한 체크 및 로그 컨텍스트 적용
 */
exports.recordTaxIncome = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, amount, taxType = "manual_income", description } = data || {};
    if (!classId) throw new HttpsError("invalid-argument", "classId가 필요합니다.");

    // 1. 전역 플랜/학급 데이터 로드
    const [globalConfig, classSnap] = await Promise.all([
        getGlobalConfig(),
        db.doc(`classes/${classId}`).get()
    ]);

    const classData = classSnap.data() || {};
    const planType = classData.planType || "FREE";
    const logContext = {
        config: globalConfig,
        planType,
        serviceName: "tax",
        pageKey: "tax",
    };

    // 2. 마스터 플랜 체크: 급여 기능 접근 권한
    if (!canUseFeature(globalConfig, planType, "tax", "accessible")) {
        throw new HttpsError(
            "permission-denied",
            "현재 플랜에서는 세금 기록 기능을 사용할 수 없습니다.",
        );
    }

    await mustBeTeacherOrTaxAdmin(classId, auth.uid);

    try {
        // 유틸 함수에 logContext를 전달해 플랜 기반 로그를 기록
        const result = await recordTaxIncomeUtil(
            classId,
            { amount: Number(amount), description, source: "manual_record", taxType },
            auth.uid,
            { alsoUpdateSummary: false, ...logContext }
        );
        return { success: true, id: result.id };
    } catch (e) {
        throw new HttpsError("internal", "세금 수입 기록에 실패했습니다.");
    }
});

/**
 * 2) 수동 세금 지출 기록 (recordTaxExpense)
 * 마스터 플랜 기반 권한 체크 및 수동 로그 플랜 적용
 */
exports.recordTaxExpense = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, amountUsed, reason, category = "general" } = data || {};
    if (!classId) throw new HttpsError("invalid-argument", "classId가 필요합니다.");

    const [globalConfig, classSnap] = await Promise.all([
        getGlobalConfig(),
        db.doc(`classes/${classId}`).get()
    ]);

    const classData = classSnap.data() || {};
    const planType = classData.planType || "FREE";
    const logContext = {
        config: globalConfig,
        planType,
        serviceName: "tax",
        pageKey: "tax",
    };

    // 마스터 플랜 체크
    if (!canUseFeature(globalConfig, planType, "tax", "accessible")) {
        throw new HttpsError(
            "permission-denied",
            "현재 플랜에서는 세금 지출 기록 권한이 없습니다.",
        );
    }

    await mustBeTeacherOrTaxAdmin(classId, auth.uid);

    return await db.runTransaction(async (tx) => {
        const expenseResult = stageTaxExpense(
            tx,
            classId,
            {
                amount: Number(amountUsed),
                description: reason,
                source: "manual_record",
                expenseType: category,
                category,
                studentUid: auth.uid,
            },
            auth.uid,
            logContext
        );
        if (expenseResult?.skipped) {
            throw new HttpsError("failed-precondition", "세금 기능이 비활성화되어 있습니다.");
        }
        const expenseId = expenseResult?.id || null;

        // 수동 로그: 플랜에 따라 기록 여부 결정
        stageActivityLog(tx, classId, {
            studentUid: auth.uid,
            type: "admin_action",
            category: "tax_expense_record",
            amount: Number(amountUsed),
            description: `세금 지출 기록: ${reason}`,
            relatedDoc: { collection: "taxExpenses", id: expenseId }
        }, logContext);

        return { success: true, id: expenseId };
    });
});

/* -------------------------------------------
 * 4) 세금 고지서 납부 처리
 * ----------------------------------------- */

/**
 * 미납 고지서 목록 및 학생 잔액 조회
 */
exports.getUnpaidTaxBills = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId } = data || {};
        if (!classId) throw new HttpsError("invalid-argument", "classId가 필요합니다.");

        const studentUid = auth.uid;

        try {
            // 미납 고지서 조회
            const billsSnapshot = await db.collection(
                `classes/${classId}/students/${studentUid}/taxBills`
            )
                .where("isPaid", "==", false)
                .get();
            const unpaidBills = billsSnapshot.docs
                .map((doc) => {
                    const bill = doc.data() || {};

                    // 안전한 날짜 처리
                    let issuedDate = null;
                    try {
                        const issuedSource = bill.issuedAt || bill.createdAt || bill.timestamp;
                        if (issuedSource) {
                            if (typeof issuedSource.toDate === "function") {
                                issuedDate = issuedSource.toDate().toISOString();
                            } else if (issuedSource?.seconds) {
                                issuedDate = new Date(issuedSource.seconds * 1000).toISOString();
                            } else if (
                                typeof issuedSource === "string" ||
                                typeof issuedSource === "number"
                            ) {
                                issuedDate = new Date(issuedSource).toISOString();
                            }
                        }
                    } catch (err) {
                        console.warn("날짜 파싱 실패:", bill.issuedAt, err);
                    }
                    if (!issuedDate) issuedDate = new Date().toISOString();

                    return {
                        id: doc.id,
                        ...bill,
                        issuedDate,
                    };
                })
                .sort((a, b) => new Date(a.issuedDate) - new Date(b.issuedDate));

            // 통화 필드명 조회
            const classDoc = await db.doc(`classes/${classId}`).get();
            const currencyField = classDoc.data()?.currencySettings?.field || "cash";

            // 학생 잔액 조회(설정 필드 사용)
            const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
            const studentDoc = await studentRef.get();
            const studentBalance = studentDoc.exists
                ? Number(studentDoc.data()?.assets?.[currencyField] ?? 0)
                : 0;

            return {
                success: true,
                unpaidBills,
                studentBalance,
            };
        } catch (error) {
            console.error("미납 고지서 조회 오류:", error);
            throw new HttpsError("internal", "데이터 조회에 실패했습니다.");
        }
    }
);

/**
 * 3) 세금 고지서 일괄 납부 (processTaxPayment)
 * 플랜 기능 체크 및 자동 세입 반영
 */
exports.processTaxPayment = onCall({ region: "asia-northeast3" }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, billIds } = data || {};
    if (!classId) throw new HttpsError("invalid-argument", "classId가 필요합니다.");
    if (!Array.isArray(billIds) || billIds.length === 0) {
        throw new HttpsError("invalid-argument", "납부할 고지서 ID 목록이 필요합니다.");
    }

    const globalConfig = await getGlobalConfig();
    const batchKey = resolveAggregateBatchKey(
        data,
        `tax_bill_payment_${auth.uid}_${Date.now()}`,
    );

    return await db.runTransaction(async (tx) => {
        const classSnap = await tx.get(db.doc(`classes/${classId}`));
        const studentRef = db.doc(`classes/${classId}/students/${auth.uid}`);
        const studentSnap = await tx.get(studentRef);

        const classData = classSnap.data() || {};
        const studentData = studentSnap.data() || {};
        const planType = classData.planType || "FREE";
        const logContext = {
            config: globalConfig,
            planType,
            serviceName: "tax",
            pageKey: "tax",
        };
        const currencyField = classData.currencySettings?.field || "cash";
        const studentName = studentData.name || studentData.displayName || null;
        const aggregateTaxId = `tax_bill_payment_${batchKey}`;

        if (!canUseFeature(globalConfig, planType, "tax", "accessible")) {
            throw new HttpsError(
                "permission-denied",
                "현재 플랜에서는 세금 납부 기능을 사용할 수 없습니다.",
            );
        }

        let totalAmount = 0;
        const billsData = [];
        const taxPaymentLines = [];
        const paymentDate = new Date();

        for (const bid of billIds) {
            const billRef = studentRef.collection("taxBills").doc(bid);
            const bSnap = await tx.get(billRef);
            if (!bSnap.exists) continue;

            const billData = bSnap.data() || {};
            const isAlreadyPaid = billData.isPaid === true || billData.status === "paid";
            if (isAlreadyPaid) continue;

            const billAmount = Math.max(0, Number(billData.amount || 0));
            const lateFee = calculateTaxBillLateFee(billData, paymentDate);
            const lateFeeAmount = lateFee.amount;
            const billTotalAmount = billAmount + lateFeeAmount;
            billsData.push({
                ref: billRef,
                data: billData,
                id: bid,
                amount: billAmount,
                lateFee,
                lateFeeAmount,
                totalAmount: billTotalAmount,
            });
            totalAmount += billTotalAmount;

            if (billTotalAmount > 0) {
                taxPaymentLines.push({
                    id: bid,
                    amount: billTotalAmount,
                    source: "tax_bill_payment",
                    taxType: billData.taxType || "etc",
                    description: `${studentName || auth.uid} - ${billData.name || "세금 고지서"} 납부`,
                    studentUid: auth.uid,
                    studentName,
                    relatedDoc: { collection: "taxBills", id: bid },
                    externalId: bid,
                    meta: {
                        billName: billData.name || null,
                        principalAmount: billAmount,
                        lateFeeAmount,
                        lateFeeOverdueDays: lateFee.overdueDays,
                        lateFeeChargeableDays: lateFee.chargeableDays,
                        lateFeeMode: lateFee.mode,
                    },
                });
            }
        }

        if (billsData.length === 0) {
            throw new HttpsError("failed-precondition", "납부 가능한 고지서가 없습니다.");
        }
        if (!(totalAmount > 0)) {
            throw new HttpsError("failed-precondition", "납부 가능한 고지서 금액이 없습니다.");
        }
        if (Number(studentData?.assets?.[currencyField] || 0) < totalAmount) {
            throw new HttpsError("failed-precondition", "잔액이 부족하여 세금을 납부할 수 없습니다.");
        }

        const taxIncomeResult = stageTaxIncome(
            tx,
            classId,
            {
                amount: totalAmount,
                description: `세금 고지서 납부 합산 (${taxPaymentLines.length}건)`,
                source: "tax_bill_payment",
                taxType: "tax_bill_payment",
                studentUid: auth.uid,
                studentName,
            },
            auth.uid,
            {
                ...logContext,
                customId: aggregateTaxId,
                classData,
                sourceKey: "taxBillPayment",
                aggregateMeta: {
                    group: "tax_bill_payment",
                    batchKey,
                    pageKey: "tax",
                    actorUid: auth.uid,
                    actorName: studentName,
                    mode: "process_tax_payment",
                },
                detailLines: taxPaymentLines,
                detailCollection: TAX_LINE_COLLECTION,
            },
        );
        const isTaxRecorded = !taxIncomeResult?.skipped && !!taxIncomeResult?.id;

        for (const bill of billsData) {
            stageActivityLog(tx, classId, {
                studentUid: auth.uid,
                type: "expense",
                category: "tax_payment",
                amount: bill.totalAmount,
                principalAmount: bill.amount,
                lateFeeAmount: bill.lateFeeAmount,
                description: `'${bill.data.name || "고지서"}' 세금 납부`,
                relatedDoc: { collection: "taxBills", id: bill.id },
                taxEvent: {
                    sourceKey:
                        bill.data.billKind === "month_end_settlement"
                            ? "monthEndSettlementAdditional"
                            : "taxBillPayment",
                    taxCategory:
                        bill.data.billKind === "month_end_settlement"
                            ? "settlement_additional"
                            : "bill_payment",
                    taxType: bill.data.taxType || "tax_bill_payment",
                    amount: bill.totalAmount,
                    taxableAmount: bill.amount,
                    taxRate: null,
                    sourceDoc: { collection: "taxBills", id: bill.id },
                },
            }, logContext);

            tx.update(bill.ref, {
                isPaid: true,
                status: "paid",
                paidAt: now(),
                amountPaid: bill.amount,
                lateFeePaid: bill.lateFeeAmount,
                lateFeeCalculatedAt: now(),
                lateFeeOverdueDays: bill.lateFee.overdueDays,
                lateFeeChargeableDays: bill.lateFee.chargeableDays,
                totalPaidAmount: bill.totalAmount,
                ...(isTaxRecorded
                    ? {
                        taxRecord: buildTaxRecordPointer(
                            "taxIncomes",
                            aggregateTaxId,
                            bill.id,
                        ),
                        taxRecordedAt: now(),
                        taxCancelled: false,
                    }
                    : {}),
            });
        }

        tx.update(studentRef, {
            [`assets.${currencyField}`]: inc(-totalAmount),
            lastUpdated: now(),
        });

        return {
            success: true,
            totalAmount,
            taxAggregateId: isTaxRecorded ? aggregateTaxId : null,
        };
    });
});

/* -------------------------------------------
 * 5) 세금 데이터 삭제 (관리자)
 * ----------------------------------------- */

/**
 * 세금 수입 기록 삭제
 */
exports.deleteTaxIncome = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, taxIncomeId, reason = "" } = data || {};
        if (!classId || !taxIncomeId)
            throw new HttpsError("invalid-argument", "classId와 taxIncomeId가 필요합니다.");

        await mustBeTeacherOrTaxAdmin(classId, auth.uid);

        const hardDeleteResult = await db.runTransaction(async (tx) => {
            const ref = db.doc(`classes/${classId}/taxIncomes/${taxIncomeId}`);
            const snap = await tx.get(ref);
            if (!snap.exists)
                throw new HttpsError("not-found", "?ë©¸íˆ‘ ?ì„ì—¯ æ¹²ê³•ì¤‰??ï§¡ì– ì“£ ???ë†ë’¿?ëˆë–Ž.");

            const record = snap.data() || {};
            tx.delete(ref);

            return {
                deletedAmount: Number(record.amount || 0),
                deletedReason: reason || "",
            };
        });

        return {
            success: true,
            message: "?ë©¸íˆ‘ ?ì„ì—¯ æ¹²ê³•ì¤‰??ì‚­ì œë˜ì—ˆìŠµë‹ˆë‹¤.",
            ...hardDeleteResult,
        };

        await db.runTransaction(async (tx) => {
            const ref = db.doc(`classes/${classId}/taxIncomes/${taxIncomeId}`);
            const snap = await tx.get(ref);
            if (!snap.exists)
                throw new HttpsError("not-found", "세금 수입 기록을 찾을 수 없습니다.");

            const record = snap.data() || {};
            if (!isTaxRecordCancelled(record)) {
                tx.set(
                    ref,
                    {
                        status: "cancelled",
                        isCancelled: true,
                        cancelledAt: now(),
                        cancelledBy: auth.uid,
                        cancelledReason: reason || "tax_income_delete",
                    },
                    { merge: true },
                );
            }

            stageActivityLog(tx, classId, {
                studentUid: auth.uid,
                type: "admin_action",
                category: "tax_income_cancel",
                amount: Number(record.amount || 0),
                description: `세금 수입 취소: ${record.description || ""}`,
                relatedDoc: { collection: "taxIncomes", id: taxIncomeId },
            });
        });

        return { success: true, message: "세금 수입 기록을 취소처리했습니다." };
    }
);
exports.deleteTaxExpense = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, taxExpenseId, reason = "" } = data || {};
        if (!classId || !taxExpenseId)
            throw new HttpsError("invalid-argument", "classId와 taxExpenseId가 필요합니다.");

        await mustBeTeacherOrTaxAdmin(classId, auth.uid);

        const hardDeleteResult = await db.runTransaction(async (tx) => {
            const ref = db.doc(`classes/${classId}/taxExpenses/${taxExpenseId}`);
            const snap = await tx.get(ref);
            if (!snap.exists)
                throw new HttpsError("not-found", "?ë©¸íˆ‘ ï§žÂ€ç•°?æ¹²ê³•ì¤‰??ï§¡ì– ì“£ ???ë†ë’¿?ëˆë–Ž.");

            const record = snap.data() || {};
            tx.delete(ref);

            return {
                deletedAmount: Number(record.amount || 0),
                category: record.category || null,
                deletedReason: reason || "",
            };
        });

        return {
            success: true,
            message: "?ë©¸íˆ‘ ï§žÂ€ç•°?æ¹²ê³•ì¤‰??ì‚­ì œë˜ì—ˆìŠµë‹ˆë‹¤.",
            ...hardDeleteResult,
        };

        await db.runTransaction(async (tx) => {
            const ref = db.doc(`classes/${classId}/taxExpenses/${taxExpenseId}`);
            const snap = await tx.get(ref);
            if (!snap.exists)
                throw new HttpsError("not-found", "세금 지출 기록을 찾을 수 없습니다.");

            const record = snap.data() || {};
            if (!isTaxRecordCancelled(record)) {
                tx.set(
                    ref,
                    {
                        status: "cancelled",
                        isCancelled: true,
                        cancelledAt: now(),
                        cancelledBy: auth.uid,
                        cancelledReason: reason || "tax_expense_delete",
                    },
                    { merge: true },
                );
            }

            stageActivityLog(tx, classId, {
                studentUid: auth.uid,
                type: "admin_action",
                category: "tax_expense_cancel",
                amount: Number(record.amount || 0),
                description: `세금 지출 취소: ${record.description || ""}`,
                relatedDoc: { collection: "taxExpenses", id: taxExpenseId },
            });
        });

        return { success: true, message: "세금 지출 기록을 취소처리했습니다." };
    }
);
exports.bulkDeleteTaxData = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const { classId, incomeIds = [], expenseIds = [], reason = "" } = data || {};
        if (!classId || (incomeIds.length === 0 && expenseIds.length === 0)) {
            throw new HttpsError("invalid-argument", "취소할 데이터가 없습니다.");
        }

        await mustBeTeacherOrTaxAdmin(classId, auth.uid);

        const hardDeleteResult = await db.runTransaction(async (tx) => {
            const incomeRefs = [];
            const expenseRefs = [];

            for (const id of incomeIds) {
                const ref = db.doc(`classes/${classId}/taxIncomes/${id}`);
                const snap = await tx.get(ref);
                if (snap.exists) incomeRefs.push({ ref, data: snap.data(), id });
            }

            for (const id of expenseIds) {
                const ref = db.doc(`classes/${classId}/taxExpenses/${id}`);
                const snap = await tx.get(ref);
                if (snap.exists) expenseRefs.push({ ref, data: snap.data(), id });
            }

            let deletedIncomeCount = 0;
            let deletedExpenseCount = 0;
            let deletedIncomeAmount = 0;
            let deletedExpenseAmount = 0;

            for (const item of incomeRefs) {
                tx.delete(item.ref);
                deletedIncomeCount += 1;
                deletedIncomeAmount += Number(item.data?.amount || 0);
            }

            for (const item of expenseRefs) {
                tx.delete(item.ref);
                deletedExpenseCount += 1;
                deletedExpenseAmount += Number(item.data?.amount || 0);
            }

            return {
                deletedIncomeCount,
                deletedExpenseCount,
                deletedIncomeAmount,
                deletedExpenseAmount,
                deletedReason: reason || "",
            };
        });

        return {
            success: true,
            message: `${hardDeleteResult.deletedIncomeCount}å«„ëŒì“½ ?ì„ì—¯ì´ê³  ${hardDeleteResult.deletedExpenseCount}å«„ëŒì“½ ï§žÂ€ç•°ê°€ ì‚­ì œë˜ì—ˆìŠµë‹ˆë‹¤.`,
            ...hardDeleteResult,
        };

        const result = await db.runTransaction(async (tx) => {
            const incomeRefs = [];
            const expenseRefs = [];

            for (const id of incomeIds) {
                const ref = db.doc(`classes/${classId}/taxIncomes/${id}`);
                const snap = await tx.get(ref);
                if (snap.exists) incomeRefs.push({ ref, data: snap.data(), id });
            }

            for (const id of expenseIds) {
                const ref = db.doc(`classes/${classId}/taxExpenses/${id}`);
                const snap = await tx.get(ref);
                if (snap.exists) expenseRefs.push({ ref, data: snap.data(), id });
            }

            let cancelledIncomeCount = 0;
            let cancelledExpenseCount = 0;

            for (const item of incomeRefs) {
                if (isTaxRecordCancelled(item.data)) continue;
                tx.set(
                    item.ref,
                    {
                        status: "cancelled",
                        isCancelled: true,
                        cancelledAt: now(),
                        cancelledBy: auth.uid,
                        cancelledReason: reason || "tax_data_bulk_delete",
                    },
                    { merge: true },
                );
                cancelledIncomeCount += 1;
            }

            for (const item of expenseRefs) {
                if (isTaxRecordCancelled(item.data)) continue;
                tx.set(
                    item.ref,
                    {
                        status: "cancelled",
                        isCancelled: true,
                        cancelledAt: now(),
                        cancelledBy: auth.uid,
                        cancelledReason: reason || "tax_data_bulk_delete",
                    },
                    { merge: true },
                );
                cancelledExpenseCount += 1;
            }

            stageActivityLog(tx, classId, {
                studentUid: auth.uid,
                type: "admin_action",
                category: "tax_data_bulk_cancel",
                amount: cancelledIncomeCount + cancelledExpenseCount,
                description: `세금 데이터 일괄 취소 (수입: ${cancelledIncomeCount}, 지출: ${cancelledExpenseCount})`,
            });

            return { cancelledIncomeCount, cancelledExpenseCount };
        });

        return {
            success: true,
            message: `${result.cancelledIncomeCount}건의 수입과 ${result.cancelledExpenseCount}건의 지출을 취소처리했습니다.`,
            ...result,
        };
    }
);
exports.watchTaxSummary = onDocumentWritten(
    "classes/{classId}/dashboardSummary/taxSummary",
    (event) => {
        console.log(`[watchTaxSummary] 트리거 실행 classId: ${event.params.classId}`);

        // 변경 전 데이터
        if (event.data.before.exists) {
            console.log("[watchTaxSummary] 변경 전:", JSON.stringify(event.data.before.data()));
        } else {
            console.log("[watchTaxSummary] 변경 전: 문서가 존재하지 않습니다.");
        }

        // 변경 후 데이터
        if (event.data.after.exists) {
            console.log("[watchTaxSummary] 변경 후:", JSON.stringify(event.data.after.data()));
        } else {
            console.log("[watchTaxSummary] 변경 후: 문서가 삭제되었습니다.");
        }
    }
);


