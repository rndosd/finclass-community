// src/components/ui/Tabs.jsx
import React, { useRef } from "react";

const VARIANTS = {
  gradient: {
    container:
      "bg-white/60 backdrop-blur-sm border border-blue-100/50 rounded-xl shadow-sm",
    nav: "flex space-x-2 p-2 overflow-x-auto",
    active:
      "bg-blue-600 text-white shadow-sm",
    inactive: "text-slate-600 hover:text-slate-800 hover:bg-white/50",
  },
  pills: {
    container:
      "bg-slate-100 rounded-2xl p-1 border border-slate-200",
    nav: "flex gap-1 overflow-x-auto",
    active:
      "bg-white text-blue-700 rounded-xl shadow-sm " +
      "ring-1 ring-slate-200",
    inactive:
      "text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-xl " +
      "border border-transparent",
  },
  underline: {
    container: "border-b border-slate-200",
    nav: "-mb-px flex gap-2 overflow-x-auto sm:gap-6",
    active: "border-blue-700 text-blue-800 border-b-[3px]",
    inactive:
      "border-transparent text-slate-600 hover:text-slate-700 hover:border-slate-300 border-b-[3px]",
  },
  buttons: {
    container: "flex gap-2 flex-wrap",
    nav: "flex gap-2 overflow-x-auto",
    active: "bg-blue-600 text-white",
    inactive:
      "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50",
  },
};

const SIZES = {
  sm: "px-3 py-1.5 text-xs",
  md: "min-h-11 px-3 py-2 text-sm sm:px-4",
  lg: "px-3 py-3 text-sm sm:px-6",
  xl: "px-4 py-4 text-base sm:px-8",
};

const Tabs = ({
  tabs = [],
  activeTab,
  onTabChange,
  variant = "underline", // 'gradient' | 'pills' | 'underline' | 'buttons'
  size = "lg",
  className = "",
  disabled = false,
  fullWidth = false,
  wrapLabels = false,
  idPrefix = "tabs", // aria-id prefix
  ariaLabel = "화면 선택",
}) => {
  const variantStyles = VARIANTS[variant] || VARIANTS.underline;
  const sizeStyles = SIZES[size] || SIZES.lg;
  const listRef = useRef(null);

  const baseTabClass = `
    ${wrapLabels ? "min-w-0 whitespace-normal" : "min-w-fit whitespace-nowrap"} font-semibold transition-colors duration-200 motion-reduce:transition-none
    ${variant === "underline" ? "" : "rounded-xl"}
    ${sizeStyles}
    ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
  `;

  const handleKeyDown = (e) => {
    if (!listRef.current) return;
    const focusables = Array.from(
      listRef.current.querySelectorAll('[role="tab"]:not([disabled])'),
    );
    const currentIndex = focusables.indexOf(document.activeElement);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    switch (e.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % focusables.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + focusables.length) % focusables.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = focusables.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    focusables[nextIndex]?.focus();

    // Move focus and update the selected tab.
    const nextId = focusables[nextIndex]?.getAttribute("data-tab-id");
    if (nextId && onTabChange && nextId !== activeTab) {
      onTabChange(nextId);
    }
  };

  return (
    <div className={`${variantStyles.container} ${className}`}>
      <nav
        ref={listRef}
        className={`${variantStyles.nav} ${fullWidth ? "justify-between" : ""}`}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const isDisabled = disabled || tab.disabled;
          const tabId = `${idPrefix}-tab-${tab.id}`;

          return (
            <button
              type="button"
              key={tab.id}
              data-tab-id={tab.id}
              role="tab"
              id={tabId}
              aria-selected={isActive}
              aria-controls={tab.panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => {
                if (isDisabled) return;
                if (onTabChange && tab.id !== activeTab) onTabChange(tab.id);
              }}
              disabled={isDisabled}
              className={`
                ${baseTabClass}
                ${isActive ? variantStyles.active : variantStyles.inactive}
                ${isDisabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}
                ${fullWidth ? "flex-1" : ""}
                flex items-center justify-center gap-2
                focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500
              `}
              aria-current={
                variant === "underline" && isActive ? "page" : undefined
              }
            >
              {tab.icon && (
                <span className={`${tab.label ? "mr-2" : ""}`}>
                  {typeof tab.icon === "string" ? (
                    <span className="text-lg">{tab.icon}</span>
                  ) : (
                    <tab.icon className="w-4 h-4" />
                  )}
                </span>
              )}
              {tab.label}
              {tab.badge && (
                <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-xs font-semibold leading-none text-slate-600">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

// Convenience variant components.
export const GradientTabs = (props) => <Tabs {...props} variant="gradient" />;
export const PillTabs = (props) => <Tabs {...props} variant="pills" />;
export const UnderlineTabs = (props) => <Tabs {...props} variant="underline" />;
export const ButtonTabs = (props) => <Tabs {...props} variant="buttons" />;

// Demo.
export const TabsDemo = () => {
  const [activeTab, setActiveTab] = React.useState("tab1");
  const demoTabs = [
    { id: "tab1", label: "Dashboard", icon: "📊", badge: "New" },
    { id: "tab2", label: "Settings" },
    { id: "tab3", label: "Profile", disabled: true },
  ];
  return (
    <div className="space-y-6 p-6">
      <div>
        <h3 className="text-lg font-semibold mb-3">Gradient Tabs</h3>
        <Tabs
          tabs={demoTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-3">Pills Tabs</h3>
        <PillTabs
          tabs={demoTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-3">Underline Tabs</h3>
        <UnderlineTabs
          tabs={demoTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-3">Button Tabs</h3>
        <ButtonTabs
          tabs={demoTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          size="md"
        />
      </div>
    </div>
  );
};

export default Tabs;
