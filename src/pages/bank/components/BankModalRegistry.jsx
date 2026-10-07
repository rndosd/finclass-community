import React from "react";

// --- 기존 모달들 import ---
import DepositHistoryModal from "../modals/DepositHistoryModal";
import LoanHistoryModal from "../modals/LoanHistoryModal";
// import RepayModal from "../modals/RepayModal"; // 👈 [삭제] LoanHistoryModal 내부로 이동했으므로 여기서 안 씁니다.
import DepositConfirmationModal from "../modals/DepositConfirmationModal";
import LoanConfirmationModal from "../modals/LoanConfirmationModal";
import SavingClaimConfirmationModal from "../modals/SavingClaimConfirmationModal";
import UnifiedProductManagementModal from "../bankadmin/modals/UnifiedProductManagementModal";
import TierRateAdjustmentModal from "../bankadmin/modals/TierRateAdjustmentModal";
import ApprovalModal from "../bankadmin/modals/ApprovalModal";
import LoanContractCenterModal from "../bankadmin/modals/LoanContractCenterModal";
import LoanLimitSettingsModal from "../bankadmin/modals/LoanLimitSettingsModal";
import ClassBankOverviewModal from "../bankadmin/modals/ClassBankOverviewModal";
import SubscriptionOverviewModal from "../bankadmin/modals/SubscriptionOverviewModal";

// --- 청약통장 모달들 ---
import SubscriptionHistoryModal from "../modals/subscription/SubscriptionHistoryModal";
import SubscriptionManagementModal from "../bankadmin/modals/SubscriptionManagementModal";
import DepositEffectSimulatorModal from "../modals/DepositEffectSimulatorModal";
import BankDepositOperationAssistantModal from "../modals/BankDepositOperationAssistantModal";

/**
 * @param {Object} modalState - 단순 열림/닫힘 상태 (Bank.jsx의 modalState)
 * @param {Function} closeModal - 모달 닫기 함수
 * @param {Object} actions - 각 기능별 훅에서 반환된 액션 함수들
 * @param {Object} data - 모달 렌더링에 필요한 모든 데이터 (uid, classId, 현황 등)
 */
