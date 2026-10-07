import { appConfirm } from "../../utils/appDialogs";
// src/pages/marketplace/Marketplace.jsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Coins,
  Filter,
  Gavel,
  History,
  PlusCircle,
  Settings2,
} from "lucide-react";
import { deleteDoc, doc } from "firebase/firestore";
import AppLayout from "../../components/layout/AppLayout";
import {
  Alert,
  AssetBalanceBar,
  Button,
  PageHeader,
  PageLoader,
  SurfaceLoader,
  Tabs,
} from "../../components/ui";
import { db } from "../../firebase";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useNotifications } from "../../contexts/NotificationContext";
import { useNumberFormat } from "../../contexts/NumberFormatContext";
import { useUser } from "../../contexts/UserContext";
import { PERMISSIONS } from "../../constants/permissions";
import AuctionTabSection from "./auction/components/AuctionTabSection";
import useAuctionPanelState from "./auction/hooks/useAuctionPanelState";
import ItemCard from "./components/ItemCard";
import ItemForm from "./components/ItemForm";
import MarketplaceCategoryBar from "./components/MarketplaceCategoryBar";
import MarketplaceFilter from "./components/MarketplaceFilter";
import { useCategories } from "./hooks/useCategories";
import { useMarketplace } from "./hooks/useMarketplace";
import useMarketplaceApprovalSettings from "./hooks/useMarketplaceApprovalSettings";
import useMarketplaceFeeSettings from "./hooks/useMarketplaceFeeSettings";
import { useMarketplaceFilters } from "./hooks/useMarketplaceFilters";
import CategoryManagerModal from "./modals/CategoryManagerModal";
import ItemDetailModal from "./modals/ItemDetailModal";
import MarketplaceApprovalModal from "./modals/MarketplaceApprovalModal";
import PersonalTransactionModal from "./modals/PersonalTransactionModal";
import RejectReasonModal from "./modals/RejectReasonModal";
import SellerFeeSettingsModal from "./modals/SellerFeeSettingsModal";
import TransactionHistoryModal from "./modals/TransactionHistoryModal";

const MARKETPLACE_TABS = [
  { id: "market", label: "중고거래" },
  { id: "auction", label: "경매장" },
];

