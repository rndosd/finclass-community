"use strict";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function selectSealedAuctionWinner(bids = []) {
  return [...bids]
    .filter((bid) => Number.isFinite(Number(bid?.amount)) && Number(bid.amount) > 0)
    .sort((left, right) => {
      const amountDifference = Number(right.amount) - Number(left.amount);
      if (amountDifference !== 0) return amountDifference;
      const leftSequence = Number(left.sequence || 0);
      const rightSequence = Number(right.sequence || 0);
      if (leftSequence > 0 && rightSequence > 0 && leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
      }
      return toMillis(left.createdAt) - toMillis(right.createdAt);
    })[0] || null;
}

module.exports = {
  selectSealedAuctionWinner,
};
