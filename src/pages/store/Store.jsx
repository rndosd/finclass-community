import { appConfirm } from "../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Menu, Transition } from "@headlessui/react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Crown,
  Coins,
  History,
  Package,
  Percent,
  Plus,
  Settings,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  writeBatch,
} from "firebase/firestore";

import { db } from "../../firebase";
import { withFirestoreSnapshotTelemetry } from "../../utils/firestoreTelemetry";
import AppLayout from "../../components/layout/AppLayout";
import {
  Alert,
  AssetBalanceBar,
  Badge,
  Button,
  CardSkeleton,
  PageHeader,
  PageLoader,
  SurfaceLoader,
} from "../../components/ui";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useNumberFormat } from "../../contexts/NumberFormatContext";
import { useUser } from "../../contexts/UserContext";
import { useFundMode } from "../../contexts/FundModeContext";
import { useEconomyBaseline } from "../../hooks/economy/useEconomyBaseline";
import { useClassStudents } from "../../hooks/user/useClassStudents";
import { resolveClassCurrencyUnit } from "../../utils/currencyUnit";
import { getStoreTreasuryMode } from "../../utils/taxPolicy";
import { buildPurchaseResultMessage } from "./utils/purchaseResultMessage";
import StoreItemList from "./components/StoreItemList";
import StoreToolbar from "./components/StoreToolbar";
import VipLoungeGate from "./components/VipLoungeGate";
import VipLoungeIntro from "./components/VipLoungeIntro";
import useCart from "./hooks/useCart";
import useStoreData from "./hooks/useStoreData";
import useStoreUsageMap from "./hooks/useStoreUsageMap";
import AddEditCategoryModal from "./modals/AddEditCategoryModal";
import AddEditRandomBoxModal from "./modals/AddEditRandomBoxModal";
import AddEditStoreItemModal from "./modals/AddEditStoreItemModal";
import AddEditVipLoungeModal from "./modals/AddEditVipLoungeModal";
import AddToCartModal from "./modals/AddToCartModal";
import BuyItemModal from "./modals/BuyItemModal";
import MyItemsModal from "./modals/MyItemsModal";
import StoreCartModal from "./modals/StoreCartModal";
import StoreAnalyticsPanel from "./components/StoreAnalyticsPanel";
import StorePendingRedemptionsModal from "./modals/StorePendingRedemptionsModal";
import StorePosModal from "./modals/StorePosModal";
import TaxSettingsModal from "./modals/TaxSettingsModal";
import { useStorePurchases } from "./hooks/useStorePurchases";
import {
  decorateStoreItemWithTimeSale,
  STORE_SPECIAL_CATEGORY_ID,
} from "./utils/timeSale";
import {
  getStoreCurrencyUnit,
  getStudentBalanceByCurrency,
  normalizeStoreCurrencyType,
} from "./utils/storeCurrency";
import { isRandomBoxItem } from "./utils/randomBox";
import {
  isStoreItemPurchasableByStudents,
  isStoreItemVisibleToStudents,
} from "./utils/storeSaleStatus";
import { buildStorePriceGuidance } from "./utils/storePriceGuidance";
import {
  canEnterVipLounge,
  isVipLoungeCategory,
  isVipStoreItem,
} from "./utils/vipLounge";
import { formatDateKeyInKST } from "../../utils/kstDate";
import { ENABLE_CLASS_FUNDS_ROLLOUT } from "../../config/rolloutFlags";
import { beginFirestoreSubscriptionDebug } from "../../utils/firestoreSubscriptionDebug";

const StorePageSkeleton = () => (
  <div className="space-y-6">
    <div className="space-y-3">
      <div className="h-10 w-40 animate-pulse rounded-2xl bg-slate-200/80" />
      <div className="h-5 w-80 max-w-full animate-pulse rounded-xl bg-slate-200/60" />
    </div>

    <div className="flex flex-wrap gap-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={`store-category-skeleton-${index}`}
          className="h-10 w-24 animate-pulse rounded-full bg-slate-200/70"
        />
      ))}
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="h-14 w-56 animate-pulse rounded-2xl bg-white/90 shadow-sm" />
      <div className="flex flex-wrap gap-2">
        <div className="h-10 w-28 animate-pulse rounded-xl bg-white/90 shadow-sm" />
        <div className="h-10 w-28 animate-pulse rounded-xl bg-white/90 shadow-sm" />
      </div>
    </div>

    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <CardSkeleton
          key={`store-card-skeleton-${index}`}
          rows={5}
          showFooter
          className="min-h-[280px] rounded-[2rem] border-0 bg-white shadow-md shadow-slate-200/40"
        />
      ))}
    </div>
  </div>
);

