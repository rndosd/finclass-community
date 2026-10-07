import React from "react";

import UnifiedAdjustmentModal from "../../admin/modals/UnifiedAdjustmentModal";

const CreditScoreModal = ({
  targets = [],
  onClose,
  initialMode = "increment",
}) => (
  <UnifiedAdjustmentModal
    targets={targets}
    onClose={onClose}
    initialMode={initialMode}
    initialType="credit"
    allowedTypes={["credit"]}
  />
);

export default CreditScoreModal;
