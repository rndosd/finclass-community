"use strict";

const AGENT_ACTION_REGISTRY = {
    prepare_notice_draft: {
        label: "안내문 초안 준비",
        domain: "dashboard",
        riskLevel: "low",
        executable: false,
        reviewConfirmationEnabled: true,
        featureFlagKey: "settings.aiAgentActionFlags.prepare_notice_draft",
    },
    prepare_checklist: {
        label: "점검표 준비",
        domain: "dashboard",
        riskLevel: "low",
        executable: false,
        reviewConfirmationEnabled: true,
        featureFlagKey: "settings.aiAgentActionFlags.prepare_checklist",
    },
    prepare_daily_brief: {
        label: "오늘 브리핑 준비",
        domain: "dashboard",
        riskLevel: "low",
        executable: false,
        reviewConfirmationEnabled: true,
        featureFlagKey: "settings.aiAgentActionFlags.prepare_daily_brief",
    },
    prepare_payroll: {
        label: "급여 지급안 준비",
        domain: "payroll",
        riskLevel: "medium",
        executable: false,
        reviewConfirmationEnabled: true,
        featureFlagKey: "settings.aiAgentActionFlags.prepare_payroll",
    },
    prepare_tax_reminder: {
        label: "세금/자리세 안내 준비",
        domain: "tax",
        riskLevel: "medium",
        executable: false,
        reviewConfirmationEnabled: true,
        featureFlagKey: "settings.aiAgentActionFlags.prepare_tax_reminder",
    },
    prepare_store_review: {
        label: "스토어 점검 준비",
        domain: "store",
        riskLevel: "medium",
        executable: false,
        reviewConfirmationEnabled: true,
        featureFlagKey: "settings.aiAgentActionFlags.prepare_store_review",
    },
    prepare_police_review: {
        label: "생활 규칙 점검 준비",
        domain: "police",
        riskLevel: "medium",
        executable: false,
        reviewConfirmationEnabled: true,
        featureFlagKey: "settings.aiAgentActionFlags.prepare_police_review",
    },
    prepare_routine_work: {
        label: "반복 업무 준비",
        domain: "dashboard",
        riskLevel: "low",
        executable: false,
        reviewConfirmationEnabled: true,
        featureFlagKey: "settings.aiAgentActionFlags.prepare_routine_work",
    },
};

const createAgentActionHelpers = ({
    crypto,
    formatDateKeyInKST,
    HttpsError,
    cleanString,
}) => {
    const readActionFlagValue = (flags, actionType) => {
        const value = flags && typeof flags === "object" ? flags[actionType] : null;
        if (typeof value === "boolean") return value;
        if (value && typeof value === "object" && typeof value.enabled === "boolean") return value.enabled;
        return false;
    };

    const buildAgentActionTypePolicies = (settings = {}, classData = {}) => {
        const actionFlags = settings.aiAgentActionFlags || classData.aiAgentActionFlags || {};
        return Object.entries(AGENT_ACTION_REGISTRY).map(([actionType, item]) => {
            const actionFlagEnabled = readActionFlagValue(actionFlags, actionType);
            return {
                actionType,
                label: item.label || actionType,
                domain: item.domain || "dashboard",
                riskLevel: item.riskLevel || "low",
                featureFlagKey: item.featureFlagKey || "settings.aiAgentActionFlags." + actionType,
                featureFlagEnabled: actionFlagEnabled,
                draftEnabled: true,
                reviewConfirmationEnabled: item.reviewConfirmationEnabled !== false,
                executionEnabled: false,
                executable: false,
                mode: "prepare_and_confirm_review_only",
                statusLabel: actionFlagEnabled ? "플래그 켜짐 · 검토 기록만 가능" : "초안/검토 기록만 가능",
                disabledReason: actionFlagEnabled ?
                    "액션별 플래그는 켜져 있지만 실제 실행 엔진은 아직 연결되지 않았습니다." :
                    "현재 단계에서는 실행 없이 초안 저장과 검토 완료 기록만 제공합니다.",
            };
        });
    };

    const sanitizeAgentActionInput = (value = {}) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new HttpsError("invalid-argument", "action must be an object.");
        }
        const actionType = cleanString(value.actionType || "prepare_checklist");
        const registryItem = AGENT_ACTION_REGISTRY[actionType];
        if (!registryItem) {
            throw new HttpsError("invalid-argument", "Unsupported agent action type.");
        }
        const title = cleanString(value.title || "AI 준비 작업").slice(0, 120);
        const domain = cleanString(value.domain || "dashboard").slice(0, 40) || "dashboard";
        const text = cleanString(value.text || value.summary || "").slice(0, 4000);
        const targets = Array.isArray(value.targets) ? value.targets.slice(0, 50).map((target) => ({
            uid: cleanString(target?.uid || target?.studentUid || "").slice(0, 128),
            name: cleanString(target?.name || "").slice(0, 80),
            reason: cleanString(target?.reason || "").slice(0, 200),
        })) : [];

        return {
            actionType,
            domain,
            title,
            text,
            riskLevel: registryItem.riskLevel,
            executable: false,
            requiresConfirmation: true,
            sourceKind: cleanString(value.sourceKind || "manual_review").slice(0, 60),
            sourceCardId: cleanString(value.sourceCardId || value.id || "").slice(0, 160) || null,
            deepLink: cleanString(value.deepLink || "").slice(0, 200) || null,
            targets,
            targetCount: targets.length,
        };
    };

    const buildAgentActionPreview = (action) => ({
        schemaVersion: 1,
        summary: `${action.title} 실행안을 준비합니다. 실제 데이터는 변경하지 않습니다.`,
        changes: [],
        targetCount: action.targetCount,
        riskLevel: action.riskLevel,
        requiresConfirmation: true,
        executable: false,
        messageDraft: action.text || null,
        guardrails: [
            "현재 단계에서는 자동 승인, 지급, 차감, 삭제를 실행하지 않습니다.",
            "선생님이 검토한 뒤 관련 페이지에서 직접 실행해야 합니다.",
        ],
    });

    const buildAgentActionIdempotencyKey = ({ classId, action }) => crypto
        .createHash("sha256")
        .update(JSON.stringify({
            classId,
            actionType: action.actionType,
            title: action.title,
            sourceCardId: action.sourceCardId,
            text: action.text,
            targets: action.targets.map((target) => target.uid || target.name),
            dateKey: formatDateKeyInKST(new Date()),
        }))
        .digest("hex")
        .slice(0, 32);

    return {
        buildAgentActionIdempotencyKey,
        buildAgentActionPreview,
        buildAgentActionTypePolicies,
        sanitizeAgentActionInput,
    };
};

module.exports = {
    AGENT_ACTION_REGISTRY,
    createAgentActionHelpers,
};
