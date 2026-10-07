const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const clampNumber = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
};

const hasText = (value) => String(value || "").trim().length > 0;

export const hasMoneyReward = (prize = {}) => {
  if (prize?.moneyEnabled === true) return true;
  if (prize?.moneyEnabled === false) return false;
  if (prize?.type === "money" || prize?.type === "bundle") return true;
  if (prize?.type === "item") return false;
  return (
    hasOwn(prize, "amount") ||
    hasOwn(prize, "multiplier") ||
    hasText(prize?.rewardMode)
  );
};

export const hasItemReward = (prize = {}) => {
  if (prize?.itemEnabled === true) return true;
  if (prize?.itemEnabled === false) return false;
  if (prize?.type === "item" || prize?.type === "bundle") return true;
  if (prize?.type === "money") return false;
  return hasText(prize?.itemId);
};

export const inferPrizeType = (prize = {}) => {
  const money = hasMoneyReward(prize);
  const item = hasItemReward(prize);
  if (money && item) return "bundle";
  if (money) return "money";
  if (item) return "item";
  return null;
};

export const inferMoneyRewardMode = (prize = {}) => {
  if (!hasMoneyReward(prize)) return null;
  if (prize?.rewardMode === "amount") return "amount";
  if (prize?.rewardMode === "multiplier") return "multiplier";

  const hasAmount = hasOwn(prize, "amount");
  const hasMultiplier = hasOwn(prize, "multiplier");
  if (hasAmount && !hasMultiplier) return "amount";
  return "multiplier";
};

export const resolveMoneyPrizeAmount = (prize = {}, entryPrice = 0) => {
  if (!hasMoneyReward(prize)) return 0;

  const rewardMode = inferMoneyRewardMode(prize);
  if (rewardMode === "amount") {
    return clampNumber(prize.amount);
  }

  return Math.round(clampNumber(entryPrice) * clampNumber(prize.multiplier));
};

export const buildStoreItemValueMap = (storeItems = []) =>
  (Array.isArray(storeItems) ? storeItems : []).reduce((acc, item) => {
    const itemId = String(item?.id || "").trim();
    if (!itemId) return acc;
    acc[itemId] = clampNumber(item?.price);
    return acc;
  }, {});

export const resolveItemPrizeValue = (prize = {}, storeItemValues = {}) => {
  if (!hasItemReward(prize)) return 0;
  const itemId = String(prize?.itemId || "").trim();
  if (!itemId) return 0;
  return clampNumber(storeItemValues?.[itemId]);
};

const normalizePercentages = (entries = [], key = "chance") => {
  const rawTotal = entries.reduce((sum, entry) => sum + clampNumber(entry?.[key]), 0);
  if (rawTotal <= 0) {
    return {
      rawTotal,
      normalized: entries.map((entry) => ({
        entry,
        probability: 0,
      })),
    };
  }

  const usesRawPercent = rawTotal >= 99.9 && rawTotal <= 100.1;
  return {
    rawTotal,
    normalized: entries.map((entry) => {
      const rawValue = clampNumber(entry?.[key]);
      return {
        entry,
        probability: usesRawPercent ? rawValue : (rawValue / rawTotal) * 100,
      };
    }),
  };
};

const nCr = (n, r) => {
  if (r < 0 || r > n) return 0;
  if (r === 0 || r === n) return 1;
  const limit = r > n / 2 ? n - r : r;
  let result = 1;
  for (let i = 1; i <= limit; i += 1) {
    result = (result * (n - i + 1)) / i;
  }
  return Math.floor(result);
};

const getLottoWinCases = ({
  maxNumber = 0,
  pickCount = 0,
  useBonus = true,
  rankIndex = 0,
}) => {
  const n = clampNumber(maxNumber);
  const k = clampNumber(pickCount);
  if (n <= 0 || k <= 0 || k > n) return 0;

  if (rankIndex === 0) return 1;

  if (useBonus) {
    if (rankIndex === 1) return k;
    const match = k - (rankIndex - 1);
    const mismatch = rankIndex - 1;
    if (match < 0) return 0;
    return nCr(k, match) * nCr(n - k - 1, mismatch);
  }

  const match = k - rankIndex;
  const mismatch = rankIndex;
  if (match < 0) return 0;
  return nCr(k, match) * nCr(n - k, mismatch);
};

