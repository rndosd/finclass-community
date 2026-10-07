"use strict";

const admin = require("../firebaseAdminCompat");

const WRITE_BATCH_SIZE = 450;

const toWholeNumber = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
};

const toMetricNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const getDeskAssetValue = (desk = {}) => {
    const marketValue = toWholeNumber(desk.lastPurchasePrice);
    if (marketValue > 0) return marketValue;
    return toWholeNumber(desk.price);
};

function summarizeRealEstateAssetsByOwner(layout = {}) {
    const summaries = new Map();
    const groups = Array.isArray(layout?.groups) ? layout.groups : [];

    groups.forEach((group) => {
        const desks = Array.isArray(group?.desks) ? group.desks : [];
        desks.forEach((desk) => {
            if (
                !desk ||
                desk.isActive === false ||
                !desk.ownerId ||
                desk.ownerType === "classFund"
            ) return;

            const ownerId = String(desk.ownerId || "").trim();
            if (!ownerId) return;

            const current = summaries.get(ownerId) || {
                value: 0,
                count: 0,
            };
            current.value += getDeskAssetValue(desk);
            current.count += 1;
            summaries.set(ownerId, current);
        });
    });

    return summaries;
}

function getChangedRealEstateOwnerIds(beforeSummary, afterSummary) {
    const ownerIds = new Set([
        ...beforeSummary.keys(),
        ...afterSummary.keys(),
    ]);
    const changedOwnerIds = [];

    ownerIds.forEach((ownerId) => {
        const before = beforeSummary.get(ownerId) || { value: 0, count: 0 };
        const after = afterSummary.get(ownerId) || { value: 0, count: 0 };

        if (before.value !== after.value || before.count !== after.count) {
            changedOwnerIds.push(ownerId);
        }
    });

    return changedOwnerIds;
}

function calculateTotalNetWorthFromAssets(assets = {}) {
    const cash = toMetricNumber(assets.cash);
    const deposit = toMetricNumber(assets.deposit);
    const loan = toMetricNumber(assets.loan);
    const itemValue = toMetricNumber(assets.itemValue);
    const usdBalance = toMetricNumber(assets.usdBalance);
    const stockValue = toMetricNumber(assets.stockValue?.value);
    const realEstateValue = toMetricNumber(assets.realEstateValue);
    const conversionRate = Math.max(
        1,
        toMetricNumber(assets.stockValue?.lastConversionRate) || 10,
    );

    const classCurrencyTotal = cash + deposit - loan;
    const foreignAssetsLocal = Math.round(
        (usdBalance + stockValue) / conversionRate,
    );

    return classCurrencyTotal + foreignAssetsLocal + itemValue + realEstateValue;
}

function buildRealEstateAssetPatch(studentData = {}, summary = {}, options = {}) {
    const assets = studentData.assets || {};
    const nextValue = toWholeNumber(summary.value);
    const nextCount = toWholeNumber(summary.count);
    const currentValue = toMetricNumber(assets.realEstateValue);
    const storedNetWorth = Number(assets.totalNetWorth);
    const baseNetWorth = Number.isFinite(storedNetWorth)
        ? storedNetWorth
        : calculateTotalNetWorthFromAssets(assets);
    const nextTotalNetWorth = baseNetWorth - currentValue + nextValue;

    if (
        currentValue === nextValue &&
        toMetricNumber(assets.realEstateCount) === nextCount &&
        toMetricNumber(assets.totalNetWorth) === nextTotalNetWorth
    ) {
        return null;
    }

    return {
        "assets.realEstateValue": nextValue,
        "assets.realEstateCount": nextCount,
        "assets.totalNetWorth": nextTotalNetWorth,
        "assets.realEstateUpdatedAt": options.serverTimestamp ||
            admin.firestore.FieldValue.serverTimestamp(),
    };
}

async function commitStudentAssetOperations(db, operations) {
    for (let index = 0; index < operations.length; index += WRITE_BATCH_SIZE) {
        const batch = db.batch();
        const chunk = operations.slice(index, index + WRITE_BATCH_SIZE);
        chunk.forEach(({ ref, patch }) => batch.update(ref, patch));
        await batch.commit();
    }
}

async function syncRealEstateAssetsForClass(
    db,
    classId,
    beforeLayout = {},
    afterLayout = {},
    options = {},
) {
    const beforeSummary = summarizeRealEstateAssetsByOwner(beforeLayout);
    const afterSummary = summarizeRealEstateAssetsByOwner(afterLayout);
    const changedOwnerIds = getChangedRealEstateOwnerIds(
        beforeSummary,
        afterSummary,
    );

    if (changedOwnerIds.length === 0) {
        return {
            changedOwnerCount: 0,
            updatedStudentCount: 0,
            skippedMissingStudentCount: 0,
        };
    }

    const studentRefs = changedOwnerIds.map((ownerId) =>
        db.doc(`classes/${classId}/students/${ownerId}`),
    );
    const studentSnaps = await db.getAll(...studentRefs);
    const operations = [];
    let skippedMissingStudentCount = 0;

    studentSnaps.forEach((studentSnap, index) => {
        if (!studentSnap.exists) {
            skippedMissingStudentCount += 1;
            return;
        }

        const ownerId = changedOwnerIds[index];
        const patch = buildRealEstateAssetPatch(
            studentSnap.data() || {},
            afterSummary.get(ownerId) || { value: 0, count: 0 },
            options,
        );

        if (patch) {
            operations.push({ ref: studentSnap.ref, patch });
        }
    });

    if (!options.dryRun && operations.length > 0) {
        await commitStudentAssetOperations(db, operations);
    }

    return {
        changedOwnerCount: changedOwnerIds.length,
        updatedStudentCount: operations.length,
        skippedMissingStudentCount,
    };
}

module.exports = {
    buildRealEstateAssetPatch,
    calculateTotalNetWorthFromAssets,
    getChangedRealEstateOwnerIds,
    summarizeRealEstateAssetsByOwner,
    syncRealEstateAssetsForClass,
};
