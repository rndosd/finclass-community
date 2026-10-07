import { useMemo } from "react";
import { createFinancialRequestTracker } from "../../../utils/financialRequests";
import { buyStoreCart, buyStoreCartPos, buyStoreItem } from "../services/storeService";

import { createStorePurchaseJournal } from "./storePurchaseJournal";

const copyItems = (items) => items.map(({ itemId, quantity }) => ({ itemId, quantity }));

export function useStorePurchases(classId, uid) {
  return useMemo(() => {
    const requests = createFinancialRequestTracker({
      journal: createStorePurchaseJournal(classId, uid),
      retainRequestOnError: (error) => error?.details?.reason === "class-maintenance",
    });
    const run = (kind, payload, execute) => requests.run(JSON.stringify([kind, payload]), execute);
    return {
      buyItem(itemId, quantity) {
        return run("item", { itemId, quantity }, (id) => buyStoreItem(classId, itemId, quantity, id));
      },
      buyCart(items) {
        const order = copyItems(items);
        return run("cart", order, (id) => buyStoreCart(classId, order, id));
      },
      buyPos(targetStudentUid, items, options = {}) {
        const order = copyItems(items);
        const settings = {
          isImmediate: options.isImmediate ?? true,
          transactionType: options.transactionType ?? "purchase",
          recordAsTaxExpense: options.recordAsTaxExpense ?? false,
          classFundId: options.classFundId || "",
        };
        return run("pos", { targetStudentUid, order, ...settings }, (id) =>
          buyStoreCartPos(classId, targetStudentUid, order, { ...settings, clientRequestId: id }));
      },
    };
    // Both durable IDs and active promises are scoped to the current account.
  }, [classId, uid]);
}
