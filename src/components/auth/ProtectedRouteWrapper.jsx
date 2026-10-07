import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { auth } from "../../firebase";
import { useUser } from "../../contexts/UserContext";
import AppLayout from "../layout/AppLayout";
import SurfaceLoader from "../ui/SurfaceLoader";

const DEFAULT_ROUTE_GUARD_MESSAGE = "이용 권한 확인 중…";
const ROUTE_GUARD_MIN_HEIGHT = "min-h-[calc(100vh-10rem)]";
const ROUTE_GUARD_FRAME_CLASS_NAME =
  "rounded-[2rem] border border-white/70 bg-white/78 shadow-xl shadow-slate-200/35";

function RouteGuardShell({ children, pathname }) {
  const showSidebar = pathname !== "/changepassword";

  return (
    <AppLayout
      showSidebar={showSidebar}
      showDefaultHeader={false}
      showDisclaimer={false}
    >
      <div className="px-4 pb-6 pt-4 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-7xl motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
          {children}
        </div>
      </div>
    </AppLayout>
  );
}

export function RouteGuardLoader({
  message = DEFAULT_ROUTE_GUARD_MESSAGE,
  blocking = false,
}) {
  const location = useLocation();

  if (blocking) {
    return (
      <SurfaceLoader
        loading
        variant="app-blocking"
        message={message}
        delay={90}
        minVisible={280}
        overlayClassName="bg-white/58 backdrop-blur-sm"
      >
        <RouteGuardShell pathname={location.pathname}>
          <div
            className={`${ROUTE_GUARD_FRAME_CLASS_NAME} ${ROUTE_GUARD_MIN_HEIGHT}`}
            aria-hidden="true"
          />
        </RouteGuardShell>
      </SurfaceLoader>
    );
  }

  return (
    <RouteGuardShell pathname={location.pathname}>
      <SurfaceLoader
        loading
        variant="surface-loading"
        message={message}
        delay={100}
        minVisible={240}
        minHeightClassName={ROUTE_GUARD_MIN_HEIGHT}
        className={ROUTE_GUARD_FRAME_CLASS_NAME}
        overlayClassName="bg-white/44"
      />
    </RouteGuardShell>
  );
}

export default function ProtectedRouteWrapper({ allowedRoles, children }) {
  const { userData, loading: userContextLoading } = useUser();
  const location = useLocation();
  const currentAuthUser = auth.currentUser;

  if (userContextLoading) {
    return <RouteGuardLoader />;
  }

  if (!currentAuthUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (userData && userData.forcePasswordChange === true) {
    if (location.pathname !== "/force-change-password") {
      return (
        <Navigate
          to="/force-change-password"
          state={{ from: location }}
          replace
        />
      );
    }
  } else if (
    userData &&
    userData.forcePasswordChange === false &&
    location.pathname === "/force-change-password"
  ) {
    return <Navigate to="/" replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    if (!userData || !allowedRoles.includes(userData.role)) {
      console.warn(
        `접근 거부: 사용자 역할(${userData?.role})은 ${location.pathname} 경로에 필요한 역할(${allowedRoles.join(", ")})에 포함되지 않습니다.`,
      );
      return <Navigate to="/" replace />;
    }
  }

  return children ? children : <Outlet />;
}
