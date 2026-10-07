import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../../firebase";

function getCaseLibraryDraftRef(classId, uid) {
  return doc(db, "classes", classId, "caseLibraryDrafts", uid);
}

export async function loadCaseLibraryDraft(classId, uid) {
  if (!classId || !uid) {
    return null;
  }

  const snapshot = await getDoc(getCaseLibraryDraftRef(classId, uid));
  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data();
}

export function subscribeCaseLibraryDraft({
  classId,
  uid,
  onChange,
  onError,
}) {
  if (!classId || !uid) {
    onChange?.(null);
    return () => {};
  }

  return onSnapshot(
    getCaseLibraryDraftRef(classId, uid),
    (snapshot) => {
      onChange?.(snapshot.exists() ? snapshot.data() : null);
    },
    (error) => {
      onError?.(error);
    },
  );
}

export async function saveCaseLibraryDraft({ classId, uid, draftData }) {
  if (!classId || !uid) {
    throw new Error("임시저장에 필요한 사용자 정보가 없습니다.");
  }

  await setDoc(
    getCaseLibraryDraftRef(classId, uid),
    {
      ...draftData,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function clearCaseLibraryDraft(classId, uid) {
  if (!classId || !uid) {
    return;
  }

  await deleteDoc(getCaseLibraryDraftRef(classId, uid));
}
