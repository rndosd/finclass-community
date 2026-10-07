const pickAuctionSummary = (auctionSummary) => {
  if (!auctionSummary || typeof auctionSummary !== 'object') return null;

  return {
    auctionId: auctionSummary.auctionId || null,
    status: auctionSummary.status || '',
  };
};

const pickContractState = (contractState) => {
  if (!contractState || typeof contractState !== 'object') return null;

  return {
    sellerSigned: contractState.sellerSigned === true,
    buyerSigned: contractState.buyerSigned === true,
    buyerName: contractState.buyerName || '',
    selectedAt: contractState.selectedAt || null,
  };
};

const pickPurchaseRequests = (purchaseRequests) => {
  if (!Array.isArray(purchaseRequests)) return [];

  const seenBuyerIds = new Set();
  return purchaseRequests.reduce((picked, request) => {
    const buyerId = String(request?.buyerId || '').trim();
    if (!buyerId || seenBuyerIds.has(buyerId)) return picked;

    seenBuyerIds.add(buyerId);
    picked.push({
      buyerId,
      buyerName: String(request?.buyerName || '익명').trim() || '익명',
      requestedAt: request?.requestedAt || null,
    });
    return picked;
  }, []);
};

const pickForeclosureInfo = (foreclosureInfo) => {
  if (!foreclosureInfo || typeof foreclosureInfo !== 'object') return null;

  return {
    status: foreclosureInfo.status || '',
    auctionId: foreclosureInfo.auctionId || null,
  };
};

export const toViewerDeskSummary = (desk) => {
  if (!desk || typeof desk !== 'object') return null;

  return {
    id: desk.id || '',
    label: desk.label || '',
    number: desk.number ?? null,
    teamId: desk.teamId || null,
    isActive: desk.isActive !== false,
    studentId: desk.studentId || null,
    studentName: desk.studentName || '',
    ownerId: desk.ownerId || null,
    ownerName: desk.ownerName || '',
    ownerType: desk.ownerType || (desk.ownerId ? 'student' : 'state'),
    ownerFundId: desk.ownerFundId || null,
    ownerSource: desk.ownerSource || '',
    ownerSinceAt: desk.ownerSinceAt || null,
    buyerId: desk.buyerId || null,
    tradeStatus: desk.tradeStatus || '',
    isForSale: desk.isForSale === true,
    askingPrice: Number(desk.askingPrice || 0),
    price: Number(desk.price || 0),
    lastPurchasePrice: Number(desk.lastPurchasePrice || 0),
    fundAcquisitionPrice: Number(desk.fundAcquisitionPrice || 0),
    weeklyRent: Number(desk.weeklyRent || desk.rentPrice || 0),
    rentPrice: Number(desk.rentPrice || 0),
    auctionSummary: pickAuctionSummary(desk.auctionSummary),
    foreclosureInfo: pickForeclosureInfo(desk.foreclosureInfo),
    contractState: pickContractState(desk.contractState),
    rentContractId: desk.rentContractId || null,
    rentContractStatus: desk.rentContractStatus || '',
    rentStartAt: desk.rentStartAt || null,
    rentLastDateAt: desk.rentLastDateAt || null,
    rentTenantId: desk.rentTenantId || null,
    rentTenantName: desk.rentTenantName || '',
    rentPaidUntil: desk.rentPaidUntil || null,
    rentPaidDays: Number(desk.rentPaidDays || 0),
    rentPaidAmount: Number(desk.rentPaidAmount || 0),
    rentDepositAmount: Number(desk.rentDepositAmount || 0),
    rentDepositStatus: desk.rentDepositStatus || '',
    rentDepositPaidAmount: Number(desk.rentDepositPaidAmount || 0),
    rentDepositReturnedAmount: Number(desk.rentDepositReturnedAmount || 0),
    rentDepositDeductedAmount: Number(desk.rentDepositDeductedAmount || 0),
    rentDepositPaidAt: desk.rentDepositPaidAt || null,
    rentDepositReturnedAt: desk.rentDepositReturnedAt || null,
    rentDepositSettlementReason: desk.rentDepositSettlementReason || '',
    purchaseRequests: pickPurchaseRequests(desk.purchaseRequests),
  };
};

export const toViewerGroupSummary = (group) => {
  if (!group || typeof group !== 'object') return { desks: [] };

  return {
    ...group,
    desks: Array.isArray(group.desks)
      ? group.desks.map((desk) => toViewerDeskSummary(desk))
      : [],
  };
};

export const toViewerLayoutGroups = (groups) =>
  Array.isArray(groups) ? groups.map((group) => toViewerGroupSummary(group)) : [];
