import {
  useEffect,
  useState } from
"react";
import {
  writeBatch } from
"firebase/firestore";
import {
  Award,
  Crown,
  GripVertical,
  Lock,
  Medal,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
} from
"lucide-react";
import {
  db } from
"../../firebase";
import {
  Alert,
  Badge,
  Button,
  InputField,
  Modal,
  SelectField,
  Tabs,
  Textarea,
  ToggleSwitch } from
"../../components/ui";
import {
  useFeedback } from
"../../contexts/FeedbackContext";

const TAB_ITEMS = [
{ id: "titles", label: "칭호", icon: Medal },
{ id: "certificates", label: "자격증", icon: ShieldCheck }];


const PREVIEW_MODE_TABS = [
{ id: "teacher", label: "교사 보기" },
{ id: "student", label: "학생 보기" }];


const GRADE_SETTING_TABS = [
{ id: "titleGrades", label: "칭호" },
{ id: "certificateGrades", label: "자격증" }];


const STUDENT_DEX_FILTER_TABS = [
{ id: "all", label: "전체" },
{ id: "owned", label: "발견" },
{ id: "locked", label: "미발견" },
{ id: "requestable", label: "요청 가능" }];


const MAX_REPRESENTATIVE_TITLES = 2;

const CERTIFICATE_OPTIONS = {
  issueMethod: [
  { value: "manual", label: "교사 수동 발급" },
  { value: "assignment", label: "과제 통과" },
  { value: "exam", label: "시험 통과" },
  { value: "project", label: "프로젝트 완료" }]

};

const GRADE_TONE_OPTIONS = [
{ value: "slate", label: "슬레이트" },
{ value: "blue", label: "블루" },
{ value: "indigo", label: "인디고" },
{ value: "emerald", label: "에메랄드" },
{ value: "violet", label: "바이올렛" },
{ value: "amber", label: "앰버" },
{ value: "red", label: "레드" }];


const DEFAULT_TITLE_GRADES = [{ id: "common", label: "기초", tone: "slate", order: 1 }, { id: "rare", label: "성장", tone: "blue", order: 2 }, { id: "epic", label: "우수", tone: "emerald", order: 3 }, { id: "legendary", label: "특별", tone: "amber", order: 4 }];






const CERTIFICATE_NO_STAGE_ID = "none";
const CERTIFICATE_NO_STAGE_OPTION = { value: CERTIFICATE_NO_STAGE_ID, label: "단계 없음" };
const DEFAULT_CERTIFICATE_GRADES = [{ id: "basic", label: "기초", tone: "emerald", order: 1 }, { id: "intermediate", label: "중급", tone: "blue", order: 2 }, { id: "advanced", label: "고급", tone: "violet", order: 3 }];





const DEFAULT_TITLE_COLLECTION_STAGES = [{ id: "starter", label: "첫 발견", minRate: 1, tone: "blue", order: 1 }, { id: "challenger", label: "도전 수집가", minRate: 40, tone: "indigo", order: 2 }, { id: "advanced", label: "상급 수집가", minRate: 75, tone: "emerald", order: 3 }, { id: "master", label: "도감 마스터", minRate: 100, tone: "amber", order: 4 }];

const EMPTY_TITLE_FORM = {
  name: "",
  description: "",
  acquisitionCondition: "",
  gradeId: DEFAULT_TITLE_GRADES[0].id,
  revealMode: "condition_only",
  rarity: "common",
  icon: "none",
  familyId: "plaque",
  paletteId: "sky",
  sourceType: "manual",
  allowStudentRequest: true,
  isVisible: true,
  isActive: true
};

const EMPTY_CERTIFICATE_FORM = {
  name: "",
  description: "",
  category: "",
  gradeId: CERTIFICATE_NO_STAGE_ID,
  level: CERTIFICATE_NO_STAGE_ID,
  issueMethod: "manual",
  expiresEnabled: false,
  isVisible: true,
  isActive: true
};

const levelToneMap = {
  basic: "emerald",
  intermediate: "blue",
  advanced: "violet"
};

const titleSourceLabelMap = {
  manual: "교사 수동 지급",
  random_box: "랜덤박스 보상",
  event: "이벤트 보상",
  mission: "과제 누적 보상",
  claim_request: "조건 달성 승인"
};

const titleSourceHintMap = {
  manual: "교사가 직접 지급하면 도감이 등록됩니다.",
  random_box: "랜덤박스 보상에서 발견될 수 있습니다.",
  event: "이벤트 보상으로만 해금될 수 있습니다.",
  mission: "과제 누적 보상을 달성하면 등록됩니다.",
  claim_request: "조건 달성 후 요청하면 교사가 승인할 수 있습니다."
};

const certificateIssueMethodMap = {
  manual: "교사 수동 발급",
  assignment: "과제 통과",
  exam: "시험 통과",
  project: "프로젝트 완료"
};

const titleRequestStatusMap = {
  pending: {
    label: "대기",
    tone: "blue",
    description: "교사가 요청을 검토하고 있습니다."
  },
  approved: {
    label: "승인",
    tone: "emerald",
    description: "요청이 승인되어 칭호가 지급되었습니다."
  },
  rejected: {
    label: "반려",
    tone: "red",
    description: "조건을 다시 확인한 뒤 다시 요청할 수 있습니다."
  }
};

const TITLE_REVEAL_MODE_OPTIONS = [
{
  value: "condition_only",
  label: "이름 숨김, 조건 공개",
  description: "학생은 숨겨진 상태로 보고, 획득 요건만 확인할 수 있습니다."
},
{
  value: "name_only",
  label: "이름 공개, 조건 숨김",
  description: "학생은 칭호 이름은 볼 수 있고, 획득 조건은 비밀로 둡니다."
},
{
  value: "name_and_condition",
  label: "이름과 조건 공개",
  description: "학생은 잠겨 있어도 칭호명과 획득 요건을 모두 볼 수 있습니다."
},
{
  value: "blurred",
  label: "이름 블러, 조건 블러",
  description: "학생은 칭호 이름과 획득 조건을 흐리게 보고 나중에 확실하게 알게 됩니다."
},
{
  value: "hidden",
  label: "이름과 조건 모두 숨김",
  description: "학생은 비밀 슬롯처럼 보고, 교사 안내 전까지 내용을 알 수 없습니다."
}];


const TITLE_REVEAL_VISIBILITY_OPTIONS = [
  { value: "public", label: "공개" },
  { value: "blur", label: "블러" },
  { value: "hidden", label: "비공개" },
];

const DEFAULT_TITLE_REVEAL_CONFIG = Object.freeze({
  name: "hidden",
  condition: "public",
  nameplate: "hidden",
});

const TITLE_REVEAL_FIELD_LABELS = {
  name: "이름",
  condition: "조건",
  nameplate: "명패",
};

