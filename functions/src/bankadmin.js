"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("../firebaseAdminCompat");

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const {
  stageNotification,
  scheduleReminder,
} = require("../utils/notificationUtils");
const { addCalendarDaysInKST } = require("../utils/dateUtils");
const { stageActivityLog } = require("../utils/logUtils");
const { getGlobalConfig, canUseFeature } = require("../utils/planManager");
const { getUserData } = require("../utils/permissions");
const { getDepositInterestWithholdingPolicy } = require("../utils/taxPolicy");
const {
  buildSavingInterestTaxPolicySnapshot,
} = require("../utils/depositInterestTax");

const ACTIVE_SAVING_STATUSES = new Set(["active"]);
const APPROVED_LOAN_STATUSES = new Set(["ongoing", "active"]);

function toWholeNumber(value) {
  const numericValue = Math.floor(Number(value));
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getLoanOutstandingAmount(loanData = {}) {
  return toWholeNumber(
    loanData.amountLeft ?? loanData.principal ?? loanData.amount,
  );
}

function buildProductAmountMap(snapshot, allowedStatuses, amountResolver) {
  const amountMap = new Map();

  for (const doc of snapshot?.docs || []) {
    const data = doc.data() || {};
    const status = String(data.status || "");
    const productId = String(data.productId || "");

    if (!productId || !allowedStatuses.has(status)) continue;

    amountMap.set(
      productId,
      (amountMap.get(productId) || 0) + amountResolver(data),
    );
  }

  return amountMap;
}

exports.approveBankApplications = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

    const { classId, applications, approve } = data || {};

    // 1. 유효성 검사
    if (
      !classId ||
      !Array.isArray(applications) ||
      typeof approve !== "boolean"
    ) {
      throw new HttpsError(
        "invalid-argument",
        "필수 매개변수가 누락되었습니다.",
      );
    }

    if (applications.length > 100) {
      throw new HttpsError(
        "invalid-argument",
        "한 번에 최대 100건까지만 처리 가능합니다.",
      );
    }

    // =========================================================
    // 🛡️ [보안 강화] 권한 체크 로직
    // - 토큰이 갱신되기 전이라도 Firestore 권한으로 한 번 더 확인합니다.
    // =========================================================
    const token = auth.token || {};
    const isTeacher = token.role === "teacher" || token.role === "admin";
    let callerStudentData = null;

    if (!isTeacher) {
      callerStudentData = await getUserData(classId, auth.uid);
    }

    const isBankAdmin = callerStudentData?.permissions?.bank_admin === true;

    if (!isTeacher && !isBankAdmin) {
      throw new HttpsError("permission-denied", "승인/반려 권한이 없습니다.");
    }

    if (!isTeacher) {
      if (!callerStudentData || callerStudentData.role !== "student") {
        throw new HttpsError(
          "permission-denied",
          "학생 관리자 계정 정보를 확인할 수 없습니다.",
        );
      }

      const callerClassId = token.classId || callerStudentData.classId || null;
      if (callerClassId && callerClassId !== classId) {
        throw new HttpsError(
          "permission-denied",
          "본인의 학급 데이터만 관리할 수 있습니다.",
        );
      }
    }
    // =========================================================

    const globalConfig = await getGlobalConfig();

    try {
      const results = await db.runTransaction(async (tx) => {
        const classRef = db.collection("classes").doc(classId);
        const bankSettingsRef = classRef.collection("bank").doc("settings");

        // 2. 데이터 읽기 준비 (Batch Read)
        const appRefs = applications.map((item) => {
          const coll = item.kind === "saving" ? "savings" : "loans";
          return classRef
            .collection("students")
            .doc(item.studentUid)
            .collection(coll)
            .doc(item.applicationId);
        });

        const studentUids = [...new Set(applications.map((a) => a.studentUid))];
        const studentRefs = studentUids.map((uid) =>
          classRef.collection("students").doc(uid),
        );
        const savingsQueries = studentRefs.map((ref) => ref.collection("savings"));
        const loansQueries = studentRefs.map((ref) => ref.collection("loans"));

        const readResults = await Promise.all([
          tx.get(classRef),
          tx.get(bankSettingsRef),
          ...studentRefs.map((ref) => tx.get(ref)),
          ...appRefs.map((ref) => tx.get(ref)),
          ...savingsQueries.map((query) => tx.get(query)),
          ...loansQueries.map((query) => tx.get(query)),
        ]);
        const classSnap = readResults[0];
        const bankSettingsSnap = readResults[1];
        const studentSnaps = readResults.slice(2, 2 + studentRefs.length);
        const appSnaps = readResults.slice(
          2 + studentRefs.length,
          2 + studentRefs.length + appRefs.length,
        );
        const savingsSnaps = readResults.slice(
          2 + studentRefs.length + appRefs.length,
          2 + studentRefs.length + appRefs.length + studentRefs.length,
        );
        const loanSnaps = readResults.slice(
          2 + studentRefs.length + appRefs.length + studentRefs.length,
        );

        if (!classSnap.exists) {
          throw new HttpsError("not-found", "학급 정보를 찾을 수 없습니다.");
        }

        const classData = classSnap.data() || {};
        const bankSettingsData = bankSettingsSnap.data() || {};
        const planType = classData.planType || "FREE";
        const currencyField = classData.currencySettings?.field || "cash";
        const currencyUnit = classData.currencyUnit || "단위";
        const displayCurrencyUnit =
          classData.currencyUnit || classData.currencySettings?.name || "원";
        const logCtx = { config: globalConfig, planType, serviceName: "bank" };
        const isLogEnabled = canUseFeature(
          globalConfig,
          planType,
          "bank",
          "enableLog",
        );

        // 스냅샷 매핑
        const studentSnapsMap = Object.fromEntries(
          studentRefs.map((ref, i) => [ref.id, studentSnaps[i]]),
        );
        const appSnapsMap = Object.fromEntries(
          appRefs.map((ref, i) => [ref.id, appSnaps[i]]),
        );

        const activeSavingAmountsByStudent = new Map();
        const approvedLoanAmountsByStudent = new Map();
        const approvedLoanTotalsByStudent = new Map();
        const pendingSavingApprovalsByStudent = new Map();
        const pendingLoanApprovalsByStudent = new Map();
        const pendingLoanTotalsByStudent = new Map();

        studentUids.forEach((studentUid, index) => {
          activeSavingAmountsByStudent.set(
            studentUid,
            buildProductAmountMap(
              savingsSnaps[index],
              ACTIVE_SAVING_STATUSES,
              (savingData) => toWholeNumber(savingData.amount),
            ),
          );
          approvedLoanAmountsByStudent.set(
            studentUid,
            buildProductAmountMap(
              loanSnaps[index],
              APPROVED_LOAN_STATUSES,
              (loanData) => getLoanOutstandingAmount(loanData),
            ),
          );

          const studentData = studentSnaps[index]?.data() || {};
          approvedLoanTotalsByStudent.set(
            studentUid,
            toWholeNumber(studentData.assets?.loan || 0),
          );
        });

        const processedResults = [];

        // 3. 승인/반려 처리 루프
        for (const item of applications) {
          const { applicationId, studentUid, kind } = item;
          const studentSnap = studentSnapsMap[studentUid];
          const appSnap = appSnapsMap[applicationId];

          if (!studentSnap?.exists || !appSnap?.exists) continue;

          const app = appSnap.data() || {};
          if (app.status !== "pending") continue;

          const studentData = studentSnap.data() || {};
          const studentRef = studentSnap.ref;
          const appRef = appSnap.ref;
          const amount = toWholeNumber(app.principal || app.amount || 0);
          const label = app.productLabel || (kind === "loan" ? "대출" : "예금");
          const days = Number(app.days || 0);
          const productId = String(app.productId || "");

          const startTs = admin.firestore.Timestamp.now();
          const startDate = startTs.toDate();

          let expectedDate = null;

          if (approve) {
            // ✅ 승인 로직
            expectedDate = addCalendarDaysInKST(startDate, days);
            const confirmedRate = Number(
              app.finalRateApplied || app.finalRate || app.baseRate || 0,
            );
            const interestTaxPolicySnapshot =
              buildSavingInterestTaxPolicySnapshot(
                getDepositInterestWithholdingPolicy(classData),
              );
            const studentName =
              studentData.name || app.studentName || studentUid;
            const savingProductConfig =
              kind === "saving"
                ? (bankSettingsData.depositProducts || []).find(
                    (product) => String(product.id) === productId,
                  )
                : null;

            if (kind === "saving") {
              const maxProductLimit = toWholeNumber(
                savingProductConfig?.maxDepositProductLimit,
              );
              const activeByProduct =
                activeSavingAmountsByStudent.get(studentUid) || new Map();
              const pendingByProduct =
                pendingSavingApprovalsByStudent.get(studentUid) || new Map();
              const nextApprovedAmount =
                (activeByProduct.get(productId) || 0) +
                (pendingByProduct.get(productId) || 0) +
                amount;

              if (maxProductLimit > 0 && nextApprovedAmount > maxProductLimit) {
                throw new HttpsError(
                  "failed-precondition",
                  `${studentName}의 '${label}' 예금은 상품 한도 ${maxProductLimit.toLocaleString()}${displayCurrencyUnit}를 초과해 승인할 수 없습니다.`,
                );
              }

              pendingByProduct.set(
                productId,
                (pendingByProduct.get(productId) || 0) + amount,
              );
              pendingSavingApprovalsByStudent.set(studentUid, pendingByProduct);
            } else {
              const productConfig = (bankSettingsData.loanProducts || []).find(
                (product) => String(product.id) === productId,
              );
              const maxProductLimit = toWholeNumber(
                productConfig?.maxLoanProductLimit,
              );
              const approvedByProduct =
                approvedLoanAmountsByStudent.get(studentUid) || new Map();
              const pendingByProduct =
                pendingLoanApprovalsByStudent.get(studentUid) || new Map();
              const nextApprovedProductAmount =
                (approvedByProduct.get(productId) || 0) +
                (pendingByProduct.get(productId) || 0) +
                amount;

              if (maxProductLimit > 0 && nextApprovedProductAmount > maxProductLimit) {
                throw new HttpsError(
                  "failed-precondition",
                  `${studentName}의 '${label}' 대출은 상품 한도 ${maxProductLimit.toLocaleString()}${displayCurrencyUnit}를 초과해 승인할 수 없습니다.`,
                );
              }

              pendingByProduct.set(
                productId,
                (pendingByProduct.get(productId) || 0) + amount,
              );
              pendingLoanApprovalsByStudent.set(studentUid, pendingByProduct);

              if (bankSettingsData.isLoanLimitRatioEnabled) {
                const ratio =
                  studentData.loanLimitRatio ??
                  bankSettingsData.defaultLoanLimitRatio ??
                  0.5;
                const assets = studentData.assets || {};
                const netAssets = Number(assets.totalNetWorth || 0);
                const loanRatioLimit = netAssets * ratio;
                const approvedLoanTotal =
                  approvedLoanTotalsByStudent.get(studentUid) || 0;
                const pendingLoanTotal =
                  pendingLoanTotalsByStudent.get(studentUid) || 0;
                const nextApprovedLoanTotal =
                  approvedLoanTotal + pendingLoanTotal + amount;

                if (nextApprovedLoanTotal > loanRatioLimit) {
                  throw new HttpsError(
                    "failed-precondition",
                    `${studentName}의 대출은 현재 자산 기준 한도 ${Math.floor(loanRatioLimit).toLocaleString()}${displayCurrencyUnit}를 초과해 승인할 수 없습니다.`,
                  );
                }

                pendingLoanTotalsByStudent.set(
                  studentUid,
                  pendingLoanTotal + amount,
                );
              }
            }

            if (kind === "saving") {
              /* --- [예금 승인] --- */
              tx.update(appRef, {
                status: "active",
                rate: confirmedRate,
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: auth.uid, // 👈 관리자 학생이 승인하면 학생 UID가 기록됩니다
                startedAt: startTs,
                expectedMaturityDate:
                  admin.firestore.Timestamp.fromDate(expectedDate),
                processedAt: FieldValue.serverTimestamp(),
                processedBy: auth.uid,
                earlyTerminationBlocked:
                  app.earlyTerminationBlocked === true ||
                  savingProductConfig?.earlyTerminationBlocked === true,
                interestTaxPolicySnapshot,
              });

              if (amount > 0) {
                tx.update(studentRef, {
                  "assets.deposit": FieldValue.increment(amount),
                });
              }

              if (isLogEnabled) {
                stageActivityLog(
                  tx,
                  classId,
                  {
                    studentUid,
                    type: "expense",
                    category: "deposit_started",
                    amount,
                    currency: currencyUnit,
                    description: `'${label}' 예금 시작 (금리: ${confirmedRate}%)`,
                    relatedDoc: { collection: "savings", id: applicationId },
                    status: "active",
                    approvedAt: FieldValue.serverTimestamp(),
                    startedAt: startTs,
                    expectedMaturityDate:
                      admin.firestore.Timestamp.fromDate(expectedDate),
                  },
                  logCtx,
                );
              }

              stageNotification(tx, classId, {
                uid: studentUid,
                title: "예금 승인 완료",
                message: `신청하신 '${label}' 상품이 활성화되었습니다.`,
                type: "deposit_approved",
                priority: "medium",
              });
            } else {
              /* --- [대출 승인] --- */
              tx.update(appRef, {
                status: "ongoing",
                amount,
                principal: amount,
                rate: confirmedRate,
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: auth.uid,
                startedAt: startTs,
                expectedRepaymentDate:
                  admin.firestore.Timestamp.fromDate(expectedDate),
                amountLeft: amount,
                interestLeft: Number(
                  app.normalInterestAmount ??
                    app.interestCalculatedOnRequest ??
                    0,
                ),
                ...(app.interestModel === "declining_balance" && {
                  interestModel: "declining_balance",
                  interestState: {
                    accruedAmount: 0,
                    paidAmount: 0,
                    waivedAmount: 0,
                    baseDate: startTs,
                  },
                }),
                interestPaid: 0,
                penaltyPaid: 0,
                processedAt: FieldValue.serverTimestamp(),
                processedBy: auth.uid,
              });

              if (amount > 0) {
                tx.update(studentRef, {
                  [`assets.${currencyField}`]: FieldValue.increment(amount),
                  "assets.loan": FieldValue.increment(amount),
                });
              }

              stageActivityLog(
                tx,
                classId,
                {
                  studentUid,
                  type: "income",
                  category: "loan_approve",
                  amount,
                  description: `'${label}' 대출 승인 및 지급`,
                  relatedDoc: { collection: "loans", id: applicationId },
                  currency: currencyUnit,
                },
                logCtx,
              );

              stageNotification(tx, classId, {
                uid: studentUid,
                title: "대출 승인 완료",
                message: `신청하신 '${label}' 대출이 승인되어 지급되었습니다.`,
                type: "loan_approved",
                priority: "medium",
              });
            }
          } else {
            // ❌ 반려 로직
            tx.update(appRef, {
              status: "rejected",
              processedAt: FieldValue.serverTimestamp(),
              processedBy: auth.uid,
            });

            if (kind === "saving" && amount > 0) {
              tx.update(studentRef, {
                [`assets.${currencyField}`]: FieldValue.increment(amount),
              });
            }

            stageNotification(tx, classId, {
              uid: studentUid,
              title: "신청 반려 안내",
              message: `신청하신 '${label}' 신청이 반려되었습니다.`,
              type: kind === "saving" ? "deposit_rejected" : "loan_rejected",
              priority: "medium",
            });
          }

          processedResults.push({
            studentUid,
            applicationId,
            kind,
            expectedDate,
            success: true,
          });
        }
        return processedResults;
      });

      // 4. 알림 스케줄링 (승인 시에만)
      if (approve) {
        for (const res of results) {
          if (!res.expectedDate) continue;

          // 알림 기준 시간 설정 (만기일 오전 7시)
          const baseAlertTime = new Date(res.expectedDate.getTime());
          baseAlertTime.setHours(baseAlertTime.getHours() + 7);
          const today = new Date();

          if (res.kind === "loan") {
            // 👈 대출만 처리
            // 대출 상환 3일 전 알림 예약 (딱 하나만)
            const scheduledAt = new Date(baseAlertTime.getTime());
            scheduledAt.setDate(scheduledAt.getDate() - 3); // 3일 전

            if (scheduledAt > today) {
              await scheduleReminder(
                classId,
                res.studentUid,
                res.applicationId,
                scheduledAt,
                "3_days_before", // 타입 고정
                "sendLoanRepaymentReminder",
              );
            }
          }
          // ❌ 예금(res.kind === "saving") 예약 로직은 삭제되었습니다.
        }
      }

      return { success: true, count: results.length };
    } catch (e) {
      if (e instanceof HttpsError) {
        throw e;
      }
      console.error("[approveBankApplications] error:", e);
      throw new HttpsError("internal", `처리에 실패했습니다: ${e.message}`);
    }
  },
);
