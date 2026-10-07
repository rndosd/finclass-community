"use strict";

const LAYOUT_VIEW_VERSION = 2;

const toWholeNumber = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
};

const pickAuctionSummary = (auctionSummary) => {
    if (!auctionSummary || typeof auctionSummary !== "object") return null;

    return {
        auctionId: auctionSummary.auctionId || null,
        status: auctionSummary.status || "",
    };
};

const pickContractState = (contractState) => {
    if (!contractState || typeof contractState !== "object") return null;

    return {
        sellerSigned: contractState.sellerSigned === true,
        buyerSigned: contractState.buyerSigned === true,
        buyerName: contractState.buyerName || "",
        selectedAt: contractState.selectedAt || null,
    };
};

const pickPurchaseRequests = (purchaseRequests) => {
    if (!Array.isArray(purchaseRequests)) return [];

    const seenBuyerIds = new Set();
    return purchaseRequests.reduce((picked, request) => {
        const buyerId = String(request?.buyerId || "").trim();
        if (!buyerId || seenBuyerIds.has(buyerId)) return picked;

        seenBuyerIds.add(buyerId);
        picked.push({
            buyerId,
            buyerName: String(request?.buyerName || "익명").trim() || "익명",
            requestedAt: request?.requestedAt || null,
        });
        return picked;
    }, []);
};

const pickForeclosureInfo = (foreclosureInfo) => {
    if (!foreclosureInfo || typeof foreclosureInfo !== "object") return null;

    return {
        status: foreclosureInfo.status || "",
        auctionId: foreclosureInfo.auctionId || null,
    };
};

const summarizeDesk = (desk = {}) => ({
    id: desk.id || "",
    label: desk.label || "",
    number: desk.number ?? null,
    teamId: desk.teamId || "none",
    isActive: desk.isActive !== false,
    studentId: desk.studentId || null,
    studentName: desk.studentName || "",
    ownerId: desk.ownerId || null,
    ownerName: desk.ownerName || "",
    ownerType: desk.ownerType || (desk.ownerId ? "student" : "state"),
    ownerFundId: desk.ownerFundId || null,
    ownerSource: desk.ownerSource || "",
    ownerSinceAt: desk.ownerSinceAt || null,
    buyerId: desk.buyerId || null,
    tradeStatus: desk.tradeStatus || "",
    isForSale: desk.isForSale === true,
    askingPrice: toWholeNumber(desk.askingPrice),
    price: toWholeNumber(desk.price),
    lastPurchasePrice: toWholeNumber(desk.lastPurchasePrice),
    fundAcquisitionPrice: toWholeNumber(desk.fundAcquisitionPrice),
    weeklyRent: toWholeNumber(desk.weeklyRent || desk.rentPrice),
    rentPrice: toWholeNumber(desk.rentPrice),
    auctionSummary: pickAuctionSummary(desk.auctionSummary),
    foreclosureInfo: pickForeclosureInfo(desk.foreclosureInfo),
    contractState: pickContractState(desk.contractState),
    rentContractId: desk.rentContractId || null,
    rentContractStatus: desk.rentContractStatus || "",
    rentStartAt: desk.rentStartAt || null,
    rentLastDateAt: desk.rentLastDateAt || null,
    rentTenantId: desk.rentTenantId || null,
    rentTenantName: desk.rentTenantName || "",
    rentPaidUntil: desk.rentPaidUntil || null,
    rentPaidDays: toWholeNumber(desk.rentPaidDays),
    rentPaidAmount: toWholeNumber(desk.rentPaidAmount),
    rentDepositAmount: toWholeNumber(desk.rentDepositAmount),
    rentDepositStatus: desk.rentDepositStatus || "",
    rentDepositPaidAmount: toWholeNumber(desk.rentDepositPaidAmount),
    rentDepositReturnedAmount: toWholeNumber(desk.rentDepositReturnedAmount),
    rentDepositDeductedAmount: toWholeNumber(desk.rentDepositDeductedAmount),
    rentDepositPaidAt: desk.rentDepositPaidAt || null,
    rentDepositReturnedAt: desk.rentDepositReturnedAt || null,
    rentDepositSettlementReason: desk.rentDepositSettlementReason || "",
    purchaseRequests: pickPurchaseRequests(desk.purchaseRequests),
});

const summarizeGroup = (group = {}) => ({
    id: group.id || "",
    name: group.name || "",
    cols: Math.max(1, toWholeNumber(group.cols) || 1),
    desks: Array.isArray(group.desks) ?
        group.desks.map((desk) => summarizeDesk(desk)) :
        [],
});

const buildLayoutViewData = (layout = {}) => ({
    version: LAYOUT_VIEW_VERSION,
    source: "layout",
    sourceUpdatedAt: layout.updatedAt || null,
    generatedAt: new Date().toISOString(),
    groups: Array.isArray(layout.groups) ?
        layout.groups.map((group) => summarizeGroup(group)) :
        [],
});

module.exports = {
    LAYOUT_VIEW_VERSION,
    buildLayoutViewData,
};
