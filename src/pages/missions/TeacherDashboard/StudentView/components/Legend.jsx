// src/pages/missions/components/TeacherDashboard/StudentView/components/Legend.jsx
import React, { useState, useRef, useEffect } from "react";
import { Button } from "../../../../../components/ui";
import { createPortal } from "react-dom";
import {
  HelpCircle,
  FileText,
  Clock,
  CheckCircle,
  XCircle, // ✅ 추가
} from "lucide-react";
import {
  LEGEND_ITEMS,
  getStatusVisual,
} from "../../../constants/statusVisuals";

const Legend = ({ sticky = true }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({
    top: 0,
    bottom: "auto",
    left: 0,
    width: 380,
  });
  const btnRef = useRef(null);

  const place = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const viewportPadding = 12;
    if (window.innerWidth < 640) {
      const width = Math.min(
        420,
        window.innerWidth - viewportPadding * 2,
      );
      setPos({
        top: "auto",
        bottom: viewportPadding,
        left: viewportPadding,
        width,
      });
      return;
    }

    const width = Math.min(
      560,
      Math.max(420, window.innerWidth - viewportPadding * 2),
    );
    const gap = 8;
    const left = Math.max(
      viewportPadding,
      Math.min(
        window.innerWidth - width - viewportPadding,
        r.right - width,
      ),
    );
    const top = Math.min(r.bottom + gap, window.innerHeight - 120);
    setPos({ top, bottom: "auto", left, width });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onResize = () => place();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open]);

  useEffect(() => {
    const onDown = (e) => {
      if (!open) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // ✅ 아이콘 매핑에 x-circle 추가
  const ICON_COMPONENTS = {
    "file-text": FileText,
    clock: Clock,
    "check-circle": CheckCircle,
    "x-circle": XCircle, // ← 이거 없어서 물음표 나왔던 거
  };

  const filteredLegendItems = LEGEND_ITEMS.filter(
    (item) =>
      !item.key.includes("progress") && item.key !== "challenge_progress",
  );

  const popover =
    open &&
    createPortal(
      <div
        role="dialog"
        aria-label="아이콘 도움말"
        style={{
          position: "fixed",
          top: pos.top,
          bottom: pos.bottom,
          left: pos.left,
          width: pos.width,
        }}
        className="z-[9999] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-xl border bg-white p-3 shadow-xl sm:max-h-[calc(100dvh-7.5rem)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-[12px] text-gray-500 mb-2">
          아이콘은 <span className="font-medium">클릭 가능한 상태</span>에서만
          동작합니다.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filteredLegendItems.map((item) => {
            const statusVisual = getStatusVisual(item.key);
            const IconComponent = ICON_COMPONENTS[item.icon];

            return (
              <div
                key={item.key}
                className="flex items-start gap-2 rounded-md p-2 hover:bg-gray-50"
              >
                <div className="shrink-0 w-8 flex items-center justify-center">
                  {IconComponent ? (
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center ring-1 ring-inset ${statusVisual.bg} ${statusVisual.ring}`}
                    >
                      <IconComponent
                        className={`w-4 h-4 ${statusVisual.iconColor}`}
                      />
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center">
                      <HelpCircle className="w-4 h-4 text-gray-500" />
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800 leading-5">
                    {item.label}
                  </div>
                  {item.hint && (
                    <div className="text-[11px] text-gray-500 leading-4">
                      {item.hint}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex justify-end">
          <Button tone="slate" kind="ghost" size="xs"
            type="button"
            onClick={() => setOpen(false)}
            
          >
            닫기
          </Button>
        </div>
      </div>,
      document.body,
    );

  return (
    <div
      className={[
        sticky ? "sticky top-0 z-10" : "",
        "bg-white/90 backdrop-blur border-b",
      ].join(" ")}
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <svg
            className="w-5 h-5 text-blue-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0m4.5 0a2.25 2.25 0 01-4.5 0"
            />
          </svg>
          <span>학생별 과제 현황</span>
        </h3>

        <div>
          <Button tone="slate" kind="outline" size="xs"
            ref={btnRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1"
            aria-expanded={open}
            aria-haspopup="dialog"
          >
            <HelpCircle className="w-4 h-4" />
            도움말
          </Button>
        </div>
      </div>

      {popover}
    </div>
  );
};

export default Legend;
