import { useEffect, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import { Alert, Badge, Button, Modal, Tabs } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { normalizeTitleCategoryList } from "../CredentialsPage.parts";

const TAB_ITEMS = [
  { id: "certificateGrades", label: "단계 설정" },
  { id: "certificateCategories", label: "카테고리 설정" },
];

const GRADE_TONE_OPTIONS = [
  { value: "slate", label: "슬레이트" },
  { value: "blue", label: "블루" },
  { value: "indigo", label: "인디고" },
  { value: "emerald", label: "에메랄드" },
  { value: "violet", label: "바이올렛" },
  { value: "amber", label: "앰버" },
  { value: "red", label: "레드" },
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
  { value: "Heart", label: "하트" },
  { value: "Ticket", label: "티켓" },
  { value: "Backpack", label: "가방" },
];

const CATEGORY_COLOR_OPTIONS = [
  { value: "slate", label: "슬레이트" },
  { value: "blue", label: "블루" },
  { value: "cyan", label: "시안" },
  { value: "indigo", label: "인디고" },
  { value: "emerald", label: "에메랄드" },
  { value: "green", label: "그린" },
  { value: "orange", label: "오렌지" },
  { value: "red", label: "레드" },
  { value: "purple", label: "퍼플" },
  { value: "rose", label: "로즈" },
  { value: "violet", label: "바이올렛" },
];

const normalizeBadgeTone = (value) =>
  GRADE_TONE_OPTIONS.some((option) => option.value === value) ? value : "slate";

const normalizeConfiguredCategoryList = (items = []) =>
  normalizeTitleCategoryList(items.filter((item) => !item?.isFallback));

const reorderList = (list, fromIndex, toIndex) => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return list;
  if (fromIndex >= list.length || toIndex >= list.length) return list;

  const nextList = [...list];
  const [moved] = nextList.splice(fromIndex, 1);
  nextList.splice(toIndex, 0, moved);
  return nextList.map((item, index) => ({
    ...item,
    order: index + 1,
  }));
};

const createGradeDraft = (index) => ({
  id: `certificate-grade-${Date.now()}-${index + 1}`,
  label: `자격증 단계 ${index + 1}`,
  tone: "slate",
  order: index + 1,
});

const createCategoryDraft = (label, index) =>
  normalizeTitleCategoryList([
    {
      id: `certificate-category-${Date.now()}-${index + 1}`,
      label,
      order: index + 1,
    },
  ])[0];

