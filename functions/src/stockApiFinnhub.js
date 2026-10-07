// functions/src/stockApiFinnhub.js
//
// Finnhub 기반 시세 및 미국 주요 지수 이력 갱신

const admin = require("../firebaseAdminCompat");
const db = admin.firestore();

// Firebase Functions v2
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const functions = require("firebase-functions"); // 👈 필수 모듈 추가

// 외부 라이브러리
const axios = require("axios");

// Firestore 헬퍼
const { Timestamp } = require("firebase-admin/firestore");

// 프로젝트 유틸리티 함수 (가정된 외부 모듈)
// ⚠️ 이 파일은 외부 모듈이 가정되어 있어 누락 시 에러가 날 수 있습니다.
const {
    fetchAllSymbols,
    getPrefetchContext,
} = require("../utils/prefetchUtils");
const {
    US_INDEX_SYMBOLS,
    buildUsIndexHistoryDocument,
} = require("../utils/usIndexHistory");
const { assertAdminFromClaims } = require("../utils/permissions");

// 상수 (가정된 외부 모듈)
const MARKET_CACHE_COLLECTION = "stockMarketCache";
const QUOTE_SUMMARY_COLLECTION = "stockMarketSummary"; // 앱이 보는 컬렉션 이름으로 통일
const CHART_CACHE_COLLECTION = "stockChartCache";
const US_INDEX_HISTORY_DOC = "us_index_history";
const LOG_CONTEXTS = {
    PREFETCH: "FINNHUB_PREFETCH",
    CHART_CACHE: "FINNHUB_CHART_CACHE",
};

// ────────────────────────────────────────
// 🔐 Finnhub API 키 시크릿
// ────────────────────────────────────────

const finnhubApiKeyParam = defineSecret("FINNHUB_API_KEY");

// ────────────────────────────────────────
// 🔧 로깅 유틸 및 헬퍼 (재정의)
// ────────────────────────────────────────

const logger = {
    error: (context, message, error) =>
        console.error(`[${context}] ${message}:`, error?.message || error),
    warn: (context, message, data) =>
        console.warn(`[${context}] ${message}`, data),
    info: (context, message, data) =>
        console.info(`[${context}] ${message}`, data),
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ────────────────────────────────────────
// 🔧 개별 심볼 시세 처리 (Finnhub /quote) - 기존 로직 유지
// ────────────────────────────────────────

async function processQuoteSymbolFinnhub(symbol, apiKey, batch, summary, targetNY) {
    // ... (이전 코드 유지) ...
    try {
        const url = "https://finnhub.io/api/v1/quote";
        const res = await axios.get(url, {
            params: { symbol, token: apiKey },
            timeout: 8000,
        });

        const q = res.data;
        const CONTEXT = LOG_CONTEXTS.PREFETCH;

        if (!q || typeof q.c !== "number") {
            logger.warn(CONTEXT, `${symbol}의 유효한 시세 데이터가 없습니다.`, q);
            return false;
        }

        const now = Timestamp.now();
        const current = q.c;
        const previousClose = typeof q.pc === "number" ? q.pc : null;

        const dailyHighUSD = typeof q.h === "number" ? q.h : null;
        const dailyLowUSD = typeof q.l === "number" ? q.l : null;
        const openPriceUSD = typeof q.o === "number" ? q.o : null;
        const changeUSD = typeof q.d === "number" ? q.d : null;
        const changePercent = typeof q.dp === "number" ? q.dp : null;
        const volume = 0;

        batch.set(
            db.collection(MARKET_CACHE_COLLECTION).doc(symbol),
            {
                currentPriceUSD: current,
                previousCloseUSD: previousClose,
                dailyHighUSD,
                dailyLowUSD,
                openPriceUSD,
                changeUSD,
                changePercent,
                volume,
                lastFetched: now,
                source: "finnhub",
            },
            { merge: true },
        );

        summary[symbol] = {
            current,
            previousClose,
            name: symbol,
            // Written atomically with both summaries and the market cache.
            prefetchMarketDate: targetNY,
            lastFetched: now,
            source: "finnhub",
            dailyHighUSD,
            dailyLowUSD,
            openPriceUSD,
            changeUSD,
            changePercent,
            volume,
        };

        return true;
    } catch (error) {
        logger.error(LOG_CONTEXTS.PREFETCH, `${symbol} 시세 조회에 실패했습니다.`, {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
        });
        return false;
    }
}

async function persistUsIndexHistory(quotes, marketDate) {
    const docRef = db
        .collection(QUOTE_SUMMARY_COLLECTION)
        .doc(US_INDEX_HISTORY_DOC);

    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        const nextData = buildUsIndexHistoryDocument({
            existingData: snapshot.exists ? snapshot.data() : {},
            quotes,
            marketDate,
            updatedAt: Timestamp.now(),
        });

        transaction.set(docRef, nextData);
    });
}

