import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { auth } from "../../firebase";
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  CheckCircle2,
  ArrowRight,
  Mail,
  UserPlus,
  School,
  ArrowLeft,
  AlertTriangle,
  Lock, // 아이콘 추가
  AtSign, // 아이콘 추가
} from "lucide-react";
import { useFeedback } from "../../contexts/FeedbackContext";
import { Button, InputField, Spinner } from "../../components/ui";
import KakaoInquiryFab from "../../components/support/KakaoInquiryFab";
import { signInWithGoogleIdentity } from "../../services/googleIdentitySignIn";

const GoogleIcon = () => (
  <svg className="w-6 h-6" viewBox="0 0 24 24">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const normalizeSchoolName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s*(?:\uCD08\uB4F1\uD559\uAD50|\uCD08)+\s*$/u, "");

const buildClassDocId = ({ schoolName = "", grade = "", classNum = "" }) => {
  const normalizedSchoolName = normalizeSchoolName(schoolName);
  const normalizedGrade = String(grade || "").trim();
  const normalizedClassNum = String(classNum || "").trim();

  if (!normalizedSchoolName || !normalizedGrade || !normalizedClassNum) {
    return "";
  }

  return `${normalizedSchoolName}\uCD08 ${normalizedGrade}-${normalizedClassNum}`;
};

