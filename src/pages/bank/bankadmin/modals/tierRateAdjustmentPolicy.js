export const parseSignedRateModifier = (value) => {
  if (value === "" || value === null || value === undefined) return 0;
  return Number.parseFloat(value);
};

const formatMagnitude = (value) => {
  const magnitude = Math.abs(Number(value) || 0);
  return Number.isInteger(magnitude)
    ? magnitude.toFixed(0)
    : magnitude.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export const describeRateAdjustment = (type, value) => {
  const modifier = Number(value) || 0;
  const productLabel = type === "loan" ? "대출" : "예금";

  if (modifier === 0) return `기본 ${productLabel}금리 그대로 적용`;

  const magnitude = formatMagnitude(modifier);
  if (type === "loan") {
    return modifier > 0
      ? `기본 대출금리에 ${magnitude}%p 가산`
      : `기본 대출금리에서 ${magnitude}%p 할인`;
  }

  return modifier > 0
    ? `기본 예금금리에 ${magnitude}%p 추가`
    : `기본 예금금리에서 ${magnitude}%p 차감`;
};
