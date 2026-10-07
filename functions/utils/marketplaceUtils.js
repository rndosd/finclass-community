// functions/src/utils/marketplaceUtils.js
"use strict";

const admin = require("../firebaseAdminCompat");
const FieldValue = admin.firestore.FieldValue;

/**
 * Firestore Timestamp | Date | number(ms) | string → Date
 */
function asDate(v) {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
    if (typeof v === "string") {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

/**
 * 사용 가능 금액 = 자산(cashField) - 예약금(assets.reserved)
 * reserved는 통화 무관 단일 숫자(수업 내 통화 1종 가정)
 */
function getAvailable(assets = {}, currencyField = "cash") {
    const cash = Number(assets?.[currencyField] || 0);
    const reserved = Number(assets?.reserved || 0);
    return cash - reserved;
}

/**
 * assets.{currencyField} 증감
 */
function incCash(tx, userRef, currencyField, delta) {
    tx.update(userRef, {
        [`assets.${currencyField}`]: FieldValue.increment(Number(delta)),
    });
}

/**
 * assets.reserved 증감 (단일 숫자)
 */
function incReserved(tx, userRef, delta) {
    tx.update(userRef, {
        "assets.reserved": FieldValue.increment(Number(delta)),
    });
}

/**
 * 입찰단위(틱) 계산
 * 기본 규칙: 1 / 5 / 10 / 20 / 30 (가격 구간에 따라 증가)
 * 필요 시 클래스 설정으로 확장 가능.
 */
function bidTickFor(amount) {
    const a = Number(amount || 0);
    if (a < 100) return 1;
    if (a < 500) return 5;
    if (a < 1000) return 10;
    if (a < 5000) return 20;
    return 30;
}

/**
 * 공개 경매: 현재가 + 틱, 단 현재가가 없으면 시작가 이상에서 시작
 * 블라인드: 시작가 이상이면 OK (틱 개념 없음)
 */
function getMinNextBid(startPrice = 0, currentHighestBid = 0, isBlind = false) {
    const sp = Number(startPrice || 0);
    const chb = Number(currentHighestBid || 0);

    if (isBlind) {
        return sp; // 블라인드는 시작가 이상이면 허용
    }

    if (!chb || chb < sp) {
        // 최초 유효 입찰가
        // 정책에 따라 sp + tick을 요구하려면 아래 라인으로 교체 가능:
        // return sp + bidTickFor(sp);
        return sp;
    }
    return chb + bidTickFor(chb);
}

module.exports = {
    asDate,
    getAvailable,
    incCash,
    incReserved,
    getMinNextBid,
    bidTickFor,
    FieldValue,
};
