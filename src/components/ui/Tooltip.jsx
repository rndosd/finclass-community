// src/components/ui/Tooltip.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

const ARROW_SIZE = 8;

const Tooltip = ({
    content,
    children,
    position = "top",    // 'top' | 'bottom' | 'left' | 'right'
    delay = 120,         // ms
    maxWidth = 320,
    className = ""
}) => {
    const triggerRef = useRef(null);
    const [visible, setVisible] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0, placement: position });
    const [mountNode, setMountNode] = useState(null);
    const timerRef = useRef(null);

    useEffect(() => {
        setMountNode(document.body);
        return () => clearTimeout(timerRef.current);
    }, []);

    const show = useCallback(() => {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setVisible(true), delay);
    }, [delay]);

    const hide = useCallback(() => {
        clearTimeout(timerRef.current);
        setVisible(false);
    }, []);

    const updatePosition = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();

        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;

        let top = 0;
        let left = 0;
        let placement = position;

        const margin = 10;

        const calcTop = () => rect.top + scrollY - margin;
        const calcBottom = () => rect.bottom + scrollY + margin;
        const calcLeftCenter = (w = 0) => rect.left + scrollX + rect.width / 2 - w / 2;

        const calcLeft = () => rect.left + scrollX - margin;
        const calcRight = () => rect.right + scrollX + margin;
        const calcTopCenter = (h = 0) => rect.top + scrollY + rect.height / 2 - h / 2;

        // 기본 배치
        if (position === "top") {
            top = calcTop();
            left = calcLeftCenter();
        } else if (position === "bottom") {
            top = calcBottom();
            left = calcLeftCenter();
        } else if (position === "left") {
            top = calcTopCenter();
            left = calcLeft();
        } else if (position === "right") {
            top = calcTopCenter();
            left = calcRight();
        }

        // 화면 밖 보정 (간단/견고)
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;

        // Top인 경우 위로 못 나가면 bottom으로 바꿈
        if (position === "top" && rect.top < 80) {
            placement = "bottom";
            top = calcBottom();
            left = calcLeftCenter();
        }
        // Bottom인 경우 아래로 못 나가면 top으로 바꿈
        if (position === "bottom" && vh - rect.bottom < 80) {
            placement = "top";
            top = calcTop();
            left = calcLeftCenter();
        }

        // 좌우도 간단 보정
        if (position === "left" && rect.left < 120) {
            placement = "right";
            top = calcTopCenter();
            left = calcRight();
        }
        if (position === "right" && vw - rect.right < 120) {
            placement = "left";
            top = calcTopCenter();
            left = calcLeft();
        }

        setCoords({ top, left, placement });
    }, [position]);

    // 보일 때/윈도우 리사이즈/스크롤 시 위치 갱신
    useEffect(() => {
        if (!visible) return;
        updatePosition();
        const onResize = () => updatePosition();
        const onScroll = () => updatePosition();
        window.addEventListener("resize", onResize);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            window.removeEventListener("resize", onResize);
            window.removeEventListener("scroll", onScroll);
        };
    }, [visible, updatePosition]);

    // 트리거 영역에 접근성 핸들러
    const triggerProps = {
        ref: triggerRef,
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
        onTouchStart: show,
        onTouchEnd: hide,
        className: "inline-flex align-top"
    };

    const Arrow = ({ placement }) => {
        const base =
            "absolute w-0 h-0 border-transparent";
        const sides = {
            top: `bottom-[-${ARROW_SIZE - 2}px] left-1/2 -translate-x-1/2
            border-l-[${ARROW_SIZE}px] border-r-[${ARROW_SIZE}px] border-t-[${ARROW_SIZE}px]
            border-t-slate-900/90`,
            bottom: `top-[-${ARROW_SIZE - 2}px] left-1/2 -translate-x-1/2
               border-l-[${ARROW_SIZE}px] border-r-[${ARROW_SIZE}px] border-b-[${ARROW_SIZE}px]
               border-b-slate-900/90`,
            left: `right-[-${ARROW_SIZE - 2}px] top-1/2 -translate-y-1/2
             border-t-[${ARROW_SIZE}px] border-b-[${ARROW_SIZE}px] border-l-[${ARROW_SIZE}px]
             border-l-slate-900/90`,
            right: `left-[-${ARROW_SIZE - 2}px] top-1/2 -translate-y-1/2
              border-t-[${ARROW_SIZE}px] border-b-[${ARROW_SIZE}px] border-r-[${ARROW_SIZE}px]
              border-r-slate-900/90`
        };
        return <span className={`${base} ${sides[placement]}`} />;
    };

    const TooltipBody = () => {
        // 배치에 따라 본문 위치 조정
        const offset = ARROW_SIZE + 6; // 화살표 + 간극
        let style = {};
        if (coords.placement === "top") {
            style = { top: coords.top - offset, left: coords.left };
        } else if (coords.placement === "bottom") {
            style = { top: coords.top + offset, left: coords.left };
        } else if (coords.placement === "left") {
            style = { top: coords.top, left: coords.left - offset };
        } else {
            style = { top: coords.top, left: coords.left + offset };
        }

        return (
            <div
                role="tooltip"
                style={{ position: "fixed", ...style, maxWidth }}
                className={[
                    // 컨테이너
                    "z-[9999] pointer-events-none select-none",
                    // 등장/퇴장 애니메이션
                    "transition-all duration-150",
                    visible ? "opacity-100 scale-100" : "opacity-0 scale-95",
                    className
                ].join(" ")}
            >
                <div
                    className={`
            relative rounded-2xl px-3 py-2 text-sm leading-snug
            backdrop-blur-md bg-slate-900/90 text-white
            shadow-2xl ring-1 ring-white/10
          `}
                >
                    <Arrow placement={coords.placement} />
                    <div className="whitespace-pre-line break-words">
                        {content}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            {React.cloneElement(React.Children.only(children), triggerProps)}
            {mountNode && visible && createPortal(<TooltipBody />, mountNode)}
        </>
    );
};

export default Tooltip;
