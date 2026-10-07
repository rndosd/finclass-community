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
import { ArrowDown, ArrowUp, GripVertical, Pencil } from "lucide-react";

import { Badge, Button } from "../../../components/ui";
import { formatTitleRevealConfigLabel } from "../CredentialsPage.parts";

function isNoSelectionTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,label,select,textarea,svg,path,[role='button'],[data-no-selection='true']",
    ),
  );
}

// eslint-disable-next-line no-unused-vars
function formatRevealMode(value) {
  switch (value) {
    case "name_only":
      return "이름 공개 / 조건 비공개";
    case "name_and_condition":
      return "이름 공개 / 조건 공개";
    case "blurred":
      return "이름 블러 / 조건 블러";
    case "hidden":
      return "이름 비공개 / 조건 비공개";
    case "condition_only":
    default:
      return "이름 비공개 / 조건 공개";
  }
}

function SortArrow({ active, descending }) {
  if (!active) return null;
  return descending ? (
    <ArrowDown className="h-3.5 w-3.5" />
  ) : (
    <ArrowUp className="h-3.5 w-3.5" />
  );
}

function SortHeaderButton({
  label,
  active = false,
  descending = false,
  onClick,
  ascLabel,
  descLabel,
}) {
  return (
    <Button
      type="button"
      data-no-selection="true"
      onClick={onClick}
      className="inline-flex items-center gap-1 font-inherit text-inherit transition hover:text-slate-600"
      aria-label={descending ? ascLabel : descLabel}
    >
      <span>{label}</span>
      <SortArrow active={active} descending={descending} />
    </Button>
  );
}

