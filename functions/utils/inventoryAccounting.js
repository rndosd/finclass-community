"use strict";

const PURCHASE_LIKE_ACQUISITION_TYPES = new Set(["purchase", "gift"]);
const ARCADE_REWARD_ACQUISITION_TYPES = new Set([
    "arcade_reward",
    "lotto_reward",
]);
const ONE_HOUR_MS = 60 * 60 * 1000;

function toFiniteNonNegativeNumber(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0
        ? numericValue
        : fallback;
}

function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function toPositiveIntegerOrNull(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return null;
    }

    return Math.floor(numericValue);
}

function toMillis(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value?.toMillis === "function") {
        const millis = Number(value.toMillis());
        return Number.isFinite(millis) ? millis : null;
    }

    if (
        value &&
        typeof value === "object" &&
        Number.isFinite(Number(value.seconds))
    ) {
        const seconds = Number(value.seconds);
        const nanoseconds = Number(value.nanoseconds || 0);
        return (seconds * 1000) + Math.floor(nanoseconds / 1000000);
    }

    if (value instanceof Date) {
        const millis = value.getTime();
        return Number.isFinite(millis) ? millis : null;
    }

    const millis = Number(value);
    return Number.isFinite(millis) ? millis : null;
}

function resolveAcquisitionExpiryMillis(acquisition = {}) {
    const explicitExpiryMillis = toMillis(acquisition?.expiresAtMs);
    if (explicitExpiryMillis && explicitExpiryMillis > 0) {
        return explicitExpiryMillis;
    }

    const expiresAtMillis = toMillis(acquisition?.expiresAt);
    if (expiresAtMillis && expiresAtMillis > 0) {
        return expiresAtMillis;
    }

    const validityHours = toPositiveIntegerOrNull(acquisition?.validityHours);
    if (!validityHours) {
        return null;
    }

    const acquiredAtMillis = toMillis(acquisition?.acquiredAt);
    if (!acquiredAtMillis) {
        return null;
    }

    return acquiredAtMillis + (validityHours * ONE_HOUR_MS);
}

function isTrackedInventoryAcquisitionExpired(acquisition = {}, options = {}) {
    const nowMs = Number.isFinite(Number(options?.nowMs))
        ? Number(options.nowMs)
        : Date.now();
    const expiresAtMs = resolveAcquisitionExpiryMillis(acquisition);

    return expiresAtMs !== null && expiresAtMs <= nowMs;
}

function isTicketInventoryItem(inventoryData = {}) {
    return (
        inventoryData?.functionTag === "arcade_ticket" ||
        inventoryData?.itemType === "ticket"
    );
}

function resolveAcquisitionUnitValue(
    acquisition = {},
    inventoryData = {},
    fallbackUnitValue = null,
) {
    const candidates = [
        acquisition?.unitValue,
        acquisition?.price,
        inventoryData?.price,
        fallbackUnitValue,
    ];

    for (const candidate of candidates) {
        const numericValue = Number(candidate);
        if (Number.isFinite(numericValue) && numericValue >= 0) {
            return numericValue;
        }
    }

    return 0;
}

function inferAssetValueApplied(acquisition = {}) {
    if (typeof acquisition?.assetValueApplied === "boolean") {
        return acquisition.assetValueApplied;
    }

    const type = String(acquisition?.type || "").trim();
    if (PURCHASE_LIKE_ACQUISITION_TYPES.has(type)) {
        return true;
    }

    if (ARCADE_REWARD_ACQUISITION_TYPES.has(type)) {
        // Legacy arcade rewards were stored without an item-value increment.
        // Treat missing flags as "not yet applied" until a repair/recalc runs.
        return false;
    }

    return true;
}

function inferTicketCountApplied(acquisition = {}, inventoryData = {}) {
    if (!isTicketInventoryItem(inventoryData)) {
        return false;
    }

    if (typeof acquisition?.ticketCountApplied === "boolean") {
        return acquisition.ticketCountApplied;
    }

    const type = String(acquisition?.type || "").trim();
    if (PURCHASE_LIKE_ACQUISITION_TYPES.has(type)) {
        return true;
    }

    if (ARCADE_REWARD_ACQUISITION_TYPES.has(type)) {
        return false;
    }

    return true;
}

