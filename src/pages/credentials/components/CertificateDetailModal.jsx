import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, CreditCard, Lock, RotateCw, ScrollText, ShieldCheck } from "lucide-react";

import { Badge, Button, Modal , Tabs} from "../../../components/ui";
import CertificateLicenseCard from "./CertificateLicenseCard";
import TitleCategoryBadge from "./TitleCategoryBadge";

function buildRecordCode(item, locked) {
  const rawValue = String(
    item?.ownedId || item?.definitionId || item?.certificateId || item?.id || "",
  )
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  const suffix = rawValue ? rawValue.slice(-8) : "PENDING";
  return `${locked ? "PRE" : "CERT"}-${suffix.padStart(8, "0")}`;
}

function DetailCell({ icon: Icon, label, value, description }) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white/80 p-3.5">
      <div className="flex items-center gap-2 text-slate-400">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        <p className="text-[9px] font-black uppercase tracking-[0.18em]">{label}</p>
      </div>
      <p className="mt-1.5 break-words text-sm font-black text-slate-900">{value}</p>
      {description ? <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{description}</p> : null}
    </div>
  );
}

function CertificateBack({
  item,
  locked,
  status,
  formatDate,
  studentLabel,
  classDisplayName,
  classId,
  recordCode,
  condition,
  validity,
}) {
  return (
    <div className="relative mx-auto w-full max-w-[640px] overflow-hidden rounded-[22px] border border-slate-200 bg-[linear-gradient(145deg,#f8fafc,#ffffff_48%,#eef2ff)] p-5 shadow-[0_26px_60px_-36px_rgba(15,23,42,0.6)] sm:aspect-[1.586/1]">
      <ShieldCheck className="pointer-events-none absolute -bottom-10 -right-5 h-48 w-48 text-indigo-100/60" strokeWidth={1.1} />
      <div className="relative flex h-full flex-col">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.18em] text-indigo-500">{classDisplayName || "우리 학급"}</p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-slate-950">자격증 발급 정보</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {item?.categoryLabel ? <TitleCategoryBadge label={item.categoryLabel} iconKey={item.categoryIconKey} colorKey={item.categoryColorKey} size="sm" /> : null}
            {item?.gradeLabel ? <Badge tone={item.gradeTone || "blue"}>{item.gradeLabel}</Badge> : null}
            {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <DetailCell label="소유자" value={locked ? "취득 예정" : studentLabel || "학생"} description={locked ? "조건을 달성하면 발급됩니다." : "학생 자격증 지갑에 등록됨"} />
          <DetailCell icon={ShieldCheck} label="발급 학급" value={classDisplayName || "우리 학급"} description={`학급 ID · ${classId || "CLASS"}`} />
          <DetailCell icon={CalendarDays} label="발급일" value={!locked && item?.issuedAt ? formatDate(item.issuedAt) : "발급 전"} description="학급 명의로 발급됩니다." />
          <DetailCell icon={CheckCircle2} label="자격증 상태" value={validity} description={!locked && item?.isRevoked ? "회수된 자격증입니다." : "회수 또는 만료 상태가 함께 기록됩니다."} />
        </div>

        <div className="relative mt-2.5 grid gap-2.5 sm:grid-cols-[1fr_auto]">
          <div className="rounded-xl border border-indigo-100 bg-white/85 p-3.5">
            <div className="flex items-center gap-2 text-indigo-700">
              {locked ? <Lock className="h-3.5 w-3.5" /> : <ScrollText className="h-3.5 w-3.5" />}
              <p className="text-[11px] font-black">{locked ? "취득 조건" : "자격증 설명"}</p>
            </div>
            <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-700">{condition}</p>
          </div>
          <div className="min-w-[150px] rounded-xl border border-dashed border-slate-300 bg-white/70 p-3.5">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">관리번호</p>
            <p className="mt-1 break-all font-mono text-xs font-black text-slate-800">{recordCode}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CertificateDetailModal({
  open,
  item,
  locked = false,
  onClose,
  status,
  formatDate,
  studentLabel,
  classDisplayName,
  classId,
}) {
  const [visibleSide, setVisibleSide] = useState("front");

  useEffect(() => {
    if (open) setVisibleSide("front");
  }, [open, item?.id, item?.ownedId]);

  if (!open || !item) return null;

  const recordCode = buildRecordCode(item, locked);
  const condition = item?.acquisitionCondition || item?.description || "취득 조건이 아직 등록되지 않았습니다.";
  const validity = !locked && item?.expiresAt
    ? formatDate(item.expiresAt)
    : item?.expiresAt === null && !locked
      ? "기한 없음"
      : "발급 후 확인";

  return (
    <Modal isOpen={open} onClose={onClose} title={locked ? "자격증 취득 조건" : "내 자격증"} size="xl">
      <div className="mx-auto max-w-[760px] space-y-4">
        <div className="flex items-center justify-center">
          <Tabs ariaLabel="자격증 면 선택" idPrefix="certificate-side" tabs={[{id:"front",label:"앞면",icon:CreditCard},{id:"back",label:"뒷면",icon:RotateCw}]} activeTab={visibleSide} onTabChange={setVisibleSide} variant="pills" size="md" />
        </div>

        <div role="tabpanel">
          {visibleSide === "front" ? (
            <div className="mx-auto max-w-[640px]">
              <CertificateLicenseCard
                item={item}
                status={status}
                locked={locked}
                formatDate={formatDate}
                studentLabel={studentLabel}
                classDisplayName={classDisplayName}
                classId={classId}
                showActionHint={false}
              />
            </div>
          ) : (
            <CertificateBack
              item={item}
              locked={locked}
              status={status}
              formatDate={formatDate}
              studentLabel={studentLabel}
              classDisplayName={classDisplayName}
              classId={classId}
              recordCode={recordCode}
              condition={condition}
              validity={validity}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-xs text-slate-500">앞면과 뒷면을 눌러 자격증 정보를 확인하세요.</p>
          <Button variant="outline" tone="slate" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </Modal>
  );
}
