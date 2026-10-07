import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { Button, ChartSkeleton, SurfaceLoader } from "../../../../components/ui";
import { db } from "../../../../firebase";

const TARGET_WEIGHT_TOTAL = 10;
const WEIGHT_TOTAL_EPSILON = 0.001;
const CUSTOM_PRESET_ID = "custom";

const PRESET_OPTIONS = [
  {
    id: "active_equal",
    label: "활성 상품 균등",
    description: "현재 판매 중인 상품을 같은 비중으로 담습니다.",
  },
  {
    id: "popular_30d",
    label: "최근 인기 상품",
    description: "최근 30일 판매 수량 상위 상품을 담습니다.",
    requirement: "최근 30일 판매 데이터 필요",
  },
  {
    id: "category_balanced",
    label: "카테고리 균형",
    description: "카테고리별 대표 상품을 하나씩 담습니다.",
  },
];

const toDateId = (value) => {
  const d = dayjs(value);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
};

const normalizeWeight = (weight) => {
  const parsed = Number(weight);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.1;
};

const toPositivePrice = (value) => {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
};

const distributePresetWeights = (itemIds = []) => {
  const uniqueIds = [...new Set(itemIds.filter(Boolean))];
  if (!uniqueIds.length) return [];

  const base = Math.floor((TARGET_WEIGHT_TOTAL / uniqueIds.length) * 10) / 10;
  let remainder = Number((TARGET_WEIGHT_TOTAL - base * uniqueIds.length).toFixed(1));

  return uniqueIds.map((itemId) => {
    let weight = base;
    if (remainder > 0) {
      weight = Number((weight + 0.1).toFixed(1));
      remainder = Number((remainder - 0.1).toFixed(1));
    }
    return { itemId, weight: normalizeWeight(weight) };
  });
};

const DEFAULT_DATES = (() => {
  const today = dayjs();
  return {
    baseDate: today.subtract(7, "day").format("YYYY-MM-DD"),
    compareDate: today.subtract(1, "day").format("YYYY-MM-DD"),
  };
})();

const TAB_ITEMS = [
  { id: "basket", label: "장바구니 설정" },
  { id: "compare", label: "날짜 비교" },
];

