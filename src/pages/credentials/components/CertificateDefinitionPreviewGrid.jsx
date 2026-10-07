import { Pencil } from "lucide-react";

import { Badge, Button } from "../../../components/ui";
import { CERTIFICATE_TEMPLATE_OPTIONS } from "../certificateStyleOptions";
import TitleCategoryBadge from "./TitleCategoryBadge";

const ISSUE_METHOD_LABELS = {
  manual: "수동 발급",
  assignment: "과제 충족",
  exam: "시험 충족",
  project: "프로젝트 충족",
};

function getTemplateLabel(value) {
  return (
    CERTIFICATE_TEMPLATE_OPTIONS.find((item) => item.value === value)?.label ||
    "라이선스 카드"
  );
}

function isNoSelectionTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,label,select,textarea,svg,path,[role='button'],[data-no-selection='true']",
    ),
  );
}

export default function CertificateDefinitionPreviewGrid({
  items,
  selectedDefinitionIds,
  onToggleSelection,
  onEdit,
  formatDexNumber,
}) {
  const selectedIdSet = new Set(selectedDefinitionIds);

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const isSelected = selectedIdSet.has(item.id);

        return (
          <div
            key={item.id}
            onClick={(event) => {
              if (isNoSelectionTarget(event.target)) return;
              onToggleSelection(item.id);
            }}
            className={[
              "relative cursor-pointer select-none overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] p-5 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.2)] transition",
              isSelected
                ? "ring-2 ring-sky-300 ring-offset-2 ring-offset-white"
                : "hover:border-sky-200 hover:shadow-[0_18px_42px_-30px_rgba(14,165,233,0.22)]",
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
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-xs font-semibold text-slate-600">선택</span>
              </label>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="slate">No. {formatDexNumber(item.displayOrder)}</Badge>
                  {item.gradeLabel ? (
                    <Badge tone={item.gradeTone || "slate"}>{item.gradeLabel}</Badge>
                  ) : null}
                </div>
                <Badge tone="indigo">{getTemplateLabel(item.templateId)}</Badge>
              </div>

              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                  Certificate
                </p>
                <p className="mt-2 text-xl font-black tracking-tight text-slate-950">
                  {item.name || "이름 없는 자격증"}
                </p>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                  {item.description || "학생에게 보여 줄 자격증 설명이 아직 없습니다."}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {item.categoryLabel ? (
                  <TitleCategoryBadge
                    label={item.categoryLabel}
                    iconKey={item.categoryIconKey}
                    colorKey={item.categoryColorKey}
                    size="sm"
                  />
                ) : null}
                <Badge tone="blue">
                  {ISSUE_METHOD_LABELS[item.issueMethod] ||
                    item.issueMethod ||
                    "수동 발급"}
                </Badge>
                <Badge tone={item.expiresEnabled ? "amber" : "slate"}>
                  {item.expiresEnabled ? "만료 사용" : "기한 없음"}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone={item.isVisible === false ? "amber" : "blue"}>
                  {item.isVisible === false ? "학생 숨김" : "학생 노출"}
                </Badge>
                <Badge tone={item.isActive === false ? "slate" : "emerald"}>
                  {item.isActive === false ? "발급 중지" : "발급 가능"}
                </Badge>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
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
        );
      })}
    </div>
  );
}
