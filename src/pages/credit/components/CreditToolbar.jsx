import React from "react";
import { Award, Settings } from "lucide-react";
import { Button, Tabs } from "../../../components/ui";

export default function CreditToolbar({
  tabs,
  activeTab,
  onTabChange,
  canManageCredit,
  onViewTiers,
  onEditTiers,
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange}
        variant="underline" ariaLabel="신용 업무" size="md" fullWidth className="max-w-xl" />
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button data-tour="credit-tier-table" tone="slate" kind="outline"
          onClick={onViewTiers} icon={Award} size="sm">등급표</Button>
        {canManageCredit ? (
          <Button tone="slate" kind="outline" onClick={onEditTiers}
            icon={Settings} size="sm">등급 기준 설정</Button>
        ) : null}
      </div>
    </div>
  );
}
