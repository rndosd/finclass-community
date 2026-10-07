import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useMemo, useState, useLayoutEffect, useRef } from "react";
import {
  BarChart3,
  CalendarDays,
  RefreshCw,
  Scale,
  Users,
} from "lucide-react";
import {
  collection,
  documentId,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { Button, ErrorState, Modal, SectionLoader, runFilterApplyOnEnter, Tabs } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import { DEFAULT_CLASS_CURRENCY_UNIT } from "../../../utils/currencyUnit";
import { getPoliceStatsCoverage } from "../utils/statsCoverage";
import PoliceStatsDetails from "./components/PoliceStatsDetails";
import {
  formatDateKeyInKST,
  getRecentDateRangeInKST,
  parseDateKeyAsKST,
} from "../../../utils/kstDate";

const RANGE_PRESETS = [
  { id: "7d", label: "7일", days: 7 },
  { id: "14d", label: "2주", days: 14 },
  { id: "28d", label: "4주", days: 28 },
];

const VIEW_TABS = [
  { id: "summary", label: "요약" },
  { id: "students", label: "학생별" },
  { id: "rules", label: "규칙별" },
];

const buildDefaultRange = () => {
  const range = getRecentDateRangeInKST({ days: 7, endOffsetDays: -1 });
  return {
    dateStart: range.startDate,
    dateEnd: range.endDate,
  };
};

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};



