import { getDocs } from "firebase/firestore";
import { ACTIVITY_CATEGORY_GROUPS } from "../../../constants/financeExportConfig";
import {
  ACTIVITY_LOG_SCOPE,
  buildActivityLogQuery,
  convertFirestoreDocToActivity,
  getDefaultDateRange,
} from "../../../utils/activityUtils";

const BANK_CATEGORIES = [
  ...ACTIVITY_CATEGORY_GROUPS.transfer,
  ...ACTIVITY_CATEGORY_GROUPS.deposit,
  ...ACTIVITY_CATEGORY_GROUPS.loan,
];

export async function loadRecentBankActivities({ db, classId, studentUid, currencyUnit, pageSize = 3 }) {
  const range = getDefaultDateRange(30);
  const snapshots = await Promise.all(
    // At most 4 scope alternatives × 3 categories: below both the OR and 100-term limits.
    Array.from({ length: Math.ceil(BANK_CATEGORIES.length / 3) }, (_, index) =>
      getDocs(buildActivityLogQuery({
        db, classId, studentUid, currencyUnit, pageSize,
        ...range,
        categoryFilter: BANK_CATEGORIES.slice(index * 3, index * 3 + 3),
        logScope: ACTIVITY_LOG_SCOPE.GENERAL,
      })),
    ),
  );
  const docs = [...new Map(snapshots.flatMap(snapshot => snapshot.docs).map(doc => [doc.id, doc])).values()];
  docs.sort((left, right) => {
    const a = left.data().createdAt;
    const b = right.data().createdAt;
    return (b?.seconds || 0) - (a?.seconds || 0) ||
      (b?.nanoseconds || 0) - (a?.nanoseconds || 0) || right.id.localeCompare(left.id);
  });
  return docs.slice(0, pageSize).map(convertFirestoreDocToActivity);
}
