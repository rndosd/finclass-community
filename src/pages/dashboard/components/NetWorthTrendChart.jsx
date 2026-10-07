import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
// src/pages/dashboard/components/NetWorthTrendChart.jsx
import React, { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, Activity, TrendingDown } from "lucide-react";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import Spinner from "../../../components/ui/Spinner";

const NetWorthTrendChart = ({
  currencyUnit,
  embedded = false,
  studentUid,
}) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

  const { classId, userData } = useUser();
  const [assetHistory, setAssetHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 640 : false,
  );
  const resolvedStudentUid = studentUid || userData?.uid;

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setIsMobile(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!classId || !resolvedStudentUid) {
      setAssetHistory([]);
      setIsLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const loadAssetHistory = async () => {
      try {
        const assetHistoryRef = collection(
          db,
          "classes",
          classId,
          "students",
          resolvedStudentUid,
          "assetHistory",
        );
        const q = query(assetHistoryRef, orderBy("date", "desc"), limit(30));

        const snapshot = await getDocs(q);
        if (cancelled) return;
        if (snapshot.empty) {
          setAssetHistory([]);
          setIsLoading(false);
          return;
        }
        const history = [];
        snapshot.forEach((doc) => {
          const d = doc.data();
          history.push({
            date: d.date,
            netWorth: d.netWorth || 0,
            timestamp: d.timestamp,
          });
        });
        history.sort((a, b) => a.date.localeCompare(b.date)); // 오래된 순
        setAssetHistory(history);
        setIsLoading(false);
        setError(null);
      } catch {
        if (cancelled) return;
        setError("자산 히스토리를 불러오는 중 오류가 발생했습니다.");
        setIsLoading(false);
      }
    };

    void loadAssetHistory();

    return () => {
      cancelled = true;
    };
  }, [classId, resolvedStudentUid]);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${date.getMonth() + 1}/${date.getDate()}(${days[date.getDay()]})`;
  };

  const formatCompactDate = (dateString) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const CustomTooltip = ({ active, payload, label }) => {
  const { formatClassCurrency: formatDisplayMoney } = useMoneyDisplay();

    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-2 sm:p-3 border border-slate-200 rounded-lg shadow-lg">
          <p className="text-xs sm:text-sm font-medium text-slate-600">
            {new Date(label).toLocaleDateString("ko-KR")}
          </p>
          <p className="text-sm sm:text-lg font-bold text-indigo-600">
            {formatDisplayMoney(payload[0].value)} {currencyUnit}
          </p>
        </div>
      );
    }
    return null;
  };

  const wrapperBase = embedded ? (isMobile ? "h-[250px]" : "h-80") : "h-80";
  const wrapperClass = embedded
    ? wrapperBase
    : `bg-white rounded-xl p-6 border border-slate-200 shadow-sm ${wrapperBase}`;

  if (isLoading) {
    return (
      <div className={wrapperClass}>
        <h4 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-500" /> 순자산 변화 (30일)
        </h4>
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <Spinner tone="indigo" />
            <p className="text-sm text-slate-500">
              자산 히스토리를 불러오는 중...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={wrapperClass}>
        <h4 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-500" /> 순자산 변화 (30일)
        </h4>
        <div className="h-full flex items-center justify-center">
          <div className="text-center text-red-500">
            <div className="text-4xl mb-4">⚠️</div>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (assetHistory.length === 0) {
    return (
      <div className={wrapperClass}>
        <h4 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-500" />
          순자산 변화 (30일)
        </h4>
        <div className="h-full flex items-center justify-center">
          <div className="text-center text-slate-400">
            <Activity className="h-10 w-10 text-slate-400 mb-4" />
            <p className="text-sm font-medium text-slate-600">
              자산 기록이 없습니다
            </p>
            <p className="text-xs mt-2 text-slate-500">
              매일 자정에 자산 데이터가 수집됩니다
            </p>
            <div className="mt-4 px-4 py-2 bg-slate-100 rounded-full text-xs text-slate-500">
              첫 번째 기록은 내일부터 확인 가능합니다
            </div>
          </div>
        </div>
      </div>
    );
  }

  const values = assetHistory.map((i) => i.netWorth);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max((maxValue - minValue) * 0.1, 1000);
  const chartMargin = isMobile
    ? { top: 4, right: 8, left: -10, bottom: 2 }
    : { top: 5, right: 30, left: 20, bottom: 5 };
  const xAxisTickInterval = isMobile
    ? Math.max(0, Math.floor(assetHistory.length / 6))
    : "preserveStartEnd";

  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between mb-3 sm:mb-4 gap-2">
        <h4 className="text-sm sm:text-base font-semibold text-slate-700 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-500" /> 순자산 변화 (30일)
        </h4>
        <div className="text-[11px] sm:text-xs text-slate-500 whitespace-nowrap">
          {assetHistory.length}일간의 기록
        </div>
      </div>

      <div className="h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={assetHistory}
            margin={chartMargin}
          >
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis
              dataKey="date"
              tickFormatter={isMobile ? formatCompactDate : formatDate}
              axisLine={false}
              tickLine={false}
              interval={xAxisTickInterval}
              minTickGap={isMobile ? 6 : 18}
              tick={{ fontSize: isMobile ? 10 : 12, fill: "#64748b" }}
            />
            <YAxis
              domain={[minValue - padding, maxValue + padding]}
              tickFormatter={(value) => `${Math.floor(value / 1000)}K`}
              axisLine={false}
              tickLine={false}
              width={isMobile ? 34 : 44}
              tick={{ fontSize: isMobile ? 10 : 12, fill: "#64748b" }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="netWorth"
              stroke="#4f46e5"
              strokeWidth={3}
              dot={{ fill: "#4f46e5", strokeWidth: 2, r: 4 }}
              activeDot={{
                r: 6,
                stroke: "#4f46e5",
                strokeWidth: 2,
                fill: "#ffffff",
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 하단 통계: 이모지 + 등폭 숫자 + 줄바꿈 방지 */}
      {assetHistory.length > 1 && (
        <div className="mt-3 sm:mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 sm:gap-8 text-[11px] sm:text-xs text-slate-500">
          <span className="flex items-center gap-1 whitespace-nowrap">
            <TrendingUp className="h-3 w-3 text-slate-400" />
            <span className="font-medium text-slate-600">최고:</span>
            {formatDisplayMoney(Math.max(...values))} {currencyUnit}
          </span>

          <span className="flex items-center gap-1 whitespace-nowrap">
            <TrendingDown className="h-3 w-3 text-slate-400" />
            <span className="font-medium text-slate-600">최저:</span>
            {formatDisplayMoney(Math.min(...values))} {currencyUnit}
          </span>

          <span className="flex items-center gap-1 whitespace-nowrap">
            <Activity className="h-3 w-3 text-slate-400" />
            <span className="font-medium text-slate-600">변화:</span>
            {values[values.length - 1] - values[0] >= 0 ? "+" : ""}
            {formatDisplayMoney(values[values.length - 1] - values[0])}{" "}
            {currencyUnit}
          </span>
        </div>
      )}
    </div>
  );
};

export default NetWorthTrendChart;
