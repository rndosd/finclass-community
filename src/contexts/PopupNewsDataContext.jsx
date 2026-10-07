import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";
import { useUser } from "./UserContext";

const MAX_NEWS_SCAN = 30;
const EMPTY_NEWS = Object.freeze([]);
const EMPTY_STATUS = Object.freeze({ exists: false, data: null });
const PopupNewsDataContext = createContext(null);

const serializeFirestoreError = (error) => ({
  code: error?.code || null,
  name: error?.name || null,
  message: error?.message || String(error || "Unknown error"),
});

const isFirestoreInternalAssertionError = (error) => {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "");
  return code === "internal" || /INTERNAL ASSERTION FAILED/i.test(message);
};

const shouldUseLegacyPopupFallback = (error) => {
  if (!error || isFirestoreInternalAssertionError(error)) return false;
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "failed-precondition" && message.includes("index");
};

const buildStatusCacheKey = ({ classId, uid, newsId, popupVersion, kind }) =>
  `${kind}_${classId}_${uid}_${newsId}_v${popupVersion}`;

const getStatusRef = ({ classId, uid, newsId, popupVersion, kind }) => {
  const collectionName =
    kind === "ack" ? "newsPopupAcks" : "newsPopupDismissals";
  const documentId = `${classId}_${newsId}_v${popupVersion}`;
  return doc(
    db,
    `classes/${classId}/students/${uid}/${collectionName}/${documentId}`,
  );
};

export function PopupNewsDataProvider({ children }) {
  const { classId, userData, authTransitioning } = useUser();
  const uid = userData?.uid;
  const [newsList, setNewsList] = useState(EMPTY_NEWS);
  const [loading, setLoading] = useState(false);
  const statusCacheRef = useRef(new Map());
  const cacheEpochRef = useRef(0);

  useEffect(() => {
    cacheEpochRef.current += 1;
    statusCacheRef.current.clear();
  }, [authTransitioning, classId, uid]);

  useEffect(() => {
    if (authTransitioning || !classId || !uid) {
      setNewsList(EMPTY_NEWS);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const newsRef = collection(db, `classes/${classId}/news`);
    const popupNewsQuery = query(
      newsRef,
      where("popupEnabled", "==", true),
      orderBy("createdAt", "desc"),
      limit(MAX_NEWS_SCAN),
    );
    const fallbackNewsQuery = query(
      newsRef,
      orderBy("createdAt", "desc"),
      limit(MAX_NEWS_SCAN),
    );
    let cancelled = false;
    let fallbackRequestId = 0;

    const applySnapshot = (snapshot) => {
      if (cancelled) return;
      setNewsList(
        snapshot.docs.map((item) => ({
          id: item.id,
          dataSource: "news",
          ...item.data(),
        })),
      );
      setLoading(false);
    };

    const loadFallbackSnapshot = async () => {
      const requestId = ++fallbackRequestId;
      try {
        const snapshot = await getDocs(fallbackNewsQuery);
        if (cancelled || requestId !== fallbackRequestId) return;
        applySnapshot(snapshot);
      } catch (error) {
        if (cancelled || requestId !== fallbackRequestId) return;
        console.error(
          "[PopupNewsData] legacy query failed:",
          serializeFirestoreError(error),
        );
        setLoading(false);
      }
    };

    const unsubscribe = onSnapshot(
      popupNewsQuery,
      applySnapshot,
      (error) => {
        if (cancelled) return;
        const errorDetails = serializeFirestoreError(error);
        if (shouldUseLegacyPopupFallback(error)) {
          console.warn(
            "[PopupNewsData] popup-only query requires fallback:",
            errorDetails,
          );
          void loadFallbackSnapshot();
          return;
        }
        console.error(
          "[PopupNewsData] popup-only query failed without fallback:",
          errorDetails,
        );
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      fallbackRequestId += 1;
      unsubscribe();
    };
  }, [authTransitioning, classId, uid]);

  const readPopupStatus = useCallback(
    async ({ kind, newsId, popupVersion }) => {
      if (
        authTransitioning ||
        !classId ||
        !uid ||
        (kind !== "ack" && kind !== "dismiss")
      ) {
        return EMPTY_STATUS;
      }

      const statusKey = { classId, uid, newsId, popupVersion, kind };
      const cacheKey = buildStatusCacheKey(statusKey);
      const cached = statusCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const requestEpoch = cacheEpochRef.current;
      const stateSnap = await getDoc(getStatusRef(statusKey));
      const nextStatus = {
        exists: stateSnap.exists(),
        data: stateSnap.exists() ? stateSnap.data() : null,
      };
      if (requestEpoch === cacheEpochRef.current) {
        statusCacheRef.current.set(cacheKey, nextStatus);
      }
      return nextStatus;
    },
    [authTransitioning, classId, uid],
  );

  const rememberPopupStatus = useCallback(
    ({ kind, newsId, popupVersion, data }) => {
      if (!classId || !uid) return;
      statusCacheRef.current.set(
        buildStatusCacheKey({ classId, uid, newsId, popupVersion, kind }),
        { exists: true, data: data || null },
      );
    },
    [classId, uid],
  );

  const value = useMemo(
    () => ({ newsList, loading, readPopupStatus, rememberPopupStatus }),
    [loading, newsList, readPopupStatus, rememberPopupStatus],
  );

  return (
    <PopupNewsDataContext.Provider value={value}>
      {children}
    </PopupNewsDataContext.Provider>
  );
}

export function usePopupNewsData() {
  return useContext(PopupNewsDataContext) || {
    newsList: EMPTY_NEWS,
    loading: false,
    readPopupStatus: async () => EMPTY_STATUS,
    rememberPopupStatus: () => {},
  };
}
