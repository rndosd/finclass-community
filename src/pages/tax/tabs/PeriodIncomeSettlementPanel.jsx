import { useNumberFormat as useConfiguredMoney } from "../../../contexts/NumberFormatContext";
import React, { useCallback, useEffect, useState } from "react";
import { Clock3 } from "lucide-react";

import { Badge, Card, Spinner } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { getTaxPeriodSettlementHistory } from "../services/taxPeriodSettlementService";



const STATUS_META = {
  finalized: { label: "자동 반영 완료", tone: "emerald" },
  consumed: { label: "월말정산 반영", tone: "indigo" },
  preparing: { label: "처리 중", tone: "amber" },
  revising: { label: "재계산 중", tone: "amber" },
  failed: { label: "확인 필요", tone: "rose" },
};

export default function PeriodIncomeSettlementPanel({
  classId,
  currencyUnit = "단위",
}) {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatMoney = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const { showFeedback } = useFeedback();
  const [history, setHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!classId) return;
    setIsLoadingHistory(true);
    const result = await getTaxPeriodSettlementHistory({ classId });
    setIsLoadingHistory(false);
    if (!result.success) {
      showFeedback(result.message, "warning");
      return;
    }
    setHistory(result.rows || []);
  }, [classId, showFeedback]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="space-y-5">
      <Card title="국고 반영 내역" icon={Clock3} variant="surface">
        <Card.Content noPadding>
          {isLoadingHistory ? (
            <div className="flex justify-center py-8">
              <Spinner size="md" />
            </div>
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              아직 국고에 반영된 세금이 없습니다.
            </p>
          ) : (
            <div className="space-y-2">
              {history.map((item) => {
                const meta = STATUS_META[item.status] || {
                  label: item.status || "확인",
                  tone: "slate",
                };
                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 rounded-xl border border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-black text-slate-800">
                          {item.startDateKey === item.endDateKey
                            ? item.startDateKey
                            : `${item.startDateKey} ~ ${item.endDateKey}`}
                        </p>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.detailCount || 0}건 · 국고 반영 완료
                      </p>
                    </div>
                    <p className="text-sm font-black text-slate-900">
                      {formatMoney(item.amount, currencyUnit)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
