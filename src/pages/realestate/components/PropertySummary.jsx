import React from 'react';
import { User, Users } from '@phosphor-icons/react';
import { useNumberFormat } from '../../../contexts/NumberFormatContext';

const PropertySummary = ({ desk, price, currencyUnit, status }) => {
  const { formatClassCurrency } = useNumberFormat();
  return (
    <section aria-label="자리 요약" className="w-full min-w-0">
      {status && <p className={`mb-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${status.tone === 'overdue' ? 'bg-red-700 text-white' : 'bg-indigo-100 text-indigo-800'}`}>{status.label}</p>}
      <div className="pb-7 pt-2">
        <p className="text-base font-semibold text-slate-500">현재 가격</p>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className="min-w-0 break-all text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 tabular-nums">{formatClassCurrency(price)}</p>{currencyUnit && <span className="text-xl font-semibold text-slate-500">{currencyUnit}</span>}</div>
      </div>
      <dl className="border-t border-slate-200">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 py-5">
          <dt className="flex shrink-0 items-center gap-2 text-base text-slate-500"><User size={22} />소유자</dt>
          <dd className="min-w-0 break-words text-right text-lg font-bold text-blue-700">{desk.ownerName || '국가'}</dd>
        </div>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 py-5">
          <dt className="flex shrink-0 items-center gap-2 text-base text-slate-500"><Users size={22} />앉은 학생</dt>
          <dd className="min-w-0 break-words text-right text-lg font-bold text-slate-900">{desk.studentName || '미배정'}</dd>
        </div>
      </dl>

    </section>
  );
};

export default PropertySummary;
