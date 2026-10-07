import { useCallback, useState } from "react";

// React Query's initialData is empty before the Firestore subscription answers.
// Keep that pending state and subscription errors separate from a real empty list.
export default function useLiveQueryStatus(queryKey, enabled) {
  const scope = JSON.stringify(queryKey);
  const [snapshot, setSnapshot] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const onSuccess = useCallback(() => setSnapshot({ scope, error: null }), [scope]);
  const onError = useCallback(error => setSnapshot({ scope, error }), [scope]);
  const retrySnapshot = useCallback(() => {
    setSnapshot(null);
    setRetryCount(count => count + 1);
  }, []);
  return {
    retryCount, onSuccess, onError, retrySnapshot,
    snapshotLoading: Boolean(enabled && snapshot?.scope !== scope),
    snapshotError: enabled && snapshot?.scope === scope ? snapshot.error : null,
  };
}
