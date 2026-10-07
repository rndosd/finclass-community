import { SHEET_LAYOUT_OPTIONS } from "../../../constants/financeExportConfig";

const STORAGE_PREFIX = "admin.finance.exportPreferences.v1";
const PRESET_STORAGE_PREFIX = "admin.finance.exportPresets.v1";
const MAX_PRESET_COUNT = 12;
const MAX_PRESET_NAME_LENGTH = 40;
const ALLOWED_SHEET_LAYOUTS = new Set(
  SHEET_LAYOUT_OPTIONS.map((option) => option.value),
);

export const FINANCE_EXPORT_SELECTION_FIELDS = [
  "selectedColumns",
  "selectedCategories",
  "selectedRecordTypes",
];

const getStorageKey = (classId, mode) =>
  `${STORAGE_PREFIX}:${encodeURIComponent(classId || "default")}:${encodeURIComponent(
    mode || "asset",
  )}`;

const getPresetStorageKey = (classId, mode) =>
  `${PRESET_STORAGE_PREFIX}:${encodeURIComponent(
    classId || "default",
  )}:${encodeURIComponent(mode || "asset")}`;

const toUniqueStringList = (value) => {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(value.filter((item) => typeof item === "string" && item.length > 0)),
  );
};

const sanitizeSelection = (value, allowedKeys, fallback) => {
  const allowedKeySet = new Set(toUniqueStringList(allowedKeys));
  const source = Array.isArray(value) ? value : fallback;

  return toUniqueStringList(source).filter((key) => allowedKeySet.has(key));
};

const sanitizeSheetLayout = (value, fallback = "singleSheet") => {
  if (ALLOWED_SHEET_LAYOUTS.has(value)) return value;
  if (ALLOWED_SHEET_LAYOUTS.has(fallback)) return fallback;
  return "singleSheet";
};

const sanitizePresetName = (value) =>
  String(value || "").trim().slice(0, MAX_PRESET_NAME_LENGTH);

