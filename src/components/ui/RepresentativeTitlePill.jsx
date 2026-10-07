import TitleNameplatePreview from "../../pages/credentials/components/TitleNameplatePreview";

export default function RepresentativeTitlePill({
  item,
  className = "",
  variant = "default",
  extraCount = 0,
}) {
  if (!item?.name) return null;

  const equippedOrder = Number(item?.equippedOrder);
  const slotLabel =
    Number.isInteger(equippedOrder) && equippedOrder > 0
      ? `\uB300\uD45C ${equippedOrder}`
      : "\uB300\uD45C \uBA85\uD328";
  const previewProps = {
    label: item.name,
    version: item.version,
    familyId: item.familyId || "plaque",
    paletteId: item.paletteId || "sky",
    trimPaletteId: item.trimPaletteId || "match",
    ornamentSetId: item.ornamentSetId || "none",
    iconId: item.icon || item.iconId || "award",
    fontStyleId: item.fontStyleId || "basic",
    textScale: item.textScale ?? 100,
    textOffsetY: item.textOffsetY ?? 0,
    textColorMode: item.textColorMode || "auto",
    customTextColor: item.customTextColor || "",
    customFrameColor: item.customFrameColor || "",
    customBannerColor: item.customBannerColor || "",
    customTrimColor: item.customTrimColor || "",
    topDecoId: item.topDecoId || "none",
    sideDecoId: item.sideDecoId || "none",
    bottomDecoId: item.bottomDecoId || "none",
    patternId: item.patternId || "none",
    effectId: item.effectId || "none",
  };
  const canUseFrameCrop =
    previewProps.ornamentSetId === "none" &&
    previewProps.topDecoId === "none" &&
    previewProps.sideDecoId === "none" &&
    previewProps.bottomDecoId === "none";

  if (variant === "dashboard-mini") {
    return (
      <div className={["flex max-w-full items-center justify-center", className].join(" ")}>
        <div className="w-full max-w-[260px]">
          <TitleNameplatePreview
            preserveDesignScale
            {...previewProps}
            compact
            detailLevel="mini"
            labelFit="compact"
            cropToFrame={canUseFrameCrop}
          />
        </div>
      </div>
    );
  }

  if (variant === "dashboard") {
    return (
      <div
        className={[
          "flex max-w-full items-center justify-center py-1",
          className,
        ].join(" ")}
      >
        <div className="w-full max-w-[280px]">
          <TitleNameplatePreview
            preserveDesignScale
            {...previewProps}
            detailLevel="compact"
            scaleLabelWithContainer
            cropToFrame={canUseFrameCrop}
          />
        </div>

        {extraCount > 0 ? (
          <span className="shrink-0 text-sm font-semibold tracking-tight text-slate-500">
            +{extraCount}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={[
        "relative min-w-[180px] rounded-[22px] border border-white/80 bg-white/90 px-3 py-3 shadow-[0_12px_30px_rgba(148,163,184,0.16)]",
        className,
      ].join(" ")}
    >
      <span className="absolute left-3 top-3 rounded-full border border-slate-200 bg-white/95 px-2 py-0.5 text-[10px] font-black tracking-[0.16em] text-slate-500 shadow-sm">
        {slotLabel}
      </span>
      <div className="pt-4">
        <TitleNameplatePreview
          preserveDesignScale
          {...previewProps}
          compact
        />
      </div>
    </div>
  );
}
