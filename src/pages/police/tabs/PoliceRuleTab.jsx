import { appConfirm } from "../../../utils/appDialogs";
import React, { useMemo, useState } from "react";
import { Menu, Transition } from "@headlessui/react";
import {
  Cog6ToothIcon,
  GiftIcon,
  PencilSquareIcon,
  PlusCircleIcon,
  ShieldExclamationIcon,
  TableCellsIcon,
  TagIcon,
} from "@heroicons/react/24/outline";

import Button from "../../../components/ui/Button";
import { Modal, Spinner, Tabs } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import PoliceRuleBulkForm from "../components/PoliceRuleBulkForm";
import PoliceRuleForm from "../components/PoliceRuleForm";
import PoliceRuleList from "../components/PoliceRuleList";
import { usePoliceMutations } from "../hooks/usePoliceMutations";
import { useDangerLabelsQuery } from "../hooks/usePoliceQuery";
import DangerLabelSettingsModal from "../modals/DangerLabelSettingsModal";
import { isPenaltyRule, isRewardRule } from "../utils/policeRuleUtils";

const PoliceRuleTab = ({
  policeRules = [],
  classId,
  isPoliceAdmin = false,
  canManageRules = false,
  onApplyRule,
}) => {
  const { classData } = useUser();
  const isEditable = canManageRules;
  const currencyUnit = classData?.currencyUnit || "미르";

  const [activeTab, setActiveTab] = useState("penalty");
  const [editMode, setEditMode] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [showBulkRuleForm, setShowBulkRuleForm] = useState(false);
  const [currentRuleToEdit, setCurrentRuleToEdit] = useState(null);
  const [showDangerLabelModal, setShowDangerLabelModal] = useState(false);

  const { data: labelMap, isLoading: isLabelLoading } =
    useDangerLabelsQuery(classId);
  const { deleteRule, deleteRules, isDeleting, reorderRules, isReordering } =
    usePoliceMutations(classId);

  const penaltyRules = useMemo(
    () => (policeRules || []).filter((rule) => isPenaltyRule(rule)),
    [policeRules],
  );

  const rewardRules = useMemo(
    () => (policeRules || []).filter((rule) => isRewardRule(rule)),
    [policeRules],
  );

  const filteredRules = activeTab === "penalty" ? penaltyRules : rewardRules;
  const ruleTabs = useMemo(
    () => [
      {
        id: "penalty",
        label: "벌점 규칙",
        icon: ShieldExclamationIcon,
        badge: penaltyRules.length,
      },
      {
        id: "reward",
        label: "상점 규칙",
        icon: GiftIcon,
        badge: rewardRules.length,
      },
    ],
    [penaltyRules.length, rewardRules.length],
  );

  const handleEdit = (rule) => {
    setCurrentRuleToEdit(rule);
    setShowRuleForm(true);
  };

  const handleDelete = async (ruleId) => {
    if (
      !(await appConfirm("이 규칙을 삭제하면 복구할 수 없습니다. 정말 삭제하시겠습니까?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))
    ) {
      return;
    }

    deleteRule({ ruleId });
  };

  const handleBulkDelete = async (ruleIds = []) => {
    if (!Array.isArray(ruleIds) || ruleIds.length === 0) return;

    const message =
      ruleIds.length === 1
        ? "선택한 규칙을 삭제하시겠습니까?"
        : `선택한 ${ruleIds.length}개 규칙을 삭제하시겠습니까?`;

    if (!(await appConfirm(`${message} 삭제 후에는 복구할 수 없습니다.`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) {
      return;
    }

    await deleteRules(ruleIds);
  };

  const handleReorder = async (orderUpdates = []) => {
    if (!Array.isArray(orderUpdates) || orderUpdates.length === 0) return;
    await reorderRules(orderUpdates);
  };

  if (isLabelLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-20">
        <Spinner size="lg" />
        <p className="animate-pulse text-sm text-slate-500">
          규칙 설정을 불러오는 중...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in p-4 duration-500 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Tabs
          tabs={ruleTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          variant="underline"
          size="md"
        />

        {isEditable ? (
          <div className="grid w-full grid-cols-[1fr_1fr_auto] items-center gap-2 sm:flex sm:w-auto">
            <Button
              onClick={() => {
                setCurrentRuleToEdit(null);
                setShowRuleForm(true);
              }}
              tone="blue"
              size="sm"
              icon={PlusCircleIcon}
              className="justify-center"
            >
              규칙 추가
            </Button>

            <Button
              onClick={() => setShowBulkRuleForm(true)}
              tone="blue"
              kind="outline"
              size="sm"
              icon={TableCellsIcon}
              className="justify-center"
            >
              일괄 추가
            </Button>

            <Menu as="div" className="relative">
              <Menu.Button className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm transition-all hover:bg-slate-50">
                <Cog6ToothIcon className="h-5 w-5" />
              </Menu.Button>
              <Transition
                as={React.Fragment}
                enter="transition ease-out duration-100"
                enterFrom="scale-95 transform opacity-0"
                enterTo="scale-100 transform opacity-100"
                leave="transition ease-in duration-75"
                leaveFrom="scale-100 transform opacity-100"
                leaveTo="scale-95 transform opacity-0"
              >
                <Menu.Items className="absolute right-0 z-50 mt-2 w-48 origin-top-right rounded-2xl border border-slate-100 bg-white p-1 shadow-xl ring-1 ring-black/5 focus:outline-none">
                  <Menu.Item>
                    {({ active }) => (
                      <Button
                        type="button"
                        onClick={() => setEditMode((prev) => !prev)}
                        icon={PencilSquareIcon}
                        kind="ghost"
                        tone="slate"
                        size="sm"
                        className={`flex w-full items-center justify-start gap-3 transition-colors  ${
                          active ? "bg-slate-50" : ""
                        }  ${editMode ? "text-rose-600" : "text-slate-700"}`}
                      >
                        {editMode ? "편집 종료" : "편집 모드 설정"}
                      </Button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <Button
                        type="button"
                        onClick={() => setShowDangerLabelModal(true)}
                        icon={TagIcon}
                        kind="ghost"
                        tone="slate"
                        size="sm"
                        className={`flex w-full items-center justify-start gap-3 text-slate-700 transition-colors  ${
                          active ? "bg-slate-50" : ""
                        }`}
                      >
                        위험도 라벨 설정
                      </Button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Transition>
            </Menu>
          </div>
        ) : null}
      </div>

      {editMode ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
          <div className="rounded-lg bg-rose-500 p-1.5 shadow-sm">
            <ShieldExclamationIcon className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-rose-800">
              현재 규칙 편집 모드입니다.
            </p>
            <p className="text-xs text-rose-600">
              카드 선택과 순서 변경을 할 수 있고, 선택한 항목은 공통 툴바에서 한
              번에 삭제할 수 있습니다.
            </p>
          </div>
        </div>
      ) : null}

      <PoliceRuleList
        rules={filteredRules}
        ruleType={activeTab}
        isEditable={isEditable}
        editMode={editMode}
        labelMap={labelMap}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onApplyRule={isPoliceAdmin ? onApplyRule : undefined}
        onBulkDelete={handleBulkDelete}
        onReorder={handleReorder}
        isDeleting={isDeleting}
        isReordering={isReordering}
        currencyUnit={currencyUnit}
      />

      {showRuleForm ? (
        <Modal
          isOpen={showRuleForm}
          onClose={() => setShowRuleForm(false)}
          title={currentRuleToEdit ? "학급 규칙 수정" : "새로운 학급 규칙 추가"}
          size="md"
        >
          <PoliceRuleForm
            existingRule={currentRuleToEdit}
            isEditing={!!currentRuleToEdit}
            onClose={() => setShowRuleForm(false)}
            classId={classId}
          />
        </Modal>
      ) : null}

      {showBulkRuleForm ? (
        <Modal
          isOpen={showBulkRuleForm}
          onClose={() => setShowBulkRuleForm(false)}
          title="학급 규칙 일괄 추가"
          size="xl"
        >
          <PoliceRuleBulkForm
            existingRules={policeRules}
            defaultType={activeTab === "reward" ? "reward" : "penalty"}
            onClose={() => setShowBulkRuleForm(false)}
          />
        </Modal>
      ) : null}

      {showDangerLabelModal ? (
        <DangerLabelSettingsModal
          classId={classId}
          onClose={() => setShowDangerLabelModal(false)}
        />
      ) : null}
    </div>
  );
};

export default React.memo(PoliceRuleTab);
