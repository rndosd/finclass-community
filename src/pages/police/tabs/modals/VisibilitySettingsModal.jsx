import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FileWarning,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";

import {
  Badge,
  BulkActionFloatingBar,
  Button,
  Modal,
  Spinner,
  ToggleSwitch,
} from "../../../../components/ui";
import { useUser } from "../../../../contexts/UserContext";
import { usePoliceMutations } from "../../hooks/usePoliceMutations";
import { usePoliceSettingsQuery } from "../../hooks/usePoliceQuery";
import {
  VISIBILITY_LEVELS,
  buildRuleVisibilityState,
  createDefaultRuleVisibility,
  sanitizeRuleVisibilityState,
} from "../../utils/visibilityConfig";

const CONTEXT_META = {
  reports: {
    label: "신고 접수 내역",
    description: "신고가 접수된 건을 어떤 수준으로 보여줄지 정합니다.",
  },
  history: {
    label: "부과내역",
    description: "벌금과 제재 내역을 어떤 수준으로 보여줄지 정합니다.",
  },
};

const ROLE_META = {
  policeAdmin: {
    label: "경찰 관리자",
  },
  student: {
    label: "일반 학생",
  },
};

const LEVEL_UI_META = {
  hidden: {
    label: "비공개",
    description: "타인 건은 숨기고 본인 관련 내역만 보입니다.",
    icon: EyeOff,
    badgeTone: "rose",
  },
  summary: {
    label: "요약",
    description: "신고자 또는 처리자와 대상자만 보입니다.",
    icon: UserRound,
    badgeTone: "amber",
  },
  detail: {
    label: "상세",
    description: "규칙, 사유, 금액 같은 상세 정보까지 보입니다.",
    icon: Eye,
    badgeTone: "indigo",
  },
};

const LEVEL_BUTTON_STYLES = {
  hidden: {
    idle:
      "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800",
    active: "border-rose-500 bg-rose-500 text-white shadow-sm",
  },
  summary: {
    idle:
      "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100",
    active: "border-amber-500 bg-amber-500 text-white shadow-sm",
  },
  detail: {
    idle:
      "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300 hover:bg-sky-100",
    active: "border-sky-500 bg-sky-500 text-white shadow-sm",
  },
};

const DANGER_GROUP_META = {
  3: {
    key: "danger-3",
    label: "위험도 3",
    tone: "rose",
  },
  2: {
    key: "danger-2",
    label: "위험도 2",
    tone: "amber",
  },
  1: {
    key: "danger-1",
    label: "위험도 1",
    tone: "sky",
  },
};

const ROLE_KEYS = ["policeAdmin", "student"];

const getRuleOrder = (rule = {}) => Number(rule?.order || 0);

const isPenaltyRule = (rule = {}) =>
  Number(rule?.fineAmount || 0) < 0 || Number(rule?.creditChange || 0) < 0;

const getDangerLevel = (rule = {}) => {
  const raw = Number(rule?.dangerLevel || 0);
  if (raw >= 3) return 3;
  if (raw === 2) return 2;
  return 1;
};

const buildOrderedRules = ({
  rules = [],
  ruleDirection = "asc",
  dangerDirection = "desc",
}) =>
  [...rules].sort((a, b) => {
    const dangerCompare = getDangerLevel(a) - getDangerLevel(b);
    if (dangerCompare !== 0) {
      return dangerDirection === "desc" ? dangerCompare * -1 : dangerCompare;
    }

    const ruleCompare =
      getRuleOrder(a) - getRuleOrder(b) ||
      String(a?.id || "").localeCompare(String(b?.id || ""));

    return ruleDirection === "desc" ? ruleCompare * -1 : ruleCompare;
  });

const isRowSelectionInteraction = (target) => {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest("[data-no-row-select='true']"));
};

const SortArrow = ({ descending = false }) =>
  descending ? (
    <ArrowDown className="h-3.5 w-3.5" />
  ) : (
    <ArrowUp className="h-3.5 w-3.5" />
  );

