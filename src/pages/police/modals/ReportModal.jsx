// src/pages/police/modals/ReportModal.jsx - 벌금 규칙 필터링 완성본
import React, { useState, useMemo } from "react";
import { Modal } from "../../../components/ui";
import ReportForm from "../components/ReportForm";
import reportActionAsset from "../../../assets/police/report-action-v1.webp";
import { isPenaltyRule } from "../utils/policeRuleUtils";

const ReportModal = ({
  isOpen,
  onClose,
  allStudents,
  policeRules,
  onSubmitSuccess,
  "data-tour": dataTour,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fineRules = useMemo(() => {
    return (policeRules || []).filter((rule) => isPenaltyRule(rule));
  }, [policeRules]);

  const handleSubmitSuccess = (message) => {
    setIsSubmitting(false);
    if (typeof onSubmitSuccess === "function") onSubmitSuccess(message);
    onClose?.();
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setIsSubmitting(false);
      onClose?.();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      closeOnOverlayClick={!isSubmitting}
      data-tour={dataTour}
    >
      <Modal.Header>
        <div className="flex items-center gap-2">
          <img
            src={reportActionAsset}
            alt=""
            className="h-12 w-12 object-contain"
            aria-hidden="true"
          />
          <span className="text-lg font-semibold">
            벌금 규칙 위반 행위 신고
          </span>
        </div>
      </Modal.Header>

      <Modal.Body>
        <ReportForm
          allStudents={allStudents}
          policeRules={fineRules}
          onSubmitSuccess={handleSubmitSuccess}
          onCancel={handleClose}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
        />
      </Modal.Body>
    </Modal>
  );
};

export default ReportModal;
