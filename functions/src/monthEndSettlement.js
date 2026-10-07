"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { stageActivityLog } = require("../utils/logUtils");
const { stageTaxExpense } = require("../utils/taxExpense");
const { getGlobalConfig, canUseFeature, canUsePagePolicy } = require("../utils/planManager");
const { mustBeTeacherOrTaxAdmin } = require("../utils/permissions");
const {
    getMonthEndSettlementPolicy,
} = require("../utils/taxPolicy");
const {
    finalizeOutstandingDailySettlements,
} = require("./taxPeriodSettlement").__private;

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const SOURCE_LABELS = {
    payrollSalary: "급여",
    payrollBonus: "성과급",
    incentivePayment: "인센티브",
    jobBoardReward: "잡보드 보상",
    missionReward: "미션 보상",
    policeReward: "경찰 보상",
    arcadePrize: "상금",
    depositInterest: "예금 이자",
    stockDividend: "주식 배당",
    realEstateRent: "부동산 임대료",
    assetAdjustment: "자산 조정",
};

const toMoney = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.round(parsed));
};

const toRate = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
};

const dateFromAny = (value) => {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value.seconds === "number") {
        return new Date(value.seconds * 1000);
    }
    return null;
};

const timestampFromAny = (value) => {
    const date = dateFromAny(value);
    return date ? Timestamp.fromDate(date) : null;
};

const isoFromTimestamp = (value) => {
    const date = dateFromAny(value);
    return date ? date.toISOString() : null;
};

const serializeTimestamp = (value) => {
    const date = dateFromAny(value);
    return date ? date.toISOString() : null;
};

const sortByAmountDesc = (left, right) =>
    toMoney(right?.amount ?? right?.taxAmount ?? right?.grossAmount) -
    toMoney(left?.amount ?? left?.taxAmount ?? left?.grossAmount);

const buildStatementSourceBreakdown = (sourceBreakdown = {}) =>
    Object.values(sourceBreakdown || {})
        .map((source) => ({
            sourceKey: source.sourceKey || "unknown",
            label: source.label || SOURCE_LABELS[source.sourceKey] || source.sourceKey || "소득",
            grossAmount: toMoney(source.grossAmount),
            withheldAmount: toMoney(source.withheldAmount),
            taxableAmountAtWithholding: toMoney(source.taxableAmountAtWithholding),
            count: Math.max(0, Number(source.count || 0)),
        }))
        .sort((left, right) => toMoney(right.grossAmount) - toMoney(left.grossAmount));

const buildStudentStatementPayload = ({
    classId,
    draftId,
    draft,
    row,
    issuedBy,
    currencyUnit,
    taxBillId = null,
}) => {
    const additionalTax = toMoney(row.additionalTax);
    const refundAmount = toMoney(row.refundAmount);
    const resultType = additionalTax > 0
        ? "additional_tax"
        : refundAmount > 0
            ? "refund"
            : "settled";

    return {
        classId,
        studentUid: row.studentUid,
        studentName: row.studentName || "학생",
        statementKind: "month_end_settlement",
        settlementDraftId: draftId,
        status: "finalized",
        resultType,
        issuedBy,
        issuedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        finalizedAt: FieldValue.serverTimestamp(),
        periodStartAt: serializeTimestamp(draft.periodStartAt),
        periodEndAt: serializeTimestamp(draft.periodEndAt),
        currencyUnit,
        summary: {
            grossIncome: toMoney(row.grossIncome),
            nonTaxableIncome: toMoney(row.nonTaxableIncome),
            taxableIncome: toMoney(row.taxableIncome),
            incomeDeduction: toMoney(row.incomeDeduction),
            taxBase: toMoney(row.taxBase),
            calculatedTax: toMoney(row.calculatedTax),
            taxCredit: toMoney(row.taxCredit),
            finalTax: toMoney(row.finalTax),
            prepaidTax: toMoney(row.prepaidTax),
            settlementAmount: Number.isFinite(Number(row.settlementAmount))
                ? Math.round(Number(row.settlementAmount))
                : 0,
            additionalTax,
            refundAmount,
        },
        sourceBreakdown: buildStatementSourceBreakdown(row.sourceBreakdown),
        exemptions: (row.exemptions || []).map((item) => ({
            id: item.id || "exemption",
            label: item.label || "비과세",
            amount: toMoney(item.amount),
            maxAmount: toMoney(item.maxAmount),
            sourceKeys: Array.isArray(item.sourceKeys) ? item.sourceKeys : [],
        })).sort(sortByAmountDesc),
        incomeDeductions: (row.incomeDeductions || []).map((item) => ({
            id: item.id || "deduction",
            label: item.label || "소득공제",
            amount: toMoney(item.amount),
            basisAmount: toMoney(item.basisAmount),
            rate: item.rate === undefined ? null : toRate(item.rate),
            maxAmount: item.maxAmount === undefined ? null : toMoney(item.maxAmount),
            requestedAmount: item.requestedAmount === undefined ? null : toMoney(item.requestedAmount),
            note: item.note || "",
        })).sort(sortByAmountDesc),
        taxBracketBreakdown: (row.taxBracketBreakdown || []).map((item) => ({
            upToAmount: item.upToAmount === null || item.upToAmount === undefined
                ? null
                : toMoney(item.upToAmount),
            rate: toRate(item.rate),
            taxableAmount: toMoney(item.taxableAmount),
            taxAmount: toMoney(item.taxAmount),
        })),
        taxCredits: (row.taxCredits || []).map((item) => ({
            id: item.id || "credit",
            label: item.label || "세액공제",
            amount: toMoney(item.amount),
            basisAmount: toMoney(item.basisAmount),
            rate: item.rate === undefined ? null : toRate(item.rate),
            maxAmount: item.maxAmount === undefined ? null : toMoney(item.maxAmount),
            requestedAmount: item.requestedAmount === undefined ? null : toMoney(item.requestedAmount),
            note: item.note || "",
        })).sort(sortByAmountDesc),
        metrics: {
            storePurchaseAmount: toMoney(row.metrics?.storePurchaseAmount),
            donationAmount: toMoney(row.metrics?.donationAmount),
        },
        manualAdjustments: {
            incomeDeductionAmount: toMoney(row.manualAdjustments?.incomeDeductionAmount),
            appliedIncomeDeduction: toMoney(row.manualAdjustments?.appliedIncomeDeduction),
            taxCreditAmount: toMoney(row.manualAdjustments?.taxCreditAmount),
            appliedTaxCredit: toMoney(row.manualAdjustments?.appliedTaxCredit),
            note: row.manualAdjustments?.note || "",
        },
        taxBillId,
        taxBillPath: taxBillId
            ? `classes/${classId}/students/${row.studentUid}/taxBills/${taxBillId}`
            : null,
    };
};

