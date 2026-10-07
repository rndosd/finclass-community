import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../../firebase";
import { getAuctionEndAtMs, toMillis } from "../utils/auctionTiming";

const HISTORY_LIMIT = 100;

const sortAuctionItems = (items, statusFilter) => {
  const list = [...items];
  switch (statusFilter) {
    case "active":
      return list.sort((a, b) => getAuctionEndAtMs(a) - getAuctionEndAtMs(b));
    case "ended":
      return list.sort(
        (a, b) =>
          (getAuctionEndAtMs(b) || toMillis(b.updatedAt)) -
          (getAuctionEndAtMs(a) || toMillis(a.updatedAt)),
      );
    case "rejected":
      return list.sort(
        (a, b) => toMillis(b.rejectedAt || b.createdAt) - toMillis(a.rejectedAt || a.createdAt),
      );
    case "pending":
    default:
      return list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }
};

const buildAuctionQuery = (baseRef, requestedStatus) => {
  switch (requestedStatus) {
    case "ended":
      return query(baseRef, where("status", "==", "ended"), limit(HISTORY_LIMIT));
    case "pending":
      return query(baseRef, where("status", "==", "pending"), limit(HISTORY_LIMIT));
    case "rejected":
      return query(baseRef, where("status", "==", "rejected"), limit(HISTORY_LIMIT));
    case "active":
    default:
      return query(baseRef, where("status", "==", "active"));
  }
};

export default function useAuctionItems(
  classId,
  statusFilter,
  { enabled = true } = {},
) {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !classId) {
      setItems([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const unsub = onSnapshot(
      buildAuctionQuery(collection(db, "classes", classId, "auction"), statusFilter),
      (snap) => {
        const list = sortAuctionItems(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          statusFilter,
        );
        setItems(list);
        setIsLoading(false);
      },
      (err) => {
        setItems([]);
        setError(err);
        setIsLoading(false);
      },
    );

    return () => unsub();
  }, [classId, enabled, statusFilter]);

  const sorted = useMemo(() => items, [items]);
  return { items: sorted, isLoading, error };
}