const Marketplace = () => {
  const {
    classId,
    isTeacher,
    isAdmin,
    hasPermission,
    userData: contextUserData,
  } = useUser();
  const { showFeedback } = useFeedback();
  const { formatClassCurrency: formatNumber } = useNumberFormat();
  const formatWholeNumber = formatNumber;
  const [activeTab, setActiveTab] = useState("market");
  const [statusFilter, setStatusFilter] = useState("active");
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showFeeSettingsModal, setShowFeeSettingsModal] = useState(false);
  const isMarketplaceAdmin =
    hasPermission(PERMISSIONS.MARKETPLACE_ADMIN) || isTeacher;
  const approvalSettings = useMarketplaceApprovalSettings({
    classId,
    userData: contextUserData,
    isMarketplaceAdmin,
    showFeedback,
  });

  const {
    items,
    loading,
    pendingApprovalCount: marketPendingApprovalCount,
    pendingApprovalItems: marketPendingApprovalItems,
    isPendingApprovalListReady: isMarketPendingApprovalListReady,
    processingApprovalItemId,
    userData,
    classData,
    submitItem,
    updateItem,
    approveItem,
    purchaseItem,
    deleteItem,
    markSaleAlertsAsSeen,
  } = useMarketplace({
    enabled: activeTab === "market",
    pendingApprovalsEnabled: showApprovalModal,
    statusFilter,
    autoApproveEnabled: approvalSettings.autoApproveEnabled,
  });

  const { categories } = useCategories({
    enabled: activeTab === "market" || showCategoryModal,
  });
  const { badgeCounts } = useNotifications();
  const [lastSettledMarketItems, setLastSettledMarketItems] = useState([]);
  const [hasResolvedMarketOnce, setHasResolvedMarketOnce] = useState(false);

  const marketItems = loading
    ? items.length > 0
      ? items
      : lastSettledMarketItems
    : items;
  const { selectedCategory, setSelectedCategory, filteredItems } =
    useMarketplaceFilters(marketItems, userData, isMarketplaceAdmin);
  const canManageSellerFee = isMarketplaceAdmin;
  const canSettleAuction = isTeacher || isAdmin || userData?.role === "admin";
  const saleAlertCount = isMarketplaceAdmin
    ? 0
    : Number(badgeCounts?.marketplace || 0);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showTransactionHistory, setShowTransactionHistory] = useState(false);
  const [showPersonalHistory, setShowPersonalHistory] = useState(false);
  const [approvalActiveTab, setApprovalActiveTab] = useState("market");
  const [selectedItem, setSelectedItem] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [isManagementMenuOpen, setIsManagementMenuOpen] = useState(false);
  const managementMenuRef = useRef(null);

  const auction = useAuctionPanelState({
    classId,
    userData,
    isMarketplaceAdmin,
    canSettleAuction,
    showFeedback,
    enabled: activeTab === "auction",
    pendingApprovalsEnabled: showApprovalModal,
    settingsEnabled: activeTab === "auction" || showFeeSettingsModal,
  });

  const marketFee = useMarketplaceFeeSettings({
    classId,
    userData,
    isMarketplaceAdmin,
    showFeedback,
    enabled: activeTab === "market" || showFeeSettingsModal,
  });
  const totalPendingApprovalCount =
    Number(marketPendingApprovalCount || 0) +
    Number(auction.pendingApprovalCount || 0);
  const approvalActionCount = isMarketplaceAdmin
    ? Math.max(Number(badgeCounts?.marketplace || 0), totalPendingApprovalCount)
    : 0;

  const marketplaceTabs = useMemo(
    () =>
      MARKETPLACE_TABS.map((tab) => {
        if (!isMarketplaceAdmin) {
          if (tab.id === "market") {
            return {
              ...tab,
              badge: saleAlertCount > 0 ? saleAlertCount : null,
            };
          }

          return { ...tab, badge: null };
        }

        if (tab.id === "market") {
          return {
            ...tab,
            badge:
              marketPendingApprovalCount > 0
                ? marketPendingApprovalCount
                : null,
          };
        }

        if (tab.id === "auction") {
          return {
            ...tab,
            badge:
              auction.pendingApprovalCount > 0
                ? auction.pendingApprovalCount
                : null,
          };
        }

        return tab;
      }),
    [
      auction.pendingApprovalCount,
      isMarketplaceAdmin,
      marketPendingApprovalCount,
      saleAlertCount,
    ],
  );

  const currencyName = classData?.currencyUnit || "골드";
  const userBalance = Number(userData?.assets?.cash || 0);
  const itemCounts = useMemo(
    () => ({ [statusFilter]: filteredItems.length }),
    [filteredItems.length, statusFilter],
  );
  const finalFilteredItems = filteredItems;
  const isInitialMarketLoading =
    activeTab === "market" &&
    loading &&
    !hasResolvedMarketOnce &&
    lastSettledMarketItems.length === 0;

  useEffect(() => {
    setLastSettledMarketItems([]);
    setHasResolvedMarketOnce(false);
  }, [classId]);

  useEffect(() => {
    if (activeTab !== "market" || loading) {
      return;
    }

    setLastSettledMarketItems(items);
    setHasResolvedMarketOnce(true);
  }, [activeTab, items, loading]);

  useEffect(() => {
    if (
      activeTab !== "market" ||
      statusFilter !== "sold" ||
      saleAlertCount <= 0
    ) {
      return;
    }

    void markSaleAlertsAsSeen();
  }, [activeTab, markSaleAlertsAsSeen, saleAlertCount, statusFilter]);

  useEffect(() => {
    if (!isManagementMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!managementMenuRef.current?.contains(event.target)) {
        setIsManagementMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isManagementMenuOpen]);
  const handleOpenApprovalModal = (tab = "market") => {
    setApprovalActiveTab(tab);
    setShowApprovalModal(true);
  };

  const getEmptyStateMessage = () => {
    const messages = {
      active: "판매 중인 물건이 없습니다",
      sold: "판매 완료된 물건이 없습니다",
      pending: "승인 대기 중인 물건이 없습니다",
      rejected: "반려된 물건이 없습니다",
      all: "등록된 물건이 없습니다",
    };
    return messages[statusFilter] || messages.all;
  };

  const getEmptyStateDescription = () => {
    const selectedCategoryName =
      categories.find((category) => category.id === selectedCategory)?.name ||
      "전체";
    const categoryText =
      selectedCategoryName === "전체"
        ? ""
        : `'${selectedCategoryName}' 카테고리에서 `;

    const descriptions = {
      active: `${categoryText}현재 판매 중인 물건이 없습니다.`,
      sold: `${categoryText}아직 판매 완료된 물건이 없습니다.`,
      pending: `${categoryText}승인을 기다리는 물건이 없습니다.`,
      rejected: `${categoryText}반려된 물건이 없습니다.`,
      all:
        selectedCategoryName === "전체"
          ? "첫 번째 물건을 등록해 보세요."
          : `${categoryText}등록된 물건이 없습니다.`,
    };
    return descriptions[statusFilter] || descriptions.all;
  };

  const handleSubmitItem = async (itemData) => {
    const success = editingItem
      ? await updateItem(editingItem.id, itemData)
      : await submitItem(itemData);
    if (success) {
      setShowForm(false);
      setEditingItem(null);
    }
  };

  const handleOpenEditItem = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleOpenCreateItem = () => {
    setEditingItem(null);
    setShowForm(true);
  };

  const handleApproveItem = async (itemId) => {
    await approveItem(itemId, true);
  };

  const handleRejectItem = (item) => {
    setRejectTarget(item);
  };

  const handleSubmitReject = async (reason) => {
    if (!rejectTarget) return;
    await approveItem(rejectTarget.id, false, reason || "");
    setRejectTarget(null);
  };

  const handleDeleteItem = async (item) => {
    if (!(await appConfirm(`"${item.title}" 상품을 삭제하시겠습니까?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) {
      return;
    }

    try {
      const success = await deleteItem(item.id);
      if (success) {
        showFeedback("상품이 삭제되었습니다.", "success");
      }
    } catch (error) {
      console.error("상품 삭제 실패:", error);
      showFeedback("삭제 중 오류가 발생했습니다.", "error");
    }
  };

  const handleConfirmPurchase = async () => {
    if (!selectedItem) return;
    await purchaseItem(selectedItem);
    setSelectedItem(null);
  };

  const handleDeleteCategory = async (category) => {
    if (!classId) {
      showFeedback("학급 정보가 없습니다.", "error");
      return;
    }

    try {
      await deleteDoc(
        doc(db, "classes", classId, "marketplace_categories", category.id),
      );
      showFeedback(`'${category.name}' 카테고리가 삭제되었습니다.`, "success");

      if (selectedCategory === category.id && categories.length > 1) {
        const remainingCategories = categories.filter(
          (target) => target.id !== category.id,
        );
        if (remainingCategories.length > 0) {
          setSelectedCategory(remainingCategories[0].id);
        }
      }
    } catch (error) {
      console.error("카테고리 삭제 실패:", error);
      showFeedback("카테고리 삭제 중 오류가 발생했습니다.", "error");
    }
  };

  const marketplaceQuestGuide = useMemo(() => {
    const activeMarketItems = marketItems.filter(
      (item) => String(item?.status || "active") === "active",
    );
    const soldMarketItems = marketItems.filter(
      (item) => String(item?.status || "") === "sold",
    );
    const hasCategories = categories.length > 0;
    const hasAuctionItems =
      Array.isArray(auction.items) && auction.items.length > 0;
    const hasSellerFeePolicy =
      Number(marketFee?.sellerFeeRate || 0) > 0 ||
      Number(auction?.auctionFeeRate || 0) > 0;

    return {
      type: "quest",
      title: "마켓 도우미",
      launcherTitle: "마켓 도우미",
      launcherDescription: "중고거래, 경매, 승인, 수수료 흐름을 체크합니다.",
      subtitle: "학생들이 물건을 올리고 거래하는 시장 구조를 확인합니다.",
      storageKey: classId
        ? `finclass_marketplace_quest_${classId}`
        : "finclass_marketplace_quest",
      tourKey: "TEACHER_MARKETPLACE_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "market-tab",
          title: "중고거래 화면 확인하기",
          description: "중고거래와 경매 탭, 상단 거래 버튼 위치를 확인합니다.",
          completed: activeTab === "market",
          manualComplete: true,
          objectives: [
            {
              id: "market-open",
              label: "중고거래 탭 열기",
              completed: activeTab === "market",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="marketplace-tabs"]',
              title: "거래 탭",
              content: "중고거래와 경매 화면을 여기에서 전환합니다.",
            },
            {
              target: '[data-tour="marketplace-actions"]',
              title: "거래 행동",
              content: "물건 등록, 승인 관리, 거래 이력 버튼을 확인합니다.",
            },
          ],
        },
        {
          id: "category-flow",
          title: "카테고리 확인하기",
          description: "물건을 분류할 카테고리 구조를 확인합니다.",
          doneText: `${categories.length}개의 카테고리가 있습니다.`,
          completed: hasCategories,
          manualComplete: true,
          objectives: [
            {
              id: "categories-ready",
              label: "카테고리 목록 확인",
              completed: hasCategories,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="marketplace-content"]',
              title: "카테고리와 필터",
              content: "마켓 화면에서 카테고리와 판매 상태 필터를 확인합니다.",
            },
          ],
        },
        {
          id: "item-flow",
          title: "판매 물건 흐름 만들기",
          description:
            "학생이 물건을 등록하고 구매하는 기본 흐름을 확인합니다.",
          doneText: `${activeMarketItems.length}개의 판매 중 물건이 있습니다.`,
          completed: activeMarketItems.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "active-item",
              label: "판매 중 물건 1개 이상 확인",
              completed: activeMarketItems.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="marketplace-actions"]',
              title: "물건 등록",
              content: "상단 물건 등록 버튼으로 판매 글을 만들 수 있습니다.",
            },
            {
              target: '[data-tour="marketplace-content"]',
              title: "물건 목록",
              content: "물건 카드에서 상세 보기, 구매, 승인 상태를 확인합니다.",
            },
          ],
        },
        {
          id: "approval-flow",
          title: "승인 흐름 확인하기",
          description:
            "교사가 물건 등록이나 경매 출품을 승인하는 흐름을 확인합니다.",
          completed: showApprovalModal || approvalActionCount > 0,
          manualComplete: true,
          objectives: [
            {
              id: "approval-open",
              label: "승인 관리 열기",
              completed: showApprovalModal,
            },
            {
              id: "approval-count",
              label: "승인 대기 건수 확인",
              completed: approvalActionCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="marketplace-actions"]',
              title: "승인 관리",
              content: "상단 승인 관리에서 대기 중인 물건과 경매를 처리합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "auction-flow",
          title: "경매 흐름 살펴보기",
          description: "중고거래 외에 경매 방식으로 물건을 출품할 수 있습니다.",
          completed: activeTab === "auction" || hasAuctionItems,
          manualComplete: true,
          objectives: [
            {
              id: "auction-open",
              label: "경매 탭 열기",
              completed: activeTab === "auction",
            },
            {
              id: "auction-items",
              label: "경매 물건 확인",
              completed: hasAuctionItems,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="marketplace-tabs"]',
              title: "경매 탭",
              content: "경매 탭에서 입찰과 낙찰 흐름을 확인합니다.",
            },
            {
              target: '[data-tour="marketplace-content"]',
              title: "경매 목록",
              content: "진행 중인 경매와 입찰 상태를 확인합니다.",
            },
          ],
        },
        {
          id: "seller-fee",
          title: "판매 수수료 설정 보기",
          description:
            "판매자 수수료나 경매 수수료로 거래 비용을 만들 수 있습니다.",
          completed: showFeeSettingsModal || hasSellerFeePolicy,
          manualComplete: true,
          objectives: [
            {
              id: "fee-open",
              label: "판매 수수료 설정 열기",
              completed: showFeeSettingsModal,
            },
            {
              id: "fee-policy",
              label: "수수료 정책 확인",
              completed: hasSellerFeePolicy,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="marketplace-actions"]',
              title: "판매 수수료 설정",
              content: "상단 설정에서 판매 수수료를 조정합니다.",
            },
          ],
        },
        {
          id: "transaction-history",
          title: "거래 이력 확인하기",
          description: "거래가 끝난 물건과 전체 거래 기록을 확인합니다.",
          completed:
            showTransactionHistory ||
            showPersonalHistory ||
            soldMarketItems.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "history-open",
              label: "거래 이력 열기",
              completed: showTransactionHistory || showPersonalHistory,
            },
            {
              id: "sold-items",
              label: "판매 완료 물건 확인",
              completed: soldMarketItems.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="marketplace-actions"]',
              title: "거래 이력",
              content: "내 거래 이력과 전체 거래 이력 버튼을 확인합니다.",
            },
          ],
        },
      ],
    };
  }, [
    activeTab,
    approvalActionCount,
    auction.auctionFeeRate,
    auction.items,
    categories.length,
    classId,
    marketFee?.sellerFeeRate,
    marketItems,
    showApprovalModal,
    showFeeSettingsModal,
    showPersonalHistory,
    showTransactionHistory,
  ]);

  if (isInitialMarketLoading && Date.now() < 0) {
    return <PageLoader message="마켓플레이스 데이터를 불러오는 중입니다..." />;
  }

  if (isInitialMarketLoading) {
    return (
      <AppLayout showDefaultHeader={false} showSidebar={true}>
        <PageLoader
          fullHeight={false}
          className="min-h-screen"
          message="마켓플레이스 데이터를 불러오는 중입니다..."
        />
      </AppLayout>
    );
  }

  if (!classId) {
    return (
      <AppLayout title="학급 없음" showSidebar={true} showDefaultHeader={false}>
        <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
          <Alert
            type="warning"
            message="마켓플레이스를 이용하려면 학급을 선택해 주세요."
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      showDefaultHeader={false}
      showSidebar={true}
      pageGuide={marketplaceQuestGuide}
    >
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <PageHeader
          title="마켓플레이스"
          subtitle="중고거래와 경매 현황을 확인하고 관리합니다."
          actions={
            isMarketplaceAdmin ? (
              <div
                className="flex flex-wrap items-center justify-end gap-2"
                data-tour="marketplace-actions"
              >
                <Button
                  size="sm"
                  kind="outline"
                  tone="slate"
                  icon={CheckCircle2}
                  onClick={() => handleOpenApprovalModal(activeTab)}
                  className="relative"
                >
                  승인 관리
                  {approvalActionCount > 0 ? (
                    <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white">
                      {approvalActionCount > 99 ? "99+" : approvalActionCount}
                    </span>
                  ) : null}
                </Button>

                <div ref={managementMenuRef} className="relative">
                  <Button
                    size="sm"
                    kind="outline"
                    tone="slate"
                    icon={Settings2}
                    onClick={() =>
                      setIsManagementMenuOpen((current) => !current)
                    }
                    aria-expanded={isManagementMenuOpen}
                    aria-haspopup="menu"
                  >
                    관리자 메뉴
                    <ChevronDown
                      className={`ml-1 h-4 w-4 transition ${
                        isManagementMenuOpen ? "rotate-180" : ""
                      }`}
                    />
                  </Button>

                  {isManagementMenuOpen ? (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-200/60"
                    >
                      {canManageSellerFee ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setShowFeeSettingsModal(true);
                            setIsManagementMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
                        >
                          <Settings2 className="h-4 w-4" /> 판매·경매 설정
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowTransactionHistory(true);
                          setIsManagementMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                      >
                        <History className="h-4 w-4" /> 전체 거래 내역
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null
          }
        />

        <div className="border-b border-slate-200/70 pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div data-tour="marketplace-tabs" data-active-tab={activeTab} className="min-w-[280px] max-w-md flex-1">
              <Tabs tabs={marketplaceTabs} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" size="lg" fullWidth className="w-full" />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AssetBalanceBar variant="inline" items={[{ key: "cash", icon: Coins, tone: "indigo", value: `${formatNumber(userBalance)} ${currencyName}`, ariaLabel: `보유 현금 ${formatNumber(userBalance)} ${currencyName}` }]} />
              <div data-tour="marketplace-personal-actions" className="flex items-center gap-2">
                <Button size="sm" kind="outline" tone="slate" icon={History} onClick={() => setShowPersonalHistory(true)}>내 거래 내역</Button>
                <Button size="sm" kind="solid" tone="blue" icon={activeTab === "auction" ? Gavel : PlusCircle} onClick={activeTab === "auction" ? auction.handleOpenAuctionCreate : handleOpenCreateItem} disabled={activeTab === "auction" ? !auction.canCreateAuction : false}>
                  {activeTab === "auction" ? "경매 출품" : "물건 등록"}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="relative space-y-3">
          <div
            data-tour="marketplace-content"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]"
          />

          {activeTab === "market" ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <MarketplaceCategoryBar
                  categories={categories}
                  selectedCategoryId={selectedCategory}
                  onCategoryChange={setSelectedCategory}
                  onOpenAddCategoryModal={() => {
                    setEditingCategory(null);
                    setShowCategoryModal(true);
                  }}
                  onReorderCategories={() => {}}
                  onEditCategory={(category) => {
                    setEditingCategory(category);
                    setShowCategoryModal(true);
                  }}
                  onDeleteCategory={handleDeleteCategory}
                  className="mt-0 min-w-0 flex-1"
                />

                <div className="space-y-3 lg:w-[220px] lg:shrink-0">
                  <MarketplaceFilter
                    statusFilter={statusFilter}
                    onFilterChange={setStatusFilter}
                    itemCounts={itemCounts}
                    isMarketplaceAdmin={isMarketplaceAdmin}
                    pendingBadgeCount={marketPendingApprovalCount}
                  />
                </div>
              </div>

              <div className="min-w-0">
                <SurfaceLoader
                  loading={activeTab === "market" && loading}
                  variant={
                    hasResolvedMarketOnce ? "refreshing" : "surface-loading"
                  }
                  preserveContent={hasResolvedMarketOnce}
                  minHeightClassName="min-h-[340px]"
                  message={hasResolvedMarketOnce ? "마켓플레이스 목록을 갱신하는 중입니다..." : "마켓플레이스 목록을 불러오는 중입니다..."}
                >
                  {finalFilteredItems.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {finalFilteredItems.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          currentUser={userData}
                          userBalance={userBalance}
                          isMarketplaceAdmin={isMarketplaceAdmin}
                          currencyName={currencyName}
                          formatNumber={formatNumber}
                          formatWholeNumber={formatWholeNumber}
                          onViewDetails={setSelectedItem}
                          onApprove={() => handleApproveItem(item.id)}
                          onReject={() => handleRejectItem(item)}
                          onDelete={handleDeleteItem}
                          onEdit={handleOpenEditItem}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="py-20 text-center">
                      <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 p-6">
                        <div className="text-4xl text-slate-400">📦</div>
                      </div>
                      <h3 className="mb-2 text-xl font-semibold text-slate-700">
                        {getEmptyStateMessage()}
                      </h3>
                      <p className="mb-6 text-slate-500">
                        {getEmptyStateDescription()}
                      </p>

                      {statusFilter === "all" || statusFilter === "active" ? (
                        <button
                          onClick={handleOpenCreateItem}
                          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-3 font-semibold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:from-indigo-600 hover:to-purple-700 hover:shadow-xl"
                        >
                          <PlusCircle size={18} />
                          물건 등록하기
                        </button>
                      ) : (
                        <button
                          onClick={() => setStatusFilter("active")}
                          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-3 font-semibold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:from-blue-600 hover:to-indigo-700 hover:shadow-xl"
                        >
                          <Filter size={18} />
                          판매 중 보기
                        </button>
                      )}
                    </div>
                  )}
                </SurfaceLoader>
              </div>
            </div>
          ) : null}

          {activeTab === "auction" ? (
            <AuctionTabSection
              auction={auction}
              classId={classId}
              isMarketplaceAdmin={isMarketplaceAdmin}
              canSettleAuction={canSettleAuction}
              autoApproveEnabled={approvalSettings.autoApproveEnabled || isMarketplaceAdmin || isAdmin || userData?.role === "admin"}
              userData={userData}
              currencyName={currencyName}
              formatNumber={formatNumber}
            />
          ) : null}
        </div>
      </div>

      {showForm ? (
        <ItemForm
          currencyName={currencyName}
          sellerFeeRate={marketFee.marketFeeRate}
          sellerFeeEnabled={marketFee.marketFeeEnabled}
          formatWholeNumber={formatWholeNumber}
          itemToEdit={editingItem}
          autoApproveEnabled={approvalSettings.autoApproveEnabled || isMarketplaceAdmin}
          onSubmit={handleSubmitItem}
          onClose={() => {
            setEditingItem(null);
            setShowForm(false);
          }}
        />
      ) : null}

      <ItemDetailModal
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        item={selectedItem}
        currentUser={userData}
        currencyName={currencyName}
        userBalance={userBalance}
        formatNumber={formatNumber}
        formatWholeNumber={formatWholeNumber}
        onConfirmPurchase={handleConfirmPurchase}
      />

      <CategoryManagerModal
        isOpen={showCategoryModal}
        onClose={() => {
          setEditingCategory(null);
          setShowCategoryModal(false);
        }}
        categoryToEdit={editingCategory}
        onCreated={(newId) => setSelectedCategory(newId)}
      />

      <RejectReasonModal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onSubmit={handleSubmitReject}
        itemTitle={rejectTarget?.title || ""}
      />

      <MarketplaceApprovalModal
        isOpen={showApprovalModal}
        onClose={() => setShowApprovalModal(false)}
        initialTab={approvalActiveTab}
        marketItems={marketPendingApprovalItems}
        auctionItems={auction.pendingApprovalItems}
        marketPendingCount={marketPendingApprovalCount}
        auctionPendingCount={auction.pendingApprovalCount}
        isMarketReady={isMarketPendingApprovalListReady}
        isAuctionReady={auction.isPendingApprovalListReady}
        processingMarketItemId={processingApprovalItemId}
        processingAuctionItemId={auction.processingApprovalAuctionId}
        currencyName={currencyName}
        formatWholeNumber={formatWholeNumber}
        onProcessMarketApproval={approveItem}
        onProcessAuctionApproval={auction.processAuctionApproval}
        autoApproveEnabled={approvalSettings.autoApproveEnabled}
        isSavingAutoApprove={approvalSettings.isSavingAutoApprove}
        onAutoApproveChange={approvalSettings.updateAutoApprove}
      />

      <TransactionHistoryModal
        isOpen={showTransactionHistory}
        onClose={() => setShowTransactionHistory(false)}
        currencyName={currencyName}
        isTeacher={isMarketplaceAdmin}
        title="전체 거래 기록"
        formatWholeNumber={formatWholeNumber}
      />

      <PersonalTransactionModal
        isOpen={showPersonalHistory}
        onClose={() => setShowPersonalHistory(false)}
        currencyName={currencyName}
        formatWholeNumber={formatWholeNumber}
      />

      <SellerFeeSettingsModal
        isOpen={showFeeSettingsModal}
        onClose={() => setShowFeeSettingsModal(false)}
        canManageSellerFee={canManageSellerFee}
        marketFee={marketFee}
        auctionFee={auction}
      />
    </AppLayout>
  );
};

export default Marketplace;
