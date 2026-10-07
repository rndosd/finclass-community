import React from "react";
import { Landmark } from "lucide-react";
import OfficeDash, { OFFICE_TAB_IDS } from "./OfficeDash";

const CROSS_PAGE_TAB_ROUTES = {
  jobDefinitions: "/labor",
  jobApplications: "/labor",
  payroll: "/labor",
  jobStatus: "/labor",
};

export default function TaxDash() {
  return (
    <OfficeDash
      pageTitle="국세청"
      pageSubtitle="세금 규칙과 국고 현황을 확인하고 관리합니다."
      pageIcon={Landmark}
      tabIds={OFFICE_TAB_IDS.tax}
      crossPageTabRoutes={CROSS_PAGE_TAB_ROUTES}
    />
  );
}
