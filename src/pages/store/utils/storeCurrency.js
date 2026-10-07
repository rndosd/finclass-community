import { DEFAULT_CLASS_CURRENCY_UNIT } from "../../../utils/currencyUnit";
import { DEFAULT_MISSION_TOKEN_LABEL } from "../../../utils/missionTokenLabel";

export const MISSION_TOKEN_UNIT = DEFAULT_MISSION_TOKEN_LABEL;

export const normalizeStoreCurrencyType = (currencyType) =>
  ["missionToken", "usdBalance"].includes(currencyType) ? currencyType : "cash";

// Legacy inventory may lack currency metadata. Never add unknown values to cash.
export const summarizeStoreInventoryValue = (inventoryItems, storeItems = []) => {
  const catalog = new Map(storeItems.map((item) => [item.id, item]));
  return inventoryItems.reduce((totals, item) => {
    const quantity = Number(item.visibleQuantity ?? item.quantity) || 0;
    const catalogItem = catalog.get(item.itemId || item.id);
    const currencyType = item.currencyType ?? (catalogItem
      ? normalizeStoreCurrencyType(catalogItem.currencyType)
      : null);
    if (["cash", "missionToken", "usdBalance"].includes(currencyType)) {
      totals[currencyType] += (Number(item.price) || 0) * quantity;
    } else {
      totals.unknownQuantity += quantity;
    }
    return totals;
  }, { cash: 0, missionToken: 0, usdBalance: 0, unknownQuantity: 0 });
};

export const getStoreCurrencyField = (currencyType) =>
  normalizeStoreCurrencyType(currencyType);

export const getStoreCurrencyUnit = (
  currencyType,
  classCurrencyUnit = DEFAULT_CLASS_CURRENCY_UNIT,
  missionTokenUnit = MISSION_TOKEN_UNIT,
) =>
  normalizeStoreCurrencyType(currencyType) === "usdBalance"
    ? "FIN"
    : normalizeStoreCurrencyType(currencyType) === "missionToken"
    ? missionTokenUnit
    : classCurrencyUnit;

export const getStudentBalanceByCurrency = (assets = {}, currencyType = "cash") => {
  const field = getStoreCurrencyField(currencyType);
  return Number(assets?.[field] ?? 0);
};
