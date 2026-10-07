import { appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useMemo, useState } from "react";
import { deleteDoc, doc, getDoc } from "firebase/firestore";
import {
  Coins,
  Info,
  Percent,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";

import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Spinner,
} from "../../../components/ui";
import TaxRuleFormModal from "./TaxRuleFormModal";

const NO_TIER_ID = "__no_credit_tier__";

const normalizeTierKey = (value) => String(value || "").trim().toLowerCase();

const formatNumber = (value) => Number(value || 0).toLocaleString("ko-KR");

const formatAmount = (value, currencyUnit) =>
  `${formatNumber(value)}${currencyUnit || ""}`;

const formatPercent = (value) => `${Number(value || 0)}%`;

const normalizeTierDefinition = (tierData = {}) => {
  if (!tierData) return null;

  if (typeof tierData === "string") {
    const value = tierData.trim();
    if (!value) return null;

    return {
      id: value,
      name: value,
    };
  }

  const id = String(tierData?.id || tierData?.name || "").trim();
  if (!id) return null;

  return {
    id,
    name: String(tierData?.name || id).trim(),
  };
};

const fallbackTierLabel = (tierId) => {
  const value = String(tierId || "").trim();
  if (!value) return "";
  if (value === NO_TIER_ID || value === "__no_tier__") return "무등급";

  const numericMatch = value.match(/^numeric_(\d+)$/i);
  if (numericMatch) {
    return `${numericMatch[1]}등급`;
  }

  return value;
};

const normalizeStudentTier = (student = {}) => {
  const rawTier = student?.creditTier;

  if (!rawTier) {
    return {
      id: NO_TIER_ID,
      name: "미등급",
    };
  }

  if (typeof rawTier === "string") {
    const value = rawTier.trim();
    return {
      id: value || NO_TIER_ID,
      name: value || "미등급",
    };
  }

  const id = String(rawTier?.id || rawTier?.name || "").trim();
  const name = String(rawTier?.name || rawTier?.id || "").trim();

  return {
    id: id || NO_TIER_ID,
    name: name || "미등급",
  };
};

const formatSelectionSummary = (values = [], suffix = "개") => {
  if (!Array.isArray(values) || values.length === 0) return null;

  const visible = values
    .slice(0, 3)
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (visible.length === 0) return null;

  const extraCount = values.length - visible.length;
  return `${visible.join(" · ")}${extraCount > 0 ? ` 외 ${extraCount}${suffix}` : ""}`;
};

const getRuleCalculationMode = (rule = {}) => {
  const nextMode = String(rule?.calculationMode || "").trim().toLowerCase();

  if (
    nextMode === "flat_rate" ||
    nextMode === "flat_amount" ||
    nextMode === "rate_after_exemption" ||
    nextMode === "progressive"
  ) {
    return nextMode;
  }

  return rule?.type === "percent" ? "flat_rate" : "flat_amount";
};

const getRuleCalculationConfig = (rule = {}) => {
  const calculationMode = getRuleCalculationMode(rule);
  const config =
    rule?.calculationConfig && typeof rule.calculationConfig === "object"
      ? rule.calculationConfig
      : {};

  if (calculationMode === "flat_rate") {
    return {
      rate: Number(config.rate ?? rule?.value ?? 0),
    };
  }

  if (calculationMode === "flat_amount") {
    return {
      amount: Number(config.amount ?? rule?.value ?? 0),
    };
  }

  if (calculationMode === "rate_after_exemption") {
    return {
      rate: Number(config.rate ?? 0),
      exemptionAmount: Number(config.exemptionAmount ?? 0),
    };
  }

  return {
    brackets: Array.isArray(config.brackets)
      ? config.brackets
          .map((bracket) => ({
            upToAmount:
              bracket?.upToAmount === null || bracket?.upToAmount === undefined
                ? null
                : Number(bracket.upToAmount),
            rate: Number(bracket?.rate ?? 0),
          }))
          .filter((bracket) => bracket.upToAmount === null || Number.isFinite(bracket.upToAmount))
      : [],
  };
};

