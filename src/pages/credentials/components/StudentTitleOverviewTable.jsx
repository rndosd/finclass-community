import { useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, Users } from "lucide-react";

import { Badge, Button, Card, Spinner } from "../../../components/ui";
import { EmptyState, SectionLead } from "../CredentialsPage.parts";
import {
  getTitleCollectionStageToneColor,
  getTitleCollectionStageToneStyle,
} from "../titleCollectionStageTones";
import TitleCollectionStageEmblem from "./TitleCollectionStageEmblem";

function compareStudentIdentity(left, right) {
  return (
    String(left?.studentNumber || "").localeCompare(
      String(right?.studentNumber || ""),
      "ko",
      { numeric: true },
    ) ||
    String(left?.studentName || "").localeCompare(
      String(right?.studentName || ""),
      "ko",
    )
  );
}

function OwnedCountSortButton({ sortMode, onClick }) {
  const Icon =
    sortMode === "owned-asc"
      ? ChevronUp
      : sortMode === "owned-desc"
        ? ChevronDown
        : ArrowUpDown;

  return (
    <Button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 font-black text-slate-400 transition hover:text-slate-700"
    >
      <span>보유 수</span>
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

function CollectionProgressCell({ row, titleCollectionStages }) {
  const rate = Number(row?.titleCollectionRate || 0);
  const stageTone = row?.titleCollectionStageTone || "slate";
  const stageStyle = getTitleCollectionStageToneStyle(stageTone);
  const stageColor = row?.titleCollectionStageColor || "";
  const stageAccent = getTitleCollectionStageToneColor(stageTone, stageColor);
  const stageLabel = row?.titleCollectionStageLabel || "미등록";
  const dexOwnedCount = Number(row?.dexOwnedCount || 0);
  const dexTotal = Number(row?.dexTotal || 0);

  return (
    <div className="flex min-w-[250px] items-center gap-3">
      <TitleCollectionStageEmblem
        rate={rate}
        tone={stageTone}
        color={stageColor}
        stages={titleCollectionStages}
        compact
        showStage={false}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <Badge
            tone={stageTone}
            style={stageColor ? {
              color: stageAccent,
              backgroundColor: `${stageAccent}18`,
              boxShadow: `inset 0 0 0 1px ${stageAccent}42`,
            } : undefined}
          >
            {stageLabel}
          </Badge>
          <span>도감 {dexOwnedCount}/{dexTotal || 0}</span>
          <span className="text-slate-300">|</span>
          <span>진행률 {rate}%</span>
        </div>
        <div className={`h-2 overflow-hidden rounded-full ${stageStyle.track}`}>
          <div
            className={`h-full rounded-full bg-gradient-to-r ${stageStyle.fill} transition-[width]`}
            style={{
              width: `${Math.max(0, Math.min(100, rate))}%`,
              backgroundColor: stageAccent,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function isRowSelectionExcludedTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,label,select,textarea,[role='button'],[data-no-row-select='true']",
    ),
  );
}

export default function StudentTitleOverviewTable({
  rows = [],
  titleCollectionStages = [],
  onSelect,
  selectedIssueUids = [],
  onSetIssueSelection,
  onToggleAllIssueSelection,
  onSelectionMouseDown,
  onSelectionMouseEnter,
  isLoading,
}) {
  const [sortMode, setSortMode] = useState("default");
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);

  const allSelected =
    rows.length > 0 && rows.every((row) => selectedIssueUids.includes(row.uid));

  const displayedRows = useMemo(() => {
    if (sortMode === "owned-asc") {
      return [...rows].sort(
        (left, right) =>
          Number(left?.ownedCount || 0) - Number(right?.ownedCount || 0) ||
          compareStudentIdentity(left, right),
      );
    }

    if (sortMode === "owned-desc") {
      return [...rows].sort(
        (left, right) =>
          Number(right?.ownedCount || 0) - Number(left?.ownedCount || 0) ||
          compareStudentIdentity(left, right),
      );
    }

    return rows;
  }, [rows, sortMode]);
  const handleOwnedCountSortClick = () => {
    setSortMode((prev) => {
      if (prev === "default") return "owned-asc";
      if (prev === "owned-asc") return "owned-desc";
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
        title="학생 전체 칭호 현황"
        description="학생을 선택하면 하단에서 칭호 지급을 진행하고, 상세보기에서 학생별 보유 현황과 요청 상태를 함께 확인할 수 있습니다."
      />

      {isLoading ? (
        <div className="py-12">
          <Spinner />
        </div>
      ) : displayedRows.length ? (
        <>
        <div className="space-y-3 p-4 md:hidden">
          <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-slate-50 px-3">
            {mobileSelectionMode ? (
              <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-slate-600">
                <input
                  type="checkbox"
                  aria-label="표시된 학생 전체 선택"
                      checked={allSelected}
                  onChange={onToggleAllIssueSelection}
                  className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                전체 선택
              </label>
            ) : (
              <OwnedCountSortButton
                sortMode={sortMode}
                onClick={handleOwnedCountSortClick}
              />
            )}
            <Button
              type="button"
              size="sm"
              tone={mobileSelectionMode ? "rose" : "slate"}
              kind={mobileSelectionMode ? "soft" : "outline"}
              onClick={() => {
                if (mobileSelectionMode) {
                  selectedIssueUids.forEach((uid) =>
                    onSetIssueSelection(uid, false),
                  );
                }
                setMobileSelectionMode((current) => !current);
              }}
              className="min-h-11 shrink-0 justify-center"
            >
              {mobileSelectionMode ? "선택 종료" : "선택"}
            </Button>
          </div>

          {displayedRows.map((row) => {
            const isSelected = selectedIssueUids.includes(row.uid);
            const hasPendingRequests = Number(row.pendingRequestCount || 0) > 0;

            return (
              <article
                key={row.uid}
                className={`rounded-2xl border p-4 ${
                  isSelected
                    ? "border-indigo-300 bg-indigo-50/70"
                    : hasPendingRequests
                      ? "border-amber-200 bg-amber-50/50"
                      : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  {mobileSelectionMode ? (
                  <label className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white">
                    <input
                      type="checkbox"
                      aria-label={`${row.studentName} 선택`}
                          checked={isSelected}
                      onChange={(event) =>
                        onSetIssueSelection(row.uid, event.target.checked)
                      }
                      className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="sr-only">{row.studentName} 선택</span>
                  </label>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-indigo-600">
                      학번 {row.studentNumber || "-"}
                    </p>
                    <p className="truncate font-black text-slate-900">
                      {row.studentName}
                    </p>
                  </div>
                  <Badge tone={row.ownedCount ? "emerald" : "slate"}>
                    칭호 {row.ownedCount}개
                  </Badge>
                </div>

                <div className="mt-4 rounded-xl bg-white/80 p-3">
                    <CollectionProgressCell row={row} titleCollectionStages={titleCollectionStages} />
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-400">대표 칭호</p>
                    <p className="truncate font-bold text-slate-700">
                      {row.equippedTitleName || "-"}
                    </p>
                  </div>
                  <Badge tone={hasPendingRequests ? "amber" : "slate"}>
                    요청 {row.pendingRequestCount}건
                  </Badge>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  tone="slate"
                  onClick={() => onSelect(row.uid)}
                  className="mt-4 min-h-11 w-full justify-center"
                >
                  상세보기
                </Button>
              </article>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50/90">
              <tr className="text-left text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                <th className="px-4 py-3">
                  <label className="inline-flex items-center">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={onToggleAllIssueSelection}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </label>
                </th>
                <th className="px-4 py-3">학번</th>
                <th className="px-4 py-3">이름</th>
                <th className="px-4 py-3">
                  <OwnedCountSortButton
                    sortMode={sortMode}
                    onClick={handleOwnedCountSortClick}
                  />
                </th>
                <th className="px-4 py-3">도감 진행</th>
                <th className="px-4 py-3">대표 칭호</th>
                <th className="px-4 py-3">대기 요청</th>
                <th className="px-4 py-3">상세보기</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {displayedRows.map((row) => {
                const isSelected = selectedIssueUids.includes(row.uid);
                const hasPendingRequests = Number(row.pendingRequestCount || 0) > 0;
                const pendingPreviewText = row.pendingRequestPreview?.length
                  ? `${row.pendingRequestPreview.join(", ")}${
                      row.extraPendingRequestCount > 0
                        ? ` 외 ${row.extraPendingRequestCount}건`
                        : ""
                    }`
                  : "";

                return (
                  <tr
                    key={row.uid}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      if (isRowSelectionExcludedTarget(event.target)) return;
                      event.preventDefault();
                      onSelectionMouseDown?.(row.uid, isSelected);
                    }}
                    onMouseEnter={() => onSelectionMouseEnter?.(row.uid)}
                    className={`cursor-pointer transition ${
                      isSelected
                        ? "bg-indigo-50/70"
                        : hasPendingRequests
                          ? "bg-amber-50/60 hover:bg-amber-50/80"
                          : "hover:bg-slate-50/80"
                    }`}
                  >
                    <td
                      className="px-4 py-4"
                      data-no-row-select="true"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <label className="inline-flex items-center">
                        <input
                          type="checkbox"
                          aria-label={`${row.studentName} 선택`}
                          checked={isSelected}
                          onChange={(event) =>
                            onSetIssueSelection(row.uid, event.target.checked)
                          }
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </label>
                    </td>
                    <td className="px-4 py-4 text-slate-500">
                      {row.studentNumber || "-"}
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <p className="font-bold text-slate-900">
                          {row.studentName}
                        </p>
                        {hasPendingRequests ? (
                          <p className="text-xs font-semibold text-amber-700">
                            요청: {pendingPreviewText}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone={row.ownedCount ? "emerald" : "slate"}>
                        {row.ownedCount}개
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <CollectionProgressCell row={row} titleCollectionStages={titleCollectionStages} />
                    </td>
                    <td className="max-w-[320px] px-4 py-4 text-slate-700">
                      <p className="truncate" title={row.equippedTitleName || ""}>
                        {row.equippedTitleName || "-"}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <Badge
                        tone={row.pendingRequestCount ? "amber" : "slate"}
                      >
                        {row.pendingRequestCount}건
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <Button
                        size="sm"
                        variant="outline"
                        tone="slate"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(row.uid);
                        }}
                      >
                        상세보기
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <EmptyState
          icon={Users}
          title="표시할 학생 현황이 없습니다"
          description="학생 계정을 등록하면 전체 칭호 현황을 여기에서 바로 확인할 수 있습니다."
        />
      )}
    </Card>
  );
}
