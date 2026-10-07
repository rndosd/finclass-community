import { collection, doc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { buildChoiceEntry, CHOICE_NOTE_MAX_LENGTH, CHOICE_QUESTIONS, CHOICE_REVIEW_OPTIONS } from "./choiceReflectionModel";

// Private self-reports use the existing users/{uid} owner-only subcollection
// boundary. They never update financial documents or send answers to an AI.
function entriesCollection(uid, classId, domain) {
  if (!uid || auth.currentUser?.uid !== uid || typeof classId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,180}$/.test(classId) || !["store", "stock"].includes(domain)) {
    throw new Error("현재 계정의 선택 기록만 열 수 있어요.");
  }
  return collection(db, "users", uid, "choiceReflections", classId, "domains", domain, "entries");
}

function toEntry(id, data) {
  return { ...data, id, createdAtMs: data.createdAt?.toMillis?.() || data.createdAtMs || 0 };
}

export async function listChoiceReflections(uid, classId, domain) {
  const result = await getDocs(query(entriesCollection(uid, classId, domain), orderBy("createdAt", "desc"), limit(40)));
  return result.docs.map((snapshot) => toEntry(snapshot.id, snapshot.data()))
    .filter((entry) => CHOICE_QUESTIONS[entry.sourceType]?.domain === domain);
}

export async function saveChoiceReflection(uid, classId, entry, answer = {}) {
  const valid = buildChoiceEntry(entry);
  if (!valid || valid.id !== entry.id) throw new Error("선택 기록 정보를 확인해 주세요.");
  const { reason, review, note } = answer;
  if (note !== undefined && (typeof note !== "string" || note.length > CHOICE_NOTE_MAX_LENGTH ||
      CHOICE_QUESTIONS[entry.sourceType].domain !== "stock" || reason === undefined)) {
    throw new Error("덧붙인 생각은 200자 이내로 적어 주세요.");
  }
  if ((reason !== undefined && !CHOICE_QUESTIONS[entry.sourceType].reasons.some(([id]) => id === reason)) ||
      (review !== undefined && !CHOICE_REVIEW_OPTIONS.some(([id]) => id === review))) {
    throw new Error("답변을 다시 선택해 주세요.");
  }
  const target = doc(entriesCollection(uid, classId, CHOICE_QUESTIONS[entry.sourceType].domain), entry.id);
  return runTransaction(db, async (transaction) => {
    const previous = await transaction.get(target);
    const data = previous.exists() ? previous.data() : {
      sourceType: valid.sourceType, sourceId: valid.sourceId, label: valid.label,
      questionVersion: valid.questionVersion,
      reason: null, review: null, createdAt: serverTimestamp(),
    };
    if (data.sourceType !== entry.sourceType || data.sourceId !== entry.sourceId) {
      throw new Error("원래 선택 기록을 확인해 주세요.");
    }
    // Preserve the original reason when a completed trade is retried. Later
    // thoughts have a separate field, so they do not replace the first answer.
    const updates = {};
    if (reason !== undefined && !data.reason) {
      updates.reason = reason;
      updates.reasonAnsweredAt = serverTimestamp();
      if (note?.trim()) updates.note = note.trim();
    }
    if (review !== undefined) {
      if (!(data.reason || updates.reason)) throw new Error("먼저 선택 이유를 남겨 주세요.");
      if (data.review !== review) {
        updates.review = review;
        updates.reviewAnsweredAt = serverTimestamp();
      }
    }
    if (!previous.exists()) transaction.set(target, { ...data, ...updates });
    else if (Object.keys(updates).length) transaction.update(target, updates);
    return { ...toEntry(entry.id, { ...data, ...updates }), createdAtMs: data.createdAt?.toMillis?.() || entry.createdAtMs };
  });
}