export const getArcadeRecommendation = ({
  rtp = null,
  winRate = 0,
}) => {
  if (rtp == null) {
    return {
      tone: "slate",
      label: "보상 확인 필요",
      description: "금액이나 아이템 가격이 있어야 평균 보상과 평균 손익을 계산할 수 있습니다.",
    };
  }

  if (rtp > 100) {
    return {
      tone: "rose",
      label: "너무 후함",
      description: "여러 번 할수록 평균적으로 학생 이득이 커집니다. 확률이나 보상값을 조금 낮추는 편이 안전합니다.",
    };
  }

  if (rtp < 45 || winRate < 12) {
    return {
      tone: "amber",
      label: "극악형",
      description: "꽝이 너무 많거나 평균 보상이 낮아 참여가 확 꺼질 수 있습니다. 소보상 쪽을 조금 풀어주는 편이 좋습니다.",
    };
  }

  if (rtp >= 55 && rtp <= 85 && winRate >= 20 && winRate <= 55) {
    return {
      tone: "emerald",
      label: "기본형",
      description: "평균 손익과 참여감이 비교적 안정적입니다. 수업에서 기본 세팅으로 쓰기 좋은 편입니다.",
    };
  }

  if (rtp >= 85 && rtp <= 100) {
    return {
      tone: "violet",
      label: "완화형",
      description: "보상이 자주 나와 참여감은 좋지만 운영 기준으로는 다소 후한 편입니다. 오래 돌릴수록 비용이 커질 수 있습니다.",
    };
  }

  return {
    tone: "sky",
    label: "중간 조정형",
    description: "너무 짜지도 후하지도 않지만 한두 칸 정도만 더 다듬으면 운영감이 더 좋아질 수 있습니다.",
  };
};

const buildSummary = ({
  entryPrice = 0,
  feeAmount = 0,
  totalWinRate = 0,
  moneyWinRate = 0,
  itemWinRate = 0,
  moneyExpectedReturn = 0,
  itemExpectedReturn = 0,
  maxMoneyPrize = 0,
  maxPrizeValue = 0,
  extra = {},
}) => {
  const safePrice = clampNumber(entryPrice);
  const safeFeeAmount = clampNumber(feeAmount);
  const totalCost = safePrice + safeFeeAmount;
  const totalExpectedReturn = moneyExpectedReturn + itemExpectedReturn;
  const rtp = totalCost > 0 ? (totalExpectedReturn / totalCost) * 100 : null;
  const expectedNet = totalCost > 0 ? totalExpectedReturn - totalCost : totalExpectedReturn;

  return {
    entryPrice: safePrice,
    feeAmount: safeFeeAmount,
    totalCost,
    totalWinRate,
    moneyWinRate,
    itemWinRate,
    moneyExpectedReturn,
    itemExpectedReturn,
    totalExpectedReturn,
    expectedNet,
    rtp,
    maxMoneyPrize,
    maxPrizeValue,
    recommendation: getArcadeRecommendation({
      rtp,
      winRate: totalWinRate,
    }),
    ...extra,
  };
};

