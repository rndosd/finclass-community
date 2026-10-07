// functions/src/notification.js

const admin = require("../firebaseAdminCompat");
const db = admin.firestore();
const { onTaskDispatched } = require("firebase-functions/v2/tasks");
const { createNotification } = require("../utils/notificationUtils");

// 대출 상환 리마인더 실행 (3일 전 전용)
exports.sendLoanRepaymentReminder = onTaskDispatched(async (request) => {
  const { classId, studentUid, loanId, type } = request.data;
  try {
    const loanRef = db.doc(
      `classes/${classId}/students/${studentUid}/loans/${loanId}`,
    );
    const loanSnap = await loanRef.get();

    // 갚았거나 문서가 없으면 종료
    if (!loanSnap.exists || loanSnap.data().status === "repaid") return;

    const loanData = loanSnap.data();

    // 오직 3일 전 알림만 생성
    if (type === "3_days_before") {
      await createNotification(classId, {
        uid: studentUid,
        title: "대출 상환 3일 전 안내",
        message: `'${loanData.productLabel}' 상환일이 3일 남았습니다. 잊지 말고 상환 금액을 준비해 주세요.`,
        type: "loan_repayment_3days",
      });
    }
  } catch (error) {
    console.error("대출 알림 전송 실패:", error);
  }
});
