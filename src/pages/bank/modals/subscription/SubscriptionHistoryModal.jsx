import React, { useEffect, useMemo, useState } from "react";
import { Dialog } from "@headlessui/react";
import {
  BanknotesIcon,
  CalendarIcon,
  ClockIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  Button,
  SurfaceLoader,
  TableSkeleton,
} from "../../../../components/ui";

import { loadPaymentsForProduct } from "../../services/subscriptionService";
import { formatBankMoney } from "../../../../utils/bankMoney";

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.toMillis === "function") return new Date(value.toMillis());

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizePayment = (payment, index) => {
  const paymentNum = payment?.num ?? payment?.paymentNumber ?? index + 1;
  return {
    id: `${paymentNum}-${index}`,
    paymentNumber: Number(paymentNum) || index + 1,
    originalPaymentNumber: Number(payment?.originalNum || 0) || null,
    amount: Number(payment?.amount || 0),
    paymentDate: toDate(payment?.date || payment?.paymentDate),
    isCancelled: !!payment?.isCancelled,
    currencyUnit: payment?.unit,
  };
};

export default function SubscriptionHistoryModal({
  isOpen,
  onClose,
  uid,
  classId,
  productId,
  productTitle,
  currencyUnit,
  initialPaymentHistory = null,
}) {
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const hasPaymentHistory = paymentHistory.length > 0;

  useEffect(() => {
    if (!isOpen || !uid || !classId || !productId) return;

    const loadHistory = async () => {
      if (Array.isArray(initialPaymentHistory)) {
        const normalizedInitial = initialPaymentHistory
          .map((payment, index) => normalizePayment(payment, index))
          .sort((a, b) => {
            const aTime = a.paymentDate ? a.paymentDate.getTime() : 0;
            const bTime = b.paymentDate ? b.paymentDate.getTime() : 0;
            return bTime - aTime;
          });

        setPaymentHistory(normalizedInitial);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const payments = await loadPaymentsForProduct({
          classId,
          studentUid: uid,
          productId,
        });

        const normalized = (payments || [])
          .map((payment, index) => normalizePayment(payment, index))
          .sort((a, b) => {
            const aTime = a.paymentDate ? a.paymentDate.getTime() : 0;
            const bTime = b.paymentDate ? b.paymentDate.getTime() : 0;
            return bTime - aTime;
          });

        setPaymentHistory(normalized);
      } catch (error) {
        console.error("청약 납입 이력 로드 실패:", error);
        setPaymentHistory([]);
      } finally {
        setLoading(false);
      }
    };

    void loadHistory();
  }, [classId, initialPaymentHistory, isOpen, productId, uid]);

  const summary = useMemo(() => {
    const totalCount = paymentHistory.length;
    const validPayments = paymentHistory.filter((payment) => !payment.isCancelled);

    return {
      totalCount,
      validCount: validPayments.length,
      totalAmount: paymentHistory.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      ),
      validAmount: validPayments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      ),
    };
  }, [paymentHistory]);

  const formatDate = (date) => {
    if (!date) return "-";

    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/25" />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg bg-white">
          <div className="flex items-center justify-between border-b p-6">
            <div>
              <Dialog.Title className="text-lg font-semibold text-gray-900">
                청약 납입 이력
              </Dialog.Title>
              <p className="mt-1 text-sm text-gray-600">{productTitle}</p>
            </div>
            <Button
              type="button"
              onClick={onClose}
              icon={XMarkIcon}
              iconOnly
              size="icon-md"
              tone="slate"
              kind="ghost"
              rounded="lg"
              aria-label="닫기"
              
            />
          </div>

          <div className="border-b bg-blue-50 p-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <SummaryCard
                icon={<CalendarIcon className="h-5 w-5 text-blue-600" />}
                label="전체 납입횟수"
                value={`${summary.totalCount}회`}
                valueClass="text-blue-600"
              />
              <SummaryCard
                icon={<CalendarIcon className="h-5 w-5 text-emerald-600" />}
                label="인정 납입 횟수"
                value={`${summary.validCount}회`}
                valueClass="text-emerald-600"
              />
              <SummaryCard
                icon={<BanknotesIcon className="h-5 w-5 text-slate-700" />}
                label="전체 납입금액"
                value={`${formatBankMoney(summary.totalAmount)} ${currencyUnit}`}
                valueClass="text-slate-800"
              />
              <SummaryCard
                icon={<BanknotesIcon className="h-5 w-5 text-green-600" />}
                label="인정 납입 금액"
                value={`${formatBankMoney(summary.validAmount)} ${currencyUnit}`}
                valueClass="text-green-600"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <SurfaceLoader
              loading={loading}
              variant={hasPaymentHistory ? "refreshing" : "surface-loading"}
              preserveContent={hasPaymentHistory}
              skeleton={
                <TableSkeleton
                  bare
                  columns={4}
                  rows={5}
                  className="h-full min-h-full"
                />
              }
              minHeightClassName="min-h-[280px]"
            >
              {paymentHistory.length === 0 ? (
                <div className="py-12 text-center">
                  <ClockIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                  <p className="text-gray-500">납입 이력이 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {paymentHistory.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex items-center justify-between rounded-lg bg-gray-50 p-4 transition-colors hover:bg-gray-100"
                    >
                      <div className="flex items-center">
                        <div className="mr-4 rounded-full bg-blue-100 p-2">
                          <BanknotesIcon className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {payment.isCancelled
                              ? `취소된 납입${
                                  payment.originalPaymentNumber
                                    ? ` (기존 ${payment.originalPaymentNumber}회차)`
                                    : ""
                                }`
                              : `${payment.paymentNumber}회차 납입`}
                          </p>
                          <p className="text-sm text-gray-500">
                            {formatDate(payment.paymentDate)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={`font-bold ${
                            payment.isCancelled
                              ? "text-red-600 line-through"
                              : "text-gray-900"
                          }`}
                        >
                          {formatBankMoney(payment.amount)}{" "}
                          {payment.currencyUnit || currencyUnit}
                        </p>
                        <p className="text-xs text-gray-500">
                          #
                          {payment.isCancelled
                            ? payment.originalPaymentNumber || "-"
                            : payment.paymentNumber}
                          {payment.isCancelled ? " · 취소" : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SurfaceLoader>
          </div>

          <div className="border-t bg-gray-50 p-6">
            <Button size="md"
              onClick={onClose}
              tone="slate"
              kind="solid"
              className="w-full"
            >
              닫기
            </Button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}

function SummaryCard({ icon, label, value, valueClass }) {
  return (
    <div className="rounded-xl bg-white p-4 text-center">
      <div className="mb-2 flex items-center justify-center gap-2">
        {icon}
        <span className="font-medium text-slate-700">{label}</span>
      </div>
      <p className={`text-lg font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}
