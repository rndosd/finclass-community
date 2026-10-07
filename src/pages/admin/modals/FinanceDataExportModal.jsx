import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  Bookmark,
  CalendarDays,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Layers3,
  ListFilter,
  Save,
  Settings2,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";

import { Button, Checkbox, Modal, RadioGroup } from "../../../components/ui";
import {
  ACTIVITY_CATEGORY_OPTIONS,
  CREDIT_RECORD_TYPE_OPTIONS,
  SHEET_LAYOUT_OPTIONS,
} from "../../../constants/financeExportConfig";
import {
  deleteFinanceExportPreset,
  loadFinanceExportPreferences,
  loadFinanceExportPresets,
  saveFinanceExportPreference,
  saveFinanceExportPreset,
  saveFinanceExportSheetLayout,
} from "../utils/financeExportPreferences";

const MODE_META = {
  asset: {
    title: "자산 엑셀 내보내기",
    description: "학급 자산 수치를 선택해서 현재 기준으로 내려받습니다.",
    icon: Wallet,
    supportsDateRange: false,
    supportsCategories: false,
    supportsRecordTypes: false,
    columnTitle: "포함할 자산 수치",
    columnHint: "학번과 이름은 항상 포함됩니다.",
  },
  activity: {
    title: "활동 로그 내보내기",
    description: "기간, 카테고리, 열을 골라 활동 로그를 엑셀로 내보냅니다.",
    icon: FileSpreadsheet,
    supportsDateRange: true,
    supportsCategories: true,
    supportsRecordTypes: false,
    columnTitle: "포함할 컬럼",
    columnHint: "",
  },
  credit: {
    title: "신용 로그 내보내기",
    description: "신용 변동 로그와 점수 이력을 원하는 방식으로 내려받습니다.",
    icon: ShieldCheck,
    supportsDateRange: true,
    supportsCategories: false,
    supportsRecordTypes: true,
    columnTitle: "",
    columnHint: "",
  },
};

const DATE_RANGE_OPTIONS = [
  { value: "allTime", label: "전체 기간" },
  { value: "last7Days", label: "최근 7일" },
  { value: "last30Days", label: "최근 30일" },
  { value: "custom", label: "직접 선택" },
];

