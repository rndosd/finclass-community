import { formatConfiguredMoney } from "../../../utils/numberDisplay";
import { getStoreCurrencyUnit } from "./storeCurrency";

const isAmount = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;

const formatMoney = (value) => formatConfiguredMoney(value, {}, { fractionDigits: 8, trimTrailingZeros: true });

export function buildPurchaseResultMessage(result, classCurrencyUnit, missionTokenUnit) {
  const heading = result?.message || "구매를 완료했습니다.";
  if (!result?.success) return heading;
  const data = result.data || {};
  const totals = data.totalCostByCurrency || (isAmount(data.totalCost) && data.currencyType
    ? { [data.currencyType]: data.totalCost } : {});
  const lines = [heading];
  for (const field of ["cash", "missionToken", "usdBalance"]) {
    if (!isAmount(totals[field])) continue;
    const unit = getStoreCurrencyUnit(field, classCurrencyUnit, missionTokenUnit);
    const total = Number(totals[field]);
    const tax = data.taxAmountByCurrency?.[field] ?? (data.currencyType === field ? data.taxAmount : undefined);
    if (isAmount(tax) && Number(tax) <= total) {
      lines.push(`상품 금액 ${formatMoney(total - Number(tax))}${unit} + 포함된 소비세 ${formatMoney(tax)}${unit}`);
    }
    lines.push(`총 차감액 ${formatMoney(total)}${unit}`);
  }
  if (isAmount(data.newBalance) && data.currencyType) {
    lines.push(`결제 후 잔액 ${formatMoney(data.newBalance)}${getStoreCurrencyUnit(data.currencyType, classCurrencyUnit, missionTokenUnit)}`);
  }
  if (lines.length > 1) lines.push("소비세는 결제 금액에 포함되며, 따로 더 차감되지 않아요.");
  return lines.join("\n");
}
