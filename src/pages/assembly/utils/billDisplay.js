export const getBillProposerDisplayName = (bill, canViewRealName = false) => {
  const proposerName = bill?.proposerName || "-";

  if (bill?.isAnonymous === true && !canViewRealName) {
    return "익명";
  }

  return proposerName;
};
