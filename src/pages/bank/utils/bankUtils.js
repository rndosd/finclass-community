// src/pages/bank/utils/bankUtils.js

import {
  calculatePeriodRateAdjustment,
  calculateSavingInterest,
  roundBankMoney,
  toSafeNumber,
} from "../../../utils/bankMoney";

export { calculatePeriodRateAdjustment, calculateSavingInterest };

export const calculateLoanInterest = (
  principal,
  rateForPeriodPercentage,
  days,
) => {
  if (toSafeNumber(days) <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.round(
      toSafeNumber(principal) * (toSafeNumber(rateForPeriodPercentage) / 100),
    ),
  );
};

export const buildDepositQuote = ({
  principal,
  baseRate,
  weeklyModifier,
  productDays,
}) => {
  const normalizedPrincipal = toSafeNumber(principal);
  const normalizedBaseRate = toSafeNumber(baseRate);
  const rateAdjustment = calculatePeriodRateAdjustment(
    weeklyModifier,
    productDays,
  );
  const finalRate = Math.max(
    0,
    roundBankMoney(normalizedBaseRate + rateAdjustment),
  );
  const baseInterestAmount = calculateSavingInterest(
    normalizedPrincipal,
    normalizedBaseRate,
  );
  const totalEstimatedInterest = calculateSavingInterest(
    normalizedPrincipal,
    finalRate,
  );

  return {
    rateAdjustment,
    finalRate,
    baseInterestAmount,
    tierBonusInterestAmount: roundBankMoney(
      totalEstimatedInterest - baseInterestAmount,
    ),
    totalEstimatedInterest,
  };
};

export const buildLoanQuote = ({
  principal,
  baseRate,
  weeklyModifier,
  productDays,
}) => {
  const normalizedPrincipal = toSafeNumber(principal);
  const normalizedBaseRate = toSafeNumber(baseRate);
  const rateAdjustment = calculatePeriodRateAdjustment(
    weeklyModifier,
    productDays,
  );
  const finalRate = Math.max(
    0,
    roundBankMoney(normalizedBaseRate + rateAdjustment),
  );
  const baseInterestAmount = calculateLoanInterest(
    normalizedPrincipal,
    normalizedBaseRate,
    productDays,
  );
  const totalEstimatedInterest = calculateLoanInterest(
    normalizedPrincipal,
    finalRate,
    productDays,
  );

  return {
    rateAdjustment,
    finalRate,
    baseInterestAmount,
    tierBonusInterestAmount: roundBankMoney(
      totalEstimatedInterest - baseInterestAmount,
    ),
    totalEstimatedInterest,
  };
};