export default function TeacherSignup() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showFeedback } = useFeedback();
  const initialData = location.state || null;

  // 1. 상태 초기화
  const [step, setStep] = useState(() => {
    const savedStep = sessionStorage.getItem("signup_step");
    if (initialData?.isGoogleLogin) return "form";
    return savedStep || "select";
  });

  const [googleData, setGoogleData] = useState(() => {
    const savedData = sessionStorage.getItem("signup_google_data");
    if (initialData)
      return {
        uid: initialData.uid,
        email: initialData.email,
        name: initialData.name,
      };
    return savedData ? JSON.parse(savedData) : { uid: "", email: "", name: "" };
  });

  // 이메일 가입 전용 상태
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // 공통 폼 데이터
  const [name, setName] = useState(""); // 이름은 구글/이메일 공통 사용
  const [schoolName, setSchoolName] = useState("");
  const [grade, setGrade] = useState("");
  const [classNum, setClassNum] = useState("");

  const isProcessing = useRef(false);

  // 구글 데이터가 있으면 이름 자동 채움
  useEffect(() => {
    if (googleData.name) setName(googleData.name);
  }, [googleData]);

  // 상태 동기화 (구글 로그인 시에만 세션 사용)
  useEffect(() => {
    if (step === "form" && googleData.uid) {
      sessionStorage.setItem("signup_step", step);
      sessionStorage.setItem("signup_google_data", JSON.stringify(googleData));
    }
  }, [step, googleData]);

  const clearSession = () => {
    sessionStorage.removeItem("signup_step");
    sessionStorage.removeItem("signup_google_data");
  };

  // 리스너 방어 로직
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (isProcessing.current) return;
      if (user && step === "select" && !initialData) {
        signOut(auth);
      }
    });
    return () => unsubscribe();
  }, [step, initialData]);

  // 구글 로그인 핸들러
  const handleGoogleSignupStart = async () => {
    if (isLoading) return;
    setIsLoading(true);
    isProcessing.current = true;
    setError("");

    try {
      await signOut(auth);
      const result = await signInWithGoogleIdentity(auth);
      const user = result.user;

      const tempUser = {
        uid: user.uid,
        email: user.email,
        name: user.displayName || "",
      };

      sessionStorage.setItem("signup_step", "form");
      sessionStorage.setItem("signup_google_data", JSON.stringify(tempUser));

      setGoogleData(tempUser);
      setStep("form");

    } catch (err) {
      console.error(err);
      if (err.code !== "auth/popup-closed-by-user") {
        setError("인증 중 문제가 발생했습니다.");
      }
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        isProcessing.current = false;
      }, 500);
    }
  };

  // 이메일 가입 모드로 전환
  const handleEmailSignupStart = () => {
    clearSession();
    setGoogleData({ uid: "", email: "", name: "" }); // 구글 데이터 초기화
    setName(""); // 이름 초기화
    setStep("form");
  };

  const handleCancel = async () => {
    clearSession();
    setGoogleData({ uid: "", email: "", name: "" });
    setStep("select");
    setError("");
    await signOut(auth);
  };

  // ✅ 통합 제출 핸들러 (구글 vs 이메일 분기 처리)
  const handleFinalSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // 공통 유효성 검사
    if (!name || !schoolName || !grade || !classNum) {
      setError("필수 정보를 모두 입력해주세요.");
      return;
    }

    // 이메일 가입일 경우 추가 검사
    if (!googleData.uid) {
      if (!emailInput || !passwordInput) {
        setError("이메일과 비밀번호를 입력해주세요.");
        return;
      }
      if (passwordInput.length < 6) {
        setError("비밀번호는 6자 이상이어야 합니다.");
        return;
      }
    }

    setIsLoading(true);

    try {
      const classDocId = buildClassDocId({ schoolName, grade, classNum });

      if (googleData.uid) {
        const currentUser = auth.currentUser;
        const googleProviderIds = currentUser?.providerData?.map((item) => item.providerId) || [];
        const hasGoogleProvider = googleProviderIds.includes("google.com");

        if (!currentUser || currentUser.uid !== googleData.uid || !hasGoogleProvider) {
          clearSession();
          await signOut(auth).catch(() => undefined);
          setGoogleData({ uid: "", email: "", name: "" });
          setStep("select");
          setError("Google 인증 세션이 만료되었습니다. 다시 Google 계정으로 시작해 주세요.");
          return;
        }

        await currentUser.getIdToken(true);
      }

      const functions = getFunctions(undefined, "asia-northeast3");
      let successMessage = "가입이 완료되었습니다. 로그인해 주세요.";

      // 🔥 분기 처리: 구글 가입 vs 이메일 가입
      if (googleData.uid) {
        // [CASE 1] 구글 계정 연동 가입
        const registerGoogleTeacher = httpsCallable(
          functions,
          "registerGoogleTeacher",
        );
        await registerGoogleTeacher({
          uid: googleData.uid,
          email: googleData.email,
          name: name,
          classDocId,
          privacyAgreed: true,
        });
      } else {
        // [CASE 2] 이메일 신규 가입
        const requestTeacherAccount = httpsCallable(
          functions,
          "requestTeacherAccount",
        );
        await requestTeacherAccount({
          email: emailInput,
          password: passwordInput,
          name: name,
          classDocId,
          privacyAgreed: true,
        });

        // 이메일 가입 교사에 한해 인증 메일 발송
        let verificationEmailSent = false;
        try {
          const emailCredential = await signInWithEmailAndPassword(
            auth,
            emailInput.trim(),
            passwordInput,
          );
          await sendEmailVerification(emailCredential.user);
          verificationEmailSent = true;
        } catch (mailError) {
          console.error("Verification email send failed:", mailError);
        } finally {
          await signOut(auth).catch(() => undefined);
        }
        successMessage = verificationEmailSent
          ? "가입이 완료되었습니다. 인증 메일 확인 후 로그인해 주세요."
          : "가입이 완료되었습니다. 인증 메일 전송에 실패했습니다. 로그인 화면에서 인증 메일을 다시 요청해 주세요.";
      }

      clearSession();
      showFeedback(successMessage, "success");
      navigate("/login");
    } catch (err) {
      console.error("Signup Error:", err);
      // 에러 메시지 번역
      let msg = err.message || "가입 처리 중 오류가 발생했습니다.";
      if (
        err?.code === "functions/unauthenticated" ||
        msg.includes("unauthenticated")
      ) {
        msg = "Google 인증 세션이 만료되었습니다. 다시 Google 계정으로 시작해 주세요.";
      }
      if (
        msg.includes("already-exists") ||
        msg.includes("email-already-in-use")
      ) {
        msg = "이미 가입된 이메일입니다.";
      }
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_transparent_30%),linear-gradient(180deg,#f8fbff_0%,#eef4ff_42%,#f8fafc_100%)] p-4 pt-10">
      <KakaoInquiryFab />
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-md items-center justify-center">
        <div className="w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-4 shadow-lg shadow-blue-200">
            <UserPlus size={32} />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            선생님 회원가입
          </h1>
          <p className="text-slate-500 mt-2 text-sm font-medium">
            {step === "select"
              ? "간편하게 가입 방식을 선택하세요"
              : "가입 정보를 입력해주세요"}
          </p>
          <div
            role="alert"
            className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-amber-900"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-amber-600"
              size={20}
            />
            <p className="text-sm leading-6">
              <strong className="font-extrabold">학생은 이 화면에서 가입하지 마세요.</strong>
              <br />
              학생 계정은 선생님이 학급 관리에서 만들어 주세요.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/60 border border-slate-100 overflow-hidden">
          <div className="p-8">
            {error && (
              <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded-r flex items-start gap-2">
                <span>⚠️</span> {error}
              </div>
            )}

            {step === "select" ? (
              // Step 1: 방식 선택
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <Button variant="ghost" kind="ghost"
                  onClick={handleGoogleSignupStart}
                  disabled={isLoading}
                  className="w-full flex items-center gap-4 p-4 border-2 border-slate-100 rounded-2xl hover:border-blue-500 hover:bg-blue-50 transition-all bg-white group disabled:opacity-50"
                >
                  {isLoading ? (
                    <Spinner size="sm" tone="blue" containerClassName="gap-0" />
                  ) : (
                    <div className="group-hover:scale-110 transition-transform">
                      <GoogleIcon />
                    </div>
                  )}
                  <div className="flex-1 text-left">
                    <p className="font-bold text-slate-800 text-lg">
                      Google 계정으로 시작
                    </p>
                    <p className="text-xs text-slate-500">
                      학교 계정 사용을 권장합니다
                    </p>
                  </div>
                  <ArrowRight className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                </Button>

                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-slate-100"></div>
                  <span className="flex-shrink-0 mx-4 text-xs text-slate-400 font-medium">
                    또는
                  </span>
                  <div className="flex-grow border-t border-slate-100"></div>
                </div>

                <Button variant="ghost" kind="ghost"
                  onClick={handleEmailSignupStart}
                  className="w-full flex items-center gap-4 p-4 border-2 border-slate-100 rounded-2xl hover:border-slate-400 transition-all bg-white group"
                >
                  <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 group-hover:bg-slate-200 transition-colors">
                    <Mail size={20} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-bold text-slate-700">이메일로 가입</p>
                    <p className="text-xs text-slate-400">
                      아이디/비밀번호 직접 입력
                    </p>
                  </div>
                </Button>
              </div>
            ) : (
              // Step 2: 정보 입력 폼
              <form
                onSubmit={handleFinalSubmit}
                className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500"
              >
                {/* 구글 로그인된 경우: 이메일 표시 (수정 불가) */}
                {googleData.email ? (
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-center gap-4">
                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
                      <GoogleIcon />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                          인증됨
                        </span>
                      </div>
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {googleData.email}
                      </p>
                    </div>
                    <CheckCircle2 className="text-blue-500" size={20} />
                  </div>
                ) : (
                  // 이메일 가입인 경우: 이메일/비번 입력창 표시
                  <div className="space-y-4 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-500 mb-2">
                      계정 정보
                    </h3>
                    <div className="relative">
                      <AtSign
                        size={18}
                        className="absolute left-3 top-3.5 text-slate-400"
                      />
                      <input
                        type="email"
                        aria-label="이메일 주소"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="이메일 주소"
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-blue-200 focus:ring-2 focus:ring-blue-500 outline-none"
                        required
                      />
                    </div>
                    <div className="relative">
                      <Lock
                        size={18}
                        className="absolute left-3 top-3.5 text-slate-400"
                      />
                      <input
                        type="password"
                        aria-label="비밀번호 (6자 이상)"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="비밀번호 (6자 이상)"
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-blue-200 focus:ring-2 focus:ring-blue-500 outline-none"
                        required
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <InputField
                    label="성함"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="선생님 성함"
                    required
                  />

                  <div className="pt-2">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase mb-2 ml-1">
                      <School size={14} /> 학급 정보
                    </label>
                    <div className="space-y-3">
                      <InputField
                        label="학교명"
                        value={schoolName}
                        onChange={(e) => setSchoolName(e.target.value)}
                        placeholder="학교명 (예: 서울)"
                        required
                      />
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <InputField
                            type="number"
                            label="학년"
                            value={grade}
                            onChange={(e) => setGrade(e.target.value)}
                            placeholder="학년"
                            required
                          />
                        </div>
                        <div className="flex-1">
                          <InputField
                            type="number"
                            label="반"
                            value={classNum}
                            onChange={(e) => setClassNum(e.target.value)}
                            placeholder="반"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4 border-t border-slate-50">
                  <Button size="md" variant="ghost" kind="ghost"
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 transition flex items-center justify-center gap-2"
                  >
                    <ArrowLeft size={18} /> 이전
                  </Button>
                  <Button size="md" tone="blue" kind="solid"
                    type="submit"
                    disabled={isLoading}
                    className="flex-[2] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <Spinner size="current" color="current" containerClassName="gap-0" />
                    ) : (
                      "가입 신청 완료"
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-slate-600">
          이미 계정이 있으신가요?{" "}
          <Link to="/login" className="font-semibold text-blue-700 underline underline-offset-4">
            로그인
          </Link>
        </p>
        <p className="text-center text-xs text-slate-400 mt-8">
          &copy; {new Date().getFullYear()} FinClass. All rights reserved.
        </p>
      </div>
      </div>
    </div>
  );
}
