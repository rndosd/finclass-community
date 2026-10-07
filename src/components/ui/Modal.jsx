// src/components/ui/Modal.jsx
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";

/** ---------------- Modal Manager (기존 로직 유지) ---------------- */
const ModalStack = (() => {
  let stack = [];
  const panels = new Map();
  let scrollLocks = 0;
  const add = (id, panel) => {
    panels.set(id, panel);
    if (!stack.includes(id)) stack.push(id);
    return stack.length - 1;
  };
  const remove = (id) => {
    stack = stack.filter((x) => x !== id);
    panels.delete(id);
  };
  const isTop = (id) => stack[stack.length - 1] === id;
  const canRestoreFocus = (element) =>
    stack.length === 0 || panels.get(stack[stack.length - 1])?.contains(element);
  const lockScroll = () => {
    if (scrollLocks === 0) {
      const prev = document.body.style.overflow;
      document.body.setAttribute("data-prev-overflow", prev ?? "");
      document.body.style.overflow = "hidden";
    }
    scrollLocks++;
  };
  const unlockScroll = () => {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) {
      const prev = document.body.getAttribute("data-prev-overflow");
      document.body.style.overflow = prev || "";
    }
  };
  return { add, remove, isTop, canRestoreFocus, lockScroll, unlockScroll };
})();

const SIZE_MAP = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-[96vw]",
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const isElementVisible = (element) => {
  if (!element || element.closest("[hidden], [aria-hidden='true'], [inert]")) {
    return false;
  }

  let current = element;
  while (current && current !== document.body) {
    const styles = window.getComputedStyle(current);
    if (styles.display === "none" || styles.visibility === "hidden") {
      return false;
    }
    current = current.parentElement;
  }

  return true;
};

const getFocusableElements = (panel) =>
  Array.from(panel?.querySelectorAll(FOCUSABLE_SELECTOR) || []).filter(
    isElementVisible,
  );

let _idSeq = 0;
const nextId = () => `modal-${++_idSeq}`;

