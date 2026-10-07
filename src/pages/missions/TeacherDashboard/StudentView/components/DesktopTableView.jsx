import { confirmMissionAction } from "../../../components/MissionActionDialog";
// src/pages/missions/components/TeacherDashboard/StudentView/DesktopTableView.jsx
import "../../teacherMissionViews.css";
import React, { useCallback, memo, useMemo, useState, useEffect } from "react";
import StatusIcon from "./StatusIcon";
import Legend from "./Legend";
import { isMissionAssignedToStudent } from "../../../utils/missionEligibility";
import { Button } from "../../../../../components/ui";

// 일반(단일) 미션에서만 아이콘 클릭 허용
const isClickableStatus = (s) =>
  s === "pending" || s === "late" || s === "approved" || s === "late-approved";
const SELECTABLE_STATUSES = new Set(["pending", "late", "approved", "late-approved"]);
const PENDING_STATUSES = new Set(["pending", "late"]);
const APPROVED_STATUSES = new Set(["approved", "late-approved"]);

const chunk = (arr, size = 50) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

const INDEX_COL_WIDTH = 52;
const STUDENT_COL_WIDTH = 104;
const MISSION_COL_WIDTH = 150;
const MISSION_TITLE_CLAMP_STYLE = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  whiteSpace: "normal",
  lineHeight: "1.1rem",
  minHeight: "2.2rem",
};

