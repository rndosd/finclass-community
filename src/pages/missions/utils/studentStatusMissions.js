import { getAlwaysAvailabilityDays } from "./alwaysMissionState";

function getAvailabilityDays(mission = {}) {
  return getAlwaysAvailabilityDays(mission?.availability);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function compareTeacherMissionOrder(left = {}, right = {}) {
  const leftOrder = Number(left?.displayOrder);
  const rightOrder = Number(right?.displayOrder);
  const leftHasOrder = Number.isFinite(leftOrder);
  const rightHasOrder = Number.isFinite(rightOrder);

  if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (leftHasOrder !== rightHasOrder) {
    return leftHasOrder ? -1 : 1;
  }

  const leftStart = toMillis(left?.timeWindow?.start || left?.startDate);
  const rightStart = toMillis(right?.timeWindow?.start || right?.startDate);
  if (leftStart !== rightStart) return leftStart - rightStart;

  const leftCreated = toMillis(left?.createdAt);
  const rightCreated = toMillis(right?.createdAt);
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;

  return String(left?.title || "").localeCompare(String(right?.title || ""), "ko");
}

export function isMissionActiveOnCurrentDay(mission = {}, now = new Date()) {
  if (mission?.type !== "always") return true;
  return getAvailabilityDays(mission).includes(now.getDay());
}

export function sortMissionsBySelectedOrder(
  allMissions = [],
  selectedMissionIds = [],
) {
  if (!Array.isArray(allMissions) || allMissions.length === 0) return [];
  if (!Array.isArray(selectedMissionIds) || selectedMissionIds.length === 0) {
    return [];
  }

  const selectedSet = new Set(selectedMissionIds.filter(Boolean));

  return allMissions
    .filter((mission) => selectedSet.has(mission?.id))
    .sort(compareTeacherMissionOrder);
}

export function getStudentStatusDisplayMissions({
  allMissions = [],
  selectedMissionIds = [],
  now = new Date(),
} = {}) {
  return sortMissionsBySelectedOrder(allMissions, selectedMissionIds).filter((mission) =>
    isMissionActiveOnCurrentDay(mission, now),
  );
}
