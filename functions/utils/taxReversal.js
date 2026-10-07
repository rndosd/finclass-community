const admin = require("../firebaseAdminCompat");
const { stageTaxIncome } = require("./taxIncome");
const { stageTaxExpense } = require("./taxExpense");
const { normalizeTaxEvent } = require("./taxEvent");

const FieldValue = admin.firestore.FieldValue;

const TAX_CANCELLATION_STATUS = Object.freeze({
    VOIDED_BEFORE_SETTLEMENT: "voided_before_settlement",
    REVERSED_AFTER_SETTLEMENT: "reversed_after_settlement",
});

const sanitizeIdPart = (value) =>
    String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

function buildTaxEventCancellationPlan(activityLogData = {}, options = {}) {
    const taxEvent = normalizeTaxEvent(activityLogData?.taxEvent);
    if (!taxEvent) return { action: "none", reason: "no_tax_event" };

    const previousCancellation = activityLogData?.taxCancellation;
    if (previousCancellation?.status) {
        return {
            action: "none",
            reason: "already_cancelled",
            taxEvent,
            previousCancellation,
        };
    }

    const immediateTaxRecord = activityLogData?.taxPosting?.mode === "immediate"
        ? activityLogData?.taxPosting?.record
        : null;

    if (!taxEvent.periodSettlementId && !immediateTaxRecord?.id) {
        return {
            action: "void",
            status: TAX_CANCELLATION_STATUS.VOIDED_BEFORE_SETTLEMENT,
            taxEvent,
        };
    }

    const activityLogId = sanitizeIdPart(options.activityLogId);
    const studentUid = sanitizeIdPart(options.studentUid);
    if (!activityLogId) {
        throw new Error("tax cancellation requires activityLogId after settlement");
    }

    return {
        action: "reverse",
        status: TAX_CANCELLATION_STATUS.REVERSED_AFTER_SETTLEMENT,
        taxEvent,
        reversalId: ["tax_event_reversal", studentUid, activityLogId]
            .filter(Boolean)
            .join("_"),
        immediateTaxRecord: immediateTaxRecord || null,
        voidTaxEvent: Boolean(immediateTaxRecord?.id),
    };
}

function stageTaxPostingLink(tx, activityLogRef, taxRecordResult = {}) {
    if (!tx || !activityLogRef) return null;

    const taxPosting = taxRecordResult?.deferred
        ? { mode: "deferred" }
        : taxRecordResult?.id
            ? {
                mode: "immediate",
                record: {
                    collection: "taxIncomes",
                    id: taxRecordResult.id,
                    lineIds: Array.isArray(taxRecordResult.lineIds)
                        ? taxRecordResult.lineIds
                        : [],
                },
            }
            : { mode: "none" };

    tx.set(activityLogRef, { taxPosting }, { merge: true });
    return taxPosting;
}

