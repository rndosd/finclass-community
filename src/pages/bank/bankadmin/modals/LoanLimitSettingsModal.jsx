import React, { useCallback, useEffect, useMemo, useState } from "react";
import { doc, getDoc, writeBatch } from "firebase/firestore";
import { User, Settings2, ShieldCheck } from "lucide-react";
import { Button, Modal, InputField, Spinner, Alert, ToggleSwitch } from "../../../../components/ui";
import { db } from "../../../../firebase";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { useClassStudents } from "../../../../hooks/user/useClassStudents";

function normalizeStudentList(students = []) {
  return [...students]
    .map((student) => {
      const rawRatio = student.loanLimitRatio;
      let loanLimitRatio = "";
      if (typeof rawRatio === "number" && !Number.isNaN(rawRatio)) {
        loanLimitRatio = (rawRatio * 100).toString();
      }

      return {
        uid: student.uid,
        name: student.name || "이름 없음",
        studentNumber: student.studentNumber || 0,
        loanLimitRatio,
      };
    })
    .sort((a, b) => a.studentNumber - b.studentNumber);
}

export default function LoanLimitSettingsModal({ isOpen, onClose, classId, ...modalProps }) {
  const { showFeedback } = useFeedback();
  const [students, setStudents] = useState([]);
  const [limits, setLimits] = useState({});
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLimitEnabled, setIsLimitEnabled] = useState(true);
  const [defaultRatio, setDefaultRatio] = useState("");

  const {
    data: classStudents = [],
    isLoading: studentsLoading,
  } = useClassStudents(classId, {
    enabled: isOpen && !!classId,
    realtime: false,
  });

  const normalizedStudents = useMemo(
    () => normalizeStudentList(classStudents),
    [classStudents],
  );

  const isLoading = isSettingsLoading || studentsLoading;

  const fetchSettings = useCallback(async () => {
    if (!classId) return;

    setIsSettingsLoading(true);
    try {
      const bankSettingsRef = doc(db, `classes/${classId}/bank/settings`);
      const bankSettingsSnap = await getDoc(bankSettingsRef);

      if (bankSettingsSnap.exists()) {
        const settingsData = bankSettingsSnap.data();
        setIsLimitEnabled(settingsData.isLoanLimitRatioEnabled ?? true);

        if (typeof settingsData.defaultLoanLimitRatio === "number") {
          setDefaultRatio((settingsData.defaultLoanLimitRatio * 100).toString());
        } else {
          setDefaultRatio("");
        }
      } else {
        setIsLimitEnabled(true);
        setDefaultRatio("");
      }
    } catch (error) {
      console.error("[LoanLimitSettingsModal] settings load failed:", error);
      showFeedback("대출 한도 설정을 불러오지 못했습니다.", "error");
    } finally {
      setIsSettingsLoading(false);
    }
  }, [classId, showFeedback]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchSettings();
  }, [fetchSettings, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setStudents(normalizedStudents);

    const nextLimits = {};
    normalizedStudents.forEach((student) => {
      nextLimits[student.uid] = student.loanLimitRatio;
    });
    setLimits(nextLimits);
  }, [isOpen, normalizedStudents]);

  const handleLimitChange = (uid, value) => {
    setLimits((prev) => ({ ...prev, [uid]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    const batch = writeBatch(db);

    try {
      const bankSettingsRef = doc(db, `classes/${classId}/bank/settings`);
      let defaultRatioToSave = null;

      if (defaultRatio !== "") {
        const numericDefaultRatio = parseFloat(defaultRatio);
        if (
          Number.isNaN(numericDefaultRatio) ||
          numericDefaultRatio < 0 ||
          numericDefaultRatio > 100
        ) {
          showFeedback("기본 한도 비율은 0에서 100 사이여야 합니다.", "error");
          setIsSaving(false);
          return;
        }
        defaultRatioToSave = numericDefaultRatio / 100;
      }

      batch.set(
        bankSettingsRef,
        {
          isLoanLimitRatioEnabled: isLimitEnabled,
          defaultLoanLimitRatio: defaultRatioToSave,
        },
        { merge: true },
      );

      students.forEach((student) => {
        const valueStr = limits[student.uid];
        let valueToSave = null;
        if (valueStr !== "" && valueStr !== undefined) {
          valueToSave = parseFloat(valueStr) / 100;
        }

        const studentRef = doc(db, `classes/${classId}/students`, student.uid);
        batch.update(studentRef, { loanLimitRatio: valueToSave });
      });

      await batch.commit();
      showFeedback("대출 한도 설정을 저장했습니다.", "success");
    } catch (error) {
      console.error("[LoanLimitSettingsModal] save failed:", error);
      showFeedback("대출 한도 설정 저장에 실패했습니다.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="학생별 대출 한도 설정"
      size="lg"
      {...modalProps}
    >
      <div className="space-y-6 antialiased text-slate-800">
        <div className="group relative overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className={`rounded-2xl p-3 transition-colors ${
                  isLimitEnabled
                    ? "bg-indigo-500 text-white"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                <ShieldCheck size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold">대출 한도 기능</h3>
                <p className="text-sm text-slate-500">
                  학생별 자산 대비 최대 대출 비율을 설정합니다.
                </p>
              </div>
            </div>
            <ToggleSwitch checked={isLimitEnabled} onChange={setIsLimitEnabled} />
          </div>
        </div>

        <div
          className={`rounded-[1.5rem] border border-slate-200 bg-slate-50/50 p-6 transition-all ${
            !isLimitEnabled && "pointer-events-none opacity-40 grayscale"
          }`}
        >
          <div className="mb-4 flex items-center gap-2">
            <Settings2 size={20} className="text-indigo-600" />
            <h3 className="font-bold">기본 한도 비율</h3>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex-grow">
              <p className="text-sm leading-relaxed text-slate-600">
                학생별 값이 비어 있으면 아래 기본 비율이 적용됩니다.
                <br />
                예를 들어 기본 비율이 <span className="font-bold text-indigo-600">50%</span>
                이면 자산의 절반까지 대출할 수 있습니다.
              </p>
            </div>
            <div className="relative w-full md:w-32">
              <InputField
                id="default-limit"
                type="number"
                value={defaultRatio}
                onChange={(e) => setDefaultRatio(e.target.value)}
                placeholder="50"
                className="!pr-8 !rounded-2xl border-slate-200 text-center text-lg font-bold focus:border-indigo-500"
                disabled={!isLimitEnabled}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">
                %
              </span>
            </div>
          </div>
        </div>

        <div className={`transition-all ${!isLimitEnabled && "pointer-events-none opacity-40 grayscale"}`}>
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <User size={18} className="text-slate-500" />
              <h3 className="font-bold">학생별 개별 비율</h3>
            </div>
            <span className="text-xs font-medium text-slate-400">
              총 {students.length}명
            </span>
          </div>

          <Alert
            type="info"
            className="!mb-4 !rounded-2xl !border-indigo-100 !bg-indigo-50 !text-xs !font-medium !text-indigo-700"
            message="비어 있는 학생은 기본 한도 비율을 사용합니다."
          />

          {isLoading ? (
            <div className="flex flex-col items-center justify-center rounded-[1.5rem] border border-dashed bg-slate-50/30 py-20">
              <Spinner size="lg" tone="indigo" />
              <span className="mt-4 text-sm font-medium text-slate-400">
                학생 목록을 불러오는 중입니다...
              </span>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
              <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 z-10 border-b bg-slate-50/80 backdrop-blur-md">
                    <tr>
                      <th className="w-20 p-4 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                        번호
                      </th>
                      <th className="p-4 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                        학생
                      </th>
                      <th className="w-40 p-4 text-center text-xs font-black uppercase tracking-widest text-slate-400">
                        한도 비율 (%)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {students.map((student) => (
                      <tr key={student.uid} className="transition-colors hover:bg-slate-50/80">
                        <td className="p-4 text-center font-bold text-slate-400">
                          {student.studentNumber}
                        </td>
                        <td className="p-4 font-bold text-slate-700">{student.name}</td>
                        <td className="p-4">
                          <div className="relative">
                            <InputField
                              id={`limit-${student.uid}`}
                              type="number"
                              value={limits[student.uid] || ""}
                              onChange={(e) =>
                                handleLimitChange(student.uid, e.target.value)
                              }
                              placeholder="기본값"
                              className="!rounded-xl !border-transparent !bg-slate-100 !py-2 !pr-7 text-center font-bold focus:!border-indigo-500 focus:!bg-white"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                              %
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center gap-3 border-t pt-6">
          <Button size="md"
            onClick={onClose}
            variant="secondary"
            disabled={isSaving}
            className="flex-1"
          >
            닫기
          </Button>
          <Button tone="blue" kind="solid" size="md"
            onClick={handleSave}
            isLoading={isSaving}
            disabled={isLoading}
            className="flex-[2]"
          >
            {isSaving ? "저장 중..." : "설정 저장"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