function buildTrackedInventoryAcquisition(input = {}) {
    const quantity = Math.max(0, Math.floor(Number(input?.quantity || 0)));
    const validityHours = toPositiveIntegerOrNull(input?.validityHours);
    const expiresAtMs = resolveAcquisitionExpiryMillis({
        ...input,
        ...(validityHours ? { validityHours } : {}),
    });
    const next = {
        ...input,
        quantity,
        unitValue: toFiniteNonNegativeNumber(input?.unitValue, 0),
        assetValueApplied: input?.assetValueApplied === true,
        ticketCountApplied: input?.ticketCountApplied === true,
    };

    if (validityHours) {
        next.validityHours = validityHours;
    } else {
        delete next.validityHours;
    }

    if (expiresAtMs) {
        next.expiresAtMs = Math.floor(expiresAtMs);
    } else {
        delete next.expiresAtMs;
    }

    if (next.quantity <= 0) {
        next.quantity = 0;
    }

    return next;
}

function normalizeAcquisitionForAccounting(
    acquisition = {},
    inventoryData = {},
    options = {},
) {
    const acquisitionType = String(acquisition?.type || "").trim();
    const normalizedAcquisition = { ...acquisition };
    const sourcePurchaseId =
        acquisition?.sourcePurchaseId ||
        (acquisitionType === "gift" ? acquisition?.purchaseId || null : null);

    if (
        acquisitionType === "gift" &&
        Object.prototype.hasOwnProperty.call(normalizedAcquisition, "purchaseId")
    ) {
        delete normalizedAcquisition.purchaseId;
    }

    return buildTrackedInventoryAcquisition({
        ...normalizedAcquisition,
        ...(sourcePurchaseId ? { sourcePurchaseId } : {}),
        unitValue: resolveAcquisitionUnitValue(
            acquisition,
            inventoryData,
            options?.fallbackUnitValue,
        ),
        assetValueApplied: inferAssetValueApplied(acquisition),
        ticketCountApplied: inferTicketCountApplied(acquisition, inventoryData),
    });
}

function inferFallbackAcquisitionType(inventoryData = {}) {
    const obtainedFrom = String(inventoryData?.obtainedFrom || "").trim();
    if (obtainedFrom === "lotto") return "lotto_reward";
    if (obtainedFrom) return "arcade_reward";
    return "legacy_inventory";
}

function compareTrackedInventoryAcquisitions(a = {}, b = {}) {
    const aExpiryMs = resolveAcquisitionExpiryMillis(a);
    const bExpiryMs = resolveAcquisitionExpiryMillis(b);

    if (aExpiryMs !== null && bExpiryMs !== null && aExpiryMs !== bExpiryMs) {
        return aExpiryMs - bExpiryMs;
    }

    if (aExpiryMs !== null) {
        return -1;
    }

    if (bExpiryMs !== null) {
        return 1;
    }

    const aAcquiredAtMs = toMillis(a?.acquiredAt);
    const bAcquiredAtMs = toMillis(b?.acquiredAt);

    if (
        aAcquiredAtMs !== null &&
        bAcquiredAtMs !== null &&
        aAcquiredAtMs !== bAcquiredAtMs
    ) {
        return aAcquiredAtMs - bAcquiredAtMs;
    }

    if (aAcquiredAtMs !== null) {
        return -1;
    }

    if (bAcquiredAtMs !== null) {
        return 1;
    }

    return 0;
}

function sortTrackedInventoryAcquisitions(acquisitions = []) {
    return [...(Array.isArray(acquisitions) ? acquisitions : [])].sort(
        compareTrackedInventoryAcquisitions,
    );
}

