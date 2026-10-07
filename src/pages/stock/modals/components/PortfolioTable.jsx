import React, { useMemo } from "react";
import { PieChart, TrendingDown, TrendingUp } from "lucide-react";
import { Button, DataTable, EmptyState } from "../../../../components/ui";

const MobilePortfolioCard = ({
  item,
  weightLabel,
  onOpenSellModal,
  getProfitStyle,
  formatFin,
  formatPercent,
  formatShareQuantity,
  isMyPortfolio,
}) => {
  const profitStyle = getProfitStyle(item.profitRate);
  const portfolioWeightPercent = Number.isFinite(item.portfolioWeightPercent)
    ? item.portfolioWeightPercent
    : 0;
  const isPriceInvalid =
    item.currentPriceUSD === null || item.currentPriceUSD === undefined;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 font-bold text-blue-600">
            {item.symbol.substring(0, 2)}
          </div>
          <div className="min-w-0">
            <h4 className="break-words font-bold text-slate-800">
              {item.companyName}
            </h4>
            <p className="text-xs font-bold text-slate-400">
              {item.symbol}
            </p>
          </div>
        </div>
        {isMyPortfolio ? (
          <Button
            size="sm"
            tone="blue"
            kind="solid"
            className="shrink-0"
            disabled={item.quantity <= 0 || isPriceInvalid}
            onClick={() => onOpenSellModal(item)}
          >
            매도
          </Button>
        ) : null}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-4 rounded-xl bg-slate-50/50 p-3">
        <div>
          <p className="text-xs font-bold text-slate-400">
            보유량
          </p>
          <p className="text-sm font-bold text-slate-700">
            {formatShareQuantity(item.quantity)}주
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold text-slate-400">
            평가액
          </p>
          <p className="text-sm font-bold text-slate-700">
            {formatFin(item.evalAmountUSD)} FIN
          </p>
          <p className="mt-1 text-[11px] font-black text-blue-500">
            {weightLabel} {formatPercent(portfolioWeightPercent)}%
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span
          className={`rounded-lg px-2 py-1 text-xs font-bold ${profitStyle.bg} ${profitStyle.color}`}
        >
          {item.profitRate >= 0 ? "+" : "-"}{" "}
          {formatPercent(Math.abs(item.profitRate))}%
        </span>
        <p className={`text-sm font-bold ${profitStyle.color}`}>
          {item.profitLossUSD >= 0 ? "+" : ""}
          {formatFin(item.profitLossUSD)} FIN
        </p>
      </div>
    </div>
  );
};

