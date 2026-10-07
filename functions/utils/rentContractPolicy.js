"use strict";

const DAYS_PER_WEEK = 7;
const INITIAL_PREPAY_DAYS = 7;

const toWholeNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
};

const calculateCumulativeRentAmount = (weeklyRent, paidDays) =>
    Math.floor(
        (toWholeNumber(weeklyRent) * toWholeNumber(paidDays)) /
        DAYS_PER_WEEK,
    );

const calculateCumulativeRentCharge = ({ weeklyRent, paidDays, paidAmount, requestedDays }) => {
    const nextPaidDays = toWholeNumber(paidDays) + toWholeNumber(requestedDays);
    const targetAmount = calculateCumulativeRentAmount(weeklyRent, nextPaidDays);
    return Math.max(0, targetAmount - toWholeNumber(paidAmount));
};

const calculateInitialPrepaidDays = ({ totalContractDays, elapsedContractDays }) => {
    const totalDays = toWholeNumber(totalContractDays);
    if (totalDays <= 0) return 0;

    const elapsedDays = Math.max(1, toWholeNumber(elapsedContractDays));
    const billingBlocks = Math.max(1, Math.ceil(elapsedDays / INITIAL_PREPAY_DAYS));
    return Math.min(totalDays, billingBlocks * INITIAL_PREPAY_DAYS);
};

const calculateUnusedPrepaidRent = ({ weeklyRent, paidDays, paidAmount, accruedDays }) => {
    const earnedDays = Math.min(toWholeNumber(paidDays), toWholeNumber(accruedDays));
    const earnedAmount = calculateCumulativeRentAmount(weeklyRent, earnedDays);
    return Math.max(0, toWholeNumber(paidAmount) - earnedAmount);
};

module.exports = {
    DAYS_PER_WEEK,
    INITIAL_PREPAY_DAYS,
    calculateCumulativeRentAmount,
    calculateCumulativeRentCharge,
    calculateInitialPrepaidDays,
    calculateUnusedPrepaidRent,
};
