// src/pages/tax/utils/taxPathUtils.js

export const getPath = (type, classId, ids = {}) => {
    if (!classId) {
        console.error(`getPath Error: classId is required but was not provided for type "${type}".`);
        return null;
    }

    const { studentUid, docId } = ids;

    switch (type) {
        // --- Collection Paths ---
        case 'students':
            return `classes/${classId}/students`;
        case 'jobDefinitions':
            return `classes/${classId}/jobDefinitions`;
        case 'taxRules':
            return `classes/${classId}/taxRules`;

        // --- Document Paths ---
        case 'student':
            if (!studentUid) {
                console.error(`getPath Error: 'studentUid' is required for type "${type}".`);
                return null;
            }
            return `classes/${classId}/students/${studentUid}`;

        case 'jobDefinition':
            if (!docId) {
                console.error(`getPath Error: 'docId' is required for type "${type}".`);
                return null;
            }
            return `classes/${classId}/jobDefinitions/${docId}`;

        case 'taxRule':
            if (!docId) {
                console.error(`getPath Error: 'docId' is required for type "${type}".`);
                return null;
            }
            return `classes/${classId}/taxRules/${docId}`;

        // --- Subcollection Paths ---
        case 'payslipCollection':
            if (!studentUid) {
                console.error(`getPath Error: 'studentUid' is required for type "${type}".`);
                return null;
            }
            return `classes/${classId}/students/${studentUid}/paySlips`;

        // ⭐ 추가: paySlips 케이스 (급여명세서 서브컬렉션)
        case 'paySlips':
            if (!studentUid) {
                console.error(`getPath Error: 'studentUid' is required for type "${type}".`);
                return null;
            }
            return `classes/${classId}/students/${studentUid}/paySlips`;

        // ⭐ 추가: 특정 급여명세서 문서
        case 'paySlipDoc':
            if (!studentUid || !docId) {
                console.error(`getPath Error: 'studentUid' and 'docId' are required for type "${type}".`);
                return null;
            }
            return `classes/${classId}/students/${studentUid}/paySlips/${docId}`;

        case 'studentTaxBillCollection':  // ✅ 추가
            if (!studentUid) {
                console.error(`getPath Error: 'studentUid' is required for type "${type}".`);
                return null;
            }
            return `classes/${classId}/students/${studentUid}/taxBills`;

        case 'taxBills': // ⭐ 추가: 세금 고지서 서브컬렉션
            if (!studentUid) {
                console.error(`getPath Error: 'studentUid' is required for type "${type}".`);
                return null;
            }
            return `classes/${classId}/students/${studentUid}/taxBills`;

        case 'taxBillDoc': // ⭐ 추가: 특정 세금 고지서 문서
            if (!studentUid || !docId) {
                console.error(`getPath Error: 'studentUid' and 'docId' are required for type "${type}".`);
                return null;
            }
            return `classes/${classId}/students/${studentUid}/taxBills/${docId}`;

        default:
            console.error(`Unknown path type in getPath: ${type}`);
            return null;
    }
};