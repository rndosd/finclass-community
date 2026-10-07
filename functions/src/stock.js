/* functions/src/stock.js
 * 주식 관련 모든 기능 통합 - tradeHistory 방식
 * - 주식 매수/매도/환전 onCall (V2)
 * - 모든 거래는 tradeHistory로 통일
 * - stockPortfolio 직접 업데이트
 * - activityLogs 기록 (수수료 정보 포함)
 *
 * 변경사항: stageTaxIncome 제거 (비용 절감)
 *    - 수수료 정보는 tradeHistory.feeUSD에 기록
 *    - 활동 로그 description에 수수료 정보 표시
 */

const admin = require("../firebaseAdminCompat");
const { FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("../utils/maintenanceHttps");
const { onSchedule } = require("../utils/maintenanceScheduler");

const { createMaintenanceDb } = require("../utils/maintenanceDb");
const db = createMaintenanceDb(admin.firestore());

// 유틸리티 및 헬퍼 함수
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { stageActivityLog } = require("../utils/logUtils");
const { getPrefetchContext } = require("../utils/prefetchUtils");
const { DEFAULT_CLASS_CURRENCY_UNIT } = require("../utils/currencyUnit");
const { assertCanOperateClassFund } = require("../utils/permissions");
const { resolveStockAccess } = require("../utils/stockAccess");
const { getClassFundChannelAccess } = require("../utils/classFundPolicy");
const { formatDateKeyInKST } = require("../utils/dateUtils");
const {
  buildClassFundStockBuyRecords,
  buildClassFundStockSellRecords,
} = require("../utils/classFundStockAccounting");
const {
  buildClassFundStockCancellationAccounting,
  normalizeClassFundStockSymbol,
} = require("../utils/classFundStockCancellation");

const { getMarketConfig } = require("../utils/marketConfig");
const { readStockTradePricing, valuePortfolioAfterTrade } = require("../utils/stockTradePricing");
const { getSpendableBankBalance } = require("../utils/bankMoney");
const { runFinancialRequest } = require("../utils/financialRequest");
const {
  buildClassFundBuyExchangePayment,
  buildClassFundSellExchangePayment,
  buildStudentAutoExchangeBuyPayment,
} = require("../utils/stockAutoExchange");
const {
  STOCK_JOB_INDEX_VERSION,
  applyPortfolioIndexDelta,
  ensureStockJobIndexBootstrapped,
  getClassesWithStockHolders,
  rebuildAllClassStockJobIndexes,
  rebuildClassStockJobIndex,
} = require("../utils/stockJobIndex");
const {
    STOCK_QUANTITY_MIN,
    isStockQuantityAvailable,
    normalizeStockQuantity,
    roundStockQuantity,
} = require("../utils/stockQuantity");

/* ------------------------------ 유틸 ------------------------------ */
const asNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const round2 = (n) => Math.round(asNum(n) * 100) / 100;
const round4 = (n) => Math.round(asNum(n) * 10000) / 10000;
const kstWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  weekday: "short",
});
const isKstWeekend = (date = new Date()) => {
  const weekday = kstWeekdayFormatter.format(date);
  return weekday === "Sat" || weekday === "Sun";
};
const SNAPSHOT_BATCH_LIMIT = 400;
const STOCK_SNAPSHOT_STATUS_COLLECTION = "stockSnapshotStatus";
const DAY_MS = 24 * 60 * 60 * 1000;
const STOCK_SELL_LOCK_EXEMPT_SYMBOLS = new Set([
  "PLAG",
  "HIVE",
  "HUT",
  "RIOT",
  "MARA",
  "LAZR",
  "AAL",
  "WBD",
]);

const getTimestampMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const assertStockSellHoldingPeriod = ({
  symbol,
  portfolioData = {},
  stockMinHoldingDays = 0,
  isTeacherOrAdmin = false,
}) => {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const days = Math.max(0, Math.round(Number(stockMinHoldingDays) || 0));

  if (
    isTeacherOrAdmin ||
    days <= 0 ||
    STOCK_SELL_LOCK_EXEMPT_SYMBOLS.has(normalizedSymbol)
  ) {
    return;
  }

  const buyAtMs = getTimestampMillis(portfolioData.lastBuyAt || portfolioData.createdAt);
  if (!buyAtMs) return;

  const availableAtMs = buyAtMs + days * DAY_MS;
  const nowMs = Date.now();
  if (nowMs >= availableAtMs) return;

  const remainingDays = Math.max(1, Math.ceil((availableAtMs - nowMs) / DAY_MS));
  throw new Error(
    `보유 기간 규칙에 따라 ${remainingDays}일 뒤 매도할 수 있습니다. 매수 후 ${days}일 동안은 가격 변화를 관찰합니다.`,
  );
};

const getStockPerformanceMetrics = (studentData = {}) => ({
  cumulativeRealizedGainUSD: asNum(
    studentData?.stockPerformance?.cumulativeRealizedGainUSD,
    0,
  ),
  cumulativeRealizedGainInClassCurrency: asNum(
    studentData?.stockPerformance?.cumulativeRealizedGainInClassCurrency,
    0,
  ),
  cumulativeTradeFeesUSD: asNum(
    studentData?.stockPerformance?.cumulativeTradeFeesUSD,
    0,
  ),
  cumulativeTradeFeesInClassCurrency: asNum(
    studentData?.stockPerformance?.cumulativeTradeFeesInClassCurrency,
    0,
  ),
  cumulativeDividendsUSD: asNum(
    studentData?.stockPerformance?.cumulativeDividendsUSD,
    0,
  ),
  cumulativeDividendsInClassCurrency: asNum(
    studentData?.stockPerformance?.cumulativeDividendsInClassCurrency,
    0,
  ),
});

const buildTradePerformanceUpdate = ({
  symbol,
  feeUSD = 0,
  feeInClassCurrency = 0,
  tradeType,
  realizedGainUSD = 0,
  realizedGainInClassCurrency = 0,
}) => {
  const patch = {
    "stockPerformance.cumulativeTradeFeesUSD": FieldValue.increment(feeUSD),
    "stockPerformance.cumulativeTradeFeesInClassCurrency":
      FieldValue.increment(feeInClassCurrency),
    "stockPerformance.lastTradeType": tradeType,
    "stockPerformance.lastTradeSymbol": symbol,
    "stockPerformance.lastTradeAt": FieldValue.serverTimestamp(),
    "stockPerformance.updatedAt": FieldValue.serverTimestamp(),
  };

  if (tradeType === "buy") {
    patch["stockPerformance.buyTradeCount"] = FieldValue.increment(1);
    return patch;
  }

  patch["stockPerformance.sellTradeCount"] = FieldValue.increment(1);
  patch["stockPerformance.cumulativeRealizedGainUSD"] =
    FieldValue.increment(realizedGainUSD);
  patch["stockPerformance.cumulativeRealizedGainInClassCurrency"] =
    FieldValue.increment(realizedGainInClassCurrency);

  return patch;
};

const buildStudentStockSnapshot = ({
  classId = null,
  studentId = null,
  studentData = {},
  portfolioDocs = [],
  priceMap = {},
  conversionRate = 1,
  currencyUnit = DEFAULT_CLASS_CURRENCY_UNIT,
  snapshotDateNY,
  priceSourceDoc,
}) => {
  let marketValueUSD = 0;
  let costBasisUSD = 0;
  const holdingSymbols = [];
  const positionsBySymbol = {};

  portfolioDocs.forEach((portfolioDoc) => {
    const hold = typeof portfolioDoc.data === "function"
      ? portfolioDoc.data()
      : portfolioDoc;
    const quantity = asNum(hold?.quantity, 0);
    if (quantity <= 0) return;

    const symbol = String(hold?.symbol || "").trim().toUpperCase();
    const currentPrice = asNum(priceMap[symbol]?.current, 0);
    const totalInvestmentUSD = asNum(
      hold?.totalInvestmentUSD,
      asNum(hold?.averagePriceUSD, 0) * quantity,
    );

    marketValueUSD += currentPrice * quantity;
    costBasisUSD += totalInvestmentUSD;
    if (symbol) {
      holdingSymbols.push(symbol);
      positionsBySymbol[symbol] = round4(quantity);
    }
  });

  marketValueUSD = round4(marketValueUSD);
  costBasisUSD = round4(costBasisUSD);

  const unrealizedGainUSD = round4(marketValueUSD - costBasisUSD);
  const usdBalanceUSD = round4(asNum(studentData?.assets?.usdBalance, 0));
  const accountValueUSD = round4(marketValueUSD + usdBalanceUSD);
  const performance = getStockPerformanceMetrics(studentData);
  const totalReturnUSD = round4(
    unrealizedGainUSD +
      performance.cumulativeRealizedGainUSD +
      performance.cumulativeDividendsUSD,
  );

  return {
    classId: classId || null,
    studentId: studentId || null,
    snapshotDateNY,
    marketValueUSD,
    marketValueInClassCurrency: round4(marketValueUSD / conversionRate),
    costBasisUSD,
    costBasisInClassCurrency: round4(costBasisUSD / conversionRate),
    unrealizedGainUSD,
    unrealizedGainInClassCurrency: round4(unrealizedGainUSD / conversionRate),
    cumulativeRealizedGainUSD: performance.cumulativeRealizedGainUSD,
    cumulativeRealizedGainInClassCurrency:
      performance.cumulativeRealizedGainInClassCurrency,
    cumulativeTradeFeesUSD: performance.cumulativeTradeFeesUSD,
    cumulativeTradeFeesInClassCurrency:
      performance.cumulativeTradeFeesInClassCurrency,
    cumulativeDividendsUSD: performance.cumulativeDividendsUSD,
    cumulativeDividendsInClassCurrency:
      performance.cumulativeDividendsInClassCurrency,
    totalReturnUSD,
    totalReturnInClassCurrency: round4(totalReturnUSD / conversionRate),
    usdBalanceUSD,
    usdBalanceInClassCurrency: round4(usdBalanceUSD / conversionRate),
    accountValueUSD,
    accountValueInClassCurrency: round4(accountValueUSD / conversionRate),
    holdingsCount: holdingSymbols.length,
    holdingSymbols: holdingSymbols.sort(),
    positionsBySymbol,
    conversionRate,
    currencyUnit,
    priceSourceDoc,
    source: "ny_close_revaluation",
    capturedAt: FieldValue.serverTimestamp(),
  };
};

