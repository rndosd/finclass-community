import { useEffect, useMemo, useState } from "react";

import {
  Button,
  InputField,
  Modal,
  Textarea,
  ToggleSwitch,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  CERTIFICATE_NO_STAGE_ID,
  DEFAULT_CERTIFICATE_GRADES,
  DEFAULT_TITLE_GRADES,
  DEFAULT_TITLE_REVEAL_CONFIG,
  deriveLegacyTitleRevealMode,
  normalizeTitleRevealConfig,
} from "../CredentialsPage.parts";
import { normalizeTitleStyle } from "../titleStyleOptions";
import CertificateDefinitionFields from "./CertificateDefinitionFieldsV2";
import TitleDefinitionFields from "./TitleDefinitionFields";
import TitleStyleDesignerModal from "./TitleStyleDesignerModal";

const EMPTY_TITLE_FORM = {
  name: "",
  description: "",
  acquisitionCondition: "",
  categoryId: "",
  category: "",
  gradeId: DEFAULT_TITLE_GRADES[0]?.id || "common",
  revealMode: "condition_only",
  revealConfig: { ...DEFAULT_TITLE_REVEAL_CONFIG },
  rarity: "common",
  version: 3,
  icon: "none",
  familyId: "plaque",
  paletteId: "sky",
  trimPaletteId: "match",
  ornamentSetId: "none",
  fontStyleId: "basic",
  textScale: 100,
  textOffsetY: 0,
  textColorMode: "auto",
  customTextColor: "",
  customFrameColor: "",
  customBannerColor: "",
  customTrimColor: "",
  topDecoId: "none",
  sideDecoId: "none",
  bottomDecoId: "none",
  patternId: "none",
  effectId: "none",
  sourceType: "manual",
  allowStudentRequest: true,
  isVisible: true,
  isActive: true,
};

const EMPTY_CERTIFICATE_FORM = {
  name: "",
  acquisitionCondition: "",
  description: "",
  categoryId: "",
  category: "",
  gradeId: CERTIFICATE_NO_STAGE_ID,
  level: CERTIFICATE_NO_STAGE_ID,
  templateId: "license",
  issueMethod: "manual",
  expiresEnabled: false,
  isVisible: true,
  isActive: true,
};

function normalizeSelectOptions(options = [], selectedValue, selectedLabel) {
  const merged = [
    ...options,
  ]
    .filter(Boolean)
    .map((item) => ({
      value: String(item?.value || "").trim(),
      label: String(item?.label || item?.value || "").trim(),
    }))
    .filter((item) => item.value);

  return Array.from(new Map(merged.map((item) => [item.value, item])).values());
}

function buildTitleForm(initialData) {
  if (!initialData) return { ...EMPTY_TITLE_FORM };
  const gradeId =
    initialData.gradeId ||
    initialData.rarity ||
    DEFAULT_TITLE_GRADES[0]?.id ||
    "common";
  return {
    ...EMPTY_TITLE_FORM,
    name: initialData.name || "",
    description: initialData.description || "",
    acquisitionCondition: initialData.acquisitionCondition || "",
    categoryId: initialData.categoryId || "",
    category: initialData.category || "",
    gradeId,
    revealMode: initialData.revealMode || "condition_only",
    revealConfig: normalizeTitleRevealConfig(
      initialData.revealConfig,
      initialData.revealMode || "condition_only",
    ),
    rarity: initialData.rarity || gradeId,
    version:
      Number(initialData.version) >= 3 || typeof initialData.ornamentSetId === "string" ? 3 : 2,
    icon: initialData.icon || "none",
    familyId: initialData.familyId || "plaque",
    paletteId: initialData.paletteId || "sky",
    trimPaletteId: initialData.trimPaletteId || "match",
    ornamentSetId: initialData.ornamentSetId || "none",
    fontStyleId: initialData.fontStyleId || "basic",
    textScale: initialData.textScale ?? 100,
    textOffsetY: initialData.textOffsetY ?? 0,
    textColorMode: initialData.textColorMode || "auto",
    customTextColor: initialData.customTextColor || "",
    customFrameColor: initialData.customFrameColor || "",
    customBannerColor: initialData.customBannerColor || "",
    customTrimColor: initialData.customTrimColor || "",
    topDecoId: initialData.topDecoId || "none",
    sideDecoId: initialData.sideDecoId || "none",
    bottomDecoId: initialData.bottomDecoId || "none",
    patternId: initialData.patternId || "none",
    effectId: initialData.effectId || "none",
    sourceType: initialData.sourceType || "manual",
    allowStudentRequest: initialData.allowStudentRequest !== false,
    isVisible: initialData.isVisible !== false,
    isActive: true,
  };
}

