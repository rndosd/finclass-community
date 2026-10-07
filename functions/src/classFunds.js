"use strict";

const admin = require("../firebaseAdminCompat");
const { FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { stageActivityLog } = require("../utils/logUtils");
const {
    assertCanOperateClassFund,
    mustBeTeacherOrTaxAdmin,
} = require("../utils/permissions");
const { stageTaxExpense } = require("../utils/taxExpense");
const { formatDateKeyInKST } = require("../utils/dateUtils");
const {
    buildClassFundSettlementId,
    getCommittedClassFundBudgetTotal,
} = require("../utils/classFundAccounting");
const {
    getClassFundChannelAccess,
    normalizeAllowedChannels,
    normalizeUsageChannel,
} = require("../utils/classFundPolicy");
const {
    stageImmediateClassFundExpense,
} = require("../utils/classFundExpenseRecording");
const {
    CANCELLATION_STATUS_CANCELLED,
    CANCELLATION_STATUS_REVERSAL,
    buildClassFundUsageCancellationAccounting,
    getClassFundUsageCancellationPolicy,
} = require("../utils/classFundUsageCancellation");
const { normalizePensionSettings } = require("../utils/classFundPension");
const { getClassFundArchivePlan } = require("../utils/classFundArchive");

const db = admin.firestore();

const FUND_STATUS_ACTIVE = "active";
const MAX_BULK_ALLOCATIONS = 50;
const MAX_SETTLEMENT_USAGES = 200;
const USAGE_STATUS_PENDING = "pending";
const USAGE_STATUS_SETTLED = "settled";

const cleanText = (value, maxLength = 200) =>
    String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);

const normalizeFundType = (value) => {
    const normalized = cleanText(value, 40)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized || "general";
};

const toMoneyAmount = (value) => {
    const amount = Math.round(Number(value));
    return Number.isFinite(amount) ? amount : 0;
};

const assertClassFundFeature = (globalConfig, planType) => {
    if (!canUseFeature(globalConfig, planType, "tax", "accessible")) {
        throw new HttpsError(
            "permission-denied",
            "현재 요금제에서는 예산·기금 기능을 사용할 수 없습니다.",
        );
    }
};

const getTaxBalance = (summary = {}) =>
    toMoneyAmount(summary.totalIncome) - toMoneyAmount(summary.totalExpense);

const isInvestmentFundType = (fundType) => fundType === "investment";
const isAssetOperationFundType = (fundType) =>
    fundType === "investment" || fundType === "pension";

const isExpenseSettlementFund = (fund = {}) =>
    !isInvestmentFundType(fund.fundType) &&
    fund.settlementBehavior !== "asset_operation";

const buildFundAccountingFields = (fundType) =>
    isAssetOperationFundType(fundType)
        ? {
            accountingMode: fundType === "pension" ? "pension" : "investment",
            settlementBehavior: "asset_operation",
            usageSettlementMode: "none",
            investmentValue: 0,
            realEstateValue: 0,
            totalValue: 0,
            realizedGain: 0,
            realizedLoss: 0,
            ...(fundType === "pension" ? {
                pensionContributionTotal: 0,
                pensionParticipantCount: 0,
                pensionSettings: normalizePensionSettings({}),
            } : {}),
        }
        : {
            accountingMode: "expense_budget",
            settlementBehavior: "daily_expense_settlement",
            usageSettlementMode: "daily",
            pendingSettlementExpenseTotal: 0,
            settledExpenseTotal: 0,
        };

const loadClassContext = async (classId) => {
    const [globalConfig, classSnap] = await Promise.all([
        getGlobalConfig(),
        db.doc(`classes/${classId}`).get(),
    ]);
    const classData = classSnap.exists ? classSnap.data() || {} : {};
    const planType = classData.planType || "FREE";
    assertClassFundFeature(globalConfig, planType);
    return {
        globalConfig,
        classData,
        planType,
        logContext: {
            config: globalConfig,
            planType,
            serviceName: "tax",
            pageKey: "budgetFunds",
        },
    };
};

const mustManageClassFunds = async (classId, uid) => {
    const permissionInfo = await mustBeTeacherOrTaxAdmin(classId, uid);
    if (!permissionInfo.isTeacher && !permissionInfo.hasTaxAdmin) {
        throw new HttpsError(
            "permission-denied",
            "국세청 관리자 권한이 필요합니다.",
        );
    }
    return permissionInfo;
};

exports.createClassFund = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const name = cleanText(data?.name, 60);
        const description = cleanText(data?.description, 500);
        const fundType = normalizeFundType(data?.fundType);
        const allowedChannels = normalizeAllowedChannels(data?.allowedChannels, fundType);

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId가 필요합니다.");
        }
        if (name.length < 2) {
            throw new HttpsError("invalid-argument", "기금 이름은 2자 이상이어야 합니다.");
        }

        await mustManageClassFunds(classId, auth.uid);
        await loadClassContext(classId);

        const fundRef = db.collection(`classes/${classId}/classFunds`).doc();
        const now = FieldValue.serverTimestamp();
        await fundRef.set({
            name,
            description,
            fundType,
            status: FUND_STATUS_ACTIVE,
            cashBalance: 0,
            allocatedFromTaxTotal: 0,
            spentTotal: 0,
            transferInTotal: 0,
            transferOutTotal: 0,
            allowedChannels,
            operatorUids: [],
            operatorCount: 0,
            ...buildFundAccountingFields(fundType),
            createdBy: auth.uid,
            createdAt: now,
            updatedAt: now,
        });

        return { success: true, fundId: fundRef.id };
    },
);