function consumeTrackedInventoryAcquisitions(
    acquisitions,
    quantity,
    inventoryData = {},
    options = {},
) {
    const normalizedAcquisitions = sortTrackedInventoryAcquisitions(acquisitions);
    let remainingQuantity = Math.max(0, Math.floor(Number(quantity || 0)));
    const updatedAcquisitions = [];
    const consumptionDetails = [];
    let totalAssetValueToRemove = 0;
    let totalTicketCountToRemove = 0;
    let expiredQuantity = 0;
    const skipExpired = options?.skipExpired === true;
    const nowMs = Number.isFinite(Number(options?.nowMs))
        ? Number(options.nowMs)
        : Date.now();

    for (const acquisition of normalizedAcquisitions) {
        const normalized = normalizeAcquisitionForAccounting(
            acquisition,
            inventoryData,
            options,
        );
        const available = normalized.quantity;

        if (available <= 0) {
            continue;
        }

        if (
            skipExpired &&
            isTrackedInventoryAcquisitionExpired(normalized, { nowMs })
        ) {
            expiredQuantity += available;
            updatedAcquisitions.push(normalized);
            continue;
        }

        if (remainingQuantity <= 0) {
            updatedAcquisitions.push(normalized);
            continue;
        }

        const take = Math.min(remainingQuantity, available);
        consumptionDetails.push({
            sourceType: normalized.type || "purchase",
            fromName: normalized.senderName || normalized.fromName || null,
            message: normalized.message || null,
            obtainedFrom: normalized.obtainedFrom || inventoryData?.obtainedFrom || null,
            sourcePurchaseId:
                normalized.sourcePurchaseId || normalized.purchaseId || null,
            randomBoxOpenId: normalized.randomBoxOpenId || null,
            boxItemId: normalized.boxItemId || null,
            boxItemName: normalized.boxItemName || null,
            grantedQuantity: Math.max(
                1,
                Math.floor(Number(normalized.grantedQuantity || available || 1)),
            ),
            remainingQuantityBeforeUse: available,
            quantity: take,
            unitValue: normalized.unitValue,
            assetValueApplied: normalized.assetValueApplied,
            ticketCountApplied: normalized.ticketCountApplied,
        });

        if (normalized.assetValueApplied) {
            totalAssetValueToRemove += normalized.unitValue * take;
        }
        if (normalized.ticketCountApplied) {
            totalTicketCountToRemove += take;
        }

        remainingQuantity -= take;
        const remainingFromAcquisition = available - take;
        if (remainingFromAcquisition > 0) {
            updatedAcquisitions.push({
                ...normalized,
                quantity: remainingFromAcquisition,
            });
        }
    }

    return {
        updatedAcquisitions,
        consumptionDetails,
        remainingQuantity,
        totalAssetValueToRemove: roundCurrency(totalAssetValueToRemove),
        totalTicketCountToRemove,
        expiredQuantity,
    };
}

function consumeExpiredTrackedInventoryAcquisitions(
    acquisitions,
    quantity,
    inventoryData = {},
    options = {},
) {
    const normalizedAcquisitions = sortTrackedInventoryAcquisitions(acquisitions);
    let remainingQuantity = Math.max(0, Math.floor(Number(quantity || 0)));
    const updatedAcquisitions = [];
    const consumptionDetails = [];
    let totalAssetValueToRemove = 0;
    let totalTicketCountToRemove = 0;
    let expiredQuantity = 0;
    const nowMs = Number.isFinite(Number(options?.nowMs))
        ? Number(options.nowMs)
        : Date.now();

    for (const acquisition of normalizedAcquisitions) {
        const normalized = normalizeAcquisitionForAccounting(
            acquisition,
            inventoryData,
            options,
        );
        const available = normalized.quantity;

        if (available <= 0) {
            continue;
        }

        if (!isTrackedInventoryAcquisitionExpired(normalized, { nowMs })) {
            updatedAcquisitions.push(normalized);
            continue;
        }

        expiredQuantity += available;

        if (remainingQuantity <= 0) {
            updatedAcquisitions.push(normalized);
            continue;
        }

        const take = Math.min(remainingQuantity, available);
        consumptionDetails.push({
            sourceType: normalized.type || "purchase",
            fromName: normalized.senderName || normalized.fromName || null,
            message: normalized.message || null,
            obtainedFrom: normalized.obtainedFrom || inventoryData?.obtainedFrom || null,
            sourcePurchaseId:
                normalized.sourcePurchaseId || normalized.purchaseId || null,
            randomBoxOpenId: normalized.randomBoxOpenId || null,
            boxItemId: normalized.boxItemId || null,
            boxItemName: normalized.boxItemName || null,
            grantedQuantity: Math.max(
                1,
                Math.floor(Number(normalized.grantedQuantity || available || 1)),
            ),
            remainingQuantityBeforeUse: available,
            quantity: take,
            unitValue: normalized.unitValue,
            assetValueApplied: normalized.assetValueApplied,
            ticketCountApplied: normalized.ticketCountApplied,
        });

        if (normalized.assetValueApplied) {
            totalAssetValueToRemove += normalized.unitValue * take;
        }
        if (normalized.ticketCountApplied) {
            totalTicketCountToRemove += take;
        }

        remainingQuantity -= take;
        const remainingFromAcquisition = available - take;
        if (remainingFromAcquisition > 0) {
            updatedAcquisitions.push({
                ...normalized,
                quantity: remainingFromAcquisition,
            });
        }
    }

    return {
        updatedAcquisitions,
        consumptionDetails,
        remainingQuantity,
        totalAssetValueToRemove: roundCurrency(totalAssetValueToRemove),
        totalTicketCountToRemove,
        expiredQuantity,
    };
}

