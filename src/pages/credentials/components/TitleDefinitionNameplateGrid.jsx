import { Pencil } from "lucide-react";

import { Badge, Button } from "../../../components/ui";
import TitleNameplatePreview from "./TitleNameplatePreview";

function isNoSelectionTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,label,select,textarea,svg,path,[role='button'],[data-no-selection='true']",
    ),
  );
}

export default function TitleDefinitionNameplateGrid({
  items,
  selectedDefinitionIds,
  onToggleSelection,
  onEdit,
  formatDexNumber,
  onItemMouseDown,
  onItemMouseEnter,
}) {
  const selectedIdSet = new Set(selectedDefinitionIds);

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const isSelected = selectedIdSet.has(item.id);

        return (
          <div
            key={item.id}
            onMouseDown={(event) => {
              if (event.button !== 0 || isNoSelectionTarget(event.target)) return;
              onItemMouseDown?.(item, event);
            }}
            onMouseEnter={() => onItemMouseEnter?.(item)}
            className={[
              "relative cursor-pointer select-none overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] p-5 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.2)] transition",
              isSelected
                ? "ring-2 ring-rose-300 ring-offset-2 ring-offset-white"
                : "hover:border-indigo-200 hover:shadow-[0_18px_42px_-30px_rgba(79,70,229,0.22)]",
            ].join(" ")}
          >
            <div className="absolute right-4 top-4 flex items-center gap-2">
              <label
                data-no-selection="true"
                className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/95 px-3 py-1.5 shadow-sm"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelection(item.id)}
                  aria-label={`${item.name} 선택`}
                  className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <span className="text-xs font-semibold text-slate-600">선택</span>
              </label>
            </div>

            <div className="flex min-h-[170px] items-center justify-center rounded-[24px] border border-slate-100 bg-white/80 px-4 py-6">
              <TitleNameplatePreview
                label={item?.name || "이름 없는 칭호"}
                version={item?.version}
                familyId={item?.familyId || "plaque"}
                paletteId={item?.paletteId || "sky"}
                trimPaletteId={item?.trimPaletteId || "match"}
                ornamentSetId={item?.ornamentSetId || "none"}
            iconId={item?.iconId || item?.icon || "none"}
            fontStyleId={item?.fontStyleId || "basic"}
            textScale={item?.textScale ?? 100}
            textOffsetY={item?.textOffsetY ?? 0}
            textColorMode={item?.textColorMode || "auto"}
            customTextColor={item?.customTextColor || ""}
            customFrameColor={item?.customFrameColor || ""}
                customBannerColor={item?.customBannerColor || ""}
                customTrimColor={item?.customTrimColor || ""}
                topDecoId={item?.topDecoId || "none"}
                sideDecoId={item?.sideDecoId || "none"}
                bottomDecoId={item?.bottomDecoId || "none"}
                patternId={item?.patternId || "none"}
                effectId={item?.effectId || "none"}
              />
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone="slate">No. {formatDexNumber(item.displayOrder)}</Badge>
                {item?.gradeLabel ? (
                  <Badge tone={item.gradeTone || "slate"}>{item.gradeLabel}</Badge>
                ) : null}
                {item?.categoryLabel ? (
                  <Badge tone="blue">{item.categoryLabel}</Badge>
                ) : null}
                <Badge tone={item.allowStudentRequest !== false ? "indigo" : "slate"}>
                  {item.allowStudentRequest !== false ? "요청 허용" : "요청 잠금"}
                </Badge>
                <Badge tone={item.isVisible === false ? "amber" : "blue"}>
                  {item.isVisible === false ? "도감 숨김" : "도감 노출"}
                </Badge>
              </div>

              <div>
                <p className="text-base font-black text-slate-900">{item.name}</p>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">
                  {item.acquisitionCondition || "획득 조건이 아직 등록되지 않았습니다."}
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  tone="slate"
                  icon={Pencil}
                  data-no-selection="true"
                  onClick={() => onEdit?.(item)}
                  aria-label={`${item.name} 수정`}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
