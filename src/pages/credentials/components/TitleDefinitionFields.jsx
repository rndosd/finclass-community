import { useMemo } from "react";

import { Button, SelectField, Textarea } from "../../../components/ui";
import {
  DEFAULT_TITLE_REVEAL_CONFIG,
  DEFAULT_TITLE_GRADES,
  TITLE_REVEAL_VISIBILITY_OPTIONS,
  formatTitleRevealConfigLabel,
  normalizeTitleRevealConfig,
} from "../CredentialsPage.parts";
import TitleNameplatePreview from "./TitleNameplatePreview";
import {
  TITLE_STYLE_BOTTOM_DECO_OPTIONS,
  TITLE_STYLE_BORDER_OPTIONS,
  TITLE_STYLE_EFFECT_OPTIONS,
  TITLE_STYLE_FAMILY_OPTIONS,
  TITLE_STYLE_FONT_OPTIONS,
  TITLE_STYLE_ICON_OPTIONS,
  TITLE_STYLE_PATTERN_OPTIONS,
  TITLE_STYLE_SIDE_DECO_OPTIONS,
  TITLE_STYLE_TOP_DECO_OPTIONS,
  getMatchedTitleStylePreset,
  getTitleStylePaletteLabel,
} from "../titleStyleOptions";

function getOptionLabel(options, value, fallback) {
  return options.find((item) => item.value === value)?.label || fallback;
}

