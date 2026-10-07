import React, { useEffect, useState } from 'react';
import { Power, Save } from 'lucide-react';
import { Button, ToggleSwitch } from '../../../components/ui';
import TaxTab from './components/TaxTab';
import { getDefaultSaleSpecialTerms } from '../utils/contractTemplate';

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeConfigForForm = (raw) => {
  const data = raw || {};
  return {
    enabled: data.enabled !== false,
    acquisitionTaxEnabled: data.acquisitionTaxEnabled !== false,
    acquisitionTaxRate: toNumber(data.acquisitionTaxRate, 0),
    capitalGainsTaxEnabled: data.capitalGainsTaxEnabled !== false,
    capitalGainsTaxRate: toNumber(data.capitalGainsTaxRate, 0),
    officialPriceRatio: toNumber(data.officialPriceRatio, 70),
    rentLimitEnabled: data.rentLimitEnabled !== false,
    rentLimitRate: toNumber(data.rentLimitRate, 0),
    rentTaxEnabled: data.rentTaxEnabled !== false,
    rentTaxRate: toNumber(data.rentTaxRate, 0),
    holdingTaxEnabled: data.holdingTaxEnabled === true,
    holdingTaxRate: toNumber(data.holdingTaxRate, 0),
    holdingTaxCutoverAt: data?.holdingTaxCutoverAt || null,
    saleTemplate: typeof data.saleTemplate === 'string' ? data.saleTemplate : '',
    saleSpecialTerms:
      typeof data.saleSpecialTerms === 'string' && data.saleSpecialTerms.trim().length > 0
        ? data.saleSpecialTerms
        : getDefaultSaleSpecialTerms(),
  };
};

