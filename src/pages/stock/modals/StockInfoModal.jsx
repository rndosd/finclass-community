import { appAlert } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  CardSkeleton,
  InputField,
  Modal,
  SectionLoader,
  Tabs,
} from "../../../components/ui";
import ModernRichEditor from "../../../components/ui/modernricheditor/ModernRichEditor";
import {
  BookOpen,
  Building2,
  CircleDollarSign,
  Coins,
  Edit3,
  FileText,
  GraduationCap,
  Landmark,
  PieChart,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
} from "recharts";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useStockContext } from "../../../contexts/StockContext";
import { useUser } from "../../../contexts/UserContext";
import { getDefaultStockProfile } from "../../../config/defaultStockProfiles";
import { STOCK_CATALOG_BY_TICKER } from "../../../config/stockCatalog";
import { db } from "../../../firebase";
import { useStockEarnings } from "../../../hooks/stock/useStockEarnings";
import { useStockEtfProfile } from "../../../hooks/stock/useStockEtfProfile";
import { sanitizeRichHtml } from "../../../utils/sanitizeRichHtml";
import { getEarningsPeriodCopy } from "../utils/earningsPeriod";

const fetchStockInfo = async (classId, symbol) => {
  if (!classId || !symbol) return null;

  const classStockDocRef = doc(db, "classes", classId, "stockInfo", symbol);
  const docSnap = await getDoc(classStockDocRef);

  if (!docSnap.exists()) {
    return null;
  }

  return docSnap.data();
};

const formatDateLabel = (value) => {
  if (!value) return "-";

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleDateString("ko-KR");
  }

  const source =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T12:00:00`
      : value;
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("ko-KR");
};

const formatDateTimeLabel = (value) => {
  if (!value) return "-";

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString("ko-KR");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("ko-KR");
};

const toNullableNumber = (value) => {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const formatAmountLabel = (formatFin, value, currency = "USD") => {
  const numericValue = toNullableNumber(value);
  if (numericValue == null || numericValue <= 0) return "-";

  return `${formatFin(numericValue, {
    fractionDigits: 4,
    trimTrailingZeros: true,
  })} ${currency}`;
};

const formatPositivePercentLabel = (formatPercent, value) => {
  const numericValue = toNullableNumber(value);
  if (numericValue == null || numericValue <= 0) return "-";
  return `${formatPercent(numericValue, {
    fractionDigits: 2,
    trimTrailingZeros: true,
  })}%`;
};

const formatSignedPercentLabel = (formatPercent, value) => {
  const numericValue = toNullableNumber(value);
  if (numericValue == null) return "-";

  const prefix = numericValue > 0 ? "+" : "";
  return `${prefix}${formatPercent(numericValue, {
    fractionDigits: 1,
    trimTrailingZeros: true,
  })}%`;
};

const formatCompactUsd = (formatFin, value) => {
  const numericValue = toNullableNumber(value);
  if (numericValue == null) return "-";

  return `$${formatFin(numericValue, {
    compact: true,
    compactFractionDigits: 1,
    fractionDigits: 1,
  })}`;
};

const formatUsdValue = (formatFin, value, fractionDigits = 2) => {
  const numericValue = toNullableNumber(value);
  if (numericValue == null) return "-";

  return `$${formatFin(numericValue, {
    fractionDigits,
    trimTrailingZeros: true,
  })}`;
};

const formatQuarterLabel = (quarter) => {
  const year = Number(quarter?.year);
  if (quarter?.periodType === "annual" && Number.isInteger(year)) {
    return `${year}년 연간`;
  }
  const fiscalPeriod = String(quarter?.fiscalPeriod || quarter?.fp || "")
    .trim()
    .toUpperCase();
  const fiscalMatch = fiscalPeriod.match(/^Q([1-4])$/);
  const frame = String(quarter?.frame || "")
    .trim()
    .toUpperCase();
  const frameMatch = frame.match(/Q([1-4])$/);
  const quarterNumber =
    fiscalMatch
      ? Number(fiscalMatch[1])
      : frameMatch
        ? Number(frameMatch[1])
        : Number(quarter?.quarter);

  if (Number.isInteger(year) && Number.isInteger(quarterNumber)) {
    return `${year}년 ${quarterNumber}분기`;
  }

  const period = typeof quarter?.period === "string" ? quarter.period : null;
  if (period && /^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const parsed = new Date(`${period}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      const derivedQuarter = Math.floor(parsed.getMonth() / 3) + 1;
      return `${parsed.getFullYear()}년 ${derivedQuarter}분기`;
    }
  }

  return quarter?.label || "-";
};

const formatShareCountLabel = (formatFin, value) => {
  const numericValue = toNullableNumber(value);
  if (numericValue == null) return "-";

  return `${formatFin(numericValue, {
    compact: true,
    compactFractionDigits: 1,
    fractionDigits: 1,
  })}주`;
};

const getEarningsMetricValue = (period, usdKey) => {
  const amountKey = String(usdKey || "").replace(/USD$/, "Amount");
  return toNullableNumber(period?.[amountKey] ?? period?.[usdKey]);
};

const formatReportedAmount = (formatFin, value, currency = "USD") => {
  const numericValue = toNullableNumber(value);
  if (numericValue == null) return "-";

  const normalizedCurrency = String(currency || "USD").toUpperCase();
  const currencySymbols = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    KRW: "₩",
    CNY: "CN¥",
    TWD: "NT$",
  };
  const formatted = formatFin(numericValue, {
    compact: true,
    compactFractionDigits: 1,
    fractionDigits: 1,
  });
  return currencySymbols[normalizedCurrency]
    ? `${currencySymbols[normalizedCurrency]}${formatted}`
    : `${formatted} ${normalizedCurrency}`;
};

const formatReportedEps = (formatFin, value, currency = "USD") =>
  formatReportedAmount(formatFin, value, currency);

const sumQuarterMetric = (quarters, key) => {
  const values = quarters
    .map((quarter) => getEarningsMetricValue(quarter, key))
    .filter((value) => value != null);

  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
};

