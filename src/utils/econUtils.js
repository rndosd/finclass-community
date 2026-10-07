import { formatDateKeyInKST } from "./kstDate";

/**
 * econUtils.js
 * 교실 경제 지표 통합 유틸
 * ---------------------------------------------
 * 규칙:
 * - conversionRate: "1 로컬통화 = conversionRate USD" (LOCAL_TO_USD)
 *   → USD→Local 변환 시: usdAmount / conversionRate
 *   → Local→USD 변환 시: localAmount * conversionRate
 * - 통화량(M):
 *   M0 = 현금(cash에 이미 대출 포함됨) + USD현금(환산)
 *   M2 = M0 + 적금(deposit)
 * - 주식평가액은 통화량(M)에 포함하지 않음
 *   잠재 유동성(보조)에만 반영
 * ---------------------------------------------
 * ✅ 수정사항:
 * 1. cash에 대출이 이미 포함되어 있으므로 M0에서 loan 제거
 * 2. USD 현금(usdBalance)을 M0, M2에 포함
 * 3. 잠재유동성 = M2 + λ × 주식평가액(환산)
 */

/////////////////////////////
// 숫자/공통
/////////////////////////////
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const safeDiv = (a, b) => (n(b) === 0 ? 0 : n(a) / n(b));

export const pctChange = (curr, prev) => {
  const c = n(curr),
    p = n(prev);
  return p === 0 ? 0 : ((c - p) / Math.abs(p)) * 100;
};

export const usdToLocal = (usdAmount, conversionRate) => {
  const cr = n(conversionRate),
    usd = n(usdAmount);
  return cr > 0 ? usd / cr : 0;
};
export const localToUsd = (localAmount, conversionRate) => {
  const cr = n(conversionRate),
    loc = n(localAmount);
  return cr > 0 ? loc * cr : 0;
};

/////////////////////////////
// 개인 지표
/////////////////////////////
/**
 * 개별 학생 지표 계산
 * @param {Object} p
 * @param {number} p.cash - 현금 (이미 대출받은 금액 포함)
 * @param {number} p.deposit - 적금 (잠금형)
 * @param {number} p.loan - 대출 부채
 * @param {number} p.usdBalance - USD 현금
 * @param {number} p.stockValueUSD - 주식 평가액 (USD)
 * @param {number} p.conversionRate - 환율 (1 로컬 = conversionRate USD)
 * @param {number} p.liquidityLambda - 유동성 계수 (기본 0.2)
 */
export function calcStudentMetrics({
  cash = 0,
  deposit = 0,
  loan = 0,
  realEstateValue = 0,
  totalNetWorth = 0,
  usdBalance = 0,
  stockValueUSD = 0,
  conversionRate = 0,
  liquidityLambda = 0.2,
} = {}) {
  const CASH = n(cash),
    DEP = n(deposit),
    LOAN = n(loan);
  const USD = n(usdBalance),
    STOCK_USD = n(stockValueUSD);
  const NET_WORTH = n(totalNetWorth);
  const CR = n(conversionRate),
    L = n(liquidityLambda);

  // USD를 로컬 통화로 환산
  const usdLocal = usdToLocal(USD, CR);
  const stockLocal = usdToLocal(STOCK_USD, CR);

  // 통화량 계산 (cash에 이미 대출 포함됨)
  const M0 = CASH + usdLocal; // 즉시 유통 가능 = 현금 + USD현금(환산)
  const M2 = M0 + DEP; // 전체 통화량 = M0 + 적금

  // 학급 화폐 순자산
  const classCurrencyTotal = CASH + DEP - LOAN;

  // 외화 자산
  const foreignTotalUSD = USD + STOCK_USD;
  const foreignTotalLocal = usdLocal + stockLocal;

  // 잠재 유동성 = M2 + (주식 × λ)
  const potentialLiquidity = M2 + L * stockLocal;

  return {
    // 통화량/유동성
    M0,
    M2,
    potentialLiquidity,
    // 자산/환산
    classCurrencyTotal,
    foreignTotalUSD,
    foreignTotalLocal,
    stockUSD: STOCK_USD,
    stockLocal,
    // 순자산
    netWorth: NET_WORTH,
  };
}

/////////////////////////////
// 학급 합계 지표
/////////////////////////////
/**
 * students 배열로 학급 지표 집계
 * students 원소 예:
 *   { assets: { cash, deposit, loan, usdBalance, stockValue?:{rawValueUSD} },
 *     stockUSD?, stockValueUSD? }
 */
