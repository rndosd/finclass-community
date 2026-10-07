import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Award,
  BarChart3,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { Spinner } from "../../../components/ui";
import CurrentCreditDistribution from "./CurrentCreditDistribution";
import { normalizeCreditScore } from "../utils/tierUtils";
import { db } from "../../../firebase";
import { getRecentDateRangeInKST } from "../../../utils/kstDate";

const RANGE_PRESETS = [
  { id: "14d", label: "14일", days: 14 },
  { id: "30d", label: "30일", days: 30 },
  { id: "60d", label: "60일", days: 60 },
];

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const formatNumber = (value) =>
  Math.round(toNumber(value)).toLocaleString("ko-KR");

const formatSigned = (value) => {
  const numeric = Math.round(toNumber(value));
  if (numeric > 0) return `+${numeric.toLocaleString("ko-KR")}`;
  return numeric.toLocaleString("ko-KR");
};

const normalizeStudentNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value);
};

const normalizeDailyDoc = (docSnap) => {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    date: String(data.date || docSnap.id),
    status: data.status || "empty",
    snapshot:
      data.snapshot && typeof data.snapshot === "object" ? data.snapshot : {},
    eventTotals:
      data.eventTotals && typeof data.eventTotals === "object"
        ? data.eventTotals
        : {},
    byStudent:
      data.byStudent && typeof data.byStudent === "object"
        ? data.byStudent
        : {},
    byReason:
      data.byReason && typeof data.byReason === "object" ? data.byReason : {},
  };
};

const getStudentName = (student = {}) =>
  String(student.studentName || student.name || "학생").trim() || "학생";

const buildRange = (presetId) => {
  const preset =
    RANGE_PRESETS.find((item) => item.id === presetId) || RANGE_PRESETS[1];
  return getRecentDateRangeInKST({ days: preset.days, endOffsetDays: -1 });
};

const normalizeRange = (rangePreset, customRange) => {
  if (customRange?.startDate && customRange?.endDate) return customRange;
  return buildRange(rangePreset);
};

