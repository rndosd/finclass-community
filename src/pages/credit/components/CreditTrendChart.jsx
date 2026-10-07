// src/pages/credit/components/CreditTrendChart.jsx
import React, { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { TrendingUp, Activity, TrendingDown } from "lucide-react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../../../firebase";

const CreditTrendChart = ({
  classId,
  studentUid,
  embedded = false,
  tierMarkers = [],
}) => {
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!classId || !studentUid) return;

    // 🚀 신용 점수 히스토리 경로 (매일 자정에 기록되는 데이터)
    const ref = collection(
      db,
      `classes/${classId}/students/${studentUid}/creditHistory`,
    );
    const q = query(ref, orderBy("date", "desc"), limit(30));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => doc.data());
      // 차트를 위해 날짜 오름차순(과거->현재) 정렬
      data.sort((a, b) => a.date.localeCompare(b.date));
      setHistory(data);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [classId, studentUid]);

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  if (isLoading)
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400">
        로딩 중...
      </div>
    );

  if (history.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400">
        <Activity className="mb-2 opacity-50" />
        <span className="text-xs">아직 기록된 추이가 없습니다.</span>
      </div>
    );
  }

  const scores = history.map((d) => d.score);
  const visibleTierMarkers = tierMarkers.filter(
    (marker) => Number.isFinite(Number(marker?.value)) && Number(marker.value) > 0,
  );
  const chartScores = [
    ...scores,
    ...visibleTierMarkers.map((marker) => Number(marker.value)),
  ];
  const minScore = Math.min(...chartScores);
  const maxScore = Math.max(...chartScores);
  const padding = 50;
  const isDense = history.length > 14;

  return (
    <div
      className={`w-full h-full flex flex-col ${embedded ? "" : "p-4 bg-white rounded-xl border border-slate-200"}`}
    >
      {!embedded && (
        <h4 className="font-bold text-slate-700 mb-4">30일간 신용 변화</h4>
      )}

      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={history}
            margin={{
              top: 10,
              right: embedded ? 4 : 10,
              left: embedded ? -26 : -20,
              bottom: 0,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#f1f5f9"
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: embedded ? 10 : 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              minTickGap={18}
              interval={isDense ? "preserveStartEnd" : 0}
              tickMargin={8}
            />
            <YAxis
              domain={[Math.max(0, minScore - padding), maxScore + padding]}
              tick={{ fontSize: embedded ? 10 : 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "none",
                boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
              }}
              itemStyle={{ color: "#4f46e5", fontWeight: "bold" }}
              labelStyle={{
                color: "#64748b",
                fontSize: "12px",
                marginBottom: "4px",
              }}
              formatter={(value) => [`${value}점`, "신용점수"]}
            />
            {visibleTierMarkers.map((marker) => (
              <ReferenceLine
                key={marker.id || marker.value}
                y={Number(marker.value)}
                stroke={marker.color || "#cbd5e1"}
                strokeDasharray={marker.id === "next-tier" ? "5 4" : "3 3"}
              />
            ))}
            <Line
              type="monotone"
              dataKey="score"
              stroke="#6366f1"
              strokeWidth={embedded ? 2.5 : 3}
              dot={{ r: embedded ? 2.5 : 3, fill: "#6366f1", strokeWidth: 2, stroke: "#fff" }}
              activeDot={{ r: embedded ? 5 : 6, fill: "#6366f1" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 하단 요약 */}
      <div className="mt-4 flex justify-between text-xs text-slate-500 px-2">
        <span className="flex items-center gap-1">
          <TrendingUp size={12} /> 최고: {maxScore}
        </span>
        <span className="flex items-center gap-1">
          <TrendingDown size={12} /> 최저: {minScore}
        </span>
      </div>
    </div>
  );
};

export default CreditTrendChart;
