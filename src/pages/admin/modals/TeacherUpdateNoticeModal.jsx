// src/pages/admin/modals/TeacherUpdateNoticeModal.jsx
import React from 'react';
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    doc,
    getDoc,
    setDoc,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { Modal, Button } from '../../../components/ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/** 안전 변환(Timestamp | string | Date -> Date) */
const toDateSafe = (v) => {
    if (!v) return null;
    if (v.toDate) return v.toDate();       // Firestore Timestamp
    if (v instanceof Date) return v;       // JS Date
    if (typeof v === 'string') return new Date(v); // ISO string
    return null;
};

/** 로컬 타임존 기준 YYYY-MM-DD */
const todayYMD = () => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
};

/** Date -> YYYY-MM-DD */
const toYMD = (v) => {
    const d = toDateSafe(v);
    if (!d) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
};

/** 날짜 범위 확인 (더 안전한 방법) */
const isInDateRange = (startAt, endAt, targetDate = new Date()) => {
    const start = toDateSafe(startAt);
    const end = toDateSafe(endAt);

    if (!start || !end) return false;

    // 날짜만 비교 (시간 제거)
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const today = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

    return startDate <= today && today <= endDate;
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

/** Firestore 권한 오류 코드 판별 */
const isPermissionDenied = (error) => {
    const code = error?.code || '';
    return code === 'permission-denied' || code.endsWith('/permission-denied');
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

export default function TeacherUpdateNoticeModal({ uid }) {
    const [open, setOpen] = React.useState(false);
    const [notice, setNotice] = React.useState(null);
    const [saving, setSaving] = React.useState(false);

    const todayStr = todayYMD();
    const mkDismissId = React.useCallback((nid) => `${nid}_${todayStr}`, [todayStr]);

    React.useEffect(() => {
        if (!uid) return;

        (async () => {
            try {
                // 1) isActive(=active) == true + 최신 5건만 가져오기
                const q = query(
                    collection(db, 'globalUpdateMessages'),
                    where('active', '==', true),
                    orderBy('createdAt', 'desc'),
                    limit(5)
                );
                const snap = await getDocs(q);
                if (snap.empty) {
                    setNotice(null);
                    setOpen(false);
                    return;
                }

                // 2) 기간 필터는 클라이언트에서 날짜 비교
                const candidates = snap.docs
                    .map((d) => ({ id: d.id, ...d.data() }))
                    .filter((n) => isInDateRange(n.startAt, n.endAt));

                if (candidates.length === 0) {
                    setNotice(null);
                    setOpen(false);
                    return;
                }

                // 3) 오늘 숨김 여부 확인
                const latest = candidates[0];
                const dismissRef = doc(db, `users/${uid}/noticeDismissals/${mkDismissId(latest.id)}`);
                const dismissed = await getDoc(dismissRef);
                if (dismissed.exists()) {
                    setNotice(null);
                    setOpen(false);
                    return;
                }

                setNotice(latest);
                setOpen(true);
            } catch (e) {
                if (!isPermissionDenied(e)) {
                    console.warn('[TeacherUpdateNoticeModal] load error:', getErrorMessage(e));
                }
                setNotice(null);
                setOpen(false);
            }
        })();
    }, [mkDismissId, uid]);

    if (!notice) return null;

    const handleDismissToday = async () => {
        try {
            setSaving(true);
            const ref = doc(db, `users/${uid}/noticeDismissals/${mkDismissId(notice.id)}`);
            await setDoc(ref, { noticeId: notice.id, dismissedAt: new Date() }, { merge: true });
        } catch (e) {
            if (!isPermissionDenied(e)) {
                console.warn('[TeacherUpdateNoticeModal] dismiss error:', getErrorMessage(e));
            }
        } finally {
            setSaving(false);
            setOpen(false);
            setNotice(null);
        }
    };

    const handleCloseOnce = () => {
        // 기록 없이 이번 진입에서만 닫기
        setOpen(false);
    };

    return (
        <Modal isOpen={open} onClose={handleCloseOnce} title="📢 업데이트 공지" size="lg">
            <div className="space-y-6">
                {/* 공지 내용 - 더 깔끔한 스타일링 */}
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <div className="prose prose-sm max-w-none">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            components={MarkdownComponents}
                        >
                            {notice.content || ''}
                        </ReactMarkdown>
                    </div>
                </div>

                {/* 기간 정보 */}
                <div className="flex items-center justify-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                        <span>📅</span>
                        <span>기간: {toYMD(notice.startAt)} ~ {toYMD(notice.endAt)}</span>
                    </div>
                </div>

                {/* 버튼 영역 */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                    <Button variant="outline" onClick={handleCloseOnce}>
                        닫기
                    </Button>
                    <Button onClick={handleDismissToday} isLoading={saving}>
                        오늘 하루 보지 않기
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
