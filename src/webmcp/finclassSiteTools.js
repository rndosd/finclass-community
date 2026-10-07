import { extractRewards, getMissionStatus } from "../pages/missions/utils/missionHelpers";
import { getMissionMinTierRequirement, isMissionAssignedToStudent } from "../pages/missions/utils/missionEligibility";
import { normalizeStoreItemSaleStatus } from "../pages/store/utils/storeSaleStatus";
import { DEFAULT_SITE_TOOL_OPERATIONS } from "./finclassSiteToolOperations";

const READ_ONLY_ANNOTATIONS = Object.freeze({ readOnlyHint: true });
const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  idempotentHint: false,
});

const APP_SECTION_PATHS = Object.freeze({
  home: "/dashboard",
  personal_assets: "/assets",
  students: "/manage/assets",
  permissions: "/manage/permissions",
  dashboard_settings: "/manage/dashboard",
  time_settings: "/manage/time-settings",
  student_registration: "/manage/students/create",
  student_deletion: "/manage/students/delete",
  news: "/news",
  credit: "/credit",
  missions: "/missions",
  bank: "/bank",
  tax: "/tax",
  labor: "/labor",
  police: "/police",
  store: "/store",
  marketplace: "/marketplace",
  stock: "/stock",
  realestate: "/realestate",
  jobs: "/job-board",
  assembly: "/assembly",
  credentials: "/credentials",
  arcade: "/arcade",
  case_library: "/case-library",
});

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false,
});

const normalizeSearchText = (value) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "");

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clampLimit = (value, fallback = 20) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(50, Math.max(1, parsed));
};

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoString = (value) => toDate(value)?.toISOString() || null;

const getStudentId = (student = {}) => student.uid || student.id || null;