exports.allocateTaxToClassFunds = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const description =
      cleanText(data?.description, 300) || "세금 재정을 기금으로 배정";
        const allocations = Array.isArray(data?.allocations)
            ? data.allocations
                .map((entry) => ({
                    fundId: cleanText(entry?.fundId, 120),
                    amount: toMoneyAmount(entry?.amount),
                }))
                .filter((entry) => entry.fundId && entry.amount > 0)
            : [];

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId가 필요합니다.");
        }
        if (!allocations.length) {
            throw new HttpsError("invalid-argument", "배정할 금액을 입력해 주세요.");
        }
        if (allocations.length > MAX_BULK_ALLOCATIONS) {
            throw new HttpsError(
                "invalid-argument",
                `한 번에 ${MAX_BULK_ALLOCATIONS}개 기금까지만 배정할 수 있습니다.`,
            );
        }

        await mustManageClassFunds(classId, auth.uid);
        const { logContext } = await loadClassContext(classId);

        const result = await db.runTransaction(async (tx) => {
            const summaryRef = db.doc(`classes/${classId}/dashboardSummary/taxSummary`);
            const fundsCol = db.collection(`classes/${classId}/classFunds`);
            const [summarySnap, fundsSnap] = await Promise.all([
                tx.get(summaryRef),
                tx.get(fundsCol),
            ]);

            const fundDocs = fundsSnap.docs || [];
            const fundsById = new Map(fundDocs.map((fundDoc) => [fundDoc.id, fundDoc]));
            const taxBalance = getTaxBalance(summarySnap.exists ? summarySnap.data() : {});
            const committedFundBudget = getCommittedClassFundBudgetTotal(
                fundDocs.map((fundDoc) => fundDoc.data() || {}),
            );
            const availableToAllocate = taxBalance - committedFundBudget;
            const totalAllocation = allocations.reduce(
                (sum, entry) => sum + entry.amount,
                0,
            );

            if (availableToAllocate < totalAllocation) {
                throw new HttpsError(
                    "failed-precondition",
                    `배정 가능 금액이 부족합니다. 가능: ${availableToAllocate.toLocaleString("ko-KR")}`,
                );
            }

            const batchKey = db.collection("_").doc().id;
            const now = FieldValue.serverTimestamp();

            for (const allocation of allocations) {
                const fundDoc = fundsById.get(allocation.fundId);
                if (!fundDoc) {
                    throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
                }

                const fundData = fundDoc.data() || {};
                if (fundData.status && fundData.status !== FUND_STATUS_ACTIVE) {
                    throw new HttpsError(
                        "failed-precondition",
                        "운영 중인 기금에만 배정할 수 있습니다.",
                    );
                }

                const balanceBefore = toMoneyAmount(fundData.cashBalance);
                const balanceAfter = balanceBefore + allocation.amount;
                const ledgerRef = fundDoc.ref.collection("ledger").doc();

                tx.update(fundDoc.ref, {
                    cashBalance: FieldValue.increment(allocation.amount),
                    allocatedFromTaxTotal: FieldValue.increment(allocation.amount),
                    totalValue: FieldValue.increment(allocation.amount),
                    lastAllocationAt: now,
                    updatedAt: now,
                });
                tx.set(ledgerRef, {
                    type: "allocation",
                    direction: "in",
                    amount: allocation.amount,
                    source: "tax_revenue",
                    description,
                    balanceBefore,
                    balanceAfter,
                    batchKey,
                    createdBy: auth.uid,
                    createdAt: now,
                });
            }

            stageActivityLog(
                tx,
                classId,
                {
                    studentUid: auth.uid,
                    type: "admin_action",
                    category: "class_fund_allocation",
                    amount: totalAllocation,
                    description,
                    relatedDoc: {
                        collection: "classFunds",
                        id: allocations.length === 1 ? allocations[0].fundId : batchKey,
                    },
                },
                logContext,
            );

            return {
                allocatedTotal: totalAllocation,
                taxBalance,
                allocatedFundBalanceBefore: committedFundBudget,
                committedFundBudgetBefore: committedFundBudget,
                availableBefore: availableToAllocate,
                availableAfter: availableToAllocate - totalAllocation,
            };
        });

        return { success: true, ...result };
    },
);

exports.recordClassFundUsage = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const fundId = cleanText(data?.fundId, 120);
        const amount = toMoneyAmount(data?.amount);
        const description = cleanText(data?.description, 300);
        const channel = normalizeUsageChannel(data?.channel);
        const dateKey =
            cleanText(data?.dateKey, 20).match(/^\d{4}-\d{2}-\d{2}$/) ?
                cleanText(data?.dateKey, 20) :
                formatDateKeyInKST(new Date());

        if (!classId || !fundId) {
            throw new HttpsError("invalid-argument", "classId와 fundId가 필요합니다.");
        }
        if (amount <= 0) {
            throw new HttpsError("invalid-argument", "사용 금액을 입력해 주세요.");
        }

        await mustManageClassFunds(classId, auth.uid);
        const { logContext } = await loadClassContext(classId);

        const result = await db.runTransaction(async (tx) => {
            const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
            const fundSnap = await tx.get(fundRef);

            if (!fundSnap.exists) {
                throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
            }

            const fundData = fundSnap.data() || {};
            const access = getClassFundChannelAccess(fundData, channel, { amount });
            if (!access.allowed) {
                throw new HttpsError(
                    "failed-precondition",
                    access.reason,
                );
            }

            const balanceBefore = toMoneyAmount(fundData.cashBalance);

            const now = FieldValue.serverTimestamp();
            const usageRef = db.collection(`classes/${classId}/fundUsages`).doc();
            const stagedExpense = stageImmediateClassFundExpense(tx, {
                classId,
                usageRef,
                fundId,
                fundName: fundData.name || "",
                fundType: fundData.fundType || "general",
                amount,
                channel,
                description,
                dateKey,
                balanceBefore,
                balanceAfter: balanceBefore - amount,
                createdBy: auth.uid,
                now,
                taxContext: logContext,
            });

            tx.update(fundRef, {
                cashBalance: FieldValue.increment(
                    stagedExpense.accounting.cashDelta,
                ),
                spentTotal: FieldValue.increment(
                    stagedExpense.accounting.spentTotalDelta,
                ),
                settledExpenseTotal: FieldValue.increment(
                    stagedExpense.accounting.settledExpenseTotalDelta,
                ),
                totalValue: FieldValue.increment(
                    stagedExpense.accounting.totalValueDelta,
                ),
                lastUsageAt: now,
                updatedAt: now,
            });

            stageActivityLog(
                tx,
                classId,
                {
                    studentUid: auth.uid,
                    type: "admin_action",
                    category: "class_fund_usage",
                    amount,
                    description:
                        description || `${fundData.name || "기금"} 사용 기록`,
                    relatedDoc: {
                        collection: "fundUsages",
                        id: usageRef.id,
                    },
                },
                logContext,
            );

            return {
                usageId: usageRef.id,
                taxExpenseId: stagedExpense.taxExpenseId,
                balanceBefore,
                balanceAfter: balanceBefore - amount,
            };
        });

        return { success: true, ...result };
    },
);

