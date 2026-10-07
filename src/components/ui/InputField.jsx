// src/components/ui/InputField.jsx
import React, { useId } from "react";
import { resolveUiTone } from "./toneStyles";

const cx = (...classes) => classes.filter(Boolean).join(" ");

const TONE_STYLES = {
  slate: "focus:border-slate-400",
  blue: "focus:border-blue-500",
  emerald: "focus:border-emerald-400",
  amber: "focus:border-amber-400",
  red: "focus:border-red-500 focus:ring-red-500/20",
  rose: "focus:border-rose-400",
};

const SIZE_STYLES = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-3 text-sm",
  lg: "h-11 px-4 text-base",
};

export default function InputField({
  id: suppliedId,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  min,
  step,
  required = false,
  className = "",
  wrapperClassName = "",
  labelClassName = "",
  hint,
  error,
  tone = "blue",
  size = "md",
  readOnly = false,
  disabled = false,
  validation,
  ...props
}) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  const handleChange = (event) => {
    const newValue = event.target.value;

    if (validation) {
      const isValid = validation(newValue, event);
      if (!isValid) return;
    }

    onChange?.(event);
  };

  const resolvedTone = error ? "red" : resolveUiTone(tone, "blue");
  const toneClass = TONE_STYLES[resolvedTone] || TONE_STYLES.blue;
  const sizeClass = SIZE_STYLES[size] || SIZE_STYLES.md;
  const helpTextId = id ? `${id}-help` : undefined;
  const errorTextId = id ? `${id}-error` : undefined;

  return (
    <div className={cx("space-y-1.5", wrapperClassName)}>
      {label ? (
        <label
          htmlFor={id}
          className={cx("block text-sm font-bold text-slate-700", labelClassName)}
        >
          {label}
          {required ? <span className="ml-1 text-red-500">*</span> : null}
        </label>
      ) : null}
      <input
        type={type}
        id={id}
        name={name}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        min={min}
        step={step}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={cx(hint && helpTextId, error && errorTextId) || undefined}
        className={cx(
          "w-full rounded-xl border border-blue-200 bg-blue-50/50 text-slate-700 outline-none transition",
          "placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500/20",
          "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400",
          readOnly && "cursor-default bg-slate-50 text-slate-600",
          error && "border-red-300 bg-red-50/40 text-red-900",
          sizeClass,
          toneClass,
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={helpTextId} className="text-xs leading-5 text-slate-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorTextId} className="text-xs font-semibold leading-5 text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