function recalculateInventoryHoldingState(
    inventoryData = {},
    options = {},
) {
    const quantity = Math.max(0, Math.floor(Number(inventoryData?.quantity || 0)));
    const rawAcquisitions = Array.isArray(inventoryData?.acquisitions)
        ? inventoryData.acquisitions
        : [];
    const normalizedAcquisitions = [];
    const isTicket = isTicketInventoryItem({
        ...inventoryData,
        itemType: options?.itemType ?? inventoryData?.itemType,
        functionTag: options?.functionTag ?? inventoryData?.functionTag,
    });

    let quantityCovered = 0;
    let totalItemValue = 0;

    for (const acquisition of rawAcquisitions) {
        const available = Math.max(0, Math.floor(Number(acquisition?.quantity || 0)));
        if (available <= 0) {
            continue;
        }

        const unitValue = resolveAcquisitionUnitValue(
            acquisition,
            inventoryData,
            options?.fallbackUnitValue,
        );
        quantityCovered += available;
        totalItemValue += unitValue * available;
        normalizedAcquisitions.push(
            buildTrackedInventoryAcquisition({
                ...acquisition,
                type: acquisition?.type || inferFallbackAcquisitionType(inventoryData),
                quantity: available,
                unitValue,
                assetValueApplied: unitValue > 0,
                ticketCountApplied: isTicket,
            }),
        );
    }

    if (quantityCovered < quantity) {
        const remainingQuantity = quantity - quantityCovered;
        const unitValue = resolveAcquisitionUnitValue(
            {},
            inventoryData,
            options?.fallbackUnitValue,
        );
        totalItemValue += unitValue * remainingQuantity;
        normalizedAcquisitions.push(
            buildTrackedInventoryAcquisition({
                type: inferFallbackAcquisitionType(inventoryData),
                quantity: remainingQuantity,
                acquiredAt:
                    inventoryData?.lastAcquiredDate ||
                    inventoryData?.createdAt ||
                    null,
                obtainedFrom: inventoryData?.obtainedFrom || null,
                unitValue,
                assetValueApplied: unitValue > 0,
                ticketCountApplied: isTicket,
            }),
        );
    }

    return {
        normalizedAcquisitions,
        totalItemValue: roundCurrency(totalItemValue),
        totalTicketCount: isTicket ? quantity : 0,
    };
}

function buildInventoryExpiryIndexState(
    inventoryData = {},
    options = {},
) {
    const nowMs = Number.isFinite(Number(options?.nowMs))
        ? Number(options.nowMs)
        : Date.now();
    const rawAcquisitions = Array.isArray(options?.acquisitions)
        ? options.acquisitions
        : Array.isArray(inventoryData?.acquisitions)
            ? inventoryData.acquisitions
            : [];

    let nextExpiryAtMs = null;

    for (const acquisition of rawAcquisitions) {
        const normalized = normalizeAcquisitionForAccounting(
            acquisition,
            inventoryData,
            options,
        );
        const quantity = Math.max(0, Math.floor(Number(normalized.quantity || 0)));
        const expiryMs = resolveAcquisitionExpiryMillis(normalized);

        if (
            quantity <= 0 ||
            normalized.assetValueApplied !== true ||
            !expiryMs ||
            expiryMs <= 0 ||
            toFiniteNonNegativeNumber(normalized.unitValue) <= 0
        ) {
            continue;
        }

        if (nextExpiryAtMs === null || expiryMs < nextExpiryAtMs) {
            nextExpiryAtMs = expiryMs;
        }
    }

    return {
        hasUnsettledExpiringAsset:
            nextExpiryAtMs !== null && nextExpiryAtMs <= nowMs,
        hasFutureExpiringAsset:
            nextExpiryAtMs !== null && nextExpiryAtMs > nowMs,
        hasExpiringAsset: nextExpiryAtMs !== null,
        nextExpiryAtMs,
    };
}

module.exports = {
    buildInventoryExpiryIndexState,
    buildTrackedInventoryAcquisition,
    consumeExpiredTrackedInventoryAcquisitions,
    consumeTrackedInventoryAcquisitions,
    inferAssetValueApplied,
    inferTicketCountApplied,
    isTicketInventoryItem,
    isTrackedInventoryAcquisitionExpired,
    normalizeAcquisitionForAccounting,
    recalculateInventoryHoldingState,
    resolveAcquisitionExpiryMillis,
    resolveAcquisitionUnitValue,
    roundCurrency,
    sortTrackedInventoryAcquisitions,
};
