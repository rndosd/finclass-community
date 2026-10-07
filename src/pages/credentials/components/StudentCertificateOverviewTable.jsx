import { useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, Users } from "lucide-react";

import { Badge, Button, Card, Spinner } from "../../../components/ui";
import { EmptyState, SectionLead } from "../CredentialsPage.parts";

function OwnedCountSortButton({ sortMode, onClick }) {
  const Icon =
    sortMode === "owned-asc"
      ? ChevronUp
      : sortMode === "owned-desc"
        ? ChevronDown
        : ArrowUpDown;

  return (
    <Button tone="slate" kind="ghost" size="md"
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 transition"
    >
      <span>보유 수</span>
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

export default function StudentCertificateOverviewTable({
  rows = [],
  onSelect,
  isLoading,
}) {
  const [sortMode, setSortMode] = useState("default");
  const displayedRows = useMemo(() => {
    if (sortMode === "default") return rows;
    const direction = sortMode === "owned-asc" ? 1 : -1;
    return [...rows].sort(
      (left, right) =>
        (Number(left?.ownedCount || 0) - Number(right?.ownedCount || 0)) *
          direction ||
        String(left?.studentNumber || "").localeCompare(
          String(right?.studentNumber || ""),
          "ko",
          { numeric: true },
        ),
    );
  }, [rows, sortMode]);

  const toggleOwnedSort = () => {
    setSortMode((current) => {
      if (current === "default") return "owned-asc";
      if (current === "owned-asc") return "owned-desc";
      return "default";
    });
  };

  return (
    <Card
      className="overflow-hidden"
      variant="surface"
      tone="white"
      noShadow
    >
      <SectionLead
        eyebrow="전체 현황"
        title="학생 전체 자격증 현황"
        description="학생별 보유·유효·만료·회수 현황을 확인하고 상세보기에서 개별 기록을 관리할 수 있습니다."
      />

      {isLoading ? (
        <div className="py-12"><Spinner /></div>
      ) : displayedRows.length ? (
        <>
          <div className="space-y-3 p-4 md:hidden">
            {displayedRows.map((row) => (
              <article key={row.uid} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-indigo-600">학번 {row.studentNumber || "-"}</p>
                    <p className="truncate font-black text-slate-900">{row.studentName}</p>
                  </div>
                  <Badge tone={row.ownedCount ? "emerald" : "slate"}>보유 {row.ownedCount}개</Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-emerald-50 px-2 py-3"><p className="text-xs text-emerald-600">유효</p><p className="font-black text-emerald-800">{row.validCount}</p></div>
                  <div className="rounded-xl bg-amber-50 px-2 py-3"><p className="text-xs text-amber-600">만료</p><p className="font-black text-amber-800">{row.expiredCount}</p></div>
                  <div className="rounded-xl bg-rose-50 px-2 py-3"><p className="text-xs text-rose-600">회수</p><p className="font-black text-rose-800">{row.revokedCount}</p></div>
                </div>
                <Button size="sm" variant="outline" tone="slate" onClick={() => onSelect(row.uid)} className="mt-4 w-full justify-center">상세보기</Button>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50/90">
                <tr className="text-left text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  <th className="px-4 py-3">학번</th>
                  <th className="px-4 py-3">이름</th>
                  <th className="px-4 py-3"><OwnedCountSortButton sortMode={sortMode} onClick={toggleOwnedSort} /></th>
                  <th className="px-4 py-3">유효</th>
                  <th className="px-4 py-3">만료</th>
                  <th className="px-4 py-3">회수</th>
                  <th className="px-4 py-3">상세보기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {displayedRows.map((row) => (
                  <tr key={row.uid} className="transition hover:bg-slate-50/80">
                    <td className="px-4 py-4 text-slate-500">{row.studentNumber || "-"}</td>
                    <td className="px-4 py-4 font-bold text-slate-900">{row.studentName}</td>
                    <td className="px-4 py-4"><Badge tone={row.ownedCount ? "emerald" : "slate"}>{row.ownedCount}개</Badge></td>
                    <td className="px-4 py-4"><Badge tone={row.validCount ? "emerald" : "slate"}>{row.validCount}개</Badge></td>
                    <td className="px-4 py-4"><Badge tone={row.expiredCount ? "amber" : "slate"}>{row.expiredCount}개</Badge></td>
                    <td className="px-4 py-4"><Badge tone={row.revokedCount ? "red" : "slate"}>{row.revokedCount}건</Badge></td>
                    <td className="px-4 py-4"><Button size="sm" variant="outline" tone="slate" onClick={() => onSelect(row.uid)}>상세보기</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState icon={Users} title="표시할 학생 현황이 없습니다" description="학생 계정을 등록하면 전체 자격증 현황을 확인할 수 있습니다." />
      )}
    </Card>
  );
}

