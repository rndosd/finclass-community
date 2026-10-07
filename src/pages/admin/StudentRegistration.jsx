import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useClassStudents } from "../../hooks/user/useClassStudents";
import { db } from "../../firebase";
import { doc, writeBatch } from "firebase/firestore";
import { useStudentRegistration } from "./hooks/useStudentRegistration";
import AppLayout from "../../components/layout/AppLayout";
import StudentNameEditor from "./components/StudentNameEditor";
import {
  Button,
  InputField,
  Alert,
  Card,
  Badge,
  PageHeader,
  Spinner,
  Tabs,
} from "../../components/ui";
import {
  UploadCloud,
  Plus,
  Trash2,
  Rocket,
  Users,
  Download,
  FileText,
  X, // 닫기 아이콘 추가
} from "lucide-react";

const normalizeGenderValue = (value) => {
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

/**
 * 🌟 계정 생성 결과 모달 컴포넌트
 * - 배경 클릭 시 닫힘
 * - Esc 키 입력 시 닫힘
 * - 배경 스크롤 방지
 * - 우측 상단 X 버튼 추가
 */
const RegistrationResultModal = ({ isOpen, onClose, results }) => {
  // 1. 배경 스크롤 방지 및 Esc 키 이벤트 등록
  useEffect(() => {
    if (!isOpen) return;

    // 스크롤 막기
    document.body.style.overflow = "hidden";

    // Esc 키 이벤트 핸들러
    const handleEsc = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);

    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !results || results.length === 0) return null;

  const errorCount = results.filter((r) => r.status === "error").length;
  const successCount = results.length - errorCount;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose} // 외부 영역 클릭 시 닫기
    >
      <Card
        className="w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()} // 카드 내부 클릭 시 닫힘 방지
      >
        {/* 헤더 부분 */}
        <div
          className={`p-6 border-b shrink-0 relative ${
            errorCount > 0 ? "bg-red-50" : "bg-emerald-50"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold text-slate-800">
              계정 생성 처리 결과
            </h2>
            <div className="flex items-center gap-2">
              <Badge
                color={errorCount > 0 ? "red" : "emerald"}
                variant="solid"
                size="lg"
              >
                총 {results.length}명 처리
              </Badge>
              {/* 우측 상단 X 버튼 */}
              <button
                onClick={onClose}
                className="p-1 rounded-full hover:bg-slate-200/50 transition-colors text-slate-500"
              >
                <X size={20} />
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            성공:{" "}
            <span className="font-bold text-emerald-600">{successCount}</span>명
            / 실패: <span className="font-bold text-red-600">{errorCount}</span>
            명
          </p>
        </div>

        {/* 결과 내역 (스크롤 영역) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-slate-50/30">
          {errorCount > 0 && (
            <div className="mb-4 p-4 bg-white border border-red-100 rounded-xl shadow-sm text-sm text-red-700 font-medium italic">
              ⚠️ 실패한 항목은 이메일 중복이나 데이터 형식을 다시 확인해 주세요.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            {results.map((line, idx) => (
              <Alert
                key={idx}
                variant={line.status === "error" ? "destructive" : "success"}
                message={line.message}
                className="text-xs border-none shadow-sm"
              />
            ))}
          </div>
        </div>

        {/* 푸터 */}
        <div className="p-4 border-t bg-white flex justify-end shrink-0 gap-2">
          <Button size="md" tone="slate" onClick={onClose} >
            확인
          </Button>
        </div>
      </Card>
    </div>
  );
};

const RegistrationLoadingModal = ({ isOpen, totalCount }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className="w-full max-w-md shadow-2xl border border-indigo-100 bg-white animate-in zoom-in-95 duration-200">
        <Card.Content noPadding>
          <div className="flex flex-col items-center text-center py-4">
            <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <Spinner tone="indigo" />
            </div>
            <h3 className="text-lg font-bold text-slate-800">
              학생 계정 생성 중입니다
            </h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              {totalCount}명 계정을 순차 처리하고 있어요.
              <br />
              잠시만 기다려 주세요.
            </p>
            <div className="mt-4 w-full rounded-full bg-slate-100 p-1">
              <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 animate-pulse" />
            </div>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
};

export default function StudentRegistration() {
  const [searchParams] = useSearchParams();
  const { userData, classId } = useUser();
  const { showFeedback } = useFeedback();
  const { data: studentList = [] } = useClassStudents(classId, {
    enabled: !!classId,
    realtime: true,
  });
  const {
    students,
    addRow,
    deleteRow,
    handleChange,
    fileName,
    fileInputRef,
    handleFileUpload,
    result,
    setResult,
    isSubmitting,
    handleRegister,
    handleDownloadSample,
  } = useStudentRegistration();

  const classIdForRegistration = classId || userData?.classId;
  const validStudentsCount = students.filter((s) => s.name && s.email).length;
  const [existingGenderDraft, setExistingGenderDraft] = useState({});
  const [isSavingExistingGender, setIsSavingExistingGender] = useState(false);
  const [activeTab, setActiveTab] = useState(() => searchParams.get("tab") === "existing" ? "existing" : "register");

  const existingStudents = useMemo(() => {
    return [...(studentList || [])]
      .filter((student) => student?.role === "student")
      .sort((a, b) => Number(a?.studentNumber || 0) - Number(b?.studentNumber || 0));
  }, [studentList]);

  useEffect(() => {
    const nextDraft = {};
    existingStudents.forEach((student) => {
      nextDraft[student.uid] = normalizeGenderValue(student.gender);
    });
    setExistingGenderDraft(nextDraft);
  }, [existingStudents]);

  const changedExistingGenderStudents = useMemo(() => {
    return existingStudents.filter((student) => {
      const current = normalizeGenderValue(student.gender);
      const draft = existingGenderDraft[student.uid] ?? "";
      return current !== draft;
    });
  }, [existingGenderDraft, existingStudents]);

  const registrationTabs = useMemo(() => {
    const changedCount = changedExistingGenderStudents.length;
    return [
      { id: "register", label: "신규 계정 등록", icon: FileText },
      {
        id: "existing",
        label: "기존 학생 관리",
        icon: Users,
        badge: changedCount > 0 ? String(changedCount) : undefined,
      },
    ];
  }, [changedExistingGenderStudents.length]);

  const handleExistingGenderChange = (uid, value) => {
    setExistingGenderDraft((prev) => ({
      ...prev,
      [uid]: normalizeGenderValue(value),
    }));
  };

  const handleSaveExistingGender = async () => {
    if (!classIdForRegistration) {
      showFeedback("학급 정보를 찾을 수 없습니다.", "error");
      return;
    }

    if (changedExistingGenderStudents.length === 0) {
      showFeedback("저장할 변경사항이 없습니다.", "info");
      return;
    }

    setIsSavingExistingGender(true);
    try {
      const batch = writeBatch(db);
      changedExistingGenderStudents.forEach((student) => {
        const nextGender = existingGenderDraft[student.uid] || null;
        batch.update(doc(db, `classes/${classIdForRegistration}/students/${student.uid}`), {
          gender: nextGender,
        });
      });

      await batch.commit();
      showFeedback(
        `${changedExistingGenderStudents.length}명의 성별 정보를 저장했습니다.`,
        "success",
      );
    } catch (error) {
      console.error("기존 학생 성별 저장 실패:", error);
      showFeedback("성별 정보 저장 중 오류가 발생했습니다.", "error");
    } finally {
      setIsSavingExistingGender(false);
    }
  };

  const studentRegistrationQuestGuide = useMemo(
    () => ({
      type: "quest",
      title: "학생 등록 도우미",
      launcherTitle: "학생 등록 도우미",
      launcherDescription: "엑셀 등록, 직접 입력, 기존 학생 관리 흐름을 체크합니다.",
      subtitle: "경제 교실을 시작하기 위한 학생 계정 등록 흐름을 확인합니다.",
      storageKey: classIdForRegistration
        ? `finclass_student_registration_quest_${classIdForRegistration}`
        : "finclass_student_registration_quest",
      tourKey: "ADMIN_STUDENT_REGISTRATION_QUEST_TOUR",
      guidePath: "/case-library",
      quests: [
        {
          id: "choose-registration-method",
          title: "학생 등록 방식 고르기",
          description: "엑셀 업로드와 직접 입력 중 지금 반에 맞는 등록 방식을 하나 선택합니다.",
          completed: Boolean(fileName) || validStudentsCount > 0 || result.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "file-selected",
              label: "엑셀 파일을 선택했거나",
              completed: Boolean(fileName),
            },
            {
              id: "manual-valid-count",
              label: "직접 입력으로 학생 1명 이상을 준비했습니다.",
              completed: validStudentsCount > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="student-method1-full"]',
              title: "엑셀 등록",
              content: "학생 명단이 많다면 샘플 파일을 내려받아 한 번에 업로드합니다.",
            },
            {
              target: '[data-tour="student-method2-full"]',
              title: "직접 입력",
              content: "학생 수가 적거나 바로 추가할 때는 직접 입력으로 시작합니다.",
            },
            {
              target: '[data-tour="student-add-row"]',
              title: "학생 행 추가",
              content: "필요한 만큼 입력 행을 추가합니다.",
            },
          ],
        },
        {
          id: "submit-registration",
          title: "계정 생성 버튼 확인하기",
          description: "입력한 학생 계정을 실제로 생성하는 최종 버튼을 확인합니다.",
          completed: result.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "registration-result",
              label: "등록 결과 확인",
              completed: result.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="student-submit-full"]',
              title: "등록 제출",
              content: "입력 내용을 확인하고 계정 생성을 실행합니다.",
            },
            {
              target: '[data-tour="student-register-submit"]',
              title: "최종 등록 버튼",
              content: "이 버튼이 실제 계정 생성을 시작합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "existing-students",
          title: "기존 학생 관리 확인하기",
          description: "이미 등록된 학생 정보와 성별 값을 관리할 수 있습니다.",
          completed: activeTab === "existing" || existingStudents.length > 0,
          manualComplete: true,
          objectives: [
            {
              id: "existing-open",
              label: "기존 학생 관리 탭 열기",
              completed: activeTab === "existing",
            },
            {
              id: "existing-count",
              label: "기존 학생 목록 확인",
              completed: existingStudents.length > 0,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="student-method2-full"]',
              title: "기존 학생 관리",
              content: "탭을 전환해 이미 등록된 학생 정보를 확인합니다.",
            },
          ],
        },
      ],
    }),
    [
      activeTab,
      classIdForRegistration,
      existingStudents.length,
      fileName,
      result.length,
      validStudentsCount,
    ],
  );

  return (
    <AppLayout title="" pageGuide={studentRegistrationQuestGuide}>
      {/* 🌟 결과 모달 (완성형) */}
      <RegistrationResultModal
        isOpen={result.length > 0}
        onClose={() => setResult([])}
        results={result}
      />
      <RegistrationLoadingModal
        isOpen={isSubmitting}
        totalCount={validStudentsCount}
      />

      <div className="min-h-screen p-4 sm:p-6 lg:p-8 space-y-6 bg-[#f0f5ff]">
        <PageHeader
          title="학생 계정 일괄 등록"
          subtitle="엑셀(.xlsx) 업로드 또는 직접 입력으로 계정을 생성하세요. 성별은 선택 입력입니다."
          icon={Users}
          rightSlot={
            <Badge color="indigo" variant="soft" size="lg">
              {activeTab === "register"
                ? `${students.length}명 입력됨`
                : `${existingStudents.length}명 등록됨`}
            </Badge>
          }
        />
        <Tabs
          tabs={registrationTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          variant="underline"
          size="md"
          className="inline-block w-fit max-w-full"
        />

        {activeTab === "register" && (
          <>
            {/* 방법 1: 파일 업로드 섹션 */}
            <Card
              tone="white"
              variant="surface"
              icon={UploadCloud}
              title="방법 1. 엑셀 파일로 간편하게 등록"
            >
              <Card.Content noPadding>
                <div data-tour="student-method1-full" className="flex flex-wrap items-center gap-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFileUpload}
                    disabled={isSubmitting}
                    className="hidden"
                  />
                  <Button
                    data-tour="student-file-select"
                    tone="lightBlue"
                    kind="soft"
                    icon={UploadCloud}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSubmitting}
                  >
                    엑셀 파일 선택
                  </Button>

                  {fileName && (
                    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                      <FileText className="h-4 w-4 text-slate-500" />
                      <span className="text-sm text-slate-600 truncate max-w-[200px] font-medium">
                        {fileName}
                      </span>
                    </div>
                  )}

                  <Button
                    tone="slate"
                    kind="ghost"
                    size="sm"
                    icon={Download}
                    onClick={handleDownloadSample}
                    className="ml-auto"
                  >
                    샘플 양식 다운로드
                  </Button>
                </div>
              </Card.Content>
            </Card>

            {/* 방법 2: 학생 정보 직접 입력 테이블 */}
            <Card
              tone="slate"
              variant="surface"
              icon={FileText}
              title="방법 2. 직접 정보 입력하기"
            >
              <Card.Content noPadding>
                <div
                  data-tour="student-method2-full"
                  className="space-y-3 p-4 md:hidden"
                >
                  {students.length === 0 ? (
                    <div className="flex min-h-52 flex-col items-center justify-center text-center">
                      <Users className="mb-3 h-12 w-12 text-slate-300" />
                      <p className="text-sm font-medium text-slate-500">
                        입력된 학생 정보가 없습니다.
                      </p>
                    </div>
                  ) : (
                    students.map((student, index) => (
                      <section
                        key={index}
                        data-tour={index === 0 ? "student-input-row" : undefined}
                        className={`rounded-2xl border p-4 ${
                          student.name && student.email
                            ? "border-emerald-200 bg-emerald-50/40"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-slate-400">
                              학생 {String(index + 1).padStart(2, "0")}
                            </p>
                            <p className="mt-0.5 text-sm font-bold text-slate-700">
                              {student.name || "정보를 입력해 주세요"}
                            </p>
                          </div>
                          <Button
                            tone="red"
                            kind="ghost"
                            size="sm"
                            icon={Trash2}
                            onClick={() => deleteRow(index)}
                            disabled={isSubmitting || students.length === 1}
                            className="min-w-11"
                            aria-label={`${index + 1}번째 학생 삭제`}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold text-slate-500">
                              학번
                            </span>
                            <InputField
                              value={student.studentNumber}
                              placeholder="예: 1"
                              onChange={(event) =>
                                handleChange(
                                  index,
                                  "studentNumber",
                                  event.target.value,
                                )
                              }
                              disabled={isSubmitting}
                              size="sm"
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold text-slate-500">
                              이름
                            </span>
                            <InputField
                              value={student.name}
                              placeholder="이름"
                              onChange={(event) =>
                                handleChange(index, "name", event.target.value)
                              }
                              disabled={isSubmitting}
                              size="sm"
                            />
                          </label>
                          <label className="col-span-2 space-y-1.5">
                            <span className="text-xs font-semibold text-slate-500">
                              이메일 아이디
                            </span>
                            <InputField
                              type="email"
                              value={student.email}
                              placeholder="student@example.com"
                              onChange={(event) =>
                                handleChange(index, "email", event.target.value)
                              }
                              disabled={isSubmitting}
                              size="sm"
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold text-slate-500">
                              초기 비밀번호
                            </span>
                            <InputField
                              value={student.password}
                              placeholder="초기 비밀번호"
                              onChange={(event) =>
                                handleChange(index, "password", event.target.value)
                              }
                              disabled={isSubmitting}
                              size="sm"
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold text-slate-500">
                              성별
                            </span>
                            <select
                              value={student.gender || ""}
                              onChange={(event) =>
                                handleChange(index, "gender", event.target.value)
                              }
                              disabled={isSubmitting}
                              className="h-11 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            >
                              <option value="">미입력</option>
                              <option value="male">남</option>
                              <option value="female">여</option>
                            </select>
                          </label>
                        </div>
                      </section>
                    ))
                  )}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm min-w-[920px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-slate-700 text-left">
                        <th className="p-4 w-16 text-center font-bold">번호</th>
                        <th className="p-4 w-32 font-bold">학번(숫자)</th>
                        <th className="p-4 w-32 font-bold">이름</th>
                        <th className="p-4 flex-1 font-bold">이메일(아이디)</th>
                        <th className="p-4 w-32 font-bold">비밀번호</th>
                        <th className="p-4 w-28 font-bold">성별(선택)</th>
                        <th className="p-4 w-24 text-center font-bold">삭제</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {students.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-16 text-center">
                            <div className="flex flex-col items-center justify-center opacity-40">
                              <Users className="h-16 w-16 text-slate-300 mb-4" />
                              <p className="text-slate-500 text-lg font-medium">
                                입력된 학생 정보가 없습니다
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        students.map((s, i) => (
                          <tr
                            key={i}
                            data-tour={i === 0 ? "student-input-row" : undefined}
                            className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                              s.name && s.email ? "bg-emerald-50/30" : ""
                            }`}
                          >
                            <td className="p-4 text-center text-slate-400 font-mono font-medium">
                              {String(i + 1).padStart(2, "0")}
                            </td>
                            <td className="p-3">
                              <InputField
                                value={s.studentNumber}
                                aria-label={`${i + 1}번째 학생 학번`}
                                placeholder="예: 1"
                                onChange={(e) =>
                                  handleChange(i, "studentNumber", e.target.value)
                                }
                                disabled={isSubmitting}
                                size="sm"
                                className="text-center"
                              />
                            </td>
                            <td className="p-3">
                              <InputField
                                value={s.name}
                                aria-label={`${i + 1}번째 학생 이름`}
                                placeholder="이름"
                                onChange={(e) => handleChange(i, "name", e.target.value)}
                                disabled={isSubmitting}
                                size="sm"
                              />
                            </td>
                            <td className="p-3">
                              <InputField
                                type="email"
                                value={s.email}
                                aria-label={`${i + 1}번째 학생 이메일`}
                                placeholder="student@example.com"
                                onChange={(e) => handleChange(i, "email", e.target.value)}
                                disabled={isSubmitting}
                                size="sm"
                              />
                            </td>
                            <td className="p-3">
                              <InputField
                                value={s.password}
                                aria-label={`${i + 1}번째 학생 초기 비밀번호`}
                                placeholder="초기 비번"
                                onChange={(e) =>
                                  handleChange(i, "password", e.target.value)
                                }
                                disabled={isSubmitting}
                                size="sm"
                              />
                            </td>
                            <td className="p-3">
                              <select
                                value={s.gender || ""}
                                aria-label={`${i + 1}번째 학생 성별`}
                                onChange={(e) =>
                                  handleChange(i, "gender", e.target.value)
                                }
                                disabled={isSubmitting}
                                className="w-full h-9 px-3 rounded-xl border border-blue-200 bg-blue-50/50 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                              >
                                <option value="">미입력</option>
                                <option value="male">남</option>
                                <option value="female">여</option>
                              </select>
                            </td>
                            <td className="p-3 text-center">
                              <Button
                                tone="red"
                                kind="ghost"
                                size="sm"
                                icon={Trash2}
                                onClick={() => deleteRow(i)}
                                aria-label={`${i + 1}번째 학생 삭제`}
                                disabled={isSubmitting || students.length === 1}
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card.Content>
              {/* 요약 바 */}
              {students.length > 0 && (
                <div className="px-6 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-xs font-medium text-slate-500">
                  <div className="flex items-center gap-4">
                    <span>
                      총 <strong className="text-slate-700">{students.length}</strong>개 행
                    </span>
                    <span className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      생성 가능:{" "}
                      <strong className="text-emerald-600">{validStudentsCount}</strong>명
                    </span>
                  </div>
                </div>
              )}
            </Card>

            {/* 하단 액션 바 */}
            <Card tone="white" variant="surface">
              <Card.Content noPadding>
                <div data-tour="student-submit-full" className="flex flex-wrap gap-4 items-center justify-between">
                  <Button size="md"
                    data-tour="student-add-row"
                    tone="slate"
                    kind="outline"
                    icon={Plus}
                    onClick={addRow}
                    disabled={isSubmitting}
                    
                  >
                    새로운 행 추가
                  </Button>

                  <div className="flex items-center gap-4">
                    {validStudentsCount > 0 && (
                      <p className="text-sm font-bold text-emerald-600 animate-pulse hidden sm:block">
                        {validStudentsCount}명의 계정을 생성할 준비가 되었습니다!
                      </p>
                    )}
                    <Button
                      data-tour="student-register-submit"
                      icon={Rocket}
                      tone="blue"
                      onClick={() => handleRegister(classIdForRegistration)}
                      isLoading={isSubmitting}
                      disabled={isSubmitting || validStudentsCount === 0}
                      size="lg"
                      
                    >
                      계정 만들기
                    </Button>
                  </div>
                </div>
              </Card.Content>
            </Card>
          </>
        )}

        {activeTab === "existing" && (
          <Card
            tone="slate"
            variant="surface"
            icon={Users}
            title="기존 학생 정보 관리"
          >
            <Card.Content noPadding>
              <div className="mb-3 text-xs text-slate-500">
                성별 정보는 선택 항목입니다. 비워두면 미입력으로 저장됩니다.
              </div>

              <div className="space-y-3 md:hidden">
                {existingStudents.length === 0 ? (
                  <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-400">
                    등록된 학생이 없습니다.
                  </div>
                ) : (
                  existingStudents.map((student) => (
                    <section
                      key={student.uid}
                      className="rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <div className="mb-4 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge color="slate" variant="soft" size="sm">
                            {student.studentNumber || "학번 없음"}
                          </Badge>
                          <StudentNameEditor key={`${classIdForRegistration}-${student.uid}`} student={student} classId={classIdForRegistration} />
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {student.email || "-"}
                        </p>
                      </div>
                      <label className="block space-y-1.5">
                        <span className="text-xs font-semibold text-slate-500">
                          성별
                        </span>
                        <select
                          value={existingGenderDraft[student.uid] ?? ""}
                          onChange={(event) =>
                            handleExistingGenderChange(student.uid, event.target.value)
                          }
                          disabled={isSavingExistingGender}
                          className="h-11 w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="">미입력</option>
                          <option value="male">남</option>
                          <option value="female">여</option>
                        </select>
                      </label>
                    </section>
                  ))
                )}
              </div>

              <div className="hidden overflow-x-auto rounded-xl border border-slate-100 md:block">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr className="text-slate-600 text-left">
                      <th className="p-3 w-20 text-center">학번</th>
                      <th className="p-3 w-44">이름</th>
                      <th className="p-3">이메일</th>
                      <th className="p-3 w-36">성별(선택)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 bg-white">
                    {existingStudents.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-400">
                          등록된 학생이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      existingStudents.map((student) => (
                        <tr key={student.uid}>
                          <td className="p-3 text-center text-slate-500 font-medium">
                            {student.studentNumber || "-"}
                          </td>
                          <td className="p-3 font-semibold text-slate-700">
                            <StudentNameEditor key={`${classIdForRegistration}-${student.uid}`} student={student} classId={classIdForRegistration} />
                          </td>
                          <td className="p-3 text-slate-500">
                            {student.email || "-"}
                          </td>
                          <td className="p-3">
                            <select
                              value={existingGenderDraft[student.uid] ?? ""}
                              onChange={(e) =>
                                handleExistingGenderChange(student.uid, e.target.value)
                              }
                              disabled={isSavingExistingGender}
                              className="w-full h-9 px-3 rounded-xl border border-blue-200 bg-blue-50/50 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            >
                              <option value="">미입력</option>
                              <option value="male">남</option>
                              <option value="female">여</option>
                            </select>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs font-medium text-slate-500">
                  변경됨:{" "}
                  <strong className="text-indigo-600">
                    {changedExistingGenderStudents.length}
                  </strong>
                  명
                </span>
                <Button
                  tone="blue"
                  kind="solid"
                  size="sm"
                  onClick={handleSaveExistingGender}
                  isLoading={isSavingExistingGender}
                  disabled={
                    isSavingExistingGender || changedExistingGenderStudents.length === 0
                  }
                  className="w-full sm:w-auto"
                >
                  기존 학생 성별 저장
                </Button>
              </div>
            </Card.Content>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