function stageActivityTaxCancellation({
    tx,
    classId,
    activityLogRef,
    activityLogData,
    actorUid,
    reason = "source_cancelled",
    context = {},
} = {}) {
    if (!tx || !classId || !activityLogRef || !activityLogData) {
        return { action: "none", reason: "missing_activity_log" };
    }

    const plan = buildTaxEventCancellationPlan(activityLogData, {
        activityLogId: activityLogRef.id,
        studentUid: activityLogData.studentUid,
    });
    if (plan.action === "none") return plan;

    const cancellation = {
        status: plan.status,
        reason: String(reason || "source_cancelled"),
        actorUid: actorUid || null,
        amount: plan.taxEvent.amount,
        sourceKey: plan.taxEvent.sourceKey,
        periodSettlementId: plan.taxEvent.periodSettlementId || null,
        cancelledAt: FieldValue.serverTimestamp(),
    };

    if (plan.action === "void") {
        tx.set(
            activityLogRef,
            {
                taxEvent: {
                    ...activityLogData.taxEvent,
                    voided: true,
                },
                taxCancellation: cancellation,
            },
            { merge: true },
        );
        return plan;
    }

    const reversal = stageIncomeCancellationAsExpense(
        tx,
        classId,
        {
            amount: plan.taxEvent.amount,
            description: `세금 취소 조정 - ${plan.taxEvent.sourceKey}`,
            source: "tax_event_cancellation",
            expenseType: "tax_refund",
            category: plan.taxEvent.taxCategory || "tax_refund",
            studentUid: activityLogData.studentUid || null,
            studentName: activityLogData.studentName || null,
            breakdown: {
                baseAmount: plan.taxEvent.taxableAmount,
                taxAmount: plan.taxEvent.amount,
                taxRate: plan.taxEvent.taxRate,
            },
        },
        actorUid,
        {
            ...context,
            customId: plan.reversalId,
            skipFeatureGate: true,
            aggregateMeta: {
                group: "tax_event_cancellation",
                batchKey: plan.reversalId,
                pageKey: context.pageKey || context.serviceName || "tax",
                actorUid: actorUid || null,
                reason,
                mode: "reverse_settled_tax_event",
            },
            detailLines: [
                {
                    id: activityLogRef.id,
                    amount: plan.taxEvent.amount,
                    source: "tax_event_cancellation",
                    expenseType: "tax_refund",
                    category: plan.taxEvent.taxCategory || "tax_refund",
                    studentUid: activityLogData.studentUid || null,
                    studentName: activityLogData.studentName || null,
                    relatedDoc: activityLogData.relatedDoc || null,
                    externalId: activityLogRef.id,
                    meta: {
                        sourceKey: plan.taxEvent.sourceKey,
                        taxType: plan.taxEvent.taxType,
                        periodSettlementId: plan.taxEvent.periodSettlementId,
                        reversalType: "income_to_expense",
                    },
                },
            ],
        },
    );

    tx.set(
        activityLogRef,
        {
            ...(plan.voidTaxEvent
                ? {
                    taxEvent: {
                        ...activityLogData.taxEvent,
                        voided: true,
                    },
                }
                : {}),
            taxCancellation: {
                ...cancellation,
                reversal: {
                    collection: "taxExpenses",
                    id: reversal.id,
                },
                ...(plan.immediateTaxRecord
                    ? { originalTaxRecord: plan.immediateTaxRecord }
                    : {}),
            },
        },
        { merge: true },
    );

    return plan;
}

function stageIncomeCancellationAsExpense(
    tx,
    classId,
    payload,
    createdBy,
    options = {},
) {
    const amount = Number(payload?.amount) || 0;
    if (!(amount > 0)) throw new Error("reversal.amount must be greater than 0");

    return stageTaxExpense(
        tx,
        classId,
        {
            amount,
            description: payload?.description || "Income cancellation reversal",
            source: payload?.source || "reversal_income_cancel",
            expenseType: payload?.expenseType || "reversal",
            category: payload?.category || payload?.expenseType || "reversal",
            studentUid: payload?.studentUid || null,
            studentName: payload?.studentName || null,
            breakdown: payload?.breakdown,
        },
        createdBy,
        options,
    );
}

function stageExpenseCancellationAsIncome(
    tx,
    classId,
    payload,
    createdBy,
    options = {},
) {
    const amount = Number(payload?.amount) || 0;
    if (!(amount > 0)) throw new Error("reversal.amount must be greater than 0");

    return stageTaxIncome(
        tx,
        classId,
        {
            amount,
            description: payload?.description || "Expense cancellation reversal",
            source: payload?.source || "reversal_expense_cancel",
            taxType: payload?.taxType || "reversal",
            studentUid: payload?.studentUid || null,
            studentName: payload?.studentName || null,
            breakdown: payload?.breakdown,
        },
        createdBy,
        options,
    );
}

module.exports = {
    TAX_CANCELLATION_STATUS,
    buildTaxEventCancellationPlan,
    stageActivityTaxCancellation,
    stageTaxPostingLink,
    stageIncomeCancellationAsExpense,
    stageExpenseCancellationAsIncome,
};
