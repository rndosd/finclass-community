import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Landmark,
  LogOut,
  ReceiptText,
  Send,
  ShieldAlert,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";

import { useFundMode } from "../../contexts/FundModeContext";
import {
  FUND_CHANNEL_OPTIONS,
  getFundChannelAccess,
} from "../../domain/classFunds/fundPolicy";
import { useNumberFormat } from "../../contexts/NumberFormatContext";
import { useUser } from "../../contexts/UserContext";

const FUND_CHANNEL_SHORTCUTS = {
  manualExpense: {
    label: "직접 집행",
    to: "/tax?tab=budgetFunds",
    icon: ReceiptText,
  },
  storePurchase: {
    label: "상점",
    to: "/store?fundAction=pos",
    activePath: "/store",
    icon: ShoppingBag,
  },
  bankPayout: { label: "은행 지급", to: "/bank", icon: Send },
  realEstatePurchase: {
    label: "부동산",
    to: "/realestate",
    icon: Building2,
  },
  stockInvestment: { label: "주식 투자", to: "/stock", icon: TrendingUp },
};

const isShortcutActive = (location, channelKey) => {
  if (channelKey === "manualExpense") {
    return location.pathname === "/tax" &&
      new URLSearchParams(location.search).get("tab") === "budgetFunds";
  }
  const shortcut = FUND_CHANNEL_SHORTCUTS[channelKey];
  const activePath = shortcut?.activePath || shortcut?.to?.split("?")[0];
  return activePath ? location.pathname.startsWith(activePath) : false;
};