export default function TitleDefinitionFields({
  form,
  isSubmitting,
  titleCategoryOptions,
  titleGradeOptions,
  onCategoryChange,
  setField,
  onOpenStyleDesigner,
}) {
  const matchedPreset = useMemo(
    () =>
      getMatchedTitleStylePreset({
        familyId: form.familyId,
        paletteId: form.paletteId,
        trimPaletteId: form.trimPaletteId,
        icon: form.icon,
        fontStyleId: form.fontStyleId,
        textColorMode: form.textColorMode,
        customTextColor: form.customTextColor,
        topDecoId: form.topDecoId,
        sideDecoId: form.sideDecoId,
        bottomDecoId: form.bottomDecoId,
        patternId: form.patternId,
        effectId: form.effectId,
      }),
    [form],
  );

  const selectedFamilyLabel = getOptionLabel(
    TITLE_STYLE_FAMILY_OPTIONS,
    form.familyId || "plaque",
    "기본 명패",
  );
  const selectedPaletteLabel = getTitleStylePaletteLabel(
    form.paletteId || "sky",
    "하늘색",
  );
  const selectedTrimLabel = getOptionLabel(
    TITLE_STYLE_BORDER_OPTIONS,
    form.trimPaletteId || "match",
    "기본",
  );
  const selectedFontLabel = getOptionLabel(
    TITLE_STYLE_FONT_OPTIONS,
    form.fontStyleId || "basic",
    "기본형",
  );
  const selectedIconLabel = getOptionLabel(
    TITLE_STYLE_ICON_OPTIONS,
    form.icon || "none",
    "없음",
  );
  const selectedTopDecoLabel = getOptionLabel(
    TITLE_STYLE_TOP_DECO_OPTIONS,
    form.topDecoId || "none",
    "없음",
  );
  const selectedSideDecoLabel = getOptionLabel(
    TITLE_STYLE_SIDE_DECO_OPTIONS,
    form.sideDecoId || "none",
    "없음",
  );
  const selectedBottomDecoLabel = getOptionLabel(
    TITLE_STYLE_BOTTOM_DECO_OPTIONS,
    form.bottomDecoId || "none",
    "없음",
  );
  const selectedPatternLabel = getOptionLabel(
    TITLE_STYLE_PATTERN_OPTIONS,
    form.patternId || "none",
    "없음",
  );
  const selectedEffectLabel = getOptionLabel(
    TITLE_STYLE_EFFECT_OPTIONS,
    form.effectId || "none",
    "없음",
  );
  const revealConfig = normalizeTitleRevealConfig(
    form.revealConfig || DEFAULT_TITLE_REVEAL_CONFIG,
    form.revealMode || "condition_only",
  );

  return (
    <>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">
          획득 조건
        </label>
        <Textarea
          rows={3}
          value={form.acquisitionCondition || ""}
          onChange={(event) =>
            setField("acquisitionCondition", event.target.value)
          }
          placeholder="예: 예금 상품 10회 가입, 과제 3개 완료"
          disabled={isSubmitting}
        />
        <p className="text-xs text-slate-500">
          학생 도감에서 칭호를 잠금 상태로 볼 때 함께 보여줄 안내 문구입니다.
        </p>
      </div>

      <div className="space-y-5 rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
          <p className="text-sm font-semibold text-slate-800">칭호 기본 설정</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            카테고리, 등급, 학생 공개 방식을 먼저 정하고, 필요하면 아래에서 명패
            스타일까지 세밀하게 조정할 수 있습니다.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <SelectField
              label="카테고리"
              value={form.categoryId || ""}
              onChange={(event) => onCategoryChange(event.target.value)}
              options={
                titleCategoryOptions.length
                  ? titleCategoryOptions
                  : [
                      {
                        value: "",
                        label:
                          "먼저 칭호/카테고리 설정에서 카테고리를 만들어 주세요.",
                      },
                    ]
              }
              disabled={isSubmitting || !titleCategoryOptions.length}
            />
            <p className="text-xs leading-5 text-slate-500">
              카테고리는 칭호 도감과 관리 목록에서 묶음 기준으로 쓰입니다.
            </p>
          </div>

          <SelectField
            label="등급"
            value={form.gradeId || DEFAULT_TITLE_GRADES[0]?.id || "common"}
            onChange={(event) => {
              setField("gradeId", event.target.value);
              setField("rarity", event.target.value);
            }}
            options={titleGradeOptions}
            disabled={isSubmitting}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SelectField
            label="이름 공개"
            value={revealConfig.name}
            onChange={(event) =>
              setField("revealConfig", {
                ...revealConfig,
                name: event.target.value,
              })
            }
            options={TITLE_REVEAL_VISIBILITY_OPTIONS}
            disabled={isSubmitting}
          />
          <SelectField
            label="조건 공개"
            value={revealConfig.condition}
            onChange={(event) =>
              setField("revealConfig", {
                ...revealConfig,
                condition: event.target.value,
              })
            }
            options={TITLE_REVEAL_VISIBILITY_OPTIONS}
            disabled={isSubmitting}
          />
          <SelectField
            label="명패 공개"
            value={revealConfig.nameplate}
            onChange={(event) =>
              setField("revealConfig", {
                ...revealConfig,
                nameplate: event.target.value,
              })
            }
            options={TITLE_REVEAL_VISIBILITY_OPTIONS}
            disabled={isSubmitting}
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
          <p className="text-sm font-semibold text-slate-800">학생 공개 요약</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {formatTitleRevealConfigLabel(revealConfig)}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            이름, 획득 조건, 명패를 각각 공개/블러/비공개로 조합해서 학생 도감
            노출 방식을 설정합니다.
          </p>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.28)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                명패 스타일 미리보기
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                학생 도감과 대표 칭호 영역에서 보일 명패 스타일을 여기서 맞춰둘
                수 있습니다.
              </p>
            </div>
            <Button
              variant="secondary"
              tone="blue"
              onClick={onOpenStyleDesigner}
              disabled={isSubmitting}
            >
              명패 디자이너 열기
            </Button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[0.92fr,1.08fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <TitleNameplatePreview
                preserveDesignScale
                label={form.name || "칭호 이름"}
                version={form.version}
                familyId={form.familyId || "plaque"}
                paletteId={form.paletteId || "sky"}
                trimPaletteId={form.trimPaletteId || "match"}
                ornamentSetId={form.ornamentSetId || "none"}
                iconId={form.icon || "none"}
                fontStyleId={form.fontStyleId || "basic"}
                textScale={form.textScale ?? 100}
                textOffsetY={form.textOffsetY ?? 0}
                textColorMode={form.textColorMode || "auto"}
                customTextColor={form.customTextColor || ""}
                customFrameColor={form.customFrameColor || ""}
                customBannerColor={form.customBannerColor || ""}
                customTrimColor={form.customTrimColor || ""}
                topDecoId={form.topDecoId || "none"}
                sideDecoId={form.sideDecoId || "none"}
                bottomDecoId={form.bottomDecoId || "none"}
                patternId={form.patternId || "none"}
                effectId={form.effectId || "none"}
                compact
              />
            </div>

            <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600 sm:grid-cols-2">
              <p>
                <span className="font-semibold text-slate-800">프리셋</span>{" "}
                {matchedPreset?.label || "직접 조합한 사용자 설정"}
              </p>
              <p>
                <span className="font-semibold text-slate-800">형태</span>{" "}
                {selectedFamilyLabel}
              </p>
              <p>
                <span className="font-semibold text-slate-800">색상</span>{" "}
                {selectedPaletteLabel}
              </p>
              <p>
                <span className="font-semibold text-slate-800">테두리</span>{" "}
                {selectedTrimLabel}
              </p>
              <p>
                <span className="font-semibold text-slate-800">폰트</span>{" "}
                {selectedFontLabel}
              </p>
              <p>
                <span className="font-semibold text-slate-800">아이콘</span>{" "}
                {selectedIconLabel}
              </p>
              <p>
                <span className="font-semibold text-slate-800">상단 장식</span>{" "}
                {selectedTopDecoLabel}
              </p>
              <p>
                <span className="font-semibold text-slate-800">측면 장식</span>{" "}
                {selectedSideDecoLabel}
              </p>
              <p>
                <span className="font-semibold text-slate-800">하단 장식</span>{" "}
                {selectedBottomDecoLabel}
              </p>
              <p>
                <span className="font-semibold text-slate-800">패턴</span>{" "}
                {selectedPatternLabel}
              </p>
              <p>
                <span className="font-semibold text-slate-800">효과</span>{" "}
                {selectedEffectLabel}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
