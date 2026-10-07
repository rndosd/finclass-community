import React, { useEffect, useRef, useState } from "react";
import { collection, documentId, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../../../firebase";
import { Button, ErrorState, SectionLoader, runFilterApplyOnEnter } from "../../../components/ui";
import { filterInputClassName } from "../../../components/ui/FilterControls";
import { getRecentDateRangeInKST, shiftDateKeyInKST } from "../../../utils/kstDate";
import CPIChartModal from "../../admin/components/modals/CPIChartModal";
import { getComparisonRange, MAX_ANALYTICS_DAYS } from "../utils/storeAnalyticsModel";
import StoreAnalyticsView from "./StoreAnalyticsView";
import "./StoreAnalyticsUI.css";

const recent = (days) => getRecentDateRangeInKST({ days, endOffsetDays: -1 });

export default function StoreAnalyticsPanel({ isOpen, classId, items = [], currencyUnit = "원", totalStudentCount = 0 }) {
  const [range, setRange] = useState(() => recent(7));
  const [draft, setDraft] = useState(() => recent(7));
  const [custom, setCustom] = useState(false);
  const [validation, setValidation] = useState("");
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCpi, setShowCpi] = useState(false);
  const startInput = useRef(null);
  const endInput = useRef(null);

  useEffect(() => {
    if (!isOpen || !classId) return;
    let active = true;
    setLoading(true);
    setError("");
    const previous = getComparisonRange(range);
    const load = async (dates) => {
      const snapshot = await getDocs(query(collection(db, "classes", classId, "storeAnalyticsDaily"),
        where(documentId(), ">=", dates.startDate), where(documentId(), "<=", dates.endDate), orderBy(documentId(), "asc")));
      return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    };
    Promise.all([load(range), load(previous)]).then(([rows, previousRows]) => {
      if (active) setResult({ classId, range, rows, previousRows });
    }).catch(() => {
      if (active) setError("상점 통계를 불러오지 못했습니다. 다시 시도해 주세요.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isOpen, classId, range, reload]);

  const apply = () => {
    const next = {
      startDate: startInput.current?.value ?? draft.startDate,
      endDate: endInput.current?.value ?? draft.endDate,
    };
    if (!getComparisonRange(next) || next.endDate > shiftDateKeyInKST(new Date(), -1)) {
      setValidation(`전날까지의 날짜를 선택해 주세요. 한 번에 최대 ${MAX_ANALYTICS_DAYS}일 조회할 수 있습니다.`);
      return;
    }
    setValidation("");
    setDraft(next);
    setRange(next);
  };
  const quick = (days) => {
    const next = recent(days);
    setCustom(false);
    setValidation("");
    setDraft(next);
    setRange(next);
  };
  const validResult = result?.classId === classId && result?.range === range;
  const comparisonRange = getComparisonRange(range);
  const isRecentRange = (days) => {
    const preset = recent(days);
    return range.startDate === preset.startDate && range.endDate === preset.endDate;
  };
  const hasUnappliedRange = draft.startDate !== range.startDate || draft.endDate !== range.endDate;
  if (!isOpen) return null;
  return (
    <div className="store-analytics-ui space-y-6">
      <div className="store-period-toolbar">
        <div><p className="mb-2 text-sm font-semibold text-slate-800">기간 선택</p><div className="flex flex-wrap gap-2" role="group" aria-label="상점 통계 기간 선택">
          {[7, 30].map((days) => <Button key={days} size="sm" kind={isRecentRange(days) ? "solid" : "outline"} tone={isRecentRange(days) ? "blue" : "slate"} aria-pressed={isRecentRange(days)} onClick={() => quick(days)}>최근 {days}일</Button>)}
          <Button size="sm" kind="outline" tone="slate" aria-controls="store-period-fields" aria-expanded={custom} onClick={() => setCustom(!custom)}>기간 선택</Button>
        </div></div>
        <div className="store-applied-period" aria-live="polite"><p className="text-sm font-semibold text-slate-800">적용 기간 {range.startDate} ~ {range.endDate}</p><p className="mt-1 text-sm text-slate-700">비교 기간 {comparisonRange?.startDate} ~ {comparisonRange?.endDate}</p><p className="mt-1 text-xs text-slate-600">구매 집계: 주말 제외 · 하루 한 번 집계</p></div>
      </div>
      {custom && <div id="store-period-fields" className="store-period-fields flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm font-bold text-slate-700">시작일<input type="date" aria-invalid={Boolean(validation)} aria-describedby={validation ? "store-period-help store-period-error" : "store-period-help"} ref={startInput} value={draft.startDate} max={shiftDateKeyInKST(new Date(), -1)} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} onKeyDown={(event) => runFilterApplyOnEnter(event, apply, { blur: true })} className={`mt-1.5 block ${filterInputClassName({ tone: "blue" })}`} /></label>
        <label className="text-sm font-bold text-slate-700">종료일<input type="date" aria-invalid={Boolean(validation)} aria-describedby={validation ? "store-period-help store-period-error" : "store-period-help"} ref={endInput} value={draft.endDate} max={shiftDateKeyInKST(new Date(), -1)} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} onKeyDown={(event) => runFilterApplyOnEnter(event, apply, { blur: true })} className={`mt-1.5 block ${filterInputClassName({ tone: "blue" })}`} /></label>
        <Button size="sm" onClick={apply}>조회</Button>
        <p id="store-period-help" className="w-full text-sm text-slate-700">{hasUnappliedRange ? "입력한 기간은 아직 적용되지 않았습니다. 조회를 눌러 적용하세요." : `전날까지 최대 ${MAX_ANALYTICS_DAYS}일을 선택할 수 있습니다. 날짜 입력 후 조회를 눌러 적용하세요.`}</p>
        {validation && <p id="store-period-error" role="alert" className="w-full text-sm text-red-700">{validation}</p>}
      </div>}
      {!classId ? <ErrorState variant="section" title="학급을 선택해 주세요." description="학급 선택 후 상점 통계를 확인할 수 있습니다." />
        : error ? <ErrorState variant="section" title={error} description="선택한 기간은 유지됩니다. 다시 시도해 통계를 불러오세요." onRetry={() => setReload((value) => value + 1)} />
          : loading || !validResult ? <SectionLoader message="구매 현황과 가격 변화를 불러오는 중입니다." />
            : <StoreAnalyticsView rows={result.rows} previousRows={result.previousRows} range={range} items={items} currencyUnit={currencyUnit} totalStudentCount={totalStudentCount} onOpenCpi={() => setShowCpi(true)} />}
      {showCpi && <CPIChartModal isOpen={showCpi} onClose={() => setShowCpi(false)} classId={classId} />}
    </div>
  );
}
