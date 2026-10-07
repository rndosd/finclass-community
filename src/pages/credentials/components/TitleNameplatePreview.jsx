import { useId, useLayoutEffect, useRef, useState } from "react";

import { getTitleFrameAsset } from "../../../assets/titles/v2/titleAssetRegistry";
import { resolveTitleAppearance } from "../../../assets/titles/v3/titleAppearanceRegistry";
import {
  getTitleStyleIcon,
  getTitleStyleFontOption,
  getTitleStylePaletteSpec,
  getTitleStyleTrimSpec,
  normalizeTitleStyle,
} from "../titleStyleOptions";

function buildDefs(id, palette, trim, detailLevel = "full") {
  const isCompact = detailLevel === "compact";
  const isMini = detailLevel === "mini";
  const shadowDy = isMini ? 2 : isCompact ? 4 : 6;
  const shadowBlur = isMini ? 1.8 : isCompact ? 3.4 : 5.2;
  const shadowOpacity = isMini ? 0.18 : isCompact ? 0.26 : 0.34;

  return (
    <defs>
      <linearGradient id={`${id}-frame`} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={palette.outerStart} />
        <stop offset="28%" stopColor={palette.outerMid} />
        <stop offset="54%" stopColor={palette.sparkle} stopOpacity="0.24" />
        <stop offset="72%" stopColor={palette.outerMid} />
        <stop offset="100%" stopColor={palette.outerEnd} />
      </linearGradient>
      <linearGradient id={`${id}-banner`} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor={palette.bannerStart} />
        <stop offset="24%" stopColor={palette.bannerMid} />
        <stop offset="50%" stopColor={palette.bannerHighlight} stopOpacity="0.2" />
        <stop offset="76%" stopColor={palette.bannerMid} />
        <stop offset="100%" stopColor={palette.bannerEnd} />
      </linearGradient>
      <linearGradient
        id={`${id}-banner-soft`}
        x1="0%"
        y1="0%"
        x2="0%"
        y2="100%"
      >
        <stop offset="0%" stopColor={palette.sparkle} stopOpacity="0.82" />
        <stop offset="38%" stopColor={palette.bannerHighlight} stopOpacity="0.3" />
        <stop offset="72%" stopColor={palette.bannerHighlight} stopOpacity="0.06" />
        <stop offset="100%" stopColor={palette.bannerEnd} stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-trim`} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor={trim.edge} />
        <stop offset="18%" stopColor={trim.dark} />
        <stop offset="43%" stopColor={trim.mid} />
        <stop offset="50%" stopColor={trim.light} />
        <stop offset="57%" stopColor={trim.mid} />
        <stop offset="82%" stopColor={trim.dark} />
        <stop offset="100%" stopColor={trim.edge} />
      </linearGradient>
      <linearGradient id={`${id}-trim-soft`} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor={trim.light} />
        <stop offset="46%" stopColor={trim.mid} />
        <stop offset="100%" stopColor={trim.capDark} />
      </linearGradient>
      <radialGradient id={`${id}-gem`} cx="31%" cy="25%" r="76%">
        <stop offset="0%" stopColor={palette.sparkle} stopOpacity="0.98" />
        <stop offset="14%" stopColor={palette.gemLight} />
        <stop offset="56%" stopColor={palette.gemDark} />
        <stop offset="82%" stopColor={palette.outerEnd} />
        <stop offset="100%" stopColor={palette.deepStroke} />
      </radialGradient>
      <linearGradient id={`${id}-shine`} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={palette.sparkle} stopOpacity="0.26" />
        <stop offset="24%" stopColor={palette.sparkle} stopOpacity="0.9" />
        <stop offset="58%" stopColor={palette.sparkle} stopOpacity="0.22" />
        <stop offset="100%" stopColor={palette.sparkle} stopOpacity="0" />
      </linearGradient>
      <filter id={`${id}-shadow`} x="-30%" y="-35%" width="160%" height="220%">
        <feDropShadow
          in="SourceAlpha"
          dx="0"
          dy={shadowDy}
          stdDeviation={shadowBlur}
          floodColor={trim.shadow}
          floodOpacity={shadowOpacity}
          result="ambientShadow"
        />
        <feDropShadow
          in="SourceAlpha"
          dx="0"
          dy="1.25"
          stdDeviation="0.9"
          floodColor={palette.deepStroke}
          floodOpacity="0.18"
          result="contactShadow"
        />
        <feMerge>
          <feMergeNode in="ambientShadow" />
          <feMergeNode in="contactShadow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={isMini ? 2 : isCompact ? 4 : 7} />
      </filter>
    </defs>
  );
}

const DETAIL_LEVELS = new Set(["full", "compact", "mini"]);

function getDetailLevel(detailLevel, compact) {
  if (DETAIL_LEVELS.has(detailLevel)) return detailLevel;
  return compact ? "compact" : "full";
}

function getWrapClass(detailLevel) {
  if (detailLevel === "mini") return "max-w-[210px]";
  if (detailLevel === "compact") return "max-w-[280px]";
  return "max-w-[360px]";
}

function getLabelMetrics(compact, label = "", fitMode = "default", fontStyleId = "basic") {
  const length = Array.from(String(label || "").trim()).length;
  const isTightFit = fitMode === "tight";
  const metalLetterSpacing = compact ? "-0.045em" : "-0.035em";
  const isMetalEngraved = getTitleStyleFontOption(fontStyleId).supportsCustomTextColor === false;
  const withMetalSpacing = (metrics) =>
    isMetalEngraved ? { ...metrics, letterSpacing: metalLetterSpacing } : metrics;

  if (compact) {
    if (isTightFit) {
      if (length >= 13) {
        return withMetalSpacing({ fontSize: 9, letterSpacing: "-0.025em" });
      }
      if (length >= 10) {
        return withMetalSpacing({ fontSize: 10, letterSpacing: "-0.015em" });
      }
      if (length >= 8) {
        return withMetalSpacing({ fontSize: 11, letterSpacing: "0" });
      }
      return withMetalSpacing({ fontSize: 13, letterSpacing: "0.015em" });
    }

    if (length >= 15) {
      return withMetalSpacing({ fontSize: 10, letterSpacing: "-0.02em" });
    }
    if (length >= 11) {
      return withMetalSpacing({ fontSize: 12, letterSpacing: "0.01em" });
    }
    return withMetalSpacing({ fontSize: 14, letterSpacing: "0.025em" });
  }

  if (length >= 15) {
    return withMetalSpacing({ fontSize: 13, letterSpacing: "-0.02em" });
  }
  if (length >= 11) {
    return withMetalSpacing({ fontSize: 15, letterSpacing: "0.01em" });
  }
  return withMetalSpacing({ fontSize: 17, letterSpacing: "0.03em" });
}

const NAMEPLATE_LAYOUTS = {
  plaque: { labelLeft: "16%", labelRight: "16%", labelTop: "48%", badgeLeft: "50%", badgeTop: "20%" },
  wing: { labelLeft: "19%", labelRight: "19%", labelTop: "48%", badgeLeft: "50%", badgeTop: "20%" },
  scroll: { labelLeft: "18%", labelRight: "18%", labelTop: "51%", badgeLeft: "50%", badgeTop: "19%" },
  jewel: { labelLeft: "17%", labelRight: "17%", labelTop: "48%", badgeLeft: "50%", badgeTop: "20%" },
  ticket: { labelLeft: "17%", labelRight: "17%", labelTop: "50%", badgeLeft: "50%", badgeTop: "20%" },
  blossom: { labelLeft: "17%", labelRight: "17%", labelTop: "49%", badgeLeft: "50%", badgeTop: "20%" },
  shield: { labelLeft: "18%", labelRight: "18%", labelTop: "49%", badgeLeft: "50%", badgeTop: "20%" },
  arc: { labelLeft: "19%", labelRight: "19%", labelTop: "57%", badgeLeft: "50%", badgeTop: "20%" },
  marquee: { labelLeft: "17%", labelRight: "17%", labelTop: "48%", badgeLeft: "50%", badgeTop: "20%" },
  seal: { labelLeft: "19%", labelRight: "19%", labelTop: "69.5%", centerBadgeTop: "19%" },
};
function toRgba(hex, alpha) {
  if (!hex || typeof hex !== "string") {
    return `rgba(15,23,42,${alpha})`;
  }

  const value = hex.replace("#", "");
  if (![3, 6].includes(value.length)) {
    return `rgba(15,23,42,${alpha})`;
  }

  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : value;

  const int = Number.parseInt(normalized, 16);
  if (Number.isNaN(int)) {
    return `rgba(15,23,42,${alpha})`;
  }

  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getPerceivedLuminance(hex) {
  if (!hex || typeof hex !== "string") return 0.4;
  const value = hex.replace("#", "");
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : value;
  if (normalized.length !== 6) return 0.4;

  const int = Number.parseInt(normalized, 16);
  if (Number.isNaN(int)) return 0.4;

  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function getLabelStyle({
  palette,
  trim,
  compact,
  fontStyleId = "basic",
  textColorMode = "auto",
  customTextColor = "",
}) {
  const fontOption = getTitleStyleFontOption(fontStyleId);
  const isAutomaticPreset = fontOption.supportsCustomTextColor === false;
  const isOutlineStyle = fontOption.stylePreset === "outline";
  const stylePreset = fontOption.stylePreset || "basic";
  const luminance = getPerceivedLuminance(palette?.bannerMid || palette?.bannerEnd);
  const useDarkText = luminance >= 0.62;
  const hasCustomTextColor = textColorMode === "custom" && Boolean(customTextColor);
  const fillColor = hasCustomTextColor
    ? customTextColor
    : useDarkText
      ? palette?.deepStroke || trim?.edge || "#0f172a"
      : "#ffffff";
  const customTextIsLight = hasCustomTextColor && getPerceivedLuminance(fillColor) >= 0.62;
  const strokeColor = hasCustomTextColor
    ? customTextIsLight
      ? toRgba("#0f172a", 0.58)
      : toRgba("#ffffff", 0.82)
    : useDarkText
      ? toRgba("#ffffff", 0.78)
      : trim?.edge || palette?.deepStroke || "#1e293b";
  const insetGlow = hasCustomTextColor
    ? customTextIsLight
      ? toRgba("#0f172a", 0.2)
      : toRgba("#ffffff", 0.44)
    : useDarkText
      ? toRgba("#ffffff", 0.44)
      : palette?.bannerHighlight || "#ffffff";
  const automaticStyles = {
    metal: {
      top: trim?.light || "#ffffff",
      middle: useDarkText ? palette?.deepStroke || "#182235" : "#fffdf5",
      bottom: useDarkText ? trim?.dark || "#475569" : trim?.mid || "#cbd5e1",
      stroke: useDarkText ? "#ffffff" : "#07111f",
      glow: useDarkText ? "#ffffff" : trim?.light || "#ffffff",
      shadow: useDarkText ? trim?.dark || "#334155" : "#020617",
      fontFamily: '"Black Han Sans", "Noto Sans KR", "Malgun Gothic", sans-serif',
      fontWeight: 400,
      useGradient: true,
      strokeWidth: compact ? 1 : 1.3,
      shadowStyle: "metal",
    },
    crystal: {
      top: "#ffffff",
      middle: palette?.sparkle || "#c4f1ff",
      bottom: palette?.gemDark || palette?.deepStroke || "#2563eb",
      stroke: palette?.deepStroke || trim?.edge || "#1e3a8a",
      glow: palette?.bannerHighlight || "#dbeafe",
      shadow: palette?.gemDark || "#1e3a8a",
      fontFamily: '"Black Han Sans", "Noto Sans KR", "Malgun Gothic", sans-serif',
      fontWeight: 400,
      useGradient: true,
      strokeWidth: compact ? 0.8 : 1.05,
      shadowStyle: "crystal",
    },
    emboss: {
      color: useDarkText ? "#fffdf4" : palette?.deepStroke || "#1f2937",
      stroke: useDarkText ? trim?.dark || "#475569" : "#fffdf4",
      glow: useDarkText ? "#ffffff" : "#ffffff",
      shadow: useDarkText ? "#334155" : "#0f172a",
      fontFamily: '"Gowun Batang", "Noto Serif KR", serif',
      fontWeight: 700,
      useGradient: false,
      strokeWidth: compact ? 0.42 : 0.62,
      shadowStyle: "emboss",
    },
    stamp: {
      color: useDarkText ? "#172033" : "#fff8e7",
      stroke: useDarkText ? "#fff8e7" : "#172033",
      glow: useDarkText ? "#ffffff" : "#0f172a",
      shadow: useDarkText ? "#64748b" : "#020617",
      fontFamily: '"Black Han Sans", "Noto Sans KR", "Malgun Gothic", sans-serif',
      fontWeight: 400,
      useGradient: false,
      strokeWidth: compact ? 0.6 : 0.85,
      shadowStyle: "stamp",
    },
  };
  const automaticStyle = automaticStyles[stylePreset] || automaticStyles.metal;
  const automaticGradient = `linear-gradient(180deg, ${automaticStyle.top} 0%, ${automaticStyle.middle} 44%, ${
    automaticStyle.bottom
  } 100%)`;
  const automaticTextShadow =
    automaticStyle.shadowStyle === "neon"
      ? [
          `0 0 2px ${automaticStyle.glow}`,
          `0 0 5px ${toRgba(automaticStyle.glow, 0.78)}`,
          `0 2px 4px ${toRgba(automaticStyle.shadow, 0.48)}`,
        ].join(", ")
      : automaticStyle.shadowStyle === "emboss"
        ? [
            `0 1px 0 ${automaticStyle.glow}`,
            `0 2px 0 ${toRgba(automaticStyle.shadow, 0.62)}`,
            `0 4px 5px ${toRgba("#0f172a", 0.18)}`,
          ].join(", ")
        : automaticStyle.shadowStyle === "stamp"
          ? `0 2px 0 ${toRgba(automaticStyle.shadow, 0.72)}, 0 4px 5px ${toRgba("#0f172a", 0.2)}`
          : [
              `0 1px 0 ${automaticStyle.glow}`,
              `0 2px 0 ${toRgba(automaticStyle.shadow, 0.56)}`,
              `0 4px 6px ${toRgba("#0f172a", 0.28)}`,
            ].join(", ");

  return {
    color:
      isAutomaticPreset && !hasCustomTextColor
        ? automaticStyle.useGradient
          ? "transparent"
          : automaticStyle.color
        : fillColor,
    backgroundImage:
      isAutomaticPreset && !hasCustomTextColor && automaticStyle.useGradient
        ? automaticGradient
        : undefined,
    WebkitBackgroundClip:
      isAutomaticPreset && !hasCustomTextColor && automaticStyle.useGradient ? "text" : undefined,
    WebkitTextFillColor:
      isAutomaticPreset && !hasCustomTextColor && automaticStyle.useGradient ? "transparent" : undefined,
    fontFamily:
      isAutomaticPreset
        ? automaticStyle.fontFamily
        : isOutlineStyle
          ? '"Do Hyeon", "Noto Sans KR", "Malgun Gothic", sans-serif'
        : '"Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif',
    fontWeight: isAutomaticPreset ? automaticStyle.fontWeight : isOutlineStyle ? 400 : 800,
    WebkitTextStroke: `${
      isAutomaticPreset ? automaticStyle.strokeWidth : isOutlineStyle ? (compact ? 0.9 : 1.2) : compact ? 0.65 : 0.85
    }px ${isAutomaticPreset ? automaticStyle.stroke : strokeColor
    }`,
    paintOrder: "stroke fill",
    textShadow: isAutomaticPreset
      ? automaticTextShadow
      : isOutlineStyle
        ? `0 1px 0 ${insetGlow}, 0 3px 0 ${toRgba(strokeColor, 0.56)}, 0 5px 7px ${toRgba("#0f172a", 0.22)}`
      : [
          `0 1px 0 ${typeof insetGlow === "string" ? insetGlow : toRgba("#ffffff", 0.28)}`,
          `0 3px 5px ${useDarkText ? toRgba("#0f172a", 0.14) : toRgba(strokeColor, 0.2)}`,
        ].join(", "),
  };
}

function getNameplateLayout(familyId = "plaque") {
  return NAMEPLATE_LAYOUTS[familyId] || NAMEPLATE_LAYOUTS.plaque;
}

function SideBadge({ Icon, trim, className = "" }) {
  if (!Icon) return null;

  return (
    <span
      className={`flex h-9 w-9 items-center justify-center rounded-full border shadow-[0_5px_14px_rgba(15,23,42,0.12)] ${className}`}
      style={{
        background: trim.badgeFill,
        borderColor: trim.badgeStroke,
        color: trim.badgeText,
      }}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function InlineEmblem({ Icon, palette, trim, layout, compact, familyId }) {
  if (!Icon) return null;

  const sizeByFamily = {
    plaque: compact ? 30 : 36,
    wing: compact ? 32 : 38,
    scroll: compact ? 32 : 38,
    jewel: compact ? 32 : 40,
    ticket: compact ? 30 : 36,
    blossom: compact ? 32 : 40,
    shield: compact ? 32 : 38,
    arc: compact ? 32 : 38,
    marquee: compact ? 32 : 38,
  };

  const size = sizeByFamily[familyId] || (compact ? 30 : 36);
  const iconSize = Math.round(size * 0.46);
  const borderRadius =
    familyId === "scroll"
      ? "18px"
      : familyId === "ticket"
        ? "16px"
        : familyId === "wing"
          ? "20px"
          : familyId === "shield"
            ? "18px"
            : familyId === "arc"
              ? "18px"
          : "999px";

  return (
    <span
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: layout.badgeLeft || "10%",
        top: layout.badgeTop || layout.labelTop,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius,
        background: `radial-gradient(circle at 35% 30%, ${toRgba(
          palette.bannerHighlight || "#ffffff",
          0.46,
        )} 0%, ${toRgba(trim.badgeFill || "#ffffff", 0.26)} 44%, ${toRgba(
          palette.bannerMid || "#ffffff",
          0.08,
        )} 100%)`,
        border: `1px solid ${toRgba(trim.badgeStroke || trim.edge || "#cbd5e1", 0.36)}`,
        boxShadow: [
          `inset 0 1px 0 ${toRgba("#ffffff", 0.72)}`,
          `0 10px 18px ${toRgba(trim.shadow || "#0f172a", 0.08)}`,
        ].join(", "),
        backdropFilter: "blur(3px)",
        opacity: 0.82,
      }}
    >
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{
          color: toRgba(trim.badgeText || trim.edge || "#475569", 0.58),
          textShadow: `0 1px 0 ${toRgba("#ffffff", 0.36)}`,
        }}
      >
        <Icon
          style={{
            width: `${iconSize}px`,
            height: `${iconSize}px`,
            strokeWidth: compact ? 2.1 : 1.9,
          }}
        />
      </span>
    </span>
  );
}

// Scale the editor's entire 360px canvas, including text strokes and shadows.
export default function TitleNameplatePreview({ preserveDesignScale = false, ...props }) {
  const viewportRef = useRef(null);
  const [width, setWidth] = useState(360);
  useLayoutEffect(() => {
    if (!preserveDesignScale || !viewportRef.current) return undefined;
    const viewport = viewportRef.current;
    const updateWidth = () => setWidth(viewport.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [preserveDesignScale]);

  if (!preserveDesignScale) return <TitleNameplateCanvas {...props} />;
  return (
    <div
      ref={viewportRef}
      className={[
        "relative mx-auto w-full",
        getWrapClass(getDetailLevel(props.detailLevel, props.compact)),
      ].join(" ")}
      style={{ aspectRatio: "320 / 156" }}
      data-title-design-viewport=""
    >
      <div
        style={{
          width: 360,
          position: "absolute",
          top: 0,
          left: 0,
          transformOrigin: "top left",
          transform: `scale(${width / 360})`,
        }}
      >
        <TitleNameplateCanvas
          {...props}
          compact={false}
          detailLevel="full"
          labelFit="default"
          scaleLabelWithContainer={false}
          cropToFrame={false}
        />
      </div>
    </div>
  );
}

function TitleNameplateCanvas({
  label,
  familyId = "plaque",
  version,
  paletteId = "sky",
  trimPaletteId = "match",
  ornamentSetId = "none",
  iconId = "none",
  fontStyleId = "basic",
  textScale = 100,
  textOffsetY = 0,
  textColorMode = "auto",
  customTextColor = "",
  customFrameColor = "",
  customBannerColor = "",
  customTrimColor = "",
  topDecoId = "none",
  sideDecoId = "none",
  bottomDecoId = "none",
  patternId = "none",
  effectId = "none",
  locked = false,
  lockVariant = "default",
  blurLabel = false,
  compact = false,
  detailLevel = "",
  labelFit = "default",
  showLabel = true,
  showIconBadges = false,
  scaleLabelWithContainer = false,
  cropToFrame = false,
}) {
  const instanceId = useId().replace(/:/g, "");
  const style = normalizeTitleStyle({
    familyId,
    paletteId,
    trimPaletteId,
    ...(version === undefined ? {} : { version }),
    ...(ornamentSetId === "none" ? {} : { ornamentSetId }),
    icon: iconId,
    fontStyleId,
    textScale,
    textOffsetY,
    textColorMode,
    customTextColor,
    customFrameColor,
    customBannerColor,
    customTrimColor,
    topDecoId,
    sideDecoId,
    bottomDecoId,
    patternId,
    effectId,
  });
  const palette = getTitleStylePaletteSpec(style.paletteId, style);
  const trim = getTitleStyleTrimSpec(style.trimPaletteId, style.paletteId, style);
  const Icon = getTitleStyleIcon(style.icon);
  const resolvedDetailLevel = getDetailLevel(detailLevel, compact);
  const isMini = resolvedDetailLevel === "mini";
  const layerOpacity = isMini ? 0.74 : resolvedDetailLevel === "compact" ? 0.88 : 1;
  const wrapClass = getWrapClass(resolvedDetailLevel);
  const labelStyle = getLabelStyle({
    palette,
    trim,
    compact,
    fontStyleId: style.fontStyleId,
    textColorMode: style.textColorMode,
    customTextColor: style.customTextColor,
  });
  const staticAppearance = resolveTitleAppearance(style);
  const frameAsset = staticAppearance?.base || getTitleFrameAsset(style);
  const canCropToFrame =
    cropToFrame &&
    Number.isFinite(frameAsset?.y) &&
    Number.isFinite(frameAsset?.width) &&
    Number.isFinite(frameAsset?.height) &&
    frameAsset.height > 0;
  const croppedFrameViewportStyle = canCropToFrame
    ? {
        aspectRatio: `${frameAsset.width} / ${frameAsset.height}`,
      }
    : undefined;
  const croppedFrameCanvasStyle = canCropToFrame
    ? {
        top: `-${((frameAsset.y || 0) / frameAsset.height) * 100}%`,
      }
    : undefined;
  const layout = {
    ...getNameplateLayout(style.familyId),
    ...(frameAsset?.layout || {}),
  };

  const isConcealed = locked || lockVariant === "concealed";
  const isMutedLocked = !isConcealed && lockVariant === "muted";
  const effectiveShowLabel = !isConcealed && showLabel;
  const hasIcon = Boolean(Icon);
  const effectiveShowIconBadges = !isConcealed && showIconBadges && hasIcon;
  // Baked 2.5D frames have a tighter inner banner than the flexible SVG
  // fallback, so long titles use the compact fitting scale automatically.
  const resolvedLabelFit = frameAsset && labelFit === "default" ? "tight" : labelFit;
  const labelMetrics = getLabelMetrics(
    compact || isMini,
    label,
    resolvedLabelFit,
    style.fontStyleId,
  );
  const labelScale = style.textScale / 100;
  const scaledLabelFontSize = scaleLabelWithContainer
    ? `clamp(${Math.round(labelMetrics.fontSize * labelScale * 0.72)}px, ${(
        (labelMetrics.fontSize * labelScale) / 3.6
      ).toFixed(3)}cqw, ${Math.round(labelMetrics.fontSize * labelScale * 1.8)}px)`
    : `${Math.round(labelMetrics.fontSize * labelScale)}px`;
  const labelPositionOffset = `${style.textOffsetY}%`;
  const labelTop =
    labelPositionOffset === "0%"
      ? layout.labelTop
      : `calc(${layout.labelTop} + ${labelPositionOffset})`;
  const rearOrnamentLayers = staticAppearance?.layers.filter((layer) => layer.layer === "rear") || [];
  const frontOrnamentLayers = staticAppearance?.layers.filter((layer) => layer.layer !== "rear") || [];

  return (
    <div
      className={`relative mx-auto w-full ${wrapClass} ${canCropToFrame ? "overflow-hidden" : ""}`}
      data-title-renderer={frameAsset?.renderer || "svg-fallback"}
      style={{
        ...(scaleLabelWithContainer ? { containerType: "inline-size" } : {}),
        ...croppedFrameViewportStyle,
      }}
    >
      <div
        className={canCropToFrame ? "absolute inset-x-0" : "relative w-full"}
        style={croppedFrameCanvasStyle}
      >
      <svg
        viewBox="0 0 320 156"
        preserveAspectRatio="xMidYMid meet"
        shapeRendering="geometricPrecision"
        aria-hidden="true"
        focusable="false"
        className="w-full overflow-visible"
        style={
          isConcealed
            ? {
                filter: "grayscale(1) saturate(0) brightness(0) contrast(1.8)",
                opacity: 0.98,
              }
            : isMutedLocked
              ? {
                  filter: "grayscale(0.82) saturate(0.4) brightness(0.96)",
                  opacity: 0.8,
                }
            : undefined
        }
      >
        {buildDefs(instanceId, palette, trim, resolvedDetailLevel)}
        <g
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ paintOrder: "stroke fill" }}
        >
          {rearOrnamentLayers.length ? (
            <g opacity={layerOpacity}>
              {rearOrnamentLayers.map((layer) => (
                <image
                  key={layer.id}
                  href={layer.src}
                  x={layer.x}
                  y={layer.y}
                  width={layer.width}
                  height={layer.height}
                  preserveAspectRatio="xMidYMid meet"
                />
              ))}
            </g>
          ) : null}
          {frameAsset ? (
            <>
              <image
                href={frameAsset.src}
                x={frameAsset.x}
                y={frameAsset.y}
                width={frameAsset.width}
                height={frameAsset.height}
                preserveAspectRatio="xMidYMid meet"
                style={{ filter: frameAsset.filter }}
              />
            </>
          ) : null}
          {frontOrnamentLayers.length ? (
            <g opacity={layerOpacity}>
              {frontOrnamentLayers.map((layer) => (
                <image
                  key={layer.id}
                  href={layer.src}
                  x={layer.x}
                  y={layer.y}
                  width={layer.width}
                  height={layer.height}
                  preserveAspectRatio="xMidYMid meet"
                />
              ))}
            </g>
          ) : null}
        </g>
      </svg>

      {isConcealed ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={`select-none font-black text-white ${compact ? "text-3xl" : "text-4xl"}`}
            style={{ textShadow: "0 4px 12px rgba(15,23,42,0.55)" }}
          >
            ?
          </span>
        </div>
      ) : isMutedLocked ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className={`rounded-full bg-slate-950/65 px-3 py-1 text-white shadow-[0_8px_24px_rgba(15,23,42,0.28)] ${
              compact ? "text-lg" : "text-xl"
            }`}
          >
            ?
          </span>
        </div>
      ) : style.familyId === "seal" ? (
        <>
          {effectiveShowIconBadges ? (
            <span
              className="absolute left-1/2 -translate-x-1/2"
              style={{ top: layout.centerBadgeTop || "18%" }}
            >
              <SideBadge Icon={Icon} trim={trim} className="h-10 w-10" />
            </span>
          ) : null}
          {effectiveShowLabel ? (
            <div
              className="absolute -translate-y-1/2"
              style={{
                left: layout.labelLeft,
                right: layout.labelRight,
                top: labelTop,
              }}
            >
              <p
                className="w-full overflow-hidden whitespace-nowrap px-2 text-center font-extrabold leading-none"
                style={{
                  ...labelStyle,
                  fontSize: scaledLabelFontSize,
                  letterSpacing: labelMetrics.letterSpacing,
                  filter: blurLabel ? "blur(3.6px)" : undefined,
                  opacity: blurLabel ? 0.96 : undefined,
                }}
              >
                {label}
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {effectiveShowIconBadges ? (
            <InlineEmblem
              Icon={Icon}
              palette={palette}
              trim={trim}
              layout={layout}
              compact={compact}
              familyId={style.familyId}
            />
          ) : null}
          {effectiveShowLabel ? (
            <div
              className="absolute -translate-y-1/2"
              style={{
                left: layout.labelLeft,
                right: layout.labelRight,
                top: labelTop,
              }}
            >
              <p
                className="w-full overflow-hidden whitespace-nowrap px-2 text-center font-extrabold leading-none"
                style={{
                  ...labelStyle,
                  fontSize: scaledLabelFontSize,
                  letterSpacing: labelMetrics.letterSpacing,
                  filter: blurLabel ? "blur(3.6px)" : undefined,
                  opacity: blurLabel ? 0.96 : undefined,
                }}
              >
                {label}
              </p>
            </div>
          ) : null}
        </>
      )}
      </div>
    </div>
  );
}
