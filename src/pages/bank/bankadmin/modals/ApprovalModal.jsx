import { appConfirm } from "../../../../utils/appDialogs";
import React, { useEffect, useRef, useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import dayjs from "dayjs";
import {
  Button,
  IconButton,
  Modal,
  SectionLoader,
  Spinner,
  ToggleSwitch,
} from "../../../../components/ui";
import {
  CheckCircleIcon,
  BanknotesIcon,
  CreditCardIcon,
  DocumentTextIcon,
  InboxIcon,
  CursorArrowRaysIcon,
} from "@heroicons/react/24/outline";

import { db } from "../../../../firebase";
import { useUser } from "../../../../contexts/UserContext";
import { useBank } from "../../../../contexts/BankContext"; // 🚀 BankContext 추가
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { useBankAdmin } from "../../../../hooks/bank/useBankAdmin";
import { formatBankMoney } from "../../../../utils/bankMoney";

const DEFAULT_AUTO_APPROVAL_SETTINGS = Object.freeze({
  savings: false,
  loans: false,
});

const DEFAULT_OPTIMISTIC_COUNT_DELTA = Object.freeze({
  savings: 0,
  loans: 0,
});

const DEFAULT_OPTIMISTIC_HIDDEN_IDS = Object.freeze({
  savings: [],
  loans: [],
});

const AUTO_APPROVAL_CONTROLS = [
  {
    id: "savings",
    title: "예금 자동 승인",
    description: "조건을 만족한 신규 예금 신청을 즉시 승인합니다.",
  },
  {
    id: "loans",
    title: "대출 자동 승인",
    description:
      "조건을 만족한 신규 대출 신청을 즉시 처리합니다. 끄면 승인 대기로 남아 직접 상담 후 승인할 수 있습니다.",
  },
];

const AUTO_APPROVAL_FEEDBACK = {
  savings: {
    enabled:
      "예금 자동 승인이 켜졌습니다. 조건을 만족한 신규 예금 신청은 즉시 승인됩니다.",
    disabled:
      "예금 자동 승인이 꺼졌습니다. 신규 예금 신청은 승인 대기로 들어갑니다.",
  },
  loans: {
    enabled:
      "대출 자동 승인이 켜졌습니다. 조건을 만족한 신규 대출 신청은 즉시 처리됩니다.",
    disabled:
      "대출 자동 승인이 꺼졌습니다. 신규 대출 신청은 승인 대기로 남아 직접 상담 후 승인할 수 있습니다.",
  },
};

function resolveAutoApprovalSettings(bankSettings = {}) {
  const legacyValue =
    typeof bankSettings?.isAutoApprovalEnabled === "boolean"
      ? bankSettings.isAutoApprovalEnabled
      : false;

  return {
    savings:
      typeof bankSettings?.depositAutoApprovalEnabled === "boolean"
        ? bankSettings.depositAutoApprovalEnabled
        : legacyValue,
    loans:
      typeof bankSettings?.loanAutoApprovalEnabled === "boolean"
        ? bankSettings.loanAutoApprovalEnabled
        : legacyValue,
  };
}

const TABS = {
  savings: {
    id: "savings",
    title: "예금 승인",
    icon: BanknotesIcon,
    type: "saving",
  },
  loans: {
    id: "loans",
    title: "대출 승인",
    icon: CreditCardIcon,
    type: "loan",
  },
};

export default function ApprovalModal({
  isOpen,
  onClose,
  classId: classIdProp,
  // onActionProcessed, // 🚀 컨텍스트가 자동 갱신하므로 이제 필요 없음
  currencyUnit: currencyUnitProp,
  initialTab = "savings",
  ...modalProps
}) {
  const { classId: contextClassId, classData, isTeacher, userData } = useUser();
  const { showFeedback } = useFeedback();

  const { bankSettings } = useBank();
  const depositAutoApprovalEnabled = bankSettings?.depositAutoApprovalEnabled;
  const loanAutoApprovalEnabled = bankSettings?.loanAutoApprovalEnabled;
  const legacyAutoApprovalEnabled = bankSettings?.isAutoApprovalEnabled;
  const [activeTab, setActiveTab] = useState(initialTab);

  const classId =
    classIdProp || contextClassId || userData?.classId || classData?.classId;
  const currencyUnit = currencyUnitProp || classData?.currencyUnit || "캐시";
  const {
    pendingSavings,
    pendingLoans,
    pendingCounts,
    isPendingListsReady,
    isPendingListsLoading,
    refetchPendingLists,
  } = useBankAdmin(classId, true, {
    enabled: isOpen,
    kinds: ["savings", "loans"],
    canRepair: isTeacher,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedLoanContract, setSelectedLoanContract] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIndex, setDragStartIndex] = useState(null);
  const [autoApprovalSettings, setAutoApprovalSettings] = useState(
    DEFAULT_AUTO_APPROVAL_SETTINGS,
  );
  const [optimisticCountDelta, setOptimisticCountDelta] = useState(
    DEFAULT_OPTIMISTIC_COUNT_DELTA,
  );
  const [optimisticHiddenIds, setOptimisticHiddenIds] = useState(
    DEFAULT_OPTIMISTIC_HIDDEN_IDS,
  );
  const [isSavingAutoApproval, setIsSavingAutoApproval] = useState(false);
  const dragSelectionRef = useRef({
    baseSelection: new Set(),
    hasMoved: false,
    mode: "select",
  });

  // 승인 상세 리스트는 모달이 열릴 때만 불러온다.
  const hiddenIds =
    activeTab === "savings"
      ? optimisticHiddenIds.savings
      : optimisticHiddenIds.loans;
  const currentItems = (
    activeTab === "savings" ? pendingSavings : pendingLoans
  ).filter((item) => !hiddenIds.includes(item.id));
  const isAwaitingSummarySync =
    optimisticHiddenIds.savings.length > 0 || optimisticHiddenIds.loans.length > 0;
  const displayedPendingCounts = {
    savings: Math.max(
      0,
      pendingCounts.savings + optimisticCountDelta.savings,
    ),
    loans: Math.max(
      0,
      pendingCounts.loans + optimisticCountDelta.loans,
    ),
  };

  // 모달 재오픈 시 탭/선택 상태를 항상 외부 상태(initialTab)와 동기화
  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(TABS[initialTab] ? initialTab : "savings");
    setSelectedIds(new Set());
    setIsDragging(false);
    setDragStartIndex(null);
  }, [isOpen, initialTab]);

  useEffect(() => {
    setAutoApprovalSettings(
      resolveAutoApprovalSettings({
        depositAutoApprovalEnabled,
        loanAutoApprovalEnabled,
        isAutoApprovalEnabled: legacyAutoApprovalEnabled,
      }),
    );
  }, [
    depositAutoApprovalEnabled,
    loanAutoApprovalEnabled,
    legacyAutoApprovalEnabled,
  ]);

  useEffect(() => {
    if (!isOpen || !classId) {
      setOptimisticCountDelta(DEFAULT_OPTIMISTIC_COUNT_DELTA);
      setOptimisticHiddenIds(DEFAULT_OPTIMISTIC_HIDDEN_IDS);
      return;
    }
  }, [classId, isOpen]);

  useEffect(() => {
    const nextSavings = optimisticHiddenIds.savings.filter((id) =>
      pendingSavings.some((item) => item.id === id),
    );
    const nextLoans = optimisticHiddenIds.loans.filter((id) =>
      pendingLoans.some((item) => item.id === id),
    );

    if (
      nextSavings.length === optimisticHiddenIds.savings.length &&
      nextLoans.length === optimisticHiddenIds.loans.length
    ) {
      return;
    }

    const clearedSavingsCount =
      optimisticHiddenIds.savings.length - nextSavings.length;
    const clearedLoansCount =
      optimisticHiddenIds.loans.length - nextLoans.length;

    setOptimisticHiddenIds({
      savings: nextSavings,
      loans: nextLoans,
    });

    if (clearedSavingsCount > 0 || clearedLoansCount > 0) {
      setOptimisticCountDelta((prev) => ({
        savings: prev.savings + clearedSavingsCount,
        loans: prev.loans + clearedLoansCount,
      }));
    }
  }, [
    optimisticHiddenIds,
    pendingLoans,
    pendingSavings,
  ]);

  const handleAutoApprovalToggle = async (type, nextValue) => {
    if (!classId || isSavingAutoApproval) return;

    setIsSavingAutoApproval(true);
    try {
      const settingsRef = doc(db, "classes", classId, "bank", "settings");
      const snap = await getDoc(settingsRef);
      const prevSettings = resolveAutoApprovalSettings(snap.data() || {});
      const nextSettings = {
        ...prevSettings,
        [type]: nextValue,
      };

      await setDoc(
        settingsRef,
        {
          depositAutoApprovalEnabled: nextSettings.savings,
          loanAutoApprovalEnabled: nextSettings.loans,
          isAutoApprovalEnabled:
            nextSettings.savings && nextSettings.loans,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setAutoApprovalSettings(nextSettings);
      if (prevSettings[type] !== nextValue) {
        showFeedback(
          nextValue
            ? AUTO_APPROVAL_FEEDBACK[type].enabled
            : AUTO_APPROVAL_FEEDBACK[type].disabled,
          "success",
        );
      }
    } catch (error) {
      console.error("auto approval toggle error:", error);
      showFeedback("자동 승인 설정 저장에 실패했습니다.", "error");
    } finally {
      setIsSavingAutoApproval(false);
    }
  };

  const isInteractiveTarget = (target) =>
    typeof Element !== "undefined" &&
    target instanceof Element &&
    Boolean(
      target.closest(
        'button, input, textarea, select, a, [role="button"], [data-row-action="true"]',
      ),
    );

  // --- 드래그 선택 로직 ---
  const handleMouseDown = (event, index, itemId, disabled = false) => {
    if (disabled || event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }

    event.preventDefault();
    dragSelectionRef.current = {
      baseSelection: new Set(selectedIds),
      hasMoved: false,
      mode: selectedIds.has(itemId) ? "deselect" : "select",
    };
    setIsDragging(true);
    setDragStartIndex(index);
  };

  const handleMouseEnter = (index) => {
    if (!isDragging || dragStartIndex === null) return;

    const start = Math.min(dragStartIndex, index);
    const end = Math.max(dragStartIndex, index);
    const { baseSelection, mode } = dragSelectionRef.current;
    const newSelection = new Set(baseSelection);
    dragSelectionRef.current.hasMoved =
      dragSelectionRef.current.hasMoved || index !== dragStartIndex;

    for (let i = start; i <= end; i++) {
      const targetId = currentItems[i]?.id;
      if (!targetId) continue;

      if (mode === "select") {
        newSelection.add(targetId);
      } else {
        newSelection.delete(targetId);
      }
    }
    setSelectedIds(newSelection);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStartIndex(null);
  };

  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRowClick = (event, itemId, disabled = false) => {
    if (disabled || isInteractiveTarget(event.target)) {
      return;
    }

    if (dragSelectionRef.current.hasMoved) {
      dragSelectionRef.current.hasMoved = false;
      return;
    }

    toggleSelection(itemId);
  };

  const handleSelectAll = (e) => {
    if (e.target.checked)
      setSelectedIds(new Set(currentItems.map((item) => item.id)));
    else setSelectedIds(new Set());
  };

  // --- 처리 핸들러 ---
  const handleAction = async (approve, targetItems = null) => {
    const itemsToProcess =
      targetItems || currentItems.filter((item) => selectedIds.has(item.id));
    if (itemsToProcess.length === 0 || isProcessing) return;

    const actionText = approve ? "승인" : "거절";
    const confirmMsg =
      itemsToProcess.length === 1
        ? `${itemsToProcess[0].studentName}님의 신청을 ${actionText}하시겠습니까?`
        : `선택한 ${itemsToProcess.length}건을 일괄 ${actionText}하시겠습니까?`;

    if (!(await appConfirm(confirmMsg))) return;

    setIsProcessing(true);
    setSelectedIds(new Set());
    try {
      const functions = getFunctions(undefined, "asia-northeast3");
      const approveFn = httpsCallable(functions, "approveBankApplications");
      const deltaKey = activeTab === "savings" ? "savings" : "loans";

      setOptimisticHiddenIds((prev) => ({
        ...prev,
        [deltaKey]: Array.from(
          new Set([...prev[deltaKey], ...itemsToProcess.map((item) => item.id)]),
        ),
      }));
      setOptimisticCountDelta((prev) => ({
        ...prev,
        [deltaKey]: prev[deltaKey] - itemsToProcess.length,
      }));

      const applications = itemsToProcess.map((item) => ({
        applicationId: item.id,
        studentUid: item.studentUid,
        // 🚨 [수정] item.type 대신 activeTab 상태를 보고 결정해야 정확합니다!
        kind: activeTab === "savings" ? "saving" : "loan",
      }));

      await approveFn({ classId, approve, applications });

      showFeedback(
        `${itemsToProcess.length}건이 ${actionText}되었습니다.`,
        "success",
      );
    } catch (error) {
      const deltaKey = activeTab === "savings" ? "savings" : "loans";
      console.error(error);
      setOptimisticHiddenIds((prev) => ({
        ...prev,
        [deltaKey]: prev[deltaKey].filter(
          (id) => !itemsToProcess.some((item) => item.id === id),
        ),
      }));
      setOptimisticCountDelta((prev) => ({
        ...prev,
        [deltaKey]: prev[deltaKey] + itemsToProcess.length,
      }));
      showFeedback(
        error?.message || "처리 중 오류가 발생했습니다.",
        "error",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="승인 관리 센터" size="xl" {...modalProps}>
      <div
        className="flex flex-col max-h-[75vh]"
        onMouseLeave={handleMouseUp}
        onMouseUp={handleMouseUp}
      >
        {/* 상단 탭 */}
        <div className="flex p-1 bg-slate-100 rounded-xl mb-4">
          {Object.values(TABS).map((tab) => {
            // 🚀 탭별 개수 계산 (Context 데이터 사용)
            const count =
              tab.id === "savings"
                ? displayedPendingCounts.savings
                : displayedPendingCounts.loans;

            return (
              <Button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setSelectedIds(new Set());
                }}
                tone="blue"
                kind={activeTab === tab.id ? "soft" : "ghost"}
                size="sm"
                rounded="lg"
                className={`flex-1 flex items-center justify-center py-2 text-sm font-bold rounded-lg transition-all ${
                  activeTab === tab.id
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <tab.icon
                  className={`w-4 h-4 mr-2 ${activeTab === tab.id ? "text-blue-600" : "text-slate-400"}`}
                />
                {tab.title}
                {count > 0 && (
                  <span
                    className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${
                      activeTab === tab.id
                        ? "bg-blue-600 text-white"
                        : "bg-slate-300 text-slate-600"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </Button>
            );
          })}
        </div>

        {/* 일괄 선택 헤더 (기존과 동일) */}
        <div className="mb-4 px-4 py-3 rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 pb-3">
            <div>
              <p className="text-sm font-bold text-slate-800">
                자동 승인 설정
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                예금과 대출을 각각 따로 관리할 수 있습니다.
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {AUTO_APPROVAL_CONTROLS.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {item.title}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {item.description}
                  </p>
                </div>
                <ToggleSwitch
                  checked={autoApprovalSettings[item.id]}
                  onChange={(nextValue) =>
                    handleAutoApprovalToggle(item.id, nextValue)
                  }
                  disabled={isSavingAutoApproval}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between mb-3 px-2 py-2 bg-slate-50 rounded-lg border border-slate-100">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              onChange={handleSelectAll}
              checked={
                currentItems.length > 0 &&
                selectedIds.size === currentItems.length
              }
            />
            <span className="text-xs font-bold text-slate-600">
              {selectedIds.size > 0
                ? `${selectedIds.size}건 선택됨`
                : "전체 선택"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isAwaitingSummarySync && !isPendingListsLoading && (
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                <Spinner
                  size="xs"
                  color="current"
                  containerClassName="gap-0"
                />
                <span>최신 내역 반영 중</span>
              </div>
            )}
            {selectedIds.size > 0 && (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  tone="rose"
                  onClick={() => handleAction(false)}
                  disabled={isProcessing}
                >
                  일괄 거절
                </Button>
                <Button
                  size="xs"
                  tone="blue"
                  onClick={() => handleAction(true)}
                  disabled={isProcessing}
                  isLoading={isProcessing}
                >
                  일괄 승인
                </Button>
              </>
            )}
            <Button
              size="xs"
              variant="outline"
              tone="slate"
              onClick={() => void refetchPendingLists({ force: true })}
              disabled={isPendingListsLoading || isProcessing}
            >
              새로고침
            </Button>
          </div>
        </div>

        {/* 리스트 본문 */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar select-none">
          {!isPendingListsReady ? (
            <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
              <SectionLoader
                message={"\uC2B9\uC778 \uB300\uAE30 \uB0B4\uC5ED\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4..."}
                tone="slate"
                size="sm"
                showSkeleton={false}
                minHeightClassName="min-h-[240px]"
              />
            </div>
          ) : currentItems.length === 0 ? (
            <div className="py-20 text-center border-2 border-dashed border-slate-100 rounded-2xl">
              <InboxIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">
                {TABS[activeTab].title} 내역이 없습니다.
              </p>
            </div>
          ) : (
            currentItems.map((item, index) => (
              <div
                key={item.id}
                onMouseDown={(event) =>
                  handleMouseDown(event, index, item.id, isProcessing)
                }
                onMouseEnter={() => handleMouseEnter(index)}
                onClick={(event) => handleRowClick(event, item.id, isProcessing)}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
                  selectedIds.has(item.id)
                    ? "bg-blue-50 border-blue-200 shadow-sm"
                    : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                {/* ... (리스트 아이템 내부 UI 기존과 동일) ... */}
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleSelection(item.id)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600"
                  disabled={isProcessing}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-900">
                      {item.studentName}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium tabular-nums">
                      {item.createdAt?.toDate
                        ? dayjs(item.createdAt.toDate()).format("MM.DD HH:mm")
                        : "-"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {item.productName || item.productLabel}
                    <span className="mx-1 text-slate-300">|</span>
                    <span className="text-blue-600 font-bold">
                      {formatBankMoney(item.amount)} {currencyUnit}
                    </span>
                  </div>
                </div>
                <div
                  className="flex gap-1"
                  data-row-action="true"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {activeTab === "loans" && (
                    <IconButton
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedLoanContract(item);
                      }}
                      icon={DocumentTextIcon}
                      label="계약서 미리보기"
                      tone="rose"
                      size="md"
                      className="rounded-lg text-rose-600 hover:bg-rose-100"
                      title="계약서 미리보기"
                    />
                  )}
                  <IconButton
                    type="button"
                    onClick={() => handleAction(true, [item])}
                    icon={CheckCircleIcon}
                    label="즉시 승인"
                    tone="blue"
                    size="md"
                    className="rounded-lg text-blue-600 hover:bg-blue-100"
                    title="즉시 승인"
                  />
                </div>
              </div>
            ))
          )}
        </div>

        {/* 하단 안내 */}
        <div className="mt-4 pt-3 border-t flex justify-between items-center text-[11px] text-slate-400">
          <div className="flex items-center gap-1">
            <CursorArrowRaysIcon className="w-3 h-3" />
            행을 클릭하거나 마우스로 드래그하면 여러 개를 빠르게 선택할 수 있습니다.
          </div>
          <Button onClick={onClose} variant="secondary" size="sm">
            닫기
          </Button>
        </div>

        {selectedLoanContract ? (
          <Modal
            isOpen={true}
            onClose={() => setSelectedLoanContract(null)}
            title="대출 계약서 미리보기"
            size="xl"
          >
            <div className="max-h-[78vh] space-y-5 overflow-y-auto p-5 text-left sm:p-7">
              <div className="flex items-start justify-between border-b-2 border-rose-500 pb-4">
                <div>
                  <p className="text-[11px] font-black tracking-[0.16em] text-rose-500">LOAN CONTRACT</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-900">{classData?.className || "우리 반"} 대출 계약서</h2>
                </div>
                <DocumentTextIcon className="h-9 w-9 text-rose-500" />
              </div>
              <dl className="grid overflow-hidden rounded-xl border border-rose-200 sm:grid-cols-2">
                <div className="flex border-b border-rose-100 sm:border-r"><dt className="w-28 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">대출 상품</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{selectedLoanContract.productName || selectedLoanContract.productLabel || "대출 상품"}</dd></div>
                <div className="flex border-b border-rose-100"><dt className="w-28 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">대출자</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{selectedLoanContract.studentName || "학생"}</dd></div>
                <div className="flex sm:border-r"><dt className="w-28 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">대출 원금</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{formatBankMoney(selectedLoanContract.amount || selectedLoanContract.principal || 0)} {currencyUnit}</dd></div>
                <div className="flex"><dt className="w-28 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">대출 기간</dt><dd className="px-3 py-2 text-sm font-black text-slate-800">{selectedLoanContract.days || 0}일</dd></div>
              </dl>
              <section className="rounded-xl border border-rose-200 border-l-4 p-4">
                <h3 className="mb-2 text-xs font-black text-rose-600">계약 내용</h3>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
                  <li>대출자는 위 상품의 원금과 대출 기간을 확인했습니다.</li>
                  <li>정상 상환액에는 원금과 약정 이자가 포함됩니다.</li>
                  <li>상환일 이후에는 원금의 하루 {Number(selectedLoanContract.overdueRate ?? 0.5)}% 연체료가 추가됩니다.</li>
                  <li>대출 신청, 승인, 상환과 정산은 학급 은행 규칙에 따라 진행합니다.</li>
                </ol>
              </section>
              <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="mb-2 text-xs font-black text-rose-600">대출자 확인 및 서명</h3>
                <p className="text-sm font-bold text-slate-700">대출 조건과 상환 내용을 확인했습니다.</p>
                <div className="mt-3 flex min-h-[150px] items-end justify-end rounded-xl border border-slate-200 bg-white p-3">
                  {selectedLoanContract.borrowerSignatureImg ? <img src={selectedLoanContract.borrowerSignatureImg} alt="대출자 서명" className="max-h-24 max-w-[180px] object-contain" /> : <span className="text-xs font-bold text-slate-400">저장된 서명이 없습니다.</span>}
                </div>
              </section>
            </div>
          </Modal>
        ) : null}
      </div>
    </Modal>
  );
}
