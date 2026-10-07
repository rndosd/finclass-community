import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getApp } from "firebase/app";
import { useFeedback } from "../../../contexts/FeedbackContext";
import {
  getXlsxImportErrorMessage,
  parseFirstXlsxWorksheet,
  validateXlsxImportFile,
} from "../../../utils/safeXlsxImport";

const normalizeGender = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const lowered = raw.toLowerCase();
  if (
    lowered === "male" ||
    lowered === "m" ||
    lowered === "man" ||
    lowered === "boy" ||
    raw === "남" ||
    raw === "남자" ||
    raw === "남성"
  ) {
    return "male";
  }

  if (
    lowered === "female" ||
    lowered === "f" ||
    lowered === "woman" ||
    lowered === "girl" ||
    raw === "여" ||
    raw === "여자" ||
    raw === "여성"
  ) {
    return "female";
  }

  return "";
};

export const useStudentRegistration = () => {
  const { showFeedback } = useFeedback();

  const [students, setStudents] = useState([
    { name: "", email: "", password: "123456", studentNumber: "", gender: "" },
  ]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState([]); // 🌟 결과 상태
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const addRow = () => {
    setStudents((prev) => [
      ...prev,
      { name: "", email: "", password: "123456", studentNumber: "", gender: "" },
    ]);
  };

  const deleteRow = (index) => {
    setStudents((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index),
    );
  };

  const handleChange = (index, field, value) => {
    setStudents((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      validateXlsxImportFile(file);
    } catch (error) {
      showFeedback(
        getXlsxImportErrorMessage(error, "엑셀 파일 형식을 확인해 주세요."),
        "error",
      );
      e.target.value = "";
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const { rows } = parseFirstXlsxWorksheet(evt.target.result, { file });

        const parsed = rows.map((row) => ({
          studentNumber: row.학번 || row.studentNumber || "",
          name: String(row.이름 || row.name || "").trim(),
          email: String(row.이메일 || row.email || "")
            .trim()
            .toLowerCase(),
          password: String(row.비밀번호 || row.password || "123456").trim(),
          gender: normalizeGender(row.성별 || row.gender || row.Gender || ""),
        }));

        const validStudents = parsed.filter((s) => s.name && s.email);
        const invalidRowCount = parsed.length - validStudents.length;

        if (validStudents.length === 0) {
          showFeedback(
            '엑셀 파일에서 유효한 학생 정보를 찾을 수 없습니다. "이름", "이메일" 열이 있는지 확인해주세요.',
            "error",
          );
          return;
        }

        setStudents(validStudents);
        showFeedback(
          `${validStudents.length}명의 학생 정보를 성공적으로 불러왔습니다.`,
          "success",
        );
        if (invalidRowCount > 0) {
          showFeedback(
            `이름 또는 이메일이 없는 ${invalidRowCount}개의 행은 제외되었습니다.`,
            "warning",
          );
        }
      } catch (err) {
        showFeedback(
          getXlsxImportErrorMessage(
            err,
            "엑셀 파일을 처리하는 중 오류가 발생했습니다.",
          ),
          "error",
        );
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleRegister = async (classId) => {
    if (!classId) {
      showFeedback("학생을 등록할 학급이 지정되지 않았습니다.", "error");
      return;
    }

    const validStudents = students
      .filter((s) => String(s.name ?? "").trim() && String(s.email ?? "").trim())
      .map((s) => ({
        ...s,
        name: String(s.name ?? "").trim(),
        email: String(s.email ?? "").trim().toLowerCase(),
        password: String(s.password ?? "").trim(),
        studentNumber: String(s.studentNumber ?? "").trim(),
        gender: normalizeGender(s.gender || ""),
      }));

    if (validStudents.length === 0) {
      showFeedback(
        "이름과 이메일을 모두 입력한 학생 정보가 없습니다.",
        "warning",
      );
      return;
    }

    const emailCounts = validStudents.reduce((acc, student) => {
      acc[student.email] = (acc[student.email] || 0) + 1;
      return acc;
    }, {});
    const duplicateEmails = Object.keys(emailCounts).filter(
      (email) => emailCounts[email] > 1,
    );

    if (duplicateEmails.length > 0) {
      showFeedback(
        `같은 요청에 중복된 이메일이 있습니다: ${duplicateEmails.join(", ")}`,
        "warning",
      );
      return;
    }

    setIsSubmitting(true);
    setResult([]);

    try {
      const functions = getFunctions(getApp(), "asia-northeast3");
      const createFn = httpsCallable(functions, "createStudentAccounts");
      const requestData = { students: validStudents, classIdToAssign: classId };

      const { data } = await createFn(requestData);
      const resultsArray = data?.results || [];
      const failedEmails = new Set(
        resultsArray
          .filter((r) => r.status !== "success")
          .map((r) => String(r.email ?? "").trim().toLowerCase())
          .filter(Boolean),
      );
      const failedStudents = validStudents.filter((student) =>
        failedEmails.has(student.email),
      );

      if (resultsArray.length === 0) {
        showFeedback("서버에서 처리 결과 데이터를 받지 못했습니다.", "warning");
      }

      setResult(
        resultsArray.map((r, i) => {
          const base = `${i + 1}. ${r.name || r.email || r.uid || "알 수 없는 사용자"}`;
          const fallbackSuccess = `✅ ${base} 생성 완료`;
          const fallbackError = `❌ ${base} 생성 실패`;
          const message = r.message?.trim();

          return {
            status: r.status === "success" ? "success" : "error",
            message: message
              ? `${r.status === "success" ? "✅" : "❌"} ${base} ${
                  r.status === "success" ? "성공" : `실패: ${message}`
                }`
              : r.status === "success"
                ? fallbackSuccess
                : fallbackError,
          };
        }),
      );

      if (failedStudents.length > 0) {
        showFeedback(
          "일부 학생 계정 생성에 실패했습니다. 실패한 학생만 입력칸에 남겼습니다.",
          "warning",
        );
      } else if (resultsArray.length > 0) {
        showFeedback("계정 생성 작업이 완료되었습니다.", "info");
      }

      if (resultsArray.length > 0) {
        setStudents(
          failedStudents.length > 0
            ? failedStudents
            : [
                {
                  name: "",
                  email: "",
                  password: "123456",
                  studentNumber: "",
                  gender: "",
                },
              ],
        );
      }
      setFileName("");
    } catch (err) {
      showFeedback(`계정 생성 중 오류: ${err.message}`, "error");
      setResult([
        { status: "error", message: `❌ 전체 처리 중 오류: ${err.message}` },
      ]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadSample = () => {
    const sampleData = [
      {
        학번: 1,
        이름: "김학생",
        이메일: "student1@example.com",
        비밀번호: "123456",
        성별: "남",
      },
      {
        학번: 2,
        이름: "이학생",
        이메일: "student2@example.com",
        비밀번호: "123456",
        성별: "여",
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "학생 목록");
    XLSX.writeFile(workbook, "학생등록_샘플.xlsx");
  };

  return {
    students,
    addRow,
    deleteRow,
    handleChange,
    fileName,
    fileInputRef,
    handleFileUpload,
    result,
    setResult, // 🌟 이 부분이 추가되어야 모달을 닫을 수 있습니다!
    isSubmitting,
    handleRegister,
    handleDownloadSample,
  };
};
