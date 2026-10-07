import { appConfirm } from "../../../utils/appDialogs";
// src/pages/admin/components/GlobalUpdateNoticeAdmin.jsx
import React, { useState, useEffect } from 'react';
import { db } from '../../../firebase';
import {
    collection,
    addDoc,
    onSnapshot,
    deleteDoc,
    doc,
    updateDoc,
    serverTimestamp,
} from 'firebase/firestore';

import {
    Card,
    Button,
    InputField,
    Textarea,
    Spinner,
    Tooltip,
    Modal,
} from '../../../components/ui';

import { useFeedback } from '../../../contexts/FeedbackContext';
import { Trash2, Eye, EyeOff, FileText } from 'lucide-react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import dayjs from 'dayjs';

// 🔹 안전 변환 유틸
const toDateSafe = (v) => {
    if (!v) return null;
    if (v.toDate) return v.toDate(); // Firestore Timestamp
    if (v instanceof Date) return v;
    if (typeof v === 'string') return new Date(v);
    return null;
};

const formatDateTime = (v, fmt = 'YYYY-MM-DD HH:mm') => {
    const d = toDateSafe(v);
    return d ? dayjs(d).format(fmt) : '';
};

const ymd = (v) => {
    const d = toDateSafe(v);
    return d ? dayjs(d).format('YYYY-MM-DD') : '';
};

/** 에러 메시지 안전 추출 */
const getErrorMessage = (error) => {
    if (error?.code && error?.message) {
        return `${error.code}: ${error.message}`;
    }
    if (error?.message) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return '알 수 없는 오류가 발생했습니다.';
};

/** 입력 값 검증 */
const validateNoticeInput = (content, startAt, endAt) => {
    const errors = [];

    if (!content?.trim()) {
        errors.push('내용을 입력해주세요.');
    }

    if (startAt && endAt) {
        const start = new Date(startAt);
        const end = new Date(endAt);
        if (start > end) {
            errors.push('시작일이 종료일보다 늦을 수 없습니다.');
        }
    }

    return errors;
};

// 🔹 ReactMarkdown 컴포넌트 설정 - 더 깔끔한 스타일링
const MarkdownComponents = {
    a: ({ href, children, ...props }) => (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline"
            {...props}
        >
            {children}
        </a>
    ),
    h1: ({ children, ...props }) => (
        <h1 className="text-2xl font-bold text-slate-800 mb-4 border-b border-slate-200 pb-2" {...props}>
            {children}
        </h1>
    ),
    h2: ({ children, ...props }) => (
        <h2 className="text-xl font-semibold text-slate-800 mb-3 mt-6" {...props}>
            {children}
        </h2>
    ),
    h3: ({ children, ...props }) => (
        <h3 className="text-lg font-semibold text-slate-700 mb-2 mt-4" {...props}>
            {children}
        </h3>
    ),
    p: ({ children, ...props }) => (
        <p className="text-slate-700 mb-3 leading-relaxed" {...props}>
            {children}
        </p>
    ),
    ul: ({ children, ...props }) => (
        <ul className="list-disc list-inside text-slate-700 mb-3 space-y-1" {...props}>
            {children}
        </ul>
    ),
    ol: ({ children, ...props }) => (
        <ol className="list-decimal list-inside text-slate-700 mb-3 space-y-1" {...props}>
            {children}
        </ol>
    ),
    li: ({ children, ...props }) => (
        <li className="text-slate-700 leading-relaxed" {...props}>
            {children}
        </li>
    ),
    strong: ({ children, ...props }) => (
        <strong className="font-semibold text-slate-800" {...props}>
            {children}
        </strong>
    ),
    blockquote: ({ children, ...props }) => (
        <blockquote className="border-l-4 border-blue-200 bg-blue-50 pl-4 py-2 mb-3 italic text-slate-600" {...props}>
            {children}
        </blockquote>
    ),
    code: ({ children, ...props }) => (
        <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-sm font-mono" {...props}>
            {children}
        </code>
    ),
    pre: ({ children, ...props }) => (
        <pre className="bg-slate-100 text-slate-800 p-3 rounded-md mb-3 overflow-x-auto text-sm font-mono" {...props}>
            {children}
        </pre>
    ),
};

