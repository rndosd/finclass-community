import { formatDateKeyInKST, parseDateKeyAsKST, shiftDateKeyInKST, toDate } from "../../../utils/kstDate";
import { normalizeStoreItemSaleStatus, STORE_ITEM_SALE_STATUS } from "./storeSaleStatus";

export const MAX_ANALYTICS_DAYS = 120;
const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value) => Math.round(n(value) * 100) / 100;
const isAnalyticsItemForSale = (item = {}) => {
  const raw = String(item.saleStatus || "").trim().toLowerCase();
  const aliases = { forsale: STORE_ITEM_SALE_STATUS.FOR_SALE, displayonly: STORE_ITEM_SALE_STATUS.DISPLAY_ONLY };
  return item.isActive !== false && normalizeStoreItemSaleStatus({ ...item, saleStatus: aliases[raw] || item.saleStatus }) === STORE_ITEM_SALE_STATUS.FOR_SALE;
};
export const currencyKey = (value) => {
  const key = String(value || "cash").trim().toLowerCase();
  return ["cash", "money", "class", "default"].includes(key) ? "cash" : key;
};
export const calendarKeys = (range) => {
  const keys = [];
  const start = parseDateKeyAsKST(range.startDate);
  const end = parseDateKeyAsKST(range.endDate);
  if (!start || !end) return keys;
  for (let day = start.getTime(); day <= end.getTime(); day += 86400000) {
    keys.push(shiftDateKeyInKST(new Date(day), 0));
  }
  return keys;
};
export const weekdayKeys = (range) => calendarKeys(range).filter((key) => {
  const weekday = new Date(parseDateKeyAsKST(key).getTime() + 9 * 3600000).getUTCDay();
  return weekday !== 0 && weekday !== 6;
});

export function getComparisonRange(range) {
  const start = parseDateKeyAsKST(range.startDate);
  const end = parseDateKeyAsKST(range.endDate);
  if (!start || !end || start > end ||
      shiftDateKeyInKST(start, 0) !== range.startDate ||
      shiftDateKeyInKST(end, 0) !== range.endDate) return null;
  const days = Math.round((end - start) / 86400000) + 1;
  if (days > MAX_ANALYTICS_DAYS) return null;
  return {
    days, startDate: shiftDateKeyInKST(start, -days), endDate: shiftDateKeyInKST(start, -1),
  };
}

const mergeCurrency = (target, source = {}) => {
  Object.entries(source).forEach(([rawKey, entry]) => {
    const key = currencyKey(rawKey);
    target[key] ||= { amount: 0, quantity: 0, unit: entry.unit || "" };
    target[key].amount = money(target[key].amount + n(entry.amount));
    target[key].quantity += n(entry.quantity);
  });
};

export function summarizeShopping(rows, range) {
  const map = new Map(rows.map((row) => [row.id, row]));
  const byCurrency = {};
  const byItem = {};
  const byStudent = {};
  const gifts = { quantity: 0 };
  const classFund = { quantity: 0, byCurrency: {} };
  let missingDays = 0;
  let excludedCount = 0;
  let latestDate = null;
  const trend = weekdayKeys(range).map((date) => {
    const shopping = map.get(date)?.shopping;
    if (shopping?.version !== 1 || shopping.status !== "ready") {
      missingDays += 1;
      return { date, quantity: null, participants: null, amount: null };
    }
    latestDate = date;
    excludedCount += n(shopping.excludedCount);
    mergeCurrency(byCurrency, shopping.byCurrency);
    Object.entries(shopping.byItem || {}).forEach(([id, item]) => {
      byItem[id] ||= { id, name: item.name || "상품", quantity: 0, byCurrency: {} };
      byItem[id].quantity += n(item.quantity);
      mergeCurrency(byItem[id].byCurrency, item.byCurrency);
    });
    Object.entries(shopping.byStudent || {}).forEach(([uid, student]) => {
      byStudent[uid] ||= { uid, name: student.name || "학생", studentNumber: student.studentNumber, quantity: 0, byCurrency: {} };
      byStudent[uid].quantity += n(student.quantity);
      mergeCurrency(byStudent[uid].byCurrency, student.byCurrency);
    });
    gifts.quantity += n(shopping.gifts?.quantity);
    classFund.quantity += n(shopping.classFund?.quantity);
    mergeCurrency(classFund.byCurrency, shopping.classFund?.byCurrency);
    return {
      date, quantity: n(shopping.quantity), participants: Object.keys(shopping.byStudent || {}).length,
      amount: n(shopping.byCurrency?.cash?.amount),
    };
  });
  return {
    byCurrency, byItem, byStudent, gifts, classFund, trend, missingDays, excludedCount, latestDate,
    participantCount: Object.keys(byStudent).length,
    quantity: Object.values(byItem).reduce((sum, item) => sum + item.quantity, 0),
    complete: trend.length > 0 && missingDays === 0 && excludedCount === 0,
    readyDays: trend.length - missingDays,
  };
}

