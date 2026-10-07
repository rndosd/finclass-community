import React, { useEffect, useMemo, useState } from "react";
import { Checkbox, Button, DataTable, EmptyState } from "../../../components/ui";
import { ArrowUpDown, ListChecks, SlidersHorizontal } from "lucide-react";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import { DEFAULT_MISSION_TOKEN_LABEL } from "../../../utils/missionTokenLabel";

const STORAGE_PREFIX = "admin.finance.visibleColumns.v1";

export const OPTIONAL_COLUMN_CONFIG = [
  { key: "creditScore", label: "신용" },
  { key: "missionToken", label: DEFAULT_MISSION_TOKEN_LABEL },
  { key: "cash", label: "현금" },
  { key: "deposit", label: "예금" },
  { key: "loan", label: "대출" },
  { key: "itemValue", label: "아이템" },
  { key: "stockValue", label: "주식" },
  { key: "usdCash", label: "외화" },
  { key: "realEstateValue", label: "부동산" },
  { key: "totalNetWorth", label: "순자산" },
];

export const DEFAULT_VISIBLE_COLUMNS = OPTIONAL_COLUMN_CONFIG.reduce(
  (acc, col) => ({ ...acc, [col.key]: true }),
  {}
);

const SORTABLE_OPTIONAL_COLUMNS = new Set([
  "creditScore",
  "missionToken",
  "cash",
  "deposit",
  "loan",
  "itemValue",
  "totalNetWorth",
]);

const toNumber = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const isRowSelectionExcludedTarget = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,select,textarea,label,[data-no-row-select='true']",
    ),
  );
};

const getStorageKey = (classId) => `${STORAGE_PREFIX}:${classId || "default"}`;

export const sanitizeVisibleColumns = (raw) => {
  const next = { ...DEFAULT_VISIBLE_COLUMNS };
  if (!raw || typeof raw !== "object") return next;

  OPTIONAL_COLUMN_CONFIG.forEach((col) => {
    if (typeof raw[col.key] === "boolean") {
      next[col.key] = raw[col.key];
    }
  });

  return next;
};

export const loadVisibleColumns = (classId) => {
  if (typeof window === "undefined") return { ...DEFAULT_VISIBLE_COLUMNS };
  try {
    const saved = window.localStorage.getItem(getStorageKey(classId));
    if (!saved) return { ...DEFAULT_VISIBLE_COLUMNS };
    return sanitizeVisibleColumns(JSON.parse(saved));
  } catch (error) {
    console.warn("Failed to load finance table columns:", error);
    return { ...DEFAULT_VISIBLE_COLUMNS };
  }
};

const saveVisibleColumns = (classId, visibleColumns) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getStorageKey(classId),
      JSON.stringify(visibleColumns)
    );
  } catch (error) {
    console.warn("Failed to save finance table columns:", error);
  }
};

