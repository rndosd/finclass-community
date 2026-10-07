import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Button,
  Checkbox,
  InputField,
  SelectField,
  Textarea,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { db } from "../../../firebase";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useUser } from "../../../contexts/UserContext";

const DANGER_LEVEL_OPTIONS = [
  { value: 1, label: "1 - 낮음" },
  { value: 2, label: "2 - 보통" },
  { value: 3, label: "3 - 높음" },
];

const EMPTY_FORM_STATE = {
  title: "",
  content: "",
  isAnonymous: false,
  hideResultsDuringVoting: false,
  registerPoliceRuleOnPass: false,
  fineAmount: "",
  creditChange: "",
  dangerLevel: 2,
  notes: "",
};

const buildFormStateFromBill = (bill) => ({
  title: bill?.title || "",
  content: bill?.content || "",
  isAnonymous: bill?.isAnonymous === true,
  hideResultsDuringVoting: bill?.hideResultsDuringVoting === true,
  registerPoliceRuleOnPass:
    bill?.registerPoliceRuleOnPass === true || Boolean(bill?.policeRuleData),
  fineAmount:
    bill?.policeRuleData?.fineAmount === 0 || bill?.policeRuleData?.fineAmount
      ? String(bill.policeRuleData.fineAmount)
      : "",
  creditChange:
    bill?.policeRuleData?.creditChange === 0 || bill?.policeRuleData?.creditChange
      ? String(bill.policeRuleData.creditChange)
      : "",
  dangerLevel: Number(bill?.policeRuleData?.dangerLevel || 2),
  notes: bill?.policeRuleData?.notes || "",
});

