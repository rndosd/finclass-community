import React from "react";

// 🎨 모던 파스텔 톤 토큰 (배경색 위주가 아닌, 텍스트/링 위주로 개편)
const TONES = {
  white: {
    bg: "bg-white",
    ring: "ring-slate-100/50", // 아주 연한 테두리
    shadow: "shadow-slate-200/40", // 맑은 회색 그림자
    accent: "text-slate-800",
  },
  slate: {
    bg: "bg-slate-50",
    ring: "ring-slate-200",
    shadow: "shadow-slate-300/30",
    accent: "text-slate-900",
  },
  blue: {
    // lightBlue 대체
    bg: "bg-blue-50/30", // 아주 연한 블루 틴트
    ring: "ring-blue-100/50",
    shadow: "shadow-blue-200/30", // 푸른빛 그림자
    accent: "text-blue-900",
  },
  // 필요시 추가...
};

function CardBase({
  children,
  className = "",
  style,
  title = "",
  icon: Icon = null,
  iconBackground = true,
  iconColor = "bg-blue-500",
  iconStyle = "soft",
  iconSize = "md",
  titleColor, // deprecated
  noPadding = false,
  noBorder = false, // 이제 기본이 borderless이므로 큰 의미 없음 (하위호환용)
  noShadow = false,
  onClick,
  variant = "surface", // 'elevated' (기본) | 'flat' | 'outline'
  tone = "white", // 기본값을 white로 고정
  density = "comfortable",
  hoverable = false,
  rounded = "2xl", // ⭐️ 기본을 3xl로 변경 (더 둥글게)
  headerBar = false,
}) {
  const t = TONES[tone] ?? TONES.white;
  const safeTitle =
    typeof title === "string" ? title : title?.tierFullName ?? "";

  // 1. Spacing Logic
  const pad = noPadding
    ? ""
    : density === "compact"
    ? "p-4"
    : density === "comfortable"
    ? "p-4 sm:p-6" // 넉넉한 여백
    : "p-5 sm:p-6";

  const radius =
    rounded === "lg"
      ? "rounded-lg"
      : rounded === "xl"
      ? "rounded-xl"
      : rounded === "2xl"
      ? "rounded-2xl"
      : "rounded-3xl";

  // 2. Variants Logic (핵심 변경)
  let variantClass = "";

  if (variant === "surface") {
    variantClass = `${t.bg} ${noBorder ? "" : "ring-1 ring-slate-200"}`;
  } else if (variant === "elevated") {
    // ⭐️ 모던 스타일: Border 대신 Ring 사용, 진한 그림자 대신 연한 유색 그림자
    variantClass = `${t.bg} ${noShadow ? "" : `shadow-xl ${t.shadow}`} ring-1 ${
      t.ring
    }`;
  } else if (variant === "flat") {
    // 배경만 있고 그림자 없음
    variantClass = `${t.bg} ring-1 ring-transparent`;
  } else if (variant === "outline") {
    variantClass = "bg-transparent ring-1 ring-slate-200";
  } else if (variant === "glass") {
    variantClass =
      "bg-white/70 backdrop-blur-xl shadow-lg shadow-slate-200/20 ring-1 ring-white/50";
  }

  // 3. Hover Logic
  // 카드 전체가 살짝 떠오르는 느낌
  const hoverClass =
    hoverable && !onClick
      ? "transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-slate-200/50"
      : "";

  // 4. Interactivity
  const interactivity = onClick
    ? "cursor-pointer transition-all duration-200 active:scale-[0.98] hover:shadow-md"
    : "";

  const titleTone = titleColor ?? t.accent;

  // Icon Rendering Helper
  const renderIcon = () => {
    if (!Icon) return null;
    const sizeMap = {
      sm: "w-6 h-6 p-1",
      md: "w-8 h-8 p-1.5",
      lg: "w-10 h-10 p-2",
    };
    const iconSizeClass = sizeMap[iconSize] || sizeMap.md;

    if (!iconBackground) return <Icon className={`w-5 h-5 ${titleTone}`} />;

    // 아이콘 스타일 (Soft 기본)
    let styleClass = "bg-slate-100 text-slate-600 rounded-2xl"; // 기본값

    if (iconStyle === "circle") {
      styleClass = `${iconColor} text-white rounded-full`;
    } else if (iconStyle === "soft") {
      // iconColor prop이 'bg-blue-500' 식으로 들어올 때 처리 (간이)
      if (iconColor.includes("blue"))
        styleClass = "bg-blue-50 text-blue-600 rounded-2xl";
      else if (iconColor.includes("rose"))
        styleClass = "bg-rose-50 text-rose-600 rounded-2xl";
      else if (iconColor.includes("emerald"))
        styleClass = "bg-emerald-50 text-emerald-600 rounded-2xl";
    }

    return (
      <div
        className={`${iconSizeClass} flex items-center justify-center ${styleClass} mr-3`}
      >
        <Icon className="w-full h-full" />
      </div>
    );
  };

  return (
    <div
      onClick={onClick}
      style={style}
      className={[
        "relative flex flex-col overflow-hidden", // 배경 장식 잘림 방지
        pad,
        radius,
        variantClass,
        hoverClass,
        interactivity,
        className,
      ].join(" ")}
    >
      {/* Header Bar (Deprecated but kept for compatibility) */}
      {headerBar && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 to-indigo-500 opacity-80" />
      )}

      {/* Title Area */}
      {safeTitle && (
        <div className="flex items-center mb-4 z-10 relative">
          {renderIcon()}
          <h2 className={`text-base font-bold tracking-tight ${titleTone}`}>
            {safeTitle}
          </h2>
        </div>
      )}

      {/* Children */}
      <div className="flex-grow flex flex-col z-10 relative h-full">
        {children}
      </div>
    </div>
  );
}

// ──────── Subcomponents (심플하게 변경) ────────

const CardHeader = ({ children, align = "between", className = "" }) => {
  const justify = {
    start: "justify-start",
    center: "justify-center",
    end: "justify-end",
    between: "justify-between",
  }[align];
  return (
    <div className={`flex items-center ${justify} mb-4 ${className}`}>
      {children}
    </div>
  );
};

const CardTitle = ({ children, className = "" }) => (
  <h3
    className={`text-base font-bold text-slate-800 tracking-tight ${className}`}
  >
    {children}
  </h3>
);

const CardDescription = ({ children, className = "" }) => (
  <p className={`text-sm text-slate-600 mt-0.5 ${className}`}>{children}</p>
);

const CardContent = ({
  children,
  noPadding = false,
  density = "cozy",
  className = "",
}) => {
  const pad = noPadding
    ? ""
    : density === "compact"
    ? "p-3"
    : density === "comfortable"
    ? "p-5"
    : "p-4";

  // flex-col이 기본이지만 className으로 덮어쓰기 가능
  return (
    <div className={`flex-grow flex flex-col ${pad} ${className}`}>
      {children}
    </div>
  );
};

const CardFooter = ({ children, align = "end", className = "" }) => {
  const justify =
    {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    }[align] || "justify-end";

  // ⭐️ 중요: border-t 제거! (모던한 플로팅 버튼 느낌을 위해)
  return (
    <div className={`mt-auto pt-2 flex ${justify} gap-2 ${className}`}>
      {children}
    </div>
  );
};

const Card = Object.assign(CardBase, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Content: CardContent,
  Footer: CardFooter,
});

export default Card;
