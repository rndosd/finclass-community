import React, {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { doc, onSnapshot } from "firebase/firestore";
import {
  AlertTriangle,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Button, Badge, Card, Spinner } from "../../../components/ui";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { db, functions } from "../../../firebase";
import { DEFAULT_CLASS_CURRENCY_UNIT } from "../../../utils/currencyUnit";
import {
  RELATIVE_ECONOMY_AXIS_META,
  RELATIVE_ECONOMY_PERIOD_OPTIONS,
  RELATIVE_ECONOMY_SORT_OPTIONS,
} from "./classRelativeEconomyConfig";
import { httpsCallable } from "firebase/functions";

const AXIS_META_MAP = new Map(
  RELATIVE_ECONOMY_AXIS_META.map((axis) => [axis.key, axis]),
);

const RELATIVE_ECONOMY_SCHEMA_VERSION = 1;
const RELATIVE_ECONOMY_SUMMARY_STALE_MS = 15 * 60 * 1000;
const RELATIVE_ECONOMY_REFRESH_DEBOUNCE_MS = 1200;
const RELATIVE_ECONOMY_REFRESH_LOCK_MS = 30 * 1000;
const refreshRelativeEconomyAnalytics = httpsCallable(
  functions,
  "refreshRelativeEconomyAnalytics",
);

const clamp = (value, min = 0, max = 100) =>
  Math.min(max, Math.max(min, Number(value) || 0));

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const average = (values = []) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + toNumber(value), 0) / values.length;
};

const normalizeValue = (value) => String(value || "").trim();

const getToneClass = (tone) => {
  if (tone === "rose") return "bg-rose-500";
  if (tone === "emerald") return "bg-emerald-500";
  if (tone === "amber") return "bg-amber-500";
  if (tone === "blue") return "bg-blue-500";
  if (tone === "indigo") return "bg-indigo-500";
  if (tone === "violet") return "bg-violet-500";
  if (tone === "teal") return "bg-teal-500";
  if (tone === "sky") return "bg-sky-500";
  if (tone === "orange") return "bg-orange-500";
  return "bg-slate-400";
};

const getBandLabel = (percentile) =>
  `상위 ${Math.max(1, 100 - Math.round(clamp(percentile)))}%`;

const getRelativeEconomyCacheKey = (classId) =>
  `relative-economy:${classId}:v${RELATIVE_ECONOMY_SCHEMA_VERSION}`;

const readRelativeEconomyCache = (classId) => {
  if (!classId || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getRelativeEconomyCacheKey(classId));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== RELATIVE_ECONOMY_SCHEMA_VERSION) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("[ClassRelativeEconomyTab] failed to read cache:", error);
    return null;
  }
};

const writeRelativeEconomyCache = (classId, payload) => {
  if (!classId || typeof window === "undefined" || !payload?.periods) return;

  try {
    window.localStorage.setItem(
      getRelativeEconomyCacheKey(classId),
      JSON.stringify({
        schemaVersion: RELATIVE_ECONOMY_SCHEMA_VERSION,
        cachedAtMs: Date.now(),
        lastComputedAtMs: toNumber(payload.lastComputedAtMs),
        periods: payload.periods,
      }),
    );
  } catch (error) {
    console.warn("[ClassRelativeEconomyTab] failed to write cache:", error);
  }
};

const getPeriodPayload = (payload, periodDays) =>
  payload?.periods?.[String(periodDays)] || null;

const hydrateRelativeEconomyRows = (rawRows = [], periodDays) =>
  rawRows.map((row) => {
    const strengths = (Array.isArray(row.strengthKeys) ? row.strengthKeys : [])
      .map((key) => ({
        ...AXIS_META_MAP.get(key),
        value: row[key],
      }))
      .filter((axis) => axis?.key)
      .sort((left, right) => right.value - left.value)
      .slice(0, 3);

    return {
      ...row,
      strengths,
      profile: getProfileMeta(row, periodDays),
    };
  });

