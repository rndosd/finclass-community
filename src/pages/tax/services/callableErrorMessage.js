const GENERIC_MESSAGES = new Set(["internal", "unknown"]);
const MESSAGE_OVERRIDES = new Map([
  [
    "no finalized period income settlements are ready.",
    "자동 국고 집계가 완료된 세금이 없습니다. 전날까지의 원천징수 기록을 확인해 주세요.",
  ],
  [
    "this period is already consumed by month-end settlement.",
    "이미 월말정산에 반영된 기간입니다.",
  ],
]);

export const getCallableErrorMessage = (error, fallbackMessage) => {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").trim();
  const normalizedMessage = message.toLowerCase();

  if (MESSAGE_OVERRIDES.has(normalizedMessage)) {
    return MESSAGE_OVERRIDES.get(normalizedMessage);
  }

  if (
    !message ||
    code.endsWith("/internal") ||
    code.endsWith("/unknown") ||
    GENERIC_MESSAGES.has(normalizedMessage)
  ) {
    return fallbackMessage;
  }

  return message;
};
