import React, { useEffect, useMemo, useRef, useState } from "react";
import { Tab } from "@headlessui/react";
import {
  SparklesIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  PlayIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import Modal from "../../../../components/ui/Modal";

import {
  useLotteryRounds,
  useEligibleParticipantsQuery,
} from "../../hooks/subscription/useLotteryQueries";
import { useLotteryMutations } from "../../hooks/subscription/useLotteryMutations";

import RoundManagementTab from "./lottery/RoundManagementTab";
import LotteryExecutionTab from "./lottery/LotteryExecutionTab";
import LotteryHistoryTab from "./lottery/LotteryHistoryTab";

const LotteryModal = ({
  isOpen,
  onClose,
  product,
  classId,
  currencyUnit,
  showFeedback,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [dismissedRoundIds, setDismissedRoundIds] = useState([]);
  const justCreatedRef = useRef(false);

  const { data: allRounds = [], isLoading: roundsLoading } = useLotteryRounds(
    classId,
    product?.id,
  );

  const { currentRound, completedRounds, latestRoundNumber } = useMemo(() => {
    const active = allRounds.filter(
      (r) => r.status === "scheduled" || r.status === "running",
    );
    const completed = allRounds.filter((r) => r.status === "completed");
    const displayRound =
      active[0] || completed.find((r) => !dismissedRoundIds.includes(r.id)) || null;
    const maxRound = allRounds.reduce(
      (max, r) => Math.max(max, Number(r.roundNumber || 0)),
      0,
    );

    return {
      currentRound: displayRound,
      completedRounds: completed,
      latestRoundNumber: maxRound,
    };
  }, [allRounds, dismissedRoundIds]);

  const { data: participants = [], isLoading: loadingParticipants } =
    useEligibleParticipantsQuery(classId, product?.id, currentRound);

  const { createMutation, updateMutation, deleteMutation, executeMutation } =
    useLotteryMutations(classId, product?.id, showFeedback);

  useEffect(() => {
    if (justCreatedRef.current && currentRound?.status === "scheduled") {
      setActiveTab(1);
      justCreatedRef.current = false;
    }
  }, [currentRound]);

  if (!product) return null;

  const tabs = [
    { name: "회차 관리", icon: Cog6ToothIcon, disabled: false },
    { name: "참여자 확인", icon: UserGroupIcon, disabled: !currentRound },
    { name: "추첨 실행·발표", icon: PlayIcon, disabled: !currentRound },
    { name: "당첨자 기록", icon: TrophyIcon, disabled: false },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <Modal.Header>
        <div className="flex items-center gap-3 text-slate-800">
          <div className="p-2 bg-purple-100 rounded-lg">
            <SparklesIcon className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{product.title} 추첨 관리</h2>
            <p className="text-sm text-slate-500">
              {currentRound
                ? `${currentRound.roundNumber}회차 · 참여 자격 ${participants.length}명`
                : "새로운 추첨 회차를 생성해 운영을 시작하세요."}
            </p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Body className="p-0">
        <Tab.Group selectedIndex={activeTab} onChange={setActiveTab}>
          <Tab.List className="flex border-b bg-slate-50 px-6">
            {tabs.map((tab) => (
              <Tab
                key={tab.name}
                disabled={tab.disabled}
                className={({ selected }) =>
                  [
                    "flex items-center gap-2 px-4 py-4 font-semibold text-sm transition-all border-b-[3px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                    tab.disabled ? "opacity-30 cursor-not-allowed" : "",
                    selected
                      ? "border-blue-700 text-blue-800 bg-white"
                      : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100",
                  ].join(" ")
                }
              >
                <tab.icon className="h-5 w-5" />
                {tab.name}
              </Tab>
            ))}
          </Tab.List>

          <Tab.Panels
            className="p-6 overflow-y-auto"
            style={{ minHeight: "400px", maxHeight: "calc(85vh - 250px)" }}
          >
            <Tab.Panel>
              <RoundManagementTab
                product={product}
                currentRound={currentRound}
                latestRoundNumber={latestRoundNumber}
                createRound={async (data) => {
                  justCreatedRef.current = true;
                  return createMutation.mutateAsync(data);
                }}
                updateRound={(roundId, updates) =>
                  updateMutation.mutateAsync({ roundId, updates })}
                deleteRound={(id) => deleteMutation.mutateAsync(id)}
                roundsLoading={
                  roundsLoading ||
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  deleteMutation.isPending
                }
                showFeedback={showFeedback}
              />
            </Tab.Panel>

            <Tab.Panel>
              <LotteryExecutionTab
                mode="participants"
                currentRound={currentRound}
                participants={participants}
                loadingParticipants={loadingParticipants}
                currencyUnit={currencyUnit}
              />
            </Tab.Panel>

            <Tab.Panel>
              <LotteryExecutionTab
                mode="execute"
                currentRound={currentRound}
                participants={participants}
                executeRound={(roundId) => executeMutation.mutateAsync(roundId)}
                isExecuting={executeMutation.isPending}
                currencyUnit={currencyUnit}
                onCreateNewRound={() => {
                  if (!currentRound?.id) return;
                  setDismissedRoundIds((prev) => [...prev, currentRound.id]);
                  setActiveTab(0);
                }}
              />
            </Tab.Panel>

            <Tab.Panel>
              <LotteryHistoryTab
                completedRounds={completedRounds}
                currencyUnit={currencyUnit}
              />
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>
      </Modal.Body>
    </Modal>
  );
};

export default LotteryModal;