const AssetRow = ({
  student,
  selectionEnabled,
  canOpenLog,
  canOpenActivityLog,
  canOpenMissionTokenHistory,
  canOpenBank,
  canOpenPortfolio,
  canOpenInventory,
  isSelected,
  onToggle,
  onOpenLog,
  onOpenActivityLog,
  onOpenMissionTokenHistory,
  onOpenBank,
  onOpenPortfolio,
  onOpenInventory,
  isColumnVisible,
  onSelectionMouseDown,
  onSelectionMouseEnter,
}) => {
  const { formatClassCurrency } = useNumberFormat();

  const {
    cash = 0,
    deposit = 0,
    loan = 0,
    itemValue = 0,
    realEstateValue = 0,
    usdBalance = 0,
    stockValue = {},
    totalNetWorth = 0,
  } = student.assets || {};

  const missionToken = toNumber(
    student.assets?.missionToken ?? student.assets?.token ?? 0
  );

  const lastRate =
    Number(stockValue?.lastConversionRate) > 0
      ? Number(stockValue.lastConversionRate)
      : 1;
  const stockValueLocal = Math.round(toNumber(stockValue?.value) / lastRate);
  const usdCashLocal = Math.round(toNumber(usdBalance) / lastRate);

  const hasScore =
    student.creditScore !== undefined && student.creditScore !== null;

  const handleAction = (enabled, fn, ...args) => {
    if (!enabled) return;
    if (typeof fn === "function") fn(...args);
  };

  const interactiveClass = (enabled) =>
    enabled
      ? "cursor-pointer hover:underline decoration-2 underline-offset-4 hover:text-blue-700 transition-colors"
      : "cursor-default";

  return (
    <DataTable.Row
      onMouseDown={(event) => {
        if (!selectionEnabled || event.button !== 0) return;
        if (isRowSelectionExcludedTarget(event.target)) return;
        event.preventDefault();
        onSelectionMouseDown?.(student.uid, isSelected);
      }}
      onMouseEnter={() => {
        if (!selectionEnabled) return;
        onSelectionMouseEnter?.(student.uid);
      }}
      className={`transition-colors border-b last:border-0 border-slate-50 ${
        isSelected
          ? "bg-blue-50"
          : !selectionEnabled
            ? "hover:bg-slate-50/80"
            : "cursor-pointer hover:bg-slate-50/80"
      }`}
    >
      {selectionEnabled && (
        <td
          className="p-4 text-center"
          data-no-row-select="true"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Checkbox checked={isSelected} onChange={onToggle} />
        </td>
      )}

      <td className="p-4 text-slate-500 font-mono text-xs">
        {student.studentNumber || "-"}
      </td>
      <td className="p-4 font-semibold text-slate-700">{student.name}</td>

      {isColumnVisible("creditScore") && (
        <td
          data-no-row-select="true"
          className={`p-4 text-center ${canOpenLog ? "cursor-pointer group" : ""}`}
          onClick={() => handleAction(canOpenLog, onOpenLog, student)}
        >
          <span
            className={`font-bold px-3 py-1 rounded-full ${
              hasScore ? "text-blue-600 bg-blue-50" : "text-slate-300"
            }`}
          >
            {hasScore ? student.creditScore : "-"}
          </span>
        </td>
      )}

      {isColumnVisible("missionToken") && (
        <td
          data-no-row-select="true"
          className={`p-4 text-right font-bold text-blue-600 ${interactiveClass(
            canOpenMissionTokenHistory,
          )}`}
          onClick={() =>
            handleAction(
              canOpenMissionTokenHistory,
              onOpenMissionTokenHistory,
              student,
            )
          }
        >
          {formatClassCurrency(missionToken)}
        </td>
      )}

      {isColumnVisible("cash") && (
        <td className="p-4 text-right font-bold text-emerald-600">
          {formatClassCurrency(cash)}
        </td>
      )}

      {isColumnVisible("deposit") && (
        <td
          data-no-row-select="true"
          className={`p-4 text-right text-blue-600 font-bold ${interactiveClass(canOpenBank)}`}
          onClick={() => handleAction(canOpenBank, onOpenBank, student, "savings")}
        >
          {formatClassCurrency(deposit)}
        </td>
      )}

      {isColumnVisible("loan") && (
        <td
          data-no-row-select="true"
          className={`p-4 text-right text-rose-600 font-bold ${interactiveClass(canOpenBank)}`}
          onClick={() => handleAction(canOpenBank, onOpenBank, student, "loans")}
        >
          {formatClassCurrency(loan)}
        </td>
      )}

      {isColumnVisible("itemValue") && (
        <td
          data-no-row-select="true"
          className={`p-4 text-right text-purple-600 font-bold ${interactiveClass(canOpenInventory)}`}
          onClick={() => handleAction(canOpenInventory, onOpenInventory, student)}
        >
          {formatClassCurrency(itemValue)}
        </td>
      )}

      {isColumnVisible("stockValue") && (
        <td
          data-no-row-select="true"
          className={`p-4 text-right text-amber-600 font-bold ${interactiveClass(canOpenPortfolio)}`}
          onClick={() => handleAction(canOpenPortfolio, onOpenPortfolio, student)}
        >
          {formatClassCurrency(stockValueLocal)}
        </td>
      )}

      {isColumnVisible("usdCash") && (
        <td className="p-4 text-right text-blue-500 font-medium">
          {formatClassCurrency(usdCashLocal)}
        </td>
      )}

      {isColumnVisible("realEstateValue") && (
        <td className="p-4 text-right text-amber-600 font-bold">
          {formatClassCurrency(realEstateValue)}
        </td>
      )}

      {isColumnVisible("totalNetWorth") && (
        <td className="bg-slate-50/30 p-4 text-right font-bold text-slate-900">
          {formatClassCurrency(totalNetWorth)}
        </td>
      )}
      <td className="p-4 text-center" data-no-row-select="true">
        <Button
          type="button"
          kind="ghost"
          tone="slate"
          size="icon-sm"
          icon={ListChecks}
          aria-label={`${student.name} 활동 로그 보기`}
          title="활동 로그 보기"
          disabled={!canOpenActivityLog}
          onClick={() => handleAction(canOpenActivityLog, onOpenActivityLog, student)}
        />
      </td>
    </DataTable.Row>
  );
};

