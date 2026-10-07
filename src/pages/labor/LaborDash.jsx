import React from "react";
import { Briefcase } from "lucide-react";
import OfficeDash, { OFFICE_TAB_IDS } from "../tax/OfficeDash";

const CROSS_PAGE_TAB_ROUTES = {
  taxFinance: "/tax",
  autoTaxPolicy: "/tax",
  incomeSettlement: "/tax",
  taxRules: "/tax",
  monthEndSettlement: "/tax",
};

export default function LaborDash() {
  return (
    <OfficeDash
      pageTitle="노동청"
      pageSubtitle="직업과 급여 운영 현황을 확인하고 관리합니다."
      pageIcon={Briefcase}
      tabIds={OFFICE_TAB_IDS.labor}
      crossPageTabRoutes={CROSS_PAGE_TAB_ROUTES}
    />
  );
}
