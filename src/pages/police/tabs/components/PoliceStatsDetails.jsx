import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button, DataTable, Modal, Tabs } from "../../../../components/ui";

export const compareStudentNumbers = (a, b) => {
  const number = (value) => value !== null && value !== "" && Number(value) > 0 ? Number(value) : Infinity;
  const difference = number(a.studentNumber) - number(b.studentNumber);
  return (Number.isFinite(difference) ? difference : 0) ||
    (number(a.studentNumber) < number(b.studentNumber) ? -1 : number(a.studentNumber) > number(b.studentNumber) ? 1 : 0) ||
    a.name.localeCompare(b.name, "ko-KR", { numeric: true });
};

const count = (value) => `${Number(value || 0).toLocaleString("ko-KR")}건`;
const PAGE_SIZE = 20;
const headerClass = "!px-3 !py-3 !font-semibold";
const cellClass = "px-3 py-3 text-sm";

function useWideScreen() {
  const [wide, setWide] = useState(() => window.matchMedia?.("(min-width: 1024px)").matches ?? true);
  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 1024px)");
    if (!media) return undefined;
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

function DetailPanel({ title, onClose, children, wide }) {
  const headingRef = useRef(null);
  useEffect(() => {
    if (wide) headingRef.current?.focus({ preventScroll: true });
  }, [wide]);
  if (!wide) return <Modal isOpen title={title} onClose={onClose} size="md" density="compact">{children}</Modal>;
  return (
    <aside aria-label={title} className="sticky top-4 self-start overflow-hidden rounded-xl border border-blue-200 bg-white" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-slate-900 outline-none">{title}</h3>
        <Button kind="ghost" tone="slate" size="sm" icon={X} aria-label="상세 패널 닫기" onClick={onClose} />
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
    </aside>
  );
}

function PagedList({ title, query, onQueryChange, page, onPageChange, total, children, placeholder }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="space-y-2 border-b border-slate-100 p-4">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <input aria-label={placeholder} placeholder={placeholder} value={query} onChange={(event) => { onQueryChange(event.target.value); onPageChange(1); }} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
    </div>
    <div className="max-h-[520px] overflow-y-auto">{children}</div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span>{total}개 결과 · {page} / {pages}페이지</span>
      <div className="flex gap-2">
        <Button size="xs" kind="outline" tone="slate" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>이전</Button>
        <Button size="xs" kind="outline" tone="slate" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>다음</Button>
      </div>
    </div>
  </section>;
}

