// src/pages/police/tabs/components/SetThresholdModal.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Modal, Button, InputField, Spinner } from '../../../components/ui';
import { useFeedback } from '../../../contexts/FeedbackContext';

/**
 * A modal for teachers/admins to set the passing threshold for assembly bills.
 * Uses Modal.Header/Body/Footer (no title prop) to match the provided Modal API/layout.
 */
export default function SetThresholdModal({ isOpen, onClose, classId }) {
    const [threshold, setThreshold] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [fallbackThreshold, setFallbackThreshold] = useState('');
    const { showFeedback } = useFeedback();

    // Fetch the current threshold value when the modal opens
    useEffect(() => {
        if (!isOpen || !classId) return;

        const fetchThreshold = async () => {
            setIsLoading(true);
            setFallbackThreshold('');
            try {
                // 올바른 경로: assemblySettings/criteria 문서에서 읽기
                const criteriaRef = doc(db, 'classes', classId, 'assemblySettings', 'criteria');
                const criteriaSnap = await getDoc(criteriaRef);

                if (criteriaSnap.exists() && criteriaSnap.data().passThreshold) {
                    setThreshold(criteriaSnap.data().passThreshold.toString());
                } else {
                    // 설정된 값이 없으면 학급 학생 수의 절반을 기본값으로 제안
                    const classRef = doc(db, 'classes', classId);
                    const classSnap = await getDoc(classRef);

                    if (classSnap.exists() && classSnap.data().studentCount) {
                        const suggestedThreshold = Math.ceil(classSnap.data().studentCount / 2);
                        setThreshold(suggestedThreshold.toString());
                        setFallbackThreshold(
                            `학급 학생 수: ${classSnap.data().studentCount}명 (절반: ${suggestedThreshold}표)`
                        );
                    } else {
                        setThreshold('18'); // 기본값
                        setFallbackThreshold('기본값 제안');
                    }
                }
            } catch (error) {
                console.error('투표 기준 조회 오류:', error);
                showFeedback('투표 기준을 불러오는 중 오류가 발생했습니다.', 'error');
            } finally {
                setIsLoading(false);
            }
        };

        fetchThreshold();
    }, [isOpen, classId, showFeedback]);

    // Handle saving the new threshold value
    const handleSave = async () => {
        const numThreshold = Number(threshold);
        if (!Number.isInteger(numThreshold) || numThreshold <= 0) {
            showFeedback('1 이상의 정수 값을 입력해주세요.', 'warning');
            return;
        }
        if (numThreshold > 100) {
            showFeedback('100 이하의 값을 입력해주세요.', 'warning');
            return;
        }

        setIsSaving(true);
        try {
            // 올바른 경로: assemblySettings/criteria 문서에 저장
            const criteriaRef = doc(db, 'classes', classId, 'assemblySettings', 'criteria');
            await setDoc(
                criteriaRef,
                { passThreshold: numThreshold, updatedAt: new Date() },
                { merge: true }
            );

            showFeedback(`투표 통과 기준이 ${numThreshold}표로 설정되었습니다.`, 'success');
            onClose();
        } catch (error) {
            console.error('투표 기준 저장 오류:', error);
            showFeedback('저장 중 오류가 발생했습니다: ' + error.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleClose = useCallback(() => {
        if (!isSaving) onClose();
    }, [isSaving, onClose]);

    return (
        <Modal isOpen={isOpen} onClose={handleClose} size="md">
            {/* 헤더: 제공된 Modal.Header 사용 (닫기 버튼 수동 배치) */}
            <Modal.Header>
                <h3 className="text-lg sm:text-xl font-semibold text-gray-800">
                    투표 가결 기준 설정
                </h3>
                <Button tone="slate" kind="ghost" size="icon-md"
                    onClick={handleClose}
                    
                    aria-label="Close modal"
                    disabled={isSaving}
                >
                    ×
                </Button>
            </Modal.Header>

            {/* 바디 */}
            <Modal.Body>
                {isLoading ? (
                    <div className="p-8 text-center">
                        <Spinner />
                        <p className="mt-2 text-sm text-slate-500">현재 설정을 불러오는 중...</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <InputField
                                label="가결에 필요한 최소 찬성표 수"
                                type="number"
                                value={threshold}
                                onChange={(e) => setThreshold(e.target.value)}
                                placeholder="예: 15"
                                min="1"
                                max="100"
                                required
                            />
                            {fallbackThreshold && (
                                <p className="mt-1 text-xs text-blue-600">💡 {fallbackThreshold}</p>
                            )}
                        </div>

                        <div className="bg-slate-50 p-3 rounded-md">
                            <h4 className="text-sm font-medium text-slate-700 mb-2">작동 방식</h4>
                            <ul className="text-xs text-slate-600 space-y-1">
                                <li>
                                    • 법안의 <strong>찬성표</strong>가 이 숫자 이상이면{' '}
                                    <span className="text-green-600">가결</span>
                                </li>
                                <li>
                                    • 찬성표가 이 숫자 미만이면 <span className="text-red-600">부결</span>
                                </li>
                                <li>• 반대표는 집계하지만 가결/부결 판정에는 영향 없음</li>
                            </ul>
                        </div>

                        {threshold && (
                            <div className="bg-blue-50 p-3 rounded-md">
                                <p className="text-sm text-blue-800">
                                    <strong>{threshold}표 이상</strong> 찬성하면 법안이 가결됩니다.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </Modal.Body>

            {/* 푸터 */}
            <Modal.Footer>
                <Button variant="outline" onClick={handleClose} disabled={isSaving}>
                    취소
                </Button>
                <Button onClick={handleSave} isLoading={isSaving} disabled={isSaving || isLoading}>
                    {isSaving ? '저장 중...' : '저장하기'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
