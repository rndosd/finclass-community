import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Circle,
  Eye,
  EyeOff,
  GraduationCap,
} from "lucide-react";

import { Button, Card, EmptyState, IconButton, Spinner } from "../../../components/ui";
import { useStockContext } from "../../../contexts/StockContext";
import { useUser } from "../../../contexts/UserContext";
import { useStockSettings } from "../../../hooks/stock/useStockSettings";

const REPRESENTATIVE_CATEGORY_IDS = [
  "반도체·하드웨어",
  "소프트웨어·인터넷",
  "금융·핀테크",
  "소비·유통",
  "미디어·통신",
  "헬스케어·바이오",
  "산업재·방산",
  "에너지·소재",
  "운송·모빌리티",
  "미국·글로벌 지수 ETF",
  "채권·현금 ETF",
  "원자재·통화 ETF",
];

const REPRESENTATIVE_CATEGORY_LIMIT = 12;

const getChangePercent = (priceData) => {
  const current = Number(priceData?.current);
  const previousClose = Number(priceData?.previousClose);
  if (!Number.isFinite(current) || !Number.isFinite(previousClose) || previousClose <= 0) {
    return null;
  }
  return ((current - previousClose) / previousClose) * 100;
};

const formatChange = (value) => {
  if (!Number.isFinite(value)) return "시세 준비 중";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const getTone = (value) => {
  if (!Number.isFinite(value) || Math.abs(value) < 0.15) {
    return {
      surface: "border-[#d8dee7] bg-[#e3e7ec]",
      label: "text-[#10264a]",
      value: value > 0 ? "text-[#007a52]" : value < 0 ? "text-[#e1192d]" : "text-slate-600",
    };
  }
  if (value >= 2) {
    return { surface: "border-[#269466] bg-[#269466]", label: "text-white", value: "text-white" };
  }
  if (value > 0) {
    return {
      surface: "border-[#bfe8ce] bg-[#caf0d7]",
      label: "text-[#10264a]",
      value: "text-[#007a52]",
    };
  }
  if (value <= -2) {
    return { surface: "border-[#df4050] bg-[#df4050]", label: "text-white", value: "text-white" };
  }
  return {
    surface: "border-[#f3bfc5] bg-[#fdccd1]",
    label: "text-[#10264a]",
    value: "text-[#e1192d]",
  };
};

export default function TopMoversDashboard({
  isLoadingData,
  allStocksByCategory = {},
  onSelectStock,
  privilegedSymbols = new Set(),
}) {
  const { allPrices } = useStockContext();
  const { isTeacher, classId } = useUser();
  const { settings, updateSettings } = useStockSettings(classId);
  const hiddenStocks = useMemo(() => settings?.hiddenStocks || {}, [settings?.hiddenStocks]);
  const isTopMoversHidden = settings?.isTopMoversHidden === true;
  const [showAllCategories, setShowAllCategories] = useState(false);

  const categories = useMemo(() => {
    return Object.entries(allStocksByCategory)
      .filter(([categoryId]) => categoryId !== "indices")
      .map(([categoryId, stocks]) => {
        const changes = (Array.isArray(stocks) ? stocks : [])
          .map((stock) => {
            const symbol = String(stock?.ticker || stock?.symbol || "").trim().toUpperCase();
            if (
              !symbol ||
              stock?.isIndex ||
              (hiddenStocks[symbol] === true && !privilegedSymbols.has(symbol))
            ) {
              return null;
            }
            return getChangePercent(allPrices?.[symbol]);
          })
          .filter(Number.isFinite);

        if (changes.length === 0) return null;
        return {
          categoryId,
          companyName: categoryId,
          isCategory: true,
          stockCount: changes.length,
          changePercent: changes.reduce((sum, change) => sum + change, 0) / changes.length,
        };
      })
      .filter(Boolean);
  }, [allPrices, allStocksByCategory, hiddenStocks, privilegedSymbols]);

  const representativeCategories = useMemo(() => {
    const categoryMap = new Map(categories.map((category) => [category.categoryId, category]));
    const selected = REPRESENTATIVE_CATEGORY_IDS.map((categoryId) => categoryMap.get(categoryId)).filter(Boolean);
    const selectedIds = new Set(selected.map((category) => category.categoryId));
    const fallbackCategories = categories.filter((category) => !selectedIds.has(category.categoryId));
    return [...selected, ...fallbackCategories].slice(0, REPRESENTATIVE_CATEGORY_LIMIT);
  }, [categories]);

  const visibleCategories = showAllCategories ? categories : representativeCategories;
  const hiddenCategoryCount = Math.max(0, categories.length - representativeCategories.length);

  const handleToggleVisibility = async () => {
    await updateSettings({ isTopMoversHidden: !isTopMoversHidden });
  };

  if (!isTeacher && isTopMoversHidden) return null;

  if (isLoadingData && categories.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-sm">
        <div>
          <Spinner />
          <p className="mt-3 text-xs font-bold tracking-widest text-slate-400">시장 동향 분석 중...</p>
        </div>
      </div>
    );
  }

  return (
    <Card
      noShadow
      className={`relative h-full overflow-hidden rounded-3xl border p-0 shadow-sm transition-all ${
        isTopMoversHidden ? "border-slate-300 bg-slate-50 opacity-70" : "border-slate-100 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-3">
        <div>
          <h3 className="text-lg font-black tracking-tight text-slate-900">주요 시장 동향</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">카테고리별 공개 종목 평균 등락률</p>
        </div>
        <div className="flex items-center gap-2">
          {isTeacher && isTopMoversHidden ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-black text-slate-600">
              <GraduationCap className="h-3 w-3" /> 학생에게 숨김
            </span>
          ) : null}
          {isTeacher ? (
            <IconButton
              icon={isTopMoversHidden ? EyeOff : Eye}
              label={isTopMoversHidden ? "학생에게 보이기" : "학생에게 숨기기"}
              onClick={handleToggleVisibility}
              tone={isTopMoversHidden ? "slate" : "indigo"}
              active={!isTopMoversHidden}
              title={isTopMoversHidden ? "학생들에게 보이기" : "학생들에게 숨기기"}
            />
          ) : null}
        </div>
      </div>

      <section className="px-3 pb-3" aria-label="카테고리별 시장 등락률">
        <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500" aria-label="히트맵 색상 범례">
            <span className="inline-flex items-center gap-1"><Circle className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500" /> 상승</span>
            <span className="inline-flex items-center gap-1"><Circle className="h-2.5 w-2.5 fill-rose-400 text-rose-400" /> 하락</span>
            <span className="inline-flex items-center gap-1"><Circle className="h-2.5 w-2.5 fill-slate-300 text-slate-300" /> 보합</span>
          </div>
        </div>

        {categories.length === 0 ? (
          <EmptyState
            icon={AlertCircle}
            title="카테고리 평균 등락률이 없습니다"
            description="공개된 종목의 시세가 준비되면 이곳에 표시됩니다."
            size="sm"
            className="min-h-[180px] border-slate-200 bg-slate-50/70 py-6"
          />
        ) : (
          <div className="grid auto-rows-[64px] grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
              {visibleCategories.map((category) => {
                const tone = getTone(category.changePercent);
                return (
                  <button
                    key={category.categoryId}
                    type="button"
                    onClick={() => onSelectStock?.(category)}
                    className={`flex min-w-0 flex-col justify-between rounded-lg border p-2.5 text-left transition-all hover:z-10 hover:-translate-y-0.5 hover:shadow-md focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${tone.surface}`}
                    aria-label={`${category.categoryId}, 평균 ${formatChange(category.changePercent)}, ${category.stockCount}개 종목`}
                  >
                    <span className={`truncate text-xs font-black ${tone.label}`}>{category.categoryId}</span>
                    <span className="flex items-end justify-between gap-2">
                      <strong className={`text-sm font-black tabular-nums ${tone.value}`}>{formatChange(category.changePercent)}</strong>
                    </span>
                  </button>
                );
              })}
          </div>
        )}
        {hiddenCategoryCount > 0 ? (
          <div className="mt-3 flex justify-center">
            <Button
              type="button"
              size="sm"
              kind="ghost"
              tone="slate"
              icon={showAllCategories ? ChevronUp : ChevronDown}
              onClick={() => setShowAllCategories((current) => !current)}
            >
              {showAllCategories ? "대표 카테고리만 보기" : `${hiddenCategoryCount}개 카테고리 더 보기`}
            </Button>
          </div>
        ) : null}
      </section>
    </Card>
  );
}
