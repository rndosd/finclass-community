import React, { useEffect, useMemo, useState } from "react";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import { Button, Modal } from "../../../../components/ui";
import { useUser } from "../../../../contexts/UserContext";
import useResolvedMissionDoc from "../../hooks/useResolvedMissionDoc";
import { getRewardLabel, getRewardToneClasses, getRewardVisual } from "../../constants/rewardVisuals";
import { getMissionMinTierRequirement } from "../../utils/missionEligibility";
import { getRewardDisplayText, normalizeRewardList } from "../../utils/rewardUtils";
import MissionAlwaysTeacherModal from "./MissionAlwaysTeacherModal";
import ApprovalModeToggle from "./components/ApprovalModeToggle";
import CompletionFormView from "./components/CompletionFormView";
import SubmissionFormView from "./components/SubmissionFormView";
import MissionApprovalSection from "./components/MissionApprovalSection";
import { getMissionReadProvider } from "../../services/missionReadService";
const missionUsesSubmission = mission => mission?.type === "challenge" || !!mission?.requireSubmissionForm;
const MissionDetailModal = ({
  isOpen,
  onClose,
  mission,
  studentMatrix = [],
  onApproveMany,
  onCancelMany,
  onRejectMany,
  onSaveFeedbackMany,
  onEditMission
}) => {
  const [mode, setMode] = useState("approve");
  const [detailView, setDetailView] = useState("pending");
  const {
    classData,
    classId: classIdFromUser,
    missionTokenLabel
  } = useUser();
  const {
    mission: resolvedMission,
    rawMission,
    loading: missionLoading,
    requiresResolution,
    error: missionError
  } = useResolvedMissionDoc({
    mission,
    enabled: isOpen
  });
  const displayMission = resolvedMission || mission;
  const isAlwaysMission = displayMission?.type === "always";
  const usesSubmission = missionUsesSubmission(displayMission);
  const classId = displayMission?.classId || displayMission?.classID || classIdFromUser;
  const currencyUnit = classData?.currencyUnit || "코인";
  const detailReady = !missionLoading && !missionError && (!requiresResolution || !!rawMission);
  const usesInbox = true && !displayMission?.autoApprove;
  useEffect(() => {
    if (!isOpen) return;
    setMode("approve");
    setDetailView("pending");
  }, [isOpen, displayMission?.id]);
  const title = useMemo(() => displayMission?.title || "과제 상세", [displayMission?.title]);
  const rewardSummary = useMemo(() => normalizeRewardList(displayMission?.rewards || []), [displayMission?.rewards]);
  const minTier = useMemo(() => getMissionMinTierRequirement(displayMission), [displayMission]);
  const missionDescription = useMemo(() => {
    const raw = typeof displayMission?.description === "string" ? displayMission.description.trim() : "";
    return raw || "과제 설명이 없습니다.";
  }, [displayMission?.description]);
  const scheduleInfo = useMemo(() => {
    const formatDateTime = value => {
      if (!value) return null;
      const parsed = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return dayjs(parsed).format("YYYY.MM.DD HH:mm");
    };
    const start = formatDateTime(displayMission?.timeWindow?.start ?? displayMission?.startDate);
    const end = formatDateTime(displayMission?.timeWindow?.end ?? displayMission?.endDate);
    return {
      startLabel: start || "시작 시간 없음",
      endLabel: end || "마감 시간 없음"
    };
  }, [displayMission?.timeWindow?.start, displayMission?.timeWindow?.end, displayMission?.startDate, displayMission?.endDate]);
  const handleEditMission = () => {
    onClose?.();
    onEditMission?.(displayMission);
  };
  if (!isOpen || !displayMission) return null;
  if (isAlwaysMission) {
    return <MissionAlwaysTeacherModal isOpen={isOpen} onClose={onClose} mission={displayMission} classId={classId} studentMatrix={studentMatrix} />;
  }
  return <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <Modal.Header>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h2 className="truncate text-lg font-bold text-slate-900">{title}</h2>

            {typeof onEditMission === "function" && <Button size="sm" variant="secondary" onClick={handleEditMission} className="shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <PencilSquareIcon className="h-4 w-4" />
                  과제 정보 수정
                </span>
              </Button>}

            {minTier && <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                적용 등급 {minTier.name} 이상
              </span>}
          </div>

          <details><summary className="cursor-pointer text-sm text-slate-500">과제 설명 보기</summary>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{missionDescription}</p>
          </details>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-500">시작 시간</p>
              <p className="mt-0.5 text-sm font-bold text-slate-800">
                {scheduleInfo.startLabel}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-500">마감 시간</p>
              <p className="mt-0.5 text-sm font-bold text-slate-800">
                {scheduleInfo.endLabel}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {rewardSummary.length > 0 ? rewardSummary.map((reward, index) => {
            const visual = getRewardVisual(reward.type);
            const VisualIcon = visual.icon;
            const rewardLabel = getRewardLabel(reward.type, currencyUnit, missionTokenLabel);
            return <span key={`${reward.type}-${index}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${getRewardToneClasses(visual.tone)}`}>
                    <VisualIcon size={12} strokeWidth={2.5} />
                    <span>
                      {rewardLabel} +
                      {getRewardDisplayText(reward, currencyUnit, missionTokenLabel)}
                    </span>
                  </span>;
          }) : <span className="text-xs text-slate-500">보상 없음</span>}
          </div>
        </div>
      </Modal.Header>

      <div className="border-b bg-slate-50/60 px-6 pb-4 pt-3">
        {usesInbox && <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" tone={detailView === "pending" ? "blue" : "slate"} kind={detailView === "pending" ? "solid" : "outline"} onClick={() => setDetailView("pending")}>승인 대기</Button>
          <Button size="sm" tone={detailView === "records" ? "blue" : "slate"} kind={detailView === "records" ? "solid" : "outline"} onClick={() => setDetailView("records")}>전체 현황·기록</Button>
        </div>}
        {(!usesInbox || detailView === "records") && <ApprovalModeToggle mode={mode} onChange={setMode} />}
      </div>

      {!detailReady ? <div className="px-6 py-12 text-center text-sm text-slate-500">
          {missionError ? "과제 상태를 불러오지 못했습니다. 닫았다가 다시 열어주세요." : missionLoading ? "상세 과제 문서를 불러오는 중입니다." : "상세 과제 문서를 찾을 수 없습니다."}
        </div> : usesInbox && detailView === "pending" ? <Modal.Body><MissionApprovalSection mission={displayMission} classId={classId} students={studentMatrix} approveMany={onApproveMany} rejectMany={onRejectMany} /></Modal.Body> : usesSubmission ? <SubmissionFormView mission={displayMission} studentMatrix={studentMatrix} mode={mode} onClose={onClose} /> : <CompletionFormView mission={displayMission} studentMatrix={studentMatrix} mode={mode} onApproveMany={onApproveMany} onCancelMany={onCancelMany} onRejectMany={onRejectMany} onSaveFeedbackMany={onSaveFeedbackMany} onClose={onClose} />}
    </Modal>;
};
export default MissionDetailModal;
