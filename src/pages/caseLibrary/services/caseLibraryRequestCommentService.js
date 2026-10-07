import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { incrementCaseLibraryRequestCommentCount } from "./caseLibraryRequestService";

function getCaseLibraryRequestCommentsRef(classId, requestId) {
  return collection(
    db,
    "classes",
    classId,
    "caseLibraryRequests",
    requestId,
    "requestComments",
  );
}

function getCaseLibraryRequestCommentRef(classId, requestId, commentId) {
  return doc(
    db,
    "classes",
    classId,
    "caseLibraryRequests",
    requestId,
    "requestComments",
    commentId,
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

export async function createCaseLibraryRequestComment({
  classId,
  requestId,
  authorUid,
  authorName,
  classLabel,
  teacherNamePublic,
  content,
  parentId = null,
  replyToAuthorName = "",
}) {
  if (!classId || !requestId || !authorUid) {
    throw new Error("답변 정보를 확인한 뒤 다시 시도해 주세요.");
  }

  const trimmedContent = String(content || "").trim();
  if (!trimmedContent) {
    throw new Error("답변 내용을 입력해 주세요.");
  }

  await addDoc(getCaseLibraryRequestCommentsRef(classId, requestId), {
    classId,
    requestId,
    authorUid: String(authorUid),
    authorName: String(authorName || "").trim(),
    classLabel: String(classLabel || "").trim(),
    teacherNamePublic: Boolean(teacherNamePublic),
    content: trimmedContent,
    parentId: parentId ? String(parentId).trim() : null,
    replyToAuthorName: String(replyToAuthorName || "").trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await incrementCaseLibraryRequestCommentCount(classId, requestId, 1);
}

export async function updateCaseLibraryRequestComment({
  classId,
  requestId,
  commentId,
  content,
}) {
  if (!classId || !requestId || !commentId) {
    throw new Error("수정할 답변 정보를 확인해 주세요.");
  }

  const trimmedContent = String(content || "").trim();
  if (!trimmedContent) {
    throw new Error("답변 내용을 입력해 주세요.");
  }

  await updateDoc(getCaseLibraryRequestCommentRef(classId, requestId, commentId), {
    content: trimmedContent,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCaseLibraryRequestComment({
  classId,
  requestId,
  commentId,
}) {
  if (!classId || !requestId || !commentId) {
    throw new Error("삭제할 답변 정보를 확인해 주세요.");
  }

  const commentsSnapshot = await getDocs(
    getCaseLibraryRequestCommentsRef(classId, requestId),
  );
  const comments = commentsSnapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));
  const deleteIds = collectDescendantIds(commentId, comments);
  const batch = writeBatch(db);

  deleteIds.forEach((id) => {
    batch.delete(getCaseLibraryRequestCommentRef(classId, requestId, id));
  });

  await batch.commit();
  await incrementCaseLibraryRequestCommentCount(classId, requestId, -deleteIds.length);
}

export function subscribeCaseLibraryRequestComments({
  classId,
  requestId,
  onChange,
  onError,
}) {
  if (!classId || !requestId) {
    onChange?.([]);
    return () => {};
  }

  return onSnapshot(
    query(
      getCaseLibraryRequestCommentsRef(classId, requestId),
      orderBy("createdAt", "asc"),
    ),
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
