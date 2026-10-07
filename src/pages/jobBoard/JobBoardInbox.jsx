import { ArrowRight, ClipboardList, Inbox } from "lucide-react";
import { Badge, Button } from "../../components/ui";
import { APPLICATION_STATUS_META, formatReward, getRewardModeLabel } from "./JobBoardPage.parts";
import { REQUEST_STATUS_META } from "./JobSeekerBoardPage.parts";

const applicationHints = {
  applied: "선발 결과를 기다리고 있어요.",
  selected: "활동 후 결과를 제출해 주세요.",
  submitted: "제출한 결과를 검토하고 있어요.",
  approved: "결과가 승인됐어요. 보상 지급을 기다려 주세요.",
  paid: "보상 지급이 완료됐어요.",
  rejected: "반려 내용을 확인해 주세요.",
  withdrawn: "취소한 지원이에요.",
};

export default function JobBoardInbox({
  kind = "applications", rows = [], currencyUnit, loading, error, onRetry,
  direction = "received", onDirectionChange, onOpen, onManage, onOwn,
  onAccept, onReject, onComplete, busyKey = "",
}) {
  const isRequests = kind === "requests";
  const title = isRequests ? (direction === "received" ? "받은 의뢰" : "보낸 의뢰") : "내 지원";
  const Icon = isRequests ? Inbox : ClipboardList;
  return (
    <aside id="job-board-inbox" aria-label={title} className="min-w-0 scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl leading-7 font-bold text-slate-900"><Icon className="h-5 w-5 text-blue-600" />{title}</h2>
        {!loading && !error && <span className="text-sm text-slate-500">총 {rows.length}건</span>}
      </div>
      {isRequests && (
        <div className="mt-4 flex rounded-xl border border-slate-200 p-1" role="group" aria-label="의뢰 방향">
          {[['received', '받은 의뢰'], ['sent', '보낸 의뢰']].map(([value, label]) => (
            <button type="button" key={value} aria-pressed={direction === value} onClick={() => onDirectionChange(value)}
              className={`min-h-10 flex-1 rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${direction === value ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {isRequests && <p className="mt-3 text-xs text-slate-500">전체 상태 · 최근 의뢰부터 표시합니다.</p>}
      {error ? (
        <div role="alert" className="py-8 text-sm text-slate-600">
          <p className="font-semibold text-rose-700">{title}{title === '내 지원' ? '을' : '를'} 불러오지 못했습니다.</p>
          <p className="mt-2">잠시 후 다시 시도해 주세요.</p>
          <Button className="mt-3" kind="outline" tone="slate" onClick={onRetry}>다시 시도</Button>
        </div>
        ) : loading ? <p role="status" className="py-8 text-sm text-slate-500">{title}{title === '내 지원' ? '을' : '를'} 불러오는 중입니다...</p>
        : rows.length === 0 ? (
          <div className="py-8 text-sm text-slate-500">
            <p className="font-semibold text-slate-700">아직 {title === '내 지원' ? '지원한 공고가' : title + '가'} 없습니다.</p>
            <p className="mt-2 leading-6">{!isRequests ? '마음에 드는 공고를 눌러 지원해 보세요.' : direction === 'received' ? '내 서비스를 등록하면 친구들의 의뢰를 여기서 확인할 수 있어요.' : '친구의 서비스를 선택해 필요한 일을 의뢰해 보세요.'}</p>
          </div>
        ) : (
          <div className="mt-2 divide-y divide-slate-200">
            {rows.slice(0, 3).map(row => {
              const meta = (isRequests ? REQUEST_STATUS_META : APPLICATION_STATUS_META)[row.status] || {label: row.status || '상태 확인', tone: 'slate'};
              const amount = isRequests ? row.proposedRewardAmount : row.rewardAmount;
              return (
                <article key={row.id} className="py-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words text-base font-bold text-slate-900">{isRequests ? row.serviceTitle : row.postTitle}</h3>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{isRequests ? `${direction === 'received' ? row.requesterName || '의뢰인' : row.providerName || '서비스 제공자'} · ${row.requestMessage || '의뢰 내용을 확인해 주세요.'}` : applicationHints[row.status] || '지원 내용을 확인해 주세요.'}</p>
                  <p className="mt-3 text-sm font-semibold tabular-nums text-slate-700">{!isRequests && `${getRewardModeLabel(row.rewardMode)} · `}{formatReward(amount, currencyUnit)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {isRequests && direction === 'received' && row.status === 'requested' && onAccept ? <>
                      <Button size="sm" tone="blue" disabled={Boolean(busyKey)} isLoading={busyKey === `request:accept:${row.id}`} onClick={() => onAccept(row)}>수락</Button>
                      <Button size="sm" kind="outline" tone="slate" disabled={Boolean(busyKey)} onClick={() => onReject(row)}>거절</Button>
                    </> : isRequests && direction === 'received' && row.status === 'accepted' && onComplete ?
                      <Button size="sm" kind="outline" tone="blue" disabled={Boolean(busyKey)} isLoading={busyKey === `request:complete:${row.id}`} onClick={() => onComplete(row)}>완료 알리기</Button> : null}
                    <Button size="sm" kind="outline" tone="slate" onClick={() => onOpen(row)}>{!isRequests && row.status === 'selected' ? '결과 제출' : isRequests ? '의뢰 상세' : '지원 내용 보기'}</Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      <div className="flex flex-wrap gap-x-5 gap-y-3 border-t border-slate-200 pt-4">
        <Button size="sm" kind="ghost" tone="blue" icon={ArrowRight} onClick={onManage}>{title} 전체 보기</Button>
        <Button size="sm" kind="ghost" tone="slate" onClick={onOwn}>{isRequests ? '내 서비스 관리' : '내 공고 관리'}</Button>
      </div>
    </aside>
  );
}
