import { useEffect, useRef, useState } from "react";
import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { requestOverviewSummaryRepair } from "../../../utils/overviewSummaryRepair";
import {
  getEmptyBankOverviewSummary,
  isValidBankOverviewSummaryData,
  normalizeBankOverviewSummaryData,
} from "../../../utils/overviewSummarySchema";
import { calculateLoanInterestDue } from "../utils/loanMetrics";

const EMPTY_KIND_STATE = Object.freeze({
  rows: [],
  summary: null,
  loaded: false,
  loading: false,
  error: null,
});
const EMPTY_ROWS_STATE = Object.freeze({
  rows: [],
  fetched: false,
  loaded: false,
  loading: false,
  error: null,
});

function getSummaryDocId(kind) {
  return kind === "loans" ? "bankOverviewLoans" : "bankOverviewSavings";
}

function getSourceCollectionId(kind) {
  return kind === "loans" ? "loans" : "savings";
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function toWholeNumber(value) {
  const numericValue = Math.floor(Number(value));
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getStudentUidFromGroupedDoc(docSnap) {
  return docSnap?.ref?.parent?.parent?.id || null;
}

function getLoanPrincipal(loan = {}) {
  return toWholeNumber(loan.principal ?? loan.amount);
}

function getLoanOutstandingPrincipal(loan = {}) {
  const principal = getLoanPrincipal(loan);
  if (normalizeText(loan.status) === "pending") {
    return principal;
  }
  return toWholeNumber(loan.amountLeft ?? principal);
}

function getLoanTotalInterest(loan = {}) {
  return toWholeNumber(
    loan.normalInterestAmount ??
      loan.interestCalculatedOnRequest ??
      loan.expectedProfit ??
      loan.interestLeft,
  );
}

function getLoanRemainingInterest(loan = {}) {
  const status = normalizeText(loan.status);
  if (["repaid", "cancelled_request", "rejected"].includes(status)) {
    return 0;
  }

  if (status === "ongoing" && loan.interestModel === "declining_balance") {
    return toWholeNumber(calculateLoanInterestDue(loan).interestDue);
  }

  const totalInterest = getLoanTotalInterest(loan);
  const interestPaid = toWholeNumber(loan.interestPaid);

  if (totalInterest > 0 || interestPaid > 0) {
    return Math.max(0, totalInterest - interestPaid);
  }

  return toWholeNumber(loan.interestLeft);
}

function buildSavingOverviewRow(docSnap) {
  const data = docSnap.data() || {};
  const studentUid = getStudentUidFromGroupedDoc(docSnap);

  return {
    id: docSnap.id,
    requestedBy: normalizeText(data.requestedBy || studentUid),
    studentUid: studentUid || normalizeText(data.studentUid) || null,
    studentName: normalizeText(data.studentName),
    productId: normalizeText(data.productId),
    productLabel: normalizeText(data.productLabel),
    amount: toWholeNumber(data.amount),
    days: toWholeNumber(data.days),
    status: normalizeText(data.status),
    expectedProfit: toWholeNumber(
      data.expectedProfit ?? data.interestCalculatedOnRequest,
    ),
    interestCalculatedOnRequest: toWholeNumber(
      data.interestCalculatedOnRequest ?? data.expectedProfit,
    ),
    createdAt: data.createdAt || null,
    appliedAt: data.appliedAt || null,
    processedAt: data.processedAt || null,
    startedAt: data.startedAt || null,
    expectedMaturityDate: data.expectedMaturityDate || null,
    actualMaturityDate: data.actualMaturityDate || null,
    maturityDate: data.maturityDate || null,
  };
}

function buildLoanOverviewRow(docSnap) {
  const data = docSnap.data() || {};
  const studentUid = getStudentUidFromGroupedDoc(docSnap);

  return {
    id: docSnap.id,
    requestedBy: normalizeText(data.requestedBy || studentUid),
    studentUid: studentUid || normalizeText(data.studentUid) || null,
    studentName: normalizeText(data.studentName),
    productId: normalizeText(data.productId),
    productLabel: normalizeText(data.productLabel),
    amount: getLoanPrincipal(data),
    principal: getLoanPrincipal(data),
    amountLeft: getLoanOutstandingPrincipal(data),
    interestLeft: getLoanRemainingInterest(data),
    interestPaid: toWholeNumber(data.interestPaid),
    interestModel: data.interestModel || null,
    interestState: data.interestState || null,
    days: toWholeNumber(data.days),
    rate: data.rate ?? null,
    baseRate: data.baseRate ?? null,
    finalRateApplied: data.finalRateApplied ?? null,
    status: normalizeText(data.status),
    normalInterestAmount: getLoanTotalInterest(data),
    interestCalculatedOnRequest: toWholeNumber(
      data.interestCalculatedOnRequest ?? data.expectedProfit,
    ),
    expectedProfit: toWholeNumber(
      data.expectedProfit ?? data.interestCalculatedOnRequest,
    ),
    createdAt: data.createdAt || null,
    appliedAt: data.appliedAt || null,
    processedAt: data.processedAt || null,
    startedAt: data.startedAt || null,
    expectedRepaymentDate: data.expectedRepaymentDate || null,
    penaltyBaseDate: data.penaltyBaseDate || null,
    actualRepaymentDate: data.actualRepaymentDate || null,
    repaymentDate: data.repaymentDate || null,
  };
}

function buildOverviewRow(kind, docSnap) {
  return kind === "loans"
    ? buildLoanOverviewRow(docSnap)
    : buildSavingOverviewRow(docSnap);
}

function useSummaryBackedOverviewKind(
  kind,
  classId,
  { subscribe = false, hydrate = false } = {},
) {
  const [state, setState] = useState(EMPTY_KIND_STATE);
  const hydratedKeyRef = useRef("");
  const stateKeyRef = useRef("");

  useEffect(() => {
    const summaryKey = classId ? `${classId}:${kind}` : "";
    const emptyState = {
      ...EMPTY_KIND_STATE,
      summary: getEmptyBankOverviewSummary(kind),
    };

    if (stateKeyRef.current !== summaryKey) {
      stateKeyRef.current = summaryKey;
      hydratedKeyRef.current = "";
      setState(emptyState);
    }

    if (!classId) {
      hydratedKeyRef.current = "";
      setState(emptyState);
      return undefined;
    }

    if (!subscribe && !hydrate) {
      setState((current) => ({
        ...current,
        loading: false,
        error: null,
      }));
      return undefined;
    }

    let isActive = true;

    setState((current) => ({
      ...current,
      loading: !current.loaded,
      error: null,
    }));

    const summaryRef = doc(
      db,
      "classes",
      classId,
      "dashboardSummary",
      getSummaryDocId(kind),
    );

    const applySummaryData = (data) => {
      if (!isValidBankOverviewSummaryData(data, kind)) return false;

      hydratedKeyRef.current = summaryKey;
      const normalizedSummary = normalizeBankOverviewSummaryData(data, kind);
      setState({
        rows: normalizedSummary.rows,
        summary: normalizedSummary,
        loaded: true,
        loading: false,
        error: null,
      });
      return true;
    };

    const refreshSummary = async ({ force = false } = {}) => {
      setState((current) => ({
        ...current,
        loading: !current.loaded || force,
        error: null,
      }));

      try {
        if (!force) {
          const existingSnap = await getDoc(summaryRef);
          if (!isActive) return;

          const existingData = existingSnap.exists() ? existingSnap.data() || {} : null;
          if (applySummaryData(existingData)) return;
        }

        const repairResult = await requestOverviewSummaryRepair(classId, {
          force,
          scope: "bank",
        });
        if (!isActive) return;

        const snap = await getDoc(summaryRef);
        if (!isActive) return;

        const data = snap.exists() ? snap.data() || {} : null;
        if (applySummaryData(data)) return;

        const summaryError =
          repairResult.error ||
          new Error(`[useClassBankOverview] ${kind} summary is unavailable.`);
        hydratedKeyRef.current = summaryKey;
        setState((current) => ({
          ...current,
          loaded: true,
          loading: false,
          error: summaryError,
        }));
      } catch (summaryError) {
        if (!isActive) return;
        console.error(
          `[useClassBankOverview] ${kind} summary refresh error:`,
          summaryError,
        );
        hydratedKeyRef.current = summaryKey;
        setState((current) => ({
          ...current,
          loaded: true,
          loading: false,
          error: summaryError,
        }));
      }
    };

    if (!subscribe) {
      if (hydratedKeyRef.current !== summaryKey) {
        void refreshSummary();
      }
      return () => {
        isActive = false;
      };
    }

    const unsubscribe = onSnapshot(
      summaryRef,
      (snap) => {
        if (!isActive) return;

        const data = snap.exists() ? snap.data() || {} : null;
        if (applySummaryData(data)) return;

        void refreshSummary();
      },
      (summaryError) => {
        if (!isActive) return;
        console.error(`[useClassBankOverview] ${kind} summary snapshot error:`, summaryError);
        void refreshSummary();
      },
    );

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [classId, hydrate, kind, subscribe]);

  return state;
}

function useBankOverviewRows(
  kind,
  classId,
  { enabled = false, fallbackRows = [] } = {},
) {
  const [state, setState] = useState(EMPTY_ROWS_STATE);
  const stateKeyRef = useRef("");

  useEffect(() => {
    const rowsKey = classId ? `${classId}:${kind}` : "";
    const normalizedFallbackRows = Array.isArray(fallbackRows)
      ? fallbackRows.filter((row) => row && row.id)
      : [];

    if (stateKeyRef.current !== rowsKey) {
      stateKeyRef.current = rowsKey;
      setState({
        rows: normalizedFallbackRows,
        fetched: false,
        loaded: normalizedFallbackRows.length > 0,
        loading: false,
        error: null,
      });
    }

    if (!classId) {
      setState(EMPTY_ROWS_STATE);
      return undefined;
    }

    if (!enabled) {
      setState((current) => ({
        ...current,
        rows: current.rows.length > 0 ? current.rows : normalizedFallbackRows,
        loaded: current.loaded || normalizedFallbackRows.length > 0,
        loading: false,
        error: null,
      }));
      return undefined;
    }

    let isActive = true;

    setState((current) => ({
      fetched: current.fetched,
      rows: current.rows.length > 0 ? current.rows : normalizedFallbackRows,
      loaded: current.loaded || normalizedFallbackRows.length > 0,
      loading: !(current.loaded || normalizedFallbackRows.length > 0),
      error: null,
    }));

    const rowsQuery = query(
      collectionGroup(db, getSourceCollectionId(kind)),
      where("classId", "==", classId),
      orderBy("createdAt", "desc"),
    );

    void getDocs(rowsQuery)
      .then((snapshot) => {
        if (!isActive) return;

        const rows = snapshot.docs.map((docSnap) => buildOverviewRow(kind, docSnap));
        const nextRows = rows;

        setState({
          rows: nextRows,
          fetched: true,
          loaded: true,
          loading: false,
          error: null,
        });
      })
      .catch((rowsError) => {
        if (!isActive) return;
        console.error(`[useClassBankOverview] ${kind} rows fetch error:`, rowsError);
        setState((current) => ({
          ...current,
          rows: current.rows.length > 0 ? current.rows : normalizedFallbackRows,
          loaded: true,
          loading: false,
          error: rowsError,
        }));
      });

    return () => {
      isActive = false;
    };
  }, [classId, enabled, fallbackRows, kind]);

  return state;
}

export default function useClassBankOverview(
  classId,
  { enabled = true, activeTab = "savings", rowsEnabled = false } = {},
) {
  const queryEnabled = !!classId && enabled;
  const savingsSummaryState = useSummaryBackedOverviewKind(
    "savings",
    classId,
    {
      subscribe: queryEnabled && activeTab === "savings",
      hydrate: queryEnabled,
    },
  );
  const loansSummaryState = useSummaryBackedOverviewKind(
    "loans",
    classId,
    {
      subscribe: queryEnabled && activeTab === "loans",
      hydrate: queryEnabled,
    },
  );
  const savingsRowsState = useBankOverviewRows("savings", classId, {
    enabled: queryEnabled && rowsEnabled && activeTab === "savings",
    fallbackRows: savingsSummaryState.rows,
  });
  const loansRowsState = useBankOverviewRows("loans", classId, {
    enabled: queryEnabled && rowsEnabled && activeTab === "loans",
    fallbackRows: loansSummaryState.rows,
  });

  const savingsLoading =
    queryEnabled &&
    activeTab === "savings" &&
    (
      (savingsSummaryState.loading && !savingsSummaryState.loaded) ||
      (rowsEnabled && savingsRowsState.loading && !savingsRowsState.loaded)
    );
  const loansLoading =
    queryEnabled &&
    activeTab === "loans" &&
    (
      (loansSummaryState.loading && !loansSummaryState.loaded) ||
      (rowsEnabled && loansRowsState.loading && !loansRowsState.loaded)
    );

  return {
    savings: savingsRowsState.rows,
    loans: loansRowsState.rows,
    savingsSummary: savingsSummaryState.summary || getEmptyBankOverviewSummary("savings"),
    loansSummary: loansSummaryState.summary || getEmptyBankOverviewSummary("loans"),
    savingsLoaded: savingsSummaryState.loaded,
    loansLoaded: loansSummaryState.loaded,
    savingsRowsLoaded: savingsRowsState.fetched && !savingsRowsState.loading && !savingsRowsState.error,
    loansRowsLoaded: loansRowsState.fetched && !loansRowsState.loading && !loansRowsState.error,
    savingsLoading,
    loansLoading,
    activeTabLoading: activeTab === "savings" ? savingsLoading : loansLoading,
    error:
      savingsSummaryState.error ||
      loansSummaryState.error ||
      savingsRowsState.error ||
      loansRowsState.error ||
      null,
  };
}
