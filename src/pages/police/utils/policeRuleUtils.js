export const getPoliceRuleNumericValues = (rule = {}) => ({
  fineAmount: Number(rule?.fineAmount || 0),
  creditChange: Number(rule?.creditChange || 0),
  missionTokenChange: Number(rule?.missionTokenChange || 0),
});

export const isMissionTokenEnabledForRule = (rule = {}) =>
  rule?.missionTokenEnabled === true ||
  Number(rule?.missionTokenChange || 0) !== 0;

export const resolvePoliceRuleAction = (rule = {}) => {
  const { fineAmount, creditChange, missionTokenChange } =
    getPoliceRuleNumericValues(rule);
  const deltas = [fineAmount, creditChange, missionTokenChange];

  if (deltas.some((value) => value < 0)) return "fine";
  if (deltas.some((value) => value > 0)) return "reward";
  return null;
};

export const resolvePoliceRuleType = (rule = {}) => {
  const action = resolvePoliceRuleAction(rule);
  if (action === "fine") return "penalty";
  if (action === "reward") return "reward";

  const explicitType = String(rule?.type || "").trim();
  if (explicitType === "penalty" || explicitType === "reward") {
    return explicitType;
  }

  return "reward";
};

export const isPenaltyRule = (rule = {}) =>
  resolvePoliceRuleAction(rule) === "fine";

export const isRewardRule = (rule = {}) =>
  resolvePoliceRuleAction(rule) === "reward";
