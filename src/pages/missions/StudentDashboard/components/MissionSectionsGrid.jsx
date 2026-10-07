import React, { useMemo, useState } from "react";
import { LightningIcon as BoltIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { ChatCircleTextIcon as ChatBubbleLeftIcon } from "@phosphor-icons/react/dist/csr/ChatCircleText";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClipboardTextIcon as DocumentTextIcon } from "@phosphor-icons/react/dist/csr/ClipboardText";

import { useUser } from "../../../../contexts/UserContext";
import { Tabs } from "../../../../components/ui";
import {
  getMissionMinTierRequirement,
  meetsMissionTierRequirement,
} from "../../utils/missionEligibility";
import {
  getAlwaysMaxPerDay,
  getTodayCountFromMissionState,
  isAlwaysAvailableOnDay,
  isWithinAlwaysTimeRange,
} from "../../utils/alwaysMissionState";
import AlwaysAssignmentList from "./AlwaysAssignmentList";
import MissionSection from "./MissionSection";
import MissionAlwaysHistoryModal from "../modals/MissionAlwaysHistoryModal";
import MissionAlwaysStudentModal from "../modals/MissionAlwaysStudentModal";
import MissionSubmitModal from "../modals/MissionSubmitModal";
import SharedUiButton from "../../../../components/ui/Button";

