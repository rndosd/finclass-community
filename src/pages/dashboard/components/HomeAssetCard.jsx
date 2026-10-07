import React, { memo, useMemo } from "react";
import { EyeIcon, BriefcaseIcon, BankIcon, TrendDownIcon, TrendUpIcon, WalletIcon } from "@phosphor-icons/react";
import { Spinner } from "../../../components/ui";
import dashboardWalletIllustration from "../../../assets/dashboard/home-wallet-v2.webp";
import { useNumberFormat } from "../../../contexts/NumberFormatContext";
import { useUser } from "../../../contexts/UserContext";
import { useJobDefinitionsQuery } from "../../../hooks/tax/useJobInfo";
import { HomeCardFrame, HomeCardHeading, HomeCardAction } from "./HomeCardChrome";
const HomeAssetCard = ({
  assets,
  currencyUnit,
  userData,
  onOpenAssets,
  displayVariant = "featured"
}) => {
  const {
    classId,
    loading: userLoading
  } = useUser();
  const {
    data: jobDefinitions = []
  } = useJobDefinitionsQuery(classId);
  const {
        formatClassCurrency,
    formatPercent
  } = useNumberFormat();
  const {
    totalNetWorth = 0,
    cash = 0,
    deposit = 0,
    itemValue = 0,
    realEstateValue = 0,
    usdBalance = 0,
    stockValue = {},
    changeRate = 0
  } = assets || {};
  const activeJobs = useMemo(() => {
    const jobs = userData?.jobs || (userData?.job ? [userData.job] : []);
    return Array.isArray(jobs) ? jobs.filter(name => name && !["없음", "무직"].includes(name)) : [];
  }, [userData]);
  const totalWeeklySalary = useMemo(() => {
    const cachedSalary = Number(userData?.payroll?.currentWeeklySalary);
    if (Number.isFinite(cachedSalary)) return cachedSalary;
    if (!activeJobs.length || !Array.isArray(jobDefinitions)) return 0;
    return activeJobs.reduce((sum, jobName) => {
      const jobDefinition = jobDefinitions.find(job => job.name === jobName);
      return sum + Number(jobDefinition?.baseSalary || 0);
    }, 0);
  }, [activeJobs, jobDefinitions, userData?.payroll?.currentWeeklySalary]);
  const assetComposition = useMemo(() => {
    const exchangeRate = Math.max(Number(stockValue?.lastConversionRate || 1), 1);
    const foreignInvestmentValue = Math.max(0, (Number(usdBalance || 0) + Number(stockValue?.value || 0)) / exchangeRate);
    const segments = [{
      label: "현금",
      value: Math.max(0, Number(cash || 0)),
      color: "bg-slate-400"
    }, {
      label: "예금",
      value: Math.max(0, Number(deposit || 0)),
      color: "bg-blue-500"
    }, {
      label: "외화·주식",
      value: foreignInvestmentValue,
      color: "bg-emerald-500"
    }, {
      label: "부동산",
      value: Math.max(0, Number(realEstateValue || 0)),
      color: "bg-violet-500"
    }, {
      label: "아이템",
      value: Math.max(0, Number(itemValue || 0)),
      color: "bg-amber-400"
    }].filter(segment => segment.label !== "부동산" || segment.value > 0);
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);
    return {
      total,
      segments: segments.map(segment => ({
        ...segment,
        percentage: total > 0 ? segment.value / total * 100 : 0
      }))
    };
  }, [cash, deposit, itemValue, realEstateValue, stockValue?.lastConversionRate, stockValue?.value, usdBalance]);
  const displayJobName = activeJobs.length > 0 ? activeJobs.join(", ") : "무직";
  return <HomeCardFrame type="asset" displayVariant={displayVariant}>
    <HomeCardHeading icon={WalletIcon}>내 자산</HomeCardHeading>
    <img className="fc-home-art fc-home-wallet-art" src={dashboardWalletIllustration} alt="" decoding="async" />
    <div className="fc-home-asset-summary">
      <p className="fc-home-muted">총 순자산 (주식 포함)</p>
      {userLoading ? <div className="flex items-center gap-2 py-3"><Spinner size="sm" /><span className="fc-home-muted">계산 중...</span></div> : <div className="fc-home-amount"><strong>{formatClassCurrency(totalNetWorth)}</strong><span>{currencyUnit}</span></div>}
      {changeRate !== 0 && <p className={"fc-home-change mt-2 " + (changeRate >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{changeRate >= 0 ? <TrendUpIcon size={14} /> : <TrendDownIcon size={14} />}어제보다 {formatPercent(Math.abs(changeRate), {
          fractionDigits: 1
        })}% {changeRate >= 0 ? '상승' : '하락'}</p>}
    </div>
    <div className="fc-home-job-strip"><div><BriefcaseIcon size={19} /><div><small>나의 직업</small><strong>{displayJobName}</strong></div></div><div><BankIcon size={19} /><div><small>주급</small><strong>{formatClassCurrency(totalWeeklySalary)}<em>{currencyUnit}</em></strong></div></div></div>
    {<div className="fc-home-composition" aria-label="자산 구성">{assetComposition.segments.map(segment => <span key={segment.label}><i className={segment.color} aria-hidden="true" />{segment.label} {Math.round(segment.percentage)}%</span>)}</div>}
    <HomeCardAction icon={EyeIcon} onClick={onOpenAssets}>내 자산 보기</HomeCardAction>
  </HomeCardFrame>;
};
export default memo(HomeAssetCard);