function legacyRevealModeToConfig(revealMode) {
  switch (revealMode) {
    case "name_only":
      return {
        name: "public",
        condition: "hidden",
        nameplate: "blur",
      };
    case "name_and_condition":
      return {
        name: "public",
        condition: "public",
        nameplate: "blur",
      };
    case "blurred":
      return {
        name: "blur",
        condition: "blur",
        nameplate: "blur",
      };
    case "hidden":
      return {
        name: "hidden",
        condition: "hidden",
        nameplate: "hidden",
      };
    case "condition_only":
    default:
      return {
        name: "hidden",
        condition: "public",
        nameplate: "hidden",
      };
  }
}

function normalizeTitleRevealVisibility(value, fallback) {
  return TITLE_REVEAL_VISIBILITY_OPTIONS.some((item) => item.value === value)
    ? value
    : fallback;
}

function normalizeTitleRevealConfig(config, fallbackRevealMode = "condition_only") {
  const fallbackConfig = legacyRevealModeToConfig(fallbackRevealMode);
  const source =
    config && typeof config === "object" && !Array.isArray(config) ? config : {};

  return {
    name: normalizeTitleRevealVisibility(
      source.name,
      fallbackConfig.name || DEFAULT_TITLE_REVEAL_CONFIG.name,
    ),
    condition: normalizeTitleRevealVisibility(
      source.condition,
      fallbackConfig.condition || DEFAULT_TITLE_REVEAL_CONFIG.condition,
    ),
    nameplate: normalizeTitleRevealVisibility(
      source.nameplate,
      fallbackConfig.nameplate || DEFAULT_TITLE_REVEAL_CONFIG.nameplate,
    ),
  };
}

function deriveLegacyTitleRevealMode(config) {
  const normalized = normalizeTitleRevealConfig(config);

  if (
    normalized.name === "hidden" &&
    normalized.condition === "public" &&
    normalized.nameplate === "hidden"
  ) {
    return "condition_only";
  }

  if (
    normalized.name === "public" &&
    normalized.condition === "hidden" &&
    normalized.nameplate === "blur"
  ) {
    return "name_only";
  }

  if (
    normalized.name === "public" &&
    normalized.condition === "public" &&
    normalized.nameplate === "blur"
  ) {
    return "name_and_condition";
  }

  if (
    normalized.name === "blur" &&
    normalized.condition === "blur" &&
    normalized.nameplate === "blur"
  ) {
    return "blurred";
  }

  if (
    normalized.name === "hidden" &&
    normalized.condition === "hidden" &&
    normalized.nameplate === "hidden"
  ) {
    return "hidden";
  }

  if (normalized.name === "hidden" && normalized.condition === "public") {
    return "condition_only";
  }

  if (normalized.name === "public" && normalized.condition === "hidden") {
    return "name_only";
  }

  if (normalized.name === "public" && normalized.condition === "public") {
    return "name_and_condition";
  }

  if (
    normalized.name === "hidden" &&
    normalized.condition === "hidden" &&
    normalized.nameplate !== "public"
  ) {
    return "hidden";
  }

  return normalized.nameplate === "public" ? "name_and_condition" : "blurred";
}

function getTitleRevealVisibilityLabel(value) {
  return (
    TITLE_REVEAL_VISIBILITY_OPTIONS.find((item) => item.value === value)?.label ||
    "비공개"
  );
}

function formatTitleRevealConfigLabel(config, fallbackRevealMode = "condition_only") {
  const normalized = normalizeTitleRevealConfig(config, fallbackRevealMode);
  return Object.entries(TITLE_REVEAL_FIELD_LABELS)
    .map(
      ([key, label]) =>
        `${label} ${getTitleRevealVisibilityLabel(normalized[key])}`,
    )
    .join(" / ");
}

const TITLE_FAMILY_META = {
  plaque: {
    value: "plaque",
    label: "명패"
  },
  seal: {
    value: "seal",
    label: "인장"
  }
};

const TITLE_PALETTE_OPTIONS = [
{
  value: "sky",
  label: "스카이",
  tone: "blue",
  iconWrap: "bg-blue-100 text-blue-700",
  shell: "border-blue-200 bg-blue-50/70",
  profileClass: "border border-blue-200 bg-blue-100 text-blue-900",
  chipClass: "border border-blue-200 bg-white text-blue-800",
  rowClass: "border border-blue-200 bg-white text-blue-800",
  boardClass: "border border-blue-200 bg-white text-blue-800"
},
{
  value: "emerald",
  label: "에메랄드",
  tone: "emerald",
  iconWrap: "bg-emerald-100 text-emerald-700",
  shell: "border-emerald-200 bg-emerald-50/70",
  profileClass: "border border-emerald-200 bg-emerald-100 text-emerald-900",
  chipClass: "border border-emerald-200 bg-white text-emerald-800",
  rowClass: "border border-emerald-200 bg-white text-emerald-800",
  boardClass: "border border-emerald-200 bg-white text-emerald-800"
},
{
  value: "royal",
  label: "로열 골드",
  tone: "amber",
  iconWrap: "bg-amber-100 text-amber-700",
  shell: "border-amber-200 bg-amber-50/70",
  profileClass: "border border-amber-200 bg-amber-100 text-amber-900",
  chipClass: "border border-amber-200 bg-white text-amber-800",
  rowClass: "border border-amber-200 bg-white text-amber-800",
  boardClass: "border border-amber-200 bg-white text-amber-800"
},
{
  value: "rose",
  label: "로즈",
  tone: "red",
  iconWrap: "bg-rose-100 text-rose-700",
  shell: "border-rose-200 bg-rose-50/70",
  profileClass: "border border-rose-200 bg-rose-100 text-rose-900",
  chipClass: "border border-rose-200 bg-white text-rose-800",
  rowClass: "border border-rose-200 bg-white text-rose-800",
  boardClass: "border border-rose-200 bg-white text-rose-800"
},
{
  value: "violet",
  label: "바이올렛",
  tone: "violet",
  iconWrap: "bg-violet-100 text-violet-700",
  shell: "border-violet-200 bg-violet-50/70",
  profileClass: "border border-violet-200 bg-violet-100 text-violet-900",
  chipClass: "border border-violet-200 bg-white text-violet-800",
  rowClass: "border border-violet-200 bg-white text-violet-800",
  boardClass: "border border-violet-200 bg-white text-violet-800"
}];