// ────────────────────────────────────────
// 1. ⏰ 시세 프리페치 스케줄러 - 수정 완료된 버전
// ────────────────────────────────────────
exports.prefetchQuotesFinnhub = onSchedule(
    {
        schedule: "0 7 * * 2-6", // 화~토 07:00 KST (미국장 종가 반영 후)
        timeZone: "Asia/Seoul",
        region: "asia-northeast3",
        timeoutSeconds: 540,
        // Resume unfinished symbols instead of repeating a timed-out full scan.
        retryCount: 3,
        maxRetrySeconds: 1800,
        minBackoffSeconds: 60,
        maxBackoffSeconds: 120,
        memory: "256MiB",
        secrets: [finnhubApiKeyParam],
    },
    async () => {
        const workDeadline = Date.now() + 450000;
        const { targetNY } = getPrefetchContext();
        const apiKey = finnhubApiKeyParam.value();

        if (!apiKey) {
            logger.error(LOG_CONTEXTS.PREFETCH, "Finnhub API 키를 사용할 수 없습니다.");
            return null;
        }

        const symbols = await fetchAllSymbols();
        const totalSymbols = symbols.length;
        if (totalSymbols === 0) return null;
        const dailySummaryRef = db.collection(QUOTE_SUMMARY_COLLECTION).doc(`quotes_${targetNY}`);
        const dailySnapshot = await dailySummaryRef.get();
        const completedQuotes = dailySnapshot.exists ? dailySnapshot.data() || {} : {};
        const pendingSymbols = symbols.filter((symbol) => {
            const quote = completedQuotes[symbol];
            return !(quote?.prefetchMarketDate === targetNY && quote?.source === "finnhub" &&
                Number.isFinite(quote.current) && quote.current > 0);
        });
        const reusedCount = totalSymbols - pendingSymbols.length;

        logger.info(
            LOG_CONTEXTS.PREFETCH,
            `Finnhub 시세 사전 수집 시작: ${totalSymbols}개 종목 (targetNY=${targetNY})`,
        );

        const batchSize = 10;
        let processedTotal = 0;
        let successTotal = 0;
        let pausedForDeadline = false;
        const indexQuotes = {};
        for (const symbol of US_INDEX_SYMBOLS) {
            if (!pendingSymbols.includes(symbol) && symbols.includes(symbol)) {
                indexQuotes[symbol] = completedQuotes[symbol];
            }
        }
        const REQUEST_DELAY_MS = 1200;

        for (let start = 0; start < pendingSymbols.length; start += batchSize) {
            const chunk = pendingSymbols.slice(start, start + batchSize);
            // Reserve the worst-case eight-second API timeout and rate-limit
            // delay for this batch, plus 90 seconds for writes/index history.
            if (Date.now() + chunk.length * (8000 + REQUEST_DELAY_MS) > workDeadline) {
                pausedForDeadline = true;
                break;
            }
            const batch = db.batch();
            const summary = {};
            let successCount = 0;

            for (const symbol of chunk) {
                const ok = await processQuoteSymbolFinnhub(
                    symbol,
                    apiKey,
                    batch,
                    summary,
                    targetNY,
                );

                processedTotal++;
                if (ok) successCount++;

                if (symbol !== chunk[chunk.length - 1]) {
                    await sleep(REQUEST_DELAY_MS);
                }
            }

            if (successCount > 0) {
                try {
                    // The completion marker is trusted only after all three
                    // representations commit together. A retry reads this date
                    // and fetches only unfinished symbols.
                    batch.set(dailySummaryRef, summary, { merge: true });
                    batch.set(
                        db.collection(QUOTE_SUMMARY_COLLECTION).doc("today_quotes_all"),
                        summary,
                        { merge: true },
                    );
                    await batch.commit();
                    successTotal += successCount;

                    for (const symbol of US_INDEX_SYMBOLS) {
                        if (summary[symbol]) indexQuotes[symbol] = summary[symbol];
                    }

                    logger.info(
                        LOG_CONTEXTS.PREFETCH,
                        `배치 커밋 및 요약 갱신 완료: ${successCount}/${chunk.length}`,
                    );
                } catch (err) {
                    logger.error(
                        LOG_CONTEXTS.PREFETCH,
                        "배치 커밋 또는 요약 저장에 실패했습니다.",
                        err,
                    );
                    throw err;
                }
            }

            if (start + batchSize < pendingSymbols.length) {
                await sleep(REQUEST_DELAY_MS);
            }
        }

        if (Object.keys(indexQuotes).length > 0) {
            await persistUsIndexHistory(indexQuotes, targetNY);
            logger.info(
                LOG_CONTEXTS.PREFETCH,
                `미국 주요 지수 이력 갱신 완료: ${Object.keys(indexQuotes).length}/4개`,
            );
        } else {
            logger.warn(
                LOG_CONTEXTS.PREFETCH,
                "미국 주요 지수 이력에 반영할 시세가 없습니다.",
            );
        }

        const progressLabel = successTotal + reusedCount === totalSymbols ? "완료" : "진행";
        logger.info(
            LOG_CONTEXTS.PREFETCH,
            `Finnhub 시세 사전 수집 ${progressLabel}: ${successTotal}/${processedTotal}건 성공, 동일 거래일 완료 ${reusedCount}건 재사용`,
        );
        if (successTotal + reusedCount < totalSymbols) {
            const reason = pausedForDeadline ? "continuation required" : "incomplete";
            throw new Error(`Finnhub prefetch ${reason}: ${totalSymbols - successTotal - reusedCount} symbols pending`);
        }
        return null;
    },
);

