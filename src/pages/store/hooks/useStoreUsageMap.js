import { useEffect, useMemo, useState } from "react";
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { db } from "../../../firebase";
import { trackFirestorePayload } from "../../../utils/firestoreTelemetry";

const STORE_USAGE_IN_QUERY_LIMIT = 10;

const normalizeItemIds = (itemIds = []) =>
  Array.from(
    new Set(
      itemIds.filter(
        (itemId) => typeof itemId === "string" && itemId.trim().length > 0,
      ),
    ),
  ).sort();

const chunkItemIds = (itemIds = [], chunkSize = STORE_USAGE_IN_QUERY_LIMIT) => {
  const chunks = [];

  for (let index = 0; index < itemIds.length; index += chunkSize) {
    chunks.push(itemIds.slice(index, index + chunkSize));
  }

  return chunks;
};

const useStoreUsageMap = ({ classId, uid, itemIds = [], enabled = true }) => {
  const [usageCache, setUsageCache] = useState({});
  const [loadedMap, setLoadedMap] = useState({});

  const normalizedItemIds = useMemo(() => normalizeItemIds(itemIds), [itemIds]);
  const itemIdsSignature = normalizedItemIds.join("|");

  useEffect(() => {
    if (!enabled || !classId || !uid || normalizedItemIds.length === 0) {
      setLoadedMap({});
      return undefined;
    }

    let isCancelled = false;

    setLoadedMap(
      normalizedItemIds.reduce((accumulator, itemId) => {
        accumulator[itemId] = false;
        return accumulator;
      }, {}),
    );

    setUsageCache((previous) => {
      const next = { ...previous };
      normalizedItemIds.forEach((itemId) => {
        delete next[itemId];
      });
      return next;
    });

    const usageCollection = collection(
      db,
      "classes",
      classId,
      "students",
      uid,
      "storeUsage",
    );
    const itemIdChunks = chunkItemIds(normalizedItemIds);

    void Promise.all(
      itemIdChunks.map(async (chunk) => {
        const snapshot = await getDocs(
          query(usageCollection, where(documentId(), "in", chunk)),
        );

        if (!isCancelled) {
          trackFirestorePayload({
            classId,
            source: "useStoreUsageMap",
            sourceGroup: "page",
            pathKey: "classes/{classId}/students/{uid}/storeUsage",
            mode: "getDocs",
            snapshot,
          });
        }
        return snapshot.docs.map((docSnapshot) => ({
          itemId: docSnapshot.id,
          data: docSnapshot.data() || {},
        }));
      }),
    )
      .then((chunkResults) => {
        if (isCancelled) return;

        const dataByItemId = new Map(
          chunkResults.flat().map((entry) => [entry.itemId, entry.data]),
        );
        const results = normalizedItemIds.map((itemId) => ({
          itemId,
          data: dataByItemId.get(itemId) ?? null,
        }));

        setUsageCache((previous) => {
          const next = { ...previous };

          results.forEach(({ itemId, data }) => {
            if (data === null) {
              delete next[itemId];
              return;
            }

            next[itemId] = data;
          });

          return next;
        });

        setLoadedMap((previous) => {
          const next = { ...previous };

          results.forEach(({ itemId }) => {
            next[itemId] = true;
          });

          return next;
        });
      })
      .catch((error) => {
        console.error("[useStoreUsageMap] usage fetch error:", error);
        if (isCancelled) return;

        setLoadedMap((previous) => {
          const next = { ...previous };

          normalizedItemIds.forEach((itemId) => {
            next[itemId] = true;
          });

          return next;
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [classId, enabled, itemIdsSignature, normalizedItemIds, uid]);

  const usageData = useMemo(
    () =>
      normalizedItemIds.reduce((accumulator, itemId) => {
        if (usageCache[itemId] !== undefined) {
          accumulator[itemId] = usageCache[itemId];
        }
        return accumulator;
      }, {}),
    [normalizedItemIds, usageCache],
  );

  return {
    usageData,
    loadedMap,
    isLoading:
      enabled &&
      normalizedItemIds.length > 0 &&
      normalizedItemIds.some((itemId) => loadedMap[itemId] !== true),
  };
};

export default useStoreUsageMap;
