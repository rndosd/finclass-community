import { useEffect, useMemo, useRef, useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import {
  createSnapshotTelemetryModeTracker,
  trackFirestorePayload,
  withFirestoreSnapshotTelemetry,
} from "../../../utils/firestoreTelemetry";
import { beginFirestoreSubscriptionDebug } from "../../../utils/firestoreSubscriptionDebug";
import {
  isStoreItemVisibleToStudents,
  normalizeStoreItemSaleStatus,
} from "../utils/storeSaleStatus";
import {
  isVipLoungeCategory,
  shouldLoadVipStoreItems,
} from "../utils/vipLounge";

const functions = getFunctions(undefined, "asia-northeast3");
const rebuildStoreCatalogSummaryFunction = httpsCallable(
  functions,
  "rebuildStoreCatalogSummary",
);
const STORE_CATALOG_SCHEMA_VERSION = 4;

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (typeof value === "number") return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const compareStoreItems = (left, right) => {
  const leftOrder = Number(left?.displayOrder);
  const rightOrder = Number(right?.displayOrder);
  const hasLeftOrder = Number.isFinite(leftOrder);
  const hasRightOrder = Number.isFinite(rightOrder);

  if (hasLeftOrder || hasRightOrder) {
    if (!hasLeftOrder) return 1;
    if (!hasRightOrder) return -1;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  }

  const leftCreatedAt = toMillis(left?.createdAt);
  const rightCreatedAt = toMillis(right?.createdAt);
  const hasLeftCreatedAt = leftCreatedAt !== null;
  const hasRightCreatedAt = rightCreatedAt !== null;

  if (hasLeftCreatedAt || hasRightCreatedAt) {
    if (!hasLeftCreatedAt) return 1;
    if (!hasRightCreatedAt) return -1;
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
  }

  return String(left?.name || "").localeCompare(String(right?.name || ""), "ko");
};

const normalizeStoreItemRecord = ({ id, rawData = {} }) => {
  const saleStatus = normalizeStoreItemSaleStatus(rawData);

  return {
    id,
    ...rawData,
    saleStatus,
    isActive: isStoreItemVisibleToStudents({
      ...rawData,
      saleStatus,
    }),
    isTaxable: rawData.isTaxable !== false,
    isGiftAllowed: rawData.isGiftAllowed !== false,
  };
};

const mapStoreItemSnapshot = (docSnapshot) =>
  normalizeStoreItemRecord({
    id: docSnapshot.id,
    rawData: docSnapshot.data() || {},
  });

const normalizeStoreCatalogItems = (catalogData = {}) => {
  const rawItems = Array.isArray(catalogData?.items)
    ? catalogData.items
    : catalogData?.items && typeof catalogData.items === "object"
      ? Object.entries(catalogData.items).map(([id, item]) => ({
          id,
          ...(item || {}),
        }))
      : [];

  return rawItems
    .filter((item) => item && typeof item === "object")
    .map((item) =>
      normalizeStoreItemRecord({
        id: item.id,
        rawData: item,
      }),
    )
    .filter((item) => isStoreItemVisibleToStudents(item));
};

const useStoreData = ({ includeHiddenItems = true } = {}) => {
  const { classId, isTeacher, userData } = useUser();
  const [categories, setCategories] = useState([]);
  const [rawItems, setRawItems] = useState([]);
  const [vipItems, setVipItems] = useState([]);
  const [isLoadingVipItems, setIsLoadingVipItems] = useState(false);
  const [catalogSubscriptionVersion, setCatalogSubscriptionVersion] = useState(0);
  const catalogRetryClassRef = useRef(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(true);

  // Listener identity follows the query and access result, not display objects.
  const managerCategoryKey = JSON.stringify(
    includeHiddenItems && !isTeacher
      ? [...new Set(categories.filter((category) => !isVipLoungeCategory(category))
          .map((category) => category.id))].sort()
      : [],
  );
  const vipAccessAllowed = shouldLoadVipStoreItems({
    classId,
    category: categories.find((category) => category.id === selectedCategoryId),
    student: userData,
    isTeacher,
    includeHiddenItems,
  });
  const vipUserUid = String(userData?.uid || userData?.id || "");

  useEffect(() => {
    setSelectedCategoryId(null);
  }, [classId]);

  useEffect(() => {
    setCategories([]);
    setIsLoadingCategories(Boolean(classId));
    if (!classId) return undefined;
    let active = true;

    const categoriesQuery = query(
      collection(db, "classes", classId, "storeCategories"),
      orderBy("order", "asc"),
    );
    const getTelemetryMode = createSnapshotTelemetryModeTracker();
    const subscriptionDebug = beginFirestoreSubscriptionDebug({
      source: "Store.categories",
      pathKey: "classes/{classId}/storeCategories",
      classId,
      role: isTeacher ? "teacher" : "student",
    });

    const unsubscribe = onSnapshot(categoriesQuery, { includeMetadataChanges: true },
      (snapshot) => {
      if (!active) return;
      subscriptionDebug.recordSnapshot(snapshot);
      const nextCategories = snapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ...docSnapshot.data(),
      }));
      trackFirestorePayload({
        classId,
        source: "useStoreData.categories",
        sourceGroup: "page",
        pathKey: "classes/{classId}/storeCategories",
        mode: getTelemetryMode(snapshot),
        rows: nextCategories,
        snapshot,
      });

      setCategories(nextCategories);
      setIsLoadingCategories(false);
      setSelectedCategoryId((previous) => previous || nextCategories[0]?.id || null);
    });

    return () => {
      active = false;
      unsubscribe();
      subscriptionDebug.stop();
    };
  }, [classId, isTeacher]);

  useEffect(() => {
    if (!classId) {
      setRawItems([]);
      setIsLoadingItems(false);
      return undefined;
    }

    setRawItems([]);
    setIsLoadingItems(true);

    const itemsCollection = collection(db, "classes", classId, "storeItems");

    if (includeHiddenItems) {
      const managerCategoryIds = JSON.parse(managerCategoryKey);
      const itemQueries = isTeacher
        ? [query(itemsCollection)]
        : managerCategoryIds.map((categoryId) => query(
            itemsCollection,
            where("categoryId", "==", categoryId),
          ));
      const subscriptionDebug = beginFirestoreSubscriptionDebug({
        source: "Store.items.admin",
        pathKey: "classes/{classId}/storeItems",
        classId,
        role: isTeacher ? "teacher" : "student",
      });

      let active = true;
      if (itemQueries.length === 0) setIsLoadingItems(false);
      const itemsByQuery = new Map();
      const unsubscribes = itemQueries.map((itemsQuery, index) => {
        const getTelemetryMode = createSnapshotTelemetryModeTracker();
        return onSnapshot(
        itemsQuery, { includeMetadataChanges: true },
        (snapshot) => {
          if (!active) return;
          subscriptionDebug.recordSnapshot(snapshot);
          itemsByQuery.set(index, snapshot.docs.map(mapStoreItemSnapshot));
          const nextItems = [...itemsByQuery.values()].flat();
          trackFirestorePayload({
            classId,
            source: "useStoreData.items",
            sourceGroup: "page",
            pathKey: "classes/{classId}/storeItems",
            mode: getTelemetryMode(snapshot),
            rows: nextItems,
            snapshot,
          });
          setRawItems(nextItems);
          setIsLoadingItems(false);
        },
        (error) => {
          if (!active) return;
          subscriptionDebug.recordError(error);
          console.error("[useStoreData] items listener error:", error);
          setRawItems([]);
          setIsLoadingItems(false);
        },
        );
      });

      return () => {
        active = false;
        unsubscribes.forEach((unsubscribe) => unsubscribe());
        subscriptionDebug.stop();
      };
    }

    let isCancelled = false;
    let catalogBackfillPromise = null;
    const requestCatalogBackfill = async (retryListener = false) => {
      if (isCancelled) return;
      try {
        // Reuse the repair even when a terminal error arrives after it completes.
        catalogBackfillPromise ||= rebuildStoreCatalogSummaryFunction({ classId });
        await catalogBackfillPromise;
        if (!isCancelled && retryListener && catalogRetryClassRef.current !== classId) {
          catalogRetryClassRef.current = classId;
          setCatalogSubscriptionVersion((version) => version + 1);
        }
      } catch (error) {
        console.error("[useStoreData] catalog backfill error:", error);
      }
    };

    const catalogRef = doc(db, "classes", classId, "storeSettings", "catalog");
    const getTelemetryMode = createSnapshotTelemetryModeTracker();
    const subscriptionDebug = beginFirestoreSubscriptionDebug({
      source: "Store.catalogSummary",
      pathKey: "classes/{classId}/storeSettings/catalog",
      classId,
      role: isTeacher ? "teacher" : "student",
    });
    const unsubscribeCatalog = onSnapshot(
      catalogRef, { includeMetadataChanges: true },
      (snapshot) => {
        subscriptionDebug.recordSnapshot(snapshot);
        if (isCancelled) return;

        const catalogData = snapshot.data() || {};
        const hasCatalogPayload =
          Array.isArray(catalogData.items) ||
          (catalogData.items && typeof catalogData.items === "object");
        const hasExpectedSchemaVersion =
          Number(catalogData?.schemaVersion) === STORE_CATALOG_SCHEMA_VERSION;

        if (
          snapshot.exists() &&
          hasCatalogPayload &&
          hasExpectedSchemaVersion
        ) {
          const nextItems = normalizeStoreCatalogItems(catalogData);
          trackFirestorePayload({
            classId,
            source: "useStoreData.catalogSummary",
            sourceGroup: "page",
            pathKey: "classes/{classId}/storeSettings/catalog",
            mode: getTelemetryMode(snapshot),
            rows: [{ id: "catalog", ...catalogData }],
            snapshot,
          });
          setRawItems(nextItems);
          setIsLoadingItems(false);
          return;
        }

        setRawItems([]);
        setIsLoadingItems(false);
        void requestCatalogBackfill();
      },
      (error) => {
        subscriptionDebug.recordError(error);
        console.error("[useStoreData] catalog summary listener error:", error);
        if (isCancelled) return;
        setRawItems([]);
        setIsLoadingItems(false);
        // A listener error is terminal; missing/old data still has a live listener.
        void requestCatalogBackfill(true);
      },
    );

    return () => {
      isCancelled = true;
      unsubscribeCatalog();
      subscriptionDebug.stop();
    };
  }, [catalogSubscriptionVersion, managerCategoryKey, classId, includeHiddenItems, isTeacher]);

  useEffect(() => {
    if (!vipAccessAllowed) {
      setVipItems([]);
      setIsLoadingVipItems(false);
      return undefined;
    }

    let active = true;
    setVipItems([]);
    setIsLoadingVipItems(true);
    const vipQuery = query(
      collection(db, "classes", classId, "storeItems"),
      where("categoryId", "==", selectedCategoryId),
    );
    const unsubscribe = onSnapshot(
      vipQuery,
      { includeMetadataChanges: true },
      withFirestoreSnapshotTelemetry({ classId }, (snapshot) => {
        if (!active) return;
        setVipItems(
          snapshot.docs.map(mapStoreItemSnapshot).filter((item) =>
            isTeacher || isStoreItemVisibleToStudents(item),
          ),
        );
        setIsLoadingVipItems(false);
      }),
      (error) => {
        if (!active) return;
        console.error("[useStoreData] VIP items listener error:", error);
        setVipItems([]);
        setIsLoadingVipItems(false);
      },
    );
    return () => {
      active = false;
      unsubscribe();
      setVipItems([]);
    };
  }, [classId, isTeacher, selectedCategoryId, vipAccessAllowed, vipUserUid]);

  const categoryOrderMap = useMemo(
    () =>
      categories.reduce((accumulator, category, index) => {
        accumulator[category.id] = Number.isFinite(Number(category?.order))
          ? Number(category.order)
          : index;
        return accumulator;
      }, {}),
    [categories],
  );

  const allItems = useMemo(() => {
    return [...rawItems, ...vipItems].sort((left, right) => {
      const leftCategoryOrder = Number(
        categoryOrderMap[left?.categoryId] ?? Number.MAX_SAFE_INTEGER,
      );
      const rightCategoryOrder = Number(
        categoryOrderMap[right?.categoryId] ?? Number.MAX_SAFE_INTEGER,
      );

      if (leftCategoryOrder !== rightCategoryOrder) {
        return leftCategoryOrder - rightCategoryOrder;
      }

      return compareStoreItems(left, right);
    });
  }, [categoryOrderMap, rawItems, vipItems]);

  const currentCategoryItems = useMemo(() => {
    return allItems.filter((item) => item.categoryId === selectedCategoryId);
  }, [allItems, selectedCategoryId]);

  return {
    categories,
    selectedCategoryId,
    setSelectedCategoryId,
    allItems,
    currentCategoryItems,
    isLoading: isLoadingCategories || isLoadingItems || isLoadingVipItems,
    isLoadingItems: isLoadingItems || isLoadingVipItems,
  };
};

export default useStoreData;
