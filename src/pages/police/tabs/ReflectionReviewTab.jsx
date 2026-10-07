import React, { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where } from "firebase/firestore";
import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { Button, ErrorState, SectionLoader, Tabs } from "../../../components/ui";
import { ReflectionContent } from "../modals/ReflectionModal";
import { useReflection } from "../hooks/useReflection";

const PAGE_SIZE = 20;
const statusLabel = (value) => ({submitted:"검토 대기",approved:"승인",rejected:"반려"}[value] || "제출 취소");
const dateText = (value) => value?.toDate ? value.toDate().toLocaleString("ko-KR", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Seoul"}) : "-";

export default function ReflectionReviewTab({ classId, currencyUnit, enabled = true }) {
  const { isTeacher, hasPermission } = useUser();
  const allowed = enabled && (isTeacher || hasPermission("permission_group_police"));
  const [status, setStatus] = useState("submitted");
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [processedIds, setProcessedIds] = useState([]);
  const gridRef = useRef(null);
  const [panelHeight, setPanelHeight] = useState(480);
  useEffect(() => {
    if (!allowed) return;
    const updateHeight = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const main = grid.closest("main");
      let bottomPadding = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      for (let parent = grid.parentElement; parent && parent !== main; parent = parent.parentElement) {
        bottomPadding += parseFloat(getComputedStyle(parent).paddingBottom) || 0;
      }
      const bottom = main && /(auto|scroll)/.test(getComputedStyle(main).overflowY) ? main.getBoundingClientRect().bottom : window.innerHeight;
      const top = grid.getBoundingClientRect().top + (main?.scrollTop || 0);
      setPanelHeight(Math.max(280, bottom - top - bottomPadding - 1));
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [allowed]);
  const actions = useReflection(classId, {enabled:allowed, fineId:selectedId});
  const list = useInfiniteQuery({
    queryKey:["policeReflections",classId,status], enabled:!!classId && allowed,
    initialPageParam:null, refetchOnWindowFocus:false,
    queryFn:async ({pageParam}) => {
      // Equality-only pending query uses the existing single-field status index.
      const constraints = status === "submitted" ? [where("status","==","submitted")] : [orderBy("submittedAt","desc")];
      if (pageParam) constraints.push(startAfter(pageParam));
      const snap = await getDocs(query(collection(db,`classes/${classId}/reflections`),...constraints,limit(PAGE_SIZE)));
      return {items:snap.docs.map(item=>({...item.data(),id:item.id})),last:snap.docs.at(-1),hasMore:snap.size===PAGE_SIZE};
    },
    getNextPageParam:last=>last.hasMore ? last.last : undefined,
  });
  const rows = useMemo(()=>{
    const unique = new Map();
    list.data?.pages.forEach(page=>page.items.forEach(item=>unique.set(item.id,item)));
    return [...unique.values()];
  },[list.data]);
  useEffect(() => {
    setProcessedIds(previous=>previous.filter(id=>rows.some(row=>row.id===id)));
  },[rows]);
  const visible = rows.filter(row=>(status !== "submitted" || !processedIds.includes(row.id)) && (row.studentName || "").includes(search.trim()));
  const detail = useQuery({
    queryKey:["policeReflectionReview",classId,selectedId],enabled:!!classId && !!selectedId && allowed,
    refetchOnWindowFocus:false,
    queryFn:async()=>{
      const [fineSnap,reflectionSnap] = await Promise.all([
        getDoc(doc(db,`classes/${classId}/policeFineHistory/${selectedId}`)),
        getDoc(doc(db,`classes/${classId}/reflections/${selectedId}`)),
      ]);
      if (!fineSnap.exists() || !reflectionSnap.exists()) throw new Error("연결된 부과 또는 제출 기록이 없습니다.");
      return {fine:{...fineSnap.data(),id:fineSnap.id},reflection:{...reflectionSnap.data(),id:reflectionSnap.id}};
    },
  });
  const handleResult = async (operation, args) => {
    const result = await operation(...args);
    setBusy(false);
    if (result?.success && status === "submitted") {
      setProcessedIds(previous=>[...previous,selectedId]);
      const index=visible.findIndex(row=>row.id===selectedId);
      const next=visible.slice(index+1).find(row=>row.status==="submitted") || visible.slice(0,index).find(row=>row.status==="submitted");
      setSelectedId(next?.id || null);
    }
    return result;
  };
  if (!allowed) return <p className="p-4 text-sm text-slate-500">소명·반성 검토를 사용할 수 없습니다.</p>;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Tabs ariaLabel="소명·반성 목록" tabs={[{id:"submitted",label:"검토 대기"},{id:"all",label:"전체 제출"}]} activeTab={status} onTabChange={value=>{if(!busy){setStatus(value);setSelectedId(null);}}} variant="underline" size="sm" />
      <Button size="sm" kind="outline" disabled={busy || list.isFetching} onClick={()=>list.refetch()}>새로고침</Button>
    </div>
    <div ref={gridRef} style={{"--reflection-review-height":`${panelHeight}px`}} className="grid items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
      <section className={`${selectedId ? "hidden md:flex" : ""} flex max-h-[var(--reflection-review-height)] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white`} aria-label="제출 목록">
        <div className="border-b border-slate-100 p-3"><input aria-label="불러온 제출물에서 학생 이름 검색" placeholder="학생 이름 검색" disabled={busy} value={search} onChange={event=>setSearch(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /><p className="mt-2 text-xs text-slate-500">불러온 {rows.length}건에서 검색 · 나머지 기록은 더 보기</p></div>
        {list.isLoading ? <SectionLoader message="제출 목록을 불러오는 중입니다."/> : list.isError ? <ErrorState variant="section" title="제출 목록을 불러오지 못했습니다." onRetry={()=>list.refetch()}/> : <>
          <div className="min-h-0 overflow-y-auto divide-y divide-slate-100">
            {!visible.length && <p className="p-6 text-center text-sm text-slate-500">{search ? "검색 결과가 없습니다." : status==="submitted" ? "검토 대기 중인 제출물이 없습니다." : "제출 기록이 없습니다."}</p>}
            {visible.map(row=><button key={row.id} type="button" disabled={busy} aria-pressed={selectedId===row.id} onClick={()=>setSelectedId(row.id)} className={`w-full p-3 text-left disabled:opacity-50 ${selectedId===row.id ? "bg-blue-50" : "hover:bg-slate-50"}`}><div className="flex justify-between gap-2 text-sm"><span className="font-semibold text-slate-900">{row.studentName || "학생"}</span><span className="text-xs text-slate-500">{statusLabel(row.status)}</span></div><div className="mt-1 flex justify-between gap-2 text-xs text-slate-500"><span>{row.submissionType==="appeal" ? "이의제기" : "반성문"}</span><span>{dateText(row.submittedAt)}</span></div><p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-600">{row.reflectionText}</p></button>)}
          </div>
          {list.hasNextPage && <div className="border-t border-slate-100 p-3"><Button size="sm" kind="outline" disabled={busy || list.isFetchingNextPage} onClick={()=>list.fetchNextPage()}>제출 더 보기</Button></div>}
        </>}
      </section>
      <div className="min-w-0 space-y-2">
        {!selectedId ? <p className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">제출물을 선택하면 본문과 관련 부과를 확인하고 검토할 수 있습니다.</p> : detail.isLoading ? <SectionLoader message="검토 내용을 불러오는 중입니다."/> : detail.isError ? <ErrorState variant="section" title="검토 내용을 불러오지 못했습니다." onRetry={()=>detail.refetch()}/> : detail.data ? <ReflectionContent key={selectedId} embedded isOpen fine={detail.data.fine} reflectionData={detail.data.reflection} mode={detail.data.reflection.status==="submitted" ? "review" : "view"} currencyUnit={currencyUnit} onBusyChange={setBusy} onClose={()=>setSelectedId(null)} onApprove={value=>handleResult(actions.approveReflection,[value])} onReject={(id,comment)=>handleResult(actions.rejectReflection,[id,comment])}/> : null}
      </div>
    </div>
  </div>;
}
