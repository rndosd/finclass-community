import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { getTaxPolicy } from "../../../utils/taxPolicy";

const TAX_TEMPLATE_SCOPE_IDS = new Set([
  "taxRules",
  "autoTaxPolicy",
  "incomeSettlement",
]);

const TAX_TREASURY_MODE_VALUES = new Set(["NONE", "TAX_ONLY", "TOTAL"]);
const TAX_RULE_ALLOWED_TARGET_TYPES = new Set(["all", "job"]);
const TAX_INCOME_SETTLEMENT_SOURCE_KEYS = [
  "missionReward",
  "policeReward",
  "assetAdjustment",
  "arcadePrize",
  "dividend",
  "stockCapitalGain",
];

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeNumber(value, fallback = 0, minimum = null, maximum = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  let nextValue = numericValue;
  if (minimum != null) {
    nextValue = Math.max(minimum, nextValue);
  }
  if (maximum != null) {
    nextValue = Math.min(maximum, nextValue);
  }
  return nextValue;
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeDateString(value) {
  if (!value) {
    return null;
  }

  const resolvedDate =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value);

  if (Number.isNaN(resolvedDate?.getTime?.())) {
    return null;
  }

  return resolvedDate.toISOString();
}

function getTimeValue(value) {
  if (!value) {
    return 0;
  }

  const resolvedDate =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value);

  return Number.isNaN(resolvedDate?.getTime?.()) ? 0 : resolvedDate.getTime();
}

function slugify(value) {
  const normalizedValue = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedValue || "tax-rule";
}

function resolveTemplateTaxRuleId(rule = {}, index = 0) {
  const explicitId = normalizeString(rule.id);
  if (explicitId) {
    return explicitId;
  }

  return `tax-rule-${slugify(rule.name)}-${index + 1}`;
}

function buildTaxRuleMatchKey(rule = {}) {
  return [
    normalizeString(rule.name).toLowerCase(),
    normalizeString(rule.targetType).toLowerCase(),
    normalizeString(rule.targetValue).toLowerCase(),
  ].join("::");
}

function resolveScopeIds(templatePayload = {}) {
  if (Array.isArray(templatePayload?.scopeIds) && templatePayload.scopeIds.length > 0) {
    return templatePayload.scopeIds.filter((scopeId) =>
      TAX_TEMPLATE_SCOPE_IDS.has(scopeId),
    );
  }

  return Object.keys(templatePayload?.data || {}).filter((scopeId) =>
    TAX_TEMPLATE_SCOPE_IDS.has(scopeId),
  );
}

function normalizeTaxTreasuryMode(value, fallback = "NONE") {
  const normalizedValue = normalizeString(value).toUpperCase();
  return TAX_TREASURY_MODE_VALUES.has(normalizedValue) ? normalizedValue : fallback;
}

function normalizeTaxRuleCalculationMode(rule = {}) {
  const nextMode = normalizeString(rule?.calculationMode).toLowerCase();

  if (
    nextMode === "flat_rate" ||
    nextMode === "flat_amount" ||
    nextMode === "rate_after_exemption" ||
    nextMode === "progressive"
  ) {
    return nextMode;
  }

  return normalizeString(rule?.type).toLowerCase() === "percent"
    ? "flat_rate"
    : "flat_amount";
}

function normalizeProgressiveBrackets(brackets = []) {
  if (!Array.isArray(brackets)) {
    return [];
  }

  const normalizedBrackets = [];
  let previousUpper = 0;
  let hasOpenEndedBracket = false;

  brackets.forEach((bracket) => {
    if (hasOpenEndedBracket) {
      return;
    }

    const rate = normalizeNumber(bracket?.rate, 0, 0);
    const rawUpper = bracket?.upToAmount;

    if (rawUpper === null || rawUpper === undefined || rawUpper === "") {
      normalizedBrackets.push({ upToAmount: null, rate });
      hasOpenEndedBracket = true;
      return;
    }

    const upToAmount = normalizeNumber(rawUpper, 0, 0);
    if (!(upToAmount > previousUpper)) {
      return;
    }

    normalizedBrackets.push({ upToAmount, rate });
    previousUpper = upToAmount;
  });

  return normalizedBrackets;
}

