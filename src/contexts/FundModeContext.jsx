import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { ENABLE_CLASS_FUNDS_ROLLOUT } from "../config/rolloutFlags";
import { getFundChannelAccess } from "../domain/classFunds/fundPolicy";
import { useUser } from "./UserContext";
import { useClassFundsQuery } from "../pages/tax/hooks/useTaxQuery";

const FundModeContext = createContext(null);

const storageKey = (classId, uid) =>
  `finclass_fund_mode:${String(classId || "")}:${String(uid || "")}`;

export const getClassFundValue = (fund = {}) => {
  const cashBalance = Number(fund.cashBalance || 0);
  const investmentValue = Number(fund.investmentValue || 0);
  const realEstateValue = Number(fund.realEstateValue || 0);
  if (fund.fundType === "investment" || fund.fundType === "pension") {
    return cashBalance + investmentValue + realEstateValue;
  }
  return cashBalance +
    Number(fund.pendingSettlementExpenseTotal || 0) +
    investmentValue +
    realEstateValue;
};

export const canUseFundChannel = (fund, channel) =>
  getFundChannelAccess(fund, channel).allowed;

export function FundModeProvider({ children }) {
  const { userData, classId, isTeacher, hasPermission } = useUser();
  const uid = userData?.uid;
  const canManageFunds = ENABLE_CLASS_FUNDS_ROLLOUT &&
    (isTeacher || hasPermission("tax_admin"));
  const canLoadAssignedFunds = ENABLE_CLASS_FUNDS_ROLLOUT && Boolean(classId && uid);
  const { data: classFunds = [] } = useClassFundsQuery(classId, {
    enabled: canLoadAssignedFunds,
    operatorUid: isTeacher ? "" : uid,
    debug: {
      source: "FundModeContext.classFunds",
      role: isTeacher ? "teacher" : "delegated",
    },
  });
  const [activeFundId, setActiveFundIdState] = useState("");

  useEffect(() => {
    if (!classId || !uid || !canLoadAssignedFunds) {
      setActiveFundIdState("");
      return;
    }

    try {
      setActiveFundIdState(sessionStorage.getItem(storageKey(classId, uid)) || "");
    } catch (_error) {
      setActiveFundIdState("");
    }
  }, [canLoadAssignedFunds, classId, uid]);

  const setActiveFundId = useCallback(
    (fundId) => {
      const nextFundId = String(fundId || "");
      setActiveFundIdState(nextFundId);
      if (!classId || !uid) return;
      try {
        if (nextFundId) {
          sessionStorage.setItem(storageKey(classId, uid), nextFundId);
        } else {
          sessionStorage.removeItem(storageKey(classId, uid));
        }
      } catch (_error) {
        // 세션 저장소를 사용할 수 없어도 현재 화면의 기금 모드는 유지한다.
      }
    },
    [classId, uid],
  );

  const activeFunds = useMemo(
    () => classFunds.filter((fund) => !fund.status || fund.status === "active"),
    [classFunds],
  );
  const activeFund = useMemo(
    () => classFunds.find((fund) => fund.id === activeFundId) || null,
    [activeFundId, classFunds],
  );
  const canOperateFund = useCallback(
    (fund) => Boolean(
      fund &&
      (!fund.status || fund.status === "active") &&
      (isTeacher || (Array.isArray(fund.operatorUids) && fund.operatorUids.includes(uid))),
    ),
    [isTeacher, uid],
  );
  const isFundMode = Boolean(activeFundId && canOperateFund(activeFund));
  const startFundMode = useCallback(
    (fundId) => {
      const fund = classFunds.find((item) => item.id === String(fundId || ""));
      if (canOperateFund(fund)) setActiveFundId(fund.id);
    },
    [canOperateFund, classFunds, setActiveFundId],
  );

  useEffect(() => {
    if (activeFundId && !canOperateFund(activeFund)) setActiveFundId("");
  }, [activeFund, activeFundId, canOperateFund, setActiveFundId]);

  const value = useMemo(
    () => ({
      activeFund,
      activeFundId,
      activeFunds,
      canManageFunds,
      canOperateFund,
      hasAssignedFunds: activeFunds.length > 0,
      isFundMode,
      startFundMode,
      changeFund: startFundMode,
      exitFundMode: () => setActiveFundId(""),
      getChannelAccess: (channel, options) =>
        getFundChannelAccess(activeFund, channel, options),
      canUseChannel: (channel, options) =>
        getFundChannelAccess(activeFund, channel, options).allowed,
    }),
    [activeFund, activeFundId, activeFunds, canManageFunds, canOperateFund, isFundMode, setActiveFundId, startFundMode],
  );

  return <FundModeContext.Provider value={value}>{children}</FundModeContext.Provider>;
}

export function useFundMode() {
  const context = useContext(FundModeContext);
  if (!context) {
    return {
      activeFund: null,
      activeFundId: "",
      activeFunds: [],
      canManageFunds: false,
      canOperateFund: () => false,
      hasAssignedFunds: false,
      isFundMode: false,
      startFundMode: () => {},
      changeFund: () => {},
      exitFundMode: () => {},
      getChannelAccess: (channel) => getFundChannelAccess(null, channel),
      canUseChannel: () => false,
    };
  }
  return context;
}
