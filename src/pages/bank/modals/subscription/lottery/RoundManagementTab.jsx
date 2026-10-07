import { appConfirm } from "../../../../../utils/appDialogs";
import React, { useState } from "react";
import {
  PencilIcon,
  TrashIcon,
  TrophyIcon,
  PlusIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { Button, IconButton, Modal } from "../../../../../components/ui";
import RoundForm from "./RoundForm";

const RoundManagementTab = ({
  product,
  currentRound,
  latestRoundNumber,
  createRound,
  updateRound,
  deleteRound,
  roundsLoading,
  showFeedback,
  onAfterCreateRound,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingRound, setEditingRound] = useState(null);

  const handleEditRound = (round) => {
    setEditingRound(round);
    setIsEditMode(true);
    setIsFormOpen(true);
  };

  const handleCreateClick = () => {
    setEditingRound(null);
    setIsEditMode(false);
    setIsFormOpen(true);
  };

  const handleDeleteRound = async (roundId) => {
    if (!(await appConfirm("정말 이 추첨 회차를 삭제하시겠습니까?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    const result = await deleteRound(roundId);
    if (result?.success) {
      showFeedback?.("추첨 회차가 삭제되었습니다.", "success");
    }
  };

  const renderStatusBadge = (status) => {
    switch (status) {
      case "running":
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            진행 중
          </span>
        );
      case "scheduled":
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            예정
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            추첨 완료
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {currentRound ? (
        <div className="bg-white border border-blue-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                현재 회차: {currentRound.roundNumber}회차
                {renderStatusBadge(currentRound.status)}
              </h3>
              <p className="text-indigo-100 text-sm">{currentRound.title}</p>
            </div>
            <div className="flex gap-2">
              {currentRound.status !== "completed" && (
                <IconButton
                  type="button"
                  onClick={() => handleEditRound(currentRound)}
                  icon={PencilIcon}
                  label="회차 수정"
                  tone="slate"
                  size="md"
                  className="rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
                  title="회차 수정"
                />
              )}
              <IconButton
                type="button"
                onClick={() => handleDeleteRound(currentRound.id)}
                icon={TrashIcon}
                label="회차 삭제"
                tone="red"
                size="md"
                className="rounded-lg text-white/80 hover:bg-red-500/20 hover:text-white"
                title="회차 삭제"
              />
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-indigo-600 mb-1">
                  {currentRound.roundNumber}
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">회차</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900 mb-1">
                  {currentRound.selectionMethod === "lottery" ? "추첨제" : "가점제"}
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">방식</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900 mb-1">
                  {currentRound.requiredPayments}회
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  필요 납입
                </div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900 mb-1">
                  {currentRound.winnerCount}명
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  당첨자 수
                </div>
              </div>
              <div>
                <div
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                    currentRound.preventDuplicateWinners
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {currentRound.preventDuplicateWinners
                    ? "중복 당첨 방지 ON"
                    : "중복 당첨 방지 OFF"}
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">
                  중복 당첨 방지
                </div>
              </div>
            </div>

            {currentRound.description && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">{currentRound.description}</p>
              </div>
            )}

            {currentRound.status === "completed" && (
              <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-5 text-center">
                <div className="flex flex-col items-center space-y-2">
                  <CheckCircleIcon className="h-10 w-10 text-green-600" />
                  <h4 className="text-lg font-semibold text-green-800">
                    추첨이 성공적으로 완료되었습니다.
                  </h4>
                  <p className="text-green-700 text-sm">
                    다음 회차를 생성해 계속 운영할 수 있습니다.
                  </p>
                  <Button
                    type="button"
                    onClick={handleCreateClick}
                    icon={PlusIcon}
                    tone="blue"
                    size="md"
                    rounded="lg"
                    className="mt-4 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2"
                  >
                    새 회차 만들기
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <TrophyIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 mb-4">아직 생성된 추첨 회차가 없습니다.</p>
          <Button
            type="button"
            onClick={handleCreateClick}
            icon={PlusIcon}
            tone="blue"
            size="md"
            rounded="lg"
            className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 mx-auto"
          >
            새 회차 만들기
          </Button>
        </div>
      )}

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        size="lg"
        title={isEditMode ? "회차 수정" : "새 회차 생성"}
      >
        <RoundForm
          product={product}
          isEditMode={isEditMode}
          editingRound={editingRound}
          createRound={createRound}
          updateRound={updateRound}
          nextRoundNumber={Number(latestRoundNumber || 0) + 1}
          onSuccess={() => {
            onAfterCreateRound?.();
            setIsFormOpen(false);
          }}
          onCancel={() => setIsFormOpen(false)}
          showFeedback={showFeedback}
          roundsLoading={roundsLoading}
        />
      </Modal>
    </div>
  );
};

export default RoundManagementTab;