const sumSources = (sourceTotals = {}, sourceKeys = []) =>
    sourceKeys.reduce((sum, key) => sum + toMoney(sourceTotals[key]), 0);

const buildEmptyStudentRow = (student, currencyUnit) => ({
    studentUid: student.uid,
    studentName: student.name || student.displayName || student.email || "학생",
    grossIncome: 0,
    nonTaxableIncome: 0,
    taxableIncome: 0,
    incomeDeduction: 0,
    taxBase: 0,
    calculatedTax: 0,
    taxCredit: 0,
    finalTax: 0,
    prepaidTax: 0,
    settlementAmount: 0,
    additionalTax: 0,
    refundAmount: 0,
    sourceBreakdown: {},
    exemptions: [],
    incomeDeductions: [],
    taxCredits: [],
    metrics: {
        storePurchaseAmount: 0,
        donationAmount: 0,
    },
    currencyUnit,
});

const applyExemptionGroups = (grossBySource, policy) => {
    const taxableBySource = { ...grossBySource };
    const rows = [];

    (policy.exemptionGroups || []).forEach((group) => {
        if (group?.enabled === false) return;
        const sourceKeys = Array.isArray(group?.sourceKeys) ? group.sourceKeys : [];
        if (sourceKeys.length === 0) return;

        const groupGross = sumSources(taxableBySource, sourceKeys);
        const maxAmount = toMoney(group?.amount);
        let remaining = Math.min(groupGross, maxAmount);
        let appliedAmount = 0;

        sourceKeys.forEach((sourceKey) => {
            if (remaining <= 0) return;
            const current = toMoney(taxableBySource[sourceKey]);
            const applied = Math.min(current, remaining);
            taxableBySource[sourceKey] = Math.max(0, current - applied);
            remaining -= applied;
            appliedAmount += applied;
        });

        if (appliedAmount > 0) {
            rows.push({
                id: group.id || "exemption",
                label: group.label || "비과세",
                amount: appliedAmount,
                maxAmount,
                sourceKeys,
            });
        }
    });

    return { taxableBySource, rows, total: rows.reduce((sum, row) => sum + row.amount, 0) };
};

const buildDeductionRows = ({ taxableIncome, taxableBySource, metrics, policy }) => {
    const deductions = policy.incomeDeductions || {};
    const rows = [];

    if (deductions.basic?.enabled !== false) {
        const amount = toMoney(deductions.basic?.amount);
        if (amount > 0) {
            rows.push({
                id: "basic",
                label: deductions.basic?.label || "기본공제",
                amount,
                basisAmount: amount,
            });
        }
    }

    if (deductions.labor?.enabled !== false) {
        const basisAmount = sumSources(taxableBySource, deductions.labor?.sourceKeys || []);
        const rawAmount = Math.round(basisAmount * (toRate(deductions.labor?.rate) / 100));
        const maxAmount = toMoney(deductions.labor?.maxAmount);
        const amount = maxAmount > 0 ? Math.min(rawAmount, maxAmount) : rawAmount;
        if (amount > 0) {
            rows.push({
                id: "labor",
                label: deductions.labor?.label || "근로소득공제",
                amount,
                basisAmount,
                rate: toRate(deductions.labor?.rate),
                maxAmount,
            });
        }
    }

    if (deductions.storeSpending?.enabled !== false) {
        const basisAmount = toMoney(metrics.storePurchaseAmount);
        const minSpendingAmount = toMoney(deductions.storeSpending?.minSpendingAmount);
        if (basisAmount >= minSpendingAmount) {
            const rawAmount = Math.round(basisAmount * (toRate(deductions.storeSpending?.rate) / 100));
            const maxAmount = toMoney(deductions.storeSpending?.maxAmount);
            const amount = maxAmount > 0 ? Math.min(rawAmount, maxAmount) : rawAmount;
            if (amount > 0) {
                rows.push({
                    id: "storeSpending",
                    label: deductions.storeSpending?.label || "상점 소비공제",
                    amount,
                    basisAmount,
                    rate: toRate(deductions.storeSpending?.rate),
                    maxAmount,
                    minSpendingAmount,
                });
            }
        }
    }

    if (deductions.activity?.enabled === true) {
        const basisAmount = sumSources(taxableBySource, deductions.activity?.sourceKeys || []);
        const rawAmount = Math.round(basisAmount * (toRate(deductions.activity?.rate) / 100));
        const maxAmount = toMoney(deductions.activity?.maxAmount);
        const amount = maxAmount > 0 ? Math.min(rawAmount, maxAmount) : rawAmount;
        if (amount > 0) {
            rows.push({
                id: "activity",
                label: deductions.activity?.label || "활동 소득공제",
                amount,
                basisAmount,
                rate: toRate(deductions.activity?.rate),
                maxAmount,
            });
        }
    }

    let runningTotal = 0;
    const cappedRows = rows.map((row) => {
        const remaining = Math.max(0, taxableIncome - runningTotal);
        const amount = Math.min(row.amount, remaining);
        runningTotal += amount;
        return { ...row, amount };
    }).filter((row) => row.amount > 0);

    return {
        rows: cappedRows,
        total: cappedRows.reduce((sum, row) => sum + row.amount, 0),
    };
};

