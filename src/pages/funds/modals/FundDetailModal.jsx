import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Menu, Transition } from "@headlessui/react";
import {
  BookOpenIcon,
  ChartLineUpIcon,
  FileTextIcon,
  GearSixIcon,
  InfoIcon,
  TrashIcon,
  TrendUpIcon,
  WalletIcon,
} from "@phosphor-icons/react";

import { Button, Modal, Tabs } from "../../../components/ui";
import { formatReportCycleLabel } from "../utils/reportCycle";
import {
  formatManagementFeeLabel,
  formatSignedPercentValue,
  formatTrimmedNumber,
  formatWeightBps,
} from "../utils/displayFormat";
import {
  FUND_PERFORMANCE_PERIODS,
  getFundPerformanceMetric,
  getPerformanceUnavailableLabel,
} from "../utils/fundPerformance";
import {
  getFundRebalanceDisabledReason,
  getFundSubscribeDisabledReason,
} from "../utils/fundActionAvailability";
import {
  getFundReportOverdueLabel,
  isFundReportOverdue,
} from "../utils/fundReportStatus";
import FundRiskSummary from "../components/FundRiskSummary";

function getStatusLabel(fund = {}) {
  if (fund.status === "paused" || fund.joinStatus === "paused") return "운용 일시중지";
  if (fund.status === "closed") return "운용 종료";
  if (isFundReportOverdue(fund)) {
    return "보고서 연체 · 가입 가능";
  }
  return "가입 가능";
}

function getStatusTone(fund = {}) {
  if (fund.status === "paused" || fund.joinStatus === "paused") {
    return "bg-amber-50 text-amber-700";
  }
  if (fund.status === "closed") return "bg-slate-100 text-slate-600";
  if (isFundReportOverdue(fund)) return "bg-rose-50 text-rose-600";
  return "bg-emerald-50 text-emerald-700";
}

function getBenchmarkLabel(fund = {}) {
  if (Array.isArray(fund.benchmarkSymbols) && fund.benchmarkSymbols.length > 0) {
    return fund.benchmarkSymbols.join(" / ");
  }
  return fund.benchmarkSymbol || "SPY / QQQ";
}

function getLatestOrderStatusLabel(order = null) {
  if (!order) return "최근 주문 없음";

  if (order.status === "executed") {
    return order.type === "redeem" ? "환매 완료" : "가입 체결 완료";
  }
  if (order.status === "rejected") return "주문 반려";
  return order.type === "redeem" ? "환매 접수 중" : "가입 접수 중";
}

