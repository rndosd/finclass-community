import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db } from "../firebase";
import { adjustStudentAssetsService } from "../pages/admin/services/assetAdminService";
import {
  alwaysListAttempts,
  approveAlwaysAttemptBatch,
  rejectAlwaysAttemptBatch,
} from "../pages/missions/services/missionAlwaysService";
import { approveMissionBatch } from "../pages/missions/services/missionService";
import { normalizeMission } from "../pages/missions/utils/normalizeMission";
import {
  isValidPendingSummaryData,
  isValidPayrollOverviewSummaryData,
  normalizePendingSummaryData,
  normalizePayrollOverviewSummaryData,
} from "../utils/overviewSummarySchema";

const functions = getFunctions(undefined, "asia-northeast3");
const approveBankApplications = httpsCallable(
  functions,
  "approveBankApplications",
);
const queryClassActivityLogs = httpsCallable(
  functions,
  "queryClassActivityLogs",
);
const approveMarketplaceItem = httpsCallable(
  functions,
  "approveMarketplaceItem",
);
const listRegularMissionStates = httpsCallable(functions, "listRegularMissionStates");

export const loadClassMissions = async (classId) => {
  const snapshot = await getDocs(collection(db, `classes/${classId}/missions`));
  const missions = snapshot.docs.map((missionDoc) =>
    normalizeMission(
      {
        id: missionDoc.id,
        classId,
        ...missionDoc.data(),
      },
      {},
    ),
  );
  const canonicalIds = missions.filter((mission) => mission.stateStorageVersion === 2).map((mission) => mission.id);
  for (let offset = 0; offset < canonicalIds.length; offset += 30) {
    const response = await listRegularMissionStates({ classId, missionIds: canonicalIds.slice(offset, offset + 30) });
    for (const mission of missions) {
      if (response.data?.missions?.[mission.id]) Object.assign(mission, response.data.missions[mission.id]);
    }
  }
  return missions;
};

export const loadPendingBankApplications = async (classId) => {
  const snapshot = await getDoc(
    doc(db, "classes", classId, "dashboardSummary", "bankAdminPending"),
  );
  const data = snapshot.exists() ? snapshot.data() || {} : null;
  if (!isValidPendingSummaryData(data)) {
    throw new Error(
      "은행 승인 대기 요약을 불러올 수 없습니다. 은행 관리 화면에서 요약을 갱신한 뒤 다시 시도해주세요.",
    );
  }
  return normalizePendingSummaryData(data);
};

export const approveMissionForStudents = ({
  classId,
  missionId,
  items,
}) => approveMissionBatch(classId, missionId, items);

export const decidePendingBankApplications = async ({
  classId,
  approve,
  applications,
}) => {
  const response = await approveBankApplications({
    classId,
    approve,
    applications,
  });
  return response?.data || {};
};

export const adjustStudents = (payload) =>
  adjustStudentAssetsService(payload);

export const loadAlwaysMissionAttempts = (payload) =>
  alwaysListAttempts(payload);

export const decideAlwaysMissionAttempts = ({
  classId,
  missionId,
  approve,
  items,
}) => {
  const action = approve ? approveAlwaysAttemptBatch : rejectAlwaysAttemptBatch;
  return action({ classId, missionId, items });
};

export const loadRecentClassActivity = async ({
  classId,
  startDate,
  endDate,
  categoryFilter = "all",
  keyword = "",
  pageSize = 20,
}) => {
  const response = await queryClassActivityLogs({
    classId,
    startDate,
    endDate,
    categoryFilter,
    keyword,
    pageSize,
  });
  return response?.data || { rows: [], hasMore: false };
};

export const loadTaxOverview = async (classId) => {
  const snapshot = await getDoc(
    doc(db, "classes", classId, "dashboardSummary", "taxSummary"),
  );
  if (!snapshot.exists()) {
    throw new Error("세금 재정 요약이 아직 생성되지 않았습니다.");
  }
  return snapshot.data() || {};
};

export const loadPayrollOverview = async (classId, limitCount = 30) => {
  const snapshot = await getDoc(
    doc(db, "classes", classId, "dashboardSummary", "payrollOverview"),
  );
  const data = snapshot.exists() ? snapshot.data() || {} : null;
  if (!isValidPayrollOverviewSummaryData(data)) {
    throw new Error("급여 요약을 불러올 수 없습니다. 급여 화면에서 요약을 갱신해주세요.");
  }
  return normalizePayrollOverviewSummaryData(data, limitCount);
};

export const loadStoreItems = async (classId) => {
  const snapshot = await getDocs(
    collection(db, "classes", classId, "storeItems"),
  );
  return snapshot.docs.map((itemDoc) => ({
    id: itemDoc.id,
    ...itemDoc.data(),
  }));
};

export const loadMarketplaceItems = async ({
  classId,
  status = "pending",
  limitCount = 20,
}) => {
  const itemsRef = collection(db, "classes", classId, "marketplace");
  const constraints = [];
  if (status !== "all") constraints.push(where("status", "==", status));
  constraints.push(limit(Math.min(50, Math.max(1, Number(limitCount) || 20))));
  const snapshot = await getDocs(query(itemsRef, ...constraints));
  return snapshot.docs.map((itemDoc) => ({
    id: itemDoc.id,
    ...itemDoc.data(),
  }));
};

export const decideMarketplaceItem = async ({
  classId,
  itemId,
  approve,
  reason = "",
}) => {
  const response = await approveMarketplaceItem({
    classId,
    itemId,
    approved: approve === true,
    reason: String(reason || "").trim(),
  });
  return response?.data || {};
};

export const navigateToAppPath = async (path) => {
  if (typeof window === "undefined") {
    throw new Error("현재 브라우저에서는 화면을 이동할 수 없습니다.");
  }
  window.location.assign(path);
  return { path };
};

export const loadStudentProfile = async (classId, studentId) => {
  const snapshot = await getDoc(doc(db, "classes", classId, "students", studentId));
  return snapshot.exists() ? { ...snapshot.data(), uid: snapshot.id } : null;
};
export const loadClassStudentProfiles = async (classId) => {
  const snapshot = await getDocs(query(collection(db, "classes", classId, "students"), orderBy("studentNumber", "asc")));
  return snapshot.docs.map((item) => ({ ...item.data(), uid: item.id }));
};

export const DEFAULT_SITE_TOOL_OPERATIONS = Object.freeze({
  loadStudentProfile,
  loadClassStudentProfiles,
  adjustStudents,
  approveMissionForStudents,
  decideAlwaysMissionAttempts,
  decideMarketplaceItem,
  decidePendingBankApplications,
  loadAlwaysMissionAttempts,
  loadClassMissions,
  loadPendingBankApplications,
  loadPayrollOverview,
  loadRecentClassActivity,
  loadMarketplaceItems,
  loadStoreItems,
  loadTaxOverview,
  navigateToAppPath,
});