function useCreditAnalyticsDaily({ classId, rangePreset, customRange }) {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const range = useMemo(
    () => normalizeRange(rangePreset, customRange),
    [customRange, rangePreset],
  );

  useEffect(() => {
    if (!classId || !range.startDate || !range.endDate) {
      setRows([]);
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);
    const ref = collection(db, "classes", classId, "creditAnalyticsDaily");
    const dailyQuery = query(
      ref,
      where("date", ">=", range.startDate),
      where("date", "<=", range.endDate),
      orderBy("date", "desc"),
    );

    const unsubscribe = onSnapshot(
      dailyQuery,
      (snapshot) => {
        setRows(snapshot.docs.map(normalizeDailyDoc));
        setIsLoading(false);
      },
      () => {
        setRows([]);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [classId, range.endDate, range.startDate]);

  return { rows, isLoading, range };
}

const EmptyState = ({ title, description }) => (
  <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
    <p className="text-sm font-bold text-slate-600">{title}</p>
    {description ? (
      <p className="mt-1 text-xs text-slate-400">{description}</p>
    ) : null}
  </div>
);

const MetricCard = ({ title, value, subText, icon: Icon, tone = "slate" }) => {
  const toneClass =
    {
      indigo: "bg-indigo-50 text-indigo-600",
      emerald: "bg-emerald-50 text-emerald-600",
      rose: "bg-rose-50 text-rose-600",
      amber: "bg-amber-50 text-amber-600",
      slate: "bg-slate-100 text-slate-600",
    }[tone] || "bg-slate-100 text-slate-600";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
          {subText ? (
            <p className="mt-1 text-xs font-medium text-slate-500">{subText}</p>
          ) : null}
        </div>
        <span className={`rounded-lg p-2 ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
};

const Section = ({ title, description, icon: Icon, children }) => (
  <section className="rounded-lg border border-slate-200 bg-white">
    <div className="flex items-start gap-2 border-b border-slate-100 px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 text-slate-500" />
      <div>
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
    </div>
    <div className="p-4">{children}</div>
  </section>
);

const StudentRow = ({ student, tone }) => {
  const isGood = tone === "good";
  const Icon = isGood ? ChevronUp : ChevronDown;
  const deltaClass = student.rangeDelta >= 0 ? "text-emerald-600" : "text-rose-600";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-black text-slate-900">
            {student.name}
          </p>
          {student.number !== null ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
              {student.number}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">{student.reason}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-right">
        <div>
          <p className="text-sm font-black text-slate-900">
            {student.latestScore === null ? "-" : formatNumber(student.latestScore)}
          </p>
          <p className={`text-xs font-bold ${deltaClass}`}>
            {formatSigned(student.rangeDelta)}
          </p>
        </div>
        <span
          className={`rounded-lg p-2 ${
            isGood ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
};

const ReasonList = ({ reasons }) => {
  if (!reasons.length) {
    return (
      <EmptyState
        title="변화 사유가 아직 없어요"
        description="신용 로그가 쌓이면 상승/하락 사유가 여기에 정리됩니다."
      />
    );
  }

  return (
    <div className="space-y-2">
      {reasons.map((reason) => {
        const isPositive = reason.netDelta >= 0;
        return (
          <div
            key={reason.reason}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-800">
                {reason.reason}
              </p>
              <p className="text-xs text-slate-500">{formatNumber(reason.count)}건</p>
            </div>
            <span
              className={`shrink-0 text-sm font-black ${
                isPositive ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {formatSigned(reason.netDelta)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

function buildFlowSummary(rows, students) {
  const ascendingRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const latestReady = [...rows]
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((row) => row.status === "ready" || row.snapshot?.scoreStudentCount);
  const latestSnapshot = latestReady?.snapshot || {};
  const studentsByUid = new Map(
    (students || []).filter((student) => student?.role !== "teacher").map((student) => [
      student.uid,
      {
        uid: student.uid,
        name: getStudentName(student),
        number: normalizeStudentNumber(student.studentNumber || student.number),
        fallbackScore: normalizeCreditScore(student.creditScore),
      },
    ]),
  );

  const trendRows = ascendingRows
    .filter((row) => Number.isFinite(Number(row.snapshot?.averageScore)))
    .map((row) => ({
      date: row.date.slice(5),
      averageScore: toNumber(row.snapshot.averageScore),
      lowScoreStudentCount: toNumber(row.eventTotals?.lowScoreStudentCount),
    }));

  const studentStats = new Map();
  const ensureStudent = (uid, fallback = {}) => {
    const base = studentsByUid.get(uid) || {};
    if (!studentStats.has(uid)) {
      studentStats.set(uid, {
        uid,
        name: base.name || getStudentName(fallback),
        number:
          base.number ??
          normalizeStudentNumber(fallback.studentNumber || fallback.number),
        fallbackScore: base.fallbackScore ?? null,
        firstScore: null,
        latestScore: null,
        rangeDelta: 0,
        logDelta: 0,
        logCount: 0,
        activeDays: 0,
      });
    }
    return studentStats.get(uid);
  };

  ascendingRows.forEach((row) => {
    Object.entries(row.byStudent || {}).forEach(([uid, entry]) => {
      const student = ensureStudent(uid, entry);
      const score = Number(entry.score);
      if (Number.isFinite(score)) {
        if (student.firstScore === null) student.firstScore = score;
        student.latestScore = score;
      }
      student.rangeDelta += toNumber(entry.delta);
      student.logDelta += toNumber(entry.logDelta);
      student.logCount += toNumber(entry.logCount);
      student.activeDays += 1;
    });
  });

  studentsByUid.forEach((base, uid) => {
    const student = ensureStudent(uid, base);
    if (student.latestScore === null) student.latestScore = base.fallbackScore;
  });

  const studentRows = Array.from(studentStats.values());
  const sortedByScore = studentRows
    .filter((student) => Number.isFinite(Number(student.latestScore)))
    .sort((a, b) => toNumber(a.latestScore) - toNumber(b.latestScore));
  const relativeGroupSize = Math.max(1, Math.ceil(sortedByScore.length * 0.2));
  const lowerScoreRank = new Map();
  const higherScoreRank = new Set();

  sortedByScore.forEach((student, index) => {
    if (index < relativeGroupSize) {
      lowerScoreRank.set(student.uid, relativeGroupSize - index);
    }
    if (index >= sortedByScore.length - relativeGroupSize) {
      higherScoreRank.add(student.uid);
    }
  });

  const rankedStudents = studentRows.map((student) => {
    const relativeScoreRisk = lowerScoreRank.get(student.uid) || 0;
    const declineRisk = Math.max(0, -student.rangeDelta);
    const logRisk = Math.max(0, -student.logDelta) / 2;
    const riskScore = relativeScoreRisk + declineRisk + logRisk;
    const reasonParts = [];
    if (relativeScoreRisk > 0) reasonParts.push("반 내 낮은 점수권");
    if (student.rangeDelta < 0) reasonParts.push("최근 하락");
    if (student.logDelta < 0) reasonParts.push("차감 로그 누적");
    if (!reasonParts.length) reasonParts.push("흐름 확인");

    return {
      ...student,
      riskScore,
      reason: reasonParts.join(" · "),
    };
  });

  const attentionCandidates = rankedStudents
    .filter(
      (student) =>
        student.riskScore > 0 ||
        student.rangeDelta < 0 ||
        student.logDelta < 0,
    )
    .sort((a, b) => b.riskScore - a.riskScore || toNumber(a.latestScore) - toNumber(b.latestScore));
  const attentionStudents = attentionCandidates
    .slice(0, 6);

  const strongStudents = rankedStudents
    .filter(
      (student) =>
        student.latestScore !== null &&
        (higherScoreRank.has(student.uid) || student.rangeDelta > 0),
    )
    .map((student) => ({
      ...student,
      reason: [
        higherScoreRank.has(student.uid) ? "반 내 높은 점수권" : "",
        student.rangeDelta > 0 ? "최근 상승" : "",
      ].filter(Boolean).join(" · "),
    }))
    .sort(
      (a, b) =>
        b.rangeDelta - a.rangeDelta ||
        toNumber(b.latestScore) - toNumber(a.latestScore),
    )
    .slice(0, 6);

  const reasonMap = new Map();
  rows.forEach((row) => {
    Object.values(row.byReason || {}).forEach((reason) => {
      const key = String(reason.reason || "사유 없음").trim() || "사유 없음";
      const current = reasonMap.get(key) || {
        reason: key,
        count: 0,
        netDelta: 0,
      };
      current.count += toNumber(reason.count);
      current.netDelta += toNumber(reason.netDelta);
      reasonMap.set(key, current);
    });
  });

  const reasons = Array.from(reasonMap.values())
    .filter((reason) => reason.count > 0)
    .sort((a, b) => Math.abs(b.netDelta) - Math.abs(a.netDelta))
    .slice(0, 8);

  const firstTrend = trendRows[0] || null;
  const lastTrend = trendRows[trendRows.length - 1] || null;
  const averageDelta =
    firstTrend && lastTrend
      ? toNumber(lastTrend.averageScore) - toNumber(firstTrend.averageScore)
      : 0;

  return {
    latestDate: latestReady?.date || null,
    trendRows,
    attentionStudents,
    strongStudents,
    reasons,
    averageDelta,
    latestAverage: latestSnapshot.averageScore ?? null,
    latestMedian: latestSnapshot.medianScore ?? null,
    attentionCandidateCount: attentionCandidates.length,
    scoreStudentCount: latestSnapshot.scoreStudentCount ?? 0,
  };
}

export default function CreditFlowTab({ classId, students = [], tierCriteria = [] }) {
  const [rangePreset, setRangePreset] = useState("30d");
  const [customRange, setCustomRange] = useState(() => buildRange("30d"));
  const { rows, isLoading, range } = useCreditAnalyticsDaily({
    classId,
    rangePreset,
    customRange,
  });
  const summary = useMemo(
    () => buildFlowSummary(rows, students),
    [rows, students],
  );

  const handlePresetClick = (presetId) => {
    setRangePreset(presetId);
    setCustomRange(buildRange(presetId));
  };

  const handleRangeChange = (field, value) => {
    setRangePreset("custom");
    setCustomRange((current) => ({
      ...current,
      [field]: value,
    }));
  };

  if (isLoading && rows.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-slate-200 bg-white">
        <Spinner size="lg" message="신용 흐름을 불러오는 중입니다" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-black text-slate-900">신용 흐름</h2>
          <p className="mt-1 text-xs text-slate-500">
            {range.startDate}부터 {range.endDate}까지의 일일 집계 기준입니다.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetClick(preset.id)}
                className={`rounded-md px-3 py-2 text-xs font-black transition ${
                  rangePreset === preset.id
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:bg-white/70 hover:text-slate-900"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <input
              type="date"
              value={customRange.startDate || ""}
              onChange={(event) => handleRangeChange("startDate", event.target.value)}
              max={customRange.endDate || undefined}
              className="h-9 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-xs font-bold text-slate-700"
              aria-label="신용 흐름 시작일"
            />
            <span>~</span>
            <input
              type="date"
              value={customRange.endDate || ""}
              onChange={(event) => handleRangeChange("endDate", event.target.value)}
              min={customRange.startDate || undefined}
              className="h-9 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-xs font-bold text-slate-700"
              aria-label="신용 흐름 종료일"
            />
          </div>
        </div>
      </div>

      <CurrentCreditDistribution students={students} tierCriteria={tierCriteria} />

      {!rows.length ? (
        <EmptyState
          title="아직 신용 통계 집계가 없어요"
          description="신용 활동 기록이 집계되면 과거 흐름이 표시됩니다. 현재 등급 분포는 위에서 확인할 수 있습니다."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="최근 평균"
              value={
                summary.latestAverage === null
                  ? "-"
                  : formatNumber(summary.latestAverage)
              }
              subText={`기간 변화 ${formatSigned(summary.averageDelta)}`}
              icon={TrendingUp}
              tone={summary.averageDelta >= 0 ? "emerald" : "rose"}
            />
            <MetricCard
              title="최근 중앙값"
              value={
                summary.latestMedian === null
                  ? "-"
                  : formatNumber(summary.latestMedian)
              }
              subText={summary.latestDate ? `${summary.latestDate} 기준` : ""}
              icon={BarChart3}
              tone="indigo"
            />
            <MetricCard
              title="관심 후보"
              value={`${formatNumber(summary.attentionCandidateCount)}명`}
              subText="상대 순위와 최근 흐름 기준"
              icon={AlertTriangle}
              tone={summary.attentionCandidateCount > 0 ? "amber" : "slate"}
            />
            <MetricCard
              title="집계 학생"
              value={`${formatNumber(summary.scoreStudentCount)}명`}
              subText="최근 스냅샷 기준"
              icon={Users}
              tone="slate"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_0.9fr]">
            <Section
              title="반 평균 흐름"
              description="평균 신용점수가 어떤 방향으로 움직이는지 봅니다."
              icon={HeartPulse}
            >
              {summary.trendRows.length ? (
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={summary.trendRows}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#64748b" }} width={38} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="averageScore"
                        name="평균 점수"
                        stroke="#4f46e5"
                        strokeWidth={3}
                        dot={{ r: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState title="표시할 평균 흐름이 없어요" />
              )}
            </Section>


          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Section
              title="봐줘야 할 학생"
              description="반 안에서 상대적으로 낮은 점수권, 최근 하락, 차감 로그를 함께 봅니다."
              icon={TrendingDown}
            >
              {summary.attentionStudents.length ? (
                summary.attentionStudents.map((student) => (
                  <StudentRow key={student.uid} student={student} tone="watch" />
                ))
              ) : (
                <EmptyState title="크게 걱정할 흐름이 없어요" />
              )}
            </Section>

            <Section
              title="잘하고 있는 학생"
              description="높은 점수 유지 또는 최근 상승 흐름이 있는 학생입니다."
              icon={Award}
            >
              {summary.strongStudents.length ? (
                summary.strongStudents.map((student) => (
                  <StudentRow key={student.uid} student={student} tone="good" />
                ))
              ) : (
                <EmptyState title="상승 흐름이 더 쌓이면 여기에 표시됩니다" />
              )}
            </Section>
          </div>

          <Section
            title="변화 사유"
            description="기간 내 신용 로그 사유별 순변화를 큰 순서대로 봅니다."
            icon={TrendingUp}
          >
            <ReasonList reasons={summary.reasons} />
          </Section>
        </>
      )}
    </div>
  );
}
