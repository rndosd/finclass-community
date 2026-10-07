import { useNumberFormat as useMoneyDisplay } from "../../../../contexts/NumberFormatContext";
import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { X, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { Button, ChartSkeleton, SurfaceLoader } from "../../../../components/ui";
import { db } from "../../../../firebase";

const M0ChartModal = ({ isOpen, onClose, classId, currencyUnit }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const [chartData, setChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !classId) return;

    const fetchData = async () => {
      try {
        setIsLoading(true);
        const historyRef = collection(db, `classes/${classId}/monetaryHistory`);
        const q = query(historyRef, orderBy("date", "desc"), limit(30));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          setChartData([]);
          setIsLoading(false);
          return;
        }

        const history = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const rawValue =
            data.totalClassAssets ?? data.totalWealth ?? data.totalNetWealth;
          history.push({
            date: data.date,
            value: Number(rawValue) || 0,
            hasValue: rawValue !== undefined && rawValue !== null,
          });
        });

        if (!history.some((row) => row.hasValue)) {
          setChartData([]);
          setIsLoading(false);
          setError(null);
          return;
        }

        history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        setChartData(history);
        setIsLoading(false);
        setError(null);
      } catch (err) {
        console.error("Total money chart load failed:", err);
        setError("차트 데이터를 불러오는 중 오류가 발생했습니다.");
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isOpen, classId]);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const CustomTooltip = ({ active, payload, label }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

    if (!active || !payload || !payload.length) return null;
    return (
      <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-lg">
        <p className="text-sm font-medium text-slate-600">
          {new Date(label).toLocaleDateString("ko-KR")}
        </p>
        <p className="text-lg font-bold text-slate-700">
          {formatDisplayMoney(Number(payload[0].value || 0))} {currencyUnit}
        </p>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h3 className="text-xl font-bold text-slate-800">총 통화량(총자산) 추이</h3>
          <Button aria-label="닫기" tone="slate" kind="ghost" size="icon-md"
            onClick={onClose}
            className="transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </Button>
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          <SurfaceLoader
            loading={isLoading}
            skeleton={<ChartSkeleton bare heightClassName="h-96" />}
            minHeightClassName="min-h-[24rem]"
            className="rounded-3xl"
          >
            {error ? (
              <div className="h-96 flex items-center justify-center">
                <div className="text-center text-red-500">
                  <div className="text-4xl mb-4">!</div>
                  <p className="text-sm">{error}</p>
                </div>
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-96 flex items-center justify-center">
                <div className="text-center text-slate-400">
                  <Activity className="h-12 w-12 mx-auto mb-4" />
                  <p className="text-sm font-medium text-slate-600">
                    표시할 히스토리 데이터가 없습니다
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-4 text-sm text-slate-500">
                  최근 {chartData.length}개 기록
                </div>

                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDate}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: "#64748b" }}
                      />
                      <YAxis
                        tickFormatter={(value) => `${Math.floor(value / 1000)}K`}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: "#64748b" }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#64748b"
                        strokeWidth={3}
                        dot={{ fill: "#64748b", strokeWidth: 2, r: 4 }}
                        activeDot={{
                          r: 6,
                          stroke: "#64748b",
                          strokeWidth: 2,
                          fill: "#ffffff",
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {chartData.length > 1 && (
                  <div className="mt-6 flex justify-center gap-8 text-sm text-slate-500">
                    <span className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-slate-400" />
                      <span className="font-medium text-slate-600">최고:</span>
                      <span className="font-bold">
                        {formatDisplayMoney(Math.max(...chartData.map((d) => d.value)))}{" "}
                        {currencyUnit}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-slate-400" />
                      <span className="font-medium text-slate-600">최저:</span>
                      <span className="font-bold">
                        {formatDisplayMoney(Math.min(...chartData.map((d) => d.value)))}{" "}
                        {currencyUnit}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-slate-400" />
                      <span className="font-medium text-slate-600">변화:</span>
                      <span className="font-bold">
                        {chartData[chartData.length - 1].value - chartData[0].value >= 0
                          ? "+"
                          : ""}
                        {formatDisplayMoney(chartData[chartData.length - 1].value - chartData[0].value)}{" "}
                        {currencyUnit}
                      </span>
                    </span>
                  </div>
                )}
              </>
            )}
          </SurfaceLoader>
        </div>
      </div>
    </div>
  );
};

export default M0ChartModal;