const buildLocalEarningsSummary = (latestQuarter, formatFin) => {
  if (!latestQuarter) {
    return {
      headline: "최근 분기 실적이 아직 준비되지 않았어요.",
      bullets: ["분기 실적은 SEC 공시가 들어오면 이 탭에서 바로 볼 수 있어요."],
    };
  }

  const revenueYoYPercent = toNullableNumber(latestQuarter.revenueYoYPercent);
  const isAnnual = latestQuarter.periodType === "annual";
  const currency = latestQuarter.reportedCurrency || "USD";
  const netIncomeUSD = getEarningsMetricValue(latestQuarter, "netIncomeUSD");
  let headline = `최근 ${isAnnual ? "연간" : "분기"} 실적이 업데이트됐어요.`;

  if (revenueYoYPercent != null) {
    if (revenueYoYPercent >= 5) {
      headline = `매출이 ${isAnnual ? "지난해" : "전년 동기"}보다 늘었어요.`;
    } else if (revenueYoYPercent <= -5) {
      headline = `매출이 ${isAnnual ? "지난해" : "전년 동기"}보다 줄었어요.`;
    }
  } else if (netIncomeUSD != null) {
    headline =
      netIncomeUSD >= 0
        ? `최근 ${isAnnual ? "연간" : "분기"}에는 흑자를 기록했어요.`
        : `최근 ${isAnnual ? "연간" : "분기"}에는 적자를 기록했어요.`;
  }

  const bullets = [];

  if (toNullableNumber(latestQuarter.actualEPS) != null) {
    bullets.push(
      `희석 EPS는 ${formatReportedEps(formatFin, latestQuarter.actualEPS, currency)}예요.`,
    );
  }

  const revenueAmount = getEarningsMetricValue(latestQuarter, "revenueUSD");
  if (revenueAmount != null) {
    const revenueLabel = formatReportedAmount(formatFin, revenueAmount, currency);
    if (revenueYoYPercent != null) {
      bullets.push(
        `매출은 ${revenueLabel}이고 전년 동기 대비 ${revenueYoYPercent > 0 ? "+" : ""}${revenueYoYPercent.toFixed(1)}%예요.`,
      );
    } else {
      bullets.push(`매출은 ${revenueLabel}예요.`);
    }
  }

  if (netIncomeUSD != null) {
    const netIncomeYoYPercent = toNullableNumber(latestQuarter.netIncomeYoYPercent);
    const netIncomeLabel = formatReportedAmount(formatFin, netIncomeUSD, currency);
    if (netIncomeYoYPercent != null) {
      bullets.push(
        `순이익은 ${netIncomeLabel}이고 전년 동기 대비 ${netIncomeYoYPercent > 0 ? "+" : ""}${netIncomeYoYPercent.toFixed(1)}%예요.`,
      );
    } else {
      bullets.push(`순이익은 ${netIncomeLabel}예요.`);
    }
  }

  return {
    headline,
    bullets:
      bullets.length > 0
        ? bullets.slice(0, 3)
        : ["아래에서 확보된 분기별 실적을 확인할 수 있어요."],
  };
};

const getQuarterKey = (quarter) => {
  const label = formatQuarterLabel(quarter);
  return label && label !== "-" ? label : quarter?.period || quarter?.label || "";
};

const getQuarterDataScore = (quarter) =>
  [
    quarter?.actualEPS,
    quarter?.estimateEPS,
    quarter?.revenueUSD,
    quarter?.revenueAmount,
    quarter?.netIncomeUSD,
    quarter?.netIncomeAmount,
    quarter?.operatingIncomeUSD,
    quarter?.operatingIncomeAmount,
    quarter?.assetsUSD,
    quarter?.liabilitiesUSD,
    quarter?.cashUSD,
    quarter?.sharesOutstanding,
    quarter?.form,
    quarter?.filedAt,
    quarter?.period,
  ].reduce((score, value) => (value == null || value === "" ? score : score + 1), 0);

const dedupeQuartersByLabel = (quarters) => {
  const byQuarterKey = new Map();

  quarters.forEach((quarter, index) => {
    const quarterKey = getQuarterKey(quarter) || `unknown-${index}`;
    const existingQuarter = byQuarterKey.get(quarterKey);

    if (
      !existingQuarter ||
      getQuarterDataScore(quarter) > getQuarterDataScore(existingQuarter)
    ) {
      byQuarterKey.set(quarterKey, quarter);
    }
  });

  return Array.from(byQuarterKey.values());
};

const translateExchangeLabel = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "-";

  const exchangeMap = {
    NASDAQ: "나스닥",
    NYSE: "뉴욕증권거래소",
    "NYSE American": "NYSE 아메리칸",
    "NYSE Arca": "NYSE 아카",
    "Cboe BZX": "Cboe BZX",
    "Cboe EDGX": "Cboe EDGX",
    AMEX: "아멕스",
  };

  return exchangeMap[normalized] || normalized;
};

const LoadingState = ({
  label = "불러오는 중...",
  minHeightClassName = "min-h-[260px]",
}) => (
  <SectionLoader
    loading
    message={label}
    minHeightClassName={minHeightClassName}
    skeleton={<CardSkeleton bare className="h-full min-h-full" rows={5} />}
  />
);

