import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  Coins,
  Coffee,
  Gift,
  History as HistoryIcon,
  Info,
  MessageCircleHeart,
  Package,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trash2,
  User,
  Utensils,
} from "lucide-react";

import { Badge, Button, Modal, Tabs } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { resolveClassCurrencyUnit } from "../../../utils/currencyUnit";
import useMyInventory from "../hooks/useMyInventory";
import {
  formatExpiryDateTime,
  formatRemainingTime,
  getActivePurchaseQuantity,
  summarizeInventoryItemExpiration,
} from "../utils/itemExpiration";
import { getRandomBoxBoxType, isRandomBoxItem } from "../utils/randomBox";
import { summarizeStoreInventoryValue } from "../utils/storeCurrency";
import DeleteInventoryItemModal from "./DeleteInventoryItemModal";
import GiftItemModal from "./GiftItemModal";
import RandomBoxResultModal from "./RandomBoxResultModal";
import UseItemModal from "./UseItemModal";

const getItemIcon = (item) => {
  if (item?.itemType === "ticket" || item?.functionTag === "arcade_ticket") {
    return <Ticket className="h-9 w-9 text-blue-500" strokeWidth={2.5} />;
  }

  if (isRandomBoxItem(item)) {
    const boxType = getRandomBoxBoxType(item);
    return (
      <Sparkles
        className={`h-9 w-9 ${boxType === "premium" ? "text-rose-500" : "text-amber-500"}`}
      />
    );
  }

  const name = String(item?.itemName || "").toLowerCase();
  if (
    name.includes("coffee") ||
    name.includes("latte") ||
    name.includes("tea") ||
    name.includes("drink") ||
    name.includes("커피") ||
    name.includes("음료")
  ) {
    return <Coffee className="h-9 w-9 text-amber-500" />;
  }

  if (
    name.includes("meal") ||
    name.includes("lunch") ||
    name.includes("snack") ||
    name.includes("food") ||
    name.includes("과자") ||
    name.includes("빵")
  ) {
    return <Utensils className="h-9 w-9 text-rose-500" />;
  }

  return <ShoppingBag className="h-9 w-9 text-indigo-500" />;
};

const formatUsageNote = (log) => {
  const raw = String(log?.note || "").trim();
  if (!raw) return "";

  if (log?.sourceType === "pos_immediate" || raw.toUpperCase().includes("POS")) {
    return "POS 즉시 사용";
  }

  return raw;
};

const formatRandomBoxRewardSummary = (log) => {
  const rewardName = String(log?.rewardItemName || "").trim();
  const rewardQuantity = Math.max(1, Number(log?.rewardQuantity || 1));

  if (!rewardName) {
    return "";
  }

  return `${rewardName} ${rewardQuantity}개 획득`;
};