export default function PoliceStatsDetails({ mode, rows, formatAmount, formatDate, ruleType = "fine" }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [studentType, setStudentType] = useState("fine");
  const triggerRef = useRef(null);
  const wide = useWideScreen();
  const studentsMode = mode === "students";
  const filtered = useMemo(() => {
    const matching = rows.filter((row) => `${studentsMode ? `${row.studentNumber ?? ""} ${row.name}` : row.ruleText}`.includes(query.trim()));
    return studentsMode ? matching.sort(compareStudentNumbers) : matching;
  }, [rows, query, studentsMode]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const visibleRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = rows.find((row) => (studentsMode ? row.uid : row.ruleKey) === selectedId);
  const detailType = studentsMode ? studentType : ruleType;
  const countKey = detailType === "reward" ? "rewardCount" : "fineCount";
  const amountKey = detailType === "reward" ? "rewardAmount" : "fineAmount";
  const details = selected ? studentsMode ? (detailType === "reward" ? selected.rewardRules : selected.rules) : [...selected.students].sort(compareStudentNumbers) : [];
  const close = () => { setSelectedId(null); triggerRef.current?.focus({ preventScroll: true }); };
  const choose = (row, event) => {
    triggerRef.current = event.currentTarget;
    setSelectedId(studentsMode ? row.uid : row.ruleKey);
    if (studentsMode) setStudentType(row.fineCount > 0 ? "fine" : "reward");
  };
  const title = selected ? `${studentsMode ? `${selected.studentNumber ? `${selected.studentNumber}번 · ` : ""}${selected.name} · 적용 규칙` : `${selected.ruleText} · 적용 학생`}` : "";
  return <div className={`grid items-start gap-4 ${selected && wide ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
    <div className="min-w-0">
      <p className="mb-3 text-xs leading-5 text-slate-500">{studentsMode ? "선택 기간에 벌점·상점 기록이 있는 학생만 학번순으로 표시합니다. 학생을 선택하면 오른쪽에서 적용 규칙을 확인할 수 있습니다." : "규칙을 선택하면 적용된 학생과 학생별 횟수를 확인할 수 있습니다."}</p>
      <PagedList title={studentsMode ? "학생별 기록" : "규칙별 기록"} query={query} onQueryChange={setQuery} page={currentPage} onPageChange={setPage} total={filtered.length} placeholder={studentsMode ? "학번 또는 학생 이름 검색" : "규칙 이름 검색"}>
        <DataTable tableClassName="w-full table-fixed" minWidth="min-w-[520px]">
          <DataTable.Header><DataTable.Row interactive={false}>
            {studentsMode && <DataTable.HeadCell align="center" className={`${headerClass} w-14 !text-center`}>학번</DataTable.HeadCell>}
            <DataTable.HeadCell className={`${headerClass} !text-left`}>{studentsMode ? "학생" : "규칙"}</DataTable.HeadCell>
            <DataTable.HeadCell align="right" className={`${headerClass} w-20 !text-right`}>{studentsMode ? "벌점" : detailType === "reward" ? "상점" : "벌점"}</DataTable.HeadCell>
            <DataTable.HeadCell align="right" className={`${headerClass} w-20 !text-right`}>{studentsMode ? "상점" : "적용 학생"}</DataTable.HeadCell>
            <DataTable.HeadCell align="center" className={`${headerClass} w-28 !text-center`}>최근 적용</DataTable.HeadCell>
          </DataTable.Row></DataTable.Header>
          <DataTable.Body>
            {!visibleRows.length && <DataTable.Empty colSpan={studentsMode ? 5 : 4}>조건에 맞는 기록이 없습니다.</DataTable.Empty>}
            {visibleRows.map((row) => {
              const id = studentsMode ? row.uid : row.ruleKey;
              return <DataTable.Row key={id} className={id === selectedId ? "bg-blue-50" : ""}>
                {studentsMode && <td className={`${cellClass} text-center tabular-nums text-slate-500`}>{row.studentNumber || "-"}</td>}
                <td className={cellClass}><button type="button" aria-expanded={id === selectedId} onClick={(event) => choose(row, event)} className="w-full py-1 text-left font-semibold text-blue-700 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">{studentsMode ? row.name : row.ruleText}</button></td>
                <td className={`${cellClass} text-right tabular-nums`}>{count(studentsMode ? row.fineCount : row[countKey])}</td>
                <td className={`${cellClass} text-right tabular-nums`}>{studentsMode ? count(row.rewardCount) : `${row.affectedStudentCount}명`}</td>
                <td className={`${cellClass} text-center text-xs tabular-nums text-slate-500`}>{formatDate(row.latestAppliedAt)}</td>
              </DataTable.Row>;
            })}
          </DataTable.Body>
        </DataTable>
      </PagedList>
    </div>
    {selected && <DetailPanel title={title} onClose={close} wide={wide}>
      {studentsMode && <Tabs ariaLabel="학생 적용 규칙 종류" tabs={[{id:"fine",label:`벌점 ${count(selected.fineCount)}`},{id:"reward",label:`상점 ${count(selected.rewardCount)}`}]} activeTab={studentType} onTabChange={setStudentType} variant="underline" size="sm" />}
      <p className="my-3 text-xs leading-5 text-slate-500">{studentsMode ? `선택 기간 ${count(selected[countKey])} · 기록 금액 ${formatAmount(selected[amountKey])}` : `${count(selected[countKey])} · ${selected.affectedStudentCount}명 · 2건 이상인 학생 ${selected.repeatStudentCount}명`}</p>
      <div className="space-y-3">
        {!details.length && <p className="py-6 text-center text-sm text-slate-500">해당 종류의 적용 기록이 없습니다.</p>}
        {details.map((detail) => <article key={studentsMode ? detail.ruleKey : detail.uid} className="rounded-lg border border-slate-200 p-3">
          <h4 className="text-sm font-semibold leading-5 text-slate-900">{studentsMode ? detail.ruleText : `${detail.studentNumber ? `${detail.studentNumber}번 · ` : ""}${detail.name}`}</h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-slate-500">건수</dt><dd className="text-right tabular-nums">{count(detail[countKey])}</dd>
            <dt className="text-slate-500">기록 금액</dt><dd className="text-right tabular-nums">{formatAmount(detail[amountKey])}</dd>
            <dt className="text-slate-500">최근 적용</dt><dd className="text-right tabular-nums">{formatDate(detail.latestAppliedAt)}</dd>
          </dl>
        </article>)}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">선택한 기간의 일일 집계입니다. 취소 기록도 포함하며 개별 사유는 부과내역에서 확인할 수 있습니다.</p>
    </DetailPanel>}
  </div>;
}
