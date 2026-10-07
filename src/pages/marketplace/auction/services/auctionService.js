import { httpsCallable } from "firebase/functions";
import { functions } from "../../../../firebase";

export async function createAuctionItem(classId, payload) {
  const fn = httpsCallable(functions, "createAuctionItem");
  const res = await fn({ classId, ...payload });
  return res.data;
}

export async function placeAuctionBid(classId, itemId, amount) {
  const fn = httpsCallable(functions, "placeAuctionBid");
  const res = await fn({ classId, itemId, amount });
  return res.data;
}

export async function closeAuction(classId, itemId, force = false) {
  const fn = httpsCallable(functions, "closeAuction");
  const res = await fn({ classId, itemId, force });
  return res.data;
}

export async function approveAuctionItem(
  classId,
  itemId,
  approved = true,
  reason = ""
) {
  const fn = httpsCallable(functions, "approveAuctionItem");
  const res = await fn({ classId, itemId, approved, reason });
  return res.data;
}
