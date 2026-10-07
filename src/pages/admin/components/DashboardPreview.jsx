import React, { useMemo } from "react";
import {
  Newspaper,
  WalletCards,
  Target,
  Gauge,
  HandHeart,
} from "lucide-react";
import { getDashboardCardLayout } from "../../dashboard/dashboardCardLayout";

const PREVIEW_CARD_INFO = {
  news: {
    title: "학급 뉴스",
    Icon: Newspaper,
    iconClassName: "bg-sky-50 text-sky-600",
    surfaceClassName: "bg-[#eef5ff]",
    compactSurfaceClassName: "bg-[#eef5ff]",
    valueClassName: "text-sky-700",
    value: "학급 소식 2개",
    supporting: "새 소식 2개",
    actions: [],
  },
  asset: {
    title: "내 자산",
    Icon: WalletCards,
    iconClassName: "bg-blue-50 text-blue-600",
    surfaceClassName: "bg-[#edf4ff]",
    compactSurfaceClassName: "bg-[#edf4ff]",
    valueClassName: "text-blue-700",
    value: "13,287 골드",
    supporting: "현금 · 예금 · 대출",
    actions: ["내 자산 보기"],
  },
  mission: {
    title: "오늘의 과제",
    Icon: Target,
    iconClassName: "bg-emerald-50 text-emerald-600",
    surfaceClassName: "bg-[#eef7f8]",
    compactSurfaceClassName: "bg-[#eef7f8]",
    valueClassName: "text-emerald-700",
    value: "신청서 제출하기",
    supporting: "오늘 안에 완료해요",
    actions: ["과제 보러 가기"],
  },
  credit: {
    title: "신용 점수",
    Icon: Gauge,
    iconClassName: "bg-amber-50 text-amber-600",
    surfaceClassName: "bg-[#f0f1fc]",
    compactSurfaceClassName: "bg-[#f0f1fc]",
    valueClassName: "text-amber-700",
    value: "697점 · 7등급",
    supporting: "다음 등급까지 53점",
    actions: ["내 신용 보기"],
  },
  donation: {
    title: "기부 프로젝트",
    Icon: HandHeart,
    iconClassName: "bg-rose-50 text-rose-600",
    surfaceClassName: "bg-[#f6f1fa]",
    compactSurfaceClassName: "bg-[#f6f1fa]",
    valueClassName: "text-rose-700",
    value: "현재 68% 달성",
    supporting: "우리 반 공동 목표",
    actions: ["기부 참여하기"],
  },
};

const PreviewCard = ({ type, variant }) => {
  const info = PREVIEW_CARD_INFO[type];
  if (!info) return null;

  const { Icon } = info;
  const isCompact = variant === "compact";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl flex h-full flex-col ${
        isCompact ? info.compactSurfaceClassName : info.surfaceClassName
      } min-h-[132px] p-3`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${info.iconClassName}`}
          >
            <Icon size={17} strokeWidth={2.25} />
          </span>
          <h3 className="break-keep text-xs font-black text-slate-800">
            {info.title}
          </h3>
        </div>
      </div>

      {type === "asset" ? (
        <div className="mt-3 grid grid-cols-2 divide-x divide-blue-100 overflow-hidden rounded-xl border border-blue-100 bg-blue-100/60">
          <span className="truncate px-2 py-2 text-[10px] font-bold text-slate-600">
            직업 · 도서관 사서
          </span>
          <span className="truncate px-2 py-2 text-[10px] font-bold text-blue-700">
            주급 · 1,200 골드
          </span>
        </div>
      ) : null}

      <div className={`flex flex-1 flex-col ${isCompact ? "mt-3" : "mt-5"}`}>
        <p
          className={`font-black leading-tight ${info.valueClassName} text-sm`}
        >
          {info.value}
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-400">
          {info.supporting}
        </p>

        {info.actions.length > 0 ? (
          <div
            className="mt-auto grid overflow-hidden rounded-xl border border-slate-200/80 bg-blue-100/60"
            style={{ gridTemplateColumns: `repeat(${info.actions.length}, minmax(0, 1fr))` }}
          >
            {info.actions.map((label, index) => (
              <span
                key={label}
                className={`px-1.5 py-2 text-center text-[10px] font-bold text-slate-600 ${
                  index > 0 ? "border-l border-slate-200/80" : ""
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const isCardVisible = (settings, cardKey) =>
  Boolean(
    settings[
      `show${cardKey.charAt(0).toUpperCase() + cardKey.slice(1)}Card`
    ],
  );

const DashboardPreview = ({ settings }) => {
  const layout = useMemo(() => {
    const visibleCards = settings.cardOrder.filter((cardKey) =>
      isCardVisible(settings, cardKey),
    );
    return getDashboardCardLayout(visibleCards);
  }, [settings]);

  return (
    <div className="relative rounded-3xl border border-slate-200 bg-[#f0f5ff] p-3 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-black text-slate-900">실시간 미리보기</h2>
        <p className="mt-1 text-xs font-medium text-slate-500">
          공개 카드의 순서에 따라 대표·요약 배치가 자동으로 바뀝니다.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-[#f0f5ff] p-2">
        {layout.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            {layout.map(({ cardType, variant, gridClassName }) => (
              <div key={cardType} className={`min-w-0 ${gridClassName} ${variant === "compact" ? PREVIEW_CARD_INFO[cardType].compactSurfaceClassName : PREVIEW_CARD_INFO[cardType].surfaceClassName}`}>
                <PreviewCard type={cardType} variant={variant} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-48 items-center justify-center bg-white text-sm font-semibold text-slate-400">
            표시할 카드가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPreview;
