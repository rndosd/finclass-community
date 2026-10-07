import { sanitizeInternalRoutePath } from "./internalRoute";

const TEACHER_ONLY_PATHS = new Set([
  "/manage/permissions",
  "/manage/dashboard",
  "/manage/time-settings",
  "/manage/students/create",
  "/manage/students/delete",
]);

export const normalizeRoutePath = (path) => {
  return sanitizeInternalRoutePath(path, "/dashboard");
};

export const isTeacherOnlyPath = (path) => {
  const normalizedPath = normalizeRoutePath(path);

  if (normalizedPath === "/admin" || normalizedPath.startsWith("/admin/")) {
    return true;
  }

  return TEACHER_ONLY_PATHS.has(normalizedPath);
};

export const sanitizeSwitchedStudentPath = (path) => {
  const normalizedPath = normalizeRoutePath(path);

  if (
    normalizedPath === "/" ||
    normalizedPath === "/login" ||
    normalizedPath === "/signup/teacher" ||
    normalizedPath === "/access-denied"
  ) {
    return "/dashboard";
  }

  if (isTeacherOnlyPath(normalizedPath)) {
    return "/dashboard";
  }

  return normalizedPath;
};
