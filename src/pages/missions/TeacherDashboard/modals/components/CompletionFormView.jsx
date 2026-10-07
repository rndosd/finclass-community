import { confirmMissionAction } from "../../../components/MissionActionDialog";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BulkActionFloatingBar, Button } from "../../../../../components/ui";
import {
  MISSION_STATUS_LABELS,
  MISSION_STATUS_STYLES,
} from "../../../constants/missionStatusConstants";
import RewardOverrideFields from "./RewardOverrideFields";
import { isMissionAssignedToStudent } from "../../../utils/missionEligibility";
import {
  getRewardAmountFromRatio,
  getRewardApprovalDefaults,
  getRewardConstraints,
  getRewardRatioFromAmount,
  hasRewardRange,
  sanitizeRewardOverride,
} from "../../../utils/rewardUtils";

const getRowTargeted = (mission, student) => {
  if ((student?.role ?? "student") === "teacher") {
    const targets = Array.isArray(mission?.targetStudentUids)
      ? mission.targetStudentUids
      : [];
    return targets.length === 0 || targets.includes(student?.uid);
  }

  return isMissionAssignedToStudent(mission, student, student?.uid);
};

const CompletionFormView = ({
  mission,
  studentMatrix,
  mode,
  onApproveMany,
  onCancelMany,
  onRejectMany,
  onSaveFeedbackMany,
  onClose,
}) => {
  const [selected, setSelected] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState({});
  const [initialFeedbackMap, setInitialFeedbackMap] = useState({});
  const [rewardOverrideMap, setRewardOverrideMap] = useState({});
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragMode, setDragMode] = useState(null);
  const initialSetRef = useRef(false);

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

    const completions = mission?.completions || {};

    return studentMatrix
      .map((student) => {
        const completion = completions[student.uid] || {};
        const missionStatus = student.missionStatuses?.find(
          (item) => item.missionId === mission.id,
        );
        const isTargeted = getRowTargeted(mission, student);
        let status = completion?.status || missionStatus?.status || "none";

        if (status === "approved" && completion?.late === true) {
          status = "late-approved";
        }

        return {
          uid: student.uid,
          name:
            student.role === "teacher"
              ? `${student.name || "교사"} (교사)`
              : student.name,
          role: student.role ?? "student",
          studentNumber: student.studentNumber ?? 9999,
          status,
          feedback: completion?.feedback ?? "",
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
      unsubmitted: targetedRows.filter((row) =>
        ["unsubmitted", "none", "not_submitted"].includes(row.status),
      ).length,
    };
  }, [rows]);

  const candidates = useMemo(() => {
    if (mode === "approve") {
      return rows.filter(
        (row) =>
          row.isTargeted &&
          (row.status === "pending" || row.status === "late"),
      );
    }

    return rows.filter(
      (row) =>
        row.isTargeted &&
        (row.status === "approved" || row.status === "late-approved"),
    );
  }, [mode, rows]);

  const candidateUidSet = useMemo(
    () => new Set(candidates.map((candidate) => candidate.uid)),
    [candidates],
  );

  const dirtyFeedbacks = useMemo(() => {
    const dirtyItems = [];

    rows.forEach((row) => {
      const current = feedbackMap[row.uid] ?? "";
      const initial = initialFeedbackMap[row.uid] ?? "";
      if (current !== initial) {
        dirtyItems.push({
          uid: row.uid,
          name: row.name,
          feedback: current,
        });
      }
    });

    return dirtyItems;
  }, [feedbackMap, initialFeedbackMap, rows]);

  useEffect(() => {
    if (!mission?.id) return;

    initialSetRef.current = false;
    setSelected(new Set());
    setFeedbackMap({});
    setInitialFeedbackMap({});
    setRewardOverrideMap({});
  }, [mission?.id]);

  useEffect(() => {
    if (!mission?.id || initialSetRef.current) return;

    const nextFeedbackMap = {};
    const nextRewardOverrideMap = {};

    rows.forEach((row) => {
      nextFeedbackMap[row.uid] = row.feedback ?? "";
      nextRewardOverrideMap[row.uid] = sanitizeRewardOverride(
        mission,
        rewardDefaults,
      );
    });

    setFeedbackMap(nextFeedbackMap);
    setInitialFeedbackMap(nextFeedbackMap);
    setRewardOverrideMap(nextRewardOverrideMap);
    initialSetRef.current = true;
  }, [mission, mission?.id, rewardDefaults, rows]);

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
    setSelected((prev) => {
      if (prev.size === 0) return prev;

      const next = new Set();
      prev.forEach((uid) => {
        if (candidateUidSet.has(uid)) {
          next.add(uid);
        }
      });
      return next;
    });
  }, [candidateUidSet]);

  const toggleOne = useCallback(
    (uid) => {
      if (!candidateUidSet.has(uid)) return;

      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(uid)) {
          next.delete(uid);
        } else {
          next.add(uid);
        }
        return next;
      });
    },
    [candidateUidSet],
  );

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allCandidateUids = candidates.map((candidate) => candidate.uid);
      if (prev.size === candidates.length) {
        return new Set();
      }
      return new Set(allCandidateUids);
    });
  }, [candidates]);

  const setFeedback = useCallback((uid, value) => {
    setFeedbackMap((prev) => ({ ...prev, [uid]: value }));
  }, []);

  const setRewardOverride = useCallback(
    (uid, value) => {
      setRewardOverrideMap((prev) => ({
        ...prev,
        [uid]: sanitizeRewardOverride(mission, value),
      }));
    },
    [mission],
  );

  const applyDrag = useCallback(
    (uid, nextMode) => {
      if (!candidateUidSet.has(uid)) return;

      setSelected((prev) => {
        const next = new Set(prev);
        if (nextMode === "select") {
          next.add(uid);
        } else {
          next.delete(uid);
        }
        return next;
      });
    },
    [candidateUidSet],
  );

  const startDrag = useCallback(
    (uid) => {
      if (!candidateUidSet.has(uid)) return;

      setIsDragSelecting(true);
      const nextMode = selected.has(uid) ? "deselect" : "select";
      setDragMode(nextMode);
      applyDrag(uid, nextMode);
    },
    [applyDrag, candidateUidSet, selected],
  );

  const isInteractiveTarget = useCallback((event) => {
    const target = event?.target;
    if (!target || typeof target.closest !== "function") return false;

    return Boolean(
      target.closest("input, button, textarea, select, a, label, [data-no-drag]"),
    );
  }, []);

  const enterDrag = useCallback(
    (uid) => {
      if (!isDragSelecting || !dragMode) return;
      applyDrag(uid, dragMode);
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

  const handleConfirm = useCallback(async () => {
    if (!selected.size) return;

    try {
      setSubmitting(true);

      if (mode === "approve") {
        if (!onApproveMany) return;

        const items = [...selected].map((uid) => {
          const rawFeedback = feedbackMap[uid];
          const feedback =
            rawFeedback === undefined
              ? undefined
              : rawFeedback.trim() === ""
                ? ""
                : rawFeedback.trim();

          return {
            uid,
            feedback,
            rewardOverride: showRewardOverrides
              ? sanitizeRewardOverride(mission, rewardOverrideMap[uid])
              : null,
          };
        });

        await onApproveMany(mission.id, items);
      } else {
        if (!onCancelMany) return;
        await onCancelMany(mission.id, [...selected]);
      }

      setSelected(new Set());
    } catch (error) {
      console.error("Failed to process mission completions:", error);
    } finally {
      setSubmitting(false);
    }
  }, [
    feedbackMap,
    mission,
    mode,
    onApproveMany,
    onCancelMany,
    rewardOverrideMap,
    selected,
    showRewardOverrides,
  ]);

  const handleReject = useCallback(async () => {
    if (mode !== "approve" || !onRejectMany || selected.size === 0) return;
    if (
      !(await confirmMissionAction(
        `\uC120\uD0DD\uD55C ${selected.size}\uBA85\uC744 \uBC18\uB824\uD560\uAE4C\uC694?`,
      ))
    ) {
      return;
    }

    try {
      setSubmitting(true);
      await onRejectMany(mission.id, {
        studentUids: [...selected],
        options: { revertTo: "rejected" },
      });
      setSelected(new Set());
    } catch (error) {
      console.error("Failed to reject mission completions:", error);
    } finally {
      setSubmitting(false);
    }
  }, [mission?.id, mode, onRejectMany, selected]);

  const handleSaveOneFeedback = useCallback(
    async (uid) => {
      if (!onSaveFeedbackMany || !mission?.id) return;

      const text = feedbackMap[uid] ?? "";

      try {
        await onSaveFeedbackMany(mission.id, [{ uid, feedback: text }]);
        setInitialFeedbackMap((prev) => ({ ...prev, [uid]: text }));
      } catch (error) {
        console.error("Failed to save mission feedback:", error);
      }
    },
    [feedbackMap, mission?.id, onSaveFeedbackMany],
  );

  const handleSaveAllFeedback = useCallback(async () => {
    if (!onSaveFeedbackMany || !mission?.id || dirtyFeedbacks.length === 0) {
      return;
    }

    try {
      setSavingFeedback(true);
      await onSaveFeedbackMany(
        mission.id,
        dirtyFeedbacks.map(({ uid, feedback }) => ({ uid, feedback })),
      );

      setInitialFeedbackMap((prev) => {
        const next = { ...prev };
        dirtyFeedbacks.forEach(({ uid, feedback }) => {
          next[uid] = feedback;
        });
        return next;
      });
    } catch (error) {
      console.error("Failed to save all feedback:", error);
    } finally {
      setSavingFeedback(false);
    }
  }, [dirtyFeedbacks, mission?.id, onSaveFeedbackMany]);

  const selectedRewardRatio = useMemo(() => {
    if (!showRewardOverrides || selected.size === 0) return 100;

    const ratios = [];

    selected.forEach((uid) => {
      const override = sanitizeRewardOverride(
        mission,
        rewardOverrideMap[uid] ?? rewardDefaults,
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
    selected,
    showRewardOverrides,
  ]);

  const applySelectedRewardRatio = useCallback(
    (ratio) => {
      if (!showRewardOverrides || selected.size === 0) return;

      setRewardOverrideMap((prev) => {
        const next = { ...prev };

        selected.forEach((uid) => {
          next[uid] = sanitizeRewardOverride(mission, {
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
    [mission, rewardConstraints, selected, showRewardOverrides],
  );

  const allChecked =
    candidates.length > 0 && selected.size === candidates.length;
  const someChecked =
    selected.size > 0 && selected.size < candidates.length;
  const actionLabel =
    mode === "approve"
      ? `선택 ${selected.size}명 승인`
      : `선택 ${selected.size}명 승인 취소`;
  const columnCount = showRewardOverrides ? 6 : 5;

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
              마우스를 누른 채 드래그해 여러 학생을 선택할 수 있습니다.
            </span>
          </div>

          <div className="flex items-center gap-2">
            {dirtyFeedbacks.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={savingFeedback}
                onClick={handleSaveAllFeedback}
              >
                {savingFeedback
                  ? "저장 중..."
                  : `피드백 ${dirtyFeedbacks.length}건 저장`}
              </Button>
            ) : null}

            <div className="text-xs text-slate-500">
            현재 처리 가능 대상
            <span className="ml-1 font-semibold text-slate-700">
              {candidates.length}명
            </span>
            </div>
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
                    title="전체 선택 또는 해제"
                  />
                </th>
                <th className="p-3 text-left font-medium text-slate-700">
                  학생
                </th>
                <th className="p-3 text-left font-medium text-slate-700">
                  상태
                </th>
                {showRewardOverrides ? (
                  <th className="p-3 text-left font-medium text-slate-700">
                    최종 보상
                  </th>
                ) : null}
                <th className="p-3 text-left font-medium text-slate-700">
                  피드백
                </th>
                <th className="p-3 text-center font-medium text-slate-700">
                  저장
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
                    표시할 학생이 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isChecked = selected.has(row.uid);
                  const isCandidate = candidateUidSet.has(row.uid);
                  const isDirty =
                    (feedbackMap[row.uid] ?? "") !==
                    (initialFeedbackMap[row.uid] ?? "");

                  return (
                    <tr
                      key={row.uid}
                      onMouseDown={(event) => {
                        if (isInteractiveTarget(event)) return;
                        startDrag(row.uid);
                      }}
                      onMouseEnter={() => enterDrag(row.uid)}
                      className={`transition-colors ${
                        isChecked
                          ? "bg-blue-50 ring-1 ring-blue-200"
                          : "hover:bg-slate-50"
                      } ${!isCandidate ? "opacity-60" : ""}`}
                      title={
                        !isCandidate ? "현재 모드에서 처리 가능한 상태가 아닙니다." : ""
                      }
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleOne(row.uid)}
                          onMouseDown={(event) => event.stopPropagation()}
                          disabled={!isCandidate}
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

                      {showRewardOverrides ? (
                        <td className="p-3">
                          {row.isTargeted ? (
                            <RewardOverrideFields
                              mission={mission}
                              value={rewardOverrideMap[row.uid]}
                              onChange={(value) =>
                                setRewardOverride(row.uid, value)
                              }
                              disabled={!isCandidate || submitting || savingFeedback}
                              compact
                            />
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                      ) : null}

                      <td className="p-3">
                        <textarea
                          value={feedbackMap[row.uid] ?? ""}
                          onChange={(event) =>
                            setFeedback(row.uid, event.target.value)
                          }
                          onMouseDown={(event) => event.stopPropagation()}
                          placeholder="간단한 피드백을 입력하세요"
                          className="w-full resize-none rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          rows={1}
                        />
                      </td>

                      <td className="p-3 text-center">
                        <Button
                          size="sm"
                          variant={isDirty ? "primary" : "ghost"}
                          disabled={!isDirty || savingFeedback}
                          data-no-drag
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => handleSaveOneFeedback(row.uid)}
                        >
                          저장
                        </Button>
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
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <div>
            전체: <span className="font-semibold">{stats.total}명</span> / 선택:{" "}
            <span className="font-semibold text-blue-600">
              {selected.size}명
            </span>
          </div>

          {dirtyFeedbacks.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={savingFeedback}
              onClick={handleSaveAllFeedback}
            >
              {savingFeedback
                ? "저장 중..."
                : `피드백 ${dirtyFeedbacks.length}건 저장`}
            </Button>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={submitting || savingFeedback}
          >
            닫기
          </Button>
          {mode === "approve" ? (
            <Button
              variant={selected.size ? "danger" : "ghost"}
              disabled={selected.size === 0 || submitting || savingFeedback}
              onClick={handleReject}
            >
              {submitting
                ? "처리 중..." : `\uC120\uD0DD ${selected.size}\uBA85 \uBC18\uB824`}
            </Button>
          ) : null}
          <Button
            variant={
              selected.size
                ? mode === "approve"
                  ? "primary"
                  : "danger"
                : "ghost"
            }
            disabled={selected.size === 0 || submitting || savingFeedback}
            onClick={handleConfirm}
          >
            {submitting ? "처리 중..." : actionLabel}
          </Button>
        </div>
      </div>
      {selected.size > 0 ? (
        <BulkActionFloatingBar
          count={selected.size}
          eyebrow={mode === "approve" ? "승인 대상 선택" : "승인 취소 선택"}
          title={actionLabel}
          subtitle={`처리 가능 ${candidates.length}명${
            dirtyFeedbacks.length > 0
              ? ` · 피드백 변경 ${dirtyFeedbacks.length}건`
              : ""
          }`}
          tone={mode === "approve" ? "indigo" : "rose"}
          actions={[
            ...(dirtyFeedbacks.length > 0
              ? [
                  {
                    key: "save-feedback",
                    label: `피드백 ${dirtyFeedbacks.length}건 저장`,
                    onClick: handleSaveAllFeedback,
                    disabled: savingFeedback || submitting,
                    isLoading: savingFeedback,
                    kind: "outline",
                    tone: "slate",
                  },
                ]
              : []),
            {
              key: "toggle-all",
              label: allChecked ? "전체 해제" : "전체 선택",
              onClick: toggleAll,
              disabled: submitting || savingFeedback,
              kind: "outline",
              tone: "slate",
            },
            ...(mode === "approve"
              ? [
                  {
                    key: "reject",
                    label: `\uC120\uD0DD \uBC18\uB824 ${selected.size}\uBA85`,
                    onClick: handleReject,
                    disabled: submitting || savingFeedback,
                    isLoading: submitting,
                    tone: "rose",
                  },
                ]
              : []),
            {
              key: "confirm",
              label: actionLabel,
              onClick: handleConfirm,
              disabled: submitting || savingFeedback,
              isLoading: submitting,
              tone: mode === "approve" ? "indigo" : "rose",
            },
          ]}
          onClear={() => setSelected(new Set())}
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
                      disabled={submitting || savingFeedback}
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
                disabled={submitting || savingFeedback}
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
    </>
  );
};

export default CompletionFormView;
