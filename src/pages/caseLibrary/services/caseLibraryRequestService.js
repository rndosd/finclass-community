import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDoc,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { buildCaseLibrarySummary } from "../caseLibraryPostUtils";

function getCaseLibraryRequestRef(classId, requestId) {
  return doc(db, "classes", classId, "caseLibraryRequests", requestId);
}

function buildCaseLibraryRequestInterestDocId({
  storageClassId,
  targetClassId,
  requestId,
}) {
  const normalizedStorageClassId = String(storageClassId || "").trim();
  const normalizedTargetClassId = String(
    targetClassId || storageClassId || "",
  ).trim();
  const normalizedRequestId = String(requestId || "").trim();

  if (
    !normalizedStorageClassId ||
    !normalizedTargetClassId ||
    !normalizedRequestId
  ) {
    return "";
  }

  return normalizedStorageClassId === normalizedTargetClassId
    ? normalizedRequestId
    : `${normalizedTargetClassId}__${normalizedRequestId}`;
}

function getCaseLibraryRequestInterestRef({
  storageClassId,
  targetClassId,
  uid,
  requestId,
}) {
  const docId = buildCaseLibraryRequestInterestDocId({
    storageClassId,
    targetClassId,
    requestId,
  });

  return doc(
    db,
    "classes",
    storageClassId,
    "caseLibraryRequestInterests",
    uid,
    "requests",
    docId,
  );
}

function normalizeMetricValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export function normalizeCaseLibraryRequest(id, data = {}) {
  const metrics = data.metrics || {};
  const interestCount = normalizeMetricValue(
    metrics.interestCount ?? data.interestCount,
  );
  const commentCount = normalizeMetricValue(
    metrics.commentCount ?? data.commentCount,
  );

  return {
    id,
    pageType: String(data.pageType || "operation-tips").trim(),
    title: String(data.title || "").trim(),
    content: String(data.content || "").trim(),
    bodyText: String(data.content || "").trim(),
    summary: String(
      data.summary || buildCaseLibrarySummary(data.content || ""),
    ).trim(),
    authorUid: String(data.authorUid || "").trim(),
    authorName: String(data.authorName || "").trim(),
    classId: String(data.classId || "").trim(),
    classLabel: String(data.classLabel || "").trim(),
    teacherNamePublic:
      typeof data.teacherNamePublic === "boolean" ? data.teacherNamePublic : true,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || data.createdAt || null,
    metrics: {
      interestCount,
      commentCount,
    },
    interestCount,
    commentCount,
  };
}

export async function getCaseLibraryRequest({ classId, requestId }) {
  if (!classId || !requestId) {
    return null;
  }

  const snapshot = await getDoc(getCaseLibraryRequestRef(classId, requestId));
  if (!snapshot.exists()) {
    return null;
  }

  return normalizeCaseLibraryRequest(snapshot.id, snapshot.data());
}

