import React, { useEffect, useState } from "react";
import { BarChart3, ListChecks } from "lucide-react";

import { Modal, Tabs } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { useClassStudents } from "../../../hooks/user/useClassStudents";
import StorePendingRedemptions from "../components/StorePendingRedemptions";
import StoreLimitStatusPanel from "../components/StoreLimitStatusPanel";

const TAB_ITEMS = [
  {
    id: "ledger",
    label: "구매 내역",
    icon: ListChecks,
  },
  {
    id: "limits",
    label: "구매 제한 현황",
    icon: BarChart3,
  },
];

const StoreManagementCenterModal = ({
  isOpen,
  onClose,
  items = [],
  categories = [],
}) => {
  const { classId } = useUser();
  const [activeTab, setActiveTab] = useState("ledger");
  const { data: students = [], isLoading: studentsLoading } = useClassStudents(
    classId,
    {
      enabled: Boolean(isOpen && activeTab === "limits" && classId),
      realtime: false,
    },
  );

  useEffect(() => {
    if (isOpen) {
      setActiveTab("ledger");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <Modal.Header>
        <div className="flex items-center justify-between gap-4 pr-8">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900">
              구매 관리 센터
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              학생 구매 내역과 구매 제한 현황을 한 곳에서 관리합니다.
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="space-y-6 bg-slate-50/40">
        <Tabs
          tabs={TAB_ITEMS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          variant="underline"
          size="md"
          className="bg-transparent"
        />

        {activeTab === "ledger" ? (
          <StorePendingRedemptions
            asModal
            onClose={onClose}
            view="ledger"
            showBackButton={false}
            title="구매 내역"
            items={items}
            categories={categories}
          />
        ) : null}

        {activeTab === "limits" ? (
          <StoreLimitStatusPanel
            isOpen={isOpen}
            items={items}
            students={students}
            studentsLoading={studentsLoading}
          />
        ) : null}
      </Modal.Body>
    </Modal>
  );
};

export default StoreManagementCenterModal;
