import { Check } from "lucide-react";

import { Modal } from "../../../components/ui";
import { getTitleCollectionStageToneColor } from "../titleCollectionStageTones";
import {
  getTitleCollectionStageAssetByVisualStage,
  TITLE_COLLECTION_VISUAL_STAGE_COUNT,
} from "../titleCollectionStageVisuals";

function withAlpha(hex, alpha) {
  const normalized = String(hex || "").replace("#", "");
  if (normalized.length !== 6) return `rgba(100, 116, 139, ${alpha})`;
  const value = Number.parseInt(normalized, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export default function StudentTitleCollectionEmblemPickerModal({
  open,
  onClose,
  unlockedStage = 1,
  selectedStage = 1,
  tone = "slate",
  color = "",
  onSelect,
  isSubmitting = false,
}) {
  const accent = getTitleCollectionStageToneColor(tone, color);

  const handleSelect = async (stage) => {
    if (stage > unlockedStage || isSubmitting) return;
    const saved = await onSelect?.(stage);
    if (saved !== false) onClose?.();
  };

  return (
    <Modal open={open} onClose={onClose} title="내 도감 엠블럼 선택" size="lg">
      <div className="space-y-5">
        <div>
          <p className="text-sm font-black text-slate-900">
            해금한 엠블럼 중 하나를 선택하세요
          </p>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
            현재 단계와 이전 단계의 엠블럼을 자유롭게 사용할 수 있습니다.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {Array.from(
            { length: TITLE_COLLECTION_VISUAL_STAGE_COUNT },
            (_, index) => index + 1,
          ).map((stage) => {
            const isUnlocked = stage <= unlockedStage;
            const isSelected = isUnlocked && stage === selectedStage;

            return (
              <button
                key={stage}
                type="button"
                disabled={!isUnlocked || isSubmitting}
                onClick={() => handleSelect(stage)}
                aria-label={
                  isUnlocked
                    ? `엠블럼 ${stage}${isSelected ? ", 선택됨" : " 선택"}`
                    : `엠블럼 ${stage}, 미해금`
                }
                className={`relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-2xl border p-2 transition ${
                  isUnlocked
                    ? "bg-white hover:-translate-y-0.5 hover:shadow-md"
                    : "cursor-not-allowed border-slate-800 bg-slate-950"
                }`}
                style={
                  isUnlocked
                    ? {
                        borderColor: isSelected
                          ? accent
                          : withAlpha(accent, 0.22),
                        boxShadow: isSelected
                          ? `0 0 0 3px ${withAlpha(accent, 0.16)}`
                          : undefined,
                      }
                    : undefined
                }
              >
                {isUnlocked ? (
                  <>
                    <img
                      src={getTitleCollectionStageAssetByVisualStage(stage)}
                      alt=""
                      aria-hidden="true"
                      className="h-[72%] w-[72%] object-contain"
                    />
                    <span className="mt-1 text-[10px] font-black text-slate-500">
                      엠블럼 {stage}
                    </span>
                    {isSelected ? (
                      <span
                        className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: accent }}
                        aria-hidden="true"
                      >
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="text-4xl font-black text-white/90" aria-hidden="true">
                      ?
                    </span>
                    <span className="mt-2 text-[10px] font-black text-slate-400">
                      미해금
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