export const analyzeChancePrizes = (
  prizes = [],
  entryPrice = 0,
  storeItems = [],
  feeAmount = 0,
) => {
  const safePrizes = Array.isArray(prizes) ? prizes : [];
  const storeItemValues = buildStoreItemValueMap(storeItems);
  const { rawTotal, normalized } = normalizePercentages(safePrizes, "chance");

  let totalWinRate = 0;
  let moneyWinRate = 0;
  let itemWinRate = 0;
  let moneyExpectedReturn = 0;
  let itemExpectedReturn = 0;
  let maxMoneyPrize = 0;
  let maxPrizeValue = 0;

  normalized.forEach(({ entry, probability }) => {
    const moneyAmount = resolveMoneyPrizeAmount(entry, entryPrice);
    const itemValue = resolveItemPrizeValue(entry, storeItemValues);
    const itemReward = hasItemReward(entry);
    const moneyReward = moneyAmount > 0;
    const anyReward = moneyReward || itemReward;

    moneyExpectedReturn += moneyAmount * (probability / 100);
    itemExpectedReturn += itemValue * (probability / 100);
    maxMoneyPrize = Math.max(maxMoneyPrize, moneyAmount);
    maxPrizeValue = Math.max(maxPrizeValue, moneyAmount + itemValue);

    if (probability > 0 && anyReward) totalWinRate += probability;
    if (probability > 0 && moneyReward) moneyWinRate += probability;
    if (probability > 0 && itemReward) itemWinRate += probability;
  });

  return buildSummary({
    entryPrice,
    feeAmount,
    totalWinRate,
    moneyWinRate,
    itemWinRate,
    moneyExpectedReturn,
    itemExpectedReturn,
    maxMoneyPrize,
    maxPrizeValue,
    extra: {
      totalConfiguredChance: rawTotal,
    },
  });
};

export const analyzeLottoPrizes = (config = {}, storeItems = []) => {
  const safePrizes = Array.isArray(config?.prizes) ? config.prizes : [];
  const safeEntryPrice = clampNumber(config?.price);
  const safeFeeAmount = clampNumber(config?.feeAmount);
  const n = clampNumber(config?.maxNumber);
  const k = clampNumber(config?.pickCount);
  const useBonus = config?.useBonus !== false;
  const totalCombinations = nCr(n, k);
  const storeItemValues = buildStoreItemValueMap(storeItems);

  if (n <= 0 || k <= 0 || k > n || totalCombinations <= 0) {
    return buildSummary({
      entryPrice: safeEntryPrice,
      feeAmount: safeFeeAmount,
      extra: {
        totalCombinations: 0,
      },
    });
  }

  let totalWinRate = 0;
  let moneyWinRate = 0;
  let itemWinRate = 0;
  let moneyExpectedReturn = 0;
  let itemExpectedReturn = 0;
  let maxMoneyPrize = 0;
  let maxPrizeValue = 0;

  safePrizes.forEach((prize, index) => {
    const winCases = getLottoWinCases({
      maxNumber: n,
      pickCount: k,
      useBonus,
      rankIndex: index,
    });
    const probability = (winCases / totalCombinations) * 100;
    if (probability <= 0) return;

    const moneyAmount = resolveMoneyPrizeAmount(prize, safeEntryPrice);
    const itemValue = resolveItemPrizeValue(prize, storeItemValues);
    const itemReward = hasItemReward(prize);
    const moneyReward = moneyAmount > 0;
    const anyReward = moneyReward || itemReward;

    moneyExpectedReturn += moneyAmount * (probability / 100);
    itemExpectedReturn += itemValue * (probability / 100);
    maxMoneyPrize = Math.max(maxMoneyPrize, moneyAmount);
    maxPrizeValue = Math.max(maxPrizeValue, moneyAmount + itemValue);

    if (anyReward) totalWinRate += probability;
    if (moneyReward) moneyWinRate += probability;
    if (itemReward) itemWinRate += probability;
  });

  return buildSummary({
    entryPrice: safeEntryPrice,
    feeAmount: safeFeeAmount,
    totalWinRate,
    moneyWinRate,
    itemWinRate,
    moneyExpectedReturn,
    itemExpectedReturn,
    maxMoneyPrize,
    maxPrizeValue,
    extra: {
      totalCombinations,
      bonusEnabled: useBonus,
    },
  });
};

