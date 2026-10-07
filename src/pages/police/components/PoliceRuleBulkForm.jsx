import React, { useMemo, useRef, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  PlusIcon,
  TableCellsIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import * as XLSX from "xlsx";
import { Button, Checkbox } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import {
  getXlsxImportErrorMessage,
  parseFirstXlsxWorksheet,
  validateXlsxImportFile,
  XLSX_IMPORT_ACCEPT,
} from "../../../utils/safeXlsxImport";
import { getPolicePath } from "../utils/policePathUtils";
import { resolvePoliceRuleType } from "../utils/policeRuleUtils";

const makeRowId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createRow = (defaultType = "penalty") => {
  const isPenalty = defaultType === "penalty";
  return {
    id: makeRowId(),
    text: "",
    fineAmount: isPenalty ? -10 : 10,
    creditChange: isPenalty ? -10 : 10,
    missionTokenChange: 0,
    dangerLevel: isPenalty ? 2 : 1,
    notes: "",
  };
};

const toSafeOrder = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const HEADER_RULE_TEXT = "\uADDC\uCE59\uB0B4\uC6A9";
const HEADER_FINE_AMOUNT = "\uAE08\uC561";
const HEADER_CREDIT_CHANGE = "\uC2E0\uC6A9\uC810\uC218";
const HEADER_MISSION_TOKEN_CHANGE = "\uBBF8\uC158\uD1A0\uD070";
const HEADER_DANGER_LEVEL = "\uC704\uD5D8\uB3C4";
const HEADER_NOTES = "\uCC38\uACE0\uC0AC\uD56D";
const REQUIRED_EXCEL_HEADERS = [
  HEADER_RULE_TEXT,
  HEADER_FINE_AMOUNT,
  HEADER_CREDIT_CHANGE,
  HEADER_DANGER_LEVEL,
  HEADER_NOTES,
];
const EXCEL_HEADERS_WITH_MISSION_TOKEN = [
  ...REQUIRED_EXCEL_HEADERS.slice(0, 3),
  HEADER_MISSION_TOKEN_CHANGE,
  ...REQUIRED_EXCEL_HEADERS.slice(3),
];

const SAMPLE_SHEET_NAME = "\uADDC\uCE59\uC77C\uAD04\uC785\uB825";
const SAMPLE_FILE_NAME = "\uACBD\uCC30\uADDC\uCE59_\uC77C\uAD04\uC785\uB825_\uC0D8\uD50C.xlsx";

const parseNumber = (value) => {
  if (typeof value === "number") return value;
  const normalized = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!normalized) return Number.NaN;
  return Number(normalized);
};

