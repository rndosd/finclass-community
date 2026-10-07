import { httpsCallable } from "firebase/functions";

import { functions } from "../../../firebase";

const processBulkPayrollFn = httpsCallable(functions, "processBulkPayroll");
const processIndividualBonusFn = httpsCallable(functions, "processIndividualBonus");
const processIndividualIncentiveFn = httpsCallable(
  functions,
  "processIndividualIncentive",
);
const updatePayrollAutomationSettingsFn = httpsCallable(
  functions,
  "updatePayrollAutomationSettings",
);

export const paySelectedStudents = async (
  classId,
  studentUids,
  paymentStartDate,
  numberOfWeeks,
  options = {},
) => {
  const { allowOverlapOverride = false } = options;

  try {
    const result = await processBulkPayrollFn({
      classId,
      studentUids,
      paymentStartDate,
      numberOfWeeks,
      allowOverlapOverride,
    });

    return { success: true, results: result.data.results };
  } catch (err) {
    throw new Error(err.message || "선택한 학생 급여 지급에 실패했습니다.");
  }
};

export const payIndividualBonus = async (
  classId,
  studentUid,
  {
    basePayslipId,
    bonusEntryMode,
    selectedJobNames,
    bonusMode,
    bonusValue,
    jobBonusConfigs,
    note,
  },
) => {
  try {
    const result = await processIndividualBonusFn({
      classId,
      studentUid,
      basePayslipId,
      bonusEntryMode,
      selectedJobNames,
      bonusMode,
      bonusValue,
      jobBonusConfigs,
      note,
    });

    return { success: true, data: result.data };
  } catch (err) {
    throw new Error(err.message || "성과급 지급에 실패했습니다.");
  }
};

export const payIndividualIncentive = async (
  classId,
  studentUid,
  {
    jobName,
    reason,
    incentiveMode,
    amount,
    quantity,
    unitAmount,
    note,
  },
) => {
  try {
    const result = await processIndividualIncentiveFn({
      classId,
      studentUid,
      jobName,
      reason,
      incentiveMode,
      amount,
      quantity,
      unitAmount,
      note,
    });

    return { success: true, data: result.data };
  } catch (err) {
    throw new Error(err.message || "인센티브 지급에 실패했습니다.");
  }
};

export const updatePayrollAutomationSettings = async (classId, settings) => {
  try {
    const result = await updatePayrollAutomationSettingsFn({
      classId,
      settings,
    });
    return result.data?.settings || null;
  } catch (err) {
    throw new Error(err.message || "정기 급여 자동 지급 설정 저장에 실패했습니다.");
  }
};
