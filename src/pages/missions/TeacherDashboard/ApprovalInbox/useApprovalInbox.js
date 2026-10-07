import { useEffect, useMemo, useState } from "react";
import { collection, doc, documentId, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../../firebase";
import { getMissionReadProvider } from "../../services/missionReadService";
import { buildPendingGroups, requestKey, studentUid } from "./approvalInboxModel";
const EMPTY = [];
export function useApprovalInbox({
  classId,
  students = EMPTY,
  missions = EMPTY,
  enabled,
  refreshKey = 0,
  scopedMissionId = null
}) {
  const selfhost = false;
  const studentKey = [...new Set(students.map(studentUid).filter(Boolean))].sort().join("\u0001");
  const key = `${classId}/${studentKey}/${scopedMissionId || "all"}/${refreshKey}`;
  const [data, setData] = useState({
    key: "",
    states: [],
    ready: false,
    error: null
  });
  useEffect(() => {
    if (!enabled || !classId || !studentKey || selfhost) return undefined;
    const byStudent = new Map();
    const pending = new Set(studentKey.split("\u0001"));
    let active = true;
    let failure = null;
    const emit = () => active && setData({
      key,
      states: [...byStudent.values()].flat(),
      ready: pending.size === 0,
      error: failure
    });
    const stops = studentKey.split("\u0001").map(uid => onSnapshot(scopedMissionId ? doc(db, `classes/${classId}/students/${uid}/missionState/${scopedMissionId}`) : query(collection(db, `classes/${classId}/students/${uid}/missionState`), where("pendingCount", ">", 0)), snapshot => {
      const docs = scopedMissionId ? snapshot.exists() ? [snapshot] : [] : snapshot.docs;
      byStudent.set(uid, docs.map(item => ({
        ...item.data(),
        missionId: item.id,
        studentUid: uid
      })));
      pending.delete(uid);
      emit();
    }, error => {
      failure = error;
      pending.delete(uid);
      emit();
    }));
    return () => {
      active = false;
      stops.forEach(stop => stop());
    };
  }, [enabled, classId, studentKey, key, selfhost, scopedMissionId]);
  const states = enabled && data.key === key ? data.states : EMPTY;
  // Old pending requests must stay visible even when the ordinary catalog's
  // date window excludes the task. Fetch just those referenced common docs.
  const missingKey = [...new Set(states.map(state => state.missionId))].filter(id => !missions.some(mission => mission.id === id)).sort().join("\u0001");
  const extraKey = `${classId}/${missingKey}`;
  const [extra, setExtra] = useState({
    key: "",
    missions: [],
    ready: false,
    error: null
  });
  useEffect(() => {
    if (!enabled || !classId || !missingKey) return undefined;
    const ids = missingKey.split("\u0001");
    const parts = new Map();
    const pending = new Set();
    let active = true;
    const lifecycle = {
      failure: null
    };
    for (let offset = 0; offset < ids.length; offset += 30) pending.add(offset);
    const emit = () => active && setExtra({
      key: extraKey,
      missions: [...parts.values()].flat(),
      ready: !pending.size,
      error: lifecycle.failure
    });
    const stops = [];
    for (let offset = 0; offset < ids.length; offset += 30) {
      stops.push(onSnapshot(query(collection(db, `classes/${classId}/missions`), where(documentId(), "in", ids.slice(offset, offset + 30))), snapshot => {
        parts.set(offset, snapshot.docs.map(item => ({
          ...item.data(),
          id: item.id,
          classId
        })));
        pending.delete(offset);
        emit();
      }, error => {
        lifecycle.failure = error;
        pending.delete(offset);
        emit();
      }));
    }
    return () => {
      active = false;
      stops.forEach(stop => stop());
    };
  }, [enabled, classId, missingKey, extraKey, refreshKey]);
  const allMissions = useMemo(() => [...missions, ...(extra.key === extraKey ? extra.missions : EMPTY)].filter(mission => !scopedMissionId || mission.id === scopedMissionId), [missions, extra, extraKey, scopedMissionId]);
  const groups = useMemo(() => buildPendingGroups(allMissions, states, students), [allMissions, states, students]);
  return {
    groups,
    selfhost,
    loading: enabled && !!classId && !selfhost && !!studentKey && (data.key !== key || !data.ready || missingKey && (extra.key !== extraKey || !extra.ready)),
    error: data.key === key && data.error || extra.key === extraKey && extra.error || null
  };
}
export function usePendingAlwaysRows({
  classId,
  group,
  expanded,
  pageSize = 50,
  students
}) {
  const missionId = group.mission.id;
  const studentKey = group.states.map(state => state.studentUid).sort().join("\u0001");
  const key = `${classId}/${missionId}/${studentKey}/${pageSize}`;
  const [data, setData] = useState({
    key: "",
    rows: [],
    ready: false,
    hasMore: false,
    error: null
  });
  useEffect(() => {
    if (!expanded || !studentKey || !classId) return undefined;
    const parts = new Map();
    const pending = new Set(studentKey.split("\u0001"));
    let active = true;
    let failure = null;
    const emit = () => active && setData({
      key,
      rows: [...parts.values()].flat(),
      ready: !pending.size,
      hasMore: [...parts.values()].some(rows => rows.length >= pageSize),
      error: failure
    });
    const stops = studentKey.split("\u0001").map(uid => onSnapshot(query(collection(db, `classes/${classId}/students/${uid}/missionState/${missionId}/attempts`), where("status", "==", "pending"), limit(pageSize)), snapshot => {
      parts.set(uid, snapshot.docs.map(item => ({
        ...item.data(),
        id: item.id,
        uid,
        attemptId: item.id,
        key: requestKey(missionId, uid, item.id)
      })));
      pending.delete(uid);
      emit();
    }, error => {
      failure = error;
      pending.delete(uid);
      emit();
    }));
    return () => {
      active = false;
      stops.forEach(stop => stop());
    };
  }, [classId, expanded, studentKey, missionId, pageSize, key]);
  const rows = useMemo(() => data.key === key ? data.rows.map(row => ({
    ...row,
    student: students.find(student => studentUid(student) === row.uid) || {
      name: row.studentName || "학생"
    },
    submittedAt: row.createdAt,
    preview: row.contentPreview || ""
  })).sort((a, b) => (a.dayKey || "").localeCompare(b.dayKey || "") || (a.student.name || "").localeCompare(b.student.name || "", "ko")) : EMPTY, [data, key, students]);
  return {
    rows,
    loading: expanded && studentKey && (data.key !== key || !data.ready),
    hasMore: data.key === key && data.hasMore,
    error: data.key === key ? data.error : null
  };
}
export function useInboxSubmission(classId, mission, row) {
  const key = row?.key;
  const [data, setData] = useState({
    key: "",
    submission: null,
    loading: false,
    error: null
  });
  useEffect(() => {
    if (!row || !mission || !classId) return undefined;
    if (mission.type === "always" || !row.submissionId) return undefined;
    setData({
      key,
      submission: null,
      loading: true,
      error: null
    });
    return onSnapshot(doc(db, `classes/${classId}/missions/${mission.id}/submissions/${row.submissionId}`), snapshot => setData({
      key,
      submission: snapshot.exists() ? {
        ...snapshot.data(),
        id: snapshot.id
      } : null,
      loading: false,
      error: snapshot.exists() ? null : new Error("제출물을 찾을 수 없습니다.")
    }), error => setData({
      key,
      submission: null,
      loading: false,
      error
    }));
  }, [classId, mission, row, key]);
  if (mission?.type === "always") return {
    submission: row,
    loading: false,
    error: null
  };
  if (!row?.submissionId) return {
    submission: row,
    loading: false,
    error: mission?.requireSubmissionForm || mission?.type === "challenge" ? new Error("제출물 참조가 없습니다. 과제별 보기에서 기록을 확인해주세요.") : null
  };
  return data.key === key ? data : {
    submission: null,
    loading: true,
    error: null
  };
}