export default function PoliceRuleBulkForm({
  onClose,
  onSaved,
  existingRules = [],
  defaultType = "penalty",
}) {
  const { classId } = useUser();
  const { showFeedback } = useFeedback();
  const fileInputRef = useRef(null);

  const [rows, setRows] = useState(() => [createRow(defaultType), createRow(defaultType)]);
  const [showMissionTokenColumn, setShowMissionTokenColumn] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const maxExistingOrder = useMemo(() => {
    if (!Array.isArray(existingRules) || existingRules.length === 0) return 0;
    const safeOrders = existingRules
      .map((rule, idx) => toSafeOrder(rule?.order) ?? idx + 1)
      .filter((n) => Number.isFinite(n));
    return safeOrders.length > 0 ? Math.max(...safeOrders) : 0;
  }, [existingRules]);

  const activeRowCount = useMemo(
    () => rows.filter((row) => String(row.text || "").trim().length > 0).length,
    [rows],
  );

  const handleChange = (rowId, field, value) => {
    setRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    );
  };

  const addRow = () => {
    setRows((prev) => [...prev, createRow(defaultType)]);
  };

  const removeRow = (rowId) => {
    setRows((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((row) => row.id !== rowId);
    });
  };

  const normalizeRows = () => {
    const normalized = rows.map((row) => {
      const text = String(row.text || "").trim();
      const notes = String(row.notes || "").trim();
      const fineAmount = Number(row.fineAmount) || 0;
      const creditChange = Number(row.creditChange) || 0;
      const missionTokenChange = showMissionTokenColumn
        ? Number(row.missionTokenChange) || 0
        : 0;
      const dangerLevel = Number(row.dangerLevel) || 1;
      const type = resolvePoliceRuleType({
        fineAmount,
        creditChange,
        missionTokenChange,
      });
      return {
        ...row,
        text,
        notes,
        fineAmount,
        creditChange,
        missionTokenChange,
        dangerLevel,
        type,
      };
    });
    return normalized.filter((row) => row.text.length > 0);
  };

  const validateRows = (normalizedRows) => {
    const invalidSignRows = [];
    normalizedRows.forEach((row, idx) => {
      const nonZeroSigns = [
        row.fineAmount,
        row.creditChange,
        row.missionTokenChange,
      ]
        .filter((value) => value !== 0)
        .map((value) => Math.sign(value));

      if (
        nonZeroSigns.length > 1 &&
        nonZeroSigns.some((sign) => sign !== nonZeroSigns[0])
      ) {
        invalidSignRows.push(idx + 1);
      }
    });

    if (invalidSignRows.length > 0) {
      showFeedback(
        `\uAE08\uC561/\uC2E0\uC6A9\uC810\uC218/\uBBF8\uC158\uD1A0\uD070 \uBD80\uD638\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uB294 \uD589: ${invalidSignRows.join(", ")}`,
        "error",
      );
      return false;
    }
    return true;
  };

  const handleDownloadSample = () => {
    try {
      const headers = showMissionTokenColumn
        ? EXCEL_HEADERS_WITH_MISSION_TOKEN
        : REQUIRED_EXCEL_HEADERS;
      const sampleRows = [
        showMissionTokenColumn
          ? {
              [HEADER_RULE_TEXT]:
                "\uC218\uC5C5 \uC911 \uBB34\uB2E8 \uC790\uB9AC \uC774\uD0C8",
              [HEADER_FINE_AMOUNT]: -10,
              [HEADER_CREDIT_CHANGE]: -5,
              [HEADER_MISSION_TOKEN_CHANGE]: -1,
              [HEADER_DANGER_LEVEL]: 2,
              [HEADER_NOTES]:
                "\uBC8C\uAE08 \uADDC\uCE59 \uC608\uC2DC: \uAE08\uC561/\uC2E0\uC6A9\uC810\uC218/\uBBF8\uC158\uD1A0\uD070\uC5D0 -\uB97C \uBD99\uC5EC \uC785\uB825, \uBBF8\uC0AC\uC6A9 \uC2DC 0",
            }
          : {
              [HEADER_RULE_TEXT]:
                "\uC218\uC5C5 \uC911 \uBB34\uB2E8 \uC790\uB9AC \uC774\uD0C8",
              [HEADER_FINE_AMOUNT]: -10,
              [HEADER_CREDIT_CHANGE]: -5,
              [HEADER_DANGER_LEVEL]: 2,
              [HEADER_NOTES]:
                "\uBC8C\uAE08 \uADDC\uCE59 \uC608\uC2DC: \uAE08\uC561/\uC2E0\uC6A9\uC810\uC218\uC5D0 -\uB97C \uBD99\uC5EC \uC785\uB825",
            },
        showMissionTokenColumn
          ? {
              [HEADER_RULE_TEXT]:
                "\uC9C8\uBB38\uC5D0 \uC801\uADF9\uC801\uC73C\uB85C \uCC38\uC5EC",
              [HEADER_FINE_AMOUNT]: 10,
              [HEADER_CREDIT_CHANGE]: 5,
              [HEADER_MISSION_TOKEN_CHANGE]: 1,
              [HEADER_DANGER_LEVEL]: 1,
              [HEADER_NOTES]:
                "\uC0C1\uAE08 \uADDC\uCE59 \uC608\uC2DC: - \uC5C6\uC774 \uC591\uC218\uB85C \uC785\uB825, \uBBF8\uC0AC\uC6A9 \uC2DC 0",
            }
          : {
              [HEADER_RULE_TEXT]:
                "\uC9C8\uBB38\uC5D0 \uC801\uADF9\uC801\uC73C\uB85C \uCC38\uC5EC",
              [HEADER_FINE_AMOUNT]: 10,
              [HEADER_CREDIT_CHANGE]: 5,
              [HEADER_DANGER_LEVEL]: 1,
              [HEADER_NOTES]:
                "\uC0C1\uAE08 \uADDC\uCE59 \uC608\uC2DC: - \uC5C6\uC774 \uC591\uC218\uB85C \uC785\uB825",
            },
      ];

      const worksheet = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
      worksheet["!cols"] = showMissionTokenColumn
        ? [
            { wch: 28 },
            { wch: 10 },
            { wch: 12 },
            { wch: 12 },
            { wch: 10 },
            { wch: 24 },
          ]
        : [
            { wch: 28 },
            { wch: 10 },
            { wch: 12 },
            { wch: 10 },
            { wch: 24 },
          ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, SAMPLE_SHEET_NAME);
      XLSX.writeFile(workbook, SAMPLE_FILE_NAME);
    } catch (error) {
      console.error("Sample download failed:", error);
      showFeedback(
        "\uC0D8\uD50C \uD30C\uC77C \uB2E4\uC6B4\uB85C\uB4DC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
        "error",
      );
    }
  };

  const handleClickUpload = () => {
    fileInputRef.current?.click();
  };

  const handleUploadExcel = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      validateXlsxImportFile(file);
      const fileBuffer = await file.arrayBuffer();
      const { rows: sheetRows } = parseFirstXlsxWorksheet(fileBuffer, {
        file,
        sheetToJsonOptions: { header: 1, defval: "" },
      });
      if (sheetRows.length === 0) {
        showFeedback(
          "\uC5D1\uC140 \uD30C\uC77C\uC5D0 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
          "error",
        );
        return;
      }

      const headerRow = (sheetRows[0] || []).map((header) => String(header || "").trim());
      const missingHeaders = REQUIRED_EXCEL_HEADERS.filter(
        (header) => !headerRow.includes(header),
      );
      if (missingHeaders.length > 0) {
        showFeedback(
          "\uC5D1\uC140 \uD5E4\uB354 \uD615\uC2DD\uC774 \uD2C0\uB838\uC2B5\uB2C8\uB2E4. \uC0D8\uD50C \uD30C\uC77C \uD615\uC2DD\uC744 \uADF8\uB300\uB85C \uC0AC\uC6A9\uD574 \uC8FC\uC138\uC694.",
          "error",
        );
        return;
      }

      const headerIndexMap = {
        text: headerRow.indexOf(HEADER_RULE_TEXT),
        fineAmount: headerRow.indexOf(HEADER_FINE_AMOUNT),
        creditChange: headerRow.indexOf(HEADER_CREDIT_CHANGE),
        missionTokenChange: headerRow.indexOf(HEADER_MISSION_TOKEN_CHANGE),
        dangerLevel: headerRow.indexOf(HEADER_DANGER_LEVEL),
        notes: headerRow.indexOf(HEADER_NOTES),
      };

      const importedRows = [];
      const invalidDangerRows = [];
      const invalidNumberRows = [];

      sheetRows.slice(1).forEach((columns, rowIdx) => {
        const excelRowNo = rowIdx + 2;
        const text = String(columns[headerIndexMap.text] || "").trim();
        if (!text) return;

        const fineAmount =
          String(columns[headerIndexMap.fineAmount] ?? "").trim() === ""
            ? 0
            : parseNumber(columns[headerIndexMap.fineAmount]);
        const creditChange =
          String(columns[headerIndexMap.creditChange] ?? "").trim() === ""
            ? 0
            : parseNumber(columns[headerIndexMap.creditChange]);
        const missionTokenChange =
          String(columns[headerIndexMap.missionTokenChange] ?? "").trim() === ""
            ? 0
            : parseNumber(columns[headerIndexMap.missionTokenChange]);
        const resolvedType = resolvePoliceRuleType({
          fineAmount,
          creditChange,
          missionTokenChange,
        });
        const dangerLevel =
          String(columns[headerIndexMap.dangerLevel] ?? "").trim() === ""
            ? 1
            : parseNumber(columns[headerIndexMap.dangerLevel]);
        const notes = String(columns[headerIndexMap.notes] || "").trim();

        if (
          !Number.isFinite(fineAmount) ||
          !Number.isFinite(creditChange) ||
          !Number.isFinite(missionTokenChange)
        ) {
          invalidNumberRows.push(excelRowNo);
          return;
        }

        if (
          resolvedType === "penalty" &&
          (!Number.isInteger(dangerLevel) || dangerLevel < 1 || dangerLevel > 3)
        ) {
          invalidDangerRows.push(excelRowNo);
          return;
        }

        importedRows.push({
          id: makeRowId(),
          text,
          fineAmount,
          creditChange,
          missionTokenChange,
          dangerLevel,
          notes,
        });
      });

      if (invalidNumberRows.length > 0) {
        showFeedback(
          `\uAE08\uC561/\uC2E0\uC6A9\uC810\uC218/\uBBF8\uC158\uD1A0\uD070\uC774 \uC22B\uC790\uAC00 \uC544\uB2CC \uD589\uC774 \uC788\uC2B5\uB2C8\uB2E4: ${invalidNumberRows.join(", ")}\uD589`,
          "error",
        );
        return;
      }

      if (invalidDangerRows.length > 0) {
        showFeedback(
          `\uC704\uD5D8\uB3C4\uB294 1~3 \uC22B\uC790\uB9CC \uC785\uB825 \uAC00\uB2A5\uD569\uB2C8\uB2E4: ${invalidDangerRows.join(", ")}\uD589`,
          "error",
        );
        return;
      }

      if (importedRows.length === 0) {
        showFeedback(
          "\uC5C5\uB85C\uB4DC\uD560 \uADDC\uCE59 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
          "warning",
        );
        return;
      }

      setShowMissionTokenColumn(
        headerRow.includes(HEADER_MISSION_TOKEN_CHANGE) ||
          importedRows.some((row) => Number(row.missionTokenChange) !== 0),
      );
      setRows(importedRows);
      showFeedback(
        `${importedRows.length}\uAC1C \uADDC\uCE59\uC744 \uC5D1\uC140\uC5D0\uC11C \uBD88\uB7EC\uC654\uC2B5\uB2C8\uB2E4.`,
        "success",
      );
    } catch (error) {
      console.error("Excel upload failed:", error);
      showFeedback(
        getXlsxImportErrorMessage(
          error,
          "\uC5D1\uC140 \uC5C5\uB85C\uB4DC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
        ),
        "error",
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleToggleMissionTokenColumn = (checked) => {
    setShowMissionTokenColumn(checked);
    if (!checked) {
      setRows((prev) => prev.map((row) => ({ ...row, missionTokenChange: 0 })));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!classId) {
      showFeedback(
        "\uD559\uAE09 \uC815\uBCF4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
        "error",
      );
      return;
    }

    const normalizedRows = normalizeRows();
    if (normalizedRows.length === 0) {
      showFeedback(
        "\uADDC\uCE59 \uB0B4\uC6A9\uC744 1\uAC1C \uC774\uC0C1 \uC785\uB825\uD574 \uC8FC\uC138\uC694.",
        "warning",
      );
      return;
    }

    if (!validateRows(normalizedRows)) return;

    setIsSaving(true);
    try {
      const rulesPath = getPolicePath("policeRulesCollection", classId);
      const rulesCollectionRef = collection(db, rulesPath);
      const batch = writeBatch(db);

      normalizedRows.forEach((row, idx) => {
        const newRef = doc(rulesCollectionRef);
        const payload = {
          text: row.text,
          fineAmount: row.fineAmount,
          creditChange: row.creditChange,
          missionTokenEnabled: row.missionTokenChange !== 0,
          missionTokenChange: row.missionTokenChange,
          notes: row.notes,
          type: row.type,
          order: maxExistingOrder + idx + 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (row.type === "penalty") payload.dangerLevel = row.dangerLevel;
        batch.set(newRef, payload);
      });

      await batch.commit();
      showFeedback(
        `${normalizedRows.length}\uAC1C \uADDC\uCE59\uC744 \uD55C \uBC88\uC5D0 \uCD94\uAC00\uD588\uC2B5\uB2C8\uB2E4.`,
        "success",
      );
      onSaved?.();
      onClose?.();
    } catch (error) {
      console.error("Bulk rule save failed:", error);
      showFeedback(
        "\uADDC\uCE59 \uC77C\uAD04 \uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
        "error",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <TableCellsIcon className="h-4 w-4" />
          {"\uD45C \uD615\uD0DC\uB85C \uC5EC\uB7EC \uADDC\uCE59\uC744 \uD55C \uBC88\uC5D0 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {"\uADDC\uCE59 \uB0B4\uC6A9\uC774 \uBE44\uC5B4 \uC788\uB294 \uD589\uC740 \uC800\uC7A5\uC5D0\uC11C \uC81C\uC678\uB429\uB2C8\uB2E4. \uAE08\uC561\uACFC \uC2E0\uC6A9\uC810\uC218\uB294 \uAC19\uC740 \uBC29\uD5A5\uC73C\uB85C \uC785\uB825\uD558\uC138\uC694. \uC704\uD5D8\uB3C4\uB294 1~3 \uC22B\uC790\uB9CC \uC785\uB825\uD569\uB2C8\uB2E4."}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {"\uC790\uB3D9 \uBD84\uB958 \uAE30\uC900: \uAE08\uC561, \uC2E0\uC6A9\uC810\uC218, \uBBF8\uC158\uD1A0\uD070 \uC911 \uD558\uB098\uB77C\uB3C4 \uC74C\uC218\uBA74 \uBC8C\uAE08 \uADDC\uCE59, \uD558\uB098\uB77C\uB3C4 \uC591\uC218\uBA74 \uC0C1\uAE08 \uADDC\uCE59\uC73C\uB85C \uC800\uC7A5\uB429\uB2C8\uB2E4."}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {"\uBBF8\uC158\uD1A0\uD070\uC740 \uC544\uB798 \uCCB4\uD06C\uBC15\uC2A4\uB97C \uCF1C\uC57C \uD45C \uCEEC\uB7FC\uC774 \uBCF4\uC785\uB2C8\uB2E4. \uB044\uBA74 \uD574\uB2F9 \uAC12\uC740 0\uC73C\uB85C \uC800\uC7A5\uB429\uB2C8\uB2E4. \uC5D1\uC140\uC740 \uBBF8\uC158\uD1A0\uD070 \uC5F4\uC774 \uC5C6\uC5B4\uB3C4 \uC5C5\uB85C\uB4DC\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4."}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-slate-500">
            {"\uC785\uB825 \uD589: "}
            {rows.length}
            {" / \uC800\uC7A5 \uB300\uC0C1: "}
            {activeRowCount}
          </div>
          <Checkbox
            id="police-rule-bulk-mission-token-toggle"
            checked={showMissionTokenColumn}
            onChange={(event) =>
              handleToggleMissionTokenColumn(event.target.checked)
            }
            label="미션토큰 컬럼 표시"
            labelClassName="text-slate-700 font-medium"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            tone="slate"
            kind="outline"
            icon={ArrowDownTrayIcon}
            onClick={handleDownloadSample}
          >
            {"\uC0D8\uD50C \uB2E4\uC6B4\uB85C\uB4DC"}
          </Button>
          <Button
            type="button"
            size="sm"
            tone="blue"
            kind="outline"
            icon={ArrowUpTrayIcon}
            onClick={handleClickUpload}
          >
            {"\uC5D1\uC140 \uC5C5\uB85C\uB4DC"}
          </Button>
          <Button
            type="button"
            size="sm"
            tone="blue"
            kind="outline"
            icon={PlusIcon}
            onClick={addRow}
          >
            {"\uD589 \uCD94\uAC00"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={XLSX_IMPORT_ACCEPT}
            onChange={handleUploadExcel}
            className="hidden"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table
          className={`${showMissionTokenColumn ? "min-w-[1120px]" : "min-w-[980px]"} w-full text-sm`}
        >
          <thead className="bg-slate-100/80 text-slate-600">
            <tr>
              <th className="px-3 py-3 text-left w-[72px]">{"\uBC88\uD638"}</th>
              <th className="px-3 py-3 text-left min-w-[280px]">
                {"\uADDC\uCE59 \uB0B4\uC6A9"}
              </th>
              <th className="px-3 py-3 text-left w-[130px]">{"\uAE08\uC561"}</th>
              <th className="px-3 py-3 text-left w-[130px]">
                {"\uC2E0\uC6A9\uC810\uC218"}
              </th>
              {showMissionTokenColumn ? (
                <th className="px-3 py-3 text-left w-[130px]">
                  {"\uBBF8\uC158\uD1A0\uD070"}
                </th>
              ) : null}
              <th className="px-3 py-3 text-left w-[120px]">{"\uC704\uD5D8\uB3C4"}</th>
              <th
                className={`px-3 py-3 text-left ${showMissionTokenColumn ? "min-w-[180px]" : "min-w-[220px]"}`}
              >
                {"\uCC38\uACE0\uC0AC\uD56D"}
              </th>
              <th className="px-3 py-3 text-center w-[130px]">{"\uC791\uC5C5"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const fineAmountNum = Number(row.fineAmount) || 0;
              const creditChangeNum = Number(row.creditChange) || 0;
              const missionTokenChangeNum = Number(row.missionTokenChange) || 0;
              const isPenalty =
                resolvePoliceRuleType({
                  fineAmount: fineAmountNum,
                  creditChange: creditChangeNum,
                  missionTokenChange: missionTokenChangeNum,
                }) === "penalty";

              return (
                <tr key={row.id} className="border-t border-slate-100 bg-white">
                  <td className="px-3 py-2 text-slate-500 font-semibold">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <input
                      value={row.text}
                      onChange={(event) =>
                        handleChange(row.id, "text", event.target.value)
                      }
                      placeholder={"\uC608: \uC218\uC5C5 \uC911 \uBB34\uB2E8 \uC790\uB9AC\uC774\uD0C8"}
                      className="w-full rounded-xl border border-blue-200 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-indigo-300"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={row.fineAmount}
                      onChange={(event) =>
                        handleChange(row.id, "fineAmount", event.target.value)
                      }
                      className="w-full rounded-xl border border-blue-200 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-indigo-300"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={row.creditChange}
                      onChange={(event) =>
                        handleChange(row.id, "creditChange", event.target.value)
                      }
                      className="w-full rounded-xl border border-blue-200 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-indigo-300"
                    />
                  </td>
                  {showMissionTokenColumn ? (
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={row.missionTokenChange}
                        onChange={(event) =>
                          handleChange(row.id, "missionTokenChange", event.target.value)
                        }
                        className="w-full rounded-xl border border-blue-200 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-indigo-300"
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <select
                      value={row.dangerLevel}
                      onChange={(event) =>
                        handleChange(row.id, "dangerLevel", event.target.value)
                      }
                      disabled={!isPenalty}
                      className={`w-full rounded-xl border px-3 py-2 outline-none ${
                        isPenalty
                          ? "border-blue-200 focus:ring-2 focus:ring-blue-500/20 focus:border-indigo-300"
                          : "border-slate-100 bg-slate-100 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <textarea
                      value={row.notes}
                      onChange={(event) =>
                        handleChange(row.id, "notes", event.target.value)
                      }
                      placeholder={"\uC120\uD0DD \uC785\uB825"}
                      rows={2}
                      className="min-h-16 w-full resize-y rounded-xl border border-blue-200 px-3 py-2 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-blue-500/20"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        tone="red"
                        kind="ghost"
                        icon={TrashIcon}
                        onClick={() => removeRow(row.id)}
                        title={"\uD589 \uC0AD\uC81C"}
                        disabled={rows.length <= 1}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
          {"\uCDE8\uC18C"}
        </Button>
        <Button type="submit" tone="blue" isLoading={isSaving} disabled={isSaving}>
          {isSaving
            ? "\uC800\uC7A5 \uC911..."
            : `${activeRowCount || 0}\uAC1C \uADDC\uCE59 \uC800\uC7A5`}
        </Button>
      </div>
    </form>
  );
}
