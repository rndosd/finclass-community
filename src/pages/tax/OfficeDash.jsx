import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import { useUser } from "../../contexts/UserContext";
import { useClassStudents } from "../../hooks/user/useClassStudents";
import {
  Alert,
  Card,
  PageHeader,
  PageLoader,
  SectionLoader,
  Tabs,
} from "../../components/ui";
import { useJobDefinitionsQuery } from "../../hooks/tax/useJobInfo";
import { useClassPayslipsQuery } from "../../hooks/tax/usePayrollInfo";
import { useTaxRulesQuery, useTaxSummaryQuery } from "./hooks/useTaxQuery";
import TaxPolicyTab from "./tabs/TaxPolicyTabV2";
import BudgetFundsTab from "./tabs/BudgetFundsTab";
import JobApplicationTab from "./tabs/JobApplicationTab";
import JobDefinitionTab from "./tabs/JobDefinitionTab";
import JobStatusTab from "./tabs/JobStatusTab";
import TaxSettlementTab from "./tabs/TaxSettlementTab";
import PayrollTab from "./tabs/PayrollTab";
import TaxFinanceTab from "./tabs/TaxFinanceTab";
import TaxStatsTab from "./tabs/TaxStatsTab";
import { ENABLE_CLASS_FUNDS_ROLLOUT } from "../../config/rolloutFlags";

const STUDENT_TAB_IDS = new Set([
  "autoTaxPolicy",
  "jobApplications",
  "jobStatus",
  "payroll",
]);

const JOB_DEFINITION_TAB_IDS = new Set([
  "jobDefinitions",
  "jobApplications",
  "jobStatus",
  "payroll",
]);

const TAX_RULE_TAB_IDS = new Set(["autoTaxPolicy", "payroll"]);
const TAX_SUMMARY_TAB_IDS = new Set(["taxFinance", "budgetFunds"]);
const PAYSLIP_TAB_IDS = new Set(["payroll"]);
const EMPTY_LIST = [];
const EMPTY_JOB_VALUE = "없음";

const normalizeStudentJobs = (student = {}) => {
  const rawJobs = Array.isArray(student.jobs)
    ? student.jobs
    : student.jobs
      ? [student.jobs]
      : student.job
        ? [student.job]
        : [];

  return Array.from(
    new Set(
      rawJobs
        .map((job) => String(job || "").trim())
        .filter((job) => job && job !== EMPTY_JOB_VALUE),
    ),
  );
};

const TAB_CONFIG = [
  {
    id: "taxFinance",
    label: "국고 현황",
    Component: TaxFinanceTab,
  },
  {
    id: "taxStats",
    label: "통계",
    Component: TaxStatsTab,
    teacherOnly: true,
    requiredPermissions: ["tax_admin"],
  },
  {
    id: "autoTaxPolicy",
    label: "세금 정책",
    Component: TaxPolicyTab,
    requiredPermissions: ["tax_admin"],
  },
  {
    id: "budgetFunds",
    label: "예산·기금",
    Component: BudgetFundsTab,
    requiredPermissions: ["tax_admin"],
    rolloutEnabled: ENABLE_CLASS_FUNDS_ROLLOUT,
  },
  {
    id: "jobDefinitions",
    label: "직업 정의",
    Component: JobDefinitionTab,
  },
  {
    id: "jobStatus",
    label: "직업 현황",
    Component: JobStatusTab,
  },
  {
    id: "jobApplications",
    label: "직업 지원",
    Component: JobApplicationTab,
  },
  {
    id: "payroll",
    label: "급여 지급",
    Component: PayrollTab,
    requiredPermissions: ["labor_admin"],
  },
  {
    id: "monthEndSettlement",
    label: "세금 정산",
    Component: TaxSettlementTab,
    teacherOnly: true,
    requiredPermissions: ["tax_admin"],
  },
];

