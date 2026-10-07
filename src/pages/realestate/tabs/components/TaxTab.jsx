import React from 'react';
import { Coins, Landmark, Percent, ToggleLeft, ToggleRight, Wallet } from 'lucide-react';
import { formatDateInKST } from '../../../../utils/kstDate';

const TaxTab = ({
  isConfigEnabled,
  acquisitionTaxEnabled,
  setAcquisitionTaxEnabled,
  acquisitionTaxRate,
  setAcquisitionTaxRate,
  capitalGainsTaxEnabled,
  setCapitalGainsTaxEnabled,
  capitalGainsTaxRate,
  setCapitalGainsTaxRate,
  officialPriceRatio,
  setOfficialPriceRatio,
  rentLimitEnabled,
  setRentLimitEnabled,
  rentLimitRate,
  setRentLimitRate,
  rentTaxEnabled,
  setRentTaxEnabled,
  rentTaxRate,
  setRentTaxRate,
  holdingTaxEnabled,
  setHoldingTaxEnabled,
  holdingTaxRate,
  setHoldingTaxRate,
  holdingTaxCutoverAt,
}) => {
  const holdingTaxCutoverLabel = holdingTaxCutoverAt
    ? formatDateInKST(holdingTaxCutoverAt)
    : '설정 저장 시 자동 확정';
  return (
    <div className="mx-auto max-w-2xl space-y-10 pb-10">
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <Landmark size={20} className="text-amber-600" /> 공시지가 설정
        </h3>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <label className="block text-sm font-bold text-slate-700">공시지가 비율</label>
              <p className="mt-1 text-xs text-slate-400">
                최근 거래가(시세) 대비 공시지가 비율입니다.
                <br />예: 시세 10,000에 비율 70%면 공시지가는 7,000입니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={officialPriceRatio}
              onChange={(event) => setOfficialPriceRatio(Number(event.target.value))}
              disabled={!isConfigEnabled}
              className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-amber-200 accent-amber-500 disabled:opacity-50"
            />
            <div className="flex min-w-[80px] items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-2">
              <input
                type="number"
                min="10"
                max="100"
                value={officialPriceRatio}
                onChange={(event) => setOfficialPriceRatio(Number(event.target.value))}
                disabled={!isConfigEnabled}
                className="w-12 bg-transparent text-right text-lg font-bold outline-none disabled:text-slate-400"
              />
              <span className="font-bold text-amber-600">%</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-1 rounded-lg bg-amber-100 p-2 text-xs text-amber-700">
            <Coins size={12} />
            <span>공시지가는 보유세와 임대 상한 계산의 기준값으로 사용됩니다.</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <Percent size={20} className="text-blue-600" /> 부동산 거래 세금
        </h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className={`rounded-xl border p-5 transition-all ${
            acquisitionTaxEnabled
              ? 'border-blue-200 bg-white ring-2 ring-blue-50'
              : 'border-slate-200 bg-slate-50'
          }`}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <label className="block text-sm font-bold text-slate-700">취득세(구매자)</label>
                <p className="mt-1 text-xs text-slate-400">구매자가 추가로 내는 세금입니다.</p>
              </div>
              <div
                onClick={() => isConfigEnabled && setAcquisitionTaxEnabled(!acquisitionTaxEnabled)}
                className={`cursor-pointer transition-colors ${
                  !isConfigEnabled ? 'cursor-not-allowed opacity-50' : ''
                } ${acquisitionTaxEnabled ? 'text-blue-600' : 'text-slate-300'}`}
              >
                {acquisitionTaxEnabled ? <ToggleRight size={32} className="fill-blue-100" /> : <ToggleLeft size={32} />}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={acquisitionTaxRate}
                onChange={(event) => setAcquisitionTaxRate(event.target.value)}
                disabled={!isConfigEnabled || !acquisitionTaxEnabled}
                className="w-full rounded-xl border p-3 text-right text-lg font-bold outline-none transition-colors focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400"
              />
              <span className={`font-bold ${acquisitionTaxEnabled ? 'text-slate-600' : 'text-slate-300'}`}>%</span>
            </div>
          </div>

          <div className={`rounded-xl border p-5 transition-all ${
            capitalGainsTaxEnabled
              ? 'border-emerald-200 bg-white ring-2 ring-emerald-50'
              : 'border-slate-200 bg-slate-50'
          }`}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <label className="block text-sm font-bold text-slate-700">양도소득세(매도자)</label>
                <p className="mt-1 text-xs text-slate-400">매도 차익이 생기면 부과할 수 있습니다.</p>
              </div>
              <div
                onClick={() => isConfigEnabled && setCapitalGainsTaxEnabled(!capitalGainsTaxEnabled)}
                className={`cursor-pointer transition-colors ${
                  !isConfigEnabled ? 'cursor-not-allowed opacity-50' : ''
                } ${capitalGainsTaxEnabled ? 'text-emerald-600' : 'text-slate-300'}`}
              >
                {capitalGainsTaxEnabled ? <ToggleRight size={32} className="fill-emerald-100" /> : <ToggleLeft size={32} />}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={capitalGainsTaxRate}
                onChange={(event) => setCapitalGainsTaxRate(event.target.value)}
                disabled={!isConfigEnabled || !capitalGainsTaxEnabled}
                className="w-full rounded-xl border p-3 text-right text-lg font-bold outline-none transition-colors focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-100 disabled:text-slate-400"
              />
              <span className={`font-bold ${capitalGainsTaxEnabled ? 'text-slate-600' : 'text-slate-300'}`}>%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <Wallet size={20} className="text-indigo-600" /> 임대 관련 정책
        </h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className={`rounded-xl border p-5 transition-all ${
            rentLimitEnabled
              ? 'border-indigo-200 bg-white ring-2 ring-indigo-50'
              : 'border-slate-200 bg-slate-50'
          }`}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <label className="block text-sm font-bold text-slate-700">임대료 상한(주간)</label>
                <p className="mt-1 text-xs text-slate-400">공시지가 대비 1주 최대 임대료 비율입니다.</p>
              </div>
              <div
                onClick={() => isConfigEnabled && setRentLimitEnabled(!rentLimitEnabled)}
                className={`cursor-pointer transition-colors ${
                  !isConfigEnabled ? 'cursor-not-allowed opacity-50' : ''
                } ${rentLimitEnabled ? 'text-indigo-600' : 'text-slate-300'}`}
              >
                {rentLimitEnabled ? <ToggleRight size={32} className="fill-indigo-100" /> : <ToggleLeft size={32} />}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={rentLimitRate}
                onChange={(event) => setRentLimitRate(event.target.value)}
                disabled={!isConfigEnabled || !rentLimitEnabled}
                className="w-full rounded-xl border p-3 text-right text-lg font-bold outline-none transition-colors focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100 disabled:text-slate-400"
              />
              <span className={`font-bold ${rentLimitEnabled ? 'text-slate-600' : 'text-slate-300'}`}>%</span>
            </div>
            <div className="mt-2 text-right text-[10px] text-slate-400">
              예: 공시지가 1,000에 10%면 최대 임대료는 주당 100입니다.
            </div>
          </div>

          <div className={`rounded-xl border p-5 transition-all ${
            rentTaxEnabled
              ? 'border-rose-200 bg-white ring-2 ring-rose-50'
              : 'border-slate-200 bg-slate-50'
          }`}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <label className="block text-sm font-bold text-slate-700">임대소득세</label>
                <p className="mt-1 text-xs text-slate-400">임대 수익에서 자동 공제되는 세금입니다.</p>
              </div>
              <div
                onClick={() => isConfigEnabled && setRentTaxEnabled(!rentTaxEnabled)}
                className={`cursor-pointer transition-colors ${
                  !isConfigEnabled ? 'cursor-not-allowed opacity-50' : ''
                } ${rentTaxEnabled ? 'text-rose-600' : 'text-slate-300'}`}
              >
                {rentTaxEnabled ? <ToggleRight size={32} className="fill-rose-100" /> : <ToggleLeft size={32} />}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={rentTaxRate}
                onChange={(event) => setRentTaxRate(event.target.value)}
                disabled={!isConfigEnabled || !rentTaxEnabled}
                className="w-full rounded-xl border p-3 text-right text-lg font-bold outline-none transition-colors focus:ring-2 focus:ring-rose-200 disabled:bg-slate-100 disabled:text-slate-400"
              />
              <span className={`font-bold ${rentTaxEnabled ? 'text-slate-600' : 'text-slate-300'}`}>%</span>
            </div>
            <div className="mt-2 text-right text-[10px] text-slate-400">임대료 수익이 발생할 때 자동으로 차감됩니다.</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <Coins size={20} className="text-orange-600" /> 보유세 정책
        </h3>
        <div className={`rounded-xl border p-5 transition-all ${
          holdingTaxEnabled
            ? 'border-orange-200 bg-white ring-2 ring-orange-50'
            : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700">기간 보유세(일할 계산)</label>
              <p className="mt-1 text-xs text-slate-400">
                교사가 정한 과세 기간 동안 실제로 보유한 일수만큼 보유세를 계산합니다.
                <br />새 계산 시작일은 첫 저장 시 자동으로 정해지고, 그 이전 이력은 계산하지 않습니다.
              </p>
            </div>
            <div
              onClick={() => isConfigEnabled && setHoldingTaxEnabled(!holdingTaxEnabled)}
              className={`cursor-pointer transition-colors ${
                !isConfigEnabled ? 'cursor-not-allowed opacity-50' : ''
              } ${holdingTaxEnabled ? 'text-orange-600' : 'text-slate-300'}`}
            >
              {holdingTaxEnabled ? <ToggleRight size={32} className="fill-orange-100" /> : <ToggleLeft size={32} />}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.1"
              value={holdingTaxRate}
              onChange={(event) => setHoldingTaxRate(event.target.value)}
              disabled={!isConfigEnabled || !holdingTaxEnabled}
              className="w-full rounded-xl border p-3 text-right text-lg font-bold outline-none transition-colors focus:ring-2 focus:ring-orange-200 disabled:bg-slate-100 disabled:text-slate-400"
            />
            <span className={`font-bold ${holdingTaxEnabled ? 'text-slate-600' : 'text-slate-300'}`}>%</span>
          </div>

          <div className="mt-3 space-y-2">
            <div className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">
              계산식: 공시가 × 주간 세율 × (과세일수 / 7)
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              새 계산 시작일: <span className="font-bold text-slate-800">{holdingTaxCutoverLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaxTab;