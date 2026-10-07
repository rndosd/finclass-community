import {
  TRANSACTION_TYPE_EXCHANGE_BIL_TO_USD,
  TRANSACTION_TYPE_EXCHANGE_USD_TO_BIL,
} from "../constants/transactionTypes";

/**
 * 환전 계산만 담당합니다.
 * 화면 표시 포맷은 모달에서 주식 전용 formatter로 처리합니다.
 */
export const calculateExchange = ({
  direction,
  amount,
  conversionRate,
  exchangeFeeRate,
  balanceBIL = 0,
  balanceUSD = 0,
  currencyUnit = "하트",
}) => {
  if (
    !direction ||
    typeof amount !== "number" ||
    Number.isNaN(amount) ||
    amount <= 0 ||
    !conversionRate ||
    conversionRate <= 0
  ) {
    return {
      success: false,
      canExchange: false,
      errorMsg: "환전할 금액을 입력해주세요.",
    };
  }

  const isBilToUsd = direction === TRANSACTION_TYPE_EXCHANGE_BIL_TO_USD;
  const isUsdToBil = direction === TRANSACTION_TYPE_EXCHANGE_USD_TO_BIL;

  if (!isBilToUsd && !isUsdToBil) {
    return {
      success: false,
      canExchange: false,
      errorMsg: "지원하지 않는 환전 방향입니다.",
    };
  }

  const sourceBalance = isBilToUsd ? balanceBIL : balanceUSD;
  const sourceCurrency = isBilToUsd ? currencyUnit : "FIN";
  const targetCurrency = isBilToUsd ? "FIN" : currencyUnit;

  if (amount > sourceBalance) {
    return {
      success: false,
      canExchange: false,
      errorMsg: `${sourceCurrency} 잔액이 부족합니다.`,
    };
  }

  const feeAmount = amount * exchangeFeeRate;
  const netAmountToConvert = amount - feeAmount;
  const finalReceivedAmount = isBilToUsd
    ? netAmountToConvert * conversionRate
    : netAmountToConvert / conversionRate;

  return {
    success: true,
    canExchange: true,
    errorMsg: "",
    inputAmount: amount,
    direction,
    sourceCurrency,
    targetCurrency,
    feeAmount,
    netAmountToConvert,
    finalReceivedAmount,
    conversionRate,
    exchangeFeeRate,
  };
};
