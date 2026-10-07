import React from "react";
import {
  BarChart3,
  Coins,
  Eye,
  EyeOff,
  Info,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Button, IconButton } from "../../../components/ui";
import { useStockContext } from "../../../contexts/StockContext";
import { useUser } from "../../../contexts/UserContext";

const StockListItem = ({
  stockItem,
  onOpenBuyModal,
  tradeDisabled = false,
  onOpenChartModal,
  onOpenStockInfoModal,
  currencyUnit,
  isHiddenFromStudents = false,
  onToggleVisibility,
  isFavorite = false,
  onToggleFavorite,
}) => {
  const { isTeacher } = useUser();
  const { formatPercent, formatStockPrice } = useStockContext();
  const { symbol, companyName, priceData, isIndex = false } = stockItem;

  const currentPrice = priceData?.current || 0;
  const prevClose = priceData?.previousClose || 0;
  const diff = currentPrice - prevClose;
  const changeRate = prevClose > 0 ? (diff / prevClose) * 100 : 0;

  if (!isTeacher && isHiddenFromStudents) return null;

  return (
    <div
      className={`relative flex min-h-[184px] min-w-0 flex-col rounded-2xl border border-slate-200/90 bg-white p-3 transition-colors duration-200 hover:border-blue-200 hover:bg-blue-50/30 ${
        isHiddenFromStudents ? "border-dashed border-slate-300 bg-slate-50 opacity-60 grayscale-[0.5]" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          {isIndex ? (
            <h3 className="truncate text-base font-black leading-none text-slate-800">{companyName}</h3>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="min-w-0 truncate text-base font-black leading-none text-slate-800">{symbol}</h3>
              <IconButton
                icon={Info}
                onClick={() => onOpenStockInfoModal(stockItem)}
                tone="blue"
                size="sm"
                className="rounded-full border-slate-200 bg-slate-50"
                title={`${symbol} 정보 보기`}
                label={`${symbol} 정보 보기`}
              />
            </div>
          )}

          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {isTeacher && isHiddenFromStudents ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-black normal-case tracking-normal">
                <EyeOff size={11} />
                학생 숨김
              </span>
            ) : null}
            <span className="truncate">{companyName || symbol}</span>
          </p>
        </div>

        <div className="ml-1 flex gap-0.5" onClick={(event) => event.stopPropagation()}>
          {!isIndex && (
            <IconButton
              onClick={onToggleFavorite}
              tone="amber"
              size="sm"
              active={isFavorite}
              label={isFavorite ? `${symbol} 관심종목 해제` : `${symbol} 관심종목 추가`}
              className={isFavorite ? "" : "text-slate-300 hover:text-amber-500"}
            >
              <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
            </IconButton>
          )}
          <IconButton
            icon={BarChart3}
            onClick={() => onOpenChartModal(symbol)}
            tone="blue"
            size="sm"
            label={`${symbol} 차트 보기`}
            className="text-slate-300"
          />
          {isTeacher && (
            <IconButton
              icon={isHiddenFromStudents ? EyeOff : Eye}
              onClick={() => onToggleVisibility?.(symbol, !isHiddenFromStudents)}
              tone={isHiddenFromStudents ? "slate" : "blue"}
              size="sm"
              active={isHiddenFromStudents}
              label={isHiddenFromStudents ? `${symbol} 학생에게 보이기` : `${symbol} 학생에게 숨기기`}
            />
          )}
        </div>
      </div>

      <div className="my-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="text-xl font-black tracking-tighter text-slate-900 tabular-nums">
          {formatStockPrice(currentPrice)}
          <span className="ml-1 text-sm font-bold uppercase text-slate-300">{isIndex ? "" : "FIN"}</span>
        </div>

        {prevClose > 0 && (
          <div
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-black ${
              diff >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
            }`}
          >
            {diff >= 0 ? <TrendingUp size={14} strokeWidth={3} /> : <TrendingDown size={14} strokeWidth={3} />}
            <span className="tabular-nums">
              {diff >= 0 ? "+" : ""}
              {formatStockPrice(diff)}{" "}
              ({formatPercent(changeRate, {
                fractionDigits: 1,
                trimTrailingZeros: true,
              })}%)
            </span>
          </div>
        )}
      </div>

      <div className="mt-auto pt-1" onClick={(event) => event.stopPropagation()}>
        {!isIndex ? (
          <Button
            onClick={() => onOpenBuyModal(symbol, companyName, currentPrice)}
            tone="blue"
            kind="solid"
            size="sm"
            fullWidth
            
            icon={Coins}
            disabled={tradeDisabled || currentPrice <= 0 || (isHiddenFromStudents && !isTeacher)}
          >
            {tradeDisabled ? "기금 사용 불가" : "매수하기"}
          </Button>
        ) : (
          <div className="w-full rounded-xl border border-slate-100 bg-slate-50 py-2.5 text-center text-[11px] font-black uppercase tracking-widest text-slate-400">
            실시간 지수 보기
          </div>
        )}
      </div>
    </div>
  );
};

export default StockListItem;