const CPIChartModal = ({ isOpen, onClose, classId }) => {
  const [activeTab, setActiveTab] = useState("basket");
  const [dates, setDates] = useState(DEFAULT_DATES);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [storeItems, setStoreItems] = useState([]);
  const [basket, setBasket] = useState([]);
  const [basketBaseDate, setBasketBaseDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [itemNameMap, setItemNameMap] = useState({});
  const [selectedPresetId, setSelectedPresetId] = useState(CUSTOM_PRESET_ID);
  const [presetLoadingId, setPresetLoadingId] = useState("");

  const [basketSaveState, setBasketSaveState] = useState({
    saving: false,
    error: "",
    success: "",
  });

  const [calcState, setCalcState] = useState({
    loading: false,
    error: "",
    result: null,
    missing: [],
  });

  useEffect(() => {
    if (!isOpen || !classId) return;

    const loadConfig = async () => {
      try {
        setLoadingConfig(true);
        setActiveTab("basket");
        setCalcState({
          loading: false,
          error: "",
          result: null,
          missing: [],
        });
        setBasketSaveState({
          saving: false,
          error: "",
          success: "",
        });

        const econSnap = await getDoc(doc(db, `classes/${classId}/config/econ`));
        const econData = econSnap.exists() ? econSnap.data() || {} : {};
        const savedPresetId =
          PRESET_OPTIONS.some((preset) => preset.id === econData.cpiPresetId)
            ? econData.cpiPresetId
            : CUSTOM_PRESET_ID;
        const loadedBasket = Array.isArray(econData.cpiBasket)
          ? econData.cpiBasket
              .filter((row) => row && row.itemId)
              .map((row) => ({
                itemId: row.itemId,
                weight: normalizeWeight(row.weight),
              }))
          : [];

        const itemsSnap = await getDocs(
          query(collection(db, `classes/${classId}/storeItems`), orderBy("name", "asc"))
        );

        const nextItems = [];
        const nextNameMap = {};
        itemsSnap.forEach((itemDoc) => {
          const itemData = itemDoc.data() || {};
          const name = String(itemData.name || itemDoc.id);
          nextItems.push({
            itemId: itemDoc.id,
            name,
            categoryId: String(itemData.categoryId || "").trim(),
            categoryName: String(itemData.categoryName || "").trim(),
            isActive: itemData.isActive !== false,
            saleStatus: String(itemData.saleStatus || "").trim(),
            price: toPositivePrice(itemData.price),
          });
          nextNameMap[itemDoc.id] = name;
        });

        setStoreItems(nextItems);
        setItemNameMap(nextNameMap);
        setBasket(loadedBasket);
        setBasketBaseDate(toDateId(econData.cpiBaseDate) || dayjs().format("YYYY-MM-DD"));
        setSelectedPresetId(savedPresetId);
      } catch (error) {
        console.error("CPI 설정 로드 실패:", error);
        setStoreItems([]);
        setItemNameMap({});
        setBasket([]);
        setBasketBaseDate(dayjs().format("YYYY-MM-DD"));
        setSelectedPresetId(CUSTOM_PRESET_ID);
        setCalcState({
          loading: false,
          error: "지표 설정을 불러오지 못했습니다.",
          result: null,
          missing: [],
        });
      } finally {
        setLoadingConfig(false);
      }
    };

    loadConfig();
  }, [isOpen, classId]);

  const basketWithNames = useMemo(
    () =>
      basket.map((row) => ({
        ...row,
        name: itemNameMap[row.itemId] || row.itemId,
      })),
    [basket, itemNameMap]
  );

  const basketWeightMap = useMemo(
    () =>
      basket.reduce((acc, row) => {
        acc[row.itemId] = normalizeWeight(row.weight);
        return acc;
      }, {}),
    [basket]
  );

  const basketWeightTotal = useMemo(
    () => basket.reduce((sum, row) => sum + normalizeWeight(row.weight), 0),
    [basket]
  );

  const isWeightTotalValid =
    Math.abs(basketWeightTotal - TARGET_WEIGHT_TOTAL) <= WEIGHT_TOTAL_EPSILON;
  const normalizedBasket = useMemo(
    () =>
      basket
        .filter((row) => row && row.itemId)
        .map((row) => ({
          itemId: row.itemId,
          weight: normalizeWeight(row.weight),
        })),
    [basket],
  );
  const currentPriceMap = useMemo(
    () => new Map(storeItems.map((item) => [item.itemId, item.price])),
    [storeItems],
  );
  const missingCurrentPriceItems = useMemo(
    () =>
      normalizedBasket
        .filter((row) => toPositivePrice(currentPriceMap.get(row.itemId)) === null)
        .map((row) => itemNameMap[row.itemId] || row.itemId),
    [currentPriceMap, itemNameMap, normalizedBasket],
  );
  const basketSaveDisabledReason = (() => {
    if (basketSaveState.saving) return "저장 중입니다.";
    if (!normalizedBasket.length) return "장바구니 항목을 선택하세요.";
    if (!toDateId(basketBaseDate)) return "기준가격 날짜를 선택하세요.";
    if (dayjs(toDateId(basketBaseDate)).isAfter(dayjs(), "day")) {
      return "기준가격 날짜는 오늘 이후로 설정할 수 없습니다.";
    }
    if (!isWeightTotalValid) {
      return `비중 점수 합계를 ${TARGET_WEIGHT_TOTAL.toFixed(1)}으로 맞춰주세요.`;
    }
    if (toDateId(basketBaseDate) === dayjs().format("YYYY-MM-DD") && missingCurrentPriceItems.length) {
      return "기준가격을 저장할 수 없는 상품이 있습니다.";
    }
    return "";
  })();
  const canSaveBasket = !basketSaveDisabledReason;

  const clearBasketMessages = () => {
    setBasketSaveState((prev) => ({ ...prev, error: "", success: "" }));
  };

  const markCustomPreset = () => {
    setSelectedPresetId(CUSTOM_PRESET_ID);
  };

  const getActiveItems = () =>
    storeItems.filter((item) => item.isActive !== false && item.price !== null);

  const buildCategoryBalancedBasket = () => {
    const byCategory = new Map();
    getActiveItems().forEach((item) => {
      const categoryKey = item.categoryId || item.categoryName || "uncategorized";
      const current = byCategory.get(categoryKey);
      if (!current || item.name.localeCompare(current.name, "ko-KR") < 0) {
        byCategory.set(categoryKey, item);
      }
    });
    return distributePresetWeights(
      Array.from(byCategory.values()).map((item) => item.itemId),
    );
  };

  const buildPopularBasket = async () => {
    const activeItemIds = new Set(getActiveItems().map((item) => item.itemId));
    const quantityByItem = new Map();
    const analyticsSnap = await getDocs(
      query(
        collection(db, `classes/${classId}/storeAnalyticsDaily`),
        orderBy(documentId(), "desc"),
        limit(30),
      ),
    );

    analyticsSnap.forEach((dailyDoc) => {
      Object.entries(dailyDoc.data()?.byItem || {}).forEach(([itemId, item]) => {
        if (!activeItemIds.has(itemId)) return;
        quantityByItem.set(
          itemId,
          (quantityByItem.get(itemId) || 0) + Number(item?.quantity || 0),
        );
      });
    });

    const popularIds = Array.from(quantityByItem.entries())
      .filter(([, quantity]) => quantity > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([itemId]) => itemId);

    return distributePresetWeights(popularIds);
  };

  const applyPreset = async (presetId) => {
    clearBasketMessages();
    setPresetLoadingId(presetId);
    try {
      let nextBasket = [];
      if (presetId === "active_equal") {
        nextBasket = distributePresetWeights(getActiveItems().map((item) => item.itemId));
      } else if (presetId === "popular_30d") {
        nextBasket = await buildPopularBasket();
      } else if (presetId === "category_balanced") {
        nextBasket = buildCategoryBalancedBasket();
      }

      if (!nextBasket.length) {
        const isPopularPreset = presetId === "popular_30d";
        setBasketSaveState({
          saving: false,
          error: isPopularPreset
            ? "최근 30일 판매 데이터가 없어 인기 상품 프리셋을 적용할 수 없습니다. 활성 상품 균등이나 카테고리 균형을 사용해 주세요."
            : "프리셋에 담을 수 있는 판매 상품이 없습니다.",
          success: "",
        });
        return;
      }

      setBasket(nextBasket);
      setSelectedPresetId(presetId);
      setBasketSaveState({
        saving: false,
        error: "",
        success: "프리셋을 적용했습니다. 저장해야 다음에도 유지됩니다.",
      });
    } catch (error) {
      console.error("CPI preset apply failed:", error);
      setBasketSaveState({
        saving: false,
        error: "프리셋 적용 중 오류가 발생했습니다.",
        success: "",
      });
    } finally {
      setPresetLoadingId("");
    }
  };

  const toggleBasketItem = (itemId, checked) => {
    clearBasketMessages();
    markCustomPreset();
    setBasket((prev) => {
      const exists = prev.some((row) => row.itemId === itemId);
      if (checked) {
        if (exists) return prev;
        const currentTotal = prev.reduce(
          (sum, row) => sum + normalizeWeight(row.weight),
          0
        );
        const suggested = Math.max(
          0.1,
          Number((TARGET_WEIGHT_TOTAL - currentTotal).toFixed(1))
        );
        return [...prev, { itemId, weight: normalizeWeight(suggested) }];
      }
      return prev.filter((row) => row.itemId !== itemId);
    });
  };

  const changeBasketWeight = (itemId, value) => {
    clearBasketMessages();
    markCustomPreset();
    const nextWeight = normalizeWeight(value);
    setBasket((prev) =>
      prev.map((row) =>
        row.itemId === itemId ? { ...row, weight: nextWeight } : row
      )
    );
  };

  const distributeWeightsEvenly = () => {
    clearBasketMessages();
    markCustomPreset();
    setBasket((prev) => {
      if (!prev.length) return prev;
      const base = Math.floor((TARGET_WEIGHT_TOTAL / prev.length) * 10) / 10;
      let remainder = Number(
        (TARGET_WEIGHT_TOTAL - base * prev.length).toFixed(1)
      );

      return prev.map((row) => {
        let nextWeight = base;
        if (remainder > 0) {
          nextWeight = Number((nextWeight + 0.1).toFixed(1));
          remainder = Number((remainder - 0.1).toFixed(1));
        }
        return { ...row, weight: normalizeWeight(nextWeight) };
      });
    });
  };

  const loadPriceSnapshot = async (dateKey) => {
    const analyticsSnap = await getDoc(
      doc(db, `classes/${classId}/storeAnalyticsDaily/${dateKey}`),
    );
    const analyticsPriceSnapshot = analyticsSnap.exists()
      ? analyticsSnap.data()?.priceSnapshot
      : null;
    if (analyticsPriceSnapshot?.prices) return analyticsPriceSnapshot;

    const legacySnap = await getDoc(
      doc(db, `classes/${classId}/storePriceSnapshots/${dateKey}`),
    );
    return legacySnap.exists() ? legacySnap.data() || {} : {};
  };

  const buildBasePricesForDate = async (baseDate) => {
    const todayKey = dayjs().format("YYYY-MM-DD");
    const sourcePrices =
      baseDate === todayKey
        ? Object.fromEntries(currentPriceMap.entries())
        : (await loadPriceSnapshot(baseDate))?.prices || {};

    const missingItems = [];
    const basePrices = normalizedBasket.reduce((acc, row) => {
      const price = toPositivePrice(sourcePrices[row.itemId]);
      if (price === null) {
        missingItems.push(itemNameMap[row.itemId] || row.itemId);
      } else {
        acc[row.itemId] = price;
      }
      return acc;
    }, {});

    return { basePrices, missingItems };
  };

  const saveBasketConfig = async () => {
    if (!classId) return;

    if (!normalizedBasket.length) {
      setBasketSaveState({
        saving: false,
        error: "장바구니 항목을 먼저 선택하세요.",
        success: "",
      });
      return;
    }

    const total = normalizedBasket.reduce((sum, row) => sum + row.weight, 0);
    const hasValidTotal =
      Math.abs(total - TARGET_WEIGHT_TOTAL) <= WEIGHT_TOTAL_EPSILON;

    if (!hasValidTotal) {
      setBasketSaveState({
        saving: false,
        error: `비중 점수 합계를 ${TARGET_WEIGHT_TOTAL.toFixed(1)}으로 맞춰주세요.`,
        success: "",
      });
      return;
    }

    const baseDate = toDateId(basketBaseDate);
    if (!baseDate) {
      setBasketSaveState({
        saving: false,
        error: "기준가격 날짜를 선택하세요.",
        success: "",
      });
      return;
    }

    if (dayjs(baseDate).isAfter(dayjs(), "day")) {
      setBasketSaveState({
        saving: false,
        error: "기준가격 날짜는 오늘 이후로 설정할 수 없습니다.",
        success: "",
      });
      return;
    }

    try {
      setBasketSaveState({
        saving: true,
        error: "",
        success: "",
      });
      const { basePrices, missingItems } = await buildBasePricesForDate(baseDate);
      if (missingItems.length) {
        setBasketSaveState({
          saving: false,
          error:
            baseDate === dayjs().format("YYYY-MM-DD")
              ? `현재 가격을 저장할 수 없는 상품이 있습니다: ${missingItems.join(", ")}`
              : `${baseDate} 가격 스냅샷에 없는 상품이 있습니다: ${missingItems.join(", ")}`,
          success: "",
        });
        return;
      }

      await setDoc(
        doc(db, `classes/${classId}/config/econ`),
        {
          cpiBasket: normalizedBasket,
          cpiBasePrices: basePrices,
          cpiBaseDate: baseDate,
          cpiPresetId: selectedPresetId,
          cpiPresetUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setBasket(normalizedBasket);
      setBasketSaveState({
        saving: false,
        error: "",
        success: `${baseDate} 기준가격으로 장바구니가 저장되었습니다.`,
      });
    } catch (error) {
      console.error("CPI 장바구니 저장 실패:", error);
      setBasketSaveState({
        saving: false,
        error: "장바구니 저장 중 오류가 발생했습니다.",
        success: "",
      });
    }
  };

  const calculateCPIComparison = async () => {
    if (!classId) return;

    const baseDate = toDateId(dates.baseDate);
    const compareDate = toDateId(dates.compareDate);
    if (!baseDate || !compareDate) {
      setCalcState({
        loading: false,
        error: "기준일과 비교일을 올바르게 선택하세요.",
        result: null,
        missing: [],
      });
      return;
    }

    if (!basketWithNames.length) {
      setCalcState({
        loading: false,
        error: "장바구니 항목이 비어 있습니다. 먼저 장바구니를 설정하세요.",
        result: null,
        missing: [],
      });
      return;
    }

    if (!isWeightTotalValid) {
      setCalcState({
        loading: false,
        error: `비중 점수 합계를 ${TARGET_WEIGHT_TOTAL.toFixed(1)}으로 맞춘 후 계산하세요.`,
        result: null,
        missing: [],
      });
      return;
    }

    try {
      setCalcState({
        loading: true,
        error: "",
        result: null,
        missing: [],
      });

      const [baseData, compareData] = await Promise.all([
        loadPriceSnapshot(baseDate),
        loadPriceSnapshot(compareDate),
      ]);

      const missingRows = [];
      const validRows = [];

      basketWithNames.forEach((row) => {
        const basePrice = Number(baseData?.prices?.[row.itemId]);
        const comparePrice = Number(compareData?.prices?.[row.itemId]);

        if (!Number.isFinite(basePrice)) {
          missingRows.push({
            itemId: row.itemId,
            itemName: row.name,
            date: baseDate,
            label: "기준일",
          });
        }
        if (!Number.isFinite(comparePrice)) {
          missingRows.push({
            itemId: row.itemId,
            itemName: row.name,
            date: compareDate,
            label: "비교일",
          });
        }

        if (!Number.isFinite(basePrice) || !Number.isFinite(comparePrice)) {
          return;
        }

        if (basePrice <= 0) {
          missingRows.push({
            itemId: row.itemId,
            itemName: row.name,
            date: baseDate,
            label: "기준일(가격 0)",
          });
          return;
        }

        validRows.push({
          itemId: row.itemId,
          itemName: row.name,
          weight: normalizeWeight(row.weight),
          ratio: comparePrice / basePrice,
        });
      });

      if (missingRows.length > 0) {
        setCalcState({
          loading: false,
          error: "",
          result: null,
          missing: missingRows,
        });
        return;
      }

      if (!validRows.length) {
        setCalcState({
          loading: false,
          error: "계산 가능한 항목이 없습니다. 장바구니를 확인하세요.",
          result: null,
          missing: [],
        });
        return;
      }

      const weightSum = validRows.reduce((sum, row) => sum + row.weight, 0);
      const weightedRatio =
        validRows.reduce((sum, row) => sum + row.ratio * row.weight, 0) /
        (weightSum > 0 ? weightSum : validRows.length);

      const cpiValue = weightedRatio * 100;
      const changePct = (weightedRatio - 1) * 100;

      setCalcState({
        loading: false,
        error: "",
        missing: [],
        result: {
          cpiValue,
          changePct,
          baseDate,
          compareDate,
          itemCount: validRows.length,
        },
      });
    } catch (error) {
      console.error("기준일 비교 CPI 계산 실패:", error);
      setCalcState({
        loading: false,
        error: "비교 계산 중 오류가 발생했습니다.",
        result: null,
        missing: [],
      });
    }
  };

  const missingSummary = useMemo(() => {
    if (!calcState.missing.length) return [];

    const grouped = calcState.missing.reduce((acc, row) => {
      if (!acc[row.itemId]) {
        acc[row.itemId] = {
          itemId: row.itemId,
          itemName: row.itemName,
          dates: [],
        };
      }
      acc[row.itemId].dates.push(`${row.date}(${row.label})`);
      return acc;
    }, {});

    return Object.values(grouped).map((row) => ({
      ...row,
      dates: [...new Set(row.dates)],
    }));
  }, [calcState.missing]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-xl font-bold text-slate-800">물가지수 관리</h3>
          <Button tone="slate" kind="ghost" size="icon-md"
            onClick={onClose}
            className="transition-colors"
            aria-label="닫기"
          >
            <X className="h-5 w-5 text-slate-500" />
          </Button>
        </div>

        <div className="overflow-y-auto p-6">
          <SurfaceLoader
            loading={loadingConfig}
            skeleton={<ChartSkeleton bare heightClassName="h-[28rem]" />}
            minHeightClassName="min-h-[32rem]"
            className="rounded-3xl"
          >
            <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            장바구니를 저장해 기준가격을 고정하고, 날짜별 상점 가격 스냅샷으로
            물가지수를 비교합니다.
          </div>

          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            {TAB_ITEMS.map((tab) => (
              <Button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
                  activeTab === tab.id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          {activeTab === "basket" ? (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-700">
                  물가지수용 장바구니 설정
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  프리셋을 적용하거나 직접 항목별 비중을 수정한 뒤 저장하세요.
                  선택한 기준일의 가격이 물가지수 기준가격으로 저장됩니다.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  tone="slate"
                  onClick={distributeWeightsEvenly}
                  disabled={basketSaveState.saving || basket.length === 0}
                >
                  균등 배분
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  tone="slate"
                  onClick={() => {
                    clearBasketMessages();
                    markCustomPreset();
                    setBasket([]);
                  }}
                  disabled={basketSaveState.saving}
                >
                  전체 해제
                </Button>
                <Button
                  size="sm"
                  tone="slate"
                  onClick={saveBasketConfig}
                  disabled={!canSaveBasket}
                  isLoading={basketSaveState.saving}
                >
                  기준가격과 함께 저장
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {PRESET_OPTIONS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  disabled={Boolean(presetLoadingId) || basketSaveState.saving}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    selectedPresetId === preset.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <div className="text-xs font-black">
                    {presetLoadingId === preset.id ? "적용 중..." : preset.label}
                  </div>
                  <div
                    className={`mt-1 text-[11px] ${
                      selectedPresetId === preset.id ? "text-slate-200" : "text-slate-500"
                    }`}
                  >
                    {preset.description}
                  </div>
                  {preset.requirement ? (
                    <div
                      className={`mt-2 text-[11px] font-semibold ${
                        selectedPresetId === preset.id ? "text-slate-100" : "text-amber-700"
                      }`}
                    >
                      {preset.requirement}
                    </div>
                  ) : null}
                </Button>
              ))}
            </div>

            <div className="mt-3 text-xs text-slate-500">
              현재 설정:{" "}
              <span className="font-semibold text-slate-700">
                {PRESET_OPTIONS.find((preset) => preset.id === selectedPresetId)?.label ||
                  "직접 설정"}
              </span>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="text-xs font-black text-slate-600" htmlFor="cpi-base-date">
                기준가격 날짜
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  id="cpi-base-date"
                  type="date"
                  value={basketBaseDate}
                  max={dayjs().format("YYYY-MM-DD")}
                  onChange={(event) => {
                    clearBasketMessages();
                    setBasketBaseDate(toDateId(event.target.value));
                  }}
                  className="h-9 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm text-slate-700"
                />
                <span className="text-xs text-slate-500">
                  오늘은 현재 상점 가격, 과거 날짜는 저장된 가격 스냅샷을 기준으로 사용합니다.
                </span>
              </div>
            </div>

            <div className="mt-3 text-xs text-slate-500">
              선택 항목 수{" "}
              <span className="font-semibold text-slate-700">{basket.length}</span>
            </div>
            <div
              className={`mt-1 text-xs ${
                isWeightTotalValid ? "text-emerald-700" : "text-amber-700"
              }`}
            >
              비중 점수 합계:{" "}
              <span className="font-semibold">{basketWeightTotal.toFixed(1)}</span> /{" "}
              {TARGET_WEIGHT_TOTAL.toFixed(1)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              합계가 10.0이어야 저장과 비교 계산이 가능합니다.
            </div>
            {!canSaveBasket && !basketSaveState.saving ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                저장하려면 {basketSaveDisabledReason}
                {missingCurrentPriceItems.length ? ` (${missingCurrentPriceItems.join(", ")})` : ""}
              </div>
            ) : null}

            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              {storeItems.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">
                  상점 항목이 없습니다. 먼저 상점 항목을 등록하세요.
                </div>
              ) : (
                storeItems.map((item) => {
                  const isSelected = Object.prototype.hasOwnProperty.call(
                    basketWeightMap,
                    item.itemId
                  );
                  const weight = basketWeightMap[item.itemId] ?? 1;
                  return (
                    <div
                      key={item.itemId}
                      className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) =>
                          toggleBasketItem(item.itemId, e.target.checked)
                        }
                      />
                      <div className="min-w-0 flex-1 truncate text-sm text-slate-700">
                        {item.name}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">비중 점수</span>
                        <input
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={weight}
                          disabled={!isSelected}
                          onChange={(e) =>
                            changeBasketWeight(item.itemId, e.target.value)
                          }
                          className="w-20 rounded-md border border-blue-200 px-2 py-1 text-right text-xs disabled:bg-slate-100"
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {basketSaveState.error && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {basketSaveState.error}
              </div>
            )}
            {basketSaveState.success && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <span>{basketSaveState.success}</span>
                <Button
                  size="xs"
                  variant="outline"
                  tone="slate"
                  icon={ArrowRight}
                  onClick={() => setActiveTab("compare")}
                >
                  날짜 비교로 이동
                </Button>
              </div>
            )}
          </div>
          ) : null}

          {activeTab === "compare" ? (
          <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            저장된 장바구니를 기준으로 두 날짜의 가격을 비교합니다. 장바구니를 바꾸려면
            먼저 장바구니 설정 탭에서 저장하세요.
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 text-sm font-bold text-slate-700">기준일</div>
              <input
                type="date"
                value={dates.baseDate}
                onChange={(e) =>
                  setDates((prev) => ({ ...prev, baseDate: toDateId(e.target.value) }))
                }
                className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 text-sm font-bold text-slate-700">비교일</div>
              <input
                type="date"
                value={dates.compareDate}
                onChange={(e) =>
                  setDates((prev) => ({
                    ...prev,
                    compareDate: toDateId(e.target.value),
                  }))
                }
                className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              tone="slate"
              onClick={calculateCPIComparison}
              disabled={loadingConfig}
              isLoading={calcState.loading}
              icon={Calculator}
            >
              비교 계산
            </Button>

            <div className="text-xs text-slate-500">
              장바구니 항목 수{" "}
              <span className="font-semibold">{basketWithNames.length}</span>
            </div>
          </div>

          {calcState.error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {calcState.error}
            </div>
          )}

          {!loadingConfig && calcState.missing.length > 0 && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2 text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div className="text-sm font-semibold">
                  선택한 날짜에 가격 데이터가 누락되어 계산을 중단했습니다.
                </div>
              </div>
              <div className="text-sm text-amber-900">
                누락 항목을 장바구니에서 제외하거나 날짜를 변경한 뒤 다시 계산하세요.
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-amber-200 bg-white">
                {missingSummary.map((row) => (
                  <div
                    key={row.itemId}
                    className="border-b border-amber-100 px-3 py-2 last:border-b-0"
                  >
                    <div className="text-sm font-semibold text-slate-700">
                      {row.itemName}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      누락 날짜: {row.dates.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  tone="slate"
                  onClick={onClose}
                >
                  닫고 장바구니 수정하기
                </Button>
              </div>
            </div>
          )}

          {calcState.result && (
            <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 className="h-5 w-5" />
                <div className="text-sm font-semibold">계산 완료</div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs text-slate-500">물가지수</div>
                  <div className="text-2xl font-extrabold text-slate-800">
                    {calcState.result.cpiValue.toFixed(1)}
                  </div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs text-slate-500">변화율</div>
                  <div className="text-2xl font-extrabold text-slate-800">
                    {calcState.result.changePct >= 0 ? "+" : ""}
                    {calcState.result.changePct.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs text-slate-500">반영 항목 수</div>
                  <div className="text-2xl font-extrabold text-slate-800">
                    {calcState.result.itemCount}
                  </div>
                </div>
              </div>
              <div className="text-xs text-slate-600">
                기준일: {calcState.result.baseDate}
              </div>
              <div className="text-xs text-slate-600">
                비교일: {calcState.result.compareDate}
              </div>
            </div>
          )}
          </>
          ) : null}
            </div>
          </SurfaceLoader>
        </div>
      </div>
    </div>
  );
};

export default CPIChartModal;
