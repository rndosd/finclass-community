import React, { useEffect, useRef } from 'react';
import { ChevronDown, Settings } from 'lucide-react';
import Tabs from '../../../components/ui/Tabs';

const OPERATIONS = new Set(['stats', 'ledger', 'holding', 'policy']);

export default function RealEstateNavigation({ tabs, activeTab, onTabChange }) {
  const disclosureRef = useRef(null);
  const primaryTabs = ['classroom', 'manage', 'auction', 'my']
    .map((id) => tabs.find((tab) => tab.id === id))
    .filter(Boolean);
  const operationTabs = tabs.filter((tab) => OPERATIONS.has(tab.id));
  const selectedOperation = operationTabs.find((tab) => tab.id === activeTab);

  useEffect(() => {
    const closeOutside = (event) => {
      const disclosure = disclosureRef.current;
      if (disclosure && !disclosure.contains(event.target)) disclosure.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  useEffect(() => {
    if (disclosureRef.current) disclosureRef.current.open = false;
  }, [activeTab]);

  return (
    <div className="relative z-40 mb-4 flex flex-wrap items-stretch gap-x-3 border-b border-slate-200">
      <Tabs
        tabs={primaryTabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        variant="underline"
        size="md"
        className="min-w-0 border-b-0"
        idPrefix="realestate"
      />
      {operationTabs.length > 0 && (
        <details
          ref={disclosureRef}
          aria-label="운영 관리 메뉴"
          className="relative ml-auto"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}
        >
          <summary className={`flex h-full min-h-[42px] cursor-pointer list-none items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden ${selectedOperation ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <Settings size={16} aria-hidden="true" />
            <span>운영 관리{selectedOperation ? ` · ${selectedOperation.label}` : ''}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-full z-30 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg" aria-label="운영 관리 화면">
            {operationTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? 'page' : undefined}
                onClick={() => {
                  disclosureRef.current.open = false;
                  disclosureRef.current.querySelector('summary')?.focus();
                  onTabChange(tab.id);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${activeTab === tab.id ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <tab.icon size={16} aria-hidden="true" />
                {tab.label}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
