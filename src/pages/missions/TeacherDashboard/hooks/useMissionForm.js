// src/pages/missions/hooks/useMissionForm.js
import { useState, useEffect, useMemo } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../../firebase";
import { getRewardConstraints } from "../../utils/rewardUtils";

const sortTierCriteria = (tiers = []) =>
  [...tiers]
    .filter((tier) => tier && typeof tier === "object" && tier.id)
    .sort((a, b) => Number(b.minScore || 0) - Number(a.minScore || 0));

export function useMissionForm({
  isOpen,
  isEdit,
  mission,
  classData,
  classId,
}) {
  const currencyUnit = classData?.currencyUnit || "코인";

  // ===== Base states =====
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [noDueDate, setNoDueDate] = useState(false);

  const [creditReward, setCreditReward] = useState("");
  const [cashReward, setCashReward] = useState("");
  const [missionTokenReward, setMissionTokenReward] = useState("");
  const [creditRewardMax, setCreditRewardMax] = useState("");
  const [cashRewardMax, setCashRewardMax] = useState("");
  const [missionTokenRewardMax, setMissionTokenRewardMax] = useState("");
  const [creditRewardRangeEnabled, setCreditRewardRangeEnabled] =
    useState(false);
  const [cashRewardRangeEnabled, setCashRewardRangeEnabled] = useState(false);
  const [missionTokenRewardRangeEnabled, setMissionTokenRewardRangeEnabled] =
    useState(false);

  const [approvalPolicy, setApprovalPolicy] = useState("auto");
  const [requireSubmissionForm, setRequireSubmissionForm] = useState(false);
  const [allowLateSubmission, setAllowLateSubmission] = useState(true);

  const [targetType, setTargetType] = useState("all");
  const [selectedStudentUids, setSelectedStudentUids] = useState([]);
  const [minimumCreditTierId, setMinimumCreditTierId] = useState("");
  const [availableCreditTiers, setAvailableCreditTiers] = useState([]);

  // ===== Repeat states =====
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeatStartDate, setRepeatStartDate] = useState("");
  const [repeatEndDate, setRepeatEndDate] = useState("");
  const [repeatDays, setRepeatDays] = useState([1, 2, 3, 4, 5]);
  const [repeatStartTime, setRepeatStartTime] = useState("09:00");
  const [repeatEndTime, setRepeatEndTime] = useState("18:00");
  const [repeatNoEndTime, setRepeatNoEndTime] = useState(false);
  const [repeatEndNextDay, setRepeatEndNextDay] = useState(false);

  // ===== Always mission states =====
  const [isActive, setIsActive] = useState(false);
  const [availabilityMode, setAvailabilityMode] = useState("off"); // off | weekly
  const [availabilityDays, setAvailabilityDays] = useState([1, 2, 3, 4, 5]);
  const [availabilityStartTime, setAvailabilityStartTime] = useState("09:00");
  const [availabilityEndTime, setAvailabilityEndTime] = useState("18:00");
  const [maxPerDay, setMaxPerDay] = useState(1);
  const [availabilityStudentVisible, setAvailabilityStudentVisible] =
    useState(true);

  useEffect(() => {
    if (!classId) {
      setAvailableCreditTiers([]);
      return undefined;
    }

    const tierRef = doc(db, `classes/${classId}/tierCriteria/default`);
    const unsubscribe = onSnapshot(
      tierRef,
      (snapshot) => {
        setAvailableCreditTiers(sortTierCriteria(snapshot.data()?.tiers || []));
      },
      () => {
        setAvailableCreditTiers([]);
      },
    );

    return () => unsubscribe();
  }, [classId]);

  // ---- helpers ----
  const nowLocalMin = useMemo(() => {
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const dueMinLocal = useMemo(
    () => (startAt ? startAt : nowLocalMin),
    [startAt, nowLocalMin],
  );

  // ===== Reset =====
  const resetForm = () => {
    setTitle("");
    setDescription("");
    setStartAt("");
    setDueAt("");
    setNoDueDate(false);

    setCreditReward("");
    setCashReward("");
    setMissionTokenReward("");
    setCreditRewardMax("");
    setCashRewardMax("");
    setMissionTokenRewardMax("");
    setCreditRewardRangeEnabled(false);
    setCashRewardRangeEnabled(false);
    setMissionTokenRewardRangeEnabled(false);

    setApprovalPolicy("auto");
    setRequireSubmissionForm(false);
    setAllowLateSubmission(true);

    setTargetType("all");
    setSelectedStudentUids([]);
    setMinimumCreditTierId("");

    setRepeatOn(false);
    setRepeatStartDate("");
    setRepeatEndDate("");
    setRepeatDays([1, 2, 3, 4, 5]);
    setRepeatStartTime("09:00");
    setRepeatEndTime("18:00");
    setRepeatNoEndTime(false);
    setRepeatEndNextDay(false);

    setIsActive(false);
    setAvailabilityMode("off");
    setAvailabilityDays([1, 2, 3, 4, 5]);
    setAvailabilityStartTime("09:00");
    setAvailabilityEndTime("18:00");
    setMaxPerDay(1);

    // ✅ 기본은 "학생에게 보이게"가 자연스러움 (원래 false였는데 true 추천)
    setAvailabilityStudentVisible(true);
  };

  // ===== Edit mode hydrate =====
  useEffect(() => {
    if (!isOpen) return;

    const toLocalInput = (raw) => {
      if (!raw) return "";
      const d = typeof raw?.toDate === "function" ? raw.toDate() : new Date(raw);
      if (isNaN(d.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
        d.getDate(),
      )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    if (isEdit && mission) {
      // 1) basic
      setTitle(mission.title || "");
      setDescription(mission.description || "");
      setRequireSubmissionForm(!!mission.requireSubmissionForm);
      setAllowLateSubmission(mission?.allowLateSubmission !== false);
      setApprovalPolicy(mission.autoApprove ? "auto" : "manual");

      // 2) rewards
      const rewards = getRewardConstraints(mission);

      setCreditReward(
        rewards.credit.isRange
          ? ""
          : rewards.credit.minAmount
            ? String(rewards.credit.minAmount)
            : "",
      );
      setCashReward(
        rewards.currency.isRange
          ? ""
          : rewards.currency.minAmount
            ? String(rewards.currency.minAmount)
            : "",
      );
      setMissionTokenReward(
        rewards.missionToken.isRange
          ? ""
          : rewards.missionToken.minAmount
            ? String(rewards.missionToken.minAmount)
            : "",
      );

      setCreditRewardMax(
        rewards.credit.isRange ? String(rewards.credit.maxAmount) : "",
      );
      setCashRewardMax(
        rewards.currency.isRange ? String(rewards.currency.maxAmount) : "",
      );
      setMissionTokenRewardMax(
        rewards.missionToken.isRange
          ? String(rewards.missionToken.maxAmount)
          : "",
      );

      setCreditRewardRangeEnabled(rewards.credit.isRange);
      setCashRewardRangeEnabled(rewards.currency.isRange);
      setMissionTokenRewardRangeEnabled(rewards.missionToken.isRange);

      // 3) targets
      if (
        Array.isArray(mission.targetStudentUids) &&
        mission.targetStudentUids.length > 0
      ) {
        setTargetType("selected");
        setSelectedStudentUids(mission.targetStudentUids);
      } else {
        setTargetType("all");
        setSelectedStudentUids([]);
      }
      setMinimumCreditTierId(
        mission?.minCreditTierId || mission?.minCreditTier?.id || "",
      );

      // 4) always vs single
      const isAlwaysType = mission.type === "always";
      const av = mission.availability || null;

      if (isAlwaysType) {
        setAvailabilityMode("weekly");
        setIsActive(mission?.isActive ?? true);
        setAvailabilityDays(av?.daysOfWeek || av?.days || [1, 2, 3, 4, 5]);
        setAvailabilityStartTime(av?.startTime || "09:00");
        setAvailabilityEndTime(av?.endTime || "18:00");
        setMaxPerDay(
          typeof av?.maxPerDay === "number" && av.maxPerDay > 0
            ? av.maxPerDay
            : 1,
        );
        setAvailabilityStudentVisible(
          typeof av?.studentVisible === "boolean" ? av.studentVisible : true,
        );

        // 일정형 값 비우기
        setStartAt("");
        setDueAt("");
        setNoDueDate(false);

        // 반복 끄기
        setRepeatOn(false);
      } else {
        setAvailabilityMode("off");
        setIsActive(false);
        setAvailabilityStudentVisible(true);

        const start = mission?.timeWindow?.start || mission?.startDate;
        const end = mission?.timeWindow?.end || mission?.endDate;
        setStartAt(toLocalInput(start));

        if (end) {
          setDueAt(toLocalInput(end));
          setNoDueDate(false);
        } else {
          setDueAt("");
          setNoDueDate(true);
        }

        setRepeatOn(false);
      }

      // 반복 관련 값은 편집 시 비활성(생성 전용)이었으니 초기화
      setRepeatStartDate("");
      setRepeatEndDate("");
      setRepeatDays([1, 2, 3, 4, 5]);
      setRepeatStartTime("09:00");
      setRepeatEndTime("18:00");
      setRepeatNoEndTime(false);
      setRepeatEndNextDay(false);

      return;
    }

    // create mode
    if (!isEdit) resetForm();
  }, [isOpen, isEdit, mission]);

  return {
    // values
    title,
    description,
    startAt,
    dueAt,
    noDueDate,
    creditReward,
    cashReward,
    missionTokenReward,
    creditRewardMax,
    cashRewardMax,
    missionTokenRewardMax,
    creditRewardRangeEnabled,
    cashRewardRangeEnabled,
    missionTokenRewardRangeEnabled,
    approvalPolicy,
    requireSubmissionForm,
    allowLateSubmission,
    targetType,
    selectedStudentUids,
    minimumCreditTierId,
    availableCreditTiers,

    repeatOn,
    repeatStartDate,
    repeatEndDate,
    repeatDays,
    repeatStartTime,
    repeatEndTime,
    repeatNoEndTime,
    repeatEndNextDay,

    isActive,
    availabilityMode,
    availabilityDays,
    availabilityStartTime,
    availabilityEndTime,
    maxPerDay,
    availabilityStudentVisible,

    // setters
    setTitle,
    setDescription,
    setStartAt,
    setDueAt,
    setNoDueDate,
    setCreditReward,
    setCashReward,
    setMissionTokenReward,
    setCreditRewardMax,
    setCashRewardMax,
    setMissionTokenRewardMax,
    setCreditRewardRangeEnabled,
    setCashRewardRangeEnabled,
    setMissionTokenRewardRangeEnabled,
    setApprovalPolicy,
    setRequireSubmissionForm,
    setAllowLateSubmission,
    setTargetType,
    setSelectedStudentUids,
    setMinimumCreditTierId,

    setRepeatOn,
    setRepeatStartDate,
    setRepeatEndDate,
    setRepeatDays,
    setRepeatStartTime,
    setRepeatEndTime,
    setRepeatNoEndTime,
    setRepeatEndNextDay,

    setIsActive,
    setAvailabilityMode,
    setAvailabilityDays,
    setAvailabilityStartTime,
    setAvailabilityEndTime,
    setMaxPerDay,
    setAvailabilityStudentVisible,

    // utils
    resetForm,
    nowLocalMin,
    dueMinLocal,
    currencyUnit,
  };
}

export default useMissionForm;
