import React, { useDeferredValue, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Coins,
  Filter,
  History,
  Search,
} from "lucide-react";
import {
  Button,
  DataTable,
  EmptyState,
  InputField,
  SurfaceLoader,
  TableSkeleton,
} from "../../../../components/ui";

const toSafeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const getAppliedRate = (trade, defaultConversionRate) => {
  const tradeRate = toSafeNumber(trade?.conversionRate, 0);
  const fallbackRate = toSafeNumber(defaultConversionRate, 1);
  return tradeRate > 0 ? tradeRate : fallbackRate > 0 ? fallbackRate : 1;
};

const getLocalAmount = (usdAmount, trade, defaultConversionRate) =>
  usdAmount / getAppliedRate(trade, defaultConversionRate);

const formatDisplayAmount = ({
  amountUSD,
  amountLocal,
  showLocalCurrency,
  currencyUnit,
  formatFin,
  formatClassCurrency,
}) =>
  showLocalCurrency
    ? `${formatClassCurrency(amountLocal, {
        fractionDigits: 2,
        trimTrailingZeros: true,
      })} ${currencyUnit}`
    : `${formatFin(amountUSD, {
        fractionDigits: 2,
        trimTrailingZeros: true,
      })} FIN`;

const resolveTradeDate = (trade) => {
  const rawValue =
    trade?.createdAt || trade?.timestamp || trade?.approvedAt || trade?.date;

  if (rawValue?.toDate) return rawValue.toDate();

  const fallbackDate = new Date(rawValue);
  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
};

const getTradeMeta = (trade) => {
  switch (trade?.type) {
    case "STOCK_BUY":
      return {
        label: "매수",
        icon: ArrowDownLeft,
        iconClassName: "bg-blue-100 text-blue-700",
        badgeClassName: "border border-blue-200 bg-blue-50 text-blue-700",
        settlementClassName: "text-rose-600",
      };
    case "STOCK_SELL":
      return {
        label: "매도",
        icon: ArrowUpRight,
        iconClassName: "bg-emerald-100 text-emerald-700",
        badgeClassName:
          "border border-emerald-200 bg-emerald-50 text-emerald-700",
        settlementClassName: "text-emerald-600",
      };
    case "STOCK_DIVIDEND":
      return {
        label: "배당",
        icon: Coins,
        iconClassName: "bg-amber-100 text-amber-700",
        badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
        settlementClassName: "text-amber-600",
      };
    default:
      return {
        label: "기타",
        icon: History,
        iconClassName: "bg-slate-100 text-slate-700",
        badgeClassName: "border border-slate-200 bg-slate-100 text-slate-600",
        settlementClassName: "text-slate-600",
      };
  }
};

const getUnitPriceUSD = (trade) => {
  if (trade?.type === "STOCK_DIVIDEND") {
    return toSafeNumber(trade?.amountUSDPerShare, 0);
  }
  return toSafeNumber(trade?.priceUSD, 0);
};

const getGrossAmountUSD = (trade) => toSafeNumber(trade?.grossUSD, 0);

const getFeeAmountUSD = (trade) =>
  trade?.type === "STOCK_BUY" || trade?.type === "STOCK_SELL"
    ? toSafeNumber(trade?.feeUSD, 0)
    : 0;

const getSettlementAmountUSD = (trade) => {
  if (trade?.type === "STOCK_BUY") {
    return -toSafeNumber(
      trade?.totalUSD,
      getGrossAmountUSD(trade) + getFeeAmountUSD(trade),
    );
  }

  if (trade?.type === "STOCK_SELL") {
    return toSafeNumber(
      trade?.netUSD,
      getGrossAmountUSD(trade) - getFeeAmountUSD(trade),
    );
  }

  if (trade?.type === "STOCK_DIVIDEND") {
    return getGrossAmountUSD(trade);
  }

  return 0;
};

const AmountValue = ({
  amountUSD,
  amountLocal,
  showLocalCurrency,
  currencyUnit,
  formatFin,
  formatClassCurrency,
  className = "text-slate-800",
  withSign = false,
  signOverride = null,
}) => {
  const displayValue = formatDisplayAmount({
    amountUSD,
    amountLocal,
    showLocalCurrency,
    currencyUnit,
    formatFin,
    formatClassCurrency,
  });

  const signPrefix =
    signOverride ||
    (amountUSD > 0 ? "+" : amountUSD < 0 ? "-" : "");
  const signedValue =
    withSign && signPrefix ? `${signPrefix}${displayValue}` : displayValue;

  return <span className={className}>{signedValue}</span>;
};

