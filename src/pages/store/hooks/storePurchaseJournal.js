// Per-tab retry IDs survive reloads. Never store account IDs or order contents.
// No expiry: an uncertain payment must not silently become a new payment.
export function createStorePurchaseJournal(classId, uid) {
  const keys = new Map();
  const storageKey = (orderKey) => {
    if (!keys.has(orderKey)) {
      keys.set(orderKey, (async () => {
        if (!classId || !uid) throw new Error("Purchase account is not ready");
        const input = JSON.stringify([
          process.env.REACT_APP_FIREBASE_PROJECT_ID || "finclass", classId, uid, orderKey,
        ]);
        const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
        return "finclass:store-retry:v1:" + Array.from(new Uint8Array(digest),
          (byte) => byte.toString(16).padStart(2, "0")).join("");
      })().catch((error) => { keys.delete(orderKey); throw error; }));
    }
    return keys.get(orderKey);
  };
  const withStorage = async (key, action) => {
    try {
      return action(window.sessionStorage, await storageKey(key));
    } catch {
      const error = new Error("구매 확인 정보를 저장할 수 없습니다. 브라우저 저장소를 허용한 뒤 다시 시도해 주세요.");
      error.code = "store/retry-storage";
      throw error;
    }
  };
  return {
    getOrCreate: (key, id) => withStorage(key, (storage, name) => {
      const previous = storage.getItem(name);
      if (previous !== null) {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(previous)) throw new Error("Invalid retry ID");
        return previous;
      }
      storage.setItem(name, id);
      return id;
    }),
    remove: (key, id) => withStorage(key, (storage, name) => {
      if (storage.getItem(name) === id) storage.removeItem(name);
    }),
  };
}
