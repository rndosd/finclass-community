import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(undefined, "asia-northeast3");

const callables = {
  submitFundApplication: httpsCallable(functions, "submitFundApplicationV2"),
  reviewFundApplication: httpsCallable(functions, "reviewFundApplication"),
  submitFundRebalance: httpsCallable(functions, "submitFundRebalance"),
  updateFundProfile: httpsCallable(functions, "updateFundProfile"),
  submitFundReport: httpsCallable(functions, "submitFundReport"),
  updateFundReport: httpsCallable(functions, "updateFundReport"),
  submitFundOrder: httpsCallable(functions, "submitFundOrder"),
  deleteFund: httpsCallable(functions, "deleteFund"),
  previewFundRisk: httpsCallable(functions, "previewFundRisk"),
};

const toFail = (err, fallbackMessage) => ({
  success: false,
  message:
    err?.message ||
    err?.data?.message ||
    err?.customData?.message ||
    fallbackMessage ||
    "요청 처리 중 오류가 발생했습니다.",
});

export async function submitFundApplication(classId, application) {
  try {
    const res = await callables.submitFundApplication({ classId, application });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[submitFundApplication] Error:", err);
    return toFail(err, "펀드 신청서 제출에 실패했습니다.");
  }
}

export async function reviewFundApplication(
  classId,
  applicationId,
  decision,
  reviewNote = "",
) {
  try {
    const res = await callables.reviewFundApplication({
      classId,
      applicationId,
      decision,
      reviewNote,
    });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[reviewFundApplication] Error:", err);
    return toFail(err, "펀드 신청 심사 처리에 실패했습니다.");
  }
}

export async function submitFundOrder(classId, payload) {
  try {
    const res = await callables.submitFundOrder({ classId, ...payload });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[submitFundOrder] Error:", err);
    return toFail(err, "펀드 주문 접수에 실패했습니다.");
  }
}

export async function submitFundRebalance(classId, payload) {
  try {
    const res = await callables.submitFundRebalance({ classId, ...payload });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[submitFundRebalance] Error:", err);
    return toFail(err, "펀드 리밸런싱 저장에 실패했습니다.");
  }
}

export async function updateFundProfile(classId, payload) {
  try {
    const res = await callables.updateFundProfile({ classId, ...payload });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[updateFundProfile] Error:", err);
    return toFail(err, "펀드 소개 수정에 실패했습니다.");
  }
}

export async function submitFundReport(classId, payload) {
  try {
    const res = await callables.submitFundReport({ classId, ...payload });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[submitFundReport] Error:", err);
    return toFail(err, "운용 보고서 제출에 실패했습니다.");
  }
}

export async function updateFundReport(classId, payload) {
  try {
    const res = await callables.updateFundReport({ classId, ...payload });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[updateFundReport] Error:", err);
    return toFail(err, "운용 보고서 수정에 실패했습니다.");
  }
}

export async function deleteFund(classId, fundId) {
  try {
    const res = await callables.deleteFund({ classId, fundId });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[deleteFund] Error:", err);
    return toFail(err, "펀드 삭제에 실패했습니다.");
  }
}

export async function previewFundRisk(classId, holdings) {
  try {
    const res = await callables.previewFundRisk({ classId, holdings });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("[previewFundRisk] Error:", err);
    return toFail(err, "가격 움직임을 계산하지 못했어요.");
  }
}
