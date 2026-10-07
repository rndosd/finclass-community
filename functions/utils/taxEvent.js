"use strict";

const TAX_EVENT_VERSION = 1;
const DEFAULT_TIME_ZONE = "Asia/Seoul";

const toNonNegativeMoney = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.round(parsed));
};

const toNullableRate = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(100, parsed));
};

const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value?.toDate === "function") {
        return toDate(value.toDate());
    }
    if (typeof value?.seconds === "number") {
        return new Date(
            value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6),
        );
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildTaxEventDateKey = (
    value = new Date(),
    timeZone = DEFAULT_TIME_ZONE,
) => {
    const date = toDate(value) || new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
};

const normalizeSourceDoc = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const collection = String(value.collection || "").trim();
    const id = String(value.id || "").trim();
    const path = String(value.path || "").trim();
    if (!collection && !id && !path) return null;
    return {
        ...(collection ? { collection } : {}),
        ...(id ? { id } : {}),
        ...(path ? { path } : {}),
    };
};

const buildTaxEventPayload = ({
    sourceKey,
    taxCategory = "withholding",
    taxType,
    amount,
    taxableAmount = 0,
    taxRate = null,
    dateKey,
    occurredAt,
    sourceDoc = null,
} = {}) => {
    const normalizedAmount = toNonNegativeMoney(amount);
    const normalizedSourceKey = String(sourceKey || "").trim();
    if (!normalizedSourceKey || !(normalizedAmount > 0)) return null;
    const normalizedSourceDoc = normalizeSourceDoc(sourceDoc);

    return {
        version: TAX_EVENT_VERSION,
        sourceKey: normalizedSourceKey,
        taxCategory: String(taxCategory || "withholding").trim() || "withholding",
        taxType:
            String(taxType || `${normalizedSourceKey}_withholding`).trim() ||
            `${normalizedSourceKey}_withholding`,
        amount: normalizedAmount,
        taxableAmount: toNonNegativeMoney(taxableAmount),
        taxRate: toNullableRate(taxRate),
        dateKey: String(dateKey || buildTaxEventDateKey(occurredAt)).trim(),
        periodSettlementId: null,
        periodSettledAt: null,
        voided: false,
        ...(normalizedSourceDoc ? { sourceDoc: normalizedSourceDoc } : {}),
    };
};

const buildTaxEventFromIncomeTax = ({
    incomeTax,
    dateKey,
    occurredAt,
    sourceDoc,
} = {}) => {
    if (!incomeTax || typeof incomeTax !== "object") return null;
    return buildTaxEventPayload({
        sourceKey: incomeTax.sourceKey,
        taxCategory: "withholding",
        taxType: `${String(incomeTax.sourceKey || "income").trim()}_withholding`,
        amount: incomeTax.withheldAmount,
        taxableAmount: incomeTax.taxableAmount,
        taxRate: incomeTax.taxRate,
        dateKey,
        occurredAt,
        sourceDoc,
    });
};

const normalizeTaxEvent = (taxEvent = {}) => {
    if (!taxEvent || typeof taxEvent !== "object") return null;
    const normalized = buildTaxEventPayload({
        ...taxEvent,
        sourceDoc: taxEvent.sourceDoc,
    });
    if (!normalized) return null;
    return {
        ...normalized,
        periodSettlementId:
            String(taxEvent.periodSettlementId || "").trim() || null,
        periodSettledAt: taxEvent.periodSettledAt || null,
        voided: taxEvent.voided === true,
    };
};

const isPeriodSettlementEligible = (taxEvent = {}) => {
    const normalized = normalizeTaxEvent(taxEvent);
    return Boolean(
        normalized &&
        normalized.amount > 0 &&
        !normalized.voided &&
        !normalized.periodSettlementId,
    );
};

const sanitizeIdPart = (value) =>
    String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

const buildPeriodTaxIncomeId = ({
    settlementId,
    taxCategory,
    sourceKey,
} = {}) => {
    const id = [
        "period_tax_income",
        settlementId,
        taxCategory,
        sourceKey,
    ]
        .map(sanitizeIdPart)
        .filter(Boolean)
        .join("_");
    if (!settlementId || !taxCategory || !sourceKey || !id) {
        throw new Error("period tax income id requires settlementId, taxCategory, and sourceKey");
    }
    return id;
};

module.exports = {
    TAX_EVENT_VERSION,
    DEFAULT_TIME_ZONE,
    buildPeriodTaxIncomeId,
    buildTaxEventDateKey,
    buildTaxEventFromIncomeTax,
    buildTaxEventPayload,
    isPeriodSettlementEligible,
    normalizeTaxEvent,
    toNonNegativeMoney,
};
