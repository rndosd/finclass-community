// src/pages/marketplace/modals/CategoryManagerModal.jsx

import React, { useState, useEffect } from 'react';
import { Modal, Button, InputField, ToggleSwitch } from '../../../components/ui';
import {
    CATEGORY_COLOR_CLASS_MAP,
    CATEGORY_COLOR_OPTIONS,
    getCategoryColorClasses,
} from '../../../components/ui/toneStyles';
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    serverTimestamp
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { useUser } from '../../../contexts/UserContext';
import { useFeedback } from '../../../contexts/FeedbackContext';
import {
    Plus, Tag, Edit3,
    ShoppingCart, Package, Gift, Sparkles, Gamepad2, Coffee, CupSoda, Pizza, BookOpen,
    Palette, Music2, GraduationCap, Trophy, Ticket, Star, Smartphone, Laptop, FlaskConical,
    Hammer, Wrench, Scissors, Heart, Leaf, Camera, Film, Headphones, Backpack, Brush,
} from 'lucide-react';

const ICON_MAP = {
    Tag, ShoppingCart, Package, Gift, Sparkles, Gamepad2, Coffee, CupSoda, Pizza, BookOpen,
    Palette, Music2, GraduationCap, Trophy, Ticket, Star, Smartphone, Laptop, FlaskConical,
    Hammer, Wrench, Scissors, Heart, Leaf, Camera, Film, Headphones, Backpack, Brush,
};

const ICON_OPTIONS = [
    'Tag', 'ShoppingCart', 'Package', 'Gift', 'Sparkles', 'Gamepad2', 'Coffee', 'CupSoda', 'Pizza', 'BookOpen',
    'Palette', 'Music2', 'GraduationCap', 'Trophy', 'Ticket', 'Star', 'Smartphone', 'Laptop', 'FlaskConical',
    'Hammer', 'Wrench', 'Scissors', 'Heart', 'Leaf', 'Camera', 'Film', 'Headphones', 'Backpack', 'Brush',
];

const COLOR_OPTIONS = CATEGORY_COLOR_OPTIONS;
const colorToClasses = getCategoryColorClasses;

// 이모지 제거용(레거시 호환)
const stripLeadingEmoji = (raw = '') => {
    const m = raw.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})\s*/u);
    return m ? raw.slice(m[0].length).trim() : raw;
};

