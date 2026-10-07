import { ACTIVITY_CATEGORY_LABELS } from "../constants/financeExportConfig";
import { stripMissionRewardImplementationSuffix } from "./userFacingRecordDescription";

const CATEGORY_ACTION_LABELS = {
  salary: "급여 수령",
  salary_deduction: "급여 차감",
  incentive: "인센티브 수령",
  job_incentive: "직업 인센티브 수령",
  job_piece_rate: "건별 인센티브 수령",
  mission: "과제 보상 수령",
  mission_penalty: "과제 보상 회수",
  transfer_in: "송금 받음",
  transfer_out: "송금 보냄",
  store: "상점 구매",
  store_purchase: "상점 구매",
  store_refund: "상점 환불",
  store_gift: "상점 선물",
  fine: "벌금 납부",
  reward: "보상 수령",
  reward_refund: "보상 회수",
  deposit_return: "예금 만기 수령",
  subscription_withdraw: "청약 만기 수령",
};

const safeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeComparableText = (value) =>
  safeText(value)
    .replace(/[-.'"‘’“”()[\]{}:·]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

const uniqueTexts = (values) => {
  const seen = new Set();

  return values.filter((value) => {
    const text = safeText(value);
    const key = normalizeComparableText(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const removeTrailingPunctuation = (value) =>
  safeText(value).replace(/[.!?。]+$/g, "").trim();

const removeOuterQuotes = (value) =>
  removeTrailingPunctuation(value)
    .replace(/^["'‘’“”]+/, "")
    .replace(/["'‘’“”]+$/, "")
    .trim();

const looksLikeAmountDetail = (value, activity, currencyUnit) => {
  const text = safeText(value);
  if (!text || text.includes("%") || /\d+\s*주/.test(text)) return false;

  const digits = text.replace(/[^0-9.-]/g, "");
  const amount = Math.abs(Number(activity?.amount));
  const mentionsAmount = Number.isFinite(amount) && amount > 0 && Number(digits) === amount;
  const mentionsCurrency = uniqueTexts([
    currencyUnit,
    activity?.currency,
    activity?.currencyUnit,
    "마로",
    "캐시",
    "FIN",
    "USD",
  ]).some((unit) => text.toLowerCase().includes(unit.toLowerCase()));

  return mentionsAmount && mentionsCurrency;
};

const splitDescriptionDetails = (rawDescription, activity, currencyUnit) => {
  const details = [];
  let main = safeText(rawDescription).replace(/^\[POS\]\s*/i, "");

  main = main.replace(/\(([^()]*)\)/g, (match, content) => {
    const detail = safeText(content);
    if (!detail || looksLikeAmountDetail(detail, activity, currencyUnit)) return "";
    details.push(detail);
    return "";
  });

  main = main.replace(/\[([^\]]+)\]/g, (match, content) => {
    const detail = safeText(content);
    if (!detail || /^POS$/i.test(detail)) return "";
    details.push(detail);
    return "";
  });

  return {
    main: removeTrailingPunctuation(main),
    details: uniqueTexts(details),
  };
};

const joinTitle = (action, subject) => {
  const safeAction = safeText(action);
  const safeSubject = removeOuterQuotes(subject);
  if (!safeSubject) return safeAction;
  if (!safeAction) return safeSubject;

  const actionKey = normalizeComparableText(safeAction);
  const subjectKey = normalizeComparableText(safeSubject);
  if (subjectKey === actionKey || subjectKey.startsWith(actionKey)) return safeSubject;

  return `${safeAction} · ${safeSubject}`;
};

const resolveArcadePresentation = (description, isIncome) => {
  const canonicalMatch = description.match(
    /^(게임 참여|게임 보상 수령)\s*·\s*(.+)$/,
  );
  if (canonicalMatch) {
    return {
      title: `${canonicalMatch[1]} · ${removeTrailingPunctuation(canonicalMatch[2])}`,
      details: [],
    };
  }

  const patterns = [
    {
      regex: /^(?:paperpick\s*slot|종이\s*뽑기)(?:\s*\d+번?|\s*\d+)?\s*:\s*(.+)$/i,
      game: "종이 뽑기",
    },
    { regex: /^(?:roulette\s*result|룰렛\s*결과)\s*:\s*(.+)$/i, game: "룰렛" },
    {
      regex: /^(?:scratch\s*result|스크래처\s*결과)\s*:\s*(.+)$/i,
      game: "스크래처",
    },
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern.regex);
    if (!match) continue;

    return {
      title: joinTitle(isIncome ? "게임 보상 수령" : "게임 참여", pattern.game),
      details: [`결과: ${removeTrailingPunctuation(match[1])}`],
    };
  }

  return null;
};

const resolveTransferSubject = (activity, description) => {
  const counterpartName = safeText(activity?.counterpartName);
  if (counterpartName) return counterpartName;

  if (activity?.category === "transfer_out") {
    return safeText(description.match(/^(.+?)에게\s*송금/)?.[1]);
  }

  return safeText(description.match(/^(.+?)(?:로부터\s*입금|\s*:)/)?.[1]);
};

const resolveStoreSubject = (description) => {
  const legacyMatch = description.match(/^(.*)\s+(\d+)\s+purchase$/i);
  if (legacyMatch) return `${safeText(legacyMatch[1])} ${Number(legacyMatch[2])}개`;

  return description
    .replace(/\s+\d+\s+purchase$/i, "")
    .replace(/\s*구매(?:\s*완료)?$/g, "")
    .trim();
};

const resolveGenericTitle = (action, description) => {
  if (!description) return action;

  const actionKey = normalizeComparableText(action);
  const descriptionKey = normalizeComparableText(description);
  if (actionKey && (descriptionKey === actionKey || descriptionKey.startsWith(actionKey))) {
    return description;
  }

  return joinTitle(action, description);
};

const resolveSubjectBeforeAction = (description, action) => {
  if (!description || !action) return description;

  const escapedAction = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = description.match(new RegExp(`^(.+?)\\s*${escapedAction}$`));
  return match ? removeOuterQuotes(match[1]) : description;
};

const buildSubtitle = ({ note, reason, details, title }) => {
  const titleKey = normalizeComparableText(title);
  const candidates = [];
  const safeNote = safeText(note);
  const safeReason = safeText(reason);
  const explicitDetailKeys = new Set(
    [safeNote, safeReason].map(normalizeComparableText).filter(Boolean),
  );

  if (safeNote) candidates.push(`메모: ${safeNote}`);
  if (safeReason) candidates.push(`사유: ${safeReason}`);
  candidates.push(
    ...details
      .map(removeTrailingPunctuation)
      .filter((detail) => !explicitDetailKeys.has(normalizeComparableText(detail))),
  );

  return uniqueTexts(candidates)
    .filter((candidate) => normalizeComparableText(candidate) !== titleKey)
    .slice(0, 2)
    .join(" · ");
};

export const getActivityPresentation = (activity = {}, options = {}) => {
  const category = safeText(activity.category).toLowerCase();
  const rawDescription = safeText(
    activity.description || activity.title || activity.reason || activity.note,
  );
  const { main: parsedMain, details } = splitDescriptionDetails(
    rawDescription,
    activity,
    options.currencyUnit,
  );
  const main =
    category === "mission" || category === "mission_penalty"
      ? stripMissionRewardImplementationSuffix(parsedMain)
      : parsedMain;
  const action =
    CATEGORY_ACTION_LABELS[category] ||
    ACTIVITY_CATEGORY_LABELS[category] ||
    (activity.type === "income" ? "수입" : activity.type === "expense" ? "지출" : "활동");
  const isIncome = activity.type === "income" || Number(activity.amount) < 0;

  let title = "";
  let inferredDetails = details;

  if (category === "arcade") {
    const arcadePresentation = resolveArcadePresentation(main, isIncome);
    if (arcadePresentation) {
      title = arcadePresentation.title;
      inferredDetails = [...arcadePresentation.details, ...details];
    }
  }

  if (!title && (category === "transfer_in" || category === "transfer_out")) {
    title = joinTitle(action, resolveTransferSubject(activity, main));
  }

  if (!title && (category === "store" || category === "store_purchase")) {
    title = joinTitle(action, resolveStoreSubject(main));
  }

  if (!title && (category === "salary" || category === "salary_deduction")) {
    title = action;
    inferredDetails = details.map((detail) =>
      /^\d+\s*주$/.test(detail) ? `${detail.replace(/\s/g, "")}분 급여` : detail,
    );
  }

  if (!title && category === "fine") {
    const subject = main.replace(/^벌금(?:\s*부과|\s*납부)?\s*[:·-]?\s*/g, "");
    title = joinTitle(action, subject);
  }

  if (!title && category === "deposit_return") {
    const subject = main.replace(/\s*만기\s*(?:수령|지급)?$/g, "");
    title = joinTitle(action, subject);
  }

  if (!title && category === "donation" && /^기부\s+[+-]?[\d,.]+/.test(main)) {
    title = action;
  }

  if (!title) {
    title = resolveGenericTitle(action, resolveSubjectBeforeAction(main, action));
  }

  return {
    title: title || "활동 기록",
    subtitle: buildSubtitle({
      note: activity.note,
      reason: activity.reason,
      details: inferredDetails,
      title,
    }),
  };
};
