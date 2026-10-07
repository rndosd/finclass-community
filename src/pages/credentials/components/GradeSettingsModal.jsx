import { useEffect, useMemo, useState } from "react";
import { ChevronDown, GripVertical, Palette, Plus, Trash2 } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";

import { Alert, Badge, Button, Modal, Tabs } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import { normalizeTitleCategoryList } from "../CredentialsPage.parts";
import {
  normalizeTitleCollectionStageAccentColor,
  normalizeTitleCollectionStageTone,
  getTitleCollectionStageToneColor,
  TITLE_COLLECTION_STAGE_TONE_OPTIONS,
} from "../titleCollectionStageTones";
import {
  getTitleCollectionConfiguredVisualStage,
  getTitleCollectionVisualStageForConfiguredStage,
  TITLE_COLLECTION_STAGE_ASSETS,
} from "../titleCollectionStageVisuals";

const TAB_ITEMS = [
  { id: "titleGrades", label: "등급 설정" },
  { id: "titleCategories", label: "카테고리 설정" },
  { id: "titleCollectionStages", label: "도감 단계" },
];

const TONE_OPTIONS = [
  { value: "slate", label: "슬레이트", previewColor: "#64748b" },
  { value: "blue", label: "파랑", previewColor: "#3b82f6" },
  { value: "indigo", label: "남색", previewColor: "#6366f1" },
  { value: "emerald", label: "초록", previewColor: "#10b981" },
  { value: "violet", label: "보라", previewColor: "#8b5cf6" },
  { value: "amber", label: "호박", previewColor: "#f59e0b" },
  { value: "red", label: "빨강", previewColor: "#ef4444" },
];

const CATEGORY_ICON_OPTIONS = [
  { value: "Tag", label: "태그" },
  { value: "BookOpen", label: "책" },
  { value: "AcademicCap", label: "학습" },
  { value: "Sparkles", label: "반짝" },
  { value: "Star", label: "별" },
  { value: "Trophy", label: "트로피" },
  { value: "Gift", label: "선물" },
  { value: "ShoppingCart", label: "쇼핑" },
  { value: "Newspaper", label: "뉴스" },
  { value: "Heart", label: "관심" },
  { value: "Ticket", label: "티켓" },
  { value: "Backpack", label: "가방" },
];

function getStageVisualMeta(item, index, stages) {
  const sortedStages = [...(stages || [])].sort(
    (left, right) =>
      Number(left?.minRate || 0) - Number(right?.minRate || 0) ||
      Number(left?.order || 0) - Number(right?.order || 0),
  );
  const configuredStageIndex = sortedStages.findIndex((stage) => stage === item);
  const resolvedStageIndex = configuredStageIndex >= 0 ? configuredStageIndex : index;
  const automaticStage = getTitleCollectionVisualStageForConfiguredStage(
    resolvedStageIndex,
    sortedStages.length,
  );
  const visualStage = getTitleCollectionConfiguredVisualStage(
    item,
    resolvedStageIndex,
    sortedStages.length,
  );

  return { automaticStage, visualStage };
}

function StageEmblemPreview({ item, index, stages, onChange }) {
  const { visualStage } = getStageVisualMeta(item, index, stages);
  const asset = TITLE_COLLECTION_STAGE_ASSETS[visualStage - 1];
  const accent = getTitleCollectionStageToneColor(
    item?.tone,
    item?.accentColor,
  );

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onChange}
        className="group relative flex h-[72px] w-[72px] items-center justify-center rounded-2xl border bg-white transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
        style={{
          borderColor: `${accent}52`,
          backgroundImage: `radial-gradient(circle, ${accent}1f, rgba(255,255,255,0.96) 70%)`,
          boxShadow: `0 8px 20px -16px ${accent}`,
        }}
        aria-label={`${item?.label || `도감 단계 ${index + 1}`} 엠블럼 변경`}
      >
        <img
          src={asset}
          alt=""
          aria-hidden="true"
          className="h-16 w-16 object-contain"
        />
        <span className="absolute inset-x-1 bottom-1 rounded-md bg-slate-950/72 px-1 py-0.5 text-[9px] font-bold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          변경
        </span>
      </button>
      <span className="text-[10px] font-bold text-slate-400">적용 엠블럼</span>
    </div>
  );
}

