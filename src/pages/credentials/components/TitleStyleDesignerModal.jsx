import { useEffect, useMemo, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { Alert, Button, InputField, Modal, SelectField , Tabs} from "../../../components/ui";
import {
  getTitleOrnamentSet,
  getTitleOrnamentSetOptions,
  isTitleOrnamentCompatible,
  normalizeTitleOrnamentSetId,
} from "../../../assets/titles/v3/titleAppearanceRegistry";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import TitleNameplatePreview from "./TitleNameplatePreview";
import {
  DEFAULT_TITLE_STYLE,
  TITLE_STYLE_BOTTOM_DECO_OPTIONS,
  TITLE_STYLE_BORDER_OPTIONS,
  TITLE_STYLE_EFFECT_OPTIONS,
  TITLE_STYLE_FAMILY_OPTIONS,
  TITLE_STYLE_FONT_OPTIONS,
  TITLE_STYLE_PALETTE_OPTIONS,
  TITLE_STYLE_PATTERN_OPTIONS,
  TITLE_STYLE_PRESETS,
  TITLE_STYLE_SIDE_DECO_OPTIONS,
  TITLE_STYLE_TEXT_COLOR_MODE_OPTIONS,
  TITLE_STYLE_TOP_DECO_OPTIONS,
  getMatchedTitleStylePreset,
  getTitleStyleFontOption,
  getTitleStylePaletteLabel,
  getTitleStylePaletteSpec,
  getTitleStyleTrimSpec,
  normalizeTitleStyle,
} from "../titleStyleOptions";

const STYLE_EDITOR_TABS = [
  { id: "preset", label: "추천" },
  { id: "basic", label: "프레임" },
  { id: "ornament", label: "장식" },
  { id: "font", label: "글자" },
  { id: "customPreset", label: "커스텀 프리셋" },
];

const FRAME_EDITOR_TABS = [
  { id: "frame", label: "프레임" },
  { id: "color", label: "색상" },
  { id: "metal", label: "금속" },
];

const CUSTOM_PRESET_STORAGE_KEY = "titleStyleCustomPresets";
const CUSTOM_PRESET_LIMIT = 24;
const LEGACY_MODAL_PALETTE_ALIASES = {
  royal: "amber",
  violet: "amethyst",
};

const TRIM_BY_METAL = {
  "champagne-gold": "gold",
  "satin-silver": "silver",
  "rose-bronze": "bronze",
};

const ORNAMENT_SIZE_ORDER = ["large", "medium", "point"];
const ORNAMENT_SIZE_LABELS = {
  large: "큰 장식",
  medium: "중간 장식",
  point: "포인트 장식",
};

const getModalPaletteId = (paletteId) => {
  const aliasedPaletteId = LEGACY_MODAL_PALETTE_ALIASES[paletteId] || paletteId;
  return TITLE_STYLE_PALETTE_OPTIONS.some((item) => item.value === aliasedPaletteId)
    ? aliasedPaletteId
    : DEFAULT_TITLE_STYLE.paletteId;
};

const normalizeModalStyle = (style = {}) => {
  const normalized = normalizeTitleStyle({
    ...style,
    version: 3,
    ornamentSetId: normalizeTitleOrnamentSetId(style.ornamentSetId),
    paletteId: getModalPaletteId(style.paletteId),
    trimPaletteId: ["gold", "bronze"].includes(style.trimPaletteId) ? style.trimPaletteId : "silver",
    customFrameColor: "",
    customBannerColor: "",
    customTrimColor: "",
    topDecoId: "none",
    sideDecoId: "none",
    bottomDecoId: "none",
    patternId: "none",
    effectId: "none",
  });
  const selectedOrnament = getTitleOrnamentSet(normalized.ornamentSetId);
  return selectedOrnament && !isTitleOrnamentCompatible(selectedOrnament, normalized)
    ? { ...normalized, ornamentSetId: "none" }
    : normalized;
};

const createStyleFingerprint = (style = {}) => {
  const normalized = normalizeTitleStyle(style);

  return JSON.stringify({
    version: normalized.version,
    familyId: normalized.familyId,
    paletteId: normalized.paletteId,
    trimPaletteId: normalized.trimPaletteId,
    ornamentSetId: normalized.ornamentSetId,
    icon: normalized.icon,
    fontStyleId: normalized.fontStyleId,
    textScale: normalized.textScale,
    textOffsetY: normalized.textOffsetY,
    textColorMode: normalized.textColorMode,
    customTextColor: normalized.customTextColor,
    customFrameColor: normalized.customFrameColor,
    customBannerColor: normalized.customBannerColor,
    customTrimColor: normalized.customTrimColor,
    topDecoId: normalized.topDecoId,
    sideDecoId: normalized.sideDecoId,
    bottomDecoId: normalized.bottomDecoId,
    patternId: normalized.patternId,
    effectId: normalized.effectId,
  });
};

const normalizeCustomPresetList = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const id = String(item?.id || "").trim();
      const name = String(item?.name || item?.label || "").trim();
      if (!id || !name) return null;

      return {
        id,
        name,
        description: String(item?.description || "").trim(),
        style: normalizeModalStyle(item?.style || item),
        createdAt: item?.createdAt || null,
        updatedAt: item?.updatedAt || null,
        order: Number(item?.order) || index + 1,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (left.order || 0) - (right.order || 0));

function OptionCard({
  selected,
  label,
  description,
  children,
  onClick,
  disabled = false,
  tone = "indigo",
  compact = false,
}) {
  const activeClass =
    tone === "amber"
      ? "border-amber-300 bg-amber-50 shadow-[0_14px_28px_-22px_rgba(245,158,11,0.42)]"
      : "border-indigo-400 bg-indigo-50 shadow-[0_14px_28px_-22px_rgba(99,102,241,0.38)]";

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[24px] border text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${compact ? "p-4" : "p-4"} ${
        selected
          ? activeClass
          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{label}</p>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          ) : null}
        </div>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </Button>
  );
}

