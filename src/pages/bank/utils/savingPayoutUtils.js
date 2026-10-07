import { calculateFinalInterest, startOfDayInKST, toDate } from "./dateUtils";
import {
  calculateInterestTax,
  roundBankMoney,
  toSafeNumber,
} from "../../../utils/bankMoney";

export const isPolicyActiveFrom = (enabledFrom, referenceDate = new Date()) => {
  if (!enabledFrom) return true;

  const targetDate = toDate(enabledFrom);
  if (!targetDate) return false;

  const normalizedTarget = startOfDayInKST(targetDate);
  const normalizedReference = startOfDayInKST(referenceDate);

  return normalizedReference.getTime() >= normalizedTarget.getTime();
};

const getSavingInterestTaxPolicySnapshot = (saving) => {
  const rawSnapshot = saving?.interestTaxPolicySnapshot;
  if (
    !rawSnapshot ||
    typeof rawSnapshot !== "object" ||
    Array.isArray(rawSnapshot)
  ) {
    return null;
  }

  return {
    enabled: rawSnapshot.enabled === true,
    taxRate: Math.max(0, toSafeNumber(rawSnapshot.taxRate)),
    enabledFrom: rawSnapshot.enabledFrom ?? null,
  };
};

export const buildSavingClaimBreakdown = ({
  saving,
  withholdingPolicy,
  referenceDate = new Date(),
}) => {
  const principal = toSafeNumber(saving?.amount);
  const hasActualBreakdown = [
    "grossInterestPaid",
    "interestTaxWithheld",
    "actualInterestPaid",
    "totalPaidAmount",
  ].some((field) => saving?.[field] !== undefined && saving?.[field] !== null);

  if (hasActualBreakdown) {
    const grossInterest = Math.max(
      0,
      roundBankMoney(toSafeNumber(saving?.grossInterestPaid)),
    );
    const taxAmount = Math.max(
      0,
      roundBankMoney(toSafeNumber(saving?.interestTaxWithheld)),
    );
    const netInterest = Math.max(
      0,
      roundBankMoney(
        toSafeNumber(
          saving?.actualInterestPaid !== undefined
            ? saving?.actualInterestPaid
            : grossInterest - taxAmount,
        ),
      ),
    );
    const totalPaid = Math.max(
      0,
      roundBankMoney(
        toSafeNumber(
          saving?.totalPaidAmount !== undefined
            ? saving?.totalPaidAmount
            : principal + netInterest,
        ),
      ),
    );

    return {
      principal,
      grossInterest,
      taxAmount,
      netInterest,
      totalPaid,
      taxRate: Math.max(0, toSafeNumber(saving?.interestTaxRateApplied)),
      withholdingEnabled: taxAmount > 0,
      hasInterest: grossInterest > 0,
      shouldShowWithholding: taxAmount > 0,
      isLegacyWithoutWithholdingData: false,
      isEstimate: false,
    };
  }

  const grossInterest = roundBankMoney(
    Math.max(
      0,
      Math.max(
        toSafeNumber(calculateFinalInterest(saving)),
        toSafeNumber(saving?.expectedProfit),
      ),
    ),
  );
  const interestTaxPolicySnapshot = getSavingInterestTaxPolicySnapshot(saving);
  const canUseWithholding =
    withholdingPolicy?.enabled === true &&
    grossInterest > 0 &&
    Boolean(interestTaxPolicySnapshot) &&
    interestTaxPolicySnapshot.enabled === true &&
    isPolicyActiveFrom(
      interestTaxPolicySnapshot.enabledFrom ?? withholdingPolicy?.enabledFrom,
      referenceDate,
    );
  const taxRate = canUseWithholding
    ? interestTaxPolicySnapshot.taxRate
    : 0;
  const taxAmount = canUseWithholding
    ? calculateInterestTax(grossInterest, taxRate)
    : 0;
  const netInterest = Math.max(0, roundBankMoney(grossInterest - taxAmount));
  const totalPaid = roundBankMoney(principal + netInterest);

  return {
    principal,
    grossInterest,
    taxAmount,
    netInterest,
    totalPaid,
    taxRate,
    withholdingEnabled: canUseWithholding,
    hasInterest: grossInterest > 0,
    shouldShowWithholding: canUseWithholding,
    isLegacyWithoutWithholdingData:
      withholdingPolicy?.enabled === true &&
      grossInterest > 0 &&
      !interestTaxPolicySnapshot,
    isEstimate: true,
  };
};