const DesktopTableView = ({
  studentMatrix = [],
  missions = [],
  onMissionAction, // (action, missionId, studentUid) => Promise
  isProcessing, // (missionId, key) => boolean
  onOpenDetailModal, // (mission) => void
  readOnly = false,
  bulkMode = false,
  onApproveMany, // (missionId, items[]) => Promise
  onCancelMany, // (missionId, uids[]) => Promise
  onRejectMany, // (missionId, { submissionIds?, studentUids?, options? }) => Promise
  isBusy = false,
  allowOpenDetail = true,
}) => {
  const displayMissions = useMemo(() => missions, [missions]);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragMode, setDragMode] = useState(null); // "select" | "deselect"
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const isBulkProcessing = bulkSubmitting || isBusy;

  const processingFor = useCallback(
    (missionId, studentUid) =>
      isProcessing?.(missionId, `approve-${studentUid}`) ||
      isProcessing?.(missionId, `cancel-approval-${studentUid}`) ||
      isProcessing?.(missionId, `reject-${studentUid}`),
    [isProcessing]
  );

  // 대상자 가드
  const isTargetedStudent = useCallback(
    (mission, student) => {
      if (!mission || !student?.uid) return false;
      if ((student.role ?? "student") === "teacher") {
        const targets = Array.isArray(mission?.targetStudentUids)
          ? mission.targetStudentUids
          : [];
        return targets.length === 0 || targets.includes(student.uid);
      }
      return isMissionAssignedToStudent(mission, student, student.uid);
    },
    [],
  );

  // ✅ 실제 액션 처리 (승인 / 취소 / 반려)
  const handleStatusActionSelect = useCallback(
    (action, mission, studentUid) => {
      if (!onMissionAction) return;
      if (!mission?.id || !studentUid) return;

      if (action === "approve") {
        onMissionAction("approve", mission.id, studentUid);
      } else if (action === "cancel") {
        onMissionAction("cancel-approval", mission.id, studentUid);
      } else if (action === "reject") {
        onMissionAction("reject", mission.id, studentUid);
      }
    },
    [onMissionAction]
  );

  const handleMissionTitleClick = useCallback(
    (e, mission) => {
      e.stopPropagation();
      if (!allowOpenDetail) return;
      onOpenDetailModal?.(mission);
    },
    [onOpenDetailModal, allowOpenDetail]
  );

  // selection helpers
  const toCellKey = (missionId, studentUid) => `${missionId}::${studentUid}`;
  const missionById = useMemo(
    () => new Map(displayMissions.map((m) => [m.id, m])),
    [displayMissions],
  );
  const statusByCell = useMemo(() => {
    const map = new Map();
    studentMatrix.forEach((student) => {
      (student.missionStatuses || []).forEach((ms) => {
        map.set(toCellKey(ms.missionId, student.uid), ms.status);
      });
    });
    return map;
  }, [studentMatrix]);

  // 모드 해제 시 선택 초기화
  useEffect(() => {
    if (!bulkMode) {
      setSelectedKeys(new Set());
    }
  }, [bulkMode]);

  // 데이터가 바뀌면 존재하는 셀만 선택 유지
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set();
      prev.forEach((key) => {
        const [missionId, studentUid] = key.split("::");
        if (missionById.has(missionId) && studentMatrix.some((s) => s.uid === studentUid)) {
          next.add(key);
        }
      });
      return next;
    });
  }, [missionById, studentMatrix]);

  const selectedCells = useMemo(() => {
    if (selectedKeys.size === 0) return [];
    const list = [];
    selectedKeys.forEach((key) => {
      const [missionId, studentUid] = key.split("::");
      const mission = missionById.get(missionId);
      if (!mission || !studentUid) return;

      const status = statusByCell.get(key) || "none";
      if (!SELECTABLE_STATUSES.has(status)) return;

      const submissionId =
        mission?.submissionsIndex?.[studentUid] ||
        mission?.completions?.[studentUid]?.submissionId ||
        null;

      list.push({
        key,
        missionId,
        studentUid,
        status,
        requireSubmissionForm: !!mission?.requireSubmissionForm,
        submissionId,
      });
    });
    return list;
  }, [selectedKeys, missionById, statusByCell]);

  const approveTargets = useMemo(
    () => selectedCells.filter((c) => PENDING_STATUSES.has(c.status)),
    [selectedCells],
  );
  const cancelTargets = useMemo(
    () => selectedCells.filter((c) => APPROVED_STATUSES.has(c.status)),
    [selectedCells],
  );
  const rejectTargets = useMemo(
    () =>
      selectedCells.filter((c) => {
        if (!PENDING_STATUSES.has(c.status)) return false;
        if (c.requireSubmissionForm) return !!c.submissionId;
        return true;
      }),
    [selectedCells],
  );

  const applyDrag = useCallback(
    (key, selectable, mode) => {
      if (!bulkMode || !selectable || !mode || isBulkProcessing) return;
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (mode === "select") next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [bulkMode, isBulkProcessing],
  );

  const startDrag = useCallback(
    (key, selectable) => {
      if (!bulkMode || !selectable || isBulkProcessing) return;
      setIsDragSelecting(true);
      const mode = selectedKeys.has(key) ? "deselect" : "select";
      setDragMode(mode);
      applyDrag(key, selectable, mode);
    },
    [bulkMode, isBulkProcessing, selectedKeys, applyDrag],
  );

  const enterDrag = useCallback(
    (key, selectable) => {
      if (!isDragSelecting || !dragMode) return;
      applyDrag(key, selectable, dragMode);
    },
    [isDragSelecting, dragMode, applyDrag],
  );

  useEffect(() => {
    const onMouseUp = () => {
      setIsDragSelecting(false);
      setDragMode(null);
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  const handleBulkApprove = useCallback(async () => {
    if (!onApproveMany || approveTargets.length === 0 || isBulkProcessing) return;
    if (!(await confirmMissionAction(`선택한 ${approveTargets.length}건을 승인할까요?`))) return;

    try {
      setBulkSubmitting(true);
      const byMission = new Map();
      approveTargets.forEach((target) => {
        if (!byMission.has(target.missionId)) byMission.set(target.missionId, []);
        byMission.get(target.missionId).push(target);
      });

      for (const [missionId, targets] of byMission.entries()) {
        const dedupMap = new Map();
        targets.forEach((t) => {
          dedupMap.set(t.studentUid, {
            uid: t.studentUid,
            submissionId: t.submissionId || null,
          });
        });
        const items = Array.from(dedupMap.values());
        const chunks = chunk(items, 50);
        for (const part of chunks) {
          await onApproveMany(missionId, part);
        }
      }
      setSelectedKeys(new Set());
    } catch (error) {
      console.error("[StudentView bulk approve] error:", error);
    } finally {
      setBulkSubmitting(false);
    }
  }, [onApproveMany, approveTargets, isBulkProcessing]);

  const handleBulkCancel = useCallback(async () => {
    if (!onCancelMany || cancelTargets.length === 0 || isBulkProcessing) return;
    if (!(await confirmMissionAction(`선택한 ${cancelTargets.length}건의 승인을 취소할까요?`))) return;

    try {
      setBulkSubmitting(true);
      const byMission = new Map();
      cancelTargets.forEach((target) => {
        if (!byMission.has(target.missionId)) byMission.set(target.missionId, []);
        byMission.get(target.missionId).push(target.studentUid);
      });

      for (const [missionId, uidsRaw] of byMission.entries()) {
        const uids = [...new Set(uidsRaw)];
        const chunks = chunk(uids, 50);
        for (const part of chunks) {
          await onCancelMany(missionId, part);
        }
      }
      setSelectedKeys(new Set());
    } catch (error) {
      console.error("[StudentView bulk cancel] error:", error);
    } finally {
      setBulkSubmitting(false);
    }
  }, [onCancelMany, cancelTargets, isBulkProcessing]);

  const handleBulkReject = useCallback(async () => {
    if (!onRejectMany || rejectTargets.length === 0 || isBulkProcessing) return;
    if (!(await confirmMissionAction(`선택한 ${rejectTargets.length}건을 반려할까요?`))) return;

    try {
      setBulkSubmitting(true);
      const byMission = new Map();
      rejectTargets.forEach((target) => {
        if (!byMission.has(target.missionId)) {
          byMission.set(target.missionId, {
            submissionIds: [],
            studentUids: [],
          });
        }
        const grouped = byMission.get(target.missionId);
        if (target.requireSubmissionForm) {
          if (target.submissionId) grouped.submissionIds.push(target.submissionId);
          return;
        }
        grouped.studentUids.push(target.studentUid);
      });

      for (const [missionId, payloadRaw] of byMission.entries()) {
        const submissionIds = [...new Set(payloadRaw.submissionIds)];
        const studentUids = [...new Set(payloadRaw.studentUids)];

        const subChunks = chunk(submissionIds, 50);
        const uidChunks = chunk(studentUids, 50);
        const maxLen = Math.max(subChunks.length, uidChunks.length);

        for (let i = 0; i < maxLen; i += 1) {
          const chunkSubmissionIds = subChunks[i] || [];
          const chunkStudentUids = uidChunks[i] || [];
          if (chunkSubmissionIds.length === 0 && chunkStudentUids.length === 0) continue;

          await onRejectMany(missionId, {
            submissionIds: chunkSubmissionIds,
            studentUids: chunkStudentUids,
            options: { revertTo: "rejected" },
          });
        }
      }
      setSelectedKeys(new Set());
    } catch (error) {
      console.error("[StudentView bulk reject] error:", error);
    } finally {
      setBulkSubmitting(false);
    }
  }, [onRejectMany, rejectTargets, isBulkProcessing]);

  // 안전한 숫자 변환
  const n = (v, d = 0) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  };

  return (
    <div className={`teacher-student-table not-prose bg-white overflow-hidden relative ${bulkMode ? "is-selecting" : ""}`}>
      <Legend />

      {bulkMode && (
        <div className="px-4 py-3 border-b border-blue-100 bg-rose-50/50 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-700">
            선택 <b>{selectedCells.length}</b>건 · 승인 가능 <b>{approveTargets.length}</b>건 ·
            취소 가능 <b>{cancelTargets.length}</b>건 · 반려 가능 <b>{rejectTargets.length}</b>건
            <span className="ml-2 text-xs text-slate-500">셀을 클릭/드래그해 선택하세요.</span>
          </div>

          <div className="flex items-center gap-2">
            <Button tone="emerald" kind="solid" size="xs"
              type="button"
              onClick={handleBulkApprove}
              disabled={approveTargets.length === 0 || isBulkProcessing}
              className="disabled:opacity-50 disabled:cursor-not-allowed"
            >
              선택 승인
            </Button>
            <Button tone="amber" kind="solid" size="xs"
              type="button"
              onClick={handleBulkCancel}
              disabled={cancelTargets.length === 0 || isBulkProcessing}
              className="disabled:opacity-50 disabled:cursor-not-allowed"
            >
              승인 취소
            </Button>
            <Button tone="rose" kind="solid" size="xs"
              type="button"
              onClick={handleBulkReject}
              disabled={rejectTargets.length === 0 || isBulkProcessing}
              className="disabled:opacity-50 disabled:cursor-not-allowed"
            >
              반려
            </Button>
            <Button tone="slate" kind="outline" size="xs"
              type="button"
              onClick={() => setSelectedKeys(new Set())}
              disabled={selectedKeys.size === 0 || isBulkProcessing}
              className="disabled:opacity-50 disabled:cursor-not-allowed"
            >
              선택 해제
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-blue-50/30">
        <table
          className="table-fixed min-w-max"
          style={{ borderCollapse: "collapse", borderSpacing: 0 }}
        >
          <colgroup>
            <col style={{ width: INDEX_COL_WIDTH }} />
            <col style={{ width: STUDENT_COL_WIDTH }} />
            {displayMissions.map((m) => (
              <col key={`col-${m.id}`} style={{ width: MISSION_COL_WIDTH }} />
            ))}
          </colgroup>

          <thead className="bg-gradient-to-r from-blue-50 to-blue-100/80">
            <tr>
              <th className="px-2 py-2 text-center text-sm font-semibold text-blue-900 sticky left-0 bg-gradient-to-r from-blue-50 to-blue-100/80 z-20 border-r border-blue-200">
                번호
              </th>
              <th
                className="px-3 py-2 text-center text-sm font-semibold text-blue-900 sticky left-0 bg-gradient-to-r from-blue-50 to-blue-100/80 z-20 border-r border-blue-200"
                style={{ left: `${INDEX_COL_WIDTH}px` }}
              >
                학생
              </th>

              {displayMissions.map((mission) => (
                <th
                  key={mission.id}
                  className="px-1.5 py-2 text-center text-sm font-semibold text-blue-800 align-top"
                >
                  {allowOpenDetail ? (
                    <Button
                      type="button"
                      onClick={(e) => handleMissionTitleClick(e, mission)}
                      className="w-full text-center hover:text-blue-600 transition-colors font-medium text-[13px]"
                      style={MISSION_TITLE_CLAMP_STYLE}
                      title={mission.title}
                      aria-label={`과제 상세: ${mission.title}`}
                    >
                      {mission.title}
                    </Button>
                  ) : (
                    <span
                      className="w-full inline-block text-center text-blue-700 cursor-default font-medium text-[13px]"
                      style={MISSION_TITLE_CLAMP_STYLE}
                      title={mission.title}
                      aria-label={`과제 제목(상세 비활성화): ${mission.title}`}
                    >
                      {mission.title}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-blue-100">
            {studentMatrix.map((student, index) => (
              <tr
                key={student.uid}
                className="hover:bg-blue-50/40 transition-colors"
              >
                <td className="px-2 py-2 text-center align-middle font-medium text-slate-600 sticky left-0 bg-white/95 backdrop-blur-sm z-10 border-r border-blue-100">
                  {student.studentNumber || index + 1}
                </td>
                <td
                  className="px-3 py-2 text-left align-middle font-medium text-slate-900 sticky bg-white/95 backdrop-blur-sm z-10 border-r border-blue-100"
                  style={{ left: `${INDEX_COL_WIDTH}px` }}
                >
                  <div className="font-semibold cursor-default text-slate-800">
                    {student.name}
                  </div>
                </td>

                {displayMissions.map((mission) => {
                  // 미션 대상자 아니면 공백 셀
                  if (!isTargetedStudent(mission, student)) {
                    return (
                      <td
                        key={`${student.uid}-${mission.id}`}
                        className="px-2 py-1.5 align-middle"
                        aria-hidden="true"
                      />
                    );
                  }

                  // 학생의 이 미션 상태 찾기
                  const ms =
                    student.missionStatuses?.find(
                      (x) => x.missionId === mission.id
                    ) || null;

                  // 데이터 없으면 대시
                  if (!ms) {
                    return (
                      <td
                        key={`${student.uid}-${mission.id}`}
                        className="px-2 py-1.5 align-middle"
                      >
                        <div className="flex justify-center items-center h-8">
                          <span className="text-slate-300">-</span>
                        </div>
                      </td>
                    );
                  }

                  const status = ms.status; // 'unsubmitted' | 'pending' | 'late' | 'approved' | 'late-approved' | 'rejected' ...
                  const processing = processingFor(mission.id, student.uid);
                  const isAlwaysMission = mission?.type === "always";

                  // 챌린지 판별
                  const isChallenge =
                    mission?.type === "challenge" &&
                    n(mission?.goalCount, 0) > 0;

                  // 승인 누적 수
                  const approvedCount =
                    n(ms?.approvedCount, NaN) ||
                    n(mission?.completions?.[student.uid]?.progressCount, 0);

                  // 목표
                  const goalCount = n(mission?.goalCount, 0);

                  // 승인 대기 프로그레스 존재 여부
                  const hasPendingProgress =
                    !!ms?.hasPendingProgress ||
                    n(ms?.pendingProgressCount, 0) > 0;

                  const clickable =
                    !readOnly &&
                    !bulkMode &&
                    !isChallenge &&
                    !isAlwaysMission &&
                    isClickableStatus(status) &&
                    !processing;
                  const canSelectCell =
                    bulkMode &&
                    !isChallenge &&
                    !isAlwaysMission &&
                    SELECTABLE_STATUSES.has(status) &&
                    !processing;
                  const cellKey = toCellKey(mission.id, student.uid);
                  const isCellSelected = selectedKeys.has(cellKey);

                  return (
                    <td
                      key={`${student.uid}-${mission.id}`}
                      className={`px-2 py-1.5 align-middle transition-colors ${
                        isCellSelected ? "bg-rose-100/80 ring-1 ring-rose-300" : ""
                      } ${canSelectCell ? "cursor-pointer hover:bg-rose-50/70" : ""}`}
                      onMouseDown={() => startDrag(cellKey, canSelectCell)}
                      onMouseEnter={() => enterDrag(cellKey, canSelectCell)}
                    >
                      <div className="flex justify-center items-center h-8">
                        <StatusIcon
                          status={
                            isChallenge && hasPendingProgress
                              ? "progress-pending"
                              : status
                          }
                          isClickable={clickable}
                          processing={processing}
                          onWrapperClick={() => {
                            if (!bulkMode && allowOpenDetail) onOpenDetailModal?.(mission);
                          }}
                          // ✅ 여기서 승인/반려/취소 선택 결과를 받는다
                          onSelectAction={(action) =>
                            handleStatusActionSelect(
                              action,
                              mission,
                              student.uid
                            )
                          }
                          size="md"
                          // 챌린지 전용
                          isChallenge={isChallenge}
                          approvedCount={
                            isChallenge ? approvedCount : undefined
                          }
                          goalCount={isChallenge ? goalCount : undefined}
                          hasPendingProgress={
                            isChallenge ? hasPendingProgress : false
                          }
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default memo(DesktopTableView);