const shouldWriteStudentStockSnapshot = ({ studentData = {}, snapshot }) => {
  const previousMarketValue = asNum(studentData?.assets?.stockValue?.value, 0);
  return (
    snapshot.holdingsCount > 0 ||
    snapshot.usdBalanceUSD > 0 ||
    snapshot.cumulativeRealizedGainUSD !== 0 ||
    snapshot.cumulativeTradeFeesUSD !== 0 ||
    snapshot.cumulativeDividendsUSD !== 0 ||
    previousMarketValue !== 0
  );
};

const normalizeClassFundId = (value) =>
  String(value || "").trim().slice(0, 120);

const assertCanBuyStock = async ({ classId, uid, symbol, role }) => {
  const access = await resolveStockAccess({ db, classId, uid, symbol, role });
  if (access.allowed) return access;

  const message =
    access.reason === "credential_required"
      ? "이 종목은 필요한 자격증을 보유한 학생만 매수할 수 있습니다."
      : "이 종목은 현재 학생에게 공개되지 않았습니다.";
  throw new HttpsError("permission-denied", message);
};

const assertInvestmentClassFund = (fundSnap) => {
  if (!fundSnap.exists) {
    throw new Error("투자 기금을 찾을 수 없습니다.");
  }

  const fund = fundSnap.data() || {};
  const access = getClassFundChannelAccess(fund, "stockInvestment");
  if (!access.allowed) {
    throw new Error(access.reason);
  }

  return fund;
};

const buildFundTradeBase = ({
  classId,
  fundId,
  fund,
  actorUid,
  symbol,
  qty,
  price,
  marketConfig,
}) => {
  const {
    tradeFeeRate,
    tradeFeeMinUSD,
    exchangeFeeRate,
    conversionRate,
    currencyUnit,
  } = marketConfig;
  const grossUSD = round4(price * qty);
  const feeUSD = Math.max(round4(grossUSD * tradeFeeRate), tradeFeeMinUSD);
  const totalUSD = round4(grossUSD + feeUSD);
  const grossInClassCurrency = round4(grossUSD / conversionRate);
  const feeInClassCurrency = round4(feeUSD / conversionRate);
  const buyExchange = buildClassFundBuyExchangePayment({
    totalUSD,
    conversionRate,
    exchangeFeeRate,
  });
  const sellBeforeExchangeUSD = round4(grossUSD - feeUSD);
  const sellExchange = buildClassFundSellExchangePayment({
    sourceUSD: sellBeforeExchangeUSD,
    conversionRate,
    exchangeFeeRate,
  });

  return {
    classId,
    fundId,
    fundName: fund?.name || "",
    actorUid,
    symbol,
    qty,
    price,
    tradeFeeRate,
    exchangeFeeRate,
    conversionRate,
    currencyUnit,
    grossUSD,
    feeUSD,
    totalUSD,
    grossInClassCurrency,
    feeInClassCurrency,
    exchangeFeeInClassCurrency: buyExchange.feeInClassCurrency,
    exchangeFeeUSD: buyExchange.feeUSD,
    totalInClassCurrency: buyExchange.sourceAmount,
    sellExchangeFeeUSD: sellExchange.feeUSD,
    sellExchangeFeeInClassCurrency: sellExchange.feeInClassCurrency,
    sellNetUSD: sellExchange.netUSD,
    sellNetInClassCurrency: sellExchange.netInClassCurrency,
  };
};

const performClassFundStockBuyTransaction = async ({
  classId,
  fundId,
  actorUid,
  symbol,
  qty,
  expectedPrice,
  clientRequestId,
}) =>
  runFinancialRequest({
    db, classId, actorUid, operation: "stock_buy", clientRequestId,
    payload: { fundId, symbol, quantity: qty, price: expectedPrice },
  }, async (tx) => {
    const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
    const callerRef = db.doc(`classes/${classId}/students/${actorUid}`);
    const portfolioRef = db.doc(
      `classes/${classId}/classFunds/${fundId}/stockPortfolio/${symbol}`,
    );
    const tradeRef = db
      .collection(`classes/${classId}/classFunds/${fundId}/tradeHistory`)
      .doc();
    const usageRef = db.collection(`classes/${classId}/fundUsages`).doc();
    const ledgerRef = fundRef.collection("ledger").doc();

    const [fundSnap, callerSnap, portfolioSnap] = await Promise.all([
      tx.get(fundRef),
      tx.get(callerRef),
      tx.get(portfolioRef),
    ]);
    const fund = assertInvestmentClassFund(fundSnap);
    assertCanOperateClassFund({
      userData: callerSnap.exists ? callerSnap.data() : null,
      fundData: fund,
      uid: actorUid,
    });
    const portfolioData = portfolioSnap.exists ? portfolioSnap.data() || {} : {};
    const marketConfig = await getMarketConfig(tx, classId);
    const { price } = await readStockTradePricing({ db, tx, symbol, expectedPrice });
    const trade = buildFundTradeBase({
      classId,
      fundId,
      fund,
      actorUid,
      symbol,
      qty,
      price,
      marketConfig,
    });

    const tradeAccess = getClassFundChannelAccess(fund, "stockInvestment", {
      amount: trade.totalInClassCurrency,
    });
    if (!tradeAccess.allowed) {
      throw new Error(tradeAccess.reason);
    }
    const cashBalance = asNum(fund.cashBalance, 0);
    const now = FieldValue.serverTimestamp();
    const records = buildClassFundStockBuyRecords({
      fundId,
      fundName: fund.name || "",
      fundType: fund.fundType || "investment",
      actorUid,
      symbol,
      quantity: qty,
      grossInClassCurrency: trade.grossInClassCurrency,
      feeInClassCurrency: trade.feeInClassCurrency,
      exchangeFeeInClassCurrency: trade.exchangeFeeInClassCurrency,
      totalInClassCurrency: trade.totalInClassCurrency,
      balanceBefore: cashBalance,
      dateKey: formatDateKeyInKST(new Date()),
      tradeId: tradeRef.id,
      now,
    });

    tx.update(fundRef, {
      cashBalance: FieldValue.increment(-trade.totalInClassCurrency),
      investmentValue: FieldValue.increment(trade.grossInClassCurrency),
      totalValue: FieldValue.increment(
        -round4(trade.feeInClassCurrency + trade.exchangeFeeInClassCurrency),
      ),
      investedTotal: FieldValue.increment(trade.grossInClassCurrency),
      tradeFeeTotal: FieldValue.increment(trade.feeInClassCurrency),
      tradeFeeTotalUSD: FieldValue.increment(trade.feeUSD),
      exchangeFeeTotal: FieldValue.increment(
        trade.exchangeFeeInClassCurrency,
      ),
      exchangeFeeTotalUSD: FieldValue.increment(trade.exchangeFeeUSD),
      lastInvestmentAt: now,
      updatedAt: now,
    });

    tx.set(tradeRef, {
      type: "CLASS_FUND_STOCK_BUY",
      classId,
      fundId,
      fundName: trade.fundName,
      actorUid,
      symbol,
      quantity: qty,
      priceUSD: price,
      grossUSD: trade.grossUSD,
      feeUSD: trade.feeUSD,
      totalUSD: trade.totalUSD,
      grossInClassCurrency: trade.grossInClassCurrency,
      feeInClassCurrency: trade.feeInClassCurrency,
      exchangeFeeInClassCurrency: trade.exchangeFeeInClassCurrency,
      exchangeFeeUSD: trade.exchangeFeeUSD,
      totalInClassCurrency: trade.totalInClassCurrency,
      tradeFeeRate: trade.tradeFeeRate,
      exchangeFeeRate: trade.exchangeFeeRate,
      conversionRate: trade.conversionRate,
      currencyUnit: trade.currencyUnit,
      description: `[기금 운용] ${fund.name || "투자기금"} ${symbol} ${qty}주 매수`,
      usageId: usageRef.id,
      ledgerId: ledgerRef.id,
      createdAt: now,
    });
    tx.set(usageRef, records.usage);
    tx.set(ledgerRef, records.ledger);

    if (portfolioSnap.exists) {
      const newQuantity = roundStockQuantity(asNum(portfolioData.quantity, 0) + qty);
      const totalInvestmentUSD = round4(asNum(portfolioData.totalInvestmentUSD, 0) + trade.grossUSD);
      const totalInvestmentInClassCurrency = round4(
        asNum(portfolioData.totalInvestmentInClassCurrency, 0) +
          trade.grossInClassCurrency,
      );

      tx.update(portfolioRef, {
        quantity: newQuantity,
        totalInvestmentUSD,
        totalInvestmentInClassCurrency,
        averagePriceUSD: round4(totalInvestmentUSD / newQuantity),
        lastBuyAt: FieldValue.serverTimestamp(),
        lastUpdated: FieldValue.serverTimestamp(),
        lastTransactionType: "buy",
        lastTradeId: tradeRef.id,
      });
    } else {
      tx.set(portfolioRef, {
        symbol,
        companyName: symbol,
        quantity: qty,
        totalInvestmentUSD: trade.grossUSD,
        totalInvestmentInClassCurrency: trade.grossInClassCurrency,
        averagePriceUSD: price,
        createdAt: FieldValue.serverTimestamp(),
        lastBuyAt: FieldValue.serverTimestamp(),
        lastUpdated: FieldValue.serverTimestamp(),
        lastTransactionType: "buy",
        lastTradeId: tradeRef.id,
      });
    }

    return {
      success: true,
      message: `${fund.name || "투자기금"} ${symbol} ${qty}주 매수 완료`,
      debitedInClassCurrency: trade.totalInClassCurrency,
      debitedUSD: trade.totalUSD,
      newFundCashBalance: round4(cashBalance - trade.totalInClassCurrency),
      tradeId: tradeRef.id,
    };
  });