// 🔹 공지 템플릿
const NOTICE_TEMPLATES = [
    {
        key: 'update',
        label: '📦 기능 업데이트',
        content: `📦 기능 업데이트\n\n**변경사항**\n1. \n2. \n3. \n\n**개선사항**\n1. \n2. \n3. `,
    },
    {
        key: 'notice',
        label: '📢 일반 공지',
        content: `📢 공지사항\n\n**안내사항**\n1. \n2. \n3. \n\n`,
    },
];

const GlobalUpdateNoticeAdmin = () => {
    const { showFeedback } = useFeedback();

    const [content, setContent] = useState('');
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [active, setActive] = useState(true);
    const [loading, setLoading] = useState(true);
    const [notices, setNotices] = useState([]);
    const [creating, setCreating] = useState(false);

    // 미리보기 모달
    const [preview, setPreview] = useState(null);

    // Firestore 구독
    useEffect(() => {
        const q = collection(db, 'globalUpdateMessages');
        const unsub = onSnapshot(
            q,
            (snap) => {
                let data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                data.sort(
                    (a, b) =>
                        (toDateSafe(b.createdAt)?.getTime() || 0) -
                        (toDateSafe(a.createdAt)?.getTime() || 0)
                );
                setNotices(data);
                setLoading(false);
            },
            (err) => {
                console.error('[globalUpdateMessages:onSnapshot]', getErrorMessage(err));
                showFeedback(`데이터 구독 오류: ${getErrorMessage(err)}`, 'error');
                setLoading(false);
            }
        );
        return () => unsub();
    }, [showFeedback]);

    // 공지 등록
    const handleCreate = async () => {
        const validationErrors = validateNoticeInput(content, startAt, endAt);
        if (validationErrors.length > 0) {
            showFeedback(validationErrors[0], 'warning');
            return;
        }

        setCreating(true);
        try {
            await addDoc(collection(db, 'globalUpdateMessages'), {
                content: content.trim(),
                startAt: startAt ? new Date(startAt) : null,
                endAt: endAt ? new Date(endAt) : null,
                active,
                createdAt: serverTimestamp(),
            });
            showFeedback('공지 등록 완료', 'success');

            // 폼 초기화
            setContent('');
            setStartAt('');
            setEndAt('');
            setActive(true);
        } catch (err) {
            console.error('[create global notice]', err);
            showFeedback(`공지 등록 실패: ${getErrorMessage(err)}`, 'error');
        } finally {
            setCreating(false);
        }
    };

    // 삭제
    const handleDelete = async (id) => {
        if (!(await appConfirm('이 공지를 삭제할까요?', {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;

        try {
            await deleteDoc(doc(db, 'globalUpdateMessages', id));
            showFeedback('삭제 완료', 'success');
        } catch (err) {
            console.error('[delete notice]', err);
            showFeedback(`삭제 실패: ${getErrorMessage(err)}`, 'error');
        }
    };

    // 상태 토글
    const handleToggle = async (id, current) => {
        try {
            await updateDoc(doc(db, 'globalUpdateMessages', id), {
                active: !current,
            });
            showFeedback('상태 변경 완료', 'success');
        } catch (err) {
            console.error('[toggle notice]', err);
            showFeedback(`상태 변경 실패: ${getErrorMessage(err)}`, 'error');
        }
    };

    // 템플릿 삽입
    const applyTemplate = (tpl) => {
        setContent(tpl.content);
        showFeedback(`"${tpl.label}" 템플릿이 적용되었습니다.`, 'info');
    };

    return (
        <Card>
            <Card.Header>
                <Card.Title>전역 공지 관리</Card.Title>
                <Card.Description>교사 계정에 보여질 전역 공지를 작성합니다.</Card.Description>
            </Card.Header>
            <Card.Content noPadding className="space-y-4">
                {/* 템플릿 선택 */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        템플릿 선택
                    </label>
                    <select
                        className="border border-blue-200 rounded-md p-2 text-sm w-full focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        onChange={(e) => {
                            const tpl = NOTICE_TEMPLATES.find((t) => t.key === e.target.value);
                            if (tpl) applyTemplate(tpl);
                            e.target.value = ''; // 선택 초기화
                        }}
                        defaultValue=""
                    >
                        <option value="">템플릿을 선택하세요...</option>
                        {NOTICE_TEMPLATES.map((tpl) => (
                            <option key={tpl.key} value={tpl.key}>
                                {tpl.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* 공지 내용 */}
                <Textarea
                    label="공지 내용"
                    rows={6}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="마크다운 문법을 사용할 수 있습니다..."
                />

                {/* 날짜 설정 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InputField
                        type="date"
                        label="시작일"
                        value={startAt}
                        onChange={(e) => setStartAt(e.target.value)}
                    />
                    <InputField
                        type="date"
                        label="종료일"
                        value={endAt}
                        onChange={(e) => setEndAt(e.target.value)}
                    />
                </div>

                {/* 활성화 체크박스 */}
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => setActive(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-slate-700">활성화</span>
                </label>

                {/* 버튼 영역 */}
                <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                        color="blue"
                        onClick={handleCreate}
                        isLoading={creating}
                        disabled={creating}
                    >
                        공지 등록
                    </Button>
                    {content.trim() && (
                        <Button
                            color="gray"
                            variant="outline"
                            onClick={() => setPreview(content)}
                        >
                            미리보기
                        </Button>
                    )}
                </div>
            </Card.Content>

            {/* 등록된 공지 목록 */}
            <Card.Content noPadding>
                <h3 className="text-lg font-semibold mb-4 text-slate-800">등록된 공지</h3>
                {loading ? (
                    <div className="flex justify-center py-8">
                        <Spinner />
                    </div>
                ) : notices.length === 0 ? (
                    <div className="text-center py-8">
                        <p className="text-sm text-slate-500">등록된 공지가 없습니다.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="p-3 text-left font-semibold text-slate-700">내용(첫 줄)</th>
                                    <th className="p-3 text-left font-semibold text-slate-700">시작일</th>
                                    <th className="p-3 text-left font-semibold text-slate-700">종료일</th>
                                    <th className="p-3 text-left font-semibold text-slate-700">상태</th>
                                    <th className="p-3 text-left font-semibold text-slate-700">작성일</th>
                                    <th className="p-3 text-center font-semibold text-slate-700">작업</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {notices.map((n) => {
                                    const firstLine = (n.content || '').split('\n')[0];
                                    return (
                                        <tr key={n.id} className="hover:bg-slate-25">
                                            <td className="p-3 max-w-xs">
                                                <Tooltip text={n.content}>
                                                    <div className="truncate text-slate-800">
                                                        {firstLine || '(내용 없음)'}
                                                    </div>
                                                </Tooltip>
                                            </td>
                                            <td className="p-3 text-slate-600">{ymd(n.startAt) || '-'}</td>
                                            <td className="p-3 text-slate-600">{ymd(n.endAt) || '-'}</td>
                                            <td className="p-3">
                                                {n.active ? (
                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                        활성
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                                        비활성
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-slate-600">
                                                {formatDateTime(n.createdAt, 'YYYY-MM-DD')}
                                            </td>
                                            <td className="p-3">
                                                <div className="flex justify-center gap-1">
                                                    <Button
                                                        size="sm"
                                                        color="blue"
                                                        variant="outline"
                                                        icon={FileText}
                                                        onClick={() => setPreview(n.content)}
                                                        title="미리보기"
                                                    >
                                                        미리보기
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        color={n.active ? 'gray' : 'green'}
                                                        variant="outline"
                                                        icon={n.active ? EyeOff : Eye}
                                                        onClick={() => handleToggle(n.id, n.active)}
                                                    >
                                                        {n.active ? '숨김' : '보임'}
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        color="red"
                                                        variant="outline"
                                                        icon={Trash2}
                                                        onClick={() => handleDelete(n.id)}
                                                    >
                                                        삭제
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card.Content>

            {/* 📌 Markdown 미리보기 모달 - 더 깔끔한 스타일링 */}
            {preview && (
                <Modal isOpen={true} onClose={() => setPreview(null)} size="lg">
                    <Modal.Header>
                        <div className="flex items-center gap-2">
                            <span>📢</span>
                            <span>공지 미리보기</span>
                        </div>
                    </Modal.Header>
                    <Modal.Body>
                        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                            <div className="prose prose-sm max-w-none">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm, remarkBreaks]}
                                    components={MarkdownComponents}
                                >
                                    {preview}
                                </ReactMarkdown>
                            </div>
                        </div>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button variant="outline" onClick={() => setPreview(null)}>
                            닫기
                        </Button>
                    </Modal.Footer>
                </Modal>
            )}
        </Card>
    );
};

export default GlobalUpdateNoticeAdmin;