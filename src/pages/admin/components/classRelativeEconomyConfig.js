const unique = (values = []) =>
  Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

export const RELATIVE_ECONOMY_PERIOD_OPTIONS = [
  { key: 7, label: "7일" },
  { key: 14, label: "14일" },
  { key: 30, label: "30일" },
];

export const RELATIVE_ECONOMY_SORT_OPTIONS = [
  { key: "attention", label: "코칭 우선" },
  { key: "savings", label: "저축 태도" },
  { key: "mission", label: "과제 성실도" },
  { key: "risk", label: "위험 성향" },
  { key: "assets", label: "자산 위치" },
];

export const RELATIVE_ECONOMY_ACTIVITY_TYPE_MAP = {
  consumptionSpend: unique([
    "store",
    "store_purchase",
    "store_gift",
    "transfer_out",
    "rent_pay",
    "subscription_payment",
  ]),
  consumptionRefund: unique([
    "store_refund",
    "subscription_payment_cancel",
  ]),
  savingsCommit: unique([
    "deposit_join",
    "deposit_started",
    "subscription_payment",
  ]),
  savingsRelease: unique([
    "deposit_return",
    "subscription_withdraw",
  ]),
  savingsReversal: unique([
    "deposit_cancel",
    "deposit_terminate",
    "subscription_payment_cancel",
    "subscription_terminate",
  ]),
  debtBorrow: unique([
    "loan",
    "loan_approve",
  ]),
  debtRepay: unique([
    "loan_repayment",
  ]),
  communityContribution: unique([
    "tax_payment",
    "donation",
  ]),
  rulePenalty: unique([
    "fine",
  ]),
  ruleRelief: unique([
    "fine_refund",
    "reward",
  ]),
  missionSubmit: unique([
    "mission_submit",
  ]),
  missionApproved: unique([
    "mission",
  ]),
  missionRejected: unique([
    "mission_reject",
    "mission_reject_batch",
    "mission_reject_completion_batch",
  ]),
  missionPenalty: unique([
    "mission_penalty",
  ]),
  investmentEntry: unique([
    "stock_buy",
    "fund_subscribe",
    "real_estate",
    "auction_purchase",
    "currency_exchange",
    "exchange_out",
  ]),
  investmentExit: unique([
    "stock_sell",
    "fund_redeem",
    "fund_order_refund",
    "auction_sale",
    "rent_income",
    "dividend",
    "exchange_in",
  ]),
  investmentCost: unique([
    "stock_fee",
    "exchange_fee",
  ]),
  riskSignal: unique([
    "arcade",
    "stock_buy",
    "stock_sell",
    "fund_subscribe",
    "fund_redeem",
    "currency_exchange",
    "exchange_in",
    "exchange_out",
    "loan_approve",
  ]),
};

export const RELATIVE_ECONOMY_CREDIT_SOURCE_MAP = {
  rulePenalty: unique([
    "police_rule",
    "police_fine",
  ]),
  ruleRelief: unique([
    "police_fine_refund",
    "police_reward",
    "police_reward_refund",
    "police_cancel",
  ]),
  mission: unique([
    "mission",
    "mission_token_conversion",
  ]),
  arcade: unique([
    "arcade",
  ]),
};

export const RELATIVE_ECONOMY_AXIS_META = [
  {
    key: "consumptionManagementPercentile",
    label: "소비 관리",
    tone: "rose",
    description: "수입 대비 순소비를 얼마나 안정적으로 관리하는지",
  },
  {
    key: "savingsAttitudePercentile",
    label: "저축 태도",
    tone: "emerald",
    description: "예금과 장기 저축을 꾸준히 유지하는지",
  },
  {
    key: "investmentParticipationPercentile",
    label: "투자 참여",
    tone: "indigo",
    description: "투자 활동과 투자 자산 비중이 어느 정도인지",
  },
  {
    key: "debtManagementPercentile",
    label: "부채 관리",
    tone: "blue",
    description: "대출 부담과 상환 태도를 함께 본 상대 위치",
  },
  {
    key: "ruleCompliancePercentile",
    label: "규칙 준수",
    tone: "amber",
    description: "벌금과 규칙 관련 신용 변동을 바탕으로 본 준수도",
  },
  {
    key: "communityContributionPercentile",
    label: "공동체 기여",
    tone: "teal",
    description: "세금 납부와 기부 참여를 바탕으로 한 기여도",
  },
  {
    key: "missionDiligencePercentile",
    label: "과제 성실도",
    tone: "violet",
    description: "제출, 승인, 반려 패턴으로 본 수행 성실도",
  },
  {
    key: "creditRecoveryPercentile",
    label: "신용 회복",
    tone: "sky",
    description: "최근 신용 변화와 변동성을 함께 본 회복력",
  },
  {
    key: "riskTendencyPercentile",
    label: "위험 성향",
    tone: "orange",
    description: "놀이터, 공격적 거래, 대출 부담이 얼마나 큰지",
  },
];
