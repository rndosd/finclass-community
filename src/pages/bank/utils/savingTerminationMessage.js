import { formatBankMoney, roundBankMoney } from "../../../utils/bankMoney";

const isAmount = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
const formatMoney = (value) => formatBankMoney(value, { fractionDigits: 3, showLessThan: false });

export function buildSavingTerminationMessage({ principal, payoutAmount, interestPaid, currencyUnit = "" }) {
  if (![principal, payoutAmount, interestPaid].every(isAmount)) {
    return "변경 전후 금액이 저장되지 않은 기록입니다. 예금 내역을 확인해 주세요.";
  }
  const deduction = roundBankMoney(Number(principal) + Number(interestPaid) - Number(payoutAmount));
  const lines = [
    `원금 ${formatMoney(principal)}${currencyUnit} · 지급 이자 ${formatMoney(interestPaid)}${currencyUnit}`,
    ...(deduction >= 0 ? [`차감액 ${formatMoney(deduction)}${currencyUnit}`] : []),
    `반환액 ${formatMoney(payoutAmount)}${currencyUnit}`,
  ];
  if (Number(interestPaid) === 0) lines.push("만기 전에 해지하여 이자는 지급되지 않았어요.");
  return lines.join("\n");
}