const getProfileMeta = (row, periodDays) => {
  if (
    row.attentionScore >= 70 &&
    row.consumptionManagementPercentile <= 40 &&
    row.riskTendencyPercentile >= 65
  ) {
    return {
      id: "coaching",
      tone: "rose",
      label: "코칭 우선",
      description: `최근 ${periodDays}일 기준 소비 부담과 위험 신호가 함께 높습니다. 예산 지키기와 지출 우선순위 코칭을 먼저 붙여보는 편이 좋습니다.`,
    };
  }

  if (
    row.savingsAttitudePercentile >= 70 &&
    row.debtManagementPercentile >= 60 &&
    row.ruleCompliancePercentile >= 60
  ) {
    return {
      id: "stable",
      tone: "emerald",
      label: "안정형",
      description: "저축 습관과 부채 관리가 안정적이고 규칙 리스크도 낮은 편입니다. 장기 목표형 과제를 줘보기에 좋습니다.",
    };
  }

  if (
    row.communityContributionPercentile >= 60 &&
    row.missionDiligencePercentile >= 70
  ) {
    return {
      id: "responsible",
      tone: "teal",
      label: "책임형",
      description: "세금과 기부 같은 공동체 참여, 과제 수행력이 함께 높은 학생입니다. 반 운영 역할을 맡겨보기 좋습니다.",
    };
  }

  if (row.creditRecoveryPercentile >= 70 && row.creditChange > 0) {
    return {
      id: "recovery",
      tone: "sky",
      label: "회복형",
      description: `최근 ${periodDays}일 동안 신용이 반 평균보다 빠르게 회복되었습니다. 실패 이후 복구하는 힘이 보입니다.`,
    };
  }

  if (row.activityPercentile <= 20 && row.activityCount <= 1) {
    return {
      id: "low-signal",
      tone: "amber",
      label: "관찰 필요",
      description: `최근 ${periodDays}일 동안 기록된 행동이 많지 않아 해석 신호가 약합니다. 참여 기회를 먼저 늘려보는 편이 좋습니다.`,
    };
  }

  return {
    id: "balanced",
    tone: "slate",
    label: "균형 관찰형",
    description: "특정 축으로 과하게 치우친 모습보다 중간권 신호가 모여 있습니다. 다음 변화 추이를 계속 보면 좋습니다.",
  };
};

const MetricBar = ({ label, value, tone = "slate" }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
      <span>{label}</span>
      <span>{getBandLabel(value)}</span>
    </div>
    <div className="h-2 rounded-full bg-slate-100">
      <div
        className={`h-2 rounded-full transition-all ${getToneClass(tone)}`}
        style={{ width: `${clamp(value)}%` }}
      />
    </div>
  </div>
);

