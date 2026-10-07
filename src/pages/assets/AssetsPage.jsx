import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Building2,
  ChevronDown,
  CircleDollarSign,
  FileText,
  Filter,
  Landmark,
  Package,
  PiggyBank,
  Search,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import AppLayout from "../../components/layout/AppLayout";
import { Button, Card, PageHeader, Spinner, Tabs } from "../../components/ui";
import {
  ACTIVITY_CATEGORY_GROUPS,
  ACTIVITY_CATEGORY_OPTIONS,
} from "../../constants/financeExportConfig";
import { useNumberFormat } from "../../contexts/NumberFormatContext";
import { useUser } from "../../contexts/UserContext";
import { db } from "../../firebase";
import {
  ACTIVITY_LOG_SCOPE,
  buildActivityLogQuery,
  convertFirestoreDocToActivity,
  calculateActivityStatistics,
  getActivityDisplayInfo,
  getDefaultDateRange,
} from "../../utils/activityUtils";
import { getUserFacingRecordDescription } from "../../utils/userFacingRecordDescription";
import NetWorthTrendChart from "../dashboard/components/NetWorthTrendChart";
import PaySlipModal from "../dashboard/modals/PaySlipModal";
const OVERVIEW_ACTIVITY_LIMIT = 2;
const OVERVIEW_PAYSLIP_LIMIT = 2;
const FULL_ACTIVITY_LIMIT = 100;
const FULL_PAYSLIP_LIMIT = 100;
const DEFAULT_ACTIVITY_DAYS = 14;
const DEFAULT_PAYSLIP_DAYS = 30;

const ACTIVITY_FILTER_OPTIONS = [
  { key: "all", label: "전체 활동" },
  ...ACTIVITY_CATEGORY_OPTIONS,
];

const PAYSLIP_FILTER_OPTIONS = [
  { key: "all", label: "전체 명세" },
  { key: "salary", label: "급여" },
  { key: "bonus", label: "성과급" },
];

const ASSET_TABS = [
  { id: "overview", label: "현황 요약", icon: TrendingUp },
  { id: "activity", label: "활동 내역", icon: ArrowUpRight },
  { id: "payslip", label: "급여 명세", icon: FileText },
];

const ASSET_TONES = {
  cash: { bar: "bg-slate-400", icon: "bg-slate-100 text-slate-600" },
  deposit: { bar: "bg-blue-500", icon: "bg-blue-50 text-blue-600" },
  stock: { bar: "bg-emerald-500", icon: "bg-emerald-50 text-emerald-600" },
  foreign: { bar: "bg-cyan-500", icon: "bg-cyan-50 text-cyan-600" },
  item: { bar: "bg-fuchsia-500", icon: "bg-fuchsia-50 text-fuchsia-600" },
  realEstate: { bar: "bg-amber-500", icon: "bg-amber-50 text-amber-600" },
  loan: { bar: "bg-rose-500", icon: "bg-rose-50 text-rose-600" },
};

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value, options = {}) {
  const date = toDate(value);
  if (!date) return "날짜 정보 없음";
  return date.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    ...options,
  });
}

function getDateBoundary(dateKey, endOfDay = false) {
  if (!dateKey) return null;
  return new Date(dateKey + (endOfDay ? "T23:59:59.999" : "T00:00:00.000"));
}

function getPayslipAmount(paySlip) {
  return Number(
    paySlip?.totals?.netSalary ??
      paySlip?.totals?.totalBonusAmount ??
      paySlip?.netSalary ??
      0,
  );
}

function getPayslipTitle(paySlip) {
  if (paySlip?.slipType === "bonus") return "특별 급여 명세서";
  return paySlip?.paymentPeriodDescription || "급여 명세서";
}

function normalizePayslipType(value) {
  return String(value || "salary")
    .trim()
    .toLowerCase() === "bonus"
    ? "bonus"
    : "salary";
}