const VIP_LOUNGE_TAB_STYLE = {
  fontFamily: '"Gowun Batang", serif',
  borderRadius: "1rem 1rem 0 0",
};
const Store = () => {
  const {
    classId,
    classData,
    userData,
    missionTokenLabel,
    loading: userContextLoading,
    isTeacher,
    hasPermission,
  } = useUser();
  const purchases = useStorePurchases(classId, userData?.uid);
  const { showFeedback } = useFeedback();
  const { formatClassCurrency } = useNumberFormat();
  const {
    activeFundId,
    activeFunds: classFunds,
    getChannelAccess,
    isFundMode,
  } = useFundMode();
  const storePurchaseAccess = getChannelAccess("storePurchase");
  const [searchParams, setSearchParams] = useSearchParams();
  const canManageStore = isTeacher || hasPermission("store_admin");
  const canViewStoreAnalytics = isTeacher;
  const canUseStorePos =
    canManageStore ||
    hasPermission("tax_admin") ||
    (isFundMode && storePurchaseAccess.allowed);

  const requestedCategoryId = searchParams.get("category") || "";
  const requestedView = searchParams.get("view") || "";
  const requestedFundAction = searchParams.get("fundAction") || "";
  const isAnalyticsView = canViewStoreAnalytics && requestedView === "analytics";

  const { cartItems, addToCart, updateQty, removeItem, clearCart } = useCart();

  const pageCurrencyUnit = resolveClassCurrencyUnit(classData);

  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showCartModal, setShowCartModal] = useState(false);
  const [buyItemModalInfo, setBuyItemModalInfo] = useState({
    isOpen: false,
    itemId: null,
  });
  const [addToCartModalInfo, setAddToCartModalInfo] = useState({
    isOpen: false,
    itemId: null,
  });
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showAddRandomBoxModal, setShowAddRandomBoxModal] = useState(false);
  const [itemToEdit, setItemToEdit] = useState(null);
  const [randomBoxToEdit, setRandomBoxToEdit] = useState(null);
  const [showTaxSettingsModal, setShowTaxSettingsModal] = useState(false);
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);
  const [categoryToEdit, setCategoryToEdit] = useState(null);
  const [vipLoungeToEdit, setVipLoungeToEdit] = useState(null);
  const [showVipLoungeModal, setShowVipLoungeModal] = useState(false);
  const [unlockedVipLoungeIds, setUnlockedVipLoungeIds] = useState(
    () => new Set(),
  );
  const [vipTab, setVipTab] = useState("info");
  const [showMyItemsModal, setShowMyItemsModal] = useState(false);
  const [showPosModal, setShowPosModal] = useState(false);
  const isStorePosOpen = canUseStorePos && showPosModal;
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [storeSnapshotPrices, setStoreSnapshotPrices] = useState({});
  const includeHiddenStoreItems =
    canUseStorePos &&
    (isAnalyticsView ||
      isStorePosOpen ||
      canManageStore ||
      showAddItemModal ||
      showAddRandomBoxModal ||
      Boolean(itemToEdit) ||
      Boolean(randomBoxToEdit) ||
      showVipLoungeModal ||
      Boolean(vipLoungeToEdit));

  const {
    categories,
    allItems,
    selectedCategoryId,
    setSelectedCategoryId,
    isLoading: isLoadingStore,
    isLoadingItems,
  } = useStoreData({ includeHiddenItems: includeHiddenStoreItems });
  const { data: posStudents = [] } = useClassStudents(classId, {
    enabled: !!classId && canUseStorePos && (isStorePosOpen || isAnalyticsView),
    realtime: isStorePosOpen,
    telemetry: {
      source: "Store.posStudents",
      sourceGroup: "page",
      role: isTeacher ? "teacher" : "delegated",
    },
  });
  const { data: economyBaseline } = useEconomyBaseline(classId, {
    enabled: !!classId && canManageStore,
    debug: {
      source: "Store.economyBaseline",
      role: isTeacher ? "teacher" : "delegated",
    },
  });

  useEffect(() => {
    if (!canUseStorePos) {
      setShowPosModal(false);
    }
  }, [canUseStorePos]);

  useEffect(() => {
    if (requestedFundAction !== "pos") return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("fundAction");
    setSearchParams(nextParams, { replace: true });

    if (!ENABLE_CLASS_FUNDS_ROLLOUT || !isFundMode) return;
    if (!canUseStorePos) {
      showFeedback("기금 POS를 사용할 권한이 없습니다.", "warning");
      return;
    }
    if (!storePurchaseAccess.allowed) {
      showFeedback(storePurchaseAccess.reason, "warning");
      return;
    }

    setShowPosModal(true);
  }, [
    canUseStorePos,
    isFundMode,
    requestedFundAction,
    searchParams,
    setSearchParams,
    showFeedback,
    storePurchaseAccess.allowed,
    storePurchaseAccess.reason,
  ]);

  useEffect(() => {
    if (!classId) return undefined;

    setCurrentTimeMs(Date.now());
    const timerId = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 30000);

    return () => window.clearInterval(timerId);
  }, [classId]);

  useEffect(() => {
    if (!classId) {
      setStoreSnapshotPrices({});
      return undefined;
    }

    const todayKey = formatDateKeyInKST(new Date());
    const snapshotRef = doc(
      db,
      "classes",
      classId,
      "storeAnalyticsDaily",
      todayKey,
    );
    const subscriptionDebug = beginFirestoreSubscriptionDebug({
      source: "Store.dailyPriceSnapshot",
      pathKey: "classes/{classId}/storeAnalyticsDaily/{date}",
      classId,
      role: isTeacher ? "teacher" : "student",
    });

    const unsubscribe = onSnapshot(
      snapshotRef,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        subscriptionDebug.recordSnapshot(snapshot);
        const nextPrices = snapshot.exists()
          ? snapshot.data()?.priceSnapshot?.prices || {}
          : {};
        setStoreSnapshotPrices(nextPrices);
      }),
      (error) => {
        subscriptionDebug.recordError(error);
        setStoreSnapshotPrices({});
      },
    );

    return () => {
      unsubscribe();
      subscriptionDebug.stop();
    };
  }, [classId, isTeacher]);

  const processedStudentsList = useMemo(() => {
    if (!posStudents.length) return [];

    const pureStudents = posStudents.filter(
      (student) => student.uid !== userData?.uid,
    );
    const sorted = [...pureStudents].sort(
      (a, b) => (a.studentNumber || 0) - (b.studentNumber || 0),
    );

    if (isTeacher && userData) {
      return [
        {
          uid: userData.uid,
          name: userData.name,
          studentNumber: 0,
          assets: userData.assets || { cash: 0 },
          isTeacherAccount: true,
        },
        ...sorted,
      ];
    }

    return sorted;
  }, [isTeacher, posStudents, userData]);

  const analyticsStudentCount = useMemo(
    () =>
      posStudents.filter(
        (student) =>
          String(student?.role || "student")
            .trim()
            .toLowerCase() === "student",
      ).length,
    [posStudents],
  );

  const studentAssets = useMemo(
    () => userData?.assets || {},
    [userData?.assets],
  );
  const studentCashBalance = Number(studentAssets.cash ?? 0);
  const studentMissionTokenBalance = Number(studentAssets.missionToken ?? 0);
  const studentForeignBalance = Number(studentAssets.usdBalance ?? 0);

  const getItemCurrencyType = useCallback(
    (item) => normalizeStoreCurrencyType(item?.currencyType),
    [],
  );

  const getItemCurrencyUnit = useCallback(
    (item) =>
      getStoreCurrencyUnit(
        getItemCurrencyType(item),
        pageCurrencyUnit,
        missionTokenLabel,
      ),
    [getItemCurrencyType, missionTokenLabel, pageCurrencyUnit],
  );

  const getStudentBalanceForItem = useCallback(
    (item) =>
      getStudentBalanceByCurrency(studentAssets, getItemCurrencyType(item)),
    [getItemCurrencyType, studentAssets],
  );

  const displayAllItems = useMemo(
    () =>
      allItems.map((item) => ({
        ...decorateStoreItemWithTimeSale(item, new Date(currentTimeMs)),
        snapshotBasePrice: Number(storeSnapshotPrices?.[item.id] ?? NaN),
        snapshotPriceChangePercent: (() => {
          const snapshotPrice = Number(storeSnapshotPrices?.[item.id] ?? NaN);
          const currentPrice = Number(item?.price ?? NaN);

          if (!Number.isFinite(snapshotPrice) || snapshotPrice <= 0)
            return null;
          if (!Number.isFinite(currentPrice) || currentPrice === snapshotPrice)
            return null;

          return (
            Math.round(
              ((currentPrice - snapshotPrice) / snapshotPrice) * 100 * 10,
            ) / 10
          );
        })(),
      })),
    [allItems, currentTimeMs, storeSnapshotPrices],
  );

  const storePriceGuidance = useMemo(
    () =>
      buildStorePriceGuidance({
        items: displayAllItems,
        economyBaseline,
      }),
    [displayAllItems, economyBaseline],
  );

  const activeTimeSaleItems = useMemo(
    () => displayAllItems.filter((item) => item.timeSaleActive),
    [displayAllItems],
  );

  const visibleTimeSaleItems = useMemo(
    () =>
      canManageStore
        ? activeTimeSaleItems
        : activeTimeSaleItems.filter((item) =>
            isStoreItemVisibleToStudents(item),
          ),
    [activeTimeSaleItems, canManageStore],
  );

  const storeCategories = useMemo(() => {
    if (visibleTimeSaleItems.length === 0) return categories;

    return [
      {
        id: STORE_SPECIAL_CATEGORY_ID,
        name: "특가",
        icon: "Sparkles",
        iconColor: "rose",
        isActive: true,
        isVirtual: true,
      },
      ...categories,
    ];
  }, [categories, visibleTimeSaleItems.length]);

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const selectedCategory = useMemo(
    () =>
      storeCategories.find((category) => category.id === selectedCategoryId) ||
      null,
    [selectedCategoryId, storeCategories],
  );

  const selectedCategoryIsVip = isVipLoungeCategory(selectedCategory);
  const canManageVipLounge = isTeacher;
  const isVipLoungeUnlocked =
    selectedCategoryIsVip &&
    (isTeacher || unlockedVipLoungeIds.has(selectedCategoryId));
  const hasVipStudentAccess =
    selectedCategoryIsVip &&
    canEnterVipLounge({
      category: selectedCategory,
      student: userData,
      isTeacher,
    });
  useEffect(() => {
    setVipTab("info");
  }, [selectedCategoryId]);

  const availableCategoryIds = useMemo(
    () => new Set(storeCategories.map((category) => category.id)),
    [storeCategories],
  );

  const handleCategoryChange = useCallback(
    (nextCategoryId) => {
      setSelectedCategoryId(nextCategoryId);

      const nextParams = new URLSearchParams(searchParams);
      if (
        nextCategoryId &&
        nextCategoryId !== STORE_SPECIAL_CATEGORY_ID &&
        availableCategoryIds.has(nextCategoryId)
      ) {
        nextParams.set("category", nextCategoryId);
      } else {
        nextParams.delete("category");
      }
      nextParams.delete("view");
      setSearchParams(nextParams, { replace: true });
    },
    [
      availableCategoryIds,
      searchParams,
      setSearchParams,
      setSelectedCategoryId,
    ],
  );

  const handleLeaveVipLounge = useCallback(() => {
    const fallbackCategory = categories.find(
      (category) => !isVipLoungeCategory(category),
    );
    handleCategoryChange(fallbackCategory?.id || categories[0]?.id || "");
  }, [categories, handleCategoryChange]);

  const handleOpenAnalyticsView = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", "analytics");
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const handleCloseAnalyticsView = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("view");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (
      selectedCategoryId === STORE_SPECIAL_CATEGORY_ID &&
      visibleTimeSaleItems.length === 0 &&
      categories.length > 0
    ) {
      setSelectedCategoryId(categories[0].id);
    }
  }, [
    categories,
    selectedCategoryId,
    setSelectedCategoryId,
    visibleTimeSaleItems.length,
  ]);

  useEffect(() => {
    if (!requestedCategoryId) return;
    if (!availableCategoryIds.has(requestedCategoryId)) return;
    setSelectedCategoryId(requestedCategoryId);
  }, [availableCategoryIds, requestedCategoryId, setSelectedCategoryId]);

  const visibleCategoryItems = useMemo(() => {
    const sourceItems = canManageStore
      ? displayAllItems
      : displayAllItems.filter((item) => isStoreItemVisibleToStudents(item));

    if (selectedCategoryId === STORE_SPECIAL_CATEGORY_ID) {
      return [...sourceItems]
        .filter((item) => item.timeSaleActive)
        .sort((left, right) => {
          const leftEnd =
            left.timeSaleEndAt?.getTime?.() || Number.MAX_SAFE_INTEGER;
          const rightEnd =
            right.timeSaleEndAt?.getTime?.() || Number.MAX_SAFE_INTEGER;
          if (leftEnd !== rightEnd) return leftEnd - rightEnd;
          return right.timeSaleDiscountPercent - left.timeSaleDiscountPercent;
        });
    }

    return sourceItems.filter((item) => item.categoryId === selectedCategoryId);
  }, [canManageStore, displayAllItems, selectedCategoryId]);

  const activeAddToCartItem = useMemo(
    () =>
      displayAllItems.find((item) => item.id === addToCartModalInfo.itemId) ||
      null,
    [addToCartModalInfo.itemId, displayAllItems],
  );

  const activeBuyItem = useMemo(
    () =>
      displayAllItems.find((item) => item.id === buyItemModalInfo.itemId) ||
      null,
    [buyItemModalInfo.itemId, displayAllItems],
  );

  const displayPosItems = useMemo(
    () =>
      displayAllItems.filter(
        (item) =>
          !isRandomBoxItem(item) &&
          (isTeacher || !isVipStoreItem(item, categoryMap)),
      ),
    [categoryMap, displayAllItems, isTeacher],
  );
  const manageableCategories = useMemo(
    () =>
      isTeacher
        ? categories
        : categories.filter((category) => !isVipLoungeCategory(category)),
    [categories, isTeacher],
  );
  const selectedCategoryIdForItemModal = useMemo(() => {
    if (selectedCategoryId === STORE_SPECIAL_CATEGORY_ID) {
      return manageableCategories[0]?.id || "";
    }
    if (
      selectedCategory &&
      isVipLoungeCategory(selectedCategory) &&
      !canManageVipLounge
    ) {
      return manageableCategories[0]?.id || "";
    }
    return selectedCategoryId || manageableCategories[0]?.id || "";
  }, [
    canManageVipLounge,
    manageableCategories,
    selectedCategory,
    selectedCategoryId,
  ]);
  const storeItemGiftPolicyMap = useMemo(
    () =>
      allItems.reduce((accumulator, item) => {
        accumulator[item.id] = item.isGiftAllowed !== false;
        return accumulator;
      }, {}),
    [allItems],
  );

  const resolvedCartItems = useMemo(() => {
    if (!cartItems.length) return [];

    const itemMap = new Map(displayAllItems.map((item) => [item.id, item]));
    return cartItems.map((cartItem) => {
      const latestItem = itemMap.get(cartItem.id);

      if (!latestItem) {
        return {
          ...cartItem,
          isMissingFromStore: true,
        };
      }

      return {
        ...cartItem,
        ...latestItem,
        quantity: cartItem.quantity,
      };
    });
  }, [cartItems, displayAllItems]);

  const usageSubscriptionItemIds = useMemo(() => {
    const nextIds = [];

    if (addToCartModalInfo.isOpen && activeAddToCartItem?.id) {
      nextIds.push(activeAddToCartItem.id);
    }

    if (buyItemModalInfo.isOpen && activeBuyItem?.id) {
      nextIds.push(activeBuyItem.id);
    }

    if (showCartModal) {
      resolvedCartItems.forEach((item) => {
        if (item?.id) nextIds.push(item.id);
      });
    }

    return nextIds;
  }, [
    activeAddToCartItem?.id,
    activeBuyItem?.id,
    addToCartModalInfo.isOpen,
    buyItemModalInfo.isOpen,
    resolvedCartItems,
    showCartModal,
  ]);

  const { usageData: scopedUsageData, loadedMap: usageLoadedMap } =
    useStoreUsageMap({
      classId,
      uid: userData?.uid,
      itemIds: usageSubscriptionItemIds,
      enabled: !!classId && !!userData?.uid,
    });

  const isAddToCartUsageLoading =
    addToCartModalInfo.isOpen &&
    Boolean(activeAddToCartItem?.id) &&
    usageLoadedMap[activeAddToCartItem.id] !== true;

  const isBuyUsageLoading =
    buyItemModalInfo.isOpen &&
    Boolean(activeBuyItem?.id) &&
    usageLoadedMap[activeBuyItem.id] !== true;

  const isCartUsageLoading =
    showCartModal &&
    resolvedCartItems.some((item) => usageLoadedMap[item.id] !== true);

  const currentTaxRate =
    classData?.settings?.taxRate ?? classData?.taxRate ?? 10;
  const isConsumptionTaxEnabled = getStoreTreasuryMode(classData) !== "NONE";

  const blockStudentPurchaseAction = useCallback(
    (item) => {
      if (isFundMode) {
        showFeedback("기금 모드에서는 상단에서 선택한 기금으로 POS를 사용해 주세요.", "warning");
        return true;
      }
      const isVipItem = isVipStoreItem(item, categoryMap);
      const canBypassSaleStatus = canManageStore && (!isVipItem || isTeacher);

      if (isVipItem && !isTeacher) {
        const vipCategory = categoryMap.get(item?.categoryId);
        const canUseVipItem =
          unlockedVipLoungeIds.has(item?.categoryId) &&
          canEnterVipLounge({
            category: vipCategory,
            student: userData,
            isTeacher,
          });

        if (!canUseVipItem) {
          showFeedback(
            "VIP \uB77C\uC6B4\uC9C0 \uC785\uC7A5 \uB300\uC0C1 \uD559\uC0DD\uB9CC \uC774 \uC0C1\uD488\uC744 \uC774\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
            "warning",
          );
          return true;
        }
      }

      if (canBypassSaleStatus || isStoreItemPurchasableByStudents(item)) {
        return false;
      }

      showFeedback(
        "이 상품은 지금 학생에게 보이기만 하고 구매는 막혀 있어요.",
        "warning",
      );
      return true;
    },
    [
      canManageStore,
      categoryMap,
      isFundMode,
      isTeacher,
      showFeedback,
      unlockedVipLoungeIds,
      userData,
    ],
  );

  const handleOpenBuyItemModal = useCallback(
    (itemToBuy) => {
      if (blockStudentPurchaseAction(itemToBuy)) return;
      setBuyItemModalInfo({ isOpen: true, itemId: itemToBuy.id });
    },
    [blockStudentPurchaseAction],
  );

  const handleCloseBuyItemModal = useCallback(() => {
    setBuyItemModalInfo({ isOpen: false, itemId: null });
  }, []);

  const handleExecutePurchase = useCallback(
    async (item, quantity) => {
      if (blockStudentPurchaseAction(item)) return false;
      setIsSubmittingPurchase(true);
      try {
        const result = await purchases.buyItem(item.id, quantity);
        showFeedback(
          buildPurchaseResultMessage(result, pageCurrencyUnit, missionTokenLabel),
          result.success ? "success" : "error",
          result.success ? { autoClose: 12000 } : {},
        );

        return Boolean(result.success);
      } catch (error) {
        showFeedback(error?.code === "store/retry-storage" ? error.message : "구매 처리 중 오류가 발생했습니다.", "error");
        return false;
      } finally {
        setIsSubmittingPurchase(false);
      }
    },
    [
      blockStudentPurchaseAction,
      purchases,
      pageCurrencyUnit,
      missionTokenLabel,
      showFeedback,
    ],
  );

  const handleOpenAddToCartModal = useCallback(
    (item) => {
      if (blockStudentPurchaseAction(item)) return;
      setAddToCartModalInfo({ isOpen: true, itemId: item.id });
    },
    [blockStudentPurchaseAction],
  );

  const handleConfirmAddToCart = async (item, quantity) => {
    if (blockStudentPurchaseAction(item)) return;
    try {
      await addToCart(item, quantity);
      showFeedback(
        `"${item.name}" ${quantity}개를 장바구니에 담았습니다.`,
        "success",
      );
      setAddToCartModalInfo({ isOpen: false, itemId: null });
    } catch (error) {
      showFeedback("장바구니에 담는 중 오류가 발생했습니다.", "error");
    }
  };

  const handleUpdateCartQty = async (itemId, newQty) => {
    try {
      await updateQty(itemId, newQty);
    } catch (error) {
      showFeedback("수량 변경에 실패했습니다.", "error");
    }
  };

  const handleRemoveFromCart = async (itemId) => {
    try {
      await removeItem(itemId);
    } catch (error) {
      showFeedback("장바구니 항목 삭제에 실패했습니다.", "error");
    }
  };

  const handleExecuteCartPurchase = async () => {
    if (cartItems.length === 0) return;
    const blockedCartItem = resolvedCartItems.find((item) =>
      blockStudentPurchaseAction(item),
    );
    if (blockedCartItem) return;

    setIsSubmittingPurchase(true);
    try {
      const formattedItems = cartItems.map((item) => ({
        itemId: item.id,
        quantity: item.quantity,
      }));

      const result = await purchases.buyCart(formattedItems);
      showFeedback(
        buildPurchaseResultMessage(result, pageCurrencyUnit, missionTokenLabel),
        result.success ? "success" : "error",
        result.success ? { autoClose: 12000 } : {},
      );

      if (result.success) {
        await clearCart();
        setShowCartModal(false);
      }
    } catch (error) {
      showFeedback(error?.code === "store/retry-storage" ? error.message : "결제 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSubmittingPurchase(false);
    }
  };

  const handleExecutePosPurchase = async (
    targetStudentUid,
    posCartItems,
    options = {},
  ) => {
    const {
      isImmediate = true,
      transactionType = "purchase",
      recordAsTaxExpense = false,
      classFundId = "",
    } = options;

    setIsSubmittingPurchase(true);
    try {
      const formattedItems = posCartItems.map((item) => ({
        itemId: item.id,
        quantity: item.quantity,
      }));

      const result = await purchases.buyPos(
        targetStudentUid,
        formattedItems,
        {
          isImmediate,
          transactionType,
          recordAsTaxExpense,
          classFundId,
        },
      );

      showFeedback(result.message, result.success ? "success" : "error");
      return !!result.success;
    } catch (error) {
      showFeedback(error?.code === "store/retry-storage" ? error.message : "POS 결제 중 오류가 발생했습니다.", "error");
      return false;
    } finally {
      setIsSubmittingPurchase(false);
    }
  };

  const handleOpenAddCategoryModal = () => {
    if (!canManageStore) return;
    setCategoryToEdit(null);
    setShowAddCategoryModal(true);
  };

  const handleOpenVipLoungeModal = (lounge = null) => {
    if (!canManageVipLounge) return;
    setVipLoungeToEdit(lounge || null);
    setShowVipLoungeModal(true);
  };

  const handleEditCategory = (category) => {
    if (!canManageStore) return;
    if (isVipLoungeCategory(category)) {
      handleOpenVipLoungeModal(category);
      return;
    }
    setCategoryToEdit(category);
    setShowAddCategoryModal(true);
  };

  const handleDeleteCategory = async (category) => {
    if (!canManageStore) return;
    if (isVipLoungeCategory(category) && !canManageVipLounge) {
      showFeedback("VIP 라운지는 교사만 삭제할 수 있습니다.", "warning");
      return;
    }

    try {
      const itemsSnap = await getDocs(
        collection(db, "classes", classId, "storeItems"),
      );
      const hasItems = itemsSnap.docs.some(
        (itemDoc) => itemDoc.data().categoryId === category.id,
      );

      if (hasItems) {
        showFeedback(
          "이 카테고리에 상품이 남아 있어 삭제할 수 없습니다.",
          "warning",
        );
        return;
      }

      if (categories.length <= 1) {
        showFeedback("카테고리는 최소 1개 이상 필요합니다.", "warning");
        return;
      }

      if (!(await appConfirm(`"${category.name}" 카테고리를 삭제할까요?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) {
        return;
      }

      await deleteDoc(
        doc(db, "classes", classId, "storeCategories", category.id),
      );

      if (selectedCategoryId === category.id) {
        setSelectedCategoryId(categories.find((c) => c.id !== category.id)?.id);
      }

      showFeedback("카테고리를 삭제했습니다.", "success");
    } catch (error) {
      showFeedback("카테고리 삭제 중 오류가 발생했습니다.", "error");
    }
  };

  const handleReorderCategories = async (reordered) => {
    if (!canManageStore) return;

    try {
      const batch = writeBatch(db);
      reordered.forEach((category, index) => {
        batch.update(
          doc(db, "classes", classId, "storeCategories", category.id),
          {
            order: index,
          },
        );
      });
      await batch.commit();
      showFeedback("카테고리 순서를 저장했습니다.", "success");
    } catch (error) {
      showFeedback("카테고리 순서 변경 중 오류가 발생했습니다.", "error");
    }
  };

  const handleReorderItems = async (reordered) => {
    if (
      !canManageStore || !classId || !selectedCategoryId ||
      selectedCategoryId === STORE_SPECIAL_CATEGORY_ID ||
      (selectedCategoryIsVip && !canManageVipLounge)
    ) return false;

    try {
      const batch = writeBatch(db);
      reordered.forEach((item, index) => {
        batch.update(doc(db, "classes", classId, "storeItems", item.id), {
          displayOrder: index,
        });
      });
      await batch.commit();
      showFeedback("상품 순서를 저장했습니다.", "success");
      return true;
    } catch (error) {
      showFeedback("상품 순서 변경 중 오류가 발생했습니다.", "error");
      return false;
    }
  };

  const handleOpenAddItemModal = () => {
    if (!canManageStore) return;
    if (selectedCategoryIsVip && !canManageVipLounge) {
      showFeedback("VIP 라운지 상품은 교사만 관리할 수 있습니다.", "warning");
      return;
    }
    setItemToEdit(null);
    setShowAddItemModal(true);
  };

  const handleOpenAddRandomBoxModal = () => {
    if (!canManageStore) return;
    if (selectedCategoryIsVip && !canManageVipLounge) {
      showFeedback("VIP 라운지 상품은 교사만 관리할 수 있습니다.", "warning");
      return;
    }
    setRandomBoxToEdit(null);
    setShowAddRandomBoxModal(true);
  };

  const handleEditItem = async (item) => {
    if (!canManageStore) return;
    if (isVipStoreItem(item, categoryMap) && !canManageVipLounge) {
      showFeedback("VIP 라운지 상품은 교사만 관리할 수 있습니다.", "warning");
      return;
    }
    if (isRandomBoxItem(item)) {
      try {
        const itemSnapshot = await getDoc(
          doc(db, "classes", classId, "storeItems", item.id),
        );
        const fullItem = itemSnapshot.exists()
          ? { id: itemSnapshot.id, ...itemSnapshot.data() }
          : item;
        setRandomBoxToEdit(fullItem);
        setShowAddRandomBoxModal(true);
      } catch (error) {
        console.error("Random box item load error:", error);
        showFeedback("랜덤박스 정보를 불러오지 못했습니다.", "error");
      }
      return;
    }
    setItemToEdit(item);
    setShowAddItemModal(true);
  };

  const handleDeleteItem = async (item) => {
    if (!canManageStore) return;
    if (isVipStoreItem(item, categoryMap) && !canManageVipLounge) {
      showFeedback("VIP 라운지 상품은 교사만 관리할 수 있습니다.", "warning");
      return;
    }

    if (!(await appConfirm(`"${item.name}" 상품을 삭제할까요?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) {
      return;
    }

    try {
      await deleteDoc(doc(db, "classes", classId, "storeItems", item.id));
      showFeedback("상품을 삭제했습니다.", "success");
    } catch (error) {
      showFeedback("상품 삭제 중 오류가 발생했습니다.", "error");
    }
  };

  const storeQuestGuide = useMemo(() => {
    const realCategories = categories.filter(
      (category) => !category?.isVirtual,
    );
    const pricedItems = allItems.filter((item) => Number(item?.price || 0) > 0);
    const sellableItems = allItems.filter((item) =>
      isStoreItemPurchasableByStudents(item),
    );
    const hasStoreItems = allItems.length > 0;
    const hasPurchaseLimit = allItems.some(
      (item) =>
        Number(item?.dailyLimit || 0) > 0 ||
        Number(item?.weeklyLimit || 0) > 0 ||
        Number(item?.totalLimit || 0) > 0,
    );
    const hasStockSetting = allItems.some((item) => {
      if (item?.stock === undefined || item?.stock === null) return false;
      return Number(item.stock) >= 0;
    });
    const hasDescription = allItems.some((item) =>
      String(item?.description || "").trim(),
    );
    const hasRandomBox = allItems.some((item) => isRandomBoxItem(item));
    const hasTimeSale = allItems.some(
      (item) => item?.timeSale || item?.timeSaleActive,
    );
    const hasVipLounge = categories.some((category) =>
      isVipLoungeCategory(category),
    );
    const hasMissionTokenItem = allItems.some(
      (item) =>
        normalizeStoreCurrencyType(item?.currencyType) === "missionToken",
    );
    const hasCustomTaxItem = allItems.some(
      (item) =>
        item?.customTaxRate !== undefined && item?.customTaxRate !== null,
    );

    return {
      type: "quest",
      title: "상점 도우미",
      subtitle: "초반 상점 운영에 필요한 목표를 결과 기준으로 확인합니다.",
      storageKey: classId
        ? `finclass_store_quest_${classId}`
        : "finclass_store_quest",
      tourKey: "TEACHER_STORE_QUEST_TOUR",
      guidePath: "/case-library",
      insights: [
        {
          id: "baseline-weekly-salary",
          label: "기준 주급",
          value: storePriceGuidance.baselineWeeklySalary
            ? `${formatClassCurrency(storePriceGuidance.baselineWeeklySalary)} ${pageCurrencyUnit}`
            : "없음",
          description: "직업 배정 현황으로 계산한 대표 주급",
          tone: "slate",
        },
        {
          id: "low-items",
          label: "저가",
          value: `${storePriceGuidance.counts.low || 0}개`,
          description: "1주 이내",
          tone: "emerald",
        },
        {
          id: "mid-items",
          label: "중가",
          value: `${storePriceGuidance.counts.mid || 0}개`,
          description: "2~3주",
          tone: "sky",
        },
        {
          id: "target-items",
          label: "목표",
          value: `${storePriceGuidance.counts.target || 0}개`,
          description: "4주 이상",
          tone: "violet",
        },
      ],
      recommendations: storePriceGuidance.recommendations,
      quests: [
        {
          id: "create-category",
          title: "첫 판매대 만들기",
          description: "상품을 담을 카테고리를 하나 이상 만듭니다.",
          doneText: `${realCategories.length}개의 판매대가 있습니다.`,
          completed: realCategories.length >= 1,
          manualComplete: false,
          objectives: [
            {
              id: "category-count",
              label: "카테고리 1개 이상 만들기",
              completed: realCategories.length >= 1,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-categories"]',
              title: "판매대 영역",
              content:
                "카테고리는 상품을 담는 판매대입니다. 여기에서 추가하고 고를 수 있습니다.",
            },
          ],
        },
        {
          id: "create-first-item",
          title: "첫 상품 올리기",
          description: "학생이 살 수 있는 상품을 하나 등록합니다.",
          doneText: `${allItems.length}개의 상품이 등록되어 있습니다.`,
          completed: hasStoreItems,
          manualComplete: false,
          objectives: [
            {
              id: "item-count",
              label: "상품 1개 이상 등록하기",
              completed: hasStoreItems,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-settings-menu"]',
              title: "상품 추가 위치",
              content: "상점 설정을 누르면 상품 추가 메뉴가 열립니다.",
              waitForTarget: '[data-tour="store-add-item-action"]',
              waitTimeoutMs: 15000,
            },
            {
              target: '[data-tour="store-add-item-action"]',
              title: "상품 추가",
              content: "상품 추가를 누르면 새 상품을 등록하는 창이 열립니다.",
              waitForTarget: '[data-tour="store-item-form"]',
              waitTimeoutMs: 15000,
            },
            {
              target: '[data-tour="store-item-name-input"]',
              title: "상품 이름",
              content:
                "예시로 '자리 바꾸기 쿠폰'이라고 입력해보세요. 정확히 입력하면 다음 안내로 넘어갑니다.",
              advanceOn: {
                equals: "자리 바꾸기 쿠폰",
                delayMs: 700,
              },
            },
            {
              target: '[data-tour="store-item-price-input"]',
              title: "판매 가격",
              content:
                "예시로 300을 입력해보세요. 나중에 주급에 맞춰 조정하면 됩니다.",
              advanceOn: {
                equals: "300",
                delayMs: 700,
              },
            },
            {
              target: '[data-tour="store-item-sale-status"]',
              title: "판매 상태",
              content:
                "처음에는 학생이 구매할 수 있는 판매중 상태인지 확인합니다.",
            },
            {
              target: '[data-tour="store-item-submit"]',
              title: "상품 등록",
              content: "필수 정보를 입력한 뒤 새 상품을 등록합니다.",
            },
            {
              target: '[data-tour="store-items-preview"]',
              title: "상품 목록",
              content: "저장한 상품은 이 목록에 카드로 표시됩니다.",
            },
          ],
        },
        {
          id: "make-sellable-item",
          title: "판매 가능한 상품 만들기",
          description:
            "학생 화면에서 실제로 구매 가능한 상품이 있는지 확인합니다.",
          doneText: `${sellableItems.length}개의 판매 가능 상품이 있습니다.`,
          completed: sellableItems.length >= 1,
          manualComplete: false,
          objectives: [
            {
              id: "sellable-item",
              label: "판매 가능 상품 1개 이상 만들기",
              completed: sellableItems.length >= 1,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-items-preview"]',
              title: "판매 상태 확인",
              content:
                "상품 카드에서 학생에게 보이는 판매 상태와 구매 가능 여부를 확인합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "fill-basic-items",
          title: "기본 상품 3개 채우기",
          description:
            "학생들이 선택할 수 있도록 상품을 최소 3개까지 늘려봅니다.",
          doneText: `${allItems.length}개의 상품이 준비되어 있습니다.`,
          completed: allItems.length >= 3,
          manualComplete: false,
          objectives: [
            {
              id: "three-items",
              label: "상품 3개 이상 등록하기",
              completed: allItems.length >= 3,
            },
            {
              id: "priced-items",
              label: "가격이 있는 상품 3개 이상 만들기",
              completed: pricedItems.length >= 3,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-settings-menu"]',
              title: "상품 추가 반복",
              content:
                "상품 추가를 반복해 기본 상품을 채웁니다. 처음에는 이름과 가격만 단순하게 잡아도 됩니다.",
            },
          ],
        },
        {
          id: "purchase-limit",
          title: "구매 제한 정하기",
          description:
            "상품별 일일, 주간, 전체 구매 제한을 사용할 수 있습니다.",
          completed: hasPurchaseLimit,
          manualComplete: false,
          objectives: [
            {
              id: "limit-set",
              label: "구매 제한이 걸린 상품 만들기",
              completed: hasPurchaseLimit,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-settings-menu"]',
              title: "상품 수정에서 설정",
              content:
                "상품을 추가하거나 수정할 때 구매 제한을 정할 수 있습니다.",
            },
          ],
        },
        {
          id: "stock-setting",
          title: "재고 설정하기",
          description: "필요한 상품에는 재고를 넣어 품절을 만들 수 있습니다.",
          completed: hasStockSetting,
          manualComplete: false,
          objectives: [
            {
              id: "stock-set",
              label: "재고 수량이 있는 상품 만들기",
              completed: hasStockSetting,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-settings-menu"]',
              title: "상품 재고",
              content: "상품 추가 또는 수정 화면에서 초기 재고를 입력합니다.",
            },
          ],
        },
        {
          id: "item-description",
          title: "상품 설명 넣기",
          description: "권한형 상품은 설명을 써두면 학생이 더 쉽게 이해합니다.",
          completed: hasDescription,
          manualComplete: false,
          objectives: [
            {
              id: "description-set",
              label: "설명이 있는 상품 만들기",
              completed: hasDescription,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-settings-menu"]',
              title: "상품 설명",
              content: "상품 추가 화면에서 상품 설명을 입력할 수 있습니다.",
            },
          ],
        },
        {
          id: "custom-tax",
          title: "상품별 세금 설정하기",
          description: "일부 상품만 다른 세율로 운영할 수 있습니다.",
          completed: hasCustomTaxItem,
          manualComplete: false,
          objectives: [
            {
              id: "tax-item",
              label: "개별 세율 상품 만들기",
              completed: hasCustomTaxItem,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-settings-menu"]',
              title: "세금 설정",
              content:
                "상품 추가 또는 수정 화면에서 기본 세율을 따르거나 개별 세율을 정할 수 있습니다.",
            },
          ],
        },
        {
          id: "random-box",
          title: "랜덤박스 만들기",
          description:
            "기본 상점이 익숙해지면 랜덤 보상 상품을 열 수 있습니다.",
          completed: hasRandomBox,
          manualComplete: false,
          objectives: [
            {
              id: "random-box-item",
              label: "랜덤박스 상품 1개 만들기",
              completed: hasRandomBox,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-settings-menu"]',
              title: "랜덤박스 추가",
              content: "상점 설정을 누른 뒤 랜덤박스 추가를 선택합니다.",
            },
          ],
        },
        {
          id: "time-sale",
          title: "타임세일 열기",
          description: "기간을 정해 할인 이벤트를 운영할 수 있습니다.",
          completed: hasTimeSale,
          manualComplete: false,
          objectives: [
            {
              id: "time-sale-item",
              label: "타임세일이 설정된 상품 만들기",
              completed: hasTimeSale,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-settings-menu"]',
              title: "타임세일 설정",
              content:
                "상품 추가 또는 수정 화면에서 타임세일을 켤 수 있습니다.",
            },
          ],
        },
        {
          id: "vip-lounge",
          title: "VIP 라운지 만들기",
          description:
            "특정 학생만 이용할 수 있는 전용 상점을 만들 수 있습니다.",
          completed: hasVipLounge,
          manualComplete: false,
          objectives: [
            {
              id: "vip-category",
              label: "VIP 라운지 카테고리 만들기",
              completed: hasVipLounge,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-categories"]',
              title: "VIP 라운지",
              content:
                "교사 권한에서는 카테고리 영역에서 VIP 라운지를 추가할 수 있습니다.",
            },
          ],
        },
        {
          id: "mission-token-item",
          title: "과제 화폐 상품 만들기",
          description:
            "일반 화폐가 아닌 과제 화폐로 살 수 있는 상품을 둘 수 있습니다.",
          completed: hasMissionTokenItem,
          manualComplete: false,
          objectives: [
            {
              id: "mission-token",
              label: "과제 화폐 결제 상품 만들기",
              completed: hasMissionTokenItem,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-settings-menu"]',
              title: "결제 화폐 선택",
              content:
                "상품 추가 화면에서 기본 화폐 또는 과제 화폐를 선택합니다.",
            },
          ],
        },
        {
          id: "store-analytics",
          title: "상점 통계 보기",
          description: "판매 흐름을 보고 다음 상품 조정을 생각할 수 있습니다.",
          completed: isAnalyticsView,
          manualComplete: false,
          objectives: [
            {
              id: "analytics-open",
              label: "상점 통계 화면 열기",
              completed: isAnalyticsView,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="store-analytics-button"]',
              title: "상점 통계",
              content:
                "상점 통계에서 기간별 구매 흐름과 상품별 판매 현황을 확인합니다.",
            },
          ],
        },
      ],
    };
  }, [
    allItems,
    categories,
    classId,
    formatClassCurrency,
    isAnalyticsView,
    pageCurrencyUnit,
    storePriceGuidance,
  ]);

  const hasStoreSeedData = categories.length > 0 || allItems.length > 0;
  const isInitialLoading =
    (userContextLoading || isLoadingStore) && !hasStoreSeedData;
  const isStoreRefreshing =
    !isInitialLoading && (isLoadingStore || isLoadingItems) && hasStoreSeedData;
  const shouldShowItemListLoading = isLoadingItems && allItems.length === 0;

  if (isInitialLoading) {
    return (
      <AppLayout showDefaultHeader={false} showSidebar={true}>
        <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
          <StorePageSkeleton />
        </div>
      </AppLayout>
    );
  }

  if (false && (userContextLoading || isLoadingStore)) {
    return (
      <AppLayout title="상점 로딩 중">
        <PageLoader
          fullHeight={false}
          className="min-h-screen"
          tone="emerald"
          message="상점 데이터를 불러오는 중입니다..."
        />
      </AppLayout>
    );
  }

  if (!classId) {
    return (
      <AppLayout title="상점">
        <div className="p-8">
          <Alert
            type="warning"
            message="학급 정보가 없어 상점을 표시할 수 없습니다."
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      showDefaultHeader={false}
      showSidebar={true}
      pageGuide={canManageStore ? storeQuestGuide : null}
    >
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <PageHeader
          title="상점"
          subtitle="학급 상품과 구매 내역을 확인하고 관리합니다."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={isConsumptionTaxEnabled ? "blue" : "slate"}
                variant="soft"
                size="sm"
                className="gap-1.5"
              >
                <Percent className="h-3.5 w-3.5" />
                {isConsumptionTaxEnabled
                  ? `소비세 ${currentTaxRate}%`
                  : "소비세 사용 안 함"}
              </Badge>

              {canUseStorePos ? (
                <>
                  <Button
                    size="sm"
                    kind="solid"
                    tone="blue"
                    icon={ShoppingCart}
                    onClick={() => setShowPosModal(true)}
                    disabled={isFundMode && !storePurchaseAccess.allowed}
                    title={isFundMode && !storePurchaseAccess.allowed ? storePurchaseAccess.reason : undefined}
                    data-tour="store-pos-button"
                    
                  >
                    POS 사용
                  </Button>
                </>
              ) : null}

              {canViewStoreAnalytics ? (
                <>
                  <Button
                    size="sm"
                    kind={isAnalyticsView ? "solid" : "outline"}
                    tone={isAnalyticsView ? "blue" : "slate"}
                    icon={TrendingUp}
                    onClick={handleOpenAnalyticsView}
                    data-tour="store-analytics-button"
                  >
                    상점 통계
                  </Button>
                </>
              ) : null}

                  {canManageStore ? (<>
<Button
                    size="sm"
                    kind="outline"
                    tone="slate"
                    icon={History}
                    onClick={() => setShowPendingModal(true)}
                    data-tour="store-management-button"
                  >
                    상점 관리
                  </Button>

                  <Menu as="div" className="relative">
                    <Menu.Button
                      as={Button}
                      size="sm"
                      kind="outline"
                      tone="slate"
                      data-tour="store-settings-menu"
                      className="gap-1.5"
                    >
                      <Settings className="h-4 w-4" /> 상점 설정
                      <ChevronDown className="h-4 w-4" />
                    </Menu.Button>

                    <Transition
                      enter="transition duration-100 ease-out"
                      enterFrom="transform scale-95 opacity-0"
                      enterTo="transform scale-100 opacity-100"
                      leave="transition duration-75 ease-out"
                      leaveFrom="transform scale-100 opacity-100"
                      leaveTo="transform scale-95 opacity-0"
                    >
                      <Menu.Items className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5">
                        <Menu.Item>
                          {({ active }) => (
                            <Button
                              type="button"
                              onClick={() => setShowTaxSettingsModal(true)}
                              tone="slate"
                              kind="ghost"
                              size="sm"
                              rounded="md"
                              className={`flex w-full items-center gap-2  ${
                                active ? "bg-slate-50" : ""
                              }`}
                            >
                              <Percent size={14} /> 소비세 설정
                            </Button>
                          )}
                        </Menu.Item>
                        <Menu.Item>
                          {({ active }) => (
                            <Button
                              type="button"
                              onClick={handleOpenAddItemModal}
                              tone="slate"
                              kind="ghost"
                              size="sm"
                              rounded="md"
                              data-tour="store-add-item-action"
                              data-tutorial-interactive="true"
                              className={`flex w-full items-center gap-2  ${
                                active ? "bg-slate-50" : ""
                              }`}
                            >
                              <Plus size={14} /> 상품 추가
                            </Button>
                          )}
                        </Menu.Item>
                        <Menu.Item>
                          {({ active }) => (
                            <Button
                              type="button"
                              onClick={handleOpenAddRandomBoxModal}
                              tone="slate"
                              kind="ghost"
                              size="sm"
                              rounded="md"
                              className={`flex w-full items-center gap-2  ${
                                active ? "bg-slate-50" : ""
                              }`}
                            >
                              <Plus size={14} /> 랜덤박스 추가
                            </Button>
                          )}
                        </Menu.Item>
                      </Menu.Items>
                    </Transition>
                  </Menu>
                </>
              ) : null}
            </div>
          }
        />

        {isFundMode && !storePurchaseAccess.allowed ? (
          <Alert type="warning" message={storePurchaseAccess.reason} />
        ) : null}

        <SurfaceLoader
          loading={isStoreRefreshing}
          variant="refreshing"
          message="상점 정보를 업데이트하는 중입니다..."
        >
          {isAnalyticsView ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
                <div>
                  <h2 className="text-lg font-black text-slate-900">
                    상점 통계
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    기간별 구매 흐름과 상품별 판매 현황을 확인합니다.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  kind="outline"
                  tone="slate"
                  icon={ArrowLeft}
                  onClick={handleCloseAnalyticsView}
                >
                  상점으로
                </Button>
              </div>

              <StoreAnalyticsPanel
                isOpen={isAnalyticsView}
                classId={classId}
                items={displayAllItems}
                currencyUnit={pageCurrencyUnit}
                totalStudentCount={analyticsStudentCount}
              />
            </div>
          ) : (
            <>
              <div data-tour="store-categories">
                <StoreToolbar
                  activeTab="shop"
                  selectedCategoryId={selectedCategoryId}
                  categories={storeCategories}
                  onCategoryChange={handleCategoryChange}
                  onOpenAddCategoryModal={handleOpenAddCategoryModal}
                  onOpenAddVipLoungeModal={handleOpenVipLoungeModal}
                  onEditCategory={handleEditCategory}
                  onDeleteCategory={handleDeleteCategory}
                  onReorderCategories={handleReorderCategories}
                  canManageStore={canManageStore}
                  canManageVipLounge={canManageVipLounge}
                />
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2 px-1">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <AssetBalanceBar
                    variant="inline"
                    items={[
                      {
                        key: "cash",
                        icon: Wallet,
                        tone: "indigo",
                        value: `${formatClassCurrency(studentCashBalance)} ${pageCurrencyUnit}`,
                        ariaLabel: `보유 현금 ${formatClassCurrency(studentCashBalance)} ${pageCurrencyUnit}`,
                      },
                      {
                        key: "mission-token",
                        icon: Coins,
                        tone: "amber",
                        value: `${formatClassCurrency(studentMissionTokenBalance)} ${missionTokenLabel}`,
                        ariaLabel: `보유 ${missionTokenLabel} ${formatClassCurrency(studentMissionTokenBalance)}`,
                        visible: studentMissionTokenBalance > 0,
                      },
                      {
                        key: "usdBalance",
                        icon: Coins,
                        tone: "blue",
                        value: `${formatClassCurrency(studentForeignBalance)} FIN`,
                        ariaLabel: `보유 외화 ${formatClassCurrency(studentForeignBalance)} FIN`,
                        visible: studentForeignBalance > 0 || allItems.some((item) => item.currencyType === "usdBalance"),
                      },
                    ]}
                  />
                  <div
                    data-tour="store-actions"
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Button
                      size="sm"
                      kind={cartItems.length > 0 ? "solid" : "outline"}
                      tone="blue"
                      icon={ShoppingCart}
                      onClick={() => setShowCartModal(true)}
                      className="relative"
                    >
                      {"\uC7A5\uBC14\uAD6C\uB2C8"}
                      {cartItems.length > 0 ? (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 animate-bounce items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-white">
                          {cartItems.length}
                        </span>
                      ) : null}
                    </Button>

                    <Button
                      size="sm"
                      kind="outline"
                      tone="blue"
                      icon={Package}
                      onClick={() => setShowMyItemsModal(true)}
                    >
                      {"\uB0B4 \uAC00\uBC29"}
                    </Button>
                  </div>
                </div>


              </div>

              <div className="relative space-y-6">
                <div
                  data-tour="store-items-preview"
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]"
                />
                {selectedCategoryIsVip && !isVipLoungeUnlocked ? (
                  <VipLoungeGate
                    lounge={selectedCategory}
                    userData={userData}
                    isTeacher={isTeacher}
                    hasAccess={hasVipStudentAccess}
                    onEnter={() =>
                      setUnlockedVipLoungeIds((previous) => {
                        const next = new Set(previous);
                        if (selectedCategoryId) next.add(selectedCategoryId);
                        return next;
                      })
                    }
                    onBack={handleLeaveVipLounge}
                  />
                ) : selectedCategoryIsVip ? (
                  <section className="fixed inset-0 z-[90] overflow-y-auto bg-[#090a0d] text-white">
                    <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(115deg,rgba(0,0,0,0.98),rgba(8,6,3,0.9)_42%,rgba(0,0,0,0.98)),radial-gradient(ellipse_at_top_right,rgba(217,158,61,0.34),transparent_36%),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:auto,auto,72px_72px]" />
                    <div className="pointer-events-none fixed inset-x-0 top-0 h-28 bg-gradient-to-b from-amber-100/10 to-transparent" />
                    <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5 md:pl-[calc(5rem+1.25rem)] md:pr-8 lg:pl-[calc(5rem+2.5rem)] lg:pr-10">
                      <header className="flex items-center justify-between gap-3">
                        <Button
                          type="button"
                          onClick={handleLeaveVipLounge}
                          icon={ArrowLeft}
                          tone="slate"
                          kind="ghost"
                          size="sm"
                          rounded="full"
                          className="inline-flex items-center gap-2 rounded-xl border border-[#b89a56]/35 bg-[#15130f]/85 px-4 py-2 text-sm font-bold text-[#f7e5ad] shadow-lg shadow-black/30 backdrop-blur-md transition hover:border-[#f2d88f]/65 hover:bg-[#211d14]"
                        >
                          {"\uC0C1\uC810\uC73C\uB85C \uB3CC\uC544\uAC00\uAE30"}
                        </Button>
                        <span className="inline-flex items-center gap-2 rounded-xl border border-[#d8bc72]/35 bg-[#16130e]/85 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-[#f6dea0] shadow-lg shadow-black/25 backdrop-blur-md">
                          <Crown className="h-4 w-4" />
                          VIP Lounge
                        </span>
                      </header>

                      <main className="flex-1 py-10">
                        <div className="mb-7 overflow-hidden rounded-[1.5rem] border border-[#b89a56]/30 bg-[#111113]/90 shadow-[0_20px_54px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                          <div className="flex flex-wrap items-center justify-end gap-3 border-b border-[#b89a56]/20 px-5 py-4 sm:px-6">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <div className="flex items-center gap-2 h-10 rounded-xl px-3 text-sm font-bold text-[#fff5d5]">
                                <Wallet className="h-4 w-4 text-amber-100" />
                                <span className="text-slate-300">
                                  {"\uBCF4\uC720 \uAE08\uC561"}
                                </span>
                                <span className="text-white">
                                  {formatClassCurrency(studentCashBalance)}{" "}
                                  {pageCurrencyUnit}
                                </span>
                              </div>

                              <Button
                                size="sm"
                                kind={
                                  cartItems.length > 0 ? "solid" : "outline"
                                }
                                tone="amber"
                                icon={ShoppingCart}
                                onClick={() => setShowCartModal(true)}
                                className="relative rounded-xl border-[#f2d88f]/45 bg-[linear-gradient(135deg,#f3d889,#bd8e36)] text-[#191308] shadow-[0_8px_20px_rgba(178,128,35,0.22)] hover:brightness-110"
                              >
                                {"\uC7A5\uBC14\uAD6C\uB2C8"}
                                {cartItems.length > 0 ? (
                                  <span className="absolute -right-1 -top-1 flex h-4 w-4 animate-bounce items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-[#050505]">
                                    {cartItems.length}
                                  </span>
                                ) : null}
                              </Button>

                              <Button
                                size="sm"
                                kind="outline"
                                tone="slate"
                                icon={Package}
                                onClick={() => setShowMyItemsModal(true)}
                                className="h-10 border-0 bg-transparent px-3 text-[#f5e8bf] shadow-none hover:bg-[#24211a]"
                              >
                                {"\uB0B4 \uAC00\uBC29"}
                              </Button>

                              {studentMissionTokenBalance > 0 ? (
                                <div className="flex h-10 items-center gap-2 border-l border-[#b89a56]/25 px-3 text-sm font-bold text-[#f5d986]">
                                  <span>{missionTokenLabel}</span>
                                  <span className="text-[#fff2c5]">{formatClassCurrency(studentMissionTokenBalance)}</span>
                                </div>
                              ) : null}
                              {studentForeignBalance > 0 ? (
                                <div className="flex h-10 items-center gap-2 border-l border-[#b89a56]/25 px-3 text-sm font-bold text-[#f5d986]">
                                  <span>FIN</span>
                                  <span className="text-[#fff2c5]">{formatClassCurrency(studentForeignBalance)}</span>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-end gap-2 px-5 pt-4 sm:px-6">
                            <div className="flex items-end gap-2">
                              <Button
                                type="button"
                                onClick={() => setVipTab("info")}
                                icon={Crown}
                                tone="amber"
                                kind={vipTab === "info" ? "soft" : "ghost"}
                                size="sm"
                                rounded="full"
                                style={VIP_LOUNGE_TAB_STYLE}
                                className={`inline-flex items-center gap-2 rounded-t-2xl border px-6 py-3 font-serif text-base font-bold tracking-[0.01em] transition-all ${
                                  vipTab === "info"
                                    ? "border-[#eacb7d]/70 bg-[linear-gradient(135deg,#f3d889,#bd8e36)] text-[#191308] shadow-[0_-2px_16px_rgba(218,169,72,0.18)]"
                                    : "border-[#b89a56]/20 bg-[#151516]/80 text-slate-300 hover:border-[#d7b868]/45 hover:bg-[#26231b] hover:text-[#fae9b7]"
                                }`}
                              >
                                {"\uB77C\uC6B4\uC9C0 \uC18C\uAC1C"}
                              </Button>
                              <Button
                                type="button"
                                onClick={() => setVipTab("items")}
                                icon={Package}
                                tone="amber"
                                kind={vipTab === "items" ? "soft" : "ghost"}
                                size="sm"
                                rounded="full"
                                style={VIP_LOUNGE_TAB_STYLE}
                                className={`inline-flex items-center gap-2 rounded-t-2xl border px-6 py-3 font-serif text-base font-bold tracking-[0.01em] transition-all ${
                                  vipTab === "items"
                                    ? "border-[#eacb7d]/70 bg-[linear-gradient(135deg,#f3d889,#bd8e36)] text-[#191308] shadow-[0_-2px_16px_rgba(218,169,72,0.18)]"
                                    : "border-[#b89a56]/20 bg-[#151516]/80 text-slate-300 hover:border-[#d7b868]/45 hover:bg-[#26231b] hover:text-[#fae9b7]"
                                }`}
                              >
                                {"\uC804\uC6A9 \uC0C1\uD488"}
                              </Button>
                            </div>
                          </div>
                        </div>

                        {vipTab === "info" ? (
                          <VipLoungeIntro
                            lounge={selectedCategory}
                            onViewProducts={() => setVipTab("items")}
                          />
                        ) : (
                          <StoreItemList
                            key={selectedCategoryId}
                            items={visibleCategoryItems}
                            currencyUnit={pageCurrencyUnit}
                            classData={classData}
                            canManageStore={
                              canManageStore && canManageVipLounge
                            }
                            allowOrderEditing={
                              selectedCategoryId !==
                                STORE_SPECIAL_CATEGORY_ID && canManageVipLounge
                            }
                            emptyStateClassName="border-white/10 bg-white/[0.055] text-white"
                            emptyStateTextClassName="text-slate-300"
                            isVipLounge
                            purchaseDisabled={isFundMode}
                            onBuyItem={handleOpenBuyItemModal}
                            onAddToCart={handleOpenAddToCartModal}
                            onEditItem={handleEditItem}
                            onDeleteItem={handleDeleteItem}
                            onReorderItems={handleReorderItems}
                            isLoadingItems={shouldShowItemListLoading}
                            categoryName={
                              storeCategories.find(
                                (category) =>
                                  category.id === selectedCategoryId,
                              )?.name
                            }
                          />
                        )}
                      </main>
                    </div>
                  </section>
                ) : (
                  <div className="space-y-6">
                    <StoreItemList
                      key={selectedCategoryId}
                      items={visibleCategoryItems}
                      currencyUnit={pageCurrencyUnit}
                      classData={classData}
                      canManageStore={canManageStore}
                      allowOrderEditing={
                        selectedCategoryId !== STORE_SPECIAL_CATEGORY_ID
                      }
                      purchaseDisabled={isFundMode}
                      onBuyItem={handleOpenBuyItemModal}
                      onAddToCart={handleOpenAddToCartModal}
                      onEditItem={handleEditItem}
                      onDeleteItem={handleDeleteItem}
                      onReorderItems={handleReorderItems}
                      isLoadingItems={shouldShowItemListLoading}
                      categoryName={
                        storeCategories.find(
                          (category) => category.id === selectedCategoryId,
                        )?.name
                      }
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </SurfaceLoader>
      </div>

      <AddToCartModal
        isOpen={addToCartModalInfo.isOpen}
        onClose={() => setAddToCartModalInfo({ isOpen: false, itemId: null })}
        item={activeAddToCartItem}
        usageData={
          scopedUsageData[activeAddToCartItem?.id] || { daily: 0, weekly: 0 }
        }
        isUsageLoading={isAddToCartUsageLoading}
        currencyUnit={getItemCurrencyUnit(activeAddToCartItem)}
        onConfirm={handleConfirmAddToCart}
      />

      <StoreCartModal
        isOpen={showCartModal}
        onClose={() => setShowCartModal(false)}
        cartItems={resolvedCartItems}
        allUsageData={scopedUsageData}
        isUsageLoading={isCartUsageLoading}
        onUpdateQty={handleUpdateCartQty}
        onRemoveItem={handleRemoveFromCart}
        onCheckout={handleExecuteCartPurchase}
        isSubmitting={isSubmittingPurchase}
        classCurrencyUnit={pageCurrencyUnit}
        studentBalances={{
          cash: studentCashBalance,
          missionToken: studentMissionTokenBalance,
          usdBalance: studentForeignBalance,
        }}
      />

      <StorePosModal
        isOpen={isStorePosOpen}
        onClose={() => setShowPosModal(false)}
        classId={classId}
        students={processedStudentsList}
        items={displayPosItems}
        classFunds={ENABLE_CLASS_FUNDS_ROLLOUT && isFundMode ? classFunds : []}
        fundPaymentOnly={ENABLE_CLASS_FUNDS_ROLLOUT && isFundMode}
        fixedFundId={isFundMode ? activeFundId : ""}
        onExecutePurchase={handleExecutePosPurchase}
        isSubmitting={isSubmittingPurchase}
        currencyUnit={pageCurrencyUnit}
      />

      <BuyItemModal
        isOpen={buyItemModalInfo.isOpen}
        onClose={handleCloseBuyItemModal}
        itemToBuy={activeBuyItem}
        isVipLoungeItem={isVipStoreItem(activeBuyItem, categoryMap)}
        usageData={
          scopedUsageData[activeBuyItem?.id] || { daily: 0, weekly: 0 }
        }
        isUsageLoading={isBuyUsageLoading}
        currencyUnit={getItemCurrencyUnit(activeBuyItem)}
        studentClassCurrencyBalance={getStudentBalanceForItem(activeBuyItem)}
        onSubmitPurchase={handleExecutePurchase}
        isSubmitting={isSubmittingPurchase}
      />

      {showAddCategoryModal ? (
        <AddEditCategoryModal
          isOpen={showAddCategoryModal}
          onClose={() => setShowAddCategoryModal(false)}
          categoryToEdit={categoryToEdit}
          onCreated={setSelectedCategoryId}
        />
      ) : null}

      {showVipLoungeModal ? (
        <AddEditVipLoungeModal
          isOpen={showVipLoungeModal}
          onClose={() => {
            setShowVipLoungeModal(false);
            setVipLoungeToEdit(null);
          }}
          loungeToEdit={vipLoungeToEdit}
          onSaved={setSelectedCategoryId}
        />
      ) : null}

      {showAddItemModal ? (
        <AddEditStoreItemModal
          isOpen={showAddItemModal}
          onClose={() => setShowAddItemModal(false)}
          selectedCategoryId={selectedCategoryIdForItemModal}
          categories={manageableCategories}
          itemToEdit={itemToEdit}
          economyBaseline={economyBaseline}
        />
      ) : null}

      {showAddRandomBoxModal ? (
        <AddEditRandomBoxModal
          isOpen={showAddRandomBoxModal}
          onClose={() => {
            setShowAddRandomBoxModal(false);
            setRandomBoxToEdit(null);
          }}
          selectedCategoryId={selectedCategoryIdForItemModal}
          categories={manageableCategories}
          allItems={allItems}
          itemToEdit={randomBoxToEdit}
        />
      ) : null}

      {showTaxSettingsModal ? (
        <TaxSettingsModal
          isOpen={showTaxSettingsModal}
          onClose={() => setShowTaxSettingsModal(false)}
        />
      ) : null}

      {showMyItemsModal ? (
        <MyItemsModal
          isOpen={showMyItemsModal}
          onClose={() => setShowMyItemsModal(false)}
          giftPolicyMap={storeItemGiftPolicyMap}
          storeItems={allItems}
        />
      ) : null}

      {showPendingModal ? (
        <StorePendingRedemptionsModal
          isOpen={showPendingModal}
          onClose={() => setShowPendingModal(false)}
          items={displayAllItems}
          categories={categories}
        />
      ) : null}
    </AppLayout>
  );
};

export default Store;