const titleThemeMap = {
  common: {
    badgeTone: "slate",
    icon: Medal,
    shell:
    "border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(148,163,184,0.14),_transparent_28%),linear-gradient(135deg,_#ffffff,_#f8fafc_55%,_#eef2f7)]",
    iconWrap: "bg-slate-900 text-white",
    label: "깔끔하고 단정한 기본형"
  },
  rare: {
    badgeTone: "blue",
    icon: Sparkles,
    shell:
    "border-blue-200 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.18),_transparent_30%),linear-gradient(135deg,_#eff6ff,_#ffffff_54%,_#ecfeff)]",
    iconWrap: "bg-blue-600 text-white",
    label: "테두리와 포인트 색 강조"
  },
  epic: {
    badgeTone: "violet",
    icon: Award,
    shell:
    "border-violet-200 bg-[radial-gradient(circle_at_top_right,_rgba(168,85,247,0.2),_transparent_30%),linear-gradient(135deg,_#f5f3ff,_#ffffff_52%,_#fdf2f8)]",
    iconWrap: "bg-violet-600 text-white",
    label: "광택과 컬러 대비가 강한 수집형"
  },
  legendary: {
    badgeTone: "amber",
    icon: Crown,
    shell:
    "border-amber-200 bg-[radial-gradient(circle_at_top_right,_rgba(251,191,36,0.22),_transparent_30%),linear-gradient(135deg,_#fff7ed,_#ffffff_52%,_#fef3c7)]",
    iconWrap: "bg-amber-500 text-white",
    label: "빛 느낌이 있는 최상위 템플릿"
  }
};

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateValue(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parsePositiveInteger(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

function formatDate(value) {
  const date = toDateValue(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatDexNumber(value) {
  return String(Math.max(1, Number(value) || 1)).padStart(3, "0");
}

function getTitleCategoryLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "\uAE30\uD0C0";

  if (/^(title|certificate)-category-\d+$/i.test(normalized)) {
    return "\uBBF8\uBD84\uB958";
  }

  if (/^(title|certificate)-category-/i.test(normalized)) {
    const cleaned = normalized
      .replace(/^(title|certificate)-category-/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return cleaned || "\uBBF8\uBD84\uB958";
  }

  return normalized;
}

function getTitleDefinitionSortOrder(item) {
  return parsePositiveInteger(item?.displayOrder);
}

function compareTitleDefinitions(left, right) {
  const leftOrder = getTitleDefinitionSortOrder(left);
  const rightOrder = getTitleDefinitionSortOrder(right);

  if (leftOrder !== null || rightOrder !== null) {
    return (
      (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER) ||
      String(left?.name || "").localeCompare(String(right?.name || ""), "ko") ||
      toMillis(left?.createdAt) - toMillis(right?.createdAt));

  }

  return (
    String(left?.name || "").localeCompare(String(right?.name || ""), "ko") ||
    toMillis(left?.createdAt) - toMillis(right?.createdAt));

}

function getTitleEquippedOrder(item = {}) {
  const explicitOrder = parsePositiveInteger(item?.equippedOrder);
  if (explicitOrder) return explicitOrder;
  return item?.equipped ? 1 : null;
}

function compareOwnedTitlePriority(left, right) {
  const leftEquipped = Number(Boolean(left?.equipped));
  const rightEquipped = Number(Boolean(right?.equipped));

  return (
    rightEquipped - leftEquipped ||
    (getTitleEquippedOrder(left) ?? Number.MAX_SAFE_INTEGER) - (
    getTitleEquippedOrder(right) ?? Number.MAX_SAFE_INTEGER) ||
    toMillis(right?.obtainedAt || right?.createdAt) -
    toMillis(left?.obtainedAt || left?.createdAt) ||
    String(left?.name || left?.titleName || "").localeCompare(
      String(right?.name || right?.titleName || ""),
      "ko"
    ));

}

function sortEquippedTitleRecords(items = []) {
  return [...items]
  .filter((item) => item?.equipped)
  .sort(compareOwnedTitlePriority)
  .slice(0, MAX_REPRESENTATIVE_TITLES);
}

const TITLE_CATEGORY_ICON_KEYS = [
"Tag",
"BookOpen",
"AcademicCap",
"Sparkles",
"Star",
"Trophy",
"Gift",
"ShoppingCart",
"Newspaper",
"Heart",
"Ticket",
"Backpack"];


const TITLE_CATEGORY_COLOR_KEYS = [
"slate",
"blue",
"cyan",
"indigo",
"emerald",
"green",
"orange",
"red",
"purple",
"rose",
"violet"];

const TITLE_CATEGORY_ICON_KEY_SET = new Set(TITLE_CATEGORY_ICON_KEYS);
const TITLE_CATEGORY_COLOR_KEY_SET = new Set(TITLE_CATEGORY_COLOR_KEYS);

function normalizeTitleCategoryId(value, fallbackIndex = 0) {
  const rawValue = String(value || "")
    .trim()
    .toLowerCase();

  if (!rawValue) return `title-category-${fallbackIndex + 1}`;

  const asciiSlug = rawValue
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  return asciiSlug || `title-category-${fallbackIndex + 1}`;
}

function pickTitleCategoryIconKey(source, fallback) {
  const candidate = source?.iconKey || source?.icon || source?.categoryIconKey;
  return TITLE_CATEGORY_ICON_KEY_SET.has(candidate) ? candidate : fallback;
}

function pickTitleCategoryColorKey(source, fallback) {
  const candidate = source?.colorKey || source?.tone || source?.categoryColorKey;
  return TITLE_CATEGORY_COLOR_KEY_SET.has(candidate) ? candidate : fallback;
}

function normalizeTitleCategoryList(items = [], fallbackValues = []) {
  const normalized = [];
  const byId = new Map();
  const byLabel = new Map();

  const appendCategory = (sourceItem, sourceIndex, isFallback = false) => {
    const source =
      sourceItem && typeof sourceItem === "object" && !Array.isArray(sourceItem)
        ? sourceItem
        : { label: sourceItem };
    const label = String(
      source?.label || source?.name || source?.category || "",
    ).trim();

    if (!label) return;

    const preferredId = String(source?.id || "").trim();
    let candidateId = preferredId || normalizeTitleCategoryId(label, sourceIndex);
    const labelKey = label.toLowerCase();
    const duplicateIdIndex = byId.get(candidateId);
    const duplicateIdItem =
      duplicateIdIndex >= 0 ? normalized[duplicateIdIndex] : null;

    if (
      duplicateIdItem &&
      duplicateIdItem.label.toLowerCase() !== labelKey
    ) {
      const baseCandidateId = candidateId;
      let suffix = sourceIndex + 1;
      do {
        candidateId = `${baseCandidateId}-${suffix}`;
        suffix += 1;
      } while (byId.has(candidateId));
    }

    const existingIndex =
      byId.get(candidateId) ?? byLabel.get(labelKey) ?? -1;
    const paletteIndex =
      existingIndex >= 0 ? existingIndex : normalized.length;
    const defaultIconKey =
      TITLE_CATEGORY_ICON_KEYS[paletteIndex % TITLE_CATEGORY_ICON_KEYS.length];
    const defaultColorKey =
      TITLE_CATEGORY_COLOR_KEYS[paletteIndex % TITLE_CATEGORY_COLOR_KEYS.length];
    const existing = existingIndex >= 0 ? normalized[existingIndex] : null;
    const nextItem = {
      id: candidateId,
      label,
      iconKey: pickTitleCategoryIconKey(
        source,
        existing?.iconKey || defaultIconKey,
      ),
      colorKey: pickTitleCategoryColorKey(
        source,
        existing?.colorKey || defaultColorKey,
      ),
      order: parsePositiveInteger(source?.order) || paletteIndex + 1,
      isFallback: Boolean(isFallback && !existing),
    };

    if (existingIndex >= 0) {
      normalized[existingIndex] = {
        ...existing,
        ...nextItem,
        isFallback: Boolean(existing.isFallback && isFallback),
        id: existing.id || nextItem.id,
        order: Math.min(
          parsePositiveInteger(existing.order) || Number.MAX_SAFE_INTEGER,
          nextItem.order,
        ),
      };
      byId.set(normalized[existingIndex].id, existingIndex);
      byLabel.set(normalized[existingIndex].label.toLowerCase(), existingIndex);
      return;
    }

    const nextIndex = normalized.length;
    normalized.push(nextItem);
    byId.set(nextItem.id, nextIndex);
    byLabel.set(nextItem.label.toLowerCase(), nextIndex);
  };

  items.forEach((item, index) => appendCategory(item, index, Boolean(item?.isFallback)));
  fallbackValues.forEach((item, index) =>
    appendCategory(item, items.length + index, true),
  );

  return normalized
    .sort(
      (left, right) =>
        (parsePositiveInteger(left.order) ?? Number.MAX_SAFE_INTEGER) -
          (parsePositiveInteger(right.order) ?? Number.MAX_SAFE_INTEGER) ||
        left.label.localeCompare(right.label, "ko"),
    )
    .map((item, index) => ({
      ...item,
      order: index + 1,
    }));
}

function getTitleCategoryMeta(categories = [], value) {
  const normalizedCategories = normalizeTitleCategoryList(categories);
  const rawValue =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : { id: value, label: value };
  const preferredId = String(rawValue?.id || "").trim();
  const preferredLabel = String(
    rawValue?.label || rawValue?.name || rawValue?.category || "",
  ).trim();

  const matchedCategory =
    normalizedCategories.find((item) => item.id === preferredId) ||
    normalizedCategories.find((item) => item.label === preferredLabel) ||
    normalizedCategories.find(
      (item) => item.label.toLowerCase() === preferredLabel.toLowerCase(),
    ) ||
    null;

  if (matchedCategory) return matchedCategory;

  const fallbackLabel = preferredLabel || "기타";
  return {
    id: preferredId || normalizeTitleCategoryId(fallbackLabel),
    label: fallbackLabel,
    iconKey: TITLE_CATEGORY_ICON_KEYS[0],
    colorKey: TITLE_CATEGORY_COLOR_KEYS[0],
    order: normalizedCategories.length + 1,
  };
}

function buildTitleCategoryChipItems(items = [], categoryOrder = []) {
  const configuredCategories = normalizeTitleCategoryList(categoryOrder);
  const categoryMap = new Map();
  const configuredCategoryMeta = new Map(
    configuredCategories.map((item) => [item.id, item]),
  );

  items.forEach((item) => {
    const categoryMeta = getTitleCategoryMeta(
      configuredCategories,
      item?.categoryId || item?.category,
    );
    const existing = categoryMap.get(categoryMeta.id) || {
      id: categoryMeta.id,
      label: categoryMeta.label,
      iconKey: categoryMeta.iconKey,
      colorKey: categoryMeta.colorKey,
      order: Number.MAX_SAFE_INTEGER,
      fallbackOrder: Number.MAX_SAFE_INTEGER,
      count: 0,
    };
    const sortOrder = getTitleDefinitionSortOrder(item);
    const configuredMeta = configuredCategoryMeta.get(categoryMeta.id);

    categoryMap.set(categoryMeta.id, {
      ...existing,
      label: categoryMeta.label,
      iconKey: configuredMeta?.iconKey || categoryMeta.iconKey,
      colorKey: configuredMeta?.colorKey || categoryMeta.colorKey,
      count: existing.count + 1,
      order: Math.min(
        existing.order,
        configuredMeta?.order ?? Number.MAX_SAFE_INTEGER,
      ),
      fallbackOrder: Math.min(
        existing.fallbackOrder,
        sortOrder ?? Number.MAX_SAFE_INTEGER,
      ),
    });
  });

  const orderedCategories = [...categoryMap.values()].sort(
    (left, right) =>
      left.order - right.order ||
      left.fallbackOrder - right.fallbackOrder ||
      left.label.localeCompare(right.label, "ko"),
  );

  return [
    {
      id: "all",
      label: "전체",
      iconKey: "Bars2",
      colorKey: "slate",
      locked: true,
    },
    ...orderedCategories.map((item) => ({
      id: item.id,
      label: item.label,
      iconKey: item.iconKey || TITLE_CATEGORY_ICON_KEYS[0],
      colorKey: item.colorKey || TITLE_CATEGORY_COLOR_KEYS[0],
    })),
  ];
}

async function commitWriteOperations(operations = [], batchSize = 400) {
  const validOperations = operations.filter(Boolean);

  for (let index = 0; index < validOperations.length; index += batchSize) {
    const batch = writeBatch(db);
    const currentBatch = validOperations.slice(index, index + batchSize);

    currentBatch.forEach((operation) => {
      if (operation.type === "set") {
        batch.set(operation.ref, operation.data, operation.options);
        return;
      }
      if (operation.type === "update") {
        batch.update(operation.ref, operation.data);
        return;
      }
      if (operation.type === "delete") {
        batch.delete(operation.ref);
      }
    });

    await batch.commit();
  }
}

function normalizeSnapshot(snapshot) {
  return snapshot.docs.map((snapshotDoc) => ({
    id: snapshotDoc.id,
    ...snapshotDoc.data()
  }));
}

function normalizeBadgeTone(value) {
  return GRADE_TONE_OPTIONS.some((option) => option.value === value) ? value : "slate";
}

function normalizeGradeList(grades, fallbackGrades) {
  const fallback = fallbackGrades.map((item, index) => ({
    ...item,
    label: String(item.label || `등급 ${index + 1}`).trim(),
    tone: normalizeBadgeTone(item.tone),
    order: index + 1
  }));

  if (!Array.isArray(grades) || !grades.length) return fallback;

  const usedIds = new Set();
  const normalized = grades
  .map((item, index) => {
    const preferredId =
    String(item?.id || "").trim() || fallback[index]?.id || `grade-${index + 1}`;
    const id = usedIds.has(preferredId) ? `${preferredId}-${index + 1}` : preferredId;
    usedIds.add(id);

    const fallbackMatch =
    fallback.find((grade) => grade.id === preferredId) ||
    fallback.find((grade) => grade.id === id) ||
    fallback[index];

    return {
      id,
      label: String(item?.label || fallbackMatch?.label || `등급 ${index + 1}`).trim(),
      tone: normalizeBadgeTone(item?.tone || fallbackMatch?.tone || "slate"),
      order: index + 1
    };
  })
  .filter((item) => item.label);

  return normalized.length ? normalized : fallback;
}

function reorderGradeList(list, fromIndex, toIndex) {
  if (!Array.isArray(list)) return [];
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return list;
  if (fromIndex >= list.length || toIndex >= list.length) return list;

  const nextList = [...list];
  const [moved] = nextList.splice(fromIndex, 1);
  nextList.splice(toIndex, 0, moved);

  return nextList.map((item, index) => ({
    ...item,
    order: index + 1
  }));
}

function getGradeMeta(grades, gradeId, fallbackId = "") {
  const normalizedGrades = Array.isArray(grades) ? grades : [];
  return (
    normalizedGrades.find((item) => item.id === gradeId) ||
    normalizedGrades.find((item) => item.id === fallbackId) ||
    normalizedGrades[0] || {
      id: fallbackId || "grade",
      label: "등급",
      tone: "slate",
      order: 1
    });

}

function buildGradeOptions(grades) {
  return grades.map((item) => ({
    value: item.id,
    label: item.label
  }));
}

function createGradeDraft(prefix, index) {
  return {
    id: `${prefix}-${Date.now()}-${index + 1}`,
    label: `${prefix === "title" ? "칭호" : "자격증"} 등급 ${index + 1}`,
    tone: "slate",
    order: index + 1
  };
}

function getTitleRequestStatusMeta(status) {
  return titleRequestStatusMap[status || "pending"] || titleRequestStatusMap.pending;
}

function getTitleRevealMeta(entry) {
  const isOwnedTitle = Boolean(
    entry?.ownedId ||
    entry?.equipped ||
    entry?.obtainedAt ||
    entry?.issuedAt
  );
  const revealConfig = normalizeTitleRevealConfig(
    entry?.revealConfig,
    entry?.revealMode || "condition_only",
  );
  const fallbackHint =
  entry?.acquisitionCondition ||
  titleSourceHintMap[entry?.sourceType] ||
  "획득 조건을 확인하고 도전해 보세요.";

  if (isOwnedTitle) {
    return {
      displayName: entry?.name || "이름 없는 칭호",
      displayHint: entry?.description || fallbackHint,
      hideName: false,
      hideHint: false,
      blurName: false,
      blurHint: false,
      concealNameplate: false,
      mutedNameplate: false,
    };
  }

  return {
    displayName:
      revealConfig.name === "hidden"
        ? "숨겨진 칭호"
        : entry?.name || "이름 없는 칭호",
    displayHint:
      revealConfig.condition === "hidden"
        ? "획득 조건은 비공개로 설정되어 있습니다."
        : fallbackHint,
    hideName: revealConfig.name === "hidden",
    hideHint: revealConfig.condition === "hidden",
    blurName: revealConfig.name === "blur",
    blurHint: revealConfig.condition === "blur",
    concealNameplate: revealConfig.nameplate === "hidden",
    mutedNameplate: revealConfig.nameplate === "blur",
  };
}

function normalizeUploadLookupKey(value) {
  return String(value || "")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, "");
}

function resolveTitleGradeFromUpload(value, grades, fallbackId) {
  const normalized = normalizeUploadLookupKey(value);
  const fallbackGrade = getGradeMeta(grades, fallbackId, fallbackId);

  if (!normalized) {
    return { gradeId: fallbackGrade.id, gradeLabel: fallbackGrade.label, errorMessage: "" };
  }

  const matchedGrade = grades.find(
    (item) =>
    normalizeUploadLookupKey(item.id) === normalized ||
    normalizeUploadLookupKey(item.label) === normalized
  );

  if (matchedGrade) {
    return { gradeId: matchedGrade.id, gradeLabel: matchedGrade.label, errorMessage: "" };
  }

  return {
    gradeId: fallbackGrade.id,
    gradeLabel: fallbackGrade.label,
    errorMessage: "등급명을 확인해 주세요."
  };
}

function buildStudentLabel(student) {
  if (!student) return "학생 정보 없음";
  return student.name || student.displayName || student.uid || "이름 없음";
}

function buildCertificateStatus(item) {
  if (item.isRevoked) return { label: "회수됨", tone: "red" };
  const expiresAt = toDateValue(item.expiresAt);
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return { label: "만료됨", tone: "amber" };
  }
  return { label: "유효", tone: "emerald" };
}

function EmptyState({ icon: Icon, title, description, action = null }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
      {Icon ?
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
          <Icon className="h-6 w-6" />
        </div> :
      null}
      <p className="mt-4 text-lg font-bold text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>);

}

function SummaryMetric({ label, value, description, tone = "slate" }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-500">{label}</p>
        <Badge tone={tone}>{value}</Badge>
      </div>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </div>);

}

function getTitleIcon(iconId, rarity = "common") {
  const iconMap = {
    award: Award,
    crown: Crown,
    medal: Medal,
    sparkles: Sparkles,
    shield: ShieldCheck,
    star: Star
  };

  return iconMap[iconId] || titleThemeMap[rarity]?.icon || Medal;
}

function getTitlePalette(paletteId, rarity = "common") {
  const paletteMap = new Map(TITLE_PALETTE_OPTIONS.map((item) => [item.value, item]));
  const rarityFallbackMap = {
    common: "sky",
    rare: "sky",
    epic: "violet",
    legendary: "royal"
  };

  return (
    paletteMap.get(paletteId) ||
    paletteMap.get(rarityFallbackMap[rarity]) ||
    TITLE_PALETTE_OPTIONS[0]);

}

function getTitleFamily(familyId) {
  if (familyId === "seal") return TITLE_FAMILY_META.seal;
  return TITLE_FAMILY_META.plaque;
}

function getTitleTheme(rarity) {
  return titleThemeMap[rarity] || titleThemeMap.common;
}

function getTitleBadgeVariant(item = {}) {
  const palette = getTitlePalette(item.paletteId, item.rarity);
  const family = getTitleFamily(item.familyId);
  return {
    shape: family.value,
    tone: palette.tone,
    icon: getTitleIcon(item.iconId || item.icon, item.rarity),
    profileClass: palette.profileClass,
    chipClass: palette.chipClass,
    rowClass: palette.rowClass,
    boardClass: palette.boardClass
  };
}

function getTitleSurfaceTheme(item = {}) {
  const fallbackTheme = getTitleTheme(item.rarity);
  const palette = getTitlePalette(item.paletteId, item.rarity);

  return {
    badgeTone: palette.tone || fallbackTheme.badgeTone,
    icon: getTitleIcon(item.iconId || item.icon, item.rarity),
    shell: palette.shell || fallbackTheme.shell,
    iconWrap: palette.iconWrap || fallbackTheme.iconWrap
  };
}

function buildTitleCollectionStage(rate, stages = DEFAULT_TITLE_COLLECTION_STAGES) {
  if (rate >= 100) return { label: "도감 마스터", tone: "도감 마스터" };
  if (rate >= 75) return { label: "상급 수집가", tone: "상급 수집가" };
  if (rate >= 40) return { label: "도전 수집가", tone: "도전 수집가" };
  if (rate > 0) return { label: "첫 발견", tone: "첫 발견" };
  return { label: "미등록", tone: "미등록" };
}

function SectionLead({ eyebrow, title, description, action = null }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ?
        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
            {eyebrow}
          </p> :
        null}
        <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">{title}</h3>
        {description ?
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p> :
        null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>);

}

