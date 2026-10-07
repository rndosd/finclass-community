import React, { useEffect, useMemo, useRef, useState, useId } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

const DEFAULT_PLACEHOLDER = "\uc120\ud0dd\ud574 \uc8fc\uc138\uc694";
const DEFAULT_SEARCH_PLACEHOLDER = "\uac80\uc0c9\uc5b4\ub97c \uc785\ub825\ud574 \uc8fc\uc138\uc694";
const DEFAULT_EMPTY_MESSAGE = "\uac80\uc0c9 \uacb0\uacfc\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.";

const normalizeText = (value) => String(value || "").trim().toLowerCase();

export default function SelectField({
  id: suppliedId,
  name,
  label,
  value,
  onChange,
  disabled,
  options = [],
  placeholder = DEFAULT_PLACEHOLDER,
  className = "",
  labelClassName = "",
  children,
  searchable = false,
  searchPlaceholder = DEFAULT_SEARCH_PLACEHOLDER,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
  combobox = false,
  dropdownClassName = "",
}) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  const allOptions = useMemo(() => {
    if (options.length > 0) return options;

    return React.Children.toArray(children)
      .map((child) => ({
        value: child.props.value,
        label: child.props.children,
        disabled: child.props.disabled,
      }))
      .filter((option) => option.value !== "");
  }, [children, options]);

  const selectedOption = useMemo(
    () => allOptions.find((option) => option.value === value),
    [allOptions, value],
  );

  const filteredOptions = useMemo(() => {
    if (!searchable) return allOptions;

    const normalizedQuery = normalizeText(searchTerm);
    if (!normalizedQuery) return allOptions;

    return allOptions.filter((option) => {
      const searchSource = `${option.label || ""} ${option.value || ""} ${option.searchText || ""}`;
      return normalizeText(searchSource).includes(normalizedQuery);
    });
  }, [allOptions, searchable, searchTerm]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm("");
      setActiveIndex(-1);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !searchable) return;

    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [isOpen, searchable]);

  useEffect(() => {
    if (!isOpen) return;

    const selectedIndex = filteredOptions.findIndex(
      (option) => !option.disabled && option.value === value,
    );

    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
      return;
    }

    const firstEnabledIndex = filteredOptions.findIndex((option) => !option.disabled);
    setActiveIndex(firstEnabledIndex);
  }, [filteredOptions, isOpen, value]);

  const emitChange = (nextValue) => {
    onChange?.({ target: { name, value: nextValue } });
  };

  const handleOptionClick = (optionValue) => {
    if (disabled) return;
    emitChange(optionValue);
    setIsOpen(false);
  };

  const moveActiveIndex = (direction) => {
    if (!filteredOptions.length) return;

    let nextIndex = activeIndex;
    for (let i = 0; i < filteredOptions.length; i += 1) {
      nextIndex = (nextIndex + direction + filteredOptions.length) % filteredOptions.length;
      if (!filteredOptions[nextIndex]?.disabled) {
        setActiveIndex(nextIndex);
        return;
      }
    }
  };

  const handleListKeyDown = (event) => {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      moveActiveIndex(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      moveActiveIndex(-1);
      return;
    }

    if (event.key === "Enter") {
      if (!isOpen) return;
      event.preventDefault();
      const activeOption = filteredOptions[activeIndex];
      if (activeOption && !activeOption.disabled) {
        handleOptionClick(activeOption.value);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  const renderOptions = () => (
    <div className="max-h-64 overflow-y-auto">
      {filteredOptions.length > 0 ? (
        filteredOptions.map((option, index) => {
          const isSelected = value === option.value;
          const isActive = activeIndex === index;

          return (
            <button
              key={option.value || index}
              type="button"
              onMouseEnter={() => !option.disabled && setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => !option.disabled && handleOptionClick(option.value)}
              disabled={option.disabled}
              className={[
                "w-full border-b border-slate-100 px-3 min-h-11 py-2.5 text-left transition-colors duration-150 last:border-b-0",
                option.disabled ? "cursor-not-allowed bg-slate-50 text-slate-300" : "",
                !option.disabled && isSelected ? "bg-blue-50 font-medium text-blue-700" : "",
                !option.disabled && !isSelected && isActive ? "bg-slate-100 text-slate-700" : "",
                !option.disabled && !isSelected && !isActive ? "text-slate-700 hover:bg-slate-50" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="block truncate">{option.label}</span>
            </button>
          );
        })
      ) : (
        <div className="px-4 py-6 text-center text-sm text-slate-600">{emptyMessage}</div>
      )}
    </div>
  );

  const fieldClasses = [
    "w-full rounded-xl border px-3 min-h-11 py-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:border-blue-500 motion-reduce:transition-none",
    isOpen ? "border-blue-500 bg-blue-50/50" : "border-blue-200 bg-blue-50/50 hover:border-blue-200",
    disabled ? "cursor-not-allowed bg-slate-100 text-slate-400" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-2">
      {label ? (
        <label
          htmlFor={id}
          className={["block text-sm font-medium text-slate-700", labelClassName]
            .filter(Boolean)
            .join(" ")}
        >
          {label}
        </label>
      ) : null}

      <div className="relative" ref={dropdownRef}>
        {combobox ? (
          <div className={fieldClasses}>
            <div className="flex items-center gap-2.5">
              {searchable ? <Search className="h-4 w-4 shrink-0 text-slate-400" /> : null}
              <input
                ref={searchInputRef}
                id={id}
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                data-unstyled-input="true"
                disabled={disabled}
                value={isOpen ? searchTerm : selectedOption?.label || ""}
                onFocus={() => !disabled && setIsOpen(true)}
                onChange={(event) => {
                  if (disabled) return;
                  setSearchTerm(event.target.value);
                  if (!isOpen) setIsOpen(true);
                }}
                onKeyDown={handleListKeyDown}
                placeholder={isOpen ? searchPlaceholder : placeholder}
                className="w-full appearance-none rounded-none border-0 bg-transparent p-0 text-sm text-slate-700 shadow-none outline-none focus:border-0 focus:ring-0 placeholder:text-slate-400 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (disabled) return;
                  setIsOpen((prev) => !prev);
                }}
                disabled={disabled}
                className="shrink-0 text-slate-400"
              >
                {isOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            id={id}
            onClick={() => !disabled && setIsOpen((prev) => !prev)}
            onKeyDown={handleListKeyDown}
            disabled={disabled}
            className={fieldClasses}
          >
            <div className="flex items-center justify-between gap-2.5">
              <span className={`truncate ${selectedOption ? "text-slate-700" : "text-slate-400"}`}>
                {selectedOption ? selectedOption.label : placeholder}
              </span>

              {!disabled ? (
                isOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                )
              ) : null}
            </div>
          </button>
        )}

        {isOpen && !disabled ? (
          <div
            className={[
              "absolute z-[9999] mt-2 w-full overflow-hidden rounded-xl border border-blue-200 bg-white shadow-xl",
              dropdownClassName,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {searchable && !combobox ? (
              <div className="border-b border-slate-100 p-2.5">
                <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-slate-50 px-3 py-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    data-unstyled-input="true"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    onKeyDown={handleListKeyDown}
                    placeholder={searchPlaceholder}
                    className="w-full appearance-none rounded-none border-0 bg-transparent p-0 text-sm text-slate-700 shadow-none outline-none focus:border-0 focus:ring-0 placeholder:text-slate-400"
                  />
                </div>
              </div>
            ) : null}

            {renderOptions()}
          </div>
        ) : null}
      </div>

      <select
        name={name}
        value={value}
        onChange={onChange}
        style={{ display: "none" }}
        tabIndex={-1}
        aria-hidden="true"
      >
        {options.length > 0
          ? options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))
          : children}
      </select>
    </div>
  );
}
