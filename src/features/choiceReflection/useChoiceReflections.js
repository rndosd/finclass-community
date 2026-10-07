import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "../../contexts/UserContext";
import { buildChoiceEntry } from "./choiceReflectionModel";
import { listChoiceReflections, saveChoiceReflection } from "./choiceReflectionService";

export function useChoiceReflections(domain, excluded = false) {
  const { classId, userData, isTeacher } = useUser();
  const uid = userData?.uid;
  const enabled = Boolean(classId && uid && userData?.role === "student" && !isTeacher && !excluded);
  const scope = useMemo(() => ({ classId, uid, domain, enabled, inflight: new Map() }), [classId, uid, domain, enabled]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [promptState, setPromptState] = useState(null);
  const [openScope, setOpenScope] = useState(null);
  const [busyState, setBusyState] = useState(null);
  const [errorState, setErrorState] = useState(null);
  const inflight = scope.inflight;
  const queryClient = useQueryClient();
  const prompt = enabled && promptState?.scope === scope ? promptState.entry : null;
  const historyOpen = enabled && openScope === scope;
  const queryKey = ["choiceReflections", classId, uid, domain];
  const history = useQuery({
    queryKey,
    queryFn: () => listChoiceReflections(uid, classId, domain),
    enabled: enabled && (historyOpen || Boolean(prompt)),
    staleTime: 60000,
  });

  const save = useCallback(async (entry, answer = {}) => {
    if (!scope.enabled || scopeRef.current !== scope) return;
    if (inflight.has(entry.id)) return inflight.get(entry.id);
    setErrorState(null);
    const task = (async () => { try {
      const saved = await saveChoiceReflection(scope.uid, scope.classId, entry, answer);
      if (scopeRef.current !== scope) return;
      setPromptState((current) => current?.scope === scope && current.entry.id === entry.id ? { scope, entry: saved } : current);
      queryClient.setQueryData(["choiceReflections", scope.classId, scope.uid, scope.domain], (records = []) =>
        [saved, ...records.filter((record) => record.id !== saved.id)].sort((a, b) => b.createdAtMs - a.createdAtMs));
      queryClient.invalidateQueries({ queryKey: ["choiceReflections", scope.classId, scope.uid, scope.domain] });
    } catch {
      if (scopeRef.current === scope) setErrorState({ scope, id: entry.id });
    } finally {
      inflight.delete(entry.id);
      if (scopeRef.current === scope) setBusyState({ scope, ids: [...inflight.keys()] });
    } })();
    inflight.set(entry.id, task);
    setBusyState({ scope, ids: [...inflight.keys()] });
    return task;
  }, [scope, inflight, queryClient]);

  const recordCompletedChoice = useCallback((input) => {
    if (!scope.enabled || scopeRef.current !== scope) return;
    const entry = buildChoiceEntry(input);
    if (!entry) return;
    setPromptState({ scope, entry });
    // Reflection failures never change the result or retry the money operation.
    void save(entry);
  }, [scope, save]);

  return {
    enabled, prompt, historyOpen,
    records: enabled ? history.data || [] : [],
    isLoading: history.isLoading,
    readError: history.error,
    retryRead: history.refetch,
    busyIds: busyState?.scope === scope ? busyState.ids : [],
    errorId: errorState?.scope === scope ? errorState.id : null,
    recordCompletedChoice, save,
    dismissPrompt: () => setPromptState(null),
    openHistory: () => setOpenScope(scope),
    closeHistory: () => setOpenScope(null),
  };
}
