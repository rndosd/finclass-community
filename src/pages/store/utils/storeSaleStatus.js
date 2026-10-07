export const STORE_ITEM_SALE_STATUS = {
  HIDDEN: "hidden",
  DISPLAY_ONLY: "display_only",
  FOR_SALE: "for_sale",
};

const VALID_STORE_ITEM_SALE_STATUS = new Set(
  Object.values(STORE_ITEM_SALE_STATUS),
);

export const STORE_ITEM_SALE_STATUS_OPTIONS = [
  {
    value: STORE_ITEM_SALE_STATUS.HIDDEN,
    label: "숨김",
    description: "학생 화면에서 보이지 않아요.",
  },
  {
    value: STORE_ITEM_SALE_STATUS.DISPLAY_ONLY,
    label: "보임(구매 불가)",
    description: "학생은 볼 수 있지만 구매는 할 수 없어요.",
  },
  {
    value: STORE_ITEM_SALE_STATUS.FOR_SALE,
    label: "보임(구매 가능)",
    description: "학생이 바로 구매할 수 있어요.",
  },
];

export const normalizeStoreItemSaleStatus = (item = {}) => {
  const rawStatus = String(item?.saleStatus || "")
    .trim()
    .toLowerCase();

  if (VALID_STORE_ITEM_SALE_STATUS.has(rawStatus)) {
    return rawStatus;
  }

  return item?.isActive === false
    ? STORE_ITEM_SALE_STATUS.HIDDEN
    : STORE_ITEM_SALE_STATUS.FOR_SALE;
};

export const isStoreItemVisibleToStudents = (item = {}) =>
  normalizeStoreItemSaleStatus(item) !== STORE_ITEM_SALE_STATUS.HIDDEN;

export const isStoreItemPurchasableByStudents = (item = {}) =>
  normalizeStoreItemSaleStatus(item) === STORE_ITEM_SALE_STATUS.FOR_SALE;

export const getStoreItemSaleStatusMeta = (item = {}) => {
  const saleStatus = normalizeStoreItemSaleStatus(item);

  switch (saleStatus) {
    case STORE_ITEM_SALE_STATUS.HIDDEN:
      return {
        code: saleStatus,
        label: "숨김",
        description: "학생 화면에서 보이지 않아요.",
        badgeClassName: "bg-slate-200 text-slate-600",
        isVisible: false,
        isPurchasable: false,
      };
    case STORE_ITEM_SALE_STATUS.DISPLAY_ONLY:
      return {
        code: saleStatus,
        label: "구매불가",
        description: "학생에게는 보이지만 구매는 막혀 있어요.",
        badgeClassName: "bg-amber-100 text-amber-700",
        isVisible: true,
        isPurchasable: false,
      };
    default:
      return {
        code: STORE_ITEM_SALE_STATUS.FOR_SALE,
        label: "구매가능",
        description: "학생이 바로 구매할 수 있어요.",
        badgeClassName: "bg-emerald-100 text-emerald-700",
        isVisible: true,
        isPurchasable: true,
      };
  }
};
