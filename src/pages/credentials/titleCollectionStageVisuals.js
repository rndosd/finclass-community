import stage01 from "../../assets/credentials/archive-bloom-stages-hd/stage-01.webp";
import stage02 from "../../assets/credentials/archive-bloom-stages-hd/stage-02.webp";
import stage03 from "../../assets/credentials/archive-bloom-stages-hd/stage-03.webp";
import stage04 from "../../assets/credentials/archive-bloom-stages-hd/stage-04.webp";
import stage05 from "../../assets/credentials/archive-bloom-stages-hd/stage-05.webp";
import stage06 from "../../assets/credentials/archive-bloom-stages-hd/stage-06.webp";
import stage07 from "../../assets/credentials/archive-bloom-stages-hd/stage-07.webp";
import stage08 from "../../assets/credentials/archive-bloom-stages-hd/stage-08.webp";
import stage09 from "../../assets/credentials/archive-bloom-stages-hd/stage-09.webp";
import stage10 from "../../assets/credentials/archive-bloom-stages-hd/stage-10.webp";
import stage11 from "../../assets/credentials/archive-bloom-stages-hd/stage-11.webp";
import stage12 from "../../assets/credentials/archive-bloom-stages-hd/stage-12.webp";

export const TITLE_COLLECTION_VISUAL_STAGE_COUNT = 12;

export const TITLE_COLLECTION_STAGE_ASSETS = [
  stage01,
  stage02,
  stage03,
  stage04,
  stage05,
  stage06,
  stage07,
  stage08,
  stage09,
  stage10,
  stage11,
  stage12,
];

function clampVisualStage(value) {
  return Math.max(
    1,
    Math.min(TITLE_COLLECTION_VISUAL_STAGE_COUNT, Number(value) || 1),
  );
}

export function getTitleCollectionVisualStageForConfiguredStage(
  stageIndex,
  stageCount,
) {
  const normalizedStageCount = Math.max(1, Math.floor(Number(stageCount) || 1));
  if (normalizedStageCount === 1) return TITLE_COLLECTION_VISUAL_STAGE_COUNT;

  const normalizedStageIndex = Math.max(
    0,
    Math.min(normalizedStageCount - 1, Math.floor(Number(stageIndex) || 0)),
  );

  return clampVisualStage(
    1 +
      Math.round(
        (normalizedStageIndex * (TITLE_COLLECTION_VISUAL_STAGE_COUNT - 1)) /
          (normalizedStageCount - 1),
      ),
  );
}

export function getTitleCollectionConfiguredVisualStage(
  stage,
  stageIndex,
  stageCount,
) {
  const automaticStage = getTitleCollectionVisualStageForConfiguredStage(
    stageIndex,
    stageCount,
  );
  const requestedStage = Number(stage?.emblemStage ?? stage?.visualStage);

  if (!Number.isFinite(requestedStage) || requestedStage <= 0) {
    return automaticStage;
  }

  return Math.max(1, Math.min(automaticStage, Math.round(requestedStage)));
}

export function getTitleCollectionConfiguredStageIndex(rate, stages = []) {
  if (!Array.isArray(stages) || !stages.length) return -1;

  const normalizedRate = Math.max(0, Math.min(100, Number(rate) || 0));
  const normalizedStages = [...stages].sort(
    (left, right) =>
      Number(left?.minRate || 0) - Number(right?.minRate || 0) ||
      Number(left?.order || 0) - Number(right?.order || 0),
  );
  let activeIndex = -1;

  normalizedStages.forEach((stage, index) => {
    if (normalizedRate >= Number(stage?.minRate || 0)) activeIndex = index;
  });

  return activeIndex;
}

export function getTitleCollectionVisualStage(rate, stages = []) {
  if (Array.isArray(stages) && stages.length) {
    const normalizedStages = [...stages].sort(
      (left, right) =>
        Number(left?.minRate || 0) - Number(right?.minRate || 0) ||
        Number(left?.order || 0) - Number(right?.order || 0),
    );
    const configuredStageIndex = getTitleCollectionConfiguredStageIndex(
      rate,
      normalizedStages,
    );
    if (configuredStageIndex < 0) return 1;

    return getTitleCollectionConfiguredVisualStage(
      normalizedStages[configuredStageIndex],
      configuredStageIndex,
      normalizedStages.length,
    );
  }

  const normalizedRate = Math.max(0, Math.min(100, Number(rate) || 0));
  return Math.max(
    1,
    Math.ceil(
      (normalizedRate / 100) * TITLE_COLLECTION_VISUAL_STAGE_COUNT,
    ),
  );
}

export function getTitleCollectionStageAsset(rate, stages = []) {
  return TITLE_COLLECTION_STAGE_ASSETS[
    getTitleCollectionVisualStage(rate, stages) - 1
  ];
}

export function getTitleCollectionSelectedVisualStage(
  selectedStage,
  unlockedStage,
) {
  const normalizedUnlockedStage = clampVisualStage(unlockedStage);
  const requestedStage = Number(selectedStage);

  if (!Number.isFinite(requestedStage) || requestedStage <= 0) {
    return normalizedUnlockedStage;
  }

  return Math.max(
    1,
    Math.min(normalizedUnlockedStage, Math.round(requestedStage)),
  );
}

export function getTitleCollectionStageAssetByVisualStage(visualStage) {
  return TITLE_COLLECTION_STAGE_ASSETS[clampVisualStage(visualStage) - 1];
}
