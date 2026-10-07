// src/constants/permissions.js

import { PERMISSION_CONFIG } from "./permissionCatalog";

const PERMISSION_KEYS = Object.freeze(
  Object.fromEntries(
    PERMISSION_CONFIG.map((permission) => [permission.key, permission.key]),
  ),
);

export const PERMISSIONS = {
  // Page access permissions
  BANK: PERMISSION_KEYS.page_bank_view,
  TAX: PERMISSION_KEYS.page_tax_view,
  LABOR: PERMISSION_KEYS.page_labor_view,
  POLICE: PERMISSION_KEYS.page_police_view,
  STORE: PERMISSION_KEYS.page_store_view,
  STOCK: PERMISSION_KEYS.page_stock_view,
  CREDIT: PERMISSION_KEYS.page_credit_view,
  CREDENTIALS: PERMISSION_KEYS.page_credentials_view,
  JOB_BOARD: PERMISSION_KEYS.page_job_board_view,
  MISSION_PAGE: PERMISSION_KEYS.page_mission_view,
  ASSEMBLY_PAGE: PERMISSION_KEYS.page_assembly_view,
  REALESTATE: PERMISSION_KEYS.page_realestate_view,
  NEWS_PAGE: PERMISSION_KEYS.page_news_view,
  MARKETPLACE_PAGE: PERMISSION_KEYS.page_marketplace_view,
  ARCADE: PERMISSION_KEYS.page_arcade_view,

  // Admin permissions
  BANK_ADMIN: PERMISSION_KEYS.bank_admin,
  POLICE_ADMIN: PERMISSION_KEYS.permission_group_police,
  POLICE_RULES_MANAGE: PERMISSION_KEYS.police_rules_manage,
  TAX_ADMIN: PERMISSION_KEYS.tax_admin,
  LABOR_ADMIN: PERMISSION_KEYS.labor_admin,
  STORE_ADMIN: PERMISSION_KEYS.store_admin,
  MISSION_ADMIN: PERMISSION_KEYS.mission_admin,
  REALESTATE_ADMIN: PERMISSION_KEYS.realestate_admin,
  NEWS_ADMIN: PERMISSION_KEYS.news_admin,
  MARKETPLACE_ADMIN: PERMISSION_KEYS.marketplace_admin,
  CREDENTIALS_ADMIN: PERMISSION_KEYS.credentials_admin,
  CREDENTIALS_DESIGNER: PERMISSION_KEYS.credentials_designer,
  ASSET_MANAGER_VIEW: PERMISSION_KEYS.asset_manager_view,
  ADMIN_ASSET_VIEW: PERMISSION_KEYS.asset_manager_view,
  ASSET_MANAGER_MANAGE: PERMISSION_KEYS.asset_manager_manage,
  ADMIN_ASSET_MANAGE: PERMISSION_KEYS.asset_manager_manage,

  // Role permissions
  ASSEMBLY_MEMBER: PERMISSION_KEYS.assembly_member,

  // Action permissions
  BANK_TRANSFER: PERMISSION_KEYS.action_bank_transfer,
};