const calculateProgressiveTax = (taxBase, brackets = []) => {
    const sortedBrackets = [...brackets].sort((a, b) => {
        if (a.upToAmount === null) return 1;
        if (b.upToAmount === null) return -1;
        return Number(a.upToAmount) - Number(b.upToAmount);
    });
    let remainingBase = toMoney(taxBase);
    let previousLimit = 0;
    let totalTax = 0;
    const bracketRows = [];

    sortedBrackets.forEach((bracket) => {
        if (remainingBase <= 0) return;
        const rate = toRate(bracket.rate);
        const upperLimit = bracket.upToAmount === null ? null : toMoney(bracket.upToAmount);
        const sliceAmount = upperLimit === null
            ? remainingBase
            : Math.max(0, Math.min(remainingBase, upperLimit - previousLimit));
        if (sliceAmount > 0) {
            const taxAmount = Math.round(sliceAmount * (rate / 100));
            totalTax += taxAmount;
            remainingBase -= sliceAmount;
            bracketRows.push({
                upToAmount: upperLimit,
                rate,
                taxableAmount: sliceAmount,
                taxAmount,
            });
        }
        if (upperLimit !== null) previousLimit = upperLimit;
    });

    return { taxAmount: Math.max(0, Math.round(totalTax)), bracketRows };
};

const buildTaxCreditRows = ({ calculatedTax, metrics, policy }) => {
    const credits = policy.taxCredits || {};
    const rows = [];

    if (credits.donation?.enabled !== false) {
        const basisAmount = toMoney(metrics.donationAmount);
        const rawAmount = Math.round(basisAmount * (toRate(credits.donation?.rate) / 100));
        const maxAmount = toMoney(credits.donation?.maxAmount);
        const amount = maxAmount > 0 ? Math.min(rawAmount, maxAmount) : rawAmount;
        if (amount > 0) {
            rows.push({
                id: "donation",
                label: credits.donation?.label || "기부금 세액공제",
                amount,
                basisAmount,
                rate: toRate(credits.donation?.rate),
                maxAmount,
            });
        }
    }

    let runningTotal = 0;
    const cappedRows = rows.map((row) => {
        const remaining = Math.max(0, calculatedTax - runningTotal);
        const amount = Math.min(row.amount, remaining);
        runningTotal += amount;
        return { ...row, amount };
    }).filter((row) => row.amount > 0);

    return {
        rows: cappedRows,
        total: cappedRows.reduce((sum, row) => sum + row.amount, 0),
    };
};

const calculateStudentSettlement = (row, policy) => {
    const sourceTotals = Object.fromEntries(
        Object.entries(row.sourceBreakdown || {}).map(([sourceKey, source]) => [
            sourceKey,
            toMoney(source.grossAmount),
        ]),
    );
    const grossIncome = Object.values(sourceTotals).reduce((sum, amount) => sum + amount, 0);
    const prepaidTax = Object.values(row.sourceBreakdown || {}).reduce(
        (sum, source) => sum + toMoney(source.withheldAmount),
        0,
    );
    const exemptionResult = applyExemptionGroups(sourceTotals, policy);
    const nonTaxableIncome = Math.min(grossIncome, exemptionResult.total);
    const taxableIncome = Math.max(0, grossIncome - nonTaxableIncome);
    const deductionResult = buildDeductionRows({
        taxableIncome,
        taxableBySource: exemptionResult.taxableBySource,
        metrics: row.metrics,
        policy,
    });
    const taxBase = Math.max(0, taxableIncome - deductionResult.total);
    const taxResult = calculateProgressiveTax(taxBase, policy.taxBrackets || []);
    const creditResult = buildTaxCreditRows({
        calculatedTax: taxResult.taxAmount,
        metrics: row.metrics,
        policy,
    });
    const finalTax = Math.max(0, taxResult.taxAmount - creditResult.total);
    const settlementAmount = finalTax - prepaidTax;

    return {
        ...row,
        grossIncome,
        prepaidTax,
        nonTaxableIncome,
        taxableIncome,
        incomeDeduction: deductionResult.total,
        taxBase,
        calculatedTax: taxResult.taxAmount,
        taxBracketBreakdown: taxResult.bracketRows,
        taxCredit: creditResult.total,
        finalTax,
        settlementAmount,
        additionalTax: Math.max(0, settlementAmount),
        refundAmount: Math.max(0, -settlementAmount),
        exemptions: exemptionResult.rows,
        incomeDeductions: deductionResult.rows,
        taxCredits: creditResult.rows,
    };
};

