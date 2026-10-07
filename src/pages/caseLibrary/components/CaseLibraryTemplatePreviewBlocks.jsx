import React from "react";
import TitleNameplatePreview from "../../credentials/components/TitleNameplatePreview";

export function CaseLibraryTemplateHighlightGrid({ highlights = [] }) {
  if (!highlights.length) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {highlights.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {item.label}
          </p>
          <p className="mt-1 text-base font-black text-slate-900">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function CaseLibraryTemplateCompactList({ items = [] }) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item, index) => (
        <div
          key={`${item.title}-${index}`}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
        >
          <p className="text-sm font-bold text-slate-900">{item.title}</p>
          {item.meta ? (
            <p className="mt-1 text-xs leading-5 text-slate-500">{item.meta}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function NameplatePreviewCard({ item }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
      <div className="rounded-[20px] border border-slate-100 bg-white px-3 py-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
        <TitleNameplatePreview
          label={item.name}
          version={item.version}
          familyId={item.familyId || "plaque"}
          paletteId={item.paletteId || "sky"}
          trimPaletteId={item.trimPaletteId || "match"}
          ornamentSetId={item.ornamentSetId || "none"}
          iconId={item.iconId || "award"}
          fontStyleId={item.fontStyleId || "basic"}
          textScale={item.textScale ?? 100}
          textOffsetY={item.textOffsetY ?? 0}
          textColorMode={item.textColorMode || "auto"}
          customTextColor={item.customTextColor || ""}
          customFrameColor={item.customFrameColor || ""}
          customBannerColor={item.customBannerColor || ""}
          customTrimColor={item.customTrimColor || ""}
          topDecoId={item.topDecoId || "none"}
          sideDecoId={item.sideDecoId || "none"}
          bottomDecoId={item.bottomDecoId || "none"}
          patternId={item.patternId || "none"}
          effectId={item.effectId || "none"}
          compact
          labelFit="tight"
          showIconBadges={false}
        />
      </div>

      {item.familyLabel || item.gradeLabel || item.categoryLabel ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.familyLabel ? (
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {item.familyLabel}
            </span>
          ) : null}
          {item.gradeLabel ? (
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {item.gradeLabel}
            </span>
          ) : null}
          {item.categoryLabel ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              {item.categoryLabel}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CaseLibraryTemplateVisualBlock({
  visual,
  maxItems = 4,
  titleClassName = "",
}) {
  if (!visual?.items?.length) {
    return null;
  }

  const visibleItems = visual.items.slice(0, maxItems);

  if (visual.type === "nameplates") {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-5">
        <div className="space-y-1">
          {visual.title ? (
            <p className={`text-sm font-black text-slate-900 ${titleClassName}`}>
              {visual.title}
            </p>
          ) : null}
          {visual.description ? (
            <p className="text-xs leading-5 text-slate-500">{visual.description}</p>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {visibleItems.map((item, index) => (
            <NameplatePreviewCard
              key={`${item.id || item.name}-${index}`}
              item={item}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export function CaseLibraryTemplateDetailSections({ sections = [] }) {
  const visibleSections = sections.filter(
    (section) => Array.isArray(section?.items) && section.items.length > 0,
  );

  if (!visibleSections.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      {visibleSections.map((section) => (
        <div
          key={section.title}
          className="rounded-3xl border border-slate-200 bg-white p-5"
        >
          <p className="text-sm font-black text-slate-900">{section.title}</p>
          <div className="mt-3 space-y-2">
            {section.items.map((item, index) => (
              <div
                key={`${section.title}-${item.label}-${index}`}
                className="flex flex-wrap items-start justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3"
              >
                <span className="text-sm font-semibold text-slate-700">{item.label}</span>
                <span className="text-sm text-slate-500">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
