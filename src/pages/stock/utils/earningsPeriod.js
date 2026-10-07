export function getEarningsPeriodCopy(metricName, availableCount, isAnnualData) {
  if (isAnnualData) return {
    title: `최근 연간 ${metricName}`,
    hint: availableCount ? "회사 공식 연간 자료" : "연간 자료에 해당 지표가 없습니다",
  };
  return {
    title: `확보된 분기 ${metricName}`,
    hint: availableCount ? `${availableCount}개 분기 합산 · 확보된 자료 기준` : "확보된 분기에 해당 지표가 없습니다",
  };
}
