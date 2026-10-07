import React, { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";
import { Button } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";

export default function StudentNameEditor({ student, classId }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(false);
  const expectedName = useRef("");
  const { showFeedback } = useFeedback();
  const save = async () => {
    if (requestRef.current || !draft?.trim()) return;
    requestRef.current = true;
    setBusy(true);
    try {
      await httpsCallable(functions, "updateStudentName")({ classId, studentUid: student.uid, name: draft.trim(), expectedName: expectedName.current });
      setDraft(null);
      showFeedback("학생 이름을 수정했습니다.", "success");
    } catch (error) {
      const messages = {
        "functions/aborted": "다른 화면에서 이름이 변경됐습니다. 취소 후 다시 수정해 주세요.",
        "functions/permission-denied": "담당 교사 또는 관리자만 수정할 수 있습니다.",
        "functions/failed-precondition": "학급 데이터 정리가 끝난 뒤 수정해 주세요.",
        "functions/not-found": "학생 계정을 찾을 수 없습니다. 새로고침해 주세요.",
      };
      showFeedback(messages[error.code] || "이름을 저장하지 못했습니다. 다시 시도해 주세요.", "error");
    } finally { requestRef.current = false; setBusy(false); }
  };
  if (draft === null) return <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="truncate">{student.name || "-"}</span><Button size="sm" variant="ghost" onClick={() => { expectedName.current = student.name || ""; setDraft(expectedName.current); }}>이름 수정</Button></div>;
  return <div className="flex min-w-0 flex-wrap gap-2">
    <input aria-label={`${student.studentNumber || ""}번 학생 이름`} autoFocus maxLength={50} value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); save(); } if (event.key === "Escape" && !busy) setDraft(null); }} className="h-11 w-full min-w-0 rounded-xl border border-blue-200 px-3 text-sm" />
    <Button size="sm" onClick={save} disabled={busy || !draft.trim()} isLoading={busy}>저장</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>취소</Button>
  </div>;
}