function SortableTitleDefinitionRow({
  item,
  isSelected,
  isSavingOrder = false,
  enableReorder = true,
  formatDexNumber,
  onToggleSelection,
  onEdit,
  onItemMouseDown,
  onItemMouseEnter,
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
    disabled: isSavingOrder || !enableReorder,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      onMouseDown={(event) => {
        if (event.button !== 0 || isNoSelectionTarget(event.target)) return;
        onItemMouseDown?.(item, event);
      }}
      onMouseEnter={() => onItemMouseEnter?.(item)}
      className={[
        "cursor-pointer select-none border-b border-slate-100 transition-colors",
        isSelected ? "bg-rose-50/60" : "bg-white hover:bg-slate-50/80",
        isDragging
          ? "relative z-10 bg-indigo-50 shadow-[0_18px_40px_-28px_rgba(79,70,229,0.45)]"
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
          className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
      </td>

      <td className="w-16 px-2 py-4 align-top">
        <Button
          type="button"
          data-no-selection="true"
          aria-label={`${item.name} 순서 이동`}
          className={[
            "mt-[-2px] rounded-xl p-2 transition-colors",
            isSavingOrder || !enableReorder
              ? "cursor-not-allowed text-slate-300"
              : "cursor-grab text-slate-400 hover:bg-slate-100 hover:text-indigo-600 active:cursor-grabbing",
          ].join(" ")}
          disabled={isSavingOrder || !enableReorder}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </Button>
      </td>

      <td className="w-24 px-4 py-4 align-top">
        <Badge tone="slate">No. {formatDexNumber(item.displayOrder)}</Badge>
      </td>

      <td className="min-w-[320px] px-4 py-4 align-top">
        <div className="min-w-0 space-y-1">
          <p className="font-bold text-slate-900">{item.name}</p>
          <p className="max-w-[360px] text-xs leading-5 text-slate-500">
            {item.acquisitionCondition || "획득 조건이 아직 등록되지 않았습니다."}
          </p>
        </div>
      </td>

      <td className="w-36 px-4 py-4 align-top">
        <Badge tone="blue">{item.categoryLabel || "미분류"}</Badge>
      </td>

      <td className="w-28 px-4 py-4 align-top">
        <Badge tone={item.gradeTone || "slate"}>
          {item.gradeLabel || "등급 없음"}
        </Badge>
      </td>

      <td className="min-w-[180px] px-4 py-4 align-top text-sm text-slate-700">
        {formatTitleRevealConfigLabel(item.revealConfig, item.revealMode)}
      </td>

      <td className="min-w-[200px] px-4 py-4 align-top">
        <div className="flex flex-wrap gap-2">
          <Badge tone={item.allowStudentRequest !== false ? "indigo" : "slate"}>
            {item.allowStudentRequest !== false ? "요청 허용" : "요청 잠금"}
          </Badge>
          <Badge tone={item.isVisible === false ? "amber" : "blue"}>
            {item.isVisible === false ? "도감 숨김" : "도감 노출"}
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

export default function TitleDefinitionListTable({
  items,
  selectedDefinitionIds,
  allSelected = false,
  onToggleSelection,
  onToggleAllSelection,
  onReorder,
  onEdit,
  isSavingOrder = false,
  enableReorder = true,
  formatDexNumber,
  onItemMouseDown,
  onItemMouseEnter,
  listSortMode = "display-order-asc",
  onToggleSort,
}) {
  const [orderedItems, setOrderedItems] = useState(items);
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);
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
    if (!enableReorder || !over || active.id === over.id || isSavingOrder) {
      return;
    }

    const oldIndex = orderedItems.findIndex((item) => item.id === active.id);
    const newIndex = orderedItems.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reorderedItems = arrayMove(orderedItems, oldIndex, newIndex);
    setOrderedItems(reorderedItems);

    try {
      await onReorder?.(reorderedItems);
    } catch {
      setOrderedItems(items);
    }
  };

  const isOrderSort = listSortMode.startsWith("display-order");
  const isCategorySort = listSortMode.startsWith("category");
  const isGradeSort = listSortMode.startsWith("grade");

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-xs leading-5 text-slate-500">
        {enableReorder
          ? "목록형에서는 드래그로 순서를 바꾸고, 컬럼 헤더를 눌러 번호·카테고리·등급 기준으로 바로 정렬할 수 있습니다."
          : "번호 오름차순이 아닐 때는 드래그 순서 변경이 잠시 꺼집니다. 순서를 직접 바꾸려면 번호 오름차순으로 돌아와 주세요."}
      </div>

      <div className="space-y-3 p-4 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-slate-500">
            칭호를 선택하면 일괄 관리할 수 있습니다.
          </p>
          <Button
            type="button"
            size="sm"
            tone={mobileSelectionMode ? "rose" : "slate"}
            kind={mobileSelectionMode ? "soft" : "outline"}
            onClick={() => {
              if (mobileSelectionMode) {
                selectedDefinitionIds.forEach((id) => onToggleSelection(id));
              }
              setMobileSelectionMode((current) => !current);
            }}
            className="min-h-11 shrink-0 justify-center"
          >
            {mobileSelectionMode ? "선택 종료" : "선택"}
          </Button>
        </div>

        {mobileSelectionMode ? (
          <label className="flex min-h-11 items-center justify-between rounded-xl bg-slate-50 px-3 text-sm font-bold text-slate-600">
            전체 칭호 선택
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAllSelection}
              className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
          </label>
        ) : null}

        {orderedItems.map((item) => {
          const isSelected = selectedIdSet.has(item.id);

          return (
            <article
              key={item.id}
              className={`rounded-2xl border p-4 ${
                isSelected
                  ? "border-rose-300 bg-rose-50/60"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-start gap-3">
                {mobileSelectionMode ? (
                  <label className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelection(item.id)}
                      className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="sr-only">{item.name} 선택</span>
                  </label>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="slate">
                      No. {formatDexNumber(item.displayOrder)}
                    </Badge>
                    <Badge tone={item.gradeTone || "slate"}>
                      {item.gradeLabel || "등급 없음"}
                    </Badge>
                  </div>
                  <p className="mt-2 font-black text-slate-900">{item.name}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500">
                    {item.acquisitionCondition ||
                      "획득 조건이 아직 등록되지 않았습니다."}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="blue">{item.categoryLabel || "미분류"}</Badge>
                <Badge tone={item.allowStudentRequest !== false ? "indigo" : "slate"}>
                  {item.allowStudentRequest !== false ? "요청 허용" : "요청 잠금"}
                </Badge>
                <Badge tone={item.isVisible === false ? "amber" : "blue"}>
                  {item.isVisible === false ? "도감 숨김" : "도감 노출"}
                </Badge>
              </div>

              <Button
                size="sm"
                variant="outline"
                tone="slate"
                icon={Pencil}
                onClick={() => onEdit?.(item)}
                className="mt-4 min-h-11 w-full justify-center"
              >
                칭호 수정
              </Button>
            </article>
          );
        })}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <table className="hidden min-w-[1260px] text-sm md:table">
          <thead className="bg-slate-50/90">
            <tr className="text-left text-xs font-black uppercase tracking-[0.16em] text-slate-400">
              <th className="w-12 px-4 py-3">
                <input
                  data-no-selection="true"
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAllSelection}
                  aria-label={allSelected ? "전체 선택 해제" : "전체 선택"}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </th>
              <th className="w-16 px-2 py-3">순서</th>
              <th className="w-24 px-4 py-3">
                <SortHeaderButton
                  label="번호"
                  active={isOrderSort}
                  descending={listSortMode === "display-order-desc"}
                  onClick={() => onToggleSort?.("display-order")}
                  ascLabel="번호 오름차순으로 정렬"
                  descLabel="번호 내림차순으로 정렬"
                />
              </th>
              <th className="min-w-[320px] px-4 py-3">칭호명</th>
              <th className="w-36 px-4 py-3">
                <SortHeaderButton
                  label="카테고리"
                  active={isCategorySort}
                  descending={listSortMode === "category-desc"}
                  onClick={() => onToggleSort?.("category")}
                  ascLabel="카테고리 오름차순으로 정렬"
                  descLabel="카테고리 내림차순으로 정렬"
                />
              </th>
              <th className="w-28 px-4 py-3">
                <SortHeaderButton
                  label="등급"
                  active={isGradeSort}
                  descending={listSortMode === "grade-desc"}
                  onClick={() => onToggleSort?.("grade")}
                  ascLabel="등급 오름차순으로 정렬"
                  descLabel="등급 내림차순으로 정렬"
                />
              </th>
              <th className="min-w-[180px] px-4 py-3">공개 방식</th>
              <th className="min-w-[200px] px-4 py-3">상태</th>
              <th className="w-20 px-4 py-3">작업</th>
            </tr>
          </thead>
          <SortableContext
            items={orderedItems.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <tbody>
              {orderedItems.map((item) => (
                <SortableTitleDefinitionRow
                  key={item.id}
                  item={item}
                  isSelected={selectedIdSet.has(item.id)}
                  isSavingOrder={isSavingOrder}
                  enableReorder={enableReorder}
                  formatDexNumber={formatDexNumber}
                  onToggleSelection={onToggleSelection}
                  onEdit={onEdit}
                  onItemMouseDown={onItemMouseDown}
                  onItemMouseEnter={onItemMouseEnter}
                />
              ))}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>
    </div>
  );
}
