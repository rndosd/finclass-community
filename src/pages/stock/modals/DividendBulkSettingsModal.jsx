import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { CheckCircle, Download, RefreshCw, Save, SlidersHorizontal, Upload } from "lucide-react";
import * as XLSX from "xlsx";

import {
  Alert,
  Button,
  EmptyState,
  Modal,
  SurfaceLoader,
  TableSkeleton,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import {
  getXlsxImportErrorMessage,
  parseFirstXlsxWorksheet,
  validateXlsxImportFile,
  XLSX_IMPORT_ACCEPT,
} from "../../../utils/safeXlsxImport";
import {
  buildDividendPolicyDraft,
  buildDividendPolicyPayload,
  DIVIDEND_POLICY_FREQUENCY_OPTIONS,
  hasPositiveCustomDividendPayout,
  normalizeTicker,
  recalculateDividendPolicyRow,
} from "../utils/dividendPolicyUtils";

const BATCH_WRITE_LIMIT = 450;
const EXCEL_HEADERS = {
  symbol: "티커",
  companyName: "종목명",
  categoryName: "카테고리",
  referencePriceUSD: "기준가(USD)",
  referenceFrequencyLabel: "원본 배당 주기",
  referenceAmountUSDPerShare: "원본 주당배당금(USD)",
  referenceYieldPercent: "원본 배당수익률(%)",
  dividendEnabled: "배당 적용",
  useCustomPolicy: "학급 사용",
  classFrequencyLabel: "학급 주기",
  classYieldPercent: "목표 연수익률(%)",
  classFirstPayoutDateNY: "첫 지급일(NY)",
  classExDividendLeadTradingDays: "보유 기준(거래일 전)",
  classPayoutUSDPerShare: "회당 주당배당금(USD)",
  nextExDateNY: "다음 보유 기준일(NY)",
  nextPayoutDateNY: "다음 지급일(NY)",
};
const POLICY_VIEW_OPTIONS = [
  ["recommended", "배당 추천"],
  ["selected", "선택 종목"],
  ["custom", "학급 사용"],
  ["source", "실제 배당"],
  ["disabled", "미적용"],
  ["all", "전체"],
];
const TEMPLATE_OPTIONS = [
  ["beginner", "초급형", "배당이 잡힌 종목을 자동 선택해 실제 배당 일정 그대로 사용합니다."],
  ["intermediate", "중급형", "배당 추천 종목을 자동 선택해 학급 배당으로 월 1회, 목표 연수익률 6%를 채웁니다."],
];
const RECOMMENDED_PATTERNS = [
  /배당 ETF/i,
  /채권 ETF/i,
  /부동산 ETF/i,
  /유틸리티/i,
  /금융 서비스/i,
  /통신 서비스/i,
  /필수 및 방어 소비재/i,
  /헬스케어 기업/i,
  /부동산 및 인프라/i,
  /전력 인프라/i,
];
const roundNumber = (value, digits = 4) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const unit = 10 ** digits;
  return Math.round(num * unit) / unit;
};
const normalizeComparable = (row) => ({
  dividendEnabled: row?.dividendEnabled !== false,
  useCustomPolicy: Boolean(row?.useCustomPolicy),
  classFrequencyKey: String(row?.classFrequencyKey || "monthly"),
  classYieldPercent: roundNumber(row?.classYieldPercent, 2),
  classFirstPayoutDateNY: String(row?.classFirstPayoutDateNY || "").trim(),
  classExDividendLeadTradingDays: Math.max(1, Math.round(Number(row?.classExDividendLeadTradingDays) || 1)),
  scheduleActionType: String(row?.scheduleActionType || "").trim(),
  overrideNextPayoutDateNY: String(row?.scheduleActionType ? row?.overrideNextPayoutDateNY || "" : "").trim(),
});
const formatDisplayNumber = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "-";
  return num.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
};
const formatRowNamesForFeedback = (rows = [], limit = 5) => {
  const names = rows
    .map((row) => row.companyName || row.symbol)
    .filter(Boolean);
  const visibleNames = names.slice(0, limit).join(", ");
  return names.length > limit ? `${visibleNames} 외 ${names.length - limit}개` : visibleNames;
};
const formatDateLabel = (value) => String(value || "").trim() || "-";
const formatUsdAmount = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "-";
  return `${num.toFixed(4)} USD`;
};
const getCycleRuleText = (frequencyKey) => {
  const option = DIVIDEND_POLICY_FREQUENCY_OPTIONS.find((item) => item.key === frequencyKey) || DIVIDEND_POLICY_FREQUENCY_OPTIONS[2];
  return `${option.label}: 직전 지급일 기준 ${option.cycleDays}일 뒤`;
};
const getHoldingRuleText = (leadDays) => `지급일 기준 ${Math.max(1, Math.round(Number(leadDays) || 1))}거래일 전 보유 수량으로 계산`;
const isRecommendedRow = (row) => RECOMMENDED_PATTERNS.some((pattern) => pattern.test(String(row?.categoryName || "")));
const isTemplateTargetRow = (row) => isRecommendedRow(row) || Number(row?.referenceAmountUSDPerShare || 0) > 0 || Number(row?.referenceYieldPercent || 0) > 0;
const isInteractiveElement = (target) => target instanceof Element && Boolean(target.closest("input, select, button, a, label"));
const parseBooleanCell = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "y", "yes", "true", "사용", "적용", "on"].includes(normalized)) return true;
  if (["0", "n", "no", "false", "미사용", "미적용", "off"].includes(normalized)) return false;
  return fallback;
};
const parseNumberCell = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};
const resolveFrequencyKey = (value, fallback = "monthly") => {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  const matched = DIVIDEND_POLICY_FREQUENCY_OPTIONS.find((option) => option.key === normalized || option.label === normalized);
  return matched?.key || fallback;
};
const flattenStocksByCategory = (allStocksByCategory = {}) => Object.entries(allStocksByCategory).flatMap(([categoryName, stocks]) =>
  (Array.isArray(stocks) ? stocks : []).map((stock) => ({ ...stock, symbol: normalizeTicker(stock?.ticker || stock?.symbol), _categoryName: categoryName })).filter((stock) => stock.symbol),
).sort((a, b) => String(a._categoryName || "").localeCompare(String(b._categoryName || ""), "ko") || String(a.symbol || "").localeCompare(String(b.symbol || "")));

