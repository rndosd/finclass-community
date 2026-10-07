export const getPolicePath = (type, classId, docId = null) => {
    if (!classId) return null;

    switch (type) {
        case 'students':
            return `classes/${classId}/students`;
        case 'policeRules':
        case 'policeRulesCollection': // ✅ 'policeRulesCollection'도 동일하게 처리
            return `classes/${classId}/policeRules`;
        case 'policeRuleDocument':
            return `classes/${classId}/policeRules/${docId}`;
        case 'policeReports':
            return `classes/${classId}/policeReports`;
        case 'policeFineHistory':
            return `classes/${classId}/policeFineHistory`;
        case 'reflections': // ✅ 'reflections' 경로 추가
            return `classes/${classId}/reflections`;
        default:
            console.error(`[getPolicePath] Unknown path type: ${type}`);
            return null;
    }
};