const applyManualAdjustmentsToRow = (row, policy, manualAdjustments = {}) => {
    const requestedIncomeDeduction = toMoney(
        manualAdjustments.incomeDeductionAmount,
    );
    const requestedTaxCredit = toMoney(manualAdjustments.taxCreditAmount);
    const note = String(manualAdjustments.note || "").trim().slice(0, 300);
    const automaticDeductionRows = (row.incomeDeductions || [])
        .filter((item) => item?.id !== "manual");
    const automaticDeductionTotal = automaticDeductionRows.reduce(
        (sum, item) => sum + toMoney(item.amount),
        0,
    );
    const appliedIncomeDeduction = Math.min(
        requestedIncomeDeduction,
        Math.max(0, toMoney(row.taxableIncome) - automaticDeductionTotal),
    );
    const incomeDeductions = [...automaticDeductionRows];
    if (appliedIncomeDeduction > 0) {
        incomeDeductions.push({
            id: "manual",
            label: "수동 소득공제",
            amount: appliedIncomeDeduction,
            requestedAmount: requestedIncomeDeduction,
            note,
        });
    }

    const incomeDeduction = incomeDeductions.reduce(
        (sum, item) => sum + toMoney(item.amount),
        0,
    );
    const taxBase = Math.max(0, toMoney(row.taxableIncome) - incomeDeduction);
    const taxResult = calculateProgressiveTax(taxBase, policy.taxBrackets || []);
    const automaticCreditResult = buildTaxCreditRows({
        calculatedTax: taxResult.taxAmount,
        metrics: row.metrics || {},
        policy,
    });
    const appliedTaxCredit = Math.min(
        requestedTaxCredit,
        Math.max(0, taxResult.taxAmount - automaticCreditResult.total),
    );
    const taxCredits = [...automaticCreditResult.rows];
    if (appliedTaxCredit > 0) {
        taxCredits.push({
            id: "manual",
            label: "수동 세액공제",
            amount: appliedTaxCredit,
            requestedAmount: requestedTaxCredit,
            note,
        });
    }
    const taxCredit = taxCredits.reduce(
        (sum, item) => sum + toMoney(item.amount),
        0,
    );
    const finalTax = Math.max(0, taxResult.taxAmount - taxCredit);
    const settlementAmount = finalTax - toMoney(row.prepaidTax);

    return {
        ...row,
        incomeDeductions,
        incomeDeduction,
        taxBase,
        calculatedTax: taxResult.taxAmount,
        taxBracketBreakdown: taxResult.bracketRows,
        taxCredits,
        taxCredit,
        finalTax,
        settlementAmount,
        additionalTax: Math.max(0, settlementAmount),
        refundAmount: Math.max(0, -settlementAmount),
        manualAdjustments: {
            incomeDeductionAmount: requestedIncomeDeduction,
            appliedIncomeDeduction,
            taxCreditAmount: requestedTaxCredit,
            appliedTaxCredit,
            note,
        },
    };
};

const aggregateRows = (rows) =>
    rows.reduce(
        (totals, row) => {
            [
                "grossIncome",
                "nonTaxableIncome",
                "taxableIncome",
                "incomeDeduction",
                "taxBase",
                "calculatedTax",
                "taxCredit",
                "finalTax",
                "prepaidTax",
                "additionalTax",
                "refundAmount",
            ].forEach((key) => {
                totals[key] += toMoney(row[key]);
            });
            totals.settlementAmount += Number.isFinite(Number(row.settlementAmount))
                ? Math.round(Number(row.settlementAmount))
                : 0;
            return totals;
        },
        {
            grossIncome: 0,
            nonTaxableIncome: 0,
            taxableIncome: 0,
            incomeDeduction: 0,
            taxBase: 0,
            calculatedTax: 0,
            taxCredit: 0,
            finalTax: 0,
            prepaidTax: 0,
            settlementAmount: 0,
            additionalTax: 0,
            refundAmount: 0,
        },
    );

const getStudentUidFromActivityLog = (docSnap, data) => {
    if (data.studentUid) return data.studentUid;
    const studentRef = docSnap.ref.parent.parent;
    return studentRef?.id || null;
};

const createRowsFromActivityLogs = ({ students, logsSnap, policy, currencyUnit }) => {
    const rowsByUid = new Map(
        students.map((student) => [student.uid, buildEmptyStudentRow(student, currencyUnit)]),
    );
    let incomeLogCount = 0;
    let metricLogCount = 0;

    logsSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const studentUid = getStudentUidFromActivityLog(docSnap, data);
        const row = rowsByUid.get(studentUid);
        if (!row) return;

        const incomeTax = data.incomeTax || null;
        if (incomeTax?.version === 1 && incomeTax.monthEndSettlementEnabled !== false) {
            const sourceKey = incomeTax.sourceKey || "unknown";
            const source = row.sourceBreakdown[sourceKey] || {
                sourceKey,
                label: SOURCE_LABELS[sourceKey] || sourceKey,
                grossAmount: 0,
                withheldAmount: 0,
                taxableAmountAtWithholding: 0,
                count: 0,
            };
            source.grossAmount += toMoney(incomeTax.grossAmount);
            source.withheldAmount += toMoney(incomeTax.withheldAmount);
            source.taxableAmountAtWithholding += toMoney(incomeTax.taxableAmount);
            source.count += 1;
            row.sourceBreakdown[sourceKey] = source;
            incomeLogCount += 1;
        }

        if (data.type === "expense" && data.category === "store") {
            row.metrics.storePurchaseAmount += toMoney(data.amount);
            metricLogCount += 1;
        }

        if (data.type === "donation" && data.category === "donation") {
            row.metrics.donationAmount += toMoney(data.amount);
            metricLogCount += 1;
        }
    });

    const rows = Array.from(rowsByUid.values()).map((row) =>
        calculateStudentSettlement(row, policy),
    );
    return { rows, incomeLogCount, metricLogCount };
};

const timestampFromDateKey = (dateKey, endOfDay = false) => {
    const suffix = endOfDay
        ? "T23:59:59.999+09:00"
        : "T00:00:00.000+09:00";
    return Timestamp.fromDate(new Date(`${dateKey}${suffix}`));
};

const buildSyntheticActivityLogSnapshot = (lineDocs = [], metricDocs = []) => ({
    forEach(callback) {
        lineDocs.forEach((lineDoc) => {
            const line = lineDoc.data() || {};
            callback({
                id: lineDoc.id,
                ref: lineDoc.ref,
                data: () => ({
                    classId: line.classId || null,
                    studentUid: line.studentUid || null,
                    studentName: line.studentName || null,
                    timestamp: line.occurredAt || null,
                    incomeTax:
                        line.incomeTax && typeof line.incomeTax === "object"
                            ? line.incomeTax
                            : null,
                }),
            });
        });
        metricDocs.forEach(callback);
    },
});