export default function BankModalRegistry({
  modalState,
  closeModal,
  actions,
  data,
}) {
  const {
    depositActions,
    loanActions,
    savingsManagement,
    loanRepayment,
  } = actions;

  const {
    uid,
    classId,
    currencyUnit,
    studentInfo,
    studentAssets, // 👈 여기서 이미 학생 자산을 가져오고 있습니다.
    bankSettings,
    tierCriteria,
    tierAdjustments,
    currentRateModifiers,
    savings,
    loans,
    hasPermission,
    isMyBankPage,
    classDisplayName,
  } = data;

  return (
    <>
      {/* 1️⃣ 신청 확인 및 실행 모달 */}
      {depositActions.showDepositConfirmModal && depositActions.depositConfirmDetails?.product && (
        <DepositConfirmationModal
          isOpen={depositActions.showDepositConfirmModal}
          onClose={() => depositActions.setShowDepositConfirmModal(false)}
          onConfirm={depositActions.executeDepositApplication}
          {...depositActions.depositConfirmDetails}
          currencyUnit={currencyUnit}
          isSubmitting={depositActions.isSubmittingDeposit}
        />
      )}

      {/* 2️⃣ 대출 신청 확인 모달 */}
      {loanActions.showLoanConfirmModal && loanActions.loanConfirmDetails?.product && (
        <LoanConfirmationModal
          isOpen={loanActions.showLoanConfirmModal}
          onClose={() => loanActions.setShowLoanConfirmModal(false)}
          onConfirm={loanActions.executeLoanApplication}
          {...loanActions.loanConfirmDetails}
          currencyUnit={currencyUnit}
          loanContractEnabled={bankSettings?.loanContractEnabled === true}
          studentName={studentInfo?.name || "학생"}
          classDisplayName={classDisplayName || "우리 반"}
          isSubmitting={loanActions.isSubmittingLoan}
        />
      )}

      {/* 2️⃣ 내역 조회 및 중도 해지/상환 모달 */}
      {savingsManagement.showClaimConfirmModal &&
        savingsManagement.claimConfirmDetails?.saving && (
          <SavingClaimConfirmationModal
            isOpen={savingsManagement.showClaimConfirmModal}
            onClose={savingsManagement.closeClaimConfirmModal}
            onConfirm={savingsManagement.confirmClaimAction}
            saving={savingsManagement.claimConfirmDetails.saving}
            breakdown={savingsManagement.claimConfirmDetails.breakdown}
            payoutAmount={savingsManagement.claimConfirmDetails.payoutAmount}
            currencyUnit={currencyUnit}
            isSubmitting={savingsManagement.isProcessingSaving}
          />
        )}

      {modalState.depositHistory && (
        <DepositHistoryModal
          open={true}
          onClose={() => closeModal("depositHistory")}
          studentName={studentInfo?.name || "학생"}
          processSavingAction={savingsManagement.processSavingAction}
          isMyBankPage={isMyBankPage}
          currencyUnit={currencyUnit}
          uid={uid}
          classId={classId}
          savings={savings}
          isProcessing={savingsManagement.isProcessingSaving}
        />
      )}

      {modalState.loanHistory && (
        <LoanHistoryModal
          open={true}
          onClose={() => closeModal("loanHistory")}
          uid={uid}
          classId={classId}
          studentName={studentInfo?.name || "학생"}
          loans={loans}
          isMyBankPage={isMyBankPage}
          currencyUnit={currencyUnit}
          // 🚀 [수정] currencyField 에러 해결 -> studentAssets.cash 사용
          studentCashBalance={studentAssets?.cash || 0}
          isRepayingLoan={loanRepayment.isRepayingLoan}
          // 상환 실행 함수 연결 (loanRepayment 훅 사용)
          onRepay={async (loan, amount) => {
            // loanRepayment 훅에 있는 '실제 상환 실행' 함수를 호출
            // (함수 이름은 hook 구현에 따라 다를 수 있으나 보통 handleRepayLoan 또는 repayLoan 등임)
            if (loanRepayment.handleRepayLoan) {
              return await loanRepayment.handleRepayLoan(loan.id, amount);
            } else {
              console.error("handleRepayLoan 함수를 찾을 수 없습니다.");
            }
          }}
        />
      )}

      {/* 🗑️ [삭제됨] RepayModal
        이유: 이제 LoanHistoryModal 내부에서 자체적으로 RepayModal을 띄우므로, 
        여기서 중복으로 렌더링하면 안 됩니다.
      */}

      {/* 3️⃣ 은행 관리자 전용 모달 (Permission 필요) */}
      {hasPermission("bank_admin") && (
        <>
          <UnifiedProductManagementModal
            isOpen={modalState.product}
            onClose={() => closeModal("product")}
            classId={classId}
            initialTab="deposit"
            currencyUnit={currencyUnit}
            bankSettings={bankSettings}
            tierCriteria={tierCriteria}
            data-tour="bank-product-modal"
          />

          <BankDepositOperationAssistantModal
            isOpen={modalState.depositOperationAssistant}
            onClose={() => closeModal("depositOperationAssistant")}
            classId={classId}
            currencyUnit={currencyUnit}
          />

          <TierRateAdjustmentModal
            isOpen={modalState.tierRate}
            onClose={() => closeModal("tierRate")}
            classId={classId}
            currencyUnit={currencyUnit}
            data-tour="bank-tier-rate-modal"
          />

          <ApprovalModal
            isOpen={modalState.approval}
            onClose={() => closeModal("approval")}
            classId={classId}
            currencyUnit={currencyUnit}
            initialTab={data.approvalActiveTab || "savings"}
            data-tour="bank-approval-modal"
          />

          <LoanContractCenterModal
            isOpen={modalState.loanContracts}
            onClose={() => closeModal("loanContracts")}
            classId={classId}
            currencyUnit={currencyUnit}
            classDisplayName={classDisplayName}
          />

          <LoanLimitSettingsModal
            isOpen={modalState.loanLimit}
            onClose={() => closeModal("loanLimit")}
            classId={classId}
            data-tour="bank-loan-limit-modal"
          />

          <SubscriptionManagementModal
            isOpen={modalState.subscriptionManagement}
            onClose={() => closeModal("subscriptionManagement")}
            classId={classId}
            currencyUnit={currencyUnit}
            data-tour="bank-subscription-management-modal"
          />

          <ClassBankOverviewModal
            isOpen={modalState.overview}
            onClose={() => closeModal("overview")}
            classId={classId}
            currencyUnit={currencyUnit}
            data-tour="bank-overview-modal"
          />

          <SubscriptionOverviewModal
            isOpen={modalState.subscriptionOverview}
            onClose={() => closeModal("subscriptionOverview")}
            classId={classId}
            currencyUnit={currencyUnit}
            data-tour="bank-subscription-overview-modal"
          />
        </>
      )}

      {/* 4️⃣ 청약 통장 관련 */}
      {modalState.subscriptionHistory && (
        <SubscriptionHistoryModal
          isOpen={true}
          onClose={() => closeModal("subscriptionHistory")}
          uid={uid}
          classId={classId}
          currencyUnit={currencyUnit}
        />
      )}

      <DepositEffectSimulatorModal
        isOpen={!!modalState.depositSimulator}
        onClose={() => closeModal("depositSimulator")}
        currencyUnit={currencyUnit}
        studentInfo={studentInfo}
        bankSettings={bankSettings}
        tierCriteria={tierCriteria}
        tierAdjustments={tierAdjustments}
        currentRateModifiers={currentRateModifiers}
        data-tour="bank-deposit-simulator-modal"
      />
    </>
  );
}
