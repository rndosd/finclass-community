import {
  buildStoreItemValueMap,
  hasItemReward,
  hasMoneyReward,
  inferMoneyRewardMode,
  inferPrizeType,
  resolveItemPrizeValue,
  resolveMoneyPrizeAmount,
} from "./prizeAnalytics";

const toSafeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clampNonNegative = (value) => Math.max(0, Number(value) || 0);

const allocateWeightedPercentages = (weights = [], total = 100, precision = 2) => {
  const factor = 10 ** precision;
  const safeWeights = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);

  if (weightSum <= 0) {
    const evenWeights = safeWeights.map(() => 1);
    return allocateWeightedPercentages(evenWeights, total, precision);
  }

  let allocated = 0;
  return safeWeights.map((weight, index) => {
    if (index === safeWeights.length - 1) {
      return Math.max(0, Math.round((total - allocated) * factor) / factor);
    }

    const value = Math.round(((weight / weightSum) * total) * factor) / factor;
    allocated += value;
    return value;
  });
};

const allocateWeightedIntegers = (weights = [], total = 0, minimums = []) => {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safeMinimums = weights.map((_, index) => Math.max(0, Math.floor(Number(minimums[index]) || 0)));
  const minimumSum = safeMinimums.reduce((sum, value) => sum + value, 0);

  if (safeTotal <= 0) return weights.map(() => 0);

  if (minimumSum >= safeTotal) {
    let remaining = safeTotal;
    return safeMinimums.map((value) => {
      if (remaining <= 0) return 0;
      const nextValue = Math.min(value || 1, remaining);
      remaining -= nextValue;
      return nextValue;
    });
  }

  const remaining = safeTotal - minimumSum;
  const safeWeights = weights.map((weight) => Math.max(0, Number(weight) || 0));
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0) || safeWeights.length || 1;
  const normalizedWeights =
    weightSum > 0 ? safeWeights : safeWeights.map(() => 1);

  const rawShares = normalizedWeights.map((weight) => (weight / weightSum) * remaining);
  const floors = rawShares.map((share) => Math.floor(share));
  let remainder = remaining - floors.reduce((sum, value) => sum + value, 0);

  const remainders = rawShares
    .map((share, index) => ({ index, remainder: share - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder);

  const allocatedExtras = [...floors];
  for (let i = 0; i < remainders.length && remainder > 0; i += 1) {
    allocatedExtras[remainders[i].index] += 1;
    remainder -= 1;
  }

  return safeMinimums.map((minimum, index) => minimum + allocatedExtras[index]);
};

export const createEditablePrize = (overrides = {}) => ({
  id: Date.now() + Math.random(),
  moneyEnabled: true,
  itemEnabled: false,
  rewardMode: "multiplier",
  multiplier: 0,
  amount: 0,
  chance: 0,
  count: 1,
  itemId: "",
  label: "새 보상",
  color: "",
  ...overrides,
});

export const toEditablePrize = (prize = {}, overrides = {}) => ({
  id: prize.id ?? Date.now() + Math.random(),
  moneyEnabled: hasMoneyReward(prize),
  itemEnabled: hasItemReward(prize),
  rewardMode: inferMoneyRewardMode(prize) || "multiplier",
  multiplier: toSafeNumber(prize.multiplier, 0),
  amount: toSafeNumber(prize.amount, 0),
  chance: toSafeNumber(prize.chance, 0),
  count: toSafeNumber(prize.count, 1),
  itemId: String(prize.itemId || ""),
  label: String(prize.label || ""),
  color: prize.color || "",
  ...overrides,
});

export const isPrizeDraftValid = (prize = {}, { quantityField = "chance" } = {}) => {
  const quantity = Number(prize?.[quantityField]);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (!String(prize?.label || "").trim()) return false;
  if (!prize?.moneyEnabled && !prize?.itemEnabled) return false;

  if (prize?.moneyEnabled) {
    if (prize?.rewardMode === "amount") {
      const amount = Number(prize?.amount);
      if (!Number.isFinite(amount) || amount < 0) return false;
    } else {
      const multiplier = Number(prize?.multiplier);
      if (!Number.isFinite(multiplier) || multiplier < 0) return false;
    }
  }

  if (prize?.itemEnabled && !String(prize?.itemId || "").trim()) {
    return false;
  }

  return true;
};

export const normalizePrizeDraft = (
  prize = {},
  { index = 0, quantityField = "chance", includeColor = false, fallbackColor = "" } = {},
) => {
  const moneyEnabled = prize?.moneyEnabled !== false;
  const itemEnabled = prize?.itemEnabled === true;
  const normalized = {
    id: prize.id ?? Date.now() + index,
    type:
      inferPrizeType({
        moneyEnabled,
        itemEnabled,
        rewardMode: prize.rewardMode,
        multiplier: prize.multiplier,
        amount: prize.amount,
        itemId: prize.itemId,
      }) || "money",
    moneyEnabled,
    itemEnabled,
    label: String(prize.label || "").trim(),
    [quantityField]: Math.max(0, toSafeNumber(prize?.[quantityField], 0)),
  };

  if (moneyEnabled) {
    const rewardMode = prize?.rewardMode === "amount" ? "amount" : "multiplier";
    normalized.rewardMode = rewardMode;
    if (rewardMode === "amount") {
      normalized.amount = Math.max(0, toSafeNumber(prize?.amount, 0));
    } else {
      normalized.multiplier = Math.max(0, toSafeNumber(prize?.multiplier, 0));
    }
  }

  if (itemEnabled) {
    normalized.itemId = String(prize.itemId || "").trim();
  }

  if (includeColor) {
    normalized.color = prize.color || fallbackColor;
  }

  return normalized;
};

export const normalizeChanceWeights = (prizes = [], { precision = 2 } = {}) => {
  const safePrizes = Array.isArray(prizes) ? prizes : [];
  const factor = 10 ** precision;
  const rawValues = safePrizes.map((prize) => clampNonNegative(prize?.chance));
  const total = rawValues.reduce((sum, value) => sum + value, 0);

  if (total <= 0) return safePrizes;

  let allocated = 0;
  return safePrizes.map((prize, index) => {
    if (index === safePrizes.length - 1) {
      return {
        ...prize,
        chance: Math.max(0, Math.round((100 - allocated) * factor) / factor),
      };
    }

    const normalized = Math.round(((rawValues[index] / total) * 100) * factor) / factor;
    allocated += normalized;
    return {
      ...prize,
      chance: normalized,
    };
  });
};

const CHANCE_PRESET_CONFIGS = {
  harsh: {
    exponent: 1.45,
    zeroValueWeight: 4.2,
    minWeight: 0.04,
  },
  balanced: {
    exponent: 1.1,
    zeroValueWeight: 2.4,
    minWeight: 0.08,
  },
  soft: {
    exponent: 0.8,
    zeroValueWeight: 1.45,
    minWeight: 0.14,
  },
};

const BOARD_PRESET_CONFIGS = {
  sparse: {
    fillRate: 0.3,
    exponent: 1.2,
    zeroValueWeight: 4.2,
    minWeight: 0.4,
  },
  balanced: {
    fillRate: 0.48,
    exponent: 0.95,
    zeroValueWeight: 3,
    minWeight: 0.55,
  },
  active: {
    fillRate: 0.68,
    exponent: 0.75,
    zeroValueWeight: 2.1,
    minWeight: 0.7,
  },
};

export const CHANCE_PRESET_OPTIONS = [
  {
    id: "harsh",
    label: "극악형",
    description: "꽝과 저보상을 더 자주 주는 운영형",
  },
  {
    id: "balanced",
    label: "기본형",
    description: "수업용으로 무난한 기본 밸런스",
  },
  {
    id: "soft",
    label: "완화형",
    description: "참여감이 높게 느껴지는 완만한 형식",
  },
];

export const BOARD_PRESET_OPTIONS = [
  {
    id: "sparse",
    label: "빈칸 많게",
    description: "보상 칸을 적게 두고 빈칸을 넉넉하게 남깁니다.",
  },
  {
    id: "balanced",
    label: "균형 배치",
    description: "빈칸과 보상 칸을 수업용으로 무난하게 배치합니다.",
  },
  {
    id: "active",
    label: "참여형 배치",
    description: "보상 칸을 더 많이 두어 뽑는 재미를 높입니다.",
  },
];

const getPrizeValueWeight = (
  prize = {},
  entryPrice = 0,
  storeItemValues = {},
  preset = CHANCE_PRESET_CONFIGS.balanced,
) => {
  const moneyValue = resolveMoneyPrizeAmount(prize, entryPrice);
  const itemValue = resolveItemPrizeValue(prize, storeItemValues);
  const totalValue = moneyValue + itemValue;
  const safePreset = preset || CHANCE_PRESET_CONFIGS.balanced;

  if (totalValue <= 0) return safePreset.zeroValueWeight;

  const baseline = Math.max(Number(entryPrice) || 0, 1);
  const scaledValue = totalValue / baseline;
  return Math.max(
    safePreset.minWeight,
    1 / Math.pow(scaledValue + 1, safePreset.exponent),
  );
};

export const applyChancePreset = (
  prizes = [],
  { presetId = "balanced", entryPrice = 0, storeItems = [], precision = 2 } = {},
) => {
  const safePrizes = Array.isArray(prizes) ? prizes.map((prize) => ({ ...prize })) : [];
  if (safePrizes.length === 0) return safePrizes;

  const storeItemValues = buildStoreItemValueMap(storeItems);
  const preset = CHANCE_PRESET_CONFIGS[presetId] || CHANCE_PRESET_CONFIGS.balanced;
  const weights = safePrizes.map((prize) =>
    getPrizeValueWeight(prize, entryPrice, storeItemValues, preset),
  );
  const allocated = allocateWeightedPercentages(weights, 100, precision);

  return safePrizes.map((prize, index) => ({
    ...prize,
    chance: allocated[index],
  }));
};

export const autoDistributeChanceWeights = (
  prizes = [],
  { entryPrice = 0, storeItems = [], precision = 2 } = {},
) => {
  const safePrizes = Array.isArray(prizes) ? prizes.map((prize) => ({ ...prize })) : [];
  if (safePrizes.length === 0) return safePrizes;

  const storeItemValues = buildStoreItemValueMap(storeItems);
  const positiveIndexes = [];
  const emptyIndexes = [];

  safePrizes.forEach((prize, index) => {
    const chance = Number(prize?.chance);
    if (Number.isFinite(chance) && chance > 0) {
      positiveIndexes.push(index);
      return;
    }
    emptyIndexes.push(index);
  });

  if (positiveIndexes.length === 0) {
    const weights = safePrizes.map((prize) =>
      getPrizeValueWeight(prize, entryPrice, storeItemValues),
    );
    const allocated = allocateWeightedPercentages(weights, 100, precision);
    return safePrizes.map((prize, index) => ({
      ...prize,
      chance: allocated[index],
    }));
  }

  const fixedTotal = positiveIndexes.reduce(
    (sum, index) => sum + clampNonNegative(safePrizes[index]?.chance),
    0,
  );

  if (fixedTotal >= 100 || emptyIndexes.length === 0) {
    const allocated = allocateWeightedPercentages(
      positiveIndexes.map((index) => clampNonNegative(safePrizes[index]?.chance)),
      100,
      precision,
    );

    return safePrizes.map((prize, index) => {
      const allocatedIndex = positiveIndexes.indexOf(index);
      return {
        ...prize,
        chance: allocatedIndex >= 0 ? allocated[allocatedIndex] : 0,
      };
    });
  }

  const remaining = Math.max(100 - fixedTotal, 0);
  const allocated = allocateWeightedPercentages(
    emptyIndexes.map((index) =>
      getPrizeValueWeight(safePrizes[index], entryPrice, storeItemValues),
    ),
    remaining,
    precision,
  );

  return safePrizes.map((prize, index) => {
    const allocatedIndex = emptyIndexes.indexOf(index);
    if (allocatedIndex >= 0) {
      return {
        ...prize,
        chance: allocated[allocatedIndex],
      };
    }

    return {
      ...prize,
      chance: clampNonNegative(prize?.chance),
    };
  });
};

export const applyBoardPreset = (
  prizes = [],
  { presetId = "balanced", boardSize = 0, entryPrice = 0, storeItems = [] } = {},
) => {
  const safePrizes = Array.isArray(prizes) ? prizes.map((prize) => ({ ...prize })) : [];
  const safeBoardSize = Math.max(0, Math.floor(Number(boardSize) || 0));

  if (safePrizes.length === 0 || safeBoardSize <= 0 || safeBoardSize < safePrizes.length) {
    return safePrizes;
  }

  const preset = BOARD_PRESET_CONFIGS[presetId] || BOARD_PRESET_CONFIGS.balanced;
  const storeItemValues = buildStoreItemValueMap(storeItems);
  const rewardSlotTotal = Math.min(
    safeBoardSize,
    Math.max(safePrizes.length, Math.round(safeBoardSize * preset.fillRate)),
  );

  const weights = safePrizes.map((prize) =>
    getPrizeValueWeight(prize, entryPrice, storeItemValues, preset),
  );

  const counts = allocateWeightedIntegers(
    weights,
    rewardSlotTotal,
    safePrizes.map(() => 1),
  );

  return safePrizes.map((prize, index) => ({
    ...prize,
    count: counts[index] || 1,
  }));
};