const getCalculationBadgeMeta = (calculationMode) => {
  if (calculationMode === "flat_rate") {
    return {
      label: "비율",
      tone: "indigo",
      Icon: Percent,
    };
  }

  if (calculationMode === "flat_amount") {
    return {
      label: "고정액",
      tone: "slate",
      Icon: Coins,
    };
  }

  if (calculationMode === "rate_after_exemption") {
    return {
      label: "면세 후 비율",
      tone: "amber",
      Icon: Percent,
    };
  }

  return {
    label: "누진세",
    tone: "rose",
    Icon: Percent,
  };
};

const buildProgressiveSummary = (brackets = [], currencyUnit) => {
  const normalized = Array.isArray(brackets) ? brackets : [];

  return normalized
    .slice(0, 3)
    .map((bracket) =>
      bracket.upToAmount === null
        ? `초과 ${formatPercent(bracket.rate)}`
        : `${formatAmount(bracket.upToAmount, currencyUnit)}까지 ${formatPercent(bracket.rate)}`,
    )
    .join(" · ");
};

const getCalculationDisplay = (rule, currencyUnit) => {
  const calculationMode = getRuleCalculationMode(rule);
  const calculationConfig = getRuleCalculationConfig(rule);
  const badgeMeta = getCalculationBadgeMeta(calculationMode);

  if (calculationMode === "flat_rate") {
    return {
      ...badgeMeta,
      primary: `비율 ${formatPercent(calculationConfig.rate)}`,
      secondary: "급여 총액에 비례해서 공제됩니다.",
    };
  }

  if (calculationMode === "flat_amount") {
    return {
      ...badgeMeta,
      primary: `고정액 ${formatAmount(calculationConfig.amount, currencyUnit)}`,
      secondary: "1주 기준으로 계산됩니다.",
    };
  }

  if (calculationMode === "rate_after_exemption") {
    return {
      ...badgeMeta,
      primary: `면세 ${formatAmount(calculationConfig.exemptionAmount, currencyUnit)} 후 ${formatPercent(calculationConfig.rate)}`,
      secondary: "비과세 한도를 넘는 금액에만 세율이 적용됩니다.",
    };
  }

  const brackets = calculationConfig.brackets || [];
  return {
    ...badgeMeta,
    primary: `누진 ${Math.max(1, brackets.length)}단계`,
    secondary: buildProgressiveSummary(brackets, currencyUnit),
  };
};

