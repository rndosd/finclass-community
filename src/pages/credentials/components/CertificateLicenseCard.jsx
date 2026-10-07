import { Lock, Medal, RotateCw, ShieldCheck } from "lucide-react";

import { Badge } from "../../../components/ui";
import {
  getCertificateLicenseTone,
  getCertificateStageMaterial,
  getCertificateStateLabel,
} from "../certificateAppearance";
import { TITLE_CATEGORY_ICON_MAP } from "./TitleCategoryBadge";

function buildShortCode(item, locked) {
  const raw = String(item?.ownedId || item?.definitionId || item?.certificateId || item?.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return `${locked ? "PRE" : "CERT"}-${(raw.slice(-8) || "PENDING").padStart(8, "0")}`;
}

export default function CertificateLicenseCard({
  item,
  status,
  locked = false,
  onOpen,
  formatDate,
  studentLabel,
  classDisplayName,
  classId,
  showActionHint = true,
  actionHint,
}) {
  const tone = getCertificateLicenseTone(item, { locked });
  const stage = getCertificateStageMaterial(item);
  const CategoryIcon = TITLE_CATEGORY_ICON_MAP[item?.categoryIconKey] || Medal;
  const stateLabel = getCertificateStateLabel(item, { locked, status });
  const code = buildShortCode(item, locked);
  const cardClassName = [
    "group relative block w-full overflow-hidden rounded-[22px] border border-white/80 bg-gradient-to-br text-left",
    "shadow-[0_24px_55px_-34px_rgba(15,23,42,0.55)] transition duration-200",
    onOpen ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_28px_64px_-32px_rgba(15,23,42,0.6)] focus:outline-none focus:ring-4 focus:ring-blue-200" : "",
    locked ? "grayscale-[0.35] opacity-80" : "",
    tone.surface,
  ].join(" ");
  const Wrapper = onOpen ? "button" : "div";

  return (
    <Wrapper type={onOpen ? "button" : undefined} onClick={onOpen} className={cardClassName} style={{ aspectRatio: "1.586 / 1" }}>
      <div className={`absolute inset-y-0 left-0 w-[35%] bg-gradient-to-br ${tone.rail}`} />
      <div className="absolute inset-y-0 left-[35%] w-px bg-white/90" />
      <CategoryIcon className={`pointer-events-none absolute -bottom-[9%] right-[2%] h-[46%] w-[46%] ${tone.watermark}`} strokeWidth={1.1} />
      <Badge tone={locked ? "slate" : status?.tone || "emerald"} size="sm" className="absolute right-[4%] top-[5%] z-20 shrink-0 border-white/50 bg-white/95">
        {stateLabel}
      </Badge>

      <div className="relative grid h-full grid-cols-[35%_65%]">
        <div className="flex min-h-0 flex-col items-center justify-center px-[9%] text-white">
          <div className="flex aspect-square w-[72%] items-center justify-center rounded-full border-[3px] border-white/80 bg-white/95 text-slate-700 shadow-[0_14px_35px_-18px_rgba(15,23,42,0.75)] ring-4 ring-white/20">
            {locked ? <Lock className="h-[42%] w-[42%]" /> : <CategoryIcon className="h-[48%] w-[48%]" strokeWidth={1.8} />}
          </div>
          <p className="mt-[9%] max-w-full truncate text-center text-[clamp(9px,1.25vw,13px)] font-black">
            {item?.categoryLabel || "학급 인증"}
          </p>
          <p className="mt-[2%] text-center text-[clamp(6px,0.8vw,8px)] font-bold tracking-[0.15em] text-white/70">CLASS LICENSE</p>
        </div>

        <div className="flex min-w-0 flex-col px-[7%] pb-[5%] pt-[8%]">
          <div className="pr-[22%]">
            <div className="flex items-center gap-2">
              <ShieldCheck className={`h-[clamp(11px,1.4vw,16px)] w-[clamp(11px,1.4vw,16px)] ${tone.ink}`} />
              <p className={`truncate text-[clamp(9px,1.35vw,13px)] font-black ${tone.ink}`}>{classDisplayName || "우리 학급"}</p>
            </div>
            <p className="mt-[1%] text-[clamp(6px,0.8vw,8px)] font-black uppercase tracking-[0.2em] text-slate-400">Official certificate</p>
          </div>

          <h3 className={`mt-[6%] line-clamp-2 text-[clamp(17px,2.6vw,27px)] font-black leading-[1.05] tracking-tight ${tone.ink}`}>
            {item?.name || "이름 없는 자격증"}
          </h3>

          <div className="mt-auto grid grid-cols-[1fr_auto] items-end gap-[6%] pb-[7%]">
            <dl className="min-w-0 space-y-[4%] text-[clamp(8px,1.18vw,11px)]">
              <div className="flex gap-2"><dt className="w-[3.5em] shrink-0 font-bold text-slate-400">이름</dt><dd className="truncate font-black text-slate-800">{locked ? "취득 예정" : studentLabel || "학생"}</dd></div>
              <div className="flex gap-2"><dt className="w-[3.5em] shrink-0 font-bold text-slate-400">단계</dt><dd className="truncate font-black text-slate-700">{stage.label}</dd></div>
              <div className="flex gap-2"><dt className="w-[3.5em] shrink-0 font-bold text-slate-400">취득일</dt><dd className="truncate font-bold text-slate-700">{!locked && item?.issuedAt ? formatDate(item.issuedAt) : "발급 전"}</dd></div>
            </dl>
            <div className={`flex aspect-square w-[clamp(48px,8vw,68px)] flex-col items-center justify-center rounded-full border-2 ring-2 ring-offset-2 shadow-md ${stage.seal} ${stage.rim}`}>
              {locked ? <Lock className="h-[27%] w-[27%]" /> : <ShieldCheck className="h-[30%] w-[30%]" />}
              <span className="mt-0.5 text-[clamp(7px,0.9vw,9px)] font-black">학급 인증</span>
            </div>
          </div>

          <div className="flex items-end justify-between gap-3 border-t border-slate-300/70 pt-[3%] text-[clamp(6px,0.9vw,9px)] font-bold text-slate-500">
            <span className="min-w-0 truncate font-mono">{code} · {classId || "CLASS"}</span>
            {showActionHint ? <span className="inline-flex shrink-0 items-center gap-1"><RotateCw className="h-3 w-3" /> {actionHint || (locked ? "조건 보기" : "뒤집기")}</span> : null}
          </div>
        </div>
      </div>
    </Wrapper>
  );
}
