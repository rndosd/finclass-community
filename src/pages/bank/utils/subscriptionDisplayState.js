import dayjs from "dayjs";

const toDay = (value) => {
  if (!value) return null;
  const date = dayjs(value?.toDate ? value.toDate() : value);
  return date.isValid() ? date : null;
};

export function getSubscriptionDisplayState({ product = {}, participation, now = dayjs() }) {
  product = product || {};
  const start = toDay(product.startDate);
  const end = toDay(product.endDate);
  const next = toDay(participation?.nextPaymentDate);
  const terminated = !!participation?.isTerminated;
  const withdrawn = !!participation?.isWithdrawn;
  const expired = !!end && now.isAfter(end);
  const matured = expired && !!participation && !terminated && !withdrawn;
  let state;
  if (terminated) state = { label: "해지 완료", actionText: "청약 내역에서 해지 결과를 확인하세요.", tone: "slate" };
  else if (withdrawn) state = { label: "수령 완료", actionText: "청약 내역에서 수령 결과를 확인하세요.", tone: "slate" };
  else if (matured) state = { label: "만기", actionText: "만기 금액을 수령하세요.", tone: "amber" };
  else if (expired) state = { label: "모집 마감", actionText: "가입 기간이 끝났습니다. 다른 상품을 확인하세요.", tone: "slate" };
  else if (start && now.isBefore(start) && !now.isSame(start, "day")) state = { label: "시작 예정", actionText: `${start.format("M월 D일")}부터 납입할 수 있어요.`, tone: "slate" };
  else if (product.status === "paused" || product.status === "closed") state = { label: "운영 중단", actionText: "선생님이 운영을 재개하면 납입할 수 있어요.", tone: "slate" };
  else if (next && now.isBefore(next) && !now.isSame(next, "day")) state = { label: "다음 납입 대기", actionText: `${next.format("M월 D일")}부터 납입할 수 있어요.`, tone: "slate", displayNextDate: next };
  else state = { label: participation ? "납입 가능" : "가입 가능", actionText: "지금 납입할 수 있어요.", tone: "blue", canDeposit: true };
  return { canDeposit: false, displayNextDate: null, ...state, isMatured: matured, terminated, isTerminated: terminated,
    warnText: state.label, nextLabel: state.displayNextDate?.format("M월 D일") || "-",
    nextDateLabel: state.displayNextDate?.format("M월 D일") || null };
}