function buildTaxRuleLegacyFields(calculationMode, calculationConfig) {
  if (calculationMode === "flat_rate") {
    return {
      type: "percent",
      value: normalizeNumber(calculationConfig?.rate, 0, 0),
    };
  }

  if (calculationMode === "flat_amount") {
    return {
      type: "fixed",
      value: normalizeNumber(calculationConfig?.amount, 0, 0),
    };
  }

  return {
    type: "fixed",
    value: 0,
  };
}

function normalizeTaxRuleCalculationConfig(rule = {}, calculationMode) {
  const config =
    rule?.calculationConfig && typeof rule.calculationConfig === "object"
      ? rule.calculationConfig
      : {};

  if (calculationMode === "flat_rate") {
    return {
      rate: normalizeNumber(config.rate ?? rule?.value, 0, 0),
    };
  }

  if (calculationMode === "flat_amount") {
    return {
      amount: normalizeNumber(config.amount ?? rule?.value, 0, 0),
    };
  }

  if (calculationMode === "rate_after_exemption") {
    return {
      rate: normalizeNumber(config.rate, 0, 0),
      exemptionAmount: normalizeNumber(config.exemptionAmount, 0, 0),
    };
  }

  return {
    brackets: normalizeProgressiveBrackets(config.brackets),
  };
}

function normalizeTaxRuleRecord(rule = {}, index = 0) {
  const rawTargetType = normalizeString(rule?.targetType).toLowerCase() || "all";
  if (!TAX_RULE_ALLOWED_TARGET_TYPES.has(rawTargetType)) {
    return null;
  }

  const calculationMode = normalizeTaxRuleCalculationMode(rule);
  const calculationConfig = normalizeTaxRuleCalculationConfig(rule, calculationMode);
  const legacyFields = buildTaxRuleLegacyFields(calculationMode, calculationConfig);
  const targetValue =
    rawTargetType === "job" ? normalizeString(rule?.targetValue) : null;

  if (rawTargetType === "job" && !targetValue) {
    return null;
  }

  const name = normalizeString(rule?.name);
  if (!name) {
    return null;
  }

  return {
    id: resolveTemplateTaxRuleId(rule, index),
    name,
    description: String(rule?.description || "").trim(),
    schemaVersion: 2,
    calculationMode,
    calculationConfig,
    displaySummary: String(rule?.displaySummary || "").trim(),
    type: legacyFields.type,
    value: legacyFields.value,
    autoDeduct: rule?.autoDeduct !== false,
    targetType: rawTargetType,
    targetValue,
    isActive: rule?.isActive !== false,
  };
}

function normalizeTaxWithholdingPolicyEntry(entry = {}) {
  return {
    enabled: entry?.enabled === true,
    taxRate: normalizeNumber(entry?.taxRate, 0, 0, 100),
    enabledFrom: null,
  };
}

function normalizeIncomeSettlementPolicyEntry(sourceKey, entry = {}) {
  const normalizedEntry = {
    enabled: entry?.enabled === true,
    taxRate: normalizeNumber(entry?.taxRate, 0, 0, 100),
    exemptionThreshold: normalizeNumber(entry?.exemptionThreshold, 0, 0),
    enabledFrom: normalizeDateString(entry?.enabledFrom),
  };

  if (sourceKey === "arcadePrize") {
    normalizedEntry.profitBasis = "net_cash";
  }

  if (sourceKey === "stockCapitalGain") {
    normalizedEntry.offsetLosses = true;
  }

  return normalizedEntry;
}

function normalizeAutoTaxPolicyRecord(policy = {}) {
  return {
    treasury: {
      store: {
        mode: normalizeTaxTreasuryMode(policy?.treasury?.store?.mode, "NONE"),
      },
      payroll: {
        mode: normalizeTaxTreasuryMode(policy?.treasury?.payroll?.mode, "NONE"),
      },
      police: {
        fineEnabled: policy?.treasury?.police?.fineEnabled === true,
        rewardExpenseEnabled: policy?.treasury?.police?.rewardExpenseEnabled === true,
      },
    },
    withholding: {
      depositInterest: normalizeTaxWithholdingPolicyEntry(
        policy?.withholding?.depositInterest,
      ),
      payrollBonus: normalizeTaxWithholdingPolicyEntry(
        policy?.withholding?.payrollBonus,
      ),
    },
  };
}

function normalizeIncomeSettlementPoliciesRecord(policies = {}) {
  return Object.fromEntries(
    TAX_INCOME_SETTLEMENT_SOURCE_KEYS.map((sourceKey) => [
      sourceKey,
      normalizeIncomeSettlementPolicyEntry(sourceKey, policies?.[sourceKey]),
    ]),
  );
}

