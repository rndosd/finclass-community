"use strict";

const admin = require("../firebaseAdminCompat");
const { startOfDayInKST } = require("./dateUtils");

const toSafeNumber = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
};

function toDateLike(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") {
        return new Date(value.seconds * 1000);
    }
    if (value instanceof Date) return value;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSavingInterestTaxPolicyActive(
    enabledFrom,
    referenceDate = new Date(),
) {
    if (!enabledFrom) return true;

    const targetDate = toDateLike(enabledFrom);
    if (!targetDate) return false;

    const normalizedTarget = startOfDayInKST(targetDate);
    const normalizedReference = startOfDayInKST(referenceDate);

    return normalizedReference.getTime() >= normalizedTarget.getTime();
}

function buildSavingInterestTaxPolicySnapshot(policy = {}) {
    const enabledFromDate = toDateLike(policy?.enabledFrom);

    return {
        version: 1,
        enabled: policy?.enabled === true,
        taxRate: Math.max(0, toSafeNumber(policy?.taxRate)),
        enabledFrom: enabledFromDate
            ? admin.firestore.Timestamp.fromDate(
                startOfDayInKST(enabledFromDate),
            )
            : null,
    };
}

function getSavingInterestTaxPolicySnapshot(saving = {}) {
    const rawSnapshot = saving?.interestTaxPolicySnapshot;
    if (
        !rawSnapshot ||
        typeof rawSnapshot !== "object" ||
        Array.isArray(rawSnapshot)
    ) {
        return null;
    }

    return {
        enabled: rawSnapshot.enabled === true,
        taxRate: Math.max(0, toSafeNumber(rawSnapshot.taxRate)),
        enabledFrom: rawSnapshot.enabledFrom ?? null,
    };
}

function resolveSavingInterestTaxPolicy(
    saving = {},
    currentPolicy = null,
    referenceDate = new Date(),
) {
    const snapshot = getSavingInterestTaxPolicySnapshot(saving);
    const currentEnabled = currentPolicy?.enabled === true;
    const enabledFrom = snapshot?.enabledFrom ?? currentPolicy?.enabledFrom ?? null;

    return {
        hasSnapshot: Boolean(snapshot),
        enabled:
            currentEnabled &&
            snapshot?.enabled === true &&
            isSavingInterestTaxPolicyActive(enabledFrom, referenceDate),
        taxRate: snapshot ? snapshot.taxRate : 0,
        enabledFrom,
    };
}

module.exports = {
    buildSavingInterestTaxPolicySnapshot,
    getSavingInterestTaxPolicySnapshot,
    isSavingInterestTaxPolicyActive,
    resolveSavingInterestTaxPolicy,
    toDateLike,
};
