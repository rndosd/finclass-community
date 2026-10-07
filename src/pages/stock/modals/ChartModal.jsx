import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import {
  Badge,
  Button,
  ChartSkeleton,
  EmptyState,
  Modal,
  SurfaceLoader,
} from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";

const TRADINGVIEW_SCRIPT_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

const TRADINGVIEW_SYMBOL_MAP = {
  "^GSPC": "SP:SPX",
  "^IXIC": "NASDAQ:IXIC",
  "^DJI": "DJ:DJI",
  "^RUT": "TVC:RUT",
  "^VIX": "CBOE:VIX",
};

function resolveTradingViewSymbol(symbol) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) return "";
  return TRADINGVIEW_SYMBOL_MAP[normalizedSymbol] || normalizedSymbol;
}

function buildTradingViewSymbolUrl(tradingViewSymbol) {
  const slug = String(tradingViewSymbol || "").trim().replace(":", "-");

  if (!slug) {
    return "https://www.tradingview.com/?utm_source=finclass&utm_medium=widget_new&utm_campaign=advanced-chart";
  }

  return `https://www.tradingview.com/symbols/${slug}/?utm_source=finclass&utm_medium=widget_new&utm_campaign=advanced-chart`;
}

function buildAdvancedChartConfig(symbol, isTeacher) {
  const resolvedSymbol = resolveTradingViewSymbol(symbol);
  const isStudentMode = !isTeacher;

  return {
    autosize: true,
    symbol: resolvedSymbol,
    interval: "D",
    timezone: "exchange",
    theme: "light",
    style: "1",
    locale: "kr",
    allow_symbol_change: false,
    withdateranges: true,
    hide_side_toolbar: !isTeacher,
    hide_top_toolbar: !isTeacher,
    save_image: false,
    calendar: false,
    details: false,
    hotlist: false,
    studies: [],
    disabled_features: isStudentMode
      ? [
          "context_menus",
          "legend_context_menu",
          "legend_inplace_edit",
          "symbol_search_hot_key",
          "main_series_scale_menu",
        ]
      : [],
    backgroundColor: "rgba(255, 255, 255, 1)",
    gridColor: "rgba(148, 163, 184, 0.12)",
    watchlist: [],
    support_host: "https://www.tradingview.com",
  };
}

function formatDividendDate(dateKey) {
  if (!dateKey) return "-";
  const parsed = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString("ko-KR");
}

function formatDividendAmount(value, currency = "USD") {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  return `${numericValue.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} ${currency}`;
}

function formatDividendPercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "-";
  return `${numericValue.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function TradingViewChart({ symbol, isTeacher }) {
  const containerRef = useRef(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [hasError, setHasError] = useState(false);

  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const tradingViewSymbol = useMemo(
    () => resolveTradingViewSymbol(normalizedSymbol),
    [normalizedSymbol],
  );
  const widgetConfig = useMemo(
    () => buildAdvancedChartConfig(normalizedSymbol, isTeacher),
    [normalizedSymbol, isTeacher],
  );
  const tradingViewSymbolUrl = useMemo(
    () => buildTradingViewSymbolUrl(tradingViewSymbol),
    [tradingViewSymbol],
  );

  useEffect(() => {
    const mountNode = containerRef.current;
    if (!mountNode || !normalizedSymbol) return undefined;

    setIsBootstrapping(true);
    setHasError(false);
    mountNode.innerHTML = "";

    const widgetRoot = document.createElement("div");
    widgetRoot.className = "tradingview-widget-container h-full w-full";
    widgetRoot.style.height = "100%";
    widgetRoot.style.width = "100%";

    const widgetHost = document.createElement("div");
    widgetHost.className = "tradingview-widget-container__widget h-full w-full";
    widgetHost.style.height = "calc(100% - 28px)";
    widgetHost.style.width = "100%";

    const copyright = document.createElement("div");
    copyright.className =
      "tradingview-widget-copyright mt-2 text-right text-[10px] text-slate-400";
    copyright.innerHTML = isTeacher
      ? `<a href="${tradingViewSymbolUrl}" rel="noopener nofollow" target="_blank" class="text-slate-500 hover:underline">${normalizedSymbol} chart</a> by TradingView`
      : `${normalizedSymbol} chart by TradingView`;

    const script = document.createElement("script");
    script.src = TRADINGVIEW_SCRIPT_SRC;
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify(widgetConfig);
    script.onload = () => setIsBootstrapping(false);
    script.onerror = () => {
      setHasError(true);
      setIsBootstrapping(false);
    };

    widgetRoot.appendChild(widgetHost);
    widgetRoot.appendChild(copyright);
    widgetRoot.appendChild(script);
    mountNode.appendChild(widgetRoot);

    const bootstrapTimeout = window.setTimeout(() => {
      setIsBootstrapping(false);
    }, 2500);

    return () => {
      window.clearTimeout(bootstrapTimeout);
      mountNode.innerHTML = "";
    };
  }, [normalizedSymbol, isTeacher, tradingViewSymbolUrl, widgetConfig]);

  if (!normalizedSymbol) {
    return (
      <EmptyState
        icon={Search}
        title="종목이 선택되지 않았습니다"
        description="차트를 보려면 먼저 종목을 선택해 주세요."
        className="h-[460px] rounded-[2rem] border-2 border-slate-200 bg-slate-50 p-8"
      />
    );
  }

  return (
    <div className="relative min-h-[460px] rounded-[2rem] border border-slate-100 bg-white p-4 shadow-sm">
      {isBootstrapping ? (
        <div className="absolute inset-4 z-10">
          <SurfaceLoader
            loading
            variant="surface-loading"
            message="차트를 불러오는 중..."
            minHeightClassName="min-h-[428px]"
            skeleton={
              <ChartSkeleton
                bare
                className="h-full min-h-full"
                heightClassName="h-[320px]"
              />
            }
            className="h-full rounded-[1.5rem]"
            overlayClassName="rounded-[1.5rem]"
          />
        </div>
      ) : null}

      {hasError ? (
        <EmptyState
          icon={Search}
          title="차트를 불러오지 못했습니다"
          description="잠시 후 다시 시도하거나 다른 종목을 열어보세요."
          className="h-[460px] rounded-[1.5rem] border-2 border-slate-200 bg-slate-50 p-8"
        />
      ) : (
        <>
          <div ref={containerRef} className="h-[460px] w-full" />
          {!isTeacher && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-auto absolute left-4 top-4 z-30 h-10 w-[28rem] rounded-xl bg-transparent"
                title="학생 화면에서는 차트 설정을 변경할 수 없습니다."
              />
              <div
                aria-hidden="true"
                className="pointer-events-auto absolute bottom-[118px] left-3 z-30 h-24 w-40 rounded-2xl bg-white/98 shadow-[0_0_0_10px_rgba(255,255,255,0.98)]"
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

const ChartModal = ({ isOpen, onClose, symbol, dividendInfo = null }) => {
  const { isTeacher } = useUser();

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} title={`${symbol || ""} 차트`} onClose={onClose} size="lg">
      <div className="w-full animate-in fade-in zoom-in-95 duration-500">
        <TradingViewChart symbol={symbol} isTeacher={isTeacher} />

        {dividendInfo && (
          <div className="mt-4 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  dividendInfo.isClassPolicy
                    ? "indigo"
                    : dividendInfo.status === "earned"
                    ? "blue"
                    : "emerald"
                }
                size="sm"
                className="font-black"
              >
                {dividendInfo.isClassPolicy
                  ? "학급 배당 예정"
                  : dividendInfo.status === "earned"
                  ? "지급 예정"
                  : "배당 예정"}
              </Badge>
              {dividendInfo.isClassPolicy && (
                <Badge tone="indigo" size="sm" className="font-black">
                  학급 설정 우선 적용
                </Badge>
              )}
              {dividendInfo.frequencyLabel && (
                <Badge tone="slate" size="sm" className="font-black">
                  {dividendInfo.frequencyLabel}
                </Badge>
              )}
            </div>

            <div className={`mt-3 grid gap-3 ${dividendInfo.isClassPolicy ? "sm:grid-cols-5" : "sm:grid-cols-3"}`}>
              <div className="rounded-2xl bg-white/80 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">주당 배당금</p>
                <p className="mt-1 text-sm font-black text-slate-800">
                  {formatDividendAmount(dividendInfo.amountUSDPerShare, dividendInfo.currency)}
                </p>
              </div>
              <div className="rounded-2xl bg-white/80 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">배당락일</p>
                <p className="mt-1 text-sm font-black text-slate-800">
                  {formatDividendDate(dividendInfo.exDateNY)}
                </p>
              </div>
              <div className="rounded-2xl bg-white/80 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">지급일</p>
                <p className="mt-1 text-sm font-black text-slate-800">
                  {formatDividendDate(dividendInfo.payDateNY)}
                </p>
              </div>
              {dividendInfo.isClassPolicy && (
                <>
                  <div className="rounded-2xl bg-white/80 px-4 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">목표 연수익률</p>
                    <p className="mt-1 text-sm font-black text-slate-800">
                      {formatDividendPercent(dividendInfo.classYieldPercent)}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      배당락 {dividendInfo.classExDividendLeadTradingDays ?? 1}영업일 전
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/80 px-4 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">원본 참고 배당률</p>
                    <p className="mt-1 text-sm font-black text-slate-800">
                      {formatDividendPercent(dividendInfo.referenceYieldPercent)}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 px-2 text-xs leading-5 text-slate-500">
          {isTeacher
            ? "차트 도구로 가격 흐름을 살펴볼 수 있습니다."
            : "차트 아래에서 기간을 선택해 가격 흐름을 살펴보세요."}
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <Button size="md" onClick={onClose} tone="slate" kind="soft" >
          닫기
        </Button>
      </div>
    </Modal>
  );
};

export default ChartModal;
