import React, { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "../../../firebase";
import {
  Button,
  Checkbox,
  InputField,
  SelectField,
  Textarea,
} from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useUser } from "../../../contexts/UserContext";
import { getPolicePath } from "../utils/policePathUtils";
import {
  isMissionTokenEnabledForRule,
  resolvePoliceRuleType,
} from "../utils/policeRuleUtils";

const getInitialState = (existingRule) => {
  const isEditing = Boolean(existingRule);

  return {
    text: existingRule?.text ?? "",
    fineAmount: existingRule?.fineAmount ?? (isEditing ? 0 : -10),
    creditChange: existingRule?.creditChange ?? (isEditing ? 0 : -10),
    missionTokenEnabled: isMissionTokenEnabledForRule(existingRule),
    missionTokenChange: existingRule?.missionTokenChange ?? 0,
    notes: existingRule?.notes ?? "",
    dangerLevel: existingRule?.dangerLevel ?? (isEditing ? 1 : 2),
  };
};

const PoliceRuleForm = ({ existingRule, onClose, onUpdate, isEditing }) => {
  const { classId, missionTokenLabel } = useUser();
  const { showFeedback } = useFeedback();

  const [rule, setRule] = useState(getInitialState(existingRule));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setRule(getInitialState(existingRule));
  }, [existingRule]);

  const handleChange = (field, value) => {
    setRule((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!rule.text.trim()) {
      showFeedback("규칙 내용을 입력해 주세요.", "warning");
      return;
    }

    setIsSaving(true);

    try {
      const rulesPath = getPolicePath("policeRulesCollection", classId);
      const rawAmount = Number(rule.fineAmount) || 0;
      const rawCredit = Number(rule.creditChange) || 0;
      const rawMissionToken = rule.missionTokenEnabled
        ? Number(rule.missionTokenChange) || 0
        : 0;
      const nonZeroSigns = [rawAmount, rawCredit, rawMissionToken]
        .filter((value) => value !== 0)
        .map((value) => Math.sign(value));

      if (
        nonZeroSigns.length > 1 &&
        nonZeroSigns.some((sign) => sign !== nonZeroSigns[0])
      ) {
        showFeedback(
          `화폐, 신용점수, ${missionTokenLabel}의 증감 방향을 같게 맞춰 주세요.`,
          "error",
        );
        setIsSaving(false);
        return;
      }

      const resolvedType = resolvePoliceRuleType({
        fineAmount: rawAmount,
        creditChange: rawCredit,
        missionTokenChange: rawMissionToken,
      });

      const ruleData = {
        ...rule,
        fineAmount: rawAmount,
        creditChange: rawCredit,
        missionTokenEnabled: rule.missionTokenEnabled === true,
        missionTokenChange: rawMissionToken,
        type: resolvedType,
        updatedAt: serverTimestamp(),
      };

      if (resolvedType === "penalty") {
        ruleData.dangerLevel = Number(rule.dangerLevel) || 1;
      }

      if (isEditing && existingRule?.id) {
        const ruleRef = doc(db, rulesPath, existingRule.id);
        await updateDoc(ruleRef, ruleData);
        showFeedback("규칙을 수정했습니다.", "success");
      } else {
        const snapshot = await getDocs(query(collection(db, rulesPath)));
        const newOrder = snapshot.size + 1;
        const newRuleRef = doc(collection(db, rulesPath));

        await setDoc(newRuleRef, {
          ...ruleData,
          order: newOrder,
          createdAt: serverTimestamp(),
        });

        showFeedback("새 규칙을 추가했습니다.", "success");
      }

      onUpdate?.();
      onClose?.();
    } catch (error) {
      console.error("police rule save failed:", error);
      showFeedback("규칙 저장에 실패했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const showDangerLevel =
    Number(rule.fineAmount) < 0 ||
    Number(rule.creditChange) < 0 ||
    Number(rule.missionTokenChange) < 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 space-y-4 rounded-lg border bg-slate-50 p-4"
    >
      <h3 className="text-lg font-bold">
        {isEditing ? "규칙 수정" : "새 규칙 추가"}
      </h3>

      <Textarea
        label="규칙 내용"
        value={rule.text}
        onChange={(event) => handleChange("text", event.target.value)}
        required
        rows={3}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InputField
          label="벌금/상금"
          type="number"
          value={rule.fineAmount}
          onChange={(event) => handleChange("fineAmount", event.target.value)}
          placeholder="벌금은 음수, 상금은 양수"
        />
        <InputField
          label="신용점수 변화"
          type="number"
          value={rule.creditChange}
          onChange={(event) => handleChange("creditChange", event.target.value)}
          placeholder="감점은 음수, 가점은 양수"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <Checkbox
          id="police-rule-mission-token-enabled"
          checked={rule.missionTokenEnabled}
          onChange={(event) =>
            handleChange("missionTokenEnabled", event.target.checked)
          }
          label={`${missionTokenLabel}까지 함께 설정`}
          labelClassName="font-medium text-slate-700"
        />
        {rule.missionTokenEnabled ? (
          <div className="mt-3">
            <InputField
              label={`${missionTokenLabel} 증감`}
              type="number"
              value={rule.missionTokenChange}
              onChange={(event) =>
                handleChange("missionTokenChange", event.target.value)
              }
              placeholder="차감은 음수, 지급은 양수"
            />
          </div>
        ) : null}
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-bold text-slate-700">참고 사항</span>
        <Textarea
          value={rule.notes}
          onChange={(event) => handleChange("notes", event.target.value)}
          placeholder="필요한 메모를 남겨 두세요."
          rows={3}
        />
      </label>

      {showDangerLevel ? (
        <SelectField
          label="위험도 (벌점 규칙 전용)"
          value={rule.dangerLevel}
          onChange={(event) => handleChange("dangerLevel", Number(event.target.value))}
        >
          <option value={1}>1 - 낮음 (주의)</option>
          <option value={2}>2 - 보통 (경고)</option>
          <option value={3}>3 - 높음 (중대)</option>
        </SelectField>
      ) : null}

      <div className="flex justify-end gap-2 border-t pt-3">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          disabled={isSaving}
        >
          취소
        </Button>
        <Button
          type="submit"
          color="blue"
          isLoading={isSaving}
          disabled={isSaving}
        >
          {isEditing ? "수정 사항 저장" : "규칙 추가"}
        </Button>
      </div>
    </form>
  );
};

export default PoliceRuleForm;