const MobileAssetMetric = ({ label, value, tone = "slate", onClick }) => {
  const toneClassName = {
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-50 text-slate-700",
  }[tone];
  const Component = onClick ? "button" : "div";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`min-h-14 rounded-xl p-3 text-left ${toneClassName} ${
        onClick ? "transition active:scale-[0.98]" : ""
      }`}
    >
      <span className="block text-[11px] font-bold opacity-70">{label}</span>
      <strong className="mt-1 block truncate text-sm">{value}</strong>
    </Component>
  );
};

const MobileAssetCard = ({
  student,
  selectionEnabled,
  canOpenLog,
  canOpenActivityLog,
  canOpenMissionTokenHistory,
  canOpenBank,
  canOpenInventory,
  canOpenPortfolio,
  isSelected,
  onToggle,
  onOpenLog,
  onOpenActivityLog,
  onOpenMissionTokenHistory,
  onOpenBank,
  onOpenInventory,
  onOpenPortfolio,
}) => {
  const { formatClassCurrency } = useNumberFormat();
  const { missionTokenLabel } = useUser();
  const {
    cash = 0,
    deposit = 0,
    loan = 0,
    itemValue = 0,
    realEstateValue = 0,
    usdBalance = 0,
    stockValue = {},
    totalNetWorth = 0,
  } = student.assets || {};
  const missionToken = toNumber(
    student.assets?.missionToken ?? student.assets?.token ?? 0,
  );
  const lastRate =
    Number(stockValue?.lastConversionRate) > 0
      ? Number(stockValue.lastConversionRate)
      : 1;
  const stockValueLocal = Math.round(toNumber(stockValue?.value) / lastRate);
  const usdCashLocal = Math.round(toNumber(usdBalance) / lastRate);

  return (
    <article
      className={`rounded-2xl border p-4 shadow-sm ${
        isSelected
          ? "border-blue-300 bg-blue-50/80"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start gap-3">
        {selectionEnabled ? (
          <label className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50">
            <Checkbox checked={isSelected} onChange={onToggle} />
            <span className="sr-only">{student.name} 선택</span>
          </label>
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-blue-600">
            번호 {student.studentNumber || "-"}
          </p>
          <h3 className="truncate text-base font-black text-slate-900">
            {student.name}
          </h3>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] font-bold text-slate-400">총 순자산</p>
          <p className="text-base font-black text-slate-900">
            {formatClassCurrency(totalNetWorth)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MobileAssetMetric
          label="현금"
          value={formatClassCurrency(cash)}
          tone="emerald"
        />
        <MobileAssetMetric
          label="예금"
          value={formatClassCurrency(deposit)}
          tone="blue"
          onClick={
            canOpenBank ? () => onOpenBank?.(student, "savings") : undefined
          }
        />
        <MobileAssetMetric
          label="대출"
          value={formatClassCurrency(loan)}
          tone="rose"
          onClick={
            canOpenBank ? () => onOpenBank?.(student, "loans") : undefined
          }
        />
        <MobileAssetMetric
          label="주식"
          value={formatClassCurrency(stockValueLocal)}
          tone="amber"
          onClick={
            canOpenPortfolio ? () => onOpenPortfolio?.(student) : undefined
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          kind="soft"
          tone="slate"
          size="sm"
          icon={ListChecks}
          className="flex-1"
          disabled={!canOpenActivityLog}
          onClick={() => onOpenActivityLog?.(student)}
        >
          활동 내역
        </Button>
        <Button
          type="button"
          kind="outline"
          tone="slate"
          size="sm"
          className="flex-1"
          disabled={!canOpenInventory}
          onClick={() => onOpenInventory?.(student)}
        >
          보유 아이템 {formatClassCurrency(itemValue)}
        </Button>
      </div>

      <details className="mt-3 rounded-xl border border-slate-200 bg-white">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm font-bold text-slate-600">
          상세 자산과 기록
        </summary>
        <div className="border-t border-slate-100 p-3">
          <div className="grid grid-cols-2 gap-2">
            <MobileAssetMetric
              label={missionTokenLabel}
              value={formatClassCurrency(missionToken)}
              tone="blue"
            />
            <MobileAssetMetric
              label="외화"
              value={formatClassCurrency(usdCashLocal)}
              tone="blue"
            />
            <MobileAssetMetric
              label="부동산"
              value={formatClassCurrency(realEstateValue)}
              tone="amber"
            />
            <MobileAssetMetric
              label="신용 점수"
              value={
                student.creditScore === undefined ||
                student.creditScore === null
                  ? "-"
                  : student.creditScore
              }
              tone="slate"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              kind="outline"
              tone="slate"
              size="sm"
              disabled={!canOpenLog}
              onClick={() => onOpenLog?.(student)}
              className="justify-center"
            >
              신용 기록
            </Button>
            <Button
              type="button"
              kind="outline"
              tone="slate"
              size="sm"
              disabled={!canOpenMissionTokenHistory}
              onClick={() => onOpenMissionTokenHistory?.(student)}
              className="justify-center"
            >
              토큰 기록
            </Button>
          </div>
        </div>
      </details>
    </article>
  );
};

const StudentAssetTable = (props) => {
  const { missionTokenLabel } = useUser();
  const {
    classId,
    onVisibleColumnsChange,
    readOnly,
    selectionEnabled = !readOnly,
    canCustomizeColumns = !readOnly,
    canOpenLog = !readOnly,
    canOpenActivityLog = !readOnly,
    canOpenMissionTokenHistory = !readOnly,
    canOpenBank = !readOnly,
    canOpenPortfolio = !readOnly,
    canOpenInventory = !readOnly,
  } = props;
  const [sortConfig, setSortConfig] = useState({
    key: "studentNumber",
    direction: "asc",
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() =>
    loadVisibleColumns(classId)
  );
  const optionalColumnConfig = useMemo(
    () =>
      OPTIONAL_COLUMN_CONFIG.map((column) =>
        column.key === "missionToken"
          ? { ...column, label: missionTokenLabel }
          : column,
      ),
    [missionTokenLabel],
  );

  useEffect(() => {
    setVisibleColumns(loadVisibleColumns(classId));
  }, [classId]);

  useEffect(() => {
    if (!canCustomizeColumns) return;
    saveVisibleColumns(classId, visibleColumns);
  }, [canCustomizeColumns, classId, visibleColumns]);

  useEffect(() => {
    onVisibleColumnsChange?.(visibleColumns);
  }, [onVisibleColumnsChange, visibleColumns]);

  const isColumnVisible = (key) => visibleColumns[key] !== false;
  const visibleColumnCount = useMemo(() => {
    const baseColumns = 3;
    const selectionColumn = selectionEnabled ? 1 : 0;
    const optionalColumns = OPTIONAL_COLUMN_CONFIG.filter(
      (column) => visibleColumns[column.key] !== false,
    ).length;

    return baseColumns + selectionColumn + optionalColumns;
  }, [selectionEnabled, visibleColumns]);

  useEffect(() => {
    const isSortKeyVisible =
      !SORTABLE_OPTIONAL_COLUMNS.has(sortConfig.key) ||
      visibleColumns[sortConfig.key] !== false;

    if (!isSortKeyVisible) {
      setSortConfig({ key: "studentNumber", direction: "asc" });
    }
  }, [sortConfig.key, visibleColumns]);

  const sortedStudents = useMemo(() => {
    const items = [...props.students];
    if (!sortConfig.key) return items;

    items.sort((a, b) => {
      let aVal;
      let bVal;

      if (sortConfig.key === "name") {
        aVal = String(a.name || "");
        bVal = String(b.name || "");
      } else if (
        [
          "cash",
          "deposit",
          "loan",
          "itemValue",
          "realEstateValue",
          "totalNetWorth",
          "missionToken",
        ].includes(sortConfig.key)
      ) {
        if (sortConfig.key === "missionToken") {
          aVal = toNumber(a.assets?.missionToken ?? a.assets?.token ?? 0);
          bVal = toNumber(b.assets?.missionToken ?? b.assets?.token ?? 0);
        } else {
          aVal = toNumber(a.assets?.[sortConfig.key]);
          bVal = toNumber(b.assets?.[sortConfig.key]);
        }
      } else {
        aVal = toNumber(a[sortConfig.key]);
        bVal = toNumber(b[sortConfig.key]);
      }

      if (aVal === bVal) return 0;
      return sortConfig.direction === "asc"
        ? aVal > bVal
          ? 1
          : -1
        : aVal < bVal
        ? 1
        : -1;
    });

    return items;
  }, [props.students, sortConfig]);

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ k }) => (
    <ArrowUpDown
      className={`inline ml-1 h-3 w-3 ${
        sortConfig.key === k ? "text-blue-600" : "text-slate-300"
      }`}
    />
  );

  const toggleColumn = (key) => {
    if (!canCustomizeColumns) return;
    setVisibleColumns((prev) => ({ ...prev, [key]: !isColumnVisible(key) }));
  };

  const resetColumns = () => {
    if (!canCustomizeColumns) return;
    setVisibleColumns({ ...DEFAULT_VISIBLE_COLUMNS });
  };

  const showMinimalColumns = () => {
    if (!canCustomizeColumns) return;
    const minimal = optionalColumnConfig.reduce(
      (acc, col) => ({ ...acc, [col.key]: false }),
      {}
    );
    minimal.cash = true;
    minimal.totalNetWorth = true;
    setVisibleColumns(minimal);
  };

  return (
    <div>
      {canCustomizeColumns && (
        <div className="mb-3 hidden justify-end md:flex">
          <div className="relative">
            <Button
              kind="outline"
              tone="slate"
              size="sm"
              icon={SlidersHorizontal}
              onClick={() => setShowColumnMenu((v) => !v)}
            >
              컬럼 설정
            </Button>

            {showColumnMenu && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white shadow-xl z-20 p-3">
                <div className="text-xs font-semibold text-slate-500 mb-2">
                  표시할 컬럼 선택
                </div>
                <div className="space-y-2">
                  {optionalColumnConfig.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center justify-between gap-2 text-sm text-slate-700"
                    >
                      <span>{col.label}</span>
                      <Checkbox
                        checked={isColumnVisible(col.key)}
                        onChange={() => toggleColumn(col.key)}
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    kind="outline"
                    tone="slate"
                    size="xs"
                    onClick={showMinimalColumns}
                  >
                    최소 컬럼
                  </Button>
                  <Button
                    kind="outline"
                    tone="blue"
                    size="xs"
                    onClick={resetColumns}
                  >
                    전체 복원
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:hidden">
        {sortedStudents.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white py-12">
            <EmptyState
              icon={ListChecks}
              title="표시할 학생 자산 정보가 없습니다"
              description="학생 계정을 등록하면 자산 현황을 확인할 수 있습니다."
            />
          </div>
        ) : (
          sortedStudents.map((student) => (
            <MobileAssetCard
              key={student.uid}
              student={student}
              selectionEnabled={selectionEnabled}
              canOpenLog={canOpenLog}
              canOpenActivityLog={canOpenActivityLog}
              canOpenMissionTokenHistory={canOpenMissionTokenHistory}
              canOpenBank={canOpenBank}
              canOpenInventory={canOpenInventory}
              canOpenPortfolio={canOpenPortfolio}
              isSelected={props.selectedUids.includes(student.uid)}
              onToggle={() => props.onToggleSelection(student.uid)}
              onOpenLog={props.onOpenLog}
              onOpenActivityLog={props.onOpenActivityLog}
              onOpenMissionTokenHistory={props.onOpenMissionTokenHistory}
              onOpenBank={props.onOpenBank}
              onOpenInventory={props.onOpenInventory}
              onOpenPortfolio={props.onOpenPortfolio}
            />
          ))
        )}
      </div>

      <div className="hidden md:block">
        <DataTable>
          <DataTable.Header>
            <DataTable.Row interactive={false}>
              {selectionEnabled && (
                <DataTable.HeadCell align="center" className="w-12 p-4">
                  <Checkbox
                    checked={
                      props.selectedUids.length === props.students.length &&
                      props.students.length > 0
                    }
                    onChange={props.onSelectAll}
                    indeterminate={
                      props.selectedUids.length > 0 &&
                      props.selectedUids.length < props.students.length
                    }
                  />
                </DataTable.HeadCell>
              )}

              <DataTable.HeadCell
                className="cursor-pointer p-4"
                onClick={() => requestSort("studentNumber")}
              >
                학번 <SortIcon k="studentNumber" />
              </DataTable.HeadCell>
              <DataTable.HeadCell
                className="cursor-pointer p-4"
                onClick={() => requestSort("name")}
              >
                이름 <SortIcon k="name" />
              </DataTable.HeadCell>
              {isColumnVisible("creditScore") && (
                <DataTable.HeadCell
                  align="center"
                  className="cursor-pointer p-4"
                  onClick={() => requestSort("creditScore")}
                >
                  신용 <SortIcon k="creditScore" />
                </DataTable.HeadCell>
              )}

              {isColumnVisible("missionToken") && (
                <DataTable.HeadCell
                  align="right"
                  className="cursor-pointer p-4 text-blue-600"
                  onClick={() => requestSort("missionToken")}
                >
                  {missionTokenLabel} <SortIcon k="missionToken" />
                </DataTable.HeadCell>
              )}

              {isColumnVisible("cash") && (
                <DataTable.HeadCell
                  align="right"
                  className="cursor-pointer p-4"
                  onClick={() => requestSort("cash")}
                >
                  현금 <SortIcon k="cash" />
                </DataTable.HeadCell>
              )}

              {isColumnVisible("deposit") && (
                <DataTable.HeadCell
                  align="right"
                  className="cursor-pointer p-4 text-blue-600"
                  onClick={() => requestSort("deposit")}
                >
                  예금 <SortIcon k="deposit" />
                </DataTable.HeadCell>
              )}

              {isColumnVisible("loan") && (
                <DataTable.HeadCell
                  align="right"
                  className="cursor-pointer p-4 text-rose-600"
                  onClick={() => requestSort("loan")}
                >
                  대출 <SortIcon k="loan" />
                </DataTable.HeadCell>
              )}

              {isColumnVisible("itemValue") && (
                <DataTable.HeadCell
                  align="right"
                  className="cursor-pointer p-4 text-slate-600"
                  onClick={() => requestSort("itemValue")}
                >
                  아이템 <SortIcon k="itemValue" />
                </DataTable.HeadCell>
              )}

              {isColumnVisible("stockValue") && (
                <DataTable.HeadCell align="right" className="p-4 text-amber-600">주식</DataTable.HeadCell>
              )}

              {isColumnVisible("usdCash") && (
                <DataTable.HeadCell align="right" className="p-4 text-blue-500">외화</DataTable.HeadCell>
              )}

              {isColumnVisible("realEstateValue") && (
                <DataTable.HeadCell
                  align="right"
                  className="cursor-pointer p-4 text-amber-600"
                  onClick={() => requestSort("realEstateValue")}
                >
                  부동산 <SortIcon k="realEstateValue" />
                </DataTable.HeadCell>
              )}

              {isColumnVisible("totalNetWorth") && (
                <DataTable.HeadCell
                  align="right"
                  className="cursor-pointer p-4 text-slate-900"
                  onClick={() => requestSort("totalNetWorth")}
                >
                  순자산 <SortIcon k="totalNetWorth" />
                </DataTable.HeadCell>
              )}
              <DataTable.HeadCell align="center" className="w-16 p-4">
                활동
              </DataTable.HeadCell>

            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {sortedStudents.length === 0 ? (
              <DataTable.Empty colSpan={visibleColumnCount} className="py-14">
                <EmptyState
                  icon={ListChecks}
                  title="표시할 학생 자산 정보가 없습니다"
                  description="학생 계정이 등록되면 자산 현황을 확인할 수 있습니다."
                />
              </DataTable.Empty>
            ) : (
              sortedStudents.map((s) => (
              <AssetRow
                key={s.uid}
                student={s}
                selectionEnabled={selectionEnabled}
                canOpenLog={canOpenLog}
                canOpenActivityLog={canOpenActivityLog}
                canOpenMissionTokenHistory={canOpenMissionTokenHistory}
                canOpenBank={canOpenBank}
                canOpenPortfolio={canOpenPortfolio}
                canOpenInventory={canOpenInventory}
                isColumnVisible={isColumnVisible}
                isSelected={props.selectedUids.includes(s.uid)}
                onToggle={() => props.onToggleSelection(s.uid)}
                onOpenLog={props.onOpenLog}
                onOpenActivityLog={props.onOpenActivityLog}
                onOpenMissionTokenHistory={props.onOpenMissionTokenHistory}
                onOpenBank={props.onOpenBank}
                onOpenPortfolio={props.onOpenPortfolio}
                onOpenInventory={props.onOpenInventory}
                onSelectionMouseDown={props.onSelectionMouseDown}
                onSelectionMouseEnter={props.onSelectionMouseEnter}
              />
            ))
            )}
          </DataTable.Body>
        </DataTable>
      </div>
    </div>
  );
};

export default StudentAssetTable;
