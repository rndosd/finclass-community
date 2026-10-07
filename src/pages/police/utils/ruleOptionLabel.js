import { isMissionTokenEnabledForRule } from "./policeRuleUtils";

const formatSignedNumber = (value, formatter = amount => amount.toLocaleString()) => {
  const amount = Number(value || 0);
  if (amount > 0) return `+${formatter(amount)}`;
  return formatter(amount);
};

export const buildPoliceRuleOption = (rule = {}, formatter) => {
  const rawOrder = String(rule?.order ?? "").trim();
  const orderLabel = rawOrder ? `${rawOrder}. ` : "";
  const showMissionToken =
    isMissionTokenEnabledForRule(rule) || Number(rule?.missionTokenChange || 0) !== 0;
  const tokenInfo = showMissionToken
    ? ` / 토큰 ${formatSignedNumber(rule?.missionTokenChange || 0, formatter)}`
    : "";

  return {
    value: rule?.id || "",
    label: `${orderLabel}${rule?.text || ""} (\uBC8C\uAE08 ${formatSignedNumber(
      rule?.fineAmount || 0, formatter,
    )} / \uC2E0\uC6A9 ${formatSignedNumber(rule?.creditChange || 0)}${tokenInfo})`,
    searchText: `${rule?.order || ""} ${rule?.text || ""} ${rule?.fineAmount || ""} ${rule?.creditChange || ""} ${rule?.missionTokenChange || ""}`,
  };
};
