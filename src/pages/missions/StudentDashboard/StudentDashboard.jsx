import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useEffect, useMemo, useState } from "react";
import { collection, documentId, onSnapshot, query, where } from "firebase/firestore";
import { ArrowsLeftRightIcon as ArrowRightLeft } from "@phosphor-icons/react/dist/csr/ArrowsLeftRight";
import { ClockCounterClockwiseIcon as History } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { SparkleIcon as Sparkles } from "@phosphor-icons/react/dist/csr/Sparkle";

import { AssetBalanceBar, Button } from "../../../components/ui";
import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { useMissionTokenCreditConfig } from "../hooks/useMissionTokenCreditConfig";
import { useMissionTokenConversion } from "../hooks/useMissionTokenConversion";
import { useStudentMissionActions } from "../hooks/useStudentMissionActions";
import { mergeCanonicalMissionStates } from "../hooks/useCanonicalMissionStates";
import {
  canSubmitMission,
  getMissionTimeStatus,
} from "../utils/missionHelpers";
import { isMissionAssignedToStudent } from "../utils/missionEligibility";
import MissionSectionsGrid from "./components/MissionSectionsGrid";
import MissionTokenConvertModal from "./modals/MissionTokenConvertModal";
import MissionTokenHistoryModal from "./modals/MissionTokenHistoryModal";

