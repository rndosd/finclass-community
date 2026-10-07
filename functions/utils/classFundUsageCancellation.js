"use strict";

const CANCELLATION_STATUS_CANCELLED = "cancelled";
const CANCELLATION_STATUS_REVERSAL = "reversal";

const toMoneyAmount = (value) => {
    const amount = Math.round(Number(value));
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

const getClassFundUsageCancellationPolicy = (usage = {}) => {
    if (usage.cancellationStatus === CANCELLATION_STATUS_CANCELLED) {
        return { allowed: false, reason: "이미 취소된 내역입니다." };
    }
    if (usage.cancellationStatus === CANCELLATION_STATUS_REVERSAL ||
        usage.reversalOfUsageId) {
        return { allowed: false, reason: "취소 복구 내역은 다시 취소할 수 없습니다." };
    }
    if (String(usage.direction || "out") === "in") {
        return { allowed: false, reason: "입금·매각 내역은 현재 취소할 수 없습니다." };
    }
    if (usage.settlementStatus === "not_applicable" ||
        usage.usageKind === "asset_purchase" ||
        usage.usageKind === "asset_sale") {
        return {
            allowed: false,
            reason: "주식·부동산 같은 자산 거래는 해당 거래 화면에서 정정해야 합니다.",
        };
    }
    if (usage.source === "store_pos" ||
        usage.relatedRealEstateLedgerId ||
        usage.relatedTradeId ||
        (Array.isArray(usage.storeRedemptionIds) && usage.storeRedemptionIds.length)) {
        return {
            allowed: false,
            reason: "상품·자산 상태가 연결된 거래는 현재 장부에서 취소할 수 없습니다.",
        };
    }
    if (usage.source === "class_fund_payout" && !usage.relatedPayoutId) {
        return { allowed: false, reason: "연결된 송금 정보를 찾을 수 없습니다." };
    }
    if (usage.settlementId) {
        return {
            allowed: false,
            reason: "여러 건이 함께 반영된 기존 내역은 개별 취소할 수 없습니다.",
        };
    }
    if (usage.source && !["class_fund_usage", "class_fund_payout"].includes(
        usage.source,
    )) {
        return { allowed: false, reason: "연결된 원거래 화면에서 정정해 주세요." };
    }
    if (toMoneyAmount(usage.amount) <= 0) {
        return { allowed: false, reason: "취소할 금액 정보가 올바르지 않습니다." };
    }

    return {
        allowed: true,
        kind: usage.relatedPayoutId ? "bank_payout" : "cash_expense",
    };
};

const buildClassFundUsageCancellationAccounting = (usage = {}) => {
    const amount = toMoneyAmount(usage.amount);
    const isPending = usage.settlementStatus === "pending";
    return {
        cashDelta: amount,
        spentTotalDelta: -amount,
        settledExpenseTotalDelta: isPending ? 0 : -amount,
        pendingSettlementExpenseTotalDelta: isPending ? -amount : 0,
        totalValueDelta: amount,
    };
};

module.exports = {
    CANCELLATION_STATUS_CANCELLED,
    CANCELLATION_STATUS_REVERSAL,
    buildClassFundUsageCancellationAccounting,
    getClassFundUsageCancellationPolicy,
};
