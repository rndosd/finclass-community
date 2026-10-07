import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Check, ChevronRight, Search, TrendingDown, TrendingUp, Users, X } from 'lucide-react';
import Button from '../../../../../components/ui/Button';
import ErrorState from '../../../../../components/ui/ErrorState';
import SectionLoader from '../../../../../components/ui/SectionLoader';
import { useUser } from '../../../../../contexts/UserContext';
import { useTeacherMissionDashboardRQ } from '../../../hooks/useTeacherMissionDashboardRQ';
import { useMissionAnalyticsDailyRQ } from './useMissionAnalyticsDailyRQ';
import { useMissionStatsHistory } from './useMissionStatsHistory';
import { buildStudentMetrics, percent, shift, days, previousRange } from './missionStatsModel';
import { formatDayKey } from './StudentStatsTableView.utils';
import './StudentStatsTableView.css';

const display=p=>p===null?'—':`${p}%`;
const fmt=key=>key.slice(5).replace('-','.');
const isCompleted=status=>['approved','late-approved','completed'].includes(status);
const statusText={approved:'승인 완료','late-approved':'승인 완료',completed:'완료',pending:'승인 대기',rejected:'반려',canceled:'취소',cancelled:'취소'};
function Meter({value,detail}) { return <div className="stat-meter"><strong>{display(value)}</strong><span className="meter-track"><i style={{width:`${value||0}%`}}/></span><small>{detail}</small></div>; }
function ChangeLabel({row}) {
  const tone=row.change>0?'up':row.change<0?'down':'neutral';
  const Icon=row.change<0?TrendingDown:TrendingUp;
  return <div className={`change-label ${tone}`}><div>{row.change!==null&&row.change!==0&&<Icon size={17}/>}<strong>{row.change===null?'비교 불가':row.change===0?'변화 없음':`${Math.abs(row.change)}%p ${row.change>0?'상승':'하락'}`}</strong></div><small>{row.changeField==='consistency'?'꾸준함':'참여율'} · {row.comparisonLabel} 대비</small></div>;
}
export default function StudentStatsTableView({studentMatrix=[],missions:initialMissions=[]}) {
  const {classId}=useUser();
  const today=formatDayKey(new Date());
  const roster=useMemo(()=>studentMatrix.filter(s=>s.role!=='teacher'&&s.role!=='admin'),[studentMatrix]);
  const [range,setRange]=useState({start:shift(today,-30),end:shift(today,-1)});
  const [draft,setDraft]=useState(range);
  const [error,setError]=useState('');
  const [scope,setScope]=useState('all');
  const [query,setQuery]=useState('');
  const [sort,setSort]=useState('number');
  const [selected,setSelected]=useState(null);
  const [detailDate,setDetailDate]=useState('all');
  const detailRef=useRef(null);
  const selectionTriggerRef=useRef(null);
  function openDetail(studentId,date,trigger) {
    selectionTriggerRef.current=trigger;
    setSelected(studentId);setDetailDate(date);
    if(studentId===selected&&date===detailDate&&detailRef.current){
      detailRef.current.focus({preventScroll:true});
      if(window.matchMedia?.('(max-width:950px)').matches)detailRef.current.scrollIntoView({block:'start'});
    }
  }
  function closeDetail() {
    setSelected(null);
    if(selectionTriggerRef.current?.isConnected)selectionTriggerRef.current.focus();
  }
  const rangeDays=days(range.start,range.end);
  const previous=previousRange(range);
  const catalog=useTeacherMissionDashboardRQ(classId,{rangeStart:previous.start,loadAllRawMissions:true,studentUids:roster.map(s=>s.uid),rosterReady:true});
  // The catalog hook returns a new array on every render; preserve identity until content changes.
  const catalogSignature=JSON.stringify(catalog.allRawMissions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const missions=useMemo(()=>catalog.allRawMissions.length?catalog.allRawMissions:initialMissions,[catalogSignature,initialMissions]);
  const analytics=useMissionAnalyticsDailyRQ({classId,dateFrom:previous.start,dateTo:range.end,enabled:!!classId&&roster.length>0});
  const rows=useMemo(()=>roster.map(student=>{
    const current=buildStudentMetrics(student,range,scope,missions,analytics.dailyRows); const prev=buildStudentMetrics(student,previous,scope,missions,analytics.dailyRows);
    const field=scope==='general'?'participation':'consistency';
    return {...current,comparisonLabel:fmt(previous.start)+'–'+fmt(previous.end),change:current[field]===null||prev[field]===null?null:current[field]-prev[field],changeField:field};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[range,scope,roster,missions,analytics.dailyRows]);
  const visible=rows.filter(row=>`${row.student.name} ${row.student.number}`.includes(query.trim())).sort((a,b)=>sort==='change'?(a.change??Infinity)-(b.change??Infinity):sort==='submitted'?b.submitted-a.submitted:sort==='consistency'?(b.consistency??-1)-(a.consistency??-1):a.student.number-b.student.number);
  const detail=rows.find(row=>row.student.id===selected);
  const history=useMissionStatsHistory({classId,student:catalog.loadingAllRaw||analytics.loadingDailyRows?null:detail?.student,missions,range,scope});
  useEffect(()=>{
    if(!selected||!detailRef.current)return;
    detailRef.current.focus({preventScroll:true});
    if(window.matchMedia?.('(max-width:950px)').matches)detailRef.current.scrollIntoView({block:'start'});
  },[selected,detailDate]);
  useEffect(()=>{
    // Reposition after async records enlarge the panel without taking focus again.
    if(!history.loading&&detailRef.current?.contains(document.activeElement)&&window.matchMedia?.('(max-width:950px)').matches){
      detailRef.current.scrollIntoView({block:'start'});
    }
  },[history.loading]);
  const avg=field=>{const values=rows.map(row=>row[field]).filter(v=>v!==null);return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null;};
  const total=field=>rows.reduce((sum,row)=>sum+row[field],0);
  const incomplete=rows.some(row=>row.missingDays.length>0);
  const chart=rangeDays.map(key=>({key,missing:rows.some(row=>row.missingDays.includes(key)),count:rows.reduce((sum,row)=>sum+row.selected.filter(e=>e.date===key).reduce((count,e)=>count+(e.count||1),0),0)}));
  const max=Math.max(...chart.map(day=>day.count),1);
  const detailRows=history.records.filter(e=>detailDate==='all'||e.date===detailDate).sort((a,b)=>`${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))||[];
  const isPresetRange=length=>range.start===shift(today,-length)&&range.end===shift(today,-1);
  const hasUnappliedRange=draft.start!==range.start||draft.end!==range.end;
  function applyRange(next=draft) {
    if(!next.start||!next.end||next.start>next.end) {setError('시작일과 종료일을 확인해 주세요. 이전 조회 결과는 유지됩니다.');return;}
    if(next.end>today||days(next.start,next.end).length>90) {setError('오늘까지 최대 90일의 기간을 선택해 주세요.');return;}
    setRange({...next});setDraft({...next});setDetailDate('all');setError('');
  }
  return <main className={`stats-demo scope-${scope}`}>

    <form className="stats-filters" aria-label="과제 통계 조회 조건" onSubmit={event=>{event.preventDefault();applyRange();}}>
      <fieldset className="stats-filter-group">
        <legend>기간 선택</legend>
        <div className="period-controls">
          <label>시작일<input className="text-sm text-slate-700" type="date" value={draft.start} max={today} aria-invalid={Boolean(error)} aria-describedby={error?'mission-period-help mission-period-error':'mission-period-help'} onInput={e=>{const value=e.currentTarget.value;setDraft(prev=>({...prev,start:value}));}}/></label>
          <label>종료일<input className="text-sm text-slate-700" type="date" value={draft.end} max={today} aria-invalid={Boolean(error)} aria-describedby={error?'mission-period-help mission-period-error':'mission-period-help'} onInput={e=>{const value=e.currentTarget.value;setDraft(prev=>({...prev,end:value}));}}/></label>
          <Button type="submit" size="sm" className="stats-apply">조회</Button>
        </div>
        <div className="quick-periods" role="group" aria-label="빠른 기간 선택">
          <Button size="sm" variant={isPresetRange(7)?'primary':'outline'} aria-pressed={isPresetRange(7)} onClick={()=>applyRange({start:shift(today,-7),end:shift(today,-1)})}>최근 7일</Button>
          <Button size="sm" variant={isPresetRange(30)?'primary':'outline'} aria-pressed={isPresetRange(30)} onClick={()=>applyRange({start:shift(today,-30),end:shift(today,-1)})}>최근 30일</Button>
        </div>
        <p id="mission-period-help" className="filter-help">{hasUnappliedRange?'입력한 기간은 아직 적용되지 않았습니다. 조회를 눌러 적용하세요.':'날짜 입력 후 조회를 눌러 적용하세요. 최근 7일·30일은 어제까지의 기간입니다.'}</p>
      </fieldset>
      <fieldset className="stats-filter-group">
        <legend>과제 범위</legend>
        <div className="scope-controls">{[['all','전체 과제'],['general','일반 과제'],['always','상시 과제']].map(([key,label])=><Button key={key} size="sm" variant="secondary" aria-pressed={scope===key} className={scope===key?'scope-active':''} onClick={()=>{setScope(key);setDetailDate('all');}}>{label}</Button>)}</div>
        <label className="mission-scope-label">상시 과제별<select className="text-sm text-slate-700" aria-label="상시 과제별 통계" value={scope.startsWith('always:')?scope:''} onChange={event=>{setScope(event.target.value||'always');setDetailDate('all');}}><option value="">전체 상시 과제</option>{missions.filter(m=>m.type==='always').map(m=><option key={m.id} value={`always:${m.id}`}>{m.title}</option>)}</select></label>
      </fieldset>
      {error&&<p id="mission-period-error" role="alert" className="range-error">{error}</p>}
    </form>
    <div className="applied-range" aria-live="polite"><p>집계 기간 {range.start.replaceAll('-','.')} ~ {range.end.replaceAll('-','.')}</p><span>변화 비교: {fmt(previous.start)} ~ {fmt(previous.end)} · 같은 길이의 이전 기간</span></div>
    {catalog.error ? <ErrorState variant="section" title="과제 목록을 불러오지 못했습니다." onReload={()=>window.location.reload()}/> : analytics.error ? <ErrorState variant="section" title="과제 집계를 불러오지 못했습니다." onRetry={analytics.retry}/> : (catalog.loadingAllRaw||analytics.loadingDailyRows) ? <SectionLoader message="과제 통계를 불러오는 중입니다."/> : <>
    <p className="stats-source-note">상시 과제는 일일 집계 기준이며 이후 승인에 따라 원본 상세와 차이가 있을 수 있습니다. 집계가 없는 운영일은 꾸준함·변화 계산을 보류합니다.</p>
    <section className="summary-grid" aria-label="학급 요약">
      {[{icon:Users,label:'평균 참여율',value:display(avg('participation')),sub:'일반 과제 · 제출한 과제 / 배정 과제'},{icon:CalendarDays,label:'평균 꾸준함',value:display(avg('consistency')),sub:'상시 과제 · 제출한 날 / 운영일'},{icon:BarChart3,label:'수행량',value:incomplete?'집계 미완료':`${total('submitted')}건`,sub:incomplete?'집계가 없는 운영일이 있습니다.':`완료 ${display(percent(total('approved'),total('submitted')))} (${total('approved')}/${total('submitted')}건) · 대기 ${total('pending')} · 기타 ${total('rejected')}`},{icon:TrendingUp,label:'개인 변화',value:`${rows.filter(r=>r.change>0).length}명 상승`,sub:`${scope==='general'?'참여율':'꾸준함'} 기준 · 하락 ${rows.filter(r=>r.change<0).length}명 · 동일 ${rows.filter(r=>r.change===0).length}명`}].map(card=><article key={card.label}><div className="metric-label"><card.icon size={17}/>{card.label}</div><strong>{card.value}</strong><p>{card.sub}</p></article>)}
    </section>
    <div className={`stats-workspace ${detail?'has-detail':''}`}>
      <section className="stats-main">
        <div className="students-panel"><div className="section-heading"><div><h2 id="mission-students-title">학생별 통계 <small>{visible.length}명</small></h2><p className="table-caption">{scope==='general'?'참여율':'꾸준함'}과 이전 기간의 변화를 함께 살펴보세요.</p></div><div className="table-tools"><label className="search-field"><Search size={16}/><input className="text-sm text-slate-700" aria-label="학생 이름 또는 번호 검색" placeholder="이름 또는 번호" value={query} onChange={e=>setQuery(e.target.value)}/></label><select className="text-sm text-slate-700" aria-label="학생 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="number">번호순</option><option value="change">변화 하락순</option><option value="submitted">수행량순</option><option value="consistency">꾸준함순</option></select></div></div>
        <div className="table-scroll" role="region" aria-labelledby="mission-students-title" tabIndex={0}><table><caption className="sr-only">학생별 참여율, 꾸준함, 수행량과 이전 기간 변화</caption><thead><tr><th scope="col">학생</th><th scope="col">참여율</th><th scope="col">꾸준함</th><th scope="col">수행량</th><th scope="col">개인 변화<small className="change-period">{fmt(previous.start)}–{fmt(previous.end)} 대비</small></th></tr></thead><tbody>{visible.map(row=><tr key={row.student.id} className={selected===row.student.id?'selected-row':''}><td><button className="student-select" aria-pressed={selected===row.student.id} aria-controls="mission-student-detail" onClick={event=>openDetail(row.student.id,'all',event.currentTarget)}><span className="student-number">{row.student.number}</span><strong>{row.student.name}</strong><ChevronRight size={14}/></button></td><td><Meter value={row.participation} detail={scope==='always'||scope.startsWith('always:')?'일반 과제 지표':`${row.submittedGeneral}/${row.assigned}개 제출`}/></td><td><Meter value={row.consistency} detail={scope==='general'?'상시 과제 지표':`${row.activeDays}/${row.available}일 참여`}/></td><td className="volume-cell">{row.missingDays.length>0?<span className="neutral">집계 미완료</span>:<><strong>{row.submitted}<span>건 제출</span></strong><small className="cell-sub completion-rate" title="제출 중 승인 완료 비율 · 교사의 승인 시점에 영향을 받습니다">완료 {display(percent(row.approved,row.submitted))} <span>({row.approved}/{row.submitted}건)</span></small><small className="cell-sub">{row.pending>0&&<span className="pending-note"> · 대기 {row.pending}</span>}{row.rejected>0&&<span> · 기타 {row.rejected}</span>}</small></>}</td><td><ChangeLabel row={row}/></td></tr>)}</tbody></table>{!visible.length&&<div className="empty-state"><p>{query.trim()?'검색된 학생이 없습니다. 이름이나 번호를 다시 확인해 주세요.':'통계를 표시할 학생이 없습니다. 학급 학생 등록 상태를 확인해 주세요.'}</p>{query.trim()&&<Button variant="outline" size="sm" onClick={()=>setQuery('')}>검색 초기화</Button>}</div>}</div>
        </div>
        <div className="daily-chart"><div className="section-heading"><h2>날짜별 제출</h2><span>{incomplete?'일부 날짜 집계 미완료':`전체 학생 · ${total('submitted')}건`}</span></div><div className="bars" role="group" aria-label="날짜별 제출 기록" style={{gridTemplateColumns:`repeat(${chart.length},minmax(22px,1fr))`}}>{chart.map(({key,count,missing})=><button key={key} className={`bar-column ${detailDate===key?'chosen':''}`} aria-pressed={detailDate===key} aria-label={`${key} ${missing?'집계 없음':'제출 '+count+'건'}, 학생 상세 날짜 선택`} aria-controls="mission-student-detail" onClick={event=>openDetail(selected||roster[0]?.uid,key,event.currentTarget)}><b>{missing?'—':count||''}</b><div className="bar-space"><i style={{height:`${missing?0:count/max*100}%`}}/></div><small>{key.slice(8)}</small></button>)}</div><p className="chart-caption">날짜를 누르면 학생 상세에서 해당 날짜의 기록을 확인할 수 있어요.</p></div>
        <details className="metric-definitions"><summary>지표는 어떻게 계산하나요?</summary><p>참여율은 기간에 배정된 일반 과제 중 한 번 이상 제출한 과제의 비율입니다. 반려된 제출도 참여에 포함합니다. 꾸준함은 상시 과제를 제출한 운영일의 비율이며, 하루에 여러 번 제출해도 하루로 계산합니다.</p><p>수행량은 제출 건수입니다. 같은 날 추가 제출도 포함합니다. 완료율은 제출 중 승인 완료된 비율이며, 교사의 승인 시점에 영향을 받습니다. 승인 대기와 기타 상태(반려·취소 등)를 함께 표시합니다. 일반 과제 수행량·내역은 현재 저장된 제출 기록 기준으로, 재제출 이전의 변경 이력을 포함하지 않습니다. 개인 변화는 조회 시작일 바로 전까지의 같은 길이 기간과 비교한 비율 차이(%p)입니다. 예: 9월 21~30일 조회 시 9월 11~20일과 비교합니다. 두 기간의 운영일 수는 다를 수 있습니다. 상시 과제의 운영 요일과 시작·종료일을 반영하며, 여러 상시 과제를 같은 날 제출해도 꾸준함은 하루로 계산합니다. 일반 과제의 참여율 분모는 현재 목록에서 기간 중 수행 가능한 배정 과제입니다.</p></details>
      </section>
      {detail&&<aside id="mission-student-detail" ref={detailRef} tabIndex={-1} className="student-detail" aria-label="학생 상세"><div className="detail-title"><div><p className="eyebrow">{detail.student.number}번 · 학생 상세</p><h2>{detail.student.name}</h2></div><Button variant="secondary" size="icon-sm" className="stats-detail-close" aria-label="학생 상세 닫기" onClick={closeDetail}><X size={17}/></Button></div><p className="detail-period">{fmt(range.start)} — {fmt(range.end)} · 기간 전체</p>
        <div className="detail-context"><ChangeLabel row={detail}/>{detail.missingDays.length>0&&<p>집계 없는 운영일 {detail.missingDays.length}일 · 아래는 원본 기록</p>}<p>{scope==='general'?'일반 과제 '+detail.submittedGeneral+'/'+detail.assigned+'개 제출':'상시 과제 '+detail.activeDays+'/'+detail.available+'일 참여'}</p></div>
        <div className="history-heading"><h3>제출 기록</h3><label>날짜<select className="text-sm text-slate-700" aria-label="학생 기록 날짜" value={detailDate} onChange={e=>setDetailDate(e.target.value)}><option value="all">기간 전체</option>{rangeDays.map(key=><option key={key} value={key}>{fmt(key)}</option>)}</select></label></div>{!history.loading&&!history.error&&<div className="history-total"><div><span>{detailDate==='all'?'기간 전체':fmt(detailDate)} 제출</span><strong>{detailRows.length}<small>건</small></strong></div><p>완료 {detailRows.filter(e=>isCompleted(e.status)).length} · <span className="pending-note">대기 {detailRows.filter(e=>e.status==='pending').length}</span> · 반려 {detailRows.filter(e=>e.status==='rejected').length}</p></div>}
        <div className="history-list">{history.error?<ErrorState variant="section" title="제출 기록을 불러오지 못했습니다." description={history.error.message} onRetry={history.retry}/>:history.loading?<SectionLoader message="제출 기록을 불러오는 중입니다."/>:<>{detailRows.map(event=><article key={event.id}><div className="history-date">{fmt(event.date)} <span>{event.time} 제출</span></div><div className="history-record"><div><small>{event.type==='always'?'상시 과제':'일반 과제'}</small><h4>{event.title}</h4></div><span className={`status ${event.status}`}>{isCompleted(event.status)&&<Check size={12}/>} {statusText[event.status]||'상태 확인 필요'}</span></div></article>)}{!history.loading&&!detailRows.length&&<p className="empty-state">선택한 날짜에 제출한 기록이 없습니다.<br/><Button variant="secondary" size="sm" onClick={()=>setDetailDate('all')}>기간 전체 보기</Button></p>}</>}</div>
      </aside>}
    </div>
    </>}
  </main>;
}
