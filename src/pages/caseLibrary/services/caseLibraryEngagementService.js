import {
  collection,
  doc,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../firebase";

const VIEW_STORAGE_PREFIX = "case-library:view";

function getCaseLibraryPostRef(classId, postId) {
  return doc(db, "classes", classId, "caseLibraryPosts", postId);
}

function buildCaseLibraryEngagementDocId({
  storageClassId,
  targetClassId,
  entityId,
}) {
  const normalizedStorageClassId = String(storageClassId || "").trim();
  const normalizedTargetClassId = String(
    targetClassId || storageClassId || "",
  ).trim();
  const normalizedEntityId = String(entityId || "").trim();

  if (
    !normalizedStorageClassId ||
    !normalizedTargetClassId ||
    !normalizedEntityId
  ) {
    return "";
  }

  return normalizedStorageClassId === normalizedTargetClassId
    ? normalizedEntityId
    : `${normalizedTargetClassId}__${normalizedEntityId}`;
}

export function getCaseLibrarySavedPostRef({
  storageClassId,
  targetClassId,
  uid,
  postId,
}) {
  const docId = buildCaseLibraryEngagementDocId({
    storageClassId,
    targetClassId,
    entityId: postId,
  });

  return doc(
    db,
    "classes",
    storageClassId,
    "caseLibrarySavedPosts",
    uid,
    "posts",
    docId,
  );
}

export function getCaseLibraryRecommendedPostRef({
  storageClassId,
  targetClassId,
  uid,
  postId,
}) {
  const docId = buildCaseLibraryEngagementDocId({
    storageClassId,
    targetClassId,
    entityId: postId,
  });

  return doc(
    db,
    "classes",
    storageClassId,
    "caseLibraryRecommendedPosts",
    uid,
    "posts",
    docId,
  );
}

function getViewStorageKey(classId, postId) {
  return `${VIEW_STORAGE_PREFIX}:${classId}:${postId}`;
}

async function incrementCaseLibraryMetric(classId, postId, field, amount = 1) {
  if (!classId || !postId || !field || !amount) {
    return;
  }

  await updateDoc(getCaseLibraryPostRef(classId, postId), {
    [`metrics.${field}`]: increment(amount),
    [field]: increment(amount),
  });
}

export async function recordCaseLibraryPostView(classId, postId) {
  if (!classId || !postId) {
    return;
  }

  if (typeof window !== "undefined") {
    const storageKey = getViewStorageKey(classId, postId);
    if (window.sessionStorage.getItem(storageKey) === "1") {
      return;
    }
    window.sessionStorage.setItem(storageKey, "1");
  }

  await incrementCaseLibraryMetric(classId, postId, "viewCount", 1);
}

export async function toggleCaseLibraryPostSave({
  storageClassId,
  targetClassId,
  postId,
  uid,
}) {
  const resolvedTargetClassId = String(
    targetClassId || storageClassId || "",
  ).trim();

  if (!storageClassId || !resolvedTargetClassId || !postId || !uid) {
    throw new Error("스크랩하려면 로그인 정보가 필요합니다.");
  }

  const postRef = getCaseLibraryPostRef(resolvedTargetClassId, postId);
  const saveRef = getCaseLibrarySavedPostRef({
    storageClassId,
    targetClassId: resolvedTargetClassId,
    uid,
    postId,
  });

  return runTransaction(db, async (transaction) => {
    const postSnapshot = await transaction.get(postRef);
    if (!postSnapshot.exists()) {
      throw new Error("게시글을 찾을 수 없습니다.");
    }

    const saveSnapshot = await transaction.get(saveRef);

    if (saveSnapshot.exists()) {
      transaction.delete(saveRef);
      transaction.update(postRef, {
        "metrics.saveCount": increment(-1),
        saveCount: increment(-1),
      });
      return { saved: false };
    }

    transaction.set(saveRef, {
      classId: storageClassId,
      sourceClassId: resolvedTargetClassId,
      postId,
      savedAt: new Date(),
    });
    transaction.update(postRef, {
      "metrics.saveCount": increment(1),
      saveCount: increment(1),
    });
    return { saved: true };
  });
}

export async function toggleCaseLibraryPostRecommend({
  storageClassId,
  targetClassId,
  postId,
  uid,
}) {
  const resolvedTargetClassId = String(
    targetClassId || storageClassId || "",
  ).trim();

  if (!storageClassId || !resolvedTargetClassId || !postId || !uid) {
    throw new Error("추천하려면 로그인 정보가 필요합니다.");
  }

  const postRef = getCaseLibraryPostRef(resolvedTargetClassId, postId);
  const recommendRef = getCaseLibraryRecommendedPostRef({
    storageClassId,
    targetClassId: resolvedTargetClassId,
    uid,
    postId,
  });

  return runTransaction(db, async (transaction) => {
    const postSnapshot = await transaction.get(postRef);
    if (!postSnapshot.exists()) {
      throw new Error("게시글을 찾을 수 없습니다.");
    }

    const recommendSnapshot = await transaction.get(recommendRef);

    if (recommendSnapshot.exists()) {
      transaction.delete(recommendRef);
      transaction.update(postRef, {
        "metrics.recommendCount": increment(-1),
        recommendCount: increment(-1),
        lastActivityAt: serverTimestamp(),
      });
      return { recommended: false };
    }

    transaction.set(recommendRef, {
      classId: storageClassId,
      sourceClassId: resolvedTargetClassId,
      postId,
      recommendedAt: new Date(),
    });
    transaction.update(postRef, {
      "metrics.recommendCount": increment(1),
      recommendCount: increment(1),
      lastActivityAt: serverTimestamp(),
    });
    return { recommended: true };
  });
}

export function subscribeCaseLibraryPostSaved({
  storageClassId,
  targetClassId,
  postId,
  uid,
  onChange,
  onError,
}) {
  if (!storageClassId || !targetClassId || !postId || !uid) {
    onChange?.(false);
    return () => {};
  }

  return onSnapshot(
    getCaseLibrarySavedPostRef({
      storageClassId,
      targetClassId,
      uid,
      postId,
    }),
    (snapshot) => {
      onChange?.(snapshot.exists());
    },
    (error) => {
      onError?.(error);
    },
  );
}

export function subscribeCaseLibraryPostRecommended({
  storageClassId,
  targetClassId,
  postId,
  uid,
  onChange,
  onError,
}) {
  if (!storageClassId || !targetClassId || !postId || !uid) {
    onChange?.(false);
    return () => {};
  }

  return onSnapshot(
    getCaseLibraryRecommendedPostRef({
      storageClassId,
      targetClassId,
      uid,
      postId,
    }),
    (snapshot) => {
      onChange?.(snapshot.exists());
    },
    (error) => {
      onError?.(error);
    },
  );
}

export function subscribeCaseLibrarySavedPosts({
  classId,
  uid,
  onChange,
  onError,
}) {
  if (!classId || !uid) {
    onChange?.([]);
    return () => {};
  }

  return onSnapshot(
    collection(db, "classes", classId, "caseLibrarySavedPosts", uid, "posts"),
    (snapshot) => {
      onChange?.(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        })),
      );
    },
    (error) => {
      onError?.(error);
    },
  );
}