function getPayslipJobs(paySlip) {
  if (
    Array.isArray(paySlip?.selectedJobNames) &&
    paySlip.selectedJobNames.length
  ) {
    return paySlip.selectedJobNames.join(", ");
  }
  const jobNames = Object.keys(paySlip?.jobBreakdowns || {});
  return jobNames.length ? jobNames.join(", ") : "직업 정보 없음";
}

export default function AssetsPage() {
  const { classId, classData, userData, missionTokenLabel } = useUser();
  const { formatClassCurrency, formatClassCurrencyCompact, formatFin } =
    useNumberFormat();

  const [activeTab, setActiveTab] = useState("overview");
  const [overviewActivities, setOverviewActivities] = useState([]);
  const [overviewPayslips, setOverviewPayslips] = useState([]);
  const [fullActivities, setFullActivities] = useState([]);
  const [fullPayslips, setFullPayslips] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(false);
  const [payslipLoading, setPayslipLoading] = useState(false);
  const [selectedPayslipId, setSelectedPayslipId] = useState(null);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityCategory, setActivityCategory] = useState("all");
  const [payslipSearch, setPayslipSearch] = useState("");
  const [payslipType, setPayslipType] = useState("all");
  const [activityDateRange, setActivityDateRange] = useState(() =>
    getDefaultDateRange(DEFAULT_ACTIVITY_DAYS),
  );
  const [payslipDateRange, setPayslipDateRange] = useState(() =>
    getDefaultDateRange(DEFAULT_PAYSLIP_DAYS),
  );

  const currencyUnit = classData?.currencyUnit || "단위";
  const studentUid = userData?.uid || null;
  const assets = userData?.assets || {};

  const {
    totalNetWorth = 0,
    cash = 0,
    deposit = 0,
    loan = 0,
    usdBalance = 0,
    itemValue = 0,
    realEstateValue = 0,
    realEstateCount = 0,
    stockValue = {},
  } = assets;

  const appliedRate = Number(stockValue?.lastConversionRate || 100) || 100;
  const convertedStockValue = Math.round(
    Number(stockValue?.value || 0) / appliedRate,
  );
  const convertedForeignBalance = Math.round(
    Number(usdBalance || 0) / appliedRate,
  );

  const assetItems = useMemo(
    () =>
      [
        { key: "cash", label: "현금", value: Number(cash || 0), icon: Wallet },
        {
          key: "deposit",
          label: "예금",
          value: Number(deposit || 0),
          icon: PiggyBank,
        },
        {
          key: "stock",
          label: "보유 주식",
          value: convertedStockValue,
          icon: TrendingUp,
          helper:
            Number(stockValue?.value || 0) > 0
              ? formatFin(Number(stockValue.value || 0)) + " FIN"
              : null,
        },
        {
          key: "foreign",
          label: "FIN 잔액",
          value: convertedForeignBalance,
          icon: CircleDollarSign,
          helper:
            Number(usdBalance || 0) > 0
              ? formatFin(Number(usdBalance || 0)) + " FIN"
              : null,
        },
        {
          key: "item",
          label: "보유 아이템",
          value: Number(itemValue || 0),
          icon: Package,
        },
        {
          key: "realEstate",
          label: "부동산",
          value: Number(realEstateValue || 0),
          icon: Building2,
          helper: realEstateCount > 0 ? realEstateCount + "건 보유" : null,
        },
      ].filter(
        (item) =>
          item.key === "cash" ||
          item.key === "deposit" ||
          Number(item.value) !== 0,
      ),
    [
      cash,
      convertedForeignBalance,
      convertedStockValue,
      deposit,
      formatFin,
      itemValue,
      realEstateCount,
      realEstateValue,
      stockValue?.value,
      usdBalance,
    ],
  );

  const grossAssets = useMemo(
    () =>
      assetItems.reduce(
        (sum, item) => sum + Math.max(0, Number(item.value || 0)),
        0,
      ),
    [assetItems],
  );

  const filteredActivities = useMemo(() => {
    const normalizedSearch = activitySearch.trim().toLowerCase();
    const categoryValues =
      activityCategory === "all"
        ? null
        : ACTIVITY_CATEGORY_GROUPS[activityCategory] || [activityCategory];

    return fullActivities.filter((activity) => {
      const category = String(activity?.category || "").toLowerCase();
      if (categoryValues && !categoryValues.includes(category)) return false;
      if (!normalizedSearch) return true;

      return [
        activity?.description,
        activity?.reason,
        activity?.category,
        activity?.amount,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(normalizedSearch);
    });
  }, [activityCategory, activitySearch, fullActivities]);

  const activityStatistics = useMemo(
    () => calculateActivityStatistics(filteredActivities),
    [filteredActivities],
  );

  const filteredPayslips = useMemo(() => {
    const normalizedSearch = payslipSearch.trim().toLowerCase();

    return fullPayslips.filter((paySlip) => {
      if (
        payslipType !== "all" &&
        normalizePayslipType(paySlip?.slipType) !== payslipType
      ) {
        return false;
      }
      if (!normalizedSearch) return true;

      return [
        getPayslipTitle(paySlip),
        getPayslipJobs(paySlip),
        paySlip?.paymentPeriodDescription,
        paySlip?.payrollPeriodKey,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(normalizedSearch);
    });
  }, [fullPayslips, payslipSearch, payslipType]);
  const loadActivities = useCallback(
    async (
      pageSize,
      dateRange = getDefaultDateRange(DEFAULT_ACTIVITY_DAYS),
    ) => {
      if (!classId || !studentUid) return [];
      const activityQuery = buildActivityLogQuery({
        db,
        classId,
        studentUid,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        categoryFilter: "all",
        pageSize,
        lastVisible: null,
        logScope: ACTIVITY_LOG_SCOPE.GENERAL,
        currencyUnit,
      });
      const snapshot = await getDocs(activityQuery);
      return snapshot.docs.map(convertFirestoreDocToActivity);
    },
    [classId, currencyUnit, studentUid],
  );

  const loadPayslips = useCallback(
    async (pageSize, dateRange = null) => {
      if (!classId || !studentUid) return [];
      const paySlipsRef = collection(
        db,
        "classes",
        classId,
        "students",
        studentUid,
        "paySlips",
      );
      const constraints = [];

      if (dateRange?.startDate) {
        constraints.push(
          where("createdAt", ">=", getDateBoundary(dateRange.startDate)),
        );
      }
      if (dateRange?.endDate) {
        constraints.push(
          where("createdAt", "<=", getDateBoundary(dateRange.endDate, true)),
        );
      }

      constraints.push(orderBy("createdAt", "desc"), limit(pageSize));
      const snapshot = await getDocs(query(paySlipsRef, ...constraints));
      return snapshot.docs.map((paySlipDoc) => ({
        id: paySlipDoc.id,
        ...paySlipDoc.data(),
      }));
    },
    [classId, studentUid],
  );

  useEffect(() => {
    if (!classId || !studentUid) {
      setOverviewActivities([]);
      setOverviewPayslips([]);
      setOverviewLoading(false);
      return undefined;
    }

    let cancelled = false;
    setOverviewLoading(true);

    Promise.all([
      loadActivities(
        OVERVIEW_ACTIVITY_LIMIT,
        getDefaultDateRange(DEFAULT_ACTIVITY_DAYS),
      ),
      loadPayslips(
        OVERVIEW_PAYSLIP_LIMIT,
        getDefaultDateRange(DEFAULT_PAYSLIP_DAYS),
      ),
    ])
      .then(([activities, payslips]) => {
        if (cancelled) return;
        setOverviewActivities(activities);
        setOverviewPayslips(payslips);
      })
      .catch(() => {
        if (cancelled) return;
        setOverviewActivities([]);
        setOverviewPayslips([]);
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [classId, loadActivities, loadPayslips, studentUid]);

  useEffect(() => {
    if (activeTab !== "activity" || !studentUid) return;

    let cancelled = false;
    setActivityLoading(true);
    loadActivities(FULL_ACTIVITY_LIMIT, activityDateRange)
      .then((activities) => {
        if (cancelled) return;
        setFullActivities(activities);
      })
      .catch(() => {
        if (cancelled) return;
        setFullActivities([]);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, activityDateRange, loadActivities, studentUid]);

  useEffect(() => {
    if (activeTab !== "payslip" || !studentUid) return;

    let cancelled = false;
    setPayslipLoading(true);
    loadPayslips(FULL_PAYSLIP_LIMIT, payslipDateRange)
      .then((payslips) => {
        if (cancelled) return;
        setFullPayslips(payslips);
      })
      .catch(() => {
        if (cancelled) return;
        setFullPayslips([]);
      })
      .finally(() => {
        if (!cancelled) setPayslipLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, loadPayslips, payslipDateRange, studentUid]);

  const openPayslip = useCallback((paySlipId) => {
    setSelectedPayslipId(paySlipId);
  }, []);

  return (
    <AppLayout showDefaultHeader={false}>
      <div className="min-h-screen bg-[#f0f5ff]">
        <div className="p-4 sm:p-6 lg:p-8">
          <PageHeader
            title="내 자산"
            subtitle="자산의 구성과 최근 경제 활동을 확인합니다."
            icon={Wallet}
          />

          <div className="mt-6">
            <Tabs
              tabs={ASSET_TABS}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              variant="underline"
              size="md"
              fullWidth
              className="max-w-xl"
            />
          </div>

          <div className="mt-6">
            {activeTab === "overview" ? (
              <div className="space-y-5">
                    
                <Card noPadding className="overflow-hidden border border-slate-200 bg-white shadow-sm">
                  <Card.Content noPadding>
                    <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
                      <div>
                        <p className="text-xs font-bold text-slate-500">총 순자산</p>
                        <p className="mt-1 flex items-baseline gap-1.5">
                          <span className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                            {formatClassCurrencyCompact(Number(totalNetWorth || 0))}
                          </span>
                          <span className="text-sm font-bold text-slate-400">
                            {currencyUnit}
                          </span>
                        </p>
                      </div>
                      <p className="text-xs font-medium text-slate-500">
                        자산 구성과 최근 30일의 변화를 확인하세요.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 divide-y divide-slate-200 min-[1100px]:grid-cols-[1.08fr_0.92fr] min-[1100px]:divide-x min-[1100px]:divide-y-0">
                      <div className="p-4 sm:p-6">
                        <AssetComposition
                          items={assetItems}
                          loan={Number(loan || 0)}
                          totalNetWorth={Number(totalNetWorth || 0)}
                          grossAssets={grossAssets}
                          currencyUnit={currencyUnit}
                          formatClassCurrency={formatClassCurrency}
                          formatClassCurrencyCompact={
                            formatClassCurrencyCompact
                          }
                        />
                      </div>
                      <div className="p-4 sm:p-6">
                        <NetWorthTrendChart
                          currencyUnit={currencyUnit}
                          embedded
                          studentUid={studentUid}
                        />
                      </div>
                    </div>
                  </Card.Content>
                </Card>
                <Card noPadding className="overflow-hidden border border-slate-200 bg-white shadow-sm">
                  <Card.Content noPadding>
                    <div className="grid grid-cols-1 divide-y divide-slate-200 min-[1100px]:grid-cols-2 min-[1100px]:divide-x min-[1100px]:divide-y-0">
                      <div>
                        <OverviewSection
                    title="최근 활동"
                    actionLabel="전체 활동 보기"
                    onAction={() => setActiveTab("activity")} embedded
                  >
                    {overviewLoading ? (
                      <SectionLoading />
                    ) : (
                      <ActivityRows
                        activities={overviewActivities}
                        currencyUnit={currencyUnit}
                        formatClassCurrency={formatClassCurrency}
                        missionTokenLabel={missionTokenLabel}
                        compact
                      />
                    )}
                  </OverviewSection>
                      </div>
                      <div>
                        <OverviewSection
                    title="최근 급여 명세"
                    actionLabel="전체 명세 보기"
                    onAction={() => setActiveTab("payslip")} embedded
                  >
                    {overviewLoading ? (
                      <SectionLoading />
                    ) : (
                      <PayslipRows
                        payslips={overviewPayslips}
                        currencyUnit={currencyUnit}
                        formatClassCurrency={formatClassCurrency}
                        onOpen={openPayslip}
                        compact
                      />
                    )}
                  </OverviewSection>
                      </div>
                    </div>
                  </Card.Content>
                </Card>
              </div>
            ) : null}

            {activeTab === "activity" ? (
              <OverviewSection title="활동 내역">
                <ListFilterBar
                  searchValue={activitySearch}
                  onSearchChange={setActivitySearch}
                  searchPlaceholder="활동 내용이나 금액으로 검색"
                  selectLabel="활동 유형"
                  selectValue={activityCategory}
                  onSelectChange={setActivityCategory}
                  options={ACTIVITY_FILTER_OPTIONS}
                  resultCount={filteredActivities.length}
                  dateRange={activityDateRange}
                  onDateRangeChange={setActivityDateRange}
                />
                <ActivityStatistics
                  statistics={activityStatistics}
                  currencyUnit={currencyUnit}
                  formatClassCurrency={formatClassCurrency}
                />

                {activityLoading ? (
                  <SectionLoading />
                ) : (
                  <ActivityRows
                    activities={filteredActivities}
                    currencyUnit={currencyUnit}
                    formatClassCurrency={formatClassCurrency}
                    missionTokenLabel={missionTokenLabel}
                  />
                )}
              </OverviewSection>
            ) : null}

            {activeTab === "payslip" ? (
              <OverviewSection title="급여 명세">
                <ListFilterBar
                  searchValue={payslipSearch}
                  onSearchChange={setPayslipSearch}
                  searchPlaceholder="지급 기간이나 직업으로 검색"
                  selectLabel="명세 유형"
                  selectValue={payslipType}
                  onSelectChange={setPayslipType}
                  options={PAYSLIP_FILTER_OPTIONS}
                  resultCount={filteredPayslips.length}
                  dateRange={payslipDateRange}
                  onDateRangeChange={setPayslipDateRange}
                />
                {payslipLoading ? (
                  <SectionLoading />
                ) : (
                  <PayslipRows
                    payslips={filteredPayslips}
                    currencyUnit={currencyUnit}
                    formatClassCurrency={formatClassCurrency}
                    onOpen={openPayslip}
                  />
                )}
              </OverviewSection>
            ) : null}
          </div>
        </div>
      </div>

      <PaySlipModal
        isOpen={Boolean(selectedPayslipId)}
        onClose={() => setSelectedPayslipId(null)}
        employeeData={userData}
        initialPaySlipId={selectedPayslipId}
      />
    </AppLayout>
  );
}

function AssetComposition({
  items,
  loan,
  grossAssets,
  currencyUnit,
  formatClassCurrency,
}) {
  const debtRatio = grossAssets > 0 ? (loan / grossAssets) * 100 : 0;

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-black text-slate-800">자산 구성</p>
          <p className="mt-1 text-xs font-medium text-slate-400">
            자산별 금액과 전체 비중
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {items.map((item) => {
          const percentage =
            grossAssets > 0 ? (Math.max(0, item.value) / grossAssets) * 100 : 0;
          const Icon = item.icon;
          const tone = ASSET_TONES[item.key] || ASSET_TONES.cash;

          return (
            <div
              key={item.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(92px,0.45fr)_minmax(120px,1fr)_auto]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
                    tone.icon
                  }
                >
                  <Icon size={15} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-600">
                    {item.label}
                  </p>
                  {item.helper ? (
                    <p className="truncate text-[9px] font-medium text-slate-400">
                      {item.helper}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="order-3 col-span-2 h-2.5 overflow-hidden rounded-full bg-slate-100 sm:order-none sm:col-span-1">
                <div
                  className={"h-full rounded-full " + tone.bar}
                  style={{ width: Math.max(2, percentage) + "%" }}
                />
              </div>
              <div className="min-w-0 text-right sm:min-w-[86px]">
                <p className="text-xs font-black text-slate-700">
                  {formatClassCurrency(item.value)} {currencyUnit}
                </p>
                <p className="text-[9px] font-bold text-slate-400">
                  {percentage.toFixed(1)}%
                </p>
              </div>
            </div>
          );
        })}

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[minmax(92px,0.45fr)_minmax(120px,1fr)_auto]">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <Landmark size={15} />
            </span>
            <p className="text-xs font-bold text-slate-600">대출</p>
          </div>
          <div className="order-3 col-span-2 h-2.5 overflow-hidden rounded-full bg-slate-100 sm:order-none sm:col-span-1">
            <div
              className="h-full rounded-full bg-rose-500"
              style={{ width: Math.max(loan > 0 ? 2 : 0, debtRatio) + "%" }}
            />
          </div>
          <div className="min-w-0 text-right sm:min-w-[86px]">
            <p className="text-xs font-black text-rose-600">
              {formatClassCurrency(loan)} {currencyUnit}
            </p>
            <p className="text-[9px] font-bold text-slate-400">
              부채 비율 {debtRatio.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewSection({ title, actionLabel, onAction, children, embedded = false }) {
  return (
    <Card noPadding className={embedded ? "!rounded-none !border-0 !bg-transparent !shadow-none" : "border border-slate-200 bg-white shadow-sm"}>
      <Card.Content noPadding className="p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-black text-slate-800 sm:text-base">
            {title}
          </h2>
          {actionLabel ? (
            <Button
              type="button"
              kind="ghost"
              tone="blue"
              size="sm"
              icon={ArrowRight}
              onClick={onAction}
              
            >
              {actionLabel}
            </Button>
          ) : null}
        </div>
        {children}
      </Card.Content>
    </Card>
  );
}

function ListFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  selectLabel,
  selectValue,
  onSelectChange,
  options,
  resultCount,
  dateRange,
  onDateRangeChange,
}) {
  return (
    <div className="mb-2 flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{searchPlaceholder}</span>
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-10 w-full rounded-xl border border-blue-200 bg-slate-50 pl-9 pr-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-300 focus:bg-blue-50/50 focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label="조회 시작일"
          value={dateRange.startDate}
          max={dateRange.endDate}
          onChange={(event) =>
            onDateRangeChange((current) => ({
              ...current,
              startDate: event.target.value,
            }))
          }
          className="h-10 min-w-0 flex-1 rounded-xl border border-blue-200 bg-blue-50/50 px-2 text-xs font-bold text-slate-600 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100 sm:w-[132px] sm:flex-none"
        />
        <span className="text-xs font-bold text-slate-400">~</span>
        <input
          type="date"
          aria-label="조회 종료일"
          value={dateRange.endDate}
          min={dateRange.startDate}
          onChange={(event) =>
            onDateRangeChange((current) => ({
              ...current,
              endDate: event.target.value,
            }))
          }
          className="h-10 min-w-0 flex-1 rounded-xl border border-blue-200 bg-blue-50/50 px-2 text-xs font-bold text-slate-600 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100 sm:w-[132px] sm:flex-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:w-44 sm:flex-none">
          <span className="sr-only">{selectLabel}</span>
          <Filter
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-blue-500"
          />
          <select
            aria-label={selectLabel}
            value={selectValue}
            onChange={(event) => onSelectChange(event.target.value)}
            className="h-10 w-full appearance-none rounded-xl border border-blue-200 bg-blue-50/50 py-2 pl-9 pr-8 text-sm font-bold text-slate-600 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={15}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
        </label>
        <span className="shrink-0 text-xs font-bold text-slate-400">
          {resultCount}건
        </span>
      </div>
    </div>
  );
}
function ActivityStatistics({
  statistics,
  currencyUnit,
  formatClassCurrency,
}) {
  const netIsPositive = statistics.netAmount >= 0;

  return (
    <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
      <div className="px-3 py-2.5 sm:px-4">
        <p className="text-[10px] font-bold text-slate-400">순변동</p>
        <p
          className={
            "mt-1 truncate text-sm font-black " +
            (netIsPositive ? "text-slate-800" : "text-rose-600")
          }
        >
          {netIsPositive ? "+" : ""}
          {formatClassCurrency(statistics.netAmount)}
          <span className="ml-1 text-[10px] font-bold text-slate-400">
            {currencyUnit}
          </span>
        </p>
      </div>
      <div className="border-l border-slate-200 px-3 py-2.5 sm:px-4">
        <p className="text-[10px] font-bold text-emerald-600">수입</p>
        <p className="mt-1 truncate text-sm font-black text-emerald-600">
          +{formatClassCurrency(statistics.totalIncome)}
        </p>
      </div>
      <div className="border-l border-slate-200 px-3 py-2.5 sm:px-4">
        <p className="text-[10px] font-bold text-rose-500">지출</p>
        <p className="mt-1 truncate text-sm font-black text-rose-600">
          -{formatClassCurrency(statistics.totalExpense)}
        </p>
      </div>
    </div>
  );
}

function ActivityRows({
  activities,
  currencyUnit,
  formatClassCurrency,
  missionTokenLabel,
  compact = false,
}) {
  if (!activities.length) {
    return <EmptyState label="조건에 맞는 활동 기록이 없어요." />;
  }

  return (
    <div className="divide-y divide-slate-100">
      {activities.map((activity) => {
        const info = getActivityDisplayInfo(
          activity,
          currencyUnit,
          formatClassCurrency,
          missionTokenLabel,
        );
        const isIncome = info.icon === "income";

        return (
          <div
            key={activity.id}
            className="flex items-center justify-between gap-3 py-3.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
                  (isIncome
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-rose-50 text-rose-600")
                }
              >
                {isIncome ? (
                  <ArrowDownLeft size={17} />
                ) : (
                  <ArrowUpRight size={17} />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-700">
                  {getUserFacingRecordDescription(activity, "경제 활동")}
                </p>
                <p className="mt-1 text-[10px] font-medium text-slate-400">
                  {formatDate(activity.timestamp)}
                </p>
              </div>
            </div>
            <span className={"shrink-0 text-sm font-black " + info.color}>
              {info.amountText}
            </span>
          </div>
        );
      })}
      {!compact ? (
        <p className="pt-4 text-center text-[11px] font-medium text-slate-400">
          선택한 기간의 최신 {activities.length}건을 표시합니다.
        </p>
      ) : null}
    </div>
  );
}

function PayslipRows({
  payslips,
  currencyUnit,
  formatClassCurrency,
  onOpen,
  compact = false,
}) {
  if (!payslips.length) {
    return <EmptyState label="아직 급여 명세서가 없습니다." />;
  }

  return (
    <div className="divide-y divide-slate-100">
      {payslips.map((paySlip) => (
        <button
          key={paySlip.id}
          type="button"
          onClick={() => onOpen(paySlip.id)}
          className="grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-3.5 text-left transition-colors hover:bg-slate-50 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Banknote size={17} />
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-sm font-bold text-slate-700">
              {getPayslipTitle(paySlip)}
            </strong>
            <small className="mt-1 block truncate text-[10px] font-medium text-slate-400">
              {formatDate(paySlip.createdAt || paySlip.generatedAt)} ·{" "}
              {getPayslipJobs(paySlip)}
            </small>
          </span>
          <span className="col-span-2 pl-12 text-left sm:col-span-1 sm:pl-0 sm:text-right">
            <strong className="block text-sm font-black text-blue-600">
              {formatClassCurrency(getPayslipAmount(paySlip))} {currencyUnit}
            </strong>
            <small className="text-[10px] font-bold text-slate-400">
              명세서 보기
            </small>
          </span>
        </button>
      ))}
      {!compact ? (
        <p className="pt-4 text-center text-[11px] font-medium text-slate-400">
          선택한 기간의 명세서 {payslips.length}건을 표시합니다.
        </p>
      ) : null}
    </div>
  );
}

function SectionLoading() {
  return (
    <div className="flex min-h-32 items-center justify-center">
      <Spinner size="md" className="text-blue-500" />
    </div>
  );
}

function EmptyState({ label }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-400">
      {label}
    </div>
  );
}
