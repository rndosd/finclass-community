const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const googleApiKey = defineSecret("GOOGLE_API_KEY");

const { searchManual } = require("../../utils/ai/vectorStore");

// 사용할 모델 목록 (우선순위 순)
const MODELS = [
    "gemini-2.5-flash-lite",  // 1순위: 하루 1,000회
    "gemini-2.0-flash-lite"   // 2순위: 하루 200회
];

exports.chatWithFinclass = onCall(
    {
        secrets: [googleApiKey],
        timeoutSeconds: 60,
        region: "asia-northeast3"
    },
    async (request) => {
        console.log('[chatWithFinclass] 호출됨', {
            hasAuth: !!request.auth,
            uid: request.auth?.uid,
            role: request.auth?.token?.role,
        });

        // 1. 권한 검사
        if (!request.auth) {
            throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
        }

        const userRole = request.auth.token?.role;
        if (userRole !== 'teacher' && userRole !== 'admin') {
            throw new HttpsError(
                'permission-denied',
                '이 기능은 교사와 관리자만 사용할 수 있습니다.'
            );
        }

        const apiKey = googleApiKey.value();
        if (!apiKey) {
            throw new HttpsError(
                'failed-precondition',
                'LLM API 키가 설정되지 않았습니다.'
            );
        }

        const userMessage = request.data.message;
        console.log('[chatWithFinclass] userMessage:', userMessage);

        try {
            // 2. 매뉴얼 검색 (RAG)
            console.log('[chatWithFinclass] 1) searchManual 시작');
            const retrievedContext = await searchManual(apiKey, userMessage);
            console.log('[chatWithFinclass] 1) searchManual 완료', {
                exists: !!retrievedContext,
                length: retrievedContext ? retrievedContext.length : 0,
            });

            // 3. 프롬프트 구성
            let promptText = userMessage;
            if (retrievedContext) {
                promptText = `다음 [참고 매뉴얼] 내용을 바탕으로 질문에 답변해 주세요.\n\n[참고 매뉴얼]\n${retrievedContext}\n\n[사용자 질문]\n${userMessage}`;
            }

            // 4. Fallback 방식으로 모델 호출
            const genAI = new GoogleGenerativeAI(apiKey);
            const systemInstruction = `당신은 Finclass 선생님들을 돕는 AI 챗봇입니다. 
Finclass의 기능, 은행/미션/경찰청/스토어 등 가상경제 시스템에 대해 안내하고,
초등학교 교실에서 실제로 어떻게 활용할지 구체적인 아이디어와 예시를 제공합니다.
답변은 친절하고 전문적인 선생님의 말투로 해주세요.`;

            let lastError = null;

            for (const modelName of MODELS) {
                try {
                    console.log(`[chatWithFinclass] 2) ${modelName} 호출 시도`);

                    const model = genAI.getGenerativeModel({
                        model: modelName,
                        systemInstruction: systemInstruction
                    });

                    const result = await model.generateContent(promptText);
                    const response = await result.response;
                    const text = response.text();

                    console.log(`[chatWithFinclass] 3) ${modelName} 성공, length:`, text.length);

                    return {
                        content: text,
                        provider: modelName,
                        timestamp: new Date().toISOString(),
                    };

                } catch (error) {
                    lastError = error;

                    // Rate limit (429) 또는 모델 관련 에러면 다음 모델 시도
                    const isRateLimit = error.status === 429 ||
            error.message?.includes('429') ||
            error.message?.includes('quota') ||
            error.message?.includes('rate limit');

                    if (isRateLimit) {
                        console.log(`[chatWithFinclass] ⚠️ ${modelName} 한도 초과, 다음 모델 시도...`);
                        continue;
                    }

                    // 다른 에러는 바로 throw
                    throw error;
                }
            }

            // 모든 모델 실패 시
            console.error("[chatWithFinclass] 모든 모델 한도 초과");
            throw new HttpsError(
                "resource-exhausted",
                "오늘의 AI 사용량이 모두 소진되었습니다. 내일 다시 시도해주세요."
            );

        } catch (error) {
            console.error("[chatWithFinclass] Chat Error 상세:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
                response: error.response?.data || error.response,
            });

            // 이미 HttpsError인 경우 그대로 throw
            if (error instanceof HttpsError) {
                throw error;
            }

            throw new HttpsError(
                "internal",
                "챗봇 처리 중 오류가 발생했습니다.",
                error.message
            );
        }
    }
);