function getTaxRulesCollection(classId) {
  return collection(db, "classes", classId, "taxRules");
}

function getClassRef(classId) {
  return doc(db, "classes", classId);
}

export async function exportTaxTemplatePayload({ classId, scopeIds = [] }) {
  if (!classId) {
    throw new Error("학급 정보가 없어 세금 템플릿을 내보낼 수 없습니다.");
  }

  const selectedScopeIds = (scopeIds || []).filter((scopeId) =>
    TAX_TEMPLATE_SCOPE_IDS.has(scopeId),
  );

  if (selectedScopeIds.length === 0) {
    return null;
  }

  const shouldLoadTaxRules = selectedScopeIds.includes("taxRules");
  const [classSnapshot, taxRulesSnapshot] = await Promise.all([
    getDoc(getClassRef(classId)),
    shouldLoadTaxRules ? getDocs(getTaxRulesCollection(classId)) : Promise.resolve(null),
  ]);

  const classData = classSnapshot.exists() ? classSnapshot.data() : {};
  const taxPolicy = getTaxPolicy(classData);
  const payloadData = {};
  let taxRulesSkipped = 0;

  if (selectedScopeIds.includes("taxRules")) {
    const taxRules = (taxRulesSnapshot?.docs || [])
      .map((docSnapshot, index) => {
        const normalizedRule = normalizeTaxRuleRecord(
          { id: docSnapshot.id, ...docSnapshot.data() },
          index,
        );

        if (!normalizedRule) {
          taxRulesSkipped += 1;
        }

        return {
          normalizedRule,
          createdAt: docSnapshot.data()?.createdAt,
          lastModifiedAt: docSnapshot.data()?.lastModifiedAt,
        };
      })
      .filter((item) => item.normalizedRule)
      .sort(
        (left, right) =>
          getTimeValue(right.lastModifiedAt || right.createdAt) -
          getTimeValue(left.lastModifiedAt || left.createdAt),
      )
      .map((item) => item.normalizedRule);

    payloadData.taxRules = taxRules;
  }

  if (selectedScopeIds.includes("autoTaxPolicy")) {
    payloadData.autoTaxPolicy = normalizeAutoTaxPolicyRecord(taxPolicy);
  }

  if (selectedScopeIds.includes("incomeSettlement")) {
    payloadData.incomeSettlement = normalizeIncomeSettlementPoliciesRecord(
      taxPolicy?.incomeSettlement,
    );
  }

  return {
    version: 1,
    pageType: "tax",
    exportedAt: new Date().toISOString(),
    scopeIds: selectedScopeIds,
    data: payloadData,
    meta: {
      taxRulesSkipped,
    },
  };
}

