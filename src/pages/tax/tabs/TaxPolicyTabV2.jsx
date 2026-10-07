import React from "react";
import { useSearchParams } from "react-router-dom";
import { ListChecks, Settings2 } from "lucide-react";

import { Tabs } from "../../../components/ui";
import TaxPolicyMasterDetail from "./TaxPolicyMasterDetail";
import TaxRuleTab from "./TaxRuleTab";

export default function TaxPolicyTabV2(props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = searchParams.get("policySection") === "payrollRules" ? "payrollRules" : "automatic";
  const setActiveSection = (section) => {
    const next = new URLSearchParams(searchParams);
    next.set("policySection", section);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <Tabs
        ariaLabel="세금 정책 업무"
        tabs={[
          { id: "automatic", label: "원천징수·공제 정책", icon: Settings2 },
          { id: "payrollRules", label: "급여 공제 규칙", icon: ListChecks },
        ]}
        activeTab={activeSection}
        onTabChange={setActiveSection}
        variant="underline"
        size="sm"
      />

      {activeSection === "automatic" ? (
        <TaxPolicyMasterDetail {...props} />
      ) : (
        <TaxRuleTab {...props} />
      )}
    </div>
  );
}
