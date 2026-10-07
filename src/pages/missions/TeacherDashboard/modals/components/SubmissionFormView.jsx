import React, { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ko";
import { BulkActionFloatingBar, Button } from "../../../../../components/ui";
import { db } from "../../../../../firebase";
import { useFeedback } from "../../../../../contexts/FeedbackContext";
import { useUser } from "../../../../../contexts/UserContext";
import {
  approveMissionBatch,
  cancelMissionApprovalBatch,
  rejectSubmissionBatch,
  rejectSubmission,
  saveSubmissionFeedback,
} from "../../../services/missionService";
import {
  MISSION_STATUS_LABELS,
  MISSION_STATUS_STYLES,
} from "../../../constants/missionStatusConstants";
import { isMissionAssignedToStudent } from "../../../utils/missionEligibility";
import {
  getRewardAmountFromRatio,
  getRewardApprovalDefaults,
  getRewardConstraints,
  getRewardRatioFromAmount,
  hasRewardRange,
  sanitizeRewardOverride,
} from "../../../utils/rewardUtils";
import RewardOverrideFields from "./RewardOverrideFields";
import SubmissionReviewModal from "./SubmissionReviewModal";

dayjs.extend(relativeTime);
dayjs.locale("ko");

const submissionDetailCache = new Map();

const buildSubmissionCacheKey = ({ classId, missionId, submissionId }) =>
  `${classId || ""}:${missionId || ""}:${submissionId || ""}`;

const getRowTargeted = (mission, student) => {
  if ((student?.role ?? "student") === "teacher") {
    const targets = Array.isArray(mission?.targetStudentUids)
      ? mission.targetStudentUids
      : [];
    return targets.length === 0 || targets.includes(student?.uid);
  }

  return isMissionAssignedToStudent(mission, student, student?.uid);
};

const buildSubmissionSummary = ({ mission, student }) => {
  const uid = student?.uid;
  if (!uid) return null;

  const completion = mission?.completions?.[uid] || null;
  const submissionId =
    completion?.submissionId || mission?.submissionsIndex?.[uid] || null;

  if (!submissionId) return null;

  return {
    id: submissionId,
    studentUid: uid,
    studentName: student?.name || completion?.name || "",
    studentNumber: student?.studentNumber ?? completion?.studentNumber ?? null,
    status: completion?.status || "pending",
    submittedAt: completion?.submittedAt || null,
    feedback: completion?.feedback || "",
    feedbackEditedAt: completion?.feedbackEditedAt || null,
    isSummary: true,
  };
};

const SubmissionFormView = ({
  mission,
  studentMatrix,
  onClose,
  mode = "approve",
}) => {
  const [subSelected, setSubSelected] = useState(() => new Set());
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewSubmission, setReviewSubmission] = useState(null);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragMode, setDragMode] = useState(null);
  const [rewardOverrideMap, setRewardOverrideMap] = useState({});
  const { showFeedback } = useFeedback();
  const { classData, classId: classIdFromUser } = useUser();

  const missionClassId = mission?.classId || mission?.classID || classIdFromUser;
  const currencyUnit = classData?.currencyUnit || "코인";
  const hasRangeRewards = useMemo(() => hasRewardRange(mission), [mission]);
  const rewardConstraints = useMemo(
    () => getRewardConstraints(mission),
    [mission],
  );
  const rewardDefaults = useMemo(
    () => getRewardApprovalDefaults(mission),
    [mission],
  );
  const showRewardOverrides = mode === "approve" && hasRangeRewards;

  const rows = useMemo(() => {
    if (!mission || !studentMatrix?.length) return [];

    return studentMatrix
      .map((student) => {
        const submission = buildSubmissionSummary({ mission, student });
        const completion = mission?.completions?.[student.uid] || null;
        const isTargeted = getRowTargeted(mission, student);
        const status = completion?.status || submission?.status || "none";

        return {
          uid: student.uid,
          name:
            student.role === "teacher"
              ? `${student.name || "교사"} (교사)`
              : student.name,
          role: student.role ?? "student",
          studentNumber: student.studentNumber ?? 9999,
          submission,
          status,
          submittedAt: submission?.submittedAt || null,
          isTargeted,
          orderKey:
            student.role === "teacher" ? -1 : (student.studentNumber ?? 9999),
        };
      })
      .sort(
        (left, right) =>
          left.orderKey - right.orderKey ||
          left.name.localeCompare(right.name, "ko") ||
          left.uid.localeCompare(right.uid),
      );
  }, [mission, studentMatrix]);

  const stats = useMemo(() => {
    const targetedRows = rows.filter(
      (row) => row.isTargeted && row.role === "student",
    );

    return {
      total: targetedRows.length,
      pending: targetedRows.filter(
        (row) => row.status === "pending" || row.status === "late",
      ).length,
      approved: targetedRows.filter(
        (row) => row.status === "approved" || row.status === "late-approved",
      ).length,
      unsubmitted: targetedRows.filter(
        (row) => !row.submission || row.status === "rejected",
      ).length,
    };
  }, [rows]);

  const submittedRows = useMemo(
    () => rows.filter((row) => row.submission && row.isTargeted),
    [rows],
  );

  const canSelectSubmission = useCallback(
    (row) => {
      if (!row?.submission) return false;
      if (mode === "approve") {
        return row.status === "pending" || row.status === "late";
      }
      return row.status === "approved" || row.status === "late-approved";
    },
    [mode],
  );

  useEffect(() => {
    setRewardOverrideMap((prev) => {
      const next = {};

      rows.forEach((row) => {
        next[row.uid] = sanitizeRewardOverride(
          mission,
          prev[row.uid] ?? rewardDefaults,
        );
      });

      return next;
    });
  }, [mission, rewardDefaults, rows]);

  useEffect(() => {
    setSubSelected((prev) => {
      if (prev.size === 0) return prev;

      const selectableIds = new Set(
        submittedRows
          .filter((row) => canSelectSubmission(row))
          .map((row) => row.submission.id),
      );
      const next = new Set();
      prev.forEach((submissionId) => {
        if (selectableIds.has(submissionId)) {
          next.add(submissionId);
        }
      });
      return next;
    });
  }, [canSelectSubmission, submittedRows]);

  useEffect(() => {
    if (!reviewTarget?.submission?.id || !missionClassId || !mission?.id) {
      setReviewSubmission(reviewTarget?.submission || null);
      setIsReviewLoading(false);
      return undefined;
    }

    const summarySubmission = reviewTarget.submission;
    const cacheKey = buildSubmissionCacheKey({
      classId: missionClassId,
      missionId: mission.id,
      submissionId: summarySubmission.id,
    });
    const cached = submissionDetailCache.get(cacheKey);

    if (cached) {
      setReviewSubmission(cached);
      setIsReviewLoading(false);
      return undefined;
    }

    let cancelled = false;
    setReviewSubmission(summarySubmission);
    setIsReviewLoading(true);

    void getDoc(
      doc(
        db,
        `classes/${missionClassId}/missions/${mission.id}/submissions/${summarySubmission.id}`,
      ),
    )
      .then((snapshot) => {
        if (cancelled) return;

        if (snapshot.exists()) {
          const nextSubmission = { id: snapshot.id, ...snapshot.data() };
          submissionDetailCache.set(cacheKey, nextSubmission);
          setReviewSubmission(nextSubmission);
          return;
        }

        setReviewSubmission(summarySubmission);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[SubmissionFormView] failed to load submission detail:", error);
        showFeedback?.(
          error?.message || "제출 상세를 불러오지 못했습니다.",
          "error",
        );
        setReviewSubmission(summarySubmission);
      })
      .finally(() => {
        if (!cancelled) {
          setIsReviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mission?.id, missionClassId, reviewTarget, showFeedback]);

  const toggleOne = useCallback((submissionId) => {
    setSubSelected((prev) => {
      const next = new Set(prev);
      if (next.has(submissionId)) {
        next.delete(submissionId);
      } else {
        next.add(submissionId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    const selectableIds = submittedRows
      .filter((row) => canSelectSubmission(row))
      .map((row) => row.submission.id);

    setSubSelected((prev) => {
      if (prev.size === selectableIds.length) {
        return new Set();
      }
      return new Set(selectableIds);
    });
  }, [canSelectSubmission, submittedRows]);

  const applyDrag = useCallback(
    (row, nextMode) => {
      if (!row?.submission || !canSelectSubmission(row)) return;

      const submissionId = row.submission.id;
      setSubSelected((prev) => {
        const next = new Set(prev);
        if (nextMode === "select") {
          next.add(submissionId);
        } else {
          next.delete(submissionId);
        }
        return next;
      });
    },
    [canSelectSubmission],
  );

  const startDrag = useCallback(
    (row) => {
      if (!row?.submission || !canSelectSubmission(row)) return;

      setIsDragSelecting(true);
      const submissionId = row.submission.id;
      const nextMode = subSelected.has(submissionId) ? "deselect" : "select";
      setDragMode(nextMode);
      applyDrag(row, nextMode);
    },
    [applyDrag, canSelectSubmission, subSelected],
  );

  const isInteractiveTarget = useCallback((event) => {
    const target = event?.target;
    if (!target || typeof target.closest !== "function") return false;

    return Boolean(
      target.closest("input, button, textarea, select, a, label, [data-no-drag]"),
    );
  }, []);

  const enterDrag = useCallback(
    (row) => {
      if (!isDragSelecting || !dragMode) return;
      applyDrag(row, dragMode);
    },
    [applyDrag, dragMode, isDragSelecting],
  );

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragSelecting(false);
      setDragMode(null);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const handleApproveSubmissions = useCallback(async () => {
    if (!subSelected.size) return;

    try {
      setSubmitting(true);

      const items = rows
        .filter((row) => row.submission && subSelected.has(row.submission.id))
        .map((row) => ({
          uid: row.uid,
          submissionId: row.submission.id,
          rewardOverride: showRewardOverrides
            ? sanitizeRewardOverride(mission, rewardOverrideMap[row.uid])
            : null,
        }))
        .filter((item) => item.uid && item.submissionId);

      if (items.length === 0) {
        showFeedback?.("승인할 제출을 찾지 못했습니다. 다시 선택해 주세요.", "warning");
        return;
      }

      const deduped = new Map();
      items.forEach((item) => {
        deduped.set(item.uid, item);
      });
      const finalItems = Array.from(deduped.values());

      await approveMissionBatch(missionClassId, mission.id, finalItems);
      showFeedback?.(`선택한 ${finalItems.length}건을 승인했습니다.`, "success");
      setSubSelected(new Set());
    } catch (error) {
      console.error("Failed to approve mission submissions:", error);
      showFeedback?.(
        error?.message || "제출 일괄 승인에 실패했습니다.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    mission,
    missionClassId,
    rewardOverrideMap,
    rows,
    showFeedback,
    showRewardOverrides,
    subSelected,
  ]);

  const handleRevokeSubmissions = useCallback(async () => {
    if (!subSelected.size) return;

    try {
      setSubmitting(true);
      const uids = rows
        .filter((row) => row.submission && subSelected.has(row.submission.id))
        .map((row) => row.uid);

      await cancelMissionApprovalBatch(missionClassId, mission.id, uids);
      showFeedback?.(`선택한 ${uids.length}건의 승인을 취소했습니다.`, "success");
      setSubSelected(new Set());
    } catch (error) {
      console.error("Failed to cancel mission approvals:", error);
      showFeedback?.(
        error?.message || "승인 취소에 실패했습니다.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }, [mission?.id, missionClassId, rows, showFeedback, subSelected]);

  const handleRejectSubmissions = useCallback(async () => {
    if (!subSelected.size) return;

    try {
      setSubmitting(true);

      const submissionIds = rows
        .filter((row) => row.submission && subSelected.has(row.submission.id))
        .map((row) => row.submission.id)
        .filter(Boolean);

      if (submissionIds.length === 0) {
        showFeedback?.("반려할 제출이 없습니다.", "warning");
        return;
      }

      await rejectSubmissionBatch(missionClassId, mission.id, submissionIds);
      showFeedback?.(`선택한 ${submissionIds.length}건을 반려했습니다.`, "success");
      setSubSelected(new Set());
    } catch (error) {
      console.error("Failed to reject mission submissions:", error);
      showFeedback?.(
        error?.message || "제출 반려 중 문제가 발생했습니다.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }, [mission?.id, missionClassId, rows, showFeedback, subSelected]);

  const selectableCount = useMemo(
    () => submittedRows.filter((row) => canSelectSubmission(row)).length,
    [canSelectSubmission, submittedRows],
  );

  const selectedSubmissionRows = useMemo(
    () =>
      rows.filter(
        (row) => row.submission && subSelected.has(row.submission.id),
      ),
    [rows, subSelected],
  );

  const selectedRewardRatio = useMemo(() => {
    if (!showRewardOverrides || selectedSubmissionRows.length === 0) {
      return 100;
    }

    const ratios = [];

    selectedSubmissionRows.forEach((row) => {
      const override = sanitizeRewardOverride(
        mission,
        rewardOverrideMap[row.uid] ?? rewardDefaults,
      );

      ["credit", "currency", "missionToken"].forEach((type) => {
        const reward = rewardConstraints[type];
        if (!reward?.isRange) return;

        ratios.push(getRewardRatioFromAmount(reward, override[type]));
      });
    });

    if (!ratios.length) return 100;

    return Math.round(
      (ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length) * 100,
    );
  }, [
    mission,
    rewardConstraints,
    rewardDefaults,
    rewardOverrideMap,
    selectedSubmissionRows,
    showRewardOverrides,
  ]);

  const applySelectedRewardRatio = useCallback(
    (ratio) => {
      if (!showRewardOverrides || selectedSubmissionRows.length === 0) return;

      setRewardOverrideMap((prev) => {
        const next = { ...prev };

        selectedSubmissionRows.forEach((row) => {
          next[row.uid] = sanitizeRewardOverride(mission, {
            credit: getRewardAmountFromRatio(rewardConstraints.credit, ratio),
            currency: getRewardAmountFromRatio(
              rewardConstraints.currency,
              ratio,
            ),
            missionToken: getRewardAmountFromRatio(
              rewardConstraints.missionToken,
              ratio,
            ),
          });
        });

        return next;
      });
    },
    [mission, rewardConstraints, selectedSubmissionRows, showRewardOverrides],
  );

  const allChecked = useMemo(() => {
    if (!submittedRows.length) return false;
    const selectableIds = submittedRows
      .filter((row) => canSelectSubmission(row))
      .map((row) => row.submission.id);

    return selectableIds.length > 0 && subSelected.size === selectableIds.length;
  }, [canSelectSubmission, subSelected.size, submittedRows]);

  const someChecked =
    subSelected.size > 0 && subSelected.size < selectableCount;

  const actionLabel =
    mode === "approve"
      ? `선택 ${subSelected.size}건 승인`
      : `선택 ${subSelected.size}건 승인 취소`;
  const actionDisabled = submitting || subSelected.size === 0;
  const columnCount = showRewardOverrides ? 6 : 5;
  const selectedCount = subSelected.size;
  const approveActionLabel = `선택 승인 ${selectedCount}건`;
  const rejectActionLabel = `선택 반려 ${selectedCount}건`;
  const cancelActionLabel = `선택 취소 ${selectedCount}건`;
  const floatingTitle =
    mode === "approve" ? `선택 검토 ${selectedCount}건` : cancelActionLabel;

  return (
    <>
      <div className="border-b bg-slate-50 px-6 pb-3 pt-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              전체: <strong className="text-slate-900">{stats.total}명</strong>
            </span>
            <span>
              승인 대기{" "}
              <strong className="text-blue-600">{stats.pending}명</strong>
            </span>
            <span>
              승인 완료{" "}
              <strong className="text-green-600">{stats.approved}명</strong>
            </span>
            <span>
              미제출{" "}
              <strong className="text-slate-500">{stats.unsubmitted}명</strong>
            </span>
            <span className="ml-2 text-[11px] font-bold text-slate-400">
              마우스를 누른 채 드래그해 여러 제출을 선택할 수 있습니다.
            </span>
          </div>

          <div className="text-xs text-slate-500">
            {mode === "approve" ? "승인 가능 제출" : "취소 가능 제출"}
            <span className="ml-1 font-semibold text-slate-700">
              {selectableCount}건
            </span>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 pb-28">
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="w-12 p-3 text-center">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(element) => {
                      if (element) {
                        element.indeterminate = someChecked;
                      }
                    }}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="p-3 text-left font-medium text-slate-700">
                  학생
                </th>
                <th className="p-3 text-left font-medium text-slate-700">
                  상태
                </th>
                <th className="p-3 text-left font-medium text-slate-700">
                  제출 시간
                </th>
                {showRewardOverrides ? (
                  <th className="p-3 text-left font-medium text-slate-700">
                    최종 보상
                  </th>
                ) : null}
                <th className="p-3 text-center font-medium text-slate-700">
                  상세
                </th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columnCount}
                    className="p-8 text-center text-slate-500"
                  >
                    대상 학생이 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isChecked = row.submission
                    ? subSelected.has(row.submission.id)
                    : false;
                  const selectable = canSelectSubmission(row);

                  return (
                    <tr
                      key={row.uid}
                      onMouseDown={(event) => {
                        if (isInteractiveTarget(event)) return;
                        startDrag(row);
                      }}
                      onMouseEnter={() => enterDrag(row)}
                      className={`transition-colors ${
                        isChecked
                          ? "bg-blue-50 ring-1 ring-blue-200"
                          : "hover:bg-slate-50"
                      } ${row.submission ? "" : "opacity-70"}`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            selectable &&
                            row.submission &&
                            toggleOne(row.submission.id)
                          }
                          onMouseDown={(event) => event.stopPropagation()}
                          disabled={!selectable}
                          className="rounded"
                        />
                      </td>

                      <td className="p-3">
                        <div className="font-medium text-slate-900">
                          {row.name}
                        </div>
                      </td>

                      <td className="p-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                            MISSION_STATUS_STYLES[row.status] ||
                            MISSION_STATUS_STYLES.none
                          }`}
                        >
                          {MISSION_STATUS_LABELS[row.status] || row.status}
                        </span>
                      </td>

                      <td className="p-3 text-slate-600">
                        {row.submittedAt?.toDate
                          ? dayjs(row.submittedAt.toDate()).format(
                              "YYYY.MM.DD HH:mm",
                            )
                          : "-"}
                      </td>

                      {showRewardOverrides ? (
                        <td className="p-3">
                          {row.submission ? (
                            <RewardOverrideFields
                              mission={mission}
                              value={rewardOverrideMap[row.uid]}
                              onChange={(value) =>
                                setRewardOverrideMap((prev) => ({
                                  ...prev,
                                  [row.uid]: sanitizeRewardOverride(mission, value),
                                }))
                              }
                              disabled={!selectable || submitting}
                              compact
                            />
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                      ) : null}

                      <td className="p-3 text-center">
                        {row.submission ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              data-no-drag
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setReviewSubmission(null);
                                setIsReviewLoading(false);
                                setReviewTarget(row);
                              }}
                            >
                            상세보기
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hidden sticky bottom-0 z-10 flex items-center justify-between border-t bg-white/95 px-6 py-3 backdrop-blur">
        <div className="text-sm text-slate-500">
          제출: <span className="font-semibold">{submittedRows.length}건</span> / 선택:{" "}
          <span className="font-semibold text-blue-600">{subSelected.size}건</span>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            닫기
          </Button>

          {mode === "approve" ? (
            <Button
              variant={subSelected.size ? "primary" : "ghost"}
              disabled={actionDisabled}
              onClick={handleApproveSubmissions}
            >
              {submitting ? "처리 중..." : actionLabel}
            </Button>
          ) : (
            <Button
              variant={subSelected.size ? "danger" : "ghost"}
              disabled={actionDisabled}
              onClick={handleRevokeSubmissions}
            >
              {submitting ? "처리 중..." : actionLabel}
            </Button>
          )}
        </div>
      </div>

      {subSelected.size > 0 ? (
        <BulkActionFloatingBar
          count={subSelected.size}
          eyebrow={mode === "approve" ? "승인 대기 선택" : "승인 취소 선택"}
          title={floatingTitle}
          subtitle={`제출 ${submittedRows.length}건 · 처리 가능 ${selectableCount}건`}
          tone={mode === "approve" ? "indigo" : "rose"}
          actions={[
            {
              key: "toggle-all",
              label: allChecked ? "전체 해제" : "전체 선택",
              onClick: toggleAll,
              disabled: submitting,
              kind: "outline",
              tone: "slate",
            },
            ...(mode === "approve"
              ? [
                  {
                    key: "approve",
                    label: approveActionLabel,
                    onClick: handleApproveSubmissions,
                    disabled: actionDisabled,
                    tone: "indigo",
                  },
                  {
                    key: "reject",
                    label: rejectActionLabel,
                    onClick: handleRejectSubmissions,
                    disabled: actionDisabled,
                    tone: "rose",
                  },
                ]
              : [
                  {
                    key: "cancel",
                    label: cancelActionLabel,
                    onClick: handleRevokeSubmissions,
                    disabled: actionDisabled,
                    tone: "rose",
                  },
                ]),
          ]}
          onClear={() => setSubSelected(new Set())}
          clearLabel="선택 해제"
        >
          {showRewardOverrides ? (
            <div className="min-w-[220px] rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-500">
                  전체 보상 조절
                </span>
                <div className="flex items-center gap-2">
                  {[
                    { key: "min", label: "최소", ratio: 0 },
                    { key: "mid", label: "중간", ratio: 0.5 },
                    { key: "max", label: "최대", ratio: 1 },
                  ].map((option) => (
                    <Button tone="slate" kind="ghost" size="xs"
                      key={option.key}
                      type="button"
                      disabled={submitting}
                      onClick={() => applySelectedRewardRatio(option.ratio)}
                      className="transition disabled:cursor-not-allowed"
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <input
                type="range"
                min="0"
                max="100"
                step="1"
                disabled={submitting}
                value={selectedRewardRatio}
                onChange={(event) =>
                  applySelectedRewardRatio(Number(event.target.value) / 100)
                }
                className="mt-1.5 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          ) : null}
        </BulkActionFloatingBar>
      ) : null}

      {reviewTarget ? (
        <SubmissionReviewModal
          submission={reviewSubmission || reviewTarget.submission}
          loading={isReviewLoading}
          mission={mission}
          classId={missionClassId}
          currencyUnit={currencyUnit}
          onClose={() => {
            setReviewTarget(null);
            setReviewSubmission(null);
            setIsReviewLoading(false);
          }}
          rewardOverride={rewardOverrideMap[reviewTarget.uid]}
          onRewardOverrideChange={(value) =>
            setRewardOverrideMap((prev) => ({
              ...prev,
              [reviewTarget.uid]: sanitizeRewardOverride(mission, value),
            }))
          }
          onApprove={async (submissionId, feedback, rewardOverride) => {
            const targetUid = reviewTarget.uid;
            if (!targetUid) return;

            await approveMissionBatch(missionClassId, mission.id, [
              {
                uid: targetUid,
                submissionId,
                feedback,
                rewardOverride: showRewardOverrides
                  ? sanitizeRewardOverride(mission, rewardOverride)
                  : null,
              },
            ]);
          }}
          onRevoke={async (studentUid) => {
            await cancelMissionApprovalBatch(missionClassId, mission.id, [
              studentUid,
            ]);
          }}
          onReject={async (submissionId, reason) => {
            await rejectSubmission(missionClassId, mission.id, submissionId, {
              reason,
            });
          }}
          onSaveFeedback={async (submissionId, feedback) => {
            await saveSubmissionFeedback(
              missionClassId,
              mission.id,
              submissionId,
              feedback,
            );
            const nextSubmission = {
              ...(reviewSubmission || reviewTarget.submission || {}),
              id: submissionId,
              feedback,
            };
            const cacheKey = buildSubmissionCacheKey({
              classId: missionClassId,
              missionId: mission.id,
              submissionId,
            });
            submissionDetailCache.set(cacheKey, nextSubmission);
            setReviewSubmission(nextSubmission);
          }}
        />
      ) : null}
    </>
  );
};

export default SubmissionFormView;