const recordedCurrency = (row, id) => {
  const item = row.byItem?.[id];
  const legacyCurrency = String(item?.currencyType || "").trim();
  const paidCurrencies = Object.keys(row.shopping?.byItem?.[id]?.byCurrency || {})
    .filter((key) => String(key).trim()).map(currencyKey);
  const unique = [...new Set(paidCurrencies)];
  // Multiple currencies in one day cannot prove the currency of its captured price.
  if (unique.length > 1 || (legacyCurrency && unique.length && currencyKey(legacyCurrency) !== unique[0])) return null;
  // Old byItem fields could have been filled from current items during a backfill.
  // Only the rebuilt shopping projection carries recorded transaction evidence.
  if (unique.length !== 1) return null;
  const currency = unique[0];
  const paidEntry = Object.entries(row.shopping?.byItem?.[id]?.byCurrency || {})
    .find(([key]) => currencyKey(key) === currency)?.[1];
  return {
    name: row.shopping?.byItem?.[id]?.name || id,
    currencyType: currency, currencyUnit: paidEntry?.unit || "",
    saleStatus: STORE_ITEM_SALE_STATUS.FOR_SALE, isActive: true,
    currencyProvenance: "recordedShoppingCurrency",
  };
};

// Old scheduled writers did not write capturedDate/items. Their collection marker,
// matching snapshot date and actual same-day KST write timestamp prove the capture.
// A later backfill/current-price fallback with an old date fails this contract.
export function resolvePriceRecord(row) {
  const snapshot = row?.priceSnapshot;
  if (!row?.id || !snapshot) return null;
  if (snapshot.capturedDate === row.id) {
    return { ...snapshot, prices: snapshot.capturedPrices || snapshot.prices || {}, provenance: "capturedSnapshot" };
  }
  if (snapshot.capturedDate) return null;
  const collected = toDate(row.priceSnapshotUpdatedAt);
  if (row.priceSnapshotSource !== "scheduled_price_snapshot" || snapshot.date !== row.id ||
      !collected || !Number.isFinite(collected.getTime()) || formatDateKeyInKST(collected) !== row.id) return null;
  const prices = snapshot.prices || {};
  const items = {};
  Object.keys(prices).forEach((id) => {
    const item = recordedCurrency(row, id);
    if (item) items[id] = item;
  });
  return { ...snapshot, prices, items, provenance: "legacyScheduledSnapshot" };
}
const priceRecord = resolvePriceRecord;
const eligible = (snapshot, id) => {
  const item = snapshot?.items?.[id];
  return item && String(item.currencyType || "").trim() && currencyKey(item.currencyType) === "cash" &&
    isAnalyticsItemForSale(item) && n(snapshot.prices?.[id]) > 0;
};
const sameRecordedUnit = (base, snapshot, id) => {
  const baseUnit = String(base?.items?.[id]?.currencyUnit || "").trim();
  const nextUnit = String(snapshot?.items?.[id]?.currencyUnit || "").trim();
  return !baseUnit || !nextUnit || baseUnit === nextUnit;
};

