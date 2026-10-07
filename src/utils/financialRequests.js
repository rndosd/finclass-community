export const createFinancialRequestId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `rid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

// Keep an uncertain request's ID AND original payload until its result is known.
// A changed quote must not turn a retry into another purchase.
export function createFinancialRequestTracker({ retainRequestOnError = () => false, journal } = {}) {
  const requests = new Map();
  const isDefiniteFailure = (result) => {
    if (retainRequestOnError(result)) return false;
    const code = String(result?.code || "").replace(/^functions\//, "");
    return result?.details?.reason === "stock-price-changed" || [
      "invalid-argument", "permission-denied", "unauthenticated", "not-found",
      "failed-precondition", "out-of-range", "unimplemented", "resource-exhausted",
    ].includes(code);
  };
  return {
    has: (key) => requests.has(key),
    run(key, execute) {
      const pending = requests.get(key);
      if (pending?.promise) return pending.promise;
      const entry = pending || { id: createFinancialRequestId(), execute };
      requests.set(key, entry);
      entry.promise = Promise.resolve().then(async () => {
        if (journal) entry.id = await journal.getOrCreate(key, entry.id);
        return entry.execute(entry.id);
      }).then(async (result) => {
        if (result?.success || isDefiniteFailure(result)) {
          if (journal) await journal.remove(key, entry.id);
          requests.delete(key);
        }
        return result;
      }, async (error) => {
        if (isDefiniteFailure(error)) {
          if (journal) await journal.remove(key, entry.id);
          requests.delete(key);
        }
        throw error;
      }).finally(() => { entry.promise = null; });
      return entry.promise;
    },
  };
}
