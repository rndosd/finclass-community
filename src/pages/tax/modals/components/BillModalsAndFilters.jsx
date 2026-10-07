import { appConfirm } from "../../../../utils/appDialogs";
import { useNumberFormat as useMoneyDisplay } from "../../../../contexts/NumberFormatContext";
// src/pages/tax/modals/components/BillModalsAndFilters.jsx

import React from "react";
import { Modal, Button, Badge } from "../../../../components/ui";
import { Calendar, Trash2, AlertTriangle } from "lucide-react";
import {
  formatTaxBillDate,
  formatTaxBillPeriod,
  getTaxBillKindMeta,
} from "../../../../utils/taxBillUtils";

const CancelConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  billInfo,
  isLoading,
  currencyUnit,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const billKindMeta = getTaxBillKindMeta(billInfo);
  const billPeriod = formatTaxBillPeriod(billInfo);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-800">고지서 발급 취소</h3>
            <p className="text-sm text-slate-600">
              취소된 고지서는 복구할 수 없습니다.
            </p>
          </div>
        </div>

        {billInfo && (
          <div className="mb-6 rounded-lg bg-slate-50 p-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-600">학생명</span>
                <span className="font-medium">{billInfo.studentName}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-600">고지서</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{billInfo.name}</span>
                  <Badge color={billKindMeta.badgeColor} size="sm">
                    {billKindMeta.label}
                  </Badge>
                </div>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-600">금액</span>
                <span className="font-medium text-red-600">
                  {formatDisplayMoney(Number(billInfo.amount || 0))} {currencyUnit}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-600">발급일</span>
                <span className="font-medium">
                  {formatTaxBillDate(billInfo.issuedAt)}
                </span>
              </div>
              {billPeriod && (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-600">정산기간</span>
                  <span className="font-medium">{billPeriod}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600" />
            <div className="text-sm text-yellow-800">
              <p className="mb-1 font-medium">취소 전 확인사항</p>
              <ul className="list-inside list-disc space-y-1 text-xs">
                <li>발급된 고지서는 완전히 삭제됩니다.</li>
                <li>이미 납부된 고지서는 환불 처리 후 취소해야 합니다.</li>
                <li>취소 후에는 복구할 수 없습니다.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            닫기
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            isLoading={isLoading}
            loadingText="취소 중..."
          >
            고지서 취소
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const BatchCancelModal = ({
  isOpen,
  onClose,
  onConfirm,
  selectedBills,
  isLoading,
  currencyUnit,
  resolveStudentName,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();
return (<Modal isOpen={isOpen} onClose={onClose} size="md">
    <div className="p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-5 w-5 text-red-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-800">선택 고지서 취소</h3>
          <p className="text-sm text-slate-600">
            선택한 {selectedBills.length}개의 고지서를 취소합니다.
          </p>
        </div>
      </div>

      <div className="mb-6 max-h-40 overflow-y-auto rounded-lg bg-slate-50 p-4">
        <div className="space-y-2 text-sm">
          {selectedBills.map((bill) => (
            <div key={bill.id} className="flex items-center justify-between py-1">
              <span>
                {resolveStudentName(bill)} - {bill.name}
                <span className="ml-2 text-xs text-slate-500">
                  {getTaxBillKindMeta(bill).label}
                </span>
              </span>
              <span className="font-medium text-red-600">
                {formatDisplayMoney(Number(bill.amount || 0))} {currencyUnit}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium">이 작업은 되돌릴 수 없습니다.</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>
          닫기
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          isLoading={isLoading}
          loadingText="취소 중..."
        >
          {`${selectedBills.length}개 고지서 취소`}
        </Button>
      </div>
    </div>
  </Modal>);
};

const BillFiltersAndActions = ({
  paymentFilter,
  setPaymentFilter,
  bills,
  unpaidBills,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  selectedBillIds,
  selectedCancellableBills,
  onUnpaidBatchCancel,
  isCancelling,
  setShowBatchCancelModal,
}) => (
  <div className="border-b bg-gray-50 p-4">
    <div className="mb-4 flex gap-2">
      <Button
        size="sm"
        variant={paymentFilter === "all" ? "primary" : "outline"}
        onClick={() => setPaymentFilter("all")}
        className={paymentFilter === "all" ? "bg-indigo-600 text-white" : ""}
      >
        전체 ({bills.length})
      </Button>
      <Button
        size="sm"
        variant={paymentFilter === "unpaid" ? "primary" : "outline"}
        onClick={() => setPaymentFilter("unpaid")}
        className={
          paymentFilter === "unpaid"
            ? "bg-orange-600 text-white"
            : "border-orange-300 text-orange-600"
        }
      >
        미납 ({unpaidBills.length})
      </Button>
      <Button
        size="sm"
        variant={paymentFilter === "paid" ? "primary" : "outline"}
        onClick={() => setPaymentFilter("paid")}
        className={
          paymentFilter === "paid"
            ? "bg-green-600 text-white"
            : "border-green-300 text-green-600"
        }
      >
        납부완료 ({bills.length - unpaidBills.length})
      </Button>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-medium text-slate-700">기간 선택:</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded border border-blue-200 px-3 py-1 text-sm"
        />
        <span>~</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded border border-blue-200 px-3 py-1 text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        {selectedBillIds.size > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowBatchCancelModal(true)}
            disabled={isCancelling || selectedCancellableBills.length === 0}
            tone="red"
          >
            <Trash2 className="mr-1 h-4 w-4" />
            선택 {selectedCancellableBills.length}개 취소
          </Button>
        )}

        {unpaidBills.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              if (
                (await appConfirm(
                  `미납 고지서 ${unpaidBills.length}건을 모두 취소하시겠습니까?`,
                ))
              ) {
                onUnpaidBatchCancel(unpaidBills);
              }
            }}
            disabled={isCancelling}
            className="border-orange-200 text-orange-600 hover:bg-orange-50"
          >
            <Trash2 className="mr-1 h-4 w-4" />
            미납 고지서 일괄 취소
          </Button>
        )}
      </div>
    </div>
  </div>
);

const BillModalsAndFilters = {
  CancelConfirmModal,
  BatchCancelModal,
  FiltersAndActions: BillFiltersAndActions,
};

export default BillModalsAndFilters;
