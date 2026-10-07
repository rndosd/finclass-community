"use strict";

const { Timestamp } = require("firebase-admin/firestore");
const STORE_ITEM_VALIDITY_HOUR_MS = 60 * 60 * 1000;

const normalizeStoreItemValidityHours = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return null;
    }

    return Math.floor(numericValue);
};

const buildStoreItemExpirationMeta = (
    itemData = {},
    acquiredAtMs = Date.now(),
) => {
    const validityHours = normalizeStoreItemValidityHours(itemData?.validityHours);
    if (!validityHours) {
        return {};
    }

    return {
        validityHours,
        expiresAtMs: acquiredAtMs + (validityHours * STORE_ITEM_VALIDITY_HOUR_MS),
    };
};

const toJsDate = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value?.seconds === "number") {
        const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
        return new Date(value.seconds * 1000 + Math.floor(nanos / 1000000));
    }
    if (typeof value?._seconds === "number") {
        const nanos = typeof value?._nanoseconds === "number" ? value._nanoseconds : 0;
        return new Date(value._seconds * 1000 + Math.floor(nanos / 1000000));
    }
    if (value instanceof Date) return value;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolveTimeSalePricing = (itemData = {}, now = new Date()) => {
    const basePrice = Math.max(0, Number(itemData?.price) || 0);
    const rawSalePrice = Number(itemData?.timeSale?.salePrice);
    const roundedSalePrice = Number.isFinite(rawSalePrice)
        ? Math.round(rawSalePrice)
        : null;
    const startAt = toJsDate(itemData?.timeSale?.startAt);
    const endAt = toJsDate(itemData?.timeSale?.endAt);
    const hasValidSchedule =
        roundedSalePrice !== null &&
        roundedSalePrice > 0 &&
        roundedSalePrice < basePrice &&
        startAt &&
        endAt &&
        startAt.getTime() < endAt.getTime();

    const saleApplied =
        hasValidSchedule &&
        now.getTime() >= startAt.getTime() &&
        now.getTime() < endAt.getTime();

    const salePrice = hasValidSchedule ? roundedSalePrice : null;
    const discountPercent =
        hasValidSchedule && basePrice > 0
            ? Math.max(0, Math.floor(((basePrice - roundedSalePrice) / basePrice) * 100))
            : 0;

    return {
        basePrice,
        effectivePrice: saleApplied && salePrice !== null ? salePrice : basePrice,
        saleApplied,
        salePrice,
        startAt,
        endAt,
        discountPercent,
    };
};

const buildTimeSaleRecordFields = (taxInfo = {}) => {
    const fields = {
        originalPricePerItem: Number(taxInfo?.originalPrice || taxInfo?.totalAmount || 0),
        timeSaleApplied: taxInfo?.saleApplied === true,
    };

    if (taxInfo?.saleApplied) {
        fields.timeSaleSalePrice = Number(taxInfo?.salePrice || 0);
        fields.timeSaleDiscountPercent = Number(taxInfo?.discountPercent || 0);

        if (taxInfo?.timeSaleStartAt) {
            fields.timeSaleStartAt = Timestamp.fromDate(
                taxInfo.timeSaleStartAt,
            );
        }

        if (taxInfo?.timeSaleEndAt) {
            fields.timeSaleEndAt = Timestamp.fromDate(
                taxInfo.timeSaleEndAt,
            );
        }
    }

    return fields;
};

/**
 */
const calculateItemTaxInfo = (itemData, classSettings = {}, now = new Date()) => {
    const pricing = resolveTimeSalePricing(itemData, now);
    const itemPrice = pricing.effectivePrice;
    const defaultTaxRate = Number(classSettings?.taxRate ?? 10);

    const isExempt =
    itemData?.isTaxExempt === true ||
    (itemData?.customTaxRate !== undefined &&
      Number(itemData.customTaxRate) === 0);

    let effectiveTaxRate = isExempt
        ? 0
        : (itemData?.customTaxRate ?? defaultTaxRate);

    if (effectiveTaxRate === 0) {
        return {
            baseAmount: itemPrice,
            taxAmount: 0,
            totalAmount: itemPrice,
            taxRate: 0,
            isTaxable: false,
            originalPrice: pricing.basePrice,
            saleApplied: pricing.saleApplied,
            salePrice: pricing.salePrice,
            timeSaleStartAt: pricing.startAt,
            timeSaleEndAt: pricing.endAt,
            discountPercent: pricing.discountPercent,
        };
    }

    const baseAmount =
    Math.round((itemPrice / (1 + effectiveTaxRate / 100)) * 100) / 100;
    const taxAmount = Math.round((itemPrice - baseAmount) * 100) / 100;

    return {
        baseAmount,
        taxAmount,
        totalAmount: itemPrice,
        taxRate: effectiveTaxRate,
        isTaxable: true,
        originalPrice: pricing.basePrice,
        saleApplied: pricing.saleApplied,
        salePrice: pricing.salePrice,
        timeSaleStartAt: pricing.startAt,
        timeSaleEndAt: pricing.endAt,
        discountPercent: pricing.discountPercent,
    };
};


module.exports = { calculateItemTaxInfo, resolveTimeSalePricing, buildTimeSaleRecordFields, buildStoreItemExpirationMeta };