export async function createCaseLibraryRequest({ classId, requestData }) {
  if (!classId) {
    throw new Error("학급 정보를 확인한 뒤 다시 시도해 주세요.");
  }

  const requestsRef = collection(db, "classes", classId, "caseLibraryRequests");
  const payload = {
    pageType: String(requestData?.pageType || "operation-tips").trim(),
    title: String(requestData?.title || "").trim(),
    content: String(requestData?.content || "").trim(),
    summary: String(
      requestData?.summary || buildCaseLibrarySummary(requestData?.content || ""),
    ).trim(),
    authorUid: String(requestData?.authorUid || "").trim(),
    authorName: String(requestData?.authorName || "").trim(),
    classId: String(classId),
    classLabel: String(requestData?.classLabel || "").trim(),
    teacherNamePublic:
      typeof requestData?.teacherNamePublic === "boolean"
        ? requestData.teacherNamePublic
        : true,
    metrics: {
      interestCount: 0,
      commentCount: 0,
    },
    interestCount: 0,
    commentCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(requestsRef, payload);
  return docRef.id;
}

export async function updateCaseLibraryRequest({
  classId,
  requestId,
  requestData,
}) {
  if (!classId || !requestId) {
    throw new Error("수정할 사례 요청 정보를 찾지 못했습니다.");
  }

  await updateDoc(getCaseLibraryRequestRef(classId, requestId), {
    pageType: String(requestData?.pageType || "operation-tips").trim(),
    title: String(requestData?.title || "").trim(),
    content: String(requestData?.content || "").trim(),
    summary: String(
      requestData?.summary || buildCaseLibrarySummary(requestData?.content || ""),
    ).trim(),
    authorName: String(requestData?.authorName || "").trim(),
    classLabel: String(requestData?.classLabel || "").trim(),
    teacherNamePublic:
      typeof requestData?.teacherNamePublic === "boolean"
        ? requestData.teacherNamePublic
        : true,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeCaseLibraryRequests({
  classId,
  scope = "class",
  onChange,
  onError,
}) {
  const isSharedScope = scope === "shared";

  if (!isSharedScope && !classId) {
    onChange?.([]);
    return () => {};
  }

  return onSnapshot(
    isSharedScope
      ? collectionGroup(db, "caseLibraryRequests")
      : collection(db, "classes", classId, "caseLibraryRequests"),
    (snapshot) => {
      onChange?.(
        snapshot.docs.map((docSnapshot) =>
          normalizeCaseLibraryRequest(docSnapshot.id, docSnapshot.data()),
        ),
      );
    },
    (error) => {
      onError?.(error);
    },
  );
}

export async function toggleCaseLibraryRequestInterest({
  storageClassId,
  targetClassId,
  requestId,
  uid,
}) {
  const resolvedTargetClassId = String(
    targetClassId || storageClassId || "",
  ).trim();

  if (!storageClassId || !resolvedTargetClassId || !requestId || !uid) {
    throw new Error("요청 공감 처리에 필요한 정보를 찾지 못했습니다.");
  }

  const requestRef = getCaseLibraryRequestRef(resolvedTargetClassId, requestId);
  const interestRef = getCaseLibraryRequestInterestRef({
    storageClassId,
    targetClassId: resolvedTargetClassId,
    uid,
    requestId,
  });

  return runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists()) {
      throw new Error("사례 요청을 찾지 못했습니다.");
    }

    const interestSnapshot = await transaction.get(interestRef);

    if (interestSnapshot.exists()) {
      transaction.delete(interestRef);
      transaction.update(requestRef, {
        "metrics.interestCount": increment(-1),
        interestCount: increment(-1),
      });
      return { interested: false };
    }

    transaction.set(interestRef, {
      classId: storageClassId,
      sourceClassId: resolvedTargetClassId,
      requestId,
      interestedAt: new Date(),
    });
    transaction.update(requestRef, {
      "metrics.interestCount": increment(1),
      interestCount: increment(1),
    });
    return { interested: true };
  });
}

export function subscribeCaseLibraryRequestInterested({
  storageClassId,
  targetClassId,
  requestId,
  uid,
  onChange,
  onError,
}) {
  if (!storageClassId || !targetClassId || !requestId || !uid) {
    onChange?.(false);
    return () => {};
  }

  return onSnapshot(
    getCaseLibraryRequestInterestRef({
      storageClassId,
      targetClassId,
      uid,
      requestId,
    }),
    (snapshot) => {
      onChange?.(snapshot.exists());
    },
    (error) => {
      onError?.(error);
    },
  );
}

export async function incrementCaseLibraryRequestCommentCount(
  classId,
  requestId,
  amount,
) {
  if (!classId || !requestId || !amount) {
    return;
  }

  await updateDoc(getCaseLibraryRequestRef(classId, requestId), {
    "metrics.commentCount": increment(amount),
    commentCount: increment(amount),
    lastActivityAt: serverTimestamp(),
  });
}
