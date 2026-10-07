import React, { useEffect, useMemo, useState } from "react";
import {
  AcademicCapIcon,
  ArchiveBoxIcon,
  Bars2Icon,
  BeakerIcon,
  BookOpenIcon,
  CameraIcon,
  CakeIcon,
  ChartBarIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  GlobeAltIcon,
  GiftIcon,
  HeartIcon,
  KeyIcon,
  LockClosedIcon,
  MusicalNoteIcon,
  NewspaperIcon,
  PaintBrushIcon,
  PencilIcon,
  MegaphoneIcon,
  PlusCircleIcon,
  ScissorsIcon,
  ShoppingCartIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  TicketIcon,
  TrashIcon,
  TrophyIcon,
  UserGroupIcon,
  WrenchIcon,
} from "@heroicons/react/24/outline";
import {
  CATEGORY_CHIP_TONE_STYLES,
  DEFAULT_CATEGORY_CHIP_TONE,
} from "./toneStyles";

const ICON_MAP = {
  AcademicCap: AcademicCapIcon,
  AlertCircle: ExclamationTriangleIcon,
  Award: TrophyIcon,
  Backpack: ArchiveBoxIcon,
  BookOpen: BookOpenIcon,
  BarChart3: ChartBarIcon,
  Briefcase: ArchiveBoxIcon,
  Building: ArchiveBoxIcon,
  Brush: PaintBrushIcon,
  Bell: MegaphoneIcon,
  Camera: CameraIcon,
  Calendar: Bars2Icon,
  CheckCircle: StarIcon,
  Clock: Bars2Icon,
  Coffee: CakeIcon,
  Crown: TrophyIcon,
  CupSoda: CakeIcon,
  Film: FilmIcon,
  FileText: PencilIcon,
  Flame: SparklesIcon,
  FlaskConical: BeakerIcon,
  Gamepad2: SparklesIcon,
  Gift: GiftIcon,
  Globe: GlobeAltIcon,
  GraduationCap: AcademicCapIcon,
  Hammer: WrenchIcon,
  Headphones: MusicalNoteIcon,
  Heart: HeartIcon,
  Eye: CameraIcon,
  Lightbulb: SparklesIcon,
  KeyRound: KeyIcon,
  Laptop: ComputerDesktopIcon,
  Leaf: SparklesIcon,
  LockKeyhole: LockClosedIcon,
  Settings: WrenchIcon,
  Music2: MusicalNoteIcon,
  Newspaper: NewspaperIcon,
  Package: ArchiveBoxIcon,
  PaintBrush: PaintBrushIcon,
  Pencil: PencilIcon,
  Palette: PaintBrushIcon,
  Pizza: CakeIcon,
  Scissors: ScissorsIcon,
  ShoppingCart: ShoppingCartIcon,
  Users: UserGroupIcon,
  Smartphone: DevicePhoneMobileIcon,
  Sparkles: SparklesIcon,
  Star: StarIcon,
  Tag: TagIcon,
  Ticket: TicketIcon,
  Target: TrophyIcon,
  Trophy: TrophyIcon,
  TrendingUp: ChartBarIcon,
  Zap: SparklesIcon,
  Wrench: WrenchIcon,
};

const COLOR_STYLES = CATEGORY_CHIP_TONE_STYLES;
const DEFAULT_STYLE = DEFAULT_CATEGORY_CHIP_TONE;