exports.updateClassFund = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const fundId = cleanText(data?.fundId, 120);
        const name = cleanText(data?.name, 60);
        const description = cleanText(data?.description, 500);
        const requestedStatus = cleanText(data?.status, 20);
        const status = ["active", "inactive"].includes(requestedStatus)
            ? requestedStatus
            : null;

        if (!classId || !fundId) {
            throw new HttpsError("invalid-argument", "classId와 fundId가 필요합니다.");
        }
        if (name.length < 2) {
            throw new HttpsError("invalid-argument", "기금 이름은 2자 이상이어야 합니다.");
        }

        await mustManageClassFunds(classId, auth.uid);
        await loadClassContext(classId);

        await db.runTransaction(async (tx) => {
            const fundRef = db.doc("classes/" + classId + "/classFunds/" + fundId);
            const fundSnap = await tx.get(fundRef);
            if (!fundSnap.exists) {
                throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
            }

            const fundData = fundSnap.data() || {};
            if (fundData.status === "deleted") {
                throw new HttpsError("failed-precondition", "삭제된 기금은 수정할 수 없습니다.");
            }
            const nextStatus = status || fundData.status || FUND_STATUS_ACTIVE;
            if (
                nextStatus === "inactive" &&
                toMoneyAmount(fundData.pendingSettlementExpenseTotal) > 0
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "기존 장부 대기 내역을 먼저 반영한 뒤 비활성화해 주세요.",
                );
            }

            tx.update(fundRef, {
                name,
                description,
                status: nextStatus,
                allowedChannels: normalizeAllowedChannels(
                    data?.allowedChannels,
                    fundData.fundType || "general",
                ),
                updatedBy: auth.uid,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return { success: true };
    },
);

exports.updateClassFundOperators = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const fundId = cleanText(data?.fundId, 120);
        const operatorUids = Array.from(new Set(
            (Array.isArray(data?.operatorUids) ? data.operatorUids : [])
                .map((uid) => cleanText(uid, 120))
                .filter(Boolean),
        ));
        if (!classId || !fundId) {
            throw new HttpsError("invalid-argument", "기금을 선택해 주세요.");
        }
        if (operatorUids.length > 100) {
            throw new HttpsError("invalid-argument", "담당자는 100명까지 지정할 수 있습니다.");
        }

        await mustManageClassFunds(classId, auth.uid);
        await loadClassContext(classId);

        const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
        const operatorRefs = operatorUids.map((uid) =>
            db.doc(`classes/${classId}/students/${uid}`),
        );
        const [fundSnap, ...operatorSnaps] = await db.getAll(fundRef, ...operatorRefs);
        if (!fundSnap.exists) {
            throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
        }
        if (fundSnap.data()?.status === "deleted") {
            throw new HttpsError("failed-precondition", "삭제된 기금은 변경할 수 없습니다.");
        }
        if (operatorSnaps.some((snap) => !snap.exists)) {
            throw new HttpsError("not-found", "담당자 정보를 찾을 수 없습니다.");
        }
        if (operatorSnaps.some((snap) => snap.data()?.role !== "student")) {
            throw new HttpsError("invalid-argument", "학생만 기금 담당자로 지정할 수 있습니다.");
        }

        await fundRef.update({
            operatorUids,
            operatorCount: operatorUids.length,
            updatedBy: auth.uid,
            updatedAt: FieldValue.serverTimestamp(),
        });
        return { success: true, operatorCount: operatorUids.length };
    },
);

exports.archiveClassFund = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const fundId = cleanText(data?.fundId, 120);
        const destinationFundId = cleanText(data?.destinationFundId, 120);
        if (!classId || !fundId) {
            throw new HttpsError("invalid-argument", "삭제할 기금을 선택해 주세요.");
        }
        if (destinationFundId === fundId) {
            throw new HttpsError("invalid-argument", "다른 기금으로 이전해 주세요.");
        }

        await mustManageClassFunds(classId, auth.uid);
        const { logContext } = await loadClassContext(classId);

        const result = await db.runTransaction(async (tx) => {
            const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
            const fundSnap = await tx.get(fundRef);
            if (!fundSnap.exists) {
                throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
            }

            const fund = fundSnap.data() || {};
            if (fund.status === "deleted") {
                return {
                    alreadyDeleted: true,
                    movedAmount: 0,
                    destinationType: fund.deletedDestinationType || "tax",
                };
            }

            const plan = getClassFundArchivePlan(fund);
            if (!plan.canArchive) {
                if (plan.blockers.includes("stock") || plan.blockers.includes("realEstate")) {
                    throw new HttpsError(
                        "failed-precondition",
                        "보유 중인 주식과 부동산을 모두 정리한 후 삭제해 주세요.",
                    );
                }
                throw new HttpsError(
                    "failed-precondition",
                    "기존 장부 대기 내역을 먼저 반영한 후 삭제해 주세요.",
                );
            }

            let destinationRef = null;
            let destination = null;
            if (plan.cashAmount > 0 && destinationFundId) {
                destinationRef = db.doc(
                    `classes/${classId}/classFunds/${destinationFundId}`,
                );
                const destinationSnap = await tx.get(destinationRef);
                if (!destinationSnap.exists) {
                    throw new HttpsError("not-found", "이전할 기금을 찾을 수 없습니다.");
                }
                destination = destinationSnap.data() || {};
                if (destination.status && destination.status !== FUND_STATUS_ACTIVE) {
                    throw new HttpsError(
                        "failed-precondition",
                        "운영 중인 기금으로만 잔액을 이전할 수 있습니다.",
                    );
                }
            }

            const destinationType = destinationRef ? "fund" : "tax";
            const effectiveDestinationFundId = destinationRef ? destinationFundId : "";
            const destinationName = destination?.name || "국고";
            const now = FieldValue.serverTimestamp();
            const archiveId = db.collection("_").doc().id;
            const sourceUpdate = {
                status: "deleted",
                cashBalance: 0,
                totalValue: 0,
                allocatedFromTaxTotal: plan.settledExpenseTotal,
                operatorUids: [],
                operatorCount: 0,
                deletedBy: auth.uid,
                deletedAt: now,
                deletedDestinationType: destinationType,
                deletedDestinationFundId: effectiveDestinationFundId || null,
                deletedDestinationFundName: destinationName,
                deletedCashAmount: plan.cashAmount,
                deletedCommittedBudget: plan.committedBudget,
                updatedBy: auth.uid,
                updatedAt: now,
            };
            if (fund.fundType === "pension") {
                sourceUpdate["pensionSettings.enabled"] = false;
                sourceUpdate.pensionParticipantCount = 0;
            }
            if (destinationRef) {
                sourceUpdate.transferOutTotal = FieldValue.increment(plan.cashAmount);
            } else {
                sourceUpdate.returnedToTaxTotal = FieldValue.increment(plan.cashAmount);
            }
            tx.update(fundRef, sourceUpdate);

            if (plan.cashAmount > 0) {
                const sourceLedgerRef = fundRef.collection("ledger").doc(`${archiveId}_out`);
                tx.set(sourceLedgerRef, {
                    type: "archive",
                    direction: "out",
                    amount: plan.cashAmount,
                    destinationType,
                    counterpartFundId: effectiveDestinationFundId || null,
                    counterpartFundName: destinationName,
                    description: `기금 삭제에 따른 잔액 ${destinationName} 이전`,
                    balanceBefore: plan.cashAmount,
                    balanceAfter: 0,
                    createdBy: auth.uid,
                    createdAt: now,
                });
            }

            if (destinationRef && plan.cashAmount > 0) {
                const destinationBefore = toMoneyAmount(destination.cashBalance);
                tx.update(destinationRef, {
                    cashBalance: FieldValue.increment(plan.cashAmount),
                    totalValue: FieldValue.increment(plan.cashAmount),
                    transferInTotal: FieldValue.increment(plan.cashAmount),
                    allocatedFromTaxTotal: FieldValue.increment(plan.committedBudget),
                    updatedAt: now,
                });
                tx.set(destinationRef.collection("ledger").doc(`${archiveId}_in`), {
                    type: "archive_transfer",
                    direction: "in",
                    amount: plan.cashAmount,
                    counterpartFundId: fundId,
                    counterpartFundName: fund.name || "삭제된 기금",
                    description: `${fund.name || "기금"} 삭제에 따른 잔액 이전`,
                    balanceBefore: destinationBefore,
                    balanceAfter: destinationBefore + plan.cashAmount,
                    createdBy: auth.uid,
                    createdAt: now,
                });
            }

            stageActivityLog(
                tx,
                classId,
                {
                    studentUid: auth.uid,
                    type: "admin_action",
                    category: "class_fund_archive",
                    amount: plan.cashAmount,
                    description: `${fund.name || "기금"} 삭제 · 잔액 ${destinationName} 이전`,
                    relatedDoc: { collection: "classFunds", id: fundId },
                },
                logContext,
            );

            return {
                alreadyDeleted: false,
                movedAmount: plan.cashAmount,
                destinationType,
                destinationFundId: effectiveDestinationFundId || null,
                destinationFundName: destinationName,
            };
        });

        return { success: true, ...result };
    },
);

