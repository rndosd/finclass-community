const TOTAL_WEIGHT_TENTHS = 1000;

export function buildEqualWeightPercentages(count, maxSingleWeightPct = 100) {
  const holdingCount = Math.max(0, Math.floor(Number(count) || 0));
  const maxTenths = Math.max(0, Math.round((Number(maxSingleWeightPct) || 0) * 10));
  if (holdingCount === 0 || holdingCount * maxTenths < TOTAL_WEIGHT_TENTHS) {
    return null;
  }

  const baseTenths = Math.floor(TOTAL_WEIGHT_TENTHS / holdingCount);
  const remainder = TOTAL_WEIGHT_TENTHS - baseTenths * holdingCount;

  return Array.from({ length: holdingCount }, (_, index) => {
    const receivesRemainder = index >= holdingCount - remainder;
    return ((baseTenths + (receivesRemainder ? 1 : 0)) / 10).toFixed(1);
  });
}
