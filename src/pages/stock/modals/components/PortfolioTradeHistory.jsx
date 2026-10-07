import React, { useMemo } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Coins,
  Filter,
  History,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Button,
  DataTable,
  EmptyState,
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

const getGrossAmountUSD = (trade) => toSafeNumber(trade?.grossUSD, 0);

const getLocalAmount = (usdAmount, trade, defaultConversionRate) =>
  usdAmount / getAppliedRate(trade, defaultConversionRate);

const getStoredOrConvertedLocalAmount = (
  storedValue,
  usdAmount,
  trade,
  defaultConversionRate,
) => {
  const numericStoredValue = Number(storedValue);
  if (Number.isFinite(numericStoredValue)) {
    return numericStoredValue;
  }
  return getLocalAmount(usdAmount, trade, defaultConversionRate);
};

const getProfitTone = (value) => {
  if (value > 0) {
    return {
      text: "text-emerald-600",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      icon: TrendingUp,
      iconBg: "bg-emerald-100 text-emerald-700",
    };
  }

  if (value < 0) {
    return {
      text: "text-rose-600",
      bg: "bg-rose-50",
      border: "border-rose-200",
      icon: TrendingDown,
      iconBg: "bg-rose-100 text-rose-700",
    };
  }

  return {
    text: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
    icon: History,
    iconBg: "bg-slate-100 text-slate-600",
  };
};

const getStatusMeta = (item) => {
  if (item.netQuantity > 0) {
    return {
      label: "보유중",
      className: "border border-blue-200 bg-blue-50 text-blue-700",
    };
  }

  return {
    label: "전량정리",
    className: "border border-slate-200 bg-slate-100 text-slate-600",
  };
};

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

const AmountValue = ({
  amountUSD,
  amountLocal,
  showLocalCurrency,
  currencyUnit,
  formatFin,
  formatClassCurrency,
  emphasize = false,
  align = "right",
  toneClassName = "text-slate-900",
}) => {
  const value = formatDisplayAmount({
    amountUSD,
    amountLocal,
    showLocalCurrency,
    currencyUnit,
    formatFin,
    formatClassCurrency,
  });

  return (
    <div className={align === "left" ? "text-left" : "text-right"}>
      <p className={`font-black ${emphasize ? toneClassName : "text-slate-700"}`}>
        {value}
      </p>
    </div>
  );
};

