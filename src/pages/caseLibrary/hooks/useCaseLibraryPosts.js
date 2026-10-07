import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  writeBatch,
  limit as limitQuery,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { isCaseLibraryTemplateVisible } from "../caseLibraryAccess";
import {
  buildCaseLibraryPostRouteId,
  buildCaseLibrarySummary,
} from "../caseLibraryPostUtils";

const SHARED_CASE_LIBRARY_POST_SUMMARY_COLLECTION = "sharedCaseLibraryPostSummaries";

function sanitizeStringList(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeMetricValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeTemplateMeta(templateMeta, templateEnabled) {
  if (!templateEnabled) {
    return null;
  }

  return {
    includedScopes: sanitizeStringList(templateMeta?.includedScopes),
    excludedScopes: sanitizeStringList(templateMeta?.excludedScopes),
    targetHint: String(templateMeta?.targetHint || "").trim(),
  };
}

export function buildCaseLibraryPostSummaryId(classId, postId) {
  const normalizedClassId = String(classId || "").trim();
  const normalizedPostId = String(postId || "").trim();

  if (!normalizedClassId || !normalizedPostId) {
    return "";
  }

  return `${normalizedClassId}__${normalizedPostId}`;
}

export function normalizeCaseLibraryPost(id, data = {}) {
  const pageType = String(data.pageType || "police");
  const metrics = data.metrics || {};
  const saveCount = normalizeMetricValue(metrics.saveCount ?? data.saveCount);
  const viewCount = normalizeMetricValue(metrics.viewCount ?? data.viewCount);
  const recommendCount = normalizeMetricValue(
    metrics.recommendCount ?? data.recommendCount,
  );
  const commentCount = normalizeMetricValue(metrics.commentCount ?? data.commentCount);
  const applyCount = normalizeMetricValue(metrics.applyCount ?? data.applyCount);
  const rawTemplateEnabled = Boolean(
    data.postKind === "template" || data.templateEnabled || data.template,
  );
  const templateEnabled =
    rawTemplateEnabled && isCaseLibraryTemplateVisible(pageType);

  return {
    id,
    postId: String(id || "").trim(),
    pageType,
    postKind: templateEnabled ? "template" : "post",
    requestId: String(data.requestId || "").trim(),
    title: String(data.title || "").trim(),
    bodyHtml: String(data.bodyHtml || ""),
    bodyText: String(data.bodyText || "").trim(),
    summary: String(
      data.summary || buildCaseLibrarySummary(data.bodyText || data.bodyHtml),
    ).trim(),
    authorUid: String(data.authorUid || "").trim(),
    authorName: String(data.authorName || "").trim(),
    classId: String(data.classId || "").trim(),
    sourceClassId: String(data.classId || "").trim(),
    classLabel: String(data.classLabel || data.roleLabel || "").trim(),
    teacherNamePublic:
      typeof data.teacherNamePublic === "boolean" ? data.teacherNamePublic : true,
    featured: Boolean(data.featured),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || data.createdAt || null,
    publishedAt: data.publishedAt || data.createdAt || null,
    templateEnabled,
    templateScopeIds: sanitizeStringList(data.templateScopeIds),
    template: normalizeTemplateMeta(data.template, templateEnabled),
    templatePayload:
      data.templatePayload && typeof data.templatePayload === "object"
        ? data.templatePayload
        : null,
    metrics: {
      saveCount,
      viewCount,
      recommendCount,
      commentCount,
      applyCount,
    },
    saveCount,
    viewCount,
    recommendCount,
    commentCount,
    applyCount,
    routeId: buildCaseLibraryPostRouteId({
      classId: data.classId,
      id,
    }),
  };
}

export function normalizeCaseLibraryPostSummary(summaryId, data = {}) {
  const pageType = String(data.pageType || "police");
  const metrics = data.metrics || {};
  const saveCount = normalizeMetricValue(metrics.saveCount ?? data.saveCount);
  const viewCount = normalizeMetricValue(metrics.viewCount ?? data.viewCount);
  const recommendCount = normalizeMetricValue(
    metrics.recommendCount ?? data.recommendCount,
  );
  const commentCount = normalizeMetricValue(metrics.commentCount ?? data.commentCount);
  const applyCount = normalizeMetricValue(metrics.applyCount ?? data.applyCount);
  const rawTemplateEnabled = Boolean(
    data.postKind === "template" || data.templateEnabled || data.template,
  );
  const templateEnabled =
    rawTemplateEnabled && isCaseLibraryTemplateVisible(pageType);
  const sourceClassId = String(
    data.sourceClassId || data.classId || "",
  ).trim();
  const postId = String(data.postId || "").trim();

  return {
    id: postId || String(summaryId || "").trim(),
    postId: postId || String(summaryId || "").trim(),
    summaryId: String(summaryId || "").trim(),
    sourceClassId,
    classId: sourceClassId,
    pageType,
    postKind: templateEnabled ? "template" : "post",
    requestId: String(data.requestId || "").trim(),
    title: String(data.title || "").trim(),
    bodyHtml: "",
    bodyText: "",
    summary: String(
      data.summary || buildCaseLibrarySummary(""),
    ).trim(),
    authorUid: String(data.authorUid || "").trim(),
    authorName: String(data.authorName || "").trim(),
    classLabel: String(data.classLabel || data.roleLabel || "").trim(),
    teacherNamePublic:
      typeof data.teacherNamePublic === "boolean" ? data.teacherNamePublic : true,
    featured: Boolean(data.featured),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || data.createdAt || null,
    publishedAt: data.publishedAt || data.createdAt || null,
    lastActivityAt: data.lastActivityAt || null,
    templateEnabled,
    templateScopeIds: sanitizeStringList(data.templateScopeIds),
    template: normalizeTemplateMeta(data.template, templateEnabled),
    templatePayload: null,
    metrics: {
      saveCount,
      viewCount,
      recommendCount,
      commentCount,
      applyCount,
    },
    saveCount,
    viewCount,
    recommendCount,
    commentCount,
    applyCount,
    routeId: buildCaseLibraryPostRouteId({
      classId: sourceClassId,
      postId,
      summaryId,
    }),
  };
}

function getSharedCaseLibraryPostSummariesRef() {
  return collection(db, SHARED_CASE_LIBRARY_POST_SUMMARY_COLLECTION);
}

export function getCaseLibraryPostRef(classId, postId) {
  return doc(db, "classes", classId, "caseLibraryPosts", postId);
}

export async function getCaseLibraryPost({ classId, postId }) {
  if (!classId || !postId) {
    return null;
  }

  const snapshot = await getDoc(getCaseLibraryPostRef(classId, postId));
  if (!snapshot.exists()) {
    return null;
  }

  return normalizeCaseLibraryPost(snapshot.id, snapshot.data());
}

export async function createCaseLibraryPost({ classId, postData }) {
  if (!classId) {
    throw new Error("학급 정보가 없어 운영사례를 저장할 수 없습니다.");
  }

  const postsRef = collection(db, "classes", classId, "caseLibraryPosts");
  const saveCount = normalizeMetricValue(postData?.metrics?.saveCount ?? postData?.saveCount);
  const viewCount = normalizeMetricValue(postData?.metrics?.viewCount ?? postData?.viewCount);
  const recommendCount = normalizeMetricValue(
    postData?.metrics?.recommendCount ?? postData?.recommendCount,
  );
  const commentCount = normalizeMetricValue(
    postData?.metrics?.commentCount ?? postData?.commentCount,
  );
  const applyCount = normalizeMetricValue(
    postData?.metrics?.applyCount ?? postData?.applyCount,
  );

  const payload = {
    pageType: String(postData?.pageType || "police"),
    postKind: postData?.postKind === "template" ? "template" : "post",
    requestId: String(postData?.requestId || "").trim(),
    title: String(postData?.title || "").trim(),
    bodyHtml: String(postData?.bodyHtml || ""),
    bodyText: String(postData?.bodyText || "").trim(),
    summary: String(
      postData?.summary ||
        buildCaseLibrarySummary(postData?.bodyText || postData?.bodyHtml),
    ).trim(),
    authorUid: String(postData?.authorUid || "").trim(),
    authorName: String(postData?.authorName || "").trim(),
    classId: String(classId),
    classLabel: String(postData?.classLabel || "").trim(),
    teacherNamePublic:
      typeof postData?.teacherNamePublic === "boolean"
        ? postData.teacherNamePublic
        : true,
    featured: Boolean(postData?.featured),
    templateEnabled: Boolean(postData?.templateEnabled),
    templateScopeIds: sanitizeStringList(postData?.templateScopeIds),
    template:
      postData?.templateEnabled && postData?.template
        ? {
            includedScopes: sanitizeStringList(postData.template.includedScopes),
            excludedScopes: sanitizeStringList(postData.template.excludedScopes),
            targetHint: String(postData.template.targetHint || "").trim(),
          }
        : null,
    templatePayload:
      postData?.templateEnabled && postData?.templatePayload
        ? postData.templatePayload
        : null,
    metrics: {
      saveCount,
      viewCount,
      recommendCount,
      commentCount,
      applyCount,
    },
    saveCount,
    viewCount,
    recommendCount,
    commentCount,
    applyCount,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    publishedAt: serverTimestamp(),
  };

  const docRef = await addDoc(postsRef, payload);
  return docRef.id;
}

export async function updateCaseLibraryPost({ classId, postId, postData }) {
  if (!classId || !postId) {
    throw new Error("수정할 게시글 정보를 찾지 못했습니다.");
  }

  const postRef = doc(db, "classes", classId, "caseLibraryPosts", postId);

  await updateDoc(postRef, {
    pageType: String(postData?.pageType || "police"),
    postKind: postData?.postKind === "template" ? "template" : "post",
    requestId: String(postData?.requestId || "").trim(),
    title: String(postData?.title || "").trim(),
    bodyHtml: String(postData?.bodyHtml || ""),
    bodyText: String(postData?.bodyText || "").trim(),
    summary: String(
      postData?.summary ||
        buildCaseLibrarySummary(postData?.bodyText || postData?.bodyHtml),
    ).trim(),
    authorName: String(postData?.authorName || "").trim(),
    classLabel: String(postData?.classLabel || "").trim(),
    teacherNamePublic:
      typeof postData?.teacherNamePublic === "boolean"
        ? postData.teacherNamePublic
        : true,
    templateEnabled: Boolean(postData?.templateEnabled),
    templateScopeIds: sanitizeStringList(postData?.templateScopeIds),
    template:
      postData?.templateEnabled && postData?.template
        ? {
            includedScopes: sanitizeStringList(postData.template.includedScopes),
            excludedScopes: sanitizeStringList(postData.template.excludedScopes),
            targetHint: String(postData.template.targetHint || "").trim(),
          }
        : null,
    templatePayload:
      postData?.templateEnabled && postData?.templatePayload
        ? postData.templatePayload
        : null,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCaseLibraryPost({ classId, postId }) {
  if (!classId || !postId) {
    throw new Error("삭제할 게시글 정보를 찾지 못했습니다.");
  }

  const postRef = doc(db, "classes", classId, "caseLibraryPosts", postId);
  const commentsRef = collection(db, "classes", classId, "caseLibraryPosts", postId, "comments");
  const commentsSnapshot = await getDocs(commentsRef);
  const batch = writeBatch(db);

  commentsSnapshot.docs.forEach((commentSnapshot) => {
    batch.delete(commentSnapshot.ref);
  });

  batch.delete(postRef);
  await batch.commit();
}

export default function useCaseLibraryPosts(classId, options = {}) {
  const scope = options?.scope === "shared" ? "shared" : "class";
  const isSharedScope = scope === "shared";
  const pageSize = Math.max(0, Number(options?.pageSize || 0));
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(classId || isSharedScope));
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isSharedScope && !classId) {
      setPosts([]);
      setLoading(false);
      setLoadingMore(false);
      setHasMore(false);
      setCursor(null);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setLoadingMore(false);
    setHasMore(false);
    setCursor(null);
    setError(null);

    const targetQuery = isSharedScope
      ? query(
          getSharedCaseLibraryPostSummariesRef(),
          orderBy("createdAt", "desc"),
          ...(pageSize > 0 ? [limitQuery(pageSize)] : []),
        )
      : collection(db, "classes", classId, "caseLibraryPosts");

    const unsubscribe = onSnapshot(targetQuery, (snapshot) => {
      const nextPosts = snapshot.docs.map((docSnapshot) =>
        isSharedScope
          ? normalizeCaseLibraryPostSummary(docSnapshot.id, docSnapshot.data())
          : normalizeCaseLibraryPost(docSnapshot.id, docSnapshot.data()),
      );

      setPosts(nextPosts);
      setCursor(snapshot.docs.at(-1) || null);
      setHasMore(Boolean(isSharedScope && pageSize > 0 && snapshot.docs.length === pageSize));
      setLoading(false);
    }, (nextError) => {
      console.error("[useCaseLibraryPosts] listen failed:", nextError);
      setPosts([]);
      setCursor(null);
      setHasMore(false);
      setError(nextError);
      setLoading(false);
      setLoadingMore(false);
    });

    return () => unsubscribe();
  }, [classId, isSharedScope, pageSize]);

  const loadMore = useCallback(async () => {
    if (!isSharedScope || pageSize <= 0 || !cursor || loadingMore || !hasMore) {
      return;
    }

    setLoadingMore(true);

    try {
      const snapshot = await getDocs(
        query(
          getSharedCaseLibraryPostSummariesRef(),
          orderBy("createdAt", "desc"),
          startAfter(cursor),
          limitQuery(pageSize),
        ),
      );

      const nextPosts = snapshot.docs.map((docSnapshot) =>
        normalizeCaseLibraryPostSummary(docSnapshot.id, docSnapshot.data()),
      );

      setPosts((currentPosts) => {
        const nextMap = new Map(
          currentPosts.map((post) => [post.summaryId || post.id, post]),
        );

        nextPosts.forEach((post) => {
          nextMap.set(post.summaryId || post.id, post);
        });

        return Array.from(nextMap.values());
      });
      setCursor(snapshot.docs.at(-1) || cursor);
      setHasMore(snapshot.docs.length === pageSize);
    } catch (nextError) {
      console.error("[useCaseLibraryPosts] loadMore failed:", nextError);
      setError(nextError);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, hasMore, isSharedScope, loadingMore, pageSize]);

  return useMemo(
    () => ({
      error,
      hasMore,
      loadMore,
      loading,
      loadingMore,
      posts,
    }),
    [error, hasMore, loadMore, loading, loadingMore, posts],
  );
}