exports.transferClassFunds = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const fromFundId = cleanText(data?.fromFundId, 120);
        const toFundId = cleanText(data?.toFundId, 120);
        const amount = toMoneyAmount(data?.amount);
        const description =
            cleanText(data?.description, 300) || "기금 간 이체";

        if (!classId || !fromFundId || !toFundId) {
            throw new HttpsError("invalid-argument", "출발·도착 기금을 선택해 주세요.");
        }
        if (fromFundId === toFundId) {
            throw new HttpsError("invalid-argument", "서로 다른 기금을 선택해 주세요.");
        }
        if (amount <= 0) {
            throw new HttpsError("invalid-argument", "이체 금액을 입력해 주세요.");
        }

        await mustManageClassFunds(classId, auth.uid);
        const { logContext } = await loadClassContext(classId);

        const result = await db.runTransaction(async (tx) => {
            const fromRef = db.doc("classes/" + classId + "/classFunds/" + fromFundId);
            const toRef = db.doc("classes/" + classId + "/classFunds/" + toFundId);
            const [fromSnap, toSnap] = await Promise.all([
                tx.get(fromRef),
                tx.get(toRef),
            ]);
            if (!fromSnap.exists || !toSnap.exists) {
                throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
            }

            const fromData = fromSnap.data() || {};
            const toData = toSnap.data() || {};
            if (
                (fromData.status && fromData.status !== FUND_STATUS_ACTIVE) ||
                (toData.status && toData.status !== FUND_STATUS_ACTIVE)
            ) {
                throw new HttpsError("failed-precondition", "운영 중인 기금끼리만 이체할 수 있습니다.");
            }

            const fromBefore = toMoneyAmount(fromData.cashBalance);
            const toBefore = toMoneyAmount(toData.cashBalance);
            if (fromBefore < amount) {
                throw new HttpsError("failed-precondition", "출발 기금 잔액이 부족합니다.");
            }

            const transferId = db.collection("_").doc().id;
            const now = FieldValue.serverTimestamp();
            tx.update(fromRef, {
                cashBalance: FieldValue.increment(-amount),
                totalValue: FieldValue.increment(-amount),
                transferOutTotal: FieldValue.increment(amount),
                updatedAt: now,
            });
            tx.update(toRef, {
                cashBalance: FieldValue.increment(amount),
                totalValue: FieldValue.increment(amount),
                transferInTotal: FieldValue.increment(amount),
                updatedAt: now,
            });
            tx.set(fromRef.collection("ledger").doc(transferId + "_out"), {
                type: "transfer",
                direction: "out",
                amount,
                counterpartFundId: toFundId,
                counterpartFundName: toData.name || "",
                description,
                balanceBefore: fromBefore,
                balanceAfter: fromBefore - amount,
                createdBy: auth.uid,
                createdAt: now,
            });
            tx.set(toRef.collection("ledger").doc(transferId + "_in"), {
                type: "transfer",
                direction: "in",
                amount,
                counterpartFundId: fromFundId,
                counterpartFundName: fromData.name || "",
                description,
                balanceBefore: toBefore,
                balanceAfter: toBefore + amount,
                createdBy: auth.uid,
                createdAt: now,
            });

            stageActivityLog(
                tx,
                classId,
                {
                    studentUid: auth.uid,
                    type: "admin_action",
                    category: "class_fund_transfer",
                    amount,
                    description,
                    relatedDoc: { collection: "classFunds", id: transferId },
                },
                logContext,
            );

            return {
                transferId,
                fromBalanceAfter: fromBefore - amount,
                toBalanceAfter: toBefore + amount,
            };
        });

        return { success: true, ...result };
    },
);

