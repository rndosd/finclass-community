export const getPortfolioProfitStyle = (rate) => {
  if (rate > 5) {
    return {
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
    };
  }
  if (rate > 0) {
    return {
      color: "text-green-600",
      bg: "bg-green-50",
      border: "border-green-200",
    };
  }
  if (rate < -5) {
    return {
      color: "text-red-600",
      bg: "bg-red-50",
      border: "border-red-200",
    };
  }
  if (rate < 0) {
    return {
      color: "text-orange-600",
      bg: "bg-orange-50",
      border: "border-orange-200",
    };
  }
  return {
    color: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
  };
};
