import {
  applyImpliedPermissions,
  KNOWN_PERMISSION_KEYS,
} from "./permissionCatalog";

test("delegated management permissions include their page view permissions", () => {
  const permissions = applyImpliedPermissions({
    bank_admin: true,
    page_bank_view: false,
    realestate_admin: true,
    police_rules_manage: true,
  });

  expect(permissions.page_bank_view).toBe(true);
  expect(permissions.page_realestate_view).toBe(true);
  expect(permissions.page_police_view).toBe(true);
  expect(permissions.permission_group_police).not.toBe(true);
  expect(Object.keys(permissions).every((key) => KNOWN_PERMISSION_KEYS.includes(key))).toBe(true);
});
