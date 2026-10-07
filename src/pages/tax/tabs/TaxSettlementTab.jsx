import React, { useState } from "react";
import {
  ArrowRight,
  CalendarCheck2,
  Clock3,
  Landmark,
  ReceiptText,
} from "lucide-react";

import Badge from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import MonthEndSettlementTab from "./MonthEndSettlementTab";
import PeriodIncomeSettlementPanel from "./PeriodIncomeSettlementPanel";

export default function TaxSettlementTab(props) {
  const [activeView, setActiveView] = useState(null);

  const monthLabel = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="space-y-5">
      {!activeView ? (
        <section className="overflow-hidden rounded-3xl border border-indigo-100 bg-white shadow-sm">
          <div className="bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-5 lg:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-black text-indigo-600">{monthLabel}</p>
              <Badge tone="emerald">세금 자동 반영</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">
              설정한 세율대로 세금이 국고에 쌓입니다
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              공제와 누진세를 계산해야 할 때만 월말정산을 실행하세요.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setActiveView("monthEnd")}
                className="flex items-center justify-between gap-4 rounded-2xl border border-indigo-200 bg-white p-4 text-left transition hover:border-indigo-400 hover:shadow-sm"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                    <ReceiptText className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-black text-slate-900">월말정산 시작</span>
                    <span className="mt-1 block text-xs text-slate-500">공제·누진세 계산</span>
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-indigo-500" />
              </button>

              <button
                type="button"
                onClick={() => setActiveView("period")}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 hover:shadow-sm"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <Landmark className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-black text-slate-900">국고 반영 내역</span>
                    <span className="mt-1 block text-xs text-slate-500">날짜별 세금 확인</span>
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveView("history")}
            className="flex w-full items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-left transition hover:bg-slate-50"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <Clock3 className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-black text-slate-900">지난 월말정산</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  완료된 월별 정산 기록을 확인합니다.
                </span>
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        </section>
      ) : null}

      {activeView ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarCheck2 className="h-4 w-4 text-indigo-600" />
              <p className="text-sm font-black text-slate-800">
                {activeView === "period"
                  ? "국고 반영 내역"
                  : activeView === "history"
                    ? "지난 월말정산"
                    : "월말정산"}
              </p>
            </div>
            <Button
              type="button"
              kind="ghost"
              tone="slate"
              size="sm"
              onClick={() => setActiveView(null)}
            >
              간단 화면으로 돌아가기
            </Button>
          </div>

          {activeView === "period" ? (
            <PeriodIncomeSettlementPanel {...props} />
          ) : (
            <MonthEndSettlementTab
              key={activeView}
              {...props}
              initialSubTab={activeView === "history" ? "history" : "run"}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
