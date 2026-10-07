import React, { Suspense, useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import Button from "../../../components/ui/Button";
import Card from "../../../components/ui/Card";
import IconButton from "../../../components/ui/IconButton";
import Spinner from "../../../components/ui/Spinner";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useNotifications } from "../../../contexts/NotificationContext";
import { db } from "../../../firebase";
import { getUserFacingRecordDescription } from "../../../utils/userFacingRecordDescription";
import TaxIncomeHistoryModal from "../modals/TaxIncomeHistoryModal";
import TaxExpenseHistoryModal from "../modals/TaxExpenseHistoryModal";
import { getIncomeBadgeLabel } from "../constants/taxIncomeConstants";
import { getExpenseBadgeLabel } from "../constants/taxExpenseConstants";
import TaxPaymentModal from "../modals/TaxPaymentModal";

// === Icons ===
import { RefreshCw, TrendingUp, TrendingDown, CreditCard, FileText, BarChart3, Wallet, ClipboardList, ArrowUpRight, ArrowDownLeft, CircleAlert, Settings, ReceiptText, ChevronRight } from "lucide-react";

// === Firestore-only modals ===
const TaxBillIssuerModal = React.lazy(() => import("../modals/TaxBillIssuerModal"));
const TaxRecordModal = React.lazy(() => import("../modals/TaxRecordModal"));
const TaxBillHistoryModal = React.lazy(() => import("../modals/TaxBillHistoryModal"));
const RebuildTaxSummaryModal = React.lazy(() => import("../modals/RebuildTaxSummaryModal"));
const TaxBillLateFeeSettingsModal = React.lazy(() => import("../modals/TaxBillLateFeeSettingsModal"));
const formatSelfhostNumber = value => Number(value || 0).toLocaleString("ko-KR", {
  maximumFractionDigits: 2
});
const FirestoreTaxFinanceTab = ({
  classId,
  classData,
  currencyUnit,
  taxSummary,
  // 💡 undefined 일 수 있음
  isLoading,
  refreshTaxSummary
}) => {
  const {
    formatNumber
  } = useNumberFormat();
  const {
    actionBadges,
    badgeCounts
  } = useNotifications() || {};
  const taxActionCount = Number(actionBadges?.tax ?? badgeCounts?.tax ?? 0);
  const {
    showFeedback
  } = useFeedback();
  const {
    hasPermission,
    isTeacher
  } = useUser();
  const [modalState, setModalState] = useState({
    taxBill: false,
    taxRecord: false,
    taxBillHistory: false,
    incomeHistory: false,
    expenseHistory: false,
    taxPayment: false,
    lateFeeSettings: false
  });
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [recentActivities, setRecentActivities] = useState([]);
  const [isRecentLoading, setIsRecentLoading] = useState(true);

  // 🛡️ [방어 로직 1] 권한 및 기본 데이터 계산
  const canManageTax = hasPermission("tax_admin") || isTeacher;

  // 🛡️ [방어 로직 2] 연산 시 null/undefined 방지 (Optional Chaining + Nullish Coalescing)
  const totalIncome = taxSummary?.totalIncome ?? 0;
  const totalExpense = taxSummary?.totalExpense ?? 0;
  const balance = totalIncome - totalExpense;
  const openModal = name => setModalState(p => ({
    ...p,
    [name]: true
  }));
  const closeModal = name => setModalState(p => ({
    ...p,
    [name]: false
  }));
  useEffect(() => {
    if (!classId) {
      setRecentActivities([]);
      setIsRecentLoading(false);
      return undefined;
    }
    let cancelled = false;
    const loadRecentActivities = async () => {
      setIsRecentLoading(true);
      try {
        const [incomeSnapshot, expenseSnapshot] = await Promise.all([getDocs(query(collection(db, `classes/${classId}/taxIncomes`), orderBy("createdAt", "desc"), limit(3))), getDocs(query(collection(db, `classes/${classId}/taxExpenses`), orderBy("createdAt", "desc"), limit(3)))]);
        if (cancelled) return;
        const normalize = (snapshot, type) => snapshot.docs.map(docSnapshot => ({
          id: `${type}-${docSnapshot.id}`,
          type,
          ...docSnapshot.data()
        }));
        const nextActivities = [...normalize(incomeSnapshot, "income"), ...normalize(expenseSnapshot, "expense")].sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || a.timestamp?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || b.timestamp?.toMillis?.() || 0;
          return bTime - aTime;
        }).slice(0, 4);
        setRecentActivities(nextActivities);
      } catch (error) {
        console.error("[TaxFinanceTab] recent activities error:", error);
        if (!cancelled) setRecentActivities([]);
      } finally {
        if (!cancelled) setIsRecentLoading(false);
      }
    };
    void loadRecentActivities();
    return () => {
      cancelled = true;
    };
  }, [classId, taxSummary?.totalExpense, taxSummary?.totalIncome]);
  const handleRebuildComplete = () => {
    showFeedback("세금 데이터가 동기화되었습니다.", "success");
    if (refreshTaxSummary) refreshTaxSummary();
  };

  // 🛡️ [방어 로직 3] 초기 로딩 시 빈 화면 대신 스피너 렌더링
  if (isLoading && !taxSummary) {
    return <div className="flex flex-col items-center justify-center p-20 bg-white rounded-3xl border border-slate-100 shadow-sm">
        <Spinner size="lg" tone="blue" />
        <p className="mt-4 text-slate-500 font-medium">재정 정보 갱신 중…</p>
      </div>;
  }
  return <>
      <Card noPadding variant="flat" tone="white" rounded="3xl" className="overflow-hidden border border-slate-200 bg-white shadow-sm">
        <Card.Content noPadding className="p-0">
          <div className="grid divide-y divide-slate-100 lg:grid-cols-[minmax(270px,1.35fr)_minmax(145px,0.72fr)_minmax(145px,0.72fr)_minmax(210px,1fr)] lg:divide-x lg:divide-y-0">
            <div className="flex items-center gap-4 px-5 py-5 sm:px-7">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Wallet size={23} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">실시간 국고 잔액</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="truncate text-3xl font-black tracking-tight text-blue-600 sm:text-4xl">
                    {formatNumber(balance)}
                    <span className="ml-1.5 text-base font-bold text-blue-400">{currencyUnit}</span>
                  </p>
                  {isTeacher ? <IconButton type="button" onClick={() => setRebuildOpen(true)} icon={BarChart3} label="국고 재계산" tone="red" size="sm" className="shrink-0 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" /> : null}
                </div>
              </div>
            </div>
            <TreasuryMetric icon={ArrowUpRight} label="총 수입" value={`+${formatNumber(totalIncome)}`} tone="emerald" />
            <TreasuryMetric icon={ArrowDownLeft} label="총 지출" value={`-${formatNumber(totalExpense)}`} tone="rose" />
            <TreasuryMetric icon={CircleAlert} label={taxActionCount > 0 ? "미납 확인 필요" : "미납 알림"} value={taxActionCount > 0 ? `${taxActionCount}건` : "없음"} tone={taxActionCount > 0 ? "amber" : "slate"} actionLabel={taxActionCount > 0 ? "납부하기" : undefined} onAction={taxActionCount > 0 ? () => openModal("taxPayment") : undefined} />
          </div>
        </Card.Content>
      </Card>

      <Card noPadding variant="flat" tone="white" rounded="3xl" className="overflow-hidden border border-slate-200 bg-white shadow-sm">
        <Card.Content noPadding className="p-0">
          <div className={`grid min-h-[430px] ${canManageTax ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"}`}>
            <section className="min-w-0 px-5 py-5 sm:px-7 sm:py-6">
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-900">최근 국고 활동</h3>
                  <p className="mt-1 text-xs text-slate-500">최근 수입과 지출을 시간순으로 확인합니다.</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button type="button" tone="emerald" kind="ghost" size="sm" onClick={() => openModal("incomeHistory")}>수입 내역</Button>
                  <Button type="button" tone="rose" kind="ghost" size="sm" onClick={() => openModal("expenseHistory")}>지출 내역</Button>
                </div>
              </div>

              {isRecentLoading ? <div className="flex min-h-64 items-center justify-center"><Spinner size="md" tone="blue" /></div> : recentActivities.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center text-center">
                  <ClipboardList className="h-9 w-9 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-500">아직 기록된 국고 활동이 없습니다.</p>
                </div> : <div className="divide-y divide-slate-100">
                  {recentActivities.map(activity => <RecentTreasuryActivity key={activity.id} activity={activity} currencyUnit={currencyUnit} formatNumber={formatNumber} onClick={() => openModal(activity.type === "income" ? "incomeHistory" : "expenseHistory")} />)}
                </div>}
            </section>

            {canManageTax ? <aside className="border-t border-slate-200 bg-slate-50/40 px-5 py-5 sm:px-6 sm:py-6 lg:border-l lg:border-t-0">
                <div className="mb-4">
                  <h3 className="text-lg font-black text-slate-900">바로가기</h3>
                  <p className="mt-1 text-xs text-slate-500">자주 쓰는 세금 관리 작업입니다.</p>
                </div>
                <div className="divide-y divide-slate-200">
                  <TaxManagementAction icon={ClipboardList} title="수입·지출 기록" description="외부 수입이나 지출을 직접 입력합니다." primary onClick={() => openModal("taxRecord")} />
                  <TaxManagementAction icon={FileText} title="고지서 발급" description="특정 학생에게 세금을 청구합니다." onClick={() => openModal("taxBill")} />
                  <TaxManagementAction icon={BarChart3} title="고지서 내역" description="전체 고지서 현황을 관리합니다." onClick={() => openModal("taxBillHistory")} />
                  <TaxManagementAction icon={Settings} title="연체료 설정" description="새 고지서의 기본 연체료를 설정합니다." tone="amber" onClick={() => openModal("lateFeeSettings")} />
                </div>
              </aside> : null}
          </div>
        </Card.Content>
      </Card>
      {/* === 모달 섹션 === */}
      <Suspense fallback={null}>
      {modalState.taxBill && <TaxBillIssuerModal isOpen={modalState.taxBill} onClose={() => closeModal("taxBill")} />}
      {modalState.taxRecord && <TaxRecordModal isOpen={modalState.taxRecord} onClose={() => closeModal("taxRecord")} classId={classId} />}
      {modalState.taxBillHistory && <TaxBillHistoryModal isOpen={modalState.taxBillHistory} onClose={() => closeModal("taxBillHistory")} classId={classId} />}
      {modalState.incomeHistory && <TaxIncomeHistoryModal isOpen={modalState.incomeHistory} onClose={() => closeModal("incomeHistory")} classId={classId} currencyUnit={currencyUnit} />}
      {modalState.expenseHistory && <TaxExpenseHistoryModal isOpen={modalState.expenseHistory} onClose={() => closeModal("expenseHistory")} classId={classId} currencyUnit={currencyUnit} />}
      {modalState.taxPayment && <TaxPaymentModal isOpen={modalState.taxPayment} onClose={() => closeModal("taxPayment")} classId={classId} currencyUnit={currencyUnit} />}
      {modalState.lateFeeSettings && <TaxBillLateFeeSettingsModal isOpen={modalState.lateFeeSettings} onClose={() => closeModal("lateFeeSettings")} classId={classId} classData={classData} />}
      {rebuildOpen && <RebuildTaxSummaryModal isOpen={rebuildOpen} onClose={() => setRebuildOpen(false)} classId={classId} onAfterRebuild={handleRebuildComplete} />}
      </Suspense>
    </>;
};
const TREASURY_METRIC_TONES = {
  emerald: "text-emerald-700 bg-emerald-50",
  rose: "text-rose-700 bg-rose-50",
  amber: "text-amber-700 bg-amber-50",
  slate: "text-slate-700 bg-slate-100"
};
function TreasuryMetric({
  icon: Icon,
  label,
  value,
  tone,
  actionLabel,
  onAction
}) {
  return <div className="flex min-w-0 items-center gap-2.5 px-4 py-4">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TREASURY_METRIC_TONES[tone]}`}>
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="whitespace-nowrap text-xs font-bold text-slate-500">{label}</p>
        <p className={`mt-1 whitespace-nowrap text-xl font-black ${TREASURY_METRIC_TONES[tone].split(" ")[0]}`}>{value}</p>
      </div>
      {onAction ? <button type="button" onClick={onAction} className="shrink-0 rounded-lg bg-amber-500 px-2.5 py-2 text-[11px] font-black text-white transition hover:bg-amber-600">
          {actionLabel}
        </button> : null}
    </div>;
}
function RecentTreasuryActivity({
  activity,
  currencyUnit,
  formatNumber,
  onClick
}) {
  const isIncome = activity.type === "income";
  const rawDate = activity.createdAt?.toDate?.() || activity.timestamp?.toDate?.();
  const periodDateMatch = isIncome && activity.source === "period_tax_settlement" ? String(activity.periodEnd || "").match(/^\d{4}-(\d{2})-(\d{2})$/) : null;
  const dateLabel = periodDateMatch ? `${Number(periodDateMatch[1])}. ${Number(periodDateMatch[2])}.` : rawDate ? rawDate.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }) : "날짜 없음";
  const typeLabel = isIncome ? getIncomeBadgeLabel(activity, currencyUnit) : getExpenseBadgeLabel(activity);
  const title = getUserFacingRecordDescription(activity, typeLabel);
  const detail = title === typeLabel ? isIncome ? "수입 기록" : "지출 기록" : typeLabel;
  return <button type="button" onClick={onClick} className="group grid w-full grid-cols-[84px_minmax(0,1fr)_auto] items-center gap-3 px-1 py-4 text-left transition hover:bg-slate-50 sm:grid-cols-[92px_minmax(0,1fr)_150px_110px]">
      <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-black ${isIncome ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
        {isIncome ? "수입" : "지출"}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-black text-slate-800">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-400">{detail}</span>
      </span>
      <span className={`text-right text-sm font-black ${isIncome ? "text-emerald-700" : "text-rose-700"}`}>
        {isIncome ? "+" : "-"}{formatNumber(activity.amount || 0)}{currencyUnit}
      </span>
      <span className="hidden items-center justify-end gap-1 text-xs text-slate-400 sm:flex">
        {dateLabel}<ChevronRight size={15} className="transition group-hover:translate-x-0.5" />
      </span>
    </button>;
}
function TaxManagementAction({
  icon: Icon,
  title,
  description,
  onClick,
  primary = false,
  tone = "blue"
}) {
  const iconTone = tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600";
  return <button type="button" onClick={onClick} className={`group flex w-full items-center gap-3 py-4 text-left transition ${primary ? "text-blue-700" : "text-slate-800"}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${primary ? "bg-blue-600 text-white" : iconTone}`}>
        <Icon size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-400">{description}</span>
      </span>
      <ChevronRight size={17} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500" />
    </button>;
}
const SelfhostTaxFinanceTab = ({
  currencyUnit,
  taxSummary,
  isLoading,
  refreshTaxSummary,
  selfhostTaxAdapter = {}
}) => {
  const [modalState, setModalState] = useState({
    incomeHistory: false,
    expenseHistory: false
  });
  const totalIncome = taxSummary?.totalIncome ?? 0;
  const totalExpense = taxSummary?.totalExpense ?? 0;
  const balance = totalIncome - totalExpense;
  const history = selfhostTaxAdapter.history || {};
  const openHistory = type => {
    selfhostTaxAdapter.onSetHistoryType?.(type);
    setModalState({
      incomeHistory: type === "INCOME",
      expenseHistory: type === "EXPENSE"
    });
  };
  const closeHistory = () => {
    setModalState({
      incomeHistory: false,
      expenseHistory: false
    });
  };
  if (isLoading && !taxSummary) {
    return <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-100 bg-white p-20 shadow-sm">
        <Spinner size="lg" tone="blue" />
        <p className="mt-4 font-medium text-slate-500">Loading tax finance data...</p>
      </div>;
  }
  return <>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div data-tour="tax-finance-summary">
          <Card variant="elevated" tone="white" rounded="3xl" className="relative h-full overflow-hidden border-0 shadow-xl shadow-slate-200/40 ring-1 ring-slate-100/50">
            <div className="pointer-events-none absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-blue-50 opacity-50 blur-3xl" />
            <Card.Content className="relative z-10 flex h-full flex-col p-6">
              <div className="mb-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
                    <Wallet size={24} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">Tax Finance</h3>
                    <p className="text-xs text-slate-500">Selfhost API summary</p>
                  </div>
                </div>
                <IconButton type="button" onClick={refreshTaxSummary} icon={RefreshCw} label="Refresh" tone="blue" size="md" isLoading={isLoading} className="rounded-xl text-slate-400 hover:bg-blue-50 hover:text-blue-600" />
              </div>

              <div className="flex-1 space-y-6">
                <div className="rounded-3xl border border-slate-100 bg-slate-50/50 py-8 text-center">
                  <div className="flex items-baseline justify-center text-blue-600">
                    <span className="text-5xl font-black tracking-normal">
                      {formatSelfhostNumber(balance)}
                    </span>
                    <span className="ml-1.5 text-xl font-bold opacity-60">{currencyUnit}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-emerald-100/50 bg-emerald-50/30 p-4">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                      <ArrowUpRight size={14} /> Total income
                    </div>
                    <div className="text-lg font-black text-emerald-700">
                      +{formatSelfhostNumber(totalIncome)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-rose-100/50 bg-rose-50/30 p-4">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-rose-600">
                      <ArrowDownLeft size={14} /> Total expense
                    </div>
                    <div className="text-lg font-black text-rose-700">
                      -{formatSelfhostNumber(totalExpense)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-2 gap-3 border-t border-slate-100 pt-6">
                <Button onClick={() => openHistory("INCOME")} tone="emerald" kind="soft" size="md" icon={TrendingUp} className="w-full justify-center">
                  Income history
                </Button>
                <Button onClick={() => openHistory("EXPENSE")} tone="rose" kind="soft" size="md" icon={TrendingDown} className="w-full justify-center">
                  Expense history
                </Button>
              </div>
            </Card.Content>
          </Card>
        </div>

        <div data-tour="tax-finance-management">
          <Card variant="elevated" tone="white" rounded="3xl" className="relative h-full overflow-hidden border-0 shadow-xl shadow-slate-200/40 ring-1 ring-slate-100/50">
            <div className="pointer-events-none absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-indigo-50 opacity-60 blur-3xl" />
            <Card.Content className="relative z-10 flex h-full flex-col p-6">
              <div className="mb-8 flex items-center gap-3">
                <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600">
                  <BarChart3 size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Tax Controls</h3>
                  <p className="text-xs text-slate-500">Use the command panel below for writes</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatusTile icon={ClipboardList} title="Manual records" value={taxSummary?.recordCount || 0} />
                <StatusTile icon={FileText} title="Bills" value={taxSummary?.billCount || 0} />
                <StatusTile icon={CreditCard} title="Unpaid bills" value={taxSummary?.unpaidBillCount || 0} />
                <StatusTile icon={ReceiptText} title="Paid bills" value={taxSummary?.paidBillCount || 0} />
              </div>
            </Card.Content>
          </Card>
        </div>
      </div>

      <TaxIncomeHistoryModal adapterMode="selfhost" isOpen={modalState.incomeHistory} onClose={closeHistory} records={history.incomeRecords || []} currencyUnit={currencyUnit} filters={history.filters} students={history.students} isLoading={isLoading} isLoadingMore={history.isLoadingMore} hasMore={history.hasMore} onApply={history.onApply} onLoadMore={history.onLoadMore} onFiltersChange={history.onFiltersChange} onReset={() => history.onReset?.("INCOME")} />
      <TaxExpenseHistoryModal adapterMode="selfhost" isOpen={modalState.expenseHistory} onClose={closeHistory} records={history.expenseRecords || []} currencyUnit={currencyUnit} filters={history.filters} students={history.students} isLoading={isLoading} isLoadingMore={history.isLoadingMore} hasMore={history.hasMore} onApply={history.onApply} onLoadMore={history.onLoadMore} onFiltersChange={history.onFiltersChange} onReset={() => history.onReset?.("EXPENSE")} />
    </>;
};
function StatusTile({
  icon: Icon,
  title,
  value
}) {
  return <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-slate-500">
        <Icon size={16} />
        <span className="text-xs font-bold uppercase tracking-normal">{title}</span>
      </div>
      <div className="text-2xl font-black text-slate-800">{formatSelfhostNumber(value)}</div>
    </div>;
}
const TaxFinanceTab = ({
  adapterMode,
  selfhostTaxAdapter,
  ...props
}) => {
  return <FirestoreTaxFinanceTab {...props} />;
};
export default TaxFinanceTab;