export function comparePrices(currentRows, previousRows) {
  const allRows = [...previousRows, ...currentRows];
  const capturedHistory = allRows.map((row) => ({ row, snapshot: priceRecord(row) })).filter(({ snapshot }) => snapshot)
    .sort((a, b) => a.row.id.localeCompare(b.row.id)).flatMap(({ row, snapshot }) => Object.entries(snapshot.prices)
      .filter(([, price]) => n(price) > 0).map(([id, price]) => ({
        date: row.id, id, name: snapshot.items?.[id]?.name || id, price: n(price),
        currencyType: snapshot.items?.[id]?.currencyType || null,
        currencyUnit: snapshot.items?.[id]?.currencyUnit || "",
        provenance: snapshot.provenance, currencyProvenance: snapshot.items?.[id]?.currencyProvenance || null,
      })));
  const evidence = {
    capturedHistory,
    priceRecordDays: allRows.filter((row) => Object.values(row.priceSnapshot?.capturedPrices || row.priceSnapshot?.prices || {}).some((price) => n(price) > 0)).length,
    capturedDays: new Set(capturedHistory.map((entry) => entry.date)).size,
    legacyCapturedDays: new Set(capturedHistory.filter((entry) => entry.provenance === "legacyScheduledSnapshot").map((entry) => entry.date)).size,
    unknownCurrencyPrices: capturedHistory.filter((entry) => !entry.currencyType).length,
  };
  const records = (rows) => rows.filter(priceRecord).sort((a, b) => a.id.localeCompare(b.id));
  const current = records(currentRows).at(-1);
  const previous = records(previousRows).at(-1);
  const next = priceRecord(current);
  const base = priceRecord(previous);
  const ids = Object.keys(base?.prices || {}).filter((id) => eligible(base, id) && eligible(next, id) && sameRecordedUnit(base, next, id));
  if (!ids.length) return { ...evidence, change: null, rows: [], trend: [], currentDate: current?.id, previousDate: previous?.id,
    currentProvenance: next?.provenance, previousProvenance: base?.provenance };
  const indexFor = (snapshot) => ids.every((id) => eligible(snapshot, id) && sameRecordedUnit(base, snapshot, id))
    ? ids.reduce((sum, id) => sum + n(snapshot.prices[id]) / n(base.prices[id]), 0) / ids.length * 100
    : null;
  return {
    ...evidence, currentProvenance: next.provenance, previousProvenance: base.provenance,
    change: indexFor(next) - 100, currentDate: current.id, previousDate: previous.id,
    itemCount: ids.length,
    rows: ids.map((id) => ({
      id, name: next.items[id].name || base.items[id].name || "상품",
      previousPrice: n(base.prices[id]), price: n(next.prices[id]),
      previousCurrencyUnit: base.items[id].currencyUnit || "", currencyUnit: next.items[id].currencyUnit || "",
      priceChange: (n(next.prices[id]) / n(base.prices[id]) - 1) * 100,
    })),
    trend: [{ date: previous.id, index: 100 }, ...currentRows.slice().sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({ date: row.id, index: indexFor(priceRecord(row)) }))],
  };
}

export function buildStoreHighlights(summary, previous, priceRows = []) {
  if (!summary.complete || !previous.complete) return [{ id: "pending", tone: "amber", label: "비교 집계 준비 중" }];
  if (summary.trend.length !== previous.trend.length) return [{ id: "weekdays", tone: "amber", label: "두 기간의 평일 수가 다름" }];
  const highlights = [];
  const changedPrice = priceRows.filter((row) => Number.isFinite(row.priceChange) && Math.abs(row.priceChange) >= 5)
    .sort((a, b) => Math.abs(b.priceChange) - Math.abs(a.priceChange) || a.id.localeCompare(b.id))[0];
  if (changedPrice) highlights.push({ id: "price", tone: "blue", label: `${changedPrice.name} 가격 ${changedPrice.priceChange > 0 ? "+" : ""}${changedPrice.priceChange.toFixed(1)}%` });
  const participants = summary.participantCount - previous.participantCount;
  if (Math.abs(participants) >= 2 && (!previous.participantCount || Math.abs(participants) / previous.participantCount >= 0.1)) {
    highlights.push({ id: "participants", tone: participants > 0 ? "emerald" : "amber", label: `구매 학생 ${Math.abs(participants)}명 ${participants > 0 ? "증가" : "감소"}` });
  }
  const topItem = Object.entries(summary.byItem || {}).sort((a, b) => n(b[1].quantity) - n(a[1].quantity) || a[0].localeCompare(b[0]))[0]?.[1];
  if (summary.quantity >= 10 && topItem && n(topItem.quantity) / summary.quantity >= 0.5) {
    highlights.push({ id: "concentration", tone: "blue", label: `${topItem.name || "최다 판매 상품"} · 전체 판매 수량의 ${Math.round(n(topItem.quantity) / summary.quantity * 100)}%` });
  }
  const quantity = summary.quantity - previous.quantity;
  if (Math.abs(quantity) >= 5 && (!previous.quantity || Math.abs(quantity) / previous.quantity >= 0.15)) {
    highlights.push({ id: "quantity", tone: quantity > 0 ? "blue" : "amber", label: `판매 수량 ${Math.abs(quantity)}개 ${quantity > 0 ? "증가" : "감소"}` });
  }
  return highlights.slice(0, 3);
}

