import { appAlert } from "./appDialogs";
import * as XLSX from "xlsx";
import dayjs from "dayjs";

import {
  ACTIVITY_CATEGORY_OPTIONS,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_EXPORT_COLUMNS,
  ASSET_EXPORT_COLUMNS,
  CREDIT_RECORD_TYPE_OPTIONS,
  CREDIT_SOURCE_LABELS,
  CREDIT_HISTORY_COLUMNS,
  CREDIT_LOG_COLUMNS,
} from "../constants/financeExportConfig";
import { getAmountInClass } from "./activityUtils";

const INVALID_SHEET_NAME_PATTERN = /[:\\/?*[\]]/g;
const MAX_SHEET_NAME_LENGTH = 31;
const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*]/g;
const SHEET_LAYOUT_LABELS = Object.freeze({
  singleSheet: "전체 1시트",
  multipleSheetsPerStudent: "학생별 시트",
  both: "전체 시트와 학생별 시트",
});

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value) => {
  const date = toDateValue(value);
  return date ? dayjs(date).format("YYYY-MM-DD HH:mm:ss") : "";
};

const sanitizeSheetName = (value) => {
  const base = String(value || "Sheet")
    .replace(INVALID_SHEET_NAME_PATTERN, "")
    .trim();

  return (base || "Sheet").slice(0, MAX_SHEET_NAME_LENGTH);
};

