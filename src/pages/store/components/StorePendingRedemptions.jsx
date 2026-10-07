import { appConfirm } from "../../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import {
  ArrowLeft,
  BarChart3,
  CreditCard,
  DollarSign,
  Filter,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import {
  BulkActionFloatingBar,
  Button,
  FilterBar,
  IconButton,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import useDragSelection from "../../../hooks/useDragSelection";
import { resolveClassCurrencyUnit } from "../../../utils/currencyUnit";
import useAllStorePurchases from "../hooks/useAllStorePurchases";
import CancelReasonModal from "../modals/CancelReasonModal";
import {
  hardDeleteStorePurchase,
  markPurchaseAsRedeemed,
} from "../services/storeAdminService";
import {
  bulkCancelStorePurchases,
  cancelStorePurchase,
} from "../services/storeService";
import { oneWeekAgo, todayYMD } from "./StoreDateRangeFilter";
import StorePendingRedemptionsTable from "./StorePendingRedemptionsTable";
import { isVipStoreItem } from "../utils/vipLounge";

const ALL_CATEGORY_VALUE = "__all__";

const stripLeadingEmoji = (raw = "") => {
  const match = raw.match(
    /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})\s*/u,
  );
  return match ? raw.slice(match[0].length).trim() : raw;
};

const STATUS_FILTER_OPTIONS = [
  { value: "unused", label: "미사용" },
  { value: "all", label: "전체 상태" },
  { value: "completed", label: "지급 완료" },
  { value: "cancelled", label: "취소/환불" },
];

const isCompletedStatus = (status) =>
  status === "redeemed" || status === "completed";

const isUnusedPurchase = (item, usageMap) =>
  isCompletedStatus(item?.status) &&
  usageMap?.[item.id]?.type === "unused";

const isRedemptionInventoryAcquisition = (acquisition, purchaseId) => {
  const acquisitionType = String(acquisition?.type || "purchase");
  return (
    (acquisitionType === "purchase" || acquisitionType === "gift") &&
    acquisition?.purchaseId === purchaseId
  );
};

const isSameIdList = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

const areUsageMapsEqual = (prevMap, nextMap) => {
  const prevKeys = Object.keys(prevMap || {});
  const nextKeys = Object.keys(nextMap || {});
  if (prevKeys.length !== nextKeys.length) return false;

  for (const key of prevKeys) {
    const prev = prevMap[key];
    const next = nextMap[key];
    if (!next) return false;
    if (
      prev?.type !== next?.type ||
      prev?.purchasedQty !== next?.purchasedQty ||
      prev?.usedQty !== next?.usedQty ||
      prev?.remainingQty !== next?.remainingQty
    ) {
      return false;
    }
  }

  return true;
};

const toTimestampMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return Number(value.toMillis()) || 0;
  if (typeof value?.seconds === "number") {
    return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000);
  }
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
};

const normalizeSearchValue = (value) =>
  String(value || "").trim().toLowerCase();

const isRandomBoxPurchase = (item) =>
  item?.itemType === "randomBox" ||
  item?.functionTag === "random_box" ||
  Array.isArray(item?.randomBoxConfigSnapshot?.rewards);

const hasRandomBoxSearchSummary = (item) =>
  (Array.isArray(item?.randomBoxRewardNames) && item.randomBoxRewardNames.length > 0) ||
  (Array.isArray(item?.randomBoxRewardItemIds) && item.randomBoxRewardItemIds.length > 0);

const matchesPurchaseSearch = (item, queryText, randomBoxEvents = []) => {
  if (!queryText) return true;

  const directValues = [
    item?.itemName,
    item?.studentName,
    item?.itemId,
    item?.randomBoxLastRewardItemName,
    ...(Array.isArray(item?.randomBoxRewardNames) ? item.randomBoxRewardNames : []),
    ...(Array.isArray(item?.randomBoxRewardItemIds) ? item.randomBoxRewardItemIds : []),
  ];

  if (
    directValues.some((value) => normalizeSearchValue(value).includes(queryText))
  ) {
    return true;
  }

  return randomBoxEvents.some((event) =>
    [event?.rewardItemName, event?.boxItemName, event?.rewardItemId].some(
      (value) => normalizeSearchValue(value).includes(queryText),
    ),
  );
};