export const analyzeBoardPrizes = (
  prizes = [],
  boardSize = 0,
  entryPrice = 0,
  storeItems = [],
  feeAmount = 0,
) => {
  const safePrizes = Array.isArray(prizes) ? prizes : [];
  const storeItemValues = buildStoreItemValueMap(storeItems);
  const totalPrizeCount = safePrizes.reduce((sum, prize) => sum + clampNumber(prize?.count), 0);
  const safeBoardSize = Math.max(1, Math.max(clampNumber(boardSize), totalPrizeCount));

  let totalWinRate = 0;
  let moneyWinRate = 0;
  let itemWinRate = 0;
  let moneyExpectedReturn = 0;
  let itemExpectedReturn = 0;
  let maxMoneyPrize = 0;
  let maxPrizeValue = 0;

  safePrizes.forEach((prize) => {
    const count = clampNumber(prize?.count);
    const probability = (count / safeBoardSize) * 100;
    const moneyAmount = resolveMoneyPrizeAmount(prize, entryPrice);
    const itemValue = resolveItemPrizeValue(prize, storeItemValues);
    const itemReward = hasItemReward(prize);
    const moneyReward = moneyAmount > 0;
    const anyReward = moneyReward || itemReward;

    moneyExpectedReturn += moneyAmount * (count / safeBoardSize);
    itemExpectedReturn += itemValue * (count / safeBoardSize);
    maxMoneyPrize = Math.max(maxMoneyPrize, moneyAmount);
    maxPrizeValue = Math.max(maxPrizeValue, moneyAmount + itemValue);

    if (probability > 0 && anyReward) totalWinRate += probability;
    if (probability > 0 && moneyReward) moneyWinRate += probability;
    if (probability > 0 && itemReward) itemWinRate += probability;
  });

  return buildSummary({
    entryPrice,
    feeAmount,
    totalWinRate,
    moneyWinRate,
    itemWinRate,
    moneyExpectedReturn,
    itemExpectedReturn,
    maxMoneyPrize,
    maxPrizeValue,
    extra: {
      boardSize: safeBoardSize,
      blankRate: Math.max(((safeBoardSize - totalPrizeCount) / safeBoardSize) * 100, 0),
      totalPrizeCount,
    },
  });
};

export const buildChanceProbabilityRows = (prizes = []) => {
  const safePrizes = Array.isArray(prizes) ? prizes : [];
  const { normalized } = normalizePercentages(safePrizes, "chance");

  return normalized
    .filter(({ probability }) => probability > 0)
    .map(({ entry, probability }, index) => ({
      id: entry?.id || `chance-${index}`,
      label: String(entry?.label || "").trim() || `보상 ${index + 1}`,
      probabilityPercent: probability,
    }));
};

export const buildBoardProbabilityRows = (prizes = [], boardSize = 0) => {
  const safePrizes = Array.isArray(prizes) ? prizes : [];
  const totalPrizeCount = safePrizes.reduce((sum, prize) => sum + clampNumber(prize?.count), 0);
  const safeBoardSize = Math.max(1, Math.max(clampNumber(boardSize), totalPrizeCount));

  const rewardRows = safePrizes
    .filter((prize) => clampNumber(prize?.count) > 0)
    .map((prize, index) => ({
      id: prize?.id || `board-${index}`,
      label: String(prize?.label || "").trim() || `보상 ${index + 1}`,
      probabilityPercent: (clampNumber(prize?.count) / safeBoardSize) * 100,
    }));

  const blankCount = Math.max(safeBoardSize - totalPrizeCount, 0);
  if (blankCount > 0) {
    rewardRows.push({
      id: "board-blank",
      label: "꽝",
      probabilityPercent: (blankCount / safeBoardSize) * 100,
    });
  }

  return rewardRows;
};

export const buildLottoProbabilityRows = (config = {}) => {
  const safePrizes = Array.isArray(config?.prizes) ? config.prizes : [];
  const n = clampNumber(config?.maxNumber);
  const k = clampNumber(config?.pickCount);
  const useBonus = config?.useBonus !== false;
  const totalCombinations = nCr(n, k);

  if (n <= 0 || k <= 0 || k > n || totalCombinations <= 0) {
    return [];
  }

  return safePrizes
    .map((prize, index) => {
      const winCases = getLottoWinCases({
        maxNumber: n,
        pickCount: k,
        useBonus,
        rankIndex: index,
      });
      const probabilityPercent = (winCases / totalCombinations) * 100;

      return {
        id: prize?.id || prize?.rank || `lotto-${index}`,
        label: String(prize?.label || "").trim() || `${index + 1}등`,
        probabilityPercent,
      };
    })
    .filter((row) => row.probabilityPercent > 0);
};
