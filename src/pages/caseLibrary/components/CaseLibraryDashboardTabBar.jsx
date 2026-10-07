import React from "react";
import CaseLibraryTabStrip from "./CaseLibraryTabStrip";

export default function CaseLibraryDashboardTabBar({
  activeTab,
  tabs,
  onChange,
}) {
  return (
    <CaseLibraryTabStrip
      activeId={activeTab}
      items={tabs}
      onChange={onChange}
    />
  );
}