const toDateSafe = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const StudentDashboard = ({
  onRefresh,
  missions: missionsProp,
  previewMode = false,
  studentMode = false,
  onHeaderActionsChange,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const {
    classId,
    userData,
    classData,
    isTeacher,
    hasPermission,
    missionTokenLabel,
  } = useUser();
  const { submitMission, isSubmitting } = useStudentMissionActions();
  const { config: missionTokenCreditConfig, creditScoreMax } =
    useMissionTokenCreditConfig(previewMode ? null : classId);
  const { convertMissionToken, isSubmitting: isConvertingMissionToken } =
    useMissionTokenConversion(previewMode ? null : classId);
  const studentUid = previewMode ? null : userData?.uid;

  const [alwaysStateMap, setAlwaysStateMap] = useState({});
  const [regularStateMap, setRegularStateMap] = useState({});
  const [stateReader, setStateReader] = useState({ key: null, error: null });
  const stateMissionKey = (Array.isArray(missionsProp) ? missionsProp : []).map((mission) => mission.id).filter(Boolean).sort().join("\u0001");
  const stateReaderKey = `${classId}/${studentUid}/${stateMissionKey}`;

  const allMissions = useMemo(
    () => (Array.isArray(missionsProp) ? missionsProp : []).map((mission) =>
      mergeCanonicalMissionStates(mission, regularStateMap[mission.id] ? { [studentUid]: regularStateMap[mission.id] } : {})),
    [missionsProp, regularStateMap, studentUid],
  );
  const needsRegularState = !previewMode && allMissions.some((mission) => mission.stateStorageVersion === 2);
  const loading = !Array.isArray(missionsProp) || (needsRegularState && stateReader.key !== stateReaderKey);

  const [isMissionTokenConvertModalOpen, setIsMissionTokenConvertModalOpen] =
    useState(false);
  const [isMissionTokenHistoryModalOpen, setIsMissionTokenHistoryModalOpen] =
    useState(false);

  const creditScore = Number(userData?.creditScore ?? 0);
  const missionToken = Number(
    userData?.assets?.missionToken ?? userData?.assets?.token ?? 0,
  );

  const headerActions = useMemo(() => {
    if (previewMode) return null;

    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AssetBalanceBar
          variant="inline"
          items={[
            {
              key: "mission-token",
              icon: Sparkles,
              tone: "amber",
              value: `${formatDisplayMoney(missionToken)} ${missionTokenLabel}`,
              ariaLabel: `보유 ${missionTokenLabel} ${formatDisplayMoney(missionToken)}`,
            },
          ]}
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="xs"
            kind="ghost"
            tone="slate"
            icon={History}
            onClick={() => setIsMissionTokenHistoryModalOpen(true)}
            aria-label={`${missionTokenLabel} 내역 보기`}
            title={`${missionTokenLabel} 내역 보기`}
          >
            내역
          </Button>
          {missionTokenCreditConfig.enabled && !(studentMode && isTeacher) ? (
            <Button
              size="xs"
              tone="lightBlue"
              kind="ghost"
              icon={ArrowRightLeft}
              onClick={() => setIsMissionTokenConvertModalOpen(true)}
            >
              전환
            </Button>
          ) : null}
        </div>
      </div>
    );
  }, [
    formatDisplayMoney,
    missionToken,
    missionTokenCreditConfig.enabled,
    missionTokenLabel,
    isTeacher,
    previewMode,
    studentMode,
  ]);

  useEffect(() => {
    onHeaderActionsChange?.(headerActions);
    return () => onHeaderActionsChange?.(null);
  }, [headerActions, onHeaderActionsChange]);

  useEffect(() => {
    if (previewMode || !classId || !studentUid || !stateMissionKey) {
      setAlwaysStateMap({});
      setRegularStateMap({});
      return undefined;
    }

    const ids = stateMissionKey.split("\u0001");
    const stateRef = collection(db, `classes/${classId}/students/${studentUid}/missionState`);
    const reader = { active: true, chunks: new Map(), pending: new Set(), error: null };
    for (let offset = 0; offset < ids.length; offset += 30) reader.pending.add(offset);
    const subscriptions = [];
    for (let offset = 0; offset < ids.length; offset += 30) {
      subscriptions.push(onSnapshot(query(stateRef, where(documentId(), "in", ids.slice(offset, offset + 30))), (snapshot) => {
        if (!reader.active) return;
        reader.chunks.set(offset, snapshot.docs);
        reader.pending.delete(offset);
        const next = {};
        const regular = {};
        for (const docs of reader.chunks.values()) docs.forEach((docSnap) => {
          const state = docSnap.data();
          if (state?.kind === "regular") regular[docSnap.id] = state;
          else next[docSnap.id] = { id: docSnap.id, ...state };
        });
        setAlwaysStateMap(next);
        setRegularStateMap(regular);
        if (!reader.pending.size) setStateReader({ key: `${classId}/${studentUid}/${stateMissionKey}`, error: reader.error });
      }, (error) => {
        if (!reader.active) return;
        reader.error = error;
        setStateReader({ key: `${classId}/${studentUid}/${stateMissionKey}`, error });
      }));
    }
    return () => { reader.active = false; subscriptions.forEach((unsubscribe) => unsubscribe()); };
  }, [classId, previewMode, studentUid, stateMissionKey]);


  const classified = useMemo(() => {
    if (!Array.isArray(allMissions)) return [];

    if (previewMode) {
      const now = new Date();

      return allMissions
        .map((mission) => {
          if (mission.type === "always") {
            return {
              ...mission,
              rewards: mission.rewards || [],
              displayStatus: "available",
              priority: 2,
              canSubmit: false,
              _completion: null,
            };
          }

          const end = toDateSafe(mission?.timeWindow?.end);
          let status = "available";
          let priority = 3;

          if (end && end < now) {
            status = "overdue";
            priority = 0;
          } else if (end && (end - now) / 3600000 <= 24) {
            status = "urgent";
            priority = 1;
          }

          return {
            ...mission,
            rewards: mission.rewards || [],
            displayStatus: status,
            priority,
            canSubmit: false,
            _completion: null,
          };
        })
        .sort((left, right) => left.priority - right.priority);
    }

    if (!studentUid) return [];

    const now = new Date();
    const isPowerUser =
      !studentMode &&
      (isTeacher || hasPermission?.("view_future_missions"));

    return allMissions
      .map((mission) => {
        const completion = mission.completions?.[studentUid] || null;
        const assignedToStudent = isMissionAssignedToStudent(
          mission,
          userData,
          studentUid,
        );
        const timeStatus = getMissionTimeStatus(mission);
        const canSubmit = canSubmitMission(mission, studentUid, {
          ignoreTarget: isPowerUser,
          studentData: userData,
        });
        let status = "not_available";
        let priority = 5;

        if (completion?.status === "pending" || completion?.status === "late") {
          status = "pending";
          priority = 2;
        } else if (
          completion?.status === "approved" ||
          completion?.status === "late-approved"
        ) {
          status = "completed";
          priority = 4;
        } else if (canSubmit) {
          const end = toDateSafe(mission.timeWindow?.end);
          if (end && end < now) {
            status = "overdue";
            priority = 0;
          } else if (end && (end - now) / 3600000 <= 24) {
            status = "urgent";
            priority = 1;
          } else {
            status = "available";
            priority = 3;
          }
        } else if (assignedToStudent && timeStatus.status === "expired") {
          status = "overdue";
          priority = 0;
        }

        return {
          ...mission,
          rewards: mission.rewards || [],
          displayStatus: status,
          priority,
          canSubmit,
          _completion: completion,
        };
      })
      .filter(
        (mission) =>
          mission.type === "always" ||
          mission.displayStatus !== "not_available" ||
          isPowerUser,
      )
      .sort((left, right) => left.priority - right.priority);
  }, [
    allMissions,
    previewMode,
    studentUid,
    isTeacher,
    studentMode,
    hasPermission,
    userData,
  ]);

  const handleSubmit = async (mission, content = "") => {
    if (previewMode) return;
    if (!mission) return;

    const result = await submitMission(mission, content);
    if (result?.success) {
      onRefresh?.();
      return;
    }

    if (
      typeof result?.error === "string" &&
      (result.error.includes("미션을 찾을 수 없습니다") || result.error.includes("과제를 찾을 수 없습니다"))
    ) {
      onRefresh?.();
    }
  };

  if (needsRegularState && stateReader.error) {
    return <div role="alert" className="p-4 text-sm text-red-700">과제 상태를 불러오지 못했습니다. 페이지를 새로고침해주세요.</div>;
  }
  if (loading) {
    return (
      <div className="animate-pulse p-10 text-center">
        데이터를 불러오는 중입니다...
      </div>
    );
  }

  return (
    <div className="space-y-6">

      <section>
        <div className="hidden">
          <div>
            <p className="text-sm font-bold text-indigo-600">
              {"내 과제"}
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">
              {
                "과제 현황을 확인해 보세요"
              }
            </h2>
          </div>
        </div>
        <MissionSectionsGrid
          filteredMissions={classified}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          classData={classData}
          classId={classId}
          readOnly={previewMode}
          alwaysStateMap={alwaysStateMap}
          onAlwaysRefresh={onRefresh}
        />
      </section>

      {!previewMode ? (
        <MissionTokenConvertModal
          isOpen={isMissionTokenConvertModalOpen}
          onClose={() => setIsMissionTokenConvertModalOpen(false)}
          config={missionTokenCreditConfig}
          currentTier={userData?.creditTier || null}
          creditScoreMax={creditScoreMax}
          missionTokenBalance={missionToken}
          currentCreditScore={creditScore}
          onSubmit={convertMissionToken}
          isSubmitting={isConvertingMissionToken}
        />
      ) : null}
      {!previewMode ? (
        <MissionTokenHistoryModal
          isOpen={isMissionTokenHistoryModalOpen}
          onClose={() => setIsMissionTokenHistoryModalOpen(false)}
          classId={classId}
          studentUid={studentUid}
        />
      ) : null}
    </div>
  );
};

export default StudentDashboard;
