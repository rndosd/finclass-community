import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useUser } from "./UserContextCore";

import { DEFAULT_FORMAT_SETTINGS, normalizeNumberFormatSettings, formatConfiguredMoney } from "../utils/numberDisplay";
export { DEFAULT_FORMAT_SETTINGS, normalizeNumberFormatSettings } from "../utils/numberDisplay";

const NumberFormatContext = createContext();

const toSafeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const truncateNumber = (value, fractionDigits = 0) => {
  const num = toSafeNumber(value, 0);
  const safeFractionDigits = Math.max(0, Number(fractionDigits) || 0);
  if (safeFractionDigits === 0) {
    return Math.trunc(num);
  }

  const factor = 10 ** safeFractionDigits;
  const truncated = Math.trunc(num * factor) / factor;
  return Object.is(truncated, -0) ? 0 : truncated;
};

const toTruncatedWholeNumber = (value) => truncateNumber(value, 0);

const COMPACT_NUMBER_UNITS = [
  { threshold: 1_000_000_000_000, suffix: "조" },
  { threshold: 100_000_000, suffix: "억" },
  { threshold: 10_000, suffix: "만" },
];

const formatCompactSuffix = (value, fractionDigits = 1) => {
  const num = toSafeNumber(value, 0);
  const abs = Math.abs(num);
  const options = {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  };
  const unit = COMPACT_NUMBER_UNITS.find(
    ({ threshold }) => abs >= threshold,
  );

  if (unit) {
    return `${(num / unit.threshold).toLocaleString("ko-KR", options)}${unit.suffix}`;
  }

  return null;
};

const formatDecimal = (value, fractionDigits, trimTrailingZeros = false) =>
  toSafeNumber(value, 0).toLocaleString("ko-KR", {
    minimumFractionDigits: trimTrailingZeros ? 0 : fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

export const useOptionalNumberFormat = () => useContext(NumberFormatContext);

export const useNumberFormat = () => {
  const context = useOptionalNumberFormat();
  if (!context) {
    throw new Error("useNumberFormat must be used within NumberFormatProvider");
  }
  return context;
};

export const NumberFormatProvider = ({ children }) => {
  const { classData } = useUser();

  const [formatSettings, setFormatSettings] = useState(DEFAULT_FORMAT_SETTINGS);

  useEffect(() => {
    setFormatSettings(
      normalizeNumberFormatSettings(classData?.numberFormat),
    );
  }, [classData?.numberFormat]);

  const shouldUseCompactNotation = (options = {}) =>
    options.forceCompact === true || formatSettings.useCompactNotation !== false;

  const formatCount = (value) => {
    let num = Number(value);

    if (Number.isNaN(num)) return "0";

    const isSmallDecimal = Math.abs(num) < 1 && num !== 0;

    if (isSmallDecimal) {
      if (formatSettings.smallDecimalPlaces === 0) {
        return "0";
      }

      return num.toLocaleString("ko-KR", {
        minimumFractionDigits: formatSettings.smallDecimalPlaces,
        maximumFractionDigits: formatSettings.smallDecimalPlaces,
      });
    }

    switch (formatSettings.largeNumberDisplay) {
      case "tens":
        return (Math.trunc(num / 10) * 10).toLocaleString("ko-KR");
      case "ones":
        return Math.trunc(num).toLocaleString("ko-KR");
      case "first":
        num = truncateNumber(num, 1);
        break;
      case "second":
        num = truncateNumber(num, 2);
        break;
      case "third":
        num = truncateNumber(num, 3);
        break;
      default:
        break;
    }

    if (Number.isInteger(num)) {
      return num.toLocaleString("ko-KR");
    }

    const decimalPlaces =
      formatSettings.largeNumberDisplay === "first"
        ? 1
        : formatSettings.largeNumberDisplay === "second"
          ? 2
          : formatSettings.largeNumberDisplay === "third"
            ? 3
            : 0;

    return num.toLocaleString("ko-KR", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    });
  };

  const formatClassCurrencyCompact = (value, options = {}) => {
    const num = toSafeNumber(value, 0);
    if (!shouldUseCompactNotation(options)) {
      return formatConfiguredMoney(num, formatSettings, options);
    }
    const compact = formatCompactSuffix(num, options.fractionDigits ?? 1);
    return compact || formatConfiguredMoney(num, formatSettings, options);
  };

  const formatClassCurrency = useCallback((value, options = {}) => {
    const num = toSafeNumber(value, 0);

    if (options.compact && (options.forceCompact === true || formatSettings.useCompactNotation !== false)) {
      const compact = formatCompactSuffix(num, options.fractionDigits ?? 1);
      if (compact) return compact;
    }

    return formatConfiguredMoney(num, formatSettings, options);
  }, [formatSettings]);

  const formatFin = (value, options = {}) => {
    const num = toSafeNumber(value, 0);
    const fractionDigits = options.fractionDigits ?? 2;

    if (options.compact && shouldUseCompactNotation(options)) {
      const compact = formatCompactSuffix(
        num,
        options.compactFractionDigits ?? 1,
      );
      if (compact) return compact;
    }

    return formatDecimal(num, fractionDigits, options.trimTrailingZeros);
  };

  const formatExchangeRate = (value, options = {}) => {
    const fractionDigits = options.fractionDigits ?? 2;
    return formatDecimal(
      value,
      fractionDigits,
      options.trimTrailingZeros ?? true,
    );
  };

  const formatWholeNumber = (value) =>
    toTruncatedWholeNumber(value).toLocaleString("ko-KR");

  const formatCompactNumber = (value, options = {}) => {
    if (options.whole) {
      return formatClassCurrencyCompact(value, options);
    }

    const num = toSafeNumber(value, 0);
    if (!shouldUseCompactNotation(options)) {
      return formatCount(num);
    }
    const compact = formatCompactSuffix(num, options.fractionDigits ?? 1);
    return compact || formatCount(num);
  };

  const formatPercent = (value, options = {}) => {
    const fractionDigits = options.fractionDigits ?? 2;
    return formatDecimal(value, fractionDigits, options.trimTrailingZeros);
  };

  const formatStockPrice = (value, options = {}) =>
    formatFin(value, { fractionDigits: 2, ...options });

  return (
    <NumberFormatContext.Provider
      value={{
        formatNumber: formatCount,
        formatCount,
        formatWholeNumber,
        formatCompactNumber,
        formatClassCurrency,
        formatClassCurrencyCompact,
        formatFin,
        formatExchangeRate,
        formatPercent,
        formatStockPrice,
        formatSettings,
        setFormatSettings,
      }}
    >
      {children}
    </NumberFormatContext.Provider>
  );
};
