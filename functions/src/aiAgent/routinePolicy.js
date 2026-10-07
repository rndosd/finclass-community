"use strict";

const AGENT_ROUTINE_TEMPLATES = [
    {
        id: "daily-opening-brief",
        title: "매일 아침 운영 브리핑 준비",
        description: "오늘 먼저 볼 일, 주의 학생, 준비할 업무를 아침 브리핑으로 정리합니다.",
        domain: "dashboard",
        defaultEnabled: false,
        schedule: { type: "daily", time: "08:30" },
        mode: "auto_prepare",
        actionType: "prepare_daily_brief",
    },
    {
        id: "weekly-payroll-prepare",
        title: "금요일 급여 지급안 준비",
        description: "급여 지급 전 직업 배정, 지급 대상, 예외 학생을 점검할 목록을 준비합니다.",
        domain: "payroll",
        defaultEnabled: false,
        schedule: { type: "weekly", dayOfWeek: "friday", time: "14:30" },
        mode: "auto_prepare",
        actionType: "prepare_payroll",
    },
    {
        id: "month-end-tax-reminder",
        title: "월말 세금/자리세 연체 안내 준비",
        description: "월말에 세금과 자리세 연체 학생을 나누고 안내문 초안을 준비합니다.",
        domain: "tax",
        defaultEnabled: false,
        schedule: { type: "monthly", day: "monthEnd", time: "09:00" },
        mode: "auto_prepare",
        actionType: "prepare_tax_reminder",
    },
    {
        id: "weekly-store-review",
        title: "스토어 미처리 점검 준비",
        description: "오래 대기 중인 스토어 구매/사용 건을 정리해 검토 목록을 준비합니다.",
        domain: "store",
        defaultEnabled: false,
        schedule: { type: "weekly", dayOfWeek: "monday", time: "09:00" },
        mode: "auto_prepare",
        actionType: "prepare_store_review",
    },
    {
        id: "weekly-police-review",
        title: "신고/반성문 미처리 점검 준비",
        description: "생활 규칙 관련 미처리 건과 반복 학생을 정리해 점검표를 준비합니다.",
        domain: "police",
        defaultEnabled: false,
        schedule: { type: "weekly", dayOfWeek: "friday", time: "13:00" },
        mode: "auto_prepare",
        actionType: "prepare_police_review",
    },
];

const ROUTINE_DOMAIN_DEEP_LINKS = {
    store: "/store",
    police: "/police",
    tax: "/tax",
    payroll: "/tax",
};

const ROUTINE_WEEKDAY_INDEX = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};

const routineSettingsPath = (classId) =>
    `classes/${classId}/aiAgentRoutineSettings/default`;

const isValidRoutineTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));

const getKstPartsForRoutine = (date) => {
    const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    return {
        year: kstDate.getUTCFullYear(),
        month: kstDate.getUTCMonth() + 1,
        day: kstDate.getUTCDate(),
        weekday: kstDate.getUTCDay(),
    };
};

const parseRoutineTime = (time) => {
    const [hour, minute] = String(time || "09:00").split(":").map((value) => Number(value));
    return {
        hour: Number.isFinite(hour) ? hour : 9,
        minute: Number.isFinite(minute) ? minute : 0,
    };
};

const makeDateFromKstParts = ({ year, month, day, hour, minute }) =>
    new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0));

const getMonthEndDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const createAgentRoutineHelpers = ({
    admin,
    db,
    HttpsError,
    timestampToDate,
}) => {
    const normalizeRoutineRules = (rules = {}) => {
        const input = rules && typeof rules === "object" ? rules : {};
        return AGENT_ROUTINE_TEMPLATES.reduce((acc, template) => {
            const current = input[template.id] && typeof input[template.id] === "object" ? input[template.id] : {};
            const time = isValidRoutineTime(current.time) ? current.time : template.schedule.time;
            acc[template.id] = {
                templateId: template.id,
                enabled: typeof current.enabled === "boolean" ? current.enabled : template.defaultEnabled,
                time,
                mode: current.mode === "confirm_execute" ? "confirm_execute" : template.mode,
                requiresConfirmation: true,
                nextRunAt: current.nextRunAt || null,
                lastPreparedAt: current.lastPreparedAt || null,
                lastPreparedForDate: current.lastPreparedForDate || null,
                updatedAt: current.updatedAt || null,
            };
            return acc;
        }, {});
    };

    const buildRoutineSettingsPayload = (rules = {}, metadata = {}) => {
        const normalizedRules = normalizeRoutineRules(rules);
        const templates = AGENT_ROUTINE_TEMPLATES.map((template) => ({
            ...template,
            rule: normalizedRules[template.id],
            enabled: normalizedRules[template.id]?.enabled === true,
            time: normalizedRules[template.id]?.time || template.schedule.time,
        }));
        const enabledCount = templates.filter((template) => template.enabled).length;

        return {
            schemaVersion: 1,
            mode: "auto_prepare_only",
            description: "반복 업무는 자동 실행이 아니라 준비함 생성부터 시작합니다.",
            templates,
            rules: normalizedRules,
            enabledCount,
            updatedAt: metadata.updatedAt || null,
            updatedByUid: metadata.updatedByUid || null,
            updatedByName: metadata.updatedByName || null,
        };
    };

    const readAgentRoutineSettings = async (classId) => {
        const snap = await db.doc(routineSettingsPath(classId)).get().catch((error) => {
            console.warn("[aiAgentSummary] routine settings read failed:", error?.message || error);
            return null;
        });
        const data = snap?.exists ? snap.data() || {} : {};
        return buildRoutineSettingsPayload(data.rules || {}, {
            updatedAt: data.updatedAt || null,
            updatedByUid: data.updatedByUid || null,
            updatedByName: data.updatedByName || null,
        });
    };

    const sanitizeRoutineSettingsUpdate = (rules = {}) => {
        if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
            throw new HttpsError("invalid-argument", "rules must be an object.");
        }
        const allowedIds = new Set(AGENT_ROUTINE_TEMPLATES.map((template) => template.id));
        const current = {};
        Object.entries(rules).forEach(([id, value]) => {
            if (!allowedIds.has(id)) return;
            const item = value && typeof value === "object" ? value : {};
            if (typeof item.enabled !== "boolean" && typeof item.time !== "string" && typeof item.mode !== "string") return;
            current[id] = {
                ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
                ...(isValidRoutineTime(item.time) ? { time: item.time } : {}),
                ...(item.mode === "confirm_execute" ? { mode: "confirm_execute" } : {}),
            };
        });
        return normalizeRoutineRules(current);
    };

    const resolveNextRoutineRunAt = (template, rule = {}, fromDate = new Date()) => {
        const schedule = template.schedule || {};
        const time = isValidRoutineTime(rule.time) ? rule.time : schedule.time || "09:00";
        const { hour, minute } = parseRoutineTime(time);
        const parts = getKstPartsForRoutine(fromDate);

        if (schedule.type === "weekly") {
            const targetWeekday = ROUTINE_WEEKDAY_INDEX[schedule.dayOfWeek] ?? parts.weekday;
            let dayOffset = (targetWeekday - parts.weekday + 7) % 7;
            let candidate = makeDateFromKstParts({ ...parts, day: parts.day + dayOffset, hour, minute });
            if (candidate <= fromDate) {
                dayOffset += 7;
                candidate = makeDateFromKstParts({ ...parts, day: parts.day + dayOffset, hour, minute });
            }
            return candidate;
        }

        if (schedule.type === "monthly") {
            const currentDay = schedule.day === "monthEnd" ? getMonthEndDay(parts.year, parts.month) : Number(schedule.day || 1);
            let candidate = makeDateFromKstParts({ ...parts, day: currentDay, hour, minute });
            if (candidate <= fromDate) {
                const nextMonthDate = new Date(Date.UTC(parts.year, parts.month, 1));
                const nextYear = nextMonthDate.getUTCFullYear();
                const nextMonth = nextMonthDate.getUTCMonth() + 1;
                const nextDay = schedule.day === "monthEnd" ? getMonthEndDay(nextYear, nextMonth) : Number(schedule.day || 1);
                candidate = makeDateFromKstParts({ year: nextYear, month: nextMonth, day: nextDay, hour, minute });
            }
            return candidate;
        }

        let candidate = makeDateFromKstParts({ ...parts, hour, minute });
        if (candidate <= fromDate) {
            candidate = makeDateFromKstParts({ ...parts, day: parts.day + 1, hour, minute });
        }
        return candidate;
    };

    const applyRoutineScheduleMetadata = (rules = {}, { now = new Date(), preserveExisting = true } = {}) => {
        const normalizedRules = normalizeRoutineRules(rules);
        return AGENT_ROUTINE_TEMPLATES.reduce((acc, template) => {
            const rule = normalizedRules[template.id];
            const existingNextRunAt = preserveExisting ? timestampToDate(rule.nextRunAt) : null;
            const nextRunAt = existingNextRunAt && existingNextRunAt > now ?
                rule.nextRunAt :
                admin.firestore.Timestamp.fromDate(
                    resolveNextRoutineRunAt(template, rule, now),
                );
            acc[template.id] = {
                ...rule,
                lastPreparedAt: rule.lastPreparedAt || null,
                lastPreparedForDate: rule.lastPreparedForDate || null,
                nextRunAt: rule.enabled ? nextRunAt : null,
            };
            return acc;
        }, {});
    };

    const getDueRoutineTemplates = (rules = {}, now = new Date()) => {
        const normalizedRules = normalizeRoutineRules(rules);
        return AGENT_ROUTINE_TEMPLATES
            .map((template) => ({ template, rule: normalizedRules[template.id] }))
            .filter(({ rule }) => {
                if (!rule?.enabled) return false;
                const nextRunAt = timestampToDate(rule.nextRunAt);
                return !nextRunAt || nextRunAt <= now;
            });
    };

    return {
        AGENT_ROUTINE_TEMPLATES,
        ROUTINE_DOMAIN_DEEP_LINKS,
        applyRoutineScheduleMetadata,
        buildRoutineSettingsPayload,
        getDueRoutineTemplates,
        normalizeRoutineRules,
        readAgentRoutineSettings,
        resolveNextRoutineRunAt,
        routineSettingsPath,
        sanitizeRoutineSettingsUpdate,
    };
};

module.exports = {
    createAgentRoutineHelpers,
};
