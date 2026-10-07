import React, { useEffect, useRef, useId } from "react";

export default function Checkbox({
  label,
  id,
  name,
  checked,
  onChange,
  readOnly = false,
  disabled = false,
  className = "",
  labelClassName = "",
  indeterminate = false,
  "aria-labelledby": ariaLabelledBy,
}) {
  const checkboxRef = useRef(null);
  const generatedId = useId();
  const fieldId = id || name || generatedId;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <div className={`flex items-center ${className}`}>
      <input
        ref={checkboxRef}
        id={fieldId}
        name={name}
        aria-labelledby={ariaLabelledBy}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        readOnly={readOnly || typeof onChange !== "function"}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {label && (
        <label
          htmlFor={fieldId}
          className={`ml-2 block text-sm ${disabled ? "text-slate-400" : "text-slate-900"} ${labelClassName}`}
        >
          {label}
        </label>
      )}
    </div>
  );
}
