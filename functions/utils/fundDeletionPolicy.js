"use strict";

const FUND_POSITION_EPSILON = 0.0001;

const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const hasActivePosition = (position = {}) =>
  asNumber(position.units) > FUND_POSITION_EPSILON ||
  asNumber(position.reservedUnits) > FUND_POSITION_EPSILON;

const getFundDeletionBlockReason = ({
  fund = {},
  positions = [],
  orders = [],
} = {}) => {
  if (
    asNumber(fund.unitsOutstanding) > FUND_POSITION_EPSILON ||
    asNumber(fund.investorCount) > 0 ||
    asNumber(fund.aumUSD) > 0.01 ||
    positions.some(hasActivePosition)
  ) {
    return "투자자가 보유 중인 펀드는 삭제할 수 없습니다. 먼저 모든 보유분을 환매해 주세요.";
  }

  if (orders.some((order) => String(order?.status || "").trim() === "submitted")) {
    return "처리 중인 가입·환매 주문이 있어 삭제할 수 없습니다. 주문 처리가 끝난 뒤 다시 시도해 주세요.";
  }

  return null;
};

module.exports = {
  FUND_POSITION_EPSILON,
  getFundDeletionBlockReason,
  hasActivePosition,
};
