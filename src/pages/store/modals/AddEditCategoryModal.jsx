import React, { useEffect, useState } from "react";
import {
  Backpack,
  BookOpen,
  Brush,
  Camera,
  Coffee,
  CupSoda,
  Edit3,
  Film,
  FlaskConical,
  Gamepad2,
  Gift,
  GraduationCap,
  Hammer,
  Headphones,
  Heart,
  Laptop,
  Leaf,
  Music2,
  Package,
  Palette,
  Pizza,
  Plus,
  Scissors,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Tag,
  Ticket,
  Trophy,
  Wrench,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { Button, InputField, Modal, ToggleSwitch } from "../../../components/ui";
import {
  CATEGORY_COLOR_CLASS_MAP,
  CATEGORY_COLOR_OPTIONS,
  getCategoryColorClasses,
} from "../../../components/ui/toneStyles";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";

const ICON_MAP = {
  Tag,
  ShoppingCart,
  Package,
  Gift,
  Sparkles,
  Gamepad2,
  Coffee,
  CupSoda,
  Pizza,
  BookOpen,
  Palette,
  Music2,
  GraduationCap,
  Trophy,
  Ticket,
  Star,
  Smartphone,
  Laptop,
  FlaskConical,
  Hammer,
  Wrench,
  Scissors,
  Heart,
  Leaf,
  Camera,
  Film,
  Headphones,
  Backpack,
  Brush,
};

const ICON_OPTIONS = Object.keys(ICON_MAP);

const COLOR_OPTIONS = CATEGORY_COLOR_OPTIONS;
const colorToClasses = (key) =>
  getCategoryColorClasses(key);

const stripLeadingEmoji = (raw = "") => {
  const match = raw.match(
    /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})\s*/u,
  );
  return match ? raw.slice(match[0].length).trim() : raw;
};