// ────────────────────────────────────────
// 🚨 주식 분할 보정 함수 (클라이언트 호출 가능)
// ────────────────────────────────────────

/**
 * 🚨 주식 분할 보정 (전체 히스토리 조정)
 * 복잡한 날짜 구분 없이 전체 데이터를 분할 비율로 나눔
 */
exports.adjustSymbolForSplit = onCall(
    {
        region: "asia-northeast3",
        cors: true, // 👈 [추가됨] CORS 명시적 허용
        // secrets: [finnhubApiKeyParam], // SECRET 제외
    },
    async (request) => {
        assertAdminFromClaims(request);

        const { symbol, splitRatio } = request.data;

        // 1. CORS 처리는 onCall이 Firebase 인증을 사용하므로,
        //   인증된 사용자(Client App)의 호출은 onCall 내부에서 자동으로 처리됨

        if (!symbol || !splitRatio) {
            return { success: false, message: "symbol과 splitRatio가 필요합니다." };
        }

        const ratio = parseFloat(splitRatio);
        if (isNaN(ratio) || ratio <= 0) {
            return { success: false, message: "splitRatio 값이 올바르지 않습니다." };
        }

        logger.info(
            LOG_CONTEXTS.CHART_CACHE,
            `${symbol} 종목 ${ratio}:1 분할 보정을 시작합니다. (전체 이력)`,
        );

        try {
            // ===== 1. stockChartCache 전체 히스토리 조정 =====
            const chartDocRef = db
                .collection(CHART_CACHE_COLLECTION)
                .doc(`${symbol}_D_fmp`);
            const chartSnap = await chartDocRef.get();

            if (!chartSnap.exists) {
                return { success: false, message: `${symbol} 차트 데이터가 없습니다.` };
            }

            const existingData = chartSnap.data(); // 👈 기존 데이터 백업
            const historical = existingData.historical || [];

            // ⭐ 날짜 구분 없이 전부 나누기
            const adjustedHistorical = historical
                .map((candle) => ({
                    ...candle,
                    // 가격 정보는 나누고
                    open: candle.open / ratio,
                    high: candle.high / ratio,
                    low: candle.low / ratio,
                    close: candle.close / ratio,
                    adjClose: candle.adjClose / ratio,
                    // 거래량은 곱합니다. (null check는 미리 되어있다고 가정)
                    volume: candle.volume * ratio || 0,
                    unadjustedVolume: candle.unadjustedVolume * ratio || 0, // FMP 포맷 유지
                }))
                .filter((c) => c.close !== null && !isNaN(c.close)); // 유효하지 않은 값 필터링

            await chartDocRef.set({
                historical: adjustedHistorical,
                lastFetched: Timestamp.now(),
                source: existingData.source || "finnhub", // 👈 [FIX] 기존 소스 유지 (없으면 기본값)
                splitInfo: {
                    ratio: ratio,
                    adjustedAt: Timestamp.now(),
                    note: "전체 히스토리 조정됨 (수동 입력)",
                },
            });

            logger.info(
                LOG_CONTEXTS.CHART_CACHE,
                `차트 이력 보정 완료: ${adjustedHistorical.length}개 캔들`,
            );

            // ===== 2. stockMarketCache 최신 시세 조정 (선택 사항이지만 안전을 위해 포함) =====
            const cacheDocRef = db.collection(MARKET_CACHE_COLLECTION).doc(symbol);
            const cacheSnap = await cacheDocRef.get();

            if (cacheSnap.exists) {
                const cacheData = cacheSnap.data();
                const newUpdate = {};
                // null 체크 후 조정
                if (cacheData.currentPriceUSD)
                    newUpdate.currentPriceUSD = cacheData.currentPriceUSD / ratio;
                if (cacheData.previousCloseUSD)
                    newUpdate.previousCloseUSD = cacheData.previousCloseUSD / ratio;
                if (cacheData.dailyHighUSD)
                    newUpdate.dailyHighUSD = cacheData.dailyHighUSD / ratio;
                if (cacheData.dailyLowUSD)
                    newUpdate.dailyLowUSD = cacheData.dailyLowUSD / ratio;
                if (cacheData.openPriceUSD)
                    newUpdate.openPriceUSD = cacheData.openPriceUSD / ratio;

                await cacheDocRef.update(newUpdate);
            }

            logger.info(LOG_CONTEXTS.CHART_CACHE, "시장 캐시 보정을 완료했습니다.");

            return {
                success: true,
                adjustedCandles: adjustedHistorical.length,
                splitRatio: ratio,
                message: "전체 히스토리 및 시세 조정 완료.",
            };
        } catch (error) {
            logger.error(
                LOG_CONTEXTS.CHART_CACHE,
                `${symbol} 보정에 실패했습니다.`,
                error,
            );
            // Firebase Functions의 httpsCallable 에러 포맷에 맞춤
            throw new functions.https.HttpsError(
                "internal",
                `분할 보정 중 오류가 발생했습니다: ${error.message}`,
            );
        }
    },
);

