export const VISIBILITY_LEVELS = ["hidden", "summary", "detail"];
export const VISIBILITY_ROLES = ["policeAdmin", "student"];
export const VISIBILITY_CONTEXTS = ["reports", "history"];

export const VISIBILITY_LEVEL_META = {
  hidden: {
    label: "비공개",
    description: "타인 건은 숨기고 본인 관련 내역만 예외로 보여줍니다.",
    tone:
      "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
    activeTone: "border-slate-900 bg-slate-900 text-white shadow-sm",
  },
  summary: {
    label: "요약",
    description: "신고자·처리자와 대상자 관계만 간단히 보여줍니다.",
    tone:
      "border-amber-200 bg-white text-amber-700 hover:border-amber-300 hover:text-amber-800",
    activeTone: "border-amber-500 bg-amber-500 text-white shadow-sm",
  },
  detail: {
    label: "상세",
    description: "사유, 규칙, 금액 같은 상세 정보까지 보여줍니다.",
    tone:
      "border-indigo-200 bg-white text-indigo-700 hover:border-indigo-300 hover:text-indigo-800",
    activeTone: "border-indigo-600 bg-indigo-600 text-white shadow-sm",
  },
};

export const VISIBILITY_ROLE_META = {
  policeAdmin: {
    label: "경찰 관리자",
    description: "권한 학생에게 공개되는 범위를 정합니다.",
  },
  student: {
    label: "일반 학생",
    description: "다른 학생에게 공개되는 범위를 정합니다.",
  },
};

export const VISIBILITY_CONTEXT_META = {
  reports: {
    label: "신고 접수 내역",
    description: "신고가 들어온 사실과 처리 상태를 보여주는 목록입니다.",
  },
  history: {
    label: "부과내역",
    description: "벌점과 보상 집행 내역을 보여주는 목록입니다.",
  },
};

export const DEFAULT_RULE_VISIBILITY = {
  policeAdmin: {
    reports: "detail",
    history: "detail",
  },
  student: {
    reports: "hidden",
    history: "hidden",
  },
};

export const createDefaultRuleVisibility = () => ({
  policeAdmin: {
    reports: DEFAULT_RULE_VISIBILITY.policeAdmin.reports,
    history: DEFAULT_RULE_VISIBILITY.policeAdmin.history,
  },
  student: {
    reports: DEFAULT_RULE_VISIBILITY.student.reports,
    history: DEFAULT_RULE_VISIBILITY.student.history,
  },
});

export const normalizeVisibilityLevel = (value, fallback = "hidden") =>
  VISIBILITY_LEVELS.includes(value) ? value : fallback;

export const getRuleVisibilityMap = (settings = {}) =>
  settings?.ruleVisibilityMatrix || settings?.visibilityByRule || {};

const getLegacyModeLevel = (mode, { summaryFallback = "summary" } = {}) => {
  if (mode === "public") return "detail";
  if (mode === "anonymized") return summaryFallback;
  return "hidden";
};

export const getLegacyRuleVisibilityLevel = ({
  settings = {},
  role = "student",
  context = "history",
  ruleId,
}) => {
  const normalizedRuleId = String(ruleId || "");
  const mode = settings?.policeVisibilityMode || "anonymized";
  const publishRuleIds = Array.isArray(settings?.publishRuleIds)
    ? settings.publishRuleIds.map(String)
    : [];
  const whitelist = new Set(publishRuleIds);
  const allowAdminRealName = settings?.adminRealNameForNonSensitive ?? true;
  const adminListOnlyView = settings?.adminListOnlyView === true;
  const isWhitelisted = whitelist.has(normalizedRuleId);

  if (role === "policeAdmin") {
    if (allowAdminRealName) {
      if (context === "history" && adminListOnlyView) return "summary";
      return "detail";
    }

    if (!isWhitelisted) return "hidden";
    const legacyLevel = getLegacyModeLevel(mode);
    if (context === "history" && adminListOnlyView && legacyLevel === "detail") {
      return "summary";
    }
    return legacyLevel;
  }

  if (context === "reports") {
    return "hidden";
  }

  if (!isWhitelisted) return "hidden";
  return getLegacyModeLevel(mode);
};

export const getRuleVisibilityLevel = ({
  settings = {},
  role = "student",
  context = "history",
  ruleId,
}) => {
  const normalizedRuleId = String(ruleId || "");
  const map = getRuleVisibilityMap(settings);
  const storedLevel = map?.[normalizedRuleId]?.[role]?.[context];

  if (VISIBILITY_LEVELS.includes(storedLevel)) {
    return storedLevel;
  }

  const defaultLevel =
    DEFAULT_RULE_VISIBILITY?.[role]?.[context] || DEFAULT_RULE_VISIBILITY.student.history;

  if (
    map &&
    Object.prototype.hasOwnProperty.call(map, normalizedRuleId)
  ) {
    return defaultLevel;
  }

  return getLegacyRuleVisibilityLevel({
    settings,
    role,
    context,
    ruleId: normalizedRuleId,
  });
};

export const buildRuleVisibilityState = ({
  policeRules = [],
  settings = {},
}) =>
  (Array.isArray(policeRules) ? policeRules : []).reduce((acc, rule) => {
    const ruleId = String(rule?.id || "");
    if (!ruleId) return acc;

    acc[ruleId] = {
      policeAdmin: {
        reports: getRuleVisibilityLevel({
          settings,
          role: "policeAdmin",
          context: "reports",
          ruleId,
        }),
        history: getRuleVisibilityLevel({
          settings,
          role: "policeAdmin",
          context: "history",
          ruleId,
        }),
      },
      student: {
        reports: getRuleVisibilityLevel({
          settings,
          role: "student",
          context: "reports",
          ruleId,
        }),
        history: getRuleVisibilityLevel({
          settings,
          role: "student",
          context: "history",
          ruleId,
        }),
      },
    };

    return acc;
  }, {});

export const sanitizeRuleVisibilityState = ({
  state = {},
  policeRules = [],
}) =>
  (Array.isArray(policeRules) ? policeRules : []).reduce((acc, rule) => {
    const ruleId = String(rule?.id || "");
    if (!ruleId) return acc;

    const current = state?.[ruleId] || createDefaultRuleVisibility();

    acc[ruleId] = {
      policeAdmin: {
        reports: normalizeVisibilityLevel(
          current?.policeAdmin?.reports,
          DEFAULT_RULE_VISIBILITY.policeAdmin.reports,
        ),
        history: normalizeVisibilityLevel(
          current?.policeAdmin?.history,
          DEFAULT_RULE_VISIBILITY.policeAdmin.history,
        ),
      },
      student: {
        reports: normalizeVisibilityLevel(
          current?.student?.reports,
          DEFAULT_RULE_VISIBILITY.student.reports,
        ),
        history: normalizeVisibilityLevel(
          current?.student?.history,
          DEFAULT_RULE_VISIBILITY.student.history,
        ),
      },
    };

    return acc;
  }, {});
