import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import {
  ArrowRight,
  Award,
  LineChart,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Badge, Button, Card } from "../../../components/ui";
import creditScoreShieldIllustration from "../../../assets/dashboard/credit-score-shield-v1.webp";
import { db } from "../../../firebase";
import { fetchCreditLogsSince } from "../utils/creditLogReads";
import CreditTrendChart from "./CreditTrendChart";
import CreditScoreChange from "./CreditScoreChange";
import { formatCreditScore, normalizeCreditScore } from "../utils/tierUtils";

export default function MyCreditTab({
  classId,
  student,
  tierInfo,
  tierCriteria = [],
  creditScoreMax,
  onViewAllLogs,
}) {
  const [recentLogs, setRecentLogs] = useState([]);
  const [recentStats, setRecentStats] = useState({
    plus: 0,
    minus: 0,
    loading: true,
  });
  const [weeklyDrivers, setWeeklyDrivers] = useState({
    positive: null,
    negative: null,
    loading: true,
  });

  const currentScore = normalizeCreditScore(student?.creditScore);

  const { currentTier, nextTier, progressPercentage, pointsToNext } = useMemo(() => {
    const sortedCriteria = [...tierCriteria].sort(
      (a, b) => Number(b?.minScore || 0) - Number(a?.minScore || 0),
    );
    const resolvedCurrentTier =
      sortedCriteria.find((tier) => tier?.id === tierInfo?.id) || tierInfo;

    if (!resolvedCurrentTier?.id || currentScore === null) {
      return {
        currentTier: resolvedCurrentTier,
        nextTier: null,
        progressPercentage: 0,
        pointsToNext: 0,
      };
    }

    const currentTierIndex = sortedCriteria.findIndex(
      (tier) => tier?.id === resolvedCurrentTier.id,
    );
    const resolvedNextTier =
      currentTierIndex > 0 ? sortedCriteria[currentTierIndex - 1] : null;

    if (!resolvedNextTier?.minScore) {
      return {
        currentTier: resolvedCurrentTier,
        nextTier: null,
        progressPercentage: 100,
        pointsToNext: 0,
      };
    }

    const currentTierMin = Number(resolvedCurrentTier?.minScore || 0);
    const nextTierMin = Number(resolvedNextTier.minScore || 0);
    const rangeSize = Math.max(1, nextTierMin - currentTierMin);
    const currentProgress = currentScore - currentTierMin;

    return {
      currentTier: resolvedCurrentTier,
      nextTier: resolvedNextTier,
      progressPercentage: Math.min(
        100,
        Math.max(0, (currentProgress / rangeSize) * 100),
      ),
      pointsToNext: Math.max(0, nextTierMin - currentScore),
    };
  }, [currentScore, tierCriteria, tierInfo]);

  useEffect(() => {
    if (!classId || !student?.uid) {
      setRecentLogs([]);
      return undefined;
    }

    const logQuery = query(
      collection(db, `classes/${classId}/students/${student.uid}/creditLogs`),
      orderBy("timestamp", "desc"),
      limit(5),
    );

    const unsubscribe = onSnapshot(
      logQuery,
      (snapshot) => {
        setRecentLogs(
          snapshot.docs.map((logDoc) => ({ id: logDoc.id, ...logDoc.data() })),
        );
      },
      () => {
        setRecentLogs([]);
      },
    );

    return () => unsubscribe();
  }, [classId, student?.uid]);

  useEffect(() => {
    if (!classId || !student?.uid) {
      setRecentStats({ plus: 0, minus: 0, loading: false });
      setWeeklyDrivers({ positive: null, negative: null, loading: false });
      return undefined;
    }

    let cancelled = false;

    const fetchWeeklySummary = async () => {
      setRecentStats((prev) => ({ ...prev, loading: true }));
      setWeeklyDrivers((prev) => ({ ...prev, loading: true }));

      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const snapshot = await fetchCreditLogsSince(classId, student.uid, sevenDaysAgo);
        if (cancelled) return;

        const stats = { plus: 0, minus: 0 };
        const grouped = { positive: new Map(), negative: new Map() };

        snapshot.docs.forEach((logDoc) => {
          const data = logDoc.data() || {};
          const delta = Number(data?.delta ?? data?.amount ?? 0);
          const reason = String(data?.reason || "사유 없음").trim() || "사유 없음";

          if (delta > 0) {
            stats.plus += delta;
            grouped.positive.set(reason, (grouped.positive.get(reason) || 0) + delta);
          } else if (delta < 0) {
            stats.minus += Math.abs(delta);
            grouped.negative.set(
              reason,
              (grouped.negative.get(reason) || 0) + Math.abs(delta),
            );
          }
        });

        const topPositive = Array.from(grouped.positive.entries()).sort(
          (a, b) => b[1] - a[1],
        )[0];
        const topNegative = Array.from(grouped.negative.entries()).sort(
          (a, b) => b[1] - a[1],
        )[0];

        setRecentStats({ ...stats, loading: false });
        setWeeklyDrivers({
          positive: topPositive
            ? { reason: topPositive[0], score: topPositive[1] }
            : null,
          negative: topNegative
            ? { reason: topNegative[0], score: topNegative[1] }
            : null,
          loading: false,
        });
      } catch {
        if (cancelled) return;
        setRecentStats({ plus: 0, minus: 0, loading: false });
        setWeeklyDrivers({ positive: null, negative: null, loading: false });
      }
    };

    void fetchWeeklySummary();

    return () => {
      cancelled = true;
    };
  }, [classId, student?.uid]);

  const weeklyNet = recentStats.plus - recentStats.minus;
  const hasWeeklyMovement = recentStats.plus > 0 || recentStats.minus > 0;
  const weeklyNetIsPositive = weeklyNet >= 0;
  const tierMarkers = [
    {
      id: "current-tier",
      value: Number(currentTier?.minScore),
      label: `${currentTier?.name || ""} \uAE30\uC900`,
      color: "#cbd5e1",
    },
    {
      id: "next-tier",
      value: Number(nextTier?.minScore),
      label: `${nextTier?.name || ""} \uAE30\uC900`,
      color: currentTier?.color || "#4f46e5",
    },
  ].filter((marker) => Number.isFinite(marker.value) && marker.value > 0);

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="relative overflow-hidden px-1 sm:px-2">
        <div className="relative py-3 sm:py-5 lg:py-6">
          <img
            src={creditScoreShieldIllustration}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute right-7 top-6 hidden h-24 w-24 object-contain opacity-95 xl:block"
          />

          <div className="grid gap-7 lg:grid-cols-[minmax(0,0.92fr)_minmax(340px,1.08fr)] lg:gap-10">
            <section className="min-w-0">
              <div className="flex items-center gap-2 text-indigo-600">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-xs font-black tracking-[0.14em] text-slate-500">
                  {"\uB098\uC758 \uC2E0\uC6A9"}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
                <div className="flex items-end gap-1">
                  <span className="text-5xl font-black tracking-[-0.07em] text-slate-950 sm:text-6xl">
                    {formatCreditScore(currentScore)}
                  </span>
                  <span className="mb-1 text-base font-black text-slate-500">
                    {currentScore !== null ? "점" : ""}
                  </span>
                </div>
                <Badge
                  variant="soft"
                  className="mb-1 rounded-full px-3 py-1.5 text-sm font-black"
                  style={{
                    backgroundColor: `${currentTier?.color || "#4f46e5"}18`,
                    color: currentTier?.color || "#4f46e5",
                  }}
                >
                  {currentTier?.name || "등급 미설정"}
                </Badge>
              </div>

              <p
                className={`mt-3 text-sm font-bold sm:text-base ${
                  recentStats.loading
                    ? "text-slate-500"
                    : weeklyNetIsPositive
                      ? "text-emerald-700"
                      : "text-rose-700"
                }`}
              >
                {recentStats.loading
                  ? "\uC774\uBC88 \uC8FC \uC2E0\uC6A9 \uBCC0\uD654\uB97C \uACC4\uC0B0\uD558\uB294 \uC911\uC774\uC5D0\uC694"
                  : hasWeeklyMovement
                    ? `\uC774\uBC88 \uC8FC ${weeklyNetIsPositive ? "+" : ""}${weeklyNet.toLocaleString()}\uC810 \uBCC0\uD654\uD588\uC5B4\uC694`
                    : "\uC774\uBC88 \uC8FC\uB294 \uC2E0\uC6A9 \uC810\uC218 \uBCC0\uD654\uAC00 \uC5C6\uC5B4\uC694"}
              </p>
            </section>

            <section className="min-w-0 border-t border-slate-100 pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-1">
              {nextTier ? (
                <>
                  <p className="text-sm font-bold text-slate-500">
                    {"\uB2E4\uC74C \uB4F1\uAE09 \uBAA9\uD45C"}
                  </p>
                  <p className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                    {`${nextTier.name || "-"} \uB4F1\uAE09\uAE4C\uC9C0 `}
                    <span className="text-indigo-600">
                      {`${pointsToNext.toLocaleString()}\uC810`}
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-slate-500">
                    {"\uD604\uC7AC \uB4F1\uAE09"}
                  </p>
                  <p className="mt-1 text-2xl font-black tracking-tight text-indigo-600 sm:text-3xl">
                    {currentScore === null || !currentTier?.id
                      ? "점수와 등급 기준을 확인해 주세요"
                      : "최고 등급을 달성했어요"}
                  </p>
                </>
              )}

              <div className="mt-5">
                <div className="relative h-3 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-[width] duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  />
                  {nextTier ? (
                    <span
                      className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-4 border-white bg-indigo-600 shadow-sm"
                      style={{ left: `calc(${progressPercentage}% - 10px)` }}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-500">
                  <span>{currentScore === null ? "미설정" : `${formatCreditScore(currentScore)}점`}</span>
                  <span>
                    {nextTier
                      ? `${Number(nextTier.minScore || 0).toLocaleString()}\uC810`
                      : creditScoreMax
                        ? `${Number(creditScoreMax).toLocaleString()}\uC810`
                        : ""}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <div className="mt-6 grid rounded-2xl border border-white bg-white/85 px-3 py-2 shadow-[0_14px_32px_-26px_rgba(30,64,175,0.45)] sm:grid-cols-3 sm:divide-x sm:divide-slate-100">
            <div className="flex items-center gap-3 py-2 sm:px-4 sm:first:pl-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <TrendingUp className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-500">{"\uC774\uBC88 \uC8FC \uC0C1\uC2B9"}</p>
                <p className="mt-0.5 text-lg font-black text-emerald-600">
                  {recentStats.loading ? "..." : `+${recentStats.plus.toLocaleString()}\uC810`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 py-2 sm:px-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                <TrendingDown className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-500">{"\uC774\uBC88 \uC8FC \uD558\uB77D"}</p>
                <p className="mt-0.5 text-lg font-black text-rose-600">
                  {recentStats.loading ? "..." : `-${recentStats.minus.toLocaleString()}\uC810`}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-3 py-2 sm:px-4 sm:pr-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <Award className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">{"\uAC00\uC7A5 \uD070 \uBCC0\uD654"}</p>
                <p className="mt-0.5 truncate text-sm font-black text-slate-800">
                  {weeklyDrivers.loading
                    ? "\uACC4\uC0B0 \uC911..."
                    : weeklyDrivers.positive
                      ? `${weeklyDrivers.positive.reason} +${weeklyDrivers.positive.score}\uC810`
                      : "\uC544\uC9C1 \uC5C6\uC5B4\uC694"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card noPadding className="rounded-[28px] border border-slate-100 bg-white shadow-[0_16px_36px_-30px_rgba(15,23,42,0.38)]">
          <Card.Content noPadding className="p-5 sm:p-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <LineChart className="h-5 w-5 text-indigo-500" />
                <h3 className="text-base font-black text-slate-900">{"\uC2E0\uC6A9 \uC810\uC218 \uCD94\uC774"}</h3>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold text-slate-500">
                {tierMarkers.map((marker) => (
                  <span key={marker.id} className="inline-flex items-center gap-1.5">
                    <span
                      className="h-0 w-4 border-t-2 border-dashed"
                      style={{ borderColor: marker.color }}
                    />
                    {`${marker.label} ${marker.value.toLocaleString()}\uC810`}
                  </span>
                ))}
              </div>
            </div>

            <div className="min-h-[280px] overflow-hidden rounded-[24px] border border-slate-100 bg-slate-50/70 p-3 sm:min-h-[320px] sm:p-5">
              <CreditTrendChart
                classId={classId}
                studentUid={student?.uid}
                tierMarkers={tierMarkers}
                embedded
              />
            </div>
          </Card.Content>
        </Card>

        <Card noPadding className="rounded-[28px] border border-slate-100 bg-white shadow-[0_16px_36px_-30px_rgba(15,23,42,0.38)]">
          <Card.Content noPadding className="p-5 sm:p-7">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-indigo-500" />
                <h3 className="text-base font-black text-slate-900">
                  {"\uCD5C\uADFC \uC2E0\uC6A9 \uAE30\uB85D"}
                </h3>
              </div>
              <Button
                type="button"
                tone="lightBlue"
                kind="ghost"
                size="sm"
                icon={ArrowRight}
                onClick={onViewAllLogs}
                
              >
                {"\uC804\uCCB4 \uB0B4\uC5ED"}
              </Button>
            </div>

            {recentLogs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center text-sm font-semibold text-slate-400">
                {"\uC544\uC9C1 \uAE30\uB85D\uC774 \uC5C6\uC5B4\uC694."}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentLogs.map((log) => {
                  const delta = Number(log?.delta ?? log?.amount ?? 0);
                  const isPositive = delta > 0;
                  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

                  return (
                    <div key={log.id} className="flex items-center gap-3 py-3.5 first:pt-2">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                          isPositive
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-rose-50 text-rose-600"
                        }`}
                      >
                        <TrendIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-slate-800">
                          {log.reason || "\uC0AC\uC720 \uC5C6\uC74C"}
                        </p>
                        <CreditScoreChange log={log} />
                        <p className="mt-0.5 text-xs font-medium text-slate-400">
                          {log.timestamp?.toDate
                            ? log.timestamp.toDate().toLocaleDateString("ko-KR")
                            : "\uB0A0\uC9DC \uC815\uBCF4 \uC5C6\uC74C"}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-black ${
                          isPositive ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {`${isPositive ? "+" : ""}${delta.toLocaleString()}\uC810`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
