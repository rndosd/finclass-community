import React, { useMemo, useState } from "react";
import { Gavel } from "lucide-react";
import { Alert, Button, Spinner } from "../../../../components/ui";
import MarketplaceFilter from "../../components/MarketplaceFilter";
import AuctionItemCard from "./AuctionItemCard";
import AuctionBidModal from "../modals/AuctionBidModal";
import AuctionCreateModal from "../modals/AuctionCreateModal";
import AuctionDetailModal from "../modals/AuctionDetailModal";
import RejectReasonModal from "../../modals/RejectReasonModal";
import { getAuctionEndAtMs } from "../utils/auctionTiming";

export default function AuctionTabSection({
  auction,
  classId,
  isMarketplaceAdmin,
  canSettleAuction,
  userData,
  currencyName,
  formatNumber,
  autoApproveEnabled = false,
}) {
  const [detailItem, setDetailItem] = useState(null);

  const statusOptions = useMemo(
    () =>
      isMarketplaceAdmin
        ? [
            { key: "active", label: "진행·정산 대기" },
            { key: "ended", label: "정산완료" },
            { key: "pending", label: "승인대기" },
            { key: "rejected", label: "반려" },
          ]
        : [
            { key: "active", label: "진행·정산 대기" },
            { key: "ended", label: "정산완료" },
          ],
    [isMarketplaceAdmin],
  );

  const getEmptyState = () => {
    switch (auction.auctionStatusFilter) {
      case "pending":
        return {
          title: "승인 대기 경매가 없습니다",
          description: "등록 후 승인 대기 중인 경매가 여기에 표시됩니다.",
        };
      case "rejected":
        return {
          title: "반려된 경매가 없습니다",
          description: "반려된 경매와 반려 사유가 여기에 표시됩니다.",
        };
      case "ended":
        return {
          title: "정산 완료 경매가 없습니다",
          description: "마감 정산이 끝난 경매가 여기에 표시됩니다.",
        };
      case "active":
      default:
        return {
          title: "진행 중인 경매가 없습니다",
          description: "첫 경매 물품을 등록해서 학급 경매를 시작해보세요.",
        };
    }
  };

const emptyState = getEmptyState();
  const sortedAuctionItems = useMemo(() => {
    if (auction.auctionStatusFilter !== "active") return auction.auctionItems;
    return [...auction.auctionItems].sort((left, right) => {
      const leftEndAt = getAuctionEndAtMs(left) || Number.MAX_SAFE_INTEGER;
      const rightEndAt = getAuctionEndAtMs(right) || Number.MAX_SAFE_INTEGER;
      return leftEndAt - rightEndAt;
    });
  }, [auction.auctionItems, auction.auctionStatusFilter]);

  const renderAuctionCard = (item, variant = "default", auctionNumber) => {
    const endAtMs = getAuctionEndAtMs(item);
    const canForceSettle = canSettleAuction && endAtMs > Date.now();
    const canClose = canSettleAuction && String(item?.status || "") === "active";
    const antiSnipingSeconds = Number(
      item?.antiSnipingSeconds ?? auction.auctionAntiSnipingSeconds ?? 30,
    );

    return (
      <AuctionItemCard
        key={item.id}
        item={item}
        variant={variant}
        auctionNumber={auctionNumber}
        currencyName={currencyName}
        formatNumber={formatNumber}
        onBid={auction.handleOpenAuctionBid}
        onCloseAuction={auction.handleCloseAuction}
        canCloseAuction={canClose}
        isForceSettle={canForceSettle}
        isClosing={auction.closingAuctionId === item.id}
        isMarketplaceAdmin={isMarketplaceAdmin}
        isProcessingApproval={auction.processingApprovalAuctionId === item.id}
        onApprove={() => auction.handleApproveAuction(item.id)}
        onReject={() => auction.handleRejectAuction(item)}
        currentUserUid={userData?.uid}
        antiSnipingSeconds={antiSnipingSeconds}
        onViewDetails={(selectedItem) =>
          setDetailItem({
            ...selectedItem,
            antiSnipingSeconds,
          })
        }
      />
    );
  };

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="shrink-0 rounded-xl bg-indigo-50 p-2 text-indigo-600">
                <Gavel size={16} />
              </div>
              <div>
                <p className="text-lg font-extrabold text-slate-800">{auction.auctionStatusFilter === "active" ? "진행·정산 대기 경매" : "경매장"}</p>
                {auction.auctionStatusFilter === "active" ? (
                  <div className="mt-1 flex items-center gap-2 text-xs font-bold text-slate-500">
                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                    <span>진행·정산 대기 {sortedAuctionItems.length}건</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-3 lg:w-[220px] lg:shrink-0">
              <MarketplaceFilter
                statusFilter={auction.auctionStatusFilter}
                onFilterChange={auction.setAuctionStatusFilter}
                itemCounts={auction.auctionItemCounts}
                pendingBadgeCount={auction.pendingApprovalCount}
                options={statusOptions}
              />
            </div>
          </div>

          {auction.auctionLoadError ? (
            <Alert
              type="error"
              message="경매 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
            />
          ) : null}

          {auction.isAuctionLoading ? (
            <div className="py-10">
              <Spinner message="경매 목록 불러오는 중.." />
            </div>
          ) : sortedAuctionItems.length > 0 ? (
            auction.auctionStatusFilter === "active" ? (
              <div className="space-y-4">
                <div className={`grid gap-4 ${sortedAuctionItems.length > 1 ? "xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.85fr)]" : "grid-cols-1"}`}>
                  {renderAuctionCard(sortedAuctionItems[0], "featured", 1)}
                  {sortedAuctionItems.length > 1 ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                      {sortedAuctionItems.slice(1, 3).map((item, index) => renderAuctionCard(item, "compact", index + 2))}
                    </div>
                  ) : null}
                </div>
                {sortedAuctionItems.length > 3 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {sortedAuctionItems.slice(3).map((item, index) => renderAuctionCard(item, "default", index + 4))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sortedAuctionItems.map((item, index) => renderAuctionCard(item, "default", index + 1))}
              </div>
            )          ) : (
            <div className="py-16 text-center">
              <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 p-6">
                <div className="text-4xl text-slate-400">🔨</div>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-slate-700">
                {emptyState.title}
              </h3>
              <p className="mb-6 text-slate-500">{emptyState.description}</p>
              {auction.auctionStatusFilter === "active" ? (
                <p className="text-sm text-slate-500">
                  상단 헤더의 <span className="font-semibold">경매 출품</span> 버튼으로
                  등록할 수 있습니다.
                </p>
              ) : (
                <Button
                  size="sm"
                  kind="outline"
                  tone="slate"
                  onClick={() => auction.setAuctionStatusFilter("active")}
                >
                  진행·정산 대기 보기
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <AuctionCreateModal
        isOpen={auction.showAuctionCreateModal}
        onClose={() => auction.setShowAuctionCreateModal(false)}
        currencyName={currencyName}
        onSubmit={auction.handleCreateAuction}
        isSubmitting={auction.isCreatingAuctionItem}
        antiSnipingSeconds={auction.auctionAntiSnipingSeconds}
        autoApproveEnabled={autoApproveEnabled}
      />

      <AuctionDetailModal
        isOpen={!!detailItem}
        onClose={() => setDetailItem(null)}
        item={detailItem ? {
          ...detailItem,
          ...auction.auctionItems.find((item) => item.id === detailItem.id),
        } : null}
        classId={classId}
        canViewBidders={isMarketplaceAdmin}
        currencyName={currencyName}
        formatNumber={formatNumber}
        currentUserUid={userData?.uid}
        onBid={(item) => {
          setDetailItem(null);
          auction.handleOpenAuctionBid(item);
        }}
      />

      <AuctionBidModal
        isOpen={auction.showAuctionBidModal}
        onClose={() => {
          auction.setShowAuctionBidModal(false);
          auction.setSelectedAuctionItem(null);
          auction.setMyPrevHold(0);
        }}
        item={auction.selectedAuctionItem}
        currencyName={currencyName}
        formatNumber={formatNumber}
        userBalance={Number(userData?.assets?.cash || 0)}
        userAuctionHold={auction.userAuctionHold}
        myPrevHold={auction.myPrevHold}
        onSubmitBid={auction.handleSubmitAuctionBid}
        isSubmitting={auction.isSubmittingAuctionBid}
      />

      <RejectReasonModal
        isOpen={!!auction.rejectAuctionTarget}
        onClose={() => auction.setRejectAuctionTarget(null)}
        onSubmit={auction.handleSubmitRejectAuction}
        itemTitle={auction.rejectAuctionTarget?.title || ""}
      />
    </div>
  );
}