// ────────────────────────────────────────
// 🚨 2단계: 포트폴리오 보유 수량 및 단가 조정 함수
// ────────────────────────────────────────

exports.adjustPortfolioForSplit = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        timeoutSeconds: 300,
    },
    async (request) => {
        assertAdminFromClaims(request);

        const { symbol, splitRatio } = request.data;

        if (!symbol || !splitRatio) {
            return { success: false, message: "symbol과 splitRatio가 필요합니다." };
        }

        const ratio = parseFloat(splitRatio);
        if (isNaN(ratio) || ratio <= 0) {
            return { success: false, message: "splitRatio 값이 올바르지 않습니다." };
        }

        const symbolUpper = symbol.toUpperCase().trim();
        logger.info(
            LOG_CONTEXTS.CHART_CACHE,
            `${symbolUpper} 포트폴리오 보정 시작 (비율: ${ratio})`,
        );

        let classesAffected = 0;
        let portfoliosAdjusted = 0;

        try {
            // 1. 모든 학급(classes) 문서 조회
            const classesSnap = await db.collection("classes").get();

            // 2. 각 학급의 학생 포트폴리오 컬렉션 순회
            for (const classDoc of classesSnap.docs) {
                const classId = classDoc.id;
                const studentsRef = db.collection(`classes/${classId}/students`);

                // 모든 학생 문서 조회 (학생 수가 많으면 여기서 부하 발생 가능)
                const studentsSnap = await studentsRef.get();

                for (const studentDoc of studentsSnap.docs) {
                    const studentUid = studentDoc.id;
                    const portfolioRef = db.collection(
                        `classes/${classId}/students/${studentUid}/stockPortfolio`,
                    );

                    // 해당 학생의 포트폴리오에서 대상 종목만 찾기
                    const stockSnap = await portfolioRef.doc(symbolUpper).get();

                    if (stockSnap.exists) {
                        const stockData = stockSnap.data();
                        const oldQuantity = stockData.quantity || 0;
                        const oldAvgPrice = stockData.avgPriceUSD || 0;

                        if (oldQuantity > 0) {
                            const newQuantity = oldQuantity * ratio;
                            const newAvgPriceUSD = oldAvgPrice / ratio;

                            // 포트폴리오 문서 업데이트
                            await stockSnap.ref.update({
                                quantity: newQuantity,
                                avgPriceUSD: newAvgPriceUSD,
                                totalInvestmentUSD: stockData.totalInvestmentUSD, // 총 투자금은 유지
                                splitAdjusted: Timestamp.now(), // 조정 완료 플래그
                            });

                            portfoliosAdjusted++;
                            logger.info(
                                LOG_CONTEXTS.CHART_CACHE,
                                `${studentUid} 사용자 ${symbolUpper} 보정: `
                                + `수량 ${oldQuantity}->${newQuantity}, `
                                + `평균가 ${oldAvgPrice}->${newAvgPriceUSD}`,
                            );
                        }
                    }
                }
                classesAffected++;
            }

            logger.info(
                LOG_CONTEXTS.CHART_CACHE,
                `포트폴리오 보정 완료. 학급: ${classesAffected}, 포트폴리오: ${portfoliosAdjusted}`,
            );

            return {
                success: true,
                classesAffected,
                portfoliosAdjusted,
                message: `${symbolUpper} 종목 포트폴리오 조정 완료: ${portfoliosAdjusted}개 포트폴리오 수정.`,
            };
        } catch (error) {
            logger.error(
                LOG_CONTEXTS.CHART_CACHE,
                `${symbolUpper} 포트폴리오 보정에 실패했습니다.`,
                error,
            );
            throw new functions.https.HttpsError(
                "internal",
                `포트폴리오 보정 중 오류가 발생했습니다: ${error.message}`,
            );
        }
    },
);