export async function applyTaxTemplatePayload({
  classId,
  templatePayload,
  applyMode = "merge",
}) {
  if (!classId) {
    throw new Error("학급 정보가 없어 세금 템플릿을 적용할 수 없습니다.");
  }

  if (!templatePayload?.data) {
    throw new Error("적용할 세금 템플릿 데이터가 없습니다.");
  }

  const scopeIds = resolveScopeIds(templatePayload);
  if (scopeIds.length === 0) {
    throw new Error("적용할 세금 템플릿 범위를 찾을 수 없습니다.");
  }

  const shouldLoadTaxRules = scopeIds.includes("taxRules");
  const classRef = getClassRef(classId);

  const taxRulesSnapshot = shouldLoadTaxRules
    ? await getDocs(getTaxRulesCollection(classId))
    : null;

  const existingTaxRuleMap = new Map(
    (taxRulesSnapshot?.docs || []).map((docSnapshot, index) => {
      const normalizedRule = normalizeTaxRuleRecord(
        { id: docSnapshot.id, ...docSnapshot.data() },
        index,
      );

      return [docSnapshot.id, normalizedRule || docSnapshot.data()];
    }),
  );
  const existingTaxRuleIdByKey = new Map(
    (taxRulesSnapshot?.docs || [])
      .map((docSnapshot, index) => {
        const normalizedRule = normalizeTaxRuleRecord(
          { id: docSnapshot.id, ...docSnapshot.data() },
          index,
        );

        if (!normalizedRule) {
          return null;
        }

        return [buildTaxRuleMatchKey(normalizedRule), docSnapshot.id];
      })
      .filter(Boolean),
  );

  const batch = writeBatch(db);
  let hasWrites = false;
  let taxRulesCreated = 0;
  let taxRulesUpdated = 0;
  let taxRulesSkipped = 0;

  if (scopeIds.includes("taxRules")) {
    const incomingRules = Array.isArray(templatePayload?.data?.taxRules)
      ? templatePayload.data.taxRules
      : [];
    const taxRulesCollectionRef = getTaxRulesCollection(classId);

    incomingRules.forEach((rule, index) => {
      const normalizedRule = normalizeTaxRuleRecord(rule, index);
      if (!normalizedRule) {
        taxRulesSkipped += 1;
        return;
      }

      const matchedRuleId =
        existingTaxRuleMap.has(normalizedRule.id)
          ? normalizedRule.id
          : existingTaxRuleIdByKey.get(buildTaxRuleMatchKey(normalizedRule)) || "";
      const ruleRef = doc(taxRulesCollectionRef, matchedRuleId || normalizedRule.id);
      const existingRule = matchedRuleId
        ? existingTaxRuleMap.get(matchedRuleId)
        : null;
      const writePayload = {
        name: normalizedRule.name,
        description: normalizedRule.description,
        schemaVersion: normalizedRule.schemaVersion,
        calculationMode: normalizedRule.calculationMode,
        calculationConfig: clonePlainObject(normalizedRule.calculationConfig),
        displaySummary: normalizedRule.displaySummary,
        type: normalizedRule.type,
        value: normalizedRule.value,
        autoDeduct: normalizedRule.autoDeduct,
        targetType: normalizedRule.targetType,
        targetValue: normalizedRule.targetValue,
        isActive: normalizedRule.isActive,
        lastModifiedAt: serverTimestamp(),
      };

      if (existingRule) {
        taxRulesUpdated += 1;
        hasWrites = true;
        batch.set(ruleRef, writePayload, { merge: true });
        return;
      }

      taxRulesCreated += 1;
      hasWrites = true;
      batch.set(ruleRef, {
        ...writePayload,
        createdAt: serverTimestamp(),
      });
    });
  }

  const taxPolicyPatch = {};

  if (scopeIds.includes("autoTaxPolicy")) {
    const normalizedAutoTaxPolicy = normalizeAutoTaxPolicyRecord(
      templatePayload?.data?.autoTaxPolicy,
    );

    taxPolicyPatch.treasury = normalizedAutoTaxPolicy.treasury;
    taxPolicyPatch.withholding = normalizedAutoTaxPolicy.withholding;
  }

  if (scopeIds.includes("incomeSettlement")) {
    taxPolicyPatch.incomeSettlement = normalizeIncomeSettlementPoliciesRecord(
      templatePayload?.data?.incomeSettlement,
    );
  }

  if (Object.keys(taxPolicyPatch).length > 0) {
    hasWrites = true;
    batch.set(
      classRef,
      {
        taxPolicy: {
          ...taxPolicyPatch,
          version: 1,
          updatedAt: serverTimestamp(),
        },
        ...(scopeIds.includes("autoTaxPolicy")
          ? {
              taxSettings: {
                storeMode:
                  taxPolicyPatch?.treasury?.store?.mode ||
                  normalizeTaxTreasuryMode(null, "NONE"),
              },
              settings: {
                payrollTaxMode:
                  taxPolicyPatch?.treasury?.payroll?.mode ||
                  normalizeTaxTreasuryMode(null, "NONE"),
              },
            }
          : {}),
      },
      { merge: true },
    );
  }

  if (hasWrites) {
    await batch.commit();
  }

  return {
    pageType: "tax",
    applyMode,
    taxRulesCreated,
    taxRulesUpdated,
    taxRulesSkipped:
      taxRulesSkipped + normalizeNumber(templatePayload?.meta?.taxRulesSkipped, 0, 0),
    autoTaxPolicyApplied: scopeIds.includes("autoTaxPolicy") ? 1 : 0,
    incomeSettlementPoliciesApplied: scopeIds.includes("incomeSettlement")
      ? TAX_INCOME_SETTLEMENT_SOURCE_KEYS.length
      : 0,
    note:
      "학생별 지정 규칙과 신용등급 대상 규칙은 템플릿 범위에서 제외하고 공통 세금 설정만 반영합니다.",
  };
}