const readPeriodSettlementInput = async ({
    classId,
    settlementIds = [],
}) => {
    let settlementDocs = [];
    const normalizedIds = Array.from(
        new Set(
            (Array.isArray(settlementIds) ? settlementIds : [])
                .map((id) => String(id || "").trim())
                .filter(Boolean),
        ),
    );

    if (normalizedIds.length > 0) {
        const refs = normalizedIds.map((id) =>
            db.doc(`classes/${classId}/taxPeriodSettlements/${id}`),
        );
        settlementDocs = await db.getAll(...refs);
    } else {
        const snap = await db
            .collection(`classes/${classId}/taxPeriodSettlements`)
            .where("status", "==", "finalized")
            .get();
        settlementDocs = snap.docs;
    }

    const availableDocs = settlementDocs
        .filter((docSnap) => docSnap.exists)
        .filter((docSnap) => {
            const data = docSnap.data() || {};
            return (
                data.status === "finalized" &&
                !data.monthEndSettlementId
            );
        })
        .sort((left, right) =>
            String(left.data()?.startDateKey || "").localeCompare(
                String(right.data()?.startDateKey || ""),
            ),
        );

    if (availableDocs.length === 0) {
        throw new HttpsError(
            "failed-precondition",
            "자동 국고 집계가 완료된 세금이 없습니다. 전날까지의 원천징수 기록을 확인해 주세요.",
        );
    }

    const lineSnaps = await Promise.all(
        availableDocs.map((docSnap) => docSnap.ref.collection("lines").get()),
    );
    const lineDocs = lineSnaps.flatMap((snap) => snap.docs);
    const metricDocsByPath = new Map();
    for (const settlementDoc of availableDocs) {
        const settlement = settlementDoc.data() || {};
        const rangeSnap = await db
            .collectionGroup("activityLogs")
            .where("classId", "==", classId)
            .where("timestamp", ">=", timestampFromDateKey(settlement.startDateKey))
            .where("timestamp", "<=", timestampFromDateKey(settlement.endDateKey, true))
            .orderBy("timestamp", "desc")
            .get();
        rangeSnap.docs.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const isStoreMetric =
                data.type === "expense" && data.category === "store";
            const isDonationMetric =
                data.type === "donation" && data.category === "donation";
            if (isStoreMetric || isDonationMetric) {
                metricDocsByPath.set(docSnap.ref.path, docSnap);
            }
        });
    }
    const metricDocs = Array.from(metricDocsByPath.values());

    const startDateKey = availableDocs[0].data().startDateKey;
    const endDateKey = availableDocs.reduce((latest, docSnap) => {
        const candidate = String(docSnap.data()?.endDateKey || "");
        return candidate > latest ? candidate : latest;
    }, "");

    return {
        settlementIds: availableDocs.map((docSnap) => docSnap.id),
        periodStartTs: timestampFromDateKey(startDateKey),
        periodEndTs: timestampFromDateKey(endDateKey, true),
        logsSnap: buildSyntheticActivityLogSnapshot(lineDocs, metricDocs),
    };
};


const ensureTaxAccess = async (
    classId,
    auth,
    { skipPlanCheck = false, teacherOnly = false } = {},
) => {
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    if (!classId) throw new HttpsError("invalid-argument", "classId가 필요합니다.");

    const [globalConfig, classSnap] = await Promise.all([
        getGlobalConfig(),
        db.doc(`classes/${classId}`).get(),
        mustBeTeacherOrTaxAdmin(classId, auth.uid, { teacherOnly }),
    ]);
    if (!classSnap.exists) {
        throw new HttpsError("not-found", "학급을 찾을 수 없습니다.");
    }

    const classData = classSnap.data() || {};
    const planType = classData.planType || "FREE";
    const hasTaxAccess =
        canUseFeature(globalConfig, planType, "tax", "accessible") ||
        canUsePagePolicy(globalConfig, planType, "tax", "accessible");
    if (!skipPlanCheck && !hasTaxAccess) {
        throw new HttpsError("permission-denied", "세금 기능을 사용할 수 없는 플랜입니다.");
    }

    return { globalConfig, classData, planType };
};

