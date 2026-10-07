import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Modal,
} from "../../../components/ui";
import { db } from "../../../firebase";
import PrintablePayslipDocument from "../components/PrintablePayslipDocument";

const payrollPrintStyles = `
  @page { size: A4 portrait; margin: 0; }
  @media screen {
    .payroll-print-root { display: none; }
  }
  @media print {
    html, body {
      width: 210mm !important;
      margin: 0 !important;
      padding: 0 !important;
      background: white !important;
    }
    body > * {
      display: none !important;
    }
    body > .payroll-print-root {
      display: block !important;
      width: 210mm;
      margin: 0;
      padding: 0;
      background: white;
    }
    .payroll-print-page {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 210mm;
      min-height: 297mm;
      margin: 0;
      padding: 14mm 15mm 12mm;
      page-break-after: always;
      break-after: page;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .payroll-print-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .payroll-print-page thead {
      display: table-header-group;
    }
    .payroll-print-page tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .payroll-print-page--dense {
      padding: 10mm 13mm 9mm;
    }
    .payroll-print-page--dense section {
      margin-top: 4mm !important;
    }
    .payroll-print-page--dense header {
      padding-bottom: 3mm !important;
    }
    .payroll-print-page--dense h1 {
      font-size: 22px !important;
    }
    .payroll-print-page--dense th,
    .payroll-print-page--dense td {
      padding-top: 1.6mm !important;
      padding-bottom: 1.6mm !important;
    }
    .payroll-print-page--compact {
      padding: 8mm 11mm 7mm;
      font-size: 10px;
    }
    .payroll-print-page--compact section {
      margin-top: 2.5mm !important;
    }
    .payroll-print-page--compact header {
      padding-bottom: 2.5mm !important;
    }
    .payroll-print-page--compact h1 {
      font-size: 19px !important;
    }
    .payroll-print-page--compact h2 {
      font-size: 14px !important;
    }
    .payroll-print-page--compact th,
    .payroll-print-page--compact td {
      padding-top: 1.2mm !important;
      padding-bottom: 1.2mm !important;
      font-size: 9px !important;
    }
    .payroll-print-page--compact footer {
      padding-top: 2mm !important;
    }
  }
`;
const TEXT = {
  all: "\uc804\uccb4",
  salary: "\uae09\uc5ec",
  bonus: "\uc131\uacfc\uae09",
  title: "\ucd5c\uadfc \uae09\uc5ec \uc9c0\uae09 \ub0b4\uc5ed",
  countPrefix: "\ud45c\uc2dc",
  netTotalPrefix: "\uc2e4\uc9c0\uae09 \ud569\uacc4",
  searchPlaceholder:
    "\ud559\uc0dd\uba85 \ub610\ub294 \uc9c0\uae09\uae30\uac04\uc73c\ub85c \uac80\uc0c9",
  createdAt: "\uc9c0\uae09\uc77c",
  student: "\ud559\uc0dd",
  type: "\uad6c\ubd84",
  period: "\uc9c0\uae09 \uae30\uac04",
  totalBaseSalary: "\ucd1d\uae09\uc5ec",
  deductions: "\uacf5\uc81c",
  totalBonus: "\uc131\uacfc\uae09",
  netSalary: "\uc2e4\uc9c0\uae09",
  emptyTitle: "\ud45c\uc2dc\ud560 \uc9c0\uae09 \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
  emptyDescription:
    "\uac80\uc0c9\uc5b4\ub098 \uad6c\ubd84 \ud544\ud130\ub97c \ubc14\uafd4\uc11c \ub2e4\uc2dc \ud655\uc778\ud574\ubcf4\uc138\uc694.",
  unknownName: "\uc774\ub984 \uc5c6\uc74c",
};

const TYPE_FILTERS = [
  { value: "all", label: TEXT.all },
  { value: "salary", label: TEXT.salary },
  { value: "bonus", label: TEXT.bonus },
];

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const getPayslipKey = (row) =>
  `${String(row?.studentUid || "unknown")}:${String(
    row?.id || toMillis(row?.createdAt),
  )}`;
const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value, options = {}) => {
  const parsed = toDate(value);
  if (!parsed) return "-";

  return parsed.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...options,
  });
};



const normalizeSlipType = (value) =>
  String(value || "salary").trim().toLowerCase() === "bonus" ? "bonus" : "salary";