const EmptyState = ({
  icon: Icon,
  title,
  description,
  tone = "slate",
}) => {
  const toneClassMap = {
    slate: "bg-slate-50 text-slate-400",
    blue: "bg-blue-50 text-blue-400",
    emerald: "bg-emerald-50 text-emerald-400",
  };

  return (
    <div className="rounded-[2rem] border border-slate-100 bg-slate-50/60 px-6 py-14 text-center">
      <div
        className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${
          toneClassMap[tone] || toneClassMap.slate
        }`}
      >
        <Icon className="h-8 w-8" />
      </div>
      <h4 className="text-lg font-black text-slate-800">{title}</h4>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
};

const StatCard = ({ title, value, hint, tone = "slate" }) => {
  const toneClassMap = {
    slate: "from-slate-50 to-white text-slate-900",
    blue: "from-blue-50 to-white text-blue-900",
    emerald: "from-emerald-50 to-white text-emerald-900",
    rose: "from-rose-50 to-white text-rose-900",
    amber: "from-amber-50 to-white text-amber-900",
  };

  return (
    <div
      className={`rounded-[1.6rem] border border-slate-100 bg-gradient-to-br px-5 py-4 shadow-sm ${
        toneClassMap[tone] || toneClassMap.slate
      }`}
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
        {title}
      </p>
      <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-xs font-medium text-slate-500">{hint}</p>
    </div>
  );
};

const InfoContent = ({
  classStockInfo,
  catalogStock,
  defaultStockInfo,
  earningsData,
  isEtf,
  isEarningsLoading,
  isTeacher,
  isEditing,
  isLoading,
  editForm,
  formatFin,
  setEditForm,
}) => {
  const profile = earningsData?.profile || {};
  const exchangeLabel = translateExchangeLabel(profile.exchange);
  const securityInfoSection = isEtf ? (
    <div className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-black text-slate-900">ETF 기본 정보</h4>
          <p className="mt-1 text-sm text-slate-500">
            ETF는 기업 실적보다 어떤 자산에 나누어 투자하는지 살펴보는 상품이에요.
          </p>
        </div>
        <Badge tone="blue" size="sm" className="font-black">
          ETF
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <StatCard
          title="상품 유형"
          value="상장지수펀드"
          hint="거래소에서 주식처럼 사고팔 수 있어요"
          tone="blue"
        />
        <StatCard
          title="투자 분류"
          value={catalogStock?.categoryName || defaultStockInfo?.category || "ETF"}
          hint="상품이 주로 투자하는 시장과 자산 기준"
          tone="slate"
        />
      </div>
    </div>
  ) : earningsData ? (
    <div className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-lg font-black text-slate-900">기업 기본 정보</h4>
          <p className="mt-1 text-sm text-slate-500">
            종목 자체 정보는 여기서 보고, 실적 탭에서는 분기별 숫자 비교에 집중해요.
          </p>
        </div>
        <Badge tone="slate" size="sm" className="font-black">
          {earningsData.source === "sec" ? "SEC 기준" : "캐시 기준"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="시가총액"
          value={formatCompactUsd(formatFin, profile.marketCapUSD)}
          hint="현재 주가 x SEC 발행주식 수 기준"
          tone="amber"
        />
        <StatCard
          title="발행주식 수"
          value={formatShareCountLabel(formatFin, profile.sharesOutstanding)}
          hint="SEC 최신 공시 기준"
          tone="blue"
        />
        <StatCard
          title="거래소"
          value={exchangeLabel}
          hint="미국 상장 거래소"
          tone="slate"
        />
        <StatCard
          title="최근 분기"
          value={
            earningsData.latestQuarter
              ? formatQuarterLabel(earningsData.latestQuarter)
              : "-"
          }
          hint="가장 최근 공시가 반영된 분기"
          tone="slate"
        />
      </div>
    </div>
  ) : isEarningsLoading ? (
    <LoadingState label="기업 기본 정보를 불러오는 중..." />
  ) : null;

  const hasClassDescription = Boolean(classStockInfo?.content);
  const displayTitle = hasClassDescription
    ? classStockInfo?.title || defaultStockInfo?.title
    : defaultStockInfo?.title;
  const displayContent = hasClassDescription
    ? classStockInfo.content
    : defaultStockInfo?.content;
  const isShowingDefaultDescription =
    !hasClassDescription && Boolean(defaultStockInfo?.content);

  if (isTeacher && isEditing) {
    return (
      <div className="space-y-6">
        {securityInfoSection}
        <InputField
          id="title"
          label="제목"
          placeholder="주식 정보 제목을 입력하세요"
          value={editForm.title}
          onChange={(event) =>
            setEditForm((prev) => ({ ...prev, title: event.target.value }))
          }
        />

        <ModernRichEditor
          id="content"
          label="내용"
          placeholder="학생들에게 전달할 주식 정보를 입력하세요."
          height="300px"
          toolbar="standard"
          value={editForm.content}
          onChange={(content) => setEditForm((prev) => ({ ...prev, content }))}
        />

        <ModernRichEditor
          id="teacher-notes"
          label="교사 메모 (학생 비공개)"
          placeholder="개인적인 교사 메모"
          height="150px"
          toolbar="simple"
          value={editForm.teacherNotes}
          onChange={(content) =>
            setEditForm((prev) => ({ ...prev, teacherNotes: content }))
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {securityInfoSection}

      {isLoading ? <LoadingState label="학급 설명을 불러오는 중..." /> : null}

      {!isLoading && displayTitle ? (
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-2xl font-black text-slate-800">
            {displayTitle}
          </h4>
          {isShowingDefaultDescription ? (
            <Badge tone="blue" size="sm" className="font-black">
              공용 기본 설명
            </Badge>
          ) : null}
        </div>
      ) : null}

      {!isLoading && displayContent ? (
        <div className="prose prose-slate max-w-none">
          <div
            className="min-h-[200px] rounded-[1.75rem] border border-slate-200 bg-white p-6"
            dangerouslySetInnerHTML={{
              __html: sanitizeRichHtml(displayContent),
            }}
          />
        </div>
      ) : !isLoading ? (
        <EmptyState
          icon={classStockInfo ? FileText : GraduationCap}
          title={
            classStockInfo
              ? "등록된 종목 설명이 없어요"
              : isTeacher
                ? "학급 설명을 아직 적지 않았어요"
                : "학급 설명이 아직 없어요"
          }
          description={
            classStockInfo
              ? isTeacher
                ? "편집 버튼을 눌러 학생들이 읽을 설명을 추가해 주세요."
                : "선생님이 설명을 추가하면 여기에서 바로 볼 수 있어요."
              : isTeacher
                ? "편집 버튼을 눌러 학생들이 읽을 종목 설명과 교사용 메모를 남길 수 있어요."
                : "선생님이 이 종목에 대한 학급 설명을 준비하면 여기에서 바로 볼 수 있어요."
          }
        />
      ) : null}

      {isTeacher && classStockInfo?.teacherNotes ? (
        <div className="border-t border-slate-100 pt-6">
          <h5 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-700">
            <GraduationCap className="h-4 w-4" />
            교사 메모 (학생 비공개)
          </h5>
          <div
            className="prose prose-sm max-w-none rounded-[1.5rem] border border-yellow-200 bg-yellow-50 p-4"
            dangerouslySetInnerHTML={{
              __html: sanitizeRichHtml(classStockInfo.teacherNotes),
            }}
          />
        </div>
      ) : null}

      {classStockInfo?.lastUpdated ? (
        <div className="border-t border-slate-100 pt-4 text-xs text-slate-400">
          마지막 수정: {formatDateTimeLabel(classStockInfo.lastUpdated)}
        </div>
      ) : null}
    </div>
  );
};

const DividendContent = ({
  dividendInfo,
  dividendSummary,
  isEtf,
  isInfoLoading,
}) => {
  if (isInfoLoading && !dividendSummary) {
    return (
      <LoadingState label={`${isEtf ? "분배금" : "배당"} 정보를 정리하는 중...`} />
    );
  }

  if (!dividendInfo || !dividendSummary) {
    return (
      <EmptyState
        icon={Coins}
        title={`표시할 ${isEtf ? "분배금" : "배당"} 정보가 아직 없어요`}
        description={`${isEtf ? "분배금" : "배당"} 정책이나 실제 지급 일정이 연결되면 이 탭에서 한눈에 확인할 수 있어요.`}
        tone="emerald"
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={dividendSummary.badgeTone}
                size="sm"
                className="font-black"
              >
                {isEtf
                  ? dividendInfo.isClassPolicy
                    ? "학급 분배금"
                    : "분배 일정"
                  : dividendSummary.badgeLabel}
              </Badge>
              <Badge tone="slate" size="sm" className="font-black">
                {dividendSummary.frequencyLabel}
              </Badge>
            </div>
            <p className="mt-3 text-lg font-black text-emerald-900">
              1주당 {dividendSummary.amountLabel}
            </p>
          </div>
          <div className="rounded-2xl bg-white/80 px-4 py-3 text-right text-xs font-medium text-emerald-900/80">
            <div>다음 지급일 {dividendSummary.payDateLabel}</div>
            <div>배당락일 {dividendSummary.exDateLabel}</div>
          </div>
        </div>

        <div
          className={`mt-4 grid gap-3 ${
            dividendInfo?.isClassPolicy ? "sm:grid-cols-5" : "sm:grid-cols-3"
          }`}
        >
          <StatCard
            title={isEtf ? "주당 분배금" : "주당 배당금"}
            value={dividendSummary.amountLabel}
            hint="학생이 1주를 보유했을 때 기준"
            tone="emerald"
          />
          <StatCard
            title="배당락일"
            value={dividendSummary.exDateLabel}
            hint={`이 날짜 전까지 보유해야 ${isEtf ? "분배금을" : "배당을"} 받을 수 있어요`}
            tone="blue"
          />
          <StatCard
            title="지급일"
            value={dividendSummary.payDateLabel}
            hint="실제 지급 예정일"
            tone="slate"
          />
          {dividendInfo?.isClassPolicy ? (
            <>
              <StatCard
                title="목표 수익률"
                value={dividendSummary.classYieldLabel}
                hint="학급 정책 기준"
                tone="amber"
              />
              <StatCard
                title="배당 준비 기간"
                value={
                  Number.isFinite(Number(dividendSummary.leadDays))
                    ? `${dividendSummary.leadDays}영업일`
                    : "-"
                }
                hint="배당락일 전에 확보해야 하는 기간"
                tone="slate"
              />
            </>
          ) : null}
        </div>

        {dividendInfo?.isClassPolicy &&
        dividendSummary.referenceYieldLabel !== "-" ? (
          <p className="mt-3 text-xs font-medium text-emerald-900/80">
            참고 원본 배당수익률은 {dividendSummary.referenceYieldLabel}예요.
          </p>
        ) : null}
      </div>
    </div>
  );
};

const BREAKDOWN_COLORS = ["#3b82f6", "#34d399", "#fbbf24", "#cbd5e1"];

const ETF_SECTOR_LABELS = {
  "COMMUNICATION SERVICES": "통신·미디어",
  "CONSUMER DISCRETIONARY": "선택소비재",
  "CONSUMER STAPLES": "필수소비재",
  ENERGY: "에너지",
  FINANCIALS: "금융",
  "FINANCIAL SERVICES": "금융",
  "HEALTH CARE": "헬스케어",
  HEALTHCARE: "헬스케어",
  INDUSTRIALS: "산업재",
  "INFORMATION TECHNOLOGY": "정보기술",
  MATERIALS: "소재",
  "REAL ESTATE": "부동산",
  UTILITIES: "유틸리티",
};

const formatEtfSectorLabel = (value) => {
  const source = String(value || "").trim();
  if (!source) return "기타";
  return ETF_SECTOR_LABELS[source.toUpperCase()] || source;
};

const VisualBreakdown = ({ title, items, centerLabel, icon: CenterIcon }) => {
  const chartItems = items
    .map((item, index) => ({
      ...item,
      value: Math.max(0, Number(item.value) || 0),
      color: item.color || BREAKDOWN_COLORS[index % BREAKDOWN_COLORS.length],
    }))
    .filter((item) => item.value > 0);

  if (!chartItems.length) return null;

  return (
    <div>
      <h4 className="text-lg font-bold text-slate-900">{title}</h4>
      <div className="mt-4 grid items-center gap-5 sm:grid-cols-[minmax(220px,0.95fr),minmax(180px,0.7fr)] lg:grid-cols-1 xl:grid-cols-[minmax(220px,0.95fr),minmax(180px,0.7fr)]">
        <div className="relative mx-auto h-[250px] w-full max-w-[300px]" aria-label={title}>
          <ResponsiveContainer width="100%" height="100%">
            <RechartsPieChart>
              <Pie
                data={chartItems}
                dataKey="value"
                nameKey="name"
                innerRadius={68}
                outerRadius={108}
                paddingAngle={2}
                stroke="#ffffff"
                strokeWidth={3}
                isAnimationActive={false}
              >
                {chartItems.map((item) => (
                  <Cell key={item.name} fill={item.color} />
                ))}
              </Pie>
            </RechartsPieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <CenterIcon className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="mt-2 max-w-[110px] text-xs font-bold leading-5 text-slate-500">
              {centerLabel}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {chartItems.map((item) => (
            <div key={item.name} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <span className="truncate text-sm font-semibold text-slate-600">
                  {item.name}
                </span>
              </div>
              <span className="shrink-0 text-sm font-black tabular-nums text-slate-900">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const MetricRow = ({ icon: Icon, label, value, comparison, tone = "blue" }) => {
  const toneClasses = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-500",
  };

  return (
    <div className="flex items-center gap-3 border-t border-slate-100 py-4 first:border-t-0 first:pt-0 last:pb-0">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${toneClasses[tone] || toneClasses.blue}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-500">{label}</p>
        <p className="mt-1 truncate text-xl font-black tabular-nums text-slate-900">
          {value}
        </p>
      </div>
      {comparison ? (
        <span className="max-w-[140px] text-right text-xs font-bold leading-5 text-slate-500">
          {comparison}
        </span>
      ) : null}
    </div>
  );
};

const ETF_CATEGORY_GUIDANCE = {
  "미국·글로벌 지수 ETF": "추종 지수와 국가·기업 규모별 비중을 함께 확인해 보세요.",
  "국가·지역 ETF": "해당 국가의 산업 비중과 환율 변화가 가격에 미치는 영향을 확인해 보세요.",
  "채권·현금 ETF": "보유 채권의 만기, 금리 민감도와 신용 위험을 확인해 보세요.",
  "배당·팩터 ETF": "종목을 고르는 기준과 분배금의 지속 가능성을 확인해 보세요.",
  "원자재·통화 ETF": "현물·선물 투자 방식과 환율, 선물 교체 비용을 확인해 보세요.",
  "테마·섹터 ETF": "특정 산업에 집중된 정도와 상위 구성 종목의 비중을 확인해 보세요.",
};

const ETF_SOURCE_LABELS = {
  alphavantage: "Alpha Vantage",
  ishares: "iShares 공식 자료",
};

const EtfProfileContent = ({
  catalogStock,
  defaultStockInfo,
  etfProfileData,
  isEtfProfileLoading,
  formatFin,
  formatPercent,
}) => {
  const categoryName =
    catalogStock?.categoryName || defaultStockInfo?.category || "ETF";
  const categoryGuidance =
    ETF_CATEGORY_GUIDANCE[categoryName] ||
    "어떤 자산을 담는지와 가격 변동 위험을 함께 확인해 보세요.";
  const explorationKeywords = Array.isArray(catalogStock?.explorationKeywords)
    ? catalogStock.explorationKeywords.filter(Boolean)
    : [];
  const riskTags = Array.isArray(catalogStock?.riskTags)
    ? catalogStock.riskTags.filter(Boolean)
    : [];
  const profile = etfProfileData?.profile || {};
  const holdings = Array.isArray(etfProfileData?.holdings)
    ? etfProfileData.holdings
    : [];
  const sectorExposures = Array.isArray(etfProfileData?.sectorExposures)
    ? etfProfileData.sectorExposures
    : [];
  const sourceLinks = Array.isArray(etfProfileData?.sourceLinks)
    ? etfProfileData.sourceLinks.filter((source) => source?.id && source?.url)
    : [];
  const formatEtfPercent = (value) => {
    const numericValue = toNullableNumber(value);
    if (numericValue == null) return "-";
    return `${formatPercent(numericValue, {
      fractionDigits: 2,
      trimTrailingZeros: true,
    })}%`;
  };
  const chartSource = sectorExposures.length > 0 ? sectorExposures : holdings;
  const chartItems = chartSource.slice(0, 3).map((item) => ({
    name:
      sectorExposures.length > 0
        ? formatEtfSectorLabel(item.name)
        : item.name || item.symbol || "기타",
    value: toNullableNumber(item.weightPercent) || 0,
    label: formatEtfPercent(item.weightPercent),
  }));
  const chartTotal = chartItems.reduce((sum, item) => sum + item.value, 0);
  if (chartItems.length > 0 && chartTotal < 99) {
    chartItems.push({
      name: "그 밖의 구성",
      value: Math.max(0, 100 - chartTotal),
      label: formatEtfPercent(Math.max(0, 100 - chartTotal)),
      color: BREAKDOWN_COLORS[3],
    });
  }

  if (isEtfProfileLoading && !etfProfileData) {
    return <LoadingState label="ETF 구성과 운용 정보를 불러오는 중..." />;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-6 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 lg:grid-cols-[1.08fr,0.92fr]">
        {chartItems.length > 0 ? (
          <VisualBreakdown
            title="이 바구니의 모습"
            items={chartItems}
            centerLabel={sectorExposures.length > 0 ? "분야별 비중" : "대표 종목 비중"}
            icon={PieChart}
          />
        ) : (
          <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl bg-slate-50 px-6 text-center">
            <PieChart className="h-10 w-10 text-blue-500" aria-hidden="true" />
            <h4 className="mt-4 text-lg font-bold text-slate-900">구성 정보를 준비하고 있어요</h4>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              자료가 들어오면 분야와 대표 종목을 원형으로 보여줄게요.
            </p>
          </div>
        )}

        <div className="border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="flex items-start gap-3 pb-5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Building2 className="h-7 w-7" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xl font-black text-slate-900">
                {etfProfileData?.holdingCount
                  ? `${formatFin(etfProfileData.holdingCount)}곳에 나눠 투자해요`
                  : "여러 곳에 나눠 투자해요"}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {categoryName} 중심의 투자 바구니예요.
              </p>
            </div>
          </div>
          <MetricRow
            icon={CircleDollarSign}
            label="1년에 드는 비용"
            value={formatEtfPercent(profile.netExpenseRatioPercent)}
            comparison="펀드 운영 비용"
            tone="blue"
          />
          <MetricRow
            icon={Coins}
            label="분배금 참고 비율"
            value={formatEtfPercent(profile.dividendYieldPercent)}
            comparison="지난 분배금 기준"
            tone="emerald"
          />
          <MetricRow
            icon={Landmark}
            label="펀드 크기"
            value={formatCompactUsd(formatFin, profile.netAssetsUSD)}
            tone="slate"
          />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-900">
        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
        <p>여러 회사와 분야를 함께 담아 위험을 나눠요. {categoryGuidance}</p>
      </div>

      {holdings.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-lg font-bold text-slate-900">대표 종목</h4>
            <span className="text-xs font-bold text-slate-400">
              상위 {Math.min(5, holdings.length)}개
            </span>
          </div>
          <div className="mt-4 divide-y divide-slate-100">
            {holdings.slice(0, 5).map((holding, index) => (
              <div
                key={`${holding.symbol || holding.name}-${index}`}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-xs font-black text-slate-700">
                  {holding.symbol?.slice(0, 4) || index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {holding.name || holding.symbol || "이름 정보 없음"}
                  </p>
                  {holding.symbol ? (
                    <p className="mt-0.5 text-xs font-semibold text-slate-400">
                      {holding.symbol}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-black tabular-nums text-blue-700">
                  {formatEtfPercent(holding.weightPercent)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={PieChart}
          title="이 ETF의 투자 바구니를 준비하고 있어요"
          description={
            etfProfileData
              ? "펀드 크기와 비용은 확인됐지만, 구성 종목은 아직 자료에 없어요. 다음 자료 확인 때 더 채워질 수 있어요."
              : "자료를 모으는 중이에요. 기본 ETF와 우리 반이 가진 ETF는 더 자주 확인해요."
          }
          tone="blue"
        />
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-lg font-bold text-slate-900">이 자료는 언제 확인했을까?</h4>
            <p className="mt-1 text-sm text-slate-500">
              구성 종목 기준일 {formatDateLabel(etfProfileData?.dataAsOf)} · 마지막 확인 {formatDateTimeLabel(etfProfileData?.lastSyncedAt)}
            </p>
          </div>
          {etfProfileData?.coverage ? (
            <Badge
              tone={etfProfileData.coverage === "complete" ? "emerald" : "amber"}
              size="sm"
              className="font-black"
            >
              {etfProfileData.coverage === "complete" ? "구성 종목까지 확인" : "일부 정보만 확인"}
            </Badge>
          ) : null}
        </div>

        {sourceLinks.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {sourceLinks.map((source) => (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
              >
                {ETF_SOURCE_LABELS[source.id] || source.id} 원문
              </a>
            ))}
          </div>
        ) : null}

        {explorationKeywords.length > 0 || riskTags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {[...explorationKeywords, ...riskTags].map((label) => (
              <Badge key={label} tone="slate" size="sm">
                {label}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const EarningsContent = ({
  earningsData,
  isEarningsLoading,
  isIndex,
  catalogStock,
  defaultStockInfo,
  formatFin,
  formatPercent,
}) => {
  const recentYearQuarters = useMemo(
    () =>
      dedupeQuartersByLabel(
        Array.isArray(earningsData?.quarters) ? earningsData.quarters : [],
      ).slice(0, 4),
    [earningsData?.quarters],
  );
  const [selectedQuarterKey, setSelectedQuarterKey] = useState("");
  const isAnnualData = recentYearQuarters[0]?.periodType === "annual";
  const summaryPeriods = isAnnualData
    ? recentYearQuarters.slice(0, 1)
    : recentYearQuarters;
  const trailingRevenueUSD = sumQuarterMetric(summaryPeriods, "revenueUSD");
  const trailingNetIncomeUSD = sumQuarterMetric(summaryPeriods, "netIncomeUSD");
  const trailingOperatingIncomeUSD = sumQuarterMetric(
    summaryPeriods,
    "operatingIncomeUSD",
  );
  const metricPeriodCopy = (name, key) => getEarningsPeriodCopy(
    name,
    summaryPeriods.filter(period => getEarningsMetricValue(period, key) != null).length,
    isAnnualData,
  );
  const revenuePeriodCopy = metricPeriodCopy("매출", "revenueUSD");
  const netIncomePeriodCopy = metricPeriodCopy("순이익", "netIncomeUSD");
  const operatingIncomePeriodCopy = metricPeriodCopy("영업이익", "operatingIncomeUSD");

  useEffect(() => {
    if (!recentYearQuarters.length) {
      setSelectedQuarterKey("");
      return;
    }

    const currentKeys = recentYearQuarters.map(getQuarterKey);
    if (!selectedQuarterKey || !currentKeys.includes(selectedQuarterKey)) {
      setSelectedQuarterKey(getQuarterKey(recentYearQuarters[0]));
    }
  }, [recentYearQuarters, selectedQuarterKey]);

  const selectedQuarter =
    recentYearQuarters.find(
      (quarter) => getQuarterKey(quarter) === selectedQuarterKey,
    ) ||
    recentYearQuarters[0] ||
    null;
  const summary = buildLocalEarningsSummary(selectedQuarter, formatFin);
  const selectedCurrency =
    selectedQuarter?.reportedCurrency || earningsData?.metadata?.reportedCurrency || "USD";
  const selectedRevenue = getEarningsMetricValue(selectedQuarter, "revenueUSD");
  const selectedOperatingIncome = getEarningsMetricValue(
    selectedQuarter,
    "operatingIncomeUSD",
  );
  const selectedNetIncome = getEarningsMetricValue(selectedQuarter, "netIncomeUSD");
  const operatingMarginPercent =
    selectedRevenue > 0 && selectedOperatingIncome != null
      ? Math.min(100, Math.max(0, (selectedOperatingIncome / selectedRevenue) * 100))
      : null;
  const earningsBreakdownItems =
    operatingMarginPercent == null
      ? []
      : [
          {
            name: "사업에 쓴 돈",
            value: 100 - operatingMarginPercent,
            label: `${formatPercent(100 - operatingMarginPercent, {
              fractionDigits: 0,
            })}%`,
            color: BREAKDOWN_COLORS[3],
          },
          {
            name: "영업으로 남은 돈",
            value: operatingMarginPercent,
            label: `${formatPercent(operatingMarginPercent, {
              fractionDigits: 0,
            })}%`,
            color: BREAKDOWN_COLORS[0],
          },
        ];
  const companyCategory =
    catalogStock?.categoryName || defaultStockInfo?.category || "상장 기업";

  if (isIndex) {
    return (
      <EmptyState
        icon={Landmark}
        title="지수는 분기 실적 탭을 사용하지 않아요"
        description="지수는 여러 종목을 묶어 만든 시장 지표라서 개별 기업처럼 분기 실적 보고서를 보여주지 않습니다."
        tone="blue"
      />
    );
  }

  if (isEarningsLoading) {
    return <LoadingState label="분기 실적을 불러오는 중..." />;
  }

  if (!earningsData) {
    return (
      <EmptyState
        icon={Sparkles}
        title="실적 캐시가 아직 준비되지 않았어요"
        description="SEC 기반 동기화가 완료되면 확보된 분기 실적과 시가총액을 이 탭에서 볼 수 있어요."
        tone="blue"
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-lg font-bold text-slate-900">
            어느 {isAnnualData ? "연도" : "분기"}를 볼까요?
          </h4>
          <p className="mt-1 text-sm text-slate-500">
            확보된 {recentYearQuarters.length}개 {isAnnualData ? "연도" : "분기"} 자료를 확인할 수 있어요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {recentYearQuarters.map((quarter) => {
            const quarterKey = getQuarterKey(quarter);
            const isSelected = quarterKey === getQuarterKey(selectedQuarter);

            return (
              <button
                key={quarterKey}
                type="button"
                onClick={() => setSelectedQuarterKey(quarterKey)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  isSelected
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50"
                }`}
              >
                <span className="text-sm font-black">{formatQuarterLabel(quarter)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 lg:grid-cols-[1.08fr,0.92fr]">
        {earningsBreakdownItems.length > 0 ? (
          <VisualBreakdown
            title="매출 100이 들어오면"
            items={earningsBreakdownItems}
            centerLabel="영업이익 기준"
            icon={Building2}
          />
        ) : (
          <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl bg-slate-50 px-6 text-center">
            <Building2 className="h-10 w-10 text-blue-500" aria-hidden="true" />
            <h4 className="mt-4 text-lg font-bold text-slate-900">{companyCategory}</h4>
            <p className="mt-2 text-sm text-slate-500">비용과 이익 비율을 준비하고 있어요.</p>
          </div>
        )}

        <div className="border-t border-slate-100 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="pb-5">
            <p className="text-xl font-black text-slate-900">{summary.headline}</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {summary.bullets[0] || "이번 분기 핵심 숫자를 살펴봐요."}
            </p>
          </div>
          <MetricRow
            icon={CircleDollarSign}
            label={`최근 ${isAnnualData ? "연간" : "분기"} 매출`}
            value={formatReportedAmount(formatFin, selectedRevenue, selectedCurrency)}
            comparison={
              selectedQuarter?.revenueYoYPercent != null
                ? `작년보다 ${formatSignedPercentLabel(formatPercent, selectedQuarter.revenueYoYPercent)}`
                : "작년 비교 없음"
            }
            tone="blue"
          />
          <MetricRow
            icon={Coins}
            label={`최근 ${isAnnualData ? "연간" : "분기"} 순이익`}
            value={formatReportedAmount(formatFin, selectedNetIncome, selectedCurrency)}
            comparison={
              selectedQuarter?.netIncomeYoYPercent != null
                ? `작년보다 ${formatSignedPercentLabel(formatPercent, selectedQuarter.netIncomeYoYPercent)}`
                : "작년 비교 없음"
            }
            tone={(selectedNetIncome || 0) >= 0 ? "emerald" : "amber"}
          />
          <MetricRow
            icon={Sparkles}
            label="주당순이익(EPS)"
            value={formatReportedEps(
              formatFin,
              selectedQuarter?.actualEPS,
              selectedCurrency,
            )}
            comparison="주식 1주당 번 돈"
            tone="slate"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-bold text-slate-400">회사 분야</p>
          <p className="mt-1 text-sm font-black text-slate-900">{companyCategory}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-bold text-slate-400">거래소</p>
          <p className="mt-1 text-sm font-black text-slate-900">
            {translateExchangeLabel(earningsData?.profile?.exchange)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-bold text-slate-400">실적 기준</p>
          <p className="mt-1 text-sm font-black text-slate-900">
            {formatQuarterLabel(selectedQuarter)}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-900">
        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
        <p>좋은 회사도 실적과 주가는 늘 함께 움직이지 않아요.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard
          title={revenuePeriodCopy.title}
          value={formatReportedAmount(formatFin, trailingRevenueUSD, selectedCurrency)}
          hint={revenuePeriodCopy.hint}
          tone="emerald"
        />
        <StatCard
          title={netIncomePeriodCopy.title}
          value={formatReportedAmount(formatFin, trailingNetIncomeUSD, selectedCurrency)}
          hint={netIncomePeriodCopy.hint}
          tone={(trailingNetIncomeUSD || 0) >= 0 ? "blue" : "rose"}
        />
        <StatCard
          title={operatingIncomePeriodCopy.title}
          value={formatReportedAmount(
            formatFin,
            trailingOperatingIncomeUSD,
            selectedCurrency,
          )}
          hint={operatingIncomePeriodCopy.hint}
          tone={(trailingOperatingIncomeUSD || 0) >= 0 ? "blue" : "rose"}
        />
      </div>

      <div className="rounded-[2rem] border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-black text-slate-900">
              {isAnnualData ? "연도" : "분기"} 비교 표
            </h4>
            <p className="mt-1 text-sm text-slate-500">
              확보된 {isAnnualData ? "연도별" : "분기별"} 숫자를 한 번에 비교할 수 있어요.
            </p>
          </div>
          <Badge tone="slate" size="sm" className="font-black">
            {recentYearQuarters.length}개 {isAnnualData ? "연도" : "분기"}
          </Badge>
        </div>

        {recentYearQuarters.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  <th className="px-3 py-3">{isAnnualData ? "연도" : "분기"}</th>
                  <th className="px-3 py-3">EPS</th>
                  <th className="px-3 py-3">예상 EPS</th>
                  <th className="px-3 py-3">서프라이즈</th>
                  <th className="px-3 py-3">매출</th>
                  <th className="px-3 py-3">순이익</th>
                  <th className="px-3 py-3">영업이익</th>
                </tr>
              </thead>
              <tbody>
                {recentYearQuarters.map((quarter) => (
                  <tr
                    key={getQuarterKey(quarter)}
                    className={`border-b text-slate-700 last:border-b-0 ${
                      getQuarterKey(quarter) === getQuarterKey(selectedQuarter)
                        ? "border-indigo-100 bg-indigo-50/40"
                        : "border-slate-50"
                    }`}
                  >
                    <td className="px-3 py-4">
                      <div className="font-black text-slate-900">
                        {formatQuarterLabel(quarter)}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {formatDateLabel(quarter.period)}
                      </div>
                    </td>
                    <td className="px-3 py-4 font-semibold">
                      {formatReportedEps(
                        formatFin,
                        quarter.actualEPS,
                        quarter.reportedCurrency || selectedCurrency,
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {formatUsdValue(formatFin, quarter.estimateEPS)}
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${
                          (quarter.surprisePercent || 0) >= 0
                            ? "bg-blue-50 text-blue-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {formatSignedPercentLabel(
                          formatPercent,
                          quarter.surprisePercent,
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      {formatReportedAmount(
                        formatFin,
                        getEarningsMetricValue(quarter, "revenueUSD"),
                        quarter.reportedCurrency || selectedCurrency,
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {formatReportedAmount(
                        formatFin,
                        getEarningsMetricValue(quarter, "netIncomeUSD"),
                        quarter.reportedCurrency || selectedCurrency,
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {formatReportedAmount(
                        formatFin,
                        getEarningsMetricValue(quarter, "operatingIncomeUSD"),
                        quarter.reportedCurrency || selectedCurrency,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              icon={Sparkles}
              title="표시할 분기 실적이 아직 없어요"
              description="기업 기본 정보는 확인되었지만 분기 실적은 다음 동기화 후 채워질 수 있어요."
              tone="blue"
            />
          </div>
        )}
      </div>
    </div>
  );
};

const StockInfoModal = ({
  isOpen,
  onClose,
  symbol,
  companyName = null,
  isIndex = false,
  dividendInfo = null,
}) => {
  const { isTeacher, userData, classId } = useUser();
  const { formatFin, formatPercent } = useStockContext();
  const queryClient = useQueryClient();
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const defaultStockInfo = useMemo(
    () => getDefaultStockProfile(normalizedSymbol),
    [normalizedSymbol],
  );
  const catalogStock = STOCK_CATALOG_BY_TICKER.get(normalizedSymbol) || null;
  const isEtf = catalogStock?.type === "ETF";

  const [activeTab, setActiveTab] = useState("earnings");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    content: "",
    teacherNotes: "",
  });

  const { data: classStockInfo, isLoading: isInfoLoading } = useQuery({
    queryKey: ["stockInfo", classId, normalizedSymbol],
    queryFn: () => fetchStockInfo(classId, normalizedSymbol),
    enabled: isOpen && !!classId && !!normalizedSymbol,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });

  const { data: earningsData, isLoading: isEarningsLoading } = useStockEarnings(
    normalizedSymbol,
    {
      enabled: isOpen && !!normalizedSymbol && !isIndex && !isEtf,
    },
  );
  const { data: etfProfileData, isLoading: isEtfProfileLoading } =
    useStockEtfProfile(normalizedSymbol, {
      enabled: isOpen && !!normalizedSymbol && isEtf,
    });

  useEffect(() => {
    if (classStockInfo) {
      setEditForm({
        title: classStockInfo.title || "",
        content: classStockInfo.content || "",
        teacherNotes: classStockInfo.teacherNotes || "",
      });
      return;
    }

    setEditForm({
      title: "",
      content: "",
      teacherNotes: "",
    });
  }, [classStockInfo]);

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
      setActiveTab("info");
      return;
    }

    if (isEditing && activeTab !== "info") {
      setActiveTab("info");
    }
  }, [activeTab, isEditing, isOpen]);

  const dividendSummary = useMemo(() => {
    if (!dividendInfo) return null;

    return {
      badgeTone: dividendInfo.isClassPolicy ? "indigo" : "emerald",
      badgeLabel: dividendInfo.isClassPolicy ? "학급 배당" : "배당 일정",
      frequencyLabel: dividendInfo.frequencyLabel || "주기 미정",
      amountLabel: formatAmountLabel(
        formatFin,
        dividendInfo.amountUSDPerShare,
        dividendInfo.currency || "USD",
      ),
      exDateLabel: formatDateLabel(dividendInfo.exDateNY),
      payDateLabel: formatDateLabel(dividendInfo.payDateNY),
      classYieldLabel: formatPositivePercentLabel(
        formatPercent,
        dividendInfo.classYieldPercent,
      ),
      referenceYieldLabel: formatPositivePercentLabel(
        formatPercent,
        dividendInfo.referenceYieldPercent,
      ),
      leadDays: dividendInfo.classExDividendLeadTradingDays,
    };
  }, [dividendInfo, formatFin, formatPercent]);

  const modalTabs = useMemo(
    () => [
      {
        id: "earnings",
        label: "한눈에",
        icon: isEtf ? PieChart : Sparkles,
        disabled: isEditing,
      },
      {
        id: "dividend",
        label: isEtf ? "분배금" : "배당",
        icon: Coins,
        disabled: isEditing,
      },
      { id: "info", label: "소개", icon: FileText },
    ],
    [isEditing, isEtf],
  );

  const displayCompanyName =
    defaultStockInfo?.companyNameKo ||
    companyName ||
    etfProfileData?.companyName ||
    earningsData?.profile?.companyName ||
    normalizedSymbol;

  const saveClassStockInfo = async () => {
    if (!classId || !normalizedSymbol || !isTeacher) return;

    try {
      setIsSaving(true);
      const classStockDocRef = doc(
        db,
        "classes",
        classId,
        "stockInfo",
        normalizedSymbol,
      );

      const dataToSave = {
        ...editForm,
        symbol: normalizedSymbol,
        lastUpdated: new Date(),
        updatedBy: userData?.uid || "unknown",
        updatedByName: userData?.displayName || userData?.email || "Unknown",
      };

      if (classStockInfo) {
        await updateDoc(classStockDocRef, dataToSave);
      } else {
        await setDoc(classStockDocRef, {
          ...dataToSave,
          createdAt: new Date(),
        });
      }

      await queryClient.invalidateQueries({
        queryKey: ["stockInfo", classId, normalizedSymbol],
      });

      setIsEditing(false);
    } catch (error) {
      console.error("[StockInfoModal] Failed to save class stock info:", error);
      appAlert("저장 중 오류가 발생했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (classStockInfo) {
      setEditForm({
        title: classStockInfo.title || "",
        content: classStockInfo.content || "",
        teacherNotes: classStockInfo.teacherNotes || "",
      });
    } else {
      setEditForm({
        title: "",
        content: "",
        teacherNotes: "",
      });
    }

    setIsEditing(false);
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      showDefaultCloseButton={false}
    >
      <div className="flex h-full max-h-[85vh] flex-col overflow-hidden">
        <div className="border-b border-slate-100 px-8 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-3xl font-black tracking-tight text-slate-900">
                  {normalizedSymbol}
                </h3>
                {isTeacher && !isEditing ? (
                  <Button
                    onClick={() => {
                      setActiveTab("info");
                      setIsEditing(true);
                    }}
                    tone="blue"
                    kind="outline"
                    size="sm"
                    icon={Edit3}
                  >
                    편집
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                {displayCompanyName}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!isEtf && earningsData?.profile?.exchange ? (
                  <Badge tone="slate" size="sm" className="font-black">
                    {translateExchangeLabel(earningsData.profile.exchange)}
                  </Badge>
                ) : null}
                {!isEtf && earningsData?.latestQuarter ? (
                  <Badge tone="indigo" size="sm" className="font-black">
                    최근 분기 {formatQuarterLabel(earningsData.latestQuarter)}
                  </Badge>
                ) : null}
              </div>
            </div>

            {isTeacher && isEditing ? (
              <div className="flex gap-2">
                <Button
                  onClick={saveClassStockInfo}
                  tone="blue"
                  kind="solid"
                  size="sm"
                  icon={Save}
                  disabled={isSaving}
                  isLoading={isSaving}
                  loadingText="저장 중..."
                >
                  저장
                </Button>
                <Button
                  onClick={cancelEdit}
                  tone="slate"
                  kind="outline"
                  size="sm"
                  icon={X}
                  disabled={isSaving}
                >
                  취소
                </Button>
              </div>
            ) : null}
          </div>

          <div className="mt-5">
            <Tabs
              tabs={modalTabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              variant="underline"
              size="md"
              idPrefix={`stock-info-${normalizedSymbol}`}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {activeTab === "info" ? (
            <InfoContent
              classStockInfo={classStockInfo}
              catalogStock={catalogStock}
              defaultStockInfo={defaultStockInfo}
              earningsData={earningsData}
              isEtf={isEtf}
              isEarningsLoading={isEarningsLoading}
              isTeacher={isTeacher}
              isEditing={isEditing}
              isLoading={isInfoLoading}
              editForm={editForm}
              formatFin={formatFin}
              setEditForm={setEditForm}
            />
          ) : activeTab === "dividend" ? (
            <DividendContent
              dividendInfo={dividendInfo}
              dividendSummary={dividendSummary}
              isEtf={isEtf}
              isInfoLoading={isInfoLoading}
            />
          ) : isEtf ? (
            <EtfProfileContent
              catalogStock={catalogStock}
              defaultStockInfo={defaultStockInfo}
              etfProfileData={etfProfileData}
              isEtfProfileLoading={isEtfProfileLoading}
              formatFin={formatFin}
              formatPercent={formatPercent}
            />
          ) : (
            <EarningsContent
              earningsData={earningsData}
              isEarningsLoading={isEarningsLoading}
              isIndex={isIndex}
              catalogStock={catalogStock}
              defaultStockInfo={defaultStockInfo}
              formatFin={formatFin}
              formatPercent={formatPercent}
            />
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-8 py-4">
          <Button onClick={onClose} tone="slate" kind="outline" size="sm">
            닫기
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default StockInfoModal;
