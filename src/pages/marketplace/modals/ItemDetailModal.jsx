import React from "react";
import { Info, Package, ShoppingCart, User, Wallet } from "lucide-react";

import { getProductTypeAsset } from "../../../assets/illustrations/productTypes";
import { Button, Modal } from "../../../components/ui";

const formatValue = (value, formatter) =>
  typeof formatter === "function" ? formatter(value) : value.toLocaleString();

// Purchase decisions must retain small balances and shortages even when the
// classroom's general display setting rounds amounts to whole units.
const formatPurchaseAmount = (value) => {
  const formatted = value.toLocaleString("ko-KR", { maximumFractionDigits: 10 });
  return value > 0 && Number(formatted.replace(/,/g, "")) === 0
    ? String(value)
    : formatted;
};

const ItemDetailModal = ({
  isOpen,
  onClose,
  item,
  currentUser,
  currencyName,
  userBalance,
  formatWholeNumber,
  onConfirmPurchase,
}) => {
  if (!isOpen || !item) return null;

  const balance = Math.max(0, Number(userBalance || 0));
  const price = Math.max(0, Math.trunc(Number(item.price || 0)));
  const rawStock = Number(
    item.stock === undefined || item.stock === null ? 1 : item.stock,
  );
  const stock = Number.isFinite(rawStock) ? Math.max(0, Math.trunc(rawStock)) : 0;
  const hasStockAvailable = stock > 0;
  const canAfford = balance >= price;
  const isOwner = Boolean(currentUser?.uid && currentUser.uid === item.sellerId);
  const isSold = item.status === "sold";
  const isRejected = item.status === "rejected";
  const isPending = item.status === "pending" || (!item.approved && !isRejected);
  const isActiveListing = item.status === "active" && item.approved;
  const canPurchase =
    !isOwner && isActiveListing && hasStockAvailable && canAfford;
  const itemAsset = getProductTypeAsset({ ...item, assetContext: "marketplace" });
  const formattedPrice = formatValue(price, formatWholeNumber);
  const formattedBalance = formatPurchaseAmount(balance);
  const remainingBalance = Math.max(0, balance - price);
  const shortage = Math.max(0, price - balance);

  let listingStateLabel = "\uD310\uB9E4 \uC911";
  if (isSold) listingStateLabel = "\uAC70\uB798 \uC644\uB8CC";
  else if (isPending) listingStateLabel = "\uC2B9\uC778 \uB300\uAE30";
  else if (isRejected) listingStateLabel = "\uBC18\uB824\uB428";

  let purchaseUnavailableLabel = "\uAD6C\uB9E4\uD560 \uC218 \uC5C6\uC5B4\uC694";
  if (isOwner) purchaseUnavailableLabel = "\uB0B4 \uC0C1\uD488\uC774\uC5D0\uC694";
  else if (isSold) purchaseUnavailableLabel = "\uAC70\uB798\uAC00 \uC644\uB8CC\uB410\uC5B4\uC694";
  else if (isPending) purchaseUnavailableLabel = "\uC2B9\uC778\uC744 \uAE30\uB2E4\uB9AC\uACE0 \uC788\uC5B4\uC694";
  else if (isRejected) purchaseUnavailableLabel = "\uD310\uB9E4\uD560 \uC218 \uC5C6\uC5B4\uC694";
  else if (!hasStockAvailable) purchaseUnavailableLabel = "\uC7AC\uACE0\uAC00 \uC5C6\uC5B4\uC694";
  else if (!canAfford) purchaseUnavailableLabel = "\uAE08\uC561\uC774 \uBD80\uC871\uD574\uC694";

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <Modal.Header>
        <div>
          <p className="text-xs font-bold tracking-wide text-blue-600">
            {"중고시장"}
          </p>
          <h2 className="mt-0.5 text-xl font-black tracking-tight text-slate-900">
            {"\uC0C1\uD488 \uC0C1\uC138"}
          </h2>
        </div>
      </Modal.Header>

      <Modal.Body>
        <div className="space-y-4">
          <section className="relative overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-violet-50 p-5">
            <img
              src={itemAsset}
              alt=""
              className="pointer-events-none absolute right-4 top-4 h-28 w-28 object-contain"
              aria-hidden="true"
            />
            <div className="relative min-w-0 pr-20">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  isActiveListing
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {listingStateLabel}
              </span>
              <h3 className="mt-3 break-words text-2xl font-black leading-tight tracking-tight text-slate-900">
                {item.title}
              </h3>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-medium text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <User size={14} className="text-slate-400" />
                  {item.sellerName || "\uC774\uB984 \uC5C6\uC74C"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Package size={14} className="text-slate-400" />
                  {"\uC7AC\uACE0"} {isSold ? 0 : stock}{"\uAC1C"}
                </span>
              </div>
            </div>

            <div className="relative mt-5 flex items-end justify-between gap-3 rounded-2xl border border-white/80 bg-white/80 px-4 py-3 backdrop-blur-sm">
              <span className="text-sm font-bold text-slate-500">{"\uD310\uB9E4\uAC00"}</span>
              <div className="text-right leading-none">
                <span className="text-2xl font-black tracking-tight text-slate-900">
                  {formattedPrice}
                </span>
                <span className="ml-1 text-sm font-bold text-blue-600">{currencyName}</span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white px-4 py-3.5">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
              <Package size={16} className="text-blue-500" />
              {"\uC0C1\uD488 \uC124\uBA85"}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
              {item.description || "\uC0C1\uD488 \uC124\uBA85\uC774 \uC5C6\uC5B4\uC694."}
            </p>
          </section>

          <section
            className={`rounded-2xl border p-4 ${
              canAfford
                ? "border-emerald-100 bg-emerald-50/70"
                : "border-rose-100 bg-rose-50/70"
            }`}
          >
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                  canAfford
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-rose-100 text-rose-600"
                }`}
              >
                <Wallet size={16} />
              </div>
              <div>
                <p className="text-sm font-black text-slate-800">{"\uB0B4 \uC794\uC561"}</p>
                <p className="text-xs text-slate-500">{"\uAD6C\uB9E4 \uC804 \uD655\uC778\uD574\uC694"}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-white/75 px-3 py-2.5">
                <p className="text-xs text-slate-500">{"\uBCF4\uC720 \uAE08\uC561"}</p>
                <p className="mt-1 font-black text-slate-800">
                  {formattedBalance} {currencyName}
                </p>
              </div>
              <div className="rounded-xl bg-white/75 px-3 py-2.5">
                <p className="text-xs text-slate-500">
                  {canAfford ? "\uC608\uC0C1 \uC794\uC561" : "\uBD80\uC871 \uAE08\uC561"}
                </p>
                <p
                  className={`mt-1 font-black ${
                    canAfford ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                    {formatPurchaseAmount(canAfford ? remainingBalance : shortage)} {currencyName}
                </p>
              </div>
            </div>
          </section>

          <div className="flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
            <Info size={16} className="mt-0.5 shrink-0 text-blue-500" />
            <p>
              {"\uAD6C\uB9E4\uAC00 \uC644\uB8CC\uB418\uBA74 \uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC5B4\uC694. \uD310\uB9E4\uC790\uC640 \uBB3C\uAC74\uC744 \uBC1B\uB294 \uBC29\uBC95\uC744 \uD55C \uBC88 \uB354 \uD655\uC778\uD574\uC694."}
            </p>
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <div className="flex w-full gap-2.5">
          <Button size="md"
            type="button"
            variant="secondary"
            onClick={onClose}
            className="flex-1"
          >
            {"\uB2EB\uAE30"}
          </Button>
          <Button
            type="button"
            onClick={onConfirmPurchase}
            disabled={!canPurchase}
            className={`flex-[1.5] rounded-xl font-black ${
              canPurchase
                ? "bg-blue-600 text-white shadow-lg shadow-blue-200 hover:bg-blue-700"
                : "bg-slate-200 text-slate-400"
            }`}
            icon={ShoppingCart}
          >
            {canPurchase
              ? `${formattedPrice} ${currencyName} \uAD6C\uB9E4`
              : purchaseUnavailableLabel}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default ItemDetailModal;
