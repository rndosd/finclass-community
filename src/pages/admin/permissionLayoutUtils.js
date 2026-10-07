const compareKoreanText = (left = "", right = "") =>
  String(left || "").localeCompare(String(right || ""), "ko-KR", {
    numeric: true,
    sensitivity: "base",
  });

export const isViewPermission = (permissionKey = "") =>
  permissionKey.startsWith("page_") ||
  permissionKey.endsWith("_view");

export const sortPermissionsByDisplayName = (permissions = []) =>
  [...permissions].sort((left, right) =>
    compareKoreanText(left?.label || left?.key, right?.label || right?.key),
  );

export const getPermissionGroupRows = (permissionOptions = []) =>
  Object.entries(
    permissionOptions.reduce((acc, permission) => {
      const group = permission.group || "기타";
      if (!acc[group]) acc[group] = [];
      acc[group].push(permission);
      return acc;
    }, {}),
  )
    .map(([groupName, permissionsInGroup]) => ({
      name: groupName,
      color: permissionsInGroup[0]?.color || "slate",
      permissions: sortPermissionsByDisplayName(permissionsInGroup),
      viewPermissions: sortPermissionsByDisplayName(
        permissionsInGroup.filter((permission) =>
          isViewPermission(permission.key),
        ),
      ),
      adminPermissions: sortPermissionsByDisplayName(
        permissionsInGroup.filter(
          (permission) => !isViewPermission(permission.key),
        ),
      ),
    }))
    .sort((left, right) => compareKoreanText(left.name, right.name));

export const getPermissionGroupEntries = (permissionOptions = []) =>
  getPermissionGroupRows(permissionOptions).map((row) => ({
    name: row.name,
    perms: row.permissions,
    color: row.color,
    count: row.permissions.length,
  }));