const CategoryManagerModal = ({ isOpen, onClose, categoryToEdit = null, onCreated }) => {
    const { classId, userData } = useUser();
    const { showFeedback } = useFeedback();

    // 폼 상태 - Store 모달과 동일하게 변경
    const [name, setName] = useState('');
    const [iconName, setIconName] = useState('Tag');
    const [iconColor, setIconColor] = useState('indigo');
    const [isActive, setIsActive] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isEditMode = !!categoryToEdit;

    // 초기값 로드(수정/신규) - Store 패턴 적용
    useEffect(() => {
        if (isEditMode && categoryToEdit) {
            // 레거시 이모지 이름이면 제거
            const baseName = stripLeadingEmoji(categoryToEdit.name || '');
            setName(baseName || '');
            setIsActive(categoryToEdit.isActive ?? true);
            // 저장된 아이콘/색상 사용, 없으면 기본값
            setIconName(categoryToEdit.icon && ICON_MAP[categoryToEdit.icon] ? categoryToEdit.icon : 'Tag');
            setIconColor(CATEGORY_COLOR_CLASS_MAP[categoryToEdit.iconColor] ? categoryToEdit.iconColor : 'indigo');
        } else {
            setName('');
            setIsActive(true);
            setIconName('Tag');
            setIconColor('indigo');
        }
    }, [isEditMode, categoryToEdit]);

    const handleClose = () => {
        if (isSubmitting) return;
        setName('');
        setIsActive(true);
        setIconName('Tag');
        setIconColor('indigo');
        onClose();
    };

    // 카테고리 추가/수정 - Store 패턴 적용
    const handleSubmit = async () => {
        if (!classId) {
            showFeedback('학급 정보가 없습니다. 다시 시도해주세요.', 'error');
            return;
        }
        if (!name.trim()) {
            showFeedback('카테고리명을 입력해주세요.', 'warning');
            return;
        }

        setIsSubmitting(true);

        try {
            if (isEditMode) {
                const ref = doc(db, 'classes', classId, 'marketplace_categories', categoryToEdit.id);
                await updateDoc(ref, {
                    name: name.trim(),
                    icon: iconName,
                    iconColor,
                    isActive,
                    updatedAt: serverTimestamp(),
                });
                showFeedback('카테고리가 수정되었습니다!', 'success');
            } else {
                const col = collection(db, 'classes', classId, 'marketplace_categories');
                const docRef = await addDoc(col, {
                    name: name.trim(),
                    icon: iconName,
                    iconColor,
                    isActive,
                    teacherUid: userData?.uid || null,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    order: Math.floor(Date.now() / 1000),
                });
                showFeedback('카테고리가 추가되었습니다!', 'success');
                onCreated?.(docRef.id);
            }
            handleClose();
        } catch (err) {
            console.error('[CategoryManagerModal] save error:', err);
            showFeedback(isEditMode ? '카테고리 수정 중 오류가 발생했습니다.' : '카테고리 저장 중 오류가 발생했습니다.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const HeaderIcon = isEditMode ? Edit3 : Tag;
    const IconPreview = ICON_MAP[iconName];

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            size="md"
            title={
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-blue-600">
                        <HeaderIcon className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-xl font-bold">
                        {isEditMode ? '카테고리 수정' : '새 카테고리 추가'}
                    </span>
                </div>
            }
        >
            <div className="space-y-6 p-1">
                {isEditMode && categoryToEdit && (
                    <div className="bg-blue-50 ring-1 ring-blue-200 rounded-xl p-4">
                        <h4 className="text-sm font-semibold text-blue-700 mb-2">현재 카테고리</h4>
                        <div className="flex items-center gap-2 text-blue-800">
                            {categoryToEdit.icon && ICON_MAP[categoryToEdit.icon] ? (
                                React.createElement(ICON_MAP[categoryToEdit.icon], { className: 'h-4 w-4' })
                            ) : (
                                <Tag className="h-4 w-4" />
                            )}
                            <span className="font-medium">{stripLeadingEmoji(categoryToEdit.name || '')}</span>
                        </div>
                    </div>
                )}

                {/* 아이콘 선택 */}
                <div className="space-y-3">
                    <label className="block text-sm font-semibold text-slate-700">카테고리 아이콘</label>
                    <div className="grid grid-cols-8 gap-2 p-3 bg-slate-50 rounded-xl max-h-40 overflow-y-auto">
                        {ICON_OPTIONS.map((key) => {
                            const Ico = ICON_MAP[key];
                            const isActiveIcon = iconName === key;
                            return (
                                <Button
                                    key={key}
                                    type="button"
                                    onClick={() => setIconName(key)}
                                    className={[
                                        'w-10 h-10 rounded-lg transition-all duration-200 flex items-center justify-center border',
                                        isActiveIcon
                                            ? 'bg-white border-indigo-300 ring-2 ring-indigo-200 shadow'
                                            : 'bg-white border-slate-200 hover:bg-indigo-50',
                                    ].join(' ')}
                                    disabled={isSubmitting}
                                    title={key}
                                >
                                    <Ico className={`h-5 w-5 ${isActiveIcon ? 'text-indigo-600' : 'text-slate-600'}`} />
                                </Button>
                            );
                        })}
                    </div>
                </div>

                {/* 아이콘 색상 */}
                <div className="space-y-3">
                    <label className="block text-sm font-semibold text-slate-700">아이콘 색상</label>
                    <div className="flex flex-wrap gap-2">
                        {COLOR_OPTIONS.map((c) => (
                            <Button
                                key={c.key}
                                type="button"
                                onClick={() => setIconColor(c.key)}
                                disabled={isSubmitting}
                                className={[
                                    'inline-flex items-center gap-2 px-3 py-2 rounded-lg ring-1 transition-all',
                                    c.ring, c.bg, iconColor === c.key ? 'ring-2 shadow-sm' : 'hover:ring-2',
                                ].join(' ')}
                                title={c.label}
                            >
                                <div className={`w-4 h-4 rounded-md ${c.text.replace('text-', 'bg-')}`} />
                                <span className={`text-xs font-medium ${c.text}`}>{c.label}</span>
                            </Button>
                        ))}
                    </div>
                </div>

                {/* 카테고리명 */}
                <div className="space-y-2">
                    <InputField
                        label="카테고리명"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="전자기기 및 액세서리"
                        disabled={isSubmitting}
                        className="text-lg font-medium"
                    />
                </div>

                {/* 활성화 토글 */}
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                    <div>
                        <label className="text-sm font-semibold text-slate-700">카테고리 활성화</label>
                        <p className="text-xs text-slate-500 mt-1">비활성화하면 학생들에게 보이지 않습니다</p>
                    </div>
                    <ToggleSwitch checked={isActive} onChange={setIsActive} disabled={isSubmitting} />
                </div>

                {/* 미리보기 */}
                {name.trim() && (
                    <div className={`p-4 rounded-xl border ${iconColor === 'blue' ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100' : 'bg-gradient-to-r from-slate-50 to-white border-slate-200'}`}>
                        <h4 className={`text-sm font-semibold mb-3 ${colorToClasses(iconColor).text}`}>
                            미리보기 · {COLOR_OPTIONS.find(c => c.key === iconColor)?.label}
                        </h4>
                        <div className={`flex items-center gap-3 px-4 py-3 bg-white rounded-xl ring-1 shadow-sm ${colorToClasses(iconColor).ring}`}>
                            {IconPreview ? (
                                <IconPreview className={`h-5 w-5 ${colorToClasses(iconColor).text}`} />
                            ) : (
                                <Tag className={`h-5 w-5 ${colorToClasses(iconColor).text}`} />
                            )}
                            <span className="font-medium text-slate-700">{name.trim()}</span>
                            {!isActive && (
                                <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                    비활성
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* 액션 버튼 */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                    <Button size="md"
                        onClick={handleClose}
                        variant="outline"
                        disabled={isSubmitting}
                        
                    >
                        취소
                    </Button>
                    <Button tone="blue" kind="solid" size="md"
                        onClick={handleSubmit}
                        
                        isLoading={isSubmitting}
                        disabled={!name.trim()}
                        icon={isEditMode ? Edit3 : Plus}
                    >
                        {isSubmitting ? (isEditMode ? '수정 중...' : '추가 중...') : (isEditMode ? '카테고리 수정' : '카테고리 추가')}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default CategoryManagerModal;
