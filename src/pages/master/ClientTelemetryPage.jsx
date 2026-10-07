import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import {
  ArrowLeft,
  BarChart3,
  Database,
  RefreshCw,
  Route,
  School,
} from "lucide-react";

import AppLayout from "../../components/layout/AppLayout";
import {
  Button,
  Card,
  CardSkeleton,
  PageSkeleton,
  SurfaceLoader,
} from "../../components/ui";
import { useFeedback } from "../../contexts/FeedbackContext";
import { functions } from "../../firebase";
import { formatDateKeyInKST, shiftDateKeyInKST } from "../../utils/kstDate";

const getClientFirestoreTelemetryReport = httpsCallable(
  functions,
  "getClientFirestoreTelemetryReport",
);

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatNumber = (value) => Number(value || 0).toLocaleString("ko-KR");

const normalizeReport = (raw = {}) => ({
  startDate: raw.startDate || "",
  endDate: raw.endDate || "",
  totals: raw.totals || {},
  topRoutes: Array.isArray(raw.topRoutes) ? raw.topRoutes : [],
  topClasses: Array.isArray(raw.topClasses) ? raw.topClasses : [],
  routeRows: Array.isArray(raw.routeRows) ? raw.routeRows : [],
  scopeClasses: Array.isArray(raw.scope?.classes) ? raw.scope.classes : [],
  rowCount: Number(raw.rowCount || 0),
  version: raw.version || 1,
  queryDocumentCount: raw.queryDocumentCount || 0,
  updatedAt: raw.updatedAt || "",
  generatedAt: raw.generatedAt || "",
  cached: Boolean(raw.cached),
});

