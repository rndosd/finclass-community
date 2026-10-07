import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";

import { BulkActionFloatingBar } from "../../../components/ui";
import PoliceRuleCard from "./PoliceRuleCard";
import RewardRuleCard from "./RewardRuleCard";
import { isPenaltyRule, isRewardRule } from "../utils/policeRuleUtils";
import dangerLevel1Asset from "../../../assets/police/danger-level-1-v1.webp";
import dangerLevel2Asset from "../../../assets/police/danger-level-2-v1.webp";
import dangerLevel3Asset from "../../../assets/police/danger-level-3-v1.webp";
import rewardRuleAsset from "../../../assets/police/reward-rule-v1.webp";

const resolveLevelLabel = (labelMap, level) => {
  const raw = labelMap?.[level];
  if (typeof raw === "string" && raw.trim()) return raw;
  if (
    raw &&
    typeof raw === "object" &&
    typeof raw.label === "string" &&
    raw.label.trim()
  ) {
    return raw.label;
  }
  return `위험도 ${level}`;
};
const SHELF_TONES = {
  3: {
    asset: dangerLevel3Asset,
    badge: "bg-rose-100 text-rose-700",
    count: "bg-rose-50 text-rose-700 ring-rose-100",
    surface: "border-rose-100 bg-rose-50/45",
  },
  2: {
    asset: dangerLevel2Asset,
    badge: "bg-orange-100 text-orange-700",
    count: "bg-orange-50 text-orange-700 ring-orange-100",
    surface: "border-orange-100 bg-orange-50/45",
  },
  1: {
    asset: dangerLevel1Asset,
    badge: "bg-amber-100 text-amber-700",
    count: "bg-amber-50 text-amber-700 ring-amber-100",
    surface: "border-amber-100 bg-amber-50/40",
  },
  reward: {
    asset: rewardRuleAsset,
    badge: "bg-emerald-100 text-emerald-700",
    count: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    surface: "border-emerald-100 bg-emerald-50/40",
  },
};

const RuleShelf = ({ label, count, tone = 1, wide = false, children }) => {
  const items = React.Children.toArray(children);
  const toneStyle = SHELF_TONES[tone] || SHELF_TONES[1];
  const cleanLabel = String(label || "").replace(/^[^가-힣A-Za-z0-9]+/, "");

  return (
    <section
      className={`h-full rounded-3xl border p-4 shadow-sm sm:p-5 ${toneStyle.surface}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            <img
              src={toneStyle.asset}
              alt=""
              className="h-14 w-14 object-contain"
              fetchPriority="high"
              decoding="async"
            />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-black text-slate-800 sm:text-lg">
              {cleanLabel}
            </h3>
          </div>
          <span
            className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-1 text-xs font-black ring-1 ${toneStyle.count}`}
          >
            {count}
          </span>
        </div>
      </div>

      <div className={wide ? "grid gap-2 lg:grid-cols-2" : "space-y-2"}>
        {items}
      </div>
    </section>
  );
};

const SortableRuleCard = ({ id, editMode, disabled = false, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: !editMode || disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : "auto",
    opacity: isDragging ? 0.65 : 1,
  };

  const dragHandleProps =
    editMode && !disabled ? { ...attributes, ...listeners } : {};

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {editMode ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="absolute right-2 top-2 z-30 flex h-9 w-9 touch-none cursor-grab items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          title="드래그로 순서 변경"
          aria-label="드래그로 순서 변경"
          disabled={disabled}
          {...dragHandleProps}
        >
          <GripVertical className="h-5 w-5" />
        </button>
      ) : null}
      {children}
    </div>
  );
};

const toSafeOrder = (value, fallback) => {
  const order = Number(value);
  return Number.isFinite(order) ? order : fallback;
};

