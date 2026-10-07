export const FUND_CHANNEL_OPTIONS = Object.freeze([
  { key: "manualExpense", label: "수동 집행", expenseOnly: true },
  { key: "storePurchase", label: "상점", expenseOnly: true },
  { key: "bankPayout", label: "은행 지급", expenseOnly: true },
  { key: "realEstatePurchase", label: "부동산 구매", expenseOnly: true },
  { key: "stockInvestment", label: "주식 운용", investmentOnly: true },
]);

const CHANNELS_BY_KEY = new Map(
  FUND_CHANNEL_OPTIONS.map((channel) => [channel.key, channel]),
);

export const isAssetOperationFundType = (fundType) =>
  fundType === "investment" || fundType === "pension";

export const getDefaultFundChannels = (fundType = "general") =>
  fundType === "investment"
    ? {
        manualExpense: false,
        storePurchase: false,
        bankPayout: false,
        realEstatePurchase: false,
        stockInvestment: true,
      }
    : fundType === "pension"
      ? {
          manualExpense: false,
          storePurchase: false,
          bankPayout: false,
          realEstatePurchase: true,
          stockInvestment: true,
        }
      : {
        manualExpense: true,
        storePurchase: false,
        bankPayout: false,
        realEstatePurchase: false,
        stockInvestment: false,
      };

const isChannelEnabled = (fund, channel) => {
  if (fund?.allowedChannels && typeof fund.allowedChannels === "object") {
    return fund.allowedChannels[channel] === true;
  }
  return getDefaultFundChannels(fund?.fundType)[channel] === true;
};

export const getFundChannelLabel = (channel) =>
  CHANNELS_BY_KEY.get(channel)?.label || "알 수 없는 사용처";

export const getFundChannelAccess = (fund, channel, options = {}) => {
  const definition = CHANNELS_BY_KEY.get(channel);
  const cashBalance = Number(fund?.cashBalance || 0);
  const amount = Math.max(0, Number(options.amount || 0));

  const base = {
    allowed: false,
    channel,
    label: getFundChannelLabel(channel),
    fund: fund || null,
    cashBalance,
    code: "unknown_channel",
    reason: "지원하지 않는 기금 사용처입니다.",
  };

  if (!definition) return base;
  if (!fund) {
    return {
      ...base,
      code: "fund_required",
      reason: "사용할 기금을 먼저 선택해 주세요.",
    };
  }
  if (fund.status && fund.status !== "active") {
    return {
      ...base,
      code: "fund_inactive",
      reason: "운영 중인 기금만 사용할 수 있습니다.",
    };
  }
  if (definition.expenseOnly && fund.fundType === "investment") {
    return {
      ...base,
      code: "fund_type_mismatch",
      reason: "투자 기금은 일반 지출에 사용할 수 없습니다.",
    };
  }
  if (
    fund.fundType === "pension" &&
    channel !== "stockInvestment" &&
    channel !== "realEstatePurchase"
  ) {
    return {
      ...base,
      code: "fund_type_mismatch",
      reason: "연금 기금은 주식 또는 부동산 운용에만 사용할 수 있습니다.",
    };
  }
  if (!isChannelEnabled(fund, channel)) {
    return {
      ...base,
      code: "channel_not_allowed",
      reason: `이 기금은 ${definition.label} 사용이 허용되지 않았습니다.`,
    };
  }
  if (amount > cashBalance) {
    return {
      ...base,
      code: "insufficient_balance",
      reason: "기금 잔액이 부족합니다.",
    };
  }

  return {
    ...base,
    allowed: true,
    code: "allowed",
    reason: "",
  };
};

export const getAllowedFundChannelOptions = (fund) =>
  FUND_CHANNEL_OPTIONS.filter(
    (option) => getFundChannelAccess(fund, option.key).allowed,
  );

export const getFundsAllowedForChannel = (funds, channel) =>
  (Array.isArray(funds) ? funds : []).filter(
    (fund) => getFundChannelAccess(fund, channel).allowed,
  );
