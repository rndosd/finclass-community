import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { alwaysListAttempts } from '../../../services/missionAlwaysService';
import { regularRecords, inRange } from './missionStatsModel';
import { toDateSafe, formatDayKey } from './StudentStatsTableView.utils';

export function useMissionStatsHistory({classId, student, missions, range, scope}) {
  const [result,setResult] = useState({key:null,records:[],loading:false,error:null});
  const [refresh,setRefresh] = useState(0);
  const key = `${classId}/${student?.uid}/${range.start}/${range.end}/${scope}`;
  useEffect(()=>{
    if (!classId || !student?.uid) return undefined;
    let active=true;
    setResult({key,records:[],loading:true,error:null});
    async function load() {
      const records=regularRecords(student,missions,range,scope);
      for (const mission of missions.filter(m=>m.type==='always' && scope!=='general' && (scope==='all'||scope==='always'||scope===`always:${m.id}`))) {
        let cursor=null;
        let complete=false;
        for(let page=0;page<20;page+=1) {
          if (!active) return;
          const response=await alwaysListAttempts({classId,missionId:mission.id,studentUid:student.uid,dateFrom:range.start,dateTo:range.end,limit:100,cursor,view:'attempts'});
          for(const attempt of response.attempts || []) {
            const submitted=toDateSafe(attempt.submittedAt || attempt.createdAt || attempt.createdAtMs);
            const date=attempt.dayKey || (submitted ? formatDayKey(submitted) : null);
            if (date && inRange(date,range)) records.push({id:`${mission.id}:${attempt.id || attempt.attemptId}`,title:mission.title,type:'always',date,time:submitted?dayjs(submitted).tz('Asia/Seoul').format('HH:mm'):'시각 없음',status:attempt.status || 'pending'});
          }
          if (!response.hasMore) {complete=true;break;}
          if (!response.nextCursor || JSON.stringify(cursor)===JSON.stringify(response.nextCursor)) throw new Error('제출 기록의 다음 페이지를 확인하지 못했습니다.');
          cursor=response.nextCursor;
        }
        if (!complete) throw new Error('기록이 많습니다. 날짜 범위를 줄여 다시 조회해 주세요.');
      }
      if(active) setResult({key,records:[...new Map(records.map(row=>[row.id,row])).values()],loading:false,error:null});
    }
    load().catch(error=>{if(active)setResult({key,records:[],loading:false,error});});
    return ()=>{active=false;};
  },[classId,key,student,missions,range,scope,refresh]);
  return {records:result.key===key?result.records:[],loading:!!student&&(result.key!==key||result.loading),error:result.key===key?result.error:null,retry:()=>setRefresh(value=>value+1)};
}
