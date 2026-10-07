import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "../../firebase";
import {
  clampReportCycleDays,
  DEFAULT_REPORT_CYCLE_DAYS,
  normalizeReportCycle,
} from "../../pages/funds/utils/reportCycle";
import {
  DEFAULT_STOCK_DISPLAY_SETTINGS,
  normalizeStockDisplaySettings,
} from "../../utils/stockFormat";
import { trackFirestorePayload } from "../../utils/firestoreTelemetry";

const DEFAULT_FUND_FEE_PRESETS = [
  { id: "free", label: "무료형", bps: 0 },
  { id: "basic", label: "기본형", bps: 5 },
  { id: "growth", label: "성장형", bps: 10 },
  { id: "active", label: "액티브형", bps: 20 },
];

const DEFAULT_SETTINGS = {
  conversionRate: 10,
  tradeFeeRate: 0.002,
  tradeFeeMinUSD: 0,
  tradeFeeOverrides: {},
  exchangeFeeRate: 0.01,
  exchangeFeeOverrides: {},
  studentAutoExchangeBuyEnabled: false,
  displayFormat: DEFAULT_STOCK_DISPLAY_SETTINGS,
  hiddenStocks: {},
  stockMinHoldingDays: 0,
  isTopMoversHidden: false,
  fundFeeMode: "preset",
  fundFeePresets: DEFAULT_FUND_FEE_PRESETS,
  fundFixedManagementFeeBpsWeekly: 10,
  fundFixedManagementFeeLabel: "교사 고정",
  fundReportCycleDays: DEFAULT_REPORT_CYCLE_DAYS,
  fundReportCadenceLabel: `${DEFAULT_REPORT_CYCLE_DAYS}일`,
  fundMinHoldingsCount: 3,
  fundMaxSingleWeightBps: 4000,
  fundDailyCutoffTime: "15:00",
  fundOrderStartTime: "07:45",
  fundOrderCutoffTime: "15:00",
};

const FUND_ORDER_CUTOFF_MIN_TIME = "08:01";
const FUND_ORDER_CUTOFF_MAX_TIME = "18:00";

function normalizeFundFeePresets(rawPresets, legacyFees) {
  if (Array.isArray(rawPresets) && rawPresets.length > 0) {
    return rawPresets
      .map((preset, index) => ({
        id: preset?.id || `preset-${index + 1}`,
        label: String(preset?.label || "").trim() || `프리셋 ${index + 1}`,
        bps: Math.max(0, Math.round(Number(preset?.bps) || 0)),
      }))
      .filter((preset) => Number.isFinite(preset.bps));
  }

  if (Array.isArray(legacyFees) && legacyFees.length > 0) {
    return legacyFees.map((bps, index) => ({
      id: `preset-${index + 1}`,
      label: `프리셋 ${index + 1}`,
      bps: Math.max(0, Math.round(Number(bps) || 0)),
    }));
  }

  return DEFAULT_FUND_FEE_PRESETS;
}

function normalizeTradeFeeOverrides(rawOverrides = {}) {
  if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) {
    return {};
  }

  return Object.entries(rawOverrides).reduce((accumulator, [uid, value]) => {
    const safeUid = String(uid || "").trim();
    const rawRate = value && typeof value === "object" ? value.rate : value;
    const rate = Number(rawRate);
    if (!safeUid || !Number.isFinite(rate) || rate < 0) return accumulator;
    accumulator[safeUid] = rate;
    return accumulator;
  }, {});
}

function clampFundMinHoldingsCount(value) {
  const count = Math.round(Number(value) || DEFAULT_SETTINGS.fundMinHoldingsCount);
  return Math.min(8, Math.max(1, count));
}

function clampFundMaxSingleWeightBps(value) {
  const bps = Math.round(Number(value) || DEFAULT_SETTINGS.fundMaxSingleWeightBps);
  return Math.min(10000, Math.max(100, bps));
}

function clampStockMinHoldingDays(value) {
  const days = Math.round(Number(value) || 0);
  return Math.min(365, Math.max(0, days));
}

function normalizeFundReportCycle(value, legacyValue, legacyLabel) {
  const normalized = normalizeReportCycle(value, legacyValue, legacyLabel);
  return {
    fundReportCycleDays: normalized.days,
    fundReportCadenceLabel: normalized.label,
  };
}

function timeToMinutes(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) return null;

  const [hour, minute] = normalized.split(":").map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
}

function isTimeWithinRange(value, min, max) {
  const current = timeToMinutes(value);
  const minMinutes = timeToMinutes(min);
  const maxMinutes = timeToMinutes(max);

  if (current === null || minMinutes === null || maxMinutes === null) {
    return false;
  }

  return current >= minMinutes && current <= maxMinutes;
}

