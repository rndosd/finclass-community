const STORE_ITEM_SALE_STATUS = {
    HIDDEN: "hidden",
    DISPLAY_ONLY: "display_only",
    FOR_SALE: "for_sale",
};

const VALID_STORE_ITEM_SALE_STATUS = new Set(
    Object.values(STORE_ITEM_SALE_STATUS),
);

const normalizeStoreItemSaleStatus = (item = {}) => {
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

const isStoreItemVisibleToStudents = (item = {}) =>
    normalizeStoreItemSaleStatus(item) !== STORE_ITEM_SALE_STATUS.HIDDEN;

const isStoreItemPurchasableByStudents = (item = {}) =>
    normalizeStoreItemSaleStatus(item) === STORE_ITEM_SALE_STATUS.FOR_SALE;

module.exports = {
    STORE_ITEM_SALE_STATUS,
    normalizeStoreItemSaleStatus,
    isStoreItemVisibleToStudents,
    isStoreItemPurchasableByStudents,
};