const buildUsageStatusMap = async (classId, usageTargets, inventoryCache) => {
  const inventoryKeyList = Array.from(
    new Set(usageTargets.map((item) => `${item.studentUid}::${item.itemId}`)),
  );
  const missingInventoryKeyList = inventoryKeyList.filter(
    (key) => !inventoryCache.has(key),
  );

  await Promise.all(
    missingInventoryKeyList.map(async (key) => {
      const [studentUid, itemId] = key.split("::");
      try {
        const snap = await getDoc(
          doc(db, `classes/${classId}/students/${studentUid}/inventory/${itemId}`),
        );
        inventoryCache.set(key, snap.exists() ? snap.data() : null);
      } catch (error) {
        inventoryCache.set(key, null);
      }
    }),
  );

  const nextUsageStatusMap = {};

  usageTargets.forEach((item) => {
    const purchasedQty = Math.max(0, Number(item.quantity || 0));
    const inventoryKey = `${item.studentUid}::${item.itemId}`;
    const inventoryData = inventoryCache.get(inventoryKey) ?? null;
    const acquisitions = Array.isArray(inventoryData?.acquisitions)
      ? inventoryData.acquisitions
      : [];

    const remainingQty = acquisitions
      .filter((acquisition) =>
        isRedemptionInventoryAcquisition(acquisition, item.id),
      )
      .reduce(
        (sum, acquisition) =>
          sum + Math.max(0, Number(acquisition?.quantity || 0)),
        0,
      );

    const normalizedRemainingQty = Math.min(remainingQty, purchasedQty);
    const usedQty = Math.max(0, purchasedQty - normalizedRemainingQty);

    let type = "used";
    if (normalizedRemainingQty >= purchasedQty) type = "unused";
    else if (normalizedRemainingQty > 0) type = "partial";

    nextUsageStatusMap[item.id] = {
      type,
      purchasedQty,
      usedQty,
      remainingQty: normalizedRemainingQty,
    };
  });

  return nextUsageStatusMap;
};

