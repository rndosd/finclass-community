// src/pages/missions/components/TeacherDashboard/StudentView/components/StatusIcon.jsx
import React, { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2, FileText, Clock, CheckCircle, XCircle } from "lucide-react";
import { getStatusVisual } from "../../../constants/statusVisuals";
import { Button } from "../../../../../components/ui";

const SIZE = {
  sm: {
    wrap: "w-6 h-6",
    font: "text-[10px] font-semibold",
    spinner: "w-3.5 h-3.5",
    icon: "w-3 h-3",
  },
  md: {
    wrap: "w-8 h-8",
    font: "text-[12px] font-semibold",
    spinner: "w-5 h-5",
    icon: "w-4 h-4",
  },
  lg: {
    wrap: "w-10 h-10",
    font: "text-[14px] font-semibold",
    spinner: "w-6 h-6",
    icon: "w-5 h-5",
  },
};

const ICON_COMPONENTS = {
  "file-text": FileText,
  clock: Clock,
  "check-circle": CheckCircle,
  "x-circle": XCircle,
};

const StatusIcon = ({
  status,
  isClickable = false,
  processing = false,
  onWrapperClick,
  onIconClick,
  onSelectAction,
  size = "md",
  // challenge props
  isChallenge = false,
  approvedCount,
  goalCount,
  hasPendingProgress = false,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 140 });
  const btnRef = useRef(null);

  const s = SIZE[size] || SIZE.md;
  const cfg = getStatusVisual(status);

  const clickable =
    isClickable && !processing
      ? "cursor-pointer hover:scale-110 hover:shadow-md"
      : "cursor-default";

  // ───────────────── 챌린지 전용 처리 ─────────────────
  const a = Number(approvedCount);
  const b = Number(goalCount);
  const hasApproved = Number.isFinite(a) && a >= 0;

  let bgClass = cfg.bg;
  let ringClass = cfg.ring;
  let iconColorClass = cfg.iconColor;
  let numericText = null;
  let useIcon = true;

  if (isChallenge) {
    if (hasPendingProgress) {
      bgClass = "bg-amber-500";
      ringClass = "ring-amber-300";
      iconColorClass = "text-white";
      numericText = "⏳";
      useIcon = false;
    } else if (hasApproved) {
      const reached = Number.isFinite(b) && b > 0 && a >= b;
      bgClass = reached ? "bg-green-500" : "bg-blue-500";
      ringClass = reached ? "ring-green-300" : "ring-blue-300";
      iconColorClass = "text-white";
      numericText = String(Math.max(0, Math.floor(a)));
      useIcon = false;
    }
  }

  const wrapperClass =
    `relative flex items-center justify-center ${s.wrap} rounded-full ` +
    `transition-transform duration-200 ring-1 ring-inset ${bgClass} ${ringClass} ` +
    `${clickable} select-none`;

  // pending/late 일 때만 메뉴
  const isPendingLike = status === "pending" || status === "late";

  // 메뉴 위치 계산
  const placeMenu = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 140;
    // 위에서 덮는 sticky 피하려고 살짝 아래로
    const top = r.bottom + 6;
    // 오른쪽으로 살짝
    const left = Math.min(
      window.innerWidth - width - 8,
      Math.max(8, r.left - (width - r.width)),
    );
    setMenuPos({ top, left, width });
  };

  useLayoutEffect(() => {
    if (!menuOpen) return;
    placeMenu();
    const onResize = () => placeMenu();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [menuOpen]);

  if (processing) {
    return (
      <div className={`${wrapperClass} animate-pulse`} aria-label="처리 중">
        <Loader2 className={`${s.spinner} animate-spin text-white`} />
      </div>
    );
  }

  const IconComponent = ICON_COMPONENTS[cfg.icon];

  const handleActionClick = (action) => {
    onSelectAction?.(action);
    setMenuOpen(false);
  };

  return (
    <>
      <div
        ref={btnRef}
        className={wrapperClass}
        role={onWrapperClick ? "button" : "img"}
        tabIndex={onWrapperClick ? 0 : -1}
        onClick={onWrapperClick}
        onKeyDown={(e) => {
          if (!onWrapperClick) return;
          if (e.key === "Enter" || e.key === " ") onWrapperClick();
        }}
      >
        <Button tone="blue" kind="outline" size="md"
          type="button"
          className="mission-status-button appearance-none m-0 w-full h-full flex items-center justify-center"
          aria-label={cfg.hint || cfg.label}
          disabled={!isClickable}
          onClick={(e) => {
            e.stopPropagation();
            if (isPendingLike) {
              setMenuOpen((v) => !v);
            } else if (status === "approved" || status === "late-approved") {
              // 승인된 상태는 바로 취소
              onSelectAction?.("cancel");
            } else {
              onIconClick?.(e);
            }
          }}
        >
          {useIcon && IconComponent ? (
            <IconComponent
              className={`${s.icon} ${iconColorClass}`}
              aria-hidden
            />
          ) : (
            <span className={`text-white ${s.font}`} aria-hidden>
              {numericText || cfg.label?.[0] || "?"}
            </span>
          )}
        </Button>
      </div>

      {/* ✅ 포털로 뿌리는 메뉴 → sticky에 안 가림 */}
      {isPendingLike &&
        menuOpen &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
            }}
            className="z-[9999] rounded-md bg-white shadow-xl border border-slate-200 py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Button tone="emerald" kind="ghost" size="xs"
              type="button"
              onClick={() => handleActionClick("approve")}
              className="w-full flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              승인
            </Button>
            <Button tone="rose" kind="ghost" size="xs"
              type="button"
              onClick={() => handleActionClick("reject")}
              className="w-full flex items-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              반려
            </Button>
          </div>,
          document.body,
        )}
    </>
  );
};

export default StatusIcon;
