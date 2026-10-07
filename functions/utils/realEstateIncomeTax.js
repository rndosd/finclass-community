"use strict";

const { buildIncomeTaxSnapshot } = require("./incomeTaxUtils");

const buildRealEstateRentIncomeTaxSnapshot = ({ grossAmount, config = {} } = {}) => {
    const enabled = config.rentTaxEnabled === true;
    const taxRate = enabled ? Math.max(0, Number(config.rentTaxRate || 0)) : 0;

    return buildIncomeTaxSnapshot({
        sourceKey: "realEstateRent",
        grossAmount,
        policy: {
            enabled: taxRate > 0,
            taxRate,
            monthEndSettlementEnabled: true,
        },
        policySnapshot: {
            source: "realEstateRentTax",
            taxRate,
        },
    });
};

module.exports = {
    buildRealEstateRentIncomeTaxSnapshot,
};
