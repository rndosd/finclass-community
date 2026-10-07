import { CalendarDays, CheckCircle2, Lock, RotateCcw, ScrollText, ShieldCheck } from "lucide-react";

import { Badge } from "../../../components/ui";
import TitleCategoryBadge from "./TitleCategoryBadge";

function buildRecordCode(item, locked) {
  const raw = String(item?.ownedId || item?.definitionId || item?.certificateId || item?.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return `${locked ? "PRE" : "CERT"}-${(raw.slice(-8) || "PENDING").padStart(8, "0")}`;
}

function BackCell({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 px-[5%] py-[4%]">
      <div className="flex items-center gap-1.5 text-slate-400">
        {Icon ? <Icon className="h-[clamp(10px,1.2vw,13px)] w-[clamp(10px,1.2vw,13px)]" /> : null}
        <p className="text-[clamp(7px,0.85vw,9px)] font-black tracking-[0.12em]">{label}</p>
      </div>
      <p className="mt-[3%] truncate text-[clamp(10px,1.35vw,14px)] font-black text-slate-900">{value}</p>
    </div>
  );
}

export default function CertificateLicenseBack({
  item,
  locked = false,
  status,
  formatDate,
  studentLabel,
  classDisplayName,
  classId,
}) {
  const recordCode = buildRecordCode(item, locked);
  const condition = item?.acquisitionCondition || item?.description || "취득 조건이 아직 등록되지 않았습니다.";
  const validity = !locked && item?.expiresAt
    ? formatDate(item.expiresAt)
    : item?.expiresAt === null && !locked
      ? "기한 없음"
      : "발급 후 확인";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[22px] bg-[linear-gradient(145deg,#ffffff,#f8fafc_58%,#eef2ff)] p-[5%] text-left shadow-[0_24px_55px_-34px_rgba(15,23,42,0.55)] ring-1 ring-slate-900/5">
      <div className="absolute inset-y-0 left-0 w-[1.5%] bg-gradient-to-b from-indigo-500 via-violet-400 to-sky-400" />
      <ShieldCheck className="pointer-events-none absolute -bottom-[16%] -right-[7%] h-[52%] w-[52%] text-indigo-100/45" strokeWidth={1} />
      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 pb-[3%]">
          <div className="min-w-0">
            <p className="truncate text-[clamp(8px,1vw,10px)] font-black tracking-[0.16em] text-indigo-500">{classDisplayName || "우리 학급"}</p>
            <h3 className="mt-[1%] text-[clamp(15px,2.1vw,21px)] font-black tracking-tight text-slate-950">자격증 발급 정보</h3>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {item?.categoryLabel ? <TitleCategoryBadge label={item.categoryLabel} iconKey={item.categoryIconKey} colorKey={item.categoryColorKey} size="sm" /> : null}
            {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
          </div>
        </div>

        <div className="mt-[1%] grid grid-cols-2 border-y border-slate-200/80 [&>*:nth-child(odd)]:border-r [&>*:nth-child(-n+2)]:border-b [&>*]:border-slate-200/80">
          <BackCell label="소유자" value={locked ? "취득 예정" : studentLabel || "학생"} />
          <BackCell icon={ShieldCheck} label="발급 학급" value={classDisplayName || "우리 학급"} />
          <BackCell icon={CalendarDays} label="발급일" value={!locked && item?.issuedAt ? formatDate(item.issuedAt) : "발급 전"} />
          <BackCell icon={CheckCircle2} label="자격증 상태" value={validity} />
        </div>

        <div className="relative mt-[3%] flex min-h-0 flex-1 items-stretch gap-[4%] rounded-xl bg-indigo-50/65 px-[4%] py-[3%]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-indigo-700">
              {locked ? <Lock className="h-3.5 w-3.5" /> : <ScrollText className="h-3.5 w-3.5" />}
              <p className="text-[clamp(8px,1vw,10px)] font-black">{locked ? "취득 조건" : "자격증 설명"}</p>
            </div>
            <p className="mt-[2%] line-clamp-2 text-[clamp(8px,1.1vw,11px)] font-semibold leading-[1.45] text-slate-700">{condition}</p>
          </div>
          <div className="flex min-w-[118px] flex-col justify-between border-l border-indigo-200/70 pl-[4%]">
            <div>
              <p className="text-[clamp(7px,0.85vw,9px)] font-black tracking-[0.12em] text-slate-400">관리번호</p>
              <p className="mt-1 break-all font-mono text-[clamp(8px,1vw,10px)] font-black text-slate-800">{recordCode}</p>
            </div>
            <p className="mt-2 truncate text-[clamp(7px,0.85vw,9px)] font-bold text-slate-500">{classId || "CLASS"}</p>
          </div>
        </div>

        <div className="mt-[2%] flex justify-end text-[clamp(7px,0.9vw,9px)] font-bold text-slate-500">
          <span className="inline-flex items-center gap-1"><RotateCcw className="h-3 w-3" /> 앞면으로</span>
        </div>
      </div>
    </div>
  );
}