const CategoryChipBar = ({
  items = [],
  selectedId = null,
  onSelect,
  canEdit = false,
  onAdd,
  onEdit,
  onDelete,
  onReorder,
  showDeleteAction = true,
  title = "분류 선택",
  addLabel = "분류 추가",
  editLabel = "편집 모드",
  doneLabel = "완료",
  emptyMessage = "아직 분류가 없어요.",
  className = "",
  showHeader = false,
  mode = "chip",
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const list = useMemo(() => items.filter(Boolean), [items]);
  const isNavigationMode = mode === "navigation";

  useEffect(() => {
    if (!isEditMode) {
      setDraggedItem(null);
      setDragOverId(null);
    }
  }, [isEditMode]);

  const handleDragStart = (event, item) => {
    if (item.locked || item.reorderable === false || !onReorder) return;
    setDraggedItem(item);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (event, item) => {
    if (
      !draggedItem ||
      !onReorder ||
      draggedItem.id === item.id ||
      item.reorderable === false
    ) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverId(item.id);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverId(null);
  };

  const handleDrop = (event, targetItem) => {
    if (
      !draggedItem ||
      !onReorder ||
      draggedItem.id === targetItem.id ||
      targetItem.reorderable === false
    ) {
      return;
    }
    event.preventDefault();

    const current = [...list];
    const sourceIndex = current.findIndex((item) => item.id === draggedItem.id);
    const targetIndex = current.findIndex((item) => item.id === targetItem.id);
    if (sourceIndex < 0 || targetIndex < 0) {
      handleDragEnd();
      return;
    }

    const reordered = [...current];
    const [movedItem] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, movedItem);

    onReorder(reordered);
    handleDragEnd();
  };

  const renderBrowseChip = (item) => {
    const Icon = ICON_MAP[item.iconKey] || TagIcon;
    const colorStyle = COLOR_STYLES[item.colorKey] || DEFAULT_STYLE;
    const isSelected = item.id === selectedId;
    const isActive = item.active !== false;
    const isVip = item.variant === "vip";

    if (isNavigationMode) {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => isActive && onSelect?.(item.id)}
          disabled={!isActive}
          className={
            isVip
              ? `group relative flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-black transition-colors ${
                  isSelected
                    ? "border-amber-500 text-slate-950"
                    : isActive
                      ? "border-transparent text-amber-700 hover:border-amber-300 hover:text-slate-950"
                      : "cursor-not-allowed border-transparent text-slate-400"
                }`
              : `group relative flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-bold transition-colors ${
                  isSelected
                    ? "border-indigo-500 text-slate-950"
                    : isActive
                      ? "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                      : "cursor-not-allowed border-transparent text-slate-400"
                }`
          }
        >
          <Icon
            className={`h-4 w-4 ${
              isVip
                ? isSelected
                  ? "text-amber-500"
                  : "text-amber-600"
                : isSelected
                  ? colorStyle.icon
                  : "text-slate-400 group-hover:text-slate-500"
            }`}
          />
          <span className="whitespace-nowrap">{item.label}</span>
          {item.badgeLabel ? (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                isVip
                  ? "bg-amber-100 text-slate-800"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {item.badgeLabel}
            </span>
          ) : null}
          {item.locked ? (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">
              기본
            </span>
          ) : null}
        </button>
      );
    }

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => isActive && onSelect?.(item.id)}
        disabled={!isActive}
        className={
          isVip
            ? `group flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-black transition-all ${
                isSelected
                  ? "border-amber-200 bg-slate-950 text-amber-100 shadow-[0_18px_38px_-22px_rgba(15,23,42,0.95)] ring-1 ring-amber-200/50"
                  : isActive
                    ? "border-slate-800 bg-gradient-to-br from-slate-950 to-slate-800 text-amber-100 shadow-sm hover:border-amber-200/60 hover:text-amber-50"
                    : "cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400"
              }`
            : `group flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition-all ${
                isSelected
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm ring-1 ring-indigo-100"
                  : isActive
                    ? "border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                    : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
              }`
        }
      >
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
            isVip
              ? isSelected
                ? "bg-amber-100 text-slate-950"
                : "bg-amber-200/10 text-amber-100 group-hover:bg-amber-200/20"
              : isSelected
                ? "bg-white/90"
                : "bg-slate-50 group-hover:bg-white"
          }`}
        >
          <Icon className={`h-4 w-4 ${isVip ? "" : colorStyle.icon}`} />
        </span>
        <span className="whitespace-nowrap">{item.label}</span>
        {item.badgeLabel ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
              isVip
                ? "bg-amber-100 text-slate-950"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {item.badgeLabel}
          </span>
        ) : null}
        {item.locked ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">
            기본
          </span>
        ) : null}
      </button>
    );
  };

  const renderEditChip = (item) => {
    const Icon = ICON_MAP[item.iconKey] || TagIcon;
    const colorStyle = COLOR_STYLES[item.colorKey] || DEFAULT_STYLE;
    const isDragging = draggedItem?.id === item.id;
    const isDragOver = dragOverId === item.id;

    return (
      <div
        key={item.id}
        draggable={!item.locked && item.reorderable !== false && Boolean(onReorder)}
        onDragStart={(event) => handleDragStart(event, item)}
        onDragOver={(event) => handleDragOver(event, item)}
        onDragLeave={() => setDragOverId(null)}
        onDrop={(event) => handleDrop(event, item)}
        onDragEnd={handleDragEnd}
        className={`flex shrink-0 items-center gap-1.5 border transition-all ${
          isNavigationMode ? "rounded-xl px-2.5 py-1.5" : "rounded-2xl px-2.5 py-2"
        } ${
          item.locked
            ? "border-amber-200 bg-amber-50"
            : "border-slate-200 bg-slate-50"
        } ${isDragging ? "scale-[0.98] opacity-50" : ""} ${
          isDragOver ? "border-indigo-300 bg-indigo-50 shadow-sm" : ""
        }`}
      >
        {showDeleteAction ? (
          <button
            type="button"
            onClick={() => onDelete?.(item)}
            disabled={item.deletable === false}
            className={`rounded-xl p-1.5 transition-colors ${
              item.deletable === false
                ? "cursor-not-allowed text-slate-300"
                : "text-rose-500 hover:bg-rose-100"
            }`}
            title={item.deletable === false ? "삭제할 수 없습니다." : "삭제"}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        ) : null}

        <div
          className={`rounded-xl p-1.5 ${
            item.locked || item.reorderable === false
              ? "text-slate-300"
              : "cursor-grab text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
          }`}
          title={
            item.locked || item.reorderable === false
              ? "기본 카테고리는 순서를 바꿀 수 없습니다."
              : "드래그해서 순서를 바꿔보세요."
          }
        >
          <Bars2Icon className="h-4 w-4" />
        </div>

        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white">
          <Icon className={`h-4 w-4 ${colorStyle.icon}`} />
        </span>

        <span className="max-w-[160px] truncate text-sm font-semibold text-slate-700">
          {item.label}
        </span>

        <button
          type="button"
          onClick={() => onEdit?.(item)}
          disabled={item.editable === false}
          className={`rounded-xl p-1.5 transition-colors ${
            item.editable === false
              ? "cursor-not-allowed text-slate-300"
              : "text-indigo-500 hover:bg-indigo-100"
          }`}
          title={item.editable === false ? "수정할 수 없습니다." : "수정"}
        >
          <PencilIcon className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const renderAddChip = () => {
    if (isEditMode || !canEdit || !onAdd) return null;

    return (
      <button
        type="button"
        onClick={onAdd}
        className={
          isNavigationMode
            ? "flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-transparent px-3 text-sm font-bold text-slate-500 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            : "flex shrink-0 items-center gap-2 rounded-full border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-all hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
        }
      >
        <PlusCircleIcon className="h-4 w-4" />
        <span>{addLabel}</span>
      </button>
    );
  };

  const renderEditModeToggle = () => {
    if (!canEdit || list.length === 0) return null;

    return (
      <button
        type="button"
        onClick={() => setIsEditMode((prev) => !prev)}
        className={`shrink-0 border text-xs font-black transition-all ${
          isNavigationMode ? "h-9 rounded-md px-3" : "rounded-full px-3.5 py-2"
        } ${
          isEditMode
            ? "border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm"
            : isNavigationMode
              ? "border-slate-200 bg-transparent text-slate-500 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              : "border-slate-200 bg-white text-slate-600 shadow-sm hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
        }`}
      >
        {isEditMode ? doneLabel : editLabel}
      </button>
    );
  };

  const chipRow = (
    <>
      {list.map((item) =>
        isEditMode && item.action !== true
          ? renderEditChip(item)
          : renderBrowseChip(item),
      )}
      {renderAddChip()}
    </>
  );

  return (
    <div className={`${isNavigationMode ? "mt-3" : "mt-6"} ${className}`.trim()}>
      <div
        className={
          isNavigationMode
            ? "border-b border-slate-200"
            : "rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm"
        }
      >
        {showHeader ? (
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
              {title}
            </p>
            <p className="text-xs font-medium text-slate-500">
              {isEditMode
                ? "드래그로 순서를 바꾸고 수정이나 삭제를 할 수 있습니다."
                : "분류를 선택해 원하는 항목을 찾아보세요."}
            </p>
          </div>

            {renderEditModeToggle()}
          </div>
        ) : null}

        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center">
            <p className="text-sm font-semibold text-slate-500">{emptyMessage}</p>
            {canEdit && onAdd ? (
              <button
                type="button"
                onClick={onAdd}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-600"
              >
                <PlusCircleIcon className="h-4 w-4" />
                <span>{addLabel}</span>
              </button>
            ) : null}
          </div>
        ) : (
          <div
            className={`flex gap-2 ${
              isNavigationMode ? "items-end" : "items-center"
            } ${!showHeader && canEdit ? "min-w-0" : ""}`}
          >
            <div
              className={`flex min-w-0 flex-1 overflow-x-auto scrollbar-hide ${
                isNavigationMode ? "items-end gap-1" : "items-center gap-2"
              }`}
            >
              {chipRow}
            </div>
            {!showHeader ? renderEditModeToggle() : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default CategoryChipBar;
