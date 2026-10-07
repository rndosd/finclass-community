import { Send, Sparkles } from "lucide-react";

import { Button } from "../../../components/ui";
import { getTitleCollectionStageToneColor } from "../titleCollectionStageTones";
import TitleNameplatePreview from "./TitleNameplatePreview";

function withAccentAlpha(hex, alpha) {
  const value = Number.parseInt(String(hex || "64748b").replace("#", ""), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

const ACCENT_CLASS_MAP = {
  slate: {
    unlockedShell:
      "border-stone-300/70 bg-[linear-gradient(180deg,_rgba(255,253,249,0.96),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(120,113,108,0.26)]",
    lockedShell:
      "border-stone-200/80 bg-[linear-gradient(180deg,_rgba(250,250,249,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(120,113,108,0.16)]",
    gradeBadge: "border-stone-300 bg-stone-100 text-stone-700",
    glow: "bg-stone-200/70",
    divider: "border-stone-200/80",
  },
  blue: {
    unlockedShell:
      "border-sky-200/80 bg-[linear-gradient(180deg,_rgba(243,249,255,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(14,165,233,0.26)]",
    lockedShell:
      "border-sky-100/80 bg-[linear-gradient(180deg,_rgba(248,252,255,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(14,165,233,0.16)]",
    gradeBadge: "border-sky-300 bg-sky-100 text-sky-700",
    glow: "bg-sky-200/75",
    divider: "border-sky-100/80",
  },
  indigo: {
    unlockedShell:
      "border-indigo-200/80 bg-[linear-gradient(180deg,_rgba(243,246,255,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(99,102,241,0.26)]",
    lockedShell:
      "border-indigo-100/80 bg-[linear-gradient(180deg,_rgba(247,248,255,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(99,102,241,0.16)]",
    gradeBadge: "border-indigo-300 bg-indigo-100 text-indigo-700",
    glow: "bg-indigo-200/75",
    divider: "border-indigo-100/80",
  },
  emerald: {
    unlockedShell:
      "border-emerald-200/80 bg-[linear-gradient(180deg,_rgba(240,253,246,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(16,185,129,0.26)]",
    lockedShell:
      "border-emerald-100/80 bg-[linear-gradient(180deg,_rgba(246,255,251,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(16,185,129,0.16)]",
    gradeBadge: "border-emerald-300 bg-emerald-100 text-emerald-700",
    glow: "bg-emerald-200/75",
    divider: "border-emerald-100/80",
  },
  violet: {
    unlockedShell:
      "border-violet-200/80 bg-[linear-gradient(180deg,_rgba(247,243,255,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(168,85,247,0.26)]",
    lockedShell:
      "border-violet-100/80 bg-[linear-gradient(180deg,_rgba(250,246,255,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(168,85,247,0.16)]",
    gradeBadge: "border-violet-300 bg-violet-100 text-violet-700",
    glow: "bg-violet-200/75",
    divider: "border-violet-100/80",
  },
  amber: {
    unlockedShell:
      "border-amber-200/85 bg-[linear-gradient(180deg,_rgba(255,251,238,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(245,158,11,0.28)]",
    lockedShell:
      "border-amber-100/80 bg-[linear-gradient(180deg,_rgba(255,252,245,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(245,158,11,0.18)]",
    gradeBadge: "border-amber-300 bg-amber-100 text-amber-700",
    glow: "bg-amber-200/80",
    divider: "border-amber-100/80",
  },
  red: {
    unlockedShell:
      "border-rose-200/80 bg-[linear-gradient(180deg,_rgba(255,244,246,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(244,63,94,0.26)]",
    lockedShell:
      "border-rose-100/80 bg-[linear-gradient(180deg,_rgba(255,247,248,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(244,63,94,0.16)]",
    gradeBadge: "border-rose-300 bg-rose-100 text-rose-700",
    glow: "bg-rose-200/75",
    divider: "border-rose-100/80",
  },
  cyan: {
    unlockedShell:
      "border-cyan-200/80 bg-[linear-gradient(180deg,_rgba(236,254,255,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(6,182,212,0.26)]",
    lockedShell:
      "border-cyan-100/80 bg-[linear-gradient(180deg,_rgba(247,254,255,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(6,182,212,0.16)]",
    gradeBadge: "border-cyan-300 bg-cyan-100 text-cyan-800",
    glow: "bg-cyan-200/75",
    divider: "border-cyan-100/80",
  },
  green: {
    unlockedShell:
      "border-green-200/80 bg-[linear-gradient(180deg,_rgba(240,253,244,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(34,197,94,0.26)]",
    lockedShell:
      "border-green-100/80 bg-[linear-gradient(180deg,_rgba(247,254,249,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(34,197,94,0.16)]",
    gradeBadge: "border-green-300 bg-green-100 text-green-800",
    glow: "bg-green-200/75",
    divider: "border-green-100/80",
  },
  orange: {
    unlockedShell:
      "border-orange-200/80 bg-[linear-gradient(180deg,_rgba(255,247,237,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(249,115,22,0.26)]",
    lockedShell:
      "border-orange-100/80 bg-[linear-gradient(180deg,_rgba(255,250,245,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(249,115,22,0.16)]",
    gradeBadge: "border-orange-300 bg-orange-100 text-orange-800",
    glow: "bg-orange-200/75",
    divider: "border-orange-100/80",
  },
  rose: {
    unlockedShell:
      "border-rose-200/80 bg-[linear-gradient(180deg,_rgba(255,241,242,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(244,63,94,0.26)]",
    lockedShell:
      "border-rose-100/80 bg-[linear-gradient(180deg,_rgba(255,247,248,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(244,63,94,0.16)]",
    gradeBadge: "border-rose-300 bg-rose-100 text-rose-700",
    glow: "bg-rose-200/75",
    divider: "border-rose-100/80",
  },
  purple: {
    unlockedShell:
      "border-purple-200/80 bg-[linear-gradient(180deg,_rgba(250,245,255,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(168,85,247,0.26)]",
    lockedShell:
      "border-purple-100/80 bg-[linear-gradient(180deg,_rgba(252,248,255,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(168,85,247,0.16)]",
    gradeBadge: "border-purple-300 bg-purple-100 text-purple-700",
    glow: "bg-purple-200/75",
    divider: "border-purple-100/80",
  },
  sky: {
    unlockedShell:
      "border-blue-200/80 bg-[linear-gradient(180deg,_rgba(239,246,255,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(59,130,246,0.26)]",
    lockedShell:
      "border-blue-100/80 bg-[linear-gradient(180deg,_rgba(247,250,255,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(59,130,246,0.16)]",
    gradeBadge: "border-sky-300 bg-sky-100 text-sky-700",
    glow: "bg-sky-200/75",
    divider: "border-sky-100/80",
  },
  teal: {
    unlockedShell:
      "border-teal-200/80 bg-[linear-gradient(180deg,_rgba(240,253,250,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(20,184,166,0.26)]",
    lockedShell:
      "border-teal-100/80 bg-[linear-gradient(180deg,_rgba(247,254,252,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(20,184,166,0.16)]",
    gradeBadge: "border-teal-300 bg-teal-100 text-teal-800",
    glow: "bg-teal-200/75",
    divider: "border-teal-100/80",
  },
  lime: {
    unlockedShell:
      "border-lime-200/80 bg-[linear-gradient(180deg,_rgba(247,254,231,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(132,204,22,0.26)]",
    lockedShell:
      "border-lime-100/80 bg-[linear-gradient(180deg,_rgba(251,255,243,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(132,204,22,0.16)]",
    gradeBadge: "border-lime-300 bg-lime-100 text-lime-800",
    glow: "bg-lime-200/75",
    divider: "border-lime-100/80",
  },
  yellow: {
    unlockedShell:
      "border-yellow-200/85 bg-[linear-gradient(180deg,_rgba(254,252,232,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(234,179,8,0.28)]",
    lockedShell:
      "border-yellow-100/80 bg-[linear-gradient(180deg,_rgba(255,254,246,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(234,179,8,0.18)]",
    gradeBadge: "border-yellow-300 bg-yellow-100 text-yellow-900",
    glow: "bg-yellow-200/80",
    divider: "border-yellow-100/80",
  },
  pink: {
    unlockedShell:
      "border-pink-200/80 bg-[linear-gradient(180deg,_rgba(253,242,248,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(236,72,153,0.26)]",
    lockedShell:
      "border-pink-100/80 bg-[linear-gradient(180deg,_rgba(255,247,251,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(236,72,153,0.16)]",
    gradeBadge: "border-pink-300 bg-pink-100 text-pink-700",
    glow: "bg-pink-200/75",
    divider: "border-pink-100/80",
  },
  fuchsia: {
    unlockedShell:
      "border-fuchsia-200/80 bg-[linear-gradient(180deg,_rgba(253,244,255,0.98),_rgba(255,255,255,0.96))] shadow-[0_22px_42px_-34px_rgba(217,70,239,0.26)]",
    lockedShell:
      "border-fuchsia-100/80 bg-[linear-gradient(180deg,_rgba(255,248,255,0.94),_rgba(255,255,255,0.92))] shadow-[0_18px_36px_-34px_rgba(217,70,239,0.16)]",
    gradeBadge: "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-700",
    glow: "bg-fuchsia-200/75",
    divider: "border-fuchsia-100/80",
  },
};

function getAccentClasses(tone = "slate") {
  return Object.prototype.hasOwnProperty.call(ACCENT_CLASS_MAP, tone)
    ? ACCENT_CLASS_MAP[tone]
    : ACCENT_CLASS_MAP.slate;
}

function buildLockedDescription(entry, hint) {
  if (entry?.requestStatus === "rejected" && entry?.reviewMessage) {
    return `${hint}\n\n반려 사유: ${entry.reviewMessage}`;
  }

  if (entry?.requestStatus === "pending" && entry?.requestMessage) {
    return `${hint}\n\n요청 메모: ${entry.requestMessage}`;
  }

  return hint;
}

export default function TitleDexEntryCard({
  entry,
  canEquipTitle,
  onEquip,
  isSubmitting,
  canRequest = false,
  onRequest = null,
  requestSubmitting = false,
  canSetNextTarget = false,
  onSetNextTarget = null,
  nextTargetSubmitting = false,
  isNextTarget = false,
  collectionStageTone = "slate",
  collectionStageColor = "",
  representativeCount = 0,
  maxRepresentativeCount = 3,
  formatDexNumber,
  formatDate,
  getTitleSurfaceTheme,
  getTitleRevealMeta,
  getTitleRequestStatusMeta,
  onEditDefinition = null,
}) {
  const isLocked = Boolean(entry?.locked);
  const theme = getTitleSurfaceTheme?.(entry) || {};
  const revealMeta = getTitleRevealMeta(entry);
  const requestStatusMeta = entry?.requestStatus
    ? getTitleRequestStatusMeta(entry.requestStatus)
    : null;

  const dexNumber = formatDexNumber(entry?.dexNumber);
  const gradeTone = entry?.gradeTone || theme.badgeTone || "slate";
  const gradeAccent = getAccentClasses(gradeTone);
  const collectionStageAccent = getAccentClasses(collectionStageTone);
  const collectionStageExactColor = getTitleCollectionStageToneColor(
    collectionStageTone,
    collectionStageColor,
  );

  const representativeActionDisabled =
    !entry?.equipped &&
    representativeCount >= maxRepresentativeCount &&
    !isSubmitting;

  const titleLabel = isLocked
    ? revealMeta.displayName
    : entry?.name || "이름 없는 칭호";
  const shouldConcealNameplate = isLocked && revealMeta.concealNameplate;
  const shouldMuteNameplate = isLocked && revealMeta.mutedNameplate;
  const shouldBlurName = isLocked && revealMeta.blurName;
  const shouldBlurHint = isLocked && revealMeta.blurHint;
  const nameplateLockVariant = shouldConcealNameplate
    ? "concealed"
    : shouldMuteNameplate
      ? "muted"
      : "default";
  const canEditDefinition =
    typeof onEditDefinition === "function" &&
    Boolean(entry?.definitionId || entry?.id) &&
    !entry?.missingDefinition;

  const detailText = isLocked
    ? buildLockedDescription(entry, revealMeta.displayHint)
    : entry?.description ||
      entry?.acquisitionCondition ||
      "획득 조건이 아직 등록되지 않은 칭호입니다.";

  const stateRailClass = isNextTarget
    ? "bg-amber-400"
    : entry?.equipped
      ? "bg-indigo-500"
      : "bg-slate-300";
  const stateTextClass = isNextTarget
    ? "text-amber-700"
    : entry?.equipped
      ? "text-indigo-700"
      : "text-slate-500";
  const statusLabel = isLocked
    ? isNextTarget
      ? "다음 목표 · 조건을 달성해 보세요"
      : entry?.requestStatus === "pending"
        ? requestStatusMeta?.label || "칭호 요청 접수됨"
        : "미획득 칭호"
    : entry?.equipped
      ? "대표 사용 중"
      : "대표 명패로 설정 가능";
  return (
    <article
      className={`relative flex min-h-[360px] flex-col overflow-hidden rounded-[26px] border px-4 py-4 sm:px-5 ${
        isLocked ? collectionStageAccent.lockedShell : collectionStageAccent.unlockedShell
      }`}
      style={
        collectionStageColor
          ? {
              borderColor: withAccentAlpha(collectionStageExactColor, 0.42),
              backgroundImage: `linear-gradient(180deg, ${withAccentAlpha(collectionStageExactColor, isLocked ? 0.055 : 0.09)}, rgba(255,255,255,0.96))`,
            }
          : undefined
      }
    >
      <div className={`absolute inset-x-0 top-0 h-1.5 ${stateRailClass}`} aria-hidden="true" />

      <div className="relative flex items-start justify-between gap-3 pt-1">
        <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
          No. {dexNumber}
        </span>
        {entry?.gradeLabel ? (
          <span
            className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-black tracking-[0.14em] ${gradeAccent.gradeBadge}`}
          >
            {entry.gradeLabel}
          </span>
        ) : null}
      </div>

      <div className="relative mt-3 flex flex-1 flex-col items-center">
        <div
          className="flex min-h-[120px] w-full items-center justify-center px-1 py-2"
          onClick={canEditDefinition ? () => onEditDefinition(entry) : undefined}
          onKeyDown={
            canEditDefinition
              ? (event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onEditDefinition(entry);
                }
              : undefined
          }
          role={canEditDefinition ? "button" : undefined}
          tabIndex={canEditDefinition ? 0 : undefined}
          aria-label={
            canEditDefinition
              ? `${entry?.name || titleLabel} 칭호 정의 수정`
              : undefined
          }
        >
          <TitleNameplatePreview
            preserveDesignScale
            label={titleLabel}
            version={entry?.version}
            familyId={entry?.familyId || "plaque"}
            paletteId={entry?.paletteId || "sky"}
            trimPaletteId={entry?.trimPaletteId || "match"}
            ornamentSetId={entry?.ornamentSetId || "none"}
            iconId={entry?.iconId || entry?.icon || "none"}
            fontStyleId={entry?.fontStyleId || "basic"}
            textScale={entry?.textScale ?? 100}
            textOffsetY={entry?.textOffsetY ?? 0}
            textColorMode={entry?.textColorMode || "auto"}
            customTextColor={entry?.customTextColor || ""}
            customFrameColor={entry?.customFrameColor || ""}
            customBannerColor={entry?.customBannerColor || ""}
            customTrimColor={entry?.customTrimColor || ""}
            topDecoId={entry?.topDecoId || "none"}
            sideDecoId={entry?.sideDecoId || "none"}
            bottomDecoId={entry?.bottomDecoId || "none"}
            patternId={entry?.patternId || "none"}
            effectId={entry?.effectId || "none"}
            locked={nameplateLockVariant === "concealed"}
            lockVariant={nameplateLockVariant}
            blurLabel={shouldBlurName}
            detailLevel="compact"
          />
        </div>

        <div className="w-full text-center">
          <p
            className={`text-lg font-black tracking-tight ${
              isLocked && revealMeta.hideName ? "text-slate-400" : "text-slate-950"
            }`}
            style={
              shouldBlurName
                ? { filter: "blur(4px)", userSelect: "none" }
                : undefined
            }
          >
            {titleLabel}
          </p>
          <p
            className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500"
            style={
              shouldBlurHint
                ? { filter: "blur(3.4px)", userSelect: "none" }
                : undefined
            }
          >
            {detailText}
          </p>
        </div>
      </div>

      <div className={`relative mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 ${gradeAccent.divider}`}>
        <div className={`min-w-0 flex flex-1 items-center gap-2 text-sm font-semibold ${stateTextClass}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${stateRailClass}`} aria-hidden="true" />
          <span className="truncate">{statusLabel}</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
          {canSetNextTarget && !isNextTarget ? (
            <button
              type="button"
              onClick={() => onSetNextTarget(entry)}
              disabled={nextTargetSubmitting}
              className="text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-4 transition hover:text-amber-700"
            >
              다음 목표로 설정
            </button>
          ) : null}

          {canRequest && onRequest ? (
            <Button
              size="sm"
              tone="indigo"
              variant={entry?.requestStatus === "pending" ? "secondary" : "outline"}
              onClick={() => onRequest(entry)}
              disabled={requestSubmitting || entry?.requestStatus === "pending"}
              icon={Send}
            >
              {entry?.requestStatus === "pending"
                ? "요청 접수됨"
                : entry?.requestStatus === "rejected"
                  ? "다시 요청"
                  : "칭호 요청"}
            </Button>
          ) : null}

          {!isLocked && canEquipTitle ? (
            <Button
              size="sm"
              variant={entry.equipped ? "secondary" : "primary"}
              tone="indigo"
              icon={Sparkles}
              onClick={() => onEquip(entry)}
              disabled={isSubmitting || representativeActionDisabled}
            >
              {entry.equipped
                ? "대표 해제"
                : representativeActionDisabled
                  ? `대표 ${maxRepresentativeCount}개 사용 중`
                  : "대표로 설정"}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
