//functions/index.js

"use strict";
const admin = require("./firebaseAdminCompat");
const glob = require("glob");

// Firebase 앱 초기화
admin.initializeApp();

// 모든 함수에 적용될 글로벌 옵션 설정 (V2 함수용)
const { setGlobalOptions } = require("firebase-functions/v2");
setGlobalOptions({ region: "asia-northeast3" }); // 사용할 리전으로 설정

// 'src' 폴더 및 하위 폴더의 모든 .js 파일을 자동으로 찾아 로드합니다.
const sourceFilters = new Set(
    String(process.env.FUNCTION_SOURCE_FILTER || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
);

const matchesSourceFilter = (file) => {
    if (!sourceFilters.size) {
        return true;
    }

    const normalized = file.replace(/\\/g, "/");
    const basename = normalized.split("/").pop().replace(/\.js$/, "");
    const srcPath = normalized.replace(/^\.\//, "").replace(/^src\//, "");
    return sourceFilters.has(normalized) || sourceFilters.has(srcPath) || sourceFilters.has(basename);
};

const files = glob
    .sync('./src/**/*.js', { cwd: __dirname, ignore: './node_modules/**' })
    .filter(matchesSourceFilter);
const blockedExports = new Set([
    "addAdminRole",
    "addAdminRoleLegacy",
    "applyMultipleFinesLegacy",
    "refundRewardAmountLegacy",
    "syncMissionNotificationSummaryLegacy",
    "__private",
    "__recomputeMissionNotificationSummary",
    "__handleStudentMetricsWrite",
    "__handleMissionSummaryOnStudentWrite",
    "__handleRelativeEconomyDirtyFromStudent",
    "__handleStudentJobAssignmentMirror",
    "__handleStudentPayrollCacheFromStudentWrite",
    "__cancelClassFundPosUsage",
    "__cancelClassFundRealEstateUsage",
    "__cancelClassFundStockUsage",
]);

for (const file of files) {
    // 각 파일을 require로 불러옵니다.
    const functionModule = require(`./${file}`); // ✅ 상대 경로로 수정된 부분

    // 파일에서 export된 모든 함수들을 찾아 배포를 위해 다시 export합니다.
    for (const functionName in functionModule) {
        if (Object.prototype.hasOwnProperty.call(functionModule, functionName)) {
            if (blockedExports.has(functionName)) {
                continue;
            }
            exports[functionName] = functionModule[functionName];
        }
    }
}
