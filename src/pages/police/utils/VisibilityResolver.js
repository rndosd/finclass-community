import { getRuleVisibilityLevel } from "./visibilityConfig";
import { resolvePoliceHistoryType } from "./historyRecordType";

const getStudentUid = (record = {}) =>
  record.studentUid ?? record.accusedStudentUid;

const getStudentName = (record = {}) =>
  record.studentName ?? record.accusedStudentName;

const isReportRecord = (record = {}) => record.accusedStudentUid != null;

const getRecordId = (record = {}) =>
  record.id ?? record.fineId ?? record.reportId ?? "unknown";

const getVisibilityContext = (record = {}) =>
  isReportRecord(record) ? "reports" : "history";

const getDebugEnabled = () => {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage?.getItem("debugVisibility") === "1"
    );
  } catch (_error) {
    return false;
  }
};

const debugLog = (...args) => {
  if (getDebugEnabled()) {
    console.debug(...args);
  }
};

export function resolveVisibility({ viewer, fine, rule, settings }) {
  const targetStudentUid = getStudentUid(fine);
  const isOwner = Boolean(viewer?.uid && targetStudentUid === viewer.uid);
  const isReporter = Boolean(viewer?.uid && fine?.reporterUid === viewer.uid);
  const isTeacher = viewer?.role === "teacher";
  const isPoliceAdmin = Boolean(viewer?.isPoliceAdmin);
  const context = getVisibilityContext(fine);
  const ruleId = String(rule?.id || fine?.ruleId || "");
  const isSensitiveRecord = fine?.isSensitive || rule?.sensitive;

  if (isSensitiveRecord) {
    const result =
      isTeacher || isReporter || (context === "history" && isOwner)
        ? "detail"
        : "hide";

    debugLog("[visibility] sensitive", {
      id: getRecordId(fine),
      ruleId,
      context,
      isOwner,
      isReporter,
      isTeacher,
      result,
    });

    return result;
  }

  if (isTeacher || isOwner || isReporter) {
    debugLog("[visibility] owner-or-reporter", {
      id: getRecordId(fine),
      ruleId,
      context,
      isOwner,
      isReporter,
      isTeacher,
      result: "detail",
    });

    return "detail";
  }

  const role = isPoliceAdmin ? "policeAdmin" : "student";
  const level = getRuleVisibilityLevel({
    settings,
    role,
    context,
    ruleId,
  });

  debugLog("[visibility] rule-level", {
    id: getRecordId(fine),
    ruleId,
    context,
    role,
    level,
  });

  return level === "hidden" ? "hide" : level;
}

export function presentFine({
  record,
  visibility,
  isOwner,
  isReporter,
}) {
  if (visibility === "hide") return null;

  const inferredType = resolvePoliceHistoryType(record);

  const base = {
    ...record,
    studentUid: getStudentUid(record),
    studentName: getStudentName(record),
    visibilityLevel: visibility === "summary" ? "summary" : "detail",
    visibilityContext: getVisibilityContext(record),
    isMyRecord: isOwner || isReporter,
    type: inferredType || record.type,
  };

  if (visibility !== "summary") {
    return base;
  }

  return {
    ...base,
    summaryOnly: true,
    ruleText: null,
    reportReason: null,
    reason: null,
    amountSigned: null,
    amount: null,
    creditChangeApplied: null,
    missionTokenChangeApplied: null,
  };
}

export function applyVisibilityToList(records = [], rules = [], viewer, settings) {
  const ruleMap = new Map((rules || []).map((rule) => [String(rule.id), rule]));
  const debugEnabled = getDebugEnabled();
  const stats = debugEnabled ? { detail: 0, summary: 0, hide: 0 } : null;

  const result = (records || [])
    .map((record) => {
      const rule = ruleMap.get(String(record.ruleId)) || {};
      const visibility = resolveVisibility({
        viewer,
        fine: record,
        rule,
        settings,
      });

      const isOwner = Boolean(viewer?.uid && getStudentUid(record) === viewer.uid);
      const isReporter = Boolean(viewer?.uid && record.reporterUid === viewer.uid);

      if (debugEnabled) {
        stats[visibility] += 1;
      }

      return presentFine({
        record,
        visibility,
        isOwner,
        isReporter,
      });
    })
    .filter(Boolean);

  if (debugEnabled) {
    console.debug("[visibility] summary", {
      total: (records || []).length,
      kept: result.length,
      ...stats,
      hasRuleVisibilityMatrix:
        settings?.ruleVisibilityMatrix != null ||
        settings?.visibilityByRule != null,
    });
  }

  return result;
}
