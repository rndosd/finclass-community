import React, { useEffect, useState } from "react";
import {
  Modal,
  Button,
  InputField,
  Spinner,
  ToggleSwitch,
} from "../../../components/ui";
import ModernRichEditor from "../../../components/ui/modernricheditor/ModernRichEditor";
import PopupSettingsModal from "./PopupSettingsModal";
import {
  TrendingUp,
  Globe,
  Zap,
  Newspaper,
  Trophy,
  Flame,
  Star,
  AlertCircle,
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

const DAY_MS = 24 * 60 * 60 * 1000;

const ICON_MAP = {
  Trophy,
  TrendingUp,
  Globe,
  Zap,
  Newspaper,
  Flame,
  Star,
  AlertCircle,
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

const PRIORITY_STYLES = {
  normal: {
    selected: "border-gray-500 bg-gray-50 ring-gray-200 text-gray-700",
    label: "일반",
    description: "일반 공지",
  },
  medium: {
    selected: "border-orange-500 bg-orange-50 ring-orange-200 text-orange-700",
    label: "중요",
    description: "주의가 필요한 소식",
  },
  high: {
    selected: "border-red-500 bg-red-50 ring-red-200 text-red-700",
    label: "긴급",
    description: "즉시 확인 필요",
  },
};

const toDatetimeLocalInput = (value) => {
  if (!value) return "";
  const date = value?.toDate
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const sanitizeUidList = (value) => {
  if (!Array.isArray(value)) return [];
  const unique = new Set(
    value
      .map((uid) => String(uid || "").trim())
      .filter((uid) => uid.length > 0),
  );
  return Array.from(unique);
};

const toDateSafe = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getPopupWindowMaxDismissDays = (startAt, endAt) => {
  const start = toDateSafe(startAt);
  const end = toDateSafe(endAt);
  if (!start || !end) return null;
  const diff = end.getTime() - start.getTime();
  if (diff < 0) return null;
  return Math.max(1, Math.ceil(diff / DAY_MS));
};

const createDefaultFormData = (categories) => {
  const firstActive = categories.find(
    (c) => c.isActive !== false && c.id !== "popular" && c.id !== "legacy",
  );
  return {
    title: "",
    content: "",
    categoryId: firstActive?.id || "",
    priority: "normal",
    showOnDashboard: false,
    eventEnabled: false,
    eventStartAt: "",
    eventEndAt: "",
    popupEnabled: false,
    popupMode: "dismissible",
    popupTarget: "all", // all | selected_students
    popupTargetUids: [],
    popupStartAt: "",
    popupEndAt: "",
    popupDismissUntilType: "today",
    popupDismissDays: 3,
    popupAckPhrase: "",
  };
};

const NewsModal = ({
  isOpen,
  onClose,
  onSubmit,
  mode = "add",
  newsToEdit = null,
  categories = [],
}) => {
  const [formData, setFormData] = useState(createDefaultFormData([]));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [contentError, setContentError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [eventError, setEventError] = useState("");
  const [popupError, setPopupError] = useState("");
  const [popupModalOpen, setPopupModalOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (mode === "edit" && newsToEdit) {
      setFormData({
        title: newsToEdit.title || "",
        content: newsToEdit.content || "",
        categoryId: newsToEdit.categoryId || "",
        priority: newsToEdit.priority || "normal",
        showOnDashboard: !!newsToEdit.showOnDashboard,
        eventEnabled: !!newsToEdit.eventEnabled,
        eventStartAt: toDatetimeLocalInput(newsToEdit.eventStartAt),
        eventEndAt: toDatetimeLocalInput(newsToEdit.eventEndAt),
        popupEnabled: !!newsToEdit.popupEnabled,
        popupMode:
          newsToEdit.popupMode === "mandatory_phrase"
            ? "mandatory_phrase"
            : "dismissible",
        popupTarget:
          newsToEdit.popupTarget === "selected_students"
            ? "selected_students"
            : "all",
        popupTargetUids: sanitizeUidList(newsToEdit.popupTargetUids),
        popupStartAt: toDatetimeLocalInput(newsToEdit.popupStartAt),
        popupEndAt: toDatetimeLocalInput(newsToEdit.popupEndAt),
        popupDismissUntilType:
          newsToEdit.popupDismissUntilType === "days" ||
          newsToEdit.popupDismissUntilType === "until_end"
            ? newsToEdit.popupDismissUntilType
            : "today",
        popupDismissDays: Number(newsToEdit.popupDismissDays || 3),
        popupAckPhrase: newsToEdit.popupAckPhrase || "",
      });
    } else {
      setFormData(createDefaultFormData(categories));
    }

    setContentError("");
    setCategoryError("");
    setEventError("");
    setPopupError("");
    setIsEditorUploading(false);
    setPopupModalOpen(false);
  }, [isOpen, mode, newsToEdit, categories]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === "content" && String(value || "").trim()) setContentError("");
    if (field === "categoryId" && value) setCategoryError("");
    if (field === "eventStartAt" || field === "eventEndAt") {
      setEventError("");
    }
  };

  const validatePopupSettings = () => {
    if (!formData.popupEnabled) return "";

    if (
      formData.popupMode === "dismissible" &&
      (!formData.popupStartAt || !formData.popupEndAt)
    ) {
      return "팝업 시작/종료 시간을 입력해 주세요.";
    }
    if (
      formData.popupMode === "dismissible" &&
      new Date(formData.popupStartAt) > new Date(formData.popupEndAt)
    ) {
      return "팝업 시작 시간은 종료 시간보다 늦을 수 없습니다.";
    }
    if (
      formData.popupTarget === "selected_students" &&
      sanitizeUidList(formData.popupTargetUids).length === 0
    ) {
      return "선택 학생 대상을 사용하려면 최소 1명 이상 선택해 주세요.";
    }
    if (
      formData.popupMode === "mandatory_phrase" &&
      !String(formData.popupAckPhrase || "").trim()
    ) {
      return "확인 문구를 입력해 주세요.";
    }
    if (
      formData.popupMode === "dismissible" &&
      formData.popupDismissUntilType === "days" &&
      Number(formData.popupDismissDays || 0) <= 0
    ) {
      return "다시 보지 않기 일수는 1일 이상이어야 합니다.";
    }
    if (
      formData.popupMode === "dismissible" &&
      formData.popupDismissUntilType === "days"
    ) {
      const maxDismissDays = getPopupWindowMaxDismissDays(
        formData.popupStartAt,
        formData.popupEndAt,
      );
      if (
        maxDismissDays &&
        Number(formData.popupDismissDays || 1) > maxDismissDays
      ) {
        return `N일은 팝업 기간 기준 최대 ${maxDismissDays}일까지 설정할 수 있습니다.`;
      }
    }
    return "";
  };

  const handlePopupSettingsSave = (settings) => {
    const maxDismissDays = getPopupWindowMaxDismissDays(
      settings.popupStartAt,
      settings.popupEndAt,
    );
    const rawDismissDays = Number(
      settings.popupDismissDays || formData.popupDismissDays || 1,
    );
    const cappedDismissDays = maxDismissDays
      ? Math.min(rawDismissDays, maxDismissDays)
      : rawDismissDays;

    setFormData((prev) => ({
      ...prev,
      ...settings,
      popupTarget:
        settings.popupTarget === "selected_students"
          ? "selected_students"
          : "all",
      popupTargetUids: sanitizeUidList(settings.popupTargetUids),
      popupDismissDays: Math.max(1, cappedDismissDays),
    }));
    setPopupError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isEditorUploading) {
      setContentError("이미지 업로드가 진행 중입니다. 완료 후 다시 시도해주세요.");
      return;
    }

    if (!formData.categoryId) {
      setCategoryError("주제를 선택해 주세요.");
      return;
    }

    const htmlContent = String(formData.content || "");
    const plainText = htmlContent
      .replace(/<[^>]*>?/gm, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    const hasImage = /<img\b[^>]*>/i.test(htmlContent);
    const hasSurvey = /data-survey-id=/i.test(htmlContent);
    if (!plainText && !hasImage && !hasSurvey) {
      setContentError("내용을 입력해 주세요.");
      return;
    }

    if (formData.eventEnabled && !formData.eventStartAt) {
      setEventError("학사일정 시작 일시를 입력해 주세요.");
      return;
    }
    if (
      formData.eventEnabled &&
      formData.eventStartAt &&
      formData.eventEndAt &&
      new Date(formData.eventStartAt) > new Date(formData.eventEndAt)
    ) {
      setEventError("종료 일시는 시작 일시보다 빠를 수 없습니다.");
      return;
    }

    const popupValidationError = validatePopupSettings();
    if (popupValidationError) {
      setPopupError(popupValidationError);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        title: String(formData.title || "").trim(),
        content: String(formData.content || "").trim(),
        categoryId: formData.categoryId,
        priority: formData.priority,
        showOnDashboard: !!formData.showOnDashboard,
        eventEnabled: !!formData.eventEnabled,
        eventStartAt:
          formData.eventEnabled && formData.eventStartAt
            ? new Date(formData.eventStartAt)
            : null,
        eventEndAt:
          formData.eventEnabled && formData.eventEndAt
            ? new Date(formData.eventEndAt)
            : null,
        popupEnabled: !!formData.popupEnabled,
        popupMode: formData.popupEnabled ? formData.popupMode : null,
        popupTarget: formData.popupEnabled ? formData.popupTarget : null,
        popupTargetUids:
          formData.popupEnabled && formData.popupTarget === "selected_students"
            ? sanitizeUidList(formData.popupTargetUids)
            : [],
        popupStartAt:
          formData.popupEnabled &&
          formData.popupMode === "dismissible" &&
          formData.popupStartAt
            ? new Date(formData.popupStartAt)
            : null,
        popupEndAt:
          formData.popupEnabled &&
          formData.popupMode === "dismissible" &&
          formData.popupEndAt
            ? new Date(formData.popupEndAt)
            : null,
        popupDismissUntilType:
          formData.popupEnabled && formData.popupMode === "dismissible"
            ? formData.popupDismissUntilType
            : null,
        popupDismissDays:
          formData.popupEnabled &&
          formData.popupMode === "dismissible" &&
          formData.popupDismissUntilType === "days"
            ? Number(formData.popupDismissDays || 1)
            : null,
        popupAckPhrase:
          formData.popupEnabled && formData.popupMode === "mandatory_phrase"
            ? String(formData.popupAckPhrase || "").trim()
            : "",
      });
    } catch (error) {
      console.error("[NewsModal] submit failed:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeCategories = categories.filter(
    (cat) => cat.isActive !== false && cat.id !== "popular" && cat.id !== "legacy",
  );

  const selectedTargetCount = sanitizeUidList(formData.popupTargetUids).length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-100">
            <Newspaper className="w-4 h-4 text-white" />
          </div>
          <span className="font-black text-slate-800 tracking-tight">
            {mode === "add" ? "뉴스 작성" : "뉴스 수정"}
          </span>
        </div>
      }
      size="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6 pb-2">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-3 ml-1">
            주제 <span className="text-rose-500">*</span>
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto p-1 custom-scrollbar">
            {activeCategories.map((category) => {
              const IconComponent = ICON_MAP[category.icon] || Newspaper;
              const isSelected = formData.categoryId === category.id;

              return (
                <Button
                  key={category.id}
                  type="button"
                  onClick={() => handleInputChange("categoryId", category.id)}
                  className={`p-3 rounded-2xl border-2 text-left transition-all relative overflow-hidden ${
                    isSelected
                      ? "border-blue-500 bg-blue-50/50 ring-2 ring-blue-100"
                      : "border-slate-100 bg-slate-50/50 hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1 relative z-10">
                    <IconComponent
                      className={`w-4 h-4 ${
                        isSelected ? "text-blue-600" : "text-slate-400"
                      }`}
                    />
                    <span
                      className={`font-bold text-xs ${
                        isSelected ? "text-blue-900" : "text-slate-600"
                      }`}
                    >
                      {category.label}
                    </span>
                  </div>
                </Button>
              );
            })}
          </div>
          {categoryError && (
            <p className="mt-2 text-xs text-rose-500 font-bold ml-1">{categoryError}</p>
          )}
        </div>

        <InputField
          label="제목"
          value={formData.title}
          onChange={(e) => handleInputChange("title", e.target.value)}
          placeholder="제목을 입력하세요"
          required
        />

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-3 ml-1">
            우선순위
          </label>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(PRIORITY_STYLES).map(([key, style]) => (
              <Button
                key={key}
                type="button"
                onClick={() => handleInputChange("priority", key)}
                className={`p-3 rounded-2xl border-2 transition-all text-center ${
                  formData.priority === key
                    ? style.selected
                    : "border-slate-100 bg-slate-50/50"
                }`}
              >
                <div className="font-bold text-xs">{style.label}</div>
                <p className="text-[10px] opacity-70 mt-1 leading-tight">
                  {style.description}
                </p>
              </Button>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-indigo-100 bg-indigo-50/50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-600" />
                <h4 className="text-sm font-black text-slate-800">
                  학사일정으로 등록
                </h4>
              </div>
              <p className="mt-1 text-[11px] font-medium leading-5 text-slate-500">
                뉴스와 연결된 일정을 우측 다가오는 학사 일정에 표시합니다.
              </p>
            </div>
            <ToggleSwitch
              checked={formData.eventEnabled}
              onChange={(checked) =>
                handleInputChange("eventEnabled", checked)
              }
              tone="indigo"
              srLabel="학사일정 등록"
            />
          </div>

          {formData.eventEnabled ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-600">
                  시작 일시
                </span>
                <input
                  type="datetime-local"
                  value={formData.eventStartAt}
                  onChange={(event) =>
                    handleInputChange("eventStartAt", event.target.value)
                  }
                  required
                  className="h-11 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-600">
                  종료 일시
                  <span className="ml-1 font-medium text-slate-400">(선택)</span>
                </span>
                <input
                  type="datetime-local"
                  value={formData.eventEndAt}
                  min={formData.eventStartAt || undefined}
                  onChange={(event) =>
                    handleInputChange("eventEndAt", event.target.value)
                  }
                  className="h-11 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20"
                />
              </label>
            </div>
          ) : null}
          {eventError ? (
            <p className="mt-3 text-xs font-bold text-rose-600">
              {eventError}
            </p>
          ) : null}
        </div>

        <ModernRichEditor
          label="내용"
          value={formData.content}
          onChange={(html) => handleInputChange("content", html)}
          onUploadStateChange={setIsEditorUploading}
          placeholder="내용을 입력하세요..."
          height="350px"
          enableImageUpload={true}
          enableSurvey={true}
          error={contentError}
        />

        {isEditorUploading && (
          <p className="text-xs text-slate-500 ml-1">
            이미지 업로드가 진행 중입니다. 완료 후 발행 버튼이 활성화됩니다.
          </p>
        )}

        <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-[1.5rem] p-5 border border-blue-100/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white rounded-xl shadow-sm">📌</div>
              <div>
                <label className="text-sm font-bold text-slate-800">
                  대시보드 노출
                </label>
                <p className="text-[11px] text-slate-500 font-medium">
                  메인 대시보드 카드에 이 뉴스를 노출합니다.
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.showOnDashboard}
                onChange={(e) =>
                  handleInputChange("showOnDashboard", e.target.checked)
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
            </label>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-slate-800">긴급 팝업 설정</h4>
              <p className="text-[11px] text-slate-500">
                이 뉴스의 팝업 방식과 노출 기간을 설정합니다.
              </p>
            </div>
            <Button
              type="button"
              tone="blue"
              kind="outline"
              onClick={() => setPopupModalOpen(true)}
            >
              팝업 설정 열기
            </Button>
          </div>

          <div className="text-xs text-slate-600 space-y-1">
            <p>
              상태:{" "}
              <span
                className={
                  formData.popupEnabled
                    ? "text-emerald-600 font-bold"
                    : "text-slate-500 font-semibold"
                }
              >
                {formData.popupEnabled ? "사용" : "미사용"}
              </span>
            </p>
            {formData.popupEnabled && (
              <>
                <p>
                  모드:{" "}
                  <span className="font-semibold text-slate-700">
                    {formData.popupMode === "mandatory_phrase"
                      ? "문구 입력 필수"
                      : "닫기 가능"}
                  </span>
                </p>
                <p>
                  대상:{" "}
                  <span className="font-semibold text-slate-700">
                    {formData.popupTarget === "selected_students"
                      ? `선택 학생 ${selectedTargetCount}명`
                      : "전체"}
                  </span>
                </p>
                <p>
                  노출 기간:{" "}
                  <span className="font-semibold text-slate-700">
                    {formData.popupMode === "dismissible"
                      ? `${formData.popupStartAt || "-"} ~ ${formData.popupEndAt || "-"}`
                      : "기간 설정 없음"}
                  </span>
                </p>
              </>
            )}
          </div>

          {popupError && (
            <p className="text-xs text-rose-600 font-semibold">{popupError}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
          <Button size="md"
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting || isEditorUploading}
            
          >
            취소
          </Button>
          <Button tone="blue" kind="solid" size="md"
            type="submit"
            disabled={isSubmitting || isEditorUploading}
            
          >
            {isSubmitting || isEditorUploading ? (
              <Spinner size="xs" />
            ) : mode === "add" ? (
              "뉴스 발행"
            ) : (
              "수정 저장"
            )}
          </Button>
        </div>
      </form>

      <PopupSettingsModal
        isOpen={popupModalOpen}
        onClose={() => setPopupModalOpen(false)}
        initialSettings={{
          popupEnabled: formData.popupEnabled,
          popupMode: formData.popupMode,
          popupTarget: formData.popupTarget,
          popupTargetUids: formData.popupTargetUids,
          popupStartAt: formData.popupStartAt,
          popupEndAt: formData.popupEndAt,
          popupDismissUntilType: formData.popupDismissUntilType,
          popupDismissDays: formData.popupDismissDays,
          popupAckPhrase: formData.popupAckPhrase,
        }}
        onSave={handlePopupSettingsSave}
      />
    </Modal>
  );
};

export default NewsModal;