export function buildStoreAnalyticsModel(rows, previousRows, range, items = []) {
  const previousRange = getComparisonRange(range);
  const summary = summarizeShopping(rows, range);
  const previous = summarizeShopping(previousRows, previousRange || range);
  const currentKeys = new Set(calendarKeys(range));
  const previousKeys = new Set(calendarKeys(previousRange || range));
  const currentMap = new Map(rows.map((row) => [row.id, row]));
  const prices = comparePrices([...currentKeys].map((id) => currentMap.get(id) || { id }), previousRows.filter((row) => previousKeys.has(row.id)));
  const comparable = summary.complete && previous.complete;
  const priceMap = new Map(prices.rows.map((item) => [item.id, item]));
  const known = new Map(items.filter(isAnalyticsItemForSale)
    .map((item) => [item.id, { id: item.id, name: item.name || item.title || "상품" }]));
  Object.values(summary.byItem).forEach((item) => known.set(item.id, item));
  // Keep the products behind a sales decline even after they leave the catalog.
  Object.values(previous.byItem).forEach((item) => {
    if (!known.has(item.id)) known.set(item.id, { id: item.id, name: item.name });
  });
  prices.rows.forEach((item) => { if (!known.has(item.id)) known.set(item.id, item); });
  const productRows = [...known.values()].map((item) => ({
    ...item, ...(priceMap.get(item.id) || {}),
    quantity: summary.readyDays ? n(summary.byItem[item.id]?.quantity) : null,
    previousQuantity: previous.readyDays ? n(previous.byItem[item.id]?.quantity) : null,
    amounts: summary.byItem[item.id]?.byCurrency || {},
  })).sort((a, b) => n(b.quantity) - n(a.quantity) || a.name.localeCompare(b.name, "ko-KR"));
  let insight = "집계된 구매 현황을 확인해 보세요.";
  let guidance = "비교 기간의 집계가 모두 준비되면 변화 안내가 자동으로 표시됩니다.";
  if (comparable && summary.trend.length === previous.trend.length) {
    const quantityDelta = summary.quantity - previous.quantity;
    const participantDelta = summary.participantCount - previous.participantCount;
    if (quantityDelta < 0 && participantDelta < 0) {
      insight = "구매 학생과 전체 판매 수량이 줄었어요.";
      guidance = "상품의 판매 상태와 학생 수요를 확인해 보세요.";
    } else if (quantityDelta > 0 && participantDelta > 0) {
      insight = "더 많은 학생이 구매했고, 전체 판매 수량도 늘었어요.";
      guidance = "구매 참여가 확대됐습니다. 잘 팔리는 상품의 재고를 확인해 보세요.";
    } else if (quantityDelta > 0 && participantDelta < 0) {
      insight = "구매 학생은 줄었지만, 전체 판매 수량은 늘었어요.";
      guidance = "구매 학생 1명당 평균 수량이 늘었습니다. 학생별 구매 합계의 분포를 확인해 보세요.";
    } else if (quantityDelta < 0 && participantDelta > 0) {
      insight = "구매 학생은 늘었지만, 전체 판매 수량은 줄었어요.";
      guidance = "구매 학생 1명당 평균 수량이 줄었습니다. 참여 확대와 판매 수량을 나누어 살펴보세요.";
    } else if (participantDelta !== 0) {
      insight = `전체 판매 수량은 같고, 구매 학생은 ${participantDelta > 0 ? "늘었어요" : "줄었어요"}.`;
      guidance = "학생별 구매 합계를 살펴보고 참여 변화가 어디에서 나타났는지 확인해 보세요.";
    } else if (quantityDelta !== 0) {
      insight = `구매 학생 수는 같고, 전체 판매 수량은 ${quantityDelta > 0 ? "늘었어요" : "줄었어요"}.`;
      guidance = "상품별 판매 변화와 학생별 구매 수량을 확인해 보세요.";
    } else if (prices.change !== null && Math.abs(prices.change) >= 0.1) {
      insight = `구매 학생과 판매 수량은 같고, 비교 상품 ${prices.itemCount}종의 가격은 변했어요.`;
      guidance = "가격 지수는 두 기간에 공통으로 기록된 상품의 평균 변동률입니다. 개별 상품의 가격 변경을 확인해 보세요.";
    } else {
      insight = "구매 학생과 전체 판매 수량은 직전 기간과 같아요.";
      guidance = "전체 합계가 같아도 상품별 판매 구성은 다를 수 있습니다. 상품별 현황을 확인해 보세요.";
    }
  }
  if (comparable && summary.trend.length !== previous.trend.length) {
    insight = "두 기간의 평일 수가 달라요.";
    guidance = "총 판매량의 증감에는 평일 수 차이도 영향을 줍니다. 날짜별 흐름을 함께 확인해 보세요.";
  }
  const highlights = buildStoreHighlights(summary, previous, prices.rows);
  return { summary, previous, prices, productRows, comparable, previousRange, insight, guidance, highlights };
}