const formatCount = (value) => Math.round(toNumber(value)).toLocaleString("ko-KR");

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const enumerateDateKeys = (startDate, endDate) => {
  const start = parseDateKeyAsKST(startDate);
  const end = parseDateKeyAsKST(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return [];

  const keys = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    keys.push(formatDateKeyInKST(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return keys;
};

const addMetric = (target, key, value) => {
  target[key] = toNumber(target[key]) + toNumber(value);
};

const applyLatestDate = (target, key, value) => {
  if (!value) return;
  if (!target[key] || String(value) > String(target[key])) target[key] = value;
};

const normalizeStudentName = (student = {}) =>
  String(student.studentName || student.name || "학생").trim() || "학생";

const normalizeRuleText = (rule = {}) =>
  String(rule.ruleText || rule.ruleName || rule.ruleKey || "규칙 미지정").trim() ||
  "규칙 미지정";

const EmptyState = ({ text }) => (
  <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
    {text}
  </div>
);

const RankTable = ({ title, icon: Icon, columns, rows, emptyText, maxRows = 10, minWidth = "min-w-[760px]" }) => (
  <section className="min-w-0 rounded-lg border border-slate-200 bg-white">
    <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
      <Icon className="h-4 w-4 text-slate-500" />
      <h3 className="text-sm font-black text-slate-900">{title}</h3>
    </div>
    {rows.length ? (
      <div className="overflow-x-auto">
        <table className={`w-full ${minWidth} table-fixed text-sm`}>
          <thead className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="w-14 whitespace-nowrap px-4 py-3 text-left">순위</th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-4 py-3 ${column.widthClass || ""} ${column.wrap ? "whitespace-normal break-words [overflow-wrap:anywhere]" : "whitespace-nowrap"} ${column.align === "right" ? "text-right" : "text-left"}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, maxRows).map((row, index) => (
              <tr key={row.id || row.uid || row.ruleKey || index} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-500">{index + 1}</td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 align-middle ${column.widthClass || ""} ${column.wrap ? "whitespace-normal break-words [overflow-wrap:anywhere]" : "whitespace-nowrap"} ${column.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <EmptyState text={emptyText} />
    )}
  </section>
);

export const RuleChips = ({ rules, type = "fine" }) => {
  const countKey = type === "reward" ? "rewardCount" : "fineCount";
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [fitsInline, setFitsInline] = useState(false);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return undefined;
    let disposed = false;
    const update = () => {
      if (!disposed) setFitsInline(container.clientWidth > 0 && measure.scrollWidth <= container.clientWidth);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    observer?.observe(measure);
    document.fonts?.ready?.then(update);
    return () => { disposed = true; observer?.disconnect(); };
  }, [rules, countKey]);
  if (!rules.length) return <span className="text-xs text-slate-400">규칙 데이터 없음</span>;
  const items = rules.map(rule => <li key={rule.ruleKey} className="inline-flex max-w-full items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1"><span className="min-w-0 break-words text-slate-600">{rule.ruleText}</span><span className="shrink-0 tabular-nums text-slate-500">{formatCount(rule[countKey])}건</span></li>);
  return <div ref={containerRef} className="relative min-w-0 overflow-hidden text-xs leading-5">
    <ul ref={measureRef} aria-hidden="true" className="invisible absolute left-0 top-0 flex w-max gap-2 whitespace-nowrap">{items}</ul>
    {fitsInline ? <ul className="flex gap-2">{items}</ul> : <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-blue-700 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block group-open:rotate-90">▶</span><span>전체 규칙 {rules.length}개 보기</span>
      </summary>
      <ul className="mt-1 flex flex-wrap gap-2">{items}</ul>
    </details>}
  </div>;
};

const GraphPanel = ({ title, description, children }) => (
  <section className="rounded-xl border border-slate-200 bg-white">
    <div className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-black text-slate-900">{title}</h3>
      {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
    </div>
    <div className="p-4">{children}</div>
  </section>
);

const GRAPH_VIEWS = [
  { id: "distribution", label: "분포" },
  { id: "flow", label: "흐름" },
  { id: "repeat", label: "반복" },
];

const formatShortDate = (dateKey) => {
  if (!dateKey || typeof dateKey !== "string") return "-";
  const parts = dateKey.split("-");
  if (parts.length < 3) return dateKey;
  return `${parts[1]}.${parts[2]}`;
};

const getDistributionBucket = (value) => {
  const count = toNumber(value);
  if (count === 0) return "zero";
  if (count === 1) return "one";
  if (count === 2) return "two";
  if (count <= 4) return "threeFour";
  return "fivePlus";
};

const StudentDistributionGraph = ({ rows = [] }) => {
  const buckets = [
    { id: "zero", label: "0건", fine: 0, reward: 0 },
    { id: "one", label: "1건", fine: 0, reward: 0 },
    { id: "two", label: "2건", fine: 0, reward: 0 },
    { id: "threeFour", label: "3~4건", fine: 0, reward: 0 },
    { id: "fivePlus", label: "5건 이상", fine: 0, reward: 0 },
  ];
  const bucketMap = new Map(buckets.map((bucket) => [bucket.id, bucket]));

  rows.forEach((student) => {
    bucketMap.get(getDistributionBucket(student.fineCount)).fine += 1;
    bucketMap.get(getDistributionBucket(student.rewardCount)).reward += 1;
  });

  const maxValue = Math.max(1, ...buckets.flatMap((bucket) => [bucket.fine, bucket.reward]));

  return (
    <GraphPanel
      title="학생 기록 분포"
      description="선택 기간에 벌점·상점 기록이 있는 학생만 비교합니다. 기록이 없는 학급 학생은 포함하지 않습니다."
    >
      {rows.length ? (
        <div className="space-y-4">
          {buckets.map((bucket) => (
            <div key={bucket.id} className="grid grid-cols-[72px_1fr] items-center gap-3">
              <div className="text-xs font-black text-slate-500">{bucket.label}</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-9 shrink-0 text-xs font-bold text-rose-600">벌점</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-rose-50">
                    <div
                      className="flex h-full items-center justify-end rounded-md bg-rose-500 px-2 text-xs font-black text-white"
                      style={{ width: `${Math.max(bucket.fine > 0 ? 7 : 0, (bucket.fine / maxValue) * 100)}%` }}
                    >
                      {bucket.fine > 0 ? formatCount(bucket.fine) : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-9 shrink-0 text-xs font-bold text-emerald-600">상점</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-emerald-50">
                    <div
                      className="flex h-full items-center justify-end rounded-md bg-emerald-500 px-2 text-xs font-black text-white"
                      style={{ width: `${Math.max(bucket.reward > 0 ? 7 : 0, (bucket.reward / maxValue) * 100)}%` }}
                    >
                      {bucket.reward > 0 ? formatCount(bucket.reward) : ""}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <p className="text-xs font-semibold text-slate-500">
            예: 5건 이상 구간이 크면 기록이 많은 학생층이 두꺼운 것이고, 0~1건 구간이 크면 기록이 소수에게 몰린 구조입니다.
          </p>
        </div>
      ) : (
        <EmptyState text="학생 기록 분포 데이터가 없습니다." />
      )}
    </GraphPanel>
  );
};

const WeeklyFlowGraph = ({ rows = [] }) => {
  const weeklyRows = [];
  for (let index = 0; index < rows.length; index += 7) {
    const slice = rows.slice(index, index + 7);
    if (!slice.length) continue;
    weeklyRows.push({
      id: `${slice[0].date}:${slice[slice.length - 1].date}`,
      label:
        slice.length === 1
          ? formatShortDate(slice[0].date)
          : `${formatShortDate(slice[0].date)}~${formatShortDate(slice[slice.length - 1].date)}`,
      fine: slice.reduce((sum, row) => sum + toNumber(row.fineCount), 0),
      reward: slice.reduce((sum, row) => sum + toNumber(row.rewardCount), 0),
    });
  }

  const maxValue = Math.max(1, ...weeklyRows.flatMap((row) => [row.fine, row.reward]));

  return (
    <GraphPanel
      title="주별 운영 흐름"
      description="일별 막대 대신 주 단위로 묶어, 벌점·상점 흐름이 늘었는지 줄었는지 봅니다."
    >
      {weeklyRows.length ? (
        <div className="overflow-x-auto">
          <div className="flex min-w-[620px] items-end gap-3 border-b border-slate-200 px-2 pb-3 pt-6">
            {weeklyRows.map((row) => (
              <div key={row.id} className="flex min-w-[76px] flex-1 flex-col items-center gap-2">
                <div className="flex h-48 items-end gap-1.5">
                  <div
                    className="w-5 rounded-t-md bg-rose-500"
                    style={{ height: `${Math.max(row.fine > 0 ? 8 : 0, (row.fine / maxValue) * 100)}%` }}
                    title={`벌점 ${formatCount(row.fine)}건`}
                  />
                  <div
                    className="w-5 rounded-t-md bg-emerald-500"
                    style={{ height: `${Math.max(row.reward > 0 ? 8 : 0, (row.reward / maxValue) * 100)}%` }}
                    title={`상점 ${formatCount(row.reward)}건`}
                  />
                </div>
                <div className="text-center">
                  <p className="whitespace-nowrap text-[11px] font-black text-slate-600">{row.label}</p>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-400">
                    {formatCount(row.fine)} / {formatCount(row.reward)}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-center gap-4 text-xs font-bold text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />벌점</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />상점</span>
          </div>
        </div>
      ) : (
        <EmptyState text="주별 흐름 데이터가 없습니다." />
      )}
    </GraphPanel>
  );
};

const RepeatMatrixGraph = ({ rows = [] }) => {
  const studentTotals = new Map();
  const ruleTotals = new Map();

  rows.forEach((row) => {
    studentTotals.set(row.uid, {
      uid: row.uid,
      name: row.name,
      count: toNumber(studentTotals.get(row.uid)?.count) + toNumber(row.fineCount),
    });
    ruleTotals.set(row.ruleKey, {
      ruleKey: row.ruleKey,
      ruleText: row.ruleText,
      count: toNumber(ruleTotals.get(row.ruleKey)?.count) + toNumber(row.fineCount),
    });
  });

  const students = Array.from(studentTotals.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const rules = Array.from(ruleTotals.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const cellMap = new Map(rows.map((row) => [`${row.uid}:${row.ruleKey}`, toNumber(row.fineCount)]));
  const maxValue = Math.max(1, ...Array.from(cellMap.values()));
  const cellClass = (value) => {
    const ratio = toNumber(value) / maxValue;
    if (!value) return "bg-slate-50 text-slate-300";
    if (ratio >= 0.75) return "bg-rose-600 text-white";
    if (ratio >= 0.5) return "bg-rose-400 text-white";
    if (ratio >= 0.25) return "bg-rose-200 text-rose-900";
    return "bg-rose-100 text-rose-800";
  };

  return (
    <GraphPanel
      title="반복 위반 매트릭스"
      description="같은 학생이 같은 규칙을 반복하는지, 한눈에 짙은 칸으로 확인합니다."
    >
      {students.length && rules.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-[720px] table-fixed border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="w-28 px-2 py-2 text-left font-black text-slate-500">학생</th>
                {rules.map((rule) => (
                  <th key={rule.ruleKey} className="w-20 px-1 py-2 text-center font-black text-slate-500">
                    <span className="line-clamp-2" title={rule.ruleText}>{rule.ruleText}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.uid}>
                  <th className="truncate rounded-md bg-slate-50 px-2 py-2 text-left font-black text-slate-700" title={student.name}>
                    {student.name}
                  </th>
                  {rules.map((rule) => {
                    const value = cellMap.get(`${student.uid}:${rule.ruleKey}`) || 0;
                    return (
                      <td
                        key={rule.ruleKey}
                        className={`h-11 rounded-md text-center align-middle font-black ${cellClass(value)}`}
                        title={`${student.name} · ${rule.ruleText}: ${formatCount(value)}건`}
                      >
                        {value > 0 ? formatCount(value) : "-"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs font-semibold text-slate-500">
            짙은 칸은 같은 학생-규칙 조합이 반복된 곳입니다. 벌점 Top과 달리 “반복 패턴”만 보기 위한 화면입니다.
          </p>
        </div>
      ) : (
        <EmptyState text="같은 학생이 같은 규칙을 2회 이상 반복한 기록이 없습니다." />
      )}
    </GraphPanel>
  );
};

const OperationGraphModal = ({ isOpen, onClose, stats }) => {
  const [activeGraphView, setActiveGraphView] = useState("distribution");
  const activeGraph = {
    distribution: <StudentDistributionGraph rows={stats.studentRows} />,
    flow: <WeeklyFlowGraph rows={stats.trendRows} />,
    repeat: <RepeatMatrixGraph rows={stats.repeatedViolations} />,
  }[activeGraphView];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="운영 시각화" size="xl">
      <div className="space-y-4">
        <Tabs ariaLabel="운영 시각화 종류" tabs={GRAPH_VIEWS} activeTab={activeGraphView} onTabChange={setActiveGraphView} variant="underline" size="sm" />
        {activeGraph}
      </div>
    </Modal>
  );
};

const PoliceStatsTab = ({ fineFilters, setFineFilters }) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();


  const { classId, currencyUnit } = useUser();
  const classCurrencyUnit = currencyUnit || DEFAULT_CLASS_CURRENCY_UNIT;
  const formatClassAmount = useCallback(
    (value) => `${formatConfiguredAmount(value)} ${classCurrencyUnit}`,
    [classCurrencyUnit, formatConfiguredAmount],
  );
  const initialRange = useMemo(() => {
    const defaults = buildDefaultRange();
    return {
      dateStart: fineFilters?.dateStart || defaults.dateStart,
      dateEnd: fineFilters?.dateEnd || defaults.dateEnd,
    };
  }, [fineFilters?.dateEnd, fineFilters?.dateStart]);
  const [tempFilters, setTempFilters] = useState(initialRange);
  const [appliedFilters, setAppliedFilters] = useState(initialRange);
  const [dailyRows, setDailyRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("summary");
  const [ruleView, setRuleView] = useState("fine");
  const [summaryType, setSummaryType] = useState("fine");
  const [showOperationGraphs, setShowOperationGraphs] = useState(false);

  useEffect(() => {
    setTempFilters(initialRange);
    setAppliedFilters(initialRange);
  }, [initialRange]);

  const hasIncompleteDateRange = !tempFilters.dateStart || !tempFilters.dateEnd;
  const hasInvalidDateRange =
    tempFilters.dateStart &&
    tempFilters.dateEnd &&
    tempFilters.dateStart > tempFilters.dateEnd;

  const fetchDailyAnalytics = useCallback(async () => {
    if (!classId || !appliedFilters.dateStart || !appliedFilters.dateEnd) return;
    setIsLoading(true);
    setError("");
    try {
      const ref = collection(db, "classes", classId, "policeAnalyticsDaily");
      const snapshot = await getDocs(
        query(
          ref,
          where(documentId(), ">=", appliedFilters.dateStart),
          where(documentId(), "<=", appliedFilters.dateEnd),
          orderBy(documentId(), "asc"),
        ),
      );
      setDailyRows(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    } catch (fetchError) {
      console.error("[PoliceStatsTab] failed to load daily analytics", fetchError);
      setDailyRows([]);
      setError("경찰 통계를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [appliedFilters.dateEnd, appliedFilters.dateStart, classId]);

  useEffect(() => {
    fetchDailyAnalytics();
  }, [fetchDailyAnalytics]);

  const handlePreset = (days) => {
    const range = getRecentDateRangeInKST({ days, endOffsetDays: -1 });
    const next = {
      dateStart: range.startDate,
      dateEnd: range.endDate,
    };
    setTempFilters(next);
    setAppliedFilters(next);
    setFineFilters?.(next);
  };

  const handleApply = () => {
    if (hasIncompleteDateRange || hasInvalidDateRange) return;
    const next = {
      dateStart: tempFilters.dateStart,
      dateEnd: tempFilters.dateEnd,
    };
    setAppliedFilters(next);
    setFineFilters?.(next);
  };

  const stats = useMemo(() => {
    const dateKeys = enumerateDateKeys(appliedFilters.dateStart, appliedFilters.dateEnd);
    const byDate = new Map(dailyRows.map((row) => [row.date || row.id, row]));
    const byStudent = new Map();
    const byStudentRule = new Map();
    const byRuleStudent = new Map();
    const totals = {
      sourceDays: dailyRows.length,
      readyDays: 0,
      emptyDays: 0,
      eventCount: 0,
      fineCount: 0,
      rewardCount: 0,
      fineAmount: 0,
      rewardAmount: 0,
      reportCreatedCount: 0,
      reflectionSubmittedCount: 0,
    };

    const trendRows = dateKeys.map((date) => {
      const daily = byDate.get(date);
      const eventTotals = daily?.eventTotals || {};
      if (daily?.status === "ready") totals.readyDays += 1;
      else totals.emptyDays += 1;

      addMetric(totals, "eventCount", eventTotals.eventCount);
      addMetric(totals, "fineCount", eventTotals.fineCount);
      addMetric(totals, "rewardCount", eventTotals.rewardCount);
      addMetric(totals, "fineAmount", eventTotals.fineAmount);
      addMetric(totals, "rewardAmount", eventTotals.rewardAmount);
      addMetric(totals, "reportCreatedCount", eventTotals.reportCreatedCount);
      addMetric(totals, "reflectionSubmittedCount", eventTotals.reflectionSubmittedCount);

      Object.entries(daily?.byStudent || {}).forEach(([uid, student]) => {
        const current = byStudent.get(uid) || {
          uid,
          name: normalizeStudentName(student),
          studentNumber: student.studentNumber ?? null,
          eventCount: 0,
          fineCount: 0,
          fineAmount: 0,
          rewardCount: 0,
          rewardAmount: 0,
          reportCreatedCount: 0,
          reflectionSubmittedCount: 0,
        };
        addMetric(current, "eventCount", student.eventCount);
        addMetric(current, "fineCount", student.fineCount);
        addMetric(current, "fineAmount", student.fineAmount);
        addMetric(current, "rewardCount", student.rewardCount);
        addMetric(current, "rewardAmount", student.rewardAmount);
        addMetric(current, "reportCreatedCount", student.reportCreatedCount);
        addMetric(current, "reflectionSubmittedCount", student.reflectionSubmittedCount);
        byStudent.set(uid, current);
      });

      Object.entries(daily?.byStudentRule || {}).forEach(([uid, student]) => {
        const studentRow = byStudentRule.get(uid) || {
          uid,
          name: normalizeStudentName(student),
          studentNumber: student.studentNumber ?? null,
          eventCount: 0,
          fineCount: 0,
          fineAmount: 0,
          rewardCount: 0,
          rewardAmount: 0,
          netAmount: 0,
          latestAppliedAt: null,
          rules: new Map(),
          rewardRules: new Map(),
        };

        Object.entries(student.rules || {}).forEach(([ruleKey, rule]) => {
          const ruleText = normalizeRuleText(rule);
          const studentRule = studentRow.rules.get(ruleKey) || {
            ruleKey,
            ruleText,
            eventCount: 0,
            fineCount: 0,
            fineAmount: 0,
            rewardCount: 0,
            rewardAmount: 0,
            netAmount: 0,
            latestAppliedAt: null,
          };
          addMetric(studentRule, "eventCount", rule.eventCount);
          addMetric(studentRule, "fineCount", rule.fineCount);
          addMetric(studentRule, "fineAmount", rule.fineAmount);
          addMetric(studentRule, "rewardCount", rule.rewardCount);
          addMetric(studentRule, "rewardAmount", rule.rewardAmount);
          addMetric(studentRule, "netAmount", rule.netAmount);
          applyLatestDate(studentRule, "latestAppliedAt", rule.latestAppliedAt);

          addMetric(studentRow, "eventCount", rule.eventCount);
          addMetric(studentRow, "fineCount", rule.fineCount);
          addMetric(studentRow, "fineAmount", rule.fineAmount);
          addMetric(studentRow, "rewardCount", rule.rewardCount);
          addMetric(studentRow, "rewardAmount", rule.rewardAmount);
          addMetric(studentRow, "netAmount", rule.netAmount);
          applyLatestDate(studentRow, "latestAppliedAt", rule.latestAppliedAt);

          if (toNumber(studentRule.fineCount) > 0 || toNumber(studentRule.fineAmount) > 0) {
            studentRow.rules.set(ruleKey, studentRule);
          }
          if (toNumber(studentRule.rewardCount) > 0 || toNumber(studentRule.rewardAmount) > 0) {
            studentRow.rewardRules.set(ruleKey, studentRule);
          }

          const ruleStudentRow = byRuleStudent.get(ruleKey) || {
            ruleKey,
            ruleText,
            eventCount: 0,
            fineCount: 0,
            fineAmount: 0,
            rewardCount: 0,
            rewardAmount: 0,
            netAmount: 0,
            latestAppliedAt: null,
            students: new Map(),
          };
          const ruleStudent = ruleStudentRow.students.get(uid) || {
            uid,
            name: normalizeStudentName(student),
            studentNumber: student.studentNumber ?? null,
            eventCount: 0,
            fineCount: 0,
            fineAmount: 0,
            rewardCount: 0,
            rewardAmount: 0,
            netAmount: 0,
            latestAppliedAt: null,
          };
          addMetric(ruleStudent, "eventCount", rule.eventCount);
          addMetric(ruleStudent, "fineCount", rule.fineCount);
          addMetric(ruleStudent, "fineAmount", rule.fineAmount);
          addMetric(ruleStudent, "rewardCount", rule.rewardCount);
          addMetric(ruleStudent, "rewardAmount", rule.rewardAmount);
          addMetric(ruleStudent, "netAmount", rule.netAmount);
          applyLatestDate(ruleStudent, "latestAppliedAt", rule.latestAppliedAt);

          addMetric(ruleStudentRow, "eventCount", rule.eventCount);
          addMetric(ruleStudentRow, "fineCount", rule.fineCount);
          addMetric(ruleStudentRow, "fineAmount", rule.fineAmount);
          addMetric(ruleStudentRow, "rewardCount", rule.rewardCount);
          addMetric(ruleStudentRow, "rewardAmount", rule.rewardAmount);
          addMetric(ruleStudentRow, "netAmount", rule.netAmount);
          applyLatestDate(ruleStudentRow, "latestAppliedAt", rule.latestAppliedAt);

          if (
            toNumber(ruleStudent.fineCount) > 0 ||
            toNumber(ruleStudent.fineAmount) > 0 ||
            toNumber(ruleStudent.rewardCount) > 0 ||
            toNumber(ruleStudent.rewardAmount) > 0
          ) {
            ruleStudentRow.students.set(uid, ruleStudent);
          }
          if (ruleStudentRow.students.size > 0) byRuleStudent.set(ruleKey, ruleStudentRow);
        });

        byStudentRule.set(uid, studentRow);
      });

      return {
        date,
        fineCount: toNumber(eventTotals.fineCount),
        rewardCount: toNumber(eventTotals.rewardCount),
        reportCreatedCount: toNumber(eventTotals.reportCreatedCount),
        reflectionSubmittedCount: toNumber(eventTotals.reflectionSubmittedCount),
      };
    });

    const studentRows = Array.from(byStudentRule.values())
      .map((student) => ({
        ...student,
        rules: Array.from(student.rules.values())
          .filter((rule) => toNumber(rule.fineCount) > 0)
          .sort((a, b) => b.fineCount - a.fineCount || b.fineAmount - a.fineAmount || b.eventCount - a.eventCount),
        rewardRules: Array.from(student.rewardRules.values())
          .filter((rule) => toNumber(rule.rewardCount) > 0)
          .sort((a, b) => b.rewardCount - a.rewardCount || b.rewardAmount - a.rewardAmount || b.eventCount - a.eventCount),
      }))
      .filter((student) => student.rules.length > 0 || student.rewardRules.length > 0)
      .sort((a, b) => b.fineCount - a.fineCount || b.rewardCount - a.rewardCount || b.eventCount - a.eventCount);

    const repeatedViolations = studentRows
      .flatMap((student) =>
        student.rules
          .filter((rule) => toNumber(rule.fineCount) >= 2)
          .map((rule) => ({
            id: `${student.uid}:${rule.ruleKey}`,
            uid: student.uid,
            name: student.name,
            studentNumber: student.studentNumber,
            ruleKey: rule.ruleKey,
            ruleText: rule.ruleText,
            fineCount: rule.fineCount,
            fineAmount: rule.fineAmount,
            latestAppliedAt: rule.latestAppliedAt,
          })),
      )
      .sort(
        (a, b) =>
          b.fineCount - a.fineCount ||
          b.fineAmount - a.fineAmount ||
          String(b.latestAppliedAt || "").localeCompare(String(a.latestAppliedAt || "")),
      );

    const buildRuleRows = (type) => {
      const countKey = type === "reward" ? "rewardCount" : "fineCount";
      const amountKey = type === "reward" ? "rewardAmount" : "fineAmount";
      return Array.from(byRuleStudent.values())
        .map((rule) => {
          const students = Array.from(rule.students.values())
            .filter((student) => toNumber(student[countKey]) > 0)
            .sort(
              (a, b) =>
                b[countKey] - a[countKey] ||
                b[amountKey] - a[amountKey] ||
                b.eventCount - a.eventCount,
            );

          return {
            ...rule,
            students,
            affectedStudentCount: students.length,
            repeatStudentCount: students.filter((student) => toNumber(student[countKey]) >= 2).length,
          };
        })
        .filter((rule) => rule.students.length > 0)
        .sort(
          (a, b) =>
            b[countKey] - a[countKey] ||
            b[amountKey] - a[amountKey] ||
            String(b.latestAppliedAt || "").localeCompare(String(a.latestAppliedAt || "")),
        );
    };

    const penaltyRuleRows = buildRuleRows("fine");
    const rewardRuleRows = buildRuleRows("reward");

    return {
      totals,
      coverage: getPoliceStatsCoverage(dateKeys, dailyRows),
      trendRows,
      repeatedViolations,
      penaltyStudents: studentRows
        .filter((student) => toNumber(student.fineCount) > 0)
        .sort((a, b) => b.fineCount - a.fineCount || b.fineAmount - a.fineAmount),
      rewardStudents: studentRows
        .filter((student) => toNumber(student.rewardCount) > 0)
        .sort((a, b) => b.rewardCount - a.rewardCount || b.rewardAmount - a.rewardAmount),
      penaltyRuleRows,
      rewardRuleRows,
      studentRows,
    };
  }, [appliedFilters.dateEnd, appliedFilters.dateStart, dailyRows]);

  const rangeLabel = `${appliedFilters.dateStart || "-"} ~ ${appliedFilters.dateEnd || "-"}`;
  const hasAnyEvent = stats.totals.eventCount > 0;
  const selectedRuleRows = ruleView === "reward" ? stats.rewardRuleRows : stats.penaltyRuleRows;

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="border-b bg-white p-4 sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">경찰 통계</h2>
              <p className="text-xs text-slate-500">
                {rangeLabel}
              </p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 xl:w-auto">
            <div className="flex flex-wrap items-center gap-2">
              {RANGE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePreset(preset.days)}
                  kind="ghost"
                  tone="blue"
                  size="xs"
                  className="transition"
                >
                  {preset.label}
                </Button>
              ))}
              <label className="relative min-w-[145px]">
                <CalendarDays className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="date"
                  aria-label="통계 시작일"
                  value={tempFilters.dateStart || ""}
                  onChange={(event) =>
                    setTempFilters((prev) => ({ ...prev, dateStart: event.target.value }))
                  }
                  onKeyDown={(event) => runFilterApplyOnEnter(event, handleApply, { blur: true })}
                  className="h-9 w-full rounded-xl border border-blue-200 bg-blue-50/50 pl-9 pr-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </label>
              <span className="text-xs font-bold text-slate-400">~</span>
              <label className="relative min-w-[145px]">
                <CalendarDays className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="date"
                  aria-label="통계 종료일"
                  value={tempFilters.dateEnd || ""}
                  onChange={(event) =>
                    setTempFilters((prev) => ({ ...prev, dateEnd: event.target.value }))
                  }
                  onKeyDown={(event) => runFilterApplyOnEnter(event, handleApply, { blur: true })}
                  className="h-9 w-full rounded-xl border border-blue-200 bg-blue-50/50 pl-9 pr-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </label>
              <Button
                type="button"
                tone="blue"
                size="sm"
                disabled={hasIncompleteDateRange || hasInvalidDateRange || isLoading}
                onClick={handleApply}
              >
                {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                조회
              </Button>
            </div>
            {hasInvalidDateRange ? (
              <p className="text-xs font-bold text-rose-600">
                시작일은 종료일보다 늦을 수 없습니다.
              </p>
            ) : null}
            {hasIncompleteDateRange ? (
              <p className="text-xs text-slate-500">시작일과 종료일을 모두 입력해 주세요. 조회 전까지 기존 결과를 유지합니다.</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-5 bg-slate-50/40 p-4 sm:p-6">
        {error ? (
          <ErrorState variant="section" title={error} onRetry={fetchDailyAnalytics} />
        ) : null}

        {error ? null : isLoading ? (
          <SectionLoader message="경찰 통계를 불러오는 중입니다." />
        ) : (
          <>
            {stats.coverage.availableDays > 0 ? (
              <section aria-label="선택 기간 활동 요약" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <dl className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
                  {[
                    {label:"벌점 적용", value:stats.totals.fineCount, detail:`${stats.penaltyStudents.length}명 · ${formatClassAmount(stats.totals.fineAmount)}`},
                    {label:"상점 적용", value:stats.totals.rewardCount, detail:`${stats.rewardStudents.length}명 · ${formatClassAmount(stats.totals.rewardAmount)}`},
                    {label:"신고 접수", value:stats.totals.reportCreatedCount, detail:"기간 내 접수 기록"},
                    {label:"소명·반성 제출", value:stats.totals.reflectionSubmittedCount, detail:"기간 내 제출 기록"},
                  ].map((metric) => (
                    <div key={metric.label}>
                      <dt className="text-xs font-semibold text-slate-500">{metric.label}</dt>
                      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{formatCount(metric.value)}<span className="ml-1 text-sm font-normal">건</span></dd>
                      <dd className="mt-1 text-xs text-slate-500">{metric.detail}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            {!hasAnyEvent ? (
              <EmptyState text={stats.coverage.availableDays === 0 ? "선택한 기간의 집계 자료가 없습니다." : stats.coverage.missingDays ? "선택한 기간의 집계 자료에 활동 기록이 없습니다." : "선택한 기간에 경찰 활동 기록이 없습니다."} />
            ) : null}

            {stats.coverage.availableDays > 0 ? <>
            <div className="flex flex-col gap-2 border-b border-slate-200 bg-white sm:flex-row sm:items-center sm:justify-between">
              <Tabs ariaLabel="경찰 통계 업무" tabs={VIEW_TABS} activeTab={activeView} onTabChange={setActiveView} variant="underline" size="sm" />
              <Button
                type="button"
                kind="outline"
                tone="blue"
                size="sm"
                icon={BarChart3}
                onClick={() => setShowOperationGraphs(true)}
              >
                운영 시각화
              </Button>
            </div>

            {activeView === "summary" ? (
              <>
                <Tabs ariaLabel="요약 적용 종류" tabs={[{id:"fine",label:"벌점"},{id:"reward",label:"상점"}]} activeTab={summaryType} onTabChange={setSummaryType} variant="underline" size="sm" />
                <RankTable
                    title={summaryType === "fine" ? "벌점 적용이 많은 학생 · 상위 5명" : "상점 적용이 많은 학생 · 상위 5명"}
                    icon={Users} rows={summaryType === "fine" ? stats.penaltyStudents : stats.rewardStudents}
                    maxRows={5} minWidth="min-w-[560px]" emptyText={summaryType === "fine" ? "벌점 학생 데이터가 없습니다." : "상점 학생 데이터가 없습니다."}
                    columns={[
                      {key:"name",label:"학생",wrap:true,widthClass:"w-32",render:row=><div><p className="font-semibold text-slate-900">{row.name}</p>{row.studentNumber ? <p className="text-xs text-slate-500">{row.studentNumber}번</p> : null}</div>},
                      {key:"rules",label:"주요 적용 규칙",wrap:true,render:row=><RuleChips rules={summaryType === "fine" ? row.rules : row.rewardRules} type={summaryType}/>},
                      {key:"count",label:"건수",align:"right",widthClass:"w-20",render:row=>formatCount(row[summaryType === "fine" ? "fineCount" : "rewardCount"])+"건"},
                      {key:"amount",label:"기록 금액",align:"right",widthClass:"w-36",render:row=>formatClassAmount(row[summaryType === "fine" ? "fineAmount" : "rewardAmount"])},
                    ]}
                  />

                <div className={`grid min-w-0 gap-4 ${summaryType === "fine" ? "2xl:grid-cols-2" : ""}`}>
                {summaryType === "fine" && <RankTable
                  title="같은 규칙으로 벌점을 여러 번 받은 학생"
                  icon={BarChart3}
                  rows={stats.repeatedViolations}
                  maxRows={5}
                  minWidth="min-w-[640px]"
                  emptyText="같은 학생이 같은 규칙을 2회 이상 반복한 기록이 없습니다."
                  columns={[
                    {
                      key: "name",
                      label: "학생",
                      wrap: true,
                      widthClass: "w-24",
                      render: (row) => (
                        <div>
                          <p className="font-bold text-slate-900">{row.name}</p>
                          {row.studentNumber ? (
                            <p className="text-xs text-slate-500">{row.studentNumber}번</p>
                          ) : null}
                        </div>
                      ),
                    },
                    {
                      key: "ruleText",
                      label: "반복 규칙",
                      wrap: true,
                      render: (row) => <span className="font-bold text-slate-900">{row.ruleText}</span>,
                    },
                    {
                      key: "fineCount",
                      label: "반복 건수",
                      align: "right",
                      widthClass: "w-24",
                      render: (row) => `${formatCount(row.fineCount)}건`,
                    },
                    {
                      key: "fineAmount",
                      label: "벌점 금액",
                      align: "right",
                      widthClass: "w-32",
                      render: (row) => formatClassAmount(row.fineAmount),
                    },
                    {
                      key: "latestAppliedAt",
                      label: "최근 적용",
                      align: "right",
                      wrap: true,
                      widthClass: "w-32",
                      render: (row) => formatDateTime(row.latestAppliedAt),
                    },
                  ]}
                />}

                <RankTable
                    title={summaryType === "fine" ? "많이 적용된 벌점 규칙 · 상위 5개" : "많이 적용된 상점 규칙 · 상위 5개"}
                    icon={Scale} rows={summaryType === "fine" ? stats.penaltyRuleRows : stats.rewardRuleRows}
                    maxRows={5} minWidth="min-w-[560px]" emptyText={summaryType === "fine" ? "벌점 규칙 데이터가 없습니다." : "상점 규칙 데이터가 없습니다."}
                    columns={[
                      {key:"ruleText",label:"규칙",wrap:true,render:row=><span className="font-semibold text-slate-900">{row.ruleText}</span>},
                      {key:"count",label:"건수",align:"right",widthClass:"w-20",render:row=>formatCount(row[summaryType === "fine" ? "fineCount" : "rewardCount"])+"건"},
                      {key:"affectedStudentCount",label:"적용 학생",align:"right",widthClass:"w-20",render:row=>formatCount(row.affectedStudentCount)+"명"},
                      {key:"amount",label:"기록 금액",align:"right",widthClass:"w-36",render:row=>formatClassAmount(row[summaryType === "fine" ? "fineAmount" : "rewardAmount"])},
                    ]}
                  />
                </div>

              </>
            ) : null}

            {activeView === "students" ? (
              <PoliceStatsDetails key={rangeLabel} mode="students" rows={stats.studentRows} formatAmount={formatClassAmount} formatDate={formatDateTime} />
            ) : null}
            {activeView === "rules" ? (
              <div className="space-y-4">
                <Tabs ariaLabel="통계 규칙 종류" tabs={[{id:"fine",label:"벌점 규칙"},{id:"reward",label:"상점 규칙"}]} activeTab={ruleView} onTabChange={setRuleView} variant="underline" size="sm" />
                <PoliceStatsDetails key={rangeLabel + ruleView} mode="rules" ruleType={ruleView} rows={selectedRuleRows} formatAmount={formatClassAmount} formatDate={formatDateTime} />
              </div>
            ) : null}
            </> : null}
          </>
        )}
      </div>
      <OperationGraphModal
        isOpen={showOperationGraphs}
        onClose={() => setShowOperationGraphs(false)}
        stats={stats}
      />
    </div>
  );
};

export default React.memo(PoliceStatsTab);
