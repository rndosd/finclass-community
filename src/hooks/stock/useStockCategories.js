import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "../../firebase";
import { collection, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";
import { useUser } from "../../contexts/UserContext";
import { ADVANCED_ETFS, ADVANCED_STOCKS, STOCK_CATALOG_BY_TICKER } from "../../config/stockCatalog";
import { getKoreanCompanyName } from "../../config/defaultStockProfiles";
import { createSnapshotTelemetryModeTracker, trackFirestorePayload } from "../../utils/firestoreTelemetry";

const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();

const normalizeStocks = (symbols = []) =>
  (Array.isArray(symbols) ? symbols : [])
    .map((stock) => {
      const ticker = normalizeSymbol(stock?.ticker || stock?.symbol || stock);
      if (!ticker) return null;
      const catalogMetadata = STOCK_CATALOG_BY_TICKER.get(ticker) || {};
      const originalCompanyName = stock?.companyName || stock?.name || catalogMetadata.companyName || ticker;
      return {
        ...catalogMetadata,
        ...(stock && typeof stock === "object" ? stock : {}),
        ticker,
        companyName: getKoreanCompanyName(ticker, originalCompanyName),
        companyNameOriginal: originalCompanyName,
      };
    })
    .filter(Boolean);

const buildStockCategories = (globalRows, classSnap, uid, isTeacher) => {
  const globalDefinitions = [];
  globalRows.forEach((data) => {
    globalDefinitions.push({
      ...data,
      symbols: normalizeStocks(data.symbols),
    });
  });
  globalDefinitions.push({
    id: "advanced_etf_pool",
    name: "심화 ETF 종목 풀",
    defaultVisible: false,
    isSystemPool: true,
    symbols: normalizeStocks(ADVANCED_ETFS),
  });
  globalDefinitions.push({
    id: "advanced_stock_pool",
    name: "심화 주식 종목 풀",
    defaultVisible: false,
    isSystemPool: true,
    symbols: normalizeStocks(ADVANCED_STOCKS),
  });

  const classDefinitions = [];
  classSnap?.forEach((docSnap) => {
    const data = docSnap.data() || {};
    classDefinitions.push({
      id: docSnap.id,
      ...data,
      symbols: normalizeStocks(data.symbols),
    });
  });
  classDefinitions.sort(
    (left, right) =>
      Number(left.order || 0) - Number(right.order || 0) ||
      String(left.name || "").localeCompare(String(right.name || ""), "ko"),
  );

  const activeClassDefinitions = classDefinitions.filter(
    (category) => category.isActive !== false,
  );
  const claimedSymbols = new Set(
    activeClassDefinitions.flatMap((category) =>
      category.symbols.map((stock) => stock.ticker),
    ),
  );
  const privilegedSymbols = new Set();
  const categories = {};

  globalDefinitions.forEach((category) => {
    if (category.isSystemPool === true) return;
    if (!isTeacher && category.defaultVisible === false) return;
    const stocks = category.symbols.filter(
      (stock) =>
        !claimedSymbols.has(stock.ticker) &&
        (isTeacher || stock.defaultVisible !== false),
    );
    if (stocks.length > 0) categories[category.name || category.id] = stocks;
  });

  activeClassDefinitions.forEach((category) => {
    const requiresStudentSelection =
      category.accessMode === "selected_students" ||
      category.accessMode === "credential_required";
    const allowedStudentUids = Array.isArray(category.allowedStudentUids)
      ? category.allowedStudentUids.map((value) => String(value || "").trim())
      : [];
    const canAccess =
      isTeacher ||
      !requiresStudentSelection ||
      allowedStudentUids.includes(uid);

    if (!canAccess) return;
    if (requiresStudentSelection && !isTeacher) {
      category.symbols.forEach((stock) => privilegedSymbols.add(stock.ticker));
    }
    categories[category.name || category.id] = category.symbols;
  });

  const catalogMap = new Map();
  globalDefinitions.forEach((category) => {
    category.symbols.forEach((stock) => catalogMap.set(stock.ticker, stock));
  });
  activeClassDefinitions.forEach((category) => {
    category.symbols.forEach((stock) => catalogMap.set(stock.ticker, stock));
  });

  return {
    categories,
    classDefinitions,
    privilegedSymbols: Array.from(privilegedSymbols),
    catalogSymbols: isTeacher ? Array.from(catalogMap.values()) : [],
  };
};

export const useStockCategories = (classId = "") => {
  const { user, isTeacher } = useUser();
  const uid = user?.uid || "";
  const role = isTeacher ? "staff" : "student";
  const enabled = Boolean(uid);
  const scope = useMemo(() => ({ classId, uid, role }), [classId, uid, role]);
  const [classState, setClassState] = useState(null);

  useEffect(() => {
    if (!classId || !uid) return undefined;
    let active = true;
    const getTelemetryMode = createSnapshotTelemetryModeTracker();
    const unsubscribe = onSnapshot(
      collection(db, "classes", classId, "stockCategories"),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!active) return;
        trackFirestorePayload({
          classId, source: "useStockCategories.class", sourceGroup: "page",
          pathKey: "classes/{classId}/stockCategories", mode: getTelemetryMode(snapshot), snapshot,
        });
        setClassState({ scope, snapshot, error: null });
      },
      (error) => {
        if (!active) return;
        console.warn("[useStockCategories] Class categories are unavailable; showing global categories only.", error?.code || "unknown");
        setClassState({ scope, snapshot: null, error });
      },
    );
    return () => { active = false; unsubscribe(); };
  }, [classId, uid, scope]);

  // Discard the previous account/class immediately, before effect cleanup runs.
  const current = classState?.scope === scope ? classState : null;
  const classReady = !classId || Boolean(current);
  const classSnap = current?.snapshot || null;
  const select = useCallback(
    globalRows => buildStockCategories(globalRows, classSnap, uid, isTeacher),
    [classSnap, uid, isTeacher],
  );
  const result = useQuery({
    // Definitions are common to classes; account/role isolate authenticated caches.
    queryKey: ["stock", "categories", "global", uid, role],
    queryFn: async () => {
      const snapshot = await getDocs(query(collection(db, "stockCategories"), orderBy("order", "asc")));
      trackFirestorePayload({ classId, source: "useStockCategories", sourceGroup: "page",
        pathKey: "stockCategories", mode: "getDocs", snapshot });
      return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    },
    select,
    enabled,
    staleTime: 1000 * 60 * 5,
  });
  const waitingForClass = enabled && !classReady && !result.isError;
  return {
    ...result,
    data: enabled && classReady ? result.data : undefined,
    isLoading: enabled && (result.isLoading || waitingForClass),
    isPending: result.isPending || waitingForClass,
    isFetching: result.isFetching || waitingForClass,
    isSuccess: enabled && classReady && result.isSuccess,
    status: waitingForClass ? "pending" : result.status,
    classError: current?.error || null,
  };
};