function HoldingRow({ holding, companyName, totalWeightBps, onOpenStockInfo }) {
  const weightBps = Number(holding?.weightBps || 0);
  const width = Math.max(8, Math.min(100, (weightBps / Math.max(totalWeightBps, 1)) * 100));
  const Row = onOpenStockInfo ? "button" : "div";

  return (
    <Row
      {...(onOpenStockInfo
        ? {
            type: "button",
            onClick: () => onOpenStockInfo(holding),
            "aria-label": `${holding.symbol} 주식 정보 보기`,
          }
        : {})}
      className="group block w-full space-y-2.5 border-b border-slate-100 py-4 text-left transition-colors first:pt-1 last:border-b-0 last:pb-1 hover:text-indigo-700 focus:outline-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-base font-extrabold text-slate-900 transition-colors group-hover:text-indigo-700">
          <span className="shrink-0">{holding.symbol}</span>
          {onOpenStockInfo ? (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-blue-600 transition-colors group-hover:border-blue-200 group-hover:bg-blue-50">
              <InfoIcon className="h-3.5 w-3.5" weight="bold" aria-hidden="true" />
            </span>
          ) : null}
          {companyName && companyName !== holding.symbol ? (
            <span className="truncate text-xs font-semibold text-slate-400 transition-colors group-hover:text-slate-500">
              {companyName}
            </span>
          ) : null}
        </span>
        <span className="text-sm font-bold tabular-nums text-slate-600">
          {formatWeightBps(weightBps)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100">
        <div
          className="h-1.5 rounded-full bg-indigo-500"
          style={{ width: `${width}%` }}
        />
      </div>
    </Row>
  );
}

export default function FundDetailModal({
  isOpen,
  onClose,
  fund = null,
  latestReport = null,
  formatFin,
  currencyUnit = "FIN",
  position = null,
  latestOrder = null,
  orderCutoffTime = "15:00",
  onOpenSubscribe,
  onOpenRedeem,
  onOpenRebalance,
  onOpenChart,
  onOpenReportView,
  onOpenReport,
  onOpenStockInfoModal,
  availableSymbols = [],
  onOpenProfileEdit,
  onDeleteFund,
  canManage = false,
  isManager = false,
  isTeacher = false,
  isDeletingFund = false,
}) {
  const [activeTab, setActiveTab] = useState("portfolio");
  const [performancePeriod, setPerformancePeriod] = useState("sinceInception");
  const holdings = useMemo(
    () => (Array.isArray(fund?.holdingsCurrent) ? fund.holdingsCurrent : []),
    [fund],
  );
  const companyNamesBySymbol = useMemo(
    () =>
      new Map(
        (Array.isArray(availableSymbols) ? availableSymbols : []).map((stock) => [
          String(stock?.symbol || "").trim().toUpperCase(),
          stock?.companyName || stock?.name || stock?.symbol,
        ]),
      ),
    [availableSymbols],
  );

  useEffect(() => {
    if (isOpen) {
      setActiveTab("portfolio");
      setPerformancePeriod("sinceInception");
    }
  }, [isOpen, fund?.id]);

  if (!isOpen || !fund) return null;

  const createdAt = fund.createdAt?.toDate?.() || fund.createdAt || null;
  const lastRebalancedAt = fund.lastRebalancedAt?.toDate?.() || fund.lastRebalancedAt || null;
  const lastReportAt =
    latestReport?.submittedAt?.toDate?.() ||
    latestReport?.submittedAt ||
    fund.lastReportAt?.toDate?.() ||
    fund.lastReportAt ||
    null;
  const nextReportDueAt = fund.nextReportDueAt?.toDate?.() || fund.nextReportDueAt || null;
  const availableUnits = Math.max(
    0,
    Number(position?.units || 0) - Number(position?.reservedUnits || 0),
  );
  const marketValue = availableUnits * Number(fund.currentNav || fund.baseNav || 100);
  const totalInvestedUSD = Number(position?.totalInvestedUSD || 0);
  const totalWeightBps = holdings.reduce((sum, holding) => sum + Number(holding?.weightBps || 0), 0);
  const reportOverdue = isFundReportOverdue(fund);
  const statusLabel = getStatusLabel(fund);
  const heroStatusLabel = reportOverdue
    ? isManager
      ? getFundReportOverdueLabel(fund)
      : "보고서 지연"
    : statusLabel;
  const isJoinAvailable =
    fund.status !== "closed" &&
    fund.status !== "paused" &&
    fund.joinStatus !== "paused";
  const statusTone = reportOverdue && !isManager
    ? "bg-amber-50 text-amber-700"
    : getStatusTone(fund);
  const performanceMetric = getFundPerformanceMetric(fund, performancePeriod);
  const returnPct = performanceMetric.returnPct;
  const hasReturn = Number.isFinite(returnPct);
  const hasDrawdown = Number.isFinite(performanceMetric.maxDrawdownPct);
  const isPositiveReturn = hasReturn && returnPct >= 0;
  const currentNav = Number(fund.currentNav || fund.baseNav || 100);
  const subscribeDisabledReason = getFundSubscribeDisabledReason(fund, {
    orderCutoffTime,
    isTeacher,
  });
  const rebalanceDisabledReason = getFundRebalanceDisabledReason(fund, {
    orderCutoffTime,
    isTeacher,
  });
  const detailTabs = [
    { id: "portfolio", label: "포트폴리오" },
    { id: "operation", label: "운용 정보" },
    { id: "records", label: "보고서·내 투자" },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="max-w-[1360px]"
      aria-label={`${fund.fundName} 상세`}
    >
      <div className="space-y-0 px-5 pb-6 pt-10 sm:px-8 sm:pb-8 sm:pt-12">
        <section className="grid gap-x-4 gap-y-5 border-b border-slate-200 pb-8 pr-12 sm:grid-cols-2 md:grid-cols-[repeat(3,minmax(0,1fr))_auto] md:items-center lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] lg:gap-0">
          <div className="min-w-0 sm:col-span-2 md:col-span-4 lg:col-span-1 lg:pr-8">
            <h3 className="truncate text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
              {fund.fundName || "이름 없는 펀드"}
            </h3>
            <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-500 sm:text-base">
              {fund.summary || "등록된 펀드 소개가 없습니다."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-bold ${statusTone}`}>
                {heroStatusLabel}
              </span>
              {isJoinAvailable ? (
                <>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="inline-flex items-center rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700">
                    가입 가능
                  </span>
                </>
              ) : null}
              {fund.status !== "closed" && (isManager || isTeacher) && onOpenReport ? (
                <Button
                  onClick={() => onOpenReport(fund)}
                  kind="ghost"
                  tone="blue"
                  size="xs"
                  
                >
                  보고서 작성
                </Button>
              ) : null}
            </div>
            <label className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-slate-500">
              성과 기간
              <select
                value={performancePeriod}
                onChange={(event) => setPerformancePeriod(event.target.value)}
                className="min-h-9 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                {Object.entries(FUND_PERFORMANCE_PERIODS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            {performanceMetric.startDate && performanceMetric.endDate ? (
              <p className="mt-2 text-[11px] font-semibold text-slate-400">
                평가 {performanceMetric.startDate.replaceAll("-", ".")} – {performanceMetric.endDate.replaceAll("-", ".")}
              </p>
            ) : null}
          </div>

          <div className="border-slate-200 lg:min-w-44 lg:border-l lg:px-8">
            <p className="text-xs font-bold text-slate-500">현재 NAV</p>
            <p className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight text-slate-950">
              {formatFin(currentNav, { fractionDigits: 2, trimTrailingZeros: true })}
              <span className="ml-1.5 text-sm font-bold text-slate-400">{currencyUnit}</span>
            </p>
          </div>

          <div className="border-slate-200 lg:min-w-44 lg:border-l lg:px-8">
            <p className="text-xs font-bold text-slate-500">{FUND_PERFORMANCE_PERIODS[performancePeriod]} 수익률</p>
            <p className={`mt-1 text-3xl font-extrabold tabular-nums tracking-tight ${!hasReturn ? "text-slate-400" : isPositiveReturn ? "text-emerald-600" : "text-rose-600"}`}>
              {hasReturn ? formatSignedPercentValue(returnPct, 1) : "—"}
            </p>
          </div>

          <div className="border-slate-200 lg:min-w-40 lg:border-l lg:px-8">
            <p className="text-xs font-bold text-slate-500">최대 하락</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-slate-900">
              {hasDrawdown
                ? `${performanceMetric.maxDrawdownPct.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`
                : "—"}
            </p>
            {!hasDrawdown ? (
              <p className="mt-1 text-[11px] font-semibold text-slate-400">{getPerformanceUnavailableLabel(performanceMetric)}</p>
            ) : null}
          </div>

          <div className="lg:border-l lg:border-slate-200 lg:pl-8">
            <Button
              onClick={() => onOpenSubscribe?.(fund)}
              kind="solid"
              tone="indigo"
              size="lg"
              disabled={Boolean(subscribeDisabledReason)}
              title={subscribeDisabledReason || undefined}
              className="w-full lg:min-w-32"
            >
              {position ? "추가 매수" : "가입 신청"}
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-b border-slate-200 py-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <Tabs
              tabs={detailTabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              variant="pills"
              size="sm"
              idPrefix="fund-detail"
              className="border-none bg-transparent shadow-none"
            />
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button
                onClick={() => onOpenChart?.(fund)}
                kind="outline"
                tone="slate"
                size="sm"
                icon={ChartLineUpIcon}
              >
                NAV 차트
              </Button>
              {canManage || isTeacher ? (
                <Menu as="div" className="relative">
                  <Menu.Button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                    <GearSixIcon className="h-4 w-4" aria-hidden="true" />
                    관리
                  </Menu.Button>
                  <Transition
                    as={React.Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="scale-95 transform opacity-0"
                    enterTo="scale-100 transform opacity-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="scale-100 transform opacity-100"
                    leaveTo="scale-95 transform opacity-0"
                  >
                    <Menu.Items className="absolute right-0 z-50 mt-2 w-44 origin-top-right rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl ring-1 ring-black/5 focus:outline-none">
                      {canManage ? (
                        <Menu.Item>
                          {({ active }) => (
                            <Button
                              onClick={() => onOpenProfileEdit?.(fund)}
                              kind="ghost"
                              tone="slate"
                              size="sm"
                              className={`w-full justify-start  ${active ? "bg-slate-50" : ""}`}
                            >
                              펀드 관리
                            </Button>
                          )}
                        </Menu.Item>
                      ) : null}
                      {canManage ? (
                        <Menu.Item>
                          {({ active }) => (
                            <Button
                              onClick={() => onOpenRebalance?.(fund)}
                              kind="ghost"
                              tone="slate"
                              size="sm"
                              disabled={Boolean(rebalanceDisabledReason)}
                              title={rebalanceDisabledReason || undefined}
                              className={`w-full justify-start  ${active ? "bg-slate-50" : ""}`}
                            >
                              리밸런싱
                            </Button>
                          )}
                        </Menu.Item>
                      ) : null}
                      {isTeacher ? (
                        <Menu.Item>
                          {({ active }) => (
                            <Button
                              onClick={() => onDeleteFund?.(fund)}
                              kind="ghost"
                              tone="red"
                              size="sm"
                              icon={TrashIcon}
                              isLoading={isDeletingFund}
                              loadingText="삭제 중"
                              className={`w-full justify-start  ${active ? "bg-rose-50" : ""}`}
                            >
                              펀드 삭제
                            </Button>
                          )}
                        </Menu.Item>
                      ) : null}
                    </Menu.Items>
                  </Transition>
                </Menu>
              ) : null}
              {position && availableUnits > 0 ? (
                <Button
                  onClick={() => onOpenRedeem?.(fund)}
                  kind="outline"
                  tone="slate"
                  size="sm"
                >
                  환매 신청
                </Button>
              ) : null}
          </div>
        </section>

        {subscribeDisabledReason || (canManage && rebalanceDisabledReason) ? (
          <div className="mt-4 space-y-2 border-l-2 border-amber-400 px-4 py-1 text-sm font-bold text-slate-600">
            {subscribeDisabledReason ? <p>{subscribeDisabledReason}</p> : null}
            {canManage && rebalanceDisabledReason ? <p>{rebalanceDisabledReason}</p> : null}
          </div>
        ) : null}

        {activeTab === "portfolio" ? (
          <div className="grid gap-4 pt-4 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="min-h-[360px] rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
              <div className="flex items-center gap-2.5">
                <BookOpenIcon className="h-5 w-5 text-indigo-600" weight="regular" />
                <h4 className="text-xl font-extrabold text-slate-900">이 펀드는 이렇게 운용해요</h4>
              </div>
              <p className="mt-6 text-xs font-bold text-slate-400">펀드 소개</p>
              <p className="mt-2 text-sm font-medium leading-7 text-slate-700 sm:text-base">
                {fund.summary || "등록된 펀드 소개가 없습니다."}
              </p>
              <div className="mt-6 border-t border-slate-100 pt-5">
                <p className="text-xs font-bold text-slate-400">운용 전략</p>
                <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-700 sm:text-base">
                  {fund.strategy || "등록된 운용 전략 소개가 없습니다."}
                </p>
              </div>
            </section>

            <section className="min-h-[360px] rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xl font-extrabold text-slate-900">현재 편입 비중</h4>
                <span className="text-xs font-bold text-slate-400">총 {holdings.length}종목</span>
              </div>
              {holdings.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm font-bold text-slate-500">
                  아직 편입 종목이 없습니다.
                </div>
              ) : (
                <div className="mt-5">
                  {holdings.map((holding) => (
                    <HoldingRow
                      key={`${fund.id}-${holding.symbol}`}
                      holding={holding}
                      companyName={
                        holding.companyName ||
                        companyNamesBySymbol.get(String(holding.symbol || "").trim().toUpperCase())
                      }
                      totalWeightBps={totalWeightBps}
                      onOpenStockInfo={onOpenStockInfoModal}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "operation" ? (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <TrendUpIcon className="h-5 w-5 text-indigo-600" />
              <h4 className="text-xl font-black text-slate-900">운용 정보</h4>
            </div>
            <div className="mt-4">
              <FundRiskSummary risk={fund.riskSummary} title="현재 가격 움직임" />
            </div>
            <dl className="mt-5 grid gap-x-10 gap-y-4 text-sm text-slate-600 md:grid-cols-2">
              {[
                ["운용 상태", statusLabel],
                ["매니저", fund.managerName || "미정"],
                ["운용 규모", `${formatFin(fund.aumUSD || 0, { fractionDigits: 2, trimTrailingZeros: true })} ${currencyUnit}`],
                ["투자자", `${formatTrimmedNumber(fund.investorCount || 0, 0)}명`],
                ["최소 가입금액", `${formatFin(fund.minInvestmentUSD || 0, { fractionDigits: 2, trimTrailingZeros: true })} ${currencyUnit}`],
                ["운용보수", formatManagementFeeLabel(fund)],
                ["보고서 주기", formatReportCycleLabel(fund)],
                ["벤치마크", getBenchmarkLabel(fund)],
                ["거래 시간", `평일 07:45 - ${orderCutoffTime}`],
                ["개설일", createdAt ? dayjs(createdAt).format("YYYY.MM.DD") : "-"],
                ["최근 리밸런싱", lastRebalancedAt ? dayjs(lastRebalancedAt).format("YYYY.MM.DD HH:mm") : "아직 없음"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                  <dt>{label}</dt>
                  <dd className="text-right font-bold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {activeTab === "records" ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <section className="flex min-h-[300px] flex-col rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 text-indigo-600">
                <FileTextIcon className="h-5 w-5" />
                <p className="text-sm font-black">최근 운용 보고서</p>
              </div>

              {latestReport ? (
                <>
                  <h4 className="mt-4 text-xl font-black leading-7 text-slate-900">
                    {latestReport.title || fund.lastReportTitle}
                  </h4>
                  <p className="mt-1 text-xs font-bold text-slate-400">
                    {lastReportAt ? dayjs(lastReportAt).format("YYYY.MM.DD HH:mm 제출") : "제출 시각 없음"}
                  </p>

                  <p className="mt-5 border-l-2 border-indigo-400 pl-4 text-sm font-bold leading-6 text-slate-800">
                    {latestReport.summary || fund.lastReportSummary || "요약이 없습니다."}
                  </p>
                  <p className="mt-4 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-500">
                    {latestReport.content || "보고서 본문을 열어 자세한 운용 기록을 확인할 수 있습니다."}
                  </p>

                  <div className="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
                    <div>
                      <p className="text-xs text-slate-400">다음 보고 마감</p>
                      <p className="mt-1 text-sm font-bold text-slate-700">
                        {nextReportDueAt ? dayjs(nextReportDueAt).format("YYYY.MM.DD HH:mm") : "일정 없음"}
                      </p>
                    </div>
                    <Button
                      onClick={() => onOpenReportView?.(latestReport)}
                      kind="outline"
                      tone="slate"
                      size="sm"
                    >
                      전체 보고서 보기
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                  <p className="text-base font-black text-slate-700">아직 제출된 보고서가 없습니다.</p>
                  <p className="mt-2 text-sm text-slate-400">첫 보고서가 제출되면 이곳에서 바로 읽을 수 있습니다.</p>
                </div>
              )}
            </section>

            <section className="flex min-h-[300px] flex-col rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 text-indigo-600">
                <WalletIcon className="h-5 w-5" />
                <h4 className="text-sm font-black">내 투자 현황</h4>
              </div>

              {position ? (
                <>
                  <div className="mt-5 rounded-2xl bg-slate-50 p-5">
                    <p className="text-xs font-bold text-slate-400">현재 보유 금액</p>
                    <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">
                      {formatFin(marketValue, { fractionDigits: 2, trimTrailingZeros: true })}{" "}
                      <span className="text-sm text-slate-400">{currencyUnit}</span>
                    </p>
                  </div>
                  <dl className="mt-5 space-y-4 text-sm text-slate-600">
                    <div className="flex justify-between gap-4">
                      <dt>투자 원금</dt>
                      <dd className="font-bold text-slate-900">
                        {formatFin(totalInvestedUSD, { fractionDigits: 2, trimTrailingZeros: true })} {currencyUnit}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>평균 매입 기준가</dt>
                      <dd className="font-bold text-slate-900">
                        {formatFin(position.averageCostNav || 0, { fractionDigits: 2, trimTrailingZeros: true })} {currencyUnit}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-slate-100 pt-4">
                      <dt>최근 주문 상태</dt>
                      <dd className="font-bold text-slate-900">{getLatestOrderStatusLabel(latestOrder)}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
                    <WalletIcon className="h-7 w-7" />
                  </div>
                  <p className="mt-4 text-base font-black text-slate-800">아직 가입하지 않았습니다.</p>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-slate-400">
                    가입이 완료되면 보유 금액과 투자 원금, 평균 매입 기준가가 이곳에 표시됩니다.
                  </p>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
