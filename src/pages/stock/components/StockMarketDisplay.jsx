import React, { useState, memo, useMemo } from "react";
import {
  Button,
  CategoryChipBar,
  EmptyState,
  InputField,
  SurfaceLoader,
} from "../../../components/ui";
import StockListItem from "./StockListItem";
import StockListItemSkeleton from "./StockListItemSkeleton";
import { useUser } from "../../../contexts/UserContext";
import {
  Search,
  Filter as FilterIcon,
  Star,
  ChevronDown,
  Eye,
  EyeOff,
  Layers3,
  PlusCircle,
} from "lucide-react";

const UI_TEXT = {
  favorites: "관심종목",
  allStocks: "전체 종목",
  searchPlaceholder: "티커 또는 종목명을 검색해 보세요",
  noFavorites: "아직 등록된 관심종목이 없습니다.",
  noStocks: "조건에 맞는 주식이 없습니다.",
};

const StockMarketDisplay = ({
  categoryOptions = [],
  classCategoryDefinitions = [],
  currentCategory,
  onSelectCategory,
  onOpenCategoryManager,
  onEditCategory,
  onReorderCategories,
  allStocksByCategory = {},
  searchTerm,
  onSearchChange,
  stocksToDisplay = [],
  isLoadingData,
  onOpenBuyModal,
  tradeDisabled = false,
  onOpenChartModal,
  onOpenStockInfoModal,
  currencyUnit,
  hiddenStocks = {},
  privilegedSymbols = new Set(),
  onToggleStockVisibility,
  onBulkToggleStockVisibility,
  visibilityTemplates = [],
  onApplyVisibilityTemplate,
  isSavingVisibility = false,
}) => {
  const { isTeacher } = useUser();
  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem("finclass_favorites");
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      return [];
    }
  });
  const toggleFavorite = (symbol) => {
    setFavorites((prev) => {
      const isFavorite = prev.includes(symbol);
      const nextFavorites = isFavorite ? prev.filter((id) => id !== symbol) : [...prev, symbol];
      localStorage.setItem("finclass_favorites", JSON.stringify(nextFavorites));
      return nextFavorites;
    });
  };

  const finalStocks = useMemo(() => {
    if (!stocksToDisplay || stocksToDisplay.length === 0) return [];

    return stocksToDisplay.filter((stock) => {
      const symbol = stock.symbol;
      if (!isTeacher && hiddenStocks[symbol] && !privilegedSymbols.has(symbol)) return false;

      if (currentCategory === "favorites") {
        return favorites.includes(symbol);
      }

      return true;
    });
  }, [stocksToDisplay, currentCategory, favorites, hiddenStocks, isTeacher, privilegedSymbols]);

  const showSkeleton = isLoadingData && finalStocks.length === 0;
  const showRefreshing = isLoadingData && finalStocks.length > 0;
  const selectedCategoryOption = useMemo(
    () => categoryOptions.find((option) => option.id === currentCategory) || null,
    [categoryOptions, currentCategory],
  );
  const classCategoryNames = useMemo(
    () =>
      new Set(
        classCategoryDefinitions
          .filter((category) => category?.isActive !== false)
          .map((category) => String(category?.name || "").trim())
          .filter(Boolean),
      ),
    [classCategoryDefinitions],
  );
  const defaultCategoryOptions = useMemo(
    () => categoryOptions.filter((option) => !classCategoryNames.has(option.id)),
    [categoryOptions, classCategoryNames],
  );
  const classCategoryOptions = useMemo(
    () => categoryOptions.filter((option) => classCategoryNames.has(option.id)),
    [categoryOptions, classCategoryNames],
  );
  const classCategoryItems = useMemo(() => {
    const definitionsByName = new Map(
      classCategoryDefinitions.map((category) => [String(category?.name || "").trim(), category]),
    );
    return classCategoryOptions.map((option) => ({
      id: option.id,
      label: option.name,
      iconKey: "Tag",
      colorKey: "indigo",
      active: true,
      editable: true,
      reorderable: true,
      raw: definitionsByName.get(option.id) || null,
    }));
  }, [classCategoryDefinitions, classCategoryOptions]);
  const categoryVisibilityTargets = useMemo(
    () => {
      if (!selectedCategoryOption) return [];

      return (allStocksByCategory[currentCategory] || [])
        .map((stock) => ({
          symbol: stock.ticker?.toUpperCase(),
          companyName: stock.companyName,
          isIndex: stock.isIndex,
        }))
        .filter((stock) => !stock.isIndex && stock.symbol);
    },
    [allStocksByCategory, currentCategory, selectedCategoryOption],
  );
  const categoryTargetSymbols = useMemo(
    () => categoryVisibilityTargets.map((stock) => stock.symbol),
    [categoryVisibilityTargets],
  );
  const hiddenCategoryCount = useMemo(
    () => categoryVisibilityTargets.filter((stock) => hiddenStocks[stock.symbol] === true).length,
    [categoryVisibilityTargets, hiddenStocks],
  );
  const shouldRevealCategory = hiddenCategoryCount > 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div
        data-tour="stock-market-filters"
        className="sticky top-0 z-20 mb-3 rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-sm backdrop-blur-md"
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex shrink-0 gap-2">
              <Button
                onClick={() => onSelectCategory("all")}
                tone="slate"
                kind={currentCategory === "all" ? "solid" : "outline"}
                size="sm"
                rounded="lg"
                
              >
                {UI_TEXT.allStocks}
              </Button>

              <Button
                onClick={() => onSelectCategory(currentCategory === "favorites" ? "all" : "favorites")}
                tone={currentCategory === "favorites" ? "amber" : "slate"}
                kind={currentCategory === "favorites" ? "solid" : "outline"}
                size="sm"
                rounded="lg"
                
              >
                <Star className={`h-4 w-4 ${currentCategory === "favorites" ? "fill-white" : ""}`} />
                {UI_TEXT.favorites}
              </Button>
            </div>

            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <InputField
                type="text"
                placeholder={UI_TEXT.searchPlaceholder}
                value={searchTerm}
                onChange={(event) => onSearchChange(event.target.value)}
                className="!py-2 rounded-xl border-slate-200 bg-slate-50/70 pl-10 transition-all focus:bg-white"
              />
            </div>

          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 pt-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center">
              <label htmlFor="stock-category-select" className="text-xs font-bold text-slate-500">
                카테고리
              </label>
              <div className="relative min-w-0 sm:w-64">
                <select
                  id="stock-category-select"
                  value={defaultCategoryOptions.some((option) => option.id === currentCategory) ? currentCategory : ""}
                  onChange={(event) => onSelectCategory(event.target.value)}
                  className="h-9 w-full appearance-none rounded-xl border border-blue-200 bg-blue-50/50 py-1.5 pl-3 pr-9 text-sm font-bold text-slate-700 shadow-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  aria-label="카테고리 선택"
                >
                  <option value="" disabled>
                    카테고리 선택
                  </option>
                  {defaultCategoryOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              {classCategoryItems.length > 0 ? (
                <CategoryChipBar
                  items={classCategoryItems}
                  selectedId={currentCategory}
                  onSelect={onSelectCategory}
                  canEdit={isTeacher}
                  onAdd={onOpenCategoryManager}
                  onEdit={(item) => item.raw && onEditCategory?.(item.raw)}
                  onReorder={(items) =>
                    onReorderCategories?.(items.map((item) => item.raw).filter(Boolean))
                  }
                  showDeleteAction={false}
                  mode="navigation"
                  addLabel="카테고리 추가"
                  className="!mt-0 min-w-0 flex-1"
                />
              ) : isTeacher ? (
                <Button tone="slate" kind="outline" size="xs"
                  type="button"
                  onClick={onOpenCategoryManager}
                  className="inline-flex items-center gap-1.5 transition"
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  카테고리 추가
                </Button>
              ) : null}
            </div>

            {isTeacher ? (
              <div className="flex flex-wrap items-center gap-2">
                {visibilityTemplates.length > 0 ? (
                  <div className="relative">
                    <Layers3 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <select
                      value=""
                      onChange={(event) => {
                        const selectedTemplate = visibilityTemplates.find(
                          (template) => template.id === event.target.value,
                        );
                        if (selectedTemplate) {
                          onApplyVisibilityTemplate?.(selectedTemplate);
                        }
                      }}
                      disabled={!onApplyVisibilityTemplate || isSavingVisibility}
                      className="h-8 min-w-[148px] appearance-none rounded-xl border border-blue-200 bg-blue-50/50 py-1 pl-8 pr-8 text-xs font-bold text-slate-600 shadow-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="공개 템플릿 선택"
                    >
                      <option value="" disabled>
                        공개 템플릿
                      </option>
                      {visibilityTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  </div>
                ) : null}

                <Button
                  onClick={() =>
                    onBulkToggleStockVisibility?.(categoryTargetSymbols, !shouldRevealCategory)
                  }
                  tone={shouldRevealCategory ? "blue" : "slate"}
                  kind={shouldRevealCategory ? "soft" : "outline"}
                  size="xs"
                  rounded="lg"
                  icon={shouldRevealCategory ? Eye : EyeOff}
                  disabled={!selectedCategoryOption || categoryTargetSymbols.length === 0}
                  isLoading={isSavingVisibility}
                  
                >
                  {shouldRevealCategory ? "카테고리 모두 보이기" : "카테고리 숨기기"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <SurfaceLoader
        loading={showRefreshing}
        variant="refreshing"
        message="종목 목록을 업데이트하는 중입니다..."
      >
        <div
          data-tour="stock-market-grid"
          className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
        >
          {showSkeleton ? (
            Array.from({ length: 6 }).map((_, index) => <StockListItemSkeleton key={index} />)
          ) : finalStocks.length === 0 ? (
            <EmptyState
              icon={FilterIcon}
              title={currentCategory === "favorites" ? UI_TEXT.noFavorites : UI_TEXT.noStocks}
              description={
                currentCategory === "favorites"
                  ? "관심종목을 추가하면 이곳에서 빠르게 확인할 수 있습니다."
                  : "검색어나 카테고리 필터를 조정해 다시 확인해 보세요."
              }
              className="col-span-full rounded-2xl border-slate-100 bg-white py-16 shadow-none"
            />
          ) : (
            finalStocks.map((stock) => (
              <StockListItem
                key={stock.symbol}
                stockItem={stock}
                onOpenBuyModal={onOpenBuyModal}
                tradeDisabled={tradeDisabled}
                onOpenChartModal={onOpenChartModal}
                onOpenStockInfoModal={onOpenStockInfoModal}
                currencyUnit={currencyUnit}
                isHiddenFromStudents={hiddenStocks[stock.symbol] === true}
                onToggleVisibility={onToggleStockVisibility}
                isFavorite={favorites.includes(stock.symbol)}
                onToggleFavorite={() => toggleFavorite(stock.symbol)}
              />
            ))
          )}
        </div>
      </SurfaceLoader>
    </div>
  );
};

export default memo(StockMarketDisplay);
