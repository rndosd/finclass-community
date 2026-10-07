import React from "react";

const RadioGroup = ({ label, value, onChange, children, className }) => {
  const options = React.Children.toArray(children);

  return (
    <div>
      {label && (
        <label className="mb-1 block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <div className={`flex flex-wrap gap-x-4 gap-y-2 ${className}`}>
        {options.map((radio, index) => {
          if (
            !React.isValidElement(radio) ||
            radio.props.value === undefined ||
            radio.props.value === null
          ) {
            console.warn(
              "RadioGroup received an invalid child or a child missing a 'value' prop:",
              radio,
            );
            return null;
          }

          return React.cloneElement(radio, {
            key: radio.key || radio.props.value || `radio-${index}`,
            checked: value === radio.props.value,
            onChange: () => onChange(radio.props.value),
          });
        })}
      </div>
    </div>
  );
};

const Radio = ({
  value,
  children,
  checked,
  onChange,
  description,
  className = "",
  disabled = false,
}) => {
  const usesCardLayout = Boolean(className);

  return (
    <label
      className={`${
        usesCardLayout
          ? `flex min-h-11 items-start rounded-xl border px-3 py-2.5 text-sm transition-colors ${
              disabled
                ? "cursor-not-allowed text-slate-400 opacity-70"
                : "cursor-pointer text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            }`
          : `inline-flex items-center text-sm ${
              disabled
                ? "cursor-not-allowed text-slate-400 opacity-70"
                : "cursor-pointer text-slate-700"
            }`
      } ${className}`}
    >
    <input
      type="radio"
      className={`form-radio h-4 w-4 shrink-0 text-blue-600 focus:ring-blue-500 transition duration-150 ease-in-out ${
        usesCardLayout ? "mt-0.5" : ""
      }`}
      value={value}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      readOnly={typeof onChange !== "function"}
    />
      <span className="ml-2 min-w-0">
        <span className={usesCardLayout ? "block font-semibold" : ""}>
          {children}
        </span>
      {description && (
          <span
            className={
              usesCardLayout
                ? "mt-0.5 block text-xs leading-4 text-slate-500"
                : "ml-1 text-xs text-slate-500"
            }
          >
          {description}
        </span>
      )}
    </span>
  </label>
  );
};

RadioGroup.Radio = Radio;

export { Radio };
export default RadioGroup;
