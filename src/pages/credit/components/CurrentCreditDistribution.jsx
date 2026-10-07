import React, { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildCurrentCreditDistribution } from "../utils/creditDistribution";

export default function CurrentCreditDistribution({ students = [], tierCriteria = [] }) {
  const rows = useMemo(() => buildCurrentCreditDistribution(students, tierCriteria), [students, tierCriteria]);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-bold text-slate-800">현재 학급 등급 분포</h3>
      <p className="mt-1 text-xs text-slate-500">현재 학생 점수와 학급 등급 기준으로 표시합니다. 위에서 선택한 기간의 과거 통계와는 구분됩니다.</p>
      {rows.length ? <>
        <ul className="sr-only">{rows.map((row) => <li key={row.band}>{row.label}: {row.count}명</li>)}</ul>
        <div className="mt-4" style={{ height: Math.max(240, rows.length * 32) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="학생 수" fill="#14b8a6" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </> : <p className="mt-4 text-sm text-slate-500">학급 등급 기준을 설정하면 분포가 표시됩니다.</p>}
    </section>
  );
}