function SectionCard({ title, description, children }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.16)]">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SummaryChip({ label, value }) {
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
      {label}: {value}
    </span>
  );
}

function PalettePreview({ paletteId }) {
  const palette = getTitleStylePaletteSpec(paletteId);

  return (
    <div className="space-y-3">      <TitleNameplatePreview
        preserveDesignScale
        label=""
        familyId="plaque"
        paletteId={paletteId}
        trimPaletteId="silver"
        iconId="none"
        topDecoId="none"
        sideDecoId="none"
        bottomDecoId="none"
        patternId="none"
        effectId="none"
        compact
        showLabel={false}
        showIconBadges={false}
      />
      <div
        className="h-4 rounded-full border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
        style={{
          background: `linear-gradient(90deg, ${palette.bannerStart}, ${palette.bannerMid}, ${palette.bannerEnd})`,
        }}
      />
      <div className="flex gap-2">
        {[palette.outerStart, palette.outerMid, palette.outerEnd, palette.gemDark].map((color) => (
          <span
            key={color}
            className="h-6 flex-1 rounded-full border border-slate-200"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}

function TrimPreview({ trimPaletteId, paletteId }) {
  const trim = getTitleStyleTrimSpec(trimPaletteId, paletteId);

  return (
    <div className="space-y-3">
      <div
        className="h-4 rounded-full border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
        style={{
          background: `linear-gradient(90deg, ${trim.dark}, ${trim.light}, ${trim.mid}, ${trim.light}, ${trim.dark})`,
        }}
      />
      <div className="flex gap-2">
        {[trim.light, trim.mid, trim.dark, trim.capDark].map((color) => (
          <span
            key={color}
            className="h-6 flex-1 rounded-full border border-slate-200"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}

function ColorOverrideCard({
  label,
  description,
  value,
  baseColor,
  onChange,
  onReset,
}) {
  const activeColor = value || baseColor || "#94a3b8";

  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <Button
          type="button"
          onClick={onReset}
          disabled={!value}
          className={`rounded-full border px-3 py-1 text-[11px] font-bold transition ${
            value
              ? "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
              : "border-slate-200 bg-slate-100 text-slate-400"
          }`}
        >
          기본색
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <label className="relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.58),0_10px_24px_-18px_rgba(15,23,42,0.36)]">
          <span
            className="absolute inset-0"
            style={{ backgroundColor: activeColor }}
          />
          <input
            type="color"
            value={activeColor}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
            {value ? "직접 지정" : "기본 팔레트"}
          </p>
          <p className="mt-1 text-sm font-black tracking-[0.08em] text-slate-900">
            {activeColor.toUpperCase()}
          </p>
          {value ? (
            <p className="mt-1 text-xs text-slate-400">
              기본색 {baseColor.toUpperCase()}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PartSection({
  title,
  description,
  options,
  value,
  onSelect,
  renderPreview,
}) {
  return (
    <SectionCard title={title} description={description}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {options.map((item) => (
          <OptionCard
            key={item.value}
            selected={value === item.value}
            label={item.label}
            description={item.description}
            onClick={() => onSelect(item.value)}
            tone="amber"
            compact
          >
            {renderPreview(item.value)}
          </OptionCard>
        ))}
      </div>
    </SectionCard>
  );
}



export default function TitleStyleDesignerModal({
  open,
  onClose,
  onApply,
  initialStyle,
  titleLabel,
}) {
  const { showFeedback } = useFeedback();
  const { classId, userData } = useUser();
  const [draft, setDraft] = useState(DEFAULT_TITLE_STYLE);
  const [activeTab, setActiveTab] = useState("preset");
  const [activeFrameTab, setActiveFrameTab] = useState("frame");
  const [customPresets, setCustomPresets] = useState([]);
  const [customPresetName, setCustomPresetName] = useState("");
  const [customPresetsLoading, setCustomPresetsLoading] = useState(false);
  const [isSavingCustomPreset, setIsSavingCustomPreset] = useState(false);
  const [deletingPresetId, setDeletingPresetId] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(normalizeModalStyle(initialStyle));
    setActiveTab("preset");
    setActiveFrameTab("frame");
    setCustomPresetName("");
  }, [initialStyle, open]);

  useEffect(() => {
    let isMounted = true;

    const loadCustomPresets = async () => {
      if (!open || !classId) {
        if (isMounted) {
          setCustomPresets([]);
          setCustomPresetsLoading(false);
        }
        return;
      }

      setCustomPresetsLoading(true);

      try {
        const settingsSnapshot = await getDoc(doc(db, "classes", classId, "settings", "credentials"));
        const nextPresets = normalizeCustomPresetList(
          settingsSnapshot.data()?.[CUSTOM_PRESET_STORAGE_KEY] || [],
        );

        if (isMounted) {
          setCustomPresets(nextPresets);
        }
      } catch (error) {
        if (isMounted) {
          setCustomPresets([]);
        }
      } finally {
        if (isMounted) {
          setCustomPresetsLoading(false);
        }
      }
    };

    loadCustomPresets();

    return () => {
      isMounted = false;
    };
  }, [classId, open]);

  const matchedPreset = useMemo(() => getMatchedTitleStylePreset(draft), [draft]);
  const matchedCustomPreset = useMemo(() => {
    const targetFingerprint = createStyleFingerprint(draft);
    return (
      customPresets.find((item) => createStyleFingerprint(item.style) === targetFingerprint) ||
      null
    );
  }, [customPresets, draft]);

  useEffect(() => {
    if (!open) return;
    if (matchedCustomPreset) {
      setCustomPresetName((prev) => prev || matchedCustomPreset.name);
    }
  }, [matchedCustomPreset, open]);
  const basePalette = useMemo(() => getTitleStylePaletteSpec(draft.paletteId), [draft.paletteId]);
  const ornamentSetOptions = useMemo(
    () =>
      getTitleOrnamentSetOptions({
        familyId: draft.familyId,
        paletteId: draft.paletteId,
        trimPaletteId: draft.trimPaletteId,
      }),
    [draft.familyId, draft.paletteId, draft.trimPaletteId],
  );

  const setField = (field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateAssetChoice = (changes) => {
    setDraft((prev) => {
      const next = {
        ...prev,
        ...changes,
        version: 3,
        customFrameColor: "",
        customBannerColor: "",
        customTrimColor: "",
        topDecoId: "none",
        sideDecoId: "none",
        bottomDecoId: "none",
        patternId: "none",
        effectId: "none",
      };
      const selectedOrnament = getTitleOrnamentSet(next.ornamentSetId);
      return selectedOrnament && !isTitleOrnamentCompatible(selectedOrnament, next)
        ? { ...next, ornamentSetId: "none" }
        : next;
    });
  };

  const setPalette = (paletteId) => {
    updateAssetChoice({
      paletteId,
    });
  };

  const setFrame = (familyId) => updateAssetChoice({ familyId });
  const setTrimPalette = (trimPaletteId) => updateAssetChoice({ trimPaletteId });
  const setFontStyle = (fontStyleId) => {
    const supportsCustomTextColor = getTitleStyleFontOption(fontStyleId).supportsCustomTextColor !== false;
    setDraft((prev) => ({
      ...prev,
      fontStyleId,
      ...(supportsCustomTextColor ? {} : { textColorMode: "auto", customTextColor: "" }),
    }));
  };

  const persistCustomPresets = async (nextPresets) => {
    const now = new Date().toISOString();

    await setDoc(
      doc(db, "classes", classId, "settings", "credentials"),
      {
        [CUSTOM_PRESET_STORAGE_KEY]: nextPresets.map((item, index) => ({
          id: item.id,
          name: item.name,
          description: item.description || "",
          style: normalizeTitleStyle(item.style),
          order: index + 1,
          createdAt: item.createdAt || now,
          updatedAt: now,
          updatedByUid: userData?.uid || "",
        })),
      },
      { merge: true },
    );
  };

  const handleSaveCustomPreset = async () => {
    const trimmedName = String(customPresetName || matchedCustomPreset?.name || "").trim();
    if (!trimmedName) {
      showFeedback("커스텀 프리셋 이름을 입력해 주세요.", "warning");
      return;
    }

    if (!classId) {
      showFeedback("학급 정보를 찾을 수 없습니다.", "error");
      return;
    }

    setIsSavingCustomPreset(true);

    try {
      const normalizedStyle = normalizeTitleStyle(draft);
      const existingById = matchedCustomPreset
        ? customPresets.findIndex((item) => item.id === matchedCustomPreset.id)
        : -1;
      const existingByName = customPresets.findIndex(
        (item) => item.name.toLowerCase() === trimmedName.toLowerCase(),
      );
      const targetIndex = existingById >= 0 ? existingById : existingByName;

      let nextPresets;
      if (targetIndex >= 0) {
        nextPresets = customPresets.map((item, index) =>
          index === targetIndex
            ? {
                ...item,
                name: trimmedName,
                style: normalizedStyle,
              }
            : item,
        );
      } else {
        if (customPresets.length >= CUSTOM_PRESET_LIMIT) {
          showFeedback(`커스텀 프리셋은 최대 ${CUSTOM_PRESET_LIMIT}개까지 저장할 수 있습니다.`, "warning");
          return;
        }

        nextPresets = [
          {
            id: `custom-title-preset-${Date.now()}`,
            name: trimmedName,
            description: "",
            style: normalizedStyle,
            createdAt: null,
            updatedAt: null,
            order: customPresets.length + 1,
          },
          ...customPresets,
        ];
      }

      const normalizedNextPresets = nextPresets.map((item, index) => ({
        ...item,
        order: index + 1,
      }));

      await persistCustomPresets(normalizedNextPresets);
      setCustomPresets(normalizedNextPresets);
      setCustomPresetName(trimmedName);
      showFeedback(
        targetIndex >= 0 ? "커스텀 프리셋을 덮어썼습니다." : "커스텀 프리셋을 저장했습니다.",
        "success",
      );
    } catch (error) {
      console.error("[TitleStyleDesignerModal] save custom preset error:", error);
      showFeedback("커스텀 프리셋 저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSavingCustomPreset(false);
    }
  };

  const handleDeleteCustomPreset = async (presetId) => {
    if (!presetId || !classId) return;

    setDeletingPresetId(presetId);
    try {
      const nextPresets = customPresets
        .filter((item) => item.id !== presetId)
        .map((item, index) => ({ ...item, order: index + 1 }));
      await persistCustomPresets(nextPresets);
      setCustomPresets(nextPresets);
      if (matchedCustomPreset?.id === presetId) {
        setCustomPresetName("");
      }
      showFeedback("커스텀 프리셋을 삭제했습니다.", "success");
    } catch (error) {
      console.error("[TitleStyleDesignerModal] delete custom preset error:", error);
      showFeedback("커스텀 프리셋 삭제 중 오류가 발생했습니다.", "error");
    } finally {
      setDeletingPresetId("");
    }
  };

  const handleApply = () => {
    onApply?.(normalizeTitleStyle(draft));
    onClose?.();
  };

  const previewLabel = titleLabel || "칭호 이름";
  const activeFontOption = getTitleStyleFontOption(draft.fontStyleId);
  const supportsCustomTextColor = activeFontOption.supportsCustomTextColor !== false;

  const summaryItems = [
    {
      label: "프레임",
      value:
        TITLE_STYLE_FAMILY_OPTIONS.find((item) => item.value === draft.familyId)?.label ||
        "기본 명패",
    },
    {
      label: "메인 색",
      value: getTitleStylePaletteLabel(draft.paletteId, "하늘빛"),
    },
    {
      label: "테두리",
      value:
        TITLE_STYLE_BORDER_OPTIONS.find((item) => item.value === draft.trimPaletteId)?.label ||
        "메인 색과 맞춤",
    },
    {
      label: "글자 스타일",
      value:
        TITLE_STYLE_FONT_OPTIONS.find((item) => item.value === draft.fontStyleId)?.label ||
        "기본형",
    },
    {
      label: "글자색",
      value:
        draft.textColorMode === "custom" && draft.customTextColor
          ? draft.customTextColor.toUpperCase()
          : "자동 추천",
    },
    {
      label: "상단 장식",
      value:
        TITLE_STYLE_TOP_DECO_OPTIONS.find((item) => item.value === draft.topDecoId)?.label ||
        "없음",
    },
    {
      label: "옆 장식",
      value:
        TITLE_STYLE_SIDE_DECO_OPTIONS.find((item) => item.value === draft.sideDecoId)?.label ||
        "없음",
    },
    {
      label: "하단 장식",
      value:
        TITLE_STYLE_BOTTOM_DECO_OPTIONS.find((item) => item.value === draft.bottomDecoId)?.label ||
        "없음",
    },
    {
      label: "무늬",
      value:
        TITLE_STYLE_PATTERN_OPTIONS.find((item) => item.value === draft.patternId)?.label ||
        "없음",
    },
    {
      label: "효과",
      value:
        TITLE_STYLE_EFFECT_OPTIONS.find((item) => item.value === draft.effectId)?.label ||
        "없음",
    },
  ];

  const selectedOrnament = getTitleOrnamentSet(draft.ornamentSetId);
  summaryItems.splice(5, summaryItems.length - 5, {
    label: "장식",
    value: selectedOrnament?.label || "없음",
  });

  if (draft.customFrameColor || draft.customBannerColor || draft.customTrimColor) {
    summaryItems.push({
      label: "세부 색상",
      value: [
        draft.customFrameColor ? "프레임" : null,
        draft.customBannerColor ? "배너" : null,
        draft.customTrimColor ? "테두리" : null,
      ]
        .filter(Boolean)
        .join(" / "),
    });
  }

  const renderPresetSection = () => (
    <SectionCard
      title="추천 프리셋"
      description="전체 분위기를 먼저 고른 뒤, 마음에 드는 조합을 출발점으로 잡아 보세요."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {TITLE_STYLE_PRESETS.map((preset) => {
          const selected = matchedPreset?.id === preset.id;
          const style = normalizeModalStyle({
            familyId: preset.familyId,
            paletteId: preset.paletteId,
            trimPaletteId: preset.trimPaletteId,
            icon: preset.iconId,
            topDecoId: preset.topDecoId,
            sideDecoId: preset.sideDecoId,
            bottomDecoId: preset.bottomDecoId,
            patternId: preset.patternId,
            effectId: preset.effectId,
          });

          return (
            <OptionCard
              key={preset.id}
              selected={selected}
              label={preset.label}
              description={preset.description}
              onClick={() => setDraft(style)}
            >
              <TitleNameplatePreview
                preserveDesignScale
                label={previewLabel}
                version={style.version}
                familyId={style.familyId}
                paletteId={style.paletteId}
                trimPaletteId={style.trimPaletteId}
                ornamentSetId={style.ornamentSetId}
                iconId={style.icon}
                fontStyleId={style.fontStyleId}
                textColorMode={style.textColorMode}
                customTextColor={style.customTextColor}
                customFrameColor={style.customFrameColor}
                customBannerColor={style.customBannerColor}
                customTrimColor={style.customTrimColor}
                topDecoId={style.topDecoId}
                sideDecoId={style.sideDecoId}
                bottomDecoId={style.bottomDecoId}
                patternId={style.patternId}
                effectId={style.effectId}
                compact
                showLabel={false}
                showIconBadges={false}
              />
            </OptionCard>
          );
        })}
      </div>
    </SectionCard>
  );

  const renderCustomPresetSection = () => (
    <SectionCard
      title="커스텀 프리셋"
      description="선생님이 자주 쓰는 명패 조합을 저장해 두고, 다음 칭호에도 바로 적용할 수 있습니다."
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
          <InputField
            label="프리셋 이름"
            value={customPresetName}
            onChange={(event) => setCustomPresetName(event.target.value)}
            placeholder="예: 전교행사 프리미엄"
          />
          <div className="flex items-end">
            <Button
              onClick={handleSaveCustomPreset}
              isLoading={isSavingCustomPreset}
              icon={Save}
            >
              {matchedCustomPreset ? "현재 프리셋 덮어쓰기" : "현재 스타일 저장"}
            </Button>
          </div>
        </div>

        <Alert
          type="info"
          message="같은 이름으로 저장하면 기존 커스텀 프리셋을 덮어씁니다. 현재 조합과 같은 프리셋이 있으면 그 프리셋을 바로 업데이트합니다."
        />

        {customPresetsLoading ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            커스텀 프리셋을 불러오는 중입니다.
          </div>
        ) : customPresets.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {customPresets.map((preset) => {
              const selected = matchedCustomPreset?.id === preset.id;

              return (
                <div key={preset.id} className="relative">
                  <OptionCard
                    selected={selected}
                    label={preset.name}
                    description={preset.description || "저장된 커스텀 명패 조합"}
                    onClick={() => {
                      setDraft(normalizeModalStyle(preset.style));
                      setCustomPresetName(preset.name);
                    }}
                  >
                    <TitleNameplatePreview
                      preserveDesignScale
                      label={previewLabel}
                      version={preset.style.version}
                      familyId={preset.style.familyId}
                      paletteId={preset.style.paletteId}
                      trimPaletteId={preset.style.trimPaletteId}
                      ornamentSetId={preset.style.ornamentSetId}
                      iconId={preset.style.icon}
                      fontStyleId={preset.style.fontStyleId}
                      textColorMode={preset.style.textColorMode}
                      customTextColor={preset.style.customTextColor}
                      customFrameColor={preset.style.customFrameColor}
                      customBannerColor={preset.style.customBannerColor}
                      customTrimColor={preset.style.customTrimColor}
                      topDecoId={preset.style.topDecoId}
                      sideDecoId={preset.style.sideDecoId}
                      bottomDecoId={preset.style.bottomDecoId}
                      patternId={preset.style.patternId}
                      effectId={preset.style.effectId}
                      compact
                      showLabel={false}
                      showIconBadges={false}
                    />
                  </OptionCard>

                  <Button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteCustomPreset(preset.id);
                    }}
                    disabled={deletingPresetId === preset.id}
                    className="absolute right-3 top-3 rounded-full border border-red-200 bg-white/90 p-2 text-red-500 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={`${preset.name} 프리셋 삭제`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            아직 저장된 커스텀 프리셋이 없습니다. 마음에 드는 명패를 만든 뒤 이름을 적고 저장해 보세요.
          </div>
        )}
      </div>
    </SectionCard>
  );

  const renderBasicSection = () => (
    <SectionCard
      title="프레임 형태"
      description="명패의 기본 골격을 고르세요. 색상과 금속은 위 소탭에서 이어서 조절할 수 있습니다."
    >
      <div className="space-y-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">프레임 템플릿</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {TITLE_STYLE_FAMILY_OPTIONS.map((item) => (
              <OptionCard
                key={item.value}
                selected={draft.familyId === item.value}
                label={item.label}
                description={item.description}
                onClick={() => setFrame(item.value)}
                compact
              >
                <TitleNameplatePreview
                  preserveDesignScale
                  label={previewLabel}
                  version={3}
                  familyId={item.value}
                  paletteId={draft.paletteId}
                  trimPaletteId={draft.trimPaletteId}
                  ornamentSetId="none"
                  iconId="none"
                  fontStyleId={draft.fontStyleId}
                  textColorMode={draft.textColorMode}
                  customTextColor={draft.customTextColor}
                  customFrameColor={draft.customFrameColor}
                  customBannerColor={draft.customBannerColor}
                  customTrimColor={draft.customTrimColor}
                  topDecoId="none"
                  sideDecoId="none"
                  bottomDecoId="none"
                  patternId="none"
                  effectId="none"
                  compact
                  showLabel={false}
                  showIconBadges={false}
                />
              </OptionCard>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
  const renderColorSection = () => (
    <SectionCard
      title="색상 조합"
      description="검수한 18가지 고정 팔레트만 보여줍니다. 학급별 신용등급 색상이나 임의 HEX 색상은 이 화면에 노출하지 않습니다."
    >
      <div className="space-y-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">색상 18종</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {TITLE_STYLE_PALETTE_OPTIONS.map((item) => (
              <OptionCard
                key={item.value}
                selected={draft.paletteId === item.value}
                label={item.label}
                onClick={() => setPalette(item.value)}
                compact
              >
                <PalettePreview paletteId={item.value} />
              </OptionCard>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          팔레트는 실제 제작한 명패 에셋 기준으로 고정합니다. 배경과 프레임의 명암·질감은 에셋의 완성도를 유지하도록 함께 적용됩니다.
        </div>
      </div>
    </SectionCard>
  );
  const renderBorderSection = () => (
    <SectionCard
      title="테두리 금속"
      description="명패 에셋에 맞춘 세 가지 고정 테두리만 선택할 수 있습니다. 색상 탭의 내부 팔레트와 독립적으로 조합됩니다."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {TITLE_STYLE_BORDER_OPTIONS.map((item) => (
          <OptionCard
            key={item.value}
            selected={draft.trimPaletteId === item.value}
            label={item.label}
            description={item.description}
            onClick={() => setTrimPalette(item.value)}
            tone="amber"
            compact
          >
            <TrimPreview trimPaletteId={item.value} paletteId={draft.paletteId} />
          </OptionCard>
        ))}
      </div>
      <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
        현재 실전 에셋은 새틴 실버와 샴페인 골드 두 가지를 기준으로 관리합니다. 추가 금속은 검수 후 확장합니다.
      </p>
    </SectionCard>
  );
  const renderFrameSection = () => (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
        <Tabs ariaLabel="프레임 꾸미기" idPrefix="title-frame-editor" tabs={FRAME_EDITOR_TABS} activeTab={activeFrameTab} onTabChange={setActiveFrameTab} variant="pills" size="md" fullWidth wrapLabels />
      </div>
      {activeFrameTab === "color"
        ? renderColorSection()
        : activeFrameTab === "metal"
          ? renderBorderSection()
          : renderBasicSection()}
    </div>
  );
  const renderFontSection = () => (
    <SectionCard
      title="글자 스타일과 색"
      description="명패에 맞춘 두 가지 글자 스타일 중 하나를 고르고, 크기·위치와 글자색을 이어서 조절합니다."
    >
      <div className="space-y-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">글자 스타일</p>
          <p className="mt-3 text-xs font-bold text-slate-500">직접 색상 글자체</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {TITLE_STYLE_FONT_OPTIONS.filter((item) => item.supportsCustomTextColor !== false).map((item) => (
              <OptionCard
                key={item.value}
                selected={draft.fontStyleId === item.value}
                label={item.label}
                description={item.description}
                onClick={() => setFontStyle(item.value)}
                compact
              >
                <TitleNameplatePreview
                  preserveDesignScale
                  label={previewLabel}
                  version={draft.version}
                  familyId={draft.familyId}
                  paletteId={draft.paletteId}
                  trimPaletteId={draft.trimPaletteId}
                  ornamentSetId={draft.ornamentSetId}
                  iconId={draft.icon}
                  fontStyleId={item.value}
                  textScale={draft.textScale}
                  textOffsetY={draft.textOffsetY}
                  textColorMode={
                    item.supportsCustomTextColor === false ? "auto" : draft.textColorMode
                  }
                  customTextColor={
                    item.supportsCustomTextColor === false ? "" : draft.customTextColor
                  }
                  topDecoId="none"
                  sideDecoId="none"
                  bottomDecoId="none"
                  patternId="none"
                  effectId="none"
                  compact
                  showIconBadges={false}
                />
              </OptionCard>
            ))}
          </div>
          <p className="mt-5 text-xs font-bold text-slate-500">자동 색상 프리셋</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {TITLE_STYLE_FONT_OPTIONS.filter((item) => item.supportsCustomTextColor === false).map((item) => (
              <OptionCard
                key={item.value}
                selected={draft.fontStyleId === item.value}
                label={item.label}
                description={item.description}
                onClick={() => setFontStyle(item.value)}
                compact
              >
                <TitleNameplatePreview
                  preserveDesignScale
                  label={previewLabel}
                  version={draft.version}
                  familyId={draft.familyId}
                  paletteId={draft.paletteId}
                  trimPaletteId={draft.trimPaletteId}
                  ornamentSetId={draft.ornamentSetId}
                  iconId={draft.icon}
                  fontStyleId={item.value}
                  textScale={draft.textScale}
                  textOffsetY={draft.textOffsetY}
                  textColorMode="auto"
                  customTextColor=""
                  topDecoId="none"
                  sideDecoId="none"
                  bottomDecoId="none"
                  patternId="none"
                  effectId="none"
                  compact
                  showIconBadges={false}
                />
              </OptionCard>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">글자 크기</p>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-500">작게</span>
                <button
                  type="button"
                  onClick={() => setField("textScale", 100)}
                  className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-sm transition hover:text-indigo-600"
                >
                  {draft.textScale}%
                </button>
                <span className="text-xs font-semibold text-slate-500">크게</span>
              </div>
              <input
                type="range"
                min="60"
                max="150"
                step="1"
                value={draft.textScale}
                onChange={(event) => setField("textScale", Number(event.target.value))}
                className="mt-3 w-full accent-indigo-600"
                aria-label="글자 크기 조절"
              />
              <p className="mt-2 text-center text-[11px] text-slate-400">1% 단위로 조절할 수 있습니다.</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">글자 위치</p>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-500">위</span>
                <button
                  type="button"
                  onClick={() => setField("textOffsetY", 0)}
                  className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-sm transition hover:text-indigo-600"
                >
                  {draft.textOffsetY === 0
                    ? "가운데"
                    : draft.textOffsetY < 0
                      ? `위로 ${Math.abs(draft.textOffsetY)}%`
                      : `아래로 ${draft.textOffsetY}%`}
                </button>
                <span className="text-xs font-semibold text-slate-500">아래</span>
              </div>
              <input
                type="range"
                min="-25"
                max="25"
                step="1"
                value={draft.textOffsetY}
                onChange={(event) => setField("textOffsetY", Number(event.target.value))}
                className="mt-3 w-full accent-indigo-600"
                aria-label="글자 위아래 위치 조절"
              />
              <p className="mt-2 text-center text-[11px] text-slate-400">1% 단위로 조절할 수 있습니다.</p>
            </div>
          </div>
        </div>
        {supportsCustomTextColor ? (
          <>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">글자색</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {TITLE_STYLE_TEXT_COLOR_MODE_OPTIONS.map((item) => (
                  <OptionCard
                    key={item.value}
                    selected={draft.textColorMode === item.value}
                    label={item.label}
                    description={item.description}
                    onClick={() => setField("textColorMode", item.value)}
                    compact
                  />
                ))}
              </div>
            </div>
            {draft.textColorMode === "custom" ? (
              <ColorOverrideCard
                label="직접 지정 글자색"
                description="선택한 색상과 글자 스타일에 어울리는 글자색을 직접 지정합니다."
                value={draft.customTextColor}
                baseColor={basePalette.bannerText}
                onChange={(value) => setField("customTextColor", value)}
                onReset={() => setField("customTextColor", "")}
              />
            ) : null}
          </>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-900">
            <p className="font-bold">자동 글자 스타일 프리셋</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              선택한 프리셋의 글자체·광택·윤곽·그림자가 함께 적용됩니다. 직접 색상 지정은 지원하지 않습니다.
            </p>
          </div>
        )}
        <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          {supportsCustomTextColor
            ? "명패 기본은 자동 추천 또는 직접 색상 지정으로 사용할 수 있습니다."
            : "자동 글자 스타일 프리셋은 프레임 색감이 흔들리지 않도록 직접 색상 대신 정해진 표현 방식을 사용합니다."}
        </p>
      </div>
    </SectionCard>
  );
  const renderOrnamentSection = () => (
    <SectionCard
      title="장식 요소"
      description="무늬와 효과는 선택 사항입니다. 기본 프레임과 색상이 먼저 보이도록 필요한 경우에만 더하세요."
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="안쪽 무늬"
            value={draft.patternId}
            onChange={(event) => setField("patternId", event.target.value)}
            options={TITLE_STYLE_PATTERN_OPTIONS.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
          />
          <SelectField
            label="반짝 효과"
            value={draft.effectId}
            onChange={(event) => setField("effectId", event.target.value)}
            options={TITLE_STYLE_EFFECT_OPTIONS.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
          />
        </div>
        <p className="text-xs leading-5 text-slate-500">장식 요소는 필수가 아니며, 명패 기본 구조를 유지한 채 분위기만 더해 주는 보조 설정입니다.</p>
      </div>
    </SectionCard>
  );
  const renderTopSection = () => (
    <PartSection
      title="상단 장식"
      description="왕관, 문장, 후광처럼 명패 윗부분의 성격을 정합니다."
      options={TITLE_STYLE_TOP_DECO_OPTIONS}
      value={draft.topDecoId}
      onSelect={(value) => setField("topDecoId", value)}
      renderPreview={(value) => (
        <TitleNameplatePreview
          preserveDesignScale
          label={previewLabel}
          familyId={draft.familyId}
          paletteId={draft.paletteId}
          trimPaletteId={draft.trimPaletteId}
          iconId={draft.icon}
          fontStyleId={draft.fontStyleId}
          textColorMode={draft.textColorMode}
          customTextColor={draft.customTextColor}
          customFrameColor={draft.customFrameColor}
          customBannerColor={draft.customBannerColor}
          customTrimColor={draft.customTrimColor}
          topDecoId={value}
          sideDecoId="none"
          bottomDecoId="none"
          patternId="none"
          effectId="none"
          compact
          showLabel={false}
          showIconBadges={false}
        />
      )}
    />
  );

  const renderSideSection = () => (
    <PartSection
      title="옆 장식"
      description="보석, 날개, 금속 가드처럼 좌우 끝부분의 개성을 정합니다."
      options={TITLE_STYLE_SIDE_DECO_OPTIONS}
      value={draft.sideDecoId}
      onSelect={(value) => setField("sideDecoId", value)}
      renderPreview={(value) => (
        <TitleNameplatePreview
          preserveDesignScale
          label={previewLabel}
          familyId={draft.familyId}
          paletteId={draft.paletteId}
          trimPaletteId={draft.trimPaletteId}
          iconId={draft.icon}
          fontStyleId={draft.fontStyleId}
          textColorMode={draft.textColorMode}
          customTextColor={draft.customTextColor}
          customFrameColor={draft.customFrameColor}
          customBannerColor={draft.customBannerColor}
          customTrimColor={draft.customTrimColor}
          topDecoId="none"
          sideDecoId={value}
          bottomDecoId="none"
          patternId="none"
          effectId="none"
          compact
          showLabel={false}
          showIconBadges={false}
        />
      )}
    />
  );

  const renderBottomSection = () => (
    <PartSection
      title="하단 장식"
      description="리본 꼬리, 메달, 매듭처럼 명패 아래 포인트를 고를 수 있습니다."
      options={TITLE_STYLE_BOTTOM_DECO_OPTIONS}
      value={draft.bottomDecoId}
      onSelect={(value) => setField("bottomDecoId", value)}
      renderPreview={(value) => (
        <TitleNameplatePreview
          preserveDesignScale
          label={previewLabel}
          familyId={draft.familyId}
          paletteId={draft.paletteId}
          trimPaletteId={draft.trimPaletteId}
          iconId={draft.icon}
          fontStyleId={draft.fontStyleId}
          textColorMode={draft.textColorMode}
          customTextColor={draft.customTextColor}
          customFrameColor={draft.customFrameColor}
          customBannerColor={draft.customBannerColor}
          customTrimColor={draft.customTrimColor}
          topDecoId="none"
          sideDecoId="none"
          bottomDecoId={value}
          patternId="none"
          effectId="none"
          compact
          showLabel={false}
          showIconBadges={false}
        />
      )}
    />
  );

  const renderAssetOrnamentSection = () => (
    <SectionCard
      title="프레임 전용 장식"
      description="선택한 프레임에 맞춰 만든 장식만 고를 수 있습니다. 색상과 금속을 바꿔도 같은 프레임의 장식은 계속 선택할 수 있습니다."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <OptionCard
          selected={draft.ornamentSetId === "none"}
          label="장식 없음"
          description="프레임과 고유 색상을 가장 또렷하게 보여줍니다."
          onClick={() => setField("ornamentSetId", "none")}
          compact
        >
          <TitleNameplatePreview
            preserveDesignScale
            label={previewLabel}
            version={3}
            familyId={draft.familyId}
            paletteId={draft.paletteId}
            trimPaletteId={draft.trimPaletteId}
            ornamentSetId="none"
            iconId="none"
            fontStyleId={draft.fontStyleId}
            textColorMode={draft.textColorMode}
            customTextColor={draft.customTextColor}
            compact
            showIconBadges={false}
          />
        </OptionCard>
        {ornamentSetOptions
          .slice()
          .sort((left, right) => ORNAMENT_SIZE_ORDER.indexOf(left.size) - ORNAMENT_SIZE_ORDER.indexOf(right.size))
          .map((item, index, orderedOptions) => {
          const previewPaletteId = item.paletteIds[0];
          const previewTrimPaletteId = TRIM_BY_METAL[item.metalIds[0]] || "silver";
          const isSelected = draft.ornamentSetId === item.id;
          const showSizeHeading = index === 0 || orderedOptions[index - 1]?.size !== item.size;
          return (
            <div key={item.id} className="contents">
              {showSizeHeading ? (
                <div className="col-span-full mt-2 flex items-center gap-2 border-b border-slate-200 pb-2 first:mt-0">
                  <h3 className="text-sm font-extrabold text-slate-800">{ORNAMENT_SIZE_LABELS[item.size]}</h3>
                  <span className="text-xs text-slate-500">크기별로 골라 보세요</span>
                </div>
              ) : null}
              <OptionCard
                selected={isSelected}
                disabled={!item.isCompatible}
                label={item.label}
                description={
                  item.isCompatible
                    ? item.description
                    : `${item.description} · 현재 색상/금속 조합에서는 사용할 수 없습니다.`
                }
                onClick={() => setField("ornamentSetId", item.id)}
                tone="amber"
                compact
              >
                <TitleNameplatePreview
                  preserveDesignScale
                  label={previewLabel}
                  version={3}
                  familyId={draft.familyId}
                  paletteId={previewPaletteId}
                  trimPaletteId={previewTrimPaletteId}
                  ornamentSetId={item.id}
                  iconId="none"
                  fontStyleId={draft.fontStyleId}
                  textColorMode={draft.textColorMode}
                  customTextColor={draft.customTextColor}
                  compact
                  showIconBadges={false}
                />
              </OptionCard>
            </div>
          );
        })}
      </div>
      <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
        선택한 장식은 획득 화면에도 그대로 적용됩니다. 프레임을 바꾸면 새 프레임에 맞는 장식으로 다시 고를 수 있습니다.
      </p>
    </SectionCard>
  );

  const renderActiveSection = () => {
    switch (activeTab) {
      case "customPreset":
        return renderCustomPresetSection();
      case "basic":
        return renderFrameSection();
      case "legacy-top":
        return renderTopSection();
      case "legacy-side":
        return renderSideSection();
      case "legacy-bottom":
        return renderBottomSection();
      case "font":
        return renderFontSection();
      case "legacy-ornament":
        return renderOrnamentSection();
      case "ornament":
        return renderAssetOrnamentSection();
      case "preset":
      default:
        return renderPresetSection();
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="명패 자세히 꾸미기" size="full">
      <div className="grid gap-5 xl:grid-cols-[1.12fr,0.88fr]">
        <div className="space-y-5">
          <div className="sticky top-0 z-10 -mx-1 overflow-x-auto border-b border-slate-200 bg-white/90 px-1 pb-0 backdrop-blur">
            <Tabs ariaLabel="명패 꾸미기 업무" idPrefix="title-style-editor" tabs={STYLE_EDITOR_TABS} activeTab={activeTab} onTabChange={setActiveTab} variant="underline" size="md" />
          </div>

          {renderActiveSection()}
        </div>

        <aside className="space-y-4 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#fffdf6,_#ffffff)] p-5 shadow-[0_18px_42px_-30px_rgba(245,158,11,0.18)] xl:sticky xl:top-0">
          <div>
            <p className="text-sm font-semibold text-slate-800">학생 화면 미리보기</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              어떤 탭을 보고 있어도 현재 조합이 학생 화면에서 어떻게 보일지 바로 확인할 수 있습니다.
            </p>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
              미획득 상태
            </p>
            <div className="mt-3 flex min-h-[150px] items-center justify-center">
              <TitleNameplatePreview
                preserveDesignScale
                label={previewLabel}
                version={draft.version}
                familyId={draft.familyId}
                paletteId={draft.paletteId}
                trimPaletteId={draft.trimPaletteId}
                ornamentSetId={draft.ornamentSetId}
                iconId={draft.icon}
                fontStyleId={draft.fontStyleId}
                textScale={draft.textScale}
                textOffsetY={draft.textOffsetY}
                textColorMode={draft.textColorMode}
                customTextColor={draft.customTextColor}
                customFrameColor={draft.customFrameColor}
                customBannerColor={draft.customBannerColor}
                customTrimColor={draft.customTrimColor}
                topDecoId={draft.topDecoId}
                sideDecoId={draft.sideDecoId}
                bottomDecoId={draft.bottomDecoId}
                patternId={draft.patternId}
                effectId={draft.effectId}
                locked
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              아직 얻지 못한 칭호는 검은 실루엣과 물음표로만 보여서, 학생이 수집 욕구를 느끼도록 합니다.
            </p>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
              획득 상태
            </p>
            <div className="mt-3 flex min-h-[150px] items-center justify-center">
              <TitleNameplatePreview
                preserveDesignScale
                label={previewLabel}
                version={draft.version}
                familyId={draft.familyId}
                paletteId={draft.paletteId}
                trimPaletteId={draft.trimPaletteId}
                ornamentSetId={draft.ornamentSetId}
                iconId={draft.icon}
                fontStyleId={draft.fontStyleId}
                textScale={draft.textScale}
                textOffsetY={draft.textOffsetY}
                textColorMode={draft.textColorMode}
                customTextColor={draft.customTextColor}
                customFrameColor={draft.customFrameColor}
                customBannerColor={draft.customBannerColor}
                customTrimColor={draft.customTrimColor}
                topDecoId={draft.topDecoId}
                sideDecoId={draft.sideDecoId}
                bottomDecoId={draft.bottomDecoId}
                patternId={draft.patternId}
                effectId={draft.effectId}
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              획득 후에는 선택한 색과 테두리 금속, 장식이 그대로 드러납니다.
            </p>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
              현재 조합 요약
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {summaryItems.map((item) => (
                <SummaryChip key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-xs leading-5 text-amber-900">
            추천 순서는 `프리셋 선택 → 프레임 → 메인 색 → 테두리 → 장식`입니다. 큰 분위기를 먼저 잡고,
            탭을 옮겨가며 세부 장식을 다듬으면 훨씬 덜 헷갈립니다.
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button onClick={handleApply}>이 명패 적용하기</Button>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
