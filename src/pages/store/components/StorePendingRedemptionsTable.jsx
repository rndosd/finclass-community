import React from "react";
import { ChevronDown } from "lucide-react";

import { Button, DataTable, EmptyState, Spinner } from "../../../components/ui";
import PurchaseItemRow from "./PurchaseItemRow";

const StorePendingRedemptionsTable = ({
  isLoading,
  items,
  isShowingSearchFallback = false,
  allRefundableSelected,
  onToggleSelectAllRefundable,
  refundableItems,
  refundableIdSet,
  isBulkProcessing,
  onCancelItem,
  onRedeemItem,
  processingId,
  selectedRefundIds,
  onToggleRefundSelection,
  onSelectionMouseDown,
  onSelectionMouseEnter,
  hasNextPage,
  onFetchNextPage,
  isFetchingNextPage,
  usageStatusMap,
  expandedRandomBoxIds,
  randomBoxEventMap,
  loadingRandomBoxEventMap,
  onToggleRandomBoxDetails,
  isRecordRestricted,
}) => {
  return (
    <div className="min-h-[400px] select-none">
      {isLoading && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32">
          <Spinner size="lg" />
          <p className="mt-4 animate-pulse text-sm font-medium text-slate-500">
            구매 내역을 불러오는 중입니다...
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="조건에 맞는 구매 내역이 없습니다"
            description="검색어, 기간, 상태 필터를 조정하면 다른 내역을 확인할 수 있습니다."
            size="md"
          />
        </div>
      ) : (
        <div className="pb-10">
          {isShowingSearchFallback ? (
            <div className="mx-4 mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              현재까지 불러온 내역에서는 검색 결과를 찾지 못해 최근 불러온 구매내역을 먼저 보여주고 있습니다.
            </div>
          ) : null}

          <DataTable>
            <DataTable.Header className="sticky top-0 z-10">
              <DataTable.Row interactive={false}>
                <DataTable.HeadCell align="center" className="px-4">
                  <input
                    type="checkbox"
                    checked={allRefundableSelected}
                    onChange={onToggleSelectAllRefundable}
                    disabled={refundableItems.length === 0 || isBulkProcessing}
                    className="h-4 w-4 accent-indigo-600"
                    aria-label="전체 선택"
                  />
                </DataTable.HeadCell>
                <DataTable.HeadCell align="center" className="px-6">
                  구매 시각
                </DataTable.HeadCell>
                <DataTable.HeadCell className="px-6">학생</DataTable.HeadCell>
                <DataTable.HeadCell className="px-6">상품 정보</DataTable.HeadCell>
                <DataTable.HeadCell align="right" className="px-6">
                  구매 금액
                </DataTable.HeadCell>
                <DataTable.HeadCell align="center" className="px-6">
                  상태
                </DataTable.HeadCell>
                <DataTable.HeadCell align="center" className="px-6">
                  사용 여부
                </DataTable.HeadCell>
                <DataTable.HeadCell align="center" className="px-6">
                  처리
                </DataTable.HeadCell>
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {items.map((item) => (
                <PurchaseItemRow
                  key={item.id}
                  item={item}
                  onCancel={onCancelItem}
                  onRedeem={onRedeemItem}
                  isProcessing={processingId === item.id}
                  isBulkProcessing={isBulkProcessing}
                  isSelectable={
                    !isRecordRestricted?.(item) && refundableIdSet?.has?.(item.id)
                  }
                  isSelected={selectedRefundIds.includes(item.id)}
                  onToggleSelected={onToggleRefundSelection}
                  onSelectionMouseDown={onSelectionMouseDown}
                  onSelectionMouseEnter={onSelectionMouseEnter}
                  usageInfo={usageStatusMap?.[item.id] || null}
                  isExpandedRandomBox={Boolean(expandedRandomBoxIds?.[item.id])}
                  randomBoxEvents={randomBoxEventMap?.[item.id] || []}
                  isLoadingRandomBoxEvents={Boolean(
                    loadingRandomBoxEventMap?.[item.id],
                  )}
                  onToggleRandomBoxDetails={onToggleRandomBoxDetails}
                  isRestricted={Boolean(isRecordRestricted?.(item))}
                />
              ))}
            </DataTable.Body>
          </DataTable>

          {hasNextPage ? (
            <div className="flex justify-center border-t border-slate-50 bg-white p-8">
              <Button
                kind="outline"
                tone="blue"
                size="md"
                className="min-w-[280px]"
                onClick={onFetchNextPage}
                isLoading={isFetchingNextPage}
                icon={ChevronDown}
              >
                구매 내역 더 불러오기
              </Button>
            </div>
          ) : (
            <div className="animate-in py-12 text-center text-xs font-bold text-slate-300 fade-in duration-700">
              모든 내역을 확인했습니다
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StorePendingRedemptionsTable;
