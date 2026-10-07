import { DEFAULT_MISSION_TOKEN_LABEL } from "../../../utils/missionTokenLabel";

const REWARD_TYPES = ["credit", "currency", "missionToken"];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNonNegative = (value) => Math.max(0, toNumber(value, 0));

const clampRewardAmount = (reward, amount) => {
  if (!reward) return 0;
  if (!Number.isFinite(amount)) return reward.maxAmount;

  return Math.min(Math.max(amount, reward.minAmount), reward.maxAmount);
};

export const normalizeRewardItem = (rawReward = {}) => {
  const type = REWARD_TYPES.includes(rawReward?.type) ? rawReward.type : null;
  if (!type) return null;

  const amount = toNonNegative(rawReward?.amount);
  const hasRangeFields =
    rawReward?.isRange === true ||
    rawReward?.mode === "range" ||
    rawReward?.minAmount !== undefined ||
    rawReward?.maxAmount !== undefined;

  let minAmount = hasRangeFields
    ? toNonNegative(rawReward?.minAmount ?? amount)
    : amount;
  let maxAmount = hasRangeFields
    ? toNonNegative(rawReward?.maxAmount ?? amount)
    : amount;

  if (maxAmount < minAmount) {
    [minAmount, maxAmount] = [maxAmount, minAmount];
  }

  const isRange = hasRangeFields && maxAmount !== minAmount;

  return {
    type,
    amount: isRange ? maxAmount : amount,
    minAmount,
    maxAmount,
    isRange,
  };
};

export const normalizeRewardList = (rawRewards = []) =>
  (
    Array.isArray(rawRewards)
      ? rawRewards
      : rawRewards && typeof rawRewards === "object"
        ? [
            { type: "currency", amount: rawRewards.currency },
            { type: "credit", amount: rawRewards.credit },
            {
              type: "missionToken",
              amount: rawRewards.missionToken ?? rawRewards.token,
            },
          ]
        : []
  )
    .map((reward) => normalizeRewardItem(reward))
    .filter(Boolean)
    .filter((reward) => reward.maxAmount > 0 || reward.minAmount > 0);

export const getRewardConstraints = (missionOrRewards) => {
  const rewards = Array.isArray(missionOrRewards?.rewards)
    ? missionOrRewards.rewards
    : missionOrRewards;

  const base = {
    credit: { type: "credit", minAmount: 0, maxAmount: 0, isRange: false },
    currency: {
      type: "currency",
      minAmount: 0,
      maxAmount: 0,
      isRange: false,
    },
    missionToken: {
      type: "missionToken",
      minAmount: 0,
      maxAmount: 0,
      isRange: false,
    },
  };

  normalizeRewardList(rewards).forEach((reward) => {
    base[reward.type] = reward;
  });

  return base;
};

export const hasRewardRange = (missionOrRewards) =>
  Object.values(getRewardConstraints(missionOrRewards)).some(
    (reward) => reward.isRange,
  );

export const getRewardApprovalDefaults = (missionOrRewards) => {
  const constraints = getRewardConstraints(missionOrRewards);
  return {
    credit: constraints.credit.maxAmount,
    currency: constraints.currency.maxAmount,
    missionToken: constraints.missionToken.maxAmount,
  };
};

export const getRangeRewardTypes = (missionOrRewards) =>
  Object.values(getRewardConstraints(missionOrRewards))
    .filter((reward) => reward.isRange && reward.maxAmount > 0)
    .map((reward) => reward.type);

export const sanitizeRewardOverride = (missionOrRewards, override = {}) => {
  const constraints = getRewardConstraints(missionOrRewards);

  return Object.fromEntries(
    REWARD_TYPES.map((type) => {
      const reward = constraints[type];
      const defaultValue = reward.maxAmount;
      const nextValue = toNonNegative(override?.[type] ?? defaultValue);

      if (!reward.isRange) {
        return [type, reward.maxAmount];
      }

      return [
        type,
        Math.min(Math.max(nextValue, reward.minAmount), reward.maxAmount),
      ];
    }),
  );
};

export const getRewardAmountFromRatio = (reward, ratio) => {
  if (!reward?.isRange) return reward?.maxAmount ?? 0;

  const range = reward.maxAmount - reward.minAmount;
  if (range <= 0) return reward.maxAmount;

  const clampedRatio = Math.min(Math.max(ratio, 0), 1);
  return clampRewardAmount(
    reward,
    Math.round(reward.minAmount + range * clampedRatio),
  );
};

export const getRewardRatioFromAmount = (reward, amount) => {
  if (!reward?.isRange) return 1;

  const range = reward.maxAmount - reward.minAmount;
  if (range <= 0) return 1;

  return (
    (clampRewardAmount(reward, amount) - reward.minAmount) / range
  );
};

export const getRewardDisplayText = (
  reward,
  currencyUnit = "\uCF54\uC778",
  missionTokenLabel = DEFAULT_MISSION_TOKEN_LABEL,
) => {
  const normalized = normalizeRewardItem(reward);
  if (!normalized) return "";

  const suffix =
    normalized.type === "currency"
      ? currencyUnit
      : normalized.type === "credit"
        ? "\uC810\uC218"
        : missionTokenLabel;

  if (normalized.isRange) {
    return `${normalized.minAmount}~${normalized.maxAmount}${suffix}`;
  }

  return `${normalized.maxAmount}${suffix}`;
};
