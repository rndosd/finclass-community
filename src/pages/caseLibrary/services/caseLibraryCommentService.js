import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebase";

function getCaseLibraryPostRef(classId, postId) {
  return doc(db, "classes", classId, "caseLibraryPosts", postId);
}

function getCaseLibraryCommentsRef(classId, postId) {
  return collection(db, "classes", classId, "caseLibraryPosts", postId, "comments");
}

function getCaseLibraryCommentRef(classId, postId, commentId) {
  return doc(
    db,
    "classes",
    classId,
    "caseLibraryPosts",
    postId,
    "comments",
    commentId,
  );
}

function getCaseLibraryCommentRecommendRef(
  classId,
  postId,
  commentId,
  uid,
) {
  return doc(
    db,
    "classes",
    classId,
    "caseLibraryPosts",
    postId,
    "comments",
    commentId,
    "recommenders",
    uid,
  );
}

function collectDescendantIds(targetId, comments) {
  const childMap = new Map();

  comments.forEach((comment) => {
    const parentId = String(comment.parentId || "").trim();
    if (!parentId) {
      return;
    }

    const siblings = childMap.get(parentId) || [];
    siblings.push(comment.id);
    childMap.set(parentId, siblings);
  });

  const collectedIds = new Set([targetId]);
  const queue = [targetId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const childIds = childMap.get(currentId) || [];

    childIds.forEach((childId) => {
      if (!collectedIds.has(childId)) {
        collectedIds.add(childId);
        queue.push(childId);
      }
    });
  }

  return Array.from(collectedIds);
}

export async function createCaseLibraryComment({
  classId,
  postId,
  authorUid,
  authorName,
  classLabel,
  teacherNamePublic,
  content,
  parentId = null,
  replyToAuthorName = "",
}) {
  if (!classId || !postId || !authorUid) {
    throw new Error("댓글 작성에 필요한 사용자 정보를 찾지 못했습니다.");
  }

  const trimmedContent = String(content || "").trim();
  if (!trimmedContent) {
    throw new Error("댓글 내용을 입력해 주세요.");
  }

  await addDoc(getCaseLibraryCommentsRef(classId, postId), {
    classId,
    postId,
    authorUid: String(authorUid),
    authorName: String(authorName || "").trim(),
    classLabel: String(classLabel || "").trim(),
    teacherNamePublic: Boolean(teacherNamePublic),
    content: trimmedContent,
    parentId: parentId ? String(parentId).trim() : null,
    replyToAuthorName: String(replyToAuthorName || "").trim(),
    recommendCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(getCaseLibraryPostRef(classId, postId), {
    "metrics.commentCount": increment(1),
    commentCount: increment(1),
    lastActivityAt: serverTimestamp(),
  });
}

export async function updateCaseLibraryComment({
  classId,
  postId,
  commentId,
  content,
}) {
  if (!classId || !postId || !commentId) {
    throw new Error("수정할 댓글 정보를 찾지 못했습니다.");
  }

  const trimmedContent = String(content || "").trim();
  if (!trimmedContent) {
    throw new Error("댓글 내용을 입력해 주세요.");
  }

  await updateDoc(getCaseLibraryCommentRef(classId, postId, commentId), {
    content: trimmedContent,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCaseLibraryComment({
  classId,
  postId,
  commentId,
}) {
  if (!classId || !postId || !commentId) {
    throw new Error("삭제할 댓글 정보를 찾지 못했습니다.");
  }

  const commentsSnapshot = await getDocs(getCaseLibraryCommentsRef(classId, postId));
  const comments = commentsSnapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));
  const deleteIds = collectDescendantIds(commentId, comments);
  const batch = writeBatch(db);

  for (const id of deleteIds) {
    const recommendersSnapshot = await getDocs(
      collection(
        db,
        "classes",
        classId,
        "caseLibraryPosts",
        postId,
        "comments",
        id,
        "recommenders",
      ),
    );
    recommendersSnapshot.docs.forEach((recommendSnapshot) => {
      batch.delete(recommendSnapshot.ref);
    });
    batch.delete(getCaseLibraryCommentRef(classId, postId, id));
  }

  batch.update(getCaseLibraryPostRef(classId, postId), {
    "metrics.commentCount": increment(-deleteIds.length),
    commentCount: increment(-deleteIds.length),
    lastActivityAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function toggleCaseLibraryCommentRecommend({
  classId,
  postId,
  commentId,
  uid,
}) {
  if (!classId || !postId || !commentId || !uid) {
    throw new Error("댓글 추천에 필요한 사용자 정보를 찾지 못했습니다.");
  }

  const commentRef = getCaseLibraryCommentRef(classId, postId, commentId);
  const recommendRef = getCaseLibraryCommentRecommendRef(
    classId,
    postId,
    commentId,
    uid,
  );

  return runTransaction(db, async (transaction) => {
    const commentSnapshot = await transaction.get(commentRef);
    if (!commentSnapshot.exists()) {
      throw new Error("댓글을 찾을 수 없습니다.");
    }

    const recommendSnapshot = await transaction.get(recommendRef);

    if (recommendSnapshot.exists()) {
      transaction.delete(recommendRef);
      transaction.update(commentRef, {
        recommendCount: increment(-1),
      });
      return { recommended: false };
    }

    transaction.set(recommendRef, {
      classId,
      postId,
      commentId,
      recommendedAt: serverTimestamp(),
    });
    transaction.update(commentRef, {
      recommendCount: increment(1),
    });
    return { recommended: true };
  });
}

export function subscribeCaseLibraryCommentRecommended({
  classId,
  postId,
  commentId,
  uid,
  onChange,
  onError,
}) {
  if (!classId || !postId || !commentId || !uid) {
    onChange?.(false);
    return () => {};
  }

  return onSnapshot(
    getCaseLibraryCommentRecommendRef(classId, postId, commentId, uid),
    (snapshot) => {
      onChange?.(snapshot.exists());
    },
    (error) => {
      onError?.(error);
    },
  );
}

export function subscribeCaseLibraryComments({
  classId,
  postId,
  onChange,
  onError,
}) {
  if (!classId || !postId) {
    onChange?.([]);
    return () => {};
  }

  return onSnapshot(
    query(getCaseLibraryCommentsRef(classId, postId), orderBy("createdAt", "asc")),
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

export function subscribeCaseLibraryOwnComments({
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
    query(
      collectionGroup(db, "comments"),
      where("classId", "==", classId),
      where("authorUid", "==", uid),
    ),
    (snapshot) => {
      const comments = snapshot.docs
        .map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }))
        .sort((left, right) => {
          const leftTime =
            typeof left.createdAt?.toDate === "function"
              ? left.createdAt.toDate().getTime()
              : 0;
          const rightTime =
            typeof right.createdAt?.toDate === "function"
              ? right.createdAt.toDate().getTime()
              : 0;
          return rightTime - leftTime;
        });

      onChange?.(comments);
    },
    (error) => {
      onError?.(error);
    },
  );
}
