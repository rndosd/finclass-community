import { useEffect, useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil } from "lucide-react";

import { Badge, Button } from "../../../components/ui";
import { CERTIFICATE_TEMPLATE_OPTIONS } from "../certificateStyleOptions";

function isNoSelectionTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,label,select,textarea,svg,path,[role='button'],[data-no-selection='true']",
    ),
  );
}

const ISSUE_METHOD_LABELS = {
  manual: "수동 발급",
  assignment: "과제 충족",
  exam: "시험 충족",
  project: "프로젝트 충족",
};

function getTemplateLabel(value) {
  return (
    CERTIFICATE_TEMPLATE_OPTIONS.find((item) => item.value === value)?.label ||
    "라이선스 카드"
  );
}

function SortableCertificateDefinitionRow({
  item,
  isSelected,
  isSavingOrder = false,
  formatDexNumber,
  onToggleSelection,
  onEdit,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: isSavingOrder,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      onClick={(event) => {
        if (isNoSelectionTarget(event.target)) return;
        onToggleSelection(item.id);
      }}
      className={[
        "cursor-pointer select-none border-b border-slate-100 transition-colors",
        isSelected ? "bg-cyan-50/70" : "bg-white hover:bg-slate-50/80",
        isDragging
          ? "relative z-10 bg-sky-50 shadow-[0_18px_40px_-28px_rgba(14,165,233,0.35)]"
          : "",
      ].join(" ")}
    >
      <td className="w-12 px-4 py-4 align-top">
        <input
          data-no-selection="true"
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelection(item.id)}
          aria-label={`${item.name} 선택`}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
      </td>

      <td className="w-16 px-2 py-4 align-top">
        <Button
          type="button"
          data-no-selection="true"
          aria-label={`${item.name} 순서 이동`}
          className={[
            "mt-[-2px] rounded-xl p-2 transition-colors",
            isSavingOrder
              ? "cursor-not-allowed text-slate-300"
              : "cursor-grab text-slate-400 hover:bg-slate-100 hover:text-sky-600 active:cursor-grabbing",
          ].join(" ")}
          disabled={isSavingOrder}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </Button>
      </td>

      <td className="w-24 px-4 py-4 align-top">
        <Badge tone="slate">No. {formatDexNumber(item.displayOrder)}</Badge>
      </td>

      <td className="min-w-[280px] px-4 py-4 align-top">
        <div className="space-y-1">
          <p className="font-bold text-slate-900">{item.name}</p>
          <p className="line-clamp-2 max-w-[340px] text-xs leading-5 text-slate-500">
            {item.description || "학생에게 보여 줄 자격증 설명이 아직 없습니다."}
          </p>
        </div>
      </td>

      <td className="w-36 px-4 py-4 align-top">
        <Badge tone="blue">{item.categoryLabel || "미분류"}</Badge>
      </td>

      <td className="w-28 px-4 py-4 align-top">
        {item.gradeLabel ? (
          <Badge tone={item.gradeTone || "slate"}>{item.gradeLabel}</Badge>
        ) : (
          <span className="text-sm text-slate-400">단계 없음</span>
        )}
      </td>

      <td className="w-36 px-4 py-4 align-top text-sm text-slate-700">
        {getTemplateLabel(item.templateId)}
      </td>

      <td className="w-32 px-4 py-4 align-top text-sm text-slate-700">
        {ISSUE_METHOD_LABELS[item.issueMethod] || item.issueMethod || "수동 발급"}
      </td>

      <td className="min-w-[220px] px-4 py-4 align-top">
        <div className="flex flex-wrap gap-2">
          <Badge tone={item.expiresEnabled ? "amber" : "slate"}>
            {item.expiresEnabled ? "만료 사용" : "기한 없음"}
          </Badge>
          <Badge tone={item.isVisible === false ? "amber" : "blue"}>
            {item.isVisible === false ? "학생 숨김" : "학생 노출"}
          </Badge>
          <Badge tone={item.isActive === false ? "slate" : "emerald"}>
            {item.isActive === false ? "발급 중지" : "발급 가능"}
          </Badge>
        </div>
      </td>

      <td className="w-20 px-4 py-4 align-top">
        <Button
          size="sm"
          variant="ghost"
          tone="slate"
          icon={Pencil}
          data-no-selection="true"
          onClick={() => onEdit?.(item)}
          aria-label={`${item.name} 수정`}
        />
      </td>
    </tr>
  );
}

export default function CertificateDefinitionListTable({
  items,
  selectedDefinitionIds,
  allSelected = false,
  onToggleSelection,
  onToggleAllSelection,
  onReorder,
  onEdit,
  isSavingOrder = false,
  formatDexNumber,
}) {
  const [orderedItems, setOrderedItems] = useState(items);
  const selectedIdSet = useMemo(
    () => new Set(selectedDefinitionIds),
    [selectedDefinitionIds],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    setOrderedItems(items);
  }, [items]);

  const handleDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id || isSavingOrder) return;

    const oldIndex = orderedItems.findIndex((item) => item.id === active.id);
    const newIndex = orderedItems.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reorderedItems = arrayMove(orderedItems, oldIndex, newIndex);
    setOrderedItems(reorderedItems);

    try {
      await onReorder?.(reorderedItems);
    } catch (error) {
      setOrderedItems(items);
    }
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-xs leading-5 text-slate-500">
        목록형에서는 자격증을 빠르게 정리하고 순서를 조정할 수 있습니다.
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <table className="min-w-[1360px] text-sm">
          <thead className="bg-slate-50/90">
            <tr className="text-left text-xs font-black uppercase tracking-[0.16em] text-slate-400">
              <th className="w-12 px-4 py-3">
                <input
                  data-no-selection="true"
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAllSelection}
                  aria-label={allSelected ? "전체 선택 해제" : "전체 선택"}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
              </th>
              <th className="w-16 px-2 py-3">순서</th>
              <th className="w-24 px-4 py-3">번호</th>
              <th className="min-w-[280px] px-4 py-3">자격증명</th>
              <th className="w-36 px-4 py-3">카테고리</th>
              <th className="w-28 px-4 py-3">단계</th>
              <th className="w-36 px-4 py-3">템플릿</th>
              <th className="w-32 px-4 py-3">발급 방식</th>
              <th className="min-w-[220px] px-4 py-3">상태</th>
              <th className="w-20 px-4 py-3">작업</th>
            </tr>
          </thead>
          <SortableContext
            items={orderedItems.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <tbody>
              {orderedItems.map((item) => (
                <SortableCertificateDefinitionRow
                  key={item.id}
                  item={item}
                  isSelected={selectedIdSet.has(item.id)}
                  isSavingOrder={isSavingOrder}
                  formatDexNumber={formatDexNumber}
                  onToggleSelection={onToggleSelection}
                  onEdit={onEdit}
                />
              ))}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>
    </div>
  );
}
