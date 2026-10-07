import React from "react";

const Radio = ({
  value,
  checked,
  onChange,
  children,
  description,
  className = "",
}) => {
  return (
    <label className={`flex cursor-pointer flex-col items-start ${className}`}>
      <div className="flex items-center space-x-2">
        <input
          type="radio"
          className="h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500"
          value={value}
          checked={checked}
          onChange={onChange}
          readOnly={typeof onChange !== "function"}
        />
        <span className="text-sm font-medium text-slate-800">{children}</span>
      </div>
      {description && <p className="pl-6 text-xs text-slate-500">{description}</p>}
    </label>
  );
};

export default Radio;
