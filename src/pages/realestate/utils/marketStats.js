import { formatDateKeyInKST, toDate } from '../../../utils/kstDate';

const SALE_TYPES = new Set(['sale', 'auction_sale']);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundAmount = (value) => Math.round(toNumber(value));

export const formatPercent = (value) => {
  if (!Number.isFinite(value)) return '-';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
};

const getAmount = (item) => roundAmount(item.amount || item.tradePrice || item.finalPrice || 0);

const getDateKey = (item) => formatDateKeyInKST(toDate(item.timestamp));

const getTimestampMs = (item) => {
  const date = toDate(item.timestamp);
  return date ? date.getTime() : 0;
};

export const buildMarketStats = (records) => {
  const saleRows = records.filter((item) => SALE_TYPES.has(item.type));
  const adjustmentRows = records
    .filter((item) => item.type === 'market_adjustment')
    .filter((item) => toNumber(item.previousPrice) > 0 && toNumber(item.newPrice) > 0)
    .sort((a, b) => getTimestampMs(a) - getTimestampMs(b));

  const saleAmount = saleRows.reduce((sum, item) => sum + getAmount(item), 0);
  const saleCount = saleRows.length;
  const averageTradePrice = saleCount > 0 ? Math.round(saleAmount / saleCount) : 0;

  const deskChanges = new Map();
  adjustmentRows.forEach((item) => {
    const deskId = String(item.deskId || item.deskLabel || '').trim();
    if (!deskId) return;

    const previousPrice = toNumber(item.previousPrice);
    const newPrice = toNumber(item.newPrice);
    const existing = deskChanges.get(deskId);

    if (!existing) {
      deskChanges.set(deskId, {
        deskId,
        deskLabel: item.deskLabel || deskId,
        firstPrice: previousPrice,
        latestPrice: newPrice,
        latestAt: getTimestampMs(item),
      });
      return;
    }

    existing.latestPrice = newPrice;
    existing.latestAt = getTimestampMs(item);
    if (!existing.deskLabel && item.deskLabel) existing.deskLabel = item.deskLabel;
  });

  const deskChangeRows = Array.from(deskChanges.values()).map((row) => ({
    ...row,
    changeAmount: roundAmount(row.latestPrice - row.firstPrice),
    changeRate:
      row.firstPrice > 0
        ? ((row.latestPrice - row.firstPrice) / row.firstPrice) * 100
        : null,
  }));

  const baseTotal = deskChangeRows.reduce((sum, row) => sum + row.firstPrice, 0);
  const latestTotal = deskChangeRows.reduce((sum, row) => sum + row.latestPrice, 0);
  const periodChangeRate =
    baseTotal > 0 ? ((latestTotal - baseTotal) / baseTotal) * 100 : null;

  const topRisers = deskChangeRows
    .filter((row) => Number.isFinite(row.changeRate) && row.changeRate > 0)
    .sort((a, b) => b.changeRate - a.changeRate || b.changeAmount - a.changeAmount)
    .slice(0, 3);

  const initialDeskValues = new Map();
  const currentDeskValues = new Map();
  const chartRows = [];
  let currentDateKey = '';
  // Keep the same set of adjusted desks throughout the selected period.
  deskChangeRows.forEach((row) => {
    initialDeskValues.set(row.deskId, row.firstPrice);
    currentDeskValues.set(row.deskId, row.firstPrice);
  });

  adjustmentRows.forEach((item) => {
    const deskId = String(item.deskId || item.deskLabel || '').trim();
    if (!deskId) return;

    if (!initialDeskValues.has(deskId)) {
      initialDeskValues.set(deskId, toNumber(item.previousPrice));
      currentDeskValues.set(deskId, toNumber(item.previousPrice));
    }

    currentDeskValues.set(deskId, toNumber(item.newPrice));
    currentDateKey = getDateKey(item);

    const initialTotal = Array.from(initialDeskValues.values()).reduce((sum, value) => sum + value, 0);
    const currentTotal = Array.from(currentDeskValues.values()).reduce((sum, value) => sum + value, 0);
    const indexValue = initialTotal > 0 ? Number(((currentTotal / initialTotal) * 100).toFixed(1)) : 100;
    const previousRow = chartRows[chartRows.length - 1];

    if (previousRow?.date === currentDateKey) {
      previousRow.index = indexValue;
      previousRow.adjustmentCount += 1;
    } else {
      chartRows.push({
        date: currentDateKey,
        label: currentDateKey.slice(5),
        index: indexValue,
        adjustmentCount: 1,
      });
    }
  });

  return {
    saleCount,
    saleAmount,
    averageTradePrice,
    adjustmentCount: adjustmentRows.length,
    adjustedDeskCount: deskChangeRows.length,
    periodChangeRate,
    topRisers,
    chartRows,
  };
};

