import { db } from "../../../firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

export const addNews = async ({ classId, authorUid, authorName, ...newsData }) => {
  if (!classId) throw new Error("classId가 누락되었습니다.");

  const newsColRef = collection(db, `classes/${classId}/news`);
  const finalData = {
    ...newsData,
    authorUid,
    authorName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    likes: [],
    likesCount: 0,
    commentsCount: 0,
    interactionScore: 0,
    isActive: true,
  };

  const docRef = await addDoc(newsColRef, finalData);
  return { success: true, newsId: docRef.id };
};

export const updateNews = async ({ classId, newsId, newData }) => {
  if (!classId || !newsId) {
    console.error("필수 파라미터 유실 발생:", {
      classId,
      newsId,
      dataExists: !!newData,
    });
    throw new Error("필수 파라미터가 누락되었습니다.");
  }

  const newsDocRef = doc(db, `classes/${classId}/news`, newsId);
  const updatePayload = {
    ...newData,
    updatedAt: serverTimestamp(),
  };

  await updateDoc(newsDocRef, updatePayload);
  return { success: true };
};

export const deleteNews = async ({ classId, newsId }) => {
  if (!classId || !newsId) throw new Error("필수 파라미터가 누락되었습니다.");

  await deleteDoc(doc(db, `classes/${classId}/news`, newsId));
  return { success: true };
};

export const addComment = async ({ classId, newsId, commentData }) => {
  if (!classId || !newsId) throw new Error("필수 파라미터가 누락되었습니다.");

  const commentsRef = collection(db, `classes/${classId}/news/${newsId}/comments`);
  const newsRef = doc(db, `classes/${classId}/news`, newsId);

  await addDoc(commentsRef, {
    ...commentData,
    createdAt: serverTimestamp(),
  });

  await updateDoc(newsRef, {
    commentsCount: increment(1),
    interactionScore: increment(2),
  });
  return { success: true };
};

export const deleteComment = async ({ classId, newsId, commentId }) => {
  if (!classId || !newsId || !commentId) {
    throw new Error("필수 파라미터가 누락되었습니다.");
  }

  const commentRef = doc(db, `classes/${classId}/news/${newsId}/comments`, commentId);
  const newsRef = doc(db, `classes/${classId}/news`, newsId);

  await deleteDoc(commentRef);
  await updateDoc(newsRef, {
    commentsCount: increment(-1),
    interactionScore: increment(-2),
  });
  return { success: true };
};
