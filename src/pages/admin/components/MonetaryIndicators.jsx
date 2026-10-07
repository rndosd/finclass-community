import React, { useEffect, useMemo, useState } from "react";
import {
  deleteField,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { Card, Button, Modal, StudentSelector } from "../../../components/ui";
import {
  Wallet,
  Droplets,
  Activity,
  ChevronDown,
  ChevronUp,
  Gauge,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Users,
  Settings2,
} from "lucide-react";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { db } from "../../../firebase";
import { DEFAULT_CLASS_CURRENCY_UNIT } from "../../../utils/currencyUnit";
import { useMonetaryData } from "../hooks/useMonetaryData";
import M0ChartModal from "./modals/M0ChartModal";
import LiquidityChartModal from "./modals/LiquidityChartModal";

const MonetaryIndicators = ({
  classId,
  students,
  conversionRate,
  currencyUnit,
  canManageSettings = false,
}) => {
  const { missionTokenLabel } = useUser();
  const { showFeedback } = useFeedback();
  const { formatClassCurrencyCompact } = useNumberFormat();
  const unit = currencyUnit || DEFAULT_CLASS_CURRENCY_UNIT;

  const [showTrendTotal, setShowTrendTotal] = useState(false);
  const [showTrendLiquidity, setShowTrendLiquidity] = useState(false);

  const [showDescTotal, setShowDescTotal] = useState(false);
  const [showDescLiquidity, setShowDescLiquidity] = useState(false);

  const [showTotalChart, setShowTotalChart] = useState(false);
  const [showLiquidityChart, setShowLiquidityChart] = useState(false);
  const [showExclusionModal, setShowExclusionModal] = useState(false);
  const [excludedDraftUids, setExcludedDraftUids] = useState([]);
  const [isSavingExclusions, setIsSavingExclusions] = useState(false);

  const monetaryExcludedUids = useMemo(
    () =>
      Array.isArray(students)
        ? students
            .filter(
              (student) =>
                student?.statsExclusion?.monetaryAggregates === true,
            )
            .map((student) => student.uid)
            .filter(Boolean)
        : [],
    [students],
  );

  useEffect(() => {
    setExcludedDraftUids(monetaryExcludedUids);
  }, [monetaryExcludedUids]);

  const hasExclusionChanges = useMemo(() => {
    const current = new Set(monetaryExcludedUids);
    const next = new Set(excludedDraftUids);
    if (current.size !== next.size) return true;
    return [...current].some((uid) => !next.has(uid));
  }, [excludedDraftUids, monetaryExcludedUids]);

  const { agg, trends } = useMonetaryData(
    classId,
    students,
    conversionRate
  );

  const handleSaveExclusions = async () => {
    if (!classId || !hasExclusionChanges || isSavingExclusions) return;

    const current = new Set(monetaryExcludedUids);
    const next = new Set(excludedDraftUids);
    const changedUids = Array.from(new Set([...current, ...next])).filter(
      (uid) => current.has(uid) !== next.has(uid),
    );

    if (changedUids.length === 0) return;

    setIsSavingExclusions(true);
    try {
      const batch = writeBatch(db);
      changedUids.forEach((uid) => {
        batch.update(doc(db, `classes/${classId}/students/${uid}`), {
          "statsExclusion.monetaryAggregates": next.has(uid)
            ? true
            : deleteField(),
          "statsExclusion.updatedAt": serverTimestamp(),
        });
      });
      await batch.commit();
      showFeedback("M0/M2 통계 제외 계정을 저장했습니다.", "success");
      setShowExclusionModal(false);
    } catch (error) {
      console.error("[MonetaryIndicators] failed to save exclusions:", error);
      showFeedback(
        error?.message || "통계 제외 계정 저장 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSavingExclusions(false);
    }
  };

  const openExclusionModal = () => {
    setExcludedDraftUids(monetaryExcludedUids);
    setShowExclusionModal(true);
  };

  const closeExclusionModal = () => {
    if (isSavingExclusions) return;
    setExcludedDraftUids(monetaryExcludedUids);
    setShowExclusionModal(false);
  };

  const formatSignedCurrencyCompact = (value) => {
    if (value === null || value === undefined) return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    const sign = number > 0 ? "+" : number < 0 ? "-" : "";
    return `${sign}${formatClassCurrencyCompact(Math.abs(number))} ${unit}`;
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return `${number.toFixed(1)}%`;
  };

  const SupportMetric = ({ icon: Icon, label, value, helper, tone = "slate" }) => {
    const toneClass = {
      slate: "bg-slate-50 text-slate-600 ring-slate-100",
      blue: "bg-blue-50 text-blue-600 ring-blue-100",
      emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
      amber: "bg-amber-50 text-amber-600 ring-amber-100",
    }[tone] || "bg-slate-50 text-slate-600 ring-slate-100";

    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{helper}</p>
      </div>
    );
  };

  const renderTrend = (value) => {
    if (value === null || value === undefined) {
      return <span className="text-slate-400">-</span>;
    }

    const isPositive = value > 0;
    const isNeutral = value === 0;
    const color = isNeutral
      ? "text-slate-500"
      : isPositive
      ? "text-emerald-600"
      : "text-rose-600";
    const Icon = isNeutral ? Minus : isPositive ? TrendingUp : TrendingDown;

    return (
      <span className={`${color} font-semibold flex items-center gap-1`}>
        {isPositive ? "+" : ""}
        {value.toFixed(1)}%
        <Icon className="h-3 w-3" />
      </span>
    );
  };

  const TrendSection = ({ data }) => (
    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-600">1일</span>
        {renderTrend(data?.day)}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-600">7일</span>
        {renderTrend(data?.week)}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-600">30일</span>
        {renderTrend(data?.month)}
      </div>
    </div>
  );

  return (
    <>
      {canManageSettings ? (
        <div className="mb-3 flex justify-end">
          <Button
            size="sm"
            kind="soft"
            tone="blue"
            icon={Settings2}
            onClick={openExclusionModal}
          >
            M0/M2 제외 계정
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card tone="slate" variant="elevated">
          <Card.Header>
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-slate-600" />
              <h3 className="text-base font-semibold text-slate-800">총 통화량</h3>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                kind="ghost"
                tone="slate"
                icon={BarChart3}
                onClick={() => setShowTotalChart(true)}
              >
                차트
              </Button>
              <Button
                size="xs"
                kind="ghost"
                tone="slate"
                icon={showTrendTotal ? ChevronUp : ChevronDown}
                onClick={() => setShowTrendTotal((prev) => !prev)}
              >
                추이
              </Button>
            </div>
          </Card.Header>
          <Card.Content noPadding>
            <div className="text-2xl font-extrabold">
              {formatClassCurrencyCompact(agg.totalClassAssets)} {unit}
            </div>
            <div className="mt-1 text-xs text-slate-500">학생별 순자산 합계</div>

            <Button
              onClick={() => setShowDescTotal((prev) => !prev)}
              className="mt-2 w-full border-t border-slate-100 pt-2 text-left text-xs text-slate-400 transition-colors hover:text-slate-600 flex items-center gap-1"
            >
              {showDescTotal ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              설명 {showDescTotal ? "접기" : "보기"}
            </Button>

            {showDescTotal && (
              <div className="mt-2 space-y-1 text-xs text-slate-500">
                <div>학급 전체 자산 규모를 파악하는 기준 지표입니다.</div>
                <div>학생별 순자산을 모두 합산해 계산합니다.</div>
              </div>
            )}

            {showTrendTotal && <TrendSection data={trends.totalClassAssets} />}
          </Card.Content>
        </Card>

        <Card tone="indigo" variant="elevated">
          <Card.Header>
            <div className="flex items-center gap-2">
              <Droplets className="h-4 w-4 text-indigo-600" />
              <h3 className="text-base font-semibold text-slate-800">유동 통화량</h3>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                kind="ghost"
                tone="slate"
                icon={BarChart3}
                onClick={() => setShowLiquidityChart(true)}
              >
                차트
              </Button>
              <Button
                size="xs"
                kind="ghost"
                tone="slate"
                icon={showTrendLiquidity ? ChevronUp : ChevronDown}
                onClick={() => setShowTrendLiquidity((prev) => !prev)}
              >
                추이
              </Button>
            </div>
          </Card.Header>
          <Card.Content noPadding>
            <div className="text-2xl font-extrabold">
              {formatClassCurrencyCompact(agg.liquidMoney)} {unit}
            </div>
            <div className="mt-1 text-xs text-slate-500">빠른 결제 투입 가능 자금</div>

            <Button
              onClick={() => setShowDescLiquidity((prev) => !prev)}
              className="mt-2 w-full border-t border-slate-100 pt-2 text-left text-xs text-slate-400 transition-colors hover:text-slate-600 flex items-center gap-1"
            >
              {showDescLiquidity ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              설명 {showDescLiquidity ? "접기" : "보기"}
            </Button>

            {showDescLiquidity && (
              <div className="mt-2 space-y-1 text-xs text-slate-500">
                <div className="whitespace-pre">
                  계산식: 현금 + 외화 환산금액×0.9 + 예금×0.2 + 주식 환산금액×0.35
                </div>
                <div>{missionTokenLabel}은 현재 계산에서 제외합니다.</div>
              </div>
            )}

            {showTrendLiquidity && <TrendSection data={trends.liquidMoney} />}
          </Card.Content>
        </Card>

      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SupportMetric
          icon={Gauge}
          label="유동성 비율"
          value={formatPercent(agg.liquidityRatio)}
          helper="M2 ÷ M0 · 전체 자산 중 바로 움직일 수 있는 돈의 비율"
          tone="blue"
        />
        <SupportMetric
          icon={TrendingUp}
          label="최근 30일 M0 변화"
          value={formatSignedCurrencyCompact(trends.totalClassAssets?.monthDelta)}
          helper="총 통화량이 한 달 동안 얼마나 늘거나 줄었는지"
          tone="emerald"
        />
        <SupportMetric
          icon={Users}
          label="학생 1인당 M2"
          value={`${formatClassCurrencyCompact(agg.perStudentLiquidMoney)} ${unit}`}
          helper="학생 한 명이 바로 쓸 수 있는 평균 유동 자금"
          tone="slate"
        />
        <SupportMetric
          icon={Activity}
          label="자산 집중도"
          value={formatPercent(agg.top20AssetShare)}
          helper="상위 20% 학생이 전체 M0 중 차지하는 비율"
          tone="amber"
        />
      </div>

      <M0ChartModal
        isOpen={showTotalChart}
        onClose={() => setShowTotalChart(false)}
        classId={classId}
        currencyUnit={unit}
      />
      <LiquidityChartModal
        isOpen={showLiquidityChart}
        onClose={() => setShowLiquidityChart(false)}
        classId={classId}
        currencyUnit={unit}
      />

      <Modal
        isOpen={showExclusionModal}
        onClose={closeExclusionModal}
        size="md"
      >
        <Modal.Header>
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-slate-600" />
            <h2 className="text-xl font-bold text-slate-800">
              M0/M2 통계 제외 계정
            </h2>
          </div>
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-3">
            <StudentSelector
              label="제외 계정"
              selectedUids={excludedDraftUids}
              onChange={setExcludedDraftUids}
              allStudents={students}
              allowGroupSelect={false}
              disabled={isSavingExclusions}
            />
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              선택한 계정은 현재 경제통계 계산과 앞으로 저장되는 M0/M2
              히스토리에서 제외됩니다. 이미 저장된 과거 히스토리는 바꾸지
              않습니다.
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <div className="flex w-full justify-end gap-2">
            <Button
              kind="ghost"
              tone="slate"
              disabled={isSavingExclusions}
              onClick={closeExclusionModal}
            >
              취소
            </Button>
            <Button
              kind="ghost"
              tone="slate"
              disabled={!hasExclusionChanges || isSavingExclusions}
              onClick={() => setExcludedDraftUids(monetaryExcludedUids)}
            >
              되돌리기
            </Button>
            <Button
              tone="blue"
              disabled={!hasExclusionChanges}
              isLoading={isSavingExclusions}
              onClick={handleSaveExclusions}
            >
              저장
            </Button>
          </div>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default MonetaryIndicators;
