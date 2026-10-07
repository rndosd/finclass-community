import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { Modal, Button, InputField } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";

const DEFAULT_LABELS = {
  3: "중대한 규칙 위반",
  2: "주의가 필요한 행동",
  1: "일반 생활 수칙",
};

const normalizeLabelEntry = (entry, fallback) => {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") return entry.label || fallback;
  return fallback;
};

const DangerLabelSettingsModal = ({ classId, onClose }) => {
  const { showFeedback } = useFeedback();
  const [labels, setLabels] = useState(DEFAULT_LABELS);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchLabels = async () => {
      try {
        const docRef = doc(db, `classes/${classId}/policeDangerLabels/settings`);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;

        const data = snap.data();
        setLabels({
          3: normalizeLabelEntry(data?.[3], DEFAULT_LABELS[3]),
          2: normalizeLabelEntry(data?.[2], DEFAULT_LABELS[2]),
          1: normalizeLabelEntry(data?.[1], DEFAULT_LABELS[1]),
        });
      } catch (err) {
        console.error("[DangerLabelSettingsModal] load failed:", err);
      }
    };

    if (classId) fetchLabels();
  }, [classId]);

  const handleChange = (level, value) => {
    setLabels((prev) => ({
      ...prev,
      [level]: value,
    }));
  };

  const handleSave = async () => {
    if (!classId) return;
    setIsSaving(true);
    try {
      const docRef = doc(db, `classes/${classId}/policeDangerLabels/settings`);
      await setDoc(docRef, labels);
      showFeedback("위험도 레이블 설정이 저장되었습니다.", "success");
      onClose();
    } catch (err) {
      console.error("[DangerLabelSettingsModal] save failed:", err);
      showFeedback("저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal title="학급 위험도 레이블 설정" isOpen onClose={onClose}>
      <div className="space-y-6">
        {[3, 2, 1].map((level) => (
          <div key={level}>
            <h3 className="font-semibold text-sm mb-2">위험도 {level} 텍스트</h3>
            <InputField
              label="레이블 이름"
              value={labels[level] || ""}
              onChange={(e) => handleChange(level, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="mt-6 text-right">
        <Button onClick={handleSave} color="blue" disabled={isSaving}>
          저장하기
        </Button>
      </div>
    </Modal>
  );
};

export default DangerLabelSettingsModal;
