// src/pages/police/utils/textLength.js

/**
 * 맞춤법 검사기 스타일 글자 수 계산:
 * - NFC 정규화 (동일 음절은 한 글자로)
 * - 개행/탭 등 모든 공백을 ' '로 치환 후, 연속 공백은 1칸으로 축약
 * - 코드포인트 기준(Array.from)으로 길이 계산
 * - withSpace: 공백 포함, withoutSpace: 공백 제외
 */
export const spellcheckLength = (input = '') => {
    // 1) 문자열화 + NFC 정규화
    let s = String(input ?? '').normalize('NFC');

    // 2) 모든 공백(개행/탭 포함)을 스페이스로 치환
    s = s.replace(/\s/g, ' ');

    // 3) 연속 공백 하나로 축약
    s = s.replace(/ {2,}/g, ' ');

    // 4) 앞뒤 공백 정리(많은 검사기가 앞뒤 공백은 의미 없는 것으로 취급)
    const trimmed = s.trim();

    // 5) 코드포인트 기준 길이
    const withSpace = Array.from(trimmed).length;
    const withoutSpace = Array.from(trimmed.replace(/ /g, '')).length;

    return { withSpace, withoutSpace };
};

/** 임계 체크(공백 포함 기준) */
export const meetsMinCharsWithSpace = (input, min = 30) => {
    return spellcheckLength(input).withSpace >= min;
};