const performClassFundStockSellTransaction = async ({
  classId,
  fundId,
  actorUid,
  symbol,
  qty,
  expectedPrice,
  clientRequestId,
}) =>
  runFinancialRequest({
    db, classId, actorUid, operation: "stock_sell", clientRequestId,
    payload: { fundId, symbol, quantity: qty, price: expectedPrice },
  }, async (tx) => {
    const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
    const callerRef = db.doc(`classes/${classId}/students/${actorUid}`);
    const portfolioRef = db.doc(
      `classes/${classId}/classFunds/${fundId}/stockPortfolio/${symbol}`,
    );
    const tradeRef = db
      .collection(`classes/${classId}/classFunds/${fundId}/tradeHistory`)
      .doc();
    const usageRef = db.collection(`classes/${classId}/fundUsages`).doc();
    const ledgerRef = fundRef.collection("ledger").doc();

    const [fundSnap, callerSnap, portfolioSnap] = await Promise.all([
      tx.get(fundRef),
      tx.get(callerRef),
      tx.get(portfolioRef),
    ]);
    const fund = assertInvestmentClassFund(fundSnap);
    assertCanOperateClassFund({
      userData: callerSnap.exists ? callerSnap.data() : null,
      fundData: fund,
      uid: actorUid,
    });
    if (!portfolioSnap.exists) {
      throw new Error(`${symbol} 주식을 보유하고 있지 않습니다.`);
    }

    const portfolioData = portfolioSnap.data() || {};
    const currentQuantity = roundStockQuantity(asNum(portfolioData.quantity, 0));
    if (!isStockQuantityAvailable(qty, currentQuantity)) {
      throw new Error("보유 수량이 부족합니다.");
    }

    const marketConfig = await getMarketConfig(tx, classId);
    const { price } = await readStockTradePricing({ db, tx, symbol, expectedPrice });
    const trade = buildFundTradeBase({
      classId,
      fundId,
      fund,
      actorUid,
      symbol,
      qty,
      price,
      marketConfig,
    });
    const netUSD = trade.sellNetUSD;
    const netInClassCurrency = trade.sellNetInClassCurrency;
    const newQuantity = roundStockQuantity(currentQuantity - qty);
    const currentInvestmentUSD = asNum(portfolioData.totalInvestmentUSD, 0);
    const currentInvestmentInClassCurrency = asNum(
      portfolioData.totalInvestmentInClassCurrency,
      round4(currentInvestmentUSD / trade.conversionRate),
    );
    const soldRatio = currentQuantity > 0 ? qty / currentQuantity : 0;
    const soldInvestmentUSD = round4(currentInvestmentUSD * soldRatio);
    const soldInvestmentInClassCurrency = round4(
      currentInvestmentInClassCurrency * soldRatio,
    );
    const newInvestmentUSD =
      newQuantity < STOCK_QUANTITY_MIN
        ? 0
        : Math.max(0, round4(currentInvestmentUSD - soldInvestmentUSD));
    const newInvestmentInClassCurrency =
      newQuantity < STOCK_QUANTITY_MIN
        ? 0
        : Math.max(
            0,
            round4(currentInvestmentInClassCurrency - soldInvestmentInClassCurrency),
          );
    const realizedGainUSD = round4(netUSD - soldInvestmentUSD);
    const realizedGainInClassCurrency = round4(
      netInClassCurrency - soldInvestmentInClassCurrency,
    );

    const realizedPatch =
      realizedGainInClassCurrency >= 0
        ? { realizedGain: FieldValue.increment(realizedGainInClassCurrency) }
        : { realizedLoss: FieldValue.increment(Math.abs(realizedGainInClassCurrency)) };
    const cashBalance = asNum(fund.cashBalance, 0);
    const now = FieldValue.serverTimestamp();
    const records = buildClassFundStockSellRecords({
      fundId,
      fundName: fund.name || "",
      fundType: fund.fundType || "investment",
      actorUid,
      symbol,
      quantity: qty,
      grossInClassCurrency: trade.grossInClassCurrency,
      feeInClassCurrency: trade.feeInClassCurrency,
      exchangeFeeInClassCurrency: trade.sellExchangeFeeInClassCurrency,
      netInClassCurrency,
      soldInvestmentInClassCurrency,
      realizedGainInClassCurrency,
      balanceBefore: cashBalance,
      dateKey: formatDateKeyInKST(new Date()),
      tradeId: tradeRef.id,
      now,
    });

    tx.update(fundRef, {
      cashBalance: FieldValue.increment(netInClassCurrency),
      investmentValue: FieldValue.increment(-soldInvestmentInClassCurrency),
      totalValue: FieldValue.increment(realizedGainInClassCurrency),
      tradeFeeTotal: FieldValue.increment(trade.feeInClassCurrency),
      tradeFeeTotalUSD: FieldValue.increment(trade.feeUSD),
      exchangeFeeTotal: FieldValue.increment(
        trade.sellExchangeFeeInClassCurrency,
      ),
      exchangeFeeTotalUSD: FieldValue.increment(trade.sellExchangeFeeUSD),
      lastInvestmentAt: now,
      updatedAt: now,
      ...realizedPatch,
    });

    tx.set(tradeRef, {
      type: "CLASS_FUND_STOCK_SELL",
      classId,
      fundId,
      fundName: trade.fundName,
      actorUid,
      symbol,
      quantity: qty,
      priceUSD: price,
      grossUSD: trade.grossUSD,
      feeUSD: trade.feeUSD,
      netUSD,
      grossInClassCurrency: trade.grossInClassCurrency,
      feeInClassCurrency: trade.feeInClassCurrency,
      exchangeFeeUSD: trade.sellExchangeFeeUSD,
      exchangeFeeInClassCurrency: trade.sellExchangeFeeInClassCurrency,
      netInClassCurrency,
      soldInvestmentUSD,
      soldInvestmentInClassCurrency,
      realizedGainUSD,
      realizedGainInClassCurrency,
      tradeFeeRate: trade.tradeFeeRate,
      exchangeFeeRate: trade.exchangeFeeRate,
      conversionRate: trade.conversionRate,
      currencyUnit: trade.currencyUnit,
      description: `[기금 운용] ${fund.name || "투자기금"} ${symbol} ${qty}주 매도`,
      usageId: usageRef.id,
      ledgerId: ledgerRef.id,
      createdAt: now,
    });
    tx.set(usageRef, records.usage);
    tx.set(ledgerRef, records.ledger);

    if (newQuantity < STOCK_QUANTITY_MIN) {
      tx.delete(portfolioRef);
    } else {
      tx.update(portfolioRef, {
        quantity: newQuantity,
        totalInvestmentUSD: newInvestmentUSD,
        totalInvestmentInClassCurrency: newInvestmentInClassCurrency,
        averagePriceUSD: round4(newInvestmentUSD / newQuantity),
        lastUpdated: FieldValue.serverTimestamp(),
        lastTransactionType: "sell",
        lastTradeId: tradeRef.id,
      });
    }

    return {
      success: true,
      message: `${fund.name || "투자기금"} ${symbol} 매도 완료`,
      creditedInClassCurrency: netInClassCurrency,
      creditedUSD: netUSD,
      realizedGainInClassCurrency,
      tradeId: tradeRef.id,
    };
  });