const AddEditCategoryModal = ({
  isOpen,
  onClose,
  categoryToEdit = null,
  onCreated,
}) => {
  const { classId, userData } = useUser();
  const { showFeedback } = useFeedback();

  const [name, setName] = useState("");
  const [iconName, setIconName] = useState("Tag");
  const [iconColor, setIconColor] = useState("indigo");
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditMode = Boolean(categoryToEdit);

  useEffect(() => {
    if (!isOpen) return;

    if (isEditMode && categoryToEdit) {
      setName(stripLeadingEmoji(categoryToEdit.name || ""));
      setIsActive(categoryToEdit.isActive ?? true);
      setIconName(
        categoryToEdit.icon && ICON_MAP[categoryToEdit.icon]
          ? categoryToEdit.icon
          : "Tag",
      );
      setIconColor(
        CATEGORY_COLOR_CLASS_MAP[categoryToEdit.iconColor]
          ? categoryToEdit.iconColor
          : "indigo",
      );
      return;
    }

    setName("");
    setIsActive(true);
    setIconName("Tag");
    setIconColor("indigo");
  }, [categoryToEdit, isEditMode, isOpen]);

  const handleClose = () => {
    if (isSubmitting) return;
    onClose?.();
  };

  const handleSubmit = async () => {
    if (!classId) {
      showFeedback("학급 정보를 찾을 수 없습니다.", "error");
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      showFeedback("카테고리명을 입력해 주세요.", "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        name: trimmedName,
        icon: iconName,
        iconColor,
        isActive,
        updatedAt: serverTimestamp(),
      };

      if (isEditMode) {
        await updateDoc(
          doc(db, "classes", classId, "storeCategories", categoryToEdit.id),
          payload,
        );
        showFeedback("카테고리가 수정되었습니다.", "success");
      } else {
        const createdRef = await addDoc(
          collection(db, "classes", classId, "storeCategories"),
          {
            ...payload,
            teacherUid: userData?.uid || null,
            createdAt: serverTimestamp(),
            order: Math.floor(Date.now() / 1000),
          },
        );
        showFeedback("카테고리가 추가되었습니다.", "success");
        onCreated?.(createdRef.id);
      }

      handleClose();
    } catch (error) {
      console.error("[AddEditCategoryModal] save error:", error);
      showFeedback(
        isEditMode
          ? "카테고리 수정 중 오류가 발생했습니다."
          : "카테고리 저장 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const HeaderIcon = isEditMode ? Edit3 : Tag;
  const IconPreview = ICON_MAP[iconName] || Tag;
  const colorClasses = colorToClasses(iconColor);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="md"
      title={
        <div className="flex items-center gap-3">
          <div
            className={`rounded-xl p-2 ${
              isEditMode
                ? "bg-blue-600"
                : "bg-gradient-to-br from-indigo-500 to-purple-600"
            }`}
          >
            <HeaderIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold">
            {isEditMode ? "카테고리 수정" : "새 카테고리 추가"}
          </span>
        </div>
      }
    >
      <div className="space-y-6 p-1">
        {isEditMode ? (
          <div className="rounded-xl bg-blue-50 p-4 ring-1 ring-blue-200">
            <h4 className="mb-2 text-sm font-semibold text-blue-700">
              현재 카테고리
            </h4>
            <div className="flex items-center gap-2 text-blue-800">
              <IconPreview className="h-4 w-4" />
              <span className="font-medium">
                {stripLeadingEmoji(categoryToEdit?.name || "")}
              </span>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            카테고리 아이콘
          </label>
          <div className="grid max-h-40 grid-cols-8 gap-2 overflow-y-auto rounded-xl bg-slate-50 p-3">
            {ICON_OPTIONS.map((key) => {
              const Icon = ICON_MAP[key];
              const isSelected = iconName === key;

              return (
                <Button
                  key={key}
                  type="button"
                  onClick={() => setIconName(key)}
                  size="icon-md"
                  tone="blue"
                  kind={isSelected ? "outline" : "ghost"}
                  rounded="lg"
                  className={`h-10 w-10 ${
                    isSelected
                      ? "border-indigo-300 bg-white shadow ring-2 ring-indigo-200"
                      : "border-slate-200 bg-white hover:bg-indigo-50"
                  }`}
                  disabled={isSubmitting}
                  title={key}
                  aria-pressed={isSelected}
                >
                  <Icon
                    className={`h-5 w-5 ${
                      isSelected ? "text-indigo-600" : "text-slate-600"
                    }`}
                  />
                </Button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            아이콘 색상
          </label>
          <div className="flex flex-wrap gap-2">
            {COLOR_OPTIONS.map((color) => (
              <Button
                key={color.key}
                type="button"
                onClick={() => setIconColor(color.key)}
                disabled={isSubmitting}
                size="xs"
                tone={color.key}
                kind="soft"
                rounded="lg"
                className={`gap-2 px-3 py-2 ring-1 ${
                  color.ring
                } ${color.bg} ${iconColor === color.key ? "ring-2 shadow-sm" : "hover:ring-2"}`}
                title={color.label}
                aria-pressed={iconColor === color.key}
              >
                <div className={`h-4 w-4 rounded-md ${color.chip}`} />
                <span className={`text-xs font-medium ${color.text}`}>
                  {color.label}
                </span>
              </Button>
            ))}
          </div>
        </div>

        <InputField
          label="카테고리명"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="예: 간식, 문구, 이벤트"
          disabled={isSubmitting}
          className="text-lg font-medium"
        />

        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
          <div>
            <label className="text-sm font-semibold text-slate-700">
              카테고리 활성화
            </label>
            <p className="mt-1 text-xs text-slate-500">
              꺼두면 학생 화면에서 비활성 상태로 표시됩니다.
            </p>
          </div>
          <ToggleSwitch
            checked={isActive}
            onChange={setIsActive}
            disabled={isSubmitting}
          />
        </div>

        {name.trim() ? (
          <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-4">
            <h4 className={`mb-3 text-sm font-semibold ${colorClasses.text}`}>
              미리보기
            </h4>
            <div className={`flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ${colorClasses.ring}`}>
              <IconPreview className={`h-5 w-5 ${colorClasses.text}`} />
              <span className="font-medium text-slate-700">{name.trim()}</span>
              {!isActive ? (
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  비활성
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
          <Button size="md"
            onClick={handleClose}
            variant="outline"
            disabled={isSubmitting}
            
          >
            취소
          </Button>
          <Button tone="blue" kind="solid" size="md"
            onClick={handleSubmit}
            
            isLoading={isSubmitting}
            disabled={!name.trim()}
            icon={isEditMode ? Edit3 : Plus}
          >
            {isEditMode ? "카테고리 수정" : "카테고리 추가"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default AddEditCategoryModal;
