import { CalendarClock, CircleDollarSign, Pencil, Search, Trash2, UsersRound } from "lucide-react";
import { Badge, Button } from "../../components/ui";
import { APPLICATION_STATUS_META, formatPostRemainingTime, formatReward, getDisplayPostStatusMeta, getRewardModeLabel, getSelectionTypeLabel, inputClassName } from "./JobBoardPage.parts";

const statusOptions = [['all', '전체 상태'], ['recruiting', '모집 중'], ['closed', '모집 마감'], ['pending_approval', '승인 대기'], ['draft', '임시저장'], ['cancelled', '취소']];

export default function JobRecruitDiscoveryList({clockNow, currencyUnit, loading, error, onRetry, isTeacher, myApplicationsByPostId, searchTerm, onEdit, onDeletePost, setSearchTerm, onOpen, setStatusFilter, statusFilter, userUid, visiblePosts}) {
  return <section aria-label="공고 둘러보기" className="min-w-0 space-y-4">
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className={`${inputClassName} h-11 pl-11`} value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="공고 제목이나 내용으로 검색" aria-label="공고 검색" />
      </div>
      <select className={`${inputClassName} h-11 py-0 sm:w-40`} value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="공고 상태 필터">
        {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white px-4 sm:px-5">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 py-5">
        <h2 className="text-xl leading-7 font-bold text-slate-900">{statusFilter === 'recruiting' ? '모집 중인 공고' : '둘러볼 공고'}</h2>
        {!error && !loading && <span className="text-sm text-slate-500">총 {visiblePosts.length}개</span>}
      </div>
      {error ? <div role="alert" className="py-10 text-sm text-slate-600"><p className="font-semibold text-rose-700">공고를 불러오지 못했습니다.</p><Button className="mt-3" kind="outline" tone="slate" onClick={onRetry}>다시 시도</Button></div>
        : loading ? <p role="status" className="py-10 text-sm text-slate-500">공고를 불러오는 중입니다...</p>
        : visiblePosts.length === 0 ? <div className="py-12 text-center text-sm text-slate-500">
          <p className="font-semibold text-slate-700">{searchTerm || statusFilter !== 'all' ? '조건에 맞는 공고가 없습니다.' : '아직 등록된 공고가 없습니다.'}</p>
          {(searchTerm || statusFilter !== 'all') && <Button className="mt-3" kind="outline" tone="slate" onClick={() => {setSearchTerm(''); setStatusFilter('all');}}>전체 공고 보기</Button>}
        </div> : <div className="divide-y divide-slate-200">{visiblePosts.map(post => {
          const meta = APPLICATION_STATUS_META[myApplicationsByPostId.get(post.id)?.status] || getDisplayPostStatusMeta(post, clockNow);
          const slots = Math.max(1, Number(post.slots || 1));
          const available = Math.max(0, Number(post.availableSlots ?? slots - Number(post.selectedCount || 0)));
          return <article key={post.id} className="py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onOpen(post)} className="break-words text-left text-base font-bold text-slate-900 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">{post.title}</button>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{post.description || '공고를 눌러 자세한 업무 내용을 확인해 보세요.'}</p>
              </div><Badge tone={meta.tone}>{meta.label}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5"><UsersRound className="h-4 w-4" />{slots}명 모집 · 남은 자리 {available}명</span>
              <span>{getSelectionTypeLabel(post.selectionType)}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />{formatPostRemainingTime(post, clockNow)}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-blue-700"><CircleDollarSign className="h-4 w-4" />{getRewardModeLabel(post.rewardMode)} · {formatReward(post.rewardAmount, currencyUnit)}</p>
              <div className="flex gap-2">
                {(isTeacher || post.authorUid === userUid) && <>
                  <Button size="icon-md" kind="ghost" tone="slate" aria-label={`${post.title} 공고 수정`} onClick={() => onEdit(post)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon-md" kind="ghost" tone="rose" aria-label={`${post.title} 공고 삭제`} onClick={() => onDeletePost(post)}><Trash2 className="h-4 w-4" /></Button>
                </>}
                <Button size="sm" kind="outline" tone="slate" onClick={() => onOpen(post)}>자세히</Button>
              </div>
            </div>
          </article>;
        })}</div>}
    </div>
  </section>;
}