exports.generateMonthEndSettlementDraft = onCall(
    { region: "asia-northeast3", timeoutSeconds: 540, memory: "1GiB" },
    async (request) => {
        const { auth, data } = request;
        const { classId, selectedStudentUids } = data || {};
        const { classData } = await ensureTaxAccess(classId, auth, {
            skipPlanCheck: true,
            teacherOnly: true,
        });
        const policy = getMonthEndSettlementPolicy(classData);
        const activeDraftId = policy.activeDraftId || null;
        const isRecalculation = Boolean(activeDraftId);
        let draftRef = activeDraftId
            ? db.doc(`classes/${classId}/monthEndSettlementDrafts/${activeDraftId}`)
            : db.collection(`classes/${classId}/monthEndSettlementDrafts`).doc();
        let existingRowDocs = [];
        const manualAdjustmentsByUid = new Map();
        let periodStartTs = null;
        let periodEndTs = null;
        let existingDraft = null;
        let periodSettlementInput = null;

        if (activeDraftId) {
            const draftSnap = await draftRef.get();
            if (!draftSnap.exists) {
                throw new HttpsError("not-found", "기존 월말정산 미리보기를 찾을 수 없습니다.");
            }
            existingDraft = draftSnap.data() || {};
            if (existingDraft.status !== "draft") {
                throw new HttpsError(
                    "failed-precondition",
                    "확정되었거나 취소된 미리보기는 다시 계산할 수 없습니다.",
                );
            }
            periodStartTs = timestampFromAny(existingDraft.periodStartAt);
            periodEndTs = timestampFromAny(existingDraft.periodEndAt);
            if (!periodStartTs || !periodEndTs) {
                throw new HttpsError("failed-precondition", "기존 미리보기의 정산기간이 올바르지 않습니다.");
            }

            const existingRowsSnap = await draftRef.collection("studentRows").get();
            existingRowDocs = existingRowsSnap.docs;
            existingRowsSnap.docs.forEach((rowDoc) => {
                const row = rowDoc.data() || {};
                manualAdjustmentsByUid.set(rowDoc.id, row.manualAdjustments || {});
            });
        }

        if (!existingDraft) {
            await finalizeOutstandingDailySettlements({
                classId,
                actorUid: auth.uid,
            });
        }

        periodSettlementInput = await readPeriodSettlementInput({
            classId,
            settlementIds: existingDraft?.periodSettlementIds || [],
        });
        periodStartTs = periodSettlementInput.periodStartTs;
        periodEndTs = periodSettlementInput.periodEndTs;


        if (periodEndTs.toMillis() <= periodStartTs.toMillis()) {
            throw new HttpsError("invalid-argument", "정산 종료일은 시작일 이후여야 합니다.");
        }

        const studentsSnap = await db.collection(`classes/${classId}/students`).get();
        const selectedUidSet = Array.isArray(selectedStudentUids) && selectedStudentUids.length > 0
            ? new Set(selectedStudentUids.map((uid) => String(uid || "").trim()).filter(Boolean))
            : null;
        const students = studentsSnap.docs
            .map((docSnap) => ({ uid: docSnap.id, ...(docSnap.data() || {}) }))
            .filter((student) => {
                const role = String(student.role || "").trim().toLowerCase();
                if (role === "teacher" || role === "admin") return false;
                return !selectedUidSet || selectedUidSet.has(student.uid);
            });

        const logsSnap = periodSettlementInput
            ? periodSettlementInput.logsSnap
            : await db
                .collectionGroup("activityLogs")
                .where("classId", "==", classId)
                .where("timestamp", ">", periodStartTs)
                .where("timestamp", "<=", periodEndTs)
                .orderBy("timestamp", "desc")
                .get();

        const currencyUnit = classData.currencyUnit || "단위";
        const rowResult = createRowsFromActivityLogs({
            students,
            logsSnap,
            policy,
            currencyUnit,
        });
        const rows = rowResult.rows.map((row) =>
            applyManualAdjustmentsToRow(
                row,
                policy,
                manualAdjustmentsByUid.get(row.studentUid) || {},
            ),
        );
        const incomeLogCount = rowResult.incomeLogCount;
        const metricLogCount = rowResult.metricLogCount;
        const totals = aggregateRows(rows);

        const writer = db.bulkWriter();
        const draftPayload = {
            classId,
            status: "draft",
            periodStartAt: periodStartTs,
            periodEndAt: periodEndTs,
            periodSettlementIds:
                periodSettlementInput?.settlementIds ||
                existingDraft?.periodSettlementIds ||
                [],
            inputMode: periodSettlementInput ? "period_settlements" : "activity_logs",
            policySnapshot: policy,
            totals,
            studentCount: rows.length,
            incomeLogCount,
            metricLogCount,
            currencyUnit,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: auth.uid,
            recalculatedAt: isRecalculation ? FieldValue.serverTimestamp() : null,
        };
        if (!isRecalculation) {
            draftPayload.createdAt = FieldValue.serverTimestamp();
            draftPayload.createdBy = auth.uid;
        }

        if (isRecalculation) {
            writer.set(draftRef, draftPayload, { merge: true });
        } else {
            writer.set(draftRef, draftPayload);
        }
        const nextRowUidSet = new Set(rows.map((row) => row.studentUid));
        existingRowDocs.forEach((rowDoc) => {
            if (!nextRowUidSet.has(rowDoc.id)) {
                writer.delete(rowDoc.ref);
            }
        });
        rows.forEach((row) => {
            writer.set(draftRef.collection("studentRows").doc(row.studentUid), row);
        });
        writer.set(
            db.doc(`classes/${classId}`),
            {
                taxPolicy: {
                    monthEndSettlement: {
                        activeDraftId: draftRef.id,
                        lockedPeriodEndAt: periodEndTs,
                    },
                },
            },
            { merge: true },
        );
        await writer.close();

        return {
            success: true,
            draftId: draftRef.id,
            status: "draft",
            period: {
                startAt: isoFromTimestamp(periodStartTs),
                endAt: isoFromTimestamp(periodEndTs),
            },
            rows,
            totals,
            studentCount: rows.length,
            incomeLogCount,
            metricLogCount,
            policySnapshot: policy,
            currencyUnit,
            recalculated: isRecalculation,
        };
    },
);

