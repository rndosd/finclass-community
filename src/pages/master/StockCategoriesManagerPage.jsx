import { appConfirm } from "../../utils/appDialogs";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import {
  ArrowLeft,
  Database,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import {
  Alert,
  Button,
  Card,
  CardSkeleton,
  PageSkeleton,
  SurfaceLoader,
} from "../../components/ui";
import { db } from "../../firebase";
import { useFeedback } from "../../contexts/FeedbackContext";
import {
  getXlsxImportErrorMessage,
  parseFirstXlsxWorksheet,
  validateXlsxImportFile,
  XLSX_IMPORT_ACCEPT,
} from "../../utils/safeXlsxImport";

const COLLECTION_NAME = "stockCategories";
const TEMPLATE_FILE_NAME = "주식카테고리_업로드양식.xlsx";
const EXPORT_FILE_NAME_PREFIX = "주식카테고리";

const makeLocalId = () =>
  `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeText = (value) => String(value ?? "").trim();
const normalizeTicker = (value) => normalizeText(value).toUpperCase();
const normalizeDocumentId = (value) => normalizeText(value);

const parseOrder = (value, fallback = 0) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeNameKey = (value) =>
  normalizeText(value).replace(/\s+/g, " ").toLowerCase();

const slugifyCategoryName = (value) => {
  const ascii = normalizeText(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return ascii;
};

const sortCategories = (categories = []) =>
  [...categories].sort((a, b) => {
    const orderDiff = parseOrder(a.order, 0) - parseOrder(b.order, 0);
    if (orderDiff !== 0) return orderDiff;
    return normalizeText(a.name).localeCompare(normalizeText(b.name), "ko");
  });

const createSymbolRow = (symbol = {}) => ({
  localId: makeLocalId(),
  ticker: normalizeTicker(symbol.ticker || symbol.symbol),
  companyName: normalizeText(symbol.companyName || symbol.name),
});

const createCategory = (category = {}) => {
  const nextSymbols = Array.isArray(category.symbols)
    ? category.symbols.map((symbol) => createSymbolRow(symbol))
    : [];

  return {
    localId: category.localId || makeLocalId(),
    documentId: normalizeDocumentId(category.documentId || category.id),
    name: normalizeText(category.name),
    order: parseOrder(category.order, 0),
    symbols: nextSymbols.length > 0 ? nextSymbols : [createSymbolRow()],
  };
};

const flattenCategories = (categories = []) =>
  sortCategories(categories).flatMap((category) => {
    const rows = (category.symbols || []).filter(
      (symbol) => normalizeTicker(symbol.ticker) || normalizeText(symbol.companyName),
    );

    if (rows.length === 0) {
      return [
        {
          documentId: normalizeDocumentId(category.documentId),
          categoryName: normalizeText(category.name),
          order: parseOrder(category.order, 0),
          ticker: "",
          companyName: "",
        },
      ];
    }

    return rows.map((symbol) => ({
      documentId: normalizeDocumentId(category.documentId),
      categoryName: normalizeText(category.name),
      order: parseOrder(category.order, 0),
      ticker: normalizeTicker(symbol.ticker),
      companyName: normalizeText(symbol.companyName),
    }));
  });

const getExcelCell = (row, keys) => {
  for (const key of keys) {
    if (!(key in row)) continue;
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }

  return "";
};

const buildCategoriesFromWorksheet = (rows = [], existingCategories = []) => {
  const existingIdByName = new Map(
    existingCategories
      .filter((category) => normalizeText(category.name))
      .map((category) => [normalizeNameKey(category.name), category.documentId]),
  );

  const grouped = new Map();
  let rowCount = 0;

  rows.forEach((row, index) => {
    const documentId = normalizeDocumentId(
      getExcelCell(row, ["documentId", "docId", "id", "문서ID", "문서아이디"]),
    );
    const categoryName = normalizeText(
      getExcelCell(row, ["categoryName", "name", "category", "카테고리", "카테고리명"]),
    );
    const orderRaw = getExcelCell(row, ["order", "순서", "정렬순서"]);
    const ticker = normalizeTicker(getExcelCell(row, ["ticker", "symbol", "티커"]));
    const companyName = normalizeText(
      getExcelCell(row, ["companyName", "company", "company_name", "종목명", "회사명"]),
    );

    const isEmptyRow = !documentId && !categoryName && normalizeText(orderRaw) === "" && !ticker && !companyName;
    if (isEmptyRow) return;
    rowCount += 1;

    const resolvedId = documentId || existingIdByName.get(normalizeNameKey(categoryName)) || "";
    const groupingKey = resolvedId || `${normalizeNameKey(categoryName)}::${parseOrder(orderRaw, index + 1)}`;

    if (!grouped.has(groupingKey)) {
      grouped.set(
        groupingKey,
        createCategory({
          documentId: resolvedId,
          name: categoryName,
          order: parseOrder(orderRaw, grouped.size + 1),
          symbols: [],
        }),
      );
    }

    const category = grouped.get(groupingKey);
    if (!category.name && categoryName) category.name = categoryName;
    if (!category.documentId && resolvedId) category.documentId = resolvedId;
    if (!category.order) category.order = parseOrder(orderRaw, grouped.size);
    if (ticker || companyName) category.symbols.push(createSymbolRow({ ticker, companyName }));
  });

  const categories = sortCategories(Array.from(grouped.values())).map((category) => createCategory(category));

  return {
    categories,
    summary: {
      rowCount,
      categoryCount: categories.length,
      symbolCount: categories.reduce(
        (count, category) =>
          count + category.symbols.filter((symbol) => normalizeTicker(symbol.ticker) || normalizeText(symbol.companyName)).length,
        0,
      ),
    },
  };
};

const mergeImportedCategories = (currentCategories = [], importedCategories = []) => {
  const nextCategories = currentCategories.map((category) => ({
    ...category,
    symbols: (category.symbols || []).map((symbol) => ({ ...symbol })),
  }));

  const categoryIndexById = new Map();
  const categoryIndexByName = new Map();

  nextCategories.forEach((category, index) => {
    const documentId = normalizeDocumentId(category.documentId);
    const nameKey = normalizeNameKey(category.name);
    if (documentId) categoryIndexById.set(documentId, index);
    if (nameKey) categoryIndexByName.set(nameKey, index);
  });

  const summary = {
    addedCategoryCount: 0,
    updatedCategoryCount: 0,
    addedSymbolCount: 0,
    updatedSymbolCount: 0,
  };

  importedCategories.forEach((importedCategory) => {
    const documentId = normalizeDocumentId(importedCategory.documentId);
    const nameKey = normalizeNameKey(importedCategory.name);
    const matchedIndex = documentId && categoryIndexById.has(documentId)
      ? categoryIndexById.get(documentId)
      : categoryIndexByName.get(nameKey);

    if (matchedIndex === undefined) {
      const newCategory = createCategory({
        ...importedCategory,
        symbols: (importedCategory.symbols || []).filter(
          (symbol) => normalizeTicker(symbol.ticker) || normalizeText(symbol.companyName),
        ),
      });

      nextCategories.push(newCategory);
      const newIndex = nextCategories.length - 1;
      const nextDocumentId = normalizeDocumentId(newCategory.documentId);
      const nextNameKey = normalizeNameKey(newCategory.name);
      if (nextDocumentId) categoryIndexById.set(nextDocumentId, newIndex);
      if (nextNameKey) categoryIndexByName.set(nextNameKey, newIndex);

      summary.addedCategoryCount += 1;
      summary.addedSymbolCount += newCategory.symbols.filter(
        (symbol) => normalizeTicker(symbol.ticker) || normalizeText(symbol.companyName),
      ).length;
      return;
    }

    const targetCategory = nextCategories[matchedIndex];
    const existingSymbolIndexByTicker = new Map(
      (targetCategory.symbols || [])
        .map((symbol, index) => [normalizeTicker(symbol.ticker), index])
        .filter(([ticker]) => ticker),
    );
    let changedCategory = false;

    if (documentId && !normalizeDocumentId(targetCategory.documentId)) {
      targetCategory.documentId = documentId;
      changedCategory = true;
    }
    if (normalizeText(importedCategory.name) && normalizeText(importedCategory.name) !== normalizeText(targetCategory.name)) {
      targetCategory.name = normalizeText(importedCategory.name);
      changedCategory = true;
    }
    if (Number.isFinite(parseOrder(importedCategory.order, NaN))) {
      const nextOrder = parseOrder(importedCategory.order, targetCategory.order);
      if (nextOrder !== parseOrder(targetCategory.order, 0)) {
        targetCategory.order = nextOrder;
        changedCategory = true;
      }
    }

    (importedCategory.symbols || []).forEach((symbol) => {
      const ticker = normalizeTicker(symbol.ticker);
      const companyName = normalizeText(symbol.companyName);
      if (!ticker && !companyName) return;

      const symbolIndex = existingSymbolIndexByTicker.get(ticker);
      if (symbolIndex === undefined) {
        targetCategory.symbols.push(createSymbolRow({ ticker, companyName }));
        existingSymbolIndexByTicker.set(ticker, targetCategory.symbols.length - 1);
        summary.addedSymbolCount += 1;
        return;
      }

      const existingSymbol = targetCategory.symbols[symbolIndex];
      if (companyName && normalizeText(existingSymbol.companyName) !== companyName) {
        existingSymbol.companyName = companyName;
        summary.updatedSymbolCount += 1;
      }
    });

    if (changedCategory) summary.updatedCategoryCount += 1;
  });

  return {
    categories: sortCategories(nextCategories).map((category) => createCategory(category)),
    summary,
  };
};

const StockCategoriesManagerPage = () => {
  const navigate = useNavigate();
  const { showFeedback } = useFeedback();
  const fileInputRef = useRef(null);
  const appendFileInputRef = useRef(null);
  const initialDocumentIdsRef = useRef(new Set());
  const hasLoadedCategoriesRef = useRef(false);

  const [categories, setCategories] = useState([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [importSummary, setImportSummary] = useState(null);

  const categoryCount = categories.length;
  const symbolCount = useMemo(
    () =>
      categories.reduce(
        (count, category) =>
          count + category.symbols.filter((symbol) => normalizeTicker(symbol.ticker) || normalizeText(symbol.companyName)).length,
        0,
      ),
    [categories],
  );

  const loadCategories = useCallback(async ({ preserveCurrent = false } = {}) => {
    if (preserveCurrent && hasLoadedCategoriesRef.current) {
      setIsRefreshing(true);
    } else {
      setIsInitialLoading(true);
    }
    try {
      const snapshot = await getDocs(collection(db, COLLECTION_NAME));
      const nextCategories = sortCategories(
        snapshot.docs.map((snapshotDoc) =>
          createCategory({
            documentId: snapshotDoc.id,
            ...snapshotDoc.data(),
          }),
        ),
      );

      setCategories(nextCategories);
      initialDocumentIdsRef.current = new Set(nextCategories.map((category) => category.documentId).filter(Boolean));
      setIsDirty(false);
      setImportSummary(null);
    } catch (error) {
      console.error("[StockCategoriesManagerPage] load failed:", error);
      showFeedback("주식 카테고리 데이터를 불러오지 못했습니다.", "error");
    } finally {
      hasLoadedCategoriesRef.current = true;
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  }, [showFeedback]);

  useEffect(() => {
    loadCategories({ preserveCurrent: false });
  }, [loadCategories]);

  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, []);

  const handleCategoryFieldChange = useCallback((localId, field, value) => {
    markDirty();
    setCategories((prev) =>
      prev.map((category) =>
        category.localId === localId
          ? {
              ...category,
              [field]: field === "order" ? (value === "" ? "" : parseOrder(value, 0)) : value,
            }
          : category,
      ),
    );
  }, [markDirty]);

  const handleSymbolFieldChange = useCallback((categoryLocalId, symbolLocalId, field, value) => {
    markDirty();
    setCategories((prev) =>
      prev.map((category) => {
        if (category.localId !== categoryLocalId) return category;

        return {
          ...category,
          symbols: category.symbols.map((symbol) =>
            symbol.localId === symbolLocalId
              ? { ...symbol, [field]: field === "ticker" ? normalizeTicker(value) : value }
              : symbol,
          ),
        };
      }),
    );
  }, [markDirty]);

  const handleAddCategory = useCallback(() => {
    markDirty();
    setCategories((prev) => [
      ...prev,
      createCategory({
        order: prev.reduce((maxValue, category) => Math.max(maxValue, parseOrder(category.order, 0)), 0) + 1,
        symbols: [],
      }),
    ]);
  }, [markDirty]);

  const handleRemoveCategory = useCallback((localId) => {
    markDirty();
    setCategories((prev) => prev.filter((category) => category.localId !== localId));
  }, [markDirty]);

  const handleAddSymbol = useCallback((categoryLocalId) => {
    markDirty();
    setCategories((prev) =>
      prev.map((category) =>
        category.localId === categoryLocalId
          ? { ...category, symbols: [...category.symbols, createSymbolRow()] }
          : category,
      ),
    );
  }, [markDirty]);

  const handleRemoveSymbol = useCallback((categoryLocalId, symbolLocalId) => {
    markDirty();
    setCategories((prev) =>
      prev.map((category) => {
        if (category.localId !== categoryLocalId) return category;
        const nextSymbols = category.symbols.filter((symbol) => symbol.localId !== symbolLocalId);
        return { ...category, symbols: nextSymbols.length > 0 ? nextSymbols : [createSymbolRow()] };
      }),
    );
  }, [markDirty]);

  const handleDownloadTemplate = useCallback(() => {
    const workbook = XLSX.utils.book_new();
    const templateRows = [
      ["문서ID", "카테고리명", "순서", "티커", "종목명"],
      ["major_etfs", "주요 ETF", 1, "SPY", "SPDR S&P 500 ETF"],
      ["major_etfs", "주요 ETF", 1, "QQQ", "Invesco QQQ ETF"],
      ["dividend_etfs", "배당 ETF", 2, "SCHD", "Schwab U.S. Dividend Equity ETF"],
      ["dividend_etfs", "배당 ETF", 2, "DGRO", "iShares Core Dividend Growth ETF"],
      ["real_estate_etfs", "부동산 ETF", 3, "VNQ", "Vanguard Real Estate ETF"],
      ["real_estate_infra", "부동산 및 인프라", 4, "O", "Realty Income"],
    ];

    const guideRows = [
      ["항목", "설명"],
      ["문서ID", "기존 카테고리를 수정할 때는 현재 문서 ID를 그대로 유지하세요. 새 카테고리일 때만 비워둘 수 있습니다."],
      ["카테고리명", "앱에서 보이는 카테고리 이름입니다."],
      ["순서", "숫자가 작을수록 먼저 노출됩니다."],
      ["티커", "미국 주식 또는 ETF 티커입니다. 저장 시 자동으로 대문자로 정리됩니다."],
      ["종목명", "티커와 함께 화면에 표시할 이름입니다."],
      ["작성 방법", "같은 카테고리에 여러 종목을 넣으려면 문서ID, 카테고리명, 순서를 여러 행에 반복해서 적어주세요."],
    ];

    const templateSheet = XLSX.utils.aoa_to_sheet(templateRows);
    const guideSheet = XLSX.utils.aoa_to_sheet(guideRows);
    templateSheet["!cols"] = [{ wch: 20 }, { wch: 28 }, { wch: 10 }, { wch: 12 }, { wch: 36 }];
    guideSheet["!cols"] = [{ wch: 18 }, { wch: 110 }];

    XLSX.utils.book_append_sheet(workbook, templateSheet, "업로드양식");
    XLSX.utils.book_append_sheet(workbook, guideSheet, "작성가이드");
    XLSX.writeFile(workbook, TEMPLATE_FILE_NAME);
  }, []);

  const handleExportCurrentData = useCallback(() => {
    const workbook = XLSX.utils.book_new();
    const rows = flattenCategories(categories).map((row) => ({
      문서ID: row.documentId,
      카테고리명: row.categoryName,
      순서: row.order,
      티커: row.ticker,
      종목명: row.companyName,
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [{ wch: 20 }, { wch: 28 }, { wch: 10 }, { wch: 12 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, "주식카테고리");
    XLSX.writeFile(workbook, `${EXPORT_FILE_NAME_PREFIX}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [categories]);

  const handleImportExcel = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      validateXlsxImportFile(file);
    } catch (error) {
      showFeedback(getXlsxImportErrorMessage(error), "error");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const { rows } = parseFirstXlsxWorksheet(loadEvent.target?.result, {
          file,
        });
        const parsed = buildCategoriesFromWorksheet(rows, categories);

        if (parsed.categories.length === 0) {
          showFeedback("업로드 가능한 데이터 행을 찾지 못했습니다.", "warning");
          return;
        }

        setCategories(parsed.categories);
        setImportSummary({ fileName: file.name, ...parsed.summary });
        setIsDirty(true);
        showFeedback(
          `${parsed.summary.categoryCount}개 카테고리와 ${parsed.summary.symbolCount}개 종목을 편집기에 불러왔습니다. 검토 후 저장해 주세요.`,
          "success",
        );
      } catch (error) {
        console.error("[StockCategoriesManagerPage] import failed:", error);
        showFeedback(
          getXlsxImportErrorMessage(error, "엑셀 파일을 읽지 못했습니다."),
          "error",
        );
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    reader.onerror = () => {
      showFeedback("엑셀 파일을 읽지 못했습니다.", "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    reader.readAsArrayBuffer(file);
  }, [categories, showFeedback]);

  const handleAppendImportExcel = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      validateXlsxImportFile(file);
    } catch (error) {
      showFeedback(getXlsxImportErrorMessage(error), "error");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const { rows } = parseFirstXlsxWorksheet(loadEvent.target?.result, {
          file,
        });
        const parsed = buildCategoriesFromWorksheet(rows, categories);

        if (parsed.categories.length === 0) {
          showFeedback("추가할 수 있는 엑셀 데이터를 찾지 못했습니다.", "warning");
          return;
        }

        const merged = mergeImportedCategories(categories, parsed.categories);
        setCategories(merged.categories);
        setImportSummary({
          fileName: file.name,
          rowCount: parsed.summary.rowCount,
          categoryCount: merged.categories.length,
          symbolCount: merged.categories.reduce(
            (count, category) =>
              count + category.symbols.filter((symbol) => normalizeTicker(symbol.ticker) || normalizeText(symbol.companyName)).length,
            0,
          ),
          mode: "append",
          ...merged.summary,
        });
        setIsDirty(true);
        showFeedback(
          `엑셀 내용을 기존 편집기에 추가했습니다. 새 카테고리 ${merged.summary.addedCategoryCount}개, 새 종목 ${merged.summary.addedSymbolCount}개를 확인해 주세요.`,
          "success",
        );
      } catch (error) {
        console.error("[StockCategoriesManagerPage] append import failed:", error);
        showFeedback(
          getXlsxImportErrorMessage(
            error,
            "엑셀 파일을 추가로 읽지 못했습니다.",
          ),
          "error",
        );
      } finally {
        if (appendFileInputRef.current) appendFileInputRef.current.value = "";
      }
    };

    reader.onerror = () => {
      showFeedback("엑셀 파일을 추가로 읽지 못했습니다.", "error");
      if (appendFileInputRef.current) appendFileInputRef.current.value = "";
    };

    reader.readAsArrayBuffer(file);
  }, [categories, showFeedback]);

  const getPreparedPayload = useCallback(() => {
    const usedDocumentIds = new Set();
    const validationErrors = [];

    const preparedCategories = sortCategories(categories).map((category, index) => {
      const name = normalizeText(category.name);
      const rawDocumentId = normalizeDocumentId(category.documentId);
      const order = parseOrder(category.order, index + 1) || index + 1;
      const fallbackId = slugifyCategoryName(name);
      let documentId = rawDocumentId || fallbackId || `category_${index + 1}`;

      if (!name) {
        validationErrors.push(`카테고리 ${index + 1}의 이름이 비어 있습니다.`);
      }

      const symbolPayload = [];
      const symbolSet = new Set();

      (category.symbols || []).forEach((symbol, symbolIndex) => {
        const ticker = normalizeTicker(symbol.ticker);
        const companyName = normalizeText(symbol.companyName);

        if (!ticker && !companyName) return;

        if (!ticker || !companyName) {
          validationErrors.push(`${name || documentId}: ${symbolIndex + 1}번째 행은 티커와 종목명을 모두 입력해야 합니다.`);
          return;
        }

        if (symbolSet.has(ticker)) {
          validationErrors.push(`${name || documentId}: ${ticker} 티커가 카테고리 안에 중복되어 있습니다.`);
          return;
        }

        symbolSet.add(ticker);
        symbolPayload.push({ ticker, companyName });
      });

      if (usedDocumentIds.has(documentId)) {
        let suffix = 2;
        const baseId = documentId;
        while (usedDocumentIds.has(`${baseId}_${suffix}`)) {
          suffix += 1;
        }
        documentId = `${baseId}_${suffix}`;
      }
      usedDocumentIds.add(documentId);

      return {
        documentId,
        payload: {
          name,
          order,
          symbols: symbolPayload,
        },
      };
    });

    return {
      validationErrors,
      preparedCategories,
      nextDocumentIds: new Set(preparedCategories.map((category) => category.documentId)),
    };
  }, [categories]);

  const handleSave = useCallback(async () => {
    const { preparedCategories, validationErrors, nextDocumentIds } = getPreparedPayload();

    if (validationErrors.length > 0) {
      showFeedback(validationErrors[0], "error");
      return;
    }

    const removedDocumentIds = Array.from(initialDocumentIdsRef.current).filter(
      (documentId) => !nextDocumentIds.has(documentId),
    );

    if (
      removedDocumentIds.length > 0 &&
      !(await appConfirm(`삭제된 카테고리 ${removedDocumentIds.length}개를 Firestore에서도 함께 삭제합니다. 계속할까요?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))
    ) {
      return;
    }

    setIsSaving(true);
    try {
      const batch = writeBatch(db);

      preparedCategories.forEach((category) => {
        const docRef = doc(db, COLLECTION_NAME, category.documentId);
        const isExisting = initialDocumentIdsRef.current.has(category.documentId);

        batch.set(
          docRef,
          {
            ...category.payload,
            updatedAt: serverTimestamp(),
            ...(isExisting ? {} : { createdAt: serverTimestamp() }),
          },
          { merge: true },
        );
      });

      removedDocumentIds.forEach((documentId) => {
        batch.delete(doc(db, COLLECTION_NAME, documentId));
      });

      await batch.commit();
      showFeedback("주식 카테고리를 저장했습니다.", "success");
      await loadCategories({ preserveCurrent: true });
    } catch (error) {
      console.error("[StockCategoriesManagerPage] save failed:", error);
      showFeedback("주식 카테고리를 저장하지 못했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  }, [getPreparedPayload, loadCategories, showFeedback]);

  const handleReload = useCallback(async () => {
    if (isDirty && !(await appConfirm("저장하지 않은 변경사항을 버리고 Firestore 데이터를 다시 불러올까요?"))) {
      return;
    }

    loadCategories({ preserveCurrent: true });
  }, [isDirty, loadCategories]);

  if (isInitialLoading) {
    return (
      <AppLayout title="주식 카테고리 관리">
        <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-8">
          <PageSkeleton summaryCards={3} showChart={false} showTable={false} />
          <div className="grid gap-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <CardSkeleton key={`stock-category-skeleton-${index}`} rows={6} showFooter={false} />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="주식 카테고리 관리">
      <div className="mx-auto max-w-7xl space-y-6 p-6 md:p-8">
        <Button tone="slate" kind="ghost" size="sm"
          type="button"
          onClick={() => navigate("/admin/master")}
          className="inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          마스터 허브
        </Button>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card tone="blue" variant="elevated">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="inline-flex w-fit items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-700">
                  <Database className="h-4 w-4" />
                  전역 주식 카테고리
                </div>
                <div>
                  <h1 className="tracking-tight text-slate-900 text-[28px] leading-9 font-extrabold sm:text-[32px] sm:leading-10">
                    주식 카테고리 마스터 데이터
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                    stockCategories 컬렉션을 직접 수정하고, 현재 데이터를 엑셀로 내보내거나 업로드로 일괄 반영할 수 있습니다.
                  </p>
                </div>
              </div>

              <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-auto lg:min-w-[320px]">
                <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white/70">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">카테고리 수</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">{categoryCount}</p>
                </div>
                <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white/70">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">종목 수</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">{symbolCount}</p>
                </div>
                <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-white/70">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">상태</p>
                  <p className="mt-2 text-base font-black text-slate-900">{isDirty ? "저장 안 됨" : "동기화됨"}</p>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <Card.Header align="between">
              <div>
                <Card.Title>엑셀 업로드 및 저장</Card.Title>
                <Card.Description>
                  전체 교체 업로드 또는 기존 편집기에 이어 붙이는 추가 업로드를 선택하고, 검토한 결과를 Firestore에 저장합니다.
                </Card.Description>
              </div>
            </Card.Header>
            <Card.Content noPadding className="gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Button tone="blue" kind="outline" icon={FileSpreadsheet} onClick={handleDownloadTemplate}>
                  양식 다운로드
                </Button>
                <Button tone="emerald" kind="outline" icon={Download} onClick={handleExportCurrentData} disabled={categoryCount === 0}>
                  현재 데이터 내보내기
                </Button>
                <input ref={fileInputRef} type="file" accept={XLSX_IMPORT_ACCEPT} className="hidden" onChange={handleImportExcel} />
                <Button tone="blue" kind="outline" icon={Upload} onClick={() => fileInputRef.current?.click()}>
                  교체 업로드
                </Button>
                <input ref={appendFileInputRef} type="file" accept={XLSX_IMPORT_ACCEPT} className="hidden" onChange={handleAppendImportExcel} />
                <Button tone="blue" kind="outline" icon={Plus} onClick={() => appendFileInputRef.current?.click()}>
                  추가 업로드
                </Button>
                <Button tone="slate" kind="outline" icon={RefreshCw} onClick={handleReload} isLoading={isRefreshing}>
                  Firestore 다시 불러오기
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button tone="blue" icon={Plus} onClick={handleAddCategory}>카테고리 추가</Button>
                <Button tone="blue" icon={Save} onClick={handleSave} disabled={isRefreshing || isSaving} isLoading={isSaving}>변경사항 저장</Button>
              </div>
            </Card.Content>
          </Card>
        </div>

        <Alert type="info" message="교체 업로드는 편집기 전체를 엑셀 내용으로 바꾸고, 추가 업로드는 기존 편집기 내용에 엑셀의 새 카테고리와 종목을 병합합니다. 저장 시 현재 편집기에 보이는 내용이 stockCategories에 저장됩니다." />

        {importSummary && (
          <Alert
            type="success"
            message={
              importSummary.mode === "append"
                ? `${importSummary.fileName}: 추가 업로드로 새 카테고리 ${importSummary.addedCategoryCount}개, 새 종목 ${importSummary.addedSymbolCount}개를 병합했습니다. 현재 편집기는 카테고리 ${importSummary.categoryCount}개, 종목 ${importSummary.symbolCount}개입니다.`
                : `${importSummary.fileName}: 카테고리 ${importSummary.categoryCount}개, 종목 ${importSummary.symbolCount}개, 행 ${importSummary.rowCount}개를 불러왔습니다. 내용을 확인한 뒤 저장해 주세요.`
            }
          />
        )}

        <SurfaceLoader
          loading={isRefreshing}
          variant="refreshing"
          message="주식 카테고리를 새로고침하는 중입니다..."
        >
          {categoryCount === 0 ? (
            <Card className="items-center justify-center py-16 text-center">
              <div className="mx-auto flex max-w-lg flex-col items-center gap-4">
                <div className="rounded-full bg-slate-100 p-4 text-slate-500">
                  <Database className="h-8 w-8" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">아직 카테고리가 없습니다</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    직접 첫 카테고리를 추가하거나, 엑셀 업로드 양식부터 시작할 수 있습니다.
                  </p>
                </div>
                <Button tone="blue" icon={Plus} onClick={handleAddCategory}>첫 카테고리 만들기</Button>
              </div>
            </Card>
          ) : (
            <div className="space-y-5">
              {sortCategories(categories).map((category, index) => (
                <Card key={category.localId} className="overflow-visible">
                  <div className="space-y-5">
                    <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">카테고리 {index + 1}</p>
                        <h2 className="mt-2 text-xl font-black text-slate-900">{normalizeText(category.name) || "이름 없는 카테고리"}</h2>
                        <p className="mt-1 text-sm text-slate-500">운영 중인 카테고리라면 기존 문서 ID를 유지하는 것이 안전합니다.</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button tone="blue" kind="outline" size="sm" icon={Plus} onClick={() => handleAddSymbol(category.localId)}>종목 추가</Button>
                        <Button tone="red" kind="outline" size="sm" icon={Trash2} onClick={() => handleRemoveCategory(category.localId)}>카테고리 삭제</Button>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="space-y-2 text-sm font-semibold text-slate-700">
                        <span>문서 ID</span>
                        <input
                          type="text"
                          value={category.documentId}
                          onChange={(event) => handleCategoryFieldChange(category.localId, "documentId", event.target.value)}
                          placeholder="ai_semiconductors"
                          className="w-full rounded-xl border border-blue-200 px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </label>

                      <label className="space-y-2 text-sm font-semibold text-slate-700">
                        <span>카테고리명</span>
                        <input
                          type="text"
                          value={category.name}
                          onChange={(event) => handleCategoryFieldChange(category.localId, "name", event.target.value)}
                          placeholder="AI & 반도체"
                          className="w-full rounded-xl border border-blue-200 px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </label>

                      <label className="space-y-2 text-sm font-semibold text-slate-700">
                        <span>정렬 순서</span>
                        <input
                          type="number"
                          min="0"
                          value={category.order}
                          onChange={(event) => handleCategoryFieldChange(category.localId, "order", event.target.value)}
                          className="w-full rounded-xl border border-blue-200 px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </label>
                    </div>

                    <div className="overflow-hidden rounded-3xl border border-slate-200">
                      <div className="grid grid-cols-[140px_minmax(220px,1fr)_80px] bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                        <span>티커</span>
                        <span>종목명</span>
                        <span className="text-right">삭제</span>
                      </div>

                      <div className="divide-y divide-slate-100 bg-white">
                        {category.symbols.map((symbol) => (
                          <div key={symbol.localId} className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[140px_minmax(220px,1fr)_80px] md:items-center">
                            <input
                              type="text"
                              value={symbol.ticker}
                              onChange={(event) => handleSymbolFieldChange(category.localId, symbol.localId, "ticker", event.target.value)}
                              placeholder="AAPL"
                              className="rounded-xl border border-blue-200 px-3 py-2.5 text-sm font-semibold uppercase text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                            />
                            <input
                              type="text"
                              value={symbol.companyName}
                              onChange={(event) => handleSymbolFieldChange(category.localId, symbol.localId, "companyName", event.target.value)}
                              placeholder="애플"
                              className="rounded-xl border border-blue-200 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                            />
                            <div className="flex justify-end">
                              <Button tone="red" kind="ghost" size="icon-sm" icon={Trash2} onClick={() => handleRemoveSymbol(category.localId, symbol.localId)} aria-label="종목 삭제" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </SurfaceLoader>
      </div>
    </AppLayout>
  );
};

export default StockCategoriesManagerPage;
