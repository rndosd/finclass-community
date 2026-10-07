const toSafeNumber = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
};

export const getArcadeFeeAmount = (value) => toSafeNumber(value);

export const getArcadeCashChargeAmount = (price, feeAmount = 0) =>
  toSafeNumber(price) + getArcadeFeeAmount(feeAmount);

export const formatArcadeChargeLabel = ({
  price = 0,
  feeAmount = 0,
  isTicketUsed = false,
  currencyName = "빌",
  formatAmount = value => value.toLocaleString(),
}) => {
  const safePrice = toSafeNumber(price);
  const safeFeeAmount = getArcadeFeeAmount(feeAmount);

  if (isTicketUsed) {
    return safeFeeAmount > 0
      ? `티켓 1장 + ${formatAmount(safeFeeAmount)} ${currencyName}`
      : "티켓 1장";
  }

  const totalCharge = getArcadeCashChargeAmount(safePrice, safeFeeAmount);
  return safeFeeAmount > 0
    ? `${formatAmount(totalCharge)} ${currencyName} (\uC218\uC218\uB8CC ${formatAmount(safeFeeAmount)} ${currencyName} \uD3EC\uD568)`
    : `${formatAmount(totalCharge)} ${currencyName}`;
};

export const formatArcadeChargeDetail = ({
  price = 0,
  feeAmount = 0,
  isTicketUsed = false,
  currencyName = "빌",
  formatAmount = value => value.toLocaleString(),
}) => {
  const safePrice = toSafeNumber(price);
  const safeFeeAmount = getArcadeFeeAmount(feeAmount);

  if (isTicketUsed) {
    return safeFeeAmount > 0
      ? `티켓 1장 사용 + 수수료 ${formatAmount(safeFeeAmount)} ${currencyName} 차감`
      : "티켓 1장 사용";
  }

  if (safeFeeAmount > 0) {
    return `입장료 ${formatAmount(safePrice)} + 수수료 ${formatAmount(safeFeeAmount)} ${currencyName} 차감`;
  }

  return `${formatAmount(safePrice)} ${currencyName} 차감`;
};
