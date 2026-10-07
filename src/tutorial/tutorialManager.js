import { creditSteps } from "./steps/creditSteps";
import { getAssemblyTutorialSteps } from "./steps/assemblySteps";
import { arcadeSteps } from "./steps/arcadeSteps";
import { getBankTutorialSteps } from "./steps/bankSteps";
import { mainSteps } from "./steps/mainSteps";
import { accountSteps } from "./steps/accountSteps";
import { getDeleteStudentsTutorialSteps } from "./steps/deleteStudentsSteps";
import { getMarketplaceTutorialSteps } from "./steps/marketplaceSteps";
import { getManageAssetsTutorialSteps } from "./steps/manageAssetsSteps";
import { getManageDashboardTutorialSteps } from "./steps/manageDashboardSteps";
import { managePermissionsSteps } from "./steps/managePermissionsSteps";
import { manageTimeSettingsSteps } from "./steps/manageTimeSettingsSteps";
import { getMissionTutorialSteps } from "./steps/missionSteps";
import { newsSteps } from "./steps/newsSteps";
import { getPoliceTutorialSteps } from "./steps/policeSteps";
import { getRealEstateTutorialSteps } from "./steps/realestateSteps";
import { getStockTutorialSteps } from "./steps/stockSteps";
import { storeSteps } from "./steps/storeSteps";
import { studentSteps } from "./steps/studentSteps";
import { getTaxTutorialSteps } from "./steps/taxSteps";

export const TUTORIAL_CONFIG = {
  "/manage/students/create": {
    steps: studentSteps,
    tourKey: "ADMIN_STUDENT_REGISTRATION_TOUR",
    role: "admin",
  },

  "/dashboard": {
    steps: mainSteps,
    tourKey: "TEACHER_DASHBOARD_VIEW_TOUR",
    role: "admin",
  },

  "/credit": {
    steps: creditSteps,
    tourKey: "TEACHER_CREDIT_PAGE_TOUR",
    role: "admin",
  },

  "/news": {
    steps: newsSteps,
    tourKey: "TEACHER_NEWS_PAGE_TOUR",
    role: "admin",
  },

  "/missions": {
    steps: getMissionTutorialSteps,
    tourKey: "TEACHER_MISSION_PAGE_TOUR",
    role: "admin",
  },

  "/bank": {
    steps: getBankTutorialSteps,
    tourKey: "TEACHER_BANK_PAGE_TOUR",
    role: "admin",
  },

  "/stock": {
    steps: getStockTutorialSteps,
    tourKey: "TEACHER_STOCK_PAGE_TOUR",
    role: "admin",
  },

  "/store": {
    steps: storeSteps,
    tourKey: "TEACHER_STORE_PAGE_TOUR",
    role: "admin",
  },

  "/tax": {
    steps: getTaxTutorialSteps,
    tourKey: "TEACHER_TAX_PAGE_TOUR",
    role: "admin",
  },

  "/labor": {
    steps: getTaxTutorialSteps,
    tourKey: "TEACHER_LABOR_PAGE_TOUR",
    role: "admin",
  },

  "/police": {
    steps: getPoliceTutorialSteps,
    tourKey: "TEACHER_POLICE_PAGE_TOUR",
    role: "admin",
  },

  "/realestate": {
    steps: getRealEstateTutorialSteps,
    tourKey: "TEACHER_REALESTATE_PAGE_TOUR",
    role: "admin",
  },

  "/marketplace": {
    steps: getMarketplaceTutorialSteps,
    tourKey: "TEACHER_MARKETPLACE_PAGE_TOUR",
    role: "admin",
  },

  "/assembly": {
    steps: getAssemblyTutorialSteps,
    tourKey: "TEACHER_ASSEMBLY_PAGE_TOUR",
    role: "admin",
  },

  "/arcade": {
    steps: arcadeSteps,
    tourKey: "TEACHER_ARCADE_PAGE_TOUR",
    role: "admin",
  },

  "/manage/assets": {
    steps: getManageAssetsTutorialSteps,
    tourKey: "TEACHER_MANAGE_ASSETS_TOUR",
    role: "admin",
  },

  "/manage/dashboard": {
    steps: getManageDashboardTutorialSteps,
    tourKey: "TEACHER_MANAGE_DASHBOARD_TOUR",
    role: "admin",
  },

  "/manage/permissions": {
    steps: managePermissionsSteps,
    tourKey: "TEACHER_MANAGE_PERMISSIONS_TOUR",
    role: "admin",
  },

  "/manage/time-settings": {
    steps: manageTimeSettingsSteps,
    tourKey: "TEACHER_MANAGE_TIME_SETTINGS_TOUR",
    role: "admin",
  },

  "/manage/students/delete": {
    steps: getDeleteStudentsTutorialSteps,
    tourKey: "TEACHER_DELETE_STUDENTS_TOUR",
    role: "admin",
  },

  "/account": {
    steps: accountSteps,
    tourKey: "ACCOUNT_PAGE_TOUR",
    role: "all",
  },
};

export const getTutorialConfig = (pathname, isAdmin, isTeacher, userRole) => {
  const config = TUTORIAL_CONFIG[pathname];
  if (!config) return null;

  const resolvedConfig = {
    ...config,
    steps: typeof config.steps === "function" ? config.steps() : config.steps,
  };

  if (config.role === "admin") {
    return isAdmin || isTeacher ? resolvedConfig : null;
  }

  if (config.role === "student") {
    return userRole === "student" ? resolvedConfig : null;
  }

  if (config.role === "all") {
    return resolvedConfig;
  }

  return null;
};
