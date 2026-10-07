import dayjs from 'dayjs';
import { formatDayKey, isMissionAssignedToStudent, toDateSafe } from './StudentStatsTableView.utils';

export const percent = (n, d) => d > 0 ? Math.min(100, Math.round(n / d * 100)) : null;
export const shift = (key, n) => dayjs(key).add(n, 'day').format('YYYY-MM-DD');
export function days(start, end) {
  const result = [];
  for (let key = start; key <= end; key = shift(key, 1)) result.push(key);
  return result;
}
export const previousRange = range => ({start:shift(range.start, -days(range.start, range.end).length), end:shift(range.start, -1)});
export const inRange = (key, range) => key >= range.start && key <= range.end;
const dateKey = value => {
  const date = toDateSafe(value);
  return date ? formatDayKey(date) : null;
};
const approved = status => ['approved','late-approved','completed'].includes(status);
function overlaps(mission, range) {
  const start = dateKey(mission.timeWindow?.start || mission.createdAt);
  const end = dateKey(mission.timeWindow?.end || mission.dueAt);
  return (!start || start <= range.end) && (!end || end >= range.start);
}
function operates(mission, key) {
  const weekdays = mission.availability?.daysOfWeek;
  const allowed = Array.isArray(weekdays) && weekdays.length ? weekdays.map(Number) : [1,2,3,4,5];
  return allowed.includes(dayjs(key).day()) && overlaps(mission, {start:key,end:key});
}
export function regularRecords(student, missions, range, scope) {
  if (scope === 'always' || scope.startsWith('always:')) return [];
  return missions.filter(m => m.type !== 'always').flatMap(mission => {
    const row = mission.completions?.[student.uid];
    // Use submission time: a later approval must not move participation to another day.
    const time = row?.submittedAt || row?.createdAt;
    const key = dateKey(time);
    if (!key || !inRange(key,range)) return [];
    return [{id:`general:${mission.id}`,missionId:mission.id,title:mission.title,type:'general',date:key,time:dayjs(toDateSafe(time)).tz('Asia/Seoul').format('HH:mm'),status:row.status || 'pending',count:1}];
  });
}
export function buildStudentMetrics(student, range, scope, missions, dailyRows) {
  const general = scope === 'always' || scope.startsWith('always:') ? [] : missions.filter(m => m.type !== 'always' && overlaps(m,range) && isMissionAssignedToStudent(m,student,student.uid));
  const always = scope === 'general' ? [] : missions.filter(m => m.type === 'always' && (scope === 'all' || scope === 'always' || scope === `always:${m.id}`) && isMissionAssignedToStudent(m,student,student.uid));
  const alwaysIds = new Set(always.map(m => m.id));
  const availableDays = days(range.start, range.end).filter(key => always.some(m => operates(m,key)));
  const knownDays = new Set(dailyRows.map(row => row.date));
  const missingDays = availableDays.filter(key => !knownDays.has(key));
  const activeDays = new Set();
  const selected = regularRecords(student,missions,range,scope);
  let submitted = selected.length;
  let completed = selected.filter(row=>approved(row.status)).length;
  let pending = selected.filter(row=>row.status==='pending').length;
  let other = selected.filter(row=>!approved(row.status)&&row.status!=='pending').length;
  for (const daily of dailyRows) {
    if (!inRange(daily.date,range)) continue;
    for (const [id, entry] of Object.entries(daily.byStudentMission?.[student.uid] || {})) {
      if (entry.type !== 'always' || !alwaysIds.has(id)) continue;
      const count = Math.max(0,Number(entry.attemptCount || entry.eventCount || 0));
      const done = Math.min(count,Math.max(0,Number(entry.approvedCount || 0)));
      const wait = Math.min(count-done,Math.max(0,Number(entry.pendingCount || 0)));
      submitted += count; completed += done; pending += wait; other += count-done-wait;
      if (count > 0) {
        if (availableDays.includes(daily.date)) activeDays.add(daily.date);
        selected.push({id:`daily:${id}:${daily.date}`,missionId:id,title:entry.title,type:'always',date:daily.date,count});
      }
    }
  }
  const submittedGeneral = new Set(selected.filter(row=>row.type==='general' && general.some(m=>m.id===row.missionId)).map(row=>row.missionId)).size;
  return {student:{...student,id:student.uid,number:student.studentNumber},selected,submittedGeneral,assigned:general.length,activeDays:activeDays.size,available:availableDays.length,participation:percent(submittedGeneral,general.length),consistency:missingDays.length ? null : percent(activeDays.size,availableDays.length),submitted,approved:completed,pending,rejected:other,missingDays};
}
