const HIDDEN_JOB_LINKED_PERMISSION_KEYS = new Set([
  "asset_manager_view",
  "page_bank_view",
  "page_tax_view",
  "page_labor_view",
  "page_police_view",
  "page_store_view",
  "page_stock_view",
  "page_credit_view",
  "page_credentials_view",
  "page_job_board_view",
  "page_assembly_view",
  "page_mission_view",
  "page_news_view",
  "page_realestate_view",
  "page_marketplace_view",
  "page_arcade_view",
]);

export const isJobLinkedSelectablePermission = (permission = {}) => {
  const key = String(permission?.key || "").trim();
  return Boolean(key) && !HIDDEN_JOB_LINKED_PERMISSION_KEYS.has(key);
};

export const getJobLinkedSelectablePermissions = (permissionOptions = []) =>
  permissionOptions.filter(isJobLinkedSelectablePermission);

export const filterJobLinkedPermissionKeys = (keys = []) =>
  (Array.isArray(keys) ? keys : []).filter(
    (key) => !HIDDEN_JOB_LINKED_PERMISSION_KEYS.has(String(key || "").trim()),
  );
