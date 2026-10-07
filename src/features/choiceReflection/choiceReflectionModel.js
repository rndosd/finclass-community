export const CHOICE_REFLECTION_VERSION = 2;
export const CHOICE_NOTE_MAX_LENGTH = 200;

// Keep historical reason IDs and labels below; only the new prompt is shorter.
export const CHOICE_PROMPT_REASONS = {
  store_purchase: [["need", "필요해서"], ["enjoyment", "갖고 싶어서"], ["price", "가격을 보고"], ["unsure", "잘 모르겠어"]],
  store_cart: [["need", "필요해서"], ["enjoyment", "갖고 싶어서"], ["price", "가격을 보고"], ["unsure", "잘 모르겠어"]],
  stock_buy: [["information", "종목 정보를 보고"], ["price", "가격을 보고"], ["plan", "내 투자 계획에 따라"], ["unsure", "잘 모르겠어"]],
  stock_sell: [["plan", "내 투자 계획에 따라"], ["use_money", "돈이 필요해서"], ["price", "가격이 변해서"], ["unsure", "잘 모르겠어"]],
};

const STORE_REASONS = [
  ["need", "필요해서"],
  ["enjoyment", "즐거움을 위해"],
  ["price", "가격이나 할인을 보고"],
  ["recommendation", "추천을 받아서"],
  ["other", "다른 이유가 있어서"],
  ["unsure", "아직 잘 모르겠어"],
];

export const CHOICE_QUESTIONS = {
  store_purchase: {
    domain: "store", actionLabel: "구매",
    question: "이번 구매에서 가장 크게 생각한 것은?",
    reasons: STORE_REASONS,
  },
  store_cart: {
    domain: "store", actionLabel: "장바구니 구매",
    question: "이번 장바구니 구매에서 가장 크게 생각한 것은?",
    reasons: STORE_REASONS,
  },
  stock_buy: {
    domain: "stock", actionLabel: "매수",
    question: "이번 매수를 결정한 가장 큰 이유는?",
    reasons: [
      ["information", "회사나 투자 상품 정보를 보고"],
      ["price", "가격이나 차트를 보고"],
      ["plan", "내가 정한 투자 계획에 따라"],
      ["recommendation", "추천을 받아서"],
      ["other", "다른 이유가 있어서"],
      ["unsure", "아직 잘 모르겠어"],
    ],
  },
  stock_sell: {
    domain: "stock", actionLabel: "매도",
    question: "이번 매도를 결정한 가장 큰 이유는?",
    reasons: [
      ["plan", "내가 정한 투자 계획에 따라"],
      ["use_money", "다른 곳에 돈을 쓰려고"],
      ["price", "가격이 변해서"],
      ["allocation", "투자 구성을 바꾸려고"],
      ["other", "다른 이유가 있어서"],
      ["unsure", "아직 잘 모르겠어"],
    ],
  },
};

export const CHOICE_REVIEW_OPTIONS = [
  ["same", "같은 선택을 할래"],
  ["amount", "금액이나 수량을 바꿀래"],
  ["different", "다른 선택을 할래"],
  ["unsure", "아직 잘 모르겠어"],
];

export function buildChoiceEntry({ sourceType, sourceId, label }) {
  if (!CHOICE_QUESTIONS[sourceType] || typeof sourceId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,180}$/.test(sourceId)) return null;
  return {
    id: `${sourceType}_${sourceId}`,
    sourceType, sourceId,
    label: String(label || CHOICE_QUESTIONS[sourceType].actionLabel).slice(0, 120),
    questionVersion: CHOICE_REFLECTION_VERSION,
    createdAtMs: Date.now(), reason: null, review: null,
  };
}

export function getChoiceReasonLabel(entry) {
  if (entry.questionVersion >= 2) {
    const label = CHOICE_PROMPT_REASONS[entry.sourceType]?.find(([id]) => id === entry.reason)?.[1];
    if (label) return label;
  }
  return CHOICE_QUESTIONS[entry.sourceType]?.reasons.find(([id]) => id === entry.reason)?.[1] || "이유를 아직 남기지 않았어요";
}

export function getChoiceReviewLabel(entry) {
  return CHOICE_REVIEW_OPTIONS.find(([id]) => id === entry.review)?.[1] || "";
}

export function getChoiceFeedback(entry) {
  if (entry.sourceType.startsWith("store")) {
    return "나중에 사용해 본 경험과 지금 고른 이유를 함께 돌아볼 수 있어요.";
  }
  return "가격이 오르거나 내린 결과와 함께, 선택할 때 참고한 정보와 계획도 돌아볼 수 있어요.";
}