exports.__cancelClassFundStockUsage = async ({
  classId,
  usageId,
  reason,
  actorUid,
  logContext = {},
}) => db.runTransaction(async (tx) => {
  const usageRef = db.doc(`classes/${classId}/fundUsages/${usageId}`);
  const usageSnap = await tx.get(usageRef);
  if (!usageSnap.exists) {
    throw new HttpsError("not-found", "기금 주식 내역을 찾을 수 없습니다.");
  }
  const usage = usageSnap.data() || {};
  if (usage.cancellationStatus === "cancelled") {
    throw new HttpsError("already-exists", "이미 취소된 주식 거래입니다.");
  }

  const fundId = String(usage.fundId || "").trim();
  const tradeId = String(usage.relatedTradeId || "").trim();
  const symbol = normalizeClassFundStockSymbol(usage.symbol);
  if (!fundId || !tradeId || !symbol) {
    throw new HttpsError(
      "failed-precondition",
      "주식 원거래 연결 정보를 확인할 수 없습니다.",
    );
  }

  const fundRef = db.doc(`classes/${classId}/classFunds/${fundId}`);
  const tradeRef = db.doc(
    `classes/${classId}/classFunds/${fundId}/tradeHistory/${tradeId}`,
  );
  const portfolioRef = db.doc(
    `classes/${classId}/classFunds/${fundId}/stockPortfolio/${symbol}`,
  );
  const recentTradesQuery = fundRef.collection("tradeHistory")
    .where("symbol", "==", symbol);
  const [fundSnap, tradeSnap, portfolioSnap, recentTradesSnap] =
    await Promise.all([
      tx.get(fundRef),
      tx.get(tradeRef),
      tx.get(portfolioRef),
      tx.get(recentTradesQuery),
    ]);
  if (!fundSnap.exists || !tradeSnap.exists) {
    throw new HttpsError("not-found", "기금 또는 주식 원거래를 찾을 수 없습니다.");
  }
  const trade = tradeSnap.data() || {};
  if (trade.status === "cancelled" || trade.isCancelled === true) {
    throw new HttpsError("already-exists", "이미 취소된 주식 거래입니다.");
  }
  if (trade.usageId !== usageId || trade.fundId !== fundId ||
      normalizeClassFundStockSymbol(trade.symbol) !== symbol) {
    throw new HttpsError(
      "failed-precondition",
      "주식 거래와 기금 장부 연결 정보가 일치하지 않습니다.",
    );
  }
  const activeTrades = recentTradesSnap.docs.filter((doc) => {
    const data = doc.data() || {};
    return data.status !== "cancelled" && data.isCancelled !== true;
  }).sort((left, right) => {
    const leftTime = left.data()?.createdAt?.toMillis?.() || 0;
    const rightTime = right.data()?.createdAt?.toMillis?.() || 0;
    return rightTime - leftTime;
  });
  if (activeTrades[0]?.id !== tradeId) {
    throw new HttpsError(
      "failed-precondition",
      "같은 종목의 이후 거래가 있어 이전 거래를 취소할 수 없습니다.",
    );
  }
  const previousTrade = activeTrades[1] || null;
  const portfolio = portfolioSnap.exists ? portfolioSnap.data() || {} : {};
  if (portfolioSnap.exists && portfolio.lastTradeId !== tradeId) {
    throw new HttpsError(
      "failed-precondition",
      "현재 보유 주식 상태가 원거래와 일치하지 않습니다.",
    );
  }

  let accounting;
  try {
    accounting = buildClassFundStockCancellationAccounting(trade);
  } catch (error) {
    throw new HttpsError("failed-precondition", error.message);
  }
  const quantity = roundStockQuantity(asNum(trade.quantity, 0));
  const currentQuantity = roundStockQuantity(asNum(portfolio.quantity, 0));
  if (accounting.action === "buy_cancel" &&
      (!portfolioSnap.exists || !isStockQuantityAvailable(quantity, currentQuantity))) {
    throw new HttpsError(
      "failed-precondition",
      "매수한 주식이 현재 보유 수량에 남아 있지 않아 취소할 수 없습니다.",
    );
  }
  const fund = fundSnap.data() || {};
  const balanceBefore = asNum(fund.cashBalance, 0);
  if (accounting.cashDelta < 0 && balanceBefore < Math.abs(accounting.cashDelta)) {
    throw new HttpsError(
      "failed-precondition",
      "기금 현금이 부족해 주식 매도를 취소할 수 없습니다.",
    );
  }

  const currentInvestmentUSD = asNum(portfolio.totalInvestmentUSD, 0);
  const currentInvestmentClass = asNum(
    portfolio.totalInvestmentInClassCurrency,
    0,
  );
  const nextQuantity = accounting.action === "buy_cancel" ?
    roundStockQuantity(currentQuantity - quantity) :
    roundStockQuantity(currentQuantity + quantity);
  const nextInvestmentUSD = accounting.action === "buy_cancel" ?
    Math.max(0, round4(currentInvestmentUSD - asNum(trade.grossUSD, 0))) :
    round4(currentInvestmentUSD + asNum(trade.soldInvestmentUSD, 0));
  const nextInvestmentClass = accounting.action === "buy_cancel" ?
    Math.max(
      0,
      round4(currentInvestmentClass - asNum(trade.grossInClassCurrency, 0)),
    ) :
    round4(
      currentInvestmentClass + asNum(trade.soldInvestmentInClassCurrency, 0),
    );
  if (accounting.action === "buy_cancel" &&
      (currentInvestmentUSD + 0.0001 < asNum(trade.grossUSD, 0) ||
       currentInvestmentClass + 0.0001 < asNum(trade.grossInClassCurrency, 0))) {
    throw new HttpsError(
      "failed-precondition",
      "현재 주식 취득원가가 원거래와 일치하지 않습니다.",
    );
  }

  const now = FieldValue.serverTimestamp();
  const fundUpdate = {
    cashBalance: FieldValue.increment(accounting.cashDelta),
    investmentValue: FieldValue.increment(accounting.investmentValueDelta),
    totalValue: FieldValue.increment(accounting.totalValueDelta),
    tradeFeeTotal: FieldValue.increment(accounting.tradeFeeTotalDelta),
    tradeFeeTotalUSD: FieldValue.increment(accounting.tradeFeeTotalUSDDelta),
    exchangeFeeTotal: FieldValue.increment(accounting.exchangeFeeTotalDelta),
    exchangeFeeTotalUSD: FieldValue.increment(
      accounting.exchangeFeeTotalUSDDelta,
    ),
    lastCancellationAt: now,
    updatedAt: now,
  };
  if (accounting.investedTotalDelta) {
    fundUpdate.investedTotal = FieldValue.increment(
      accounting.investedTotalDelta,
    );
  }
  if (accounting.realizedGainDelta) {
    fundUpdate.realizedGain = FieldValue.increment(accounting.realizedGainDelta);
  }
  if (accounting.realizedLossDelta) {
    fundUpdate.realizedLoss = FieldValue.increment(accounting.realizedLossDelta);
  }
  tx.update(fundRef, fundUpdate);

  if (nextQuantity < STOCK_QUANTITY_MIN) {
    tx.delete(portfolioRef);
  } else {
    tx.set(portfolioRef, {
      symbol,
      companyName: portfolio.companyName || symbol,
      quantity: nextQuantity,
      totalInvestmentUSD: nextInvestmentUSD,
      totalInvestmentInClassCurrency: nextInvestmentClass,
      averagePriceUSD: round4(nextInvestmentUSD / nextQuantity),
      lastUpdated: now,
      lastTransactionType: previousTrade?.data()?.type ===
        "CLASS_FUND_STOCK_SELL" ? "sell" : "buy",
      lastTradeId: previousTrade?.id || null,
      ...(portfolioSnap.exists ? {} : { createdAt: now }),
    }, { merge: true });
  }

  const reversalRef = db.collection(`classes/${classId}/fundUsages`).doc();
  const reversalLedgerRef = fundRef.collection("ledger").doc();
  const direction = accounting.cashDelta > 0 ? "in" : "out";
  const cashAmount = Math.abs(accounting.cashDelta);
  const balanceAfter = round4(balanceBefore + accounting.cashDelta);
  tx.update(usageRef, {
    cancellationStatus: "cancelled",
    cancellationReason: reason,
    cancelledBy: actorUid,
    cancelledAt: now,
    reversalUsageId: reversalRef.id,
    reversalLedgerId: reversalLedgerRef.id,
    updatedAt: now,
  });
  tx.set(tradeRef, {
    status: "cancelled",
    isCancelled: true,
    cancellationReason: reason,
    cancelledBy: actorUid,
    cancelledAt: now,
    reversalUsageId: reversalRef.id,
  }, { merge: true });
  if (trade.ledgerId) {
    tx.set(fundRef.collection("ledger").doc(trade.ledgerId), {
      status: "cancelled",
      isCancelled: true,
      cancellationReason: reason,
      cancelledBy: actorUid,
      cancelledAt: now,
    }, { merge: true });
  }
  tx.set(reversalRef, {
    fundId,
    fundName: fund.name || usage.fundName || "",
    fundType: fund.fundType || usage.fundType || "investment",
    amount: cashAmount,
    channel: "stockInvestment",
    direction,
    usageKind: "cancellation_reversal",
    description: `[주식 거래 취소] ${symbol} ${quantity}주`,
    dateKey: formatDateKeyInKST(new Date()),
    symbol,
    quantity,
    balanceBefore,
    balanceAfter,
    settlementStatus: "not_applicable",
    cancellationStatus: "reversal",
    reversalOfUsageId: usageId,
    relatedTradeId: tradeId,
    reason,
    createdBy: actorUid,
    usedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  tx.set(reversalLedgerRef, {
    type: "stock_trade_cancellation",
    direction,
    amount: cashAmount,
    symbol,
    quantity,
    description: `[주식 거래 취소] ${symbol} ${quantity}주`,
    originalUsageId: usageId,
    reversalUsageId: reversalRef.id,
    relatedTradeId: tradeId,
    reason,
    balanceBefore,
    balanceAfter,
    createdBy: actorUid,
    createdAt: now,
  });
  stageActivityLog(tx, classId, {
    studentUid: actorUid,
    type: "admin_action",
    category: "class_fund_stock_cancel",
    amount: cashAmount,
    description: `기금 주식 거래 취소: ${symbol} ${quantity}주`,
    relatedDoc: { collection: "fundUsages", id: usageId },
  }, logContext);

  return {
    usageId,
    reversalUsageId: reversalRef.id,
    refundedAmount: accounting.cashDelta > 0 ? cashAmount : 0,
    debitedAmount: accounting.cashDelta < 0 ? cashAmount : 0,
    balanceAfter,
    action: accounting.action,
  };
});

const rebuildClassStockJobIndexSafely = async (classId, source) => {
  if (!classId) return;

  try {
    await rebuildClassStockJobIndex(classId, { source });
  } catch (error) {
    console.error("[STOCK_JOB_INDEX] Failed to rebuild class index.", {
      classId,
      source,
      message: error?.message || "Unknown error",
    });
  }
};

/* -------------------------- 견적 함수 -------------------------- */

/** 환전 견적 */
exports.getExchangeQuote = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");

  const { classId, direction, amount } = data || {};
  const amt = asNum(amount);

  if (!classId || !direction || amt <= 0) {
    throw new HttpsError(
      "invalid-argument",
      "필수 파라미터가 누락되었거나 유효하지 않습니다.",
    );
  }

  // direction 값 변환
  let normalizedDirection = direction;
  if (direction === "EXCHANGE_BIL_TO_USD") {
    normalizedDirection = "BIL_TO_USD";
  } else if (direction === "EXCHANGE_USD_TO_BIL") {
    normalizedDirection = "USD_TO_BIL";
  }

  if (
    normalizedDirection !== "BIL_TO_USD" &&
    normalizedDirection !== "USD_TO_BIL"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "direction 값이 유효하지 않습니다.",
    );
  }

  try {
    const { conversionRate, exchangeFeeRate, currencyUnit } =
      await getMarketConfig(null, classId, auth.uid);

    let feeSrc = 0;
    let srcAfterFee = 0;
    let targetAmount = 0;
    let sourceCurrency = "";
    let targetCurrency = "";

    if (normalizedDirection === "BIL_TO_USD") {
      feeSrc = round4(amt * exchangeFeeRate);
      srcAfterFee = round4(amt - feeSrc);
      targetAmount = round4(srcAfterFee * conversionRate);
      sourceCurrency = currencyUnit;
      targetCurrency = "USD";
    } else {
      feeSrc = round4(amt * exchangeFeeRate);
      srcAfterFee = round4(amt - feeSrc);
      targetAmount = round4(srcAfterFee / conversionRate);
      sourceCurrency = "USD";
      targetCurrency = currencyUnit;
    }

    return {
      success: true,
      data: {
        // 클라이언트 호환 필드명
        inputAmount: amt,
        feeAmount: feeSrc,
        feeRate: exchangeFeeRate,
        netAmount: srcAfterFee,
        netAmountSource: srcAfterFee,
        outputAmount: targetAmount,
        finalAmountTarget: targetAmount,
        rate: conversionRate,
        conversionRate,
        exchangeFeeRate,
        sourceCurrency,
        targetCurrency,
        currencyUnit,
        direction: normalizedDirection,
        canExchange: true,
      },
    };
  } catch (e) {
    console.error("환전 견적 조회 오류:", e);
    throw new HttpsError(
      "internal",
      e.message || "환전 견적 조회 중 오류가 발생했습니다.",
    );
  }
});