function StageEmblemPicker({ item, index, stages, onSelect, onReset }) {
  const { automaticStage, visualStage } = getStageVisualMeta(
    item,
    index,
    stages,
  );

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black text-slate-700">사용할 엠블럼 선택</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            이 단계에 자동 배정된 엠블럼과 그 이전 엠블럼만 선택할 수 있습니다.
          </p>
        </div>
        {item?.emblemStage ? (
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg px-2 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-white hover:text-violet-700"
          >
            자동 추천으로 되돌리기
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {TITLE_COLLECTION_STAGE_ASSETS.slice(0, automaticStage).map((asset, assetIndex) => {
          const candidateStage = assetIndex + 1;
          const isSelected = candidateStage === visualStage;

          return (
            <button
              key={`stage-emblem-${candidateStage}`}
              type="button"
              onClick={() => onSelect(candidateStage)}
              className={`relative rounded-xl border bg-white p-1.5 transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                isSelected
                  ? "border-violet-400 ring-2 ring-violet-100"
                  : "border-slate-200"
              }`}
              aria-label={`엠블럼 ${candidateStage} 선택`}
              aria-pressed={isSelected}
            >
              <img
                src={asset}
                alt=""
                aria-hidden="true"
                className="aspect-square w-full object-contain"
              />
              <span className={`mt-1 block text-[9px] font-bold ${isSelected ? "text-violet-700" : "text-slate-400"}`}>
                엠블럼 {candidateStage}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StageColorPicker({
  item,
  index,
  isOpen,
  isSubmitting,
  creditTierPresets,
  onToggle,
  onToneSelect,
  onTierSelect,
}) {
  const accent = getTitleCollectionStageToneColor(
    item?.tone,
    item?.accentColor,
  );
  const colorLabel = item?.accentColor
    ? `원본 ${item.accentColor}`
    : TITLE_COLLECTION_STAGE_TONE_OPTIONS.find(
        (option) => option.value === item?.tone,
      )?.label || "슬레이트";

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={isSubmitting}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        aria-expanded={isOpen}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="h-5 w-5 shrink-0 rounded-full border-2 border-white shadow-sm ring-1 ring-slate-900/10"
            style={{ backgroundColor: accent }}
          />
          <span className="min-w-0">
            <span className="block text-[10px] font-bold text-slate-400">강조 색상</span>
            <span className="block truncate text-xs font-bold text-slate-700">{colorLabel}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-slate-500">
          <Palette className="h-3.5 w-3.5" aria-hidden="true" />
          색상 변경
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {isOpen ? (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-bold text-slate-500">기본 색상</p>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-label={`${item.label || `도감 단계 ${index + 1}`} 강조 색상`}
          >
            {TITLE_COLLECTION_STAGE_TONE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onToneSelect(option.value)}
                disabled={isSubmitting}
                className={`h-7 w-7 rounded-full border-2 border-white shadow-sm transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  !item.accentColor && item.tone === option.value
                    ? "ring-2 ring-slate-800 ring-offset-2"
                    : "ring-1 ring-slate-900/10"
                }`}
                style={{ backgroundColor: option.previewColor }}
                aria-label={option.label}
                aria-pressed={!item.accentColor && item.tone === option.value}
                title={option.label}
              />
            ))}
          </div>

          {creditTierPresets.length ? (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-bold text-slate-500">신용등급 색상</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {creditTierPresets.map((tier) => {
                  const isSelected =
                    normalizeHexColor(item.accentColor) ===
                    normalizeHexColor(tier.color);

                  return (
                    <button
                      key={`${item.id}-${tier.id || tier.name}`}
                      type="button"
                      onClick={() => onTierSelect(tier.color)}
                      disabled={isSubmitting}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        isSelected
                          ? "border-violet-200 bg-violet-50 text-violet-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                      title={`${tier.name} (${tier.color})`}
                    >
                      <span
                        className="h-3 w-3 rounded-full border border-white shadow-sm"
                        style={{ backgroundColor: tier.color }}
                      />
                      <span>{tier.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const CATEGORY_COLOR_OPTIONS = [
  { value: "slate", label: "슬레이트", previewColor: "#64748b" },
  { value: "blue", label: "블루", previewColor: "#3b82f6" },
  { value: "cyan", label: "시안", previewColor: "#06b6d4" },
  { value: "indigo", label: "인디고", previewColor: "#6366f1" },
  { value: "emerald", label: "에메랄드", previewColor: "#10b981" },
  { value: "green", label: "그린", previewColor: "#22c55e" },
  { value: "orange", label: "오렌지", previewColor: "#f97316" },
  { value: "red", label: "레드", previewColor: "#ef4444" },
  { value: "rose", label: "로즈", previewColor: "#f43f5e" },
  { value: "purple", label: "퍼플", previewColor: "#a855f7" },
  { value: "violet", label: "바이올렛", previewColor: "#8b5cf6" },
];

const normalizeTone = (value) =>
  TONE_OPTIONS.some((option) => option.value === value) ? value : "slate";

const getCategoryColorOption = (value) =>
  CATEGORY_COLOR_OPTIONS.find((option) => option.value === value) ||
  CATEGORY_COLOR_OPTIONS[0];

const normalizeHexColor = (value) => {
  const rawValue = String(value || "").trim();
  if (!/^#([0-9A-Fa-f]{3}){1,2}$/.test(rawValue)) return "";

  if (rawValue.length === 4) {
    return `#${rawValue[1]}${rawValue[1]}${rawValue[2]}${rawValue[2]}${rawValue[3]}${rawValue[3]}`.toLowerCase();
  }

  return rawValue.toLowerCase();
};

const hexToRgb = (value) => {
  const hexColor = normalizeHexColor(value);
  if (!hexColor) return null;

  return {
    r: parseInt(hexColor.slice(1, 3), 16),
    g: parseInt(hexColor.slice(3, 5), 16),
    b: parseInt(hexColor.slice(5, 7), 16),
  };
};

const getClosestToneFromHex = (value) => {
  const targetRgb = hexToRgb(value);
  if (!targetRgb) return "slate";

  return TONE_OPTIONS.reduce(
    (closest, option) => {
      const optionRgb = hexToRgb(option.previewColor);
      if (!optionRgb) return closest;

      const distance =
        (targetRgb.r - optionRgb.r) ** 2 +
        (targetRgb.g - optionRgb.g) ** 2 +
        (targetRgb.b - optionRgb.b) ** 2;

      if (distance < closest.distance) {
        return { tone: option.value, distance };
      }

      return closest;
    },
    { tone: "slate", distance: Number.POSITIVE_INFINITY },
  ).tone;
};

const getClosestCategoryColorFromHex = (value) => {
  const targetRgb = hexToRgb(value);
  if (!targetRgb) return CATEGORY_COLOR_OPTIONS[0].value;

  return CATEGORY_COLOR_OPTIONS.reduce(
    (closest, option) => {
      const optionRgb = hexToRgb(option.previewColor);
      if (!optionRgb) return closest;

      const distance =
        (targetRgb.r - optionRgb.r) ** 2 +
        (targetRgb.g - optionRgb.g) ** 2 +
        (targetRgb.b - optionRgb.b) ** 2;

      if (distance < closest.distance) {
        return { colorKey: option.value, distance };
      }

      return closest;
    },
    {
      colorKey: CATEGORY_COLOR_OPTIONS[0].value,
      distance: Number.POSITIVE_INFINITY,
    },
  ).colorKey;
};

const clampRate = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
};

const reorderList = (list, fromIndex, toIndex, mapper) => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return list;
  if (fromIndex >= list.length || toIndex >= list.length) return list;

  const nextList = [...list];
  const [moved] = nextList.splice(fromIndex, 1);
  nextList.splice(toIndex, 0, moved);
  return nextList.map(mapper);
};

const normalizeCategoryList = (items = []) =>
  normalizeTitleCategoryList(items.filter((item) => !item?.isFallback));

const createGradeDraft = (index) => ({
  id: `title-grade-${Date.now()}-${index + 1}`,
  label: `칭호 등급 ${index + 1}`,
  tone: "slate",
  order: index + 1,
});

const createCategoryDraft = (label, index) =>
  normalizeTitleCategoryList([
    {
      id: `title-category-${Date.now()}-${index + 1}`,
      label,
      order: index + 1,
    },
  ])[0];

const normalizeStageList = (items = []) =>
  [...items]
    .map((item, index) => ({
      id: item?.id || `title-stage-${index + 1}`,
      label: String(item?.label || "").trim() || `도감 단계 ${index + 1}`,
      minRate: clampRate(item?.minRate ?? item?.threshold ?? 0),
      tone: normalizeTitleCollectionStageTone(item?.tone),
      accentColor: normalizeTitleCollectionStageAccentColor(
        item?.accentColor || item?.color,
      ),
      emblemStage: Math.max(
        0,
        Math.min(12, Math.round(Number(item?.emblemStage ?? item?.visualStage) || 0)),
      ) || null,
      order: Number(item?.order) || index + 1,
    }))
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({
      ...item,
      order: index + 1,
    }));

const createStageDraft = (index) => ({
  id: `title-stage-${Date.now()}-${index + 1}`,
  label: `도감 단계 ${index + 1}`,
  minRate: index === 0 ? 0 : Math.min(100, index * 25),
  tone: "slate",
  accentColor: "",
  emblemStage: null,
  order: index + 1,
});

export default function GradeSettingsModal({
  open,
  titleGrades = [],
  titleCategories = [],
  titleCollectionStages = [],
  onClose,
  onSubmit,
  isSubmitting,
}) {
  const { showFeedback } = useFeedback();
  const { classId } = useUser();
  const [activeTab, setActiveTab] = useState(TAB_ITEMS[0].id);
  const [draggingGradeIndex, setDraggingGradeIndex] = useState(null);
  const [draggingCategoryIndex, setDraggingCategoryIndex] = useState(null);
  const [draggingStageIndex, setDraggingStageIndex] = useState(null);
  const [expandedStageColorId, setExpandedStageColorId] = useState(null);
  const [expandedStageEmblemId, setExpandedStageEmblemId] = useState(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [form, setForm] = useState({
    titleGrades: titleGrades || [],
    titleCategories: normalizeCategoryList(titleCategories),
    titleCollectionStages: normalizeStageList(titleCollectionStages),
  });
  const [creditTierPresets, setCreditTierPresets] = useState([]);

  useEffect(() => {
    if (!open) return;

    setActiveTab(TAB_ITEMS[0].id);
    setDraggingGradeIndex(null);
    setDraggingCategoryIndex(null);
    setDraggingStageIndex(null);
    setExpandedStageColorId(null);
    setExpandedStageEmblemId(null);
    setNewCategoryName("");
    setForm({
      titleGrades: titleGrades || [],
      titleCategories: normalizeCategoryList(titleCategories),
      titleCollectionStages: normalizeStageList(titleCollectionStages),
    });
  }, [open, titleCategories, titleCollectionStages, titleGrades]);

  useEffect(() => {
    let isMounted = true;

    const loadCreditTierPresets = async () => {
      if (!open || !classId) {
        if (isMounted) setCreditTierPresets([]);
        return;
      }

      try {
        const tierSnapshot = await getDoc(
          doc(db, `classes/${classId}/tierCriteria/default`),
        );
        const nextPresets = tierSnapshot.exists()
          ? (tierSnapshot.data()?.tiers || [])
              .filter(
                (tier) =>
                  String(tier?.name || "").trim() &&
                  normalizeHexColor(tier?.color),
              )
              .sort((left, right) => Number(right?.minScore || 0) - Number(left?.minScore || 0))
          : [];

        if (isMounted) {
          setCreditTierPresets(nextPresets);
        }
      } catch (error) {
        if (isMounted) {
          setCreditTierPresets([]);
        }
      }
    };

    loadCreditTierPresets();

    return () => {
      isMounted = false;
    };
  }, [classId, open]);

  const categoryCountLabel = useMemo(
    () => `${form.titleCategories.length}개 카테고리`,
    [form.titleCategories.length],
  );

  const stageCountLabel = useMemo(
    () => `${form.titleCollectionStages.length}개 단계`,
    [form.titleCollectionStages.length],
  );

  const moveGrade = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setForm((prev) => ({
      ...prev,
      titleGrades: reorderList(prev.titleGrades, fromIndex, toIndex, (item, index) => ({
        ...item,
        order: index + 1,
      })),
    }));
    showFeedback("등급 순서가 바뀌었습니다. 저장하면 반영됩니다.", "info");
  };

  const moveCategory = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setForm((prev) => ({
      ...prev,
      titleCategories: reorderList(
        prev.titleCategories,
        fromIndex,
        toIndex,
        (item, index) => ({
          ...item,
          order: index + 1,
        }),
      ),
    }));
    showFeedback("카테고리 순서가 바뀌었습니다. 저장하면 반영됩니다.", "info");
  };

  const moveStage = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setForm((prev) => {
      const orderedMinRates = prev.titleCollectionStages
        .map((item) => clampRate(item?.minRate))
        .sort((left, right) => left - right);

      return {
        ...prev,
        titleCollectionStages: reorderList(
          prev.titleCollectionStages,
          fromIndex,
          toIndex,
          (item, index) => ({
            ...item,
            minRate: orderedMinRates[index],
            order: index + 1,
          }),
        ),
      };
    });
    showFeedback(
      "도감 단계와 시작 비율 구간의 순서가 함께 바뀌었습니다. 저장하면 반영됩니다.",
      "info",
    );
  };

  const updateGradeField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      titleGrades: prev.titleGrades.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const removeGrade = (index) => {
    setForm((prev) => ({
      ...prev,
      titleGrades: prev.titleGrades
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({
          ...item,
          order: itemIndex + 1,
        })),
    }));
  };

  const addGrade = () => {
    setForm((prev) => ({
      ...prev,
      titleGrades: [...prev.titleGrades, createGradeDraft(prev.titleGrades.length)],
    }));
  };

  const addCategory = () => {
    const trimmed = String(newCategoryName || "").trim();
    if (!trimmed) return;

    setForm((prev) => ({
      ...prev,
      titleCategories: prev.titleCategories.some(
        (item) => item.label.toLowerCase() === trimmed.toLowerCase(),
      )
        ? prev.titleCategories
        : [
            ...prev.titleCategories,
            createCategoryDraft(trimmed, prev.titleCategories.length),
          ],
    }));
    setNewCategoryName("");
  };

  const updateCategoryField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      titleCategories: prev.titleCategories.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const removeCategory = (targetId) => {
    setForm((prev) => ({
      ...prev,
      titleCategories: prev.titleCategories.filter((item) => item.id !== targetId),
    }));
  };

  const updateStageField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      titleCollectionStages: prev.titleCollectionStages.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: field === "minRate" ? clampRate(value) : value,
              ...(field === "tone" ? { accentColor: "" } : {}),
            }
          : item,
      ),
    }));
  };

  const addStage = () => {
    if (form.titleCollectionStages.length >= 12) {
      showFeedback("도감 단계는 최대 12개까지 만들 수 있습니다.", "warning");
      return;
    }
    setForm((prev) => ({
      ...prev,
      titleCollectionStages: [
        ...prev.titleCollectionStages,
        createStageDraft(prev.titleCollectionStages.length),
      ],
    }));
  };

  const removeStage = (index) => {
    setForm((prev) => ({
      ...prev,
      titleCollectionStages: prev.titleCollectionStages
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({
          ...item,
          order: itemIndex + 1,
        })),
    }));
  };

  const handleSubmit = () => {
    onSubmit({
      titleGrades: form.titleGrades,
      titleCategories: normalizeCategoryList(form.titleCategories),
      titleCollectionStages: normalizeStageList(form.titleCollectionStages),
    });
  };

  const applyTierPresetToGrade = (index, tierColor) => {
    updateGradeField(index, "tone", getClosestToneFromHex(tierColor));
  };

  const applyTierPresetToCategory = (index, tierColor) => {
    updateCategoryField(index, "colorKey", getClosestCategoryColorFromHex(tierColor));
  };

  const applyTierPresetToStage = (index, tierColor) => {
    const accentColor = normalizeHexColor(tierColor);
    if (!accentColor) return;

    setForm((prev) => ({
      ...prev,
      titleCollectionStages: prev.titleCollectionStages.map((item, itemIndex) =>
        itemIndex === index ? { ...item, accentColor } : item,
      ),
    }));
  };

  return (
    <Modal
      isOpen={open}
      onClose={isSubmitting ? undefined : onClose}
      title="칭호/카테고리 설정"
      size="lg"
    >
      <div className="space-y-5">
        <Alert
          type="info"
          message="칭호 등급, 카테고리, 도감 단계를 한 곳에서 관리합니다. 순서를 바꾸면 학생 화면과 교사용 지급 화면에도 같은 순서로 반영됩니다."
        />

        <Tabs
          tabs={TAB_ITEMS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          variant="underline"
          size="md"
          className="w-full max-w-xl"
        />

        {activeTab === "titleGrades" ? (
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">칭호 등급</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  칭호 등급 이름과 강조 색상을 직접 정할 수 있습니다.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                tone="blue"
                onClick={addGrade}
                icon={Plus}
                disabled={isSubmitting}
              >
                등급 추가
              </Button>
            </div>

            <div className="space-y-3">
              {form.titleGrades.map((item, index) => (
                <div
                  key={item.id}
                  onDragOver={(event) => {
                    if (!isSubmitting && draggingGradeIndex !== null) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggingGradeIndex === null) return;
                    moveGrade(draggingGradeIndex, index);
                    setDraggingGradeIndex(null);
                  }}
                  className={`rounded-2xl border border-white/90 bg-white p-3 shadow-sm transition sm:p-4 ${
                    draggingGradeIndex === index
                      ? "ring-2 ring-indigo-200 opacity-70"
                      : "hover:border-slate-200"
                  }`}
                >
                    <div className="grid gap-3 sm:grid-cols-[auto,minmax(0,1fr)] lg:grid-cols-[auto,minmax(0,1fr),180px,auto]">
                    <div className="flex items-start sm:pt-6">
                      <button
                        type="button"
                        draggable={!isSubmitting}
                        onDragStart={() => setDraggingGradeIndex(index)}
                        onDragEnd={() => setDraggingGradeIndex(null)}
                        disabled={isSubmitting}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-400 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
                        aria-label={`등급 ${index + 1} 순서 이동`}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        등급 이름
                      </label>
                      <input
                        type="text"
                        value={item.label || ""}
                        onChange={(event) => updateGradeField(index, "label", event.target.value)}
                        disabled={isSubmitting}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        placeholder="등급 이름"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        강조 색상
                      </label>
                      <select
                        value={item.tone || "slate"}
                        onChange={(event) => updateGradeField(index, "tone", event.target.value)}
                        disabled={isSubmitting}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      >
                        {TONE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-end justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        tone="red"
                        onClick={() => removeGrade(index)}
                        disabled={isSubmitting || form.titleGrades.length <= 1}
                        icon={Trash2}
                      >
                        삭제
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge tone="slate">순서 {index + 1}</Badge>
                    <Badge tone={normalizeTone(item.tone)}>
                      {item.label || `칭호 등급 ${index + 1}`}
                    </Badge>
                  </div>

                  {creditTierPresets.length ? (
                    <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                      <p className="text-[11px] font-semibold text-slate-500">
                        신용등급 색상 프리셋
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {creditTierPresets.map((tier) => {
                          const recommendedTone = getClosestToneFromHex(tier.color);
                          const isSelected =
                            normalizeTone(item.tone) === recommendedTone;

                          return (
                            <button
                              key={`${item.id}-${tier.id || tier.name}`}
                              type="button"
                              onClick={() => applyTierPresetToGrade(index, tier.color)}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                isSelected
                                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                              }`}
                              title={`${tier.name} (${tier.color})`}
                            >
                              <span
                                className="h-3 w-3 rounded-full border border-white shadow-sm"
                                style={{ backgroundColor: tier.color }}
                              />
                              <span>{tier.name}</span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-slate-500">
                        프리셋을 누르면 현재 칭호 강조색 체계에서 가장 가까운 색으로
                        적용됩니다.
                      </p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === "titleCategories" ? (
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">칭호 카테고리</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  카테고리 이름, 아이콘, 색상, 순서를 한 번에 정할 수 있습니다.
                </p>
              </div>
              <Badge tone="indigo">{categoryCountLabel}</Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                type="text"
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="새 카테고리 이름"
                disabled={isSubmitting}
                className="flex-1 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <Button
                size="sm"
                tone="blue"
                icon={Plus}
                onClick={addCategory}
                disabled={isSubmitting}
              >
                추가
              </Button>
            </div>

            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-3 text-xs leading-5 text-slate-500">
              카테고리 이름을 바꾸면 같은 카테고리를 쓰는 칭호 정의에도 함께 반영됩니다.
            </div>

            <div className="space-y-3">
              {form.titleCategories.length ? (
                form.titleCategories.map((item, index) => {
                  const categoryColorOption = getCategoryColorOption(
                    item.colorKey || CATEGORY_COLOR_OPTIONS[0].value,
                  );

                  return (
                    <div
                      key={item.id}
                      onDragOver={(event) => {
                        if (!isSubmitting && draggingCategoryIndex !== null) {
                          event.preventDefault();
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggingCategoryIndex === null) return;
                        moveCategory(draggingCategoryIndex, index);
                        setDraggingCategoryIndex(null);
                      }}
                      className={`rounded-2xl border border-white/90 bg-white px-3 py-3 shadow-sm transition sm:px-4 ${
                        draggingCategoryIndex === index
                          ? "ring-2 ring-indigo-200 opacity-70"
                          : "hover:border-slate-200"
                      }`}
                    >
                      <div className="grid gap-3 sm:grid-cols-[auto,minmax(0,1fr)] lg:grid-cols-[auto,minmax(0,1.2fr),160px,190px,auto]">
                        <div className="flex items-start sm:pt-6">
                          <button
                            type="button"
                            draggable={!isSubmitting}
                            onDragStart={() => setDraggingCategoryIndex(index)}
                            onDragEnd={() => setDraggingCategoryIndex(null)}
                            disabled={isSubmitting}
                            className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-400 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
                            aria-label={`${item.label} 카테고리 순서 이동`}
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">
                            카테고리 이름
                          </label>
                          <input
                            type="text"
                            value={item.label || ""}
                            onChange={(event) =>
                              updateCategoryField(index, "label", event.target.value)
                            }
                            disabled={isSubmitting}
                            className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                            placeholder="카테고리 이름"
                          />
                          <p className="mt-1 text-xs text-slate-500">순서 {index + 1}</p>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">
                            아이콘
                          </label>
                          <select
                            value={item.iconKey || CATEGORY_ICON_OPTIONS[0].value}
                            onChange={(event) =>
                              updateCategoryField(index, "iconKey", event.target.value)
                            }
                            disabled={isSubmitting}
                            className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                          >
                            {CATEGORY_ICON_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">
                            색상
                          </label>
                          <div className="flex items-center gap-2">
                            <span
                              className="h-4 w-4 shrink-0 rounded-full border border-white shadow ring-1 ring-slate-200"
                              style={{
                                backgroundColor: categoryColorOption.previewColor,
                              }}
                            />
                            <select
                              value={item.colorKey || CATEGORY_COLOR_OPTIONS[0].value}
                              onChange={(event) =>
                                updateCategoryField(index, "colorKey", event.target.value)
                              }
                              disabled={isSubmitting}
                              className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                            >
                              {CATEGORY_COLOR_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="flex items-end justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            tone="red"
                            onClick={() => removeCategory(item.id)}
                            disabled={isSubmitting}
                            icon={Trash2}
                          >
                            삭제
                          </Button>
                        </div>
                      </div>

                      {creditTierPresets.length ? (
                        <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                          <p className="text-[11px] font-semibold text-slate-500">
                            신용등급 색상 프리셋
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {creditTierPresets.map((tier) => {
                              const recommendedColorKey = getClosestCategoryColorFromHex(tier.color);
                              const isSelected =
                                categoryColorOption.value === recommendedColorKey;

                              return (
                                <button
                                  key={`${item.id}-${tier.id || tier.name}`}
                                  type="button"
                                  onClick={() => applyTierPresetToCategory(index, tier.color)}
                                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                    isSelected
                                      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                                  }`}
                                  title={`${tier.name} (${tier.color})`}
                                >
                                  <span
                                    className="h-3 w-3 rounded-full border border-white shadow-sm"
                                    style={{ backgroundColor: tier.color }}
                                  />
                                  <span>{tier.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                  아직 등록된 카테고리가 없습니다. 먼저 카테고리를 추가해 주세요.
                </div>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "titleCollectionStages" ? (
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">도감 단계</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  단계 번호를 끌어 순서를 바꿀 수 있습니다. 시작 비율 구간은 유지되고 단계 이름·색상·엠블럼이 새 순서로 이동합니다.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="violet">{stageCountLabel}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  tone="blue"
                  onClick={addStage}
                  icon={Plus}
                  disabled={isSubmitting || form.titleCollectionStages.length >= 12}
                >
                  단계 추가
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {form.titleCollectionStages.length ? (
                form.titleCollectionStages.map((item, index) => (
                  <div
                    key={item.id}
                    onDragOver={(event) => {
                      if (!isSubmitting && draggingStageIndex !== null) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggingStageIndex === null) return;
                      moveStage(draggingStageIndex, index);
                      setDraggingStageIndex(null);
                    }}
                    className={`rounded-2xl border border-white/90 bg-white p-3 shadow-sm transition sm:p-4 ${
                      draggingStageIndex === index
                        ? "ring-2 ring-violet-200 opacity-70"
                        : "hover:border-slate-200"
                    }`}
                  >
                    <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <button
                        type="button"
                        draggable={!isSubmitting}
                        onDragStart={() => setDraggingStageIndex(index)}
                        onDragEnd={() => setDraggingStageIndex(null)}
                        disabled={isSubmitting}
                        className="inline-flex cursor-grab items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={`${index + 1}단계 순서 이동`}
                      >
                        <GripVertical className="h-4 w-4 text-slate-400" aria-hidden="true" />
                        {index + 1}단계
                      </button>

                      <Button tone="rose" kind="ghost" size="xs"
                        type="button"
                        onClick={() => removeStage(index)}
                        disabled={isSubmitting || form.titleCollectionStages.length <= 1}
                        className="inline-flex items-center gap-1.5 transition disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        단계 삭제
                      </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-[84px_minmax(0,1fr)]">
                      <StageEmblemPreview
                        item={item}
                        index={index}
                        stages={form.titleCollectionStages}
                        onChange={() => setExpandedStageEmblemId((current) =>
                          current === item.id ? null : item.id
                        )}
                      />

                      <div className="min-w-0">
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-600">
                              단계 이름
                            </label>
                            <input
                              type="text"
                              value={item.label || ""}
                              onChange={(event) => updateStageField(index, "label", event.target.value)}
                              disabled={isSubmitting}
                              className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                              placeholder="도감 단계 이름"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-600">
                              시작 비율
                            </label>
                            <div className="relative">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="1"
                                value={item.minRate ?? 0}
                                onChange={(event) => updateStageField(index, "minRate", event.target.value)}
                                disabled={isSubmitting}
                                className="w-full rounded-xl border border-blue-200 bg-blue-50/50 py-2 pl-3 pr-8 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                              />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                            </div>
                          </div>
                        </div>

                        <StageColorPicker
                          item={item}
                          index={index}
                          isOpen={expandedStageColorId === item.id}
                          isSubmitting={isSubmitting}
                          creditTierPresets={creditTierPresets}
                          onToggle={() => setExpandedStageColorId((current) =>
                            current === item.id ? null : item.id
                          )}
                          onToneSelect={(tone) => updateStageField(index, "tone", tone)}
                          onTierSelect={(color) => applyTierPresetToStage(index, color)}
                        />
                      </div>
                    </div>

                    {expandedStageEmblemId === item.id ? (
                      <StageEmblemPicker
                        item={item}
                        index={index}
                        stages={form.titleCollectionStages}
                        onSelect={(emblemStage) =>
                          updateStageField(index, "emblemStage", emblemStage)
                        }
                        onReset={() => updateStageField(index, "emblemStage", null)}
                      />
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                  아직 등록된 도감 단계가 없습니다. 먼저 단계를 추가해 주세요.
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="sticky bottom-0 z-20 -mx-4 grid grid-cols-2 gap-3 border-t border-slate-100 bg-white/95 px-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:flex sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            닫기
          </Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting}>
            저장
          </Button>
        </div>
      </div>
    </Modal>
  );
}
