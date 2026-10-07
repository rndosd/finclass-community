import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  CheckCircle2,
  Gavel,
  Inbox,
  Package,
} from "lucide-react";

import {
  Button,
  Modal,
  SurfaceLoader,
  TableSkeleton,
  ToggleSwitch,
  Tabs,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";

const TABS = {
  market: {
    id: "market",
    label: "중고거래 승인",
    shortLabel: "중고거래",
    icon: Package,
  },
  auction: {
    id: "auction",
    label: "경매장 승인",
    shortLabel: "경매장",
    icon: Gavel,
  },
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatDateTime = (value) => {
  const ms = toMillis(value);
  if (!ms) return "-";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ms);
};

const formatAmount = (value, currencyName, formatWholeNumber) => {
  const amount = Math.max(0, Math.trunc(Number(value || 0)));
  return `${formatWholeNumber ? formatWholeNumber(amount) : amount.toLocaleString()} ${currencyName}`;
};

const mapItems = (items, type, currencyName, formatWholeNumber) =>
  items.map((item) => ({
    id: item.id,
    type,
    title: item.title || "제목 없음",
    sellerName: item.sellerName || "등록자 미상",
    createdAt: item.createdAt,
    amountLabel: type === "market" ? "판매가" : "시작가",
    amountValue:
      type === "market"
        ? formatAmount(item.price, currencyName, formatWholeNumber)
        : formatAmount(item.startPrice, currencyName, formatWholeNumber),
    description:
      type === "market"
        ? item.description || "설명 없음"
        : `입찰 간격 ${formatAmount(item.bidStep || 1, currencyName, formatWholeNumber)}`,
  }));

export default function MarketplaceApprovalModal({
  isOpen,
  onClose,
  initialTab = "market",
  marketItems = [],
  auctionItems = [],
  marketPendingCount = 0,
  auctionPendingCount = 0,
  isMarketReady = false,
  isAuctionReady = false,
  processingMarketItemId = "",
  processingAuctionItemId = "",
  currencyName,
  formatWholeNumber,
  onProcessMarketApproval,
  onProcessAuctionApproval,
  autoApproveEnabled = false,
  isSavingAutoApprove = false,
  onAutoApproveChange,
}) {
  const { showFeedback } = useFeedback();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIndex, setDragStartIndex] = useState(null);
  const dragSelectionRef = useRef({
    baseSelection: new Set(),
    hasMoved: false,
    mode: "select",
  });

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(TABS[initialTab] ? initialTab : "market");
    setSelectedIds(new Set());
    setIsDragging(false);
    setDragStartIndex(null);
  }, [initialTab, isOpen]);

  const marketRows = useMemo(
    () => mapItems(marketItems, "market", currencyName, formatWholeNumber),
    [currencyName, formatWholeNumber, marketItems],
  );
  const auctionRows = useMemo(
    () => mapItems(auctionItems, "auction", currencyName, formatWholeNumber),
    [auctionItems, currencyName, formatWholeNumber],
  );

  const currentRows = activeTab === "market" ? marketRows : auctionRows;
  const isCurrentReady = activeTab === "market" ? isMarketReady : isAuctionReady;
  const currentCount = activeTab === "market" ? marketPendingCount : auctionPendingCount;
  const hasCurrentRows = currentRows.length > 0;
  const isInteractiveTarget = (target) =>
    typeof Element !== "undefined" &&
    target instanceof Element &&
    Boolean(
      target.closest(
        'button, input, textarea, select, a, [role="button"], [data-row-action="true"]',
      ),
    );

  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRowMouseDown = (event, index, itemId, disabled = false) => {
    if (disabled || event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }

    event.preventDefault();
    dragSelectionRef.current = {
      baseSelection: new Set(selectedIds),
      hasMoved: false,
      mode: selectedIds.has(itemId) ? "deselect" : "select",
    };
    setIsDragging(true);
    setDragStartIndex(index);
  };

  const handleRowMouseEnter = (index) => {
    if (!isDragging || dragStartIndex === null) return;

    const start = Math.min(dragStartIndex, index);
    const end = Math.max(dragStartIndex, index);
    const { baseSelection, mode } = dragSelectionRef.current;
    const next = new Set(baseSelection);
    dragSelectionRef.current.hasMoved =
      dragSelectionRef.current.hasMoved || index !== dragStartIndex;

    for (let i = start; i <= end; i += 1) {
      const targetId = currentRows[i]?.id;
      if (!targetId) continue;

      if (mode === "select") {
        next.add(targetId);
      } else {
        next.delete(targetId);
      }
    }

    setSelectedIds(next);
  };

  const handleRowMouseUp = () => {
    setIsDragging(false);
    setDragStartIndex(null);
  };

  const handleRowClick = (event, itemId, disabled = false) => {
    if (disabled || isInteractiveTarget(event.target)) {
      return;
    }

    if (dragSelectionRef.current.hasMoved) {
      dragSelectionRef.current.hasMoved = false;
      return;
    }

    toggleSelection(itemId);
  };

  const handleSelectAll = (checked) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(currentRows.map((item) => item.id)));
  };

  const runApproval = async (itemId, approve) => {
    if (activeTab === "market") {
      return onProcessMarketApproval?.(itemId, approve, "", { silent: true });
    }
    return onProcessAuctionApproval?.(itemId, approve, "", { silent: true });
  };

  const processItems = async (approve, targetRows = null) => {
    const itemsToProcess =
      targetRows || currentRows.filter((item) => selectedIds.has(item.id));

    if (!itemsToProcess.length || isBulkProcessing) return;

    const confirmText = approve ? "승인" : "반려";
    const confirmMessage =
      itemsToProcess.length === 1
        ? `"${itemsToProcess[0].title}" 항목을 ${confirmText}할까요?`
        : `선택한 ${itemsToProcess.length}건을 ${confirmText}할까요?`;

    if (!(await appConfirm(confirmMessage))) return;

    setIsBulkProcessing(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const item of itemsToProcess) {
        const result = await runApproval(item.id, approve);
        if (result?.ok) successCount += 1;
        else failCount += 1;
      }

      setSelectedIds(new Set());

      const message =
        failCount > 0
          ? `${confirmText} ${successCount}건 완료, ${failCount}건 실패`
          : `${confirmText} ${successCount}건 완료`;
      showFeedback(message, failCount > 0 ? "error" : "success");
    } finally {
      setIsBulkProcessing(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="승인 관리" size="lg">
      <div
        className="flex max-h-[75vh] flex-col"
        onMouseLeave={handleRowMouseUp}
        onMouseUp={handleRowMouseUp}
      >
        <Tabs ariaLabel="시장 승인 업무" idPrefix="marketplace-approval" tabs={Object.values(TABS).map(tab=>({id:tab.id,label:tab.shortLabel,icon:tab.icon,badge:(tab.id==="market"?marketPendingCount:auctionPendingCount)>0?(tab.id==="market"?marketPendingCount:auctionPendingCount):undefined}))} activeTab={activeTab} onTabChange={nextTab=>{setActiveTab(nextTab);setSelectedIds(new Set());}} variant="underline" size="md" fullWidth className="mb-4" />

        <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                신규 등록 자동 승인
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                켜면 학생의 새 판매 글과 경매 출품이 바로 공개됩니다.
              </p>
            </div>
            <ToggleSwitch
              id="marketplace-auto-approve"
              checked={autoApproveEnabled}
              onChange={onAutoApproveChange}
              disabled={isSavingAutoApprove}
              srLabel="신규 중고거래와 경매 자동승인"
              tone="emerald"
            />
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm font-bold text-slate-800">{TABS[activeTab].label}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            판매·경매 신청을 확인하고 승인해 주세요.
          </p>
        </div>

        <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2 py-2">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              aria-label="현재 승인 대기 목록 전체 선택"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={currentRows.length > 0 && selectedIds.size === currentRows.length}
              onChange={(e) => handleSelectAll(e.target.checked)}
            />
            <span className="text-xs font-bold text-slate-600">
              {selectedIds.size > 0 ? `${selectedIds.size}건 선택` : `전체 ${currentCount}건`}
            </span>
          </div>

          <div className="flex gap-2">
            {selectedIds.size > 0 ? (
              <>
                <Button
                  size="xs"
                  kind="outline"
                  tone="rose"
                  onClick={() => processItems(false)}
                  disabled={isBulkProcessing}
                >
                  선택 반려
                </Button>
                <Button
                  size="xs"
                  tone="blue"
                  onClick={() => processItems(true)}
                  disabled={isBulkProcessing}
                  isLoading={isBulkProcessing}
                >
                  선택 승인
                </Button>
              </>
            ) : null}
            <Button
              size="xs"
              kind="outline"
              tone="slate"
              onClick={() => setSelectedIds(new Set())}
              disabled={isBulkProcessing}
            >
              선택 해제
            </Button>
          </div>
        </div>

        <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
          <SurfaceLoader
            loading={!isCurrentReady}
            variant={hasCurrentRows ? "refreshing" : "surface-loading"}
            preserveContent={hasCurrentRows}
            skeleton={
              <TableSkeleton
                bare
                columns={4}
                rows={5}
                className="h-full min-h-full"
              />
            }
            minHeightClassName="min-h-[320px]"
          >
            {hasCurrentRows ? (
              currentRows.map((item, index) => {
              const isSelected = selectedIds.has(item.id);
              const isProcessing =
                isBulkProcessing ||
                (activeTab === "market"
                  ? processingMarketItemId === item.id
                  : processingAuctionItemId === item.id);

              return (
                <div
                  key={item.id}
                  onMouseDown={(event) =>
                    handleRowMouseDown(event, index, item.id, isProcessing)
                  }
                  onMouseEnter={() => handleRowMouseEnter(index)}
                  onClick={(event) => handleRowClick(event, item.id, isProcessing)}
                  className={[
                    "flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-all",
                    isSelected
                      ? "border-blue-200 bg-blue-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    aria-label={`${item.title} 선택`}
                    checked={isSelected}
                    onChange={() => toggleSelection(item.id)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    disabled={isProcessing}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="truncate font-bold text-slate-900">{item.title}</span>
                      <span className="shrink-0 text-[10px] font-medium tabular-nums text-slate-400">
                        {formatDateTime(item.createdAt)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {item.sellerName}
                      <span className="mx-1 text-slate-300">|</span>
                      {item.description}
                      <span className="mx-1 text-slate-300">|</span>
                      <span className="font-bold text-blue-600">
                        {item.amountLabel} {item.amountValue}
                      </span>
                    </div>
                  </div>

                  <div
                    className="flex gap-1"
                    data-row-action="true"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <Button tone="rose" kind="ghost" size="icon-md"
                      type="button"
                      onClick={() => processItems(false, [item])}
                      className="transition-colors"
                      title="반려"
                      disabled={isProcessing}
                    >
                      <Ban className="h-5 w-5" />
                    </Button>
                    <Button tone="blue" kind="ghost" size="icon-md"
                      type="button"
                      onClick={() => processItems(true, [item])}
                      className="transition-colors"
                      title="승인"
                      disabled={isProcessing}
                    >
                      <CheckCircle2 className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
                );
              })
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-slate-100 py-20 text-center">
                <Inbox className="mx-auto mb-3 h-10 w-10 text-slate-200" />
                <p className="text-sm font-medium text-slate-400">
                  {TABS[activeTab].shortLabel} 승인 대기 건이 없습니다.
                </p>
              </div>
            )}
          </SurfaceLoader>
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3 text-[11px] text-slate-400">
          <div>행을 클릭하거나 드래그해서 여러 승인 대기 항목을 빠르게 선택할 수 있습니다.</div>
          <Button onClick={onClose} variant="secondary" size="sm" className="shrink-0">
            닫기
          </Button>
        </div>
      </div>
    </Modal>
  );
}
