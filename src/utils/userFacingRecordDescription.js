const safeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeMissionLabel = (value) => {
  const title = safeText(value) || "과제";
  return title.endsWith("미션") || title.endsWith("과제") ? title : `${title} 과제`;
};

const replaceMissionRewardImplementationSuffix = (value) => {
  const rules = [
    [/^(.+?)\s+reward credit granted$/i, "신용 보상 지급"],
    [/^(.+?)\s+reward credit reversed$/i, "신용 보상 회수"],
    [/^(.+?)\s+reward withholding$/i, "보상 원천징수"],
    [/^(.+?)\s+reward granted$/i, "보상 지급"],
    [/^(.+?)\s+reward reversed$/i, "보상 회수"],
  ];

  for (const [pattern, suffix] of rules) {
    const match = safeText(value).match(pattern);
    if (match) return `${normalizeMissionLabel(match[1])} ${suffix}`;
  }

  return safeText(value);
};

export const stripMissionRewardImplementationSuffix = (value) =>
  safeText(value)
    .replace(/\s+reward credit (?:granted|reversed)$/i, "")
    .replace(/\s+reward (?:granted|withholding|reversed)$/i, "")
    .trim();

export const getUserFacingRecordDescription = (recordOrValue, fallback = "") => {
  const record =
    recordOrValue && typeof recordOrValue === "object" ? recordOrValue : null;
  let description = safeText(
    record
      ? record.description || record.title || record.reason || record.note
      : recordOrValue,
  );

  description = replaceMissionRewardImplementationSuffix(description);

  description = description.replace(
    /^(.+?)\s+rejected\s+(\d+)\s+attempts$/i,
    (_, subject, count) => `${safeText(subject)} 제출 ${Number(count)}건 반려`,
  );

  if (/^police reward$/i.test(description)) description = "경찰 상금";

  return description || safeText(fallback);
};

const SOURCE_LABELS = {
  mission_reward: "과제 보상",
  mission_reward_withholding: "과제 보상 원천징수",
  police_reward: "경찰 상금",
  police_reward_withholding: "경찰 상금 원천징수",
  police_reward_refund: "경찰 상금 회수",
};

export const getUserFacingRecordSource = (value, fallback = "") => {
  const source = safeText(value);
  if (!source) return safeText(fallback);
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  if (/^[a-z0-9_-]+$/i.test(source)) return safeText(fallback);
  return source;
};