export const OFFICE_TAB_IDS = {
  tax: [
    "taxFinance",
    "taxStats",
    "autoTaxPolicy",
    "budgetFunds",
    "monthEndSettlement",
  ],
  labor: ["jobDefinitions", "jobStatus", "jobApplications", "payroll"],
};

const NoClassSelected = () => (
  <Card variant="surface" tone="white" className="mx-auto max-w-md">
    <Card.Content noPadding center>
      <Alert type="warning" title="학급 미선택" message="관리할 학급 정보가 없습니다." />
    </Card.Content>
  </Card>
);

const NoTabAccess = () => (
  <Card variant="surface" tone="slate" className="mx-auto max-w-md">
    <Card.Content noPadding center>
      <Alert type="info" message="접근 가능한 메뉴가 없습니다." />
    </Card.Content>
  </Card>
);

export default function OfficeDash({
  pageTitle,
  pageSubtitle,
  pageIcon,
  tabIds = [],
  crossPageTabRoutes = {},
}) {
  const {
    isTeacher,
    loading: userLoading,
    classId,
    userData,
    hasPermission,
    classData,
  } = useUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const searchParamsString = useMemo(() => searchParams.toString(), [searchParams]);
  const [hasResolvedInitialPage, setHasResolvedInitialPage] = useState(false);

  const isDeveloperLocal = useMemo(() => {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  }, []);

  const hasTabAccess = useCallback(
    (tab) => {
      if (!tabIds.includes(tab.id)) return false;
      if (tab.rolloutEnabled === false) return false;
      if (tab.localOnly && !isDeveloperLocal) return false;
      if (isTeacher) return true;
      if (tab.teacherOnly) return false;
      if (tab.requiredPermissions) {
        return tab.requiredPermissions.some((permission) =>
          hasPermission(permission),
        );
      }
      return true;
    },
    [hasPermission, isDeveloperLocal, isTeacher, tabIds],
  );

  const visibleTabsConfig = useMemo(
    () => TAB_CONFIG.filter(hasTabAccess),
    [hasTabAccess],
  );
  const firstVisibleTab = useMemo(
    () => visibleTabsConfig[0]?.id || "",
    [visibleTabsConfig],
  );
  const requestedTabVisible = useMemo(
    () =>
      requestedTab
        ? visibleTabsConfig.some((tab) => tab.id === requestedTab)
        : false,
    [requestedTab, visibleTabsConfig],
  );

  const redirectPath = useMemo(() => {
    if (!requestedTab) return null;
    if (requestedTabVisible) return null;
    return crossPageTabRoutes[requestedTab] || null;
  }, [crossPageTabRoutes, requestedTab, requestedTabVisible]);

  const activeTab = useMemo(() => {
    if (redirectPath) return "";
    if (requestedTabVisible) return requestedTab;
    return firstVisibleTab;
  }, [firstVisibleTab, redirectPath, requestedTab, requestedTabVisible]);

  // Keep Firestore listeners scoped to the active tab so hidden sections do not
  // continue paying for live reads in the background.
  const needsStudents = STUDENT_TAB_IDS.has(activeTab);
  const needsJobDefinitions = JOB_DEFINITION_TAB_IDS.has(activeTab);
  const needsTaxRules = TAX_RULE_TAB_IDS.has(activeTab);
  const needsTaxSummary = TAX_SUMMARY_TAB_IDS.has(activeTab);
  const needsPayslips = PAYSLIP_TAB_IDS.has(activeTab);

  const { data: scopedStudentList = [], isLoading: isScopedStudentsLoading } =
    useClassStudents(classId, {
      enabled: !!classId && needsStudents,
      realtime: true,
    });
  const { data: scopedJobDefinitions = [], isLoading: isScopedJobsLoading } =
    useJobDefinitionsQuery(classId, { enabled: needsJobDefinitions });
  const { data: scopedTaxRules = [], isLoading: isScopedRulesLoading } =
    useTaxRulesQuery(classId, { enabled: needsTaxRules });
  const { data: scopedTaxSummary, isLoading: isScopedSummaryLoading } =
    useTaxSummaryQuery(classId, { enabled: needsTaxSummary });
  const { data: scopedPayslips = [], isLoading: isScopedPayslipsLoading } =
    useClassPayslipsQuery(classId, {
      enabled: needsPayslips,
      repairEnabled: isTeacher,
    });

  const studentList = needsStudents ? scopedStudentList : EMPTY_LIST;
  const jobDefinitions = needsJobDefinitions ? scopedJobDefinitions : EMPTY_LIST;
  const taxRules = needsTaxRules ? scopedTaxRules : EMPTY_LIST;
  const taxSummary = needsTaxSummary ? scopedTaxSummary : null;
  const payslips = needsPayslips ? scopedPayslips : EMPTY_LIST;
  const isStudentsLoading = needsStudents && isScopedStudentsLoading;
  const isJobsLoading = needsJobDefinitions && isScopedJobsLoading;
  const isRulesLoading = needsTaxRules && isScopedRulesLoading;
  const isSummaryLoading = needsTaxSummary && isScopedSummaryLoading;
  const isPayslipsLoading = needsPayslips && isScopedPayslipsLoading;

  useEffect(() => {
    if (!requestedTab || !redirectPath) return;
    navigate(`${redirectPath}?${searchParamsString}`, { replace: true });
  }, [navigate, redirectPath, requestedTab, searchParamsString]);

  const tabsData = useMemo(
    () =>
      visibleTabsConfig.map((tab) => ({
        id: tab.id,
        label: tab.label,
      })),
    [visibleTabsConfig],
  );

  useEffect(() => {
    if (redirectPath || !activeTab || requestedTab === activeTab) return;

    const nextSearchParams = new URLSearchParams(searchParamsString);
    nextSearchParams.set("tab", activeTab);
    const nextSearchParamsString = nextSearchParams.toString();
    if (nextSearchParamsString === searchParamsString) return;

    setSearchParams(nextSearchParams, { replace: true });
  }, [
    activeTab,
    redirectPath,
    requestedTab,
    searchParamsString,
    setSearchParams,
  ]);

  const handleTabChange = useCallback(
    (nextTab, nextQuery = {}) => {
      const nextSearchParams = new URLSearchParams(searchParamsString);
      nextSearchParams.set("tab", nextTab);
      Object.entries(nextQuery).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          nextSearchParams.delete(key);
          return;
        }
        nextSearchParams.set(key, String(value));
      });

      if (visibleTabsConfig.some((tab) => tab.id === nextTab)) {
        const nextSearchParamsString = nextSearchParams.toString();
        if (nextSearchParamsString !== searchParamsString) {
          setSearchParams(nextSearchParams, { replace: true });
        }
        return;
      }

      const targetPath = crossPageTabRoutes[nextTab];
      if (targetPath) {
        navigate(`${targetPath}?${nextSearchParams.toString()}`);
      }
    },
    [
      crossPageTabRoutes,
      navigate,
      searchParamsString,
      setSearchParams,
      visibleTabsConfig,
    ],
  );

  const isTabLoadingWithoutContent =
    (needsStudents && isStudentsLoading && studentList.length === 0) ||
    (needsJobDefinitions && isJobsLoading && jobDefinitions.length === 0) ||
    (needsTaxRules && isRulesLoading && taxRules.length === 0) ||
    (needsTaxSummary && isSummaryLoading && !taxSummary) ||
    (needsPayslips && isPayslipsLoading && payslips.length === 0);
  const isInitialPageLoading =
    !hasResolvedInitialPage &&
    (userLoading || !activeTab || isTabLoadingWithoutContent);

  useEffect(() => {
    setHasResolvedInitialPage(false);
  }, [classId, pageTitle]);

  useEffect(() => {
    if (!userLoading && activeTab && !isTabLoadingWithoutContent) {
      setHasResolvedInitialPage(true);
    }
  }, [activeTab, isTabLoadingWithoutContent, userLoading]);

  const commonProps = useMemo(
    () => ({
      classId,
      currencyUnit: classData?.currencyUnit || "원",
      userData,
      classData,
      students: studentList || [],
    }),
    [classData, classId, studentList, userData],
  );

  const laborStudents = useMemo(
    () =>
      (studentList || []).filter((student) => {
        const role = String(student?.role || "").trim().toLowerCase();
        return role !== "teacher" && role !== "admin";
      }),
    [studentList],
  );

  const isLaborOffice = useMemo(
    () => tabIds.includes("jobDefinitions") && !tabIds.includes("taxFinance"),
    [tabIds],
  );
  const isTaxOffice = useMemo(
    () => tabIds.includes("taxFinance"),
    [tabIds],
  );
  const canManageLabor = isTeacher || hasPermission("labor_admin");
  const canManageTax = isTeacher || hasPermission("tax_admin");
  const laborQuestGuide = useMemo(() => {
    if (!isLaborOffice || !canManageLabor) return null;

    const jobsWithSalary = jobDefinitions.filter(
      (job) => Number(job?.baseSalary || 0) > 0,
    );
    const jobsWithTargetHeadcount = jobDefinitions.filter(
      (job) => Number(job?.targetHeadcount || 0) > 0,
    );
    const hasLoadedStudents = STUDENT_TAB_IDS.has(activeTab);
    const assignedStudents = hasLoadedStudents
      ? laborStudents.filter((student) => normalizeStudentJobs(student).length > 0)
      : [];
    const unassignedStudents = hasLoadedStudents
      ? laborStudents.filter((student) => normalizeStudentJobs(student).length === 0)
      : [];
    const hasLoadedPayslips = PAYSLIP_TAB_IDS.has(activeTab);
    const salaryPayslips = hasLoadedPayslips
      ? payslips.filter(
          (payslip) =>
            String(payslip?.slipType || "salary").trim().toLowerCase() !== "bonus",
        )
      : [];
    const allStudentsAssigned =
      hasLoadedStudents &&
      laborStudents.length > 0 &&
      unassignedStudents.length === 0;

    return {
      type: "quest",
      title: "노동청 도우미",
      launcherTitle: "노동청 도우미",
      launcherDescription: "직업, 주급, 배정, 급여 지급 흐름을 체크합니다.",
      subtitle: "학생들이 돈을 벌 수 있는 기본 구조를 결과 기준으로 확인합니다.",
      storageKey: classId ? `finclass_labor_quest_${classId}` : "finclass_labor_quest",
      tourKey: "TEACHER_LABOR_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "create-jobs",
          title: "직업 목록 만들기",
          description: "학생들이 맡을 수 있는 직업을 하나 이상 정의합니다.",
          doneText: `${jobDefinitions.length}개의 직업이 있습니다.`,
          completed: jobDefinitions.length >= 1,
          manualComplete: false,
          objectives: [
            {
              id: "job-count",
              label: "직업 1개 이상 만들기",
              completed: jobDefinitions.length >= 1,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-tabs"]',
              title: "직업 정의 탭",
              content: "노동청의 첫 설정은 직업 정의에서 시작합니다.",
            },
            {
              target: '[data-tour="tax-job-definition-table"]',
              title: "직업 목록",
              content: "직업명, 설명, 주급, 목표 인원을 여기에서 관리합니다.",
            },
          ],
        },
        {
          id: "set-weekly-salary",
          title: "주급 기준 넣기",
          description: "직업마다 기본 주급을 넣어 돈이 생기는 기준을 만듭니다.",
          doneText: `${jobsWithSalary.length}개의 직업에 주급이 있습니다.`,
          completed: jobsWithSalary.length >= 1,
          manualComplete: false,
          objectives: [
            {
              id: "salary-ready",
              label: "주급이 있는 직업 1개 이상 만들기",
              completed: jobsWithSalary.length >= 1,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-job-definition-table"]',
              title: "주급 입력",
              content: "직업 정의 표에서 직업별 주급을 정합니다. 처음에는 균등한 금액으로 시작해도 됩니다.",
            },
          ],
        },
        {
          id: "assign-students",
          title: "학생에게 직업 배정하기",
          description: "직업 현황에서 학생들이 실제 직업을 갖고 있는지 확인합니다.",
          doneText: allStudentsAssigned
            ? "학생 직업 배정이 확인되었습니다."
            : `${assignedStudents.length}명이 직업을 갖고 있습니다.`,
          completed: allStudentsAssigned,
          manualComplete: true,
          objectives: [
            {
              id: "open-job-status",
              label: "직업 현황 탭에서 학생 배정 보기",
              completed: hasLoadedStudents,
            },
            {
              id: "assigned-students",
              label:
                hasLoadedStudents && laborStudents.length > 0
                  ? `직업 없는 학생 ${unassignedStudents.length}명 확인`
                  : "학생 직업 배정 상태 확인",
              completed: allStudentsAssigned,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-tabs"]',
              title: "직업 현황 탭",
              content: "직업 현황 탭에서 배정된 학생과 아직 직업이 없는 학생을 확인합니다.",
            },
            {
              target: '[data-tour="tax-content"]',
              title: "배정 상태",
              content: "학생별 직업 배정은 이 화면에서 확인하고 조정합니다.",
            },
          ],
        },
        {
          id: "check-payroll",
          title: "급여 지급 흐름 확인하기",
          description: "급여 탭에서 지급 기간, 세금 연동, 지급 표를 확인합니다.",
          doneText: salaryPayslips.length > 0
            ? `${salaryPayslips.length}개의 급여 기록이 있습니다.`
            : "급여 지급 흐름을 확인했습니다.",
          completed: salaryPayslips.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "open-payroll",
              label: "급여 탭 열기",
              completed: hasLoadedPayslips,
            },
            {
              id: "payroll-history",
              label: "급여 지급 기록 확인",
              completed: salaryPayslips.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-payroll-period"]',
              title: "지급 기간",
              content: "급여를 몇 주분 지급할지 먼저 확인합니다.",
            },
            {
              target: '[data-tour="tax-payroll-policy"]',
              title: "세금 연동",
              content: "급여 지급 시 세금 규칙이 어떻게 연결되는지 확인합니다.",
            },
            {
              target: '[data-tour="tax-payroll-table"]',
              title: "급여 표",
              content: "학생별 직업, 지급 상태, 즉시 지급 버튼을 확인합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "set-target-headcount",
          title: "목표 인원 정하기",
          description: "직업별 필요한 인원을 정하면 배정 상태를 보기 쉬워집니다.",
          doneText: `${jobsWithTargetHeadcount.length}개의 직업에 목표 인원이 있습니다.`,
          completed: jobsWithTargetHeadcount.length >= 1,
          manualComplete: true,
          objectives: [
            {
              id: "target-headcount",
              label: "목표 인원이 있는 직업 1개 이상 만들기",
              completed: jobsWithTargetHeadcount.length >= 1,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-job-definition-table"]',
              title: "목표 인원",
              content: "목표 인원은 반드시 정답이 아니라, 현재 반 운영에 맞춰 조정하는 기준입니다.",
            },
          ],
        },
        {
          id: "bulk-job-upload",
          title: "직업 엑셀로 불러오기",
          description: "직업 목록이 많다면 엑셀로 한 번에 등록할 수 있습니다.",
          completed: false,
          manualComplete: true,
          objectives: [
            {
              id: "upload-location",
              label: "직업 엑셀 등록 위치 확인",
              completed: false,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-job-definition-upload"]',
              title: "엑셀 등록",
              content: "직업 정의를 엑셀로 한 번에 불러올 수 있습니다.",
            },
          ],
        },
        {
          id: "job-application-round",
          title: "직업 지원 열어보기",
          description: "학생이 직접 직업을 지원하게 하는 방식도 사용할 수 있습니다.",
          completed: false,
          manualComplete: true,
          objectives: [
            {
              id: "application-board",
              label: "직업 지원 탭 구조 확인",
              completed: activeTab === "jobApplications",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-job-application-summary"]',
              title: "직업 지원 요약",
              content: "직업 지원 탭에서 모집, 지원, 승인 흐름을 관리합니다.",
            },
            {
              target: '[data-tour="tax-job-application-board"]',
              title: "지원 카드",
              content: "학생은 게시된 직업 카드에서 설명과 주급을 보고 지원할 수 있습니다.",
            },
          ],
        },
        {
          id: "bonus-incentive",
          title: "성과급 살펴보기",
          description: "기본 급여 외에 보너스나 인센티브를 지급할 수 있습니다.",
          completed: false,
          manualComplete: true,
          objectives: [
            {
              id: "bonus-payroll",
              label: "급여 탭에서 성과급 버튼 위치 확인",
              completed: activeTab === "payroll",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-payroll-table"]',
              title: "성과급 위치",
              content: "급여 표에서 학생별 보너스와 인센티브 지급을 처리할 수 있습니다.",
            },
          ],
        },
      ],
    };
  }, [
    activeTab,
    canManageLabor,
    classId,
    isLaborOffice,
    jobDefinitions,
    laborStudents,
    payslips,
  ]);
  const taxQuestGuide = useMemo(() => {
    if (!isTaxOffice || !canManageTax) return null;

    const hasLoadedSummary = activeTab === "taxFinance";
    const hasLoadedRules = TAX_RULE_TAB_IDS.has(activeTab);
    const hasFinanceActivity =
      Number(taxSummary?.totalIncome || 0) > 0 ||
      Number(taxSummary?.totalExpense || 0) > 0 ||
      Number(taxSummary?.recordCount || 0) > 0 ||
      Number(taxSummary?.billCount || 0) > 0;
    const hasTaxRules = hasLoadedRules && taxRules.length > 0;
    const percentRuleCount = hasLoadedRules
      ? taxRules.filter(
          (rule) =>
            rule?.type === "percent" ||
            rule?.calculationMode === "flat_rate" ||
            rule?.calculationMode === "rate_after_exemption",
        ).length
      : 0;

    return {
      type: "quest",
      title: "세금청 도우미",
      launcherTitle: "세금청 도우미",
      launcherDescription: "국고, 세금 규칙, 자동 반영, 정산 흐름을 체크합니다.",
      subtitle: "교실 경제에서 돈이 회수되고 다시 쓰이는 구조를 확인합니다.",
      storageKey: classId ? `finclass_tax_quest_${classId}` : "finclass_tax_quest",
      tourKey: "TEACHER_TAX_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "tax-overview",
          title: "국고 화면 확인하기",
          description: "국고 잔액, 수입, 지출, 관리 도구 위치를 먼저 확인합니다.",
          completed: hasLoadedSummary && Boolean(taxSummary),
          manualComplete: true,
          objectives: [
            {
              id: "summary-open",
              label: "국고 현황 탭 열기",
              completed: hasLoadedSummary,
            },
            {
              id: "summary-ready",
              label: "국고 요약 데이터 확인",
              completed: Boolean(taxSummary),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-tabs"]',
              title: "세금청 탭",
              content: "국고 현황, 통계, 자동 세금, 월말정산, 규칙 화면을 전환합니다.",
            },
            {
              target: '[data-tour="tax-finance-summary"]',
              title: "국고 요약",
              content: "현재 국고 잔액과 수입, 지출 흐름을 한 번에 확인합니다.",
            },
          ],
        },
        {
          id: "finance-activity",
          title: "수입과 지출 흐름 만들기",
          description: "세금 수입이나 지출 기록이 생기면 국고 운영을 추적할 수 있습니다.",
          doneText: "국고 활동 기록이 확인되었습니다.",
          completed: hasFinanceActivity,
          manualComplete: true,
          objectives: [
            {
              id: "income-expense-records",
              label: "수입 또는 지출 기록 확인",
              completed: hasFinanceActivity,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-finance-management"]',
              title: "국고 관리 도구",
              content: "수동 수입/지출 기록, 고지서 발급, 이력 관리를 여기에서 시작합니다.",
            },
          ],
        },
        {
          id: "tax-rules",
          title: "세금 규칙 준비하기",
          description: "급여나 활동에서 자동으로 걷을 세금 규칙을 하나 이상 만듭니다.",
          doneText: `${taxRules.length}개의 세금 규칙이 있습니다.`,
          completed: hasTaxRules,
          manualComplete: false,
          objectives: [
            {
              id: "rule-count",
              label: "세금 규칙 1개 이상 만들기",
              completed: hasTaxRules,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-rule-header"]',
              title: "규칙 추가",
              content: "급여 공제 규칙 탭에서 새 세금 규칙을 추가합니다.",
            },
            {
              target: '[data-tour="tax-rule-add-action"]',
              title: "새 규칙 추가",
              content: "새 규칙 추가 버튼을 누르면 규칙 이름, 방식, 세율을 입력하는 모달이 열립니다.",
              waitForTarget: '[data-tour="tax-rule-form-modal"]',
            },
            {
              target: '[data-tour="tax-rule-form-modal"]',
              title: "세금 규칙 모달",
              content: "공제 방식, 적용 대상, 세율을 확인하고 저장하는 흐름을 살펴봅니다.",
            },
            {
              target: '[data-tour="tax-rule-table"]',
              title: "규칙 목록",
              content: "규칙 이름, 방식, 세율, 적용 대상을 표에서 관리합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "auto-tax-policy",
          title: "자동 세금 정책 확인하기",
          description: "소득 유형별로 국고 즉시 반영과 원천징수 기준을 확인합니다.",
          completed: activeTab === "autoTaxPolicy",
          manualComplete: true,
          objectives: [
            {
              id: "auto-policy-open",
              label: "자동 세금 정책 탭 열기",
              completed: activeTab === "autoTaxPolicy",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-auto-summary"]',
              title: "자동 세금 기본 설정",
              content: "자동 반영과 원천징수 정책을 상단 요약에서 확인합니다.",
            },
            {
              target: '[data-tour="tax-auto-treasury"]',
              title: "국고 반영",
              content: "소득 유형별로 국고에 즉시 반영할지 조정합니다.",
            },
            {
              target: '[data-tour="tax-auto-settlement"]',
              title: "원천징수",
              content: "소득 유형별 원천징수 여부와 세율을 정합니다.",
            },
          ],
        },
        {
          id: "month-end-settlement",
          title: "월말정산 흐름 살펴보기",
          description: "운영이 쌓이면 환급과 추가 납부를 정리하는 정산 흐름을 사용할 수 있습니다.",
          completed: activeTab === "monthEndSettlement",
          manualComplete: true,
          objectives: [
            {
              id: "settlement-open",
              label: "월말정산 탭 열기",
              completed: activeTab === "monthEndSettlement",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-content"]',
              title: "월말정산",
              content: "소득 기록과 원천징수를 모아 최종 환급 또는 추가 납부를 준비합니다.",
            },
          ],
        },
        {
          id: "tax-stats",
          title: "세금 통계 보기",
          description: "세금 흐름이 쌓이면 통계 탭에서 운영 변화를 확인할 수 있습니다.",
          completed: activeTab === "taxStats",
          manualComplete: true,
          objectives: [
            {
              id: "stats-open",
              label: "통계 탭 열기",
              completed: activeTab === "taxStats",
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-content"]',
              title: "세금 통계",
              content: "기간별 수입과 지출 흐름을 보고 다음 정책을 조정합니다.",
            },
          ],
        },
        {
          id: "percent-rule",
          title: "비율형 세금 규칙 살펴보기",
          description: "정액 세금 외에 비율형 또는 면세 후 비율형 규칙도 사용할 수 있습니다.",
          completed: percentRuleCount > 0,
          manualComplete: true,
          objectives: [
            {
              id: "percent-rule-count",
              label: "비율형 세금 규칙 확인",
              completed: percentRuleCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="tax-rule-table"]',
              title: "비율형 규칙",
              content: "규칙 표에서 계산 방식과 세율을 비교합니다.",
            },
          ],
        },
      ],
    };
  }, [
    activeTab,
    canManageTax,
    classId,
    isTaxOffice,
    taxRules,
    taxSummary,
  ]);

  const renderActiveTab = () => {
    if (!classId) return <NoClassSelected />;

    const canManageJobDefinitions = isTeacher || hasPermission("labor_admin");

    switch (activeTab) {
      case "taxFinance":
        return (
          <TaxFinanceTab
            {...commonProps}
            taxSummary={taxSummary}
            isLoading={isSummaryLoading}
          />
        );
      case "autoTaxPolicy":
        return (
          <TaxPolicyTab
            {...commonProps}
            taxRules={taxRules}
            isLoading={isRulesLoading}
            onNavigateTab={handleTabChange}
          />
        );
      case "budgetFunds":
        return (
          <BudgetFundsTab
            {...commonProps}
            taxSummary={taxSummary}
            isLoading={isSummaryLoading}
          />
        );
      case "taxStats":
        return <TaxStatsTab {...commonProps} />;
      case "jobDefinitions":
        return (
          <JobDefinitionTab
            {...commonProps}
            jobDefinitions={jobDefinitions}
            isReadOnly={!canManageJobDefinitions}
          />
        );
      case "jobApplications":
        return (
          <JobApplicationTab
            {...commonProps}
            students={laborStudents}
            jobDefinitions={jobDefinitions}
          />
        );
      case "payroll":
        return (
          <PayrollTab
            {...commonProps}
            students={laborStudents}
            jobDefinitions={jobDefinitions}
            taxRules={taxRules}
            payslips={payslips}
            isLoading={isPayslipsLoading}
            onNavigateTab={handleTabChange}
          />
        );
      case "jobStatus":
        return (
          <JobStatusTab
            {...commonProps}
            students={laborStudents}
            jobDefinitions={jobDefinitions}
            isReadOnly={!canManageJobDefinitions}
            onNavigateTab={handleTabChange}
          />
        );
      case "monthEndSettlement":
        return (
          <TaxSettlementTab
            {...commonProps}
            onNavigateTab={handleTabChange}
          />
        );
      default:
        return <NoTabAccess />;
    }
  };

  if (isInitialPageLoading) {
    return (
      <AppLayout
        title="로딩 중..."
        showSidebar={true}
        showDefaultHeader={false}
        {...{ title: pageTitle }}
      >
        <PageLoader
          fullHeight={false}
          className="min-h-screen"
          message={`${pageTitle} 화면을 준비하는 중입니다...`}

        />
      </AppLayout>
    );
  }

  return (
    <AppLayout
      showSidebar={true}
      showDefaultHeader={false}
      pageGuide={laborQuestGuide || taxQuestGuide}
    >
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <PageHeader title={pageTitle} subtitle={pageSubtitle} icon={pageIcon} />

        <div data-tour="tax-tabs" data-active-tab={activeTab}>
          <Tabs
            tabs={tabsData}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            variant="underline"
            ariaLabel={`${pageTitle} 업무`}
            size="md"
            className="mb-6"
          />
        </div>

        <main className="relative animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div
            data-tour="tax-content"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[260px]"
          />
          {isTabLoadingWithoutContent ? (
            <SectionLoader
              message={`${pageTitle} 화면을 준비하는 중입니다...`}
              minHeightClassName="min-h-[360px]"

            />
          ) : (
            renderActiveTab()
          )}
        </main>
      </div>
    </AppLayout>
  );
}