const TaxRuleTab = ({
  taxRules,
  classId,
  refreshTaxRules,
  isLoading: isParentLoading,
  students = [],
  currencyUnit = "원",
}) => {
  const { hasPermission, isTeacher, userData } = useUser();
  const { showFeedback } = useFeedback();

  const canManageTax = hasPermission("tax_admin") || isTeacher;

  const [isActionLoading, setIsActionLoading] = useState(false);
  const [formModal, setFormModal] = useState({
    open: false,
    isEditing: false,
    data: null,
  });
  const [configuredTiers, setConfiguredTiers] = useState([]);

  useEffect(() => {
    let isMounted = true;

    const fetchConfiguredTiers = async () => {
      if (!classId) {
        setConfiguredTiers([]);
        return;
      }

      try {
        const snapshot = await getDoc(doc(db, `classes/${classId}/tierCriteria/default`));
        const tiers = Array.isArray(snapshot.data()?.tiers) ? snapshot.data().tiers : [];
        if (!isMounted) return;
        setConfiguredTiers(tiers);
      } catch (error) {
        console.error("신용등급 설정을 불러오지 못했습니다:", error);
        if (isMounted) {
          setConfiguredTiers([]);
        }
      }
    };

    fetchConfiguredTiers();

    return () => {
      isMounted = false;
    };
  }, [classId]);

  const studentMap = useMemo(() => {
    const nextMap = new Map();
    (students || []).forEach((student) => {
      if (!student?.uid) return;
      nextMap.set(student.uid, student);
    });
    return nextMap;
  }, [students]);

  const creditTierNameMap = useMemo(() => {
    const nextMap = new Map();

    configuredTiers.forEach((tier) => {
      const normalized = normalizeTierDefinition(tier);
      if (!normalized?.id) return;
      nextMap.set(normalizeTierKey(normalized.id), normalized.name);
    });

    (students || []).forEach((student) => {
      const normalized = normalizeStudentTier(student);
      if (!normalized?.id || !normalized?.name) return;
      nextMap.set(normalizeTierKey(normalized.id), normalized.name);
    });

    nextMap.set(normalizeTierKey(NO_TIER_ID), "무등급");
    nextMap.set(normalizeTierKey("__no_tier__"), "무등급");

    return nextMap;
  }, [configuredTiers, students]);

  const getReadableTierLabel = (tierId) => {
    const normalizedKey = normalizeTierKey(tierId);
    return creditTierNameMap.get(normalizedKey) || fallbackTierLabel(tierId);
  };

  const getMyCreditTierKeys = () => {
    const tier = userData?.creditTier;

    if (!tier) return ["__no_tier__"];

    if (typeof tier === "string") {
      const value = tier.trim();
      return value ? [value] : ["__no_tier__"];
    }

    const keys = [tier?.id, tier?.name]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return keys.length > 0 ? keys : ["__no_tier__"];
  };

  const isRuleAppliedToMe = (rule) => {
    if (!rule || !rule.targetType || rule.targetType === "all") return true;

    if (rule.targetType === "individual") {
      return (
        !Array.isArray(rule.targetValue) ||
        rule.targetValue.length === 0 ||
        rule.targetValue.includes(userData?.uid)
      );
    }

    if (rule.targetType === "credit_tier") {
      if (!Array.isArray(rule.targetValue) || rule.targetValue.length === 0) return false;
      const myTierKeys = new Set(getMyCreditTierKeys().map((value) => normalizeTierKey(value)));
      return rule.targetValue.some((value) => myTierKeys.has(normalizeTierKey(value)));
    }

    if (rule.targetType === "job") {
      const myJobs = Array.isArray(userData?.jobs)
        ? userData.jobs
        : userData?.job
          ? [userData.job]
          : [];
      return myJobs.includes(rule.targetValue);
    }

    return true;
  };

  const getIndividualTargetSummary = (targetValue) => {
    const selectedUids = Array.isArray(targetValue) ? targetValue.filter(Boolean) : [];

    if (selectedUids.length === 0) {
      return {
        primary: "전체 학생",
        secondary: "선택된 학생이 없어 전체 적용으로 간주됩니다.",
      };
    }

    const tierCounts = new Map();
    let missingStudentCount = 0;

    selectedUids.forEach((uid) => {
      const student = studentMap.get(uid);
      if (!student) {
        missingStudentCount += 1;
        return;
      }

      const tier = normalizeStudentTier(student);
      const current = tierCounts.get(tier.id);
      tierCounts.set(tier.id, {
        id: tier.id,
        name: tier.name,
        count: (current?.count || 0) + 1,
      });
    });

    const sortedTierCounts = Array.from(tierCounts.values()).sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left.name.localeCompare(right.name, "ko");
    });

    const visibleTierSummary = sortedTierCounts
      .slice(0, 3)
      .map((tier) => `${tier.name} ${tier.count}명`);

    let secondary = visibleTierSummary.length > 0
      ? `현재 등급 ${visibleTierSummary.join(" · ")}`
      : null;

    if (sortedTierCounts.length > 3) {
      secondary = `${secondary} 외 ${sortedTierCounts.length - 3}개`;
    }

    if (missingStudentCount > 0) {
      secondary = secondary
        ? `${secondary} · 미조회 ${missingStudentCount}명`
        : `학생 정보 미조회 ${missingStudentCount}명`;
    }

    return {
      primary: `학생 ${selectedUids.length}명 선택`,
      secondary,
    };
  };

  const getManagerTargetDisplay = (rule) => {
    if (rule?.targetType === "credit_tier") {
      const selectedTiers = Array.isArray(rule.targetValue) ? rule.targetValue.filter(Boolean) : [];
      const selectedTierLabels = selectedTiers.map(getReadableTierLabel);

      return {
        primary:
          selectedTierLabels.length > 0
            ? `신용등급: ${formatSelectionSummary(selectedTierLabels) || "-"}`
            : "신용등급 미지정",
        secondary: selectedTiers.length > 0 ? `총 ${selectedTiers.length}개 등급 선택` : null,
      };
    }

    if (rule?.targetType === "individual") {
      return getIndividualTargetSummary(rule.targetValue);
    }

    if (rule?.targetType === "job") {
      return {
        primary: `직업: ${rule.targetValue || "-"}`,
        secondary: "해당 직업 학생에게만 적용됩니다.",
      };
    }

    return {
      primary: "전체 학생",
      secondary: "학급 전체 공통 규칙입니다.",
    };
  };

  const getTargetDisplay = (rule) => {
    if (canManageTax) {
      return getManagerTargetDisplay(rule);
    }

    return isRuleAppliedToMe(rule)
      ? { primary: "적용됨", secondary: "내 급여 계산에 반영됩니다." }
      : { primary: "미적용", secondary: "내 급여 계산에는 반영되지 않습니다." };
  };

  const handleDeleteRule = async (ruleId) => {
    if (!canManageTax) {
      showFeedback("세금 규칙을 삭제할 권한이 없습니다.", "error");
      return;
    }

    if (!classId || !ruleId) {
      showFeedback("삭제할 세금 규칙 정보를 찾을 수 없습니다.", "error");
      return;
    }

    if (!(await appConfirm("정말로 이 세금 규칙을 삭제하시겠습니까?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;

    setIsActionLoading(true);
    try {
      await deleteDoc(doc(db, `classes/${classId}/taxRules/${ruleId}`));
      showFeedback("세금 규칙이 삭제되었습니다.", "success");
      refreshTaxRules?.();
    } catch (error) {
      console.error("Error deleting tax rule:", error);
      showFeedback("세금 규칙 삭제 중 오류가 발생했습니다.", "error");
    } finally {
      setIsActionLoading(false);
    }
  };

  const openNewRuleModal = () => setFormModal({ open: true, isEditing: false, data: null });
  const openEditRuleModal = (rule) =>
    setFormModal({ open: true, isEditing: true, data: rule });
  const closeFormModal = () =>
    setFormModal({ open: false, isEditing: false, data: null });

  const handleFormSubmitSuccess = (message) => {
    closeFormModal();
    refreshTaxRules?.();
    showFeedback(message, "success");
  };

  if (isParentLoading && (!taxRules || taxRules.length === 0)) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="mr-2" />
        <span>세금 규칙을 불러오는 중입니다...</span>
      </div>
    );
  }

  const rulesList = taxRules || [];

  return (
    <div className="space-y-6">
      <div data-tour="tax-rule-header">
        <Card tone="indigo" variant="soft" headerBar>
          <Card.Header>
            <div>
              <Card.Title tone="indigo" className="text-xl font-bold">
                급여 세금 규칙 관리
              </Card.Title>
              <Card.Description>
                규칙 이름, 계산식, 적용 대상을 한눈에 관리합니다.
              </Card.Description>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                tone="blue"
                onClick={refreshTaxRules}
                disabled={isParentLoading || isActionLoading || !refreshTaxRules}
                icon={RefreshCw}
                isLoading={isParentLoading}
              >
                새로고침
              </Button>
              {canManageTax && (
                <Button
                  onClick={openNewRuleModal}
                  tone="blue"
                  data-tour="tax-rule-add-action"
                  data-tutorial-interactive="true"
                >
                  + 새 규칙 추가
                </Button>
              )}
            </div>
          </Card.Header>
        </Card>
      </div>

      <div data-tour="tax-rule-table">
        <Card variant="surface" tone="slate">
          <Card.Content noPadding>
            {rulesList.length === 0 ? (
              <div className="py-8">
                <EmptyState
                  icon={Coins}
                  title="등록된 세금 규칙이 없습니다"
                  description="첫 규칙을 추가해 세금 계산 기준을 설정해 주세요."
                />
                {canManageTax && (
                  <div className="mt-4 flex justify-center">
                    <Button
                      tone="blue"
                      onClick={openNewRuleModal}
                      data-tour="tax-rule-add-action"
                      data-tutorial-interactive="true"
                    >
                      첫 규칙 추가하기
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <DataTable>
                  <DataTable.Header>
                    <DataTable.Row interactive={false}>
                      <DataTable.HeadCell className="w-[32%] px-4 py-3">규칙 이름</DataTable.HeadCell>
                      <DataTable.HeadCell className="w-[28%] px-4 py-3">적용값</DataTable.HeadCell>
                      <DataTable.HeadCell className="w-[40%] px-4 py-3">적용 대상</DataTable.HeadCell>
                    </DataTable.Row>
                  </DataTable.Header>
                  <DataTable.Body>
                    {rulesList.map((rule) => {
                      const isActive = rule.isActive === undefined || rule.isActive;
                      const calculationDisplay = getCalculationDisplay(rule, currencyUnit);
                      const targetDisplay = getTargetDisplay(rule);
                      const CalculationIcon = calculationDisplay.Icon;

                      return (
                        <DataTable.Row key={rule.id}>
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-2">
                              <span className="font-medium text-slate-900">{rule.name}</span>
                              {rule.description && (
                                <div className="group relative mt-0.5">
                                  <Info size={14} className="text-slate-400 group-hover:text-slate-600" />
                                  <div className="invisible absolute left-0 top-5 z-10 w-64 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-lg group-hover:visible">
                                    {rule.description}
                                    <div className="absolute -top-1 left-2 h-2 w-2 rotate-45 bg-slate-800" />
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="mt-1">
                              {isActive ? (
                                <Badge tone="emerald" size="sm" variant="soft">
                                  사용 중
                                </Badge>
                              ) : (
                                <Badge tone="slate" size="sm" variant="soft">
                                  비활성화
                                </Badge>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                tone={calculationDisplay.tone}
                                size="sm"
                                variant="soft"
                                className="inline-flex items-center gap-1"
                              >
                                <CalculationIcon className="h-3 w-3" />
                                {calculationDisplay.label}
                              </Badge>
                              <div className="font-semibold text-rose-600">
                                {calculationDisplay.primary}
                              </div>
                            </div>
                            {calculationDisplay.secondary && (
                              <div className="mt-1 text-xs leading-5 text-slate-500">
                                {calculationDisplay.secondary}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2 text-slate-700">
                                <Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                                <div>
                                  <div
                                    className={`font-medium ${
                                      !canManageTax && targetDisplay.primary === "적용됨"
                                        ? "text-emerald-600"
                                        : !canManageTax
                                          ? "text-slate-500"
                                          : "text-slate-800"
                                    }`}
                                  >
                                    {targetDisplay.primary}
                                  </div>
                                  {targetDisplay.secondary && (
                                    <div className="mt-1 text-xs leading-5 text-slate-500">
                                      {targetDisplay.secondary}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {canManageTax && (
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    tone="blue"
                                    onClick={() => openEditRuleModal(rule)}
                                    icon={Pencil}
                                    disabled={isActionLoading}
                                  >
                                    수정
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    tone="rose"
                                    onClick={() => handleDeleteRule(rule.id)}
                                    icon={Trash2}
                                    disabled={isActionLoading}
                                  >
                                    삭제
                                  </Button>
                                </div>
                              )}
                            </div>
                          </td>
                        </DataTable.Row>
                      );
                    })}
                  </DataTable.Body>
                </DataTable>
            )}
          </Card.Content>
        </Card>
      </div>

      {formModal.open && (
        <TaxRuleFormModal
          isOpen={formModal.open}
          isEditingMode={formModal.isEditing}
          initialData={formModal.data}
          onClose={closeFormModal}
          onSubmitSuccess={handleFormSubmitSuccess}
          classId={classId}
          data-tour="tax-rule-form-modal"
        />
      )}
    </div>
  );
};

export default TaxRuleTab;
