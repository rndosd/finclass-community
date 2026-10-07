import { useMemo } from "react";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";
import { formatCaseDate } from "../caseLibraryPostUtils";
import useCaseLibraryPosts from "./useCaseLibraryPosts";
import useCaseLibraryRequests from "./useCaseLibraryRequests";

export default function useCaseLibraryRequestDetail(requestId, preferredClassId = "") {
  const resolvedClassId = String(preferredClassId || "").trim();
  const scope = resolvedClassId ? "class" : "shared";
  const { error: requestsError, loading: requestsLoading, requests } =
    useCaseLibraryRequests(resolvedClassId || null, { scope });
  const { error: postsError, loading: postsLoading, posts } =
    useCaseLibraryPosts(resolvedClassId || null, { scope });

  const request = useMemo(
    () => requests.find((item) => item.id === requestId) || null,
    [requestId, requests],
  );

  const linkedCases = useMemo(
    () =>
      posts.filter(
        (item) => String(item.requestId || "").trim() === String(requestId || "").trim(),
      ),
    [posts, requestId],
  );

  const pageMeta = useMemo(
    () => caseLibraryPageMeta[request?.pageType] || caseLibraryPageMeta.all,
    [request],
  );

  return {
    error: requestsError || postsError,
    linkedCases,
    loading: requestsLoading || postsLoading,
    pageMeta,
    request,
    updatedLabel: request ? formatCaseDate(request.updatedAt || request.createdAt) : "",
  };
}
