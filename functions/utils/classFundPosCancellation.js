"use strict";

const {
    normalizeAcquisitionForAccounting,
    roundCurrency,
} = require("./inventoryAccounting");

const buildClassFundPosInventoryCancellation = ({
    purchaseId,
    redemption = {},
    inventory = {},
}) => {
    const quantity = Math.max(0, Number(redemption.quantity || 0));
    const currentQuantity = Math.max(0, Number(inventory.quantity || 0));
    if (!quantity || currentQuantity < quantity) {
        throw new Error("학생의 상품 보유 수량이 부족합니다.");
    }

    let remaining = quantity;
    let removedValue = 0;
    const fallbackUnitValue = Number(redemption.totalAmount || 0) / quantity;
    const acquisitions = (Array.isArray(inventory.acquisitions) ?
        inventory.acquisitions : []).flatMap((acquisition) => {
        if (remaining <= 0 || acquisition.purchaseId !== purchaseId) {
            return [acquisition];
        }
        const acquisitionQuantity = Math.max(
            0,
            Number(acquisition.quantity || 0),
        );
        const removeQuantity = Math.min(acquisitionQuantity, remaining);
        const normalized = normalizeAcquisitionForAccounting(
            acquisition,
            inventory,
            { fallbackUnitValue },
        );
        if (normalized.assetValueApplied === true) {
            removedValue += Number(normalized.unitValue || 0) * removeQuantity;
        }
        remaining -= removeQuantity;
        return acquisitionQuantity > removeQuantity ? [{
            ...acquisition,
            quantity: acquisitionQuantity - removeQuantity,
        }] : [];
    });

    if (remaining > 0) {
        throw new Error("해당 구매건의 상품이 이미 사용되었습니다.");
    }

    return {
        quantity,
        nextQuantity: currentQuantity - quantity,
        nextAcquisitions: acquisitions,
        itemValueToRemove: roundCurrency(removedValue),
        ticketCountToRemove:
            redemption.itemType === "ticket" ||
            redemption.functionTag === "arcade_ticket" ? quantity : 0,
    };
};

module.exports = { buildClassFundPosInventoryCancellation };