exports.payoutClassFund = onCall(
    { region: "asia-northeast3", timeoutSeconds: 120 },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const fundId = cleanText(data?.fundId, 120);
        const amountPerStudent = toMoneyAmount(data?.amountPerStudent);
        const description =
            cleanText(data?.description, 300) || "기금 지급";
        const recipientUids = Array.from(
            new Set(
                (Array.isArray(data?.recipientUids) ? data.recipientUids : [])
                    .map((uid) => cleanText(uid, 120))
                    .filter(Boolean),
            ),
        );

        if (!classId || !fundId) {
            throw new HttpsError("invalid-argument", "기금을 선택해 주세요.");
        }
        if (!recipientUids.length || recipientUids.length > 100) {
            throw new HttpsError(
                "invalid-argument",
                "지급 대상은 1명 이상 100명 이하로 선택해 주세요.",
            );
        }
        if (amountPerStudent <= 0) {
            throw new HttpsError("invalid-argument", "1인당 지급액을 입력해 주세요.");
        }

        const { classData, logContext } = await loadClassContext(classId);
        const totalAmount = amountPerStudent * recipientUids.length;
        const currencyField = classData.currencySettings?.field || "cash";
        const assetPath = "assets." + currencyField;

        const result = await db.runTransaction(async (tx) => {
            const fundRef = db.doc("classes/" + classId + "/classFunds/" + fundId);
            const callerRef = db.doc("classes/" + classId + "/students/" + auth.uid);
            const studentRefs = recipientUids.map((uid) =>
                db.doc("classes/" + classId + "/students/" + uid),
            );
            const [fundSnap, callerSnap, ...studentSnaps] = await Promise.all([
                tx.get(fundRef),
                tx.get(callerRef),
                ...studentRefs.map((ref) => tx.get(ref)),
            ]);

            if (!fundSnap.exists) {
                throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
            }
            if (studentSnaps.some((snap) => !snap.exists)) {
                throw new HttpsError("not-found", "지급 대상 학생 정보를 찾을 수 없습니다.");
            }

            const fundData = fundSnap.data() || {};
            assertCanOperateClassFund({
                userData: callerSnap.exists ? callerSnap.data() : null,
                fundData,
                uid: auth.uid,
            });
            const access = getClassFundChannelAccess(
                fundData,
                "bankPayout",
                { amount: totalAmount },
            );
            if (!access.allowed) {
                throw new HttpsError("failed-precondition", access.reason);
            }

            const balanceBefore = toMoneyAmount(fundData.cashBalance);

            const now = FieldValue.serverTimestamp();
            const usageRef = db.collection("classes/" + classId + "/fundUsages").doc();
            const payoutRef = db.collection("classes/" + classId + "/classFundPayouts").doc();
            const recipients = studentSnaps.map((studentSnap) => ({
                uid: studentSnap.id,
                name: studentSnap.data()?.name || "학생",
            }));

            const stagedExpense = stageImmediateClassFundExpense(tx, {
                classId,
                usageRef,
                fundId,
                fundName: fundData.name || "",
                fundType: fundData.fundType || "general",
                amount: totalAmount,
                channel: "bankPayout",
                description,
                dateKey: formatDateKeyInKST(new Date()),
                balanceBefore,
                balanceAfter: balanceBefore - totalAmount,
                createdBy: auth.uid,
                now,
                taxContext: logContext,
                usageData: {
                    amountPerStudent,
                    recipientCount: recipients.length,
                    recipientUids,
                    relatedPayoutId: payoutRef.id,
                    source: "class_fund_payout",
                },
            });

            tx.update(fundRef, {
                cashBalance: FieldValue.increment(
                    stagedExpense.accounting.cashDelta,
                ),
                spentTotal: FieldValue.increment(
                    stagedExpense.accounting.spentTotalDelta,
                ),
                settledExpenseTotal: FieldValue.increment(
                    stagedExpense.accounting.settledExpenseTotalDelta,
                ),
                totalValue: FieldValue.increment(
                    stagedExpense.accounting.totalValueDelta,
                ),
                lastUsageAt: now,
                updatedAt: now,
            });
            tx.set(payoutRef, {
                fundId,
                fundName: fundData.name || "",
                amountPerStudent,
                totalAmount,
                recipientCount: recipients.length,
                recipients,
                description,
                usageId: usageRef.id,
                createdBy: auth.uid,
                createdAt: now,
            });

            studentRefs.forEach((studentRef, index) => {
                const recipient = recipients[index];
                tx.update(studentRef, {
                    [assetPath]: FieldValue.increment(amountPerStudent),
                });
                stageActivityLog(
                    tx,
                    classId,
                    {
                        studentUid: recipient.uid,
                        type: "income",
                        category: "fund_payout",
                        amount: amountPerStudent,
                        description,
                        counterpartUid: auth.uid,
                        counterpartName: fundData.name || "기금",
                        relatedDoc: {
                            collection: "classFundPayouts",
                            id: payoutRef.id,
                        },
                    },
                    logContext,
                );
            });

            tx.set(fundRef.collection("ledger").doc(), {
                type: "bank_payout",
                direction: "out",
                amount: totalAmount,
                amountPerStudent,
                recipientCount: recipients.length,
                description,
                relatedPayoutId: payoutRef.id,
                balanceBefore,
                balanceAfter: balanceBefore - totalAmount,
                createdBy: auth.uid,
                createdAt: now,
            });

            return {
                payoutId: payoutRef.id,
                usageId: usageRef.id,
                taxExpenseId: stagedExpense.taxExpenseId,
                recipientCount: recipients.length,
                totalAmount,
                balanceAfter: balanceBefore - totalAmount,
            };
        });

        return { success: true, ...result };
    },
);

