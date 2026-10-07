import { useQuery } from "@tanstack/react-query";
import {
  collection,
  getCountFromServer,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../firebase";

const FRIEND_COLLECTION_SUMMARY_STALE_TIME_MS = 5 * 60 * 1000;
const FRIEND_COLLECTION_SUMMARY_BATCH_SIZE = 6;

async function fetchStudentCollectionCount(classId, studentUid) {
  const ownedTitlesRef = collection(
    db,
    "classes",
    classId,
    "students",
    studentUid,
    "ownedTitles",
  );
  const [totalSnapshot, revokedSnapshot] = await Promise.all([
    getCountFromServer(ownedTitlesRef),
    getCountFromServer(query(ownedTitlesRef, where("isRevoked", "==", true))),
  ]);
  const totalCount = Number(totalSnapshot.data().count || 0);
  const revokedCount = Number(revokedSnapshot.data().count || 0);

  return Math.max(totalCount - revokedCount, 0);
}

async function fetchPublicTitleCollectionSummaries(classId, studentUids) {
  const summaries = {};

  for (
    let startIndex = 0;
    startIndex < studentUids.length;
    startIndex += FRIEND_COLLECTION_SUMMARY_BATCH_SIZE
  ) {
    const batch = studentUids.slice(
      startIndex,
      startIndex + FRIEND_COLLECTION_SUMMARY_BATCH_SIZE,
    );
    const batchResults = await Promise.all(
      batch.map(async (studentUid) => {
        try {
          return [
            studentUid,
            await fetchStudentCollectionCount(classId, studentUid),
          ];
        } catch (error) {
          console.error(
            "[usePublicTitleCollectionSummaries] count fetch error:",
            error,
          );
          return [studentUid, null];
        }
      }),
    );

    batchResults.forEach(([studentUid, ownedCount]) => {
      summaries[studentUid] = ownedCount;
    });
  }

  return summaries;
}

export function usePublicTitleCollectionSummaries(
  classId,
  students = [],
  { enabled = true } = {},
) {
  const studentUids = students
    .map((student) => student?.uid)
    .filter(Boolean)
    .sort();

  return useQuery({
    queryKey: ["publicTitleCollectionSummaries", classId, studentUids],
    queryFn: () => fetchPublicTitleCollectionSummaries(classId, studentUids),
    enabled: Boolean(classId && enabled && studentUids.length),
    staleTime: FRIEND_COLLECTION_SUMMARY_STALE_TIME_MS,
  });
}