const SortHeaderButton = ({
  label,
  descending = false,
  onClick,
  ascLabel,
  descLabel,
}) => (
  <Button
    type="button"
    onClick={onClick}
    data-no-row-select="true"
    kind="ghost"
    tone="slate"
    size="xs"
    className="inline-flex items-center gap-1 font-inherit text-inherit transition hover:text-slate-600"
    aria-label={descending ? ascLabel : descLabel}
  >
    <span>{label}</span>
    <SortArrow descending={descending} />
  </Button>
);

const SegmentedLevelControl = ({ value, onChange, disabled = false }) => (
  <div
    data-no-row-select="true"
    className="grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-100/90 p-1.5"
  >
    {VISIBILITY_LEVELS.map((level) => {
      const meta = LEVEL_UI_META[level];
      const isActive = value === level;
      const styles = LEVEL_BUTTON_STYLES[level];

      return (
        <Button
          key={level}
          type="button"
          disabled={disabled}
          onClick={() => onChange(level)}
          data-no-row-select="true"
          kind="ghost"
          tone="slate"
          size="xs"
          aria-pressed={isActive}
          className={`rounded-xl px-2 py-2 text-center text-[11px] font-black transition ${
            isActive ? styles.active : styles.idle
          } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        >
          {meta.label}
        </Button>
      );
    })}
  </div>
);

const BulkLevelButton = ({ level, onClick }) => {
  const meta = LEVEL_UI_META[level];
  const styles = LEVEL_BUTTON_STYLES[level];

  return (
    <Button
      type="button"
      onClick={onClick}
      data-no-row-select="true"
      kind="ghost"
      tone="slate"
      size="xs"
      className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${styles.idle}`}
    >
      {meta.label}
    </Button>
  );
};

const RuleVisibilityTable = ({
  context,
  rules = [],
  visibilityState = {},
  canEdit = false,
  sortConfig = {
    rule: "asc",
    danger: "desc",
  },
  onToggleSort,
  onChangeLevel,
  selectedIds = [],
  onToggleRule,
  onToggleAll,
  onClearSelection,
  onBulkApply,
}) => {
  const contextMeta = CONTEXT_META[context];
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const editableRuleIds = useMemo(
    () =>
      rules
        .filter((rule) => rule?.sensitive !== true)
        .map((rule) => String(rule?.id || "")),
    [rules],
  );

  const allSelected =
    editableRuleIds.length > 0 && selectedIds.length === editableRuleIds.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
  const totalRules = rules.length;

  return (
    <section className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50/90 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-slate-900">
                {contextMeta.label}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                규칙과 위험도 컬럼에서 각각 오름차순, 내림차순 정렬을 바꿀 수 있습니다.
              </p>
            </div>
            <Badge tone="slate" size="xs">
              {totalRules}개 규칙
            </Badge>
          </div>
        </div>

        {totalRules === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-400">
            설정할 규칙이 아직 없습니다.
          </div>
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-2">
                {canEdit ? (
                  <label className="flex min-h-11 items-center gap-2 px-2 text-xs font-bold text-slate-600">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = someSelected;
                      }}
                      onChange={() =>
                        onToggleAll?.(context, allSelected ? [] : editableRuleIds)
                      }
                      disabled={editableRuleIds.length === 0}
                      className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    전체 선택
                  </label>
                ) : (
                  <span />
                )}
                <div className="flex gap-1">
                  <SortHeaderButton
                    label="규칙"
                    descending={sortConfig.rule === "desc"}
                    onClick={() => onToggleSort?.(context, "rule")}
                    ascLabel="규칙 오름차순으로 정렬"
                    descLabel="규칙 내림차순으로 정렬"
                  />
                  <SortHeaderButton
                    label="위험도"
                    descending={sortConfig.danger === "desc"}
                    onClick={() => onToggleSort?.(context, "danger")}
                    ascLabel="위험도 오름차순으로 정렬"
                    descLabel="위험도 내림차순으로 정렬"
                  />
                </div>
              </div>

              {rules.map((rule) => {
                const ruleId = String(rule?.id || "");
                const current =
                  visibilityState?.[ruleId] || createDefaultRuleVisibility();
                const isLockedSensitive = rule?.sensitive === true;
                const isSelected = selectedIdSet.has(ruleId);

                return (
                  <article
                    key={`mobile-${context}-${ruleId}`}
                    className={`rounded-2xl border p-4 ${
                      isSelected
                        ? "border-indigo-200 bg-indigo-50/60"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {canEdit ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isLockedSensitive}
                          onChange={() => onToggleRule?.(context, ruleId)}
                          aria-label={`${rule?.text || "규칙"} 선택`}
                          className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold leading-relaxed text-slate-900">
                          {rule?.text || "이름 없는 규칙"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge
                            tone={DANGER_GROUP_META[getDangerLevel(rule)].tone}
                            size="xs"
                          >
                            위험도 {getDangerLevel(rule)}
                          </Badge>
                          {rule?.sensitive ? (
                            <Badge tone="rose" size="xs">
                              민감 고정
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {isLockedSensitive ? (
                      <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-3 text-xs leading-relaxed text-rose-700">
                        민감 규칙은 공개 설정과 관계없이 자동으로 제한됩니다.
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {ROLE_KEYS.map((role) => (
                          <div key={`mobile-${context}-${ruleId}-${role}`}>
                            <p className="mb-1.5 text-xs font-bold text-slate-500">
                              {ROLE_META[role].label}
                            </p>
                            <SegmentedLevelControl
                              value={current?.[role]?.[context] || "hidden"}
                              disabled={!canEdit}
                              onChange={(level) =>
                                onChangeLevel?.({
                                  ruleId,
                                  role,
                                  context,
                                  level,
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-slate-50/90">
                <tr className="text-left text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                  {canEdit ? (
                    <th className="w-12 px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(node) => {
                          if (node) node.indeterminate = someSelected;
                        }}
                        onChange={() =>
                          onToggleAll?.(context, allSelected ? [] : editableRuleIds)
                        }
                        data-no-row-select="true"
                        disabled={editableRuleIds.length === 0}
                        aria-label={allSelected ? "전체 선택 해제" : "전체 선택"}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                  ) : null}
                  <th className="min-w-[340px] px-4 py-3">
                    <SortHeaderButton
                      label="규칙"
                      descending={sortConfig.rule === "desc"}
                      onClick={() => onToggleSort?.(context, "rule")}
                      ascLabel="규칙 오름차순으로 정렬"
                      descLabel="규칙 내림차순으로 정렬"
                    />
                  </th>
                  <th className="w-[130px] px-4 py-3">
                    <SortHeaderButton
                      label="위험도"
                      descending={sortConfig.danger === "desc"}
                      onClick={() => onToggleSort?.(context, "danger")}
                      ascLabel="위험도 오름차순으로 정렬"
                      descLabel="위험도 내림차순으로 정렬"
                    />
                  </th>
                  <th className="min-w-[260px] px-4 py-3">
                    {ROLE_META.policeAdmin.label}
                  </th>
                  <th className="min-w-[260px] px-4 py-3">
                    {ROLE_META.student.label}
                  </th>
                </tr>
              </thead>

              <tbody>
                {rules.map((rule) => {
                  const ruleId = String(rule?.id || "");
                  const current =
                    visibilityState?.[ruleId] || createDefaultRuleVisibility();
                  const isLockedSensitive = rule?.sensitive === true;
                  const isSelected = selectedIdSet.has(ruleId);

                  return (
                    <tr
                      key={`${context}-${ruleId}`}
                      onClick={(event) => {
                        if (
                          !canEdit ||
                          isLockedSensitive ||
                          isRowSelectionInteraction(event.target)
                        ) {
                          return;
                        }

                        onToggleRule?.(context, ruleId);
                      }}
                      className={`border-b border-slate-100 transition-colors ${
                        isSelected
                          ? "bg-indigo-50/60"
                          : "bg-white hover:bg-slate-50/80"
                      } ${
                        canEdit && !isLockedSensitive ? "cursor-pointer" : ""
                      }`}
                      aria-selected={isSelected}
                    >
                      {canEdit ? (
                        <td className="px-4 py-4 text-center align-top">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isLockedSensitive}
                            onChange={() => onToggleRule?.(context, ruleId)}
                            data-no-row-select="true"
                            aria-label={`${rule?.text || "규칙"} 선택`}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:border-slate-200"
                          />
                        </td>
                      ) : null}

                      <td className="px-4 py-4 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-bold leading-relaxed text-slate-900">
                            {rule?.text || "이름 없는 규칙"}
                          </div>
                          {rule?.sensitive ? (
                            <Badge tone="rose" size="xs">
                              민감 고정
                            </Badge>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-4 py-4 align-top">
                        <Badge tone={DANGER_GROUP_META[getDangerLevel(rule)].tone} size="xs">
                          위험도 {getDangerLevel(rule)}
                        </Badge>
                      </td>

                      {ROLE_KEYS.map((role) => (
                        <td
                          key={`${context}-${ruleId}-${role}`}
                          className="px-4 py-4 align-top"
                        >
                          {isLockedSensitive ? (
                            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-4 text-xs leading-relaxed text-rose-700">
                              민감 규칙은 공개 설정과 관계없이 자동으로 제한됩니다.
                            </div>
                          ) : (
                            <SegmentedLevelControl
                              value={current?.[role]?.[context] || "hidden"}
                              disabled={!canEdit}
                              onChange={(level) =>
                                onChangeLevel?.({
                                  ruleId,
                                  role,
                                  context,
                                  level,
                                })
                              }
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

    </section>
  );
};

const VisibilitySettingsModal = ({ isOpen, onClose, policeRules = [], "data-tour": dataTour }) => {
  const { classId, isTeacher, hasPermission } = useUser();
  const { data: settings = {}, isLoading: isSettingsLoading } =
    usePoliceSettingsQuery(classId);
  const { updateSettings, isUpdatingSettings } = usePoliceMutations(classId);

  const canEdit = isTeacher || hasPermission("police_rules_manage");
  const configurableRules = useMemo(
    () => (Array.isArray(policeRules) ? policeRules.filter(isPenaltyRule) : []),
    [policeRules],
  );

  const [visibilityState, setVisibilityState] = useState({});
  const [reflectionEnabled, setReflectionEnabled] = useState(true);
  const [selectedRuleIdsByContext, setSelectedRuleIdsByContext] = useState({
    reports: [],
    history: [],
  });
  const [sortConfigByContext, setSortConfigByContext] = useState({
    reports: {
      rule: "asc",
      danger: "desc",
    },
    history: {
      rule: "asc",
      danger: "desc",
    },
  });
  const [activeContext, setActiveContext] = useState("reports");

  useEffect(() => {
    if (!isOpen) return;

    const nextState = buildRuleVisibilityState({
      policeRules: configurableRules,
      settings,
    });

    setVisibilityState(
      sanitizeRuleVisibilityState({
        state: nextState,
        policeRules: configurableRules,
      }),
    );
    setReflectionEnabled(settings?.reflectionEnabled !== false);
    setSelectedRuleIdsByContext({ reports: [], history: [] });
    setActiveContext("reports");
  }, [configurableRules, isOpen, settings]);

  const reportRules = useMemo(
    () =>
      buildOrderedRules({
        rules: configurableRules,
        ruleDirection: sortConfigByContext.reports.rule,
        dangerDirection: sortConfigByContext.reports.danger,
      }),
    [configurableRules, sortConfigByContext.reports],
  );

  const historyRules = useMemo(
    () =>
      buildOrderedRules({
        rules: configurableRules,
        ruleDirection: sortConfigByContext.history.rule,
        dangerDirection: sortConfigByContext.history.danger,
      }),
    [configurableRules, sortConfigByContext.history],
  );

  const handleToggleSort = (context, field) => {
    setSortConfigByContext((prev) => ({
      ...prev,
      [context]: {
        ...prev?.[context],
        [field]: prev?.[context]?.[field] === "asc" ? "desc" : "asc",
      },
    }));
  };

  const handleLevelChange = ({ ruleId, role, context, level }) => {
    if (!canEdit) return;

    setVisibilityState((prev) => {
      const current = prev?.[ruleId] || createDefaultRuleVisibility();

      return {
        ...prev,
        [ruleId]: {
          ...current,
          [role]: {
            ...current[role],
            [context]: level,
          },
        },
      };
    });
  };

  const handleToggleRule = (context, ruleId) => {
    if (!canEdit) return;

    setSelectedRuleIdsByContext((prev) => {
      const next = new Set(prev?.[context] || []);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);

      return {
        ...prev,
        [context]: Array.from(next),
      };
    });
  };

  const handleToggleAllRules = (context, ruleIds = []) => {
    if (!canEdit) return;

    setSelectedRuleIdsByContext((prev) => ({
      ...prev,
      [context]: [...ruleIds],
    }));
  };

  const handleClearSelection = (context) => {
    setSelectedRuleIdsByContext((prev) => ({
      ...prev,
      [context]: [],
    }));
  };

  const handleBulkApply = ({ context, role, level }) => {
    if (!canEdit) return;

    const selectedIds = selectedRuleIdsByContext?.[context] || [];
    if (selectedIds.length === 0) return;

    setVisibilityState((prev) => {
      const next = { ...prev };

      selectedIds.forEach((ruleId) => {
        const current = next?.[ruleId] || createDefaultRuleVisibility();
        next[ruleId] = {
          ...current,
          [role]: {
            ...current[role],
            [context]: level,
          },
        };
      });

      return next;
    });
  };

  const handleSave = async () => {
    if (!canEdit) return;

    const payload = sanitizeRuleVisibilityState({
      state: visibilityState,
      policeRules: configurableRules,
    });

    await updateSettings({
      ruleVisibilityMatrix: payload,
      visibilityModelVersion: 2,
      sensitiveAlwaysPrivate: true,
      reflectionEnabled,
    });

    onClose?.();
  };

  if (!isOpen) return null;

  const activeRules =
    activeContext === "reports" ? reportRules : historyRules;
  const activeSelectedIds = selectedRuleIdsByContext?.[activeContext] || [];
  const activeSelectionCount = activeSelectedIds.length;
  const activeContextMeta = CONTEXT_META[activeContext];
  const saveDisabled = !canEdit || isUpdatingSettings || isSettingsLoading;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="공개 설정" size="xl" data-tour={dataTour}>
      <div className="space-y-5 pb-2">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-3xl border border-indigo-100 bg-indigo-50 p-4">
            <div className="flex items-center gap-2 text-indigo-700">
              <ShieldCheck size={18} />
              <p className="text-sm font-black">교사</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-indigo-700/90">
              교사는 공개 설정과 관계없이 신고 접수 내역과 부과내역을 모두 상세하게 확인합니다.
            </p>
          </div>

          <div className="rounded-3xl border border-rose-100 bg-rose-50 p-4">
            <div className="flex items-center gap-2 text-rose-700">
              <ShieldAlert size={18} />
              <p className="text-sm font-black">민감 항목</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-rose-700/90">
              민감 신고와 민감 부과내역은 공개 설정과 무관하게 제한되며, 교사와 예외 대상만
              확인할 수 있습니다.
            </p>
          </div>

          <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <Users size={18} />
              <p className="text-sm font-black">본인 예외</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-emerald-700/90">
              경찰 관리자와 일반 학생 모두 자신의 신고와 자신의 부과내역은 항상 확인할 수
              있습니다.
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap gap-3">
            {VISIBILITY_LEVELS.map((level) => {
              const meta = LEVEL_UI_META[level];
              const Icon = meta.icon;

              return (
                <div
                  key={level}
                  className="flex min-w-[220px] flex-1 items-start gap-2 rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200"
                >
                  <Badge tone={meta.badgeTone} size="xs">
                    <Icon size={12} className="mr-1 inline-block" />
                    {meta.label}
                  </Badge>
                  <p className="text-xs leading-relaxed text-slate-500">
                    {meta.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-black text-slate-900">
                반성문 / 이의제기 기능
              </p>
              <p className="text-xs leading-relaxed text-slate-500">
                끄면 벌점 및 보상 내역의 반성문 셀을 숨기고, 학생이 반성문이나
                이의제기 모달을 열 수 없게 합니다.
              </p>
            </div>
            <ToggleSwitch
              id="police-reflection-enabled"
              checked={reflectionEnabled}
              onChange={setReflectionEnabled}
              disabled={!canEdit || isUpdatingSettings || isSettingsLoading}
              label={reflectionEnabled ? "사용" : "숨김"}
              srLabel="반성문 기능 사용 여부"
            />
          </div>
        </div>

        {isSettingsLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Spinner size="lg" />
            <p className="text-sm text-slate-400">공개 설정을 불러오는 중입니다.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-200 bg-white p-2">
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CONTEXT_META).map(([context, meta]) => {
                  const isActive = activeContext === context;

                  return (
                    <Button
                      key={context}
                      type="button"
                      onClick={() => setActiveContext(context)}
                      kind="ghost"
                      tone="blue"
                      aria-pressed={isActive}
                      className={`rounded-2xl px-4 py-3 text-left transition ${
                        isActive
                          ? "bg-indigo-500 text-white shadow-sm"
                          : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <p className="text-sm font-black">{meta.label}</p>
                      <p
                        className={`mt-1 text-xs leading-relaxed ${
                          isActive ? "text-indigo-100" : "text-slate-500"
                        }`}
                      >
                        {meta.description}
                      </p>
                    </Button>
                  );
                })}
              </div>
            </div>

            <RuleVisibilityTable
              context={activeContext}
              rules={activeRules}
              visibilityState={visibilityState}
              canEdit={canEdit}
              sortConfig={sortConfigByContext[activeContext]}
              onToggleSort={handleToggleSort}
              onChangeLevel={handleLevelChange}
              selectedIds={selectedRuleIdsByContext[activeContext]}
              onToggleRule={handleToggleRule}
              onToggleAll={handleToggleAllRules}
              onClearSelection={handleClearSelection}
              onBulkApply={handleBulkApply}
            />

            <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-slate-100 p-2 text-slate-500">
                  <FileWarning size={16} />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-black text-slate-900">운영 기준 안내</p>
                  <p className="text-xs leading-relaxed text-slate-500">
                    상금 규칙은 공개 설정에서 제외했습니다. 이 화면에서는 벌칙 규칙만
                    공개 수준을 조정합니다.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSelectionCount > 0 ? (
          <BulkActionFloatingBar
            count={activeSelectionCount}
            eyebrow="일괄 수정"
            title={activeContextMeta.label}
            tone="indigo"
            placement="sticky"
            compact={false}
            showCountBadge
            showEyebrow={false}
            onClear={() => handleClearSelection(activeContext)}
            clearLabel="선택 해제"
            actions={[
              {
                key: "save",
                label: "설정 저장",
                tone: "indigo",
                rounded: "full",
                icon: ShieldCheck,
                onClick: handleSave,
                disabled: saveDisabled,
                isLoading: isUpdatingSettings,
              },
            ]}
          >
            <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
              {ROLE_KEYS.map((role) => (
                <div
                  key={`${activeContext}-${role}-bulk`}
                  className="flex flex-nowrap items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <p className="shrink-0 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                    {ROLE_META[role].label}
                  </p>
                  <div className="flex flex-nowrap gap-1.5">
                    {VISIBILITY_LEVELS.map((level) => (
                      <BulkLevelButton
                        key={`${activeContext}-${role}-${level}`}
                        level={level}
                        onClick={() =>
                          handleBulkApply({ context: activeContext, role, level })
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </BulkActionFloatingBar>
        ) : (
          <div className="sticky bottom-0 z-[1] -mx-8 mt-4 border-t border-slate-200 bg-white/95 px-8 py-4 backdrop-blur">
            <div className="flex justify-end">
              <Button
                tone="blue"
                onClick={handleSave}
                disabled={saveDisabled}
                isLoading={isUpdatingSettings}
                icon={ShieldCheck}
                rounded="full"
              >
                설정 저장
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default VisibilitySettingsModal;
