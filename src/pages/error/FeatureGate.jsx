import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePlanConfig } from "../../contexts/PlanConfigContext";

const PAGE_DISPLAY_NAMES = {
  bank: "은행",
  stock: "주식",
  mission: "과제",
  credentials: "칭호",
  caseLibrary: "가이드북",
  realestate: "부동산",
  assetManager: "경제 관리",
  arcade: "놀이터",
  police: "경찰",
  store: "상점",
  tax: "국세청",
  labor: "노동",
  news: "뉴스",
  assembly: "의회",
  jobBoard: "직업 게시판",
  marketplace: "마켓플레이스",
  credit: "신용",
};

const FeatureGate = ({ pageKey, serviceName, children }) => {
  const { checkPageAccess, loading, currentPlan } = usePlanConfig();
  const location = useLocation();
  const targetPageKey = pageKey || serviceName;

  if (loading) return null;

  const hasAccess = checkPageAccess(targetPageKey);
  if (hasAccess) return children;

  return (
    <Navigate
      to="/access-denied"
      replace
      state={{
        from: location,
        reason: "PLAN",
        service: PAGE_DISPLAY_NAMES[targetPageKey] || targetPageKey,
        plan: currentPlan,
      }}
    />
  );
};

export default FeatureGate;