const StorePendingRedemptions = ({
  onBackToShop,
  asModal = false,
  onClose,
  view = "ledger",
  showBackButton = !asModal,
  title,
  items = [],
  categories = [],
}) => {
  const { classId, classData, userData: adminUserData } = useUser();
  const { showFeedback } = useFeedback();
  const { formatClassCurrency } = useNumberFormat();
  const currencyUnit = resolveClassCurrencyUnit(classData);

  const isRefundView = view === "refund";
  const canHardDelete = ["teacher", "admin"].includes(adminUserData?.role);
  const canViewVipRecords = ["teacher", "admin"].includes(adminUserData?.role);
  const headingTitle =
    title || (isRefundView ? "환불 가능 현황" : "구매 내역");
  const defaultStatus = isRefundView ? "completed" : "all";

  const [tempStartDate, setTempStartDate] = useState(oneWeekAgo());
  const [tempEndDate, setTempEndDate] = useState(todayYMD());
  const [tempSearchQuery, setTempSearchQuery] = useState("");
  const [tempStatus, setTempStatus] = useState(defaultStatus);
  const [tempCategory, setTempCategory] = useState(ALL_CATEGORY_VALUE);
  const [applied, setApplied] = useState({
    start: oneWeekAgo(),
    end: todayYMD(),
    search: "",
    status: defaultStatus,
    category: ALL_CATEGORY_VALUE,
  });

  const [showFilters, setShowFilters] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [cancelTargetItem, setCancelTargetItem] = useState(null);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [usageStatusMap, setUsageStatusMap] = useState({});
  const [selectedRefundIds, setSelectedRefundIds] = useState([]);
  const [expandedRandomBoxIds, setExpandedRandomBoxIds] = useState({});
  const [randomBoxEventMap, setRandomBoxEventMap] = useState({});
  const [loadingRandomBoxEventMap, setLoadingRandomBoxEventMap] = useState({});
  const inventoryCacheRef = useRef(new Map());

  useEffect(() => {
    inventoryCacheRef.current.clear();
  }, [classId]);

  const {
    allPurchases,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refresh,
  } = useAllStorePurchases({
    startDate: applied.start,
    endDate: applied.end,
    statusFilter: applied.status,
  });

  const itemCategoryIdMap = useMemo(
    () =>
      items.reduce((accumulator, item) => {
        const itemId = String(item?.id || "").trim();
        if (!itemId) return accumulator;
        accumulator[itemId] = String(item?.categoryId || "").trim();
        return accumulator;
      }, {}),
    [items],
  );

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const isRestrictedVipRecord = useCallback(
    (item) => !canViewVipRecords && isVipStoreItem(item, categoryMap),
    [canViewVipRecords, categoryMap],
  );

  const categoryOptions = useMemo(() => {
    const normalizedCategories = [...categories]
      .filter((category) => String(category?.id || "").trim())
      .sort((left, right) => {
        const leftOrder = Number.isFinite(Number(left?.order))
          ? Number(left.order)
          : Number.MAX_SAFE_INTEGER;
        const rightOrder = Number.isFinite(Number(right?.order))
          ? Number(right.order)
          : Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) return leftOrder - rightOrder;

        return String(left?.name || "").localeCompare(
          String(right?.name || ""),
          "ko",
        );
      });

    return [
      {
        value: ALL_CATEGORY_VALUE,
        label: "전체 카테고리",
      },
      ...normalizedCategories.map((category) => ({
        value: String(category.id),
        label:
          stripLeadingEmoji(String(category?.name || "").trim()) ||
          "미분류",
      })),
    ];
  }, [categories]);

  const liveSearchQuery = useMemo(
    () => normalizeSearchValue(tempSearchQuery),
    [tempSearchQuery],
  );

  const loadRandomBoxEvents = useCallback(
    async (purchaseId) => {
      const normalizedPurchaseId = String(purchaseId || "").trim();
      if (!normalizedPurchaseId || !classId) return [];

      if (randomBoxEventMap[normalizedPurchaseId]) {
        return randomBoxEventMap[normalizedPurchaseId];
      }

      if (loadingRandomBoxEventMap[normalizedPurchaseId]) {
        return [];
      }

      setLoadingRandomBoxEventMap((prev) => ({
        ...prev,
        [normalizedPurchaseId]: true,
      }));

      try {
        const snapshot = await getDocs(
          collection(
            db,
            `classes/${classId}/storeRedemptions/${normalizedPurchaseId}/openEvents`,
          ),
        );
        const docs = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort(
            (left, right) =>
              toTimestampMillis(right?.openedAt) - toTimestampMillis(left?.openedAt),
          );

        setRandomBoxEventMap((prev) => {
          if (prev[normalizedPurchaseId]) return prev;
          return { ...prev, [normalizedPurchaseId]: docs };
        });

        return docs;
      } catch (error) {
        console.error("[StorePendingRedemptions] Failed to load random box events:", error);
        showFeedback("랜덤박스 상세 기록을 불러오지 못했습니다.", "error");
        return [];
      } finally {
        setLoadingRandomBoxEventMap((prev) => ({
          ...prev,
          [normalizedPurchaseId]: false,
        }));
      }
    },
    [classId, loadingRandomBoxEventMap, randomBoxEventMap, showFeedback],
  );

  useEffect(() => {
    if (!classId || !liveSearchQuery) return;

    const targetPurchaseIds = allPurchases
      .filter((item) => {
        if (!isRandomBoxPurchase(item) || hasRandomBoxSearchSummary(item)) {
          return false;
        }

        const purchaseId = String(item?.id || "").trim();
        if (
          !purchaseId ||
          randomBoxEventMap[purchaseId] ||
          loadingRandomBoxEventMap[purchaseId]
        ) {
          return false;
        }

        return !matchesPurchaseSearch(item, liveSearchQuery);
      })
      .map((item) => String(item?.id || "").trim());

    if (targetPurchaseIds.length === 0) return;

    void Promise.all(
      targetPurchaseIds.map((purchaseId) => loadRandomBoxEvents(purchaseId)),
    );
  }, [
    allPurchases,
    classId,
    liveSearchQuery,
    loadRandomBoxEvents,
    loadingRandomBoxEventMap,
    randomBoxEventMap,
  ]);

  const categoryFilteredItems = useMemo(() => {
    return allPurchases.filter((item) => {
      const purchaseCategoryId = String(
        item?.categoryId ||
          item?.itemCategoryId ||
          itemCategoryIdMap[item?.itemId] ||
          "",
      ).trim();

      const matchesCategory =
        applied.category === ALL_CATEGORY_VALUE ||
        purchaseCategoryId === applied.category;

      return matchesCategory;
    });
  }, [
    allPurchases,
    applied.category,
    itemCategoryIdMap,
  ]);

  const searchedItems = useMemo(() => {
    return categoryFilteredItems.filter((item) => {
      const purchaseId = String(item?.id || "").trim();
      const randomBoxEvents = purchaseId ? randomBoxEventMap[purchaseId] || [] : [];

      return matchesPurchaseSearch(
        item,
        liveSearchQuery,
        randomBoxEvents,
      );
    });
  }, [
    categoryFilteredItems,
    liveSearchQuery,
    randomBoxEventMap,
  ]);

  const usageTargetItems = useMemo(
    () => (liveSearchQuery ? categoryFilteredItems : searchedItems),
    [categoryFilteredItems, liveSearchQuery, searchedItems],
  );

  const usageTargets = useMemo(
    () =>
      usageTargetItems
        .filter(
          (item) =>
            isCompletedStatus(item?.status) &&
            item?.id &&
            item?.studentUid &&
            item?.itemId,
        )
        .map((item) => ({
          id: item.id,
          studentUid: item.studentUid,
          itemId: item.itemId,
          quantity: Number(item.quantity || 0),
        })),
    [usageTargetItems],
  );

  const usageTargetsJson = useMemo(
    () => JSON.stringify(usageTargets),
    [usageTargets],
  );

  useEffect(() => {
    let isCancelled = false;

    const loadUsageStatus = async () => {
      const parsedTargets = usageTargetsJson ? JSON.parse(usageTargetsJson) : [];

      if (!classId || parsedTargets.length === 0) {
        if (!isCancelled) {
          setUsageStatusMap((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        }
        return;
      }

      const nextUsageStatusMap = await buildUsageStatusMap(
        classId,
        parsedTargets,
        inventoryCacheRef.current,
      );

      if (!isCancelled) {
        setUsageStatusMap((prev) =>
          areUsageMapsEqual(prev, nextUsageStatusMap) ? prev : nextUsageStatusMap,
        );
      }
    };

    loadUsageStatus();

    return () => {
      isCancelled = true;
    };
  }, [classId, usageTargetsJson]);

  const refundableItems = useMemo(
    () =>
      searchedItems.filter((item) => isUnusedPurchase(item, usageStatusMap)),
    [searchedItems, usageStatusMap],
  );

  const filteredItems = useMemo(
    () => {
      if (isRefundView) return refundableItems;
      if (applied.status === "unused") {
        return searchedItems.filter((item) => isUnusedPurchase(item, usageStatusMap));
      }
      return searchedItems;
    },
    [applied.status, isRefundView, refundableItems, searchedItems, usageStatusMap],
  );

  const baseFilteredItems = useMemo(
    () => {
      if (isRefundView) {
        return categoryFilteredItems.filter((item) =>
          isUnusedPurchase(item, usageStatusMap),
        );
      }
      if (applied.status === "unused") {
        return categoryFilteredItems.filter((item) =>
          isUnusedPurchase(item, usageStatusMap),
        );
      }
      return categoryFilteredItems;
    },
    [applied.status, categoryFilteredItems, isRefundView, usageStatusMap],
  );

  const hasActiveSearch = liveSearchQuery.length > 0;
  const isShowingSearchFallback =
    hasActiveSearch &&
    filteredItems.length === 0 &&
    baseFilteredItems.length > 0;
  const displayedItems = isShowingSearchFallback
    ? baseFilteredItems
    : filteredItems;

  const toggleRandomBoxDetails = async (item) => {
    const purchaseId = String(item?.id || "").trim();
    if (!purchaseId || !classId) return;

    const shouldExpand = !expandedRandomBoxIds[purchaseId];
    setExpandedRandomBoxIds((prev) => ({
      ...prev,
      [purchaseId]: shouldExpand,
    }));

    if (!shouldExpand) return;
    if (randomBoxEventMap[purchaseId] || loadingRandomBoxEventMap[purchaseId]) return;

    setLoadingRandomBoxEventMap((prev) => ({ ...prev, [purchaseId]: true }));
    try {
      const snapshot = await getDocs(
        collection(db, `classes/${classId}/storeRedemptions/${purchaseId}/openEvents`),
      );
      const docs = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort(
          (left, right) =>
            toTimestampMillis(right?.openedAt) - toTimestampMillis(left?.openedAt),
        );
      setRandomBoxEventMap((prev) => ({ ...prev, [purchaseId]: docs }));
    } catch (error) {
      console.error("[StorePendingRedemptions] Failed to load random box events:", error);
      showFeedback("랜덤박스 상세 기록을 불러오지 못했습니다.", "error");
    } finally {
      setLoadingRandomBoxEventMap((prev) => ({
        ...prev,
        [purchaseId]: false,
      }));
    }
  };

  const visibleRefundableItems = useMemo(
    () =>
      displayedItems.filter(
        (item) =>
          !isRestrictedVipRecord(item) && isUnusedPurchase(item, usageStatusMap),
      ),
    [displayedItems, isRestrictedVipRecord, usageStatusMap],
  );

  const refundableIdSet = useMemo(
    () => new Set(visibleRefundableItems.map((item) => item.id)),
    [visibleRefundableItems],
  );

  useEffect(() => {
    setSelectedRefundIds((prev) => {
      const next = prev.filter((id) => refundableIdSet.has(id));
      return isSameIdList(prev, next) ? prev : next;
    });
  }, [refundableIdSet]);

  const stats = useMemo(
    () =>
      displayedItems.reduce(
        (acc, item) => {
          if (isRestrictedVipRecord(item)) return acc;
          const amount = Number(item.totalAmount) || 0;
          if (item.status === "cancelled") acc.refund += amount;
          else acc.revenue += amount;
          return acc;
        },
        { revenue: 0, refund: 0 },
      ),
    [displayedItems, isRestrictedVipRecord],
  );

  const selectedRefundItems = useMemo(
    () => visibleRefundableItems.filter((item) => selectedRefundIds.includes(item.id)),
    [selectedRefundIds, visibleRefundableItems],
  );

  const allRefundableSelected =
    visibleRefundableItems.length > 0 &&
    visibleRefundableItems.every((item) => selectedRefundIds.includes(item.id));

  const toggleRefundSelection = (item, forceMode = null) => {
    if (
      !refundableIdSet.has(item?.id) ||
      isRestrictedVipRecord(item) ||
      isBulkProcessing
    ) {
      return;
    }

    setSelectedRefundIds((prev) => {
      const next = new Set(prev);
      const isSelected = next.has(item.id);
      const shouldSelect =
        forceMode === "select"
          ? true
          : forceMode === "deselect"
            ? false
            : !isSelected;

      if (shouldSelect === isSelected) {
        return prev;
      }

      if (shouldSelect) next.add(item.id);
      else next.delete(item.id);

      return Array.from(next);
    });
  };

  const { startDrag, enterDrag } = useDragSelection({
    isSelected: (item) => selectedRefundIds.includes(item?.id),
    onSelect: (item) => toggleRefundSelection(item, "select"),
    onDeselect: (item) => toggleRefundSelection(item, "deselect"),
    isItemEnabled: (item) =>
      refundableIdSet.has(item?.id) &&
      !isRestrictedVipRecord(item) &&
      !isBulkProcessing,
  });

  const handleSelectionMouseDown = (item, isSelected) => {
    if (
      !refundableIdSet.has(item?.id) ||
      isRestrictedVipRecord(item) ||
      isBulkProcessing
    ) {
      return;
    }
    startDrag(item, { selected: isSelected });
  };

  const handleSelectionMouseEnter = (item) => {
    enterDrag(item);
  };

  const toggleSelectAllRefundable = () => {
    if (isBulkProcessing) return;
    setSelectedRefundIds(
      allRefundableSelected ? [] : visibleRefundableItems.map((item) => item.id),
    );
  };

  const handleAction = async (actionFn, item, params = {}) => {
    if (!adminUserData?.uid || processingId || isBulkProcessing || !item) return;
    if (isRestrictedVipRecord(item)) return;

    setProcessingId(item.id);
    try {
      const result =
        actionFn === cancelStorePurchase
          ? await actionFn(classId, item.studentUid, item.id, params.reason || "")
          : await actionFn({
              classId,
              purchaseId: item.id,
              adminUid: adminUserData.uid,
              studentUid: item.studentUid,
              ...params,
            });

      showFeedback(
        result?.message || "처리를 완료했습니다.",
        result?.success ? "success" : "error",
      );

      if (result?.success) {
        setSelectedRefundIds((prev) => prev.filter((id) => id !== item.id));
        refresh?.();
      }
    } catch (error) {
      showFeedback("처리 중 오류가 발생했습니다.", "error");
    } finally {
      setProcessingId(null);
      setCancelTargetItem(null);
    }
  };

  const handleBulkCancel = async (reason) => {
    if (!classId || selectedRefundItems.length === 0 || isBulkProcessing) return;

    setIsBulkProcessing(true);
    setProcessingId("bulk");
    try {
      const payload = selectedRefundItems.map((item) => ({
        purchaseId: item.id,
        studentUid: item.studentUid,
      }));

      const result = await bulkCancelStorePurchases(classId, payload, reason || "");

      showFeedback(
        result?.message || "선택한 구매를 환불했습니다.",
        result?.success ? "success" : "error",
      );

      const succeededIds = (result?.data?.success || [])
        .map((item) => item.purchaseId)
        .filter(Boolean);

      if (succeededIds.length > 0) {
        setSelectedRefundIds((prev) =>
          prev.filter((id) => !succeededIds.includes(id)),
        );
      }

      if (result?.success || succeededIds.length > 0) {
        refresh?.();
      }
    } catch (error) {
      showFeedback("선택 환불 처리 중 오류가 발생했습니다.", "error");
    } finally {
      setBulkCancelOpen(false);
      setIsBulkProcessing(false);
      setProcessingId(null);
    }
  };
  const handleBulkDeleteSelected = async () => {
    if (
      !canHardDelete ||
      selectedRefundItems.length === 0 ||
      processingId ||
      isBulkProcessing
    ) {
      return;
    }

    if (
      !(await appConfirm(`선택한 ${selectedRefundItems.length}건을 영구 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))
    ) {
      return;
    }

    setIsBulkProcessing(true);
    setProcessingId("bulk-delete");
    try {
      const settled = await Promise.allSettled(
        selectedRefundItems.map(async (selectedItem) => {
          const result = await hardDeleteStorePurchase({
            classId,
            purchaseId: selectedItem.id,
            studentUid: selectedItem.studentUid,
          });

          if (!result?.success) {
            throw new Error(result?.message || "구매 삭제에 실패했습니다.");
          }

          return selectedItem.id;
        }),
      );

      const deletedIds = settled
        .filter((entry) => entry.status === "fulfilled")
        .map((entry) => entry.value);
      const failedCount = settled.length - deletedIds.length;

      if (deletedIds.length > 0) {
        setSelectedRefundIds((prev) =>
          prev.filter((id) => !deletedIds.includes(id)),
        );
        refresh?.();
      }

      if (failedCount === 0) {
        showFeedback(`${deletedIds.length}건을 삭제했습니다.`, "success");
      } else {
        showFeedback(
          `${deletedIds.length}건 삭제, ${failedCount}건 실패했습니다.`,
          deletedIds.length > 0 ? "success" : "error",
        );
      }
    } catch (error) {
      showFeedback(error?.message || "선택 삭제 중 오류가 발생했습니다.", "error");
    } finally {
      setIsBulkProcessing(false);
      setProcessingId(null);
    }
  };

  const handleApplyAll = (event) => {
    event?.preventDefault();
    setApplied({
      start: tempStartDate,
      end: tempEndDate,
      search: tempSearchQuery,
      status: tempStatus,
      category: tempCategory,
    });
    setSelectedRefundIds([]);
    showFeedback("필터를 적용했습니다.", "success");
  };

  const handleFilterKeyDown = (event) => {
    if (event.key !== "Enter") return;
    handleApplyAll(event);
  };

  const handleSearchChange = useCallback((value) => {
    setTempSearchQuery(value);
    setApplied((prev) =>
      prev.search === value
        ? prev
        : {
            ...prev,
            search: value,
          },
    );
    setSelectedRefundIds((prev) => (prev.length === 0 ? prev : []));
  }, []);

  const isChanged =
    tempStartDate !== applied.start ||
    tempEndDate !== applied.end ||
    tempSearchQuery !== applied.search ||
    tempStatus !== applied.status ||
    tempCategory !== applied.category;

  const visibleStatusOptions = isRefundView
    ? STATUS_FILTER_OPTIONS.filter(
        (option) => option.value !== "cancelled" && option.value !== "unused",
      )
    : STATUS_FILTER_OPTIONS;

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="border-b bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
              <ListChecks className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">{headingTitle}</h2>
          </div>

          <div className="flex items-center gap-2">
            <IconButton
              icon={RefreshCw}
              label="새로고침"
              tone="blue"
              onClick={() => refresh?.()}
              isLoading={isLoading}
            />

            <IconButton
              icon={Filter}
              label="필터"
              tone="blue"
              active={showFilters}
              onClick={() => setShowFilters((prev) => !prev)}
            />

            <IconButton
              icon={BarChart3}
              label="통계"
              tone="emerald"
              active={showStats}
              onClick={() => setShowStats((prev) => !prev)}
            />

            {showBackButton ? (
              <Button
                size="sm"
                kind="solid"
                tone="blue"
                onClick={asModal ? onClose : onBackToShop}
                icon={ArrowLeft}
              >
                상점으로
              </Button>
            ) : null}
          </div>
        </div>

        {showFilters ? (
          <form
            onSubmit={handleApplyAll}
            className="mt-4 animate-in overflow-hidden rounded-2xl border border-slate-100 fade-in"
          >
            <FilterBar className="border-b-0">
              <FilterBar.Grid className="lg:grid-cols-[minmax(220px,1fr)_150px_150px_150px_auto]">
                <FilterBar.Search
                  value={tempSearchQuery}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  onEnterApply={handleApplyAll}
                  placeholder="학생 이름 또는 상품명으로 검색"
                  tone="blue"
                />
                <FilterBar.Select
                  value={tempCategory}
                  onChange={(event) => setTempCategory(event.target.value)}
                  onKeyDown={handleFilterKeyDown}
                  tone="blue"
                  aria-label="카테고리 필터"
                  options={categoryOptions}
                />
                <FilterBar.Select
                  value={tempStatus}
                  onChange={(event) => setTempStatus(event.target.value)}
                  onKeyDown={handleFilterKeyDown}
                  tone="blue"
                  aria-label="상태 필터"
                  options={visibleStatusOptions}
                />
                <FilterBar.Date
                  value={tempStartDate}
                  onChange={(event) => setTempStartDate(event.target.value)}
                  onEnterApply={handleApplyAll}
                  tone="blue"
                />
                <FilterBar.Actions>
                  <FilterBar.Date
                    value={tempEndDate}
                    onChange={(event) => setTempEndDate(event.target.value)}
                    onEnterApply={handleApplyAll}
                    tone="blue"
                    className="min-w-[132px]"
                  />
                  <Button
                    type="submit"
                    fullWidth
                    tone="blue"
                    icon={Filter}
                    variant={isChanged ? "primary" : "secondary"}
                    disabled={!isChanged}
                  >
                    적용
                  </Button>
                </FilterBar.Actions>
              </FilterBar.Grid>
            </FilterBar>
          </form>
        ) : null}

        {showStats && !isLoading ? (
          <div className="mt-6 grid animate-in grid-cols-1 gap-4 slide-in-from-right-2 sm:grid-cols-3">
            <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">
                  총 매출
                </p>
                <p className="text-xl font-black text-slate-900">
                  {formatClassCurrency(stats.revenue)}{" "}
                  <span className="text-xs font-medium text-slate-400">
                    {currencyUnit}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="rounded-xl bg-rose-50 p-2.5 text-rose-600">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">
                  총 환불
                </p>
                <p className="text-xl font-black text-rose-600">
                  -{formatClassCurrency(stats.refund)}{" "}
                  <span className="text-xs font-medium text-rose-300">
                    {currencyUnit}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-indigo-50/30 p-4 shadow-sm">
              <div className="rounded-xl bg-indigo-600 p-2.5 text-white">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">
                  순매출
                </p>
                <p className="text-xl font-black text-indigo-700">
                  {formatClassCurrency(stats.revenue - stats.refund)}{" "}
                  <span className="text-xs font-medium text-indigo-300">
                    {currencyUnit}
                  </span>
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <StorePendingRedemptionsTable
        isLoading={isLoading}
        items={displayedItems}
        isShowingSearchFallback={isShowingSearchFallback}
        allRefundableSelected={allRefundableSelected}
        onToggleSelectAllRefundable={toggleSelectAllRefundable}
        refundableItems={visibleRefundableItems}
        refundableIdSet={refundableIdSet}
        isBulkProcessing={isBulkProcessing}
        onCancelItem={setCancelTargetItem}
        onRedeemItem={(item) => handleAction(markPurchaseAsRedeemed, item)}
        processingId={processingId}
        selectedRefundIds={selectedRefundIds}
        onToggleRefundSelection={toggleRefundSelection}
        onSelectionMouseDown={handleSelectionMouseDown}
        onSelectionMouseEnter={handleSelectionMouseEnter}
        hasNextPage={hasNextPage}
        onFetchNextPage={fetchNextPage}
        isFetchingNextPage={isFetchingNextPage}
        usageStatusMap={usageStatusMap}
        expandedRandomBoxIds={expandedRandomBoxIds}
        randomBoxEventMap={randomBoxEventMap}
        loadingRandomBoxEventMap={loadingRandomBoxEventMap}
        onToggleRandomBoxDetails={toggleRandomBoxDetails}
        isRecordRestricted={isRestrictedVipRecord}
      />

      {selectedRefundIds.length > 0 ? (
        <BulkActionFloatingBar
          count={selectedRefundIds.length}
          tone="rose"
          icon={RotateCcw}
          eyebrow="선택 구매"
          title="선택한 구매를 한 번에 환불할 수 있습니다"
          subtitle="실제로 미사용 상태인 구매 건만 선택됩니다."
          actions={[
            {
              key: "toggle-all",
              label: allRefundableSelected ? "전체 선택 해제" : "전체 선택",
              onClick: toggleSelectAllRefundable,
              icon: ListChecks,
              tone: "slate",
              kind: "outline",
              disabled:
                isBulkProcessing || visibleRefundableItems.length === 0,
            },
            ...(canHardDelete
              ? [
                  {
                    key: "delete",
                    label: "선택 삭제",
                    onClick: handleBulkDeleteSelected,
                    icon: Trash2,
                    tone: "rose",
                    kind: "outline",
                    disabled:
                      isBulkProcessing || selectedRefundItems.length === 0,
                    isLoading: processingId === "bulk-delete",
                  },
                ]
              : []),
            {
              key: "refund",
              label: "선택 환불",
              onClick: () => setBulkCancelOpen(true),
              icon: RotateCcw,
              tone: "rose",
              disabled: isBulkProcessing || selectedRefundItems.length === 0,
              isLoading: processingId === "bulk",
            },
          ]}
          onClear={() => setSelectedRefundIds([])}
          clearLabel="선택 해제"
        />
      ) : null}

      <CancelReasonModal
        isOpen={Boolean(cancelTargetItem)}
        onClose={() => setCancelTargetItem(null)}
        onSubmit={(reason) =>
          handleAction(cancelStorePurchase, cancelTargetItem, { reason })
        }
        isSubmitting={Boolean(processingId) || isBulkProcessing}
      />

      <CancelReasonModal
        isOpen={bulkCancelOpen}
        onClose={() => setBulkCancelOpen(false)}
        onSubmit={handleBulkCancel}
        isSubmitting={isBulkProcessing}
      />
    </div>
  );
};

export default StorePendingRedemptions;
