const admin = require("../firebaseAdminCompat");
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const { canUseFeature } = require("./planManager");

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

function normalizeTaxExpensePayload(raw = {}, createdBy) {
    const normalizedExpenseType =
        (typeof raw.expenseType === "string" && raw.expenseType.trim()) ||
        (typeof raw.category === "string" && raw.category.trim()) ||
        "reward";
    const normalizedCategory =
        (typeof raw.category === "string" && raw.category.trim()) ||
        normalizedExpenseType;

    const doc = pruneUndefined({
        amount: Number(raw.amount) || 0,
        description: raw.description || "",
        source: raw.source || "system",
        expenseType: normalizedExpenseType,
        category: normalizedCategory,
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
    if (!(doc.amount > 0)) throw new Error("taxExpense.amount must be greater than 0");
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
                expenseType: line?.expenseType || undefined,
                category: line?.category || undefined,
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

function stageTaxExpense(tx, classId, payload, createdBy, options = {}) {
    const {
        config,
        planType = "FREE",
        serviceName = "etc",
        skipFeatureGate = false,
        customId,
        aggregateMeta = null,
        detailLines = null,
    } = options;
    if (!skipFeatureGate && !canUseFeature(config, planType, serviceName, "enableTax")) {
        return { id: null, skipped: true };
    }

    const docData = normalizeTaxExpensePayload(payload, createdBy);
    const ref = customId
        ? db.doc(`classes/${classId}/taxExpenses/${customId}`)
        : db.collection(`classes/${classId}/taxExpenses`).doc();
    tx.set(ref, docData);

    const normalizedLines = normalizeDetailLines(detailLines);
    const inlineDetailPayload = buildInlineDetailPayload(normalizedLines);
    const aggregatePatch = buildAggregatePatch(
        serviceName,
        aggregateMeta,
        normalizedLines.length || undefined,
    );
    if (aggregatePatch) tx.set(ref, aggregatePatch, { merge: true });
    if (inlineDetailPayload) tx.set(ref, inlineDetailPayload, { merge: true });

    return {
        id: ref.id,
        amount: docData.amount,
        lineIds: inlineDetailPayload?.detailLines?.map((line) => line.id) || [],
    };
}

async function recordTaxExpense(classId, payload, createdBy, options = {}) {
    const {
        config,
        planType = "FREE",
        serviceName = "etc",
        skipFeatureGate = false,
        alsoUpdateSummary = false,
        aggregateMeta = null,
        detailLines = null,
    } = options;
    if (!skipFeatureGate && !canUseFeature(config, planType, serviceName, "enableTax")) {
        return { id: null, skipped: true };
    }

    const docData = normalizeTaxExpensePayload(payload, createdBy);
    const ref = db.collection(`classes/${classId}/taxExpenses`).doc();
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
                    totalExpense: inc(docData.amount),
                    [`byExpenseType.${docData.expenseType || "etc"}`]: inc(docData.amount),
                    lastUpdated: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
    }
    return { id: ref.id, amount: docData.amount };
}

module.exports = { stageTaxExpense, recordTaxExpense };
