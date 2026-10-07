"use strict";

const admin = require("../firebaseAdminCompat");
if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");

const STOCK_JOB_INDEX_VERSION = 1;
const STOCK_JOB_INDEX_META_PATH = "system_meta/stockJobIndex";
const STOCK_JOB_INDEX_STUDENT_COLLECTION = "stockJobIndexStudents";
const STOCK_JOB_INDEX_SYMBOL_COLLECTION = "stockJobIndexSymbols";

const asNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSymbol = (value) =>
  String(value || "").trim().toUpperCase();

const uniqueSortedSymbols = (symbols = []) =>
  [...new Set(symbols.map(normalizeSymbol).filter(Boolean))].sort();

const buildClassIndexPayload = ({
  stockHolderCount = 0,
  heldSymbols = [],
  source = "unknown",
}) => ({
  stockJobIndex: {
    version: STOCK_JOB_INDEX_VERSION,
    hasStockHolders: stockHolderCount > 0,
    stockHolderCount,
    heldSymbols: uniqueSortedSymbols(heldSymbols),
    updatedAt: FieldValue.serverTimestamp(),
    lastRebuiltSource: source,
  },
});

const getClassRef = (classId) => db.doc(`classes/${classId}`);
const getStudentStateRef = (classId, studentUid) =>
  getClassRef(classId)
    .collection(STOCK_JOB_INDEX_STUDENT_COLLECTION)
    .doc(String(studentUid || "").trim());
const getSymbolStateRef = (classId, symbol) =>
  getClassRef(classId)
    .collection(STOCK_JOB_INDEX_SYMBOL_COLLECTION)
    .doc(normalizeSymbol(symbol));