// ────────────────────────────────────────
// 🚨 2-1단계: 포트폴리오 단가 조정 함수
// ────────────────────────────────────────

exports.recoverPortfolioPrice = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        timeoutSeconds: 300,
    },
    async (request) => {
        assertAdminFromClaims(request);

        const { symbol } = request.data;

        if (!symbol) {
            return { success: false, message: "symbol이 필요합니다." };
        }

        // round4 함수는 해당 파일의 다른 곳에 정의되어 있다고 가정합니다.
        // (만약 round4가 없다면 오류가 발생합니다. 필요시 직접 정의하세요.)
        const round4 = (n) => Math.round(n * 10000) / 10000;

        const symbolUpper = symbol.toUpperCase().trim();
        logger.info(
            LOG_CONTEXTS.CHART_CACHE,
            `${symbolUpper} 포트폴리오 평균가 복구 시작 (수량 유지)`,
        );

        let portfoliosAdjusted = 0;

        try {
            const classesSnap = await db.collection("classes").get();

            for (const classDoc of classesSnap.docs) {
                const classId = classDoc.id;
                const studentsRef = db.collection(`classes/${classId}/students`);

                const studentsSnap = await studentsRef.get();

                for (const studentDoc of studentsSnap.docs) {
                    const studentUid = studentDoc.id;
                    const portfolioRef = db.collection(
                        `classes/${classId}/students/${studentUid}/stockPortfolio`,
                    );
                    const stockSnap = await portfolioRef.doc(symbolUpper).get();

                    if (stockSnap.exists) {
                        const stockData = stockSnap.data();

                        const totalInvestmentUSD = stockData.totalInvestmentUSD || 0;
                        const currentQuantity = stockData.quantity || 0;

                        // ⭐️ 핵심 로직: 총 투자금액과 현재 수량을 기준으로 진짜 평균 단가를 역산합니다.
                        let newAvgPriceUSD = 0;
                        if (currentQuantity > 0 && totalInvestmentUSD > 0) {
                            // 총 투자금액 / 현재 수량 = 복구된 평균 단가
                            newAvgPriceUSD = round4(totalInvestmentUSD / currentQuantity);
                        }

                        if (newAvgPriceUSD > 0) {
                            // 포트폴리오 문서 업데이트 (수량은 유지, 단가 필드만 업데이트)
                            await stockSnap.ref.update({
                                averagePriceUSD: newAvgPriceUSD, // 주력 필드 업데이트
                                avgPriceUSD: newAvgPriceUSD, // 호환성 필드 업데이트
                                lastUpdated: Timestamp.now(),
                                priceRecovered: Timestamp.now(), // 복구 기록
                            });

                            portfoliosAdjusted++;
                            logger.info(
                                LOG_CONTEXTS.CHART_CACHE,
                                `${studentUid} 사용자 ${symbolUpper} 평균가 복구: 새 평균가 ${newAvgPriceUSD} (수량=${currentQuantity})`,
                            );
                        }
                    }
                }
            }

            logger.info(
                LOG_CONTEXTS.CHART_CACHE,
                `평균가 복구 완료. 포트폴리오: ${portfoliosAdjusted}`,
            );

            return {
                success: true,
                portfoliosAdjusted,
                message: `${symbolUpper} 종목 평균 단가 복구 완료: ${portfoliosAdjusted}개 포트폴리오 수정.`,
            };
        } catch (error) {
            logger.error(
                LOG_CONTEXTS.CHART_CACHE,
                `${symbolUpper} 평균가 복구에 실패했습니다.`,
                error,
            );
            throw new functions.https.HttpsError(
                "internal",
                `평균가 복구 중 오류가 발생했습니다: ${error.message}`,
            );
        }
    },
);

