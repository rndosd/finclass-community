import { useEffect, useMemo } from "react";
import { caseLibraryPageMeta } from "../caseLibraryRegistry";
import { formatCaseDate } from "../caseLibraryPostUtils";
import { recordCaseLibraryPostView } from "../services/caseLibraryEngagementService";
import useResolvedCaseLibraryPost from "./useResolvedCaseLibraryPost";

export default function useCaseLibraryDetail(caseId) {
  const { casePost, error, loading, relatedCases } = useResolvedCaseLibraryPost(
    caseId,
    { includeRelated: true },
  );

  const pageMeta = useMemo(
    () => caseLibraryPageMeta[casePost?.pageType] || caseLibraryPageMeta.all,
    [casePost],
  );

  const updatedLabel = useMemo(
    () => (casePost ? formatCaseDate(casePost.updatedAt || casePost.createdAt) : ""),
    [casePost],
  );

  useEffect(() => {
    const sourceClassId = String(casePost?.classId || "").trim();

    if (!sourceClassId || !casePost?.id) {
      return;
    }

    recordCaseLibraryPostView(sourceClassId, casePost.id).catch((error) => {
      console.error("[useCaseLibraryDetail] record view failed:", error);
    });
  }, [casePost?.classId, casePost?.id]);

  return {
    casePost,
    error,
    loading,
    pageMeta,
    relatedCases,
    updatedLabel,
  };
}
