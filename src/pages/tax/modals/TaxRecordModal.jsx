// src/pages/tax/modals/TaxRecordModal.jsx
import React, { useState } from 'react';
import { useUser } from '../../../contexts/UserContext';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { Modal, Button, InputField, Textarea } from '../../../components/ui';
import { Receipt, TrendingUp, TrendingDown } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase';

const TaxRecordModal = ({ isOpen, onClose, classId }) => {
    const { classData } = useUser();
    const { showFeedback } = useFeedback();
    const currencyUnit = classData?.currencyUnit || '원';

    const [formData, setFormData] = useState({
        amount: '',
        reason: '',
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const getTransactionType = () => {
        const amount = parseFloat(formData.amount);
        if (isNaN(amount) || amount === 0) return 'none';
        return amount > 0 ? 'income' : 'expense';
    };

    const transactionType = getTransactionType();
    const absoluteAmount = Math.abs(parseFloat(formData.amount) || 0);

    const resetForm = () => {
        setFormData({ amount: '', reason: '' });
        setError('');
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (error) setError('');
    };

    const validateForm = () => {
        const amount = parseFloat(formData.amount);
        if (isNaN(amount) || amount === 0) {
            setError("0이 아닌 유효한 금액을 입력해주세요. (양수: 수입, 음수: 지출)");
            return false;
        }
        if (!formData.reason.trim()) {
            setError("사유를 입력해주세요.");
            return false;
        }
        if (formData.reason.length > 200) {
            setError("사유는 200자 이내로 입력해주세요.");
            return false;
        }
        return true;
    };

    const getErrorMessage = (err) => {
        if (typeof err?.details?.message === 'string' && err.details.message.trim()) {
            return err.details.message;
        }
        if (typeof err?.message === 'string' && err.message.trim()) {
            return err.message;
        }
        return '기록 중 오류가 발생했습니다.';
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateForm()) return;
        if (!classId) {
            const message = '학급 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.';
            setError(message);
            showFeedback(message, 'error');
            return;
        }

        setIsSubmitting(true);
        setError('');

        try {
            const isIncome = transactionType === 'income';
            let result;

            if (isIncome) {
                // ✅ Cloud Function 호출로 단순화
                const recordTaxIncome = httpsCallable(functions, 'recordTaxIncome');
                result = await recordTaxIncome({
                    classId,
                    amount: absoluteAmount,
                    taxType: 'manual_income',
                    description: formData.reason.trim(),
                });
            } else {
                // ✅ Cloud Function 호출로 단순화
                const recordTaxExpense = httpsCallable(functions, 'recordTaxExpense');
                result = await recordTaxExpense({
                    classId,
                    amountUsed: absoluteAmount,
                    reason: formData.reason.trim(),
                    category: 'general',
                });
            }

            if (result?.data?.success) {
                const successMessage = result.data.message || (isIncome ? '세금 수입이 기록되었습니다.' : '세금 지출이 기록되었습니다.');
                showFeedback(successMessage, 'success');
                handleClose();
            } else {
                const failMessage = result?.data?.message || '기록에 실패했습니다.';
                setError(failMessage);
                showFeedback(failMessage, 'error');
            }
        } catch (error) {
            console.error('세금 기록 오류:', error);
            const message = getErrorMessage(error);
            setError(message);
            showFeedback(message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const getUITheme = () => {
        switch (transactionType) {
            case 'income':
                return {
                    bgColor: 'bg-green-100',
                    textColor: 'text-green-600',
                    borderColor: 'border-green-200',
                    icon: TrendingUp,
                    label: '세금 수입 기록',
                    description: '학급 세금 수입을 기록합니다',
                    amountPrefix: '+',
                    helpText: '금액이 학급 세금 잔액에 추가됩니다'
                };
            case 'expense':
                return {
                    bgColor: 'bg-red-100',
                    textColor: 'text-red-600',
                    borderColor: 'border-red-200',
                    icon: TrendingDown,
                    label: '세금 지출 기록',
                    description: '학급 세금 지출을 기록합니다',
                    amountPrefix: '-',
                    helpText: '금액이 학급 세금 잔액에서 차감됩니다'
                };
            default:
                return {
                    bgColor: 'bg-gray-100',
                    textColor: 'text-gray-600',
                    borderColor: 'border-gray-200',
                    icon: Receipt,
                    label: '세금 수입/지출 기록',
                    description: '양수면 수입, 음수면 지출로 기록됩니다',
                    amountPrefix: '',
                    helpText: '양수면 수입, 음수면 지출로 기록됩니다'
                };
        }
    };

    const theme = getUITheme();
    const ThemeIcon = theme.icon;

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={handleClose} size="md">
            <div className="flex flex-col">
                <div className="flex items-center gap-3 p-6 border-b border-slate-200">
                    <div className={`p-2 rounded-full ${theme.bgColor}`}>
                        <ThemeIcon className={`h-5 w-5 ${theme.textColor}`} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">{theme.label}</h2>
                        <p className="text-sm text-slate-500">{theme.description}</p>
                    </div>
                </div>

                <div className="p-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                            <p className="text-sm text-blue-700">
                                💡 <strong>사용법:</strong> 양수(+)는 수입, 음수(-)는 지출로 기록됩니다
                            </p>
                            <p className="text-xs text-blue-600 mt-1">
                                예: 5000 (수입), -3000 (지출)
                            </p>
                        </div>

                        <div>
                            <label htmlFor="tax-amount" className="block text-sm font-medium text-slate-700 mb-2">
                                금액 <span className="text-red-500">*</span>
                                {transactionType !== 'none' && (
                                    <span className={`ml-2 text-xs px-2 py-1 rounded-full ${theme.bgColor} ${theme.textColor}`}>
                                        {transactionType === 'income' ? '수입' : '지출'}
                                    </span>
                                )}
                            </label>
                            <div className="relative">
                                <InputField
                                    id="tax-amount"
                                    type="number"
                                    value={formData.amount}
                                    onChange={(e) => handleInputChange('amount', e.target.value)}
                                    placeholder="예: 5000 (수입) 또는 -3000 (지출)"
                                    step="1"
                                    className="pr-16"
                                    required
                                />
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                    <span className="text-slate-500 text-sm">{currencyUnit}</span>
                                </div>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                                {theme.helpText}
                            </p>
                        </div>

                        <div>
                            <label htmlFor="tax-reason" className="block text-sm font-medium text-slate-700 mb-2">
                                내용 <span className="text-red-500">*</span>
                            </label>
                            <Textarea
                                id="tax-reason"
                                value={formData.reason}
                                onChange={(e) => handleInputChange('reason', e.target.value)}
                                placeholder="구체적인 수입 또는 지출 사유를 입력하세요"
                                rows={3}
                                maxLength={200}
                                required
                            />
                            <div className="flex justify-end mt-1">
                                <p className="text-xs text-slate-400">
                                    {formData.reason.length}/200
                                </p>
                            </div>
                        </div>

                        {error && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                                <p className="text-sm text-red-600 flex items-center gap-2">
                                    <span className="font-medium">오류:</span>
                                    {error}
                                </p>
                            </div>
                        )}

                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                            <Button type="button" onClick={handleClose} variant="secondary" disabled={isSubmitting}>
                                취소
                            </Button>
                            <Button
                                type="submit"
                                disabled={isSubmitting || !formData.amount || !formData.reason.trim() || transactionType === 'none'}
                                className="min-w-[100px]"
                            >
                                {isSubmitting ? '저장 중...' : '저장하기'}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </Modal>
    );
};

export default TaxRecordModal;