const createPresetId = () =>
  `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const readStoredPreferences = (classId, mode) => {
  if (typeof window === "undefined") return {};

  try {
    const rawValue = window.localStorage.getItem(getStorageKey(classId, mode));
    if (!rawValue) return {};

    const parsedValue = JSON.parse(rawValue);
    return parsedValue && typeof parsedValue === "object" ? parsedValue : {};
  } catch (error) {
    console.warn("Failed to load finance export preferences:", error);
    return {};
  }
};

export const loadFinanceExportPreferences = ({
  classId,
  mode,
  availableSelections = {},
  defaultSelections = {},
}) => {
  const storedPreferences = readStoredPreferences(classId, mode);

  const preferences = FINANCE_EXPORT_SELECTION_FIELDS.reduce((result, field) => {
    result[field] = sanitizeSelection(
      storedPreferences[field],
      availableSelections[field],
      defaultSelections[field],
    );
    return result;
  }, {});

  preferences.sheetLayout = sanitizeSheetLayout(
    storedPreferences.sheetLayout,
    defaultSelections.sheetLayout,
  );

  return preferences;
};

export const saveFinanceExportPreference = ({
  classId,
  mode,
  field,
  selectedKeys,
}) => {
  if (
    typeof window === "undefined" ||
    !FINANCE_EXPORT_SELECTION_FIELDS.includes(field)
  ) {
    return;
  }

  try {
    const storedPreferences = readStoredPreferences(classId, mode);
    window.localStorage.setItem(
      getStorageKey(classId, mode),
      JSON.stringify({
        ...storedPreferences,
        [field]: toUniqueStringList(selectedKeys),
      }),
    );
  } catch (error) {
    console.warn("Failed to save finance export preferences:", error);
  }
};

export const saveFinanceExportSheetLayout = ({ classId, mode, sheetLayout }) => {
  if (typeof window === "undefined") return;

  try {
    const storedPreferences = readStoredPreferences(classId, mode);
    window.localStorage.setItem(
      getStorageKey(classId, mode),
      JSON.stringify({
        ...storedPreferences,
        sheetLayout: sanitizeSheetLayout(sheetLayout),
      }),
    );
  } catch (error) {
    console.warn("Failed to save finance export sheet layout:", error);
  }
};

const sanitizePreset = (
  preset,
  { availableSelections = {}, defaultSelections = {} } = {},
) => {
  if (!preset || typeof preset !== "object") return null;

  const id = typeof preset.id === "string" ? preset.id.trim() : "";
  const name = sanitizePresetName(preset.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    selectedColumns: sanitizeSelection(
      preset.selectedColumns,
      availableSelections.selectedColumns,
      defaultSelections.selectedColumns,
    ),
    selectedCategories: sanitizeSelection(
      preset.selectedCategories,
      availableSelections.selectedCategories,
      defaultSelections.selectedCategories,
    ),
    selectedRecordTypes: sanitizeSelection(
      preset.selectedRecordTypes,
      availableSelections.selectedRecordTypes,
      defaultSelections.selectedRecordTypes,
    ),
    sheetLayout: sanitizeSheetLayout(
      preset.sheetLayout,
      defaultSelections.sheetLayout,
    ),
    updatedAt:
      typeof preset.updatedAt === "string"
        ? preset.updatedAt
        : new Date().toISOString(),
  };
};

export const loadFinanceExportPresets = ({
  classId,
  mode,
  availableSelections = {},
  defaultSelections = {},
}) => {
  if (typeof window === "undefined") return [];

  try {
    const rawValue = window.localStorage.getItem(
      getPresetStorageKey(classId, mode),
    );
    if (!rawValue) return [];

    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return [];

    const seenIds = new Set();
    return parsedValue
      .map((preset) =>
        sanitizePreset(preset, { availableSelections, defaultSelections }),
      )
      .filter((preset) => {
        if (!preset || seenIds.has(preset.id)) return false;
        seenIds.add(preset.id);
        return true;
      })
      .slice(0, MAX_PRESET_COUNT);
  } catch (error) {
    console.warn("Failed to load finance export presets:", error);
    return [];
  }
};

const writeFinanceExportPresets = (classId, mode, presets) => {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    getPresetStorageKey(classId, mode),
    JSON.stringify(presets.slice(0, MAX_PRESET_COUNT)),
  );
};

export const saveFinanceExportPreset = ({
  classId,
  mode,
  preset,
  availableSelections = {},
  defaultSelections = {},
}) => {
  if (typeof window === "undefined") return { presets: [], preset: null };

  const nextPreset = sanitizePreset(
    {
      ...preset,
      id: preset?.id || createPresetId(),
      name: sanitizePresetName(preset?.name),
      updatedAt: new Date().toISOString(),
    },
    { availableSelections, defaultSelections },
  );

  if (!nextPreset) return { presets: [], preset: null };

  try {
    const currentPresets = loadFinanceExportPresets({
      classId,
      mode,
      availableSelections,
      defaultSelections,
    });
    const existingIndex = currentPresets.findIndex(
      (item) => item.id === nextPreset.id,
    );
    const nextPresets = [...currentPresets];

    if (existingIndex >= 0) {
      nextPresets[existingIndex] = nextPreset;
    } else if (nextPresets.length < MAX_PRESET_COUNT) {
      nextPresets.push(nextPreset);
    } else {
      return { presets: currentPresets, preset: null };
    }

    writeFinanceExportPresets(classId, mode, nextPresets);
    return { presets: nextPresets, preset: nextPreset };
  } catch (error) {
    console.warn("Failed to save finance export preset:", error);
    return { presets: [], preset: null };
  }
};

export const deleteFinanceExportPreset = ({
  classId,
  mode,
  presetId,
  availableSelections = {},
  defaultSelections = {},
}) => {
  if (typeof window === "undefined") return [];

  try {
    const nextPresets = loadFinanceExportPresets({
      classId,
      mode,
      availableSelections,
      defaultSelections,
    }).filter((preset) => preset.id !== presetId);
    writeFinanceExportPresets(classId, mode, nextPresets);
    return nextPresets;
  } catch (error) {
    console.warn("Failed to delete finance export preset:", error);
    return [];
  }
};