/** 매수 견적 */
exports.getStockBuyQuote = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");

  const { classId, symbol, priceUSD, quantity } = data || {};
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const qty = normalizeStockQuantity(quantity);
  const price = asNum(priceUSD);

  if (!classId || !normalizedSymbol || qty <= 0 || price <= 0) {
    throw new HttpsError(
      "invalid-argument",
      "필수 파라미터가 누락되었거나 유효하지 않습니다.",
    );
  }

  try {
    await assertCanBuyStock({
      classId,
      uid: auth.uid,
      symbol: normalizedSymbol,
      role: auth.token?.role,
    });
    const { tradeFeeRate, tradeFeeMinUSD, currencyUnit } =
      await getMarketConfig(null, classId, auth.uid);
    const { price } = await readStockTradePricing({ db, symbol: normalizedSymbol });

    const grossUSD = round4(price * qty);
    const feeUSD = Math.max(round4(grossUSD * tradeFeeRate), tradeFeeMinUSD);
    const totalUSD = round4(grossUSD + feeUSD);

    return {
      success: true,
      data: {
        symbol: normalizedSymbol,
        quantity: qty,
        priceUSD: price,
        grossUSD,
        feeUSD,
        totalUSD,
        tradeFeeRate,
        tradeFeeMinUSD,
        currencyUnit,
      },
    };
  } catch (e) {
    console.error("주식 매수 견적 조회 오류:", e);
    if (e instanceof HttpsError) throw e;
    throw new HttpsError(
      "internal",
      e.message || "매수 견적 조회 중 오류가 발생했습니다.",
    );
  }
});

/** 매도 견적 */
exports.getStockSellQuote = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");

  const { classId, symbol, priceUSD, quantity } = data || {};
  const qty = normalizeStockQuantity(quantity);
  const price = asNum(priceUSD);

  if (!classId || !symbol || qty <= 0 || price <= 0) {
    throw new HttpsError(
      "invalid-argument",
      "필수 파라미터가 누락되었거나 유효하지 않습니다.",
    );
  }

  try {
    const { tradeFeeRate, tradeFeeMinUSD, currencyUnit } =
      await getMarketConfig(null, classId, auth.uid);
    const { price } = await readStockTradePricing({ db, symbol });

    const grossUSD = round4(price * qty);
    const feeUSD = Math.max(round4(grossUSD * tradeFeeRate), tradeFeeMinUSD);
    const netUSD = round4(grossUSD - feeUSD);

    return {
      success: true,
      data: {
        symbol,
        quantity: qty,
        priceUSD: price,
        grossUSD,
        feeUSD,
        netUSD,
        tradeFeeRate,
        tradeFeeMinUSD,
        currencyUnit,
      },
    };
  } catch (e) {
    console.error("주식 매도 견적 조회 오류:", e);
    if (e instanceof HttpsError) throw e;
    throw new HttpsError(
      "internal",
      e.message || "매도 견적 조회 중 오류가 발생했습니다.",
    );
  }
});