export function calcClassAggregates(
  students = [],
  { conversionRate = 0, liquidityLambda = 0.2 } = {}
) {
  let sumCash = 0,
    sumDep = 0,
    sumLoan = 0,
    sumRealEstate = 0,
    sumUsd = 0,
    sumStockUSD = 0,
    sumTotalNetWorth = 0;

  for (const s of students) {
    const a = s?.assets || {};
    sumCash += n(a.cash);
    sumDep += n(a.deposit);
    sumLoan += n(a.loan);
    sumRealEstate += n(a.realEstateValue);
    sumTotalNetWorth += n(a.totalNetWorth);
    sumUsd += n(a.usdBalance);
    const stockUSD =
      n(s?.stockValueUSD) || n(s?.stockUSD) || n(a?.stockValue?.rawValueUSD);
    sumStockUSD += stockUSD;
  }

  const CR = n(conversionRate),
    L = n(liquidityLambda);

  // USD를 로컬 통화로 환산
  const usdCashLocal = usdToLocal(sumUsd, CR);
  const stockLocal = usdToLocal(sumStockUSD, CR);
  const totalForeignLocal = usdCashLocal + stockLocal;

  // 통화량 계산 (cash에 이미 대출 포함됨)
  const M0 = sumCash + usdCashLocal; // 즉시 유통 가능
  const M2 = M0 + sumDep; // 전체 통화량

  // 학급 화폐 순자산
  const classCurrencyTotal = sumCash + sumDep - sumLoan;

  // 전체 순자산
  const totalNetWealth = sumTotalNetWorth;

  // 잠재 유동성
  const potentialLiquidity = M2 + L * stockLocal;

  return {
    // 구성 합계
    sumCash,
    sumDep,
    sumLoan,
    sumRealEstate,
    sumUsdBalanceUSD: sumUsd,
    sumStockUSD,
    // 핵심 지표
    M0,
    M2,
    potentialLiquidity,
    classCurrencyTotal,
    totalNetWealth,
    totalForeignUSD: sumUsd + sumStockUSD,
    totalForeignLocal,
    stockLocal,
    usdCashLocal,
  };
}

/////////////////////////////
// (옵션) CPI & 상점 합계 — Firestore 의존형
/////////////////////////////
/**
 * CPI 계산 (필요할 때만 사용)
 * - econDoc: { cpiBasket: [{itemId, weight}], cpiBasePrices?: { [itemId]: price }, cpiBaseDate?:string }
 * - getItemPrice: (itemId) => Promise<number>
 */
export async function calcCPIFromBasket(econDoc, getItemPrice) {
  const basket = econDoc?.cpiBasket || [];
  const basePrices = econDoc?.cpiBasePrices || null;

  let todaySum = 0,
    baseSum = 0;
  for (const { itemId, weight = 1 } of basket) {
    const p = n(await getItemPrice(itemId));
    todaySum += p * weight;
    const base = basePrices?.[itemId];
    baseSum += n(base != null ? base : p) * weight; // 기준가 없으면 오늘가=기준가
  }
  const CPI = baseSum > 0 ? (todaySum / baseSum) * 100 : 100;
  return { CPI, baseDate: econDoc?.cpiBaseDate || null };
}

/**
 * 상점 거래 합계 계산
 * - txs: [{ amount:number }, ...]
 */
export function summarizeStoreTransactions(txs = []) {
  const count = txs.length;
  const amount = txs.reduce((s, t) => s + n(t?.amount), 0);
  const average = safeDiv(amount, Math.max(1, count));
  return { amount, count, average };
}

/////////////////////////////
// 스냅샷 페이로드 빌더 (프론트/백공용)
/////////////////////////////
/**
 * 한 번에 스냅샷 페이로드 생성
 *   - students: 학생 배열
 *   - options: { conversionRate, liquidityLambda, CPI?, storeVolume? }
 */
export function buildDailySnapshotPayload(
  students,
  {
    conversionRate = 0,
    liquidityLambda = 0.2,
    CPI = null,
    storeVolume = null,
    date = null,
  } = {}
) {
  const agg = calcClassAggregates(students, {
    conversionRate,
    liquidityLambda,
  });
  return {
    date: date || formatDateKeyInKST(new Date()),
    M0: agg.M0,
    M2: agg.M2,
    potentialLiquidity: agg.potentialLiquidity,
    CPI,
    storeVolume,
  };
}