const MyItemsModal = ({
  isOpen,
  onClose,
  uid = null,
  isAdminView = false,
  giftPolicyMap = {},
  storeItems = [],
}) => {
  const navigate = useNavigate();
  const { formatClassCurrency } = useNumberFormat();
  const { classData, missionTokenLabel = "토큰" } = useUser();
  const { showFeedback } = useFeedback();
  const currencyUnit = resolveClassCurrencyUnit(classData);

  const [activeTab, setActiveTab] = useState("items");
  const [expandedMessages, setExpandedMessages] = useState({});
  const [useItemModalInfo, setUseItemModalInfo] = useState({
    isOpen: false,
    item: null,
  });
  const [giftItemModalInfo, setGiftItemModalInfo] = useState({
    isOpen: false,
    item: null,
  });
  const [deleteItemModalInfo, setDeleteItemModalInfo] = useState({
    isOpen: false,
    item: null,
    targetStudentUid: null,
  });
  const [randomBoxResult, setRandomBoxResult] = useState(null);

  const {
    inventoryItems,
    usageHistory,
    isLoadingInventory,
    isLoadingHistory,
    historyError,
    refresh,
  } = useMyInventory({ start: null, end: null, search: "" }, uid);

  useEffect(() => {
    if (!isOpen) return;

    setExpandedMessages({});
    setUseItemModalInfo({ isOpen: false, item: null });
    setGiftItemModalInfo({ isOpen: false, item: null });
    setDeleteItemModalInfo({ isOpen: false, item: null, targetStudentUid: null });
    setRandomBoxResult(null);
  }, [isOpen, uid]);

  const decoratedInventoryItems = useMemo(
    () =>
      inventoryItems
        .map((item, index) => {
          const purchaseQty =
            item.acquisitions
              ?.filter((acquisition) => acquisition.type === "purchase")
              .reduce(
                (acc, acquisition) => acc + Number(acquisition?.quantity || 0),
                0,
              ) || 0;
          const giftAcqs =
            item.acquisitions?.filter(
              (acquisition) => acquisition.type === "gift",
            ) || [];
          const giftQty = giftAcqs.reduce(
            (acc, acquisition) => acc + Number(acquisition?.quantity || 0),
            0,
          );
          const expirationSummary = summarizeInventoryItemExpiration(item);
          const usableQuantity = expirationSummary.usableQty;
          const expiredQuantity = expirationSummary.expiredQty;
          const activePurchaseQty = getActivePurchaseQuantity(item);
          const nextExpiryMs = expirationSummary.nextExpiryMs;
          const isFullyExpired = expirationSummary.isFullyExpired;
          const visibleQuantity = isAdminView
            ? Number(item.quantity || 0)
            : usableQuantity;
          const shouldHideForStudent = !isAdminView && visibleQuantity <= 0;

          return {
            ...item,
            purchaseQty,
            giftAcqs,
            giftQty,
            usableQuantity,
            expiredQuantity,
            activePurchaseQty,
            nextExpiryMs,
            isFullyExpired,
            visibleQuantity,
            shouldHideForStudent,
            sortIndex: index,
          };
        })
        .filter((item) => !item.shouldHideForStudent)
        .sort((left, right) => {
          const leftHasExpiry = Number.isFinite(Number(left.nextExpiryMs));
          const rightHasExpiry = Number.isFinite(Number(right.nextExpiryMs));

          if (
            leftHasExpiry &&
            rightHasExpiry &&
            left.nextExpiryMs !== right.nextExpiryMs
          ) {
            return left.nextExpiryMs - right.nextExpiryMs;
          }

          if (leftHasExpiry !== rightHasExpiry) {
            return leftHasExpiry ? -1 : 1;
          }

          return left.sortIndex - right.sortIndex;
        }),
    [inventoryItems, isAdminView],
  );

  const totalInventoryValue = useMemo(
    () =>
      summarizeStoreInventoryValue(decoratedInventoryItems, storeItems),
    [decoratedInventoryItems, storeItems],
  );

  const toggleMessage = (itemId) => {
    setExpandedMessages((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <Modal.Header>
          <div className="flex w-full items-start justify-between gap-4 pr-8">
            <div className="flex min-w-0 items-start gap-3">
              <div className="rounded-2xl bg-indigo-600 p-2.5 text-white shadow-lg shadow-indigo-100">
                <Package className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-black tracking-tight text-slate-900">
                    {isAdminView ? "학생 가방 조회" : "내 가방"}
                  </h2>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-slate-600 tabular-nums" aria-label="보유 상품 가치">
                  <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    현금 상품 {formatClassCurrency(totalInventoryValue.cash)} {currencyUnit}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-1.5">
                    <Coins size={12} aria-hidden="true" />
                    {missionTokenLabel} 상품 {formatClassCurrency(totalInventoryValue.missionToken)} {missionTokenLabel}
                  </span>
                  {totalInventoryValue.usdBalance > 0 ? (
                    <span className="rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5">
                      외화 상품 {formatClassCurrency(totalInventoryValue.usdBalance)} FIN
                    </span>
                  ) : null}
                  {totalInventoryValue.unknownQuantity > 0 ? (
                    <span className="px-2.5 py-1.5">화폐 미확인 상품 {totalInventoryValue.unknownQuantity}개</span>
                  ) : null}
                </div>
              </div>
            </div>

            <button
              aria-label="가방 기록 새로고침"
              onClick={() => refresh?.()}
              className="group rounded-xl p-2.5 transition-colors hover:bg-slate-100"
            >
              <RefreshCw
                className={`h-4 w-4 text-slate-400 group-hover:text-indigo-600 ${
                  isLoadingInventory ? "animate-spin" : ""
                }`}
              />
            </button>
          </div>
        </Modal.Header>

        <Modal.Body className="flex min-h-[320px] flex-col bg-slate-50/30 p-0">
          <div className="sticky top-0 z-10 border-b bg-white px-6 py-3">
            <Tabs
              variant="underline"
              tabs={[
                { id: "items", label: "보유 아이템", icon: Package },
                { id: "history", label: "사용 기록", icon: HistoryIcon },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === "items" ? (
              <div className="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2">
                {decoratedInventoryItems.map((item) => {
                  const isArcadeTicket =
                    item.itemType === "ticket" ||
                    item.functionTag === "arcade_ticket";
                  const isRandomBox = isRandomBoxItem(item);
                  const randomBoxType = isRandomBox
                    ? getRandomBoxBoxType(item)
                    : "normal";
                  const isPremiumRandomBox =
                    isRandomBox && randomBoxType === "premium";
                  const isExpanded = expandedMessages[item.id];
                  const isGiftAllowed =
                    giftPolicyMap[item.id] ?? item.isGiftAllowed !== false;
                  const inventoryItemForModal = {
                    ...item,
                    quantity: item.visibleQuantity,
                  };

                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col overflow-hidden rounded-[2rem] border bg-white shadow-sm transition-all hover:shadow-md ${
                        isPremiumRandomBox
                          ? "border-rose-100 shadow-rose-100/40"
                          : isRandomBox
                            ? "border-amber-100 shadow-amber-100/40"
                            : "border-slate-100"
                      }`}
                    >
                      <div className="relative flex">
                        <div
                          className={`flex w-14 flex-shrink-0 items-center justify-center sm:w-20 ${
                            isArcadeTicket
                              ? "bg-blue-50/40"
                              : isRandomBox
                                ? isPremiumRandomBox
                                  ? "bg-gradient-to-br from-rose-50 via-amber-50 to-white"
                                  : "bg-amber-50/40"
                                : "bg-slate-50/50"
                          }`}
                        >
                          {getItemIcon(item)}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-5">
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <h3 className="min-w-0 flex-1 line-clamp-2 break-words text-base font-black text-slate-800">
                              {item.itemName}
                            </h3>
                            <Badge tone="indigo" variant="solid" size="sm" className="shrink-0">
                              {item.visibleQuantity}개
                            </Badge>
                          </div>

                          <div className="mb-3 flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                              구매 {item.purchaseQty}
                            </span>
                            {isRandomBox ? (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                  isPremiumRandomBox
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-amber-50 text-amber-700"
                                }`}
                              >
                                {isPremiumRandomBox ? "프리미엄 박스" : "일반 박스"}
                              </span>
                            ) : null}
                            {!isGiftAllowed ? (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
                                선물 제한
                              </span>
                            ) : null}
                            {item.giftQty > 0 ? (
                              <button
                                onClick={() => toggleMessage(item.id)}
                                className="flex items-center gap-0.5 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-500 hover:bg-rose-100"
                              >
                                <Gift size={8} />
                                선물 {item.giftQty}
                                {isExpanded ? (
                                  <ChevronUp size={10} />
                                ) : (
                                  <ChevronDown size={10} />
                                )}
                              </button>
                            ) : null}
                          </div>

                          {item.nextExpiryMs ? (
                            <div
                              className={`mb-3 rounded-xl border px-3 py-2 text-[11px] font-bold ${
                                isAdminView
                                  ? "border-blue-100 bg-blue-50 text-blue-700"
                                  : "border-sky-100 bg-sky-50 text-sky-700"
                              }`}
                            >
                              {isAdminView ? (
                                <span>
                                  사용 가능 {item.usableQuantity}개
                                  {item.expiredQuantity > 0
                                    ? ` / 만료 ${item.expiredQuantity}개`
                                    : ""}
                                  {` / 다음 만료 ${formatExpiryDateTime(
                                    item.nextExpiryMs,
                                  )} (${formatRemainingTime(item.nextExpiryMs)})`}
                                </span>
                              ) : (
                                <span>
                                  다음 만료 {formatExpiryDateTime(item.nextExpiryMs)} (
                                  {formatRemainingTime(item.nextExpiryMs)})
                                </span>
                              )}
                            </div>
                          ) : null}

                          {isAdminView &&
                          item.expiredQuantity > 0 &&
                          !item.nextExpiryMs ? (
                            <div className="mb-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">
                              만료 {item.expiredQuantity}개
                            </div>
                          ) : null}

                          {isArcadeTicket ? (
                            <p className="mb-3 text-xs leading-5 text-slate-600">오락실에서 사용할 수 있어요.</p>
                          ) : null}
                          <div className="mt-auto flex flex-wrap gap-2">
                            {isAdminView ? (
                              <>
                                {!isArcadeTicket ? (
                                  <Button
                                    size="sm"
                                    tone={
                                      isRandomBox
                                        ? isPremiumRandomBox
                                          ? "rose"
                                          : "amber"
                                        : "indigo"
                                    }
                                    className="flex-1"
                                    disabled={item.usableQuantity < 1}
                                    onClick={() =>
                                      setUseItemModalInfo({
                                        isOpen: true,
                                        item: inventoryItemForModal,
                                      })
                                    }
                                  >
                                    {isRandomBox ? "대신 열기" : "대신 사용"}
                                  </Button>
                                ) : null}
                                <Button
                                  aria-label={`${item.itemName} 삭제`}
                                  size="sm"
                                  kind="outline"
                                  tone="red"
                                  
                                  onClick={() =>
                                    setDeleteItemModalInfo({
                                      isOpen: true,
                                      item,
                                      targetStudentUid: uid,
                                    })
                                  }
                                >
                                  <Trash2 size={18} />
                                </Button>
                              </>
                            ) : (
                              <>
                                {!isArcadeTicket ? (
                                  <Button
                                    size="sm"
                                    tone={
                                      isRandomBox
                                        ? isPremiumRandomBox
                                          ? "rose"
                                          : "amber"
                                        : "indigo"
                                    }
                                    className="flex-1"
                                    disabled={item.usableQuantity < 1}
                                    onClick={() =>
                                      setUseItemModalInfo({
                                        isOpen: true,
                                        item: inventoryItemForModal,
                                      })
                                    }
                                  >
                                    {isRandomBox ? "열기" : "사용하기"}
                                  </Button>
                                ) : (
                                  <Button size="sm" tone="blue" onClick={() => {
                                    onClose?.();
                                    navigate("/arcade");
                                  }}>
                                    오락실로 이동
                                  </Button>
                                )}
                                {isGiftAllowed ? (
                                <Button
                                  size="sm"
                                  kind="outline"
                                  tone={
                                    item.activePurchaseQty > 0 && isGiftAllowed
                                      ? "slate"
                                      : "red"
                                  }
                                  
                                  disabled={!isGiftAllowed || item.activePurchaseQty < 1}
                                  onClick={() => {
                                    if (!isGiftAllowed) {
                                      showFeedback(
                                        "이 상품은 선물할 수 없도록 설정되어 있습니다.",
                                        "warning",
                                      );
                                      return;
                                    }

                                    if (item.activePurchaseQty > 0) {
                                      setGiftItemModalInfo({
                                        isOpen: true,
                                        item: {
                                          ...item,
                                          isGiftAllowed,
                                          activePurchaseQty: item.activePurchaseQty,
                                        },
                                      });
                                      return;
                                    }

                                    showFeedback(
                                      "선물 가능한 수량이 없습니다.",
                                      "warning",
                                    );
                                  }}
                                >
                                  <Gift size={18} />
                                  선물하기
                                </Button>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="animate-in slide-in-from-top-1 border-t border-rose-100/50 bg-rose-50/30 px-4 pb-4">
                          <p className="mb-2 mt-3 px-1 text-[10px] font-black text-rose-400">
                            선물 메시지
                          </p>
                          <div className="space-y-2">
                            {item.giftAcqs.map((acquisition, index) => (
                              <div
                                key={`${item.id}-gift-${index}`}
                                className="rounded-xl border border-rose-100 bg-white p-3 shadow-sm"
                              >
                                <div className="mb-1 flex justify-between text-[10px]">
                                  <span className="flex items-center gap-1 font-black text-slate-700">
                                    <User size={10} />
                                    {acquisition.senderName}
                                  </span>
                                  <span className="text-slate-400">
                                    {acquisition.quantity}개
                                  </span>
                                </div>
                                {acquisition.message ? (
                                  <p className="text-[11px] font-bold italic leading-tight text-rose-600">
                                    "{acquisition.message}"
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2 p-4 md:p-6">
                {isLoadingHistory && usageHistory.length === 0 ? (
                  <p role="status" className="py-10 text-center text-sm text-slate-500">사용 기록을 불러오는 중이에요.</p>
                ) : historyError ? (
                  <div role="alert" className="rounded-2xl bg-slate-50 p-6 text-center">
                    <p className="mb-3 text-sm text-slate-600">사용 기록을 불러오지 못했어요.</p>
                    <Button size="sm" tone="slate" kind="outline" onClick={() => refresh?.()}>다시 시도</Button>
                  </div>
                ) : usageHistory.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-10 text-center">
                    <HistoryIcon size={28} className="mx-auto mb-3 text-slate-400" aria-hidden="true" />
                    <p className="font-bold text-slate-700">아직 사용한 기록이 없어요.</p>
                    <p className="mt-2 text-sm text-slate-500">보유 아이템에서 사용할 상품을 확인해 보세요.</p>
                    <Button size="sm" tone="indigo" kind="outline" className="mt-4" onClick={() => setActiveTab("items")}>보유 아이템 보기</Button>
                  </div>
                ) : null}
                {usageHistory.map((log) => {
                  const isGift = log.sourceType === "gift";
                  const isDeleted = log.status === "deleted";
                  const isRandomBoxOpen = log.sourceType === "random_box_open";
                  const compactNote = formatUsageNote(log);
                  const rewardSummary = formatRandomBoxRewardSummary(log);
                  const isPosImmediate =
                    !isGift &&
                    !isDeleted &&
                    (log.sourceType === "pos_immediate" ||
                      compactNote === "POS 즉시 사용");
                  return (
                    <div
                      key={log.id}
                      className="group flex flex-col gap-2 rounded-[1.25rem] border border-slate-100 bg-white p-3.5 shadow-sm transition-all hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div
                            className={`rounded-xl p-2.5 ${
                              isGift
                                ? "bg-rose-50 text-rose-500"
                                : isRandomBoxOpen
                                  ? "bg-amber-50 text-amber-600"
                                  : "bg-indigo-50 text-indigo-500"
                            }`}
                          >
                            {isGift ? (
                              <Gift size={15} />
                            ) : isRandomBoxOpen ? (
                              <Sparkles size={15} />
                            ) : (
                              <ShoppingBag size={15} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-black text-slate-800">
                                {log.itemName}
                              </span>
                              <Badge
                                tone={
                                  isDeleted
                                    ? "red"
                                    : isGift
                                      ? "rose"
                                      : isRandomBoxOpen
                                        ? "amber"
                                        : "slate"
                                }
                                variant="soft"
                                size="sm"
                                className="text-[10px]"
                              >
                                {isDeleted
                                  ? "삭제"
                                  : isGift
                                    ? "선물"
                                    : isRandomBoxOpen
                                      ? "개봉"
                                      : "사용"}
                              </Badge>
                              {isPosImmediate ? (
                                <Badge
                                  tone="indigo"
                                  variant="soft"
                                  size="sm"
                                  className="text-[10px]"
                                >
                                  POS
                                </Badge>
                              ) : null}
                            </div>
                            {isGift ? (
                              <p className="mt-0.5 text-[11px] font-extrabold text-rose-400">
                                보낸 사람 {log.fromName}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <span
                          className={`mt-0.5 shrink-0 font-black ${
                            isDeleted
                              ? "text-red-500"
                              : isGift
                                ? "text-rose-500"
                                : isRandomBoxOpen
                                  ? "text-amber-600"
                                  : "text-slate-600"
                          }`}
                        >
                          {isDeleted ? `삭제 ${log.quantity}` : `-${log.quantity}`}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 px-1">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                          {log.usedDate?.seconds
                            ? new Date(log.usedDate.seconds * 1000).toLocaleString()
                            : "시간 정보 없음"}
                        </span>
                        {rewardSummary ? (
                          <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                            <Sparkles
                              size={11}
                              className="shrink-0 text-amber-500"
                            />
                            <span className="truncate">{rewardSummary}</span>
                          </span>
                        ) : null}
                        {isGift && log.fromName ? (
                          <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-500">
                            보낸 사람 {log.fromName}
                          </span>
                        ) : null}
                        {isGift && log.message ? (
                          <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-600">
                            <MessageCircleHeart
                              size={11}
                              className="shrink-0 text-rose-400"
                            />
                            <span className="truncate">"{log.message}"</span>
                          </span>
                        ) : null}
                        {compactNote && !isPosImmediate ? (
                          <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">
                            <Info size={11} className="shrink-0 text-slate-400" />
                            <span className="truncate">{compactNote}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button size="md"
            tone="slate"
            kind="soft"
            onClick={onClose}
            fullWidth
            
          >
            닫기
          </Button>
        </Modal.Footer>
      </Modal>

      <UseItemModal
        isOpen={useItemModalInfo.isOpen}
        onClose={() => {
          setUseItemModalInfo({ isOpen: false, item: null });
          refresh?.();
        }}
        item={useItemModalInfo.item}
        targetStudentUid={isAdminView ? uid : null}
        isAdminView={isAdminView}
        onUseSuccess={(data) => {
          if (data?.openedRandomBox) {
            setRandomBoxResult(data);
          }
        }}
      />

      {isAdminView ? (
        <DeleteInventoryItemModal
          isOpen={deleteItemModalInfo.isOpen}
          onClose={() => {
            setDeleteItemModalInfo({
              isOpen: false,
              item: null,
              targetStudentUid: null,
            });
            refresh?.();
          }}
          item={deleteItemModalInfo.item}
          targetStudentUid={deleteItemModalInfo.targetStudentUid}
        />
      ) : null}

      <GiftItemModal
        isOpen={giftItemModalInfo.isOpen}
        onClose={() => {
          setGiftItemModalInfo({ isOpen: false, item: null });
          refresh?.();
        }}
        item={giftItemModalInfo.item}
      />

      <RandomBoxResultModal
        isOpen={Boolean(randomBoxResult)}
        onClose={() => setRandomBoxResult(null)}
        result={randomBoxResult}
      />
    </>
  );
};

export default MyItemsModal;
