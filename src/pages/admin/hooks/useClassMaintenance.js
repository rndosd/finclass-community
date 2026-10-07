import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";

const CALLABLES = {
  delete: "deleteStudentAccounts",
  activity: "resetClassActivityData",
  full: "resetMyClassData",
};

export default function useClassMaintenance(classId, showFeedback) {
  const [pending, setPending] = useState(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [completedOperationId, setCompletedOperationId] = useState(null);
  const busyRef = useRef(false);
  const requestRef = useRef(null);
  const scopeRef = useRef(classId);
  scopeRef.current = classId;

  const refreshState = useCallback(async () => {
    const response = await httpsCallable(functions, "getClassMaintenanceState")({ classId });
    const state = response.data;
    if (scopeRef.current === classId) {
      setPending(state.active ? state : null);
      if (!state.active && state.status === "completed") setCompletedOperationId(state.operationId);
    }
    return state;
  }, [classId]);

  useEffect(() => {
    let alive = true;
    setChecking(true);
    setPending(null);
    setCompletedOperationId(null);
    requestRef.current = null;
    busyRef.current = false;
    setBusy(false);
    if (!classId) { setChecking(false); return undefined; }
    httpsCallable(functions, "getClassMaintenanceState")({ classId })
      .then(({ data }) => { if (alive) { setPending(data.active ? data : null); setChecking(false); } })
      .catch(() => {
        if (alive) showFeedback("데이터 정리 상태를 확인하지 못했습니다. 상태 확인을 다시 눌러 주세요.", "error");
      });
    return () => { alive = false; };
  }, [classId, showFeedback]);

  const pendingOperationId = pending?.operationId;
  const pendingStatus = pending?.status;
  // Refresh leases/completion automatically after a timed-out request.
  useEffect(() => {
    if (!classId || busy || !pendingOperationId || pendingStatus === "unknown" || pendingStatus === "failed") return undefined;
    let alive = true;
    let timer;
    const poll = async () => {
      try {
        const { data } = await httpsCallable(functions, "getClassMaintenanceState")({ classId });
        if (!alive) return;
        setPending(data.active ? data : null);
        if (!data.active) {
          requestRef.current = null;
          if (data.status === "completed" && data.operationId === pendingOperationId) setCompletedOperationId(data.operationId);
          return;
        }
      } catch { /* Keep the saved operation available for manual status checks. */ }
      if (alive) timer = window.setTimeout(poll, 5000);
    };
    timer = window.setTimeout(poll, 5000);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [classId, busy, pendingOperationId, pendingStatus]);

  const check = async () => {
    if (busyRef.current) return;
    setChecking(true);
    try { await refreshState(); if (scopeRef.current === classId) setChecking(false); }
    catch { showFeedback("데이터 정리 상태를 확인하지 못했습니다.", "error"); }
  };

  const execute = async (type, payload = {}, retry = false) => {
    if (busyRef.current || checking || (!retry && pending)) return null;
    const operationId = retry ? pending?.operationId : window.crypto.randomUUID();
    const request = retry && requestRef.current?.operationId === operationId
      ? requestRef.current
      : { classId, operationId, ...payload };
    requestRef.current = request;
    busyRef.current = true;
    setBusy(true);
    setPending({ type, operationId, status: "running", active: true });
    try {
      const response = await httpsCallable(functions, CALLABLES[type], { timeout: 560000 })(request);
      if (scopeRef.current !== classId) return null;
      setPending(null);
      requestRef.current = null;
      const message = type === "delete" ? "선택한 학생 계정을 삭제했습니다."
        : type === "activity" ? "명단과 로그인 계정을 유지하고 활동 기록을 초기화했습니다."
          : "학급 전체 초기화를 완료했습니다.";
      showFeedback(message, "success");
      return { ...response.data, message };
    } catch (error) {
      if (scopeRef.current !== classId) return null;
      try {
        const state = await refreshState();
        if (scopeRef.current !== classId) return null;
        if (!state.active && state.operationId === operationId && state.status === "completed") {
          requestRef.current = null;
          showFeedback("데이터 정리 작업이 완료되었습니다.", "success");
          return { success: true };
        }
        if (!state.active) {
          if (["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(error.code) && state.operationId !== operationId) {
            setPending(null);
            requestRef.current = null;
          } else setPending({ type, operationId, status: "unknown", active: true });
        }
      } catch {
        setPending({ type, operationId, status: "unknown", active: true });
      }
      const messages = {
        "functions/unauthenticated": "로그인이 만료되었습니다. 다시 로그인해 주세요.",
        "functions/permission-denied": "이 학급의 담당 교사 또는 관리자만 정리할 수 있습니다.",
        "functions/invalid-argument": "선택한 학생, 초기 현금, 확인용 학급 이름을 다시 확인해 주세요.",
        "functions/not-found": "학급 정보를 찾을 수 없습니다. 화면을 새로고침해 주세요.",
        "functions/failed-precondition": "진행 중인 정리 작업이나 확인이 필요한 데이터가 있습니다. 상태를 확인한 뒤 다시 시도해 주세요.",
        "functions/aborted": "이미 정리가 진행 중입니다. 잠시 후 상태를 확인해 주세요.",
        "functions/unavailable": "서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
      };
      showFeedback(messages[error.code] || "정리를 마치지 못했습니다. 상태를 확인하고 이어서 정리해 주세요.", "error");
      return null;
    } finally {
      if (scopeRef.current === classId) { busyRef.current = false; setBusy(false); }
    }
  };

  return { pending, checking, busy, execute, check, completedOperationId };
}
