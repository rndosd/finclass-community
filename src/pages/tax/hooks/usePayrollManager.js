import { appConfirm } from "../../../utils/appDialogs";
import { useState, useEffect, useCallback, useMemo } from "react";
import dayjs from "dayjs";

import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import * as payrollService from "../services/payrollService";
import { assignStudentJobs } from "../services/jobPermissionSyncService";

const normalizePayslipType = (value) =>
  String(value || "salary").trim().toLowerCase() === "bonus" ? "bonus" : "salary";

export const usePayrollManager = (
  classId,
  students = [],
  _jobDefinitions = [],
  _taxRules = [],
  payslips = [],
) => {
  const { hasPermission, isTeacher } = useUser();
  const { showFeedback } = useFeedback();

  const hasPayrollPermission = hasPermission("labor_admin");

  const [editedStudentJobs, setEditedStudentJobs] = useState({});
  const [paymentStartDate, setPaymentStartDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [numberOfWeeksToPay, setNumberOfWeeksToPay] = useState(1);
  const [calculatedEndDate, setCalculatedEndDate] = useState("");
  const [selectedStudentsForPayroll, setSelectedStudentsForPayroll] = useState(new Set());
  const [processingPayroll, setProcessingPayroll] = useState(false);
  const [isSavingJobs, setIsSavingJobs] = useState(false);
  const [isResettingJobs, setIsResettingJobs] = useState(false);

  const allPayslipsCache = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(payslips)) return map;

    payslips.forEach((payslip) => {
      if (!payslip?.studentUid) return;
      const studentPayslips = map.get(payslip.studentUid) || [];
      studentPayslips.push(payslip);
      map.set(payslip.studentUid, studentPayslips);
    });

    return map;
  }, [payslips]);

  const studentNameMap = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(students)) return map;

    students.forEach((student) => {
      if (!student?.uid) return;
      map.set(student.uid, student.name || "해당 학생");
    });

    return map;
  }, [students]);

  const checkPermission = useCallback(() => {
    if (!hasPayrollPermission) {
      showFeedback("급여 지급 권한이 없습니다.", "error");
      return false;
    }
    return true;
  }, [hasPayrollPermission, showFeedback]);

  const getStudentDisplayName = useCallback(
    (uid) => {
      if (!uid) return "해당 학생";
      return studentNameMap.get(uid) || "해당 학생";
    },
    [studentNameMap],
  );

  const sanitizeFeedbackMessage = useCallback(
    (rawMessage, options = {}) => {
      const { studentUid = null, fallbackMessage = "처리 중 오류가 발생했습니다." } = options;

      let safeMessage =
        typeof rawMessage === "string" && rawMessage.trim()
          ? rawMessage.trim()
          : fallbackMessage;

      if (studentUid && safeMessage.includes(studentUid)) {
        safeMessage = safeMessage.split(studentUid).join(getStudentDisplayName(studentUid));
      }

      studentNameMap.forEach((name, uid) => {
        if (!uid || !safeMessage.includes(uid)) return;
        safeMessage = safeMessage.split(uid).join(name || "해당 학생");
      });

      safeMessage = safeMessage.replace(/\b[A-Za-z0-9_-]{20,}\b/g, "해당 학생");
      safeMessage = safeMessage.replace(/해당 학생:\s*/g, "해당 학생 ");

      return safeMessage;
    },
    [studentNameMap, getStudentDisplayName],
  );

  const checkIfPaid = useCallback(
    (studentUid, startDate, numWeeks) => {
      if (!startDate || !numWeeks || numWeeks < 1) return false;

      const studentPayslips = allPayslipsCache.get(studentUid) || [];
      const targetId = `${studentUid}_${dayjs(startDate).format("YYYY-MM-DD")}_${numWeeks}`;
      const targetStart = dayjs(startDate).startOf("day");
      const targetEnd = targetStart.add(numWeeks * 7 - 1, "day");

      const toJsDate = (value) => {
        if (!value) return null;
        if (typeof value.toDate === "function") return value.toDate();
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      };

      return studentPayslips.some((payslip) => {
        if (normalizePayslipType(payslip?.slipType) !== "salary") return false;
        if (payslip?.id === targetId) return true;

        const payStartDate = toJsDate(payslip?.paymentStartDate);
        if (!payStartDate) return false;

        let payEndDate = toJsDate(payslip?.paymentEndDate);
        if (!payEndDate && Number(payslip?.numberOfWeeksPaid) > 0) {
          payEndDate = dayjs(payStartDate)
            .add(Number(payslip.numberOfWeeksPaid) * 7 - 1, "day")
            .toDate();
        }
        if (!payEndDate) return false;

        const payStart = dayjs(payStartDate).startOf("day");
        const payEnd = dayjs(payEndDate).startOf("day");
        return !payEnd.isBefore(targetStart, "day") && !payStart.isAfter(targetEnd, "day");
      });
    },
    [allPayslipsCache],
  );

  const handlePaySelectedStudents = useCallback(async () => {
    if (!checkPermission()) return false;

    const studentUids = Array.from(selectedStudentsForPayroll);
    if (studentUids.length === 0) {
      showFeedback("지급할 학생을 선택해 주세요.", "info");
      return false;
    }

    const overlappingStudentUids = studentUids.filter((uid) =>
      checkIfPaid(uid, paymentStartDate, numberOfWeeksToPay),
    );
    const shouldAllowOverlapOverride =
      isTeacher && overlappingStudentUids.length > 0;

    if (shouldAllowOverlapOverride) {
      const previewNames = overlappingStudentUids
        .slice(0, 3)
        .map((uid) => getStudentDisplayName(uid))
        .join(", ");
      const remainingCount = Math.max(0, overlappingStudentUids.length - 3);
      const confirmMessage = [
        `이미 지급된 기간과 겹치는 학생 ${overlappingStudentUids.length}명이 포함되어 있습니다.`,
        "이대로 지급하면 해당 학생들은 같은 기간 급여가 한 번 더 지급됩니다.",
        `대상: ${previewNames}${remainingCount > 0 ? ` 외 ${remainingCount}명` : ""}`,
        "",
        "선생님 권한으로 계속 지급할까요?",
      ].join("\n");
      const confirmed =
        typeof window === "undefined" || typeof window.confirm !== "function"
          ? true
          : (await appConfirm(confirmMessage));

      if (!confirmed) {
        showFeedback("중복 가능 급여 지급을 취소했습니다.", "info");
        return false;
      }

      showFeedback(
        "이미 지급된 기간이 포함되어 선생님 권한으로 재지급을 진행합니다.",
        "warning",
      );
    }

    setProcessingPayroll(true);
    try {
      const result = await payrollService.paySelectedStudents(
        classId,
        studentUids,
        paymentStartDate,
        numberOfWeeksToPay,
        { allowOverlapOverride: shouldAllowOverlapOverride },
      );

      if (!result.success) return false;

      const results = result.results || [];
      const successList = results.filter((entry) => entry.success);
      const failList = results.filter((entry) => !entry.success);
      const successCount = successList.length;

      if (failList.length > 0) {
        const failDetails = failList.map((entry) => {
          const name =
            students.find((student) => student.uid === entry.studentUid)?.name ||
            getStudentDisplayName(entry.studentUid);
          const reason = sanitizeFeedbackMessage(entry?.error, {
            studentUid: entry.studentUid,
            fallbackMessage: "실패 사유를 확인할 수 없습니다.",
          });
          return `${name}: ${reason}`;
        });
        const preview = failDetails.slice(0, 3).join(" / ");
        const remainCount = Math.max(0, failDetails.length - 3);

        showFeedback(
          `${successCount}명 성공, ${failList.length}명 실패 (${preview}${
            remainCount > 0 ? ` 외 ${remainCount}건` : ""
          })`,
          "warning",
        );
      } else {
        showFeedback(`${successCount}명 급여 지급 완료!`, "success");
      }

      if (successCount > 0) {
        setSelectedStudentsForPayroll(new Set());
      }
      return true;
    } catch (error) {
      showFeedback(
        sanitizeFeedbackMessage(error?.message, {
          fallbackMessage: "선택 급여 지급 중 오류가 발생했습니다.",
        }),
        "error",
      );
      return false;
    } finally {
      setProcessingPayroll(false);
    }
  }, [
    checkPermission,
    selectedStudentsForPayroll,
    classId,
    paymentStartDate,
    numberOfWeeksToPay,
    checkIfPaid,
    isTeacher,
    showFeedback,
    students,
    getStudentDisplayName,
    sanitizeFeedbackMessage,
  ]);

  const handleStudentJobChange = useCallback((uid, newJobs) => {
    setEditedStudentJobs((prev) => {
      const next = { ...prev };
      if (!newJobs || (Array.isArray(newJobs) && newJobs.length === 0)) {
        delete next[uid];
      } else {
        next[uid] = newJobs;
      }
      return next;
    });
  }, []);

  const handleSaveStudentJobs = useCallback(async () => {
    if (!checkPermission()) return { success: false };

    const changedEntries = Object.entries(editedStudentJobs);
    if (changedEntries.length === 0) {
      showFeedback("저장할 직업 변경사항이 없습니다.", "info");
      return { success: false };
    }

    setIsSavingJobs(true);
    try {
      await assignStudentJobs({
        classId,
        source: "payroll_manual_edit",
        assignments: changedEntries.map(([studentUid, jobData]) => ({
          studentUid,
          jobs: Array.isArray(jobData) ? jobData : [jobData],
        })),
      });
      setEditedStudentJobs({});
      showFeedback(`${changedEntries.length}명 직업 변경사항을 저장했습니다.`, "success");
      return { success: true, updatedCount: changedEntries.length };
    } catch (error) {
      const errorCode = error?.code || "unknown";
      showFeedback(
        `직업 변경 저장 실패(${errorCode}): ${error?.message || "알 수 없는 오류"}`,
        "error",
      );
      return { success: false, error: error?.message, code: errorCode };
    } finally {
      setIsSavingJobs(false);
    }
  }, [editedStudentJobs, classId, checkPermission, showFeedback]);

  const handleResetSelectedStudentJobs = useCallback(async () => {
    if (!checkPermission()) return { success: false };

    const studentUids = Array.from(selectedStudentsForPayroll);
    if (studentUids.length === 0) {
      showFeedback("직업을 초기화할 학생을 선택해 주세요.", "info");
      return { success: false };
    }

    const previewNames = studentUids
      .slice(0, 3)
      .map((uid) => getStudentDisplayName(uid))
      .join(", ");
    const remainingCount = Math.max(0, studentUids.length - 3);
    const hasUnsavedChanges = studentUids.some((uid) => Boolean(editedStudentJobs[uid]));
    const confirmMessage = [
      `선택한 학생 ${studentUids.length}명의 직업을 초기화할까요?`,
      "초기화하면 해당 학생은 급여 지급 대상에서 제외됩니다.",
      `대상: ${previewNames}${remainingCount > 0 ? ` 외 ${remainingCount}명` : ""}`,
      hasUnsavedChanges ? "저장되지 않은 직업 변경도 함께 사라집니다." : null,
    ]
      .filter(Boolean)
      .join("\n");

    const confirmed =
      typeof window === "undefined" || typeof window.confirm !== "function"
        ? true
        : (await appConfirm(confirmMessage));

    if (!confirmed) {
      showFeedback("선택 학생 직업 초기화를 취소했습니다.", "info");
      return { success: false, cancelled: true };
    }

    setIsResettingJobs(true);
    try {
      await assignStudentJobs({
        classId,
        source: "payroll_reset",
        assignments: studentUids.map((studentUid) => ({
          studentUid,
          jobs: [],
        })),
      });

      setEditedStudentJobs((prev) => {
        const next = { ...prev };
        studentUids.forEach((uid) => delete next[uid]);
        return next;
      });
      setSelectedStudentsForPayroll((prev) => {
        const next = new Set(prev);
        studentUids.forEach((uid) => next.delete(uid));
        return next;
      });

      showFeedback(`${studentUids.length}명 직업을 초기화했습니다.`, "success");
      return { success: true, updatedCount: studentUids.length };
    } catch (error) {
      const errorCode = error?.code || "unknown";
      showFeedback(
        `직업 초기화 실패(${errorCode}): ${error?.message || "알 수 없는 오류"}`,
        "error",
      );
      return { success: false, error: error?.message, code: errorCode };
    } finally {
      setIsResettingJobs(false);
    }
  }, [
    checkPermission,
    selectedStudentsForPayroll,
    getStudentDisplayName,
    editedStudentJobs,
    classId,
    showFeedback,
  ]);

  const handleToggleStudentSelection = useCallback((uid) => {
    setSelectedStudentsForPayroll((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const handleToggleStudentGroupSelection = useCallback((studentUids = []) => {
    const normalizedUids = Array.isArray(studentUids)
      ? Array.from(new Set(studentUids.filter(Boolean)))
      : [];

    if (normalizedUids.length === 0) return;

    setSelectedStudentsForPayroll((prev) => {
      const next = new Set(prev);
      const areAllSelected = normalizedUids.every((uid) => next.has(uid));

      normalizedUids.forEach((uid) => {
        if (areAllSelected) next.delete(uid);
        else next.add(uid);
      });

      return next;
    });
  }, []);

  const handleClearSelectedStudents = useCallback((studentUids = []) => {
    const normalizedUids = Array.isArray(studentUids)
      ? Array.from(new Set(studentUids.filter(Boolean)))
      : [];

    setSelectedStudentsForPayroll((prev) => {
      if (normalizedUids.length === 0) return new Set();

      const next = new Set(prev);
      normalizedUids.forEach((uid) => next.delete(uid));
      return next;
    });
  }, []);

  useEffect(() => {
    if (paymentStartDate && numberOfWeeksToPay > 0) {
      setCalculatedEndDate(
        dayjs(paymentStartDate).add(numberOfWeeksToPay * 7 - 1, "day").format("YYYY-MM-DD"),
      );
    }
  }, [paymentStartDate, numberOfWeeksToPay]);

  return {
    paymentStartDate,
    setPaymentStartDate,
    numberOfWeeksToPay,
    setNumberOfWeeksToPay,
    calculatedEndDate,
    editedStudentJobs,
    selectedStudentsForPayroll,
    processingPayroll,
    isSavingJobs,
    isResettingJobs,
    hasPayrollPermission,
    checkIfPaid,
    handleStudentJobChange,
    handleSaveStudentJobs,
    handleResetSelectedStudentJobs,
    handlePaySelectedStudents,
    handleToggleStudentSelection,
    handleToggleStudentGroupSelection,
    handleClearSelectedStudents,
  };
};
