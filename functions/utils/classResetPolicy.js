"use strict";

// Explicit inventory: new collections must be classified before activity reset.
const PRESERVE = new Set([
    "config", "settings", "displaySettings", "bankConfig", "jobDefinitions",
    "policeRules", "policeSettings", "policeDangerLabels", "taxRules", "tierCriteria",
    "storeItems", "storeCategories", "storeSettings", "subscriptionProducts",
    "stockCategories", "stockDividendPolicies", "titles", "assemblySettings",
    "miniQuizQuestionSets", "jobSeekerCategories", "aiAgentRoutineSettings",
    "marketplace_settings", "missionCategories", "credentialCategories",
    "marketplace_categories", "newsCategories", "certificates", "stockInfo",
]);
const CLEAR = new Set([
    "subscriptions", "activity", "analytics", "analyticsDaily", "arcadePrivate",
    "assembly", "assemblyBills", "auction", "case", "caseLibraryPosts", "caseLibraryRequests",
    "classFundPayouts", "classFunds", "clientTelemetryDaily", "context", "credentials",
    "credentialSummary", "credit", "dashboard", "dashboardSummary", "donationAdjustments",
    "donations", "donationStats", "donationTransfers", "donationUsages", "finance",
    "fundApplications", "fundDailySettlements", "fundOrders", "fundPositions", "fundReports",
    "funds", "fundUsages", "job", "jobApplications", "jobBoardDashboardSummaries",
    "jobBoardProfiles", "jobBoardRatings", "jobPayments", "jobPosts", "jobRecruitmentRounds",
    "jobSeekerPayments", "jobSeekerServices", "loans", "lotteryRounds", "marketplace",
    "marketplace_transactions", "members", "missionAnalyticsDaily", "monetaryHistory",
    "monthEndSettlementDrafts", "news", "notifications", "notificationSummary",
    "pensionContributions", "police", "policeFineHistory", "policeReports", "real_estate_auctions",
    "realestate", "reflections", "savings", "stock", "store", "storeAnalyticsDaily",
    "storePriceSnapshots", "storeRedemptions", "studentJobAssignments", "surveys",
    "systemSummary", "tax", "taxDaily", "taxExpenses", "taxIncomes", "taxPeriodSettlements",
    "titleRequests", "aiAgentActionDrafts", "aiAgentAnalysisCache", "aiAgentExecutionLogs",
    "auction_bids", "caseLibraryDrafts", "caseLibraryReadStates", "caseLibraryRecommendedPosts",
    "caseLibraryRequestInterests", "caseLibrarySavedPosts", "creditAnalyticsDaily", "policeAnalyticsDaily",
    "realEstateAnalyticsDaily", "storeLimitSummaries", "subscriptionResults", "taxAnalyticsDaily",
    "taxSettlementDaily", "stockJobIndexStudents", "stockJobIndexSymbols", "system_meta",
]);
const MIXED = new Set(["bank", "arcade", "arcade_metadata", "real_estate", "missions"]);
const IDENTITY_FIELDS = [
    "uid", "name", "email", "role", "studentNumber", "classId", "gender",
    "privacyAgreed", "agreedAt", "createdAt", "mustChangePassword", "passwordChangedAt",
    "status", "isApproved", "manualPermissions", "photoURL",
    "forcePasswordChange", "passwordLastResetBy", "passwordLastResetAt",
];

const resetStudentData = (data, initialCapital, timestamp) => {
    const identity = Object.fromEntries(IDENTITY_FIELDS.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
    const teacher = data.role === "teacher" || data.role === "admin";
    const manualPermissions = teacher ? (data.permissions || {}) : (data.manualPermissions || {});
    return {
        ...identity,
        job: teacher ? "교사" : "없음",
        jobs: teacher ? ["교사"] : [],
        permissions: manualPermissions,
        manualPermissions,
        jobPermissions: {},
        creditScore: 700,
        assets: { cash: teacher ? 10000 : initialCapital, deposit: 0, loan: 0, missionToken: 0, stockValue: { value: 0 } },
        lastUpdated: timestamp,
    };
};

const clearLayoutParticipants = (data) => ({
    ...data,
    groups: (data.groups || []).map((group) => ({ ...group, desks: (group.desks || []).map((desk) => ({
        ...desk, studentId: null, studentName: null, ownerId: null, ownerName: null,
        ownerSinceAt: null, ownerSource: null, ownerUpdatedAt: null,
        rentTenantId: null, rentTenantName: null, rentContractId: null,
        rentStartAt: null, rentLastDateAt: null, rentPaidUntil: null,
        rentPaidDays: 0, rentPaidAmount: 0, isForSale: false, askingPrice: 0,
        buyerId: null, contractState: null, tradeStatus: "idle",
    })) })),
});

module.exports = { PRESERVE, CLEAR, MIXED, resetStudentData, clearLayoutParticipants };
