import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2 } from 'lucide-react';
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    serverTimestamp,
    increment,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useFeedback } from '../../contexts/FeedbackContext';
import { Button, Spinner } from '../ui';

const SurveyRenderer = ({
    surveyId,
    newsId,
    classId,
    userId,
    userName,
    isReadOnly = false,
    ignoreSurveyConditions = false,
    onSubmitted,
    variant = 'card',       // 'card' | 'bare'
    showHeader = true,      // 제목/아이콘 표시 여부
}) => {
    const [responses, setResponses] = useState({});
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [surveyData, setSurveyData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [respLoading, setRespLoading] = useState(true);
    const [error, setError] = useState(null);
    const { showFeedback } = useFeedback();

    const surveyRef = useMemo(() => {
        if (!classId || !surveyId) return null;
        return doc(db, `classes/${classId}/surveys/${surveyId}`);
    }, [classId, surveyId]);

    const myResponseRef = useMemo(() => {
        if (!classId || !surveyId || !userId) return null;
        return doc(db, `classes/${classId}/surveys/${surveyId}/responses/${userId}`);
    }, [classId, surveyId, userId]);

    const deadline = surveyData?.deadline;
    const isAfterDeadline = useMemo(() => {
        if (!deadline) return false;
        try {
            const d = deadline?.toDate ? deadline.toDate() : new Date(deadline);
            return Date.now() > d.getTime();
        } catch {
            return false;
        }
    }, [deadline]);

    // 설문 로드
    useEffect(() => {
        let mounted = true;
        const loadSurvey = async () => {
            if (!surveyRef) {
                setLoading(false);
                setError('설문조사를 찾을 수 없습니다.');
                return;
            }
            try {
                setLoading(true);
                setError(null);
                const snap = await getDoc(surveyRef);
                if (!mounted) return;
                if (snap.exists()) {
                    setSurveyData(snap.data());
                } else {
                    setError('설문조사를 찾을 수 없습니다.');
                }
            } catch (err) {
                console.error('설문조사 로드 오류:', err);
                if (mounted) setError('설문조사를 불러오는 중 오류가 발생했습니다.');
            } finally {
                if (mounted) setLoading(false);
            }
        };
        loadSurvey();
        return () => { mounted = false; };
    }, [surveyRef]);

    // 내 응답 로드 (옵션 라벨 → 인덱스 역매핑 포함)
    useEffect(() => {
        let mounted = true;
        const loadMyResponse = async () => {
            if (!myResponseRef) {
                setRespLoading(false);
                return;
            }
            try {
                setRespLoading(true);
                const snap = await getDoc(myResponseRef);
                if (!mounted) return;
                if (snap.exists()) {
                    const data = snap.data();
                    const raw = data.responses || {};
                    const qs = surveyData?.questions || [];
                    const next = {};

                    const toIndex = (q, val) => {
                        if (typeof val === 'number') return val;
                        if (!q?.options) return val;
                        const i = q.options.findIndex(o => o === val);
                        return i >= 0 ? i : val;
                    };

                    for (const q of qs) {
                        const v = raw[q.id];
                        if (v == null) continue;

                        if (q.type === 'multiple_choice') {
                            if (q.allowMultiple) {
                                if (Array.isArray(v)) {
                                    next[q.id] = v.map(x => toIndex(q, x)).filter(n => typeof n === 'number');
                                } else {
                                    next[q.id] = [];
                                }
                            } else {
                                next[q.id] = toIndex(q, v);
                            }
                        } else {
                            // text/rating/scale 등은 그대로
                            next[q.id] = v;
                        }
                    }
                    setResponses(next);
                    setIsSubmitted(true);
                }
            } catch (err) {
                console.error('응답 로드 오류:', err);
            } finally {
                if (mounted) setRespLoading(false);
            }
        };
        if (surveyData) loadMyResponse();
        return () => { mounted = false; };
    }, [myResponseRef, surveyData]);

    if (loading) {
        return (
            <div className={variant === 'card' ? 'border-2 border-blue-500 rounded-xl p-6 my-6 bg-gradient-to-br from-blue-50 to-indigo-50' : ''}>
                <div className="text-center py-8">
                    <Spinner tone="blue" />
                    <p className="text-gray-600 mt-2">설문조사를 불러오는 중...</p>
                </div>
            </div>
        );
    }

    if (error || !surveyData) {
        return (
            <div className={variant === 'card' ? 'border-2 border-red-500 rounded-xl p-6 my-6 bg-red-50' : ''}>
                <p className="text-red-600">{error || '설문조사 데이터를 불러올 수 없습니다.'}</p>
            </div>
        );
    }

    const { title, description, questions = [], isActive = true } = surveyData;
    const blockedBySurveyRule = !ignoreSurveyConditions && (!isActive || isAfterDeadline);
    const locked = isReadOnly || isSubmitted || blockedBySurveyRule;

    // ===== 변경 핸들러 =====
    const setAnswer = (qid, val) => setResponses(prev => ({ ...prev, [qid]: val }));
    const handleRadioChange = (qid, oi) => setAnswer(qid, oi);
    const handleCheckboxChange = (qid, oi, checked) => {
        setResponses(prev => {
            const cur = Array.isArray(prev[qid]) ? prev[qid] : [];
            const next = checked ? Array.from(new Set([...cur, oi])) : cur.filter(i => i !== oi);
            return { ...prev, [qid]: next };
        });
    };
    const handleTextChange = (qid, value) => setAnswer(qid, value);
    const handleRatingClick = (qid, value) => setAnswer(qid, value);

    // ===== 필수 검증 =====
    const validateRequired = () => {
        const missing = [];
        for (const q of questions.filter(q => q.required)) {
            const val = responses[q.id];
            if (q.type === 'multiple_choice') {
                if (q.allowMultiple) {
                    if (!Array.isArray(val) || val.length === 0) missing.push(q);
                } else {
                    if (typeof val !== 'number') missing.push(q);
                }
            } else if (q.type === 'text') {
                if (!val || String(val).trim() === '') missing.push(q);
            } else if (q.type === 'rating') {
                const maxScore = Number(q.maxScore) || 5;
                if (typeof val !== 'number' || val < 1 || val > maxScore) missing.push(q);
            }
        }
        return missing;
    };

    // ===== 제출 =====
    const handleSubmit = async () => {
        if (locked) {
            if (isSubmitted) showFeedback('이미 제출된 설문입니다.', 'info');
            else if (!ignoreSurveyConditions && !isActive) showFeedback("지금은 이 설문에 참여할 수 없어요.", 'warning');
            else if (!ignoreSurveyConditions && isAfterDeadline) showFeedback('이 설문은 마감되었습니다.', 'warning');
            return;
        }

        const missing = validateRequired();
        if (missing.length > 0) {
            showFeedback(
                `필수 질문에 답변해주세요: ${missing.map(q => q.question || '질문').join(', ')}`,
                'warning'
            );
            return;
        }

        setIsSubmitting(true);
        try {
            if (!myResponseRef) throw new Error('제출에 필요한 정보가 없습니다.');

            // 중복 제출 방지
            const current = await getDoc(myResponseRef);
            if (current.exists()) {
                setIsSubmitted(true);
                showFeedback('이미 제출된 설문입니다.', 'info');
                onSubmitted?.();
                return;
            }

            // 저장 시: 인덱스를 라벨(옵션 문자열)로 변환
            const storedResponses = {};
            for (const q of questions) {
                const v = responses[q.id];
                if (v == null) continue;

                if (q.type === 'multiple_choice') {
                    if (q.allowMultiple) {
                        storedResponses[q.id] = Array.isArray(v)
                            ? v.map(i => (typeof i === 'number' ? q.options?.[i] : i)).filter(Boolean)
                            : [];
                    } else {
                        storedResponses[q.id] = typeof v === 'number' ? q.options?.[v] : v;
                    }
                } else {
                    // text / rating / scale 등은 값 그대로
                    storedResponses[q.id] = v;
                }
            }

            await setDoc(myResponseRef, {
                surveyId,
                newsId: newsId || null,
                userId,
                userName: userName || null,
                responses: storedResponses,
                submittedAt: serverTimestamp(),
            });

            if (surveyRef) {
                try {
                    await updateDoc(surveyRef, { responseCount: increment(1) });
                } catch (e) {
                    console.warn('responseCount 증가 실패(무시 가능):', e?.message);
                }
            }

            setIsSubmitted(true);
            showFeedback('설문조사 응답이 제출되었습니다.', 'success');
            onSubmitted?.();
        } catch (err) {
            console.error('Survey submission error:', err);
            showFeedback('설문조사 제출 중 오류가 발생했습니다.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    // ===== 질문 렌더 =====
    const renderQuestion = (q, index) => {
        const qid = q.id;
        const cur = responses[qid];

        // 공통 라벨
        const leftLabel = '낮음';
        const rightLabel = '높음';

        return (
            <div key={qid} className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
                <div className="flex items-start mb-3">
                    <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold mr-3">
                        {index + 1}
                    </div>
                    <div className="flex-1">
                        <p className="font-semibold text-gray-900 text-sm leading-relaxed">
                            {q.question}
                            {q.required && <span className="text-red-500 ml-1">*</span>}
                        </p>
                    </div>
                </div>

                <div className="ml-9">
                    {/* 객관식 (allowMultiple 지원) */}
                    {q.type === 'multiple_choice' && (
                        <div className="space-y-2">
                            {(q.options || []).map((opt, oi) => {
                                const name = `question_${qid}`;
                                if (q.allowMultiple) {
                                    const checked = Array.isArray(cur) && cur.includes(oi);
                                    return (
                                        <label key={oi} className="flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                name={name}
                                                value={oi}
                                                checked={checked}
                                                onChange={(e) => handleCheckboxChange(qid, oi, e.target.checked)}
                                                disabled={locked || respLoading}
                                                className="mr-3 text-blue-600 rounded"
                                            />
                                            <span className="text-gray-700 text-sm">{opt}</span>
                                        </label>
                                    );
                                }
                                return (
                                    <label key={oi} className="flex items-center cursor-pointer">
                                        <input
                                            type="radio"
                                            name={name}
                                            value={oi}
                                            checked={typeof cur === 'number' && cur === oi}
                                            onChange={() => handleRadioChange(qid, oi)}
                                            disabled={locked || respLoading}
                                            className="mr-3 text-blue-600"
                                        />
                                        <span className="text-gray-700 text-sm">{opt}</span>
                                    </label>
                                );
                            })}
                        </div>
                    )}

                    {/* 주관식 */}
                    {q.type === 'text' && (
                        <input
                            type="text"
                            value={cur ?? ''}
                            onChange={(e) => handleTextChange(qid, q.maxLength ? e.target.value.slice(0, q.maxLength) : e.target.value)}
                            disabled={locked || respLoading}
                            placeholder={q.placeholder || '답변을 입력하세요'}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                        />
                    )}

                    {/* 평점 (정수 버튼) */}
                    {q.type === 'rating' && (
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-500">{leftLabel}</span>
                            <div className="flex gap-2">
                                {Array.from({ length: Number(q.maxScore) || 5 }, (_, i) => i + 1).map(num => (
                                    <Button variant="ghost" kind="ghost"
                                        key={num}
                                        type="button"
                                        onClick={() => handleRatingClick(qid, num)}
                                        disabled={locked || respLoading}
                                        className={`w-8 h-8 border-2 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${cur === num
                                            ? 'bg-blue-600 border-blue-600 text-white'
                                            : 'border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600'
                                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                                    >
                                        {num}
                                    </Button>
                                ))}
                            </div>
                            <span className="text-xs text-gray-500">{rightLabel}</span>
                        </div>
                    )}

                </div>
            </div>
        );
    };

    const WrapperClass =
        variant === 'card'
            ? 'border-2 border-blue-500 rounded-xl p-6 my-6 bg-gradient-to-br from-blue-50 to-indigo-50'
            : '';

    return (
        <div className={WrapperClass}>
            {/* 라벨/상태 (bare 모드면 감춤) */}
            {variant === 'card' && (
                <div className="flex items-center justify-between mb-4">
                    <div className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-semibold">
                        설문
                    </div>
                    {(isSubmitted || !isActive || isAfterDeadline) && (
                        <div className={`flex items-center text-sm font-medium ${isSubmitted ? 'text-green-600' : 'text-gray-600'}`}>
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            {isSubmitted ? '제출 완료' : (!isActive ? "참여 중단" : '마감됨')}
                        </div>
                    )}
                </div>
            )}

            {/* 헤더 (옵션) */}
            {showHeader && (
                <div className="flex items-center mb-4">
                    <BarChart3 className="w-6 h-6 text-blue-600 mr-3" />
                    <h3 className="text-xl font-bold text-blue-900">{title}</h3>
                </div>
            )}

            {/* 설명 */}
            {description && (
                <p className="text-gray-600 mb-6 text-sm leading-relaxed">{description}</p>
            )}

            {/* 질문들 */}
            <div className="space-y-4 mb-6">
                {questions.map((q, i) => renderQuestion(q, i))}
            </div>

            {/* 제출 버튼 */}
            {!isReadOnly && (
                <div className="text-center">
                    <Button
                        onClick={handleSubmit}
                        disabled={locked}
                        isLoading={isSubmitting}
                        loadingText={"\uC81C\uCD9C \uC911..."}
                        tone="blue"
                        icon={BarChart3}
                        rounded="lg"
                        className="px-6 py-3 font-semibold"
                    >
                        {"\uC124\uBB38\uC870\uC0AC \uC81C\uCD9C"}
                        {/*
                        ?ㅻЦ議곗궗 ?쒖텧
                                제출 중...
                                설문조사 제출
                        */}
                    </Button>
                    {!ignoreSurveyConditions && (isAfterDeadline || !isActive) && !isSubmitted && (
                        <p className="text-xs text-gray-500 mt-2">
                            {isAfterDeadline ? '이 설문은 마감되어 제출할 수 없습니다.' : "지금은 이 설문에 참여할 수 없어요."}
                        </p>
                    )}
                </div>
            )}

            {/* 제출 완료 메시지 */}
            {isSubmitted && (
                <div className="text-center p-4 bg-green-50 border border-green-200 rounded-lg mt-4">
                    <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                    <p className="text-green-800 font-medium">설문조사 응답이 제출되었습니다.</p>
                    <p className="text-green-600 text-sm mt-1">감사합니다!</p>
                </div>
            )}
        </div>
    );
};

export default SurveyRenderer;
