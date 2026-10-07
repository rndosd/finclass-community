import { getTierInfoByScore, normalizeCreditScore } from "./tierUtils";

export function buildCurrentCreditDistribution(students = [], tierCriteria = []) {
  const tiers = tierCriteria.filter((tier) => normalizeCreditScore(tier.minScore) !== null)
    .sort((a, b) => Number(b.minScore) - Number(a.minScore));
  if (!tiers.length) return [];
  const rows = tiers.map((tier) => ({ band: tier.id, label: tier.name, count: 0, minScore: Number(tier.minScore) }));
  const unknown = { band: "unset", label: "점수 미설정", count: 0 };
  for (const student of students) {
    if (!student || student.role === "teacher") continue;
    if (normalizeCreditScore(student.creditScore) === null) {
      unknown.count += 1;
      continue;
    }
    const tier = getTierInfoByScore(student.creditScore, tiers);
    const row = rows.find((entry) => entry.band === tier.id);
    if (row) row.count += 1;
  }
  return unknown.count ? [...rows, unknown] : rows;
}
