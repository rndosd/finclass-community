import React from "react";
import { useUser } from "../../../contexts/UserContext";
import { useClassUiConfig } from "../../../contexts/ClassUiConfigContext";
import { splitSidebarMenuItems } from "../../../components/layout/sidebarMenuUtils";

export default function StudentMenuNotice() {
  const { isTeacher, loading, hasPermission } = useUser();
  const { sidebarSettings, loading: menuLoading } = useClassUiConfig();
  if (isTeacher || loading || menuLoading || sidebarSettings === null) return null;
  const { visibleItems } = splitSidebarMenuItems({
    menuSettings: sidebarSettings,
    hasPermission,
    isTeacher: false,
  });
  if (visibleItems.some((item) => item.path !== "/dashboard")) return null;
  return (
    <div role="status" className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
      <p className="font-semibold">아직 선생님이 메뉴를 열지 않았어요.</p>
      <p>사용할 메뉴가 보이지 않으면 선생님께 메뉴 표시와 학생 권한을 확인해 달라고 말씀해 주세요.</p>
    </div>
  );
}
