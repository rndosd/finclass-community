import { httpsCallable } from "firebase/functions";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db, functions } from "../../../firebase";
import {
  createSnapshotTelemetryModeTracker,
  trackFirestorePayload,
} from "../../../utils/firestoreTelemetry";

export const WORLD_CUP_SUMMARY_ID = "kbo_current";

const getPredictionPath = (classId) =>
  `classes/${classId}/arcade/config/matchPredictions`;

const getRewardRunPath = (classId) =>
  `classes/${classId}/arcade/config/matchRewardRuns`;

export const subscribeWorldCupMatches = (callback) => {
  const ref = doc(db, "sportsMatchSummary", WORLD_CUP_SUMMARY_ID);
  return onSnapshot(
    ref, (snap) => {
      const data = snap.exists() ? snap.data() : {};
      const matches = Array.isArray(data.matches) ? data.matches : [];
      callback({
        ...data,
        matches: [...matches].sort((left, right) =>
          String(left.startsAtUtc || "").localeCompare(String(right.startsAtUtc || "")),
        ),
      });
    },
    (error) => {
      console.error("[matchPrediction] match summary subscribe failed:", error);
      callback({ matches: [] });
    },
  );
};

export const subscribeMyMatchPredictions = (classId, studentUid, callback) => {
  if (!classId || !studentUid) {
    callback([]);
    return () => {};
  }

  const ref = collection(db, getPredictionPath(classId));
  const q = query(ref, where("studentUid", "==", studentUid));
  const getTelemetryMode = createSnapshotTelemetryModeTracker();

  return onSnapshot(
    q, { includeMetadataChanges: true },
    (snap) => {
      const rows = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((left, right) =>
          String(right.updatedAt?.toDate?.() || right.updatedAt || "").localeCompare(
            String(left.updatedAt?.toDate?.() || left.updatedAt || ""),
          ),
      );
      trackFirestorePayload({
        classId,
        source: "subscribeMyMatchPredictions",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/matchPredictions",
        mode: getTelemetryMode(snap),
        rows,
        snapshot: snap,
      });
      callback(rows);
    },
    (error) => {
      console.error("[matchPrediction] my predictions subscribe failed:", error);
      callback([]);
    },
  );
};

export const subscribeClassMatchPredictions = (classId, callback) => {
  if (!classId) {
    callback([]);
    return () => {};
  }

  const ref = collection(db, getPredictionPath(classId));
  const getTelemetryMode = createSnapshotTelemetryModeTracker();

  return onSnapshot(
    ref, { includeMetadataChanges: true },
    (snap) => {
      const rows = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((left, right) =>
          String(right.updatedAt?.toDate?.() || right.updatedAt || "").localeCompare(
            String(left.updatedAt?.toDate?.() || left.updatedAt || ""),
          ),
      );
      trackFirestorePayload({
        classId,
        source: "subscribeClassMatchPredictions",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/matchPredictions",
        mode: getTelemetryMode(snap),
        rows,
        snapshot: snap,
      });
      callback(rows);
    },
    (error) => {
      console.error("[matchPrediction] class predictions subscribe failed:", error);
      callback([]);
    },
  );
};

export const subscribeClassMatchRewardRuns = (classId, callback) => {
  if (!classId) {
    callback([]);
    return () => {};
  }

  const ref = collection(db, getRewardRunPath(classId));
  const getTelemetryMode = createSnapshotTelemetryModeTracker();

  return onSnapshot(
    ref, { includeMetadataChanges: true },
    (snap) => {
      const rows = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((left, right) =>
          String(right.updatedAt?.toDate?.() || right.updatedAt || "").localeCompare(
            String(left.updatedAt?.toDate?.() || left.updatedAt || ""),
          ),
      );
      trackFirestorePayload({
        classId,
        source: "subscribeClassMatchRewardRuns",
        sourceGroup: "page",
        pathKey: "classes/{classId}/arcade/config/matchRewardRuns",
        mode: getTelemetryMode(snap),
        rows,
        snapshot: snap,
      });
      callback(rows);
    },
    (error) => {
      console.error("[matchPrediction] reward runs subscribe failed:", error);
      callback([]);
    },
  );
};

export const saveMatchPrediction = async (
  classId,
  studentUid,
  match,
  { outcome, homeScore, awayScore, margin },
) => {
  if (!classId || !studentUid || !match?.id) {
    throw new Error("예측 저장에 필요한 정보가 부족합니다.");
  }

  const fn = httpsCallable(functions, "saveMatchPrediction");
  const result = await fn({
    classId,
    matchId: match.id,
    outcome,
    ...(String(match.id).startsWith("kbo_")
      ? { margin }
      : { homeScore: Number(homeScore), awayScore: Number(awayScore) }),
  });
  return result.data;
};

export const cancelMatchPrediction = async (classId, prediction) => {
  if (!classId || !prediction?.id) {
    throw new Error("취소할 예측 정보가 부족합니다.");
  }

  const rewardStatus = prediction?.reward?.status || prediction?.rewardStatus || "";
  if (["paid", "no_reward"].includes(rewardStatus)) {
    throw new Error("이미 보상 처리가 끝난 예측은 취소할 수 없습니다.");
  }

  await deleteDoc(doc(db, getPredictionPath(classId), prediction.id));
  return { ok: true };
};

export const cancelMatchPredictions = async (classId, predictions = []) => {
  const cancellablePredictions = predictions.filter((prediction) => {
    const rewardStatus = prediction?.reward?.status || prediction?.rewardStatus || "";
    return prediction?.id && !["paid", "no_reward"].includes(rewardStatus);
  });

  if (!classId || cancellablePredictions.length === 0) {
    throw new Error("취소할 예측을 선택해 주세요.");
  }

  const batch = writeBatch(db);
  cancellablePredictions.forEach((prediction) => {
    batch.delete(doc(db, getPredictionPath(classId), prediction.id));
  });
  await batch.commit();

  return { ok: true, count: cancellablePredictions.length };
};

export const syncWorldCupMatches = async () => {
  const fn = httpsCallable(functions, "syncKboMatches", { timeout: 540000 });
  const result = await fn({});
  return result.data;
};

export const processMatchPredictionRewards = async (classId, matchId) => {
  if (!classId || !matchId) {
    throw new Error("보상 처리에 필요한 정보가 부족합니다.");
  }

  const fn = httpsCallable(functions, "processMatchPredictionRewards");
  const result = await fn({ classId, matchId });
  return result.data;
};

export const processPendingMatchPredictionRewards = async (classId) => {
  if (!classId) {
    throw new Error("보상 처리에 필요한 학급 정보가 부족합니다.");
  }

  const fn = httpsCallable(functions, "processPendingMatchPredictionRewards");
  const result = await fn({ classId });
  return result.data;
};