exports.updateMonthEndSettlementManualAdjustments = onCall(
    { region: "asia-northeast3", timeoutSeconds: 120, memory: "512MiB" },
    async (request) => {
        const { auth, data } = request;
        const { classId, draftId, adjustments } = data || {};
        if (!draftId) throw new HttpsError("invalid-argument", "draftId가 필요합니다.");
        if (!Array.isArray(adjustments)) {
            throw new HttpsError("invalid-argument", "adjustments 배열이 필요합니다.");
        }

        await ensureTaxAccess(classId, auth, {
            skipPlanCheck: true,
            teacherOnly: true,
        });
        const draftRef = db.doc(`classes/${classId}/monthEndSettlementDrafts/${draftId}`);
        const draftSnap = await draftRef.get();
        if (!draftSnap.exists) {
            throw new HttpsError("not-found", "월말정산 미리보기를 찾을 수 없습니다.");
        }
        const draft = draftSnap.data() || {};
        if (draft.status !== "draft") {
            throw new HttpsError("failed-precondition", "draft 상태에서만 수동 공제를 수정할 수 있습니다.");
        }

        const adjustmentMap = new Map(
            adjustments
                .map((item) => [
                    String(item?.studentUid || "").trim(),
                    {
                        incomeDeductionAmount: item?.incomeDeductionAmount,
                        taxCreditAmount: item?.taxCreditAmount,
                        note: item?.note,
                    },
                ])
                .filter(([studentUid]) => studentUid),
        );
        const policy = draft.policySnapshot || {};
        const rowsSnap = await draftRef.collection("studentRows").get();
        const allRows = [];
        const updatedRows = [];
        const writer = db.bulkWriter();

        rowsSnap.forEach((rowSnap) => {
            const existingRow = rowSnap.data() || {};
            const studentUid = existingRow.studentUid || rowSnap.id;
            if (!adjustmentMap.has(studentUid)) {
                allRows.push(existingRow);
                return;
            }

            const nextRow = applyManualAdjustmentsToRow(
                { ...existingRow, studentUid },
                policy,
                adjustmentMap.get(studentUid),
            );
            allRows.push(nextRow);
            updatedRows.push(nextRow);
            writer.set(rowSnap.ref, {
                ...nextRow,
                manualAdjustmentUpdatedAt: FieldValue.serverTimestamp(),
                manualAdjustmentUpdatedBy: auth.uid,
            }, { merge: true });
        });

        const totals = aggregateRows(allRows);
        writer.set(draftRef, {
            totals,
            manualAdjustmentUpdatedAt: FieldValue.serverTimestamp(),
            manualAdjustmentUpdatedBy: auth.uid,
        }, { merge: true });
        await writer.close();

        return {
            success: true,
            draftId,
            totals,
            rows: allRows.sort((a, b) => toMoney(b.grossIncome) - toMoney(a.grossIncome)),
            updatedCount: updatedRows.length,
        };
    },
);

exports.cancelMonthEndSettlementDraft = onCall(
    { region: "asia-northeast3", timeoutSeconds: 60, memory: "256MiB" },
    async (request) => {
        const { auth, data } = request;
        const { classId, draftId, reason = "" } = data || {};
        if (!draftId) throw new HttpsError("invalid-argument", "draftId가 필요합니다.");

        const { classData } = await ensureTaxAccess(classId, auth, {
            skipPlanCheck: true,
            teacherOnly: true,
        });
        const draftRef = db.doc(`classes/${classId}/monthEndSettlementDrafts/${draftId}`);
        const draftSnap = await draftRef.get();
        if (!draftSnap.exists) {
            throw new HttpsError("not-found", "월말정산 미리보기를 찾을 수 없습니다.");
        }

        const draft = draftSnap.data() || {};
        if (draft.status !== "draft") {
            throw new HttpsError("failed-precondition", "draft 상태의 미리보기만 취소할 수 있습니다.");
        }

        const activeDraftId = classData?.taxPolicy?.monthEndSettlement?.activeDraftId || null;
        if (activeDraftId && activeDraftId !== draftId) {
            throw new HttpsError(
                "failed-precondition",
                "현재 활성화된 월말정산 미리보기와 요청이 일치하지 않습니다.",
            );
        }

        const sanitizedReason = String(reason || "").trim().slice(0, 300);
        const writer = db.bulkWriter();
        writer.set(draftRef, {
            status: "cancelled",
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledBy: auth.uid,
            cancelReason: sanitizedReason,
        }, { merge: true });
        writer.set(db.doc(`classes/${classId}`), {
            taxPolicy: {
                monthEndSettlement: {
                    activeDraftId: null,
                    lockedPeriodEndAt: null,
                },
            },
        }, { merge: true });
        await writer.close();

        return {
            success: true,
            draftId,
            status: "cancelled",
        };
    },
);