const TableRow = ({
  item,
  onOpenSellModal,
  getProfitStyle,
  formatFin,
  formatPercent,
  formatShareQuantity,
  formatStockPrice,
  isMyPortfolio,
}) => {
  const profitStyle = getProfitStyle(item.profitRate);
  const portfolioWeightPercent = Number.isFinite(item.portfolioWeightPercent)
    ? item.portfolioWeightPercent
    : 0;
  const isPriceInvalid = item.currentPriceUSD === null;

  return (
    <DataTable.Row>
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
            {item.symbol.substring(0, 2)}
          </div>
          <div>
            <p className="text-sm font-bold leading-tight text-slate-800">
              {item.companyName}
            </p>
            <p className="text-xs font-bold text-slate-400">
              {item.symbol}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 text-right font-bold text-slate-700">
        <span className="inline-flex w-full items-baseline justify-end gap-1">
          <span>{formatShareQuantity(item.quantity)}</span>
          <span className="text-xs font-bold text-slate-400">주</span>
        </span>
      </td>
      <td className="px-4 py-4 text-right text-xs font-medium text-slate-500">
        <span className="inline-flex w-full items-baseline justify-end gap-1">
          <span>{formatStockPrice(item.avgPriceUSD)}</span>
          <span className="text-xs font-bold text-slate-400">FIN</span>
        </span>
      </td>
      <td className="px-4 py-4 text-right">
        {isPriceInvalid ? (
          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-400">
            시세 확인 중
          </span>
        ) : (
          <span className="inline-flex w-full items-baseline justify-end gap-1 font-bold text-slate-800">
            <span>{formatStockPrice(item.currentPriceUSD)}</span>
            <span className="text-xs font-bold text-slate-400">FIN</span>
          </span>
        )}
      </td>
      <td className="px-4 py-4 text-right font-bold text-blue-600">
        <span className="inline-flex w-full items-baseline justify-end gap-1">
          <span>{formatFin(item.evalAmountUSD)}</span>
          <span className="text-xs font-bold text-blue-300">FIN</span>
        </span>
      </td>
      <td className="px-4 py-4 text-right">
        <span className="inline-flex rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-600">
          {formatPercent(portfolioWeightPercent)}%
        </span>
      </td>
      <td className={`px-4 py-4 text-right font-bold ${profitStyle.color}`}>
        <span className="inline-flex w-full items-baseline justify-end gap-1">
          <span>
            {item.profitLossUSD >= 0 ? "+" : ""}
            {formatFin(item.profitLossUSD)}
          </span>
          <span className="text-xs font-bold opacity-60">FIN</span>
        </span>
      </td>
      <td className="px-4 py-4 text-right">
        <span
          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold ${profitStyle.bg} ${profitStyle.color}`}
        >
          {item.profitRate >= 0 ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          {formatPercent(item.profitRate)}%
        </span>
      </td>
      {isMyPortfolio ? (
      <td className="px-6 py-4 text-center">
          <Button
            size="xs"
            tone="blue"
            kind="solid"
            className="min-w-[72px] whitespace-nowrap px-4 py-2 font-bold transition-all hover:scale-105 active:scale-95"
            disabled={item.quantity <= 0 || isPriceInvalid}
            onClick={() => onOpenSellModal(item)}
          >
            매도하기
          </Button>
        </td>
      ) : null}
    </DataTable.Row>
  );
};

const PortfolioTable = ({
  entries,
  weightLabel = "내 평가액의",
  onOpenSellModal,
  getProfitStyle,
  formatFin,
  formatPercent,
  formatShareQuantity,
  formatStockPrice,
  isMyPortfolio,
}) => {
  const entriesWithWeights = useMemo(() => {
    const totalEvalAmountUSD = (entries || []).reduce(
      (sum, item) => sum + (Number(item?.evalAmountUSD) || 0),
      0,
    );

    return (entries || []).map((item) => ({
      ...item,
      portfolioWeightPercent:
        totalEvalAmountUSD > 0
          ? ((Number(item?.evalAmountUSD) || 0) / totalEvalAmountUSD) * 100
          : 0,
    }));
  }, [entries]);

  if (!entries || entries.length === 0) {
    return (
      <EmptyState
        icon={PieChart}
        title="보유 중인 종목이 없습니다"
        description="주식을 매수하면 포트폴리오 현황이 이곳에 표시됩니다."
        className="rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50/50 py-20"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:hidden">
        {entriesWithWeights.map((item) => (
          <MobilePortfolioCard
            weightLabel={weightLabel}
            key={item.symbol}
            item={item}
            onOpenSellModal={onOpenSellModal}
            getProfitStyle={getProfitStyle}
            formatFin={formatFin}
            formatPercent={formatPercent}
            formatShareQuantity={formatShareQuantity}
            isMyPortfolio={isMyPortfolio}
          />
        ))}
      </div>

      <DataTable
        className="hidden overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm lg:block"
        tableClassName="table-fixed"
      >
          <colgroup>
            <col className={isMyPortfolio ? "w-[18%]" : "w-[20%]"} />
            <col className={isMyPortfolio ? "w-[9%]" : "w-[10%]"} />
            <col className={isMyPortfolio ? "w-[11%]" : "w-[12%]"} />
            <col className={isMyPortfolio ? "w-[11%]" : "w-[12%]"} />
            <col className={isMyPortfolio ? "w-[13%]" : "w-[14%]"} />
            <col className="w-[8%]" />
            <col className={isMyPortfolio ? "w-[13%]" : "w-[14%]"} />
            <col className="w-[9%]" />
            {isMyPortfolio ? <col className="w-[8%]" /> : null}
          </colgroup>
          <DataTable.Header className="bg-slate-50/50">
            <DataTable.Row interactive={false}>
              <DataTable.HeadCell className="px-6 py-4">종목 정보</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">보유 수량</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">평균 단가</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">현재 시세</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">평가 금액</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">비중</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">평가 손익</DataTable.HeadCell>
              <DataTable.HeadCell align="right" className="px-4 py-4">수익률</DataTable.HeadCell>
              {isMyPortfolio ? (
                <DataTable.HeadCell align="center" className="px-6 py-4">액션</DataTable.HeadCell>
              ) : null}
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {entriesWithWeights.map((item) => (
              <TableRow
                key={item.symbol}
                item={item}
                onOpenSellModal={onOpenSellModal}
                getProfitStyle={getProfitStyle}
                formatFin={formatFin}
                formatPercent={formatPercent}
                formatShareQuantity={formatShareQuantity}
                formatStockPrice={formatStockPrice}
                isMyPortfolio={isMyPortfolio}
              />
            ))}
          </DataTable.Body>
        </DataTable>
    </div>
  );
};

export default PortfolioTable;