const AdminRealEstateSettings = ({
  initialConfig,
  onSave,
  saving = false,
}) => {
  const [isConfigEnabled, setIsConfigEnabled] = useState(true);
  const [acquisitionTaxEnabled, setAcquisitionTaxEnabled] = useState(true);
  const [acquisitionTaxRate, setAcquisitionTaxRate] = useState(0);
  const [capitalGainsTaxEnabled, setCapitalGainsTaxEnabled] = useState(true);
  const [capitalGainsTaxRate, setCapitalGainsTaxRate] = useState(0);
  const [officialPriceRatio, setOfficialPriceRatio] = useState(70);
  const [rentLimitEnabled, setRentLimitEnabled] = useState(true);
  const [rentLimitRate, setRentLimitRate] = useState(0);
  const [rentTaxEnabled, setRentTaxEnabled] = useState(true);
  const [rentTaxRate, setRentTaxRate] = useState(0);
  const [holdingTaxEnabled, setHoldingTaxEnabled] = useState(false);
  const [holdingTaxRate, setHoldingTaxRate] = useState(0);
  const [holdingTaxCutoverAt, setHoldingTaxCutoverAt] = useState(null);

  useEffect(() => {
    const normalized = normalizeConfigForForm(initialConfig);
    setIsConfigEnabled(normalized.enabled);
    setAcquisitionTaxEnabled(normalized.acquisitionTaxEnabled);
    setAcquisitionTaxRate(normalized.acquisitionTaxRate);
    setCapitalGainsTaxEnabled(normalized.capitalGainsTaxEnabled);
    setCapitalGainsTaxRate(normalized.capitalGainsTaxRate);
    setOfficialPriceRatio(normalized.officialPriceRatio);
    setRentLimitEnabled(normalized.rentLimitEnabled);
    setRentLimitRate(normalized.rentLimitRate);
    setRentTaxEnabled(normalized.rentTaxEnabled);
    setRentTaxRate(normalized.rentTaxRate);
    setHoldingTaxEnabled(normalized.holdingTaxEnabled);
    setHoldingTaxRate(normalized.holdingTaxRate);
    setHoldingTaxCutoverAt(normalized.holdingTaxCutoverAt);
  }, [initialConfig]);

  const handleSave = async () => {
    const payload = {
      enabled: isConfigEnabled,
      acquisitionTaxEnabled,
      acquisitionTaxRate: toNumber(acquisitionTaxRate, 0),
      capitalGainsTaxEnabled,
      capitalGainsTaxRate: toNumber(capitalGainsTaxRate, 0),
      officialPriceRatio: toNumber(officialPriceRatio, 70),
      rentLimitEnabled,
      rentLimitRate: toNumber(rentLimitRate, 0),
      rentTaxEnabled,
      rentTaxRate: toNumber(rentTaxRate, 0),
      holdingTaxEnabled,
      holdingTaxRate: toNumber(holdingTaxRate, 0),
      holdingTaxCutoverAt,
      saleTemplate:
        typeof initialConfig?.saleTemplate === 'string'
          ? initialConfig.saleTemplate
          : '',
      saleSpecialTerms:
        typeof initialConfig?.saleSpecialTerms === 'string' &&
        initialConfig.saleSpecialTerms.trim().length > 0
          ? initialConfig.saleSpecialTerms
          : getDefaultSaleSpecialTerms(),
    };
    await onSave?.(payload);
  };

  return (
    <div className="relative flex min-h-[600px] w-full flex-col overflow-hidden rounded-xl bg-white shadow-sm animate-fadeIn">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 p-4">
        <div className="flex items-center gap-3">
          <div className={`rounded-full p-2 ${isConfigEnabled ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'}`}>
            <Power size={20} />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">부동산 시스템 활성화</h3>
            <p className="text-xs text-slate-500">
              기능을 끄면 학생들이 부동산 거래와 임대 기능을 사용할 수 없습니다.
            </p>
          </div>
        </div>
        <ToggleSwitch
          checked={isConfigEnabled}
          onChange={setIsConfigEnabled}
          tone="blue"
          srLabel="부동산 시스템 활성화"
        />
      </div>

      <div className={`flex-1 p-6 transition-opacity duration-300 ${!isConfigEnabled ? 'pointer-events-none opacity-50 grayscale' : ''}`}>
        <TaxTab
            isConfigEnabled={isConfigEnabled}
            acquisitionTaxEnabled={acquisitionTaxEnabled}
            setAcquisitionTaxEnabled={setAcquisitionTaxEnabled}
            acquisitionTaxRate={acquisitionTaxRate}
            setAcquisitionTaxRate={setAcquisitionTaxRate}
            capitalGainsTaxEnabled={capitalGainsTaxEnabled}
            setCapitalGainsTaxEnabled={setCapitalGainsTaxEnabled}
            capitalGainsTaxRate={capitalGainsTaxRate}
            setCapitalGainsTaxRate={setCapitalGainsTaxRate}
            officialPriceRatio={officialPriceRatio}
            setOfficialPriceRatio={setOfficialPriceRatio}
            rentLimitEnabled={rentLimitEnabled}
            setRentLimitEnabled={setRentLimitEnabled}
            rentLimitRate={rentLimitRate}
            setRentLimitRate={setRentLimitRate}
            rentTaxEnabled={rentTaxEnabled}
            setRentTaxEnabled={setRentTaxEnabled}
            rentTaxRate={rentTaxRate}
            setRentTaxRate={setRentTaxRate}
            holdingTaxEnabled={holdingTaxEnabled}
            setHoldingTaxEnabled={setHoldingTaxEnabled}
            holdingTaxRate={holdingTaxRate}
            setHoldingTaxRate={setHoldingTaxRate}
            holdingTaxCutoverAt={holdingTaxCutoverAt}
          />
      </div>

      <div className="sticky bottom-0 z-10 flex justify-end border-t bg-slate-50 p-4">
        <Button
          icon={Save}
          tone="slate"
          size="lg"
          onClick={handleSave}
          disabled={saving}
          
        >
          {saving ? '저장 중...' : '설정 저장하기'}
        </Button>
      </div>
    </div>
  );
};

export default AdminRealEstateSettings;
