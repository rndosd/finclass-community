const FUND_ANNUAL_FEE_PRESETS = Object.freeze([
  Object.freeze({ id: "free", label: "무료형", bpsAnnual: 0 }),
  Object.freeze({ id: "basic", label: "기본형", bpsAnnual: 100 }),
  Object.freeze({ id: "active", label: "적극운용형", bpsAnnual: 200 }),
]);

function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function resolveFundManagementFeeSelection(application = {}) {
  const requestedAnnualFee = Number(application?.managementFeeBpsAnnual);
  const legacyWeeklyFee = Math.max(
    0,
    Number(application?.managementFeeBpsWeekly) || 0,
  );
  const compatibleAnnualFee = Number.isFinite(requestedAnnualFee)
    ? Math.round(requestedAnnualFee)
    : legacyWeeklyFee <= 0
      ? 0
      : legacyWeeklyFee <= 10
        ? 100
        : 200;
  const preset = FUND_ANNUAL_FEE_PRESETS.find(
    (item) => item.bpsAnnual === compatibleAnnualFee,
  );
  if (!preset) return null;

  return {
    managementFeeBpsAnnual: preset.bpsAnnual,
    managementFeeBpsWeekly: round4(preset.bpsAnnual / 52),
    managementFeeLabel: preset.label,
  };
}

module.exports = {
  FUND_ANNUAL_FEE_PRESETS,
  resolveFundManagementFeeSelection,
};
