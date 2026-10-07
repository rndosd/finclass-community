import { CalendarClock, CircleDollarSign, Pencil, UsersRound } from "lucide-react";

import { Badge, Button, Modal } from "../../components/ui";
import {
  APPLICATION_STATUS_META,
  InfoTile,
  canReapplyFromStatus,
  formatDateTime,
  formatPostRemainingTime,
  formatReward,
  getApplyActionLabel,
  getDisplayPostStatusMeta,
  getSelectionTypeLabel,
  getStatusMeta,
  normalizeSelectionTypeValue,
} from "./JobBoardPage.parts";

export default function JobPostDetailModal({
  busyKey,
  canApply,
  clockNow,
  currencyUnit,
  isOwnApplicant,
  isOwnPostAuthor,
  isTeacher,
  inline = false,
  onApply,
  onClose,
  onEditApplication,
  onWithdraw,
  ownApplication,
  post,
}) {
  if (!post) {
    if (!inline) return null;
    return (
      <section className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-20 text-center text-sm font-semibold text-slate-500">
        공고를 선택하면 상세 내용을 확인할 수 있어요.
      </section>
    );
  }

  const statusMeta = getDisplayPostStatusMeta(post, clockNow);
  const isFirstCome = normalizeSelectionTypeValue(post.selectionType) === "first_come";
  const canEditOwnApplication =
    isOwnApplicant && ownApplication?.status === "applied" && !isFirstCome;
  const canViewOwnApplication = !isTeacher && !isOwnPostAuthor;
  const slots = Math.max(1, Number(post.slots || 1));
  const availableSlots = Math.max(
    0,
    Number(post.availableSlots ?? slots - Number(post.selectedCount || 0)),
  );

  const content = (
    <div className="space-y-4">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white">
          <div className="bg-gradient-to-br from-indigo-50 via-sky-50 to-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-2xl font-black tracking-tight text-slate-950">{post.title}</p>
                <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                보상과 마감을 확인하고, 할 수 있는 일인지 천천히 살펴보세요.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {canApply ? (
                <Button
                  size="sm"
                  tone="blue"
                  onClick={() => onApply(post)}
                  isLoading={busyKey === `apply:${post.id}`}
                >
                  {getApplyActionLabel(post.selectionType)}
                </Button>
              ) : null}
            </div>
          </div>
          </div>

          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-amber-50 px-4 py-3">
              <p className="flex items-center gap-1 text-xs font-black text-amber-700"><CircleDollarSign className="h-3.5 w-3.5" /> 보상</p>
              <p className="mt-1 text-base font-black text-amber-950">{formatReward(post.rewardAmount, currencyUnit)}</p>
            </div>
            <div className="rounded-2xl bg-indigo-50 px-4 py-3">
              <p className="flex items-center gap-1 text-xs font-black text-indigo-700"><UsersRound className="h-3.5 w-3.5" /> 모집 인원</p>
              <p className="mt-1 text-sm font-black text-indigo-950">{slots}명 모집 · 남은 자리 {availableSlots}명</p>
            </div>
            <InfoTile label="지원 방식" value={getSelectionTypeLabel(post.selectionType)} />
            <div className="rounded-2xl bg-sky-50 px-4 py-3">
              <p className="flex items-center gap-1 text-xs font-black text-sky-700"><CalendarClock className="h-3.5 w-3.5" /> 지원 마감</p>
              <p className="mt-1 text-sm font-black text-sky-950">{formatPostRemainingTime(post, clockNow)}</p>
              {post.applyDeadlineAt ? <p className="mt-1 text-[11px] font-semibold text-sky-700/70">{formatDateTime(post.applyDeadlineAt)}</p> : null}
            </div>
          </div>

          <div className="border-t border-slate-100 px-5 pb-6 pt-5">
            <p className="text-base font-black text-slate-900">어떤 일을 하나요?</p>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">
              {post.description || "등록된 업무 내용이 없습니다."}
            </p>
          </div>
        </div>

        {canViewOwnApplication ? (
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">내 지원 현황</p>
                <p className="mt-1 text-sm text-slate-500">
                  내가 이 공고에 지원했는지와 처리 상태를 확인할 수 있어요.
                </p>
              </div>
              {ownApplication ? (
                <Badge tone={getStatusMeta(ownApplication.status, APPLICATION_STATUS_META).tone}>
                  {getStatusMeta(ownApplication.status, APPLICATION_STATUS_META).label}
                </Badge>
              ) : (
                <Badge tone="slate">지원 전</Badge>
              )}
            </div>

            {ownApplication ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  지원 시각: {formatDateTime(ownApplication.appliedAt)}
                </div>
                {ownApplication.status === "selected" ? (
                  <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                    선발되었습니다. 의뢰자 안내에 따라 결과물을 제출해 주세요.
                  </div>
                ) : null}
                {ownApplication.rejectionReason ? (
                  <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    반려 사유: {ownApplication.rejectionReason}
                  </div>
                ) : null}
                {ownApplication.paymentShares?.length ? (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {ownApplication.paymentShares.map((share) => (
                        <Badge key={`${share.uid}-${share.amount}`} tone="emerald">
                          {share.name} {formatReward(share.amount, currencyUnit)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {canEditOwnApplication ? (
                    <Button
                      kind="outline"
                      tone="blue"
                      icon={Pencil}
                      onClick={() => onEditApplication(post, ownApplication)}
                      isLoading={busyKey === `apply:${post.id}`}
                    >
                      지원서 수정
                    </Button>
                  ) : null}
                  {isOwnApplicant && ownApplication.status === "selected" ? (
                    <Button
                      kind="outline"
                      tone="red"
                      onClick={() => onWithdraw(post)}
                      isLoading={busyKey === `withdraw:${post.id}`}
                    >
                      참여 취소
                    </Button>
                  ) : null}
                  {isOwnApplicant && ownApplication.status === "applied" ? (
                    <Button
                      kind="outline"
                      tone="red"
                      onClick={() => onWithdraw(post)}
                      isLoading={busyKey === `withdraw:${post.id}`}
                    >
                      지원 취소
                    </Button>
                  ) : null}
                  {canReapplyFromStatus(ownApplication.status) && canApply ? (
                    <Button tone="blue" onClick={() => onApply(post)}>
                      다시 지원
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  아직 이 공고에 지원하지 않았어요.
                </div>
                {canApply ? (
                  <Button
                    tone="blue"
                    onClick={() => onApply(post)}
                    isLoading={busyKey === `apply:${post.id}`}
                  >
                    {getApplyActionLabel(post.selectionType)}
                  </Button>
                ) : (
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
                    지금은 지원할 수 없는 공고예요.
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
    </div>
  );

  if (inline) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
        {content}
      </section>
    );
  }

  return (
    <Modal isOpen={Boolean(post)} onClose={onClose} title="공고 상세" size="xl">
      {content}
    </Modal>
  );
}
