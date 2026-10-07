import { useEffect, useMemo, useState } from "react";
import { subscribeCaseLibraryRequests } from "../services/caseLibraryRequestService";

export default function useCaseLibraryRequests(classId, options = {}) {
  const scope = options?.scope === "shared" ? "shared" : "class";
  const isSharedScope = scope === "shared";
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(classId || isSharedScope));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isSharedScope && !classId) {
      setRequests([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    return subscribeCaseLibraryRequests({
      classId,
      scope,
      onChange: (nextRequests) => {
        setRequests(Array.isArray(nextRequests) ? nextRequests : []);
        setLoading(false);
      },
      onError: (nextError) => {
        console.error("[useCaseLibraryRequests] subscribe failed:", nextError);
        setRequests([]);
        setError(nextError);
        setLoading(false);
      },
    });
  }, [classId, isSharedScope, scope]);

  return useMemo(
    () => ({
      error,
      loading,
      requests,
    }),
    [error, loading, requests],
  );
}
