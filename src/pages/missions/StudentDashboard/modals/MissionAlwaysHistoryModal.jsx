import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
} from "@heroicons/react/24/outline";
import { Coins, Sparkles, Star } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import "dayjs/locale/ko";

import { Modal, Spinner } from "../../../../components/ui";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { useUser } from "../../../../contexts/UserContext";
import { db } from "../../../../firebase";
import { sanitizeRichHtml } from "../../../../utils/sanitizeRichHtml";
import { alwaysListAttempts } from "../../services/missionAlwaysService";
import SharedUiButton from "../../../../components/ui/Button";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.locale("ko");

const KST = "Asia/Seoul";
const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_DETAIL_PAGE_LIMIT = 100;
const MAX_DAY_DETAIL_PAGES = 5;

const ATTEMPT_STATUS_LABELS = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "반려",
  canceled: "승인 취소",
};

const ATTEMPT_STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  canceled: "bg-slate-100 text-slate-600",
};

function toDateSafe(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAttempt(item = {}) {
  return {
    ...item,
    createdAt:
      typeof item?.createdAtMs === "number"
        ? new Date(item.createdAtMs)
        : toDateSafe(item?.createdAt),
    approvedAt:
      typeof item?.approvedAtMs === "number"
        ? new Date(item.approvedAtMs)
        : toDateSafe(item?.approvedAt),
    canceledAt:
      typeof item?.canceledAtMs === "number"
        ? new Date(item.canceledAtMs)
        : toDateSafe(item?.canceledAt),
  };
}

function normalizeDay(item = {}) {
  return {
    ...item,
    dayKey: item?.dayKey || item?.id || "",
    attemptCount: Number(item?.attemptCount || 0),
    approvedCount: Number(item?.approvedCount || 0),
    pendingCount: Number(item?.pendingCount || 0),
    rewardTotal: {
      currency: Number(item?.rewardTotal?.currency || 0),
      credit: Number(item?.rewardTotal?.credit || 0),
      missionToken: Number(item?.rewardTotal?.missionToken || 0),
    },
    lastAttemptAt:
      typeof item?.lastAttemptAtMs === "number"
        ? new Date(item.lastAttemptAtMs)
        : toDateSafe(item?.lastAttemptAt),
    updatedAt:
      typeof item?.updatedAtMs === "number"
        ? new Date(item.updatedAtMs)
        : toDateSafe(item?.updatedAt),
  };
}

function hasMissionStateActivity(state = null) {
  if (!state || typeof state !== "object") return false;

  return (
    Number(state?.totalCount || 0) > 0 ||
    Number(state?.approvedCount || 0) > 0 ||
    Number(state?.pendingCount || 0) > 0 ||
    Number(state?.rewardTotal?.currency || 0) > 0 ||
    Number(state?.rewardTotal?.credit || 0) > 0 ||
    Number(state?.rewardTotal?.missionToken || 0) > 0 ||
    !!state?.lastAttemptAt ||
    !!state?.latestAttemptId
  );
}

const getDailyLimit = (mission) => {
  const fromAvailability = mission?.availability?.maxPerDay;
  const fromRoot = mission?.maxPerDay ?? mission?.dailyLimit;

  return typeof fromAvailability === "number"
    ? fromAvailability
    : typeof fromRoot === "number"
      ? fromRoot
      : 1;
};

function renderAttemptRows(items = [], missionTokenLabel) {
  return items.map((item) => {
    const currency = Number(item.rewardSnapshot?.currency || 0);
    const credit = Number(item.rewardSnapshot?.credit || 0);
    const missionToken = Number(item.rewardSnapshot?.missionToken || 0);

    return (
      <div
        key={item.id}
        className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 text-xs"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-slate-700">
            <CheckCircleIcon
              className={`h-4 w-4 ${
                item.status === "approved"
                  ? "text-emerald-500"
                  : item.status === "rejected"
                    ? "text-rose-500"
                    : item.status === "canceled"
                      ? "text-slate-400"
                      : "text-amber-500"
              }`}
            />
            {dayjs(item.createdAt).tz(KST).format("HH:mm")}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                ATTEMPT_STATUS_STYLES[item.status] ||
                "bg-slate-100 text-slate-600"
              }`}
            >
              {ATTEMPT_STATUS_LABELS[item.status] || item.status}
            </span>
          </div>
          {item.contentHtml ? (
            <div
              className="prose prose-sm max-w-none rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-slate-600"
              dangerouslySetInnerHTML={{
                __html: sanitizeRichHtml(item.contentHtml),
              }}
            />
          ) : null}
        </div>

        <div className="flex gap-1">
          {item.status === "approved" && currency > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700">
              <Coins className="h-3 w-3" />
              {currency}
            </span>
          ) : null}
          {item.status === "approved" && credit > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-yellow-50 px-1.5 py-0.5 text-yellow-700">
              <Star className="h-3 w-3" />
              {credit}
            </span>
          ) : null}
          {item.status === "approved" && missionToken > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
              <Sparkles className="h-3 w-3" />
              {missionToken} {missionTokenLabel}
            </span>
          ) : null}
        </div>
      </div>
    );
  });
}

export default function MissionAlwaysHistoryModal({ open, onClose, mission }) {
  const { classId, classData, userData, missionTokenLabel } = useUser();
  const { showFeedback } = useFeedback();
  const selfUid = userData?.uid;
  const currencyUnit = classData?.currencyUnit || "코인";

  const [days, setDays] = useState([]);
  const [fallbackAttempts, setFallbackAttempts] = useState([]);
  const [attemptsByDay, setAttemptsByDay] = useState({});
  const [loadingAttemptDays, setLoadingAttemptDays] = useState({});
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("weekly");
  const [expandedDates, setExpandedDates] = useState(new Set());

  const dailyLimit = useMemo(() => getDailyLimit(mission), [mission]);
  const usesSummaryOnlyHistory = !!mission?.autoApprove && !mission?.requireSubmissionForm;
  const resolvedClassId = mission?.classId || classId;
  const usingRawFallback = !days.length && fallbackAttempts.length > 0;

  const loadFallbackAttempts = useCallback(async () => {
    if (!resolvedClassId || !mission?.id || !selfUid) return [];

    const response = await alwaysListAttempts({
      classId: resolvedClassId,
      missionId: mission.id,
      studentUid: selfUid,
      limit: 80,
      view: "attempts",
    });

    return (response?.attempts || []).map(normalizeAttempt);
  }, [mission?.id, resolvedClassId, selfUid]);

  useEffect(() => {
    if (!open || !mission?.id || !selfUid || !resolvedClassId) return undefined;

    let cancelled = false;

    const fetchHistory = async () => {
      setLoading(true);
      setDays([]);
      setFallbackAttempts([]);
      setAttemptsByDay({});
      setExpandedDates(new Set());

      try {
        const stateRef = doc(
          db,
          `classes/${resolvedClassId}/students/${selfUid}/missionState/${mission.id}`,
        );
        const [dayResponse, stateSnap] = await Promise.all([
          alwaysListAttempts({
            classId: resolvedClassId,
            missionId: mission.id,
            studentUid: selfUid,
            limit: 60,
            view: "days",
          }),
          getDoc(stateRef),
        ]);

        if (cancelled) return;

        const nextDays = (dayResponse?.attempts || [])
          .map(normalizeDay)
          .sort((left, right) => String(right.dayKey).localeCompare(String(left.dayKey)));

        if (nextDays.length > 0 || usesSummaryOnlyHistory) {
          setDays(nextDays);
          return;
        }

        const shouldUseLegacyRawFallback = hasMissionStateActivity(
          stateSnap.exists() ? stateSnap.data() : null,
        );
        if (!shouldUseLegacyRawFallback) {
          return;
        }

        const nextAttempts = await loadFallbackAttempts();
        if (cancelled) return;
        setFallbackAttempts(nextAttempts);
      } catch (error) {
        console.error("always history summary fetch failed:", error);
        showFeedback("이력을 불러오지 못했습니다.", "error");

        /* legacy raw retry intentionally disabled for summary-first history
        if (usesSummaryOnlyHistory && !usesSummaryOnlyHistory) {
          try {
            const nextAttempts = await loadFallbackAttempts();
            if (cancelled) return;
            setFallbackAttempts(nextAttempts);
          } catch (fallbackError) {
            console.error("always history raw fallback failed:", fallbackError);
            showFeedback("이력을 불러오지 못했습니다.", "error");
          }
        } else if (usesSummaryOnlyHistory && !usesSummaryOnlyHistory) {
          showFeedback("이력을 불러오지 못했습니다.", "error");
        }
        */
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [
    loadFallbackAttempts,
    mission?.id,
    open,
    resolvedClassId,
    selfUid,
    showFeedback,
    usesSummaryOnlyHistory,
  ]);

  const loadAttemptDayDetails = useCallback(
    async (dayKey) => {
      if (
        !dayKey ||
        usesSummaryOnlyHistory ||
        usingRawFallback ||
        !resolvedClassId ||
        !mission?.id ||
        !selfUid ||
        loadingAttemptDays[dayKey] ||
        attemptsByDay[dayKey]
      ) {
        return;
      }

      setLoadingAttemptDays((prev) => ({ ...prev, [dayKey]: true }));

      try {
        const collectedAttempts = [];
        let nextCursor = null;

        for (let page = 0; page < MAX_DAY_DETAIL_PAGES; page += 1) {
          const response = await alwaysListAttempts({
            classId: resolvedClassId,
            missionId: mission.id,
            studentUid: selfUid,
            dateFrom: dayKey,
            dateTo: dayKey,
            limit: DAY_DETAIL_PAGE_LIMIT,
            cursor: nextCursor,
            view: "attempts",
          });

          collectedAttempts.push(
            ...(response?.attempts || []).map(normalizeAttempt),
          );

          if (!response?.hasMore || !response?.nextCursor) {
            break;
          }
          nextCursor = response.nextCursor;
        }

        setAttemptsByDay((prev) => ({ ...prev, [dayKey]: collectedAttempts }));
      } catch (error) {
        console.error("always history day detail fetch failed:", error);
        showFeedback("상세 제출 기록을 불러오지 못했습니다.", "error");
      } finally {
        setLoadingAttemptDays((prev) => ({ ...prev, [dayKey]: false }));
      }
    },
    [
      attemptsByDay,
      loadingAttemptDays,
      mission?.id,
      resolvedClassId,
      selfUid,
      showFeedback,
      usesSummaryOnlyHistory,
      usingRawFallback,
    ],
  );

  const groupedByDate = useMemo(() => {
    if (usingRawFallback) {
      return fallbackAttempts.reduce((accumulator, attempt) => {
        const dateKey = dayjs(attempt.createdAt)
          .tz(KST)
          .format("YYYY-MM-DD");

        if (!accumulator[dateKey]) accumulator[dateKey] = [];
        accumulator[dateKey].push(attempt);
        return accumulator;
      }, {});
    }

    return days.reduce((accumulator, day) => {
      accumulator[day.dayKey] = [day];
      return accumulator;
    }, {});
  }, [days, fallbackAttempts, usingRawFallback]);

  const sortedDates = useMemo(
    () => Object.keys(groupedByDate).sort((left, right) => right.localeCompare(left)),
    [groupedByDate],
  );

  useEffect(() => {
    if (!loading && sortedDates.length > 0 && expandedDates.size === 0) {
      setExpandedDates(new Set([sortedDates[0]]));
    }
  }, [expandedDates.size, loading, sortedDates]);

  const now = dayjs().tz(KST);
  const startOfWeek = now.startOf("isoWeek");
  const endOfWeek = now.endOf("isoWeek");
  const weekStats = useMemo(
    () =>
      WEEKDAY_LABELS.map((_, index) => {
        const targetDate = startOfWeek.add(index, "day");
        const label = targetDate.format("dd");
        const dateKey = targetDate.format("YYYY-MM-DD");
        const items = groupedByDate[dateKey] || [];

        if (!usingRawFallback) {
          const day = items[0] || {};
          const rawCount = Number(day.attemptCount || 0);
          const count = Math.min(rawCount, dailyLimit || 1);

          return {
            label,
            dateKey,
            count,
            overflow: Math.max(rawCount - (dailyLimit || 1), 0),
            currency: Number(day.rewardTotal?.currency || 0),
            credit: Number(day.rewardTotal?.credit || 0),
            missionToken: Number(day.rewardTotal?.missionToken || 0),
            percentage: Math.min((count / Math.max(dailyLimit, 1)) * 100, 100),
          };
        }

        const validAttempts = items.filter((item) =>
          ["approved", "pending"].includes(item?.status || "approved"),
        );
        const approvedAttempts = validAttempts.filter(
          (item) => item.status === "approved",
        );
        const rawCount = validAttempts.length;
        const count = Math.min(rawCount, dailyLimit || 1);

        return {
          label,
          dateKey,
          count,
          overflow: Math.max(rawCount - (dailyLimit || 1), 0),
          currency: approvedAttempts.reduce(
            (sum, item) => sum + Number(item.rewardSnapshot?.currency || 0),
            0,
          ),
          credit: approvedAttempts.reduce(
            (sum, item) => sum + Number(item.rewardSnapshot?.credit || 0),
            0,
          ),
          missionToken: approvedAttempts.reduce(
            (sum, item) => sum + Number(item.rewardSnapshot?.missionToken || 0),
            0,
          ),
          percentage: Math.min((count / Math.max(dailyLimit, 1)) * 100, 100),
        };
      }),
    [dailyLimit, groupedByDate, startOfWeek, usingRawFallback],
  );

  const totalWeekly = useMemo(
    () => weekStats.reduce((sum, item) => sum + item.count, 0),
    [weekStats],
  );
  const totalWeeklyOverflow = useMemo(
    () => weekStats.reduce((sum, item) => sum + item.overflow, 0),
    [weekStats],
  );
  const totalWeeklyCurrency = useMemo(
    () => weekStats.reduce((sum, item) => sum + item.currency, 0),
    [weekStats],
  );
  const totalWeeklyCredit = useMemo(
    () => weekStats.reduce((sum, item) => sum + item.credit, 0),
    [weekStats],
  );
  const totalWeeklyMissionToken = useMemo(
    () => weekStats.reduce((sum, item) => sum + item.missionToken, 0),
    [weekStats],
  );

  const totalCount = usingRawFallback
    ? fallbackAttempts.filter((attempt) => attempt.status !== "canceled").length
    : days.reduce((sum, day) => sum + Number(day.attemptCount || 0), 0);

  const totalCurrency = usingRawFallback
    ? fallbackAttempts
        .filter((attempt) => attempt.status === "approved")
        .reduce(
          (sum, attempt) => sum + Number(attempt.rewardSnapshot?.currency || 0),
          0,
        )
    : days.reduce((sum, day) => sum + Number(day.rewardTotal?.currency || 0), 0);

  const totalCredit = usingRawFallback
    ? fallbackAttempts
        .filter((attempt) => attempt.status === "approved")
        .reduce(
          (sum, attempt) => sum + Number(attempt.rewardSnapshot?.credit || 0),
          0,
        )
    : days.reduce((sum, day) => sum + Number(day.rewardTotal?.credit || 0), 0);
  const totalMissionToken = usingRawFallback
    ? fallbackAttempts
        .filter((attempt) => attempt.status === "approved")
        .reduce(
          (sum, attempt) =>
            sum + Number(attempt.rewardSnapshot?.missionToken || 0),
          0,
        )
    : days.reduce(
        (sum, day) => sum + Number(day.rewardTotal?.missionToken || 0),
        0,
      );

  const toggleDate = (dateKey) => {
    const shouldLoadDetail =
      !!dateKey &&
      !usingRawFallback &&
      !usesSummaryOnlyHistory &&
      !expandedDates.has(dateKey) &&
      !attemptsByDay[dateKey] &&
      !loadingAttemptDays[dateKey];

    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });

    if (shouldLoadDetail) {
      void loadAttemptDayDetails(dateKey);
    }
  };

  if (!open) return null;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="md"
      title={mission?.title || "상시과제"}
    >
      <div className="mb-3 flex justify-center gap-3">
        <button
          onClick={() => setActiveTab("weekly")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 font-medium shadow-sm transition-all ${
            activeTab === "weekly"
              ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md"
              : "bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          <ChartBarIcon className="h-4 w-4" />
          {"주간 통계"}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 font-medium shadow-sm transition-all ${
            activeTab === "history"
              ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md"
              : "bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          <ClipboardDocumentListIcon className="h-4 w-4" />
          {"전체 내역"}
        </button>
      </div>

      {loading ? (
        <div className="py-10 text-center">
          <Spinner
            tone="emerald"
            message={"\uC774\uB825\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4..."}
          />
        </div>
      ) : null}

      {!loading && activeTab === "weekly" ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-blue-50 p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-700">
                {`이번 주 (${startOfWeek.format("M/D")} ~ ${endOfWeek.format("M/D")})`}
              </h4>
              <span className="text-[11px] text-slate-500">
                {`일일 제한 ${dailyLimit}회`}
              </span>
            </div>

            <div className="space-y-2">
              {weekStats.map((day) => (
                <div key={day.dateKey} className="flex items-center text-xs">
                  <span className="w-6 font-semibold text-slate-700">
                    {day.label}
                  </span>
                  <div className="mx-3 h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
                      style={{ width: `${day.percentage}%` }}
                    />
                  </div>
                  <div className="flex w-20 items-center justify-end gap-1 text-right font-medium text-slate-600">
                    <span>
                      {day.count}/{dailyLimit}
                    </span>
                    {day.overflow > 0 ? (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                        +{day.overflow}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-center gap-4 rounded-xl border bg-white p-3 text-sm shadow-sm">
            <span className="flex items-center gap-1 font-semibold text-slate-700">
              <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
              {`${totalWeekly}회`}
              {totalWeeklyOverflow > 0 ? (
                <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                  +{totalWeeklyOverflow}
                </span>
              ) : null}
            </span>
            {totalWeeklyCurrency > 0 ? (
              <span className="flex items-center gap-1 text-amber-700">
                <Coins className="h-4 w-4" />
                {totalWeeklyCurrency}
              </span>
            ) : null}
            {totalWeeklyCredit > 0 ? (
              <span className="flex items-center gap-1 text-yellow-700">
                <Star className="h-4 w-4" />
                {totalWeeklyCredit}
              </span>
            ) : null}
            {totalWeeklyMissionToken > 0 ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <Sparkles className="h-4 w-4" />
                {totalWeeklyMissionToken} {missionTokenLabel}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {!loading && activeTab === "history" ? (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {totalCount === 0 ? (
            <div className="py-10 text-center text-slate-400">
              <CalendarIcon className="mx-auto mb-2 h-12 w-12 opacity-50" />
              <p className="text-sm">{"아직 완료 이력이 없습니다."}</p>
            </div>
          ) : (
            sortedDates.map((dateKey) => {
              const items = groupedByDate[dateKey] || [];
              const isOpen = expandedDates.has(dateKey);
              const dayOfWeek = dayjs(dateKey).day();
              const dayKo = ["일", "월", "화", "수", "목", "금", "토"][dayOfWeek];

              const dateCurrency = usingRawFallback
                ? items
                    .filter((item) => item.status === "approved")
                    .reduce(
                      (sum, item) =>
                        sum + Number(item.rewardSnapshot?.currency || 0),
                      0,
                    )
                : Number(items[0]?.rewardTotal?.currency || 0);

              const dateCredit = usingRawFallback
                ? items
                    .filter((item) => item.status === "approved")
                    .reduce(
                      (sum, item) =>
                        sum + Number(item.rewardSnapshot?.credit || 0),
                      0,
                    )
                : Number(items[0]?.rewardTotal?.credit || 0);
              const dateMissionToken = usingRawFallback
                ? items
                    .filter((item) => item.status === "approved")
                    .reduce(
                      (sum, item) =>
                        sum + Number(item.rewardSnapshot?.missionToken || 0),
                      0,
                    )
                : Number(items[0]?.rewardTotal?.missionToken || 0);

              const countLabel = usingRawFallback
                ? items.filter((item) => item.status !== "canceled").length
                : Number(items[0]?.attemptCount || 0);

              return (
                <div
                  key={dateKey}
                  className="rounded-xl border border-slate-200 bg-slate-50 shadow-sm"
                >
                  <button
                    onClick={() => toggleDate(dateKey)}
                    className="flex w-full items-center justify-between rounded-t-xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? (
                        <ChevronDownIcon className="h-4 w-4 text-slate-500" />
                      ) : (
                        <ChevronRightIcon className="h-4 w-4 text-slate-500" />
                      )}
                      {`${dayjs(dateKey).format("M월 D일")} (${dayKo})`}
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-600">
                        {`${countLabel}회`}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px]">
                      {dateCurrency > 0 ? (
                        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">
                          <Coins className="h-3 w-3" />
                          {dateCurrency}
                        </span>
                      ) : null}
                      {dateCredit > 0 ? (
                        <span className="flex items-center gap-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-yellow-700">
                          <Star className="h-3 w-3" />
                          {dateCredit}
                        </span>
                      ) : null}
                      {dateMissionToken > 0 ? (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
                          <Sparkles className="h-3 w-3" />
                          {dateMissionToken} {missionTokenLabel}
                        </span>
                      ) : null}
                    </div>
                  </button>

                  {isOpen ? (
                    <div className="space-y-1 rounded-b-xl bg-white px-5 py-2">
                      {usingRawFallback ? (
                        renderAttemptRows(items, missionTokenLabel)
                      ) : usesSummaryOnlyHistory ? (
                        <div className="flex items-center justify-between border-b border-slate-100 py-2 text-xs">
                          <span className="text-slate-700">
                            {"자동승인 일일 기록"}
                          </span>
                          <span className="text-slate-500">
                            {`${Number(items[0]?.attemptCount || 0)}회 수행`}
                          </span>
                        </div>
                      ) : loadingAttemptDays[dateKey] ? (
                        <div className="py-4 text-center text-xs text-slate-500">
                          {"상세 제출을 불러오는 중입니다..."}
                        </div>
                      ) : attemptsByDay[dateKey]?.length > 0 ? (
                        renderAttemptRows(
                          attemptsByDay[dateKey],
                          missionTokenLabel,
                        )
                      ) : (
                        <div className="py-4 text-center text-xs text-slate-500">
                          {"상세 제출 본문이 아직 없거나 요약만 남아 있습니다."}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {!loading ? (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <div className="flex items-center gap-4">
            <span>{`총 ${totalCount}회`}</span>
            {totalCurrency > 0 ? <span>{`${currencyUnit} ${totalCurrency}`}</span> : null}
            {totalCredit > 0 ? <span>{`신용 ${totalCredit}`}</span> : null}
            {totalMissionToken > 0 ? (
              <span>{`${missionTokenLabel} ${totalMissionToken}`}</span>
            ) : null}
          </div>
          <SharedUiButton type="submit" tone="slate" kind="solid" size="sm"
            onClick={onClose}
            className="transition"
          >
            {"닫기"}
          </SharedUiButton>
        </div>
      ) : null}
    </Modal>
  );
}
