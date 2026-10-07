const admin = require("../firebaseAdminCompat");
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const { canUseFeature } = require("./planManager");
const {
    shouldDeferTaxIncomeToPeriodSettlement,
} = require("./taxPolicy");

const getDateKeyInKST = (value = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value instanceof Date ? value : new Date(value));
    const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${mapped.year}-${mapped.month}-${mapped.day}`;
};

const buildAutomaticPeriodSettlementPatch = (classData, occurredAt) => {
    const occurredDateKey = getDateKeyInKST(occurredAt);
    const savedActivationDateKey =
        classData?.taxPolicy?.periodIncomeSettlement?.activationDateKey || null;
    return {
        "taxPolicy.periodIncomeSettlement.enabled": true,
        "taxPolicy.periodIncomeSettlement.activationDateKey":
            savedActivationDateKey && savedActivationDateKey <= occurredDateKey
                ? savedActivationDateKey
                : occurredDateKey,
        "taxPolicy.periodIncomeSettlement.dailyAggregationEnabled": true,
        "taxPolicy.periodIncomeSettlement.scheduleEnabled": true,
        "taxPolicy.periodIncomeSettlement.sourceKeys": [],
    };
};

function pruneUndefined(obj) {
    if (obj == null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(pruneUndefined);
    if (obj instanceof FieldValue) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        const pv = pruneUndefined(v);
        if (pv !== undefined) out[k] = pv;
    }
    return out;
}

function normalizeTaxIncomePayload(raw = {}, createdBy) {
    const doc = pruneUndefined({
        amount: Number(raw.amount) || 0,
        description: raw.description || "",
        source: raw.source || "system",
        taxType: raw.taxType || "transaction_fee",
        studentUid: raw.studentUid || null,
        studentName: raw.studentName || null,
        createdBy: createdBy || null,
        breakdown:
            raw.breakdown && typeof raw.breakdown === "object"
                ? {
                    baseAmount: raw.breakdown.baseAmount,
                    taxAmount: raw.breakdown.taxAmount,
                    taxRate: raw.breakdown.taxRate,
                }
                : undefined,
    });
    doc.createdAt = FieldValue.serverTimestamp();
    if (!(doc.amount > 0)) throw new Error("taxIncome.amount must be greater than 0");
    return doc;
}

function normalizeDetailLines(rawLines = []) {
    if (!Array.isArray(rawLines)) return [];
    return rawLines
        .map((line) => {
            const amount = Number(line?.amount);
            const doc = pruneUndefined({
                amount: Number.isFinite(amount) ? amount : undefined,
                description: line?.description || "",
                source: line?.source || undefined,
                taxType: line?.taxType || undefined,
                studentUid: line?.studentUid || undefined,
                studentName: line?.studentName || undefined,
                relatedDoc: line?.relatedDoc || undefined,
                status: line?.status || "active",
                meta:
                    line?.meta && typeof line.meta === "object"
                        ? line.meta
                        : undefined,
                externalId: line?.externalId || undefined,
            });
            if (!(Number(doc.amount) > 0)) return null;
            return { id: line?.id ? String(line.id) : null, doc };
        })
        .filter(Boolean);
}

function buildInlineDetailPayload(normalizedLines = []) {
    if (!Array.isArray(normalizedLines) || normalizedLines.length === 0) {
        return null;
    }

    const detailLines = normalizedLines.map(({ id, doc }) => ({
        id: id || db.collection("_").doc().id,
        ...doc,
    }));

    return {
        detailStorage: "inline",
        detailCount: detailLines.length,
        detailLines,
        detailUpdatedAt: FieldValue.serverTimestamp(),
    };
}

function buildAggregatePatch(serviceName, aggregateMeta, detailCount) {
    if (!aggregateMeta || typeof aggregateMeta !== "object") return null;
    return pruneUndefined({
        isAggregated: true,
        detailCount,
        aggregate: {
            serviceName,
            group: aggregateMeta.group || null,
            batchKey: aggregateMeta.batchKey || null,
            pageKey: aggregateMeta.pageKey || null,
            actorUid: aggregateMeta.actorUid || null,
            actorName: aggregateMeta.actorName || null,
            reason: aggregateMeta.reason || null,
            mode: aggregateMeta.mode || null,
            version: aggregateMeta.version || 1,
        },
        updatedAt: FieldValue.serverTimestamp(),
    });
}

function stageTaxIncome(tx, classId, payload, createdBy, options = {}) {
    const {
        config,
        planType = "FREE",
        serviceName = "etc",
        skipFeatureGate = false,
        customId,
        aggregateMeta = null,
        detailLines = null,
        classData = null,
        sourceKey = null,
        occurredAt = new Date(),
        skipPeriodSettlement = false,
        ensurePeriodSettlement = false,
    } = options;
    if (!skipPeriodSettlement && ensurePeriodSettlement) {
        tx.update(
            db.doc(`classes/${classId}`),
            buildAutomaticPeriodSettlementPatch(classData, occurredAt),
        );
        return { id: null, skipped: true, deferred: true };
    }
    if (
        !skipPeriodSettlement &&
        classData &&
        shouldDeferTaxIncomeToPeriodSettlement(
            classData,
            sourceKey,
            occurredAt,
        )
    ) {
        return { id: null, skipped: true, deferred: true };
    }
    if (!skipFeatureGate && !canUseFeature(config, planType, serviceName, "enableTax")) {
        return { id: null, skipped: true };
    }

    const docData = normalizeTaxIncomePayload(payload, createdBy);
    const ref = customId
        ? db.doc(`classes/${classId}/taxIncomes/${customId}`)
        : db.collection(`classes/${classId}/taxIncomes`).doc();

    const normalizedLines = normalizeDetailLines(detailLines);
    const inlineDetailPayload = buildInlineDetailPayload(normalizedLines);
    const aggregatePatch = buildAggregatePatch(
        serviceName,
        aggregateMeta,
        normalizedLines.length || undefined,
    );
    tx.set(ref, {
        ...docData,
        ...(aggregatePatch || {}),
        ...(inlineDetailPayload || {}),
    });

    return {
        id: ref.id,
        amount: docData.amount,
        lineIds: inlineDetailPayload?.detailLines?.map((line) => line.id) || [],
    };
}

async function recordTaxIncome(classId, payload, createdBy, options = {}) {
    const {
        config,
        planType = "FREE",
        serviceName = "etc",
        skipFeatureGate = false,
        alsoUpdateSummary = false,
        aggregateMeta = null,
        detailLines = null,
        classData = null,
        sourceKey = null,
        occurredAt = new Date(),
        skipPeriodSettlement = false,
        ensurePeriodSettlement = false,
    } = options;
    if (!skipPeriodSettlement && ensurePeriodSettlement) {
        await db
            .doc(`classes/${classId}`)
            .update(buildAutomaticPeriodSettlementPatch(classData, occurredAt));
        return { id: null, skipped: true, deferred: true };
    }
    if (
        !skipPeriodSettlement &&
        classData &&
        shouldDeferTaxIncomeToPeriodSettlement(
            classData,
            sourceKey,
            occurredAt,
        )
    ) {
        return { id: null, skipped: true, deferred: true };
    }
    if (!skipFeatureGate && !canUseFeature(config, planType, serviceName, "enableTax")) {
        return { id: null, skipped: true };
    }

    const docData = normalizeTaxIncomePayload(payload, createdBy);
    const ref = db.collection(`classes/${classId}/taxIncomes`).doc();
    await ref.set(docData);

    const normalizedLines = normalizeDetailLines(detailLines);
    const inlineDetailPayload = buildInlineDetailPayload(normalizedLines);
    const aggregatePatch = buildAggregatePatch(
        serviceName,
        aggregateMeta,
        normalizedLines.length || undefined,
    );

    if (aggregatePatch || inlineDetailPayload) {
        const batch = db.batch();
        if (aggregatePatch) batch.set(ref, aggregatePatch, { merge: true });
        if (inlineDetailPayload) {
            batch.set(ref, inlineDetailPayload, { merge: true });
        }
        await batch.commit();
    }

    if (alsoUpdateSummary) {
        const inc = (n) => FieldValue.increment(n);
        await db
            .doc(`classes/${classId}/dashboardSummary/taxSummary`)
            .set(
                {
                    totalIncome: inc(docData.amount),
                    [`byTaxType.${docData.taxType || "etc"}`]: inc(docData.amount),
                    lastUpdated: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
    }
    return { id: ref.id, amount: docData.amount };
}

module.exports = { stageTaxIncome, recordTaxIncome };
