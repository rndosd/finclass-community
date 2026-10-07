import React from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { BarChart3, Edit3, Trash2 } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useUser } from '../../contexts/UserContext';
import { Button } from '../ui';

/**
 * TipTap NodeView: 설문 미리보기
 * - attrs: { surveyId }
 * - Firestore에서 surveyId로 조회
 * - editor.options.classId 필요 (useEditor 생성 시 주입)
 */
const SurveyComponent = ({ node, deleteNode, editor }) => {
    const { surveyId } = node.attrs;
    const { classId: contextClassId } = useUser();

    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);
    const [surveyData, setSurveyData] = React.useState(null);

    const classId = editor?.options?.classId || contextClassId;

    // 초기 로드
    React.useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                setLoading(true);
                setError(null);

                if (!surveyId) {
                    setError('surveyId가 없습니다.');
                    return;
                }
                if (!classId) {
                    setError('classId가 설정되지 않았습니다.');
                    return;
                }

                const ref = doc(db, `classes/${classId}/surveys/${surveyId}`);
                const snap = await getDoc(ref);
                if (cancelled) return;

                if (snap.exists()) {
                    setSurveyData(snap.data());
                } else {
                    setError('설문을 찾을 수 없습니다.');
                }
            } catch (e) {
                if (!cancelled) setError(e?.message || '설문 로드 중 오류가 발생했습니다.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [surveyId, classId]);

    // 수정 저장 후 갱신
    React.useEffect(() => {
        const onUpdated = async (e) => {
            if (e.detail?.surveyId !== surveyId) return;
            if (!classId) return;
            try {
                const ref = doc(db, `classes/${classId}/surveys/${surveyId}`);
                const snap = await getDoc(ref);
                if (snap.exists()) setSurveyData(snap.data());
            } catch { }
        };
        document.addEventListener('surveyUpdated', onUpdated);
        return () => document.removeEventListener('surveyUpdated', onUpdated);
    }, [surveyId, classId]);

    const handleEdit = () => {
        document.dispatchEvent(new CustomEvent('editSurvey', { detail: { surveyId } }));
    };

    if (loading) {
        return (
            <NodeViewWrapper className="survey-wrapper">
                <div className="p-4 border rounded-lg bg-blue-50 text-sm text-blue-700">
                    설문 미리보기 로딩 중…
                </div>
            </NodeViewWrapper>
        );
    }

    if (error || !surveyData) {
        return (
            <NodeViewWrapper className="survey-wrapper">
                <div className="p-4 border border-red-300 rounded-lg bg-red-50 text-sm text-red-700">
                    {error || '설문 데이터를 불러올 수 없습니다.'}
                </div>
            </NodeViewWrapper>
        );
    }

    const { title, description, questions = [] } = surveyData;

    return (
        <NodeViewWrapper className="survey-wrapper">
            <div className="relative border-2 border-blue-500 rounded-xl p-6 my-4 bg-gradient-to-br from-blue-50 to-indigo-50">
                {/* SURVEY 라벨 */}
                <div className="absolute top-2 right-2 bg-blue-600 text-white px-2 py-1 rounded-lg text-xs font-semibold">
                    설문
                </div>

                {/* 편집/삭제 */}
                <div className="absolute top-2 left-2 flex gap-1">
                    <Button variant="ghost" kind="ghost"
                        onClick={handleEdit}
                        className="p-1 bg-blue-100 hover:bg-blue-200 rounded transition-colors"
                        title="설문조사 편집"
                        type="button"
                    >
                        <Edit3 className="w-3 h-3 text-blue-600" />
                    </Button>
                    <Button variant="ghost" kind="ghost"
                        onClick={deleteNode}
                        className="p-1 bg-red-100 hover:bg-red-200 rounded transition-colors"
                        title="설문조사 삭제"
                        type="button"
                    >
                        <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                </div>

                {/* 헤더 */}
                <div className="flex items-center mb-4 mt-2">
                    <BarChart3 className="w-6 h-6 text-blue-600 mr-3" />
                    <h3 className="text-xl font-bold text-blue-900">{title || '제목 없는 설문'}</h3>
                </div>

                {/* 설명 */}
                {!!description && (
                    <p className="text-gray-600 mb-6 text-sm leading-relaxed">{description}</p>
                )}

                {/* 질문 미리보기 */}
                <div className="space-y-4">
                    {questions.map((q, index) => (
                        <div
                            key={q.id || `${surveyId}_${index}`}
                            className="bg-white rounded-lg p-4 shadow-sm border border-gray-100"
                        >
                            <div className="flex items-start mb-3">
                                <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold mr-3">
                                    {index + 1}
                                </div>
                                <div className="flex-1">
                                    <p className="font-semibold text-gray-900 text-sm leading-relaxed">
                                        {q.question || '질문'}
                                        {q.required && <span className="text-red-500 ml-1">*</span>}
                                    </p>
                                </div>
                            </div>

                            <div className="ml-9">
                                {q.type === 'multiple_choice' && (
                                    <div className="space-y-2">
                                        {(q.options || []).map((opt, oi) => (
                                            <div key={oi} className="flex items-center">
                                                <div className="w-4 h-4 border-2 border-gray-300 rounded-full mr-3 flex-shrink-0" />
                                                <span className="text-gray-700 text-sm">{opt}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {q.type === 'checkbox' && (
                                    <div className="space-y-2">
                                        {(q.options || []).map((opt, oi) => (
                                            <div key={oi} className="flex items-center">
                                                <div className="w-4 h-4 border-2 border-gray-300 rounded mr-3 flex-shrink-0" />
                                                <span className="text-gray-700 text-sm">{opt}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {q.type === 'text' && (
                                    <div className="border border-gray-300 rounded-md p-3 bg-gray-50">
                                        <span className="text-gray-500 text-sm italic">단답형 입력 (미리보기)</span>
                                    </div>
                                )}

                                {q.type === 'textarea' && (
                                    <div className="border border-gray-300 rounded-md p-3 bg-gray-50 min-h-[80px]">
                                        <span className="text-gray-500 text-sm italic">장문형 입력 (미리보기)</span>
                                    </div>
                                )}

                                {q.type === 'rating' && (
                                    <div className="flex items-center space-x-3">
                                        <span className="text-xs text-gray-500">매우 나쁨</span>
                                        <div className="flex space-x-2">
                                            {[1, 2, 3, 4, 5].map((num) => (
                                                <div
                                                    key={num}
                                                    className="w-8 h-8 border-2 border-gray-300 rounded-full flex items-center justify-center text-sm font-semibold text-gray-600 bg-white"
                                                >
                                                    {num}
                                                </div>
                                            ))}
                                        </div>
                                        <span className="text-xs text-gray-500">매우 좋음</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* 제출 버튼 (미리보기 고정 비활성화) */}
                <div className="mt-6 text-center">
                    <Button variant="ghost" kind="ghost"
                        disabled
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold opacity-50 cursor-not-allowed"
                        type="button"
                    >
                        설문조사 제출
                    </Button>
                    <p className="text-xs text-gray-500 mt-2">에디터 미리보기</p>
                </div>
            </div>
        </NodeViewWrapper>
    );
};

export default SurveyComponent;