export default function FundModeRibbon() {
  const [starterFundId, setStarterFundId] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [collapsedPortalTarget, setCollapsedPortalTarget] = useState(null);
  const location = useLocation();
  const { classData, classId, userData } = useUser();
  const { formatClassCurrency } = useNumberFormat();
  const {
    activeFund,
    activeFundId,
    activeFunds,
    changeFund,
    exitFundMode,
    isFundMode,
    startFundMode,
  } = useFundMode();

  const collapsedStorageKey = classId && userData?.uid
    ? `finclass_fund_ribbon_collapsed:${classId}:${userData.uid}`
    : "";

  useEffect(() => {
    if (!collapsedStorageKey) {
      setIsCollapsed(false);
      return;
    }
    try {
      setIsCollapsed(sessionStorage.getItem(collapsedStorageKey) === "1");
    } catch (_error) {
      setIsCollapsed(false);
    }
  }, [collapsedStorageKey]);

  useEffect(() => {
    setCollapsedPortalTarget(document.getElementById("fund-mode-ribbon-collapsed-slot"));
  }, []);

  const updateCollapsed = (nextCollapsed) => {
    setIsCollapsed(nextCollapsed);
    if (!collapsedStorageKey) return;
    try {
      sessionStorage.setItem(collapsedStorageKey, nextCollapsed ? "1" : "0");
    } catch (_error) {
      // 저장소를 사용할 수 없어도 현재 화면의 접힘 상태는 유지한다.
    }
  };

  if (!isFundMode && !activeFunds.length) return null;

  const headerToggleControl = (
    <button
      type="button"
      onClick={() => updateCollapsed(!isCollapsed)}
      aria-expanded={!isCollapsed}
      aria-label={isCollapsed
        ? (isFundMode ? "기금 모드 상단바 펼치기" : "기금 상단바 펼치기")
        : "기금 상단바 접기"}
      className={`inline-flex h-9 min-w-0 max-w-[200px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-black shadow-sm transition ${
        isCollapsed
          ? "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
          : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
      }`}
    >
      <Landmark className="h-4 w-4 shrink-0" />
      <span className="shrink-0">{isFundMode ? "기금 모드" : "기금"}</span>
      {isFundMode && activeFund ? (
        <span className={`hidden min-w-0 truncate font-bold xl:inline ${
          isCollapsed ? "text-emerald-700" : "text-emerald-50"
        }`}>
          · {activeFund.name}
        </span>
      ) : null}
      {isCollapsed
        ? <ChevronDown className="h-4 w-4 shrink-0" />
        : <ChevronUp className="h-4 w-4 shrink-0" />}
    </button>
  );

  const headerToggle = collapsedPortalTarget
    ? createPortal(headerToggleControl, collapsedPortalTarget)
    : headerToggleControl;

  if (isCollapsed) return headerToggle;

  if (!isFundMode) {
    const selectedId = starterFundId || activeFunds[0]?.id || "";
    return (
      <>
        {headerToggle}
        <div className="border-b border-emerald-100 bg-emerald-50/70 px-3 py-2 sm:px-4">
        <div className="mx-auto flex max-w-[1600px] items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-black text-emerald-800">
            <Landmark className="h-4 w-4" /> 내 담당 기금
          </span>
          <select
            value={selectedId}
            onChange={(event) => setStarterFundId(event.target.value)}
            className="h-8 min-w-0 w-[190px] rounded-lg border border-emerald-200 bg-white px-2 text-xs font-bold text-emerald-900 outline-none"
            aria-label="담당 기금 선택"
          >
            {activeFunds.map((fund) => (
              <option key={fund.id} value={fund.id}>{fund.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => startFundMode(selectedId)}
            className="inline-flex h-8 items-center rounded-lg bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700"
          >
            운용 시작
          </button>
        </div>
        </div>
      </>
    );
  }

  const currencyUnit = classData?.currencyUnit || "단위";
  const isUnavailable = !activeFund || activeFund.status === "inactive";
  const shortcuts = FUND_CHANNEL_OPTIONS
    .map(({ key }) => ({
      key,
      ...FUND_CHANNEL_SHORTCUTS[key],
      access: getFundChannelAccess(activeFund, key),
    }))
    .filter(({ to }) => Boolean(to));

  return (
    <>
      {headerToggle}
      <div className="border-b border-emerald-200 bg-emerald-50 px-3 py-2 shadow-sm sm:px-4">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 overflow-hidden sm:flex-nowrap xl:gap-3">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1.5 text-xs font-black text-white xl:px-3">
          <Landmark className="h-3.5 w-3.5" />
          기금 모드
        </span>

        <select
          value={activeFundId}
          onChange={(event) => changeFund(event.target.value)}
          className="h-9 min-w-0 w-[180px] shrink rounded-xl border border-emerald-200 bg-white px-2.5 text-sm font-black text-emerald-900 outline-none focus:ring-2 focus:ring-emerald-200 sm:w-[220px] xl:w-[280px] xl:px-3"
          aria-label="사용할 기금 선택"
        >
          {isUnavailable ? (
            <option value={activeFundId}>사용할 수 없는 기금</option>
          ) : null}
          {activeFunds.map((fund) => (
            <option key={fund.id} value={fund.id}>
              {fund.name}
            </option>
          ))}
        </select>

        {activeFund ? (
          <div className="flex min-w-0 items-center gap-2 text-xs font-bold text-emerald-800 xl:gap-3 xl:text-sm">
            <span className="shrink-0 whitespace-nowrap">
              <span className="hidden sm:inline">사용 가능 </span>현금 {formatClassCurrency(Number(activeFund.cashBalance || 0))} {currencyUnit}
            </span>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
            <ShieldAlert className="h-4 w-4" /> 기금 상태를 확인해 주세요.
          </span>
        )}

        <nav
          aria-label="기금 사용처 바로가기"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {shortcuts.length ? shortcuts.map(({ key, label, to, icon: Icon, access }) => {
            const isActive = isShortcutActive(location, key);
            return access.allowed ? (
              <Link
                key={key}
                to={to}
                aria-current={isActive ? "page" : undefined}
                title={`${label}로 이동`}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-xs font-black transition xl:px-3 ${
                  isActive
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "border border-emerald-200 bg-white/80 text-emerald-800 hover:bg-emerald-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            ) : (
              <span
                key={key}
                aria-disabled="true"
                title={access.reason}
                className="inline-flex h-9 shrink-0 cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-100 bg-white/35 px-2.5 text-xs font-black text-emerald-700/35 xl:px-3"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </span>
            );
          }) : (
            <span className="px-2 text-xs font-bold text-emerald-700">
              사용 가능한 사용처가 없습니다.
            </span>
          )}
        </nav>

        <button
          type="button"
          onClick={exitFundMode}
          className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-2.5 text-xs font-black text-emerald-800 transition hover:bg-emerald-100 xl:px-3"
        >
          <LogOut className="h-3.5 w-3.5" />
          모드 종료
        </button>
      </div>
      </div>
    </>
  );
}
