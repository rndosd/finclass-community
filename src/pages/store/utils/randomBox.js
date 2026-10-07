export const RANDOM_BOX_ITEM_TYPE = "randomBox";
export const RANDOM_BOX_FUNCTION_TAG = "random_box";

export const isRandomBoxItem = (item = {}) =>
  item?.itemType === RANDOM_BOX_ITEM_TYPE ||
  item?.functionTag === RANDOM_BOX_FUNCTION_TAG;

const getRandomBoxConfigSource = (item = {}) => {
  if (
    item?.randomBoxConfig &&
    Array.isArray(item.randomBoxConfig.rewards)
  ) {
    return item.randomBoxConfig;
  }

  if (
    item?.randomBoxConfigSnapshot &&
    Array.isArray(item.randomBoxConfigSnapshot.rewards)
  ) {
    return item.randomBoxConfigSnapshot;
  }

  const acquisitions = Array.isArray(item?.acquisitions)
    ? [...item.acquisitions].reverse()
    : [];
  const matchedAcquisition = acquisitions.find(
    (acquisition) =>
      acquisition?.randomBoxConfigSnapshot &&
      Array.isArray(acquisition.randomBoxConfigSnapshot.rewards),
  );

  return matchedAcquisition?.randomBoxConfigSnapshot || {};
};

export const getRandomBoxBoxType = (item = {}) =>
  String(getRandomBoxConfigSource(item)?.boxType || "normal").trim() === "premium"
    ? "premium"
    : "normal";

export const getRandomBoxRewardEntries = (item = {}) => {
  const configSource = getRandomBoxConfigSource(item);
  const rewards = Array.isArray(configSource?.rewards)
    ? configSource.rewards
    : [];
  const totalWeight = rewards.reduce(
    (sum, reward) => sum + Math.max(0, Number(reward?.weight || 0)),
    0,
  );

  return rewards
    .map((reward) => {
      const itemName = String(reward?.itemName || "").trim();
      const quantity = Math.max(1, Math.floor(Number(reward?.quantity || 1)));
      const rawProbability = Number(
        reward?.probabilityPercent ?? reward?.chance,
      );
      const probabilityPercent =
        Number.isFinite(rawProbability) && rawProbability > 0
          ? Math.round(rawProbability * 100) / 100
          : totalWeight > 0
            ? Math.round(
                ((Math.max(0, Number(reward?.weight || 0)) / totalWeight) *
                  100) *
                  100,
              ) / 100
            : 0;

      if (!itemName || probabilityPercent <= 0) {
        return null;
      }

      return {
        itemId: String(reward?.itemId || "").trim(),
        itemName,
        quantity,
        probabilityPercent,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const probabilityGap =
        Number(right?.probabilityPercent || 0) -
        Number(left?.probabilityPercent || 0);

      if (probabilityGap !== 0) {
        return probabilityGap;
      }

      return String(left?.itemName || "").localeCompare(
        String(right?.itemName || ""),
        "ko",
      );
    });
};

export const getRandomBoxRewardPreviewNames = (item = {}, limit = 3) => {
  return getRandomBoxRewardEntries(item)
    .map((reward) => reward.itemName)
    .slice(0, Math.max(0, limit));
};
