import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import {
  BanknotesIcon,
  ChartBarIcon,
  DocumentTextIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { Modal, Spinner, Button } from "../../../../components/ui";
import { useClassStudents } from "../../../../hooks/user/useClassStudents";
import { db } from "../../../../firebase";
import { formatBankMoney } from "../../../../utils/bankMoney";
import ProductPaymentsModal from "./ProductPaymentsModal";

const OVERVIEW_STALE_TIME_MS = 60 * 1000;
const OVERVIEW_GC_TIME_MS = 15 * 60 * 1000;

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.toMillis === "function") return new Date(value.toMillis());
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value) => {
  const date = toDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const getValidHistory = (paymentHistory = []) =>
  paymentHistory.filter((entry) => !entry?.isCancelled);

const getLatestPaymentAt = (paymentHistory = []) => {
  const latestEntry = [...paymentHistory].sort((a, b) => {
    const aTime = toDate(a?.date || a?.paymentDate)?.getTime?.() || 0;
    const bTime = toDate(b?.date || b?.paymentDate)?.getTime?.() || 0;
    return bTime - aTime;
  })[0];

  return toDate(latestEntry?.date || latestEntry?.paymentDate);
};

async function fetchSubscriptionProducts(classId) {
  const snapshot = await getDocs(
    collection(db, "classes", classId, "subscriptionProducts"),
  );

  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
}

async function fetchSubscriptions(classId) {
  const snapshot = await getDocs(collection(db, "classes", classId, "subscriptions"));

  return snapshot.docs.map((docSnap) => ({
    uid: docSnap.id,
    ...docSnap.data(),
  }));
}

function normalizeProducts({ subscriptions, productMap }) {
  const statsMap = new Map();

  subscriptions.forEach((subscription) => {
    const activeSubscriptions = subscription.activeSubscriptions || {};

    Object.entries(activeSubscriptions).forEach(([productId, productValue]) => {
      const paymentHistory = Array.isArray(productValue?.paymentHistory)
        ? productValue.paymentHistory
        : [];
      const validHistory = getValidHistory(paymentHistory);
      const current = statsMap.get(productId) || {
        productId,
        title:
          productValue?.productTitle ||
          productMap.get(productId)?.title ||
          `청약 상품 ${productId}`,
        participantCount: 0,
        paymentCount: 0,
        validPaymentCount: 0,
        totalAmount: 0,
        validTotalAmount: 0,
        latestPaymentAt: null,
        earlyTerminationBlocked:
          productMap.get(productId)?.earlyTerminationBlocked === true,
        participantUids: new Set(),
      };

      current.participantUids.add(subscription.uid);
      current.participantCount = current.participantUids.size;
      current.paymentCount += paymentHistory.length;
      current.validPaymentCount += validHistory.length;
      current.totalAmount += paymentHistory.reduce(
        (sum, entry) => sum + Number(entry?.amount || 0),
        0,
      );
      current.validTotalAmount += validHistory.reduce(
        (sum, entry) => sum + Number(entry?.amount || 0),
        0,
      );

      const latestPaymentAt = getLatestPaymentAt(paymentHistory);
      if (
        latestPaymentAt &&
        (!current.latestPaymentAt || latestPaymentAt > current.latestPaymentAt)
      ) {
        current.latestPaymentAt = latestPaymentAt;
      }

      statsMap.set(productId, current);
    });
  });

  return Array.from(statsMap.values()).sort((a, b) =>
    String(a.title || "").localeCompare(String(b.title || ""), "ko"),
  );
}

function buildStudentRows({ subscriptions, studentMap, selectedProductId }) {
  return subscriptions
    .map((subscription) => {
      const productValue = subscription.activeSubscriptions?.[selectedProductId];
      if (!productValue) return null;

      const paymentHistory = Array.isArray(productValue?.paymentHistory)
        ? productValue.paymentHistory
        : [];
      const validHistory = getValidHistory(paymentHistory);
      const student = studentMap.get(subscription.uid) || {};

      return {
        uid: subscription.uid,
        studentName: student.name || subscription.uid,
        studentNumber: Number(student.studentNumber || 0),
        paymentCount: paymentHistory.length,
        validPaymentCount: validHistory.length,
        totalAmount: paymentHistory.reduce(
          (sum, entry) => sum + Number(entry?.amount || 0),
          0,
        ),
        validTotalAmount: validHistory.reduce(
          (sum, entry) => sum + Number(entry?.amount || 0),
          0,
        ),
        latestPaymentAt: getLatestPaymentAt(paymentHistory),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.studentNumber !== b.studentNumber) {
        return a.studentNumber - b.studentNumber;
      }

      return String(a.studentName || "").localeCompare(
        String(b.studentName || ""),
        "ko",
      );
    });
}

export default function SubscriptionOverviewModal({
  isOpen,
  onClose,
  classId,
  currencyUnit = "원",
  ...modalProps
}) {
  const [selectedProductId, setSelectedProductId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);

  const {
    data: students = [],
    isLoading: studentsLoading,
  } = useClassStudents(classId, {
    enabled: isOpen && !!classId,
    realtime: false,
  });

  const productsQuery = useQuery({
    queryKey: ["subscriptionOverviewProducts", classId],
    queryFn: () => fetchSubscriptionProducts(classId),
    enabled: isOpen && !!classId,
    staleTime: OVERVIEW_STALE_TIME_MS,
    gcTime: OVERVIEW_GC_TIME_MS,
  });

  const subscriptionsQuery = useQuery({
    queryKey: ["subscriptionOverviewSubscriptions", classId],
    queryFn: () => fetchSubscriptions(classId),
    enabled: isOpen && !!classId,
    staleTime: OVERVIEW_STALE_TIME_MS,
    gcTime: OVERVIEW_GC_TIME_MS,
  });

  const loading =
    studentsLoading || productsQuery.isPending || subscriptionsQuery.isPending;
  const error = productsQuery.error || subscriptionsQuery.error || null;

  const productMap = useMemo(() => {
    return new Map(
      (productsQuery.data || []).map((product) => [product.id, product]),
    );
  }, [productsQuery.data]);

  const studentMap = useMemo(() => {
    return new Map(students.map((student) => [student.uid, student]));
  }, [students]);

  const productRows = useMemo(() => {
    return normalizeProducts({
      subscriptions: subscriptionsQuery.data || [],
      productMap,
    });
  }, [productMap, subscriptionsQuery.data]);

  useEffect(() => {
    if (!productRows.length) {
      setSelectedProductId("");
      return;
    }

    setSelectedProductId((current) => {
      if (current && productRows.some((row) => row.productId === current)) {
        return current;
      }
      return productRows[0].productId;
    });
  }, [productRows]);

  const selectedProduct = useMemo(() => {
    return productRows.find((row) => row.productId === selectedProductId) || null;
  }, [productRows, selectedProductId]);

  const studentRows = useMemo(() => {
    if (!selectedProductId) return [];
    return buildStudentRows({
      subscriptions: subscriptionsQuery.data || [],
      studentMap,
      selectedProductId,
    });
  }, [selectedProductId, studentMap, subscriptionsQuery.data]);

  const summary = useMemo(() => {
    return {
      participantCount: Number(selectedProduct?.participantCount || 0),
      paymentCount: Number(selectedProduct?.paymentCount || 0),
      validPaymentCount: Number(selectedProduct?.validPaymentCount || 0),
      validTotalAmount: Number(selectedProduct?.validTotalAmount || 0),
    };
  }, [selectedProduct]);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="청약 현황" size="xl" {...modalProps}>
        <div className="space-y-6">
          <section className="rounded-3xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-blue-50 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-bold tracking-wide text-emerald-700">
                  SUBSCRIPTION STATUS
                </p>
                <h3 className="mt-1 text-2xl font-black text-slate-900">
                  {selectedProduct?.title || "청약 상품 현황"}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  상품별 가입자와 납입 현황을 한눈에 확인할 수 있습니다.
                </p>
              </div>
              {selectedProduct ? (
                <Button size="md"
                  tone="blue"
                  onClick={() => setDetailOpen(true)}
                  
                >
                  전체 납입 내역 보기
                </Button>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <StatCard
                icon={<UserGroupIcon className="h-5 w-5 text-emerald-600" />}
                label="가입 학생"
                value={`${summary.participantCount}명`}
              />
              <StatCard
                icon={<DocumentTextIcon className="h-5 w-5 text-indigo-600" />}
                label="전체 납입 횟수"
                value={`${summary.paymentCount}회`}
              />
              <StatCard
                icon={<ChartBarIcon className="h-5 w-5 text-blue-600" />}
                label="유효 납입 횟수"
                value={`${summary.validPaymentCount}회`}
              />
              <StatCard
                icon={<BanknotesIcon className="h-5 w-5 text-amber-600" />}
                label="유효 납입 총액"
                value={`${formatBankMoney(summary.validTotalAmount)} ${currencyUnit}`}
              />
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h4 className="text-sm font-black text-slate-900">상품 선택</h4>
              <p className="text-xs text-slate-500">
                상품을 선택하면 해당 상품의 학생별 납입 현황을 아래에서 볼 수 있습니다.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {productRows.map((row) => (
                <FilterCard
                  key={row.productId}
                  active={selectedProductId === row.productId}
                  title={row.title}
                  subtitle={`최근 납입 ${formatDateTime(row.latestPaymentAt)}`}
                  participantCount={row.participantCount}
                  paymentCount={row.paymentCount}
                  totalAmount={row.validTotalAmount}
                  currencyUnit={currencyUnit}
                  onClick={() => setSelectedProductId(row.productId)}
                />
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h4 className="text-base font-black text-slate-900">학생별 현황</h4>
              <p className="mt-1 text-sm text-slate-500">
                선택한 상품에 가입한 학생들의 납입 현황입니다.
              </p>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-24">
                <Spinner size="lg" />
                <p className="mt-4 text-sm font-semibold text-slate-400">
                  청약 현황을 불러오는 중입니다...
                </p>
              </div>
            ) : error ? (
              <div className="px-5 py-16 text-center text-sm text-rose-600">
                청약 현황을 불러오는 중 문제가 발생했습니다.
              </div>
            ) : (
              <StudentTable rows={studentRows} currencyUnit={currencyUnit} />
            )}
          </section>
        </div>
      </Modal>

      <ProductPaymentsModal
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        classId={classId}
        productId={selectedProductId}
        earlyTerminationBlocked={selectedProduct?.earlyTerminationBlocked === true}
        currencyUnit={currencyUnit}
        canCancel
      />
    </>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-black text-slate-900">{value}</p>
    </div>
  );
}

function FilterCard({
  active,
  title,
  subtitle,
  participantCount,
  paymentCount,
  totalAmount,
  currencyUnit,
  onClick,
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      tone="emerald"
      kind={active ? "soft" : "outline"}
      rounded="xl"
      className={`rounded-2xl border p-4 text-left transition ${
        active
          ? "border-emerald-400 bg-emerald-50 shadow-sm ring-2 ring-emerald-200"
          : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-black text-slate-900">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        {active ? (
          <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white">
            선택됨
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniMetric label="학생" value={`${participantCount}명`} />
        <MiniMetric label="납입" value={`${paymentCount}회`} />
        <MiniMetric
          label="총액"
          value={`${formatBankMoney(totalAmount)} ${currencyUnit}`}
          compact
        />
      </div>
    </Button>
  );
}

function MiniMetric({ label, value, compact = false }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className={`mt-1 font-black text-slate-800 ${compact ? "text-xs" : "text-sm"}`}>
        {value}
      </p>
    </div>
  );
}

function StudentTable({ rows, currencyUnit }) {
  return (
    <div className="max-h-[460px] overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-slate-100">
          <tr>
            <th className="px-4 py-3 text-left font-bold text-slate-600">학생</th>
            <th className="px-4 py-3 text-center font-bold text-slate-600">전체 납입 횟수</th>
            <th className="px-4 py-3 text-center font-bold text-slate-600">유효 납입 횟수</th>
            <th className="px-4 py-3 text-right font-bold text-slate-600">전체 납입 총액</th>
            <th className="px-4 py-3 text-right font-bold text-slate-600">유효 납입 총액</th>
            <th className="px-4 py-3 text-center font-bold text-slate-600">최근 납입일</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                표시할 학생 데이터가 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.uid} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-800">
                  <div className="flex items-center gap-2">
                    {row.studentNumber ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">
                        {row.studentNumber}번
                      </span>
                    ) : null}
                    <span>{row.studentName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">{row.paymentCount}회</td>
                <td className="px-4 py-3 text-center">{row.validPaymentCount}회</td>
                <td className="px-4 py-3 text-right font-bold text-slate-800">
                  {formatBankMoney(row.totalAmount)} {currencyUnit}
                </td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700">
                  {formatBankMoney(row.validTotalAmount)} {currencyUnit}
                </td>
                <td className="px-4 py-3 text-center text-slate-600">
                  {formatDateTime(row.latestPaymentAt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
