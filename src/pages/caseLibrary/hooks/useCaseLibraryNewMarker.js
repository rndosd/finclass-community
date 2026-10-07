import { useEffect, useMemo, useState } from "react";
import { Timestamp } from "firebase/firestore";
import { subscribeCaseLibraryNewMarkerCutoff } from "../services/caseLibraryReadStateService";

function toMillis(value) {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().getTime();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const nextDate = new Date(value);
  return Number.isNaN(nextDate.getTime()) ? 0 : nextDate.getTime();
}

export default function useCaseLibraryNewMarker(classId, uid) {
  const [cutoff, setCutoff] = useState(() => Timestamp.fromMillis(0));

  useEffect(() => {
    if (!classId || !uid) {
      setCutoff(Timestamp.fromMillis(0));
      return undefined;
    }

    return subscribeCaseLibraryNewMarkerCutoff({
      classId,
      uid,
      onChange: (nextCutoff) => {
        setCutoff(
          nextCutoff instanceof Timestamp ? nextCutoff : Timestamp.fromMillis(0),
        );
      },
      onError: (error) => {
        console.error("[useCaseLibraryNewMarker] subscribe failed:", error);
        setCutoff(Timestamp.fromMillis(0));
      },
    });
  }, [classId, uid]);

  const cutoffMillis = useMemo(() => toMillis(cutoff), [cutoff]);

  const isItemNew = useMemo(
    () => (item) => toMillis(item?.createdAt) > cutoffMillis,
    [cutoffMillis],
  );

  return {
    cutoff,
    cutoffMillis,
    isItemNew,
  };
}