exports.updateClassFundPensionSettings = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const fundId = cleanText(data?.fundId, 120);
        if (!classId || !fundId) {
            throw new HttpsError("invalid-argument", "연금 기금을 선택해 주세요.");
        }

        const settings = normalizePensionSettings(data?.settings);
        if (settings.enabled && settings.defaultContributionRate <= 0) {
            throw new HttpsError(
                "invalid-argument",
                "연금 기본 납입률은 0보다 커야 합니다.",
            );
        }

        await mustManageClassFunds(classId, auth.uid);
        await loadClassContext(classId);

        const updateResult = await db.runTransaction(async (tx) => {
            const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
            const pensionFundsQuery = db.collection(`classes/${classId}/classFunds`)
                .where("fundType", "==", "pension");
            const [fundSnap, pensionFundsSnap] = await Promise.all([
                tx.get(fundRef),
                tx.get(pensionFundsQuery),
            ]);

            if (!fundSnap.exists) {
                throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
            }
            const fund = fundSnap.data() || {};
            if (fund.status === "deleted") {
                throw new HttpsError(
                    "failed-precondition",
                    "삭제된 기금은 연금 설정을 변경할 수 없습니다.",
                );
            }
            if (fund.fundType === "investment") {
                throw new HttpsError(
                    "failed-precondition",
                    "이 기금은 급여 연동 연금으로 전환할 수 없습니다.",
                );
            }
            const isConvertingToPension =
                fund.fundType !== "pension" && settings.enabled;
            if (
                isConvertingToPension &&
                [
                    fund.spentTotal,
                    fund.pendingSettlementExpenseTotal,
                    fund.investmentValue,
                    fund.realEstateValue,
                    fund.investedTotal,
                ].some((value) => Number(value || 0) !== 0)
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "사용·투자 기록이 없는 기금만 연금으로 전환할 수 있습니다.",
                );
            }
            if (fund.fundType !== "pension" && !settings.enabled) {
                return { converted: false };
            }
            if (
                settings.enabled &&
                pensionFundsSnap.docs.some(
                    (docSnap) =>
                        docSnap.id !== fundId &&
                        docSnap.data()?.status !== "deleted" &&
                        docSnap.data()?.pensionSettings?.enabled === true,
                )
            ) {
                throw new HttpsError(
                    "failed-precondition",
                    "급여 연동 연금은 한 번에 하나의 기금만 운영할 수 있습니다.",
                );
            }

            tx.update(fundRef, {
                fundType: "pension",
                accountingMode: "pension",
                settlementBehavior: "asset_operation",
                usageSettlementMode: "none",
                investmentValue: Number(fund.investmentValue || 0),
                realEstateValue: Number(fund.realEstateValue || 0),
                totalValue: Number(
                    fund.totalValue ??
                    Number(fund.cashBalance || 0) +
                    Number(fund.investmentValue || 0) +
                    Number(fund.realEstateValue || 0),
                ),
                pensionContributionTotal: Number(
                    fund.pensionContributionTotal || 0,
                ),
                pensionParticipantCount:
                    settings.enabled ?
                        Math.max(
                            0,
                            Number(data?.participantCount || 0),
                        ) :
                        0,
                pensionSettings: {
                    ...settings,
                    updatedBy: auth.uid,
                    updatedAt: FieldValue.serverTimestamp(),
                },
                allowedChannels: normalizeAllowedChannels(
                    fund.allowedChannels,
                    "pension",
                ),
                updatedBy: auth.uid,
                updatedAt: FieldValue.serverTimestamp(),
            });
            return { converted: isConvertingToPension };
        });

        return { success: true, settings, ...updateResult };
    },
);