const buildOrderUpdates = (sortedRules, activeId, overId) => {
  const ids = sortedRules.map((rule) => rule.id);
  const oldIndex = ids.indexOf(activeId);
  const newIndex = ids.indexOf(overId);

  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
    return { updates: [] };
  }

  const reorderedIds = arrayMove(ids, oldIndex, newIndex);
  const slots = sortedRules
    .map((rule, index) => toSafeOrder(rule.order, index + 1))
    .sort((a, b) => a - b);

  const beforeOrderById = new Map(
    sortedRules.map((rule, index) => [
      rule.id,
      toSafeOrder(rule.order, index + 1),
    ]),
  );

  const updates = reorderedIds
    .map((id, index) => ({ id, order: slots[index] }))
    .filter(({ id, order }) => beforeOrderById.get(id) !== order);

  return { updates };
};

const PoliceRuleList = ({
  rules,
  ruleType = "penalty",
  onEdit,
  onDelete,
  onApplyRule,
  onBulkDelete,
  onReorder,
  labelMap,
  isEditable,
  currencyUnit,
  editMode,
  isDeleting = false,
  isReordering = false,
}) => {
  const [selected, setSelected] = useState(new Set());
  const [orderedRules, setOrderedRules] = useState([]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    setOrderedRules(Array.isArray(rules) ? rules : []);
  }, [rules]);

  const dedupRules = useMemo(() => {
    const seen = new Set();

    return (orderedRules || []).filter((rule) => {
      if (!rule?.id) return false;
      if (seen.has(rule.id)) return false;
      seen.add(rule.id);
      return true;
    });
  }, [orderedRules]);

  const penaltyRules = useMemo(
    () =>
      dedupRules
        .filter((rule) => isPenaltyRule(rule))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [dedupRules],
  );

  const rewardRules = useMemo(
    () =>
      dedupRules
        .filter((rule) => isRewardRule(rule))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [dedupRules],
  );

  const groupedRules = useMemo(() => {
    const groups = { 3: [], 2: [], 1: [] };

    penaltyRules.forEach((rule) => {
      let level = parseInt(rule?.dangerLevel, 10);
      if (![1, 2, 3].includes(level)) level = 1;
      groups[level].push(rule);
    });

    return [3, 2, 1].map((level) => ({
      level,
      rules: groups[level].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }));
  }, [penaltyRules]);

  const visibleIds = useMemo(
    () => [...penaltyRules, ...rewardRules].map((rule) => rule.id),
    [penaltyRules, rewardRules],
  );

  const selectedIds = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [selected, visibleIds],
  );

  const selectedCount = selectedIds.length;
  const isSelectionLocked = isDeleting || isReordering;

  useEffect(() => {
    if (!editMode && selected.size) {
      setSelected(new Set());
    }
  }, [editMode, selected.size]);

  useEffect(() => {
    setSelected((prev) => {
      const allowed = new Set(visibleIds);
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  const toggleSelect = (id) => {
    if (!editMode || isSelectionLocked) return;

    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyReorder = useCallback(
    async (sortedSubset, activeId, overId) => {
      if (
        !editMode ||
        isReordering ||
        !activeId ||
        !overId ||
        activeId === overId
      ) {
        return;
      }

      const { updates } = buildOrderUpdates(sortedSubset, activeId, overId);
      if (!updates.length) return;

      const updateMap = new Map(
        updates.map((update) => [update.id, update.order]),
      );
      const before = orderedRules;

      setOrderedRules((prev) =>
        prev.map((rule) =>
          updateMap.has(rule.id)
            ? {
                ...rule,
                order: updateMap.get(rule.id),
              }
            : rule,
        ),
      );

      try {
        await onReorder?.(updates);
      } catch {
        setOrderedRules(before);
      }
    },
    [editMode, isReordering, onReorder, orderedRules],
  );

  const handleBulkDelete = async () => {
    if (!selectedCount || isSelectionLocked) return;

    try {
      await onBulkDelete?.(selectedIds);
      setSelected(new Set());
    } catch {
      // Feedback is surfaced by the mutation layer.
    }
  };

  const barLabel = ruleType === "reward" ? "선택 상금 규칙" : "선택 벌금 규칙";
  const barDeleteLabel =
    ruleType === "reward" ? "선택 상금 규칙 삭제" : "선택 벌금 규칙 삭제";

  return (
    <div className={selectedCount > 0 ? "space-y-6 pb-32" : "space-y-6"}>
      {penaltyRules.length > 0 ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {groupedRules
            .filter((group) => group.rules.length > 0)
            .map((group) => (
              <div
                key={group.level}
                className={group.level === 1 ? "lg:col-span-2" : ""}
              >
                <span className="sr-only">
                  {resolveLevelLabel(labelMap, group.level)}
                </span>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) =>
                    applyReorder(group.rules, event.active?.id, event.over?.id)
                  }
                >
                  <SortableContext
                    items={group.rules.map((rule) => rule.id)}
                    strategy={rectSortingStrategy}
                  >
                    <RuleShelf
                      label={resolveLevelLabel(labelMap, group.level)}
                      count={group.rules.length}
                      tone={group.level}
                      wide={group.level === 1}
                    >
                      {group.rules.map((rule) => (
                        <SortableRuleCard
                          key={rule.id}
                          id={rule.id}
                          editMode={editMode}
                          disabled={isSelectionLocked}
                        >
                          <PoliceRuleCard
                            rule={rule}
                            viewMode="list"
                            editMode={editMode}
                            selected={selected.has(rule.id)}
                            onToggleSelect={() => toggleSelect(rule.id)}
                            onEdit={
                              isEditable ? () => onEdit?.(rule) : undefined
                            }
                            onDelete={
                              isEditable ? () => onDelete?.(rule.id) : undefined
                            }
                            onApplyRule={
                              onApplyRule ? () => onApplyRule(rule) : undefined
                            }
                            canManage={isEditable}
                            currencyUnit={currencyUnit}
                          />
                        </SortableRuleCard>
                      ))}
                    </RuleShelf>
                  </SortableContext>
                </DndContext>
              </div>
            ))}
        </div>
      ) : null}

      {rewardRules.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) =>
            applyReorder(rewardRules, event.active?.id, event.over?.id)
          }
        >
          <SortableContext
            items={rewardRules.map((rule) => rule.id)}
            strategy={rectSortingStrategy}
          >
            <RuleShelf
              label="상점 규칙"
              count={rewardRules.length}
              tone="reward"
              wide
            >
              {rewardRules.map((rule) => (
                <SortableRuleCard
                  key={rule.id}
                  id={rule.id}
                  editMode={editMode}
                  disabled={isSelectionLocked}
                >
                  <RewardRuleCard
                    rule={rule}
                    viewMode="list"
                    editMode={editMode}
                    selected={selected.has(rule.id)}
                    onToggleSelect={() => toggleSelect(rule.id)}
                    onEdit={isEditable ? () => onEdit?.(rule) : undefined}
                    onDelete={
                      isEditable ? () => onDelete?.(rule.id) : undefined
                    }
                    onApplyRule={
                      onApplyRule ? () => onApplyRule(rule) : undefined
                    }
                    canManage={isEditable}
                    currencyUnit={currencyUnit}
                  />
                </SortableRuleCard>
              ))}
            </RuleShelf>
          </SortableContext>
        </DndContext>
      ) : null}

      {isEditable && editMode && selectedCount > 0 ? (
        <BulkActionFloatingBar
          count={selectedCount}
          tone="rose"
          icon={Trash2}
          eyebrow={barLabel}
          title="선택한 규칙을 한 번에 삭제할 수 있습니다"
          subtitle="카드를 눌러 선택한 뒤 공통 플로팅바에서 바로 삭제하세요."
          actions={[
            {
              key: "delete",
              label: barDeleteLabel,
              onClick: handleBulkDelete,
              icon: Trash2,
              tone: "rose",
              disabled: isSelectionLocked,
              isLoading: isDeleting,
            },
          ]}
          onClear={() => setSelected(new Set())}
          clearLabel="선택 해제"
        />
      ) : null}
    </div>
  );
};

export default PoliceRuleList;
