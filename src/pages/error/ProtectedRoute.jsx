import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { RouteGuardLoader } from "../../components/auth/ProtectedRouteWrapper";
import { useUser } from "../../contexts/UserContext";
import { PERMISSION_CONFIG } from "../admin/PermissionConfig";
import { getUsageScheduleBlockInfo } from "../../utils/usageSchedule";
import { useFundMode } from "../../contexts/FundModeContext";
import { PERMISSIONS } from "../../constants/permissions";

const FUND_CHANNEL_BY_PAGE_PERMISSION = {
  [PERMISSIONS.STOCK]: "stockInvestment",
  [PERMISSIONS.BANK]: "bankPayout",
  [PERMISSIONS.STORE]: "storePurchase",
  [PERMISSIONS.REALESTATE]: "realEstatePurchase",
};

export default function ProtectedRoute({
  allowedRoles,
  requiredPermission,
  children,
}) {
  const {
    userData,
    loading,
    hasPermission,
    classData,
    permissionProfileReady,
    isAccountSwitching,
  } = useUser();
  const { isFundMode, canUseChannel } = useFundMode();
  const location = useLocation();
  const requiredPermissions = Array.isArray(requiredPermission)
    ? requiredPermission.filter(Boolean)
    : requiredPermission
      ? [requiredPermission]
      : [];

  if (loading) return <RouteGuardLoader />;

  if (!userData) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (userData.role === "pending" || userData.status === "pending") {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(userData.role)) {
    return (
      <Navigate
        to="/access-denied"
        replace
        state={{ reason: "ROLE", detail: "요구 권한", from: location }}
      />
    );
  }

  if (
    requiredPermissions.length > 0 &&
    userData.role !== "teacher" &&
    userData.role !== "admin" &&
    !permissionProfileReady
  ) {
    return <RouteGuardLoader />;
  }

  if (
    requiredPermissions.length > 0 &&
    userData.role !== "teacher" &&
    userData.role !== "admin" &&
    !requiredPermissions.some((permission) =>
      hasPermission(permission) ||
      (isFundMode && FUND_CHANNEL_BY_PAGE_PERMISSION[permission] &&
        canUseChannel(FUND_CHANNEL_BY_PAGE_PERMISSION[permission])),
    )
  ) {
    const koreanLabel = requiredPermissions
      .map((permission) =>
        PERMISSION_CONFIG.find((p) => p.key === permission)?.label || permission,
      )
      .join(" 또는 ");

    return (
      <Navigate
        to="/access-denied"
        replace
        state={{
          reason: "PERMISSION",
          detail: koreanLabel,
          from: location,
        }}
      />
    );
  }

  const usageSchedule = classData?.settings?.usageSchedule;
  const shouldCheckByRole =
    userData.role === "student" && !isAccountSwitching;
  if (shouldCheckByRole) {
    const blockInfo = getUsageScheduleBlockInfo(usageSchedule);
    if (blockInfo.blocked) {
      return (
        <Navigate
          to="/access-denied"
          replace
          state={{
            reason: "TIME_WINDOW",
            detail: blockInfo.detail,
            from: location,
          }}
        />
      );
    }
  }

  return children ? children : <Outlet />;
}
