// src/pages/news/modals/AddEditCategoryModal.jsx
import React, { useState, useEffect } from "react";
import {
  Modal,
  Button,
  InputField,
  ToggleSwitch,
} from "../../../components/ui";
import {
  doc,
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import {
  Plus,
  Newspaper,
  Edit3, // header/primary
  TrendingUp,
  Globe,
  Zap,
  Trophy,
  Flame,
  Star,
  AlertCircle,
  CheckCircle,
  Calendar,
  Users,
  Bell,
  Settings,
  Megaphone,
  BarChart3,
  Briefcase,
  Shield,
  Building,
  FileText,
  MessageSquare,
  Clock,
  Target,
  Lightbulb,
  Heart,
  Eye,
  BookOpen,
  Award,
} from "lucide-react";

const ICON_MAP = {
  // 기본 뉴스 아이콘들
  Newspaper,
  Trophy,
  TrendingUp,
  Globe,
  Zap,
  Flame,
  Star,
  AlertCircle,
  CheckCircle,
  Calendar,
  Users,
  Bell,
  Settings,
  Megaphone,
  BarChart3,
  Briefcase,
  Shield,
  Building,
  FileText,
  MessageSquare,
  Clock,
  Target,
  Lightbulb,
  Heart,
  Eye,
  BookOpen,
  Award,
};

const ICON_OPTIONS = [
  "Newspaper",
  "Trophy",
  "TrendingUp",
  "Globe",
  "Zap",
  "Flame",
  "Star",
  "AlertCircle",
  "CheckCircle",
  "Calendar",
  "Users",
  "Bell",
  "Settings",
  "Megaphone",
  "BarChart3",
  "Briefcase",
  "Shield",
  "Building",
  "FileText",
  "MessageSquare",
  "Clock",
  "Target",
  "Lightbulb",
  "Heart",
  "Eye",
  "BookOpen",
  "Award",
];

const COLOR_OPTIONS = [
  {
    key: "orange",
    label: "오렌지",
    ring: "ring-orange-200",
    bg: "bg-orange-50",
    text: "text-orange-500",  // 600 → 500
  },
  {
    key: "green",
    label: "그린",
    ring: "ring-green-200",
    bg: "bg-green-50",
    text: "text-green-500",
  },
  {
    key: "blue",
    label: "블루",
    ring: "ring-blue-200",
    bg: "bg-blue-50",
    text: "text-blue-500",
  },
  {
    key: "yellow",
    label: "옐로우",
    ring: "ring-yellow-200",
    bg: "bg-yellow-50",
    text: "text-yellow-500",
  },
  {
    key: "purple",
    label: "퍼플",
    ring: "ring-purple-200",
    bg: "bg-purple-50",
    text: "text-purple-500",
  },
  {
    key: "red",
    label: "레드",
    ring: "ring-red-200",
    bg: "bg-red-50",
    text: "text-red-500",
  },
  {
    key: "indigo",
    label: "인디고",
    ring: "ring-indigo-200",
    bg: "bg-indigo-50",
    text: "text-indigo-500",
  },
  {
    key: "slate",
    label: "슬레이트",
    ring: "ring-slate-200",
    bg: "bg-slate-50",
    text: "text-slate-500",
  },
  {
    key: "cyan",
    label: "시안",
    ring: "ring-cyan-200",
    bg: "bg-cyan-50",
    text: "text-cyan-500",
  },
  {
    key: "emerald",
    label: "에메랄드",
    ring: "ring-emerald-200",
    bg: "bg-emerald-50",
    text: "text-emerald-500",
  },
  {
    key: "rose",
    label: "로즈",
    ring: "ring-rose-200",
    bg: "bg-rose-50",
    text: "text-rose-500",
  },
  {
    key: "violet",
    label: "바이올렛",
    ring: "ring-violet-200",
    bg: "bg-violet-50",
    text: "text-violet-500",
  },
];

const colorToClasses = (key) =>
  COLOR_OPTIONS.find((c) => c.key === key) || COLOR_OPTIONS[2]; // 기본: 블루

// 이모지 제거용(레거시 호환)
const stripLeadingEmoji = (raw = "") => {
  const m = raw.match(
    /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})\s*/u
  );
  return m ? raw.slice(m[0].length).trim() : raw;
};