const SummaryCard = ({
  title,
  amountUSD,
  amountLocal,
  showLocalCurrency,
  currencyUnit,
  formatFin,
  formatClassCurrency,
  helperText,
  tone,
  icon: Icon,
  iconBg,
}) => (
  <div className={`rounded-[1.75rem] border p-5 shadow-sm ${tone.bg} ${tone.border}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          {title}
        </p>
        <div className="mt-3">
          <AmountValue
            amountUSD={amountUSD}
            amountLocal={amountLocal}
            showLocalCurrency={showLocalCurrency}
            currencyUnit={currencyUnit}
            formatFin={formatFin}
            formatClassCurrency={formatClassCurrency}
            align="left"
            emphasize
            toneClassName={tone.text}
          />
        </div>
      </div>
      <div className={`rounded-2xl p-2.5 ${iconBg}`}>
        <Icon className="h-4 w-4" />
      </div>
    </div>
    <p className="mt-3 text-xs font-medium text-slate-400">{helperText}</p>
  </div>
);

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

const MobileSymbolCard = ({
  item,
  showLocalCurrency,
  currencyUnit,
  formatFin,
  formatClassCurrency,
  formatWholeNumber,
}) => {
  const profitTone = getProfitTone(item.periodProfitUSD);
  const statusMeta = getStatusMeta(item);

  return (
    <div className="rounded-[1.75rem] border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-lg font-black text-slate-800">{item.symbol}</p>
            <span
              className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black ${statusMeta.className}`}
            >
              {statusMeta.label}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-slate-400">
            매수 {item.buyCount}회 · 매도 {item.sellCount}회 · 배당 {item.dividendCount}회
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-black ${profitTone.bg} ${profitTone.border} ${profitTone.text}`}
        >
          {item.periodProfitUSD >= 0 ? "+" : ""}
          {formatDisplayAmount({
            amountUSD: item.periodProfitUSD,
            amountLocal: item.periodProfitLocal,
            showLocalCurrency,
            currencyUnit,
            formatFin,
            formatClassCurrency,
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            총 매수
          </p>
          <div className="mt-2">
            <AmountValue
              amountUSD={item.buyAmountUSD}
              amountLocal={item.buyAmountLocal}
              showLocalCurrency={showLocalCurrency}
              currencyUnit={currencyUnit}
              formatFin={formatFin}
              formatClassCurrency={formatClassCurrency}
              align="left"
            />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            총 매도
          </p>
          <div className="mt-2">
            <AmountValue
              amountUSD={item.sellAmountUSD}
              amountLocal={item.sellAmountLocal}
              showLocalCurrency={showLocalCurrency}
              currencyUnit={currencyUnit}
              formatFin={formatFin}
              formatClassCurrency={formatClassCurrency}
              align="left"
            />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            총 배당
          </p>
          <div className="mt-2">
            <AmountValue
              amountUSD={item.dividendUSD}
              amountLocal={item.dividendLocal}
              showLocalCurrency={showLocalCurrency}
              currencyUnit={currencyUnit}
              formatFin={formatFin}
              formatClassCurrency={formatClassCurrency}
              align="left"
            />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            순매수 수량
          </p>
          <p className="mt-2 text-left text-sm font-black text-slate-800">
            {formatWholeNumber(item.netQuantity)}주
          </p>
        </div>
      </div>
    </div>
  );
};

export default function PortfolioTradeHistory({
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
  selectedPeriodDays = 30,
  onSelectPeriodDays,
}) {
  const summary = useMemo(() => {
    const totals = {
      realizedGainUSD: 0,
      realizedGainLocal: 0,
      dividendUSD: 0,
      dividendLocal: 0,
      buyAmountUSD: 0,
      buyAmountLocal: 0,
      sellAmountUSD: 0,
      sellAmountLocal: 0,
      tradeCount: trades.length,
    };

    const bySymbol = new Map();

    trades.forEach((trade) => {
      const symbol = String(trade?.symbol || "-").toUpperCase();
      const grossUSD = getGrossAmountUSD(trade);
      const grossLocal = getLocalAmount(grossUSD, trade, defaultConversionRate);
      const quantity = toSafeNumber(trade?.quantity, 0);
      const realizedGainUSD = toSafeNumber(trade?.realizedGainUSD, 0);
      const realizedGainLocal = getStoredOrConvertedLocalAmount(
        trade?.realizedGainInClassCurrency,
        realizedGainUSD,
        trade,
        defaultConversionRate,
      );
      const dividendUSD =
        trade?.type === "STOCK_DIVIDEND" ? grossUSD : 0;
      const dividendLocal =
        trade?.type === "STOCK_DIVIDEND"
          ? getStoredOrConvertedLocalAmount(
              trade?.grossInClassCurrency,
              dividendUSD,
              trade,
              defaultConversionRate,
            )
          : 0;

      if (!bySymbol.has(symbol)) {
        bySymbol.set(symbol, {
          symbol,
          buyAmountUSD: 0,
          buyAmountLocal: 0,
          sellAmountUSD: 0,
          sellAmountLocal: 0,
          dividendUSD: 0,
          dividendLocal: 0,
          realizedGainUSD: 0,
          realizedGainLocal: 0,
          periodProfitUSD: 0,
          periodProfitLocal: 0,
          buyQuantity: 0,
          sellQuantity: 0,
          netQuantity: 0,
          buyCount: 0,
          sellCount: 0,
          dividendCount: 0,
        });
      }

      const item = bySymbol.get(symbol);

      if (trade?.type === "STOCK_BUY") {
        item.buyAmountUSD += grossUSD;
        item.buyAmountLocal += grossLocal;
        item.buyQuantity += quantity;
        item.netQuantity += quantity;
        item.buyCount += 1;
        totals.buyAmountUSD += grossUSD;
        totals.buyAmountLocal += grossLocal;
      }

      if (trade?.type === "STOCK_SELL") {
        item.sellAmountUSD += grossUSD;
        item.sellAmountLocal += grossLocal;
        item.sellQuantity += quantity;
        item.netQuantity -= quantity;
        item.sellCount += 1;
        item.realizedGainUSD += realizedGainUSD;
        item.realizedGainLocal += realizedGainLocal;
        totals.sellAmountUSD += grossUSD;
        totals.sellAmountLocal += grossLocal;
        totals.realizedGainUSD += realizedGainUSD;
        totals.realizedGainLocal += realizedGainLocal;
      }

      if (trade?.type === "STOCK_DIVIDEND") {
        item.dividendUSD += dividendUSD;
        item.dividendLocal += dividendLocal;
        item.dividendCount += 1;
        totals.dividendUSD += dividendUSD;
        totals.dividendLocal += dividendLocal;
      }

      item.periodProfitUSD = item.realizedGainUSD + item.dividendUSD;
      item.periodProfitLocal = item.realizedGainLocal + item.dividendLocal;
    });

    const symbolRows = Array.from(bySymbol.values()).sort((a, b) => {
      if (b.periodProfitUSD !== a.periodProfitUSD) {
        return b.periodProfitUSD - a.periodProfitUSD;
      }
      return a.symbol.localeCompare(b.symbol, "en");
    });

    return {
      ...totals,
      totalProfitUSD: totals.realizedGainUSD + totals.dividendUSD,
      totalProfitLocal: totals.realizedGainLocal + totals.dividendLocal,
      symbolRows,
    };
  }, [defaultConversionRate, trades]);

  const profitTone = getProfitTone(summary.totalProfitUSD);
  const ProfitIcon = profitTone.icon;
  const realizedRows = summary.symbolRows.filter(
    (item) => item.sellCount > 0 || item.dividendCount > 0,
  );
  const hasRealizedRows = realizedRows.length > 0;
  const hasTradeSummary = summary.tradeCount > 0;

  const renderTable = (rows, title, description) => (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h4 className="text-lg font-bold text-slate-800">{title}</h4>
          <p className="text-sm text-slate-400">{description}</p>
        </div>
        <p className="text-sm font-bold text-slate-500">
          {rows.length}종목
        </p>
      </div>

      <DataTable
        className="hidden overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm lg:block"
      >
          <DataTable.Header className="bg-slate-50/80">
            <DataTable.Row interactive={false}>
              <DataTable.HeadCell className="px-6 py-4">종목</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">기간 손익</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">총 매수</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">총 매도</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">총 배당</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-6 py-4">순매수 수량</DataTable.HeadCell>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {rows.map((item) => {
              const rowTone = getProfitTone(item.periodProfitUSD);
              const statusMeta = getStatusMeta(item);

              return (
                <DataTable.Row
                  key={item.symbol}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-800">
                        {item.symbol}
                      </p>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${statusMeta.className}`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      매수 {item.buyCount}회 · 매도 {item.sellCount}회 · 배당 {item.dividendCount}회
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <AmountValue
                      amountUSD={item.periodProfitUSD}
                      amountLocal={item.periodProfitLocal}
                      showLocalCurrency={showLocalCurrency}
                      currencyUnit={currencyUnit}
                      formatFin={formatFin}
                      formatClassCurrency={formatClassCurrency}
                      emphasize
                      toneClassName={rowTone.text}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <AmountValue
                      amountUSD={item.buyAmountUSD}
                      amountLocal={item.buyAmountLocal}
                      showLocalCurrency={showLocalCurrency}
                      currencyUnit={currencyUnit}
                      formatFin={formatFin}
                      formatClassCurrency={formatClassCurrency}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <AmountValue
                      amountUSD={item.sellAmountUSD}
                      amountLocal={item.sellAmountLocal}
                      showLocalCurrency={showLocalCurrency}
                      currencyUnit={currencyUnit}
                      formatFin={formatFin}
                      formatClassCurrency={formatClassCurrency}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <AmountValue
                      amountUSD={item.dividendUSD}
                      amountLocal={item.dividendLocal}
                      showLocalCurrency={showLocalCurrency}
                      currencyUnit={currencyUnit}
                      formatFin={formatFin}
                      formatClassCurrency={formatClassCurrency}
                    />
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-bold text-slate-800">
                    {formatWholeNumber(item.netQuantity)}주
                  </td>
                </DataTable.Row>
              );
            })}
          </DataTable.Body>
        </DataTable>

      <div className="grid grid-cols-1 gap-4 lg:hidden">
        {rows.map((item) => (
          <MobileSymbolCard
            key={item.symbol}
            item={item}
            showLocalCurrency={showLocalCurrency}
            currencyUnit={currencyUnit}
            formatFin={formatFin}
            formatClassCurrency={formatClassCurrency}
            formatWholeNumber={formatWholeNumber}
          />
        ))}
      </div>
    </div>
  );

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
                기간별 손익
              </h3>
              <p className="text-sm font-medium text-slate-500">
                선택한 기간 동안의 실현손익과 배당을 종목별로 모아 봅니다.
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
          총 <span className="font-black text-slate-800">{summary.tradeCount}건</span>
          의 거래를 기준으로 기간 성과를 집계합니다.
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
          </div>
        ) : null}
      </div>

      <SurfaceLoader
        loading={isLoading}
        variant={hasTradeSummary ? "refreshing" : "surface-loading"}
        preserveContent={hasTradeSummary}
        skeleton={
          <TableSkeleton
            bare
            columns={6}
            rows={6}
            className="h-full min-h-full"
          />
        }
        minHeightClassName="min-h-[360px]"
      >
        {hasTradeSummary ? (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <SummaryCard
              title="기간 손익"
              amountUSD={summary.totalProfitUSD}
              amountLocal={summary.totalProfitLocal}
              showLocalCurrency={showLocalCurrency}
              currencyUnit={currencyUnit}
              formatFin={formatFin}
              formatClassCurrency={formatClassCurrency}
              helperText="매도 실현손익과 배당을 합친 값입니다."
              tone={profitTone}
              icon={ProfitIcon}
              iconBg={profitTone.iconBg}
            />
            <SummaryCard
              title="총 매수금액"
              amountUSD={summary.buyAmountUSD}
              amountLocal={summary.buyAmountLocal}
              showLocalCurrency={showLocalCurrency}
              currencyUnit={currencyUnit}
              formatFin={formatFin}
              formatClassCurrency={formatClassCurrency}
              helperText="기간 내 매수 체결 금액 기준입니다."
              tone={{
                text: "text-blue-700",
                bg: "bg-white",
                border: "border-slate-100",
              }}
              icon={ArrowDownLeft}
              iconBg="bg-blue-100 text-blue-700"
            />
            <SummaryCard
              title="총 매도금액"
              amountUSD={summary.sellAmountUSD}
              amountLocal={summary.sellAmountLocal}
              showLocalCurrency={showLocalCurrency}
              currencyUnit={currencyUnit}
              formatFin={formatFin}
              formatClassCurrency={formatClassCurrency}
              helperText="기간 내 매도 체결 금액 기준입니다."
              tone={{
                text: "text-emerald-700",
                bg: "bg-white",
                border: "border-slate-100",
              }}
              icon={ArrowUpRight}
              iconBg="bg-emerald-100 text-emerald-700"
            />
            <SummaryCard
              title="총 배당금"
              amountUSD={summary.dividendUSD}
              amountLocal={summary.dividendLocal}
              showLocalCurrency={showLocalCurrency}
              currencyUnit={currencyUnit}
              formatFin={formatFin}
              formatClassCurrency={formatClassCurrency}
              helperText="기간 중 지급된 배당만 집계합니다."
              tone={{
                text: "text-amber-700",
                bg: "bg-white",
                border: "border-slate-100",
              }}
              icon={Coins}
              iconBg="bg-amber-100 text-amber-700"
            />
          </div>

          {hasRealizedRows ? (
            renderTable(
              realizedRows,
              "실현 손익이 있는 종목",
              "기간 내 매도 또는 배당으로 손익이 확정된 종목만 보여줍니다.",
            )
          ) : (
            <EmptyState
              icon={History}
              title="이 기간에는 아직 실현된 손익이 없어요"
              description="매수만 한 종목은 목록에서 제외하고, 매도나 배당이 생기면 여기에 표시됩니다."
              className="rounded-[2rem] border border-slate-100 bg-white py-14 shadow-sm"
            />
          )}
          </>
        ) : (
          <EmptyState
            icon={History}
            title="선택한 기간에는 주식 거래가 없습니다"
            description="기간을 넓히면 손익과 종목별 성과를 확인할 수 있습니다."
            className="rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50/70 py-16"
          />
        )}
      </SurfaceLoader>
    </section>
  );
}

