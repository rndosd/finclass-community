import React, { useMemo } from "react";
import { HomeCardFrame, HomeCardHeading, HomeCardAction } from "./HomeCardChrome";
import { CaretRightIcon, ChartBarIcon } from "@phosphor-icons/react";
import creditScoreShieldIllustration from "../../../assets/dashboard/home-credit-v2.webp";
import { formatCreditScore, normalizeCreditScore } from "../../credit/utils/tierUtils";
import { getHomeCreditPalette } from "./homeCreditPalette";
const HomeCreditCard = ({
  creditScore,
  tierInfo,
  tierCriteria = [],
  onOpenCreditPage,
  displayVariant = "featured"
}) => {
  const hasTierProgress = normalizeCreditScore(creditScore) !== null && Array.isArray(tierCriteria) && tierCriteria.length > 0 && tierInfo?.minScore != null;
  const {
    nextTierMinScore,
    progressPercentage,
    pointsToNext
  } = useMemo(() => {
    if (!hasTierProgress) {
      return {
        nextTierMinScore: null,
        progressPercentage: 0,
        pointsToNext: 0
      };
    }
    const sortedCriteria = [...tierCriteria].sort((a, b) => Number(b?.minScore || 0) - Number(a?.minScore || 0));
    const currentTierIndex = sortedCriteria.findIndex(tier => tier.id === tierInfo.id);
    if (currentTierIndex === -1) {
      return {
        nextTierMinScore: null,
        progressPercentage: 0,
        pointsToNext: 0
      };
    }
    const nextTier = currentTierIndex > 0 ? sortedCriteria[currentTierIndex - 1] : null;
    const nextTierMin = nextTier?.minScore || null;
    if (!nextTierMin) {
      return {
        nextTierMinScore: null,
        progressPercentage: 100,
        pointsToNext: 0
      };
    }
    const currentTierMin = Number(tierInfo.minScore || 0);
    const rangeSize = Math.max(1, Number(nextTierMin) - currentTierMin);
    const currentProgress = Number(creditScore || 0) - currentTierMin;
    return {
      nextTierMinScore: Number(nextTierMin),
      progressPercentage: Math.min(100, Math.max(0, currentProgress / rangeSize * 100)),
      pointsToNext: Math.max(0, Number(nextTierMin) - Number(creditScore || 0))
    };
  }, [creditScore, hasTierProgress, tierCriteria, tierInfo]);
  return <HomeCardFrame type="credit" displayVariant={displayVariant} style={getHomeCreditPalette(tierInfo?.color)}>
    <HomeCardHeading icon={ChartBarIcon}>신용 점수</HomeCardHeading>
    <img className="fc-home-art fc-home-credit-art" src={creditScoreShieldIllustration} alt="" decoding="async"/>
    <div className="fc-home-credit-summary"><p className="fc-home-muted">현재 신용 등급</p><strong className="fc-home-tier" style={{
        color: 'var(--credit-tier-color)'
      }}>{tierInfo?.name || '미설정'}</strong><div className="fc-home-credit-value">{formatCreditScore(creditScore)}{normalizeCreditScore(creditScore) !== null && <small>점</small>}</div></div>
    <div><div className="fc-home-progress-label"><span>현재 등급 진행도</span><span>{!hasTierProgress ? '기준 확인 중' : nextTierMinScore ? '다음 등급까지 ' + pointsToNext + '점' : '최고 등급'}</span></div><progress className="fc-home-progress" max="100" value={hasTierProgress ? progressPercentage : 0} aria-label="신용 등급 진행도" /><div className="fc-home-progress-caption"><span>{formatCreditScore(creditScore)}{normalizeCreditScore(creditScore) !== null ? '점' : ''}</span><span>{!hasTierProgress ? '기준 확인 중' : nextTierMinScore ? nextTierMinScore + '점' : '최고 등급'}</span></div></div>
    <HomeCardAction icon={CaretRightIcon} onClick={event => {
      event.preventDefault();
      event.stopPropagation();
      onOpenCreditPage?.();
    }}>내 신용 보기</HomeCardAction>
  </HomeCardFrame>;
};
export default HomeCreditCard;