/** ---------------- Modal Component ---------------- */
const Modal = ({
  isOpen: propIsOpen, // 새 이름
  open: propOpen, // 옛 이름 (호환성 유지)
  onClose,
  title,
  subtitle,
  footer,
  size = "md",
  density = "default",
  placement = "center",
  showDefaultCloseButton = true,
  closeOnOverlayClick = true,
  lockScroll = true,
  zIndexBase = 1000,
  children,
  bodyClassName = "",
  ...panelProps
}) => {
  // 🚀 핵심 1: 둘 중 하나만 true여도 열리도록 설정
  const isOpen = propIsOpen || propOpen;
  const isCompact = density === "compact";
  const isDrawer = placement === "right";

  const idRef = useRef(nextId());
  const id = idRef.current;
  const [mounted, setMounted] = useState(false);
  const [indexInStack, setIndexInStack] = useState(0);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const openedAtRef = useRef(0);
  const previouslyFocusedRef = useRef(null);
  const titleId = `${id}-title`;

  useEffect(() => {
    const div = document.createElement("div");
    containerRef.current = div;
    document.body.appendChild(div);
    setMounted(true);
    return () => {
      document.body.removeChild(div);
    };
  }, []);

  useEffect(() => {
    if (!mounted || !isOpen) return;
    setIndexInStack(ModalStack.add(id, panelRef.current));
    openedAtRef.current = Date.now();
    previouslyFocusedRef.current = document.activeElement;
    if (lockScroll) ModalStack.lockScroll();

    const focusFrame = window.requestAnimationFrame(() => {
      if (!ModalStack.isTop(id)) return;
      const preferredFocusTarget = panelRef.current?.querySelector(
        "[data-autofocus], [autofocus]",
      );
      const focusTarget =
        (isElementVisible(preferredFocusTarget) ? preferredFocusTarget : null) ||
        getFocusableElements(panelRef.current)[0];
      (focusTarget || panelRef.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      const wasTop = ModalStack.isTop(id);
      ModalStack.remove(id);
      if (lockScroll) ModalStack.unlockScroll();
      const previous = previouslyFocusedRef.current;
      if (wasTop && previous instanceof HTMLElement && document.contains(previous)) {
        window.requestAnimationFrame(() => {
          if (document.contains(previous) && ModalStack.canRestoreFocus(previous)) {
            previous.focus();
          }
        });
      }
    };
  }, [mounted, isOpen, lockScroll, id]);

  const handleKeydown = useCallback(
    (e) => {
      if (!ModalStack.isTop(id)) return;

      if (e.key === "Escape") {
        onClose?.();
        return;
      }

      if (e.key !== "Tab" || !panelRef.current) return;

      const focusableElements = getFocusableElements(panelRef.current);

      if (focusableElements.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose, id],
  );

  useEffect(() => {
    if (!mounted || !isOpen) return;
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [mounted, isOpen, handleKeydown]);

  if (!mounted || !isOpen || !containerRef.current) return null;

  const maxWidth = SIZE_MAP[size] || size;
  const overlayZ = zIndexBase + indexInStack * 2;
  const panelZ = overlayZ + 1;
  const sections = React.Children.toArray(children);
  const hasCompoundLayout = !title && sections.length > 0 && sections.every(
    (child) => React.isValidElement(child) &&
      [Modal.Header, Modal.Body, Modal.Footer].includes(child.type),
  ) && sections.some((child) => child.type === Modal.Body);
  const handleOverlayClose = (e) => {
    e.stopPropagation();
    if (!closeOnOverlayClick) return;
    if (Date.now() - openedAtRef.current < 300) return;
    onClose?.();
  };

  return createPortal(
    <div
      className={isDrawer ? "fixed inset-0 flex items-stretch justify-end" : "fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4"}
      style={{ zIndex: overlayZ }}
    >
      {/* Overlay */}
      <div
        className={`absolute inset-0 ${isDrawer ? "bg-slate-900/20" : "bg-slate-900/40 backdrop-blur-[2px]"} animate-in fade-in duration-200 motion-reduce:animate-none`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleOverlayClose}
      />

      {/* Modal Panel */}
      <div
        {...panelProps}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-describedby={panelProps["aria-describedby"] || (title && subtitle ? `${id}-subtitle` : undefined)}
        aria-labelledby={title ? titleId : panelProps["aria-labelledby"]}
        aria-label={!title ? panelProps["aria-label"] || "대화상자" : undefined}
        tabIndex={-1}
        className={`
          relative bg-white w-full ${maxWidth} ${isDrawer ? "h-[100dvh] max-h-[100dvh] rounded-none" : "rounded-t-3xl sm:rounded-3xl max-h-[94dvh] sm:max-h-[92vh]"}
          shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)] flex flex-col overflow-hidden
          transform transition-all animate-in ${isDrawer ? "slide-in-from-right" : "zoom-in-95 slide-in-from-bottom-4"} duration-200 motion-reduce:animate-none motion-reduce:transition-none
        `}
        style={{ zIndex: panelZ }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 🚀 핵심 2: 제목이 있을 때만 헤더 표시 */}
        {title && (
          <div className={`flex items-center justify-between gap-3 shrink-0 px-5 sm:px-6 ${isCompact ? "py-3" : "py-4"} border-b border-blue-100 relative z-10`}>
            <div className="min-w-0">
            <h3
              id={titleId}
              className={`min-w-0 text-xl leading-7 ${isCompact ? "" : "sm:text-2xl sm:leading-8"} font-extrabold text-slate-900`}
            >
              {title}
            </h3>
            {subtitle && <p id={`${id}-subtitle`} className="mt-1 text-sm leading-[22px] text-slate-600">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="모달 닫기"
              className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        {/* 🚀 핵심 3: 제목이 없을 때도 닫기 버튼은 띄워줌 (X 아이콘) */}
        {!title && onClose && showDefaultCloseButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label="모달 닫기"
            className="absolute top-3 right-3 z-50 flex h-11 w-11 items-center justify-center text-slate-600 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:top-6 sm:right-6"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}

        {/* 🚀 핵심 4: 내용 영역 (제목 유무에 따라 패딩 자동 조절) */}
        {hasCompoundLayout ? sections.map((child) => React.cloneElement(child, {
          density: child.props.density || density,
          className: `${child.props.className || ""} ${child.type === Modal.Body
            ? "min-h-0 flex-1 overflow-y-auto scrollbar-hide"
            : "shrink-0"}`,
        })) : <div className={`min-h-0 flex-grow overflow-y-auto scrollbar-hide ${bodyClassName}`}>
          <div className={title ? `px-5 sm:px-6 ${isCompact ? "py-4" : "py-5 sm:py-6"}` : "p-0 h-full"}>
            {children}
          </div>
        </div>}
        {footer && <div className="shrink-0 border-t border-blue-100 px-5 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>,
    containerRef.current,
  );
};

Modal.Header = ({ children, className = "", density = "default", ...props }) => (
  <div
    className={`px-5 sm:px-6 ${density === "compact" ? "py-3" : "py-4"} border-b border-blue-100 bg-white ${className}`}
    {...props}
  >
    {children}
  </div>
);
Modal.Body = ({ children, className = "", density = "default", ...props }) => (
  <div className={`px-5 sm:px-6 ${density === "compact" ? "py-4" : "py-5 sm:py-6"} ${className}`} {...props}>
    {children}
  </div>
);
Modal.Footer = ({ children, className = "", density: _density, ...props }) => (
  <div
    className={`px-5 py-3 sm:px-6 border-t border-blue-100 bg-white flex flex-wrap justify-end gap-3 items-center ${className}`}
    {...props}
  >
    {children}
  </div>
);

export default Modal;
