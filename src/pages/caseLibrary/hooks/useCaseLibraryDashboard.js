import { useEffect, useMemo, useState } from "react";
import { useUser } from "../../../contexts/UserContext";
import { buildCaseLibrarySummary, sortCasePosts } from "../caseLibraryPostUtils";
import { subscribeCaseLibraryDraft } from "../services/caseLibraryDraftService";
import { subscribeCaseLibrarySavedPosts } from "../services/caseLibraryEngagementService";
import { subscribeCaseLibraryOwnComments } from "../services/caseLibraryCommentService";
import useCaseLibraryPosts from "./useCaseLibraryPosts";

function normalizeDashboardDraft(draft) {
  if (!draft) {
    return null;
  }

  const title = String(draft.title || "").trim();
  const bodyHtml = String(draft.bodyHtml || "");
  const bodyText = String(draft.bodyText || "").trim();
  const summary = buildCaseLibrarySummary(bodyText || bodyHtml);
  const hasContent = Boolean(title || summary || bodyHtml);

  if (!hasContent) {
    return null;
  }

  return {
    pageType: String(draft.pageType || "operation-tips"),
    title,
    summary,
    updatedAt: draft.updatedAt || null,
    templateEnabled: Boolean(draft.templateEnabled),
  };
}

function buildPostKey(classId, postId) {
  return `${String(classId || "").trim()}::${String(postId || "").trim()}`;
}

export default function useCaseLibraryDashboard() {
  const { classId, user, userData } = useUser();
  const { error: postsError, loading: postsLoading, posts } = useCaseLibraryPosts(
    classId,
    { scope: "shared" },
  );
  const currentUid = String(userData?.uid || user?.uid || "").trim();

  const [savedEntries, setSavedEntries] = useState([]);
  const [savedLoading, setSavedLoading] = useState(() => Boolean(classId && currentUid));
  const [savedError, setSavedError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [draftLoading, setDraftLoading] = useState(() => Boolean(classId && currentUid));
  const [draftError, setDraftError] = useState(null);
  const [ownComments, setOwnComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(() => Boolean(classId && currentUid));
  const [commentsError, setCommentsError] = useState(null);

  useEffect(() => {
    if (!classId || !currentUid) {
      setSavedEntries([]);
      setSavedLoading(false);
      setSavedError(null);
      return undefined;
    }

    setSavedLoading(true);
    setSavedError(null);

    return subscribeCaseLibrarySavedPosts({
      classId,
      uid: currentUid,
      onChange: (nextSavedEntries) => {
        setSavedEntries(Array.isArray(nextSavedEntries) ? nextSavedEntries : []);
        setSavedLoading(false);
      },
      onError: (error) => {
        console.error("[useCaseLibraryDashboard] saved posts failed:", error);
        setSavedEntries([]);
        setSavedError(error);
        setSavedLoading(false);
      },
    });
  }, [classId, currentUid]);

  useEffect(() => {
    if (!classId || !currentUid) {
      setDraft(null);
      setDraftLoading(false);
      setDraftError(null);
      return undefined;
    }

    setDraftLoading(true);
    setDraftError(null);

    return subscribeCaseLibraryDraft({
      classId,
      uid: currentUid,
      onChange: (nextDraft) => {
        setDraft(normalizeDashboardDraft(nextDraft));
        setDraftLoading(false);
      },
      onError: (error) => {
        console.error("[useCaseLibraryDashboard] draft subscribe failed:", error);
        setDraft(null);
        setDraftError(error);
        setDraftLoading(false);
      },
    });
  }, [classId, currentUid]);

  useEffect(() => {
    if (!classId || !currentUid) {
      setOwnComments([]);
      setCommentsLoading(false);
      setCommentsError(null);
      return undefined;
    }

    setCommentsLoading(true);
    setCommentsError(null);

    return subscribeCaseLibraryOwnComments({
      classId,
      uid: currentUid,
      onChange: (nextComments) => {
        setOwnComments(Array.isArray(nextComments) ? nextComments : []);
        setCommentsLoading(false);
      },
      onError: (error) => {
        console.error("[useCaseLibraryDashboard] own comments failed:", error);
        setOwnComments([]);
        setCommentsError(error);
        setCommentsLoading(false);
      },
    });
  }, [classId, currentUid]);

  const ownPosts = useMemo(() => {
    const authoredPosts = posts.filter(
      (post) => String(post.authorUid || "").trim() === currentUid,
    );

    return sortCasePosts(authoredPosts, "latest");
  }, [currentUid, posts]);

  const postMap = useMemo(
    () => new Map(posts.map((post) => [buildPostKey(post.classId, post.id), post])),
    [posts],
  );

  const savedPostKeys = useMemo(
    () =>
      new Set(
        savedEntries.map((entry) =>
          buildPostKey(entry.sourceClassId || entry.classId, entry.postId || entry.id),
        ),
      ),
    [savedEntries],
  );

  const savedPosts = useMemo(() => {
    const bookmarkedPosts = posts.filter((post) =>
      savedPostKeys.has(buildPostKey(post.classId, post.id)),
    );
    return sortCasePosts(bookmarkedPosts, "latest");
  }, [posts, savedPostKeys]);

  const normalizedOwnComments = useMemo(
    () =>
      ownComments.map((comment) => ({
        ...comment,
        postTitle:
          postMap.get(buildPostKey(comment.classId, comment.postId))?.title ||
          "삭제되었거나 찾을 수 없는 글",
        postPageType:
          postMap.get(buildPostKey(comment.classId, comment.postId))?.pageType ||
          "operation-tips",
      })),
    [ownComments, postMap],
  );

  return {
    currentUid,
    draft,
    errors: {
      posts: postsError || null,
      saved: savedError || null,
      drafts: draftError || null,
      comments: commentsError || null,
    },
    loadingState: {
      posts: postsLoading,
      saved: postsLoading || savedLoading,
      drafts: draftLoading,
      comments: commentsLoading,
    },
    ownComments: normalizedOwnComments,
    ownPosts,
    savedPosts,
  };
}