const getSlipTypeMeta = (value) => {
  const slipType = normalizeSlipType(value);

  if (slipType === "bonus") {
    return {
      label: TEXT.bonus,
      tone: "emerald",
    };
  }

  return {
    label: TEXT.salary,
    tone: "indigo",
  };
};

const getPeriodLabel = (row) => {
  const paymentPeriodDescription = String(
    row?.paymentPeriodDescription || "",
  ).trim();
  if (paymentPeriodDescription) return paymentPeriodDescription;

  const startLabel = formatDate(row?.paymentStartDate);
  const endLabel = formatDate(row?.paymentEndDate);

  if (startLabel !== "-" && endLabel !== "-") {
    return `${startLabel} ~ ${endLabel}`;
  }

  if (startLabel !== "-") return startLabel;
  return "-";
};

export default function PayrollHistoryModal({
  isOpen,
  onClose,
  payslips = [],
  currencyUnit = "",
  classId = "",
  className = "학급",
}) {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatMoney = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [printPayslips, setPrintPayslips] = useState([]);
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const [printError, setPrintError] = useState("");

  const normalizedPayslips = useMemo(
    () =>
      [...(Array.isArray(payslips) ? payslips : [])].sort(
        (left, right) => toMillis(right?.createdAt) - toMillis(left?.createdAt),
      ),
    [payslips],
  );

  const filteredPayslips = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return normalizedPayslips.filter((row) => {
      const slipType = normalizeSlipType(row?.slipType);
      if (typeFilter !== "all" && slipType !== typeFilter) return false;

      if (!normalizedQuery) return true;

      const candidate = [
        row?.studentName,
        row?.paymentPeriodDescription,
        row?.payrollPeriodKey,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return candidate.includes(normalizedQuery);
    });
  }, [normalizedPayslips, searchQuery, typeFilter]);

  const visibleNetSalary = useMemo(
    () =>
      filteredPayslips.reduce(
        (sum, row) => sum + Number(row?.netSalary || 0),
        0,
      ),
    [filteredPayslips],
  );

  const salaryCount = useMemo(
    () =>
      filteredPayslips.filter(
        (row) => normalizeSlipType(row?.slipType) === "salary",
      ).length,
    [filteredPayslips],
  );

  const bonusCount = useMemo(
    () =>
      filteredPayslips.filter(
        (row) => normalizeSlipType(row?.slipType) === "bonus",
      ).length,
    [filteredPayslips],
  );

  const visibleKeys = useMemo(
    () => filteredPayslips.map(getPayslipKey),
    [filteredPayslips],
  );
  const allVisibleSelected =
    visibleKeys.length > 0 &&
    visibleKeys.every((key) => selectedKeys.has(key));
  const someVisibleSelected = visibleKeys.some((key) =>
    selectedKeys.has(key),
  );

  const toggleVisibleSelection = () => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleKeys.forEach((key) => next.delete(key));
      } else {
        visibleKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  };

  const togglePayslipSelection = (row) => {
    const key = getPayslipKey(row);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePrintSelected = async () => {
    const selectedRows = normalizedPayslips.filter((row) =>
      selectedKeys.has(getPayslipKey(row)),
    );
    if (!selectedRows.length || isPreparingPrint) return;

    setIsPreparingPrint(true);
    setPrintError("");

    try {
      const detailedPayslips = await Promise.all(
        selectedRows.map(async (row) => {
          if (!classId || !row?.studentUid || !row?.id) return row;

          const payslipSnap = await getDoc(
            doc(
              db,
              "classes",
              classId,
              "students",
              row.studentUid,
              "paySlips",
              row.id,
            ),
          );
          if (!payslipSnap.exists()) return row;

          const detail = payslipSnap.data() || {};
          return {
            ...row,
            ...detail,
            id: payslipSnap.id,
            studentUid: row.studentUid,
            studentName: detail.studentName || row.studentName,
          };
        }),
      );

      setPrintPayslips(detailedPayslips);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => window.print());
      });
    } catch (error) {
      console.error(
        "[PayrollHistoryModal] payslip print preparation failed:",
        error,
      );
      setPrintError(
        "선택한 명세서를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setIsPreparingPrint(false);
    }
  };
  return (
    <>
      <style>{payrollPrintStyles}</style>
      <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={TEXT.title}
      size="full"
    >
      <div className="space-y-5">
        <div className="rounded-[2rem] border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="slate">
                  {TEXT.countPrefix} {filteredPayslips.length}건
                </Badge>
                <Badge tone="blue">
                  {TEXT.salary} {salaryCount}건
                </Badge>
                <Badge tone="emerald">
                  {TEXT.bonus} {bonusCount}건
                </Badge>
                <Badge tone="blue">
                  {TEXT.netTotalPrefix} {formatMoney(visibleNetSalary, currencyUnit)}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  kind="solid"
                  tone="blue"
                  icon={Printer}
                  disabled={selectedKeys.size === 0 || isPreparingPrint}
                  isLoading={isPreparingPrint}
                  onClick={handlePrintSelected}
                >
                  선택 인쇄 {selectedKeys.size > 0 ? `${selectedKeys.size}건` : ""}
                </Button>
                {printError ? (
                  <p className="text-xs font-semibold text-rose-600">
                    {printError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex w-full flex-col gap-3 xl:max-w-xl">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={TEXT.searchPlaceholder}
                className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex flex-wrap gap-2">
                {TYPE_FILTERS.map((filter) => (
                  <Button
                    key={filter.value}
                    type="button"
                    size="sm"
                    kind={typeFilter === filter.value ? "solid" : "outline"}
                    tone={typeFilter === filter.value ? "blue" : "slate"}
                    onClick={() => setTypeFilter(filter.value)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white">
          <DataTable className="max-h-[62vh] overflow-auto" minWidth="min-w-[1180px]">
            <DataTable.Header className="sticky top-0 z-10">
              <DataTable.Row interactive={false}>
                <DataTable.HeadCell className="w-12 px-4 py-3">
                  <Checkbox
                    id="payroll-history-select-all"
                    checked={allVisibleSelected}
                    indeterminate={!allVisibleSelected && someVisibleSelected}
                    onChange={toggleVisibleSelection}
                  />
                </DataTable.HeadCell>                <DataTable.HeadCell className="px-4 py-3">{TEXT.createdAt}</DataTable.HeadCell>
                <DataTable.HeadCell className="px-4 py-3">{TEXT.student}</DataTable.HeadCell>
                <DataTable.HeadCell align="center" className="px-4 py-3">{TEXT.type}</DataTable.HeadCell>
                <DataTable.HeadCell className="px-4 py-3">{TEXT.period}</DataTable.HeadCell>
                <DataTable.HeadCell align="right" className="px-4 py-3">{TEXT.totalBaseSalary}</DataTable.HeadCell>
                <DataTable.HeadCell align="right" className="px-4 py-3">{TEXT.deductions}</DataTable.HeadCell>
                <DataTable.HeadCell align="right" className="px-4 py-3">{TEXT.totalBonus}</DataTable.HeadCell>
                <DataTable.HeadCell align="right" className="px-4 py-3">{TEXT.netSalary}</DataTable.HeadCell>
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
                {filteredPayslips.length === 0 ? (
                  <DataTable.Empty colSpan={9} className="py-14">
                    <EmptyState
                      title={TEXT.emptyTitle}
                      description={TEXT.emptyDescription}
                    />
                  </DataTable.Empty>
                ) : (
                  filteredPayslips.map((row) => {
                    const slipTypeMeta = getSlipTypeMeta(row?.slipType);
                    const rowKey = getPayslipKey(row);

                    return (
                      <DataTable.Row key={rowKey}>
                        <td className="px-4 py-3">
                          <Checkbox
                            id={`payroll-history-${rowKey}`}
                            checked={selectedKeys.has(rowKey)}
                            onChange={() => togglePayslipSelection(row)}
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-600">
                          {formatDate(row?.createdAt, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-800">
                            {row?.studentName || TEXT.unknownName}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge tone={slipTypeMeta.tone}>{slipTypeMeta.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {getPeriodLabel(row)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-slate-700">
                          {formatMoney(row?.totalBaseSalary, currencyUnit)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-500">
                          {formatMoney(row?.totalDeductions, currencyUnit)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-600">
                          {formatMoney(row?.totalBonusAmount, currencyUnit)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-blue-700">
                          {formatMoney(row?.netSalary, currencyUnit)}
                        </td>
                      </DataTable.Row>
                    );
                  })
                )}
            </DataTable.Body>
          </DataTable>
        </div>
      </div>
      </Modal>

      {typeof document !== "undefined"
        ? createPortal(
            <div className="payroll-print-root" aria-hidden="true">
              {printPayslips.map((payslip) => (
                <PrintablePayslipDocument
                  key={getPayslipKey(payslip)}
                  payslip={payslip}
                  className={className}
                  currencyUnit={currencyUnit}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}