function normalizeTimeValue(value, fallback, min, max) {
  const normalized = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) return fallback;
  return isTimeWithinRange(normalized, min, max) ? normalized : fallback;
}

function normalizeFundOrderTimes(cutoffTime, dailyCutoffTime) {
  const normalizedCutoff = normalizeTimeValue(
    dailyCutoffTime ?? cutoffTime,
    DEFAULT_SETTINGS.fundOrderCutoffTime,
    FUND_ORDER_CUTOFF_MIN_TIME,
    FUND_ORDER_CUTOFF_MAX_TIME,
  );

  return {
    fundDailyCutoffTime: normalizedCutoff,
    fundOrderStartTime: DEFAULT_SETTINGS.fundOrderStartTime,
    fundOrderCutoffTime: normalizedCutoff,
  };
}

function normalizeSettings(data = {}) {
  const reportCycle = normalizeFundReportCycle(
    data.fundReportCycleDays,
    data.fundReportCadence,
    data.fundReportCadenceLabel || data.fundReportCycleDays,
  );
  const orderTimes = normalizeFundOrderTimes(
    data.fundOrderCutoffTime,
    data.fundDailyCutoffTime,
  );

  return {
    ...DEFAULT_SETTINGS,
    ...data,
    tradeFeeOverrides: normalizeTradeFeeOverrides(data.tradeFeeOverrides),
    exchangeFeeOverrides: normalizeTradeFeeOverrides(data.exchangeFeeOverrides),
    displayFormat: normalizeStockDisplaySettings(data.displayFormat),
    stockMinHoldingDays: clampStockMinHoldingDays(data.stockMinHoldingDays),
    fundFeePresets: normalizeFundFeePresets(
      data.fundFeePresets,
      data.fundAllowedManagementFeeBpsWeekly,
    ),
    fundFixedManagementFeeBpsWeekly:
      data.fundFixedManagementFeeBpsWeekly ??
      DEFAULT_SETTINGS.fundFixedManagementFeeBpsWeekly,
    fundFixedManagementFeeLabel:
      data.fundFixedManagementFeeLabel ||
      DEFAULT_SETTINGS.fundFixedManagementFeeLabel,
    ...reportCycle,
    fundMinHoldingsCount: clampFundMinHoldingsCount(data.fundMinHoldingsCount),
    fundMaxSingleWeightBps: clampFundMaxSingleWeightBps(data.fundMaxSingleWeightBps),
    ...orderTimes,
  };
}

