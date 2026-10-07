import { normalizeStoreCurrencyType } from "./storeCurrency";
import { isStoreItemVisibleToStudents } from "./storeSaleStatus";

export const PRICE_BAND_META = {
  noBaseline: {
    id: "noBaseline",
    label: "기준 없음",
    toneClassName: "border-slate-200 bg-slate-50 text-slate-500",
    description: "직업 주급 기준값이 아직 없습니다.",
  },
  low: {
    id: "low",
    label: "저가",
    toneClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    description: "1주 이내에 살 수 있는 상품입니다.",
  },
  mid: {
    id: "mid",
    label: "중가",
    toneClassName: "border-sky-200 bg-sky-50 text-sky-700",
    description: "2~3주 정도 모으면 살 수 있는 상품입니다.",
  },
  stretch: {
    id: "stretch",
    label: "높은 편",
    toneClassName: "border-amber-200 bg-amber-50 text-amber-700",
    description: "3주를 넘기지만 목표 상품보다는 낮은 가격입니다.",
  },
  target: {
    id: "target",
    label: "목표",
    toneClassName: "border-violet-200 bg-violet-50 text-violet-700",
    description: "4주 이상 모아야 살 수 있는 목표 상품입니다.",
  },
};

const toPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export const getBaselineWeeklySalary = (economyBaseline = {}) =>
  toPositiveNumber(
    economyBaseline.baselineWeeklySalary ||
      economyBaseline.medianWeeklySalary ||
      economyBaseline.averageWeeklySalary,
  );

export const getStorePriceBand = (price, economyBaseline = {}) => {
  const baselineWeeklySalary = getBaselineWeeklySalary(economyBaseline);
  const normalizedPrice = toPositiveNumber(price);

  if (!baselineWeeklySalary || !normalizedPrice) {
    return {
      ...PRICE_BAND_META.noBaseline,
      price: normalizedPrice,
      baselineWeeklySalary,
      weeks: null,
    };
  }

  const weeks = normalizedPrice / baselineWeeklySalary;
  let meta = PRICE_BAND_META.target;
  if (weeks <= 1) {
    meta = PRICE_BAND_META.low;
  } else if (weeks <= 3) {
    meta = PRICE_BAND_META.mid;
  } else if (weeks < 4) {
    meta = PRICE_BAND_META.stretch;
  }

  return {
    ...meta,
    price: normalizedPrice,
    baselineWeeklySalary,
    weeks,
  };
};

export const formatPriceWeeks = (weeks) => {
  if (!Number.isFinite(Number(weeks))) return "-";
  const normalizedWeeks = Number(weeks);
  if (normalizedWeeks < 10) return `${normalizedWeeks.toFixed(1)}주`;
  return `${Math.round(normalizedWeeks).toLocaleString("ko-KR")}주`;
};

export const buildStorePriceGuidance = ({
  items = [],
  economyBaseline = {},
} = {}) => {
  const baselineWeeklySalary = getBaselineWeeklySalary(economyBaseline);
  const cashItems = items
    .filter((item) => isStoreItemVisibleToStudents(item))
    .filter((item) => normalizeStoreCurrencyType(item?.currencyType) === "cash")
    .map((item) => {
      const price = toPositiveNumber(item.effectivePrice ?? item.price);
      return {
        ...item,
        guidance: getStorePriceBand(price, economyBaseline),
      };
    })
    .filter((item) => item.guidance.price > 0);

  const counts = cashItems.reduce(
    (acc, item) => {
      acc[item.guidance.id] = (acc[item.guidance.id] || 0) + 1;
      return acc;
    },
    {
      low: 0,
      mid: 0,
      stretch: 0,
      target: 0,
    },
  );

  const sortedByPrice = [...cashItems].sort(
    (left, right) => left.guidance.price - right.guidance.price,
  );
  const recommendations = [];

  if (!baselineWeeklySalary) {
    recommendations.push("직업 주급 기준값이 만들어지면 가격대를 자동으로 계산합니다.");
  } else if (cashItems.length === 0) {
    recommendations.push("기본 화폐로 판매하는 상품을 1개 이상 등록해 가격대를 확인하세요.");
  } else {
    if (counts.low === 0) {
      recommendations.push("1주 이내에 살 수 있는 저가 상품을 1개 추가해 초반 참여감을 만들 수 있습니다.");
    }
    if (counts.mid === 0) {
      recommendations.push("2~3주 모아 살 수 있는 중가 상품을 1개 두면 저축 목표가 생깁니다.");
    }
    if (counts.target === 0) {
      recommendations.push("4주 이상 모아야 하는 목표 상품을 1개 두면 장기 동기가 생깁니다.");
    }
    if (recommendations.length === 0) {
      recommendations.push("저가, 중가, 목표 상품이 모두 있어 기본 가격 구조가 잡혀 있습니다.");
    }
  }

  return {
    baselineWeeklySalary,
    itemCount: cashItems.length,
    counts,
    cheapestItems: sortedByPrice.slice(0, 3),
    targetItems: cashItems
      .filter((item) => item.guidance.id === "target")
      .sort((left, right) => right.guidance.price - left.guidance.price)
      .slice(0, 3),
    recommendations,
  };
};
