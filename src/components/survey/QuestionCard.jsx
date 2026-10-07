// src/components/survey/QuestionCard.jsx
import React from "react";
import {
  PieChart,
  Star,
  TrendingUp,
  MessageSquare,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "../ui";

/* =========================
   🔹 진행률 바 컴포넌트
   ========================= */
function ProgressBar({ value, max, color = "blue" }) {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  const colorClasses = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    purple: "bg-purple-500",
    orange: "bg-orange-500",
  };

  return (
    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
      <div
        className={`h-full ${colorClasses[color]} transition-all duration-500 ease-out`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

/* =========================
   🔹 객관식 뷰
   ========================= */
function MultipleChoiceView({ optionCounts, responseCount, color }) {
  return (
    <div className="space-y-3">
      {Object.entries(optionCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([opt, cnt]) => {
          const pct =
            responseCount > 0 ? ((cnt / responseCount) * 100).toFixed(1) : 0;
          return (
            <div key={opt} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-gray-700">{opt}</span>
                <span className="text-gray-600">
                  {cnt}명 ({pct}%)
                </span>
              </div>
              <ProgressBar value={cnt} max={responseCount} color={color} />
            </div>
          );
        })}
    </div>
  );
}

/* =========================
   🔹 평점 뷰
   ========================= */
function RatingView({ ratingCounts, average, responseCount, color }) {
  return (
    <div className="space-y-3">
      {Object.entries(ratingCounts)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([score, cnt]) => {
          const pct =
            responseCount > 0 ? ((cnt / responseCount) * 100).toFixed(1) : 0;
          return (
            <div key={score} className="space-y-1">
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700">{score}점</span>
                  <div className="flex">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={`w-3 h-3 ${
                          i < Number(score)
                            ? "fill-orange-400 text-orange-400"
                            : "text-gray-300"
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <span className="text-gray-600">
                  {cnt}명 ({pct}%)
                </span>
              </div>
              <ProgressBar value={cnt} max={responseCount} color={color} />
            </div>
          );
        })}
      {average && (
        <div className="mt-4 p-3 bg-orange-100 rounded-lg">
          <div className="text-sm font-semibold text-orange-800">
            평균 평점: {Number(average).toFixed(2)}점
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   🔹 척도 뷰
   ========================= */
function ScaleView({ scaleBuckets, responseCount, color }) {
  return (
    <div className="space-y-3">
      {Object.entries(scaleBuckets).map(([bucket, cnt]) => {
        const pct =
          responseCount > 0 ? ((cnt / responseCount) * 100).toFixed(1) : 0;
        return (
          <div key={bucket} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-medium text-gray-700">{bucket}</span>
              <span className="text-gray-600">
                {cnt}명 ({pct}%)
              </span>
            </div>
            <ProgressBar value={cnt} max={responseCount} color={color} />
          </div>
        );
      })}
    </div>
  );
}

/* =========================
   🔹 주관식 뷰
   ========================= */
function TextView({ sampleCount, topKeywords }) {
  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">총 {sampleCount}개 응답</div>
      {topKeywords && Object.keys(topKeywords).length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 mb-2">
            주요 키워드
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(topKeywords)
              .sort(([, a], [, b]) => b - a)
              .map(([k, v]) => (
                <span
                  key={k}
                  className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium"
                >
                  {k} <span className="text-green-600">({v})</span>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   🔹 질문 카드 메인 컴포넌트
   ========================= */
export default function QuestionCard({
  qid,
  qsum,
  responseCount,
  isExpanded,
  onToggle,
}) {
  const type = qsum.type;

  // 질문 유형별 아이콘
  const getIcon = () => {
    switch (type) {
      case "multiple_choice":
        return <PieChart className="w-5 h-5" />;
      case "rating":
        return <Star className="w-5 h-5" />;
      case "scale":
        return <TrendingUp className="w-5 h-5" />;
      case "text":
        return <MessageSquare className="w-5 h-5" />;
      default:
        return <BarChart3 className="w-5 h-5" />;
    }
  };

  // 질문 유형별 색상
  const getColor = () => {
    switch (type) {
      case "multiple_choice":
        return "blue";
      case "rating":
        return "orange";
      case "scale":
        return "purple";
      case "text":
        return "green";
      default:
        return "gray";
    }
  };

  const color = getColor();

  const bgColors = {
    blue: "bg-blue-50 border-blue-200",
    orange: "bg-orange-50 border-orange-200",
    purple: "bg-purple-50 border-purple-200",
    green: "bg-green-50 border-green-200",
    gray: "bg-gray-50 border-gray-200",
  };

  const textColors = {
    blue: "text-blue-700",
    orange: "text-orange-700",
    purple: "text-purple-700",
    green: "text-green-700",
    gray: "text-gray-700",
  };

  const typeLabels = {
    multiple_choice: "객관식",
    rating: "평점",
    scale: "척도",
    text: "주관식",
  };

  return (
    <div
      className={`border-2 rounded-xl overflow-hidden transition-all ${bgColors[color]}`}
    >
      {/* 카드 헤더 - 클릭하여 확장/축소 */}
      <Button variant="ghost" kind="ghost"
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`${textColors[color]}`}>{getIcon()}</div>
          <div className="text-left">
            <h4 className="font-semibold text-gray-900">
              {qsum.title || "질문"}
            </h4>
            <p className="text-xs text-gray-500 mt-0.5">
              {typeLabels[type] || type}
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500" />
        )}
      </Button>

      {/* 카드 내용 - 확장 시 표시 */}
      {isExpanded && (
        <div className="px-4 pb-4 bg-white/30">
          {/* 객관식 */}
          {type === "multiple_choice" && (
            <MultipleChoiceView
              optionCounts={qsum.optionCounts || {}}
              responseCount={responseCount}
              color={color}
            />
          )}

          {/* 평점 */}
          {type === "rating" && (
            <RatingView
              ratingCounts={qsum.ratingCounts || {}}
              average={qsum.average}
              responseCount={responseCount}
              color={color}
            />
          )}

          {/* 척도 */}
          {type === "scale" && (
            <ScaleView
              scaleBuckets={qsum.scaleBuckets || {}}
              responseCount={responseCount}
              color={color}
            />
          )}

          {/* 주관식 */}
          {type === "text" && (
            <TextView
              sampleCount={qsum.sampleCount || 0}
              topKeywords={qsum.topKeywords}
            />
          )}
        </div>
      )}
    </div>
  );
}