const rebuildClassStockJobIndex = async (
  classId,
  { source = "rebuild_class" } = {},
) => {
  if (!classId) {
    throw new Error("rebuildClassStockJobIndex requires classId.");
  }

  const classRef = getClassRef(classId);
  const studentsRef = db.collection(`classes/${classId}/students`);

  const [studentsSnap, existingStudentStateSnap, existingSymbolStateSnap] =
    await Promise.all([
      studentsRef.get(),
      classRef.collection(STOCK_JOB_INDEX_STUDENT_COLLECTION).get(),
      classRef.collection(STOCK_JOB_INDEX_SYMBOL_COLLECTION).get(),
    ]);

  const studentSymbolCounts = new Map();
  const symbolHolderCounts = new Map();

  await Promise.all(
    studentsSnap.docs.map(async (studentDoc) => {
      const portfolioSnap = await studentDoc.ref.collection("stockPortfolio").get();
      let symbolCount = 0;

      portfolioSnap.forEach((portfolioDoc) => {
        const data = portfolioDoc.data() || {};
        const quantity = asNum(data.quantity, 0);
        if (!(quantity > 0)) {
          return;
        }

        const symbol = normalizeSymbol(data.symbol || portfolioDoc.id);
        if (!symbol) {
          return;
        }

        symbolCount += 1;
        symbolHolderCounts.set(symbol, (symbolHolderCounts.get(symbol) || 0) + 1);
      });

      if (symbolCount > 0) {
        studentSymbolCounts.set(studentDoc.id, symbolCount);
      }
    }),
  );

  const batch = db.batch();

  existingStudentStateSnap.docs.forEach((docSnap) => {
    if (!studentSymbolCounts.has(docSnap.id)) {
      batch.delete(docSnap.ref);
    }
  });

  studentSymbolCounts.forEach((symbolCount, studentUid) => {
    batch.set(
      getStudentStateRef(classId, studentUid),
      {
        symbolCount,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  existingSymbolStateSnap.docs.forEach((docSnap) => {
    if (!symbolHolderCounts.has(docSnap.id)) {
      batch.delete(docSnap.ref);
    }
  });

  symbolHolderCounts.forEach((holderCount, symbol) => {
    batch.set(
      getSymbolStateRef(classId, symbol),
      {
        symbol,
        holderCount,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  batch.set(
    classRef,
    buildClassIndexPayload({
      stockHolderCount: studentSymbolCounts.size,
      heldSymbols: [...symbolHolderCounts.keys()],
      source,
    }),
    { merge: true },
  );

  await batch.commit();

  return {
    classId,
    stockHolderCount: studentSymbolCounts.size,
    heldSymbols: uniqueSortedSymbols([...symbolHolderCounts.keys()]),
  };
};

const rebuildAllClassStockJobIndexes = async (
  { source = "rebuild_all" } = {},
) => {
  const classesSnap = await db.collection("classes").get();
  const failures = [];
  let indexedClassCount = 0;
  let indexedHolderClassCount = 0;

  for (const classDoc of classesSnap.docs) {
    try {
      const result = await rebuildClassStockJobIndex(classDoc.id, {
        source,
      });
      indexedClassCount += 1;
      if (result.stockHolderCount > 0) {
        indexedHolderClassCount += 1;
      }
    } catch (error) {
      failures.push({
        classId: classDoc.id,
        message: error?.message || "Unknown error",
      });
    }
  }

  const metaRef = db.doc(STOCK_JOB_INDEX_META_PATH);
  if (failures.length === 0) {
    await metaRef.set(
      {
        version: STOCK_JOB_INDEX_VERSION,
        indexedClassCount,
        indexedHolderClassCount,
        lastRebuiltAt: FieldValue.serverTimestamp(),
        lastRebuiltSource: source,
        lastFailureCount: 0,
      },
      { merge: true },
    );
  } else {
    await metaRef.set(
      {
        indexedClassCount,
        indexedHolderClassCount,
        lastRebuildAttemptAt: FieldValue.serverTimestamp(),
        lastRebuiltSource: source,
        lastFailureCount: failures.length,
        failedClassIds: failures.map((item) => item.classId),
      },
      { merge: true },
    );
  }

  return {
    totalClasses: classesSnap.size,
    indexedClassCount,
    indexedHolderClassCount,
    failures,
  };
};

const ensureStockJobIndexBootstrapped = async (
  { source = "ensure_bootstrap" } = {},
) => {
  const metaSnap = await db.doc(STOCK_JOB_INDEX_META_PATH).get();
  if (
    metaSnap.exists &&
    asNum(metaSnap.data()?.version, 0) === STOCK_JOB_INDEX_VERSION
  ) {
    return { bootstrapped: false, failures: [] };
  }

  const result = await rebuildAllClassStockJobIndexes({ source });
  if (result.failures.length > 0) {
    throw new Error(
      `Stock job index bootstrap failed for ${result.failures.length} classes.`,
    );
  }

  return {
    bootstrapped: true,
    failures: [],
    indexedClassCount: result.indexedClassCount,
  };
};

const applyPortfolioIndexDelta = async (
  tx,
  {
    classId,
    studentUid,
    symbol,
    createdPortfolio = false,
    deletedPortfolio = false,
    source = "portfolio_delta",
  } = {},
) => {
  if (!classId || !studentUid) {
    return { shouldRebuild: true };
  }

  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) {
    return { shouldRebuild: true };
  }

  if (!createdPortfolio && !deletedPortfolio) {
    return { shouldRebuild: false };
  }

  const classRef = getClassRef(classId);
  const studentStateRef = getStudentStateRef(classId, studentUid);
  const symbolStateRef = getSymbolStateRef(classId, normalizedSymbol);

  const [classSnap, studentStateSnap, symbolStateSnap] = await Promise.all([
    tx.get(classRef),
    tx.get(studentStateRef),
    tx.get(symbolStateRef),
  ]);

  const classIndex = classSnap.data()?.stockJobIndex || {};
  let shouldRebuild = asNum(classIndex.version, 0) !== STOCK_JOB_INDEX_VERSION;
  let stockHolderCount = Math.max(0, asNum(classIndex.stockHolderCount, 0));
  const heldSymbols = new Set(
    uniqueSortedSymbols(Array.isArray(classIndex.heldSymbols) ? classIndex.heldSymbols : []),
  );

  if (createdPortfolio) {
    const previousStudentSymbolCount = Math.max(
      0,
      asNum(studentStateSnap.data()?.symbolCount, 0),
    );
    const previousSymbolHolderCount = Math.max(
      0,
      asNum(symbolStateSnap.data()?.holderCount, 0),
    );

    if (previousStudentSymbolCount === 0) {
      stockHolderCount += 1;
    }
    if (previousSymbolHolderCount === 0) {
      heldSymbols.add(normalizedSymbol);
    }

    tx.set(
      studentStateRef,
      {
        symbolCount: previousStudentSymbolCount + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      symbolStateRef,
      {
        symbol: normalizedSymbol,
        holderCount: previousSymbolHolderCount + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  if (deletedPortfolio) {
    const previousStudentSymbolCount = Math.max(
      0,
      asNum(studentStateSnap.data()?.symbolCount, 0),
    );
    const previousSymbolHolderCount = Math.max(
      0,
      asNum(symbolStateSnap.data()?.holderCount, 0),
    );

    if (previousStudentSymbolCount <= 0 || previousSymbolHolderCount <= 0) {
      shouldRebuild = true;
    }

    if (previousStudentSymbolCount > 0) {
      if (previousStudentSymbolCount === 1) {
        tx.delete(studentStateRef);
        stockHolderCount = Math.max(0, stockHolderCount - 1);
      } else {
        tx.set(
          studentStateRef,
          {
            symbolCount: previousStudentSymbolCount - 1,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    if (previousSymbolHolderCount > 0) {
      if (previousSymbolHolderCount === 1) {
        tx.delete(symbolStateRef);
        heldSymbols.delete(normalizedSymbol);
      } else {
        tx.set(
          symbolStateRef,
          {
            symbol: normalizedSymbol,
            holderCount: previousSymbolHolderCount - 1,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }
  }

  tx.set(
    classRef,
    buildClassIndexPayload({
      stockHolderCount,
      heldSymbols: [...heldSymbols],
      source,
    }),
    { merge: true },
  );

  return { shouldRebuild };
};

const getClassesWithStockHolders = async () =>
  db.collection("classes").where("stockJobIndex.hasStockHolders", "==", true).get();

const chunkArray = (items = [], size = 30) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const getClassIdsHoldingAnySymbols = async (symbols = []) => {
  const normalizedSymbols = uniqueSortedSymbols(symbols);
  if (normalizedSymbols.length === 0) {
    return [];
  }

  const classIds = new Set();
  const chunks = chunkArray(normalizedSymbols, 30);

  for (const symbolChunk of chunks) {
    const snap = await db
      .collection("classes")
      .where("stockJobIndex.heldSymbols", "array-contains-any", symbolChunk)
      .get();

    snap.forEach((docSnap) => {
      classIds.add(docSnap.id);
    });
  }

  return [...classIds];
};

const getHeldSymbolsAcrossClasses = async () => {
  const symbols = new Set();
  const classesSnap = await getClassesWithStockHolders();

  classesSnap.forEach((classDoc) => {
    const heldSymbols = classDoc.data()?.stockJobIndex?.heldSymbols;
    if (!Array.isArray(heldSymbols)) {
      return;
    }

    heldSymbols.forEach((symbol) => {
      const normalized = normalizeSymbol(symbol);
      if (normalized) {
        symbols.add(normalized);
      }
    });
  });

  return symbols;
};

module.exports = {
  STOCK_JOB_INDEX_VERSION,
  applyPortfolioIndexDelta,
  ensureStockJobIndexBootstrapped,
  getClassIdsHoldingAnySymbols,
  getClassesWithStockHolders,
  getHeldSymbolsAcrossClasses,
  rebuildAllClassStockJobIndexes,
  rebuildClassStockJobIndex,
};