/* -------------------------- 매수 (USD 결제) -------------------------- */
exports.performStockBuy = onCall(
  { memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    const callerRole = String(auth.token?.role || "").trim().toLowerCase();
    const isTeacherOrAdmin =
      callerRole === "teacher" || callerRole === "admin";
    if (isKstWeekend() && !isTeacherOrAdmin) {
      throw new HttpsError(
        "failed-precondition",
        "주말(KST)에는 주식 거래를 할 수 없습니다.",
      );
    }

    const { classId, symbol, quantity, priceUSD, classFundId, clientRequestId } = data || {};
    const uid = auth.uid;
    const normalizedClassFundId = normalizeClassFundId(classFundId);
    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    const qty = normalizeStockQuantity(quantity);
    const price = asNum(priceUSD);

    if (!classId || !normalizedSymbol || qty <= 0 || price <= 0) {
      throw new HttpsError("invalid-argument", "파라미터가 유효하지 않습니다.");
    }

    // [Master] 정책 로드 및 권한 체크
    const [globalConfig, classSnap] = await Promise.all([
      getGlobalConfig(),
      db.doc(`classes/${classId}`).get(),
    ]);

    const classData = classSnap.exists ? classSnap.data() : {};
    const planType = classData.planType || "FREE";

    if (!canUseFeature(globalConfig, planType, "stock", "accessible")) {
      throw new HttpsError(
        "permission-denied",
        "현재 플랜에서는 주식 매수 기능을 이용할 수 없습니다.",
      );
    }

    const logContext = { config: globalConfig, planType, serviceName: "stock" };
    const classIndexVersion = asNum(classData?.stockJobIndex?.version, 0);

    if (normalizedClassFundId) {
      try {
        return await performClassFundStockBuyTransaction({
          classId,
          fundId: normalizedClassFundId,
          actorUid: uid,
          symbol: normalizedSymbol,
          qty,
          expectedPrice: price,
          clientRequestId,
        });
      } catch (e) {
        if (e instanceof HttpsError) {
          throw e;
        }
        throw new HttpsError(
          "internal",
          e?.message || "투자기금 매수 처리 중 오류가 발생했습니다.",
        );
      }
    }

    await assertCanBuyStock({
      classId,
      uid,
      symbol: normalizedSymbol,
      role: callerRole,
    });

    let tradeOutcome;
    try {
      tradeOutcome = await runFinancialRequest({
        db, classId, actorUid: uid, operation: "stock_buy", clientRequestId,
        payload: { fundId: "", symbol: normalizedSymbol, quantity: qty, price },
      }, async (tx) => {
        // 1) 모든 읽기 작업
        const stuRef = db.doc(`classes/${classId}/students/${uid}`);
        const stuSnap = await tx.get(stuRef);
        if (!stuSnap.exists) throw new Error("학생 정보를 찾을 수 없습니다.");

        const portfolioRef = db.doc(
          `classes/${classId}/students/${uid}/stockPortfolio/${normalizedSymbol}`,
        );
        const portfolioList = await tx.get(stuRef.collection("stockPortfolio"));
        const portfolioSnap = portfolioList.docs.find((entry) => entry.id === normalizedSymbol) || { exists: false };
        const portfolioData = portfolioSnap.exists ? portfolioSnap.data() || {} : {};
        const createdPortfolio =
          !portfolioSnap.exists || !(asNum(portfolioData.quantity, 0) > 0);

        const marketConfig = await getMarketConfig(tx, classId, uid);
        const { price: serverPrice, prices } = await readStockTradePricing({
          db, tx, symbol: normalizedSymbol, expectedPrice: price,
        });
        const {
          tradeFeeRate,
          tradeFeeMinUSD,
          conversionRate,
          currencyUnit,
          exchangeFeeRate,
          studentAutoExchangeBuyEnabled,
        } = marketConfig;

        const student = stuSnap.data();
        const grossUSD = round4(serverPrice * qty);
        const feeUSD = Math.max(
          round4(grossUSD * tradeFeeRate),
          tradeFeeMinUSD,
        );
        const totalUSD = round4(grossUSD + feeUSD);

        const usdBal = asNum(student?.assets?.usdBalance, 0);
        const cashBal = Math.max(0, getSpendableBankBalance(student.assets));
        const payment = buildStudentAutoExchangeBuyPayment({
          totalUSD,
          usdBalance: usdBal,
          cashBalance: cashBal,
          conversionRate,
          exchangeFeeRate,
          enabled: studentAutoExchangeBuyEnabled,
        });
        if (!payment.canAfford) {
          if (payment.autoExchangeApplied) {
            throw new Error(
              `${currencyUnit} 잔액이 부족합니다. (자동환전 필요: ${payment.autoExchangeSourceAmount.toFixed(2)}, 보유: ${cashBal.toFixed(2)})`,
            );
          }
          throw new Error(
            `FIN 잔액이 부족합니다. (필요: ${totalUSD.toFixed(2)}, 보유: ${usdBal.toFixed(2)})`,
          );
        }

        const indexUpdate = await applyPortfolioIndexDelta(tx, {
          classId,
          studentUid: uid,
          symbol: normalizedSymbol,
          createdPortfolio,
          source: "performStockBuy",
        });

        // 2) 쓰기 작업 시작
        // A. 자산 차감
        tx.update(stuRef, {
          "assets.usdBalance": FieldValue.increment(-payment.usdUsed),
          ...(payment.autoExchangeApplied
            ? {
                "assets.cash": FieldValue.increment(
                  -payment.autoExchangeSourceAmount,
                ),
              }
            : {}),
          "assets.stockValue.value": valuePortfolioAfterTrade({
            portfolioDocs: portfolioList.docs, prices, symbol: normalizedSymbol, quantityDelta: qty,
          }),
          "assets.stockValue.lastUpdated": FieldValue.serverTimestamp(), // 값 갱신 시각 기록
          ...buildTradePerformanceUpdate({
            symbol: normalizedSymbol,
            feeUSD,
            feeInClassCurrency: round4(feeUSD / conversionRate),
            tradeType: "buy",
          }),
        });

        // B. tradeHistory 기록
        const tradeRef = db
          .collection(`classes/${classId}/students/${uid}/tradeHistory`)
          .doc();

        tx.set(tradeRef, {
          type: "STOCK_BUY",
          classId,
          userId: uid,
          actorUid: uid,
          studentName: student?.name || "",
          symbol: normalizedSymbol,
          quantity: qty,
          priceUSD: serverPrice,
          grossUSD,
          feeUSD,
          totalUSD,
          tradeFeeRate,
          exchangeFeeRate,
          autoExchangeApplied: payment.autoExchangeApplied,
          usdBalanceUsed: payment.usdUsed,
          autoExchangeUSD: payment.autoExchangeUSD,
          autoExchangeSourceAmount: payment.autoExchangeSourceAmount,
          autoExchangeFeeInClassCurrency:
            payment.autoExchangeFeeInClassCurrency,
          conversionRate,
          currencyUnit,
          description: `${normalizedSymbol} ${qty}주 매수`,
          createdAt: FieldValue.serverTimestamp(),
        });

        // C. stockPortfolio 업데이트
        if (portfolioSnap.exists) {
          const currentData = portfolioData;
          const newQuantity = roundStockQuantity(
            asNum(currentData.quantity, 0) + qty,
          );
          const totalInvestment =
            asNum(currentData.totalInvestmentUSD, 0) + grossUSD;

          tx.update(portfolioRef, {
            quantity: newQuantity,
            totalInvestmentUSD: totalInvestment,
            averagePriceUSD: round4(totalInvestment / newQuantity),
            lastBuyAt: FieldValue.serverTimestamp(),
            lastUpdated: FieldValue.serverTimestamp(),
            lastTransactionType: "buy",
            lastTradeId: tradeRef.id,
          });
        } else {
          tx.set(portfolioRef, {
            symbol: normalizedSymbol,
            companyName: normalizedSymbol,
            quantity: qty,
            totalInvestmentUSD: grossUSD,
            averagePriceUSD: serverPrice,
            createdAt: FieldValue.serverTimestamp(),
            lastBuyAt: FieldValue.serverTimestamp(),
            lastUpdated: FieldValue.serverTimestamp(),
            lastTransactionType: "buy",
            lastTradeId: tradeRef.id,
          });
        }

        // [Master] 활동 로그 기록 (정책 반영)
        stageActivityLog(
          tx,
          classId,
          {
            studentUid: uid,
            type: "expense",
            category: "stock_buy",
            amount: totalUSD,
            currency: "USD",
            amountInClassCurrency: round4(totalUSD / conversionRate),
            conversionRate,
            autoExchangeApplied: payment.autoExchangeApplied,
            autoExchangeUSD: payment.autoExchangeUSD,
            autoExchangeSourceAmount: payment.autoExchangeSourceAmount,
            autoExchangeFeeInClassCurrency:
              payment.autoExchangeFeeInClassCurrency,
            exchangeFeeRate,
            description: payment.autoExchangeApplied
              ? `${normalizedSymbol} ${qty}주 매수 (매매 수수료 ${feeUSD.toFixed(2)} FIN, 자동환전 수수료 ${payment.autoExchangeFeeInClassCurrency.toFixed(2)} ${currencyUnit})`
              : `${normalizedSymbol} ${qty}주 매수 (수수료 ${feeUSD.toFixed(2)} FIN 포함)`,
            relatedDoc: { collection: "tradeHistory", id: tradeRef.id },
          },
          logContext,
        );

        return {
          shouldRebuildJobIndex:
            classIndexVersion !== STOCK_JOB_INDEX_VERSION ||
            indexUpdate.shouldRebuild,
          response: {
            success: true,
            message: `${normalizedSymbol} ${qty}주 매수 완료`,
            debitedUSD: totalUSD,
            debitedCash: payment.autoExchangeSourceAmount,
            autoExchangeFeeInClassCurrency:
              payment.autoExchangeFeeInClassCurrency,
            newUsdBalance: round2(usdBal - payment.usdUsed),
            tradeId: tradeRef.id,
          },
        };
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", e?.message || "주식 매수 처리 중 오류가 발생했습니다.");
    }

    if (tradeOutcome?.shouldRebuildJobIndex) {
      await rebuildClassStockJobIndexSafely(
        classId,
        "performStockBuy_post_commit",
      );
    }

    return tradeOutcome?.response || null;
  },
);

/* -------------------------- 매도 (USD 수령) -------------------------- */
/**
 * @param {string} data.classId - 학급 ID
 * @param {string} data.symbol - 주식 심볼
 * @param {number} data.quantity - 매도 수량
 * @param {number} data.priceUSD - 현재가 (USD)
 * @param {string} [data.studentUid] - (교사용) 매도 대상 학생 UID
 */
exports.performStockSell = onCall(
  { memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    const callerRole = String(auth.token?.role || "").trim().toLowerCase();
    const isTeacherOrAdmin =
      callerRole === "teacher" || callerRole === "admin";
    if (isKstWeekend() && !isTeacherOrAdmin) {
      throw new HttpsError(
        "failed-precondition",
        "주말(KST)에는 주식 거래를 할 수 없습니다.",
      );
    }

    const { classId, symbol, quantity, priceUSD, studentUid, classFundId, clientRequestId } = data || {};
    const actorUid = auth.uid; // 실제 실행 사용자 UID
    const normalizedClassFundId = normalizeClassFundId(classFundId);
    const normalizedSymbol = String(symbol || "").trim().toUpperCase();

    // 1. 거래 대상자(targetUid) 결정: studentUid가 있으면 대상 학생, 없으면 본인
    const targetUid = studentUid || actorUid;
    const isForceSell = studentUid && studentUid !== actorUid;

    const qty = normalizeStockQuantity(quantity);
    const price = asNum(priceUSD);

    if (!classId || !normalizedSymbol || qty <= 0 || price <= 0) {
      throw new HttpsError("invalid-argument", "파라미터가 유효하지 않습니다.");
    }

    try {
      // 2. 권한 체크: 타인의 주식을 매도할 때(강제매도) 교사/관리자만 허용
      if (isForceSell) {
        const actorSnap = await db
          .doc(`classes/${classId}/students/${actorUid}`)
          .get();
        const actorData = actorSnap.data();
        if (actorData?.role !== "teacher" && actorData?.role !== "admin") {
          throw new HttpsError(
            "permission-denied",
            "타인의 자산을 관리할 권한이 없습니다.",
          );
        }
      }

      // 3. 플랜 정책 로드
      const [globalConfig, classSnap] = await Promise.all([
        getGlobalConfig(),
        db.doc(`classes/${classId}`).get(),
      ]);

      const classData = classSnap.data() || {};
      const planType = classData.planType || "FREE";
      const classIndexVersion = asNum(classData?.stockJobIndex?.version, 0);
      if (!canUseFeature(globalConfig, planType, "stock", "accessible")) {
        throw new HttpsError(
          "permission-denied",
          "현재 플랜에서는 주식 기능을 이용할 수 없습니다.",
        );
      }

      const logContext = {
        config: globalConfig,
        planType,
        serviceName: "stock",
      };

      // 4. 트랜잭션 시작
      if (normalizedClassFundId) {
        try {
          return await performClassFundStockSellTransaction({
            classId,
            fundId: normalizedClassFundId,
            actorUid,
            symbol: normalizedSymbol,
            qty,
            expectedPrice: price,
            clientRequestId,
          });
        } catch (e) {
          if (e instanceof HttpsError) {
            throw e;
          }
          throw new HttpsError(
            "internal",
            e?.message || "투자기금 매도 처리 중 오류가 발생했습니다.",
          );
        }
      }

      let tradeOutcome;
      try {
        tradeOutcome = await runFinancialRequest({
          db, classId, actorUid, operation: "stock_sell", clientRequestId,
          payload: { fundId: "", targetUid, symbol: normalizedSymbol, quantity: qty, price },
        }, async (tx) => {
          // 1) 읽기 작업 (targetUid 기준)
          const stuRef = db.doc(`classes/${classId}/students/${targetUid}`);
          const stuSnap = await tx.get(stuRef);
          if (!stuSnap.exists) {
            throw new Error("대상 학생 정보를 찾을 수 없습니다.");
          }

          const portfolioRef = db.doc(
            `classes/${classId}/students/${targetUid}/stockPortfolio/${normalizedSymbol}`,
          );
          const portfolioList = await tx.get(stuRef.collection("stockPortfolio"));
          const portfolioSnap = portfolioList.docs.find((entry) => entry.id === normalizedSymbol) || { exists: false };

          if (!portfolioSnap.exists) {
            throw new Error(`${symbol} 주식을 보유하고 있지 않습니다.`);
          }

          const portfolioData = portfolioSnap.data();
          const currentQuantity = roundStockQuantity(
            asNum(portfolioData.quantity, 0),
          );
          if (!isStockQuantityAvailable(qty, currentQuantity)) {
            throw new Error("보유 수량이 부족합니다.");
          }

          const marketConfig = await getMarketConfig(tx, classId, targetUid);
          const { price: serverPrice, prices } = await readStockTradePricing({
            db, tx, symbol: normalizedSymbol, expectedPrice: price,
          });
          const {
            tradeFeeRate,
            tradeFeeMinUSD,
            conversionRate,
            currencyUnit,
            stockMinHoldingDays,
          } = marketConfig;

          assertStockSellHoldingPeriod({
            symbol,
            portfolioData,
            stockMinHoldingDays,
            isTeacherOrAdmin: isTeacherOrAdmin || isForceSell,
          });

          // 2) 매도 금액 및 수수료 계산
          const grossUSD = round4(serverPrice * qty);
          const feeUSD = Math.max(
            round4(grossUSD * tradeFeeRate),
            tradeFeeMinUSD,
          );
          const netUSD = round4(grossUSD - feeUSD);
          const currentUsdBal = asNum(stuSnap.data()?.assets?.usdBalance, 0);
          const newQuantity = roundStockQuantity(currentQuantity - qty);
          const currentInvestment = asNum(portfolioData.totalInvestmentUSD, 0);
          const avgPrice = asNum(portfolioData.averagePriceUSD, serverPrice);
          const soldInvestment = round4(avgPrice * qty);
          const newInvestment =
            newQuantity < STOCK_QUANTITY_MIN
              ? 0
              : Math.max(0, currentInvestment - soldInvestment);
          const realizedGainUSD = round4(netUSD - soldInvestment);
          const realizedGainInClassCurrency = round4(
            realizedGainUSD / conversionRate,
          );
          const soldInvestmentInClassCurrency = round4(
            soldInvestment / conversionRate,
          );
          const realizedReturnRate = soldInvestment > 0
            ? round4((realizedGainUSD / soldInvestment) * 100)
            : 0;

          const indexUpdate = await applyPortfolioIndexDelta(tx, {
            classId,
            studentUid: targetUid,
            symbol,
            deletedPortfolio: newQuantity < STOCK_QUANTITY_MIN,
            source: "performStockSell",
          });

          // 3) 쓰기 작업 시작
          // A. 학생 자산 업데이트 (FIN 잔액 증가)
          tx.update(stuRef, {
            "assets.usdBalance": FieldValue.increment(netUSD),
            "assets.stockValue.value": valuePortfolioAfterTrade({
              portfolioDocs: portfolioList.docs, prices, symbol: normalizedSymbol, quantityDelta: -qty,
            }),
            "assets.stockValue.lastUpdated": FieldValue.serverTimestamp(),
            ...buildTradePerformanceUpdate({
              symbol,
              feeUSD,
              feeInClassCurrency: round4(feeUSD / conversionRate),
              tradeType: "sell",
              realizedGainUSD,
              realizedGainInClassCurrency,
            }),
          });

          // B. 거래 이력(tradeHistory) 기록
          const tradeRef = db
            .collection(`classes/${classId}/students/${targetUid}/tradeHistory`)
            .doc();
          const description = isForceSell
            ? `[강제매도] ${symbol} ${qty}주`
            : `${symbol} ${qty}주 매도`;

          tx.set(tradeRef, {
            type: "STOCK_SELL",
            classId,
            userId: targetUid,
            actorUid: actorUid,
            studentName: stuSnap.data()?.name || "",
            symbol,
            quantity: qty,
            priceUSD: serverPrice,
            grossUSD,
            feeUSD,
            netUSD,
            tradeFeeRate,
            conversionRate,
            currencyUnit,
            soldInvestmentUSD: soldInvestment,
            realizedGainUSD,
            realizedGainInClassCurrency,
            description,
            createdAt: FieldValue.serverTimestamp(),
          });

          // C. 포트폴리오 업데이트/삭제
          if (newQuantity < STOCK_QUANTITY_MIN) {
            tx.delete(portfolioRef);
          } else {
            tx.update(portfolioRef, {
              quantity: newQuantity,
              totalInvestmentUSD: newInvestment,
              lastUpdated: FieldValue.serverTimestamp(),
              lastTransactionType: "sell",
              lastTradeId: tradeRef.id,
            });
          }

          // D. 활동 로그 기록 (ActivityLog)
          stageActivityLog(
            tx,
            classId,
            {
              studentUid: targetUid,
              type: "income",
              category: "stock_sell",
              amount: netUSD,
              currency: "USD",
              amountInClassCurrency: round4(netUSD / conversionRate),
              conversionRate,
              symbol,
              quantity: qty,
              priceUSD: serverPrice,
              grossUSD,
              feeUSD,
              netUSD,
              soldInvestmentUSD: soldInvestment,
              soldInvestmentInClassCurrency,
              realizedGainUSD,
              realizedGainInClassCurrency,
              realizedReturnRate,
              description: `${description} (수수료 ${feeUSD.toFixed(2)} FIN 차감)`,
              relatedDoc: { collection: "tradeHistory", id: tradeRef.id },
            },
            logContext,
          );

          return {
            shouldRebuildJobIndex:
              classIndexVersion !== STOCK_JOB_INDEX_VERSION ||
              indexUpdate.shouldRebuild,
            response: {
              success: true,
              message: isForceSell
                ? `${stuSnap.data()?.name} 학생의 ${symbol} 강제 매도 완료`
                : `${symbol} 매도 완료`,
              creditedUSD: netUSD,
              newUsdBalance: round2(currentUsdBal + netUSD),
              tradeId: tradeRef.id,
            },
          };
        });
      } catch (e) {
        console.error("주식 매도 처리 오류:", e);
        if (e instanceof HttpsError) throw e;
        throw new HttpsError(
          "internal",
          e.message || "매도 처리 중 오류가 발생했습니다.",
        );
      }

      if (tradeOutcome?.shouldRebuildJobIndex) {
        await rebuildClassStockJobIndexSafely(
          classId,
          "performStockSell_post_commit",
        );
      }

      return tradeOutcome?.response || null;
    } catch (e) {
      if (e instanceof HttpsError) {
        throw e;
      }

      console.error("주식 매도 처리 오류:", e);
      throw new HttpsError(
        "internal",
        e?.message || "매도 처리 중 오류가 발생했습니다.",
      );
    }
    },
);

/* ------------------------------ 환전 ------------------------------ */
/**
 * direction: "EXCHANGE_BIL_TO_USD" | "EXCHANGE_USD_TO_BIL" (클라이언트)
 * 또는 "BIL_TO_USD" | "USD_TO_BIL" (서버 처리)
 * amount: 입력 금액
 */
exports.performExchange = onCall(
  { memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "인증이 필요합니다.");

    const { classId, direction, amount, clientRequestId } = data || {};
    const uid = auth.uid;
    const amt = asNum(amount);

    if (!classId || !direction || amt <= 0) {
      throw new HttpsError("invalid-argument", "파라미터가 유효하지 않습니다.");
    }

    // [Master] 정책 로드 및 권한 체크
    const [globalConfig, classSnap] = await Promise.all([
      getGlobalConfig(),
      db.doc(`classes/${classId}`).get(),
    ]);

    const classData = classSnap.data() || {};
    const planType = classData.planType || "FREE";

    if (!canUseFeature(globalConfig, planType, "stock", "accessible")) {
      throw new HttpsError(
        "permission-denied",
        "현재 플랜에서는 환전 기능을 이용할 수 없습니다.",
      );
    }

    const logContext = { config: globalConfig, planType, serviceName: "stock" };

    // direction 정규화
    let normDir = direction;
    if (direction === "EXCHANGE_BIL_TO_USD") normDir = "BIL_TO_USD";
    if (direction === "EXCHANGE_USD_TO_BIL") normDir = "USD_TO_BIL";

    try {
      if (!["BIL_TO_USD", "USD_TO_BIL"].includes(normDir)) {
        throw new HttpsError("invalid-argument", "환전 방향이 올바르지 않습니다.");
      }
      return await runFinancialRequest({
        db, classId, actorUid: uid, operation: "stock_exchange", clientRequestId,
        payload: { direction: normDir, amount: amt },
      }, async (tx) => {
        const stuRef = db.doc(`classes/${classId}/students/${uid}`);
        const stuSnap = await tx.get(stuRef);
        if (!stuSnap.exists) throw new Error("학생 정보를 찾을 수 없습니다.");

        const student = stuSnap.data();

        // 클래스별 시장 설정 로드
        const { conversionRate, exchangeFeeRate, currencyUnit } =
          await getMarketConfig(tx, classId, uid);

        const usdBal = asNum(student?.assets?.usdBalance, 0);

        let feeSrc = 0,
          srcAfterFee = 0,
          targetAmount = 0;

        // 설명 문자열을 미리 정의해 재사용
        const exchangeDesc =
          normDir === "BIL_TO_USD"
            ? `${currencyUnit} -> FIN 환전`
            : `FIN -> ${currencyUnit} 환전`;

        if (normDir === "BIL_TO_USD") {
          // 학급 통화 -> 달러(FIN)
          if (getSpendableBankBalance(student.assets) < amt) {
            throw new HttpsError("failed-precondition", `사용 가능한 ${currencyUnit} 잔액이 부족합니다.`);
          }
          feeSrc = round4(amt * exchangeFeeRate);
          srcAfterFee = round4(amt - feeSrc);
          targetAmount = round4(srcAfterFee * conversionRate);

          tx.update(stuRef, {
            "assets.cash": FieldValue.increment(-amt),
            "assets.usdBalance": FieldValue.increment(targetAmount),
          });
        } else {
          // 달러(FIN) -> 학급 통화
          if (usdBal < amt) throw new Error("FIN 잔액이 부족합니다.");
          feeSrc = round4(amt * exchangeFeeRate);
          srcAfterFee = round4(amt - feeSrc);
          targetAmount = round4(srcAfterFee / conversionRate);

          tx.update(stuRef, {
            "assets.usdBalance": FieldValue.increment(-amt),
            "assets.cash": FieldValue.increment(targetAmount),
          });
        }

        const tradeRef = db
          .collection(`classes/${classId}/students/${uid}/tradeHistory`)
          .doc();
        tx.set(tradeRef, {
          type: `EXCHANGE_${normDir}`,
          classId,
          userId: uid,
          actorUid: uid,
          studentName: student?.name || "",
          direction: normDir,
          inputAmount: amt,
          inputCurrency: normDir === "BIL_TO_USD" ? currencyUnit : "USD",
          feeAmount: feeSrc,
          netSourceAmount: srcAfterFee,
          outputAmount: targetAmount,
          outputCurrency: normDir === "BIL_TO_USD" ? "USD" : currencyUnit,
          conversionRateUsed: conversionRate,
          exchangeFeeRate,
          currencyUnit,
          createdAt: FieldValue.serverTimestamp(),
          description: exchangeDesc, // 설명 재사용
        });

        // [Master] 활동 로그 기록
        stageActivityLog(
          tx,
          classId,
          {
            studentUid: uid,
            type: "exchange",
            category: "currency_exchange",
            amount: amt,
            currency: normDir === "BIL_TO_USD" ? "class_currency" : "USD",
            amountInClassCurrency:
              normDir === "BIL_TO_USD" ? amt : targetAmount,
            conversionRate,
            description: `${exchangeDesc} 완료`, // 설명 재사용
            relatedDoc: { collection: "tradeHistory", id: tradeRef.id },
          },
          logContext,
        );

        return {
          success: true,
          tradeId: tradeRef.id,
          targetAmount,
          message: `${exchangeDesc}이(가) 완료되었습니다.`,
        };
      });
    } catch (e) {
      console.error("환전 트랜잭션 오류:", e);
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", e?.message || "환전 처리 중 오류가 발생했습니다.");
    }
  },
);

exports.rebuildStockJobIndex = onCall(
  { memory: "512MiB", timeoutSeconds: 540 },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new HttpsError("unauthenticated", "인증이 필요합니다.");
    }

    const role = String(auth.token?.role || "").trim().toLowerCase();
    if (role !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "관리자만 주식 작업 인덱스를 재구성할 수 있습니다.",
      );
    }

    const classId = String(data?.classId || "").trim();
    if (classId) {
      const result = await rebuildClassStockJobIndex(classId, {
        source: "admin_rebuildStockJobIndex",
      });

      return {
        success: true,
        scope: "class",
        ...result,
      };
    }

    const result = await rebuildAllClassStockJobIndexes({
      source: "admin_rebuildStockJobIndex",
    });

    return {
      success: result.failures.length === 0,
      scope: "all",
      ...result,
    };
  },
);