function ExportSection({
  icon: Icon,
  title,
  description,
  summary,
  children,
  className = "",
}) {
  return (
    <section className={`py-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800">{title}</h3>
            {description ? (
              <p className="mt-0.5 text-xs leading-4 text-slate-500">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {summary ? (
          <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">
            {summary}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function CheckboxOption({ checked, children }) {
  return (
    <div
      className={`rounded-lg px-2.5 py-2 transition-colors ${
        checked
          ? "bg-blue-50/80"
          : "bg-white hover:bg-slate-50"
      }`}
    >
      {children}
    </div>
  );
}

function selectionsMatch(left = [], right = []) {
  return (
    left.length === right.length &&
    left.every((item) => right.includes(item))
  );
}

export default function FinanceDataExportModal({
  isOpen,
  onClose,
  mode,
  classId,
  allStudents = [],
  selectedStudents = [],
  availableColumns = [],
  defaultSelectedColumns = [],
  onExport,
  isLoadingExport = false,
}) {
  const meta = MODE_META[mode] || MODE_META.asset;
  const Icon = meta.icon;
  const supportsDateRange = meta.supportsDateRange;
  const supportsCategories = meta.supportsCategories;
  const supportsRecordTypes = meta.supportsRecordTypes;
  const showColumnSelector = availableColumns.length > 0;
  const allCategoryKeys = useMemo(
    () => ACTIVITY_CATEGORY_OPTIONS.map((category) => category.key),
    [],
  );
  const allRecordTypeKeys = useMemo(
    () => CREDIT_RECORD_TYPE_OPTIONS.map((item) => item.key),
    [],
  );
  const availableColumnKeySignature = availableColumns
    .map((column) => column.key)
    .join("|");
  const defaultColumnKeySignature = defaultSelectedColumns.join("|");
  const availableColumnKeys = useMemo(
    () => availableColumnKeySignature.split("|").filter(Boolean),
    [availableColumnKeySignature],
  );
  const stableDefaultSelectedColumns = useMemo(
    () => defaultColumnKeySignature.split("|").filter(Boolean),
    [defaultColumnKeySignature],
  );
  const availableSelections = useMemo(
    () => ({
      selectedColumns: availableColumnKeys,
      selectedCategories: allCategoryKeys,
      selectedRecordTypes: allRecordTypeKeys,
    }),
    [allCategoryKeys, allRecordTypeKeys, availableColumnKeys],
  );
  const defaultSelections = useMemo(
    () => ({
      selectedColumns: stableDefaultSelectedColumns,
      selectedCategories: allCategoryKeys,
      selectedRecordTypes:
        mode === "credit" ? ["creditLogs"] : allRecordTypeKeys,
      sheetLayout: "singleSheet",
    }),
    [
      allCategoryKeys,
      allRecordTypeKeys,
      mode,
      stableDefaultSelectedColumns,
    ],
  );

  const [dataScope, setDataScope] = useState("allStudents");
  const [sheetLayout, setSheetLayout] = useState("singleSheet");
  const [dateRangeType, setDateRangeType] = useState("allTime");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [selectedColumns, setSelectedColumns] = useState(defaultSelectedColumns);
  const [selectedCategories, setSelectedCategories] = useState(allCategoryKeys);
  const [selectedRecordTypes, setSelectedRecordTypes] = useState(["creditLogs"]);
  const [savedPresets, setSavedPresets] = useState([]);
  const [activePresetId, setActivePresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetFeedback, setPresetFeedback] = useState("");
  const [isPresetManagerOpen, setIsPresetManagerOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const savedPreferences = loadFinanceExportPreferences({
      classId,
      mode,
      availableSelections,
      defaultSelections,
    });
    const storedPresets = loadFinanceExportPresets({
      classId,
      mode,
      availableSelections,
      defaultSelections,
    });

    setDataScope("allStudents");
    setSheetLayout(savedPreferences.sheetLayout);
    setDateRangeType("allTime");
    setCustomStartDate("");
    setCustomEndDate("");
    setSelectedColumns(savedPreferences.selectedColumns);
    setSelectedCategories(savedPreferences.selectedCategories);
    setSelectedRecordTypes(savedPreferences.selectedRecordTypes);
    setSavedPresets(storedPresets);
    setActivePresetId("");
    setPresetName("");
    setPresetFeedback("");
    setIsPresetManagerOpen(false);
  }, [
    availableSelections,
    classId,
    defaultSelections,
    isOpen,
    mode,
  ]);

  const persistSelection = (field, selectedKeys) => {
    saveFinanceExportPreference({
      classId,
      mode,
      field,
      selectedKeys,
    });
  };

  const handleColumnToggle = (key) => {
    setPresetFeedback("");
    setSelectedColumns((prev) => {
      const next = prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key];
      persistSelection("selectedColumns", next);
      return next;
    });
  };

  const handleCategoryToggle = (key) => {
    setPresetFeedback("");
    setSelectedCategories((prev) => {
      const next = prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key];
      persistSelection("selectedCategories", next);
      return next;
    });
  };

  const handleRecordTypeToggle = (key) => {
    setPresetFeedback("");
    setSelectedRecordTypes((prev) => {
      const next = prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key];
      persistSelection("selectedRecordTypes", next);
      return next;
    });
  };

  const handleSelectAllCategories = (event) => {
    setPresetFeedback("");
    const next = event.target.checked ? allCategoryKeys : [];
    setSelectedCategories(next);
    persistSelection("selectedCategories", next);
  };

  const handleSelectAllColumns = (event) => {
    setPresetFeedback("");
    const next = event.target.checked ? availableColumnKeys : [];
    setSelectedColumns(next);
    persistSelection("selectedColumns", next);
  };

  const handleSelectAllRecordTypes = (event) => {
    setPresetFeedback("");
    const next = event.target.checked ? allRecordTypeKeys : [];
    setSelectedRecordTypes(next);
    persistSelection("selectedRecordTypes", next);
  };

  const handleSheetLayoutChange = (nextSheetLayout) => {
    setPresetFeedback("");
    setSheetLayout(nextSheetLayout);
    saveFinanceExportSheetLayout({
      classId,
      mode,
      sheetLayout: nextSheetLayout,
    });
  };

  const getCurrentPresetValues = () => ({
    selectedColumns,
    selectedCategories,
    selectedRecordTypes,
    sheetLayout,
  });

  const applyPreset = (preset) => {
    if (!preset) return;

    setSelectedColumns(preset.selectedColumns);
    setSelectedCategories(preset.selectedCategories);
    setSelectedRecordTypes(preset.selectedRecordTypes);
    setSheetLayout(preset.sheetLayout);
    saveFinanceExportPreference({
      classId,
      mode,
      field: "selectedColumns",
      selectedKeys: preset.selectedColumns,
    });
    saveFinanceExportPreference({
      classId,
      mode,
      field: "selectedCategories",
      selectedKeys: preset.selectedCategories,
    });
    saveFinanceExportPreference({
      classId,
      mode,
      field: "selectedRecordTypes",
      selectedKeys: preset.selectedRecordTypes,
    });
    saveFinanceExportSheetLayout({
      classId,
      mode,
      sheetLayout: preset.sheetLayout,
    });
  };

  const handlePresetChange = (event) => {
    const nextPresetId = event.target.value;
    setActivePresetId(nextPresetId);
    setPresetFeedback("");

    const preset = savedPresets.find((item) => item.id === nextPresetId);
    if (preset) {
      applyPreset(preset);
      setPresetFeedback(`‘${preset.name}’ 구성을 불러왔습니다.`);
    }
  };

  const handleSaveNewPreset = () => {
    const normalizedName = presetName.trim();
    if (!normalizedName) {
      setPresetFeedback("저장할 구성 이름을 입력해주세요.");
      return;
    }

    if (savedPresets.some((preset) => preset.name === normalizedName)) {
      setPresetFeedback("같은 이름의 구성이 있습니다. 선택한 뒤 업데이트해주세요.");
      return;
    }

    const result = saveFinanceExportPreset({
      classId,
      mode,
      preset: {
        name: normalizedName,
        ...getCurrentPresetValues(),
      },
      availableSelections,
      defaultSelections,
    });

    if (!result.preset) {
      setPresetFeedback("구성은 최대 12개까지 저장할 수 있습니다.");
      return;
    }

    setSavedPresets(result.presets);
    setActivePresetId(result.preset.id);
    setPresetName("");
    setPresetFeedback(`‘${result.preset.name}’ 구성을 저장했습니다.`);
    setIsPresetManagerOpen(false);
  };

  const handleUpdatePreset = () => {
    const activePreset = savedPresets.find(
      (preset) => preset.id === activePresetId,
    );
    if (!activePreset) return;

    const result = saveFinanceExportPreset({
      classId,
      mode,
      preset: {
        ...activePreset,
        ...getCurrentPresetValues(),
      },
      availableSelections,
      defaultSelections,
    });

    if (!result.preset) {
      setPresetFeedback("구성을 업데이트하지 못했습니다.");
      return;
    }

    setSavedPresets(result.presets);
    setPresetFeedback(`‘${result.preset.name}’ 구성을 업데이트했습니다.`);
    setIsPresetManagerOpen(false);
  };

  const handleDeletePreset = () => {
    const activePreset = savedPresets.find(
      (preset) => preset.id === activePresetId,
    );
    if (!activePreset) return;

    const nextPresets = deleteFinanceExportPreset({
      classId,
      mode,
      presetId: activePreset.id,
      availableSelections,
      defaultSelections,
    });
    setSavedPresets(nextPresets);
    setActivePresetId("");
    setPresetFeedback(`‘${activePreset.name}’ 구성을 삭제했습니다.`);
    setIsPresetManagerOpen(false);
  };

  const customDateRangeIsReversed =
    dateRangeType === "custom" &&
    customStartDate &&
    customEndDate &&
    dayjs(customStartDate).isAfter(dayjs(customEndDate), "day");

  const periodPreview = (() => {
    if (!supportsDateRange || dateRangeType === "allTime") return "전체 기간";
    if (dateRangeType === "last7Days") {
      return `${dayjs().subtract(6, "day").format("YYYY.MM.DD")} ~ ${dayjs().format("YYYY.MM.DD")}`;
    }
    if (dateRangeType === "last30Days") {
      return `${dayjs().subtract(29, "day").format("YYYY.MM.DD")} ~ ${dayjs().format("YYYY.MM.DD")}`;
    }
    if (customStartDate && customEndDate && !customDateRangeIsReversed) {
      return `${dayjs(customStartDate).format("YYYY.MM.DD")} ~ ${dayjs(customEndDate).format("YYYY.MM.DD")}`;
    }
    return "시작일과 종료일을 선택해주세요.";
  })();

  const handleExportClick = () => {
    const studentsToExport =
      dataScope === "selectedStudents" ? selectedStudents : allStudents;

    if (studentsToExport.length === 0) return;
    if (customDateRangeIsReversed) return;

    let startDate = null;
    let endDate = null;

    if (supportsDateRange) {
      if (dateRangeType === "last7Days") {
        startDate = dayjs().subtract(6, "day").format("YYYY-MM-DD");
        endDate = dayjs().format("YYYY-MM-DD");
      } else if (dateRangeType === "last30Days") {
        startDate = dayjs().subtract(29, "day").format("YYYY-MM-DD");
        endDate = dayjs().format("YYYY-MM-DD");
      } else if (dateRangeType === "custom") {
        startDate = customStartDate;
        endDate = customEndDate;
      }
    }

    onExport?.({
      mode,
      studentInfo: studentsToExport.map((student) => ({
        uid: student.uid,
        name: student.name,
      })),
      sheetLayout,
      startDate,
      endDate,
      selectedColumns,
      selectedCategories,
      selectedRecordTypes,
    });
  };

  const isExportDisabled =
    isLoadingExport ||
    (dataScope === "selectedStudents" && selectedStudents.length === 0) ||
    (showColumnSelector && selectedColumns.length === 0) ||
    (supportsCategories && selectedCategories.length === 0) ||
    (supportsRecordTypes && selectedRecordTypes.length === 0) ||
    (dateRangeType === "custom" && (!customStartDate || !customEndDate)) ||
    customDateRangeIsReversed;
  const targetStudentCount =
    dataScope === "selectedStudents" ? selectedStudents.length : allStudents.length;
  const selectedSheetLayoutLabel =
    SHEET_LAYOUT_OPTIONS.find((option) => option.value === sheetLayout)?.label ||
    "전체 1시트";
  const selectedDataCount = supportsRecordTypes
    ? selectedRecordTypes.length
    : selectedColumns.length;
  const selectedDataLabel = supportsRecordTypes ? "데이터" : "항목";
  const activePreset = savedPresets.find(
    (preset) => preset.id === activePresetId,
  );
  const activePresetIsDirty = Boolean(
    activePreset &&
      (!selectionsMatch(activePreset.selectedColumns, selectedColumns) ||
        !selectionsMatch(
          activePreset.selectedCategories,
          selectedCategories,
        ) ||
        !selectionsMatch(
          activePreset.selectedRecordTypes,
          selectedRecordTypes,
        ) ||
        activePreset.sheetLayout !== sheetLayout),
  );
  const persistenceStatus = (() => {
    if (presetFeedback) return presetFeedback;
    if (activePresetIsDirty) {
      return `최근 사용 설정에는 자동 저장됨 · ‘${activePreset.name}’ 구성에는 아직 미반영`;
    }
    if (activePreset) return `‘${activePreset.name}’ 구성과 동일합니다.`;
    return "포함 항목과 시트 방식은 최근 사용 설정에 자동 저장됩니다.";
  })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-100 p-2.5">
            <Icon className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold">{meta.title}</h2>
            <p className="text-sm text-slate-500">{meta.description}</p>
          </div>
        </div>
      }
      size="lg"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Bookmark className="h-4 w-4 shrink-0 text-slate-500" />
              <p className="truncate text-sm font-bold text-slate-800">
                내보내기 구성
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-500">
              체크 항목 + 시트 방식 저장
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor={`finance-export-preset-${mode}`}>
              저장된 구성
            </label>
            <select
              id={`finance-export-preset-${mode}`}
              value={activePresetId}
              onChange={handlePresetChange}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">최근 사용 설정</option>
              {savedPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            {activePresetIsDirty ? (
              <Button
                tone="blue"
                size="sm"
                icon={Save}
                className="shrink-0"
                onClick={handleUpdatePreset}
              >
                이 구성에 저장
              </Button>
            ) : null}
            <Button
              kind="outline"
              tone="slate"
              size="sm"
              icon={Settings2}
              className="shrink-0"
              onClick={() => setIsPresetManagerOpen((previous) => !previous)}
              aria-expanded={isPresetManagerOpen}
            >
              구성 관리
            </Button>
          </div>

          {isPresetManagerOpen ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <label
                  className="sr-only"
                  htmlFor={`finance-export-preset-name-${mode}`}
                >
                  새 구성 이름
                </label>
                <input
                  id={`finance-export-preset-name-${mode}`}
                  type="text"
                  value={presetName}
                  maxLength={40}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="새 구성 이름"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Button
                  kind="outline"
                  tone="blue"
                  size="sm"
                  icon={Save}
                  className="shrink-0"
                  onClick={handleSaveNewPreset}
                >
                  새 구성 저장
                </Button>
              </div>

              {activePresetId ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600">
                    ‘{activePreset?.name}’ 구성 관리
                  </p>
                  <Button
                    kind="ghost"
                    tone="rose"
                    size="sm"
                    icon={Trash2}
                    onClick={handleDeletePreset}
                  >
                    삭제
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div
            className={`mt-2 flex items-start gap-1.5 text-xs leading-5 ${
              activePresetIsDirty ? "text-amber-700" : "text-slate-500"
            }`}
            role="status"
          >
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{persistenceStatus}</span>
          </div>
        </div>

        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-4 sm:px-5">

        <div
          className={`grid ${
            supportsDateRange
              ? "divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0"
              : ""
          }`}
        >
          <ExportSection
            icon={Users}
            title="대상 학생"
            description={`전체 ${allStudents.length}명 중 내보낼 범위를 선택합니다.`}
            summary={`${targetStudentCount}명`}
            className={supportsDateRange ? "lg:pr-5" : ""}
          >
            <RadioGroup
              value={dataScope}
              onChange={setDataScope}
              className="!grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <RadioGroup.Radio
                value="allStudents"
                className={
                  dataScope === "allStudents"
                    ? "border-blue-200 bg-blue-50/70"
                    : "border-slate-200 bg-white"
                }
              >
                전체 학생
              </RadioGroup.Radio>
              <RadioGroup.Radio
                value="selectedStudents"
                disabled={selectedStudents.length === 0}
                className={
                  dataScope === "selectedStudents"
                    ? "border-blue-200 bg-blue-50/70"
                    : "border-slate-200 bg-white"
                }
              >
                선택 학생 ({selectedStudents.length}명)
              </RadioGroup.Radio>
            </RadioGroup>
          </ExportSection>

          {supportsDateRange ? (
            <ExportSection
              icon={CalendarDays}
              title="기간 선택"
              description="선택한 기간의 기록만 엑셀에 포함합니다."
              className="lg:pl-5"
            >
              <RadioGroup
                value={dateRangeType}
                onChange={setDateRangeType}
                className="!grid grid-cols-2 gap-2"
              >
                {DATE_RANGE_OPTIONS.map((option) => (
                  <RadioGroup.Radio
                    key={option.value}
                    value={option.value}
                    className={
                      dateRangeType === option.value
                        ? "border-blue-200 bg-blue-50/70"
                        : "border-slate-200 bg-white"
                    }
                  >
                    {option.label}
                  </RadioGroup.Radio>
                ))}
              </RadioGroup>

              {dateRangeType === "custom" ? (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-600">
                    시작일
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(event) => setCustomStartDate(event.target.value)}
                      className="mt-1 block min-h-11 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    종료일
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(event) => setCustomEndDate(event.target.value)}
                      className="mt-1 block min-h-11 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                </div>
              ) : null}
              <p
                className={`mt-2 text-xs leading-5 ${
                  customDateRangeIsReversed ? "text-rose-600" : "text-slate-500"
                }`}
                role={customDateRangeIsReversed ? "alert" : undefined}
              >
                {customDateRangeIsReversed
                  ? "시작일은 종료일보다 늦을 수 없습니다."
                  : `${periodPreview} · 시작일과 종료일을 모두 포함합니다.`}
              </p>
            </ExportSection>
          ) : null}
        </div>

        <div
          className={`grid ${
            supportsCategories && showColumnSelector
              ? "divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0"
              : ""
          }`}
        >
          {supportsCategories ? (
            <ExportSection
              icon={Tag}
              title="활동 로그 카테고리"
              description="필요한 경제 활동만 골라 내보냅니다."
              summary={`${selectedCategories.length}/${allCategoryKeys.length}`}
              className={showColumnSelector ? "lg:pr-5" : ""}
            >
              <div className="mb-3 border-b border-slate-100 pb-3">
                <Checkbox
                  id={`finance-${mode}-category-all`}
                  checked={selectedCategories.length === allCategoryKeys.length}
                  onChange={handleSelectAllCategories}
                  label="전체 선택"
                  labelClassName="font-semibold text-slate-700"
                />
              </div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {ACTIVITY_CATEGORY_OPTIONS.map((category) => {
                  const checked = selectedCategories.includes(category.key);
                  return (
                    <CheckboxOption key={category.key} checked={checked}>
                      <Checkbox
                        id={`finance-${mode}-category-${category.key}`}
                        checked={checked}
                        onChange={() => handleCategoryToggle(category.key)}
                        label={category.label}
                        className="w-full"
                        labelClassName="font-medium text-slate-700"
                      />
                    </CheckboxOption>
                  );
                })}
              </div>
            </ExportSection>
          ) : null}

          {supportsRecordTypes ? (
            <ExportSection
              icon={ShieldCheck}
              title="포함할 신용 데이터"
              description="변동 기록과 날짜별 점수 이력을 선택합니다."
              summary={`${selectedRecordTypes.length}개 선택`}
            >
              <div className="mb-3 border-b border-slate-100 pb-3">
                <Checkbox
                  id={`finance-${mode}-record-all`}
                  checked={
                    selectedRecordTypes.length === allRecordTypeKeys.length
                  }
                  onChange={handleSelectAllRecordTypes}
                  label="전체 선택"
                  labelClassName="font-semibold text-slate-700"
                />
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {CREDIT_RECORD_TYPE_OPTIONS.map((recordType) => {
                  const checked = selectedRecordTypes.includes(recordType.key);
                  return (
                    <CheckboxOption key={recordType.key} checked={checked}>
                      <Checkbox
                        id={`finance-${mode}-record-${recordType.key}`}
                        checked={checked}
                        onChange={() => handleRecordTypeToggle(recordType.key)}
                        label={recordType.label}
                        className="w-full"
                        labelClassName="font-medium text-slate-700"
                      />
                    </CheckboxOption>
                  );
                })}
              </div>
            </ExportSection>
          ) : null}

          {showColumnSelector ? (
            <ExportSection
              icon={ListFilter}
              title={meta.columnTitle}
              description={meta.columnHint || "엑셀에 표시할 컬럼을 선택합니다."}
              summary={`${selectedColumns.length}/${availableColumns.length}`}
              className={supportsCategories ? "lg:pl-5" : ""}
            >
              <div className="mb-3 border-b border-slate-100 pb-3">
                <Checkbox
                  id={`finance-${mode}-column-all`}
                  checked={selectedColumns.length === availableColumns.length}
                  onChange={handleSelectAllColumns}
                  label="전체 선택"
                  labelClassName="font-semibold text-slate-700"
                />
              </div>
              <div
                className={`grid grid-cols-2 gap-1 ${
                  supportsCategories ? "sm:grid-cols-2" : "sm:grid-cols-3"
                }`}
              >
                {availableColumns.map((column) => {
                  const checked = selectedColumns.includes(column.key);
                  return (
                    <CheckboxOption key={column.key} checked={checked}>
                      <Checkbox
                        id={`finance-${mode}-column-${column.key}`}
                        checked={checked}
                        onChange={() => handleColumnToggle(column.key)}
                        label={column.label}
                        className="w-full"
                        labelClassName="font-medium text-slate-700"
                      />
                    </CheckboxOption>
                  );
                })}
              </div>
            </ExportSection>
          ) : null}
        </div>

        <ExportSection
          icon={Layers3}
          title="시트 구성"
          description="엑셀 파일 안에서 학생 데이터를 나누는 방식입니다."
          summary={selectedSheetLayoutLabel}
        >
          <RadioGroup
            value={sheetLayout}
            onChange={handleSheetLayoutChange}
            className="!grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {SHEET_LAYOUT_OPTIONS.map((option) => (
              <RadioGroup.Radio
                key={option.value}
                value={option.value}
                description={option.description}
                className={
                  sheetLayout === option.value
                    ? "border-blue-200 bg-blue-50/70"
                    : "border-slate-200 bg-white"
                }
              >
                {option.label}
              </RadioGroup.Radio>
            ))}
          </RadioGroup>
        </ExportSection>
        </div>
      </div>

      <Modal.Footer className="!justify-between">
        <p className="mr-auto text-xs font-semibold text-slate-500">
          {targetStudentCount}명 · {selectedDataCount}개 {selectedDataLabel} · {selectedSheetLayoutLabel}
        </p>
        <Button kind="ghost" onClick={onClose} disabled={isLoadingExport}>
          취소
        </Button>
        <Button
          onClick={handleExportClick}
          disabled={isExportDisabled}
          icon={Download}
          isLoading={isLoadingExport}
        >
          엑셀 다운로드
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
