"use strict";

function toNonNegativeInteger(value, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
        return Math.max(0, Math.floor(Number(fallback) || 0));
    }

    return Math.max(0, Math.floor(numericValue));
}

function resolveRewardUsageStatus(remainingQuantity, grantedQuantity) {
    const safeRemainingQuantity = toNonNegativeInteger(remainingQuantity);
    const safeGrantedQuantity = Math.max(
        1,
        toNonNegativeInteger(grantedQuantity, safeRemainingQuantity || 1),
    );

    if (safeRemainingQuantity <= 0) {
        return "used";
    }

    if (safeRemainingQuantity >= safeGrantedQuantity) {
        return "unused";
    }

    return "partial";
}

function buildRandomBoxTrackingSeed() {
    return {
        randomBoxOpenedCount: 0,
        randomBoxRewardUnusedCount: 0,
        randomBoxRewardPartialCount: 0,
        randomBoxRewardUsedCount: 0,
        randomBoxLastOpenId: null,
        randomBoxLastOpenedAt: null,
        randomBoxLastRewardItemId: null,
        randomBoxLastRewardItemName: null,
        randomBoxLastRewardQuantity: null,
    };
}

function buildRandomBoxOpenEventRecord({
    purchaseId = "",
    randomBoxOpenId = "",
    studentUid = "",
    boxItemId = "",
    boxItemName = "",
    rewardItemId = "",
    rewardItemName = "",
    rewardQuantity = 1,
    openedAt = null,
} = {}) {
    const safeRewardQuantity = Math.max(1, toNonNegativeInteger(rewardQuantity, 1));

    return {
        purchaseId: String(purchaseId || "").trim(),
        randomBoxOpenId: String(randomBoxOpenId || "").trim(),
        studentUid: String(studentUid || "").trim(),
        boxItemId: String(boxItemId || "").trim(),
        boxItemName: String(boxItemName || "").trim(),
        rewardItemId: String(rewardItemId || "").trim(),
        rewardItemName: String(rewardItemName || "").trim(),
        rewardQuantity: safeRewardQuantity,
        rewardUsedQty: 0,
        rewardRemainingQty: safeRewardQuantity,
        rewardUsageStatus: "unused",
        openedAt,
        rewardLastUsedAt: null,
        updatedAt: openedAt,
    };
}

function buildRandomBoxRewardUsageTransition(detail = {}) {
    const purchaseId = String(detail?.sourcePurchaseId || "").trim();
    const randomBoxOpenId = String(detail?.randomBoxOpenId || "").trim();
    if (!purchaseId || !randomBoxOpenId) {
        return null;
    }

    const usedQuantity = Math.max(1, toNonNegativeInteger(detail?.quantity, 1));
    const remainingQuantityBeforeUse = toNonNegativeInteger(
        detail?.remainingQuantityBeforeUse,
        usedQuantity,
    );
    const grantedQuantity = Math.max(
        1,
        toNonNegativeInteger(
            detail?.grantedQuantity,
            remainingQuantityBeforeUse || usedQuantity,
        ),
    );
    const remainingQuantityAfterUse = Math.max(
        remainingQuantityBeforeUse - usedQuantity,
        0,
    );

    const previousStatus = resolveRewardUsageStatus(
        remainingQuantityBeforeUse,
        grantedQuantity,
    );
    const nextStatus = resolveRewardUsageStatus(
        remainingQuantityAfterUse,
        grantedQuantity,
    );

    const summaryCounterUpdates = {};
    const incrementField = (fieldName, delta) => {
        if (!delta) return;
        summaryCounterUpdates[fieldName] = delta;
    };
    const fieldByStatus = {
        unused: "randomBoxRewardUnusedCount",
        partial: "randomBoxRewardPartialCount",
        used: "randomBoxRewardUsedCount",
    };

    if (previousStatus !== nextStatus) {
        incrementField(fieldByStatus[previousStatus], -1);
        incrementField(fieldByStatus[nextStatus], 1);
    }

    return {
        purchaseId,
        randomBoxOpenId,
        usedQuantity,
        grantedQuantity,
        remainingQuantityBeforeUse,
        remainingQuantityAfterUse,
        previousStatus,
        nextStatus,
        summaryCounterUpdates,
    };
}

module.exports = {
    buildRandomBoxOpenEventRecord,
    buildRandomBoxRewardUsageTransition,
    buildRandomBoxTrackingSeed,
    resolveRewardUsageStatus,
};
