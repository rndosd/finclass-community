import React from "react";
import {
  Activity,
  CircleDollarSign as FinIcon,
  PieChart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useStockContext } from "../../../../contexts/StockContext";

const SummaryCard = ({
  title,
  icon: IconComponent,
  iconBg,
  value,
  valueColor = "text-slate-800",
  localValue,
  showLocalCurrency,
  profitStyle,
}) => {
  const cardClasses = `relative flex min-h-[120px] items-center overflow-hidden rounded-2xl border p-5 transition-all duration-200 ${
    profitStyle
      ? `${profitStyle.bg} ${profitStyle.border}`
      : "border-slate-200 bg-white shadow-sm"
  }`;

  return (
    <div className={cardClasses}>
      <div className="flex w-full items-center space-x-4">
        <div className={`shrink-0 rounded-xl p-3 ${iconBg}`}>
          <IconComponent className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-tighter text-slate-400">
            {title}
          </p>
          <p
            className={`truncate text-xl font-black ${
              profitStyle ? profitStyle.color : valueColor
            }`}
          >
            {value}
          </p>
          {showLocalCurrency && localValue && (
            <p
              className={`mt-0.5 text-xs font-medium opacity-80 ${
                profitStyle ? profitStyle.color : "text-slate-500"
              }`}
            >
              {localValue}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const PortfolioSummaryCards = ({
  summary,
  showLocalCurrency,
  currencyUnit,
  getProfitStyle,
}) => {
  const { formatClassCurrency, formatFin, formatPercent } = useStockContext();

  const formatFinWithUnit = (value) => `${formatFin(value)} FIN`;
  const formatLocalWithUnit = (value) =>
    `${formatClassCurrency(value)} ${currencyUnit}`;

  const totalProfitStyle = getProfitStyle(summary.totalProfitRate);
  const profitIcon = summary.totalProfitLossUSD >= 0 ? TrendingUp : TrendingDown;
  const profitIconBg = `${totalProfitStyle.bg} ${totalProfitStyle.color
    .replace("text-", "bg-")
    .replace("600", "100")}`;

  const cards = [
    {
      title: "총 투자금",
      icon: FinIcon,
      iconBg: "bg-blue-100 text-blue-600",
      value: formatFinWithUnit(summary.totalInvestedUSD),
      localValue: showLocalCurrency
        ? formatLocalWithUnit(summary.totalInvestedLocal)
        : null,
    },
    {
      title: "현재 평가금액",
      icon: Activity,
      iconBg: "bg-indigo-100 text-indigo-600",
      value: formatFinWithUnit(summary.totalCurrentValueUSD),
      valueColor: "text-indigo-600",
      localValue: showLocalCurrency
        ? formatLocalWithUnit(summary.totalCurrentValueLocal)
        : null,
    },
    {
      title: "누적 평가손익",
      icon: profitIcon,
      iconBg: profitIconBg,
      value: `${summary.totalProfitLossUSD >= 0 ? "+" : ""}${formatFinWithUnit(
        summary.totalProfitLossUSD,
      )}`,
      profitStyle: totalProfitStyle,
      localValue: showLocalCurrency
        ? formatLocalWithUnit(summary.totalProfitLossLocal)
        : null,
    },
    {
      title: "총 수익률",
      icon: PieChart,
      iconBg: profitIconBg,
      value: `${formatPercent(summary.totalProfitRate)}%`,
      profitStyle: totalProfitStyle,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <SummaryCard
          key={card.title}
          {...card}
          showLocalCurrency={showLocalCurrency}
        />
      ))}
    </div>
  );
};

export default PortfolioSummaryCards;
