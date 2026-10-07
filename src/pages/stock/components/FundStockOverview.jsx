import React from "react";
import { useStockContext } from "../../../contexts/StockContext";

export function FundStockBalance({ fundName, cashBalance, buyingPowerUSD }) {
  const { currencyUnit, formatClassCurrency, formatFin } = useStockContext();

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="break-words text-sm font-semibold text-slate-700 sm:pr-1">
        {fundName || "선택한 기금"} · 기금 계좌
      </p>
      <div className="flex items-baseline gap-2 text-sm">
        <span className="text-xs font-semibold text-slate-500">기금 현금</span>
        <strong className="tabular-nums text-slate-700">
          {formatClassCurrency(cashBalance)} <span className="text-xs">{currencyUnit}</span>
        </strong>
        <span className="text-xs font-semibold tabular-nums text-slate-400">
          ≈ {formatFin(buyingPowerUSD, { fractionDigits: 0 })} FIN
        </span>
      </div>
      <span className="text-xs font-medium text-slate-500">
        주문 시 필요한 금액만 자동환전
      </span>
    </div>
  );
}
