import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

const REPAIR_THROTTLE_MS = 15 * 1000;
const inflightRepairs = new Map();
const lastRepairAttemptAt = new Map();
const repairFns = Object.freeze({
  all: httpsCallable(functions, "rebuildOverviewSummariesForClass"),
  bank: httpsCallable(functions, "rebuildBankOverviewSummariesForClass"),
  payroll: httpsCallable(functions, "rebuildPayrollOverviewSummaryForClass"),
});

function normalizeRepairScope(scope) {
  const normalized = String(scope || "all").trim().toLowerCase();
  if (normalized === "bank" || normalized === "payroll") {
    return normalized;
  }
  return "all";
}

export async function requestOverviewSummaryRepair(
  classId,
  { force = false, scope = "all" } = {},
) {
  const normalizedClassId = String(classId || "").trim();
  const normalizedScope = normalizeRepairScope(scope);
  const repairKey = `${normalizedScope}:${normalizedClassId}`;
  if (!normalizedClassId) {
    return {
      attempted: false,
      success: false,
      skipped: true,
      error: null,
    };
  }

  if (inflightRepairs.has(repairKey)) {
    return inflightRepairs.get(repairKey);
  }

  const now = Date.now();
  const lastAttemptAt = lastRepairAttemptAt.get(repairKey) || 0;
  if (!force && now - lastAttemptAt < REPAIR_THROTTLE_MS) {
    return {
      attempted: false,
      success: false,
      skipped: true,
      error: null,
    };
  }

  lastRepairAttemptAt.set(repairKey, now);

  const repairPromise = (async () => {
    try {
      await repairFns[normalizedScope]({ classId: normalizedClassId });
      return {
        attempted: true,
        success: true,
        skipped: false,
        error: null,
      };
    } catch (error) {
      console.error(
        "[overviewSummaryRepair] failed to rebuild overview summary:",
        error,
      );
      return {
        attempted: true,
        success: false,
        skipped: false,
        error,
      };
    } finally {
      inflightRepairs.delete(repairKey);
    }
  })();

  inflightRepairs.set(repairKey, repairPromise);
  return repairPromise;
}