exports.finalizeMonthEndSettlementDraft = onCall(
    { region: "asia-northeast3", timeoutSeconds: 120, memory: "512MiB" },
    async (request) => {
        const { auth, data } = request;
        const { classId, draftId } = data || {};
        if (!draftId) throw new HttpsError("invalid-argument", "draftId가 필요합니다.");

        const { globalConfig, classData, planType } = await ensureTaxAccess(
            classId,
            auth,
            { skipPlanCheck: true, teacherOnly: true },
        );
        const draftRef = db.doc(`classes/${classId}/monthEndSettlementDrafts/${draftId}`);

        await db.runTransaction(async (tx) => {
            const draftSnap = await tx.get(draftRef);
            if (!draftSnap.exists) {
                throw new HttpsError("not-found", "월말정산 미리보기를 찾을 수 없습니다.");
            }
            const draft = draftSnap.data() || {};
            if (draft.status !== "draft") {
                throw new HttpsError("failed-precondition", "이미 처리 중이거나 확정된 정산입니다.");
            }
            const periodSettlementIds = Array.isArray(draft.periodSettlementIds)
                ? draft.periodSettlementIds
                : [];
            const periodSettlementRefs = periodSettlementIds.map((id) =>
                db.doc(`classes/${classId}/taxPeriodSettlements/${id}`),
            );
            const periodSettlementSnaps = [];
            for (const ref of periodSettlementRefs) {
                periodSettlementSnaps.push(await tx.get(ref));
            }
            periodSettlementSnaps.forEach((settlementSnap) => {
                const settlement = settlementSnap.data() || {};
                if (
                    !settlementSnap.exists ||
                    settlement.status !== "finalized" ||
                    settlement.monthEndSettlementId
                ) {
                    throw new HttpsError(
                        "failed-precondition",
                        "A linked period income settlement is no longer available.",
                    );
                }
            });
            periodSettlementRefs.forEach((ref) => {
                tx.set(ref, {
                    status: "consuming",
                    monthEndSettlementId: draftId,
                    monthEndLinkedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            });
            tx.update(draftRef, {
                status: "finalizing",
                finalizingAt: FieldValue.serverTimestamp(),
                finalizingBy: auth.uid,
            });
        });

        const draftSnap = await draftRef.get();
        const draft = draftSnap.data() || {};
        const rowsSnap = await draftRef.collection("studentRows").get();
        const currencyField = classData.currencySettings?.field || "cash";
        const currencyUnit = draft.currencyUnit || classData.currencyUnit || "단위";
        const logContext = {
            config: globalConfig,
            planType,
            serviceName: "tax",
            pageKey: "tax",
            forceWrite: true,
        };
        const writer = db.bulkWriter();
        let refundCount = 0;
        let taxBillCount = 0;
        const refundDetailLines = [];

        rowsSnap.forEach((rowSnap) => {
            const row = rowSnap.data() || {};
            const studentUid = row.studentUid || rowSnap.id;
            const studentName = row.studentName || "학생";
            const refundAmount = toMoney(row.refundAmount);
            const additionalTax = toMoney(row.additionalTax);
            const taxBillId = additionalTax > 0 ? `month_end_${draftId}` : null;

            writer.set(
                db.doc(
                    `classes/${classId}/students/${studentUid}/monthEndSettlementStatements/${draftId}`,
                ),
                buildStudentStatementPayload({
                    classId,
                    draftId,
                    draft,
                    row: {
                        ...row,
                        studentUid,
                        studentName,
                    },
                    issuedBy: auth.uid,
                    currencyUnit,
                    taxBillId,
                }),
                { merge: true },
            );

            if (refundAmount > 0) {
                refundCount += 1;
                const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
                writer.set(
                    studentRef,
                    { assets: { [currencyField]: FieldValue.increment(refundAmount) } },
                    { merge: true },
                );
                stageActivityLog(writer, classId, {
                    studentUid,
                    type: "income",
                    category: "tax_refund",
                    amount: refundAmount,
                    description: "월말정산 환급",
                    relatedDoc: { collection: "monthEndSettlementDrafts", id: draftId },
                    settlementDraftId: draftId,
                }, logContext);
                refundDetailLines.push({
                    amount: refundAmount,
                    description: "월말정산 환급",
                    source: "month_end_settlement_refund",
                    expenseType: "tax_refund",
                    category: "tax_refund",
                    studentUid,
                    studentName,
                    relatedDoc: { collection: "monthEndSettlementDrafts", id: draftId },
                    externalId: `${draftId}_${studentUid}`,
                    meta: {
                        settlementDraftId: draftId,
                        finalTax: row.finalTax || 0,
                        prepaidTax: row.prepaidTax || 0,
                    },
                });
            }

            if (additionalTax > 0) {
                taxBillCount += 1;
                const billRef = db.doc(
                    `classes/${classId}/students/${studentUid}/taxBills/${taxBillId}`,
                );
                writer.set(billRef, {
                    classId,
                    studentUid,
                    studentName,
                    issuedBy: auth.uid,
                    billKind: "month_end_settlement",
                    name: "월말정산 추가납부",
                    amount: additionalTax,
                    description: "월말정산 결과 기납부세액보다 결정세액이 큽니다.",
                    status: "pending",
                    isPaid: false,
                    issuedAt: FieldValue.serverTimestamp(),
                    paidAt: null,
                    taxType: "month_end_settlement",
                    periodStart: serializeTimestamp(draft.periodStartAt),
                    periodEnd: serializeTimestamp(draft.periodEndAt),
                    settlementDraftId: draftId,
                    policySnapshot: draft.policySnapshot || null,
                    currencyUnit,
                });
            }
        });

        const totalRefundAmount = refundDetailLines.reduce((sum, line) => sum + line.amount, 0);
        if (totalRefundAmount > 0) {
            stageTaxExpense(
                writer,
                classId,
                {
                    amount: totalRefundAmount,
                    description: "월말정산 환급",
                    source: "month_end_settlement_refund",
                    expenseType: "tax_refund",
                    category: "tax_refund",
                },
                auth.uid,
                {
                    ...logContext,
                    skipFeatureGate: true,
                    customId: `month_end_refund_${draftId}`,
                    aggregateMeta: {
                        group: "month_end_settlement",
                        batchKey: draftId,
                        pageKey: "tax",
                        actorUid: auth.uid,
                        reason: "month_end_settlement_refund",
                        mode: "finalize",
                    },
                    detailLines: refundDetailLines,
                },
            );
        }

        const periodSettlementIds = Array.isArray(draft.periodSettlementIds)
            ? draft.periodSettlementIds
            : [];
        periodSettlementIds.forEach((settlementId) => {
            writer.set(
                db.doc(`classes/${classId}/taxPeriodSettlements/${settlementId}`),
                {
                    status: "consumed",
                    monthEndConsumedAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        });
        writer.set(draftRef, {
            status: "finalized",
            finalizedAt: FieldValue.serverTimestamp(),
            finalizedBy: auth.uid,
            refundCount,
            taxBillCount,
        }, { merge: true });
        writer.set(db.doc(`classes/${classId}`), {
            taxPolicy: {
                monthEndSettlement: {
                    lastClosedAt: draft.periodEndAt,
                    activeDraftId: null,
                    lockedPeriodEndAt: null,
                },
            },
        }, { merge: true });

        await writer.close();

        return {
            success: true,
            draftId,
            refundCount,
            taxBillCount,
            totalRefundAmount,
        };
    },
);

exports.__private = {
    createRowsFromActivityLogs,
};
