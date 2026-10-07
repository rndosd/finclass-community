import React from "react";
import { formatCreditScore, normalizeCreditScore } from "../utils/tierUtils";

export default function CreditScoreChange({ log }) {
  const before = normalizeCreditScore(log?.previousScore);
  const after = normalizeCreditScore(log?.newScore);
  return (
    <p className="mt-1 text-xs font-medium text-slate-500">
      {before !== null && after !== null
        ? `신용 점수 ${formatCreditScore(before)}점 → ${formatCreditScore(after)}점`
        : "이 기록에는 변경 전후 점수가 저장되지 않았어요."}
    </p>
  );
}