const MissionSectionsGrid = ({
  filteredMissions,
  onSubmit,
  isSubmitting,
  classData,
  classId,
  readOnly = false,
  alwaysStateMap = {},
  onAlwaysRefresh,
}) => {
  const { userData } = useUser();
  const selfUid = readOnly ? null : userData?.uid;

  const [activeTab, setActiveTab] = useState("always");
  const [completedMonthOffset, setCompletedMonthOffset] = useState(0);
  const nowInKST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [currentYear, currentMonth] = nowInKST.split("-").map(Number);
  const selectedMonth = new Date(Date.UTC(currentYear, currentMonth - 1 + completedMonthOffset, 1));
  const monthKey = `${selectedMonth.getUTCFullYear()}-${String(selectedMonth.getUTCMonth() + 1).padStart(2, "0")}`;
  const [submitMission, setSubmitMission] = useState(null);
  const [alwaysMission, setAlwaysMission] = useState(null);
  const [historyMission, setHistoryMission] = useState(null);
  const [feedbackModal, setFeedbackModal] = useState(null);

  const isAlwaysMission = (mission) => {
    if (mission?.type === "always") return true;
    if (mission?.type) return false;

    const availability =
      mission?.availability && typeof mission.availability === "object"
        ? mission.availability
        : null;

    return !!availability && Object.keys(availability).length > 0;
  };

  const handleMissionClick = async (mission, options = {}) => {
    if (readOnly) return;

    const withClassId = {
      ...mission,
      classId: mission.classId || classId || classData?.id || null,
    };

    if (isAlwaysMission(mission)) {
      setAlwaysMission(withClassId);
      return;
    }

    if (options.mode === "view") {
      setSubmitMission({
        mission: withClassId,
        mode: "view",
        viewOnly: true,
      });
      return;
    }

    if (mission.requireSubmissionForm) {
      const selfCompletion = withClassId.completions?.[selfUid] || null;
      setSubmitMission({
        mission: withClassId,
        mode:
          options.mode ||
          (selfCompletion?.status === "rejected" ? "edit-submission" : "new"),
        viewOnly: false,
      });
      return;
    }

    await onSubmit(mission, "");
  };

  const sections = useMemo(() => {
    const always = filteredMissions.filter(isAlwaysMission);
    const getNormalSortRank = (mission) => {
      const completionStatus = mission.completions?.[selfUid]?.status;

      if (mission.displayStatus === "urgent") return 0;
      if (mission.displayStatus === "overdue") return 1;
      if (mission.displayStatus === "available") return 2;
      if (completionStatus === "rejected") return 3;
      if (completionStatus === "pending" || completionStatus === "late") {
        return 4;
      }
      return 5;
    };

    const normal = filteredMissions
      .filter((mission) => {
        if (isAlwaysMission(mission)) return false;
        const completion = mission.completions?.[selfUid];
        return (
          !completion ||
          ["rejected", "pending", "late"].includes(completion.status) ||
          !["approved", "late-approved"].includes(completion.status)
        );
      })
      .sort((left, right) => {
        const rankDiff = getNormalSortRank(left) - getNormalSortRank(right);
        if (rankDiff !== 0) return rankDiff;

        const leftEnd = left.timeWindow?.end?.toDate
          ? left.timeWindow.end.toDate()
          : new Date(left.timeWindow?.end || 8640000000000000);
        const rightEnd = right.timeWindow?.end?.toDate
          ? right.timeWindow.end.toDate()
          : new Date(right.timeWindow?.end || 8640000000000000);

        return leftEnd - rightEnd;
      });

    const completed = filteredMissions.filter((mission) => {
      if (isAlwaysMission(mission)) return false;
      const completion = mission.completions?.[selfUid];
      if (!["approved", "late-approved"].includes(completion?.status)) return false;
      const rawDate = completion.approvedAt || completion.completedAt || completion.submittedAt;
      const date = rawDate?.toDate ? rawDate.toDate() : new Date(rawDate);
      return !Number.isNaN(date.getTime()) && date.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).startsWith(monthKey);
    });

    const alwaysActionCount = readOnly
      ? 0
      : always.reduce((count, mission) => {
          const availability = mission?.availability || {};
          const isStudentVisible =
            typeof availability.studentVisible === "boolean"
              ? availability.studentVisible
              : typeof availability.availabilityStudentVisible === "boolean"
                ? availability.availabilityStudentVisible
                : true;
          if (!isStudentVisible) return count;

          const state = alwaysStateMap[mission.id] || {};
          const minTier = getMissionMinTierRequirement(mission);
          const hasTierAccess =
            !minTier || meetsMissionTierRequirement(mission, userData || {});
          const canDoNow =
            isAlwaysAvailableOnDay(availability) &&
            isWithinAlwaysTimeRange(availability) &&
            getTodayCountFromMissionState(state) < getAlwaysMaxPerDay(mission) &&
            hasTierAccess;

          return count + (canDoNow ? 1 : 0);
        }, 0);
    const normalActionCount = readOnly
      ? 0
      : normal.filter((mission) => mission.canSubmit === true).length;
    const nextSections = [
      {
        key: "normal",
        title: "\uC77C\uBC18\uACFC\uC81C",
        icon: DocumentTextIcon,
        missions: normal,
        actionableCount: normalActionCount,
      },
      {
        key: "always",
        title: "\uC0C1\uC2DC\uACFC\uC81C",
        icon: BoltIcon,
        missions: always,
        actionableCount: alwaysActionCount,
      },
      {
        key: "completed",
        title: "\uC644\uB8CC\uACFC\uC81C",
        icon: CheckCircleIcon,
        missions: completed,
        actionableCount: 0,
      },
    ];

    return readOnly
      ? nextSections.filter((section) => section.key !== "completed")
      : nextSections;
  }, [alwaysStateMap, filteredMissions, readOnly, selfUid, userData, monthKey]);

  return (
    <>
      <Tabs
        tabs={sections.map((section) => ({
          id: section.key,
          label: section.title,
          icon: section.icon,
          badge:
            section.actionableCount > 0 ? section.actionableCount : null,
        }))}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        variant="underline"
        size="md"
        idPrefix="student-mission-section"
        className="mb-5 max-w-full"
      />
      {activeTab === "completed" && (
        <div className="mb-4 flex items-center justify-end gap-3 text-sm text-slate-600">
          <span>{selectedMonth.getUTCFullYear()}년 {selectedMonth.getUTCMonth() + 1}월 완료 기록</span>
          <select aria-label="완료과제 기간 선택" value={completedMonthOffset} onChange={(event) => setCompletedMonthOffset(Number(event.target.value))} className="rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm">
            <option value={0}>이번 달</option>
            <option value={-1}>지난달</option>
          </select>
        </div>
      )}
      <div className="transition-all duration-300">
        {activeTab === "completed" && !sections.find((section) => section.key === "completed")?.missions.length && (
          <p className="py-12 text-center text-sm text-slate-500">선택한 달에 완료한 과제가 없습니다.</p>
        )}
        {activeTab === "always" ? (
          <AlwaysAssignmentList
            missions={sections.find((section) => section.key === "always").missions}
            classId={classId}
            readOnly={readOnly}
            onClickAssignment={handleMissionClick}
            onViewHistory={setHistoryMission}
            alwaysStateMap={alwaysStateMap}
            currencyUnit={classData?.currencyUnit || "\uCF54\uC778"}
          />
        ) : (
          <MissionSection
            section={sections.find((section) => section.key === activeTab)}
            selfUid={selfUid}
            readOnly={readOnly}
            classData={classData}
            onMissionClick={handleMissionClick}
            onFeedbackClick={(mission, feedback) =>
              setFeedbackModal({ mission, feedback })
            }
            onSubmit={onSubmit}
            isSubmitting={isSubmitting}
          />
        )}
      </div>

      {submitMission && (
        <MissionSubmitModal
          mission={submitMission.mission}
          mode={submitMission.mode}
          viewOnly={submitMission.viewOnly}
          onClose={() => setSubmitMission(null)}
          onSubmit={async (mission, content, options) => {
            await onSubmit(mission, content, options);
            setSubmitMission(null);
          }}
          isSubmitting={isSubmitting(submitMission.mission.id)}
        />
      )}

      {alwaysMission && (
        <MissionAlwaysStudentModal
          open
          mission={alwaysMission}
          missionState={alwaysStateMap[alwaysMission.id] || null}
          onClose={() => setAlwaysMission(null)}
          onSubmitted={onAlwaysRefresh}
          isSubmitting={isSubmitting(alwaysMission.id)}
        />
      )}

      {historyMission && (
        <MissionAlwaysHistoryModal
          open
          onClose={() => setHistoryMission(null)}
          mission={historyMission}
        />
      )}

      {feedbackModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setFeedbackModal(null)}
        >
          <div
            className="animate-in fade-in zoom-in duration-200 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-blue-600">
              <ChatBubbleLeftIcon className="h-5 w-5" />
              {"\uC120\uC0DD\uB2D8 \uD53C\uB4DC\uBC31"}
            </h3>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-relaxed whitespace-pre-wrap text-blue-900">
              {feedbackModal.feedback}
            </div>
            <SharedUiButton type="submit" tone="slate" kind="soft" size="md"
              onClick={() => setFeedbackModal(null)}
              className="mt-6 w-full transition-colors"
            >
              {"\uB2EB\uAE30"}
            </SharedUiButton>
          </div>
        </div>
      )}
    </>
  );
};

export default MissionSectionsGrid;
