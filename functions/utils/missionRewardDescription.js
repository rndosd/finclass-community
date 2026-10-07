"use strict";

function normalizeMissionLabel(value) {
  const title = String(value || "미션").replace(/\s+/g, " ").trim() || "미션";
  return title.endsWith("미션") ? title : `${title} 미션`;
}

function buildMissionRewardDescriptions(title) {
  const missionLabel = normalizeMissionLabel(title);
  return {
    granted: `${missionLabel} 보상 지급`,
    withholding: `${missionLabel} 보상 원천징수`,
    creditGranted: `${missionLabel} 신용 보상 지급`,
    reversed: `${missionLabel} 보상 회수`,
    creditReversed: `${missionLabel} 신용 보상 회수`,
  };
}

module.exports = {
  buildMissionRewardDescriptions,
  normalizeMissionLabel,
};