// ────────────────────────────────────────
// 🚨 2-2단계: 포트폴리오 수량 조정 함수
// ────────────────────────────────────────

exports.adjustPortfolioQuantity = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        timeoutSeconds: 300, // 학생 수가 많을 경우를 대비해 넉넉히 설정
    },
    async (request) => {
        assertAdminFromClaims(request);

        const { symbol, splitRatio } = request.data;

        // 1. 입력값 검증
        if (!symbol || !splitRatio) {
            return { success: false, message: "symbol과 splitRatio가 필요합니다." };
        }

        const ratio = parseFloat(splitRatio);
        if (isNaN(ratio) || ratio <= 0) {
            return { success: false, message: "splitRatio 값이 올바르지 않습니다." };
        }

        const symbolUpper = symbol.toUpperCase().trim();
        logger.info(
            LOG_CONTEXTS.CHART_CACHE,
            `${symbolUpper} 포트폴리오 수량 보정 시작 (비율: ${ratio})`
        );

        let portfoliosAdjusted = 0;

        try {
            // 2. 모든 학급 순회
            const classesSnap = await db.collection("classes").get();

            for (const classDoc of classesSnap.docs) {
                const classId = classDoc.id;
                // 해당 학급의 모든 학생 목록 가져오기
                const studentsSnap = await db.collection(`classes/${classId}/students`).get();

                for (const studentDoc of studentsSnap.docs) {
                    const studentUid = studentDoc.id;
                    const stockDocRef = db.doc(`classes/${classId}/students/${studentUid}/stockPortfolio/${symbolUpper}`);

                    const stockSnap = await stockDocRef.get();

                    if (stockSnap.exists) {
                        const stockData = stockSnap.data();
                        const oldQuantity = stockData.quantity || 0;

                        if (oldQuantity > 0) {
                            // ⭐️ 핵심: 수량만 조정 (단가는 별도 함수에서 처리하거나 수동 복구)
                            const newQuantity = oldQuantity * ratio;

                            // 문서 업데이트
                            await stockDocRef.update({
                                quantity: newQuantity,
                                lastUpdated: Timestamp.now(),
                                quantityAdjustedAt: Timestamp.now(), // 기록용 필드
                                splitNote: `${ratio}:1 수량 조정 적용`
                            });

                            portfoliosAdjusted++;
                        }
                    }
                }
            }

            logger.info(
                LOG_CONTEXTS.CHART_CACHE,
                `수량 보정 완료. 총 ${portfoliosAdjusted}건`
            );

            return {
                success: true,
                portfoliosAdjusted,
                message: `${symbolUpper} 종목 수량 조정 완료: ${portfoliosAdjusted}개 계정 수정됨. (${ratio}배)`,
            };
        } catch (error) {
            logger.error(
                LOG_CONTEXTS.CHART_CACHE,
                `${symbolUpper} 수량 보정에 실패했습니다.`,
                error
            );
            // 클라이언트에 에러 전달
            throw new functions.https.HttpsError(
                "internal",
                `수량 조정 중 오류 발생: ${error.message}`
            );
        }
    }
);
