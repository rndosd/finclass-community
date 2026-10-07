"use strict";

const FUND_CHANNEL_OPTIONS = Object.freeze([
    { key: "manualExpense", label: "수동 집행", expenseOnly: true },
    { key: "storePurchase", label: "상점", expenseOnly: true },
    { key: "bankPayout", label: "은행 지급", expenseOnly: true },
    { key: "realEstatePurchase", label: "부동산 구매", expenseOnly: true },
    { key: "stockInvestment", label: "주식 운용", investmentOnly: true },
]);

const CHANNELS_BY_KEY = new Map(
    FUND_CHANNEL_OPTIONS.map((channel) => [channel.key, channel]),
);

const isAssetOperationFundType = (fundType) =>
    fundType === "investment" || fundType === "pension";

const getDefaultFundChannels = (fundType = "general") =>
    fundType === "investment" ?
        {
            manualExpense: false,
            storePurchase: false,
            bankPayout: false,
            realEstatePurchase: false,
            stockInvestment: true,
        } : fundType === "pension" ?
        {
            manualExpense: false,
            storePurchase: false,
            bankPayout: false,
            realEstatePurchase: true,
            stockInvestment: true,
        } :
        {
            manualExpense: true,
            storePurchase: false,
            bankPayout: false,
            realEstatePurchase: false,
            stockInvestment: false,
        };

const normalizeUsageChannel = (value) => {
    const channel = String(value || "").trim().slice(0, 40);
    return CHANNELS_BY_KEY.has(channel) ? channel : "manualExpense";
};

const normalizeAllowedChannels = (raw = {}, fundType = "general") => {
    const source = raw && typeof raw === "object" ? raw : {};
    if (fundType === "investment") {
        return {
            storePurchase: false,
            bankPayout: false,
            realEstatePurchase: false,
            stockInvestment: true,
            manualExpense: source.manualExpense === true,
        };
    }

    if (fundType === "pension") {
        return {
            storePurchase: false,
            bankPayout: false,
            realEstatePurchase: source.realEstatePurchase !== false,
            stockInvestment: source.stockInvestment !== false,
            manualExpense: false,
        };
    }

    return {
        storePurchase: source.storePurchase === true,
        bankPayout: source.bankPayout === true,
        realEstatePurchase: source.realEstatePurchase === true,
        stockInvestment: source.stockInvestment === true,
        manualExpense: source.manualExpense !== false,
    };
};

const getClassFundChannelAccess = (fund, channel, options = {}) => {
    const normalizedChannel = String(channel || "").trim().slice(0, 40);
    const definition = CHANNELS_BY_KEY.get(normalizedChannel);
    const cashBalance = Number(fund?.cashBalance || 0);
    const amount = Math.max(0, Number(options.amount || 0));
    const denied = (code, reason) => ({
        allowed: false,
        code,
        reason,
        channel: normalizedChannel,
        cashBalance,
    });

    if (!definition) {
        return denied("unknown_channel", "지원하지 않는 기금 사용처입니다.");
    }
    if (!fund) return denied("fund_required", "기금 정보를 찾을 수 없습니다.");
    if (fund.status && fund.status !== "active") {
        return denied("fund_inactive", "운영 중인 기금만 사용할 수 있습니다.");
    }
    if (definition.expenseOnly && fund.fundType === "investment") {
        return denied(
            "fund_type_mismatch",
            "투자 기금은 일반 지출에 사용할 수 없습니다.",
        );
    }
    if (
        fund.fundType === "pension" &&
        normalizedChannel !== "stockInvestment" &&
        normalizedChannel !== "realEstatePurchase"
    ) {
        return denied(
            "fund_type_mismatch",
            "연금 기금은 주식 또는 부동산 운용에만 사용할 수 있습니다.",
        );
    }

    const allowedChannels = fund.allowedChannels &&
        typeof fund.allowedChannels === "object" ?
        fund.allowedChannels :
        getDefaultFundChannels(fund.fundType);
    if (allowedChannels[normalizedChannel] !== true) {
        return denied(
            "channel_not_allowed",
            `이 기금은 ${definition.label} 사용이 허용되지 않았습니다.`,
        );
    }
    if (amount > cashBalance) {
        return denied("insufficient_balance", "기금 잔액이 부족합니다.");
    }

    return {
        allowed: true,
        code: "allowed",
        reason: "",
        channel: normalizedChannel,
        cashBalance,
    };
};

module.exports = {
    FUND_CHANNEL_OPTIONS,
    getClassFundChannelAccess,
    getDefaultFundChannels,
    isAssetOperationFundType,
    normalizeAllowedChannels,
    normalizeUsageChannel,
};
