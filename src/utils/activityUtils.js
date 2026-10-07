import {
  Timestamp,
  collection,
  limit,
  orderBy,
  or,
  query,
  startAfter,
  where,
} from "firebase/firestore";
import dayjs from "dayjs";
import { DEFAULT_MISSION_TOKEN_LABEL } from "./missionTokenLabel";

export const ACTIVITY_LOG_SCOPE = {
  ALL: "all",
  GENERAL: "general",
  MISSION_TOKEN: "missionToken",
};

export const MISSION_TOKEN_LOG_CURRENCIES = [
  "mission_token",
  "미션토큰",
  DEFAULT_MISSION_TOKEN_LABEL,
];
const LEGACY_GENERAL_LOG_CURRENCIES = ["class_currency", "USD"];

const INCOME_CATEGORIES = [
  "salary",
  "mission",
  "transfer_in",
  "interest",
  "dividend",
  "increment",
  "exchange_in",
  "store_refund",
  "tax_income",
  "deposit_return",
  "loan_approve",
  "stock_sell",
];

const toFiniteNumber = (value) => {
  if (value === null || value === undefined) return null;

  if (typeof value?.toNumber === "function") {
    const numericValue = Number(value.toNumber());
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  if (typeof value?.valueOf === "function") {
    const primitive = value.valueOf();
    if (primitive !== value) {
      const numericValue = Number(primitive);
      if (Number.isFinite(numericValue)) return numericValue;
    }
  }

  if (typeof value === "object") {
    if ("integerValue" in value || "doubleValue" in value || "value" in value) {
      return toFiniteNumber(
        value.integerValue ?? value.doubleValue ?? value.value,
      );
    }

    if (
      Number.isFinite(Number(value.low)) &&
      (value.high === 0 || value.high === -1 || value.high === undefined)
    ) {
      return Number(value.low);
    }
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const resolveCurrencyExchangeDelta = (log = {}) => {
  if (log.category !== "currency_exchange") return null;

  const amount =
    toFiniteNumber(log.amountInClassCurrency) ?? toFiniteNumber(log.amount);
  if (amount === null || amount === 0) return null;

  const direction = String(log.exchangeDirection || log.direction || "")
    .trim()
    .toUpperCase()
    .replace(/^EXCHANGE_/, "");

  if (direction === "USD_TO_BIL") return Math.abs(amount);
  if (direction === "BIL_TO_USD") return -Math.abs(amount);

  const currency = String(log.currency || "").trim().toUpperCase();
  if (currency === "USD" || currency === "FIN") return Math.abs(amount);
  if (currency === "CLASS_CURRENCY") return -Math.abs(amount);

  const description = String(log.description || "").toUpperCase();
  if (description.includes("FIN ->")) return Math.abs(amount);
  if (description.includes("-> FIN")) return -Math.abs(amount);

  return null;
};

const resolveDirectionalDelta = (log = {}) => {
  const candidates = [
    toFiniteNumber(log.classCurrencyDelta),
    toFiniteNumber(log.adjustmentDelta),
    toFiniteNumber(log.missionTokenDelta),
    toFiniteNumber(log.delta),
  ];

  return (
    candidates.find((value) => value !== null && value !== 0) ??
    resolveCurrencyExchangeDelta(log)
  );
};

export const isMissionTokenActivity = (log) => {
  if (!log) return false;

  if (log.activityScope === "mission_token") return true;
  if (log.assetType === "missionToken") return true;

  const currency = String(log.currency || "").trim();
  if (MISSION_TOKEN_LOG_CURRENCIES.includes(currency)) return true;

  return resolveDirectionalDelta({ missionTokenDelta: log.missionTokenDelta }) !== null;
};

const buildScopeFilter = ({ logScope = ACTIVITY_LOG_SCOPE.ALL, currencyUnit }) => {
  if (logScope === ACTIVITY_LOG_SCOPE.MISSION_TOKEN) {
    return or(
      where("activityScope", "==", "mission_token"),
      ...MISSION_TOKEN_LOG_CURRENCIES.map((currency) =>
        where("currency", "==", currency),
      ),
    );
  }

  if (logScope === ACTIVITY_LOG_SCOPE.GENERAL) {
    const clauses = [where("activityScope", "==", "general")];
    const currencies = Array.from(
      new Set(
        [currencyUnit, ...LEGACY_GENERAL_LOG_CURRENCIES]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );

    currencies.forEach((currency) => {
      clauses.push(where("currency", "==", currency));
    });

    return or(...clauses);
  }

  return null;
};

export const checkIsIncome = (log) => {
  if (!log) return false;

  const directionalDelta = resolveDirectionalDelta(log);

  if (directionalDelta !== null && directionalDelta !== 0) {
    return directionalDelta > 0;
  }

  if (log.type === "income" || log.subCategory === "add") return true;
  if (log.type === "expense" || log.subCategory === "subtract") return false;
  return INCOME_CATEGORIES.includes(log.category);
};

export const getAmountInClass = (log) => {
  if (!log) return 0;

  const directionalAmount = resolveDirectionalDelta(log);
  if (directionalAmount !== null && directionalAmount !== 0) {
    return Math.abs(directionalAmount);
  }

  const classAmount = toFiniteNumber(log.amountInClassCurrency);
  if (classAmount !== null && classAmount !== 0) return Math.abs(classAmount);

  const rawAmount = toFiniteNumber(log.amount);
  if (rawAmount !== null) return Math.abs(rawAmount);

  if (classAmount !== null) return Math.abs(classAmount);

  return 0;
};

export const buildActivityLogQuery = ({
  db,
  classId,
  studentUid,
  startDate,
  endDate,
  categoryFilter = "all",
  pageSize = 10,
  lastVisible = null,
  logScope = ACTIVITY_LOG_SCOPE.ALL,
  currencyUnit,
}) => {
  const historyColRef = collection(
    db,
    `classes/${classId}/students/${studentUid}/activityLogs`,
  );

  let qy = query(historyColRef, orderBy("createdAt", "desc"));
  const scopeFilter = buildScopeFilter({ logScope, currencyUnit });
  if (scopeFilter) {
    qy = query(qy, scopeFilter);
  }

  if (startDate) {
    qy = query(
      qy,
      where(
        "createdAt",
        ">=",
        Timestamp.fromDate(dayjs(startDate).startOf("day").toDate()),
      ),
    );
  }
  if (endDate) {
    qy = query(
      qy,
      where(
        "createdAt",
        "<=",
        Timestamp.fromDate(dayjs(endDate).endOf("day").toDate()),
      ),
    );
  }

  const categoryFilters = Array.isArray(categoryFilter)
    ? Array.from(
        new Set(
          categoryFilter
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      )
    : categoryFilter && categoryFilter !== "all"
      ? [String(categoryFilter).trim()]
      : [];

  if (categoryFilters.length === 1) {
    qy = query(qy, where("category", "==", categoryFilters[0]));
  } else if (categoryFilters.length > 1 && categoryFilters.length <= 10) {
    qy = query(qy, where("category", "in", categoryFilters));
  }

  if (lastVisible) qy = query(qy, startAfter(lastVisible));
  if (pageSize) qy = query(qy, limit(pageSize));

  return qy;
};

export const convertFirestoreDocToActivity = (doc) => {
  const data = doc.data() || {};
  const rawDate = data.createdAt || data.timestamp || data.approvedAt;
  return {
    id: doc.id,
    ...data,
    timestamp: rawDate?.toDate?.() || new Date(),
  };
};

export const calculateActivityStatistics = (activities) => {
  let income = 0;
  let expense = 0;

  activities.forEach((activity) => {
    const amount = getAmountInClass(activity);
    if (checkIsIncome(activity)) income += amount;
    else expense += amount;
  });

  return {
    totalIncome: income,
    totalExpense: expense,
    netAmount: income - expense,
  };
};

export const getActivityDisplayInfo = (
  log,
  currencyUnit = "단위",
  formatNumber = (value) => value.toLocaleString(),
  missionTokenUnit = DEFAULT_MISSION_TOKEN_LABEL,
) => {
  const isIncome = checkIsIncome(log);
  const amount = getAmountInClass(log);
  const amountPrefix = amount === 0 ? "" : isIncome ? "+" : "-";
  const isMissionTokenLog =
    log?.activityScope === "mission_token" ||
    log?.assetType === "missionToken" ||
    MISSION_TOKEN_LOG_CURRENCIES.includes(String(log?.currency || "").trim());
  const resolvedCurrencyUnit = isMissionTokenLog ? missionTokenUnit : currencyUnit;

  return {
    tone: isIncome ? "emerald" : "rose",
    color: isIncome ? "text-emerald-600" : "text-rose-600",
    icon: isIncome ? "income" : "expense",
    amountText: `${amountPrefix}${formatNumber(amount)} ${resolvedCurrencyUnit}`,
    isIncome,
  };
};

export const filterActivities = (
  activities,
  typeFilter = "all",
  searchText = "",
) => {
  return activities.filter((activity) => {
    if (searchText) {
      const normalizedSearch = searchText.toLowerCase();
      const haystacks = [activity.description, activity.note, activity.reason]
        .map((value) => String(value || "").toLowerCase());

      if (!haystacks.some((value) => value.includes(normalizedSearch))) {
        return false;
      }
    }
    return true;
  });
};

export const getDefaultDateRange = (days = 30) => ({
  startDate: dayjs()
    .subtract(days - 1, "day")
    .format("YYYY-MM-DD"),
  endDate: dayjs().format("YYYY-MM-DD"),
});