const DividendBulkSettingsModal = ({ isOpen, onClose, allStocksByCategory, pricesFlatMap, dividendSummaryBySymbol, ...modalProps }) => {
  const { classId, userData } = useUser();
  const { showFeedback } = useFeedback();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const originalRowsRef = useRef({});
  const originalFullRowsRef = useRef({});
  const dragSelectionRef = useRef({ active: false, mode: "select", visited: new Set() });
  const [rows, setRows] = useState([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [currentCategoryFilter, setCurrentCategoryFilter] = useState("");
  const [currentPolicyView, setCurrentPolicyView] = useState("recommended");
  const [selectedSymbols, setSelectedSymbols] = useState(() => new Set());
  const [bulkFirstPayoutDate, setBulkFirstPayoutDate] = useState("");
  const [bulkFrequencyKey, setBulkFrequencyKey] = useState("monthly");
  const [bulkYieldPercent, setBulkYieldPercent] = useState("6");
  const [bulkLeadTradingDays, setBulkLeadTradingDays] = useState("1");
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const allStocksFlat = useMemo(() => flattenStocksByCategory(allStocksByCategory), [allStocksByCategory]);
  const fetchDividendPolicies = useCallback(async () => {
    if (!classId) return;
    setIsLoadingData(true);
    try {
      const querySnapshot = await getDocs(collection(db, "classes", classId, "stockDividendPolicies"));
      const existingPolicies = {};
      querySnapshot.forEach((docSnap) => {
        existingPolicies[docSnap.id] = docSnap.data() || {};
      });
      const nextRows = allStocksFlat.map((stock) =>
        buildDividendPolicyDraft({
          stock,
          policy: existingPolicies[stock.symbol],
          dividendInfo: dividendSummaryBySymbol?.[stock.symbol] || null,
          currentPriceUSD: pricesFlatMap?.[stock.symbol] || 0,
        }),
      );
      originalRowsRef.current = Object.fromEntries(nextRows.map((row) => [row.symbol, normalizeComparable(row)]));
      originalFullRowsRef.current = Object.fromEntries(nextRows.map((row) => [row.symbol, row]));
      setRows(nextRows);
      setSelectedSymbols(new Set());
      setIsSaved(false);
      setBulkFirstPayoutDate("");
      setBulkFrequencyKey("monthly");
      setBulkYieldPercent("6");
      setBulkLeadTradingDays("1");
    } catch (error) {
      console.error("[DividendBulkSettingsModal] Failed to load dividend policies:", error);
      showFeedback("배당 설정을 불러오지 못했습니다.", "error");
    } finally {
      setIsLoadingData(false);
    }
  }, [allStocksFlat, classId, dividendSummaryBySymbol, pricesFlatMap, showFeedback]);

  useEffect(() => {
    if (!isOpen) return;
    fetchDividendPolicies();
  }, [fetchDividendPolicies, isOpen]);

  const categoryOptions = useMemo(() => Array.from(new Set(allStocksFlat.map((stock) => stock._categoryName).filter(Boolean))), [allStocksFlat]);
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (currentCategoryFilter && row.categoryName !== currentCategoryFilter) return false;
    switch (currentPolicyView) {
      case "recommended": return isTemplateTargetRow(row);
      case "selected": return selectedSymbols.has(row.symbol);
      case "custom": return row.dividendEnabled !== false && row.useCustomPolicy;
      case "source": return row.dividendEnabled !== false && !row.useCustomPolicy;
      case "disabled": return row.dividendEnabled === false;
      default: return true;
    }
  }), [currentCategoryFilter, currentPolicyView, rows, selectedSymbols]);
  const selectedRows = useMemo(() => rows.filter((row) => selectedSymbols.has(row.symbol)), [rows, selectedSymbols]);
  const dirtyCount = useMemo(() => rows.filter((row) => JSON.stringify(normalizeComparable(row)) !== JSON.stringify(originalRowsRef.current[row.symbol] || {})).length, [rows]);
  const selectedCount = selectedSymbols.size;
  const selectedStartedCustomRows = useMemo(() => selectedRows.filter((row) => row.dividendEnabled !== false && row.useCustomPolicy && Boolean(row.lastPaidDateNY)), [selectedRows]);
  const hasFilteredRows = filteredRows.length > 0;

  const applyRowUpdates = useCallback((symbols, updater) => {
    if (!symbols.length) return;
    const symbolSet = new Set(symbols);
    setRows((prevRows) => prevRows.map((row) => symbolSet.has(row.symbol) ? recalculateDividendPolicyRow({ ...row, ...(updater(row) || {}) }, {}) : row));
    setIsSaved(false);
  }, []);

  const toggleRowSelection = useCallback((symbol) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }, []);

  const applySelectionState = useCallback((symbols, shouldSelect) => {
    if (!symbols.length) return;
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      symbols.forEach((symbol) => {
        if (shouldSelect) next.add(symbol);
        else next.delete(symbol);
      });
      return next;
    });
  }, []);

  const resetDragSelection = useCallback(() => {
    dragSelectionRef.current = { active: false, mode: "select", visited: new Set() };
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", resetDragSelection);
    return () => window.removeEventListener("mouseup", resetDragSelection);
  }, [resetDragSelection]);

  const handleRowMouseDown = useCallback((event, row) => {
    if (event.button !== 0 || isInteractiveElement(event.target)) return;
    event.preventDefault();
    const shouldSelect = !selectedSymbols.has(row.symbol);
    dragSelectionRef.current = {
      active: true,
      mode: shouldSelect ? "select" : "deselect",
      visited: new Set([row.symbol]),
    };
    applySelectionState([row.symbol], shouldSelect);
  }, [applySelectionState, selectedSymbols]);

  const handleRowMouseEnter = useCallback((event, row) => {
    if (isInteractiveElement(event.target)) return;
    const dragState = dragSelectionRef.current;
    if (!dragState.active || dragState.visited.has(row.symbol)) return;
    dragState.visited.add(row.symbol);
    applySelectionState([row.symbol], dragState.mode === "select");
  }, [applySelectionState]);

  const handleSelectVisibleRows = useCallback(() => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      filteredRows.forEach((row) => next.add(row.symbol));
      return next;
    });
  }, [filteredRows]);

  const handleClearSelection = useCallback(() => setSelectedSymbols(new Set()), []);

  const handleApplySelectionMode = useCallback((mode) => {
    const targetSymbols = selectedRows.map((row) => row.symbol);
    if (!targetSymbols.length) {
      showFeedback("먼저 적용할 종목을 선택해 주세요.", "warning");
      return;
    }
    applyRowUpdates(targetSymbols, (row) => {
      if (mode === "disabled") return { dividendEnabled: false, useCustomPolicy: false, scheduleActionType: null, overrideNextPayoutDateNY: null };
      if (mode === "source") return { dividendEnabled: true, useCustomPolicy: false, scheduleActionType: null, overrideNextPayoutDateNY: null };
      return {
        dividendEnabled: true,
        useCustomPolicy: true,
      };
    });
    if (mode === "source") {
      showFeedback("선택한 종목에 실제 배당을 적용했습니다.", "success");
    } else if (mode === "disabled") {
      showFeedback("선택한 종목을 미적용으로 바꿨습니다.", "success");
    } else {
      showFeedback("선택한 종목에 학급 설정을 적용했습니다.", "success");
    }
  }, [applyRowUpdates, selectedRows, showFeedback]);

  const handleApplyBulkSetting = useCallback((settingKey) => {
    const targetSymbols = selectedRows.map((row) => row.symbol);
    if (!targetSymbols.length) {
      showFeedback("먼저 적용할 종목을 선택해 주세요.", "warning");
      return;
    }

    const parsedBulkYield = Number(bulkYieldPercent);
    const parsedLeadDays = Math.max(1, Math.round(Number(bulkLeadTradingDays) || 1));
    const nextYieldPercent =
      Number.isFinite(parsedBulkYield) && parsedBulkYield >= 0 ? parsedBulkYield : 6;

    if ((settingKey === "firstPayoutDate" || settingKey === "all") && !bulkFirstPayoutDate) {
      showFeedback("적용할 첫 지급일을 입력해 주세요.", "warning");
      return;
    }

    applyRowUpdates(targetSymbols, (row) => {
      const patch = {
        dividendEnabled: true,
        useCustomPolicy: true,
      };

      if (settingKey === "frequency" || settingKey === "all") {
        patch.classFrequencyKey = bulkFrequencyKey;
      }
      if (settingKey === "yield" || settingKey === "all") {
        patch.classYieldPercent = nextYieldPercent;
      }
      if (settingKey === "firstPayoutDate" || settingKey === "all") {
        patch.classFirstPayoutDateNY = bulkFirstPayoutDate;
        patch.scheduleActionType = row.lastPaidDateNY ? "restart" : null;
        patch.overrideNextPayoutDateNY = row.lastPaidDateNY ? bulkFirstPayoutDate : null;
      }
      if (settingKey === "leadDays" || settingKey === "all") {
        patch.classExDividendLeadTradingDays = parsedLeadDays;
      }

      return patch;
    });

    const labels = {
      frequency: "주기",
      yield: "연수익률",
      firstPayoutDate: "첫 지급일",
      leadDays: "보유 기준",
      all: "일괄 설정",
    };
    showFeedback(`선택한 종목에 ${labels[settingKey]}을 적용했습니다.`, "success");
  }, [
    applyRowUpdates,
    bulkFirstPayoutDate,
    bulkFrequencyKey,
    bulkLeadTradingDays,
    bulkYieldPercent,
    selectedRows,
    showFeedback,
  ]);

  const handleApplyTemplate = useCallback((templateKey) => {
    const targetRows = rows.filter(isTemplateTargetRow);
    const targetSymbols = targetRows.map((row) => row.symbol);
    if (!targetSymbols.length) {
      showFeedback("자동으로 추천 배당 종목을 찾지 못했습니다.", "warning");
      return;
    }
    setSelectedSymbols(new Set(targetSymbols));
    setCurrentPolicyView("selected");
    if (templateKey === "beginner") {
      applyRowUpdates(targetSymbols, () => ({ dividendEnabled: true, useCustomPolicy: false, scheduleActionType: null, overrideNextPayoutDateNY: null }));
      showFeedback("초급형 템플릿을 적용했습니다.", "success");
      return;
    }
    applyRowUpdates(targetSymbols, (row) => ({
      dividendEnabled: true,
      useCustomPolicy: true,
      classFrequencyKey: "monthly",
      classYieldPercent: Number(row.classYieldPercent || 0) > 0 ? row.classYieldPercent : 6,
      classExDividendLeadTradingDays: Number(row.classExDividendLeadTradingDays || 0) > 0 ? row.classExDividendLeadTradingDays : 1,
      classFirstPayoutDateNY: row.lastPaidDateNY || row.classFirstPayoutDateNY ? row.classFirstPayoutDateNY : bulkFirstPayoutDate || row.classFirstPayoutDateNY || "",
    }));
    showFeedback("중급형 템플릿을 적용했습니다. 필요하면 지급일만 한 번 정해 주세요.", "success");
  }, [applyRowUpdates, bulkFirstPayoutDate, rows, showFeedback]);
  const handleClearSelectedScheduleAction = useCallback(() => {
    const targetSymbols = selectedRows.map((row) => row.symbol);
    if (!targetSymbols.length) {
      showFeedback("먼저 종목을 선택해 주세요.", "warning");
      return;
    }
    applyRowUpdates(targetSymbols, (row) => {
      const originalRow = originalFullRowsRef.current[row.symbol];
      if (!originalRow) return { scheduleActionType: null, overrideNextPayoutDateNY: null };
      return {
        classFirstPayoutDateNY: originalRow.classFirstPayoutDateNY,
        scheduleActionType: null,
        overrideNextPayoutDateNY: originalRow.overrideNextPayoutDateNY,
      };
    });
    showFeedback("선택 종목의 지급일 변경 예약을 해제했습니다.", "success");
  }, [applyRowUpdates, selectedRows, showFeedback]);

  const handleOpenImport = useCallback(() => fileInputRef.current?.click(), []);

  const handleExportExcel = useCallback(() => {
    if (!selectedRows.length) {
      showFeedback("엑셀로 내보낼 종목을 먼저 선택해 주세요.", "warning");
      return;
    }
    try {
      const excelData = selectedRows.map((row) => ({
        [EXCEL_HEADERS.symbol]: row.symbol,
        [EXCEL_HEADERS.companyName]: row.companyName,
        [EXCEL_HEADERS.categoryName]: row.categoryName,
        [EXCEL_HEADERS.referencePriceUSD]: row.referencePriceUSD,
        [EXCEL_HEADERS.referenceFrequencyLabel]: row.referenceFrequencyLabel || "",
        [EXCEL_HEADERS.referenceAmountUSDPerShare]: row.referenceAmountUSDPerShare,
        [EXCEL_HEADERS.referenceYieldPercent]: row.referenceYieldPercent,
        [EXCEL_HEADERS.dividendEnabled]: row.dividendEnabled !== false ? "적용" : "미적용",
        [EXCEL_HEADERS.useCustomPolicy]: row.useCustomPolicy ? "사용" : "미사용",
        [EXCEL_HEADERS.classFrequencyLabel]: row.classFrequencyLabel || "",
        [EXCEL_HEADERS.classYieldPercent]: row.classYieldPercent,
        [EXCEL_HEADERS.classFirstPayoutDateNY]: row.classFirstPayoutDateNY || "",
        [EXCEL_HEADERS.classExDividendLeadTradingDays]: row.classExDividendLeadTradingDays,
        [EXCEL_HEADERS.classPayoutUSDPerShare]: row.classPayoutUSDPerShare,
        [EXCEL_HEADERS.nextExDateNY]: row.pendingEntitlementDateNY || row.nextExDateNY || "",
        [EXCEL_HEADERS.nextPayoutDateNY]: row.pendingPayoutDateNY || row.overrideNextPayoutDateNY || row.nextPayoutDateNY || "",
      }));
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      worksheet["!cols"] = [{ wch: 10 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "배당설정");
      XLSX.writeFile(workbook, `배당설정_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showFeedback("선택 종목 엑셀을 내려받았습니다.", "success");
    } catch (error) {
      console.error("[DividendBulkSettingsModal] Failed to export excel:", error);
      showFeedback("엑셀 내보내기에 실패했습니다.", "error");
    }
  }, [selectedRows, showFeedback]);

  const handleImportExcel = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      validateXlsxImportFile(file);
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        try {
          const { rows: excelRows } = parseFirstXlsxWorksheet(
            loadEvent.target?.result,
            { file, sheetToJsonOptions: {} },
          );
          let importCount = 0;
          setRows((prevRows) => {
            const rowMap = new Map(prevRows.map((row) => [row.symbol, row]));
            const nextRows = prevRows.map((row) => row);
            excelRows.forEach((excelRow) => {
              const symbol = normalizeTicker(excelRow[EXCEL_HEADERS.symbol]);
              if (!symbol || !rowMap.has(symbol)) return;
              const currentRow = rowMap.get(symbol);
              const useCustomPolicy = parseBooleanCell(excelRow[EXCEL_HEADERS.useCustomPolicy], currentRow.useCustomPolicy);
              const nextFirstPayoutDate = currentRow.lastPaidDateNY ? currentRow.classFirstPayoutDateNY : String(excelRow[EXCEL_HEADERS.classFirstPayoutDateNY] || "").trim() || currentRow.classFirstPayoutDateNY;
              const nextRow = recalculateDividendPolicyRow({
                ...currentRow,
                dividendEnabled: parseBooleanCell(excelRow[EXCEL_HEADERS.dividendEnabled], currentRow.dividendEnabled !== false),
                useCustomPolicy,
                classFrequencyKey: resolveFrequencyKey(excelRow[EXCEL_HEADERS.classFrequencyLabel], currentRow.classFrequencyKey),
                classYieldPercent: parseNumberCell(excelRow[EXCEL_HEADERS.classYieldPercent], currentRow.classYieldPercent),
                classFirstPayoutDateNY: nextFirstPayoutDate,
                classExDividendLeadTradingDays: Math.max(1, Math.round(parseNumberCell(excelRow[EXCEL_HEADERS.classExDividendLeadTradingDays], currentRow.classExDividendLeadTradingDays))),
                scheduleActionType: null,
                overrideNextPayoutDateNY: currentRow.overrideNextPayoutDateNY || null,
              }, {});
              const rowIndex = nextRows.findIndex((item) => item.symbol === symbol);
              if (rowIndex >= 0) {
                nextRows[rowIndex] = nextRow;
                importCount += 1;
              }
            });
            return nextRows;
          });
          setIsSaved(false);
          showFeedback(`${importCount}개 종목의 배당 설정을 불러왔습니다. 저장을 눌러 반영해 주세요.`, "success");
        } catch (innerError) {
          console.error("[DividendBulkSettingsModal] Failed to parse excel:", innerError);
          showFeedback(getXlsxImportErrorMessage(innerError), "error");
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error("[DividendBulkSettingsModal] Failed to import excel:", error);
      showFeedback(
        getXlsxImportErrorMessage(error, "엑셀 가져오기에 실패했습니다."),
        "error",
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [showFeedback]);
  const handleSaveAll = useCallback(async () => {
    if (!classId || !userData?.uid) {
      showFeedback("학급 정보가 없어 배당 설정을 저장할 수 없습니다.", "error");
      return;
    }
    const changedRows = rows.filter((row) => JSON.stringify(normalizeComparable(row)) !== JSON.stringify(originalRowsRef.current[row.symbol] || {}));
    if (!changedRows.length) {
      showFeedback("변경한 배당 설정이 없습니다.", "info");
      return;
    }
    const invalidCustomRows = changedRows.filter((row) => row.dividendEnabled !== false && row.useCustomPolicy && !row.lastPaidDateNY && !String(row.classFirstPayoutDateNY || "").trim());
    if (invalidCustomRows.length > 0) {
      showFeedback(`첫 지급일이 없는 종목: ${formatRowNamesForFeedback(invalidCustomRows)}`, "warning");
      return;
    }
    const invalidCustomPayoutRows = changedRows.filter((row) => row.dividendEnabled !== false && row.useCustomPolicy && !hasPositiveCustomDividendPayout(row));
    if (invalidCustomPayoutRows.length > 0) {
      showFeedback(`회당 주당배당금이 0인 종목: ${formatRowNamesForFeedback(invalidCustomPayoutRows)}`, "warning");
      return;
    }
    const invalidRestartRows = changedRows.filter((row) => row.scheduleActionType === "restart" && !String(row.overrideNextPayoutDateNY || "").trim());
    if (invalidRestartRows.length > 0) {
      showFeedback(`재시작 지급일이 없는 종목: ${formatRowNamesForFeedback(invalidRestartRows)}`, "warning");
      return;
    }
    try {
      setIsSaving(true);
      const updatedBy = userData.uid;
      const updatedByName = userData.displayName || userData.email || "Unknown";
      for (let index = 0; index < changedRows.length; index += BATCH_WRITE_LIMIT) {
        const batch = writeBatch(db);
        const chunk = changedRows.slice(index, index + BATCH_WRITE_LIMIT);
        chunk.forEach((row) => {
          const payload = buildDividendPolicyPayload({ row, updatedBy, updatedByName });
          batch.set(doc(db, "classes", classId, "stockDividendPolicies", row.symbol), payload, { merge: true });
        });
        await batch.commit();
      }
      await queryClient.invalidateQueries({ queryKey: ["stock", "dividend-policies", classId] });
      await fetchDividendPolicies();
      setIsSaved(true);
      showFeedback(`배당 설정 ${changedRows.length}건을 저장했습니다.`, "success");
    } catch (error) {
      console.error("[DividendBulkSettingsModal] Failed to save dividend policies:", error);
      showFeedback("배당 설정 저장에 실패했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  }, [classId, fetchDividendPolicies, queryClient, rows, showFeedback, userData]);

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="배당 일괄 설정" size="full" {...modalProps}>
      <div className="space-y-5 pb-2">
        <div className="grid gap-3 lg:grid-cols-2">
          {TEMPLATE_OPTIONS.map(([key, title, description]) => (
            <Button key={key} kind="outline" tone="slate" rounded="2xl" onClick={() => handleApplyTemplate(key)} className="block h-full p-5 text-left">
              <div className="text-lg font-semibold text-slate-900">{title}</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
            </Button>
          ))}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">선택 {selectedCount}개 · 변경 {dirtyCount}개</div>
              <p className="mt-1 text-xs text-slate-500">학급 배당은 첫 지급일을 시작점으로 잡고, 지급일을 다시 적용하면 해당 종목 일정은 새 날짜 기준으로 재시작됩니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" kind="outline" tone="slate" icon={RefreshCw} onClick={fetchDividendPolicies}>새로고침</Button>
              <Button size="sm" kind="outline" tone="slate" icon={Download} onClick={handleExportExcel}>선택 엑셀</Button>
              <Button size="sm" kind="outline" tone="slate" icon={Upload} onClick={handleOpenImport}>엑셀 업로드</Button>
              <Button size="sm" tone={isSaved ? "emerald" : "indigo"} icon={isSaved ? CheckCircle : Save} isLoading={isSaving} disabled={isSaving || dirtyCount === 0} onClick={handleSaveAll}>저장</Button>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept={XLSX_IMPORT_ACCEPT} className="hidden" onChange={handleImportExcel} />
        </div>

        <div className="flex flex-wrap gap-2">
          {POLICY_VIEW_OPTIONS.map(([key, label]) => {
            const isActive = currentPolicyView === key;
            return <Button key={key} size="sm" tone="slate" kind={isActive ? "solid" : "soft"} rounded="full" onClick={() => setCurrentPolicyView(key)}>{label}</Button>;
          })}
        </div>

        <div className="sticky top-0 z-30 space-y-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-semibold text-slate-700" htmlFor="dividend-category-filter">카테고리</label>
              <select id="dividend-category-filter" value={currentCategoryFilter} onChange={(event) => setCurrentCategoryFilter(event.target.value)} className="min-w-[220px] rounded-xl border border-blue-200 px-4 py-2 text-sm text-slate-700">
                <option value="">전체 카테고리 ({rows.length})</option>
                {categoryOptions.map((categoryName) => <option key={categoryName} value={categoryName}>{categoryName}</option>)}
              </select>
              <Button size="sm" kind="outline" tone="slate" onClick={handleSelectVisibleRows}>현재 보기 선택</Button>
              <Button size="sm" kind="ghost" tone="slate" onClick={handleClearSelection}>선택 해제</Button>
            </div>
            <p className="text-xs text-slate-500">현재 보기 {filteredRows.length}개 · 선택 {selectedCount}개 · 이미 시작된 학급 배당 {selectedStartedCustomRows.length}개</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            <Button size="sm" kind="outline" tone="slate" onClick={() => handleApplySelectionMode("source")}>실제 배당 사용</Button>
            <Button size="sm" kind="outline" tone="blue" onClick={() => handleApplySelectionMode("custom")}>학급 배당 사용</Button>
            <Button size="sm" kind="outline" tone="red" onClick={() => handleApplySelectionMode("disabled")}>배당 미적용</Button>
            <Button size="sm" kind={isBulkEditOpen ? "solid" : "outline"} tone="slate" icon={SlidersHorizontal} onClick={() => setIsBulkEditOpen((prev) => !prev)}>일괄 수정</Button>
            <Button size="sm" kind="ghost" tone="slate" onClick={handleClearSelectedScheduleAction}>지급일 변경 해제</Button>
          </div>

          {isBulkEditOpen ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <label className="block text-xs font-semibold text-slate-500" htmlFor="bulk-frequency">주기</label>
                  <select
                    id="bulk-frequency"
                    value={bulkFrequencyKey}
                    onChange={(event) => setBulkFrequencyKey(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-700"
                  >
                    {DIVIDEND_POLICY_FREQUENCY_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" kind="outline" tone="slate" className="mt-3 w-full" onClick={() => handleApplyBulkSetting("frequency")}>주기만 적용</Button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <label className="block text-xs font-semibold text-slate-500" htmlFor="bulk-yield">연수익률</label>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                    <input
                      id="bulk-yield"
                      type="number"
                      min="0"
                      step="0.1"
                      value={bulkYieldPercent}
                      onChange={(event) => setBulkYieldPercent(event.target.value)}
                      className="w-full bg-transparent text-sm text-slate-700 outline-none"
                    />
                    <span className="text-xs font-medium text-slate-400">%</span>
                  </div>
                  <Button size="sm" kind="outline" tone="slate" className="mt-3 w-full" onClick={() => handleApplyBulkSetting("yield")}>수익률만 적용</Button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <label className="block text-xs font-semibold text-slate-500" htmlFor="bulk-first-payout">첫 지급일</label>
                  <input
                    id="bulk-first-payout"
                    type="date"
                    value={bulkFirstPayoutDate}
                    onChange={(event) => setBulkFirstPayoutDate(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-700"
                  />
                  <Button size="sm" kind="outline" tone="slate" className="mt-3 w-full" onClick={() => handleApplyBulkSetting("firstPayoutDate")}>첫 지급일만 적용</Button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <label className="block text-xs font-semibold text-slate-500" htmlFor="bulk-lead-days">보유 기준</label>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                    <input
                      id="bulk-lead-days"
                      type="number"
                      min="1"
                      step="1"
                      value={bulkLeadTradingDays}
                      onChange={(event) => setBulkLeadTradingDays(event.target.value)}
                      className="w-full bg-transparent text-sm text-slate-700 outline-none"
                    />
                    <span className="text-xs font-medium text-slate-400 whitespace-nowrap">거래일 전</span>
                  </div>
                  <Button size="sm" kind="outline" tone="slate" className="mt-3 w-full" onClick={() => handleApplyBulkSetting("leadDays")}>보유 기준만 적용</Button>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" tone="blue" onClick={() => handleApplyBulkSetting("all")}>네 항목 모두 적용</Button>
              </div>
            </div>
          ) : null}
        </div>

        <Alert type="info" message="모드 변경과 세부 일괄 수정이 분리되었습니다. 날짜만 바꿀 때는 일괄 수정에서 첫 지급일만 적용하면 됩니다." />
        <SurfaceLoader
          loading={isLoadingData}
          variant={hasFilteredRows ? "refreshing" : "surface-loading"}
          preserveContent={hasFilteredRows}
          skeleton={
            <TableSkeleton
              bare
              columns={9}
              rows={6}
              className="h-full min-h-full"
            />
          }
          minHeightClassName="min-h-[360px]"
        >
          <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
            <table className="min-w-[1260px] w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="w-16 px-4 py-3 text-center font-semibold">선택</th>
                  <th className="w-40 px-4 py-3 text-left font-semibold">종목</th>
                  <th className="min-w-[340px] px-4 py-3 text-left font-semibold">참고 정보</th>
                  <th className="w-28 px-4 py-3 text-center font-semibold whitespace-nowrap">실제 배당</th>
                  <th className="w-28 px-4 py-3 text-center font-semibold whitespace-nowrap">학급 사용</th>
                  <th className="w-40 px-4 py-3 text-left font-semibold whitespace-nowrap">학급 주기</th>
                  <th className="w-36 px-4 py-3 text-left font-semibold whitespace-nowrap">목표 연수익률</th>
                  <th className="w-40 px-4 py-3 text-left font-semibold whitespace-nowrap">첫 지급일</th>
                  <th className="w-36 px-4 py-3 text-left font-semibold whitespace-nowrap">보유 기준</th>
                </tr>
              </thead>
              <tbody>
                {!hasFilteredRows ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-10">
                      <EmptyState
                        icon={SlidersHorizontal}
                        title="현재 조건에 맞는 종목이 없습니다"
                        description="보기 필터나 선택 조건을 변경해 다시 확인해 보세요."
                      />
                    </td>
                  </tr>
                ) : filteredRows.map((row) => {
                const isSelected = selectedSymbols.has(row.symbol);
                const isStartedSchedule = Boolean(row.lastPaidDateNY);
                const isActualMode = row.dividendEnabled !== false && !row.useCustomPolicy;
                const isCustomMode = row.dividendEnabled !== false && row.useCustomPolicy;
                const scheduledPayDate = row.pendingPayoutDateNY || row.overrideNextPayoutDateNY || row.nextPayoutDateNY || row.classFirstPayoutDateNY || "";
                const scheduledExDate = row.pendingEntitlementDateNY || row.pendingExDateNY || row.overrideNextExDateNY || row.nextExDateNY || "";
                const scheduleActionLabel = row.scheduleActionType === "restart" ? `재시작 예정: ${formatDateLabel(row.overrideNextPayoutDateNY)}` : "";
                return (
                  <tr
                    key={row.symbol}
                    onMouseDown={(event) => handleRowMouseDown(event, row)}
                    onMouseEnter={(event) => handleRowMouseEnter(event, row)}
                    className={`cursor-pointer select-none border-t border-slate-100 transition ${isSelected ? "bg-indigo-50/70" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-4 py-4 align-top text-center"><input type="checkbox" checked={isSelected} onChange={() => toggleRowSelection(row.symbol)} className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" aria-label={`${row.symbol} 선택`} /></td>
                    <td className="px-4 py-4 align-top"><div className="font-semibold text-slate-900">{row.symbol}</div><div className="mt-1 text-sm text-slate-600">{row.companyName || "-"}</div></td>
                    <td className="px-4 py-4 align-top"><div className="space-y-2 text-xs leading-5 text-slate-600"><div>카테고리: {row.categoryName || "-"}</div><div>원본 주당배당금: {formatUsdAmount(row.referenceAmountUSDPerShare)}</div><div>원본 주기: {row.referenceFrequencyLabel || "-"}</div><div>원본 수익률: {formatDisplayNumber(row.referenceYieldPercent)}%</div>{scheduledPayDate ? <div>다음 일정: {formatDateLabel(scheduledPayDate)}</div> : null}{scheduledExDate ? <div>보유 기준일: {formatDateLabel(scheduledExDate)}</div> : null}{isStartedSchedule ? <div>최근 지급일: {formatDateLabel(row.lastPaidDateNY)}</div> : null}{row.pendingPayoutDateNY ? <div className="font-medium text-amber-600">재시작 대기 중</div> : null}{scheduleActionLabel ? <div className="font-medium text-indigo-600">{scheduleActionLabel}</div> : null}</div></td>
                    <td className="px-4 py-4 align-top text-center"><input type="checkbox" checked={isActualMode} onChange={() => applyRowUpdates([row.symbol], () => ({ dividendEnabled: !isActualMode, useCustomPolicy: false, scheduleActionType: null, overrideNextPayoutDateNY: null }))} className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" aria-label={`${row.symbol} 실제 배당`} /></td>
                    <td className="px-4 py-4 align-top text-center"><input type="checkbox" checked={isCustomMode} onChange={() => applyRowUpdates([row.symbol], () => ({ dividendEnabled: !isCustomMode, useCustomPolicy: !isCustomMode }))} className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" aria-label={`${row.symbol} 학급 사용`} /></td>
                    <td className="px-4 py-4 align-top"><select value={row.classFrequencyKey} onChange={(event) => applyRowUpdates([row.symbol], () => ({ classFrequencyKey: event.target.value }))} className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-700" disabled={!isCustomMode}>{DIVIDEND_POLICY_FREQUENCY_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><p className="mt-2 text-[11px] leading-5 text-slate-400">{getCycleRuleText(row.classFrequencyKey)}</p></td>
                    <td className="px-4 py-4 align-top"><div className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2"><input type="number" min="0" step="0.1" value={row.classYieldPercent ?? ""} onChange={(event) => applyRowUpdates([row.symbol], () => ({ classYieldPercent: event.target.value }))} className="w-full bg-transparent text-sm text-slate-700 outline-none" disabled={!isCustomMode} /><span className="text-sm font-semibold text-slate-400">%</span></div><p className="mt-2 text-[11px] leading-5 text-slate-400">회당 주당배당금: {formatUsdAmount(row.classPayoutUSDPerShare)}</p></td>
                    <td className="px-4 py-4 align-top">{isStartedSchedule ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500"><div className="font-semibold text-slate-700">첫 지급일 고정</div><div>{formatDateLabel(row.classFirstPayoutDateNY)}</div><div className="mt-1">지급일을 다시 적용하면 새 날짜 기준으로 재시작됩니다.</div></div> : <input type="date" value={row.classFirstPayoutDateNY || ""} onChange={(event) => applyRowUpdates([row.symbol], () => ({ classFirstPayoutDateNY: event.target.value }))} className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm text-slate-700" disabled={!isCustomMode} />}</td>
                    <td className="px-4 py-4 align-top"><div className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2"><input type="number" min="1" step="1" value={row.classExDividendLeadTradingDays ?? 1} onChange={(event) => applyRowUpdates([row.symbol], () => ({ classExDividendLeadTradingDays: Math.max(1, Number(event.target.value || 1)) }))} className="w-full bg-transparent text-sm text-slate-700 outline-none" disabled={!isCustomMode} /><span className="text-sm font-semibold text-slate-400 whitespace-nowrap">거래일 전</span></div><p className="mt-2 text-[11px] leading-5 text-slate-400">{getHoldingRuleText(row.classExDividendLeadTradingDays)}</p></td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
        </SurfaceLoader>
      </div>
    </Modal>
  );
};

export default DividendBulkSettingsModal;
