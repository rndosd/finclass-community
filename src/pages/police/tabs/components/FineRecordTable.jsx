import { useNumberFormat as useMoneyDisplay } from "../../../../contexts/NumberFormatContext";
import React from "react";
import dayjs from "dayjs";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Coins,
  EyeOff,
  ShieldAlert,
} from "lucide-react";

import { useUser } from "../../../../contexts/UserContext";
import {
  isPoliceIgnoredReportRecord,
  isPoliceRewardRecord,
} from "../../utils/historyRecordType";
import { Button, DataTable, EmptyState } from "../../../../components/ui";
import { getUserFacingRecordDescription } from "../../../../utils/userFacingRecordDescription";
import { policeHistoryTableStyles as tableStyles } from "./policeHistoryTableStyles";

const normalizeSubmissionType = (value) =>
  value === "appeal" ? "appeal" : "reflection";

const getReflectionStatusMeta = (record) => {
  const status = record.reflectionStatus || "none";
  const submissionType = normalizeSubmissionType(record.submissionType);
  const reviewOutcome = record.reviewOutcome || "approved";

  switch (status) {
    case "submitted":
      return {
        text: submissionType === "appeal" ? "이의 제기 검토 중" : "반성문 검토 중",
        bg: "bg-indigo-50/50",
        textColor: "text-indigo-600",
        border: "border-indigo-100",
        icon: <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />,
      };
    case "approved":
      return {
        text:
          reviewOutcome === "adjusted"
            ? "조정 승인"
            : submissionType === "appeal"
              ? "이의 승인"
              : "승인 완료",
        bg: "bg-emerald-50/50",
        textColor: "text-emerald-600",
        border: "border-emerald-100",
        icon: <Check size={10} strokeWidth={3} />,
      };
    case "rejected":
      return {
        text: submissionType === "appeal" ? "이의 반려" : "반려됨",
        bg: "bg-amber-50/50",
        textColor: "text-amber-600",
        border: "border-amber-100",
        icon: <AlertCircle size={10} strokeWidth={3} />,
      };
    default:
      return {
        text: "작성 필요",
        bg: "bg-rose-50/50",
        textColor: "text-rose-500",
        border: "border-rose-100",
        icon: <div className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />,
      };
  }
};

const BASE_HEADERS = [
  { key: "select", label: "선택", width: "48px" },
  { key: "when", label: "일시", width: "112px" },
  { key: "flow", label: "보고/부과 대상자", width: "220px" },
  { key: "rule", label: "규칙", width: "180px" },
  { key: "reason", label: "사유" },
  { key: "amount", label: "금액", width: "90px" },
  { key: "credit", label: "신용", width: "70px" },
  { key: "missionToken", label: "토큰", width: "80px" },
  { key: "reflection", label: "소명/반성", width: "150px" },
];

const isRowSelectionExcludedTarget = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,select,textarea,[role='button'],[data-no-row-select='true']",
    ),
  );
};

const getRecordTypeMeta = (record) => {
  if (isPoliceIgnoredReportRecord(record)) {
    return {
      isReward: false,
      isIgnoredReport: true,
      label: "반려",
      badgeClass: "border border-slate-200 bg-slate-50 text-slate-600",
    };
  }

  const isReward = isPoliceRewardRecord(record);

  return isReward
    ? {
        isReward: true,
        label: "보상",
        badgeClass: "border border-emerald-100 bg-emerald-50 text-emerald-700",
      }
    : {
        isReward: false,
        label: "벌금",
        badgeClass: "border border-rose-100 bg-rose-50 text-rose-700",
      };
};

const getSourceMeta = (record) => {
  if (record.reporterName) {
    return `보고 ${record.reporterName}`;
  }

  return `처리 ${record.resolverName || record.actorName || "교사"}`;
};

const HiddenCell = ({ centered = false }) => (
  <span
    className={`inline-flex items-center gap-1 text-xs text-slate-300 ${
      centered ? "justify-center" : ""
    }`}
  >
    <EyeOff size={11} />
    비공개
  </span>
);

