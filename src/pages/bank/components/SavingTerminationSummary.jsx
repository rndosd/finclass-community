import React from "react";
import { buildSavingTerminationMessage } from "../utils/savingTerminationMessage";

export default function SavingTerminationSummary({ saving, currencyUnit }) {
  return <div className="border-b border-slate-100 bg-rose-50/50 px-4 py-3">
    <p className="text-xs font-bold text-slate-700">중도해지 결과</p>
    <p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-600">{buildSavingTerminationMessage({
      principal: saving.amount,
      payoutAmount: saving.totalPaidAmount,
      interestPaid: saving.actualInterestPaid,
      currencyUnit,
    })}</p>
  </div>;
}