const ProposeBillModal = ({
  isOpen,
  onClose,
  classId,
  onSuccess,
  mode = "create",
  initialBill = null,
}) => {
  const { showFeedback } = useFeedback();
  const { userData } = useUser();
  const [title, setTitle] = useState(EMPTY_FORM_STATE.title);
  const [content, setContent] = useState(EMPTY_FORM_STATE.content);
  const [isAnonymous, setIsAnonymous] = useState(EMPTY_FORM_STATE.isAnonymous);
  const [hideResultsDuringVoting, setHideResultsDuringVoting] = useState(
    EMPTY_FORM_STATE.hideResultsDuringVoting,
  );
  const [registerPoliceRuleOnPass, setRegisterPoliceRuleOnPass] = useState(
    EMPTY_FORM_STATE.registerPoliceRuleOnPass,
  );
  const [fineAmount, setFineAmount] = useState(EMPTY_FORM_STATE.fineAmount);
  const [creditChange, setCreditChange] = useState(EMPTY_FORM_STATE.creditChange);
  const [dangerLevel, setDangerLevel] = useState(EMPTY_FORM_STATE.dangerLevel);
  const [notes, setNotes] = useState(EMPTY_FORM_STATE.notes);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditMode = mode === "edit";
  const modalTitle = isEditMode ? "안건 수정" : "안건 제안";
  const submitLabel = isEditMode ? "수정하기" : "제안하기";

  const applyFormState = (nextState) => {
    setTitle(nextState.title);
    setContent(nextState.content);
    setIsAnonymous(nextState.isAnonymous);
    setHideResultsDuringVoting(nextState.hideResultsDuringVoting);
    setRegisterPoliceRuleOnPass(nextState.registerPoliceRuleOnPass);
    setFineAmount(nextState.fineAmount);
    setCreditChange(nextState.creditChange);
    setDangerLevel(nextState.dangerLevel);
    setNotes(nextState.notes);
    setIsSubmitting(false);
  };

  useEffect(() => {
    if (!isOpen) {
      applyFormState(EMPTY_FORM_STATE);
      return;
    }

    applyFormState(isEditMode ? buildFormStateFromBill(initialBill) : EMPTY_FORM_STATE);
  }, [initialBill, isEditMode, isOpen]);

  const normalizedDangerLevel = useMemo(() => Number(dangerLevel), [dangerLevel]);

  const buildPoliceRuleData = () => ({
    text: title.trim(),
    fineAmount: Number(fineAmount) || 0,
    creditChange: Number(creditChange) || 0,
    dangerLevel: normalizedDangerLevel,
    notes: notes.trim(),
  });

  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle || !trimmedContent) {
      showFeedback("안건 제목과 내용을 모두 입력해 주세요.", "warning");
      return;
    }

    if (isEditMode && initialBill?.status !== "voting") {
      showFeedback("투표 중인 안건만 수정할 수 있습니다.", "warning");
      return;
    }

    if (
      registerPoliceRuleOnPass &&
      !DANGER_LEVEL_OPTIONS.some((option) => option.value === normalizedDangerLevel)
    ) {
      showFeedback("생활지도 규칙 위험도를 다시 확인해 주세요.", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditMode) {
        if (!initialBill?.id) {
          throw new Error("수정할 안건 정보를 찾지 못했습니다.");
        }

        const updatePayload = {
          title: trimmedTitle,
          content: trimmedContent,
          registerPoliceRuleOnPass,
          updatedAt: serverTimestamp(),
          lastEditedByUid: userData?.uid || "",
          lastEditedByName: userData?.name || "",
        };

        if (registerPoliceRuleOnPass) {
          updatePayload.policeRuleData = buildPoliceRuleData();
        } else {
          updatePayload.policeRuleData = deleteField();
        }

        await updateDoc(
          doc(db, `classes/${classId}/assemblyBills/${initialBill.id}`),
          updatePayload,
        );
        showFeedback("안건 내용을 수정했습니다.", "success");
      } else {
        const billData = {
          title: trimmedTitle,
          content: trimmedContent,
          proposerUid: userData.uid,
          proposerName: userData.name || "",
          isAnonymous,
          allowVoteChanges: true,
          hideResultsDuringVoting,
          createdAt: serverTimestamp(),
          status: "voting",
          registerPoliceRuleOnPass,
          showVotersDuringVoting: false,
          showVotersAfterClose: false,
          votes: {
            agree: 0,
            disagree: 0,
          },
        };

        if (registerPoliceRuleOnPass) {
          billData.policeRuleData = buildPoliceRuleData();
        }

        await addDoc(collection(db, `classes/${classId}/assemblyBills`), billData);
        showFeedback("안건을 제안했습니다.", "success");
      }

      onSuccess?.();
    } catch (error) {
      showFeedback(
        `${isEditMode ? "안건 수정" : "안건 제안"} 중 문제가 발생했습니다: ${error.message}`,
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="lg">
      <div className="space-y-4">
        {isEditMode && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-blue-800">
            교사는 진행 중인 안건의 문구와 설정을 다듬을 수 있습니다. 기존 투표 기록은
            그대로 유지됩니다.
          </div>
        )}

        <InputField
          label="안건 제목"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="학생들이 바로 이해할 수 있게 제목을 적어 주세요"
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">안건 내용</label>
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="제안 이유와 바꾸고 싶은 내용을 구체적으로 적어 주세요"
            rows={5}
          />
        </div>

        {!isEditMode && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <Checkbox
              id="assembly-bill-anonymous"
              checked={isAnonymous}
              onChange={(event) => setIsAnonymous(event.target.checked)}
              label="이름 숨기기"
              labelClassName="font-semibold text-slate-800"
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">
              체크하면 학생 화면에는 익명으로 표시돼요. 담당 선생님은 작성자를 확인할 수 있어요.
            </p>
            <div className="border-t border-slate-100 pt-3">
              <Checkbox
                id="assembly-hide-results-during-voting"
                checked={hideResultsDuringVoting}
                onChange={(event) => setHideResultsDuringVoting(event.target.checked)}
                label="투표 중 결과 숨기기"
                labelClassName="font-semibold text-slate-800"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                체크하면 투표가 마감될 때까지 학생에게 찬성·반대 결과를 보여주지 않아요.
              </p>
            </div>
            <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-700">
              학생은 투표가 마감되기 전까지 자신의 선택을 바꿀 수 있어요.
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <Checkbox
            id="register-police-rule-on-pass"
            checked={registerPoliceRuleOnPass}
            onChange={(event) => setRegisterPoliceRuleOnPass(event.target.checked)}
            label="가결 시 생활지도 규칙에 자동 등록"
            labelClassName="font-semibold text-slate-800"
          />
          <p className="mt-2 text-xs leading-5 text-slate-500">
            이 옵션을 켜면 안건이 가결될 때 경찰 규칙에도 같은 내용이 함께 반영됩니다.
          </p>

          {registerPoliceRuleOnPass && (
            <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <InputField
                    label="벌금 또는 보상 점수"
                    type="number"
                    value={fineAmount}
                    onChange={(event) => setFineAmount(event.target.value)}
                    placeholder="예: -50 또는 100"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    음수는 벌금, 양수는 보상이에요.
                  </p>
                </div>
                <div>
                  <InputField
                    label="신용 점수 변화"
                    type="number"
                    value={creditChange}
                    onChange={(event) => setCreditChange(event.target.value)}
                    placeholder="예: -5 또는 10"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    음수는 차감, 양수는 추가됩니다.
                  </p>
                </div>
              </div>

              <SelectField
                label="위험도"
                value={dangerLevel}
                onChange={(event) => setDangerLevel(Number(event.target.value))}
                options={DANGER_LEVEL_OPTIONS}
              />

              <label className="block space-y-1.5">
                <span className="text-sm font-bold text-slate-700">비고</span>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="교사가 참고할 설명이 있으면 적어 주세요"
                  rows={3}
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            닫기
          </Button>
          <Button color="blue" onClick={handleSubmit} isLoading={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ProposeBillModal;
