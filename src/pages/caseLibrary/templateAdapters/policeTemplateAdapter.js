import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebase";

function normalizeRuleNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeRuleText(value) {
  return String(value || "").trim();
}

function normalizeRuleNotes(value) {
  return String(value || "").trim();
}

function normalizeRuleType(rule = {}) {
  const explicitType = String(rule.type || "").trim();
  if (explicitType === "penalty" || explicitType === "reward") {
    return explicitType;
  }

  const fineAmount = normalizeRuleNumber(rule.fineAmount);
  const creditChange = normalizeRuleNumber(rule.creditChange);
  const missionTokenChange = normalizeRuleNumber(rule.missionTokenChange);
  return fineAmount < 0 || creditChange < 0 || missionTokenChange < 0
    ? "penalty"
    : "reward";
}

function normalizeDangerLevel(rule = {}) {
  const resolvedLevel = Number(rule?.dangerLevel);
  return Number.isFinite(resolvedLevel) && resolvedLevel > 0 ? resolvedLevel : 1;
}

export function buildPoliceTemplateRuleKey(rule = {}) {
  const parts = [
    normalizeRuleType(rule),
    normalizeRuleText(rule.text).toLowerCase(),
    normalizeRuleNumber(rule.fineAmount),
    normalizeRuleNumber(rule.creditChange),
    normalizeRuleNumber(rule.missionTokenChange),
    normalizeRuleNotes(rule.notes).toLowerCase(),
    normalizeDangerLevel(rule),
  ];

  return parts.join("::");
}

function normalizePoliceRuleRecord(rule = {}, fallbackOrder = 0) {
  const normalizedRule = {
    text: normalizeRuleText(rule.text),
    fineAmount: normalizeRuleNumber(rule.fineAmount),
    creditChange: normalizeRuleNumber(rule.creditChange),
    missionTokenChange: normalizeRuleNumber(rule.missionTokenChange),
    missionTokenEnabled:
      rule?.missionTokenEnabled === true ||
      normalizeRuleNumber(rule.missionTokenChange) !== 0,
    notes: normalizeRuleNotes(rule.notes),
    dangerLevel: normalizeDangerLevel(rule),
    type: normalizeRuleType(rule),
    order: normalizeRuleNumber(rule.order) || fallbackOrder,
  };

  return {
    ...normalizedRule,
    key: buildPoliceTemplateRuleKey(normalizedRule),
  };
}

function buildExportablePoliceRule(rule = {}) {
  return {
    text: rule.text,
    fineAmount: rule.fineAmount,
    creditChange: rule.creditChange,
    missionTokenEnabled: rule.missionTokenEnabled === true,
    missionTokenChange: rule.missionTokenChange,
    notes: rule.notes,
    dangerLevel: rule.dangerLevel,
  };
}

function getPoliceRulesCollection(classId) {
  return collection(db, "classes", classId, "policeRules");
}

export async function exportPoliceTemplatePayload({ classId, scopeIds = [] }) {
  if (!classId) {
    throw new Error("학급 정보가 없어 경찰 규칙 템플릿을 만들 수 없습니다.");
  }

  if (!scopeIds.includes("policeRules")) {
    return null;
  }

  const rulesSnapshot = await getDocs(
    query(getPoliceRulesCollection(classId), orderBy("order")),
  );

  const rules = rulesSnapshot.docs.map((ruleSnapshot, index) =>
    normalizePoliceRuleRecord(ruleSnapshot.data(), index + 1),
  );

  return {
    version: 1,
    pageType: "police",
    exportedAt: new Date().toISOString(),
    scopeIds: ["policeRules"],
    data: {
      rules: rules.map(buildExportablePoliceRule),
    },
  };
}

function buildIncomingRuleList(payload = {}) {
  return (payload?.data?.rules || [])
    .map((rule, index) => normalizePoliceRuleRecord(rule, index + 1))
    .filter((rule) => rule.text);
}

export async function applyPoliceTemplatePayload({
  classId,
  templatePayload,
  applyMode = "merge",
}) {
  if (!classId) {
    throw new Error("학급 정보가 없어 경찰 규칙 템플릿을 적용할 수 없습니다.");
  }

  if (!templatePayload?.data) {
    throw new Error("경찰 규칙 템플릿 데이터가 없습니다.");
  }

  const incomingRules = buildIncomingRuleList(templatePayload);
  if (incomingRules.length === 0) {
    return {
      pageType: "police",
      applyMode,
      rulesCreated: 0,
      rulesUpdated: 0,
      note: "가져올 경찰 규칙이 없습니다.",
    };
  }

  const rulesCollectionRef = getPoliceRulesCollection(classId);
  const existingRulesSnapshot = await getDocs(
    query(rulesCollectionRef, orderBy("order")),
  );

  const existingRules = existingRulesSnapshot.docs.map((ruleSnapshot, index) => ({
    id: ruleSnapshot.id,
    ...normalizePoliceRuleRecord(ruleSnapshot.data(), index + 1),
  }));

  const existingRuleByKey = new Map(
    existingRules.map((rule) => [rule.key, rule]),
  );

  const batch = writeBatch(db);
  let rulesCreated = 0;
  let rulesUpdated = 0;
  let nextOrder =
    existingRules.reduce(
      (maxOrder, rule) => Math.max(maxOrder, normalizeRuleNumber(rule.order)),
      0,
    ) + 1;

  incomingRules.forEach((rule) => {
    const matchedRule = existingRuleByKey.get(rule.key);

    if (matchedRule) {
      rulesUpdated += 1;
      batch.set(
        doc(rulesCollectionRef, matchedRule.id),
        {
          text: rule.text,
          fineAmount: rule.fineAmount,
          creditChange: rule.creditChange,
          missionTokenEnabled: rule.missionTokenEnabled === true,
          missionTokenChange: rule.missionTokenChange,
          notes: rule.notes,
          dangerLevel: rule.dangerLevel,
          type: rule.type,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    const nextRuleRef = doc(rulesCollectionRef);
    rulesCreated += 1;
    batch.set(nextRuleRef, {
      text: rule.text,
      fineAmount: rule.fineAmount,
      creditChange: rule.creditChange,
      missionTokenEnabled: rule.missionTokenEnabled === true,
      missionTokenChange: rule.missionTokenChange,
      notes: rule.notes,
      dangerLevel: rule.dangerLevel,
      type: rule.type,
      order: nextOrder,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    nextOrder += 1;
  });

  await batch.commit();

  return {
    pageType: "police",
    applyMode,
    rulesCreated,
    rulesUpdated,
    note: "",
  };
}