export default function ClassRelativeEconomyTab({
  classId,
  students = [],
  currencyUnit = DEFAULT_CLASS_CURRENCY_UNIT,
}) {
  const { formatClassCurrency } = useNumberFormat();
  const [periodDays, setPeriodDays] = useState(14);
  const [sortKey, setSortKey] = useState("attention");
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const refreshTimeoutRef = useRef(null);
  const isRefreshingRef = useRef(false);
  const rowsRef = useRef([]);

  const targetStudents = useMemo(
    () =>
      students.filter((student) => {
        const role = normalizeValue(student?.role).toLowerCase();
        return role !== "teacher" && role !== "admin";
      }),
    [students],
  );

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    let isDisposed = false;

    const clearRefreshTimer = () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };

    const applyPayload = (payload) => {
      const periodPayload = getPeriodPayload(payload, periodDays);
      if (!Array.isArray(periodPayload?.rows) || isDisposed) return;

      const nextRows = hydrateRelativeEconomyRows(periodPayload.rows, periodDays);
      rowsRef.current = nextRows;
      writeRelativeEconomyCache(classId, payload);
      startTransition(() => {
        setRows(nextRows);
      });
    };

    const shouldRefreshPayload = (payload) => {
      const periodPayload = getPeriodPayload(payload, periodDays);
      const hasRows = Array.isArray(periodPayload?.rows);
      const rowCount = hasRows
        ? toNumber(periodPayload?.rowCount, periodPayload.rows.length)
        : 0;
      const refreshLocked =
        payload?.refreshInProgress === true &&
        Date.now() - toNumber(payload?.refreshRequestedAtMs) <
          RELATIVE_ECONOMY_REFRESH_LOCK_MS;

      if (refreshLocked) return false;
      if (!hasRows) return true;
      if (payload?.needsRefresh === true) return true;
      if (
        Date.now() - toNumber(payload?.lastComputedAtMs) >
        RELATIVE_ECONOMY_SUMMARY_STALE_MS
      ) {
        return true;
      }

      return rowCount !== targetStudents.length;
    };

    const runRefresh = async () => {
      if (isRefreshingRef.current || !classId || targetStudents.length === 0) {
        return;
      }

      isRefreshingRef.current = true;
      if (!rowsRef.current.length && !isDisposed) {
        setIsLoading(true);
      }

      try {
        const result = await refreshRelativeEconomyAnalytics({
          classId,
          force: true,
        });
        const payload = result?.data || null;
        if (payload?.periods) {
          applyPayload(payload);
          if (!isDisposed) {
            setErrorMessage("");
          }
        }
      } catch (error) {
        console.error("[ClassRelativeEconomyTab] failed to refresh summary:", error);
        if (!isDisposed && !rowsRef.current.length) {
          setErrorMessage(
            error?.message || "상대 경제 분석 데이터를 불러오지 못했습니다.",
          );
        }
      } finally {
        isRefreshingRef.current = false;
        if (!isDisposed) {
          setIsLoading(false);
        }
      }
    };

    const scheduleRefresh = (payload) => {
      clearRefreshTimer();
      if (!shouldRefreshPayload(payload)) return;
      refreshTimeoutRef.current = window.setTimeout(
        () => void runRefresh(),
        RELATIVE_ECONOMY_REFRESH_DEBOUNCE_MS,
      );
    };

    if (!classId || targetStudents.length === 0) {
      clearRefreshTimer();
      rowsRef.current = [];
      setRows([]);
      setIsLoading(false);
      setErrorMessage("");
      return () => {
        isDisposed = true;
      };
    }

    const cachedPayload = readRelativeEconomyCache(classId);
    if (cachedPayload?.periods) {
      applyPayload(cachedPayload);
    } else {
      rowsRef.current = [];
      setRows([]);
    }

    setErrorMessage("");
    setIsLoading(!Array.isArray(getPeriodPayload(cachedPayload, periodDays)?.rows));
    scheduleRefresh(cachedPayload);

    const unsubscribe = onSnapshot(
      doc(db, `classes/${classId}/analytics/relativeEconomy`),
      (snapshot) => {
        const livePayload = snapshot.exists() ? snapshot.data() : null;
        if (livePayload?.periods) {
          applyPayload(livePayload);
          setErrorMessage("");
          setIsLoading(false);
        }
        scheduleRefresh(livePayload || cachedPayload);
      },
      (error) => {
        console.error("[ClassRelativeEconomyTab] summary listener failed:", error);
        scheduleRefresh(cachedPayload);
        if (!rowsRef.current.length) {
          setErrorMessage(
            error?.message || "상대 경제 분석 데이터를 불러오지 못했습니다.",
          );
          setIsLoading(false);
        }
      },
    );

    return () => {
      isDisposed = true;
      clearRefreshTimer();
      unsubscribe();
    };
  }, [classId, periodDays, targetStudents]);

  const sortedRows = useMemo(() => {
    const nextRows = [...rows];

    nextRows.sort((left, right) => {
      if (sortKey === "savings") {
        return (
          right.savingsAttitudePercentile - left.savingsAttitudePercentile ||
          right.debtManagementPercentile - left.debtManagementPercentile
        );
      }

      if (sortKey === "mission") {
        return (
          right.missionDiligencePercentile - left.missionDiligencePercentile ||
          right.communityContributionPercentile -
            left.communityContributionPercentile
        );
      }

      if (sortKey === "risk") {
        return (
          right.riskTendencyPercentile - left.riskTendencyPercentile ||
          right.attentionScore - left.attentionScore
        );
      }

      if (sortKey === "assets") {
        return (
          right.assetPercentile - left.assetPercentile ||
          right.currentNetWorth - left.currentNetWorth
        );
      }

      return (
        right.attentionScore - left.attentionScore ||
        right.riskTendencyPercentile - left.riskTendencyPercentile
      );
    });

    return nextRows;
  }, [rows, sortKey]);

  const summary = useMemo(() => {
    const coachingNeededCount = rows.filter(
      (row) => row.attentionScore >= 70,
    ).length;
    const stableCount = rows.filter(
      (row) =>
        row.savingsAttitudePercentile >= 70 &&
        row.debtManagementPercentile >= 60 &&
        row.ruleCompliancePercentile >= 60,
    ).length;
    const responsibleCount = rows.filter(
      (row) =>
        row.communityContributionPercentile >= 60 &&
        row.missionDiligencePercentile >= 70,
    ).length;

    return {
      studentCount: rows.length,
      coachingNeededCount,
      stableCount,
      responsibleCount,
      averageConsumptionRatio: average(rows.map((row) => row.netConsumptionRatio)),
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <Card className="rounded-[28px] border border-white/70 bg-white/85 shadow-lg shadow-slate-200/60 backdrop-blur-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="amber" size="sm">
                로컬 실험 탭
              </Badge>
              <Badge tone="indigo" size="sm">
                반 안에서만 상대 비교
              </Badge>
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900">
                상대 경제 분석
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                최근 {periodDays}일의 활동 로그, 신용로그, 신용이력을 함께 읽어서
                학생별 경제 패턴을 반 안에서 상대적으로 다시 배치합니다. 절대
                금액보다 같은 반 분포 안에서 어디쯤 있는지를 먼저 보여주는
                탭입니다.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:min-w-[320px]">
            <div className="space-y-2">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                분석 기간
              </div>
              <div className="flex flex-wrap gap-2">
                {RELATIVE_ECONOMY_PERIOD_OPTIONS.map((option) => (
                  <Button
                    key={option.key}
                    type="button"
                    onClick={() => setPeriodDays(option.key)}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      periodDays === option.key
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                정렬 기준
              </div>
              <div className="flex flex-wrap gap-2">
                {RELATIVE_ECONOMY_SORT_OPTIONS.map((option) => (
                  <Button
                    key={option.key}
                    type="button"
                    onClick={() => setSortKey(option.key)}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      sortKey === option.key
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-[24px] border border-rose-100 bg-rose-50/70 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-400">
                코칭 우선
              </div>
              <div className="mt-3 text-3xl font-black text-rose-700">
                {summary.coachingNeededCount}
              </div>
              <p className="mt-2 text-sm leading-6 text-rose-700/80">
                소비 관리 점수는 낮고 위험 성향은 높은 학생 수입니다.
              </p>
            </div>
            <div className="rounded-2xl bg-white/70 p-3 text-rose-500">
              <AlertTriangle className="h-6 w-6" />
            </div>
          </div>
        </Card>

        <Card className="rounded-[24px] border border-emerald-100 bg-emerald-50/70 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-500">
                안정형
              </div>
              <div className="mt-3 text-3xl font-black text-emerald-700">
                {summary.stableCount}
              </div>
              <p className="mt-2 text-sm leading-6 text-emerald-700/80">
                저축 태도와 부채 관리가 안정적이고 규칙 준수도 무너지지 않은
                학생 수입니다.
              </p>
            </div>
            <div className="rounded-2xl bg-white/70 p-3 text-emerald-500">
              <PiggyBank className="h-6 w-6" />
            </div>
          </div>
        </Card>

        <Card className="rounded-[24px] border border-teal-100 bg-teal-50/70 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-teal-500">
                책임형
              </div>
              <div className="mt-3 text-3xl font-black text-teal-700">
                {summary.responsibleCount}
              </div>
              <p className="mt-2 text-sm leading-6 text-teal-700/80">
                공동체 기여와 과제 성실도가 함께 높은 학생 수입니다.
              </p>
            </div>
            <div className="rounded-2xl bg-white/70 p-3 text-teal-500">
              <ShieldCheck className="h-6 w-6" />
            </div>
          </div>
        </Card>
      </div>

      <Card className="rounded-[28px] border border-white/70 bg-white/90 shadow-lg shadow-slate-200/50 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h4 className="text-lg font-black text-slate-900">
              학생별 상대 위치
            </h4>
            <p className="mt-1 text-sm text-slate-500">
              학생 {summary.studentCount}명 기준, 최근 {periodDays}일의 로그를
              축별 백분위로 다시 계산했습니다.
            </p>
          </div>
          <Badge tone="slate" size="sm">
            평균 순소비/수입 비율 {summary.averageConsumptionRatio.toFixed(2)}
          </Badge>
        </div>

        {isLoading && rows.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center">
            <Spinner />
          </div>
        ) : errorMessage ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
            <div className="rounded-2xl bg-rose-50 p-3 text-rose-500">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="text-sm font-semibold text-slate-700">
              {errorMessage}
            </div>
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
            <div className="rounded-2xl bg-slate-100 p-3 text-slate-500">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="text-sm font-semibold text-slate-700">
              아직 분석할 학생 데이터가 충분하지 않습니다.
            </div>
          </div>
        ) : (
          <div className="grid gap-4 pt-5 xl:grid-cols-2">
            {sortedRows.map((row) => (
              <div
                key={row.uid}
                className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-lg font-black text-slate-900">
                        {row.studentNumber ? `${row.studentNumber}. ` : ""}
                        {row.name}
                      </div>
                      <Badge tone={row.profile.tone} size="sm">
                        {row.profile.label}
                      </Badge>
                    </div>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      {row.profile.description}
                    </p>
                  </div>

                  <div className="grid min-w-[168px] gap-2 text-right">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        현재 자산
                      </div>
                      <div className="mt-1 text-base font-black text-slate-900">
                        {formatClassCurrency(row.currentNetWorth)} {currencyUnit}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        현재 신용
                      </div>
                      <div className="mt-1 text-base font-black text-slate-900">
                        {Math.round(row.currentCreditScore)}점
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone="slate" size="sm">
                    자산 {getBandLabel(row.assetPercentile)}
                  </Badge>
                  {row.strengths.map((axis) => (
                    <Badge key={axis.key} tone={axis.tone} size="sm">
                      {axis.label} {getBandLabel(axis.value)}
                    </Badge>
                  ))}
                  <Badge tone="orange" size="sm">
                    위험 성향 {getBandLabel(row.riskTendencyPercentile)}
                  </Badge>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {RELATIVE_ECONOMY_AXIS_META.map((axis) => (
                    <MetricBar
                      key={axis.key}
                      label={axis.label}
                      value={row[axis.key]}
                      tone={axis.tone}
                    />
                  ))}
                </div>

                <div className="mt-5 grid gap-3 rounded-[20px] bg-white/80 p-4 text-sm text-slate-600 md:grid-cols-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                      <Wallet className="h-4 w-4 text-slate-400" />
                      최근 {periodDays}일 자금 흐름
                    </div>
                    <div>
                      수입 {formatClassCurrency(row.incomeAmount)} {currencyUnit}
                    </div>
                    <div>
                      순소비 {formatClassCurrency(row.netConsumptionAmount)}{" "}
                      {currencyUnit}
                    </div>
                    <div>기록 {row.activityCount}건</div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                      <TrendingUp className="h-4 w-4 text-slate-400" />
                      보조 신호
                    </div>
                    <div>
                      신용 변화 {row.creditChange > 0 ? "+" : ""}
                      {Math.round(row.creditChange)}점
                    </div>
                    <div>
                      투자 진입 {formatClassCurrency(row.investmentEntryAmount)}{" "}
                      {currencyUnit}
                    </div>
                    <div>놀이터 {row.arcadeCount}건</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