export function useStockSettings(classId) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["stockSettings", classId], [classId]);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const snap = await getDoc(doc(db, `classes/${classId}/config/stockMarket`));
      trackFirestorePayload({
        classId,
        source: "useStockSettings",
        sourceGroup: "page",
        pathKey: "classes/{classId}/config/stockMarket",
        mode: "getDoc",
        snapshot: snap,
      });
      return snap.exists() ? normalizeSettings(snap.data()) : DEFAULT_SETTINGS;
    },
    enabled: !!classId,
  });

  const mutation = useMutation({
    mutationFn: async (newSettings) => {
      const ref = doc(db, `classes/${classId}/config/stockMarket`);
      const currentSettings =
        queryClient.getQueryData(queryKey) || query.data || DEFAULT_SETTINGS;
      const cleanData = JSON.parse(JSON.stringify(newSettings || {}));
      const {
        hiddenStocks: nextHiddenStocksRaw,
        tradeFeeOverrides: nextTradeFeeOverridesRaw,
        exchangeFeeOverrides: nextExchangeFeeOverridesRaw,
        ...restSettings
      } = cleanData;
      const reportCycle = normalizeFundReportCycle(
        restSettings.fundReportCycleDays,
        restSettings.fundReportCadence,
        restSettings.fundReportCadenceLabel,
      );
      const orderTimes = normalizeFundOrderTimes(
        restSettings.fundOrderCutoffTime,
        restSettings.fundDailyCutoffTime,
      );

      await setDoc(
        ref,
        {
          ...restSettings,
          fundReportCycleDays: clampReportCycleDays(reportCycle.fundReportCycleDays),
          fundReportCadenceLabel: reportCycle.fundReportCadenceLabel,
          fundReportCadence: deleteField(),
          fundMinHoldingsCount: clampFundMinHoldingsCount(restSettings.fundMinHoldingsCount),
          fundMaxSingleWeightBps: clampFundMaxSingleWeightBps(
            restSettings.fundMaxSingleWeightBps,
          ),
          stockMinHoldingDays: clampStockMinHoldingDays(
            restSettings.stockMinHoldingDays,
          ),
          ...orderTimes,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      if (Object.prototype.hasOwnProperty.call(cleanData, "hiddenStocks")) {
        const prevHiddenStocks = currentSettings?.hiddenStocks || {};
        const nextHiddenStocks =
          nextHiddenStocksRaw &&
          typeof nextHiddenStocksRaw === "object" &&
          !Array.isArray(nextHiddenStocksRaw)
            ? nextHiddenStocksRaw
            : {};
        const hiddenStocksPatch = {};

        Object.entries(nextHiddenStocks).forEach(([symbol, isHidden]) => {
          hiddenStocksPatch[`hiddenStocks.${symbol}`] = isHidden === true;
        });

        Object.keys(prevHiddenStocks).forEach((symbol) => {
          if (!(symbol in nextHiddenStocks)) {
            hiddenStocksPatch[`hiddenStocks.${symbol}`] = deleteField();
          }
        });

        if (Object.keys(hiddenStocksPatch).length > 0) {
          await updateDoc(ref, hiddenStocksPatch);
        }
      }

      if (Object.prototype.hasOwnProperty.call(cleanData, "tradeFeeOverrides")) {
        const prevTradeFeeOverrides = currentSettings?.tradeFeeOverrides || {};
        const nextTradeFeeOverrides = normalizeTradeFeeOverrides(
          nextTradeFeeOverridesRaw,
        );
        const tradeFeeOverridePatch = {};

        Object.entries(nextTradeFeeOverrides).forEach(([uid, rate]) => {
          tradeFeeOverridePatch[`tradeFeeOverrides.${uid}`] = rate;
        });

        Object.keys(prevTradeFeeOverrides).forEach((uid) => {
          if (!(uid in nextTradeFeeOverrides)) {
            tradeFeeOverridePatch[`tradeFeeOverrides.${uid}`] = deleteField();
          }
        });

        if (Object.keys(tradeFeeOverridePatch).length > 0) {
          await updateDoc(ref, tradeFeeOverridePatch);
        }
      }

      if (Object.prototype.hasOwnProperty.call(cleanData, "exchangeFeeOverrides")) {
        const prevExchangeFeeOverrides = currentSettings?.exchangeFeeOverrides || {};
        const nextExchangeFeeOverrides = normalizeTradeFeeOverrides(
          nextExchangeFeeOverridesRaw,
        );
        const exchangeFeeOverridePatch = {};

        Object.entries(nextExchangeFeeOverrides).forEach(([uid, rate]) => {
          exchangeFeeOverridePatch[`exchangeFeeOverrides.${uid}`] = rate;
        });

        Object.keys(prevExchangeFeeOverrides).forEach((uid) => {
          if (!(uid in nextExchangeFeeOverrides)) {
            exchangeFeeOverridePatch[`exchangeFeeOverrides.${uid}`] = deleteField();
          }
        });

        if (Object.keys(exchangeFeeOverridePatch).length > 0) {
          await updateDoc(ref, exchangeFeeOverridePatch);
        }
      }

      return { success: true };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const currentSettings = normalizeSettings(query.data || DEFAULT_SETTINGS);

  return {
    conversionRate: currentSettings.conversionRate,
    tradeFeeRate: currentSettings.tradeFeeRate,
    tradeFeeOverrides: currentSettings.tradeFeeOverrides || {},
    exchangeFeeRate: currentSettings.exchangeFeeRate,
    exchangeFeeOverrides: currentSettings.exchangeFeeOverrides || {},
    studentAutoExchangeBuyEnabled:
      currentSettings.studentAutoExchangeBuyEnabled === true,
    displayFormat: currentSettings.displayFormat,
    hiddenStocks: currentSettings.hiddenStocks || {},
    stockMinHoldingDays: currentSettings.stockMinHoldingDays,
    isTopMoversHidden: currentSettings.isTopMoversHidden,
    fundFeeMode: currentSettings.fundFeeMode || DEFAULT_SETTINGS.fundFeeMode,
    fundFeePresets: currentSettings.fundFeePresets,
    fundFixedManagementFeeBpsWeekly:
      currentSettings.fundFixedManagementFeeBpsWeekly,
    fundFixedManagementFeeLabel: currentSettings.fundFixedManagementFeeLabel,
    fundReportCycleDays: currentSettings.fundReportCycleDays,
    fundReportCadenceLabel: currentSettings.fundReportCadenceLabel,
    fundMinHoldingsCount: currentSettings.fundMinHoldingsCount,
    fundMaxSingleWeightBps: currentSettings.fundMaxSingleWeightBps,
    fundDailyCutoffTime: currentSettings.fundDailyCutoffTime,
    fundOrderStartTime: currentSettings.fundOrderStartTime,
    fundOrderCutoffTime: currentSettings.fundOrderCutoffTime,
    settings: currentSettings,
    isLoading: query.isLoading,
    isError: query.isError,
    isSaving: mutation.isPending,
    updateSettings: mutation.mutateAsync,
  };
}