const createUniqueSheetName = (usedNames, name) => {
  const base = sanitizeSheetName(name);
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }

  let index = 2;
  while (index < 1000) {
    const suffix = `_${index}`;
    const nextName = `${base.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!usedNames.has(nextName)) {
      usedNames.add(nextName);
      return nextName;
    }
    index += 1;
  }

  const fallback = `${base.slice(0, MAX_SHEET_NAME_LENGTH - 4)}_etc`;
  usedNames.add(fallback);
  return fallback;
};

const getColumnWidths = (rows) => {
  const widths = [];

  rows.forEach((row) => {
    row.forEach((cell, index) => {
      const cellLength = String(cell ?? "").length;
      widths[index] = Math.min(
        40,
        Math.max(widths[index] ?? 10, cellLength + 2),
      );
    });
  });

  return widths.map((width) => ({ wch: width }));
};

const addAoaSheet = (
  workbook,
  usedNames,
  sheetName,
  rows,
  { autoFilter = true } = {},
) => {
  const safeRows = Array.isArray(rows) && rows.length > 0 ? rows : [["데이터 없음"]];
  const worksheet = XLSX.utils.aoa_to_sheet(safeRows);
  worksheet["!cols"] = getColumnWidths(safeRows);

  if (
    autoFilter &&
    safeRows.length > 1 &&
    Array.isArray(safeRows[0]) &&
    safeRows[0].length > 1
  ) {
    const lastColumnIndex = safeRows[0].length - 1;
    worksheet["!autofilter"] = {
      ref: `A1:${XLSX.utils.encode_cell({ r: 0, c: lastColumnIndex })}`,
    };
  }

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    createUniqueSheetName(usedNames, sheetName),
  );
};

const buildTableRows = (columns, records) => {
  const headers = columns.map((column) => column.label);
  const rows = records.map((record) =>
    columns.map((column) => record[column.key] ?? ""),
  );
  return [headers, ...rows];
};

const resolveSheetLayout = (sheetLayout) => {
  if (sheetLayout === "multipleSheetsPerStudent") {
    return { includeCombined: false, includePerStudent: true };
  }

  if (sheetLayout === "both") {
    return { includeCombined: true, includePerStudent: true };
  }

  return { includeCombined: true, includePerStudent: false };
};

const sanitizeFileNamePart = (value) =>
  String(value || "")
    .replace(INVALID_FILE_NAME_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

const getPeriodLabel = ({ startDate, endDate, isSnapshot = false } = {}) => {
  if (isSnapshot) return "내보내기 시점 기준";
  if (startDate && endDate) return `${startDate} ~ ${endDate} (양 끝 날짜 포함)`;
  if (startDate) return `${startDate} 이후`;
  if (endDate) return `${endDate} 이전`;
  return "전체 기간";
};

const getPeriodFileNamePart = ({ startDate, endDate, isSnapshot = false } = {}) => {
  if (isSnapshot) return "현재";
  if (startDate && endDate) {
    return `${String(startDate).replace(/-/g, "")}-${String(endDate).replace(/-/g, "")}`;
  }
  if (startDate) return `${String(startDate).replace(/-/g, "")}-이후`;
  if (endDate) return `${String(endDate).replace(/-/g, "")}-이전`;
  return "전체기간";
};

const addExportInfoSheet = (
  workbook,
  usedNames,
  {
    dataType,
    className,
    studentCount,
    recordCounts = [],
    startDate,
    endDate,
    isSnapshot = false,
    sheetLayout,
    currencyUnit,
    includedFields = [],
    filters = [],
  },
) => {
  const rows = [
    ["핀클래스 내보내기 정보", ""],
    ["자료 종류", dataType],
    ["생성 일시", dayjs().format("YYYY-MM-DD HH:mm:ss")],
    ["학급", className || ""],
    ["대상 학생 수", Number(studentCount) || 0],
    ["조회 기간", getPeriodLabel({ startDate, endDate, isSnapshot })],
    ["시트 구성", SHEET_LAYOUT_LABELS[sheetLayout] || SHEET_LAYOUT_LABELS.singleSheet],
  ];

  if (currencyUnit) rows.push(["금액 단위", currencyUnit]);
  if (includedFields.length > 0) {
    rows.push(["포함 항목", includedFields.join(", ")]);
  }
  if (filters.length > 0) rows.push(["적용 필터", filters.join(", ")]);
  recordCounts.forEach(({ label, count }) => {
    rows.push([label, Number(count) || 0]);
  });
  rows.push([
    "안내",
    "이 시트는 다운로드 당시의 조회 조건과 데이터 범위를 확인하기 위한 정보입니다.",
  ]);

  addAoaSheet(workbook, usedNames, "내보내기정보", rows, {
    autoFilter: false,
  });
};

const writeWorkbook = (workbook, filePrefix, options = {}) => {
  const fileNameParts = [
    "핀클래스",
    options.className,
    filePrefix,
    getPeriodFileNamePart(options),
    dayjs().format("YYYYMMDD_HHmmss"),
  ]
    .map(sanitizeFileNamePart)
    .filter(Boolean);

  XLSX.writeFile(workbook, `${fileNameParts.join("_")}.xlsx`);
};

const getStudentSheetName = (student) =>
  `${student.name || "학생"}${student.studentNumber ? `(${student.studentNumber})` : ""}`;

const getAssetValues = (student) => {
  const assets = student?.assets || {};
  const stockValue = assets.stockValue || {};
  const appliedRate =
    Number(stockValue.lastConversionRate) > 0
      ? Number(stockValue.lastConversionRate)
      : 1;

  return {
    studentNumber: student?.studentNumber || "",
    studentName: student?.name || "",
    creditScore:
      student?.creditScore === undefined || student?.creditScore === null
        ? ""
        : Number(student.creditScore),
    missionToken: toNumber(assets.missionToken ?? assets.token ?? 0),
    cash: toNumber(assets.cash),
    deposit: toNumber(assets.deposit),
    loan: toNumber(assets.loan),
    itemValue: toNumber(assets.itemValue),
    stockValue: Math.round(toNumber(stockValue.value) / appliedRate),
    usdCash: Math.round(toNumber(assets.usdBalance) / appliedRate),
    realEstateValue: toNumber(assets.realEstateValue),
    totalNetWorth: toNumber(assets.totalNetWorth),
  };
};

const getActivityTransactionType = (activity) => {
  if (activity.type === "admin_adjustment") {
    if (activity.subCategory === "add") return "교사지급";
    if (activity.subCategory === "subtract") return "교사회수";
    if (activity.subCategory === "absolute") return "교사설정";
  }

  if (activity.type === "income") return "수입";
  if (activity.type === "expense") return "지출";
  return activity.type || "기타";
};

const getActivityCategoryLabel = (category) =>
  ACTIVITY_CATEGORY_LABELS[category] || category || "";

const getCreditSourceLabel = (source) =>
  CREDIT_SOURCE_LABELS[source] || source || "";

const normalizeActivityRow = (activity) => ({
  studentNumber: activity.studentNumber || "",
  studentName: activity.studentName || "",
  timestamp: formatDateTime(activity.timestamp),
  transactionType: getActivityTransactionType(activity),
  category: getActivityCategoryLabel(activity.category),
  description: activity.description || "",
  reason: activity.note || activity.reason || "",
  amount: (() => {
    const rawAmount = getAmountInClass(activity);
    if (!rawAmount) return 0;

    if (
      activity.type === "expense" ||
      activity.subCategory === "subtract" ||
      [
        "transfer_out",
        "store_purchase",
        "tax_payment",
        "fine",
        "loan_repayment",
        "stock_buy",
        "stock_fee",
        "exchange_out",
        "exchange_fee",
        "mission_penalty",
      ].includes(activity.category)
    ) {
      return rawAmount * -1;
    }

    return rawAmount;
  })(),
});

const normalizeCreditLogRow = (record) => ({
  studentUid: record.studentUid || "",
  studentNumber: record.studentNumber || "",
  studentName: record.studentName || "",
  timestamp: formatDateTime(record.timestamp),
  delta: toNumber(record.delta ?? record.amount),
  reason: record.reason || "",
  source: getCreditSourceLabel(record.source),
});

const normalizeCreditHistoryRow = (record) => ({
  studentUid: record.studentUid || "",
  studentNumber: record.studentNumber || "",
  studentName: record.studentName || "",
  date: record.date || "",
  score: toNumber(record.score),
});

export const exportAssetSnapshotToExcel = (students, options = {}) => {
  const targetStudents = Array.isArray(students) ? students : [];
  if (targetStudents.length === 0) {
    appAlert("내보낼 학생 데이터가 없습니다.");
    return;
  }

  const selectedColumnKeys = Array.isArray(options.selectedColumns)
    ? options.selectedColumns
    : [];
  const selectedColumns = ASSET_EXPORT_COLUMNS.filter((column) =>
    selectedColumnKeys.includes(column.key),
  );

  if (selectedColumns.length === 0) {
    appAlert("내보낼 자산 수치를 하나 이상 선택해주세요.");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  const { includeCombined, includePerStudent } = resolveSheetLayout(options.sheetLayout);
  const combinedColumns = [
    { key: "studentNumber", label: "학번" },
    { key: "studentName", label: "이름" },
    ...selectedColumns,
  ];

  const normalizedStudents = [...targetStudents]
    .sort((a, b) => toNumber(a.studentNumber) - toNumber(b.studentNumber))
    .map((student) => ({ student, values: getAssetValues(student) }));

  addExportInfoSheet(workbook, usedNames, {
    dataType: "학급 자산",
    className: options.className,
    studentCount: normalizedStudents.length,
    recordCounts: [{ label: "자산 행 수", count: normalizedStudents.length }],
    isSnapshot: true,
    sheetLayout: options.sheetLayout,
    currencyUnit: options.currencyUnit,
    includedFields: ["학번", "이름", ...selectedColumns.map((column) => column.label)],
  });

  if (includeCombined) {
    addAoaSheet(
      workbook,
      usedNames,
      "자산현황",
      buildTableRows(
        combinedColumns,
        normalizedStudents.map((item) => item.values),
      ),
    );
  }

  if (includePerStudent) {
    normalizedStudents.forEach(({ student, values }) => {
      const rows = [
        ["항목", "값"],
        ["학번", values.studentNumber],
        ["이름", values.studentName],
        ...selectedColumns.map((column) => [column.label, values[column.key] ?? ""]),
      ];

      addAoaSheet(workbook, usedNames, getStudentSheetName(student), rows);
    });
  }

  writeWorkbook(workbook, "학급자산", {
    className: options.className,
    isSnapshot: true,
  });
};

export const exportActivityLogToExcel = (
  activities,
  options = {},
) => {
  const records = Array.isArray(activities) ? activities : [];
  const targetStudents = Array.isArray(options.students) ? options.students : [];
  if (records.length === 0) {
    appAlert("내보낼 활동로그가 없습니다.");
    return;
  }

  const selectedColumnKeys = Array.isArray(options.selectedColumns)
    ? options.selectedColumns
    : [];
  const selectedColumns = ACTIVITY_EXPORT_COLUMNS.filter((column) =>
    selectedColumnKeys.includes(column.key),
  );

  if (selectedColumns.length === 0) {
    appAlert("내보낼 컬럼을 하나 이상 선택해주세요.");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  const { includeCombined, includePerStudent } = resolveSheetLayout(options.sheetLayout);
  const sortedRecords = [...records]
    .map((record) => ({ ...record, normalized: normalizeActivityRow(record) }))
    .sort((a, b) => {
      const studentNumberGap =
        toNumber(a.studentNumber || a.normalized.studentNumber) -
        toNumber(b.studentNumber || b.normalized.studentNumber);
      if (studentNumberGap !== 0) return studentNumberGap;

      const nameGap = String(a.studentName || "").localeCompare(String(b.studentName || ""));
      if (nameGap !== 0) return nameGap;

      return dayjs(b.normalized.timestamp).valueOf() - dayjs(a.normalized.timestamp).valueOf();
    });
  const selectedCategoryLabels = ACTIVITY_CATEGORY_OPTIONS.filter((category) =>
    options.selectedCategories?.includes(category.key),
  ).map((category) => category.label);

  addExportInfoSheet(workbook, usedNames, {
    dataType: "활동로그",
    className: options.className,
    studentCount: targetStudents.length,
    recordCounts: [{ label: "활동로그 행 수", count: sortedRecords.length }],
    startDate: options.startDate,
    endDate: options.endDate,
    sheetLayout: options.sheetLayout,
    currencyUnit: options.currencyUnit,
    includedFields: selectedColumns.map((column) => column.label),
    filters: selectedCategoryLabels,
  });

  if (includeCombined) {
    addAoaSheet(
      workbook,
      usedNames,
      "활동로그",
      buildTableRows(
        selectedColumns,
        sortedRecords.map((item) => item.normalized),
      ),
    );
  }

  if (includePerStudent) {
    const studentsForSheets =
      targetStudents.length > 0
        ? targetStudents
        : Array.from(
            sortedRecords.reduce((accumulator, item) => {
              const key = item.studentUid || `${item.studentName}_${item.studentNumber}`;
              if (!accumulator.has(key)) {
                accumulator.set(key, {
                  uid: item.studentUid || key,
                  name: item.studentName || item.normalized.studentName,
                  studentNumber: item.studentNumber || item.normalized.studentNumber,
                });
              }
              return accumulator;
            }, new Map()).values(),
          );

    studentsForSheets.forEach((student) => {
      const rows = sortedRecords
        .filter((item) =>
          student.uid
            ? item.studentUid === student.uid
            : item.studentName === student.name &&
              item.studentNumber === student.studentNumber,
        )
        .map((item) => item.normalized);

      if (rows.length === 0) return;

      addAoaSheet(
        workbook,
        usedNames,
        `${student.name || "학생"}${student.studentNumber ? `(${student.studentNumber})` : ""}`,
        buildTableRows(selectedColumns, rows),
      );
    });
  }

  writeWorkbook(workbook, "활동로그", {
    className: options.className,
    startDate: options.startDate,
    endDate: options.endDate,
  });
};

export const exportCreditDataToExcel = (
  { logs = [], history = [], students = [] } = {},
  options = {},
) => {
  const includeLogs = options.selectedRecordTypes?.includes("creditLogs");
  const includeHistory = options.selectedRecordTypes?.includes("creditHistory");

  if (!includeLogs && !includeHistory) {
    appAlert("내보낼 신용 데이터를 하나 이상 선택해주세요.");
    return;
  }

  if (
    (!includeLogs || logs.length === 0) &&
    (!includeHistory || history.length === 0)
  ) {
    appAlert("내보낼 신용 데이터가 없습니다.");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  const { includeCombined, includePerStudent } = resolveSheetLayout(options.sheetLayout);

  const normalizedLogs = [...logs]
    .map(normalizeCreditLogRow)
    .sort((a, b) => {
      const studentNumberGap = toNumber(a.studentNumber) - toNumber(b.studentNumber);
      if (studentNumberGap !== 0) return studentNumberGap;

      const nameGap = String(a.studentName).localeCompare(String(b.studentName));
      if (nameGap !== 0) return nameGap;

      return dayjs(b.timestamp).valueOf() - dayjs(a.timestamp).valueOf();
    });

  const normalizedHistory = [...history]
    .map(normalizeCreditHistoryRow)
    .sort((a, b) => {
      const studentNumberGap = toNumber(a.studentNumber) - toNumber(b.studentNumber);
      if (studentNumberGap !== 0) return studentNumberGap;

      const nameGap = String(a.studentName).localeCompare(String(b.studentName));
      if (nameGap !== 0) return nameGap;

      return String(b.date).localeCompare(String(a.date));
    });
  const selectedRecordTypeLabels = CREDIT_RECORD_TYPE_OPTIONS.filter((recordType) =>
    options.selectedRecordTypes?.includes(recordType.key),
  ).map((recordType) => recordType.label);

  addExportInfoSheet(workbook, usedNames, {
    dataType: "신용로그",
    className: options.className,
    studentCount: students.length,
    recordCounts: [
      ...(includeLogs
        ? [{ label: "신용 변동 로그 행 수", count: normalizedLogs.length }]
        : []),
      ...(includeHistory
        ? [{ label: "신용 점수 이력 행 수", count: normalizedHistory.length }]
        : []),
    ],
    startDate: options.startDate,
    endDate: options.endDate,
    sheetLayout: options.sheetLayout,
    includedFields: selectedRecordTypeLabels,
  });

  if (includeCombined && includeLogs) {
    addAoaSheet(
      workbook,
      usedNames,
      "신용변동로그",
      buildTableRows(CREDIT_LOG_COLUMNS, normalizedLogs),
    );
  }

  if (includeCombined && includeHistory) {
    addAoaSheet(
      workbook,
      usedNames,
      "신용점수이력",
      buildTableRows(CREDIT_HISTORY_COLUMNS, normalizedHistory),
    );
  }

  if (includePerStudent) {
    students.forEach((student) => {
      const studentLogs = normalizedLogs.filter(
        (row) => row.studentUid === student.uid,
      );
      const studentHistory = normalizedHistory.filter(
        (row) => row.studentUid === student.uid,
      );

      const rows = [
        ["학생", `${student.name || "학생"}${student.studentNumber ? ` (${student.studentNumber})` : ""}`],
        [],
      ];

      if (includeLogs) {
        rows.push(["신용 변동 로그"]);
        rows.push(CREDIT_LOG_COLUMNS.slice(2).map((column) => column.label));

        if (studentLogs.length === 0) {
          rows.push(["데이터 없음"]);
        } else {
          studentLogs.forEach((row) => {
            rows.push(
              CREDIT_LOG_COLUMNS.slice(2).map((column) => row[column.key] ?? ""),
            );
          });
        }

        rows.push([]);
      }

      if (includeHistory) {
        rows.push(["신용 점수 이력"]);
        rows.push(CREDIT_HISTORY_COLUMNS.slice(2).map((column) => column.label));

        if (studentHistory.length === 0) {
          rows.push(["데이터 없음"]);
        } else {
          studentHistory.forEach((row) => {
            rows.push(
              CREDIT_HISTORY_COLUMNS.slice(2).map((column) => row[column.key] ?? ""),
            );
          });
        }
      }

      addAoaSheet(workbook, usedNames, getStudentSheetName(student), rows);
    });
  }

  writeWorkbook(workbook, "신용로그", {
    className: options.className,
    startDate: options.startDate,
    endDate: options.endDate,
  });
};
