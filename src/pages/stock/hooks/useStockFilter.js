import { useMemo, useState, useEffect } from "react";
import { useUser } from "../../../contexts/UserContext";
import { useStockQuotes } from "../../../hooks/stock/useStockQuotes";
import { useStockCategories } from "../../../hooks/stock/useStockCategories";
import { useStockSettings } from "../../../hooks/stock/useStockSettings";

const CATEGORY_GROUP_LABELS = {
  sector: "주식",
  etf: "ETF",
};

function resolveCategoryGroup(name = "") {
  if (/ETF/i.test(name)) {
    return "etf";
  }

  return "sector";
}

export function useStockFilter(classId) {
  const { isTeacher } = useUser();
  const { data: allQuotes, isLoading: isLoadingQuotes } = useStockQuotes(classId);
  const { data: categoryData, isLoading: isLoadingCategories } = useStockCategories(classId);
  const { settings, isLoading: isLoadingSettings } = useStockSettings(classId);

  const categories = useMemo(
    () => categoryData?.categories || {},
    [categoryData?.categories],
  );
  const privilegedSymbols = useMemo(
    () => new Set(categoryData?.privilegedSymbols || []),
    [categoryData?.privilegedSymbols],
  );

  const hiddenStocks = useMemo(() => settings?.hiddenStocks || {}, [settings?.hiddenStocks]);
  const [activeCategory, setActiveCategory] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const isSpecialCategory = activeCategory === "all" || activeCategory === "favorites";
    if (categories && (!activeCategory || (!isSpecialCategory && !categories[activeCategory]))) {
      const categoryKeys = Object.keys(categories);
      const firstCategory = categoryKeys.find((key) => key !== "indices") || categoryKeys[0];
      if (firstCategory) setActiveCategory(firstCategory);
    }
  }, [categories, activeCategory]);

  const allStockSymbols = useMemo(() => {
    if (!categories) return [];

    const symbolsMap = new Map();
    const catalog = [
      ...Object.values(categories).flat(),
      ...(categoryData?.catalogSymbols || []),
    ];
    catalog.forEach((stock) => {
      if (stock && stock.ticker) {
        const symbol = stock.ticker.toUpperCase();
        if (!symbolsMap.has(symbol)) {
          symbolsMap.set(symbol, {
            symbol,
            companyName: stock.companyName || symbol,
            isIndex: !!stock.isIndex,
          });
        }
      }
    });

    return Array.from(symbolsMap.values());
  }, [categories, categoryData?.catalogSymbols]);

  const filteredStocks = useMemo(() => {
    if (!categories || !allQuotes) return [];

    const isSearchMode = searchTerm.trim().length > 0;
    const isFavoritesMode = activeCategory === "favorites";
    const isAllMode = activeCategory === "all";

    let list = [];
    if (isSearchMode || isFavoritesMode || isAllMode) {
      list = allStockSymbols;
    } else {
      list = (categories[activeCategory] || []).map((stock) => ({
        symbol: stock.ticker?.toUpperCase(),
        companyName: stock.companyName,
        isIndex: stock.isIndex,
      }));
    }

    return list
      .map((stock) => ({
        ...stock,
        priceData: allQuotes[stock.symbol] || { current: 0, previousClose: 0, _isMissing: true },
      }))
      .filter((stock) => {
        const isHidden = hiddenStocks[stock.symbol] === true;
        if (!isTeacher && isHidden && !privilegedSymbols.has(stock.symbol)) return false;

        if (isSearchMode) {
          const loweredSearch = searchTerm.toLowerCase();
          return (
            stock.symbol?.toLowerCase().includes(loweredSearch) ||
            stock.companyName?.toLowerCase().includes(loweredSearch)
          );
        }

        return true;
      });
  }, [categories, allQuotes, allStockSymbols, activeCategory, searchTerm, hiddenStocks, isTeacher, privilegedSymbols]);

  const categoryOptions = useMemo(() => {
    if (!categories) return [];

    return Object.entries(categories)
      .filter(([name]) => name !== "indices")
      .map(([name, stocks], index) => {
        const groupKey = resolveCategoryGroup(name);
        return {
          id: name,
          name,
          count: Array.isArray(stocks) ? stocks.length : 0,
          order: index,
          groupKey,
          groupLabel: CATEGORY_GROUP_LABELS[groupKey],
        };
      });
  }, [categories]);

  return {
    filteredStocks,
    allStockSymbols,
    allStocksByCategory: categories || {},
    categoryOptions,
    activeCategory,
    setActiveCategory,
    searchTerm,
    setSearchTerm,
    categoryNames: categories ? Object.keys(categories).filter((name) => name !== "indices") : [],
    privilegedSymbols,
    classCategoryDefinitions: categoryData?.classDefinitions || [],
    isLoading: isLoadingQuotes || isLoadingCategories || isLoadingSettings,
    isSearchMode: searchTerm.trim().length > 0,
  };
}
