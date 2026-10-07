// src/components/ui/TabButton.jsx
import React from 'react';

const TabButton = ({ children, onClick, isActive, icon: Icon, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    role="tab"
    aria-selected={isActive}
    className={`flex min-h-11 items-center justify-center gap-2 border-b-2 px-3 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 sm:px-4 ${
      isActive
        ? 'border-blue-600 text-blue-700'
        : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
    } ${className}`}
  >
    {Icon ? (
      <Icon aria-hidden="true" className={`h-4 w-4 ${isActive ? 'text-blue-700' : 'text-slate-500'}`} />
    ) : null}
    {children}
  </button>
);

export default TabButton;