const FilterChip = ({ active, label, onClick }) => (
  <Button
    size="sm"
    tone="slate"
    kind={active ? "solid" : "outline"}
    rounded="full"
    onClick={onClick}
  >
    {label}
  </Button>
);

const SummaryStatCard = ({
  title,
  value,
  helperText,
  accentClassName = "text-slate-900",
}) => (
  <div className="rounded-[1.75rem] border border-slate-100 bg-white p-5 shadow-sm">
    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
      {title}
    </p>
    <p className={`mt-3 text-2xl font-black ${accentClassName}`}>{value}</p>
    <p className="mt-2 text-xs font-medium text-slate-400">{helperText}</p>
  </div>
);

const MobileTradeCard = ({
  row,
  showLocalCurrency,
  currencyUnit,
  formatFin,
  formatClassCurrency,
  formatWholeNumber,
}) => {
  const meta = getTradeMeta(row.trade);
  const TradeIcon = meta.icon;

  return (
    <div className="rounded-[1.75rem] border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className={`rounded-2xl p-2 ${meta.iconClassName}`}>
              <TradeIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-black text-slate-800">{row.symbol}</p>
              <p className="text-xs font-medium text-slate-400">{row.dateText}</p>
            </div>
          </div>
          {row.description ? (
            <p className="mt-3 text-sm text-slate-500">{row.description}</p>
          ) : null}
        </div>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${meta.badgeClassName}`}
        >
          {meta.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            수량
          </p>
          <p className="mt-2 text-sm font-black text-slate-800">
            {formatWholeNumber(row.quantity)}주
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {row.trade.type === "STOCK_DIVIDEND" ? "주당 배당" : "단가"}
          </p>
          <p className="mt-2 text-sm font-black text-slate-800">
            {formatFin(row.unitPriceUSD, {
              fractionDigits: 2,
              trimTrailingZeros: true,
            })}{" "}
            FIN
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            거래금액
          </p>
          <div className="mt-2 text-sm font-black text-slate-800">
            <AmountValue
              amountUSD={row.grossUSD}
              amountLocal={row.grossLocal}
              showLocalCurrency={showLocalCurrency}
              currencyUnit={currencyUnit}
              formatFin={formatFin}
              formatClassCurrency={formatClassCurrency}
            />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            입출금
          </p>
          <div className={`mt-2 text-sm font-black ${meta.settlementClassName}`}>
            <AmountValue
              amountUSD={Math.abs(row.settlementUSD)}
              amountLocal={Math.abs(row.settlementLocal)}
              showLocalCurrency={showLocalCurrency}
              currencyUnit={currencyUnit}
              formatFin={formatFin}
              formatClassCurrency={formatClassCurrency}
              withSign
              className={meta.settlementClassName}
              signOverride={row.settlementUSD > 0 ? "+" : "-"}
            />
          </div>
        </div>
      </div>

      {(row.feeUSD > 0 || row.realizedGainUSD !== 0) && (
        <div className="mt-4 flex flex-wrap gap-3 text-xs font-medium text-slate-500">
          {row.feeUSD > 0 ? (
            <span>
              수수료{" "}
              <AmountValue
                amountUSD={row.feeUSD}
                amountLocal={row.feeLocal}
                showLocalCurrency={showLocalCurrency}
                currencyUnit={currencyUnit}
                formatFin={formatFin}
                formatClassCurrency={formatClassCurrency}
              />
            </span>
          ) : null}
          {row.realizedGainUSD !== 0 ? (
            <span>
              실현손익{" "}
              <AmountValue
                amountUSD={Math.abs(row.realizedGainUSD)}
                amountLocal={Math.abs(row.realizedGainLocal)}
                showLocalCurrency={showLocalCurrency}
                currencyUnit={currencyUnit}
                formatFin={formatFin}
                formatClassCurrency={formatClassCurrency}
                withSign
                className={
                  row.realizedGainUSD > 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }
                signOverride={row.realizedGainUSD > 0 ? "+" : "-"}
              />
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default function PortfolioTradeLedger({
  trades = [],
  isLoading = false,
  showLocalCurrency,
  currencyUnit,
  defaultConversionRate,
  formatFin,
  formatClassCurrency,
  formatWholeNumber,
  onChangeShowLocalCurrency,
  isFilterOpen = false,
  onToggleFilters,
  periodOptions = [],
  selectedPeriodDays = null,
  onSelectPeriodDays,
}) {
  const [symbolSearchTerm, setSymbolSearchTerm] = useState("");
  const deferredSymbolSearchTerm = useDeferredValue(symbolSearchTerm);
  const normalizedSymbolSearchTerm = deferredSymbolSearchTerm.trim().toUpperCase();

  const rows = useMemo(
    () =>
      [...trades]
        .map((trade) => {
          const tradeDate = resolveTradeDate(trade);
          const unitPriceUSD = getUnitPriceUSD(trade);
          const grossUSD = getGrossAmountUSD(trade);
          const feeUSD = getFeeAmountUSD(trade);
          const settlementUSD = getSettlementAmountUSD(trade);
          const realizedGainUSD = toSafeNumber(trade?.realizedGainUSD, 0);

          return {
            trade,
            id: trade?.id || `${trade?.type || "trade"}-${tradeDate?.getTime?.() || 0}`,
            date: tradeDate,
            dateText: tradeDate
              ? dayjs(tradeDate).format("YYYY.MM.DD HH:mm")
              : "-",
            symbol: String(trade?.symbol || "-").toUpperCase(),
            quantity: toSafeNumber(trade?.quantity, 0),
            unitPriceUSD,
            grossUSD,
            grossLocal: getLocalAmount(grossUSD, trade, defaultConversionRate),
            feeUSD,
            feeLocal: getLocalAmount(feeUSD, trade, defaultConversionRate),
            settlementUSD,
            settlementLocal: getLocalAmount(
              Math.abs(settlementUSD),
              trade,
              defaultConversionRate,
            ),
            realizedGainUSD,
            realizedGainLocal: getLocalAmount(
              Math.abs(realizedGainUSD),
              trade,
              defaultConversionRate,
            ),
            description: String(trade?.description || "").trim(),
          };
        })
        .sort((a, b) => {
          const aTime = a.date?.getTime?.() || 0;
          const bTime = b.date?.getTime?.() || 0;
          return bTime - aTime;
        }),
    [defaultConversionRate, trades],
  );

  const filteredRows = useMemo(() => {
    if (!normalizedSymbolSearchTerm) {
      return rows;
    }

    return rows.filter((row) => row.symbol.includes(normalizedSymbolSearchTerm));
  }, [normalizedSymbolSearchTerm, rows]);

  const summary = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.totalCount += 1;

          if (row.trade.type === "STOCK_BUY") {
            acc.buyCount += 1;
            acc.buyGrossUSD += row.grossUSD;
            acc.buyGrossLocal += row.grossLocal;
          }

          if (row.trade.type === "STOCK_SELL") {
            acc.sellCount += 1;
            acc.sellGrossUSD += row.grossUSD;
            acc.sellGrossLocal += row.grossLocal;
          }

          if (row.trade.type === "STOCK_DIVIDEND") {
            acc.dividendCount += 1;
            acc.dividendUSD += row.grossUSD;
            acc.dividendLocal += row.grossLocal;
          }

          return acc;
        },
        {
          totalCount: 0,
          buyCount: 0,
          sellCount: 0,
          dividendCount: 0,
          buyGrossUSD: 0,
          buyGrossLocal: 0,
          sellGrossUSD: 0,
          sellGrossLocal: 0,
          dividendUSD: 0,
          dividendLocal: 0,
        },
      ),
    [filteredRows],
  );

  const hasSymbolSearch = normalizedSymbolSearchTerm.length > 0;
  const hasAnyRows = rows.length > 0;
  const hasFilteredRows = filteredRows.length > 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 rounded-[2rem] border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-[1.5rem] bg-slate-900 p-3 text-white shadow-lg shadow-slate-200">
              <History className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-xl font-black tracking-tight text-slate-800">
                거래내역
              </h3>
              <p className="text-sm font-medium text-slate-500">
                실제 체결된 매수, 매도, 배당 기록을 건별로 확인합니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <Button
                size="xs"
                tone="slate"
                kind={showLocalCurrency ? "ghost" : "solid"}
                rounded="lg"
                onClick={() => onChangeShowLocalCurrency?.(false)}
              >
                FIN
              </Button>
              <Button
                size="xs"
                tone="slate"
                kind={showLocalCurrency ? "solid" : "ghost"}
                rounded="lg"
                onClick={() => onChangeShowLocalCurrency?.(true)}
              >
                {currencyUnit}
              </Button>
            </div>

            <Button
              type="button"
              size="sm"
              tone="slate"
              kind={isFilterOpen ? "soft" : "outline"}
              onClick={onToggleFilters}
              
            >
              <Filter className="h-4 w-4" />
              기간 필터
              {isFilterOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl bg-white/80 px-4 py-3 text-sm font-medium text-slate-500 shadow-sm ring-1 ring-slate-100">
          총 <span className="font-black text-slate-800">{summary.totalCount}건</span>
          의 거래가 있으며, 매수 {summary.buyCount}건, 매도 {summary.sellCount}건,
          배당 {summary.dividendCount}건입니다.
        </div>

        {isFilterOpen ? (
          <div className="rounded-[1.75rem] border border-slate-100 bg-white p-5 shadow-sm">
            <p className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-400">
              기간 선택
            </p>
            <div className="flex flex-wrap gap-2">
              {periodOptions.map((option) => (
                <FilterChip
                  key={option.id}
                  active={selectedPeriodDays === option.value}
                  label={option.label}
                  onClick={() => onSelectPeriodDays?.(option.value)}
                />
              ))}
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                    종목 검색
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-400">
                    티커를 입력하면 해당 종목 거래만 좁혀서 볼 수 있습니다.
                  </p>
                </div>
                {symbolSearchTerm ? (
                  <Button
                    size="xs"
                    tone="slate"
                    kind="outline"
                    rounded="full"
                    onClick={() => setSymbolSearchTerm("")}
                  >
                    초기화
                  </Button>
                ) : null}
              </div>

              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <InputField
                  type="search"
                  value={symbolSearchTerm}
                  onChange={(event) =>
                    setSymbolSearchTerm(event.target.value.toUpperCase())
                  }
                  placeholder="예: AAPL, TSLA"
                  aria-label="거래 종목 검색"
                  className="rounded-2xl border-slate-100 bg-slate-50/70 pl-11 !py-3 transition-all focus:bg-white focus:!ring-slate-300"
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <SurfaceLoader
        loading={isLoading}
        variant={hasAnyRows ? "refreshing" : "surface-loading"}
        preserveContent={hasAnyRows}
        skeleton={
          <TableSkeleton
            bare
            columns={8}
            rows={6}
            className="h-full min-h-full"
          />
        }
        minHeightClassName="min-h-[360px]"
      >
        {hasFilteredRows ? (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <SummaryStatCard
              title="총 거래건수"
              value={`${summary.totalCount}건`}
              helperText="매수, 매도, 배당을 모두 포함한 건수입니다."
            />
            <SummaryStatCard
              title="총 매수금액"
              value={formatDisplayAmount({
                amountUSD: summary.buyGrossUSD,
                amountLocal: summary.buyGrossLocal,
                showLocalCurrency,
                currencyUnit,
                formatFin,
                formatClassCurrency,
              })}
              helperText="수수료 전 기준 거래금액 합계입니다."
              accentClassName="text-blue-700"
            />
            <SummaryStatCard
              title="총 매도금액"
              value={formatDisplayAmount({
                amountUSD: summary.sellGrossUSD,
                amountLocal: summary.sellGrossLocal,
                showLocalCurrency,
                currencyUnit,
                formatFin,
                formatClassCurrency,
              })}
              helperText="수수료 전 기준 거래금액 합계입니다."
              accentClassName="text-emerald-700"
            />
            <SummaryStatCard
              title="총 배당금"
              value={formatDisplayAmount({
                amountUSD: summary.dividendUSD,
                amountLocal: summary.dividendLocal,
                showLocalCurrency,
                currencyUnit,
                formatFin,
                formatClassCurrency,
              })}
              helperText="기간 내 지급된 배당금 합계입니다."
              accentClassName="text-amber-700"
            />
          </div>

          <DataTable
            className="hidden overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm lg:block"
          >
                <DataTable.Header className="bg-slate-50/80">
                  <DataTable.Row interactive={false}>
                    <DataTable.HeadCell className="px-6 py-4">일시</DataTable.HeadCell>
                    <DataTable.HeadCell className="px-4 py-4">종목</DataTable.HeadCell>
                    <DataTable.HeadCell className="px-4 py-4">구분</DataTable.HeadCell>
                    <DataTable.HeadCell align="right" className="px-4 py-4">수량</DataTable.HeadCell>
                    <DataTable.HeadCell align="right" className="px-4 py-4">단가</DataTable.HeadCell>
                    <DataTable.HeadCell align="right" className="px-4 py-4">거래금액</DataTable.HeadCell>
                    <DataTable.HeadCell align="right" className="px-4 py-4">수수료</DataTable.HeadCell>
                    <DataTable.HeadCell align="right" className="px-6 py-4">입출금</DataTable.HeadCell>
                  </DataTable.Row>
                </DataTable.Header>
                <DataTable.Body>
                  {filteredRows.map((row) => {
                    const meta = getTradeMeta(row.trade);
                    const TradeIcon = meta.icon;

                    return (
                      <DataTable.Row
                        key={row.id}
                      >
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-500">
                          {row.dateText}
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-bold text-slate-800">
                            {row.symbol}
                          </p>
                          {row.description ? (
                            <p className="mt-1 text-xs text-slate-400">
                              {row.description}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-4">
                          <div className="inline-flex items-center gap-2">
                            <div className={`rounded-xl p-2 ${meta.iconClassName}`}>
                              <TradeIcon className="h-4 w-4" />
                            </div>
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${meta.badgeClassName}`}
                            >
                              {meta.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-bold text-slate-800">
                          {formatWholeNumber(row.quantity)}주
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-bold text-slate-700">
                          {formatFin(row.unitPriceUSD, {
                            fractionDigits: 2,
                            trimTrailingZeros: true,
                          })}{" "}
                          FIN
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-bold text-slate-800">
                          <AmountValue
                            amountUSD={row.grossUSD}
                            amountLocal={row.grossLocal}
                            showLocalCurrency={showLocalCurrency}
                            currencyUnit={currencyUnit}
                            formatFin={formatFin}
                            formatClassCurrency={formatClassCurrency}
                          />
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-bold text-slate-500">
                          {row.feeUSD > 0 ? (
                            <AmountValue
                              amountUSD={row.feeUSD}
                              amountLocal={row.feeLocal}
                              showLocalCurrency={showLocalCurrency}
                              currencyUnit={currencyUnit}
                              formatFin={formatFin}
                              formatClassCurrency={formatClassCurrency}
                            />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td
                          className={`px-6 py-4 text-right text-sm font-bold ${meta.settlementClassName}`}
                        >
                          <AmountValue
                            amountUSD={Math.abs(row.settlementUSD)}
                            amountLocal={Math.abs(row.settlementLocal)}
                            showLocalCurrency={showLocalCurrency}
                            currencyUnit={currencyUnit}
                            formatFin={formatFin}
                            formatClassCurrency={formatClassCurrency}
                            withSign
                            className={meta.settlementClassName}
                            signOverride={row.settlementUSD > 0 ? "+" : "-"}
                          />
                          {row.realizedGainUSD !== 0 ? (
                            <p
                              className={`mt-1 text-xs font-bold ${
                                row.realizedGainUSD > 0
                                  ? "text-emerald-500"
                                  : "text-rose-500"
                              }`}
                            >
                              실현손익{" "}
                              <AmountValue
                                amountUSD={Math.abs(row.realizedGainUSD)}
                                amountLocal={Math.abs(row.realizedGainLocal)}
                                showLocalCurrency={showLocalCurrency}
                                currencyUnit={currencyUnit}
                                formatFin={formatFin}
                                formatClassCurrency={formatClassCurrency}
                                withSign
                                className={
                                  row.realizedGainUSD > 0
                                    ? "text-emerald-500"
                                    : "text-rose-500"
                                }
                                signOverride={
                                  row.realizedGainUSD > 0 ? "+" : "-"
                                }
                              />
                            </p>
                          ) : null}
                        </td>
                      </DataTable.Row>
                    );
                  })}
                </DataTable.Body>
          </DataTable>

          <div className="grid grid-cols-1 gap-4 lg:hidden">
            {filteredRows.map((row) => (
              <MobileTradeCard
                key={row.id}
                row={row}
                showLocalCurrency={showLocalCurrency}
                currencyUnit={currencyUnit}
                formatFin={formatFin}
                formatClassCurrency={formatClassCurrency}
                formatWholeNumber={formatWholeNumber}
              />
            ))}
          </div>
          {hasSymbolSearch ? (
            <div className="rounded-[1.5rem] border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500">
              <span className="font-black text-slate-800">
                {normalizedSymbolSearchTerm}
              </span>
              {" "}검색 결과 {summary.totalCount}건을 표시 중입니다.
            </div>
          ) : null}
          </>
        ) : hasSymbolSearch && hasAnyRows ? (
          <EmptyState
            icon={Search}
            title="검색한 종목의 거래내역이 없습니다"
            description="다른 티커를 입력하거나 검색어를 초기화해 보세요."
            className="rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50/70 py-16"
          />
        ) : (
          <EmptyState
            icon={History}
            title="선택한 기간에 거래내역이 없습니다"
            description="전체를 선택하면 누적 거래내역을 한 번에 볼 수 있습니다."
            className="rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50/70 py-16"
          />
        )}
      </SurfaceLoader>
    </section>
  );
}