const assertTeacherContext = (getContext) => {
  const context = getContext?.() || {};
  if (context.loading) {
    throw new Error("핀클래스 로그인 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
  }

  const role = String(context.userData?.role || "");
  if (!context.classId || !["teacher", "admin"].includes(role)) {
    throw new Error("현재 로그인한 교사 또는 관리자만 이 핀클래스 도구를 사용할 수 있습니다.");
  }
  if (context.isAccountSwitching) {
    throw new Error("학생 계정으로 전환한 동안에는 교사용 핀클래스 도구를 사용할 수 없습니다.");
  }

  if (context.studentRosterLoading || context.studentRosterError) {
    throw new Error("학생 명단을 불러오지 못했거나 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
  }
  return context;
};

const assertPermission = (context, permission, label) => {
  if (typeof context.hasPermission === "function" && !context.hasPermission(permission)) {
    throw new Error(`${label} 권한이 필요합니다.`);
  }
};

const summarizeStudent = (student = {}) => ({
  studentId: getStudentId(student),
  name: String(student.name || "").trim() || "이름 없음",
  studentNumber: student.studentNumber ?? null,
});

const getSortedStudents = (context) =>
  [...(Array.isArray(context.studentList) ? context.studentList : [])].sort(
    (left, right) => {
      const leftNumber = Number(left?.studentNumber);
      const rightNumber = Number(right?.studentNumber);
      const safeLeftNumber = Number.isFinite(leftNumber)
        ? leftNumber
        : Number.MAX_SAFE_INTEGER;
      const safeRightNumber = Number.isFinite(rightNumber)
        ? rightNumber
        : Number.MAX_SAFE_INTEGER;
      if (safeLeftNumber !== safeRightNumber) {
        return safeLeftNumber - safeRightNumber;
      }
      return String(left?.name || "").localeCompare(String(right?.name || ""), "ko");
    },
  );

const getStudentFinancialSummary = (student = {}) => {
  const assets = student.assets || {};
  return {
    cash: toSafeNumber(assets.cash),
    deposit: toSafeNumber(assets.deposit),
    loan: toSafeNumber(assets.loan),
    totalNetWorth: toSafeNumber(assets.totalNetWorth),
    creditScore: toSafeNumber(student.creditScore),
    missionToken: toSafeNumber(student.missionToken ?? assets.missionToken),
  };
};

const findStudent = (context, studentId) =>
  (Array.isArray(context.studentList) ? context.studentList : []).find(
    (student) => String(getStudentId(student) || "") === String(studentId || "").trim(),
  );

const requireStudents = (context, studentIds, maximum = 50) => {
  const normalizedIds = [...new Set(
    (Array.isArray(studentIds) ? studentIds : [])
      .map((studentId) => String(studentId || "").trim())
      .filter(Boolean),
  )];
  if (normalizedIds.length === 0) throw new Error("대상 학생 ID가 필요합니다.");
  if (normalizedIds.length > maximum) {
    throw new Error(`한 번에 최대 ${maximum}명까지 처리할 수 있습니다.`);
  }

  const students = normalizedIds.map((studentId) => findStudent(context, studentId));
  const missingIds = normalizedIds.filter((studentId, index) => !students[index]);
  if (missingIds.length > 0) {
    throw new Error("현재 학급에 속하지 않은 학생이 포함되어 있습니다.");
  }
  return students;
};

const summarizeMission = (mission = {}) => {
  const rewards = extractRewards(mission);
  const completions = Object.values(mission.completions || {});
  return {
    missionId: mission.id || null,
    title: String(mission.title || "").trim() || "제목 없음",
    type: mission.type || "mission",
    isActive: mission.isActive !== false,
    startsAt: toIsoString(mission.timeWindow?.start || mission.startDate),
    endsAt: toIsoString(mission.timeWindow?.end || mission.endDate),
    rewards,
    statusCounts: {
      pending: completions.filter((entry) => ["pending", "late"].includes(entry?.status)).length,
      approved: completions.filter((entry) => entry?.status === "approved").length,
      rejected: completions.filter((entry) => entry?.status === "rejected").length,
    },
  };
};

const getMissionById = async (operations, context, missionId) => {
  const normalizedMissionId = String(missionId || "").trim();
  if (!normalizedMissionId) throw new Error("미션 ID가 필요합니다.");
  const missions = await operations.loadClassMissions(context.classId);
  const mission = missions.find((item) => String(item?.id || "") === normalizedMissionId);
  if (!mission) throw new Error("현재 학급에서 해당 미션을 찾을 수 없습니다.");
  return mission;
};

const matchesOptionalRange = (value, minimum, maximum) => {
  if (minimum !== undefined && value < Number(minimum)) return false;
  if (maximum !== undefined && value > Number(maximum)) return false;
  return true;
};

const getDefaultActivityRange = () => {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

const normalizeDateString = (value, fallback) => {
  const normalized = String(value || fallback || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  }
  return normalized;
};

const summarizeAlwaysAttempt = (attempt = {}, context) => {
  const student = findStudent(context, attempt.studentUid);
  return {
    attemptId: attempt.id || attempt.attemptId || null,
    missionId: attempt.missionId || null,
    student: student
      ? summarizeStudent(student)
      : {
          studentId: attempt.studentUid || null,
          name: attempt.studentName || "이름 없음",
          studentNumber: attempt.studentNumber ?? null,
        },
    status: attempt.status || "unknown",
    dayKey: attempt.dayKey || null,
    content: String(attempt.contentText || attempt.content || "").slice(0, 500),
    createdAt: attempt.createdAtMs
      ? new Date(attempt.createdAtMs).toISOString()
      : toIsoString(attempt.createdAt),
  };
};

const summarizeActivity = (activity = {}, context) => {
  const student = findStudent(context, activity.studentUid);
  return {
    activityId: activity.id || null,
    student: student
      ? summarizeStudent(student)
      : {
          studentId: activity.studentUid || null,
          name: "이름 없음",
          studentNumber: null,
        },
    category: activity.category || activity.type || "unknown",
    description: String(
      activity.description || activity.reason || activity.note || activity.title || "",
    ).slice(0, 500),
    amount: toSafeNumber(
      activity.amountInClassCurrency ??
        activity.amount ??
        activity.delta ??
        activity.adjustmentDelta,
    ),
    createdAt: activity.createdAtMs
      ? new Date(activity.createdAtMs).toISOString()
      : activity.timestampMs
        ? new Date(activity.timestampMs).toISOString()
        : null,
  };
};

const summarizeStoreItem = (item = {}, context) => {
  const stock = Number(item.stock);
  return {
    itemId: item.id || null,
    name: String(item.name || item.title || "").trim() || "상품명 없음",
    description: String(item.description || "").trim().slice(0, 500),
    categoryId: item.categoryId || null,
    price: toSafeNumber(item.price),
    currencyType: ["missionToken", "usdBalance"].includes(item.currencyType) ? item.currencyType : "cash",
    currencyUnit:
      item.currencyType === "usdBalance"
        ? "FIN"
        : item.currencyType === "missionToken"
        ? context.missionTokenLabel || "미션토큰"
        : context.currencyUnit || context.classData?.currencyUnit || "원",
    stock: Number.isFinite(stock) ? stock : null,
    unlimitedStock: stock === -1,
    saleStatus: normalizeStoreItemSaleStatus(item),
    isGiftAllowed: item.isGiftAllowed !== false,
    isTaxable: item.isTaxable !== false,
  };
};

const summarizeMarketplaceItem = (item = {}) => ({
  itemId: item.id || null,
  title: String(item.title || "").trim() || "제목 없음",
  description: String(item.description || "").trim().slice(0, 500),
  category: item.category || null,
  price: toSafeNumber(item.price),
  stock: Math.max(0, toSafeNumber(item.stock ?? 1)),
  soldQuantity: Math.max(0, toSafeNumber(item.soldQuantity)),
  sellerId: item.sellerId || null,
  sellerName: String(item.sellerName || "").trim() || "등록자 미상",
  status: item.status || (item.approved ? "active" : "pending"),
  createdAt: toIsoString(item.createdAt),
});

export const buildFinclassSiteTools = (
  getContext,
  operations = DEFAULT_SITE_TOOL_OPERATIONS,
) => [
  {
    name: "finclass_get_current_class",
    description:
      "현재 로그인한 교사가 관리하는 핀클래스 학급과 현재 페이지의 읽기 전용 요약을 조회합니다.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async () => {
      const context = assertTeacherContext(getContext);
      const classData = context.classData || {};
      return {
        className:
          String(classData.className || classData.name || "").trim() || "우리 반",
        teacherName:
          String(context.teacherDisplayName || context.userData?.name || "").trim() ||
          "선생님",
        role: context.userData?.role || null,
        currentPath: context.currentPath || "/",
        studentCount: Array.isArray(context.studentList)
          ? context.studentList.length
          : 0,
        currencyUnit: context.currencyUnit || classData.currencyUnit || "원",
        missionTokenLabel: context.missionTokenLabel || "미션토큰",
      };
    },
  },
  {
    name: "finclass_search_students",
    description:
      "현재 학급의 학생을 이름, 번호 또는 학생 ID로 검색합니다. 빈 검색어이면 번호순으로 학생을 조회합니다.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "학생 이름, 번호 또는 앞 단계에서 받은 학생 ID. 빈 문자열도 허용됩니다.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "반환할 최대 학생 수. 기본값은 20명입니다.",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({ query = "", limit = 20 } = {}) => {
      const context = assertTeacherContext(getContext);
      const normalizedQuery = normalizeSearchText(query);
      const students = getSortedStudents(context);
      const matches = normalizedQuery
        ? students.filter((student) => {
            const searchableValues = [
              student?.name,
              student?.studentNumber,
              student?.uid,
              student?.id,
            ];
            return searchableValues.some((value) =>
              normalizeSearchText(value).includes(normalizedQuery),
            );
          })
        : students;
      const resultLimit = clampLimit(limit);

      return {
        query: String(query || ""),
        totalMatches: matches.length,
        returnedCount: Math.min(matches.length, resultLimit),
        truncated: matches.length > resultLimit,
        students: matches.slice(0, resultLimit).map(summarizeStudent),
      };
    },
  },
  {
    name: "finclass_get_student_financial_summary",
    description:
      "학생 검색 결과의 학생 ID를 사용해 현재 학급 학생의 현금, 예금, 대출, 순자산, 신용점수와 미션토큰을 조회합니다.",
    inputSchema: {
      type: "object",
      properties: {
        studentId: {
          type: "string",
          minLength: 1,
          description: "finclass_search_students가 반환한 학생 ID",
        },
      },
      required: ["studentId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({ studentId } = {}) => {
      const context = assertTeacherContext(getContext);
      const normalizedStudentId = String(studentId || "").trim();
      if (!normalizedStudentId) {
        throw new Error("조회할 학생 ID가 필요합니다.");
      }

      let student = (Array.isArray(context.studentList)
        ? context.studentList
        : []
      ).find(
        (item) => String(item?.uid || item?.id || "") === normalizedStudentId,
      );
      if (!student) {
        throw new Error("현재 학급에서 해당 학생을 찾을 수 없습니다.");
      }
      if (context.studentRosterOnly) {
        student = await operations.loadStudentProfile(context.classId, normalizedStudentId);
        if (!student) throw new Error("현재 학급에서 해당 학생을 찾을 수 없습니다.");
      }

      return {
        student: summarizeStudent(student),
        currencyUnit: context.currencyUnit || context.classData?.currencyUnit || "원",
        missionTokenLabel: context.missionTokenLabel || "미션토큰",
        financialSummary: getStudentFinancialSummary(student),
      };
    },
  },
  {
    name: "finclass_find_students_by_financial_condition",
    description:
      "현재 학급에서 현금, 예금, 대출, 순자산, 신용점수 또는 미션토큰 범위에 맞는 학생을 찾습니다.",
    inputSchema: {
      type: "object",
      properties: {
        minCash: { type: "number" },
        maxCash: { type: "number" },
        minDeposit: { type: "number" },
        maxDeposit: { type: "number" },
        minLoan: { type: "number" },
        maxLoan: { type: "number" },
        minNetWorth: { type: "number" },
        maxNetWorth: { type: "number" },
        minCreditScore: { type: "number" },
        maxCreditScore: { type: "number" },
        minMissionToken: { type: "number" },
        maxMissionToken: { type: "number" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async (filters = {}) => {
      const context = assertTeacherContext(getContext);
      const profiles = context.studentRosterOnly
        ? await operations.loadClassStudentProfiles(context.classId) : context.studentList;
      const matches = getSortedStudents({ ...context, studentList: profiles }).filter((student) => {
        const summary = getStudentFinancialSummary(student);
        return (
          matchesOptionalRange(summary.cash, filters.minCash, filters.maxCash) &&
          matchesOptionalRange(summary.deposit, filters.minDeposit, filters.maxDeposit) &&
          matchesOptionalRange(summary.loan, filters.minLoan, filters.maxLoan) &&
          matchesOptionalRange(summary.totalNetWorth, filters.minNetWorth, filters.maxNetWorth) &&
          matchesOptionalRange(summary.creditScore, filters.minCreditScore, filters.maxCreditScore) &&
          matchesOptionalRange(summary.missionToken, filters.minMissionToken, filters.maxMissionToken)
        );
      });
      const limit = clampLimit(filters.limit);
      return {
        totalMatches: matches.length,
        returnedCount: Math.min(matches.length, limit),
        truncated: matches.length > limit,
        students: matches.slice(0, limit).map((student) => ({
          ...summarizeStudent(student),
          financialSummary: getStudentFinancialSummary(student),
        })),
      };
    },
  },
  {
    name: "finclass_get_class_economy_overview",
    description:
      "현재 학급 학생들의 현금, 예금, 대출, 순자산, 신용점수와 미션토큰 합계·평균을 조회합니다.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async () => {
      const context = assertTeacherContext(getContext);
      const profiles = context.studentRosterOnly
        ? await operations.loadClassStudentProfiles(context.classId) : context.studentList;
      const summaries = getSortedStudents({ ...context, studentList: profiles }).map(getStudentFinancialSummary);
      const fields = [
        "cash",
        "deposit",
        "loan",
        "totalNetWorth",
        "creditScore",
        "missionToken",
      ];
      const totals = Object.fromEntries(
        fields.map((field) => [
          field,
          summaries.reduce((sum, summary) => sum + summary[field], 0),
        ]),
      );
      const studentCount = summaries.length;
      const averages = Object.fromEntries(
        fields.map((field) => [
          field,
          studentCount > 0 ? Math.round((totals[field] / studentCount) * 100) / 100 : 0,
        ]),
      );
      return {
        studentCount,
        currencyUnit: context.currencyUnit || context.classData?.currencyUnit || "원",
        missionTokenLabel: context.missionTokenLabel || "미션토큰",
        totals,
        averages,
      };
    },
  },
  {
    name: "finclass_list_missions",
    description:
      "현재 학급의 일반·상시 미션을 제목으로 검색하고 보상과 승인 상태 요약을 조회합니다.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "미션 제목 검색어. 빈 문자열이면 전체 조회" },
        activeOnly: { type: "boolean", description: "활성 미션만 조회할지 여부. 기본값 true" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({ query = "", activeOnly = true, limit = 20 } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "mission_admin", "미션 관리");
      const normalizedQuery = normalizeSearchText(query);
      const missions = (await operations.loadClassMissions(context.classId))
        .filter((mission) => !activeOnly || mission.isActive !== false)
        .filter((mission) =>
          !normalizedQuery || normalizeSearchText(mission.title).includes(normalizedQuery),
        );
      const resultLimit = clampLimit(limit);
      return {
        query: String(query || ""),
        totalMatches: missions.length,
        returnedCount: Math.min(missions.length, resultLimit),
        truncated: missions.length > resultLimit,
        missions: missions.slice(0, resultLimit).map(summarizeMission),
      };
    },
  },
  {
    name: "finclass_get_mission_student_statuses",
    description:
      "미션 ID를 사용해 현재 학급 학생들의 해당 미션 제출·승인 상태를 조회합니다.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string", minLength: 1 },
        studentIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          maxItems: 50,
          description: "생략하면 현재 학급 전체 학생을 조회합니다.",
        },
        status: {
          type: "string",
          enum: ["not_submitted", "pending", "late", "approved", "late-approved", "rejected", "cancelled"],
          description: "특정 상태만 필터링할 때 사용합니다.",
        },
      },
      required: ["missionId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({ missionId, studentIds, status } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "mission_admin", "미션 관리");
      const mission = await getMissionById(operations, context, missionId);
      let students = Array.isArray(studentIds) && studentIds.length > 0
        ? requireStudents(context, studentIds)
        : getSortedStudents(context).slice(0, 50);
      if (context.studentRosterOnly && getMissionMinTierRequirement(mission)) {
        students = await Promise.all(students.map(async (student) => {
          const profile = await operations.loadStudentProfile(context.classId, getStudentId(student));
          if (!profile) throw new Error("현재 학급에서 해당 학생을 찾을 수 없습니다.");
          return profile;
        }));
      }
      const statuses = students
        .filter((student) => isMissionAssignedToStudent(mission, student, getStudentId(student)))
        .map((student) => ({
          ...summarizeStudent(student),
          status: getMissionStatus(mission, getStudentId(student)),
        }))
        .filter((entry) => !status || entry.status === status);
      return {
        mission: summarizeMission(mission),
        returnedCount: statuses.length,
        statuses,
      };
    },
  },
  {
    name: "finclass_approve_mission_students",
    description:
      "현재 학급의 일반 미션에서 승인 대기 또는 지각 제출 상태인 학생들을 승인하고 기존 미션 보상을 지급합니다. 실제 학급 기록과 자산이 변경됩니다.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string", minLength: 1 },
        studentIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 50,
        },
        feedback: { type: "string", maxLength: 500 },
      },
      required: ["missionId", "studentIds"],
      additionalProperties: false,
    },
    annotations: WRITE_ANNOTATIONS,
    execute: async ({ missionId, studentIds, feedback = "" } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "mission_admin", "미션 관리");
      const mission = await getMissionById(operations, context, missionId);
      if (mission.type === "always") {
        throw new Error("상시 미션 승인은 별도 이력 도구가 필요합니다. 현재 도구는 일반 미션만 지원합니다.");
      }
      const students = requireStudents(context, studentIds);
      const invalidStudents = students.filter(
        (student) => !["pending", "late"].includes(getMissionStatus(mission, getStudentId(student))),
      );
      if (invalidStudents.length > 0) {
        throw new Error(
          `승인 대기 상태가 아닌 학생이 포함되어 있습니다: ${invalidStudents.map((student) => student.name).join(", ")}`,
        );
      }
      const items = students.map((student) => {
        const studentId = getStudentId(student);
        return {
          uid: studentId,
          submissionId:
            mission.submissionsIndex?.[studentId] ||
            mission.completions?.[studentId]?.submissionId ||
            null,
          feedback: String(feedback || "").trim() || null,
        };
      });
      const result = await operations.approveMissionForStudents({
        classId: context.classId,
        missionId: mission.id,
        items,
      });
      return {
        success: result?.success !== false,
        message: result?.message || "미션 승인이 완료되었습니다.",
        mission: summarizeMission(mission),
        approvedStudents: students.map(summarizeStudent),
      };
    },
  },
  {
    name: "finclass_list_pending_bank_applications",
    description:
      "현재 학급의 승인 대기 중인 예금 또는 대출 신청을 조회합니다.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["saving", "loan", "all"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({ kind = "all", limit = 20 } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "bank_admin", "은행 관리");
      const summary = await operations.loadPendingBankApplications(context.classId);
      const rows = [
        ...(kind === "loan" ? [] : summary.pendingSavings.map((row) => ({ ...row, kind: "saving" }))),
        ...(kind === "saving" ? [] : summary.pendingLoans.map((row) => ({ ...row, kind: "loan" }))),
      ];
      const resultLimit = clampLimit(limit);
      return {
        counts: summary.counts,
        returnedCount: Math.min(rows.length, resultLimit),
        truncated: rows.length > resultLimit,
        applications: rows.slice(0, resultLimit).map((row) => ({
          applicationId: row.id || null,
          kind: row.kind,
          studentId: row.studentUid || null,
          studentName: row.studentName || "이름 없음",
          productName: row.productName || row.name || null,
          amount: toSafeNumber(row.amount || row.principal),
          createdAt: toIsoString(row.createdAt),
        })),
      };
    },
  },
  {
    name: "finclass_decide_bank_applications",
    description:
      "승인 대기 목록에서 받은 예금·대출 신청 ID들을 승인하거나 거절합니다. 실제 금융 기록이 변경됩니다.",
    inputSchema: {
      type: "object",
      properties: {
        applicationIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 50,
        },
        approve: { type: "boolean", description: "true이면 승인, false이면 거절" },
      },
      required: ["applicationIds", "approve"],
      additionalProperties: false,
    },
    annotations: WRITE_ANNOTATIONS,
    execute: async ({ applicationIds, approve } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "bank_admin", "은행 관리");
      const normalizedIds = [...new Set(
        (Array.isArray(applicationIds) ? applicationIds : [])
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      )];
      if (normalizedIds.length === 0 || normalizedIds.length > 50) {
        throw new Error("신청 ID는 한 번에 1~50개가 필요합니다.");
      }
      const summary = await operations.loadPendingBankApplications(context.classId);
      const pendingRows = [
        ...summary.pendingSavings.map((row) => ({ ...row, kind: "saving" })),
        ...summary.pendingLoans.map((row) => ({ ...row, kind: "loan" })),
      ];
      const applications = normalizedIds.map((applicationId) => {
        const row = pendingRows.find((item) => String(item.id || "") === applicationId);
        if (!row?.studentUid) {
          throw new Error("현재 승인 대기 목록에 없는 신청이 포함되어 있습니다.");
        }
        return {
          applicationId,
          studentUid: row.studentUid,
          kind: row.kind,
        };
      });
      const result = await operations.decidePendingBankApplications({
        classId: context.classId,
        approve: approve === true,
        applications,
      });
      return {
        success: result?.success !== false,
        decision: approve === true ? "approved" : "rejected",
        processedCount: applications.length,
        applications: applications.map(({ applicationId, kind }) => ({ applicationId, kind })),
      };
    },
  },
  {
    name: "finclass_adjust_student_assets",
    description:
      "현재 학급 학생들의 현금 자산, 신용점수 또는 미션토큰을 같은 값만큼 증감합니다. 실제 학생 기록이 변경되며 사유가 기록됩니다.",
    inputSchema: {
      type: "object",
      properties: {
        studentIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 50,
        },
        adjustType: { type: "string", enum: ["asset", "credit", "missionToken"] },
        amount: { type: "number", description: "양수는 지급·증가, 음수는 차감·감소" },
        reason: { type: "string", minLength: 2, maxLength: 200 },
      },
      required: ["studentIds", "adjustType", "amount", "reason"],
      additionalProperties: false,
    },
    annotations: WRITE_ANNOTATIONS,
    execute: async ({ studentIds, adjustType, amount, reason } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "asset_manager_manage", "학생 자산 관리");
      const students = requireStudents(context, studentIds);
      const delta = Number(amount);
      if (!Number.isFinite(delta) || delta === 0) {
        throw new Error("증감액은 0이 아닌 유효한 숫자여야 합니다.");
      }
      const normalizedReason = String(reason || "").trim();
      if (normalizedReason.length < 2) throw new Error("조정 사유를 2자 이상 입력해주세요.");
      const result = await operations.adjustStudents({
        classId: context.classId,
        adjustType,
        mode: "increment",
        increments: students.map((student) => ({
          uid: getStudentId(student),
          amount: delta,
          reason: normalizedReason,
        })),
      });
      return {
        success: result?.success !== false,
        message: result?.message || "학생 기록 조정이 완료되었습니다.",
        adjustType,
        amount: delta,
        reason: normalizedReason,
        affectedStudents: students.map(summarizeStudent),
      };
    },
  },
  {
    name: "finclass_list_always_mission_attempts",
    description:
      "상시 미션의 학생별 수행 이력을 날짜와 상태로 조회합니다. 승인에 필요한 시도 ID를 반환합니다.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string", minLength: 1 },
        studentIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          maxItems: 50,
        },
        dateFrom: { type: "string", description: "YYYY-MM-DD, 기본값은 7일 전" },
        dateTo: { type: "string", description: "YYYY-MM-DD, 기본값은 오늘" },
        status: { type: "string", enum: ["pending", "approved", "rejected", "canceled"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["missionId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({
      missionId,
      studentIds = [],
      dateFrom,
      dateTo,
      status,
      limit = 20,
    } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "mission_admin", "미션 관리");
      const mission = await getMissionById(operations, context, missionId);
      if (mission.type !== "always") throw new Error("상시 미션 ID가 필요합니다.");
      const range = getDefaultActivityRange();
      const normalizedDateFrom = normalizeDateString(dateFrom, range.startDate);
      const normalizedDateTo = normalizeDateString(dateTo, range.endDate);
      if (normalizedDateFrom > normalizedDateTo) {
        throw new Error("시작일은 종료일보다 늦을 수 없습니다.");
      }
      const students = studentIds.length > 0 ? requireStudents(context, studentIds) : [];
      const response = await operations.loadAlwaysMissionAttempts({
        classId: context.classId,
        missionId: mission.id,
        allStudents: students.length === 0,
        studentUids: students.map(getStudentId),
        dateFrom: normalizedDateFrom,
        dateTo: normalizedDateTo,
        limit: clampLimit(limit),
        view: "attempts",
      });
      const attempts = (Array.isArray(response?.attempts) ? response.attempts : [])
        .filter((attempt) => !status || attempt.status === status)
        .slice(0, clampLimit(limit));
      return {
        mission: summarizeMission(mission),
        dateFrom: normalizedDateFrom,
        dateTo: normalizedDateTo,
        returnedCount: attempts.length,
        hasMore: !!response?.hasMore,
        attempts: attempts.map((attempt) => summarizeAlwaysAttempt(attempt, context)),
      };
    },
  },
  {
    name: "finclass_decide_always_mission_attempts",
    description:
      "상시 미션 수행 이력 ID들을 승인하거나 반려합니다. 승인 시 설정된 보상이 실제로 지급됩니다.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string", minLength: 1 },
        attempts: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              attemptId: { type: "string", minLength: 1 },
              studentId: { type: "string", minLength: 1 },
            },
            required: ["attemptId", "studentId"],
            additionalProperties: false,
          },
        },
        approve: { type: "boolean", description: "true이면 승인, false이면 반려" },
        feedback: { type: "string", maxLength: 500 },
      },
      required: ["missionId", "attempts", "approve"],
      additionalProperties: false,
    },
    annotations: WRITE_ANNOTATIONS,
    execute: async ({ missionId, attempts, approve, feedback = "" } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "mission_admin", "미션 관리");
      const mission = await getMissionById(operations, context, missionId);
      if (mission.type !== "always") throw new Error("상시 미션 ID가 필요합니다.");
      const normalizedAttempts = Array.isArray(attempts) ? attempts : [];
      if (normalizedAttempts.length === 0 || normalizedAttempts.length > 50) {
        throw new Error("수행 이력은 한 번에 1~50개가 필요합니다.");
      }
      requireStudents(
        context,
        normalizedAttempts.map((attempt) => attempt.studentId),
      );
      const seenAttemptIds = new Set();
      const items = normalizedAttempts.map((attempt) => {
        const attemptId = String(attempt.attemptId || "").trim();
        const studentUid = String(attempt.studentId || "").trim();
        if (!attemptId || seenAttemptIds.has(attemptId)) {
          throw new Error("비어 있거나 중복된 수행 이력 ID가 포함되어 있습니다.");
        }
        seenAttemptIds.add(attemptId);
        return {
          attemptId,
          studentUid,
          feedback: String(feedback || "").trim() || null,
          reason: String(feedback || "").trim() || null,
        };
      });
      const result = await operations.decideAlwaysMissionAttempts({
        classId: context.classId,
        missionId: mission.id,
        approve: approve === true,
        items,
      });
      return {
        success: result?.success !== false,
        message:
          result?.message ||
          (approve === true ? "상시 미션 승인이 완료되었습니다." : "상시 미션 반려가 완료되었습니다."),
        decision: approve === true ? "approved" : "rejected",
        processedCount: items.length,
      };
    },
  },
  {
    name: "finclass_get_recent_class_activity",
    description:
      "최근 학급 경제 활동을 날짜, 학생, 분류 또는 검색어로 조회합니다. 지급·구매·이체 등의 기록을 확인할 수 있습니다.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD, 기본값은 7일 전" },
        endDate: { type: "string", description: "YYYY-MM-DD, 기본값은 오늘" },
        studentIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          maxItems: 50,
        },
        category: { type: "string", maxLength: 80 },
        keyword: { type: "string", maxLength: 100 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({
      startDate,
      endDate,
      studentIds = [],
      category = "all",
      keyword = "",
      limit = 20,
    } = {}) => {
      const context = assertTeacherContext(getContext);
      const range = getDefaultActivityRange();
      const normalizedStartDate = normalizeDateString(startDate, range.startDate);
      const normalizedEndDate = normalizeDateString(endDate, range.endDate);
      if (normalizedStartDate > normalizedEndDate) {
        throw new Error("시작일은 종료일보다 늦을 수 없습니다.");
      }
      const students = studentIds.length > 0 ? requireStudents(context, studentIds) : [];
      const response = await operations.loadRecentClassActivity({
        classId: context.classId,
        startDate: normalizedStartDate,
        endDate: normalizedEndDate,
        categoryFilter: String(category || "all").trim() || "all",
        keyword: String(keyword || "").trim(),
        pageSize: clampLimit(limit),
      });
      const allowedStudentIds = new Set(students.map(getStudentId));
      const rows = (Array.isArray(response?.rows) ? response.rows : [])
        .filter((row) => students.length === 0 || allowedStudentIds.has(row.studentUid))
        .slice(0, clampLimit(limit));
      return {
        startDate: normalizedStartDate,
        endDate: normalizedEndDate,
        returnedCount: rows.length,
        hasMore: !!response?.hasMore,
        activities: rows.map((row) => summarizeActivity(row, context)),
      };
    },
  },
  {
    name: "finclass_get_tax_overview",
    description:
      "현재 학급 국고의 총수입, 총지출, 잔액과 세목·지출 분류별 합계를 조회합니다.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async () => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "tax_admin", "세금 관리");
      const summary = await operations.loadTaxOverview(context.classId);
      const totalIncome = toSafeNumber(summary.totalIncome);
      const totalExpense = toSafeNumber(summary.totalExpense);
      return {
        currencyUnit: context.currencyUnit || context.classData?.currencyUnit || "원",
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
        byTaxType: summary.byTaxType || {},
        byCategory: summary.byCategory || {},
        updatedAt: toIsoString(summary.updatedAt || summary.lastRebuiltAt),
      };
    },
  },
  {
    name: "finclass_get_payroll_overview",
    description:
      "최근 급여·보너스 지급 건수와 순지급액, 학생별 최근 급여명세를 조회합니다.",
    inputSchema: {
      type: "object",
      properties: {
        studentIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          maxItems: 50,
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({ studentIds = [], limit = 20 } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "labor_admin", "급여 관리");
      const students = studentIds.length > 0 ? requireStudents(context, studentIds) : [];
      const resultLimit = clampLimit(limit);
      const summary = await operations.loadPayrollOverview(context.classId, resultLimit);
      const allowedStudentIds = new Set(students.map(getStudentId));
      const payslips = (Array.isArray(summary.recentPayslips) ? summary.recentPayslips : [])
        .filter((row) => students.length === 0 || allowedStudentIds.has(row.studentUid))
        .slice(0, resultLimit)
        .map((row) => ({
          payslipId: row.id || null,
          student: findStudent(context, row.studentUid)
            ? summarizeStudent(findStudent(context, row.studentUid))
            : { studentId: row.studentUid || null, name: row.studentName || "이름 없음", studentNumber: null },
          slipType: row.slipType || "salary",
          paymentPeriod: row.paymentPeriodDescription || row.payrollPeriodKey || null,
          totalBaseSalary: toSafeNumber(row.totalBaseSalary),
          totalDeductions: toSafeNumber(row.totalDeductions),
          totalBonusAmount: toSafeNumber(row.totalBonusAmount),
          netSalary: toSafeNumber(row.netSalary),
          createdAt: toIsoString(row.createdAt),
        }));
      return {
        currencyUnit: context.currencyUnit || context.classData?.currencyUnit || "원",
        stats: summary.stats,
        returnedCount: payslips.length,
        payslips,
      };
    },
  },
  {
    name: "finclass_list_store_items",
    description:
      "현재 학급 상점의 상품, 가격, 재고와 판매 상태를 조회합니다. 숨김 상품도 교사용으로 조회할 수 있습니다.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 100 },
        saleStatus: {
          type: "string",
          enum: ["hidden", "display_only", "for_sale", "all"],
        },
        currencyType: {
          type: "string",
          enum: ["cash", "missionToken", "usdBalance", "all"],
        },
        inStockOnly: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({
      query = "",
      saleStatus = "all",
      currencyType = "all",
      inStockOnly = false,
      limit = 20,
    } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "store_admin", "상점 관리");
      const keyword = normalizeSearchText(query);
      const items = await operations.loadStoreItems(context.classId);
      const matches = items
        .map((item) => summarizeStoreItem(item, context))
        .filter((item) => {
          const matchesKeyword =
            !keyword ||
            normalizeSearchText(`${item.name} ${item.description}`).includes(keyword);
          const matchesSaleStatus =
            saleStatus === "all" || item.saleStatus === saleStatus;
          const matchesCurrency =
            currencyType === "all" || item.currencyType === currencyType;
          const matchesStock =
            !inStockOnly || item.unlimitedStock || Number(item.stock) > 0;
          return matchesKeyword && matchesSaleStatus && matchesCurrency && matchesStock;
        });
      const resultLimit = clampLimit(limit);
      return {
        totalMatches: matches.length,
        returnedCount: Math.min(matches.length, resultLimit),
        truncated: matches.length > resultLimit,
        items: matches.slice(0, resultLimit),
      };
    },
  },
  {
    name: "finclass_list_marketplace_items",
    description:
      "현재 학급 중고마켓 등록 상품을 상태별로 조회합니다. 승인·반려에 필요한 상품 ID를 반환합니다.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "active", "sold", "rejected", "all"],
        },
        query: { type: "string", maxLength: 100 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async ({ status = "pending", query = "", limit = 20 } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "marketplace_admin", "중고마켓 관리");
      const resultLimit = clampLimit(limit);
      const keyword = normalizeSearchText(query);
      const items = await operations.loadMarketplaceItems({
        classId: context.classId,
        status,
        limitCount: 50,
      });
      const matches = items
        .map(summarizeMarketplaceItem)
        .filter(
          (item) =>
            !keyword ||
            normalizeSearchText(
              `${item.title} ${item.description} ${item.sellerName}`,
            ).includes(keyword),
        );
      return {
        status,
        returnedCount: Math.min(matches.length, resultLimit),
        truncated: matches.length > resultLimit,
        items: matches.slice(0, resultLimit),
      };
    },
  },
  {
    name: "finclass_decide_marketplace_items",
    description:
      "현재 승인 대기 중인 중고마켓 상품을 승인하거나 반려합니다. 실제 상품 공개 상태가 변경되며 일부 항목만 처리될 수 있습니다.",
    inputSchema: {
      type: "object",
      properties: {
        itemIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 20,
        },
        approve: {
          type: "boolean",
          description: "true이면 승인, false이면 반려",
        },
        reason: {
          type: "string",
          maxLength: 300,
          description: "반려 시 사유. 승인 시에는 선택 사항",
        },
      },
      required: ["itemIds", "approve"],
      additionalProperties: false,
    },
    annotations: WRITE_ANNOTATIONS,
    execute: async ({ itemIds, approve, reason = "" } = {}) => {
      const context = assertTeacherContext(getContext);
      assertPermission(context, "marketplace_admin", "중고마켓 관리");
      const normalizedIds = [...new Set(
        (Array.isArray(itemIds) ? itemIds : [])
          .map((itemId) => String(itemId || "").trim())
          .filter(Boolean),
      )];
      if (normalizedIds.length === 0 || normalizedIds.length > 20) {
        throw new Error("상품 ID는 한 번에 1~20개가 필요합니다.");
      }
      const normalizedReason = String(reason || "").trim();
      if (approve !== true && normalizedReason.length < 2) {
        throw new Error("반려 사유를 2자 이상 입력해주세요.");
      }
      const pendingItems = await operations.loadMarketplaceItems({
        classId: context.classId,
        status: "pending",
        limitCount: 50,
      });
      const pendingById = new Map(
        pendingItems.map((item) => [String(item.id || ""), item]),
      );
      const targets = normalizedIds.map((itemId) => {
        const item = pendingById.get(itemId);
        if (!item) {
          throw new Error("현재 승인 대기 목록에 없는 중고마켓 상품이 포함되어 있습니다.");
        }
        return item;
      });
      const settled = await Promise.allSettled(
        targets.map((item) =>
          operations.decideMarketplaceItem({
            classId: context.classId,
            itemId: item.id,
            approve: approve === true,
            reason: normalizedReason,
          }),
        ),
      );
      const results = settled.map((result, index) => ({
        item: summarizeMarketplaceItem(targets[index]),
        success: result.status === "fulfilled" && result.value?.success !== false,
        message:
          result.status === "fulfilled"
            ? result.value?.message || null
            : String(result.reason?.message || "처리에 실패했습니다."),
      }));
      return {
        success: results.every((result) => result.success),
        decision: approve === true ? "approved" : "rejected",
        requestedCount: targets.length,
        succeededCount: results.filter((result) => result.success).length,
        failedCount: results.filter((result) => !result.success).length,
        reason: normalizedReason || null,
        results,
      };
    },
  },
  {
    name: "finclass_navigate_to_section",
    description:
      "핀클래스에서 교사가 요청한 업무 화면으로 이동합니다. 데이터는 변경하지 않습니다.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: Object.keys(APP_SECTION_PATHS),
        },
      },
      required: ["section"],
      additionalProperties: false,
    },
    annotations: WRITE_ANNOTATIONS,
    execute: async ({ section } = {}) => {
      const context = assertTeacherContext(getContext);
      const path = APP_SECTION_PATHS[String(section || "")];
      if (!path) throw new Error("지원하지 않는 화면입니다.");
      await operations.navigateToAppPath(path);
      return {
        success: true,
        section,
        path,
        previousPath: context.currentPath || "/",
      };
    },
  },
];

const cleanUpRegistration = async (modelContext, name, registration) => {
  if (typeof registration === "function") {
    await registration();
    return;
  }
  if (typeof registration?.unregister === "function") {
    await registration.unregister();
    return;
  }
  if (typeof modelContext?.unregisterTool === "function") {
    await modelContext.unregisterTool(name);
  }
};

export const registerFinclassSiteTools = async ({
  modelContext,
  getContext,
  operations = DEFAULT_SITE_TOOL_OPERATIONS,
}) => {
  if (typeof modelContext?.registerTool !== "function") {
    return () => undefined;
  }

  const registrations = [];
  try {
    for (const tool of buildFinclassSiteTools(getContext, operations)) {
      const registration = await modelContext.registerTool(tool);
      registrations.push({ name: tool.name, registration });
    }
  } catch (error) {
    await Promise.allSettled(
      registrations.map(({ name, registration }) =>
        cleanUpRegistration(modelContext, name, registration),
      ),
    );
    throw error;
  }

  return async () => {
    await Promise.allSettled(
      registrations.map(({ name, registration }) =>
        cleanUpRegistration(modelContext, name, registration),
      ),
    );
  };
};
