import React from 'react';

const CheckboxGroup = ({ label, options = [], values = [], onChange }) => {
    const toggleValue = (value) => {
        if (values.includes(value)) {
            onChange(values.filter((v) => v !== value));
        } else {
            onChange([...values, value]);
        }
    };

    return (
        <div className="space-y-1">
            {label && <label className="block font-medium text-sm text-slate-700">{label}</label>}
            <div className="flex flex-wrap gap-3 mt-1">
                {options.map((option) => (
                    <label key={option.value} className="flex items-center space-x-1 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={values.includes(option.value)}
                            onChange={() => toggleValue(option.value)}
                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                        />
                        <span className="text-sm text-slate-800">{option.label}</span>
                    </label>
                ))}
            </div>
        </div>
    );
};

export default CheckboxGroup;
