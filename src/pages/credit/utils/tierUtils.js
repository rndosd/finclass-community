// src/pages/credit/utils/tierUtils.js

export function normalizeCreditScore(score) {
    if (score === undefined || score === null || String(score).trim() === '') return null;
    const value = Number(score);
    return Number.isFinite(value) ? value : null;
}

export function formatCreditScore(score) {
    const value = normalizeCreditScore(score);
    return value === null ? '미설정' : value.toLocaleString('ko-KR');
}

export function getTierInfoByScore(score, tierCriteria = []) {
    if (score === undefined || score === null || String(score).trim() === '') {
        return { name: '점수 미설정', color: '#64748b' };
    }
    if (!Array.isArray(tierCriteria) || tierCriteria.length === 0) {
        return { name: '등급 미설정', color: '#64748b' };
    }

    const numericScore = normalizeCreditScore(score);
    if (numericScore === null) {
        return { name: '점수 오류', color: '#ef4444' };
    }

    const sortedCriteria = [...tierCriteria].sort((a, b) => Number(b.minScore) - Number(a.minScore));
    for (const tier of sortedCriteria) {
        if (numericScore >= Number(tier.minScore)) {
            return tier;
        }
    }

    return sortedCriteria[sortedCriteria.length - 1] || { name: '등급 없음', color: '#64748b' };
}

function getGradientColor(index, total) {
    const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#dc2626'];
    return colors[index % total];
}

export const TIER_TEMPLATES = {
    numeric: {
        name: '숫자 등급 (1~10등급)',
        description: '1등급이 가장 높은 등급입니다.',
        tiers: Array.from({ length: 10 }, (_, i) => ({
            id: `numeric_${10 - i}`,
            name: `${10 - i}등급`,
            color: getGradientColor(9 - i, 10),
            minScore: i * 100,
        })).sort((a, b) => b.minScore - a.minScore),
    },
    game: {
        name: '게임 등급 (7단계)',
        description: '챌린저가 가장 높은 등급입니다.',
        tiers: [
            { id: 'game_challenger', name: '챌린저', color: '#fbbf24', minScore: 1000 },
            { id: 'game_master', name: '마스터', color: '#9333ea', minScore: 850 },
            { id: 'game_diamond', name: '다이아몬드', color: '#06b6d4', minScore: 700 },
            { id: 'game_gold', name: '골드', color: '#eab308', minScore: 550 },
            { id: 'game_silver', name: '실버', color: '#64748b', minScore: 400 },
            { id: 'game_bronze', name: '브론즈', color: '#d97706', minScore: 250 },
            { id: 'game_iron', name: '아이언', color: '#475569', minScore: 0 },
        ],
    },
};

export const COLOR_PRESETS = [
    { name: '빨강', value: '#ef4444' },
    { name: '주황', value: '#f97316' },
    { name: '노랑', value: '#eab308' },
    { name: '연두', value: '#84cc16' },
    { name: '초록', value: '#22c55e' },
    { name: '청록', value: '#10b981' },
    { name: '하늘', value: '#06b6d4' },
    { name: '파랑', value: '#3b82f6' },
    { name: '보라', value: '#8b5cf6' },
    { name: '분홍', value: '#ec4899' },
    { name: '회색', value: '#64748b' },
    { name: '검정', value: '#1f2937' },
];

function parseTierMinScore(minScore) {
    if (minScore === '' || minScore === null || minScore === undefined) {
        return null;
    }

    const numericScore = Number(minScore);
    return Number.isFinite(numericScore) ? numericScore : null;
}

export function validateTiers(tiers) {
    const errors = [];

    if (!Array.isArray(tiers) || tiers.length === 0) {
        errors.push({ id: 'global', field: 'array', message: '최소 1개의 등급이 필요합니다.' });
        return { isValid: false, errors };
    }

    if (!tiers.some(tier => parseTierMinScore(tier.minScore) === 0)) {
        errors.push({ id: 'global', field: 'minScore', message: '가장 낮은 등급의 시작 점수는 0점이어야 합니다.' });
    }

    const names = new Map();
    const scores = new Map();

    tiers.forEach((tier) => {
        if (!tier.name?.trim()) {
            errors.push({ id: tier.id, field: 'name', message: '등급명이 비어있습니다.' });
        } else {
            const trimmedName = tier.name.trim();
            if (names.has(trimmedName)) {
                errors.push({ id: tier.id, field: 'name', message: '등급명이 중복됩니다.' });
                errors.push({ id: names.get(trimmedName), field: 'name', message: '등급명이 중복됩니다.' });
            }
            names.set(trimmedName, tier.id);
        }

        const parsedMinScore = parseTierMinScore(tier.minScore);
        if (parsedMinScore === null || parsedMinScore < 0) {
            errors.push({ id: tier.id, field: 'minScore', message: '유효하지 않은 점수입니다.' });
        } else {
            if (scores.has(parsedMinScore)) {
                errors.push({ id: tier.id, field: 'minScore', message: '최소 점수가 중복됩니다.' });
                errors.push({ id: scores.get(parsedMinScore), field: 'minScore', message: '최소 점수가 중복됩니다.' });
            }
            scores.set(parsedMinScore, tier.id);
        }

        if (!tier.color || !/^#([0-9A-Fa-f]{3}){1,2}$/.test(tier.color)) {
            errors.push({ id: tier.id, field: 'color', message: '유효한 HEX 색상을 선택해야 합니다.' });
        }
    });

    return { isValid: errors.length === 0, errors };
}