function buildCertificateForm(initialData) {
  if (!initialData) return { ...EMPTY_CERTIFICATE_FORM };
  const gradeId =
    initialData.gradeId ||
    initialData.level ||
    DEFAULT_CERTIFICATE_GRADES[0]?.id ||
    "basic";
  return {
    ...EMPTY_CERTIFICATE_FORM,
    name: initialData.name || "",
    acquisitionCondition: initialData.acquisitionCondition || initialData.condition || "",
    description: initialData.description || "",
    categoryId: initialData.categoryId || "",
    category: initialData.category || "",
    gradeId,
    level: initialData.level || gradeId,
    templateId: initialData.templateId || "license",
    issueMethod: initialData.issueMethod || "manual",
    expiresEnabled: Boolean(initialData.expiresEnabled),
    isVisible: initialData.isVisible !== false,
    isActive: initialData.isActive !== false,
  };
}

export default function DefinitionModal({
  type,
  open,
  initialData,
  onClose,
  onSubmit,
  isSubmitting,
  titleGradeOptions = [],
  certificateGradeOptions = [],
  titleCategoryOptions = [],
  certificateCategoryOptions = [],
}) {
  const isTitle = type === "title";
  const { showFeedback } = useFeedback();

  const [form, setForm] = useState(
    isTitle ? { ...EMPTY_TITLE_FORM } : { ...EMPTY_CERTIFICATE_FORM },
  );
  const [styleDesignerOpen, setStyleDesignerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setStyleDesignerOpen(false);
      return;
    }

    setForm(isTitle ? buildTitleForm(initialData) : buildCertificateForm(initialData));
  }, [initialData, isTitle, open]);

  const normalizedTitleCategoryOptions = useMemo(
    () =>
      normalizeSelectOptions(
        titleCategoryOptions,
        form.categoryId,
        form.category,
      ),
    [form.category, form.categoryId, titleCategoryOptions],
  );

  const normalizedCertificateCategoryOptions = useMemo(
    () =>
      normalizeSelectOptions(
        certificateCategoryOptions,
        form.categoryId,
        form.category,
      ),
    [certificateCategoryOptions, form.category, form.categoryId],
  );

  useEffect(() => {
    if (!open) return;

    const options = isTitle
      ? normalizedTitleCategoryOptions
      : normalizedCertificateCategoryOptions;

    if (!options.length) return;
    const hasSelectedOption = options.some(
      (item) =>
        item.value === form.categoryId ||
        item.label === form.category,
    );

    if (form.categoryId && hasSelectedOption) return;

    if (form.category) {
      const matched = options.find((item) => item.label === form.category);
      if (matched) {
        setForm((prev) => ({
          ...prev,
          categoryId: matched.value,
          category: matched.label,
        }));
        return;
      }
    }

    const firstCategory = options[0];
    if (!firstCategory) return;

    setForm((prev) => ({
      ...prev,
      categoryId: firstCategory.value,
      category: firstCategory.label,
    }));
  }, [
    form.category,
    form.categoryId,
    isTitle,
    normalizedCertificateCategoryOptions,
    normalizedTitleCategoryOptions,
    open,
  ]);

  useEffect(() => {
    if (!open) return;

    const options = isTitle ? titleGradeOptions : certificateGradeOptions;
    if (!options.length) return;

    const currentGradeId = String(form.gradeId || "").trim();
    const fallbackGradeId = String(isTitle ? form.rarity : form.level).trim();
    const matched =
      options.find((item) => String(item.value) === currentGradeId) ||
      options.find((item) => String(item.value) === fallbackGradeId) ||
      options[0];

    if (!matched || currentGradeId === String(matched.value)) return;

    setForm((prev) => ({
      ...prev,
      gradeId: String(matched.value),
      ...(isTitle ? { rarity: String(matched.value) } : { level: String(matched.value) }),
    }));
  }, [
    certificateGradeOptions,
    form.gradeId,
    form.level,
    form.rarity,
    isTitle,
    open,
    titleGradeOptions,
  ]);

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCategoryChange = (value) => {
    const options = isTitle
      ? normalizedTitleCategoryOptions
      : normalizedCertificateCategoryOptions;
    const matched = options.find((item) => item.value === value);

    setForm((prev) => ({
      ...prev,
      categoryId: value,
      category: matched?.label || "",
    }));
  };

  const handleSubmit = () => {
    const payload = {
      ...form,
      name: String(form.name || "").trim(),
      description: String(form.description || "").trim(),
      acquisitionCondition: String(form.acquisitionCondition || "").trim(),
      categoryId: String(form.categoryId || "").trim(),
      category: String(form.category || "").trim(),
      templateId: String(form.templateId || "license").trim(),
      icon: String(form.icon || "none").trim(),
      trimPaletteId: String(form.trimPaletteId || "match").trim(),
      customFrameColor: String(form.customFrameColor || "").trim(),
      customBannerColor: String(form.customBannerColor || "").trim(),
      customTrimColor: String(form.customTrimColor || "").trim(),
      topDecoId: String(form.topDecoId || "none").trim(),
      sideDecoId: String(form.sideDecoId || "none").trim(),
      bottomDecoId: String(form.bottomDecoId || "none").trim(),
      patternId: String(form.patternId || "none").trim(),
      effectId: String(form.effectId || "none").trim(),
      isActive: isTitle ? true : form.isActive !== false,
    };

    if (isTitle) {
      payload.revealConfig = normalizeTitleRevealConfig(
        form.revealConfig,
        form.revealMode || "condition_only",
      );
      payload.revealMode = deriveLegacyTitleRevealMode(payload.revealConfig);
    }

    if (!payload.name) {
      showFeedback(isTitle ? "칭호 이름을 입력해 주세요." : "자격증 이름을 입력해 주세요.", "warning");
      return;
    }

    if (!payload.category) {
      showFeedback("카테고리를 선택해 주세요.", "warning");
      return;
    }

    onSubmit(payload);
  };

  return (
    <>
      <Modal
        isOpen={open}
        onClose={isSubmitting ? undefined : onClose}
        title={isTitle ? (initialData ? "칭호 수정" : "칭호 생성") : (initialData ? "자격증 수정" : "자격증 생성")}
        size="lg"
      >
        <div className="space-y-5">
          <InputField
            label={isTitle ? "칭호 이름" : "자격증 이름"}
            value={form.name || ""}
            onChange={(event) => setField("name", event.target.value)}
            placeholder={isTitle ? "예: 절약 마스터, 꾸준한 기록자" : "예: 금융생활 관리 자격증"}
            disabled={isSubmitting}
          />

          {!isTitle ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">자격증 소개</label>
              <Textarea
                rows={3}
                value={form.description || ""}
                onChange={(event) => setField("description", event.target.value)}
                placeholder="자격증을 소개하는 내용을 입력해 주세요."
                disabled={isSubmitting}
              />
            </div>
          ) : null}

          {!isTitle ? (
            <InputField
              label="획득 조건"
              value={form.acquisitionCondition || ""}
              onChange={(event) => setField("acquisitionCondition", event.target.value)}
              placeholder="예: 금융 교육 5회 이수"
              disabled={isSubmitting}
            />
          ) : null}

          {isTitle ? (
            <TitleDefinitionFields
              form={form}
              isSubmitting={isSubmitting}
              titleCategoryOptions={normalizedTitleCategoryOptions}
              titleGradeOptions={titleGradeOptions}
              onCategoryChange={handleCategoryChange}
              setField={setField}
              onOpenStyleDesigner={() => setStyleDesignerOpen(true)}
            />
          ) : (
            <CertificateDefinitionFields
              form={form}
              isSubmitting={isSubmitting}
              certificateCategoryOptions={normalizedCertificateCategoryOptions}
              certificateGradeOptions={certificateGradeOptions}
              onCategoryChange={handleCategoryChange}
              setField={setField}
            />
          )}

          <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
            {!isTitle ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">만료일 설정</p>
                  <p className="text-xs text-slate-500">자격증에 만료일을 설정할 수 있습니다.</p>
                </div>
                <ToggleSwitch
                  checked={Boolean(form.expiresEnabled)}
                  onChange={(checked) => setField("expiresEnabled", checked)}
                  disabled={isSubmitting}
                />
              </div>
            ) : null}

            {isTitle ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">학생 요청 허용</p>
                  <p className="text-xs text-slate-500">학생이 이 칭호를 요청할 수 있도록 허용합니다.</p>
                </div>
                <ToggleSwitch
                  checked={form.allowStudentRequest !== false}
                  onChange={(checked) => setField("allowStudentRequest", checked)}
                  disabled={isSubmitting}
                />
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {isTitle ? "학생에게 칭호 공개" : "학생에게 자격증 공개"}
                </p>
                <p className="text-xs text-slate-500">학생 도감과 관련 화면에 표시합니다.</p>
              </div>
              <ToggleSwitch
                checked={form.isVisible !== false}
                onChange={(checked) => setField("isVisible", checked)}
                disabled={isSubmitting}
              />
            </div>

            {!isTitle ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">활성 상태</p>
                  <p className="text-xs text-slate-500">비활성화하면 신규 발급 대상에서 제외됩니다.</p>
                </div>
                <ToggleSwitch
                  checked={form.isActive !== false}
                  onChange={(checked) => setField("isActive", checked)}
                  disabled={isSubmitting}
                />
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
              취소
            </Button>
            <Button onClick={handleSubmit} isLoading={isSubmitting}>
              {initialData ? "저장" : "등록"}
            </Button>
          </div>
        </div>
      </Modal>

      {isTitle ? (
        <TitleStyleDesignerModal
          open={open && styleDesignerOpen}
          onClose={() => setStyleDesignerOpen(false)}
          onApply={(style) => {
            const normalized = normalizeTitleStyle(style);
            setField("version", normalized.version);
            setField("familyId", normalized.familyId);
            setField("paletteId", normalized.paletteId);
            setField("trimPaletteId", normalized.trimPaletteId);
            setField("ornamentSetId", normalized.ornamentSetId);
            setField("icon", normalized.icon);
            setField("fontStyleId", normalized.fontStyleId);
            setField("textScale", normalized.textScale);
            setField("textOffsetY", normalized.textOffsetY);
            setField("textColorMode", normalized.textColorMode);
            setField("customTextColor", normalized.customTextColor);
            setField("customFrameColor", normalized.customFrameColor);
            setField("customBannerColor", normalized.customBannerColor);
            setField("customTrimColor", normalized.customTrimColor);
            setField("topDecoId", normalized.topDecoId);
            setField("sideDecoId", normalized.sideDecoId);
            setField("bottomDecoId", normalized.bottomDecoId);
            setField("patternId", normalized.patternId);
            setField("effectId", normalized.effectId);
          }}
          initialStyle={{
            version: form.version,
            familyId: form.familyId || "plaque",
            paletteId: form.paletteId || "sky",
            trimPaletteId: form.trimPaletteId || "match",
            ornamentSetId: form.ornamentSetId || "none",
            fontStyleId: form.fontStyleId || "basic",
            textScale: form.textScale ?? 100,
            textOffsetY: form.textOffsetY ?? 0,
            textColorMode: form.textColorMode || "auto",
            customTextColor: form.customTextColor || "",
            icon: form.icon || "none",
            customFrameColor: form.customFrameColor || "",
            customBannerColor: form.customBannerColor || "",
            customTrimColor: form.customTrimColor || "",
            topDecoId: form.topDecoId || "none",
            sideDecoId: form.sideDecoId || "none",
            bottomDecoId: form.bottomDecoId || "none",
            patternId: form.patternId || "none",
            effectId: form.effectId || "none",
          }}
          titleLabel={form.name || "칭호 이름"}
        />
      ) : null}
    </>
  );
}
