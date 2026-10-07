import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useUser } from "./UserContext";
import { useNotifications } from "./NotificationContext";
import { useBankBase } from "../hooks/bank/useBankBase";
import { useBankUser } from "../hooks/bank/useBankUser";
import useSubscription from "../hooks/bank/useSubscription";
import { formatBankMoneyWithUnit, normalizeBankMoneyFormatSettings, setBankMoneyFormatSettings } from "../utils/bankMoney";
import { resolveClassCurrencyUnit } from "../utils/currencyUnit";
const BankContext = createContext();
function toJsDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
export function BankProvider({
  children,
  provider = "firebase",
  selfhostSession = null
}) {
  const userContext = useUser() || {};
  const notificationContext = useNotifications();
  const isSelfhost = false;
  const userData = userContext.userData;
  const classId = userContext.classId;
  const classData = userContext.classData;
  const hasPermission = userContext.hasPermission || (() => false);
  const userLoading = userContext.loading;
  const isBankAdmin = hasPermission("bank_admin");
  const uid = userData?.uid;
  const profile = userData;
  const profileLoading = userLoading;
  const badgeCounts = useMemo(() => notificationContext?.badgeCounts || {}, [false, notificationContext?.badgeCounts, selfhostSession?.badgeCounts]);
  const [activeBankSurfaces, setActiveBankSurfaces] = useState({
    savings: false,
    loans: false,
    subscription: false
  });
  const providerOptions = useMemo(() => undefined, [false, selfhostSession?.apiBase, selfhostSession?.token]);
  const {
    settings,
    criteria,
    adjustments,
    isLoading: bankBaseLoading,
    hasReadError: bankBaseError,
    retry: retryBankBase
  } = useBankBase(classId, providerOptions);
  const {
    savings,
    loans,
    isLoading: bankDataLoading,
    hasReadError: bankUserError,
    retry: retryBankUser
  } = useBankUser(classId, uid, {
    savingsMode: activeBankSurfaces.savings ? "realtime" : "fetch",
    loansMode: activeBankSurfaces.loans ? "realtime" : "fetch",
    ...providerOptions
  });
  const {
    participations: subData,
    alerts: subAlerts,
    isLoading: subLoading,
    hasReadError: subError,
    retry: retrySubscription
  } = useSubscription(classId, uid, profile?.role, {
    includeProducts: false,
    participationsMode: activeBankSurfaces.subscription ? "realtime" : "fetch",
    ...providerOptions
  });
  const retryBankReads = useCallback(() => {
    retryBankBase();
    retryBankUser();
    retrySubscription();
  }, [retryBankBase, retryBankUser, retrySubscription]);
  const value = useMemo(() => {
    const moneyFormat = normalizeBankMoneyFormatSettings(settings?.moneyFormat);
    setBankMoneyFormatSettings(moneyFormat);
    const bankReadError = Boolean(bankBaseError || bankUserError || subError);
    const isLoading = !bankReadError && (profileLoading || bankBaseLoading || bankDataLoading || subLoading || !settings);
    const myScore = Number(profile?.creditScore || 0);
    const tierName = profile?.creditTier?.name || "무등급";
    const endOfToday = dayjs().endOf("day").toDate();
    const loanAlertThreshold = dayjs().add(3, "day").endOf("day").toDate();
    const summaryPendingCount = isBankAdmin ? Number(badgeCounts?.bank || 0) : 0;
    const totalPendingCount = isBankAdmin ? summaryPendingCount : 0;

    // Savings: actionable from maturity day onward.
    const actionableSavingsCount = (savings || []).filter(s => {
      const maturityDate = toJsDate(s?.expectedMaturityDate);
      return s.status === "active" && !!maturityDate && maturityDate <= endOfToday;
    }).length;

    // Loans: show from D-3 onward until repayment completes.
    const actionableLoansCount = (loans || []).filter(l => {
      const repaymentDate = toJsDate(l?.expectedRepaymentDate);
      return l.status === "ongoing" && !!repaymentDate && repaymentDate <= loanAlertThreshold;
    }).length;
    const actionableSubscriptionCount = subAlerts?.hasAction ? 1 : 0;
    const currencyUnit = resolveClassCurrencyUnit(classData);
    return {
      bankSettings: {
        ...(settings || {}),
        moneyFormat
      },
      bankMoneyFormatSettings: moneyFormat,
      tierCriteria: criteria || [],
      tierAdjustments: adjustments || {},
      studentProfile: profile,
      savings: savings || [],
      loans: loans || [],
      subscriptionProducts: [],
      myParticipations: subData || {},
      subscription: subData,
      isLoading,
      bankBaseLoading,
      bankReadError,
      retryBankReads,
      myScore,
      studentTierName: tierName,
      totalPendingCount,
      actionableSavingsCount,
      actionableLoansCount,
      actionableSubscriptionCount,
      subAlerts,
      currencyUnit,
      setActiveBankSurfaces,
      modifiers: adjustments?.[tierName] || {
        depositRateModifier: 0,
        loanRateModifier: 0,
        transferFee: 0
      },
      isBankReady: !bankReadError && !isLoading && !!profile && !!settings,
      getTierName: score => {
        const matched = (criteria || []).find(t => Number(t.minScore) === Number(score));
        return matched ? `${matched.name} 이상` : `${score}점 이상`;
      },
      formatCurrency: (amount, options = {}) => formatBankMoneyWithUnit(amount, currencyUnit, {
        settings: moneyFormat,
        ...options
      })
    };
  }, [settings, criteria, adjustments, profile, savings, loans, subData, subAlerts, classData, badgeCounts, isBankAdmin, setActiveBankSurfaces, profileLoading, bankDataLoading, bankBaseLoading, bankBaseError, bankUserError, retryBankReads, subLoading, subError]);
  return <BankContext.Provider value={value}>{children}</BankContext.Provider>;
}
export const useBank = () => {
  const context = useContext(BankContext);
  if (!context) {
    throw new Error("useBank must be used within a BankProvider");
  }
  return context;
};
