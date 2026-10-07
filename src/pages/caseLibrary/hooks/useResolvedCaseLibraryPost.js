import { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit as limitQuery,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../firebase";
import {
  buildCaseLibraryPostRouteId,
  parseCaseLibraryPostRouteId,
  sortCasePosts,
} from "../caseLibraryPostUtils";
import {
  getCaseLibraryPostRef,
  normalizeCaseLibraryPost,
  normalizeCaseLibraryPostSummary,
} from "./useCaseLibraryPosts";

const SHARED_CASE_LIBRARY_POST_SUMMARY_COLLECTION = "sharedCaseLibraryPostSummaries";

function getSharedCaseLibraryPostSummariesRef() {
  return collection(db, SHARED_CASE_LIBRARY_POST_SUMMARY_COLLECTION);
}

export default function useResolvedCaseLibraryPost(caseId, options = {}) {
  const includeRelated = options?.includeRelated === true;
  const parsedRoute = useMemo(
    () => parseCaseLibraryPostRouteId(caseId),
    [caseId],
  );
  const [summaryMeta, setSummaryMeta] = useState(null);
  const [casePost, setCasePost] = useState(null);
  const [relatedCases, setRelatedCases] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(() => Boolean(caseId));
  const [postLoading, setPostLoading] = useState(() => Boolean(caseId));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!caseId) {
      setSummaryMeta(null);
      setCasePost(null);
      setSummaryLoading(false);
      setPostLoading(false);
      setError(null);
      return undefined;
    }

    setError(null);

    if (parsedRoute.isComposite) {
      setSummaryMeta({
        postId: parsedRoute.postId,
        routeId: parsedRoute.routeId,
        sourceClassId: parsedRoute.sourceClassId,
        summaryId: parsedRoute.summaryId,
      });
      setSummaryLoading(false);
      return undefined;
    }

    setSummaryMeta(null);
    setSummaryLoading(true);

    return onSnapshot(
      query(
        getSharedCaseLibraryPostSummariesRef(),
        where("postId", "==", parsedRoute.postId),
        limitQuery(1),
      ),
      (snapshot) => {
        const summarySnapshot = snapshot.docs[0] || null;

        if (!summarySnapshot) {
          setSummaryMeta(null);
          setSummaryLoading(false);
          return;
        }

        const summary = normalizeCaseLibraryPostSummary(
          summarySnapshot.id,
          summarySnapshot.data(),
        );

        setSummaryMeta({
          pageType: summary.pageType,
          postId: summary.postId,
          routeId: summary.routeId,
          sourceClassId: summary.sourceClassId,
          summaryId: summary.summaryId,
        });
        setSummaryLoading(false);
      },
      (nextError) => {
        console.error("[useResolvedCaseLibraryPost] summary lookup failed:", nextError);
        setSummaryMeta(null);
        setSummaryLoading(false);
        setError(nextError);
      },
    );
  }, [caseId, parsedRoute]);

  useEffect(() => {
    if (!summaryMeta?.sourceClassId || !summaryMeta?.postId) {
      setCasePost(null);
      setPostLoading(summaryLoading);
      return undefined;
    }

    setPostLoading(true);

    return onSnapshot(
      getCaseLibraryPostRef(summaryMeta.sourceClassId, summaryMeta.postId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setCasePost(null);
          setPostLoading(false);
          return;
        }

        const normalizedPost = normalizeCaseLibraryPost(snapshot.id, snapshot.data());

        setCasePost({
          ...normalizedPost,
          routeId:
            summaryMeta.routeId ||
            buildCaseLibraryPostRouteId({
              classId: summaryMeta.sourceClassId,
              postId: summaryMeta.postId,
            }),
          summaryId: summaryMeta.summaryId || "",
        });
        setPostLoading(false);
      },
      (nextError) => {
        console.error("[useResolvedCaseLibraryPost] post subscribe failed:", nextError);
        setCasePost(null);
        setPostLoading(false);
        setError(nextError);
      },
    );
  }, [summaryLoading, summaryMeta]);

  useEffect(() => {
    if (!includeRelated || !casePost?.pageType) {
      setRelatedCases([]);
      return undefined;
    }

    return onSnapshot(
      query(
        getSharedCaseLibraryPostSummariesRef(),
        where("pageType", "==", casePost.pageType),
        limitQuery(20),
      ),
      (snapshot) => {
        const currentRouteId = buildCaseLibraryPostRouteId(casePost);
        const nextRelatedCases = sortCasePosts(
          snapshot.docs
            .map((docSnapshot) =>
              normalizeCaseLibraryPostSummary(docSnapshot.id, docSnapshot.data()),
            )
            .filter((post) => buildCaseLibraryPostRouteId(post) !== currentRouteId),
          "featured",
        ).slice(0, 4);

        setRelatedCases(nextRelatedCases);
      },
      (nextError) => {
        console.error("[useResolvedCaseLibraryPost] related cases failed:", nextError);
        setRelatedCases([]);
      },
    );
  }, [casePost, includeRelated]);

  return {
    casePost,
    error,
    loading: summaryLoading || postLoading,
    relatedCases,
  };
}
