// src/components/ui/TextAreaField.jsx

import React, { useId } from "react";

const cx = (...classes) => classes.filter(Boolean).join(" ");

const TextAreaField = ({
    id,
    label,
    value,
    onChange,
    placeholder = "",
    rows = 3,
    disabled = false,
    required = false,
    error = "",
    className = "",
    ...props
}) => {
    const generatedId = useId();
    const fieldId = id || generatedId;
    const errorTextId = `${fieldId}-error`;

    return (
        <div className="space-y-1">
            {label && (
                <label
                    htmlFor={fieldId}
                    className="block text-sm font-bold text-slate-700"
                >
                    {label}
                    {required && <span className="ml-1 text-red-500">*</span>}
                </label>
            )}
            <textarea
                id={fieldId}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                rows={rows}
                disabled={disabled}
                required={required}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={error ? errorTextId : undefined}
                className={cx(
                    "w-full resize-y rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm leading-[22px] text-slate-700 outline-none transition",
                    "placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20",
                    "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400",
                    error && "border-red-300 bg-red-50/40 text-red-900 focus:border-red-400",
                    className,
                )}
                {...props}
            />
            {error && (
                <p id={errorTextId} className="mt-1 text-sm font-semibold text-red-600">{error}</p>
            )}
        </div>
    );
};

export default TextAreaField;