exports.cancelClassFundUsage = onCall(
    { region: "asia-northeast3", timeoutSeconds: 120 },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const usageId = cleanText(data?.usageId, 120);
        const reason = cleanText(data?.reason, 300) || "관리자 거래 취소";
        if (!classId || !usageId) {
            throw new HttpsError("invalid-argument", "취소할 기금 내역을 선택해 주세요.");
        }

        await mustManageClassFunds(classId, auth.uid);
        const { classData, logContext } = await loadClassContext(classId);

        const usagePreviewRef = db.doc(
            `classes/${classId}/fundUsages/${usageId}`,
        );
        const usagePreviewSnap = await usagePreviewRef.get();
        if (!usagePreviewSnap.exists) {
            throw new HttpsError("not-found", "기금 사용내역을 찾을 수 없습니다.");
        }
        const usagePreview = usagePreviewSnap.data() || {};
        if (
            usagePreview.source === "store_pos" ||
            (Array.isArray(usagePreview.storeRedemptionIds) &&
                usagePreview.storeRedemptionIds.length > 0)
        ) {
            const { __cancelClassFundPosUsage } = require("./store");
            const posResult = await __cancelClassFundPosUsage({
                classId,
                usageId,
                reason,
                actorUid: auth.uid,
                logContext,
            });
            return { success: true, ...posResult };
        }
        if (usagePreview.relatedRealEstateLedgerId) {
            const { __cancelClassFundRealEstateUsage } = require("./realestate");
            const realEstateResult = await __cancelClassFundRealEstateUsage({
                classId,
                usageId,
                reason,
                actorUid: auth.uid,
                logContext,
            });
            return { success: true, ...realEstateResult };
        }
        if (usagePreview.relatedTradeId && usagePreview.channel === "stockInvestment") {
            const { __cancelClassFundStockUsage } = require("./stock");
            const stockResult = await __cancelClassFundStockUsage({
                classId,
                usageId,
                reason,
                actorUid: auth.uid,
                logContext,
            });
            return { success: true, ...stockResult };
        }

        const result = await db.runTransaction(async (tx) => {
            const usageRef = db.doc(`classes/${classId}/fundUsages/${usageId}`);
            const usageSnap = await tx.get(usageRef);
            if (!usageSnap.exists) {
                throw new HttpsError("not-found", "기금 사용내역을 찾을 수 없습니다.");
            }

            const usage = usageSnap.data() || {};
            const policy = getClassFundUsageCancellationPolicy(usage);
            if (!policy.allowed) {
                throw new HttpsError("failed-precondition", policy.reason);
            }

            const fundId = cleanText(usage.fundId, 120);
            const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
            const reversalRef = db.collection(`classes/${classId}/fundUsages`).doc();
            const ledgerRef = fundRef.collection("ledger").doc();
            const refsToRead = [fundRef];
            let payoutRef = null;
            if (policy.kind === "bank_payout") {
                payoutRef = db.doc(
                    `classes/${classId}/classFundPayouts/${usage.relatedPayoutId}`,
                );
                refsToRead.push(payoutRef);
            }
            const initialSnaps = await Promise.all(refsToRead.map((ref) => tx.get(ref)));
            const fundSnap = initialSnaps[0];
            const payoutSnap = payoutRef ? initialSnaps[1] : null;
            if (!fundSnap.exists) {
                throw new HttpsError("not-found", "기금 정보를 찾을 수 없습니다.");
            }

            const amount = toMoneyAmount(usage.amount);
            const fund = fundSnap.data() || {};
            const balanceBefore = toMoneyAmount(fund.cashBalance);
            const accounting = buildClassFundUsageCancellationAccounting(usage);
            const now = FieldValue.serverTimestamp();
            const studentRows = [];

            if (policy.kind === "bank_payout") {
                if (!payoutSnap?.exists) {
                    throw new HttpsError("not-found", "연결된 기금 송금 기록을 찾을 수 없습니다.");
                }
                const payout = payoutSnap.data() || {};
                if (payout.cancellationStatus === CANCELLATION_STATUS_CANCELLED) {
                    throw new HttpsError("already-exists", "이미 취소된 기금 송금입니다.");
                }
                const recipientUids = Array.isArray(usage.recipientUids) ?
                    usage.recipientUids.map((uid) => cleanText(uid, 120)).filter(Boolean) :
                    [];
                const amountPerStudent = toMoneyAmount(usage.amountPerStudent);
                const currencyField = classData.currencySettings?.field || "cash";
                const studentRefs = recipientUids.map((uid) =>
                    db.doc(`classes/${classId}/students/${uid}`),
                );
                const studentSnaps = await Promise.all(
                    studentRefs.map((studentRef) => tx.get(studentRef)),
                );
                if (!studentRefs.length || studentSnaps.some((snap) => !snap.exists)) {
                    throw new HttpsError("failed-precondition", "송금 대상 학생 정보를 확인할 수 없습니다.");
                }
                studentSnaps.forEach((studentSnap, index) => {
                    const currentBalance = Number(
                        studentSnap.data()?.assets?.[currencyField] || 0,
                    );
                    if (currentBalance < amountPerStudent) {
                        throw new HttpsError(
                            "failed-precondition",
                            `${studentSnap.data()?.name || "학생"}의 잔액이 부족해 송금을 취소할 수 없습니다.`,
                        );
                    }
                    studentRows.push({
                        ref: studentRefs[index],
                        uid: studentSnap.id,
                        name: studentSnap.data()?.name || "학생",
                        assetPath: `assets.${currencyField}`,
                        amount: amountPerStudent,
                    });
                });
            }

            const fundUpdate = {
                cashBalance: FieldValue.increment(accounting.cashDelta),
                spentTotal: FieldValue.increment(accounting.spentTotalDelta),
                totalValue: FieldValue.increment(accounting.totalValueDelta),
                lastCancellationAt: now,
                updatedAt: now,
            };
            if (accounting.settledExpenseTotalDelta) {
                fundUpdate.settledExpenseTotal = FieldValue.increment(
                    accounting.settledExpenseTotalDelta,
                );
            }
            if (accounting.pendingSettlementExpenseTotalDelta) {
                fundUpdate.pendingSettlementExpenseTotal = FieldValue.increment(
                    accounting.pendingSettlementExpenseTotalDelta,
                );
            }
            tx.update(fundRef, fundUpdate);

            tx.update(usageRef, {
                cancellationStatus: CANCELLATION_STATUS_CANCELLED,
                cancellationReason: reason,
                cancelledBy: auth.uid,
                cancelledAt: now,
                reversalUsageId: reversalRef.id,
                reversalLedgerId: ledgerRef.id,
                updatedAt: now,
            });
            tx.set(reversalRef, {
                fundId,
                fundName: usage.fundName || fund.name || "",
                fundType: usage.fundType || fund.fundType || "general",
                amount,
                channel: usage.channel || "manualExpense",
                direction: "in",
                usageKind: "cancellation_reversal",
                description: `[취소 복구] ${usage.description || "기금 사용"}`,
                dateKey: formatDateKeyInKST(new Date()),
                balanceBefore,
                balanceAfter: balanceBefore + amount,
                settlementStatus: "not_applicable",
                cancellationStatus: CANCELLATION_STATUS_REVERSAL,
                reversalOfUsageId: usageId,
                reason,
                createdBy: auth.uid,
                usedAt: now,
                createdAt: now,
                updatedAt: now,
            });
            tx.set(ledgerRef, {
                type: "usage_cancellation",
                direction: "in",
                amount,
                description: `[취소 복구] ${usage.description || "기금 사용"}`,
                originalUsageId: usageId,
                reversalUsageId: reversalRef.id,
                reason,
                balanceBefore,
                balanceAfter: balanceBefore + amount,
                createdBy: auth.uid,
                createdAt: now,
            });

            if (usage.taxExpenseId) {
                tx.set(db.doc(`classes/${classId}/taxExpenses/${usage.taxExpenseId}`), {
                    status: "cancelled",
                    isCancelled: true,
                    cancelledAt: now,
                    cancelledBy: auth.uid,
                    cancelledReason: "class_fund_usage_cancelled",
                }, { merge: true });
            }

            if (payoutRef) {
                tx.set(payoutRef, {
                    cancellationStatus: CANCELLATION_STATUS_CANCELLED,
                    cancellationReason: reason,
                    cancelledBy: auth.uid,
                    cancelledAt: now,
                    reversalUsageId: reversalRef.id,
                }, { merge: true });
            }
            studentRows.forEach((row) => {
                tx.update(row.ref, {
                    [row.assetPath]: FieldValue.increment(-row.amount),
                });
                stageActivityLog(tx, classId, {
                    studentUid: row.uid,
                    type: "expense",
                    category: "fund_payout_cancel",
                    amount: row.amount,
                    description: `기금 송금 취소: ${reason}`,
                    counterpartUid: auth.uid,
                    counterpartName: usage.fundName || fund.name || "기금",
                    relatedDoc: { collection: "fundUsages", id: usageId },
                }, logContext);
            });

            stageActivityLog(tx, classId, {
                studentUid: auth.uid,
                type: "admin_action",
                category: "class_fund_usage_cancel",
                amount,
                description: `기금 거래 취소: ${usage.description || reason}`,
                relatedDoc: { collection: "fundUsages", id: usageId },
            }, logContext);

            return {
                usageId,
                reversalUsageId: reversalRef.id,
                refundedAmount: amount,
                balanceAfter: balanceBefore + amount,
            };
        });

        return { success: true, ...result };
    },
);
exports.settleClassFundDailyExpenses = onCall(
    { region: "asia-northeast3", timeoutSeconds: 120 },
    async (request) => {
        const { auth, data } = request;
        if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

        const classId = cleanText(data?.classId, 120);
        const fundId = cleanText(data?.fundId, 120);

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId가 필요합니다.");
        }

        await mustManageClassFunds(classId, auth.uid);
        const { logContext, globalConfig, planType } = await loadClassContext(classId);

        const settlementRunId = db.collection("_").doc().id;
        const result = await db.runTransaction(async (tx) => {
            let usagesQuery = db
                .collection(`classes/${classId}/fundUsages`)
                .where("settlementStatus", "==", USAGE_STATUS_PENDING);

            if (fundId) {
                usagesQuery = usagesQuery.where("fundId", "==", fundId);
            }

            usagesQuery = usagesQuery.limit(MAX_SETTLEMENT_USAGES);

            const usageSnap = await tx.get(usagesQuery);
            if (usageSnap.empty) {
                return {
                    settledTotal: 0,
                    usageCount: 0,
                    settlementCount: 0,
                    hasMore: false,
                };
            }

            const fundRefs = new Map();
            for (const usageDoc of usageSnap.docs) {
                const usage = usageDoc.data() || {};
                if (usage.fundId) {
                    fundRefs.set(
                        usage.fundId,
                        db.doc(`classes/${classId}/classFunds/${usage.fundId}`),
                    );
                }
            }

            const fundSnaps = new Map();
            for (const [entryFundId, fundRef] of fundRefs.entries()) {
                fundSnaps.set(entryFundId, await tx.get(fundRef));
            }

            const groups = new Map();
            for (const usageDoc of usageSnap.docs) {
                const usage = usageDoc.data() || {};
                const entryFundId = cleanText(usage.fundId, 120);
                const dateKey =
                    cleanText(usage.dateKey, 20).match(/^\d{4}-\d{2}-\d{2}$/) ?
                        cleanText(usage.dateKey, 20) :
                        formatDateKeyInKST(usage.usedAt || usage.createdAt || new Date());

                if (!entryFundId) continue;

                const groupKey = `${entryFundId}::${dateKey}`;
                const current = groups.get(groupKey) || {
                    fundId: entryFundId,
                    dateKey,
                    amount: 0,
                    usageDocs: [],
                    detailLines: [],
                    fundName: usage.fundName || "",
                    fundType: usage.fundType || "general",
                };
                const amount = toMoneyAmount(usage.amount);
                if (amount <= 0) continue;

                current.amount += amount;
                current.usageDocs.push(usageDoc);
                current.detailLines.push({
                    id: usageDoc.id,
                    amount,
                    description: usage.description || "",
                    source: "class_fund_usage",
                    expenseType: usage.fundType || "class_fund",
                    category: usage.channel || "manualExpense",
                    relatedDoc: {
                        collection: "fundUsages",
                        id: usageDoc.id,
                    },
                    meta: {
                        fundId: entryFundId,
                        fundName: usage.fundName || "",
                        dateKey,
                        channel: usage.channel || "manualExpense",
                    },
                });
                groups.set(groupKey, current);
            }

            const settlementSnaps = new Map();
            for (const group of groups.values()) {
                const settlementId = buildClassFundSettlementId(
                    group.fundId,
                    group.dateKey,
                    settlementRunId,
                );
                const settlementRef = db.doc(
                    `classes/${classId}/fundDailySettlements/${settlementId}`,
                );
                settlementSnaps.set(settlementId, {
                    ref: settlementRef,
                    snap: await tx.get(settlementRef),
                });
            }

            const now = FieldValue.serverTimestamp();
            let settledTotal = 0;
            let usageCount = 0;
            let settlementCount = 0;

            for (const group of groups.values()) {
                const fundSnap = fundSnaps.get(group.fundId);
                const fundData = fundSnap?.exists ? fundSnap.data() || {} : {};
                if (fundSnap?.exists && !isExpenseSettlementFund(fundData)) {
                    throw new HttpsError(
                        "failed-precondition",
                        "투자 기금 사용분은 지출 정산할 수 없습니다.",
                    );
                }

                const settlementId = buildClassFundSettlementId(
                    group.fundId,
                    group.dateKey,
                    settlementRunId,
                );
                const { ref: settlementRef, snap: settlementSnap } =
                    settlementSnaps.get(settlementId);
                if (settlementSnap.exists) {
                    const existing = settlementSnap.data() || {};
                    if (existing.status === USAGE_STATUS_SETTLED) {
                        continue;
                    }
                }

                const fundName = fundData.name || group.fundName || "기금";
                const fundType = fundData.fundType || group.fundType || "class_fund";
                const taxExpenseId = `classFund_${settlementId}`;
                const taxResult = stageTaxExpense(
                    tx,
                    classId,
                    {
                        amount: group.amount,
                        description: `${fundName} 일일 사용 정산 (${group.dateKey})`,
                        source: "class_fund_daily_settlement",
                        expenseType: "class_fund",
                        category: fundType,
                        studentUid: auth.uid,
                    },
                    auth.uid,
                    {
                        config: globalConfig,
                        planType,
                        serviceName: "tax",
                        customId: taxExpenseId,
                        aggregateMeta: {
                            group: "class_fund_daily_settlement",
                            batchKey: settlementId,
                            pageKey: "budgetFunds",
                            actorUid: auth.uid,
                            reason: "class_fund_usage_settlement",
                            mode: "daily",
                            version: 1,
                        },
                        detailLines: group.detailLines,
                    },
                );

                if (taxResult.skipped) {
                    throw new HttpsError(
                        "failed-precondition",
                        "세금 기능이 활성화된 반에서만 정산할 수 있습니다.",
                    );
                }

                tx.set(
                    settlementRef,
                    {
                        fundId: group.fundId,
                        fundName,
                        fundType,
                        dateKey: group.dateKey,
                        totalAmount: group.amount,
                        usageCount: group.usageDocs.length,
                        taxExpenseId,
                        status: USAGE_STATUS_SETTLED,
                        settledBy: auth.uid,
                        settledAt: now,
                        updatedAt: now,
                        createdAt: settlementSnap.exists ?
                            settlementSnap.data()?.createdAt || now :
                            now,
                    },
                    { merge: true },
                );

                for (const usageDoc of group.usageDocs) {
                    tx.update(usageDoc.ref, {
                        settlementStatus: USAGE_STATUS_SETTLED,
                        settlementId,
                        taxExpenseId,
                        settledAt: now,
                        updatedAt: now,
                    });
                }

                if (fundSnap?.exists) {
                    tx.update(fundSnap.ref, {
                        pendingSettlementExpenseTotal: FieldValue.increment(-group.amount),
                        settledExpenseTotal: FieldValue.increment(group.amount),
                        lastSettledAt: now,
                        updatedAt: now,
                    });
                }

                stageActivityLog(
                    tx,
                    classId,
                    {
                        studentUid: auth.uid,
                        type: "admin_action",
                        category: "class_fund_daily_settlement",
                        amount: group.amount,
                        description: `${fundName} ${group.dateKey} 사용 정산`,
                        relatedDoc: {
                            collection: "fundDailySettlements",
                            id: settlementId,
                        },
                    },
                    logContext,
                );

                settledTotal += group.amount;
                usageCount += group.usageDocs.length;
                settlementCount += 1;
            }

            return {
                settledTotal,
                usageCount,
                settlementCount,
                hasMore: usageSnap.size >= MAX_SETTLEMENT_USAGES,
            };
        });

        return { success: true, ...result };
    },
);
