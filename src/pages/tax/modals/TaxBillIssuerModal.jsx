import React, { useEffect, useMemo, useState } from "react";
import { db } from "../../../firebase";
import {
  collection,
  doc,
  Timestamp,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { useClassStudents } from "../../../hooks/user/useClassStudents";
import StudentSelector from "../../../components/ui/StudentSelector";
import { Modal, Button, InputField, Textarea } from "../../../components/ui";
import { Info, Users } from "lucide-react";
import { parseDateKeyAsKST, shiftDateKeyInKST } from "../../../utils/kstDate";
import { getTaxBillLateFeePolicy } from "../../../utils/taxPolicy";

const createTaxFormState = (classData) => {
  const policy = getTaxBillLateFeePolicy(classData || {});
  return {
    name: "",
    amount: "",
    description: "",
    dueDate: "",
    lateFeeEnabled: policy.enabled === true,
    lateFeeMode: policy.mode === "rate" ? "rate" : "fixed",
    lateFeeDailyAmount: policy.dailyAmount ? String(policy.dailyAmount) : "",
    lateFeeDailyRate: policy.dailyRate ? String(policy.dailyRate) : "",
  };
};

const DUE_DATE_PRESETS = [
  { label: "3일", days: 3 },
  { label: "7일", days: 7 },
  { label: "14일", days: 14 },
];

export default function TaxBillIssuerModal({ isOpen, onClose }) {
  const { classId, classData, userData } = useUser();
  const { showFeedback } = useFeedback();
  const { data: rosterStudents = [] } = useClassStudents(classId, {
    enabled: isOpen && !!classId,
    realtime: false,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [selectedUids, setSelectedUids] = useState([]);
  const [taxData, setTaxData] = useState(() => createTaxFormState(classData));

  useEffect(() => {
    if (isOpen) {
      setTaxData(createTaxFormState(classData));
      setSelectedUids([]);
    }
  }, [classData, isOpen]);

  const studentMap = useMemo(() => {
    const nextMap = new Map();
    (rosterStudents || []).forEach((student) => {
      const uid = student?.uid || student?.id;
      if (!uid) return;
      nextMap.set(uid, student);
    });
    return nextMap;
  }, [rosterStudents]);

  const handleChange = (e) => {
    const { name, type, checked, value } = e.target;
    setTaxData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const applyDueDatePreset = (days) => {
    setTaxData((prev) => ({
      ...prev,
      dueDate: shiftDateKeyInKST(new Date(), days),
    }));
  };

  const handleIssueTax = async () => {
    if (selectedUids.length === 0)
      return showFeedback("학생을 선택해 주세요.", "error");
    if (!taxData.name || !taxData.amount)
      return showFeedback("이름과 금액을 입력해 주세요.", "error");

    if (taxData.lateFeeEnabled && !taxData.dueDate) {
      return showFeedback("연체료를 적용하려면 납부기한을 입력해 주세요.", "error");
    }

    const dueDateValue = taxData.dueDate
      ? parseDateKeyAsKST(taxData.dueDate, { endOfDay: true })
      : null;
    if (taxData.dueDate && !dueDateValue) {
      return showFeedback("납부기한을 확인해 주세요.", "error");
    }

    const dailyAmount = Math.max(0, Number(taxData.lateFeeDailyAmount || 0));
    const dailyRate = Math.max(0, Number(taxData.lateFeeDailyRate || 0));
    if (
      taxData.lateFeeEnabled &&
      taxData.lateFeeMode === "fixed" &&
      dailyAmount <= 0
    ) {
      return showFeedback("하루 고정 연체료를 입력해 주세요.", "error");
    }
    if (
      taxData.lateFeeEnabled &&
      taxData.lateFeeMode === "rate" &&
      dailyRate <= 0
    ) {
      return showFeedback("하루 비율 연체료를 입력해 주세요.", "error");
    }

    setIsLoading(true);
    const batch = writeBatch(db);

    try {
      selectedUids.forEach((uid) => {
        const student = studentMap.get(uid) || {};
        const billRef = doc(
          collection(db, `classes/${classId}/students/${uid}/taxBills`),
        );
        batch.set(billRef, {
          classId,
          studentUid: uid,
          studentName: student.name || student.displayName || null,
          studentNumber: student.studentNumber || null,
          issuedBy: userData?.uid || null,
          billKind: "manual",
          name: taxData.name,
          amount: Number(taxData.amount),
          description: taxData.description,
          status: "pending",
          isPaid: false,
          issuedAt: serverTimestamp(),
          paidAt: null,
          dueDate: dueDateValue ? Timestamp.fromDate(dueDateValue) : null,
          lateFeePolicy: {
            enabled: taxData.lateFeeEnabled === true,
            mode: taxData.lateFeeMode === "rate" ? "rate" : "fixed",
            dailyAmount: taxData.lateFeeEnabled ? dailyAmount : 0,
            dailyRate: taxData.lateFeeEnabled ? dailyRate : 0,
            graceDays: 0,
          },
          taxType: "general",
        });
      });

      await batch.commit();
      showFeedback(
        `${selectedUids.length}명에게 고지서를 보냈습니다.`,
        "success",
      );

      setTaxData(createTaxFormState(classData));
      setSelectedUids([]);
      onClose();
    } catch (error) {
      showFeedback("발송 중 오류가 발생했습니다.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="세금 고지서 발급" size="lg">
      <div className="space-y-6">
        {/* ✨ 상단 입력 섹션: 제목과 금액을 한 줄에 배치 */}
        <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              label="고지서 명칭 (제목)"
              name="name"
              placeholder="예: 3월 소득세, 자리세 등"
              value={taxData.name}
              onChange={handleChange}
            />
            <InputField
              label="납부 금액"
              name="amount"
              type="number"
              placeholder="금액을 입력하세요"
              value={taxData.amount}
              onChange={handleChange}
            />
          </div>
          <Textarea
            label="상세 설명 (선택)"
            name="description"
            placeholder="학생들에게 전달할 추가 메시지"
            value={taxData.description}
            onChange={handleChange}
            rows={2}
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-black text-slate-700">
                  {"\uB0A9\uBD80\uAE30\uD55C"}
                </span>
                <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1">
                  {DUE_DATE_PRESETS.map((preset) => {
                    const presetDate = shiftDateKeyInKST(new Date(), preset.days);
                    return (
                      <Button
                        key={preset.days}
                        type="button"
                        onClick={() => applyDueDatePreset(preset.days)}
                        size="xs"
                        tone="blue"
                        kind={taxData.dueDate === presetDate ? "solid" : "ghost"}
                        rounded="lg"
                        className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
                          taxData.dueDate === presetDate
                            ? "bg-indigo-500 text-white shadow-sm"
                            : "text-slate-500 hover:bg-white hover:text-slate-800"
                        }`}
                      >
                        {preset.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <InputField
                name="dueDate"
                type="date"
                value={taxData.dueDate}
                onChange={handleChange}
                tone="indigo"
                wrapperClassName="space-y-0"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div
              className={`rounded-xl border p-4 transition ${
                taxData.lateFeeEnabled
                  ? "border-rose-100 bg-rose-50/30"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex min-w-[120px] items-center gap-3 text-sm font-black text-slate-700">
                    <input
                      type="checkbox"
                      name="lateFeeEnabled"
                      checked={taxData.lateFeeEnabled}
                      onChange={handleChange}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    {"\uC5F0\uCCB4\uB8CC \uC801\uC6A9"}
                  </label>

                  {taxData.lateFeeEnabled && (
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:w-48">
                      <Button
                        type="button"
                        onClick={() =>
                          setTaxData((prev) => ({ ...prev, lateFeeMode: "fixed" }))
                        }
                        size="xs"
                        tone="rose"
                        kind={taxData.lateFeeMode === "fixed" ? "soft" : "ghost"}
                        rounded="lg"
                        className={`rounded-lg px-2 py-2 text-xs font-black transition ${
                          taxData.lateFeeMode === "fixed"
                            ? "bg-white text-rose-600 shadow-sm"
                            : "text-slate-500"
                        }`}
                      >
                        {"\uD558\uB8E8 \uACE0\uC815\uC561"}
                      </Button>
                      <Button
                        type="button"
                        onClick={() =>
                          setTaxData((prev) => ({ ...prev, lateFeeMode: "rate" }))
                        }
                        size="xs"
                        tone="rose"
                        kind={taxData.lateFeeMode === "rate" ? "soft" : "ghost"}
                        rounded="lg"
                        className={`rounded-lg px-2 py-2 text-xs font-black transition ${
                          taxData.lateFeeMode === "rate"
                            ? "bg-white text-rose-600 shadow-sm"
                            : "text-slate-500"
                        }`}
                      >
                        {"\uD558\uB8E8 \uBE44\uC728"}
                      </Button>
                    </div>
                  )}
                </div>

                {taxData.lateFeeEnabled && (
                  <input
                    name={
                      taxData.lateFeeMode === "fixed"
                        ? "lateFeeDailyAmount"
                        : "lateFeeDailyRate"
                    }
                    type="number"
                    min="0"
                    step={taxData.lateFeeMode === "rate" ? "0.1" : "1"}
                    value={
                      taxData.lateFeeMode === "fixed"
                        ? taxData.lateFeeDailyAmount
                        : taxData.lateFeeDailyRate
                    }
                    onChange={handleChange}
                    placeholder={
                      taxData.lateFeeMode === "fixed"
                        ? "\uD558\uB8E8 \uC5F0\uCCB4\uB8CC"
                        : "\uD558\uB8E8 \uC5F0\uCCB4\uC728 (%)"
                    }
                    className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 학생 선택 섹션 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Users className="h-5 w-5 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-800">
              받을 학생 선택 ({selectedUids.length}명)
            </h3>
          </div>
          <StudentSelector
            selectedUids={selectedUids}
            onChange={setSelectedUids}
          />
        </div>

        {/* 하단 푸터 */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2 text-slate-500">
            <Info size={16} className="text-indigo-500" />
            <span className="text-[11px]">
              발행 시 학생 사이드바에 즉시 배지가 나타납니다.
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              취소
            </Button>
            <Button tone="blue" kind="solid" size="md"
              onClick={handleIssueTax}
              isLoading={isLoading}
              loadingText="발송 중..."
              disabled={selectedUids.length === 0}
              className="min-w-[100px]"
            >
              고지서 발송
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