export default function CertificateGradeSettingsModal({
  open,
  certificateGrades = [],
  certificateCategories = [],
  onClose,
  onSubmit,
  isSubmitting,
}) {
  const { showFeedback } = useFeedback();
  const [activeTab, setActiveTab] = useState(TAB_ITEMS[0].id);
  const [draggingGradeIndex, setDraggingGradeIndex] = useState(null);
  const [draggingCategoryIndex, setDraggingCategoryIndex] = useState(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [form, setForm] = useState({
    certificateGrades,
    certificateCategories: normalizeConfiguredCategoryList(certificateCategories),
  });

  useEffect(() => {
    if (!open) return;
    setActiveTab(TAB_ITEMS[0].id);
    setDraggingGradeIndex(null);
    setDraggingCategoryIndex(null);
    setNewCategoryName("");
    setForm({
      certificateGrades,
      certificateCategories: normalizeConfiguredCategoryList(certificateCategories),
    });
  }, [certificateCategories, certificateGrades, open]);

  const updateGradeField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      certificateGrades: prev.certificateGrades.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const addGrade = () => {
    setForm((prev) => ({
      ...prev,
      certificateGrades: [
        ...prev.certificateGrades,
        createGradeDraft(prev.certificateGrades.length),
      ],
    }));
  };

  const removeGrade = (index) => {
    setForm((prev) => ({
      ...prev,
      certificateGrades: prev.certificateGrades
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({
          ...item,
          order: itemIndex + 1,
        })),
    }));
  };

  const moveGrade = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setForm((prev) => ({
      ...prev,
      certificateGrades: reorderList(
        prev.certificateGrades,
        fromIndex,
        toIndex,
      ),
    }));
    showFeedback("자격증 단계 순서를 바꿨어요. 저장하면 반영됩니다.", "info");
  };

  const updateCategoryField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      certificateCategories: prev.certificateCategories.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const addCategory = () => {
    const label = newCategoryName.trim();
    if (!label) {
      showFeedback("추가할 자격증 카테고리 이름을 입력해 주세요.", "warning");
      return;
    }

    const normalizedCategories = normalizeTitleCategoryList([
      ...form.certificateCategories,
      createCategoryDraft(label, form.certificateCategories.length),
    ]);

    setForm((prev) => ({
      ...prev,
      certificateCategories: normalizedCategories,
    }));
    setNewCategoryName("");
  };

  const removeCategory = (index) => {
    setForm((prev) => ({
      ...prev,
      certificateCategories: prev.certificateCategories
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({
          ...item,
          order: itemIndex + 1,
        })),
    }));
  };

  const moveCategory = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setForm((prev) => ({
      ...prev,
      certificateCategories: reorderList(
        prev.certificateCategories,
        fromIndex,
        toIndex,
      ),
    }));
    showFeedback(
      "자격증 카테고리 순서를 바꿨어요. 저장하면 학생 화면에도 반영됩니다.",
      "info",
    );
  };

  const handleSubmit = () => {
    onSubmit({
      certificateGrades: form.certificateGrades,
      certificateCategories: normalizeConfiguredCategoryList(
        form.certificateCategories,
      ),
    });
  };

  return (
    <Modal
      isOpen={open}
      onClose={isSubmitting ? undefined : onClose}
      title="자격증 단계·카테고리 설정"
      size="lg"
    >
      <div className="space-y-5">
        <Alert
          type="info"
          message="단계는 선택 사항입니다. 모든 자격증에서 '단계 없음'을 선택할 수 있고, 단계가 필요한 자격증에만 아래의 단계를 사용합니다."
        />

        <Tabs
          tabs={TAB_ITEMS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          variant="underline"
          size="md"
        />

        {activeTab === "certificateGrades" ? (
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">자격증 단계</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  단계가 필요한 자격증에서 공통으로 사용하는 이름과 순서입니다.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                tone="indigo"
                onClick={addGrade}
                icon={Plus}
                disabled={isSubmitting}
              >
                단계 추가
              </Button>
            </div>

            <div className="space-y-3">
              {form.certificateGrades.length ? form.certificateGrades.map((item, index) => (
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
                  className={`rounded-2xl border border-white/90 bg-white p-4 shadow-sm transition ${
                    draggingGradeIndex === index
                      ? "ring-2 ring-indigo-200 opacity-70"
                      : "hover:border-slate-200"
                  }`}
                >
                  <div className="grid gap-3 lg:grid-cols-[auto,minmax(0,1fr),180px,auto]">
                    <div className="flex items-start pt-6">
                      <button
                        type="button"
                        draggable={!isSubmitting}
                        onDragStart={() => setDraggingGradeIndex(index)}
                        onDragEnd={() => setDraggingGradeIndex(null)}
                        disabled={isSubmitting}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-400 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
                        aria-label={`자격증 단계 ${index + 1} 순서 이동`}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        단계명
                      </label>
                      <input
                        type="text"
                        value={item.label || ""}
                        onChange={(event) =>
                          updateGradeField(index, "label", event.target.value)
                        }
                        disabled={isSubmitting}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-indigo-100"
                        placeholder="자격증 단계 이름"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        강조 색상
                      </label>
                      <select
                        value={item.tone || "slate"}
                        onChange={(event) =>
                          updateGradeField(index, "tone", event.target.value)
                        }
                        disabled={isSubmitting}
                        className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-indigo-100"
                      >
                        {GRADE_TONE_OPTIONS.map((option) => (
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
                        disabled={isSubmitting}
                        icon={Trash2}
                      >
                        삭제
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge tone="slate">순서 {index + 1}</Badge>
                    <Badge tone={normalizeBadgeTone(item.tone)}>
                      {item.label || `자격증 단계 ${index + 1}`}
                    </Badge>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  추가한 단계가 없습니다. 모든 자격증에 ‘단계 없음’을 사용할 수 있습니다.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">자격증 카테고리</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  자격증 정의, 학생 보관함 필터, 이후 증서 템플릿의 기본 테마에 함께 사용됩니다.
                </p>
              </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-dashed border-slate-200 bg-white/80 p-4 md:grid-cols-[minmax(0,1fr),auto]">
              <input
                type="text"
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="새 자격증 카테고리 이름"
                disabled={isSubmitting}
                className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-indigo-100"
              />
              <Button
                size="sm"
                tone="indigo"
                onClick={addCategory}
                icon={Plus}
                disabled={isSubmitting}
              >
                카테고리 추가
              </Button>
            </div>

            <div className="space-y-3">
              {form.certificateCategories.length ? (
                form.certificateCategories.map((item, index) => (
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
                    className={`rounded-2xl border border-white/90 bg-white p-4 shadow-sm transition ${
                      draggingCategoryIndex === index
                        ? "ring-2 ring-indigo-200 opacity-70"
                        : "hover:border-slate-200"
                    }`}
                  >
                    <div className="grid gap-3 lg:grid-cols-[auto,minmax(0,1fr),140px,140px,auto]">
                      <div className="flex items-start pt-6">
                        <button
                          type="button"
                          draggable={!isSubmitting}
                          onDragStart={() => setDraggingCategoryIndex(index)}
                          onDragEnd={() => setDraggingCategoryIndex(null)}
                          disabled={isSubmitting}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-400 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
                          aria-label={`자격증 카테고리 ${index + 1} 순서 이동`}
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
                          className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-indigo-100"
                          placeholder="카테고리 이름"
                        />
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
                          className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-indigo-100"
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
                        <select
                          value={item.colorKey || CATEGORY_COLOR_OPTIONS[0].value}
                          onChange={(event) =>
                            updateCategoryField(index, "colorKey", event.target.value)
                          }
                          disabled={isSubmitting}
                          className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-indigo-100"
                        >
                          {CATEGORY_COLOR_OPTIONS.map((option) => (
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
                          onClick={() => removeCategory(index)}
                          disabled={isSubmitting || form.certificateCategories.length <= 1}
                          icon={Trash2}
                        >
                          삭제
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge tone="slate">순서 {index + 1}</Badge>
                      <Badge tone={item.colorKey || "blue"}>
                        {item.label || `카테고리 ${index + 1}`}
                      </Badge>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 p-6 text-center text-sm text-slate-500">
                  아직 등록된 자격증 카테고리가 없습니다.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
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