const FineRecordTable = ({
  filteredRecords = [],
  selectedIds = [],
  onMouseDown,
  onMouseEnter,
  allowSelection = false,
  onReflectionSubmit,
  onReflectionReview,
  onReasonClick,
  currencyUnit,
  showReflectionColumn = true,
  showMissionTokenColumn = false,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { userData, hasPermission, isTeacher, missionTokenLabel } = useUser();
  const isPoliceAdmin = isTeacher || hasPermission("permission_group_police");
  const visibleHeaders = BASE_HEADERS.filter((header) => {
    if (!allowSelection && header.key === "select") return false;
    if (!showReflectionColumn && header.key === "reflection") return false;
    if (!showMissionTokenColumn && header.key === "missionToken") return false;
    return true;
  }).map((header) => {
    if (header.key === "missionToken") {
      return {
        ...header,
        label: missionTokenLabel,
      };
    }
    return header;
  });

  const tableMinWidth = showReflectionColumn
    ? showMissionTokenColumn
      ? "min-w-[1120px]"
      : "min-w-[1040px]"
    : showMissionTokenColumn
      ? "min-w-[980px]"
      : "min-w-[900px]";

  const renderReflection = (record) => {
    if (record.visibilityLevel === "summary") {
      return <HiddenCell centered />;
    }

    const isReward = isPoliceRewardRecord(record);
    const isIgnoredReport = isPoliceIgnoredReportRecord(record);
    if (isReward || isIgnoredReport) {
      return <span className="text-[10px] font-medium text-slate-200">N/A</span>;
    }

    const isCancelled = record.status === "cancelled";
    const status = record.reflectionStatus || "none";
    const isOwn = record.studentUid === userData?.uid;
    const current = getReflectionStatusMeta(record);
    const canClick =
      (isOwn && !isCancelled) ||
      (isPoliceAdmin && status === "submitted") ||
      status === "approved";

    if (!isOwn && status === "none") {
      return (
        <div className="flex w-full justify-center">
          <div className="h-1 w-1 rounded-full bg-slate-100" />
        </div>
      );
    }

    return (
      <Button
        type="button"
        disabled={!canClick}
        onClick={(event) => {
          event.stopPropagation();
          if (isOwn && (status === "none" || status === "rejected")) {
            onReflectionSubmit(record);
            return;
          }
          onReflectionReview(record);
        }}
        kind="ghost"
        tone="slate"
        size="xs"
        className={`group relative mx-auto inline-flex min-w-[112px] items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-bold whitespace-nowrap transition-all duration-200 ${
          canClick
            ? `${current.bg} ${current.textColor} ${current.border} hover:brightness-95 hover:shadow-sm active:scale-95`
            : "cursor-default border-slate-100 bg-slate-50 text-slate-300 opacity-60"
        }`}
      >
        <span className="shrink-0">{current.icon}</span>
        <span className="tracking-tight">{current.text}</span>

        {isPoliceAdmin && status === "submitted" ? (
          <span className="absolute -right-1 -top-1 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
        ) : null}
      </Button>
    );
  };

  return (
    <DataTable tableClassName={tableStyles.table} minWidth={tableMinWidth}>
        <colgroup>
          {visibleHeaders.map((header) => (
            <col key={header.key} style={{ width: header.width }} />
          ))}
        </colgroup>

        <DataTable.Header>
          <DataTable.Row interactive={false}>
            {visibleHeaders.map((header) => (
              <DataTable.HeadCell
                key={header.key}
                className={`${tableStyles.header} ${
                  ["amount", "credit", "missionToken"].includes(header.key)
                    ? "!text-right"
                    : ["select", "when", "reflection"].includes(header.key)
                      ? "!text-center"
                      : "!text-left"
                }`}
              >
                {header.label}
                {header.key === "amount" ? `(${currencyUnit})` : ""}
              </DataTable.HeadCell>
            ))}
          </DataTable.Row>
        </DataTable.Header>

        <DataTable.Body>
          {filteredRecords.length === 0 ? (
            <DataTable.Empty colSpan={visibleHeaders.length} className="py-14">
              <EmptyState
                icon={ShieldAlert}
                title="표시할 벌금 기록이 없습니다"
                description="필터 조건을 조정하거나 새 기록이 생기면 이곳에 표시됩니다."
              />
            </DataTable.Empty>
          ) : (
            filteredRecords.map((record) => {
            const isSelected = selectedIds.includes(record.id);
            const isCancelled = record.status === "cancelled";
            const amount = Number(record.amountSigned ?? 0);
            const appliedCount = Math.max(
              1,
              Math.floor(Number(record.quantityApplied || 1)),
            );
            const typeMeta = getRecordTypeMeta(record);
            const isReward = typeMeta.isReward;
            const isIgnoredReport = typeMeta.isIgnoredReport;
            const isSensitive = record.isSensitive === true;
            const isSummaryView = record.visibilityLevel === "summary";
            const canSeeDetail =
              isTeacher || isPoliceAdmin || record.studentUid === userData?.uid;
            const canOpenReason = !isSummaryView && !(isSensitive && !canSeeDetail);
            const missionTokenDelta = Number(record.missionTokenChangeApplied || 0);

            return (
              <DataTable.Row
                key={record.id}
                onMouseDown={(event) => {
                  if (!allowSelection) return;
                  if (event.button !== 0) return;
                  if (isRowSelectionExcludedTarget(event.target)) return;

                  event.preventDefault();
                  onMouseDown?.(record.id, isSelected);
                }}
                onMouseEnter={() => {
                  if (!allowSelection) return;
                  onMouseEnter?.(record.id);
                }}
                className={`border-l-4 transition-colors ${
                  isSelected
                    ? "border-l-blue-500 bg-blue-50/50"
                    : isCancelled
                      ? "border-l-transparent bg-slate-50 opacity-40"
                      : isSensitive
                        ? "border-l-rose-400 bg-rose-50/20"
                        : "border-l-transparent bg-white hover:bg-slate-50/50"
                }`}
              >
                {allowSelection ? (
                  <td className={`${tableStyles.cell} text-center`}>
                    <div
                      className={`mx-auto flex h-4 w-4 items-center justify-center rounded border transition-all ${
                        isSummaryView
                          ? "border-slate-200 bg-slate-100"
                          : isSelected
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-300 bg-white"
                      }`}
                    >
                      {!isSummaryView && isSelected ? (
                        <Check size={10} strokeWidth={4} />
                      ) : null}
                    </div>
                  </td>
                ) : null}

                <td className={`${tableStyles.cell} ${tableStyles.date}`}>
                  {record.appliedAt
                    ? dayjs(record.appliedAt.toDate?.() || record.appliedAt).format(
                        "MM.DD HH:mm",
                      )
                    : "-"}
                </td>

                <td className={tableStyles.cell}>
                  {isSummaryView ? (
                    <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px]">
                      <span className={`${tableStyles.name} shrink-0`}>
                        {record.studentName}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-bold ${typeMeta.badgeClass}`}
                      >
                        {typeMeta.label}
                      </span>
                      {appliedCount > 1 ? (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-500">
                          x{appliedCount}
                        </span>
                      ) : null}
                      {isSensitive ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-bold text-rose-600">
                          <ShieldAlert size={11} />
                          민감
                        </span>
                      ) : null}
                      {isCancelled ? (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-500">
                          취소됨
                        </span>
                      ) : null}
                      <span className="shrink-0 text-slate-300">|</span>
                      <span className="min-w-0 truncate text-slate-500">
                        {getSourceMeta(record)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <div className="flex min-w-0 max-w-full items-center gap-1.5">
                        {record.reporterName ? (
                          <div className="flex items-center gap-1">
                            <span className={tableStyles.source}>
                              {record.reporterName}
                            </span>
                            <span className={tableStyles.source}>
                              ({record.resolverName || record.actorName || "교사"})
                            </span>
                          </div>
                        ) : (
                          <span className={tableStyles.source}>
                            {record.resolverName || record.actorName || "교사"}
                          </span>
                        )}
                      </div>
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ArrowRight size={12} className="shrink-0 text-slate-300" />
                        <span className={`${tableStyles.name} break-words`}>
                          {record.studentName}
                        </span>
                      </span>
                    </div>
                  )}
                </td>

                <td className={tableStyles.cell}>
                  {isSummaryView ? (
                    <HiddenCell />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`${tableStyles.rule} line-clamp-2 ${
                          isSensitive ? "text-rose-700" : "text-slate-700"
                        }`}
                      >
                        {record.ruleText ||
                          (isIgnoredReport
                            ? "신고 반려"
                            : isReward
                              ? "보상"
                              : "벌점")}
                      </span>
                      {appliedCount > 1 ? (
                        <span className={tableStyles.count}>
                          x{appliedCount}
                        </span>
                      ) : null}
                      {isSensitive ? (
                        <ShieldAlert size={13} className="shrink-0 text-rose-500" />
                      ) : null}
                    </div>
                  )}
                </td>

                <td className={tableStyles.cell}>
                  {isSummaryView ? (
                    <HiddenCell />
                  ) : (
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!canOpenReason) return;
                        onReasonClick(record);
                      }}
                      kind="ghost"
                      tone="slate"
                      size="xs"
                      className={`w-full justify-start text-left outline-none ${
                        canOpenReason ? "group/reason" : "cursor-default"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        {isSensitive && !canSeeDetail ? (
                          <span className="flex items-center gap-1 italic text-slate-300">
                            <EyeOff size={11} />
                            비공개
                          </span>
                        ) : (
                            <span className={`${tableStyles.reason} line-clamp-1 text-slate-500 transition-colors group-hover/reason:text-blue-600`}>
                            {getUserFacingRecordDescription(
                              record.rejectReason ||
                                record.rejectionReason ||
                                record.reason ||
                                record.description,
                              "-",
                            )}
                          </span>
                        )}
                      </div>
                    </Button>
                  )}
                </td>

                <td
                  className={`${tableStyles.cell} text-right text-sm tabular-nums font-semibold ${
                    isReward ? "text-emerald-600" : "text-slate-600"
                  }`}
                >
                  {isSummaryView || isIgnoredReport ? (
                    <span className="text-slate-300">-</span>
                  ) : (
                    <>
                      {isReward ? "+" : "-"}
                      {formatDisplayMoney(Math.abs(amount))}
                    </>
                  )}
                </td>

                <td className={`${tableStyles.cell} text-right text-sm tabular-nums`}>
                  {isSummaryView ? (
                    <span className="text-slate-300">-</span>
                  ) : Number(record.creditChangeApplied || 0) !== 0 ? (
                    <span
                      className={
                        Number(record.creditChangeApplied || 0) > 0
                          ? "font-bold text-blue-500"
                          : "font-bold text-rose-500"
                      }
                    >
                      {Number(record.creditChangeApplied || 0) > 0 ? "+" : ""}
                      {Number(record.creditChangeApplied || 0)}
                    </span>
                  ) : (
                    <span className="text-slate-300">-</span>
                  )}
                </td>

                {showMissionTokenColumn ? (
                  <td className={`${tableStyles.cell} text-right text-sm tabular-nums`}>
                    {isSummaryView ? (
                      <span className="text-slate-300">-</span>
                    ) : missionTokenDelta !== 0 ? (
                      <span
                        className={`inline-flex items-center gap-1 font-bold ${
                          missionTokenDelta > 0 ? "text-amber-600" : "text-rose-500"
                        }`}
                      >
                        <Coins size={12} />
                        <span>
                          {missionTokenDelta > 0 ? "+" : ""}
                          {missionTokenDelta}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                ) : null}

                {showReflectionColumn ? (
                  <td className={`${tableStyles.cell} text-center`}>{renderReflection(record)}</td>
                ) : null}
              </DataTable.Row>
            );
          })
          )}
        </DataTable.Body>
      </DataTable>
  );
};

export default FineRecordTable;