function TitleShowcaseCard({
  item,
  action = null,
  statusSlot = null,
  locked = false,
  compact = false
}) {
  const theme = getTitleSurfaceTheme(item);
  const ThemeIcon = theme.icon;
  const badgeVariant = getTitleBadgeVariant(item);

  return (
    <div
      className={[
      "relative overflow-hidden rounded-[24px] border p-5 shadow-[0_16px_32px_-26px_rgba(15,23,42,0.28)]",
      theme.shell,
      compact ? "min-h-[210px]" : "min-h-[250px]"]
      .join(" ")}>
      
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent" />

      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm ${theme.iconWrap}`}>
              
              <ThemeIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
                TITLE
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                {item?.categoryLabel || "기본 칭호"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {item?.gradeLabel ? <Badge tone={item.gradeTone || "slate"}>{item.gradeLabel}</Badge> : null}
            {statusSlot}
          </div>
        </div>

        <div className="mt-6">
          <p className="text-2xl font-black tracking-tight text-slate-950">
            {item?.name || "이름 없는 칭호"}
          </p>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
            {item?.description || (
            locked ?
            "아직 지급되지 않은 칭호입니다." :
            "학생에게 보여 줄 설명이 아직 없습니다.")}
          </p>
          <div className="mt-4">
            <TitlePresetBadge
              variant={badgeVariant}
              label={locked ? "미발견 칭호" : item?.name || "칭호 배지"}
              mode="chip" />
            
          </div>
        </div>

        {action ? <div className="mt-auto flex flex-wrap gap-2 pt-6">{action}</div> : null}
      </div>
    </div>);

}

function TitlePresetBadge({ preset = null, variant = null, label, mode = "profile" }) {
  const resolved = variant || preset;
  const Icon = resolved.icon;
  const modeClassMap = {
    profile: resolved.profileClass,
    chip: resolved.chipClass,
    rank: resolved.rowClass,
    board: resolved.boardClass
  };
  const sizeMap = {
    profile: {
      wrap: "px-4 py-2.5 text-sm",
      icon: "h-4 w-4",
      gap: "gap-2"
    },
    chip: {
      wrap: "px-3 py-1.5 text-xs",
      icon: "h-3.5 w-3.5",
      gap: "gap-1.5"
    },
    rank: {
      wrap: "px-2.5 py-1 text-[11px]",
      icon: "h-3 w-3",
      gap: "gap-1"
    },
    board: {
      wrap: "px-2.5 py-1 text-[11px]",
      icon: "h-3 w-3",
      gap: "gap-1"
    }
  };
  const size = sizeMap[mode] || sizeMap.profile;
  const sharedClass = `${modeClassMap[mode]} ${size.wrap} ${size.gap}`;

  if (resolved.shape === "seal") {
    return (
      <div className={`inline-flex items-center rounded-full border border-current/20 ${sharedClass}`}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/70">
          <Icon className={size.icon} />
        </span>
        <span className="font-bold tracking-tight">{label}</span>
      </div>);

  }

  return (
    <div className={`inline-flex items-center rounded-xl border border-current/15 ${sharedClass}`}>
      <Icon className={size.icon} />
      <span className="font-bold tracking-tight">{label}</span>
    </div>);

}

function CertificateRecordCard({
  item,
  action = null,
  status = null,
  statusSlot = null,
  locked = false
}) {
  const tone = item?.gradeTone || levelToneMap[item?.level] || "blue";
  const hasStage = item?.gradeId !== CERTIFICATE_NO_STAGE_ID && Boolean(item?.gradeLabel);

  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-black tracking-tight text-slate-900">
              {item?.name || "이름 없는 자격증"}
            </p>
            {hasStage ? <Badge tone={tone}>{item.gradeLabel}</Badge> : null}
            {item?.categoryLabel || item?.category ? <Badge tone="blue">{item?.categoryLabel || item?.category}</Badge> : null}
            {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
            {statusSlot}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {item?.description || (
            locked ?
            "아직 발급되지 않은 자격증입니다." :
            "학생에게 보여 줄 설명이 아직 없습니다.")}
          </p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!locked ?
        <Badge tone="indigo">
            {certificateIssueMethodMap[item?.issueMethod] || item?.issueMethod || "수동 발급"}
          </Badge> :

        <Badge tone="slate" icon={Lock}>
            잠금 상태
          </Badge>
        }
        {item?.issuedAt ? <Badge tone="slate">발급일 {formatDate(item.issuedAt)}</Badge> : null}
        {item?.expiresAt ? <Badge tone="amber">만료 {formatDate(item.expiresAt)}</Badge> : null}
        {item?.createdAt ? <Badge tone="slate">생성일 {formatDate(item.createdAt)}</Badge> : null}
      </div>
    </div>);

}

function GradeSettingsModal({
  open,
  titleGrades,
  certificateGrades,
  onClose,
  onSubmit,
  isSubmitting
}) {
  const { showFeedback } = useFeedback();
  const [activeTab, setActiveTab] = useState(GRADE_SETTING_TABS[0].id);
  const [form, setForm] = useState({
    titleGrades: titleGrades || DEFAULT_TITLE_GRADES,
    certificateGrades: certificateGrades || DEFAULT_CERTIFICATE_GRADES
  });
  const [draggingGrade, setDraggingGrade] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      titleGrades: titleGrades || DEFAULT_TITLE_GRADES,
      certificateGrades: certificateGrades || DEFAULT_CERTIFICATE_GRADES
    });
    setActiveTab(GRADE_SETTING_TABS[0].id);
    setDraggingGrade(null);
  }, [certificateGrades, open, titleGrades]);

  const updateList = (key, updater) => {
    setForm((prev) => ({
      ...prev,
      [key]: updater(prev[key])
    }));
  };

  const moveGrade = (key, fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    updateList(key, (list) => reorderGradeList(list, fromIndex, toIndex));
    showFeedback("등급 순서를 변경했습니다. 저장하면 반영됩니다.", "success");
  };

  const removeGrade = (key, index) => {
    updateList(key, (list) => {
      if (list.length <= 1) return list;
      return list
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => ({
        ...item,
        order: itemIndex + 1
      }));
    });
  };

  const addGrade = (key, prefix) => {
    updateList(key, (list) => [
    ...list,
    createGradeDraft(prefix, list.length)]
    );
  };

  const updateGradeField = (key, index, field, value) => {
    updateList(key, (list) =>
    list.map((item, itemIndex) =>
    itemIndex === index ?
    {
      ...item,
      [field]: value
    } :
    item
    )
    );
  };

  const handleGradeDrop = (key, targetIndex) => {
    if (!draggingGrade || draggingGrade.key !== key) return;
    moveGrade(key, draggingGrade.index, targetIndex);
    setDraggingGrade(null);
  };

  const renderGradeList = (key, label, description, prefix) => {
    const items = form[key] || [];
    return (
      <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-900">{label}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            tone="blue"
            onClick={() => addGrade(key, prefix)}
            icon={Plus}
            disabled={isSubmitting}>
            
            등급 추가
          </Button>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-3 text-xs leading-5 text-slate-500">
          왼쪽 손잡이를 끌어 순서를 바꾸면 저장 후 그대로 반영됩니다.
        </div>

        <div className="space-y-3">
          {items.map((item, index) =>
          <div
            key={item.id}
            onDragOver={(event) => {
              if (!isSubmitting && draggingGrade?.key === key) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              handleGradeDrop(key, index);
            }}
            className={`rounded-2xl border border-white/90 bg-white p-4 shadow-sm transition ${
            draggingGrade?.key === key && draggingGrade.index === index ?
            "ring-2 ring-indigo-200 opacity-70" :
            "hover:border-slate-200"}`
            }>
            
              <div className="grid gap-3 lg:grid-cols-[auto,minmax(0,1fr),180px,auto]">
                <div className="flex items-start pt-6">
                  <button
                  type="button"
                  draggable={!isSubmitting}
                  onDragStart={() => setDraggingGrade({ key, index })}
                  onDragEnd={() => setDraggingGrade(null)}
                  disabled={isSubmitting}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-400 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
                  aria-label={`${label} ${index + 1}번 등급 순서 이동`}>
                  
                    <GripVertical className="h-4 w-4" />
                  </button>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">등급명</label>
                  <input
                  type="text"
                  value={item.label || ""}
                  onChange={(event) => updateGradeField(key, index, "label", event.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  placeholder="등급 이름 입력" />
                
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">배지 색상</label>
                  <select
                  value={item.tone || "slate"}
                  onChange={(event) => updateGradeField(key, index, "tone", event.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20">
                  
                    {GRADE_TONE_OPTIONS.map((option) =>
                  <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                  )}
                  </select>
                </div>
                <div className="flex items-end gap-2 justify-end">
                  <Button
                  size="sm"
                  variant="outline"
                  tone="red"
                  onClick={() => removeGrade(key, index)}
                  disabled={isSubmitting || items.length <= 1}
                  icon={Trash2}>
                  
                    삭제
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="slate">순서 {index + 1}</Badge>
                <Badge tone={normalizeBadgeTone(item.tone)}>{item.label || "미입력 등급"}</Badge>
              </div>
            </div>
          )}
        </div>
      </div>);

  };

  return (
    <Modal
      isOpen={open}
      onClose={isSubmitting ? undefined : onClose}
      title="칭호 자격증 등급 설정"
      size="lg">
      
      <div className="space-y-5">
        <Alert
          type="info"
          message="등급은 칭호와 자격증 정의에서만 편집됩니다. 이미 등록된 항목은 gradeId를 기준으로 연결되므로, 사용 중인 등급을 삭제하면 일부 항목이 미분류로 보일 수 있습니다." />
        
        <Tabs
          tabs={GRADE_SETTING_TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          variant="underline"
          size="md"
          className="w-full max-w-sm" />
        
        {activeTab === "titleGrades" ?
        renderGradeList(
          "titleGrades",
          "칭호 등급",
          "칭호는 도감과 명패에 함께 표시되므로 학생이 직관적으로 이해할 수 있는 이름이 좋습니다.",
          "title"
        ) :
        renderGradeList(
          "certificateGrades",
          "자격증 등급",
          "자격증은 단계형으로 보이는 경우가 많으므로 수준이나 권한 단계를 드러내는 이름이 잘 맞습니다.",
          "certificate"
        )}
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            onClick={() =>
            onSubmit({
              titleGrades: normalizeGradeList(form.titleGrades, DEFAULT_TITLE_GRADES),
              certificateGrades: normalizeGradeList(
                form.certificateGrades,
                DEFAULT_CERTIFICATE_GRADES
              )
            })
            }
            isLoading={isSubmitting}>
            
            저장
          </Button>
        </div>
      </div>
    </Modal>);

}

function DefinitionModal({
  type,
  open,
  initialData,
  onClose,
  onSubmit,
  isSubmitting,
  titleGradeOptions,
  certificateGradeOptions,
  titleCategoryOptions = []
}) {
  const isTitle = type === "title";
  const initialForm = isTitle ? EMPTY_TITLE_FORM : EMPTY_CERTIFICATE_FORM;
  const [form, setForm] = useState(initialForm);
  const [draftCategoryName, setDraftCategoryName] = useState("");
  const [localTitleCategoryOptions, setLocalTitleCategoryOptions] = useState([]);
  const { showFeedback } = useFeedback();

  useEffect(() => {
    if (!open) return;
    setForm(
      initialData ?
      isTitle ?
      {
        name: initialData.name || "",
        description: initialData.description || "",
        acquisitionCondition: initialData.acquisitionCondition || "",
        category: initialData.category || "",
        gradeId: initialData.gradeId || initialData.rarity || DEFAULT_TITLE_GRADES[0].id,
        revealMode: initialData.revealMode || "condition_only",
        rarity: "common",
        icon: initialData.icon || "none",
        familyId: initialData.familyId || "plaque",
        paletteId: initialData.paletteId || "sky",
        sourceType: "manual",
        allowStudentRequest: initialData.allowStudentRequest !== false,
        isVisible: initialData.isVisible !== false,
        isActive: initialData.isActive !== false
      } :
      {
        name: initialData.name || "",
        description: initialData.description || "",
        category: initialData.category || "",
        gradeId: initialData.gradeId || initialData.level || DEFAULT_CERTIFICATE_GRADES[0].id,
        level: initialData.level || initialData.gradeId || "basic",
        issueMethod: initialData.issueMethod || "manual",
        expiresEnabled: Boolean(initialData.expiresEnabled),
        isVisible: initialData.isVisible !== false,
        isActive: initialData.isActive !== false
      } :
      initialForm
    );
  }, [initialData, initialForm, isTitle, open]);

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const mergedTitleCategoryOptions = Array.from(
    new Map(
      [
        ...titleCategoryOptions,
        ...localTitleCategoryOptions,
        ...(form.category ? [{ value: form.category, label: form.category }] : []),
      ]
        .map((item) => ({
          value: String(item?.value || "").trim(),
          label: String(item?.label || item?.value || "").trim()
        }))
        .filter((item) => item.value)
        .map((item) => [item.value, item])
    ).values()
  );

  const handleAddTitleCategory = () => {
    const nextCategoryName = String(draftCategoryName || "").trim();

    if (!nextCategoryName) {
      showFeedback("새 카테고리 이름을 입력해 주세요.", "warning");
      return;
    }

    setLocalTitleCategoryOptions((prev) => {
      if (prev.some((item) => item.value === nextCategoryName)) return prev;
      return [...prev, { value: nextCategoryName, label: nextCategoryName }];
    });
    setField("category", nextCategoryName);
    setDraftCategoryName("");
  };

  const handleSubmit = () => {
    const payload = {
      ...form,
      name: String(form.name || "").trim(),
      description: String(form.description || "").trim(),
      acquisitionCondition: String(form.acquisitionCondition || "").trim(),
      category: String(form.category || "").trim(),
      icon: String(form.icon || "").trim()
    };

    if (isTitle && !payload.category) {
      showFeedback("칭호 카테고리를 선택하거나 새로 추가해 주세요.", "warning");
      return;
    }

    onSubmit(payload);
  };

  void mergedTitleCategoryOptions;
  void handleAddTitleCategory;
  void handleSubmit;

  return (
    <Modal
      isOpen={open}
      onClose={isSubmitting ? undefined : onClose}
      title={
      isTitle ?
      initialData ?
      "칭호 수정" :
      "칭호 생성" :
      initialData ?
      "자격증 수정" :
      "자격증 생성"
      }
      size="md">
      
      <div className="space-y-5">
        <InputField
          label={isTitle ? "칭호명" : "자격증명"}
          value={form.name || ""}
          onChange={(event) => setField("name", event.target.value)}
          placeholder={isTitle ? "칭호 이름을 입력하세요" : "자격증 이름을 입력하세요"}
          disabled={isSubmitting} />
        
        {isTitle ?
        <>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">칭호 획득 조건</label>
              <Textarea
              rows={3}
              value={form.acquisitionCondition || ""}
              onChange={(event) => setField("acquisitionCondition", event.target.value)}
              placeholder="예: 주간 투자 수익률을 1위로 달성하고 수익 발표까지 완료"
              disabled={isSubmitting} />
            
              <p className="text-xs text-slate-500">
                학생 화면에서는 미발견 상태일 때 이름 대신 조건만 보이고, 달성 후 지급 요청을 보낼 수 있습니다.
              </p>
            </div>
            <div className="space-y-5 rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                <p className="text-sm font-semibold text-slate-800">칭호 디자인 안내</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  현재 칭호 디자인은 기본 형식으로 고정되어 있습니다. 지금은 카테고리, 등급, 공개 방식처럼
                  운영에 필요한 설정만 관리합니다.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <InputField
                label="카테고리"
                value={form.category || ""}
                onChange={(event) => setField("category", event.target.value)}
                placeholder="예: 예금, 주식, 소비"
                disabled={isSubmitting} />
              
                <SelectField
                label="등급"
                value={form.gradeId || DEFAULT_TITLE_GRADES[0].id}
                onChange={(event) => setField("gradeId", event.target.value)}
                options={titleGradeOptions}
                disabled={isSubmitting} />
              
              </div>
              <SelectField
              label="학생 공개 방식"
              value={form.revealMode || "condition_only"}
              onChange={(event) => setField("revealMode", event.target.value)}
              options={TITLE_REVEAL_MODE_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label
              }))}
              disabled={isSubmitting} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-800">학생 화면 공개 방식 안내</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {(TITLE_REVEAL_MODE_OPTIONS.find((item) => item.value === form.revealMode) || TITLE_REVEAL_MODE_OPTIONS[0]).description}
              </p>
            </div>
          </> :

        <>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">설명</label>
              <Textarea
              rows={4}
              value={form.description || ""}
              onChange={(event) => setField("description", event.target.value)}
              disabled={isSubmitting} />
            
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <InputField
              label="분야"
              value={form.category || ""}
              onChange={(event) => setField("category", event.target.value)}
              placeholder="예: 금융"
              disabled={isSubmitting} />
            
              <SelectField
              label="등급"
              value={form.gradeId || DEFAULT_CERTIFICATE_GRADES[0].id}
              onChange={(event) => {
                setField("gradeId", event.target.value);
                setField("level", event.target.value);
              }}
              options={certificateGradeOptions}
              disabled={isSubmitting} />
            
            </div>
            <SelectField
            label="발급 방식"
            value={form.issueMethod || "manual"}
            onChange={(event) => setField("issueMethod", event.target.value)}
            options={CERTIFICATE_OPTIONS.issueMethod}
            disabled={isSubmitting} />
          
          </>
        }
        <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
          {!isTitle ?
          <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">유효기간 사용</p>
                <p className="text-xs text-slate-500">
                  발급 시 만료일을 함께 입력할 수 있습니다.
                </p>
              </div>
              <ToggleSwitch
              checked={Boolean(form.expiresEnabled)}
              onChange={(checked) => setField("expiresEnabled", checked)}
              disabled={isSubmitting} />
            
            </div> :
          null}
          {isTitle ?
          <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">학생 요청 허용</p>
                <p className="text-xs text-slate-500">
                  학생이 조건을 달성했다고 판단하면 교사에게 지급 요청을 보낼 수 있습니다.
                </p>
              </div>
              <ToggleSwitch
              checked={form.allowStudentRequest !== false}
              onChange={(checked) => setField("allowStudentRequest", checked)}
              disabled={isSubmitting} />
            
            </div> :
          null}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">학생 공개</p>
              <p className="text-xs text-slate-500">
                비활성화하면 학생 화면 잠금 목록에서 숨겨집니다.
              </p>
            </div>
            <ToggleSwitch
              checked={form.isVisible !== false}
              onChange={(checked) => setField("isVisible", checked)}
              disabled={isSubmitting} />
            
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">정의 활성화</p>
              <p className="text-xs text-slate-500">
                비활성화하면 새 지급·발급 대상에서는 제외됩니다.
              </p>
            </div>
            <ToggleSwitch
              checked={form.isActive !== false}
              onChange={(checked) => setField("isActive", checked)}
              disabled={isSubmitting} />
            
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            onClick={() =>
            onSubmit({
              ...form,
              name: String(form.name || "").trim(),
              description: String(form.description || "").trim(),
              acquisitionCondition: String(form.acquisitionCondition || "").trim(),
              category: String(form.category || "").trim(),
              icon: String(form.icon || "").trim()
            })
            }
            isLoading={isSubmitting}>
            
            {initialData ? "수정" : "등록"}
          </Button>
        </div>
      </div>
    </Modal>);

}







export {
  TAB_ITEMS,
  PREVIEW_MODE_TABS,
  STUDENT_DEX_FILTER_TABS,
  MAX_REPRESENTATIVE_TITLES,
  DEFAULT_TITLE_GRADES,
  DEFAULT_CERTIFICATE_GRADES,
  CERTIFICATE_NO_STAGE_ID,
  CERTIFICATE_NO_STAGE_OPTION,
  DEFAULT_TITLE_COLLECTION_STAGES,
  titleSourceLabelMap,
  toMillis,
  toDateValue,
  parsePositiveInteger,
  formatDate,
  formatDexNumber,
  normalizeTitleCategoryId,
  normalizeTitleCategoryList,
  getTitleCategoryMeta,
  getTitleCategoryLabel,
  getTitleDefinitionSortOrder,
  compareTitleDefinitions,
  getTitleEquippedOrder,
  compareOwnedTitlePriority,
  sortEquippedTitleRecords,
  buildTitleCategoryChipItems,
  normalizeSnapshot,
  normalizeGradeList,
  getGradeMeta,
  buildGradeOptions,
  commitWriteOperations,
  getTitleRequestStatusMeta,
  getTitleRevealMeta,
  buildStudentLabel,
  buildCertificateStatus,
  EmptyState,
  SummaryMetric,
  getTitleSurfaceTheme,
  buildTitleCollectionStage,
  normalizeUploadLookupKey,
  resolveTitleGradeFromUpload,
  SectionLead,
  TITLE_REVEAL_MODE_OPTIONS,
  TITLE_REVEAL_VISIBILITY_OPTIONS,
  DEFAULT_TITLE_REVEAL_CONFIG,
  legacyRevealModeToConfig,
  normalizeTitleRevealConfig,
  deriveLegacyTitleRevealMode,
  formatTitleRevealConfigLabel,
  TitleShowcaseCard,
  CertificateRecordCard,
  GradeSettingsModal,
  DefinitionModal };
