import React from "react";

import StoreManagementCenterModal from "./StoreManagementCenterModal";

const StorePendingRedemptionsModal = ({
  isOpen,
  onClose,
  items = [],
  categories = [],
}) => (
  <StoreManagementCenterModal
    isOpen={isOpen}
    onClose={onClose}
    items={items}
    categories={categories}
  />
);

export default StorePendingRedemptionsModal;