const AddEditCategoryModal = ({
  isOpen,
  onClose,
  categoryToEdit = null,
  onCreated,
  onError,
  existingCategories = [],
}) => {
  const { classId, userData } = useUser();

  const [label, setLabel] = useState("");
  const [iconName, setIconName] = useState("Newspaper");
  const [color, setColor] = useState("blue");
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditMode = !!categoryToEdit;
  const isDefaultCategory = categoryToEdit?.isDefault;

  // 초기값 로드(수정/신규)
  useEffect(() => {
    if (isEditMode && categoryToEdit) {
      setLabel(stripLeadingEmoji(categoryToEdit.label || ""));
      setIconName(
        categoryToEdit.icon && ICON_MAP[categoryToEdit.icon]
          ? categoryToEdit.icon
          : "Newspaper"
      );
      setColor(
        COLOR_OPTIONS.some((c) => c.key === categoryToEdit.color)
          ? categoryToEdit.color
          : "blue"
      );
      setIsActive(categoryToEdit.isActive !== false);
    } else {
      setLabel("");
      setIconName("Newspaper");
      setColor("blue");
      setIsActive(true);
    }
  }, [isEditMode, categoryToEdit]);

  const handleClose = () => {
    if (isSubmitting) return;
    setLabel("");
    setIconName("Newspaper");
    setColor("blue");
    setIsActive(true);
    onClose();
  };

  const validateForm = () => {
    if (!label.trim()) {
      return { isValid: false, message: "주제 이름을 입력해주세요." };
    }

    // 중복 검사 (수정 시에는 자기 자신 제외)
    const duplicateCategory = existingCategories.find(
      (cat) =>
        cat.label?.toLowerCase() === label.trim().toLowerCase() &&
        (!isEditMode || cat.id !== categoryToEdit.id)
    );

    if (duplicateCategory) {
      return { isValid: false, message: "이미 쓰는 주제 이름이에요." };
    }

    return { isValid: true };
  };

  const handleSubmit = async () => {
    if (!classId) {
      onError?.("학급 정보가 없습니다. 다시 시도해주세요.");
      return;
    }

    const validation = validateForm();
    if (!validation.isValid) {
      onError?.(validation.message);
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditMode) {
        const ref = doc(
          db,
          "classes",
          classId,
          "newsCategories",
          categoryToEdit.id
        );
        await updateDoc(ref, {
          label: label.trim(),
          icon: iconName,
          color,
          isActive,
          updatedAt: serverTimestamp(),
        });
        onCreated?.("주제가 수정되었습니다!");
      } else {
        // 새 카테고리 추가 시 order 계산
        const maxOrder = existingCategories.reduce(
          (max, cat) => Math.max(max, cat.order ?? 0),
          0
        );

        const col = collection(db, "classes", classId, "newsCategories");
        const docRef = await addDoc(col, {
          label: label.trim(),
          icon: iconName,
          color,
          isActive,
          isDefault: false, // 사용자 정의 카테고리
          teacherUid: userData?.uid || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          order: maxOrder + 1,
        });
        onCreated?.("주제가 추가되었습니다!", docRef.id);
      }
      handleClose();
    } catch (err) {
      console.error("[AddEditCategoryModal] save error:", err);
      onError?.(
        isEditMode
          ? "주제 수정 중 오류가 발생했습니다."
          : "주제 저장 중 오류가 발생했습니다."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const HeaderIcon = isEditMode ? Edit3 : Plus;
  const IconPreview = ICON_MAP[iconName];

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="md"
      title={
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-xl ${isEditMode
                ? "bg-gradient-to-br from-blue-500 to-cyan-600"
                : "bg-gradient-to-br from-indigo-500 to-purple-600"
              }`}
          >
            <HeaderIcon className="h-5 w-5 text-white" />
          </div>
          <div>
            <span className="text-xl font-bold">
              {isEditMode ? "뉴스 주제 수정" : "새 뉴스 주제 추가"}
            </span>
            {isDefaultCategory && (
              <p className="text-sm text-amber-600 mt-0.5">
                기본 주제는 이름과 아이콘을 수정할 수 없습니다
              </p>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-6 p-1">
        {isEditMode && (
          <div
            className={`${isDefaultCategory
                ? "bg-amber-50 ring-amber-200"
                : "bg-blue-50 ring-blue-200"
              } ring-1 rounded-xl p-4`}
          >
            <h4
              className={`text-sm font-semibold mb-2 ${isDefaultCategory ? "text-amber-700" : "text-blue-700"
                }`}
            >
              현재 주제{" "}
              {isDefaultCategory ? "(기본 주제)" : "(사용자 정의)"}
            </h4>
            <div
              className={`flex items-center gap-2 ${isDefaultCategory ? "text-amber-800" : "text-blue-800"
                }`}
            >
              {categoryToEdit.icon && ICON_MAP[categoryToEdit.icon] ? (
                React.createElement(ICON_MAP[categoryToEdit.icon], {
                  className: "h-4 w-4",
                })
              ) : (
                <Newspaper className="h-4 w-4" />
              )}
              <span className="font-medium">{categoryToEdit.label}</span>
            </div>
          </div>
        )}

        {/* 아이콘 선택 */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            주제 아이콘
            {isDefaultCategory && (
              <span className="text-amber-600 ml-1">(수정 불가)</span>
            )}
          </label>
          <div className="grid grid-cols-8 gap-2 p-3 bg-slate-50 rounded-xl max-h-40 overflow-y-auto">
            {ICON_OPTIONS.map((key) => {
              const Ico = ICON_MAP[key];
              const isActiveIcon = iconName === key;
              return (
                <Button
                  key={key}
                  type="button"
                  onClick={() => !isDefaultCategory && setIconName(key)}
                  className={[
                    "w-10 h-10 rounded-lg transition-all duration-200 flex items-center justify-center border",
                    isActiveIcon
                      ? "bg-white border-indigo-300 ring-2 ring-indigo-200 shadow"
                      : "bg-white border-slate-200 hover:bg-indigo-50",
                    isDefaultCategory && "cursor-not-allowed opacity-50",
                  ].join(" ")}
                  disabled={isSubmitting || isDefaultCategory}
                  title={
                    isDefaultCategory
                      ? "기본 주제는 아이콘을 변경할 수 없습니다"
                      : key
                  }
                >
                  <Ico
                    className={`h-5 w-5 ${isActiveIcon ? "text-indigo-600" : "text-slate-600"
                      }`}
                  />
                </Button>
              );
            })}
          </div>
        </div>

        {/* 아이콘 색상 */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            아이콘 색상
          </label>
          <div className="flex flex-wrap gap-2">
            {COLOR_OPTIONS.map((c) => (
              <Button
                key={c.key}
                type="button"
                onClick={() => setColor(c.key)}
                disabled={isSubmitting}
                className={[
                  "inline-flex items-center gap-2 px-3 py-2 rounded-lg ring-1 transition-all",
                  c.ring,
                  c.bg,
                  color === c.key ? "ring-2 shadow-sm" : "hover:ring-2",
                ].join(" ")}
                title={c.label}
              >
                <div
                  className={`w-4 h-4 rounded-md ${c.text.replace(
                    "text-",
                    "bg-"
                  )}`}
                />
                <span className={`text-xs font-medium ${c.text}`}>
                  {c.label}
                </span>
              </Button>
            ))}
          </div>
        </div>

        {/* 카테고리명 */}
        <div className="space-y-2">
          <InputField
            label={`주제 이름${isDefaultCategory ? " (수정 불가)" : ""}`}
            value={label}
            onChange={(e) => !isDefaultCategory && setLabel(e.target.value)}
            placeholder="예: 학사일정, 급식소식"
            disabled={isSubmitting || isDefaultCategory}
            className={`text-lg font-medium ${isDefaultCategory ? "bg-slate-50 cursor-not-allowed" : ""
              }`}
          />
        </div>

        {/* 활성화 토글 */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
          <div>
            <label className="text-sm font-semibold text-slate-700">
              주제 활성화
            </label>
            <p className="text-xs text-slate-500 mt-1">
              비활성화하면 뉴스 목록에서 보이지 않습니다
            </p>
          </div>
          <ToggleSwitch
            checked={isActive}
            srLabel="주제 활성화"
            onChange={setIsActive}
            disabled={isSubmitting}
          />
        </div>

        {/* 미리보기 */}
        {label.trim() && (
          <div
            className={`p-4 rounded-xl border ${color === "blue"
                ? "bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100"
                : "bg-gradient-to-r from-slate-50 to-white border-slate-200"
              }`}
          >
            <h4
              className={`text-sm font-semibold mb-3 ${colorToClasses(color).text
                }`}
            >
              미리보기 · {COLOR_OPTIONS.find((c) => c.key === color)?.label}
            </h4>
            <div
              className={`flex items-center gap-3 px-4 py-3 bg-white rounded-xl ring-1 shadow-sm ${colorToClasses(color).ring
                }`}
            >
              {IconPreview ? (
                <IconPreview
                  className={`h-5 w-5 ${colorToClasses(color).text}`}
                />
              ) : (
                <Newspaper
                  className={`h-5 w-5 ${colorToClasses(color).text}`}
                />
              )}
              <span className="font-medium text-slate-700">{label.trim()}</span>
              {!isActive && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  비활성
                </span>
              )}
            </div>
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
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
            disabled={!label.trim()}
            icon={isEditMode ? Edit3 : Plus}
          >
            {isSubmitting
              ? isEditMode
                ? "수정 중..."
                : "추가 중..."
              : isEditMode
                ? "변경 저장"
                : "주제 추가"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default AddEditCategoryModal;