exports.syncAllPortfoliosDaily = onSchedule(
  {
    schedule: "40 7 * * 2-6",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const { targetNY } = getPrefetchContext();

    // 1. 미국 거래일 기준 시세를 우선 사용
    const datedSummarySnap = await db
      .collection("stockMarketSummary")
      .doc(`quotes_${targetNY}`)
      .get();
    const fallbackSummarySnap = await db
      .collection("stockMarketSummary")
      .doc("today_quotes_all")
      .get();
    const summarySnap = datedSummarySnap.exists ?
      datedSummarySnap :
      fallbackSummarySnap;
    if (!summarySnap.exists) return null;
    const priceMap = summarySnap.data();
    const priceSourceDoc = datedSummarySnap.exists ?
      `quotes_${targetNY}` :
      "today_quotes_all";
    await ensureStockJobIndexBootstrapped({
      source: "syncAllPortfoliosDaily",
    });

    const classesSnap = await getClassesWithStockHolders();
    if (classesSnap.empty) {
      console.info("[STOCK_SYNC] No holder classes found for revaluation.", {
        targetNY,
      });
      return null;
    }

    // 학급별 병렬 처리
    await Promise.all(
      classesSnap.docs.map(async (classDoc) => {
        const classId = classDoc.id;
        const classIndex = classDoc.data()?.stockJobIndex || {};
        const [marketConfig, studentsSnap, initialHolderStudentsSnap] = await Promise.all([
          getMarketConfig(
            null,
            classId,
          ),
          db.collection(`classes/${classId}/students`).get(),
          classDoc.ref.collection("stockJobIndexStudents").get(),
        ]);
        const { conversionRate, currencyUnit } = marketConfig;
        const indexedHolderCount = Math.max(
          0,
          Math.round(asNum(classIndex.stockHolderCount, 0)),
        );
        const hasCurrentIndexVersion =
          asNum(classIndex.version, 0) === STOCK_JOB_INDEX_VERSION;
        let holderStudentsSnap = initialHolderStudentsSnap;

        if (
          !hasCurrentIndexVersion ||
          holderStudentsSnap.size !== indexedHolderCount
        ) {
          await rebuildClassStockJobIndexSafely(
            classId,
            "syncAllPortfoliosDaily_index_repair",
          );
          holderStudentsSnap = await classDoc.ref
            .collection("stockJobIndexStudents")
            .get();
        }

        const holderStudentIds = new Set(
          holderStudentsSnap.docs.map((docSnap) => docSnap.id),
        );
        const canUseHolderStudentIndex =
          holderStudentIds.size > 0 ||
          Math.max(0, Math.round(asNum(classIndex.stockHolderCount, 0))) === 0;

        let batch = db.batch();
        let writeCount = 0;
        const flushBatch = async () => {
          if (writeCount === 0) return;
          await batch.commit();
          batch = db.batch();
          writeCount = 0;
        };

        for (const studentDoc of studentsSnap.docs) {
          const studentData = studentDoc.data();
          let totalValueUSD = 0;
          let totalCostBasisUSD = 0;
          const holdingDocs = [];

          if (!canUseHolderStudentIndex || holderStudentIds.has(studentDoc.id)) {
            const portfolioSnap = await studentDoc.ref
              .collection("stockPortfolio")
              .get();

            if (!portfolioSnap.empty) {
              portfolioSnap.forEach((pDoc) => {
                const hold = pDoc.data();
                holdingDocs.push(hold);
                const currentPrice = priceMap[hold.symbol]?.current || 0;
                totalValueUSD += currentPrice * (Number(hold.quantity) || 0);
                totalCostBasisUSD += asNum(
                  hold.totalInvestmentUSD,
                  asNum(hold.averagePriceUSD, 0) * asNum(hold.quantity, 0),
                );
              });
            }
          }

          totalValueUSD = round4(totalValueUSD);
          totalCostBasisUSD = round4(totalCostBasisUSD);

          // 비용 최적화: 기존 값과 같으면 업데이트 생략
          const prevValue = studentData.assets?.stockValue?.value || 0;
          const shouldUpdateStudentValue = !(
            prevValue === totalValueUSD &&
            studentData.assets?.stockValue !== undefined
          );

          if (shouldUpdateStudentValue) {
            batch.update(studentDoc.ref, {
              "assets.stockValue.value": totalValueUSD,
              "assets.lastRevaluationAt":
                admin.firestore.FieldValue.serverTimestamp(),
            });
            writeCount++;
          }

          const snapshotPayload = buildStudentStockSnapshot({
            classId,
            studentId: studentDoc.id,
            studentData,
            portfolioDocs: holdingDocs,
            priceMap,
            conversionRate,
            currencyUnit,
            snapshotDateNY: targetNY,
            priceSourceDoc,
          });

          if (
            shouldWriteStudentStockSnapshot({
              studentData,
              snapshot: snapshotPayload,
            })
          ) {
            const snapshotRef = studentDoc.ref
              .collection("stockDailySnapshots")
              .doc(targetNY);

            batch.set(snapshotRef, snapshotPayload, { merge: true });
            writeCount++;
          }

          if (writeCount >= SNAPSHOT_BATCH_LIMIT) {
            await flushBatch();
          }
        }

        await flushBatch();
        await classDoc.ref
          .collection(STOCK_SNAPSHOT_STATUS_COLLECTION)
          .doc(targetNY)
          .set({
            classId,
            snapshotDateNY: targetNY,
            ready: true,
            studentCount: studentsSnap.size,
            indexedHolderCount: holderStudentIds.size,
            stockJobIndexVersion: STOCK_JOB_INDEX_VERSION,
            priceSourceDoc,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        console.log(`[${classId}] 주식 재평가 및 일간 스냅샷 저장 완료 (${targetNY})`);
      }),
    );

    return null;
  },
);

