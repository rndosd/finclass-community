"use strict";

const STORE_PUBLIC_FIELDS = [
    "name",
    "description",
    "price",
    "currencyType",
    "customTaxRate",
    "isTaxable",
    "categoryId",
    "itemType",
    "functionTag",
    "stock",
    "dailyLimit",
    "weeklyLimit",
    "totalLimit",
    "displayOrder",
    "createdAt",
    "validityHours",
    "minCreditTierId",
    "minCreditTierName",
    "isGiftAllowed",
    "timeSale",
];

function normalizeComparable(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (Array.isArray(value)) return value.map(normalizeComparable);
    if (typeof value === "object") {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                const normalized = normalizeComparable(value[key]);
                if (normalized !== undefined) result[key] = normalized;
                return result;
            }, {});
    }
    return value;
}

function isSameContribution(before, after) {
    return JSON.stringify(normalizeComparable(before)) ===
        JSON.stringify(normalizeComparable(after));
}

function getJobApplicationRoundContribution(data) {
    if (!data) return null;

    const status = String(data.status || "").trim();
    return {
        roundId: String(data.roundId || "").trim(),
        statusBucket: ["submitted", "approved", "rejected"].includes(status) ?
            status :
            "other",
    };
}

function hasJobApplicationRoundContributionChanged(beforeData, afterData) {
    return !isSameContribution(
        getJobApplicationRoundContribution(beforeData),
        getJobApplicationRoundContribution(afterData),
    );
}

function getTaxNotificationContribution(data) {
    if (!data) return null;
    if (data.isPaid === true || data.status === "paid") return null;
    return {
        unpaid: true,
    };
}

function hasTaxNotificationContributionChanged(beforeData, afterData) {
    return !isSameContribution(
        getTaxNotificationContribution(beforeData),
        getTaxNotificationContribution(afterData),
    );
}

function normalizeStoreSaleStatus(data = {}) {
    const rawStatus = String(data.saleStatus || "").trim().toLowerCase();
    if (["hidden", "display_only", "for_sale"].includes(rawStatus)) {
        return rawStatus;
    }
    return data.isActive === false ? "hidden" : "for_sale";
}

function getStoreCatalogContribution(data) {
    if (!data) return null;

    const saleStatus = normalizeStoreSaleStatus(data);
    if (saleStatus === "hidden") return { visible: false };

    const contribution = {
        visible: true,
        saleStatus,
        isActive: true,
        isTaxable: data.isTaxable !== false,
        isGiftAllowed: data.isGiftAllowed !== false,
    };

    STORE_PUBLIC_FIELDS.forEach((field) => {
        if (data[field] !== undefined) contribution[field] = data[field];
    });

    if (Array.isArray(data.randomBoxConfig?.rewards)) {
        contribution.randomBoxConfig = {
            boxType: data.randomBoxConfig.boxType === "premium" ?
                "premium" :
                "normal",
            rewards: data.randomBoxConfig.rewards.map((reward) => ({
                itemId: String(reward?.itemId || "").trim(),
                itemName: String(reward?.itemName || "").trim(),
                quantity: Math.max(1, Math.floor(Number(reward?.quantity || 1))),
                probabilityPercent: Number(reward?.probabilityPercent || 0),
                weight: Math.max(0, Number(reward?.weight || 0)),
            })),
        };
    }

    return contribution;
}

function hasStoreCatalogContributionChanged(beforeData, afterData) {
    return !isSameContribution(
        getStoreCatalogContribution(beforeData),
        getStoreCatalogContribution(afterData),
    );
}

function getPoliceRuleCatalogContribution(data) {
    if (!data) return null;

    const fineAmount = Number(data.fineAmount || 0);
    const creditChange = Number(data.creditChange || 0);
    const missionTokenChange = Number(data.missionTokenChange || 0);
    const rawOrder = Number(data.order);
    const rawDangerLevel = Number(data.dangerLevel);
    const dangerLevel = Number.isFinite(rawDangerLevel) &&
        Math.round(rawDangerLevel) >= 1 &&
        Math.round(rawDangerLevel) <= 3 ?
        Math.round(rawDangerLevel) :
        1;

    let type = "penalty";
    if (fineAmount > 0 || creditChange > 0 || missionTokenChange > 0) {
        type = "reward";
    }

    return {
        text: String(data.text || "").trim(),
        notes: typeof data.notes === "string" ? data.notes : "",
        fineAmount,
        creditChange,
        missionTokenChange,
        missionTokenEnabled:
            data.missionTokenEnabled === true || missionTokenChange !== 0,
        order: Number.isFinite(rawOrder) ? rawOrder : null,
        dangerLevel,
        type,
        sensitive: data.sensitive === true,
    };
}

function hasPoliceRuleCatalogContributionChanged(beforeData, afterData) {
    return !isSameContribution(
        getPoliceRuleCatalogContribution(beforeData),
        getPoliceRuleCatalogContribution(afterData),
    );
}

module.exports = {
    hasJobApplicationRoundContributionChanged,
    hasPoliceRuleCatalogContributionChanged,
    hasStoreCatalogContributionChanged,
    hasTaxNotificationContributionChanged,
};
