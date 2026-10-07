import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useState, useEffect, useCallback } from "react";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  Modal,
  Button,
  Checkbox,
  SurfaceLoader,
  TableSkeleton,
} from "../../../components/ui";
import {
  AlertCircle,
  CreditCard,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Wallet,
  Info,
} from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";
import {
  formatTaxBillDate,
  formatTaxBillPeriod,
  calculateTaxBillLateFee,
  getTaxBillKindMeta,
  getTaxBillSourceLabel,
  getTaxBillSourceSummary,
  getTaxBillTotalDue,
} from "../../../utils/taxBillUtils";

const TaxPaymentModal = ({ isOpen, onClose, classId, currencyUnit }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { userData } = useUser();
  const { showFeedback } = useFeedback();
  const [unpaidBills, setUnpaidBills] = useState([]);
  const [selectedBills, setSelectedBills] = useState(new Set());
  const [expandedBillIds, setExpandedBillIds] = useState(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [studentBalance, setStudentBalance] = useState(0);

  const fetchUnpaidBillsAndBalance = useCallback(async () => {
    if (!classId || !userData?.uid) return;

    setIsLoading(true);
    try {
      const getUnpaidTaxBills = httpsCallable(functions, "getUnpaidTaxBills");
      const result = await getUnpaidTaxBills({ classId });

      if (!result.data.success) {
        throw new Error("세금 고지서 정보를 불러오지 못했습니다.");
      }

      setUnpaidBills(result.data.unpaidBills || []);
      setStudentBalance(Number(result.data.studentBalance || 0));
    } catch (error) {
      console.error("세금 고지서 조회 실패:", error);
      showFeedback(
        error.message || "세금 고지서를 불러오는 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsLoading(false);
    }
  }, [classId, userData?.uid, showFeedback]);

  useEffect(() => {
    if (isOpen) {
      fetchUnpaidBillsAndBalance();
      setSelectedBills(new Set());
      setExpandedBillIds(new Set());
    }
  }, [isOpen, fetchUnpaidBillsAndBalance]);

  const toggleBillSelection = (billId) => {
    setSelectedBills((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) {
        next.delete(billId);
      } else {
        next.add(billId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedBills.size === unpaidBills.length) {
      setSelectedBills(new Set());
      return;
    }
    setSelectedBills(new Set(unpaidBills.map((bill) => bill.id)));
  };

  const toggleBreakdown = (billId) => {
    setExpandedBillIds((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) {
        next.delete(billId);
      } else {
        next.add(billId);
      }
      return next;
    });
  };

  const selectedBillsData = unpaidBills.filter((bill) => selectedBills.has(bill.id));
  const totalAmount = selectedBillsData.reduce(
    (sum, bill) => sum + getTaxBillTotalDue(bill),
    0,
  );
  const totalLateFeeAmount = selectedBillsData.reduce(
    (sum, bill) => sum + calculateTaxBillLateFee(bill).amount,
    0,
  );
  const hasUnpaidBills = unpaidBills.length > 0;

  const handlePayment = async () => {
    if (selectedBills.size === 0) {
      showFeedback("납부할 고지서를 선택해 주세요.", "warning");
      return;
    }

    if (studentBalance < totalAmount) {
      showFeedback("보유 자산이 부족해서 납부할 수 없습니다.", "error");
      return;
    }

    setIsPaymentProcessing(true);
    try {
      const processTaxPayment = httpsCallable(functions, "processTaxPayment");
      const result = await processTaxPayment({
        classId,
        billIds: Array.from(selectedBills),
      });

      if (!result.data.success) {
        throw new Error(result.data.message || "납부 처리에 실패했습니다.");
      }

      showFeedback("세금 납부가 완료되었습니다.", "success");
      await fetchUnpaidBillsAndBalance();
      setSelectedBills(new Set());
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      showFeedback(error.message || "납부 중 오류가 발생했습니다.", "error");
    } finally {
      setIsPaymentProcessing(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="세금 납부하기" size="lg">
      <div className="space-y-6">
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-blue-50 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white p-2 shadow-sm">
                <Wallet className="h-6 w-6 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-indigo-900/70">현재 보유 자산</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-black text-indigo-600">
                    {formatDisplayMoney(studentBalance)}
                  </span>
                  <span className="text-sm font-bold text-indigo-400">
                    {currencyUnit}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-white/80 px-3 py-1 text-xs font-bold text-indigo-600">
                <Info size={14} /> 미납 고지서 {unpaidBills.length}건
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <SurfaceLoader
            loading={isLoading}
            variant={hasUnpaidBills ? "refreshing" : "surface-loading"}
            preserveContent={hasUnpaidBills}
            skeleton={
              <TableSkeleton
                bare
                columns={4}
                rows={5}
                className="h-full min-h-full"
              />
            }
            minHeightClassName="min-h-[360px]"
          >
            {hasUnpaidBills ? (
              <>
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="select-all-tax-bills"
                      checked={selectedBills.size === unpaidBills.length}
                      onChange={toggleSelectAll}
                    />
                    <label
                      htmlFor="select-all-tax-bills"
                      className="cursor-pointer text-sm font-bold text-slate-700"
                    >
                      전체 선택
                    </label>
                  </div>
                  <p className="text-xs font-bold text-slate-400">
                    카드 전체를 눌러 선택하거나 해제할 수 있습니다.
                  </p>
                </div>

                <div className="grid max-h-[320px] gap-3 overflow-y-auto pr-2 custom-scrollbar">
                  {unpaidBills.map((bill) => {
                    const isBreakdownOpen = expandedBillIds.has(bill.id);
                    const billKindMeta = getTaxBillKindMeta(bill);
                    const billPeriod = formatTaxBillPeriod(bill);
                    const billSourceSummary = getTaxBillSourceSummary(bill);
                    const displayBillName =
                      bill.name ||
                      (bill.billKind === "income_settlement" ? "??? ???" : "?? ???");
                    const lateFee = calculateTaxBillLateFee(bill);
                    const principalAmount = Number(bill.amount || 0);
                    const billTotalDue = getTaxBillTotalDue(bill);
                    const settlementBreakdown = Array.isArray(bill.settlementBreakdown)
                      ? bill.settlementBreakdown.filter(
                          (item) =>
                            Number(item?.grossAmount || 0) !== 0 ||
                            Number(item?.taxAmount || 0) !== 0,
                        )
                      : [];
                    const holdingBreakdown = Array.isArray(bill?.meta?.deskBreakdown)
                      ? bill.meta.deskBreakdown.filter(
                          (item) => Number(item?.taxAmount || 0) > 0,
                        )
                      : [];
                    const detailBreakdown = holdingBreakdown.length > 0
                      ? holdingBreakdown.map((item, index) => ({
                          key: `${bill.id}_${item.deskId || index}`,
                          label: `${item.deskLabel || item.deskId || '자리'} · ${Number(item.holdingDays || 0)}일`,
                          amount: Number(item.taxAmount || 0),
                        }))
                      : settlementBreakdown.map((item, index) => ({
                          key: `${bill.id}_${item.sourceType || index}`,
                          label: `${item.label || getTaxBillSourceLabel(item.sourceType)} 세금`,
                          amount: Number(item.taxAmount || 0),
                        }));

                    return (
                      <div
                        key={bill.id}
                        onClick={() => toggleBillSelection(bill.id)}
                        className={`group relative cursor-pointer rounded-xl border-2 p-4 transition-all ${
                          selectedBills.has(bill.id)
                            ? "border-indigo-500 bg-indigo-50/30"
                            : "border-slate-100 bg-white hover:border-slate-200"
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <Checkbox
                            checked={selectedBills.has(bill.id)}
                            readOnly
                            className="mt-1"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4 className="truncate font-bold text-slate-800">
                                  {displayBillName}
                                </h4>
                              </div>
                              <div className="shrink-0 text-right">
                                <span className="font-black text-rose-500">
                                  {formatDisplayMoney(billTotalDue)}
                                  {currencyUnit}
                                </span>
                                {lateFee.amount > 0 && (
                                  <p className="text-[11px] font-bold text-rose-400">
                                    원금 {formatDisplayMoney(principalAmount)}
                                    {currencyUnit} + 연체료{" "}
                                    {formatDisplayMoney(lateFee.amount)}
                                    {currencyUnit}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                  {billKindMeta.label}
                                </span>
                                {billPeriod && (
                                  <span className="text-[11px] font-medium text-slate-400">
                                    {billPeriod}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                                <Clock size={12} /> ??? {formatTaxBillDate(bill.issuedDate || bill.issuedAt)}
                              </div>

                              {bill.dueDate && (
                                <div className="text-xs font-medium text-slate-400">
                                  납부기한 {formatTaxBillDate(bill.dueDate)}
                                  {lateFee.overdueDays > 0 &&
                                    ` · 연체 ${lateFee.overdueDays}일`}
                                </div>
                              )}

                              {billSourceSummary && (
                                <div className="text-xs font-medium text-slate-500">
                                  {billSourceSummary}
                                </div>
                              )}

                              {detailBreakdown.length > 0 && (
                                <div className="mt-2">
                                  <Button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleBreakdown(bill.id);
                                    }}
                                    size="xs"
                                    kind="ghost"
                                    tone="blue"
                                    rounded="lg"
                                    className="-mx-2 mt-1"
                                  >
                                    {isBreakdownOpen ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                    상세 내역
                                  </Button>
                                  {isBreakdownOpen && (
                                    <div
                                      className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {detailBreakdown.map((item) => (
                                        <div
                                          key={item.key}
                                          className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200"
                                        >
                                          <p className="text-sm font-semibold text-slate-900">
                                            {item.label}{" "}
                                            {formatDisplayMoney(Number(item.amount || 0))}
                                            {currencyUnit}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {selectedBills.size > 0 && (
                  <div
                    className={`rounded-2xl border-2 p-5 shadow-sm transition-all ${
                      studentBalance >= totalAmount
                        ? "border-indigo-100 bg-indigo-50/20"
                        : "border-rose-100 bg-rose-50/20"
                    }`}
                  >
                    <h4 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-400">
                      결제 요약
                    </h4>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-slate-500">
                          선택한 고지서 ({selectedBills.size}건)
                        </span>
                        <span className="font-bold text-slate-700">
                          {formatDisplayMoney(totalAmount - totalLateFeeAmount)}
                          {currencyUnit}
                        </span>
                      </div>
                      {totalLateFeeAmount > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="font-medium text-rose-500">
                            연체료 합계
                          </span>
                          <span className="font-bold text-rose-500">
                            {formatDisplayMoney(totalLateFeeAmount)}
                            {currencyUnit}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
                        <span className="font-bold text-slate-800">
                          납부 후 예상 잔액
                        </span>
                        <span
                          className={`text-lg font-black ${
                            studentBalance >= totalAmount
                              ? "text-indigo-600"
                              : "text-rose-500"
                          }`}
                        >
                          {formatDisplayMoney(studentBalance - totalAmount)}
                          {currencyUnit}
                        </span>
                      </div>
                      {studentBalance < totalAmount && (
                        <div className="mt-2 flex items-center gap-2 rounded-xl bg-rose-500/10 p-2.5">
                          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                          <p className="text-[11px] font-bold leading-tight text-rose-700">
                            자산이 부족합니다.{" "}
                            {formatDisplayMoney(totalAmount - studentBalance)}
                            {currencyUnit}이 더 필요합니다.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center">
                <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-emerald-400" />
                <h3 className="mb-1 text-lg font-bold text-slate-800">
                  납부할 세금이 없습니다.
                </h3>
                <p className="text-sm font-medium text-slate-400">
                  납부할 고지서가 없어요.
                </p>
              </div>
            )}
          </SurfaceLoader>
        </div>

        <div className="flex gap-3 pt-2">
          <Button size="md"
            type="button"
            onClick={onClose}
            variant="ghost"
            className="flex-1"
            disabled={isPaymentProcessing}
          >
            닫기
          </Button>
          {unpaidBills.length > 0 && (
            <Button
              onClick={handlePayment}
              className={`flex-[2] rounded-2xl py-6 text-lg font-black shadow-lg transition-all ${
                studentBalance >= totalAmount
                  ? "bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700"
                  : "cursor-not-allowed bg-slate-200 text-slate-400"
              }`}
              disabled={
                selectedBills.size === 0 ||
                isPaymentProcessing ||
                studentBalance < totalAmount
              }
              isLoading={isPaymentProcessing}
              loadingText="납부 중…"
              icon={CreditCard}
            >
              {totalAmount > 0
                ? `${formatDisplayMoney(totalAmount)}${currencyUnit} 납부하기`
                : "납부하기"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default TaxPaymentModal;