const ClientTelemetryPage = () => {
  const navigate = useNavigate();
  const { showFeedback } = useFeedback();
  const todayKey = useMemo(() => formatDateKeyInKST(new Date()), []);
  const [startDate, setStartDate] = useState(() =>
    shiftDateKeyInKST(new Date(), -6),
  );
  const [endDate, setEndDate] = useState(todayKey);
  const [report, setReport] = useState(null);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [version, setVersion] = useState(2);
  const [sortBy, setSortBy] = useState("reads");
  const [classOptions, setClassOptions] = useState([]);
  const reportCache = useRef(new Map());
  const requestId = useRef(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchReport = useCallback(
    async ({ preserveCurrent = false } = {}) => {
      if (preserveCurrent) {
        setIsRefreshing(true);
      } else {
        setIsInitialLoading(true);
      }

      const currentRequest = ++requestId.current;
      try {
        const cacheKey = JSON.stringify([
          startDate,
          endDate,
          selectedClassId,
          version,
          sortBy,
        ]);
        const cached = reportCache.current.get(cacheKey);
        if (cached && Date.now() - cached.at < 300000) {
          setReport({ ...cached.report, cached: true, queryDocumentCount: 0 });
          return;
        }
        const result = await getClientFirestoreTelemetryReport({
          version,
          sortBy,
          startDate,
          endDate,
          classId: selectedClassId || undefined,
        });
        if (currentRequest !== requestId.current) return;
        const next = normalizeReport(result.data || {});
        if (reportCache.current.size >= 20) reportCache.current.clear();
        reportCache.current.set(cacheKey, {
          at: Date.parse(next.generatedAt) || Date.now(),
          report: next,
        });
        setReport(next);
        setClassOptions((previous) => [
          ...new Map(
            [...previous, ...next.scopeClasses].map((row) => [
              row.classId,
              row,
            ]),
          ).values(),
        ]);
      } catch (error) {
        console.error("[ClientTelemetryPage] failed to load report:", error);
        showFeedback("전송량 계측 리포트를 불러오지 못했습니다.", "error");
      } finally {
        if (currentRequest === requestId.current) {
          setIsInitialLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [endDate, selectedClassId, showFeedback, startDate, version, sortBy],
  );

  const initialFetch = useRef(fetchReport);
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;
    void initialFetch.current();
  }, []);

  const totals = report?.totals || {};

  const selectedClassLabel = report?.scopeClasses[0]?.className || "선택 학급";

  if (isInitialLoading) {
    return (
      <AppLayout title="데이터 전송량 계측">
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
          <PageSkeleton summaryCards={3} showChart={false} showTable={false} />
          <CardSkeleton rows={10} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="데이터 전송량 계측">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <Button tone="slate" kind="ghost" size="md"
            type="button"
            onClick={() => navigate("/admin/master")}
            className="flex items-center gap-2 transition-colors"
          >
            <ArrowLeft size={18} />
            마스터 허브
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="집계 방식"
              value={version}
              onChange={(event) => setVersion(Number(event.target.value))}
              className="h-10 rounded-xl border border-blue-200 px-3 text-sm"
            >
              <option value={2}>개선 방식</option>
              <option value={1}>기존 방식</option>
            </select>
            <select
              aria-label="순위 기준"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-10 rounded-xl border border-blue-200 px-3 text-sm"
            >
              <option value="reads">읽기 수 순</option>
              <option value="bytes">수신량 순</option>
            </select>
            <input
              aria-label="시작 날짜"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-10 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-semibold text-slate-700"
            />
            <span className="text-sm font-semibold text-slate-400">~</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-10 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-semibold text-slate-700"
            />
            <select
              aria-label="학급"
              value={selectedClassId}
              onChange={(event) => setSelectedClassId(event.target.value)}
              className="h-10 min-w-[180px] rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-semibold text-slate-700"
            >
              <option value="">전체 학급</option>
              {classOptions.map((row) => (
                <option key={row.classId} value={row.classId}>
                  {row.className || row.classId}
                </option>
              ))}
            </select>
            <Button
              tone="blue"
              icon={RefreshCw}
              onClick={() => fetchReport({ preserveCurrent: true })}
              disabled={isRefreshing}
              isLoading={isRefreshing}
            >
              조회
            </Button>
          </div>
        </div>

        <SurfaceLoader
          loading={isRefreshing}
          variant="refreshing"
          message="계측 리포트를 새로고침하는 중입니다..."
        >
          <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            <p>
              {report?.version === 2
                ? "전체 학급 · 시간 제한 없음 · 기본 10% 표본 · 5분 묶음 전송. 공통 구독은 /_shared로 분리합니다."
                : "기존 방식: 활동량 상위 40개 학급 · 평일 08~15시 · 전체 스냅샷 크기 기준."}
            </p>
            <p>
              계측이 연결된 클라이언트 조회만 포함합니다. 실제 청구액과 다르며
              서버 작업·쓰기·인덱스 읽기·규칙 평가·Storage 비용은 제외됩니다.
              삭제·조회 목록 이탈도 읽기 추정에서 제외하며, 전송 실패나 브라우저
              종료로 표본이 누락될 수 있습니다.
            </p>
            <p>
              갱신 시각:{" "}
              {report?.updatedAt
                ? new Date(report.updatedAt).toLocaleString("ko-KR")
                : "기록 없음"}{" "}
              · 이번 조회 문서: {formatNumber(report?.queryDocumentCount)}
              {report?.cached ? " (캐시 사용)" : ""} · 상세{" "}
              {formatNumber(report?.rowCount)}행 중 최대 120행
            </p>
          </div>
          <p className="text-sm text-slate-500">
            계측된 소비자 콜백의 문서 수와 JSON 크기 추정입니다. SDK 공유 구독 수,
            실제 네트워크 전송량 또는 청구액과 다릅니다. 과거 집계에는 중복과
            미계측 경로가 남아 있을 수 있습니다.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MetricCard
              title="추정 수신량"
              value={formatBytes(totals.estimatedBytes)}
              helper={`샘플 원본 ${formatBytes(totals.approxBytes)}`}
              icon={Database}
            />
            <MetricCard
              title={report?.version === 2 ? "추정 읽기 수" : "표본 문서 수"}
              value={formatNumber(
                report?.version === 2
                  ? totals.estimatedDocCount
                  : totals.docCount,
              )}
              helper={`${formatNumber(totals.eventCount)}개 계측 이벤트`}
              icon={BarChart3}
            />
            <MetricCard
              title={report?.version === 2 ? "계측 저장 횟수" : "집계 행"}
              value={formatNumber(
                report?.version === 2 ? totals.writeCount : report?.rowCount,
              )}
              helper={`${report?.startDate || startDate} ~ ${report?.endDate || endDate}`}
              icon={Route}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <RankingTable
              title="상위 페이지"
              icon={Route}
              rows={report?.topRoutes || []}
              labelKey="route"
              labelFallback="unknown"
              improved={report?.version === 2}
            />
            <RankingTable
              title="상위 학급"
              icon={School}
              rows={report?.topClasses || []}
              labelKey="className"
              improved={report?.version === 2}
              secondaryKey="teacherName"
              labelFallback="unknown"
            />
          </div>

          <Card>
            <Card.Header>
              <div>
                <h2 className="text-lg font-black text-slate-800">
                  {report?.scopeClasses.length === 1
                    ? `${selectedClassLabel} 페이지 사용도`
                    : "학급별 페이지 사용도"}
                </h2>
                <p className="text-sm text-slate-500">
                  학급별 추정 읽기 수와 수신량을 확인합니다.
                </p>
              </div>
            </Card.Header>
            <Card.Content noPadding>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="p-3">날짜</th>
                      <th className="p-3">학급</th>
                      <th className="p-3">페이지</th>
                      <th className="p-3 text-right">추정 수신량</th>
                      <th className="p-3 text-right">
                        {report?.version === 2 ? "추정 읽기" : "표본 문서"}
                      </th>
                      <th className="p-3 text-right">표본</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {!report?.routeRows.length ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="p-8 text-center text-slate-500"
                        >
                          선택한 기간에 계측 기록이 없습니다.
                        </td>
                      </tr>
                    ) : null}
                    {(report?.routeRows || []).map((row) => (
                      <tr key={`${row.classId}:${row.date}:${row.route}`}>
                        <td className="p-3 text-slate-500">{row.date}</td>
                        <td className="p-3 font-semibold text-slate-700">
                          <div>{row.className || row.classId || "-"}</div>
                          {row.className && row.classId ? (
                            <div className="mt-1 font-mono text-[11px] font-medium text-slate-400">
                              {row.classId}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-3 font-semibold text-slate-700">
                          {row.route === "/_shared"
                            ? "공통 구독"
                            : row.route || "-"}
                        </td>
                        <td className="p-3 text-right font-black text-slate-800">
                          {formatBytes(row.estimatedBytes)}
                        </td>
                        <td className="p-3 text-right text-slate-500">
                          {formatNumber(row.estimatedDocCount ?? row.docCount)}
                        </td>
                        <td className="p-3 text-right text-slate-500">
                          {formatNumber(row.eventCount)}
                          {row.eventCount < 30 ? " · 부족" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card.Content>
          </Card>
        </SurfaceLoader>
      </div>
    </AppLayout>
  );
};

const MetricCard = ({ title, value, helper, icon: Icon }) => (
  <Card>
    <Card.Content noPadding>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-400">{helper}</p>
        </div>
        <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600">
          <Icon size={22} />
        </div>
      </div>
    </Card.Content>
  </Card>
);

const RankingTable = ({
  title,
  rows,
  labelKey,
  secondaryKey,
  labelFallback,
  icon: Icon,
  improved = false,
}) => (
  <Card>
    <Card.Header>
      <div className="flex items-center gap-2">
        <Icon size={18} className="text-indigo-500" />
        <h2 className="text-lg font-black text-slate-800">{title}</h2>
      </div>
    </Card.Header>
    <Card.Content noPadding>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">항목</th>
              <th className="p-3 text-right">추정 수신량</th>
              <th className="p-3 text-right">문서</th>
              <th className="p-3 text-right">이벤트</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-400">
                  아직 계측 데이터가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={
                    row.id ||
                    row.classId ||
                    row.route ||
                    row.source ||
                    row[labelKey]
                  }
                >
                  <td className="max-w-[260px] p-3 font-semibold text-slate-700">
                    <div className="truncate">
                      {row[labelKey] === "/_shared"
                        ? "공통 구독"
                        : row[labelKey] || labelFallback}
                    </div>
                    {improved ? (
                      <div className="text-xs text-slate-500">
                        비중 {((row.share || 0) * 100).toFixed(1)}%
                      </div>
                    ) : null}
                    {secondaryKey && row[secondaryKey] ? (
                      <div className="mt-1 truncate font-mono text-[11px] font-medium text-slate-400">
                        {row[secondaryKey]}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-3 text-right font-black text-slate-900">
                    {formatBytes(row.estimatedBytes)}
                  </td>
                  <td className="p-3 text-right text-slate-500">
                    {formatNumber(row.estimatedDocCount ?? row.docCount)}
                  </td>
                  <td className="p-3 text-right text-slate-500">
                    {formatNumber(row.eventCount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card.Content>
  </Card>
);

export default ClientTelemetryPage;
