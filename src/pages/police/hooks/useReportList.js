import { appConfirm } from "../../../utils/appDialogs";
import { useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useUser } from '../../../contexts/UserContext';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { checkIsPoliceAdmin, resolvePoliceReports } from '../utils/policeUtils';
import { applyVisibilityToList } from '../utils/VisibilityResolver';
import { usePoliceSettingsQuery } from '../hooks/usePoliceQuery';

const REPORT_TYPE_FREEFORM = 'freeform';

const resolveReportType = (report = {}) => (
    typeof report?.reportType === 'string' && report.reportType.trim()
        ? report.reportType.trim()
        : report?.ruleId
            ? 'rule'
            : REPORT_TYPE_FREEFORM
);

export const useReportList = ({
    classId,
    reports = [],
    policeRules = [],
    filters,
    policeSettings,
}) => {
    const { userData, hasPermission } = useUser();
    const { showFeedback } = useFeedback();
    const queryClient = useQueryClient();

    const shouldLoadSettings = policeSettings === undefined;
    const { data: settings } = usePoliceSettingsQuery(classId, shouldLoadSettings);
    const [processingId, setProcessingId] = useState(null);
    const isPoliceAdmin = checkIsPoliceAdmin(userData) || hasPermission?.('permission_group_police');
    const resolvedSettings = policeSettings ?? settings;

    const viewer = useMemo(() => ({
        uid: userData?.uid,
        role: userData?.role,
        isPoliceAdmin,
    }), [userData, isPoliceAdmin]);

    const visibleReports = useMemo(() => {
        if (!reports?.length || !resolvedSettings) return [];
        return applyVisibilityToList(reports, policeRules, viewer, resolvedSettings);
    }, [reports, policeRules, viewer, resolvedSettings]);

    const filteredReports = useMemo(() => {
        if (!visibleReports.length) return [];
        if (!filters) return visibleReports;

        return visibleReports.filter((report) => {
            // 미처리 신고는 담당자가 놓치지 않도록 목록 필터와 관계없이 항상 노출한다.
            if (report.status === 'pending') return true;

            if (filters.dateStart || filters.dateEnd) {
                const d = report.createdAt?.toDate ? report.createdAt.toDate() : new Date(report.createdAt);
                if (filters.dateStart && d < new Date(filters.dateStart)) return false;
                if (filters.dateEnd && d > new Date(filters.dateEnd + ' 23:59:59')) return false;
            }
            if (filters.status !== 'all' && report.status !== filters.status) return false;
            if (filters.studentName && !report.accusedStudentName?.toLowerCase().includes(filters.studentName.toLowerCase())) return false;
            if (filters.sensitiveOnly && !report.isSensitive) return false;
            return true;
        });
    }, [visibleReports, filters]);

    const handleBulkResolve = useCallback(async (selectedReports, applyPenalty = false, options = {}) => {
        if (!classId || !userData?.uid || selectedReports.length === 0) return false;

        const safeTargets = applyPenalty
            ? selectedReports.filter((report) => resolveReportType(report) !== REPORT_TYPE_FREEFORM)
            : selectedReports;

        if (safeTargets.length === 0) {
            showFeedback('\uc790\uc720 \uc2e0\uace0\ub294 \uaddc\uce59 \uc801\uc6a9 \ub300\uc2e0 \uc784\uc758\ubd80\uacfc \ub610\ub294 \uae30\uac01\uc73c\ub85c \ucc98\ub9ac\ud574\uc57c \ud569\ub2c8\ub2e4.', 'warning');
            return false;
        }

        const count = safeTargets.length;
        const actionText = applyPenalty ? '처벌' : '반려';
        const rejectReason = String(options.rejectReason || "").trim();
        const rejectReasonByReportId =
            options.rejectReasonByReportId && typeof options.rejectReasonByReportId === 'object'
                ? options.rejectReasonByReportId
                : {};
        const hasRejectReasonMap = Object.keys(rejectReasonByReportId).length > 0;

        if (!applyPenalty && !hasRejectReasonMap && rejectReason.length === 0) {
            showFeedback('반려 사유를 입력해 주세요.', 'warning');
            return false;
        }

        if (!applyPenalty && hasRejectReasonMap) {
            const missingReason = safeTargets.some((report) => {
                const reason = String(rejectReasonByReportId[report.id] || "").trim();
                return reason.length === 0;
            });

            if (missingReason) {
                showFeedback('모든 신고의 반려 사유를 입력해 주세요.', 'warning');
                return false;
            }
        }

        if (!options.skipConfirm && !(await appConfirm(`선택한 ${count}건의 신고를 일괄 '${actionText}' 처리하시겠습니까?`))) {
            return false;
        }

        setProcessingId('bulk-processing');
        try {
            const result = await resolvePoliceReports({
                reportIds: safeTargets.map((report) => report.id),
                decision: applyPenalty ? 'applied' : 'ignored',
                rejectReason,
                rejectReasonByReportId,
            });

            if (!result?.success) {
                throw new Error(result?.message || '신고 처리에 실패했습니다.');
            }

            showFeedback(`${count}건의 신고가 성공적으로 ${actionText} 처리되었습니다.`, 'success');
            queryClient.invalidateQueries({
                queryKey: ['policeFineHistory', classId],
                exact: false,
            });
            queryClient.invalidateQueries({
                queryKey: ['policeReports', classId],
            });
            return true;
        } catch (error) {
            console.error('일괄 처리 에러:', error);
            showFeedback('처리 중 오류 발생: ' + error.message, 'error');
            return false;
        } finally {
            setProcessingId(null);
        }
    }, [classId, userData, showFeedback, queryClient]);

    const handleResolveReport = (report, applyPenalty) => handleBulkResolve([report], applyPenalty);

    return {
        reports: filteredReports,
        processingId,
        handleResolveReport,
        handleBulkResolve,
    };
};
