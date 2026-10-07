// src/pages/stock/services/stockService.js
// Cloud Functions(v2, region: asia-northeast3) 호출 래퍼
// - 환전: getExchangeQuote / performExchange
// - 주식: getStockBuyQuote / performStockBuy / getStockSellQuote / performStockSell

import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(undefined, "asia-northeast3");

// ===== Callable 핸들러들 =====
const _getExchangeQuote = httpsCallable(functions, "getExchangeQuote");
const _performExchange = httpsCallable(functions, "performExchange");

const _getStockBuyQuote = httpsCallable(functions, "getStockBuyQuote");
const _performStockBuy = httpsCallable(functions, "performStockBuy");
const _getStockSellQuote = httpsCallable(functions, "getStockSellQuote");
const _performStockSell = httpsCallable(functions, "performStockSell");

// ===== 공통 에러 핸들링 =====
const toFail = (err, fallbackMsg) => {
  // Firebase CallableError 에는 code/message가 들어있음
  const msg =
    err?.message ||
    err?.data?.message ||
    err?.customData?.message ||
    fallbackMsg ||
    "요청 처리 중 오류가 발생했습니다.";
  return { success: false, message: msg, code: err?.code, details: err?.details };
};

// ===== 환전 =====
/**
 * 환전 견적
 * @param {string} classId
 * @param {"EXCHANGE_BIL_TO_USD"|"EXCHANGE_USD_TO_BIL"} direction
 * @param {number} amount
 */
export const getExchangeQuote = async (classId, direction, amount) => {
  try {
    const res = await _getExchangeQuote({ classId, direction, amount });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[getExchangeQuote] Error:", err);
    return toFail(err, "환전 견적 조회 중 오류가 발생했습니다.");
  }
};

/**
 * 환전 실행
 * @param {string} classId
 * @param {"EXCHANGE_BIL_TO_USD"|"EXCHANGE_USD_TO_BIL"} direction
 * @param {number} amount
 */
export const performExchange = async (classId, direction, amount, clientRequestId) => {
  try {
    const res = await _performExchange({ classId, direction, amount, ...(clientRequestId ? { clientRequestId } : {}) });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[performExchange] Error:", err);
    return toFail(err, "환전 실행 중 오류가 발생했습니다.");
  }
};

// ===== 주식 매수 =====
/**
 * 매수 견적
 * @param {string} classId
 * @param {string} symbol
 * @param {number} priceUSD
 * @param {number} quantity
 */
export const getStockBuyQuote = async (classId, symbol, priceUSD, quantity) => {
  try {
    const res = await _getStockBuyQuote({
      classId,
      symbol,
      priceUSD,
      quantity,
    });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[getStockBuyQuote] Error:", err);
    return toFail(err, "매수 견적 조회 중 오류가 발생했습니다.");
  }
};

/**
 * 매수 실행
 * @param {string} classId
 * @param {string} symbol
 * @param {number} priceUSD
 * @param {number} quantity
 */
export const performStockBuy = async (
  classId,
  symbol,
  priceUSD,
  quantity,
  classFundId = "",
  clientRequestId,
) => {
  try {
    const res = await _performStockBuy({
      classId,
      symbol,
      priceUSD,
      quantity,
      classFundId,
      ...(clientRequestId ? { clientRequestId } : {}),
    });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[performStockBuy] Error:", err);
    return toFail(err, "매수 실행 중 오류가 발생했습니다.");
  }
};

// ===== 주식 매도 =====
/**
 * 매도 견적
 * @param {string} classId
 * @param {string} symbol
 * @param {number} priceUSD
 * @param {number} quantity
 */
export const getStockSellQuote = async (
  classId,
  symbol,
  priceUSD,
  quantity,
) => {
  try {
    const res = await _getStockSellQuote({
      classId,
      symbol,
      priceUSD,
      quantity,
    });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[getStockSellQuote] Error:", err);
    return toFail(err, "매도 견적 조회 중 오류가 발생했습니다.");
  }
};

/**
 * 매도 실행
 * @param {string} classId
 * @param {string} symbol
 * @param {number} priceUSD
 * @param {number} quantity
 */
export const performStockSell = async (
  classId,
  symbol,
  priceUSD,
  quantity,
  studentUid = null,
  classFundId = "",
  clientRequestId,
) => {
  try {
    // 백엔드에 보낼 데이터 객체에 studentUid를 포함시킵니다.
    const res = await _performStockSell({
      classId,
      symbol,
      priceUSD,
      quantity,
      studentUid, // 👈 추가된 부분
      classFundId,
      ...(clientRequestId ? { clientRequestId } : {}),
    });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[performStockSell] Error:", err);
    return toFail(err, "매도 실행 중 오류가 발생했습니다.");
  }
};

export const executeExchange = performExchange;
export const executeBuyStock = performStockBuy;
export const executeSellStock = performStockSell;
