import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { auth, db } from "../../firebase";
import { doc, getDoc } from "firebase/firestore";
import {
  Shield,
  AlertCircle,
  UserPlus,
  ArrowLeft,
  Menu,
  X,
  LogIn,
} from "lucide-react";
import Button from "../../components/ui/Button";
import IconButton from "../../components/ui/IconButton";
import { useFeedback } from "../../contexts/FeedbackContext"; // ✅ 토스트 알림 훅
import KakaoInquiryFab from "../../components/support/KakaoInquiryFab";
import { signInWithGoogleIdentity } from "../../services/googleIdentitySignIn";

// 구글 아이콘 (SVG)
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
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

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // ✅ 1. 상태 초기화: 세션 스토리지에서 값 복구 (새로고침/리렌더링 방어)
  const [unregisteredGoogleUser, setUnregisteredGoogleUser] = useState(() => {
    const saved = sessionStorage.getItem("temp_unregistered_user");
    return saved ? JSON.parse(saved) : null;
  });

  const navigate = useNavigate();
  const { showFeedback } = useFeedback(); // ✅ 토스트 알림 사용

  // 유저 상태 확인 및 라우팅 로직
  // Login.jsx 내부의 checkUserAndNavigate 수정

  const checkUserAndNavigate = async (user, loginMethod) => {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));

      // (1) DB에 유저가 없는 경우 (미가입) - 이 로직은 유지
      if (!userDoc.exists()) {
        if (loginMethod === "google") {
          const tempUser = { uid: user.uid, email: user.email, name: user.displayName };
          sessionStorage.setItem("temp_unregistered_user", JSON.stringify(tempUser));
          setUnregisteredGoogleUser(tempUser);
          // Keep Google auth alive so teacher signup can call authenticated Cloud Functions.
          showFeedback("등록되지 않은 계정입니다. 회원가입을 진행해주세요.", "info");
          return;
        } else {
          await signOut(auth);
          setError("가입되지 않은 계정입니다.");
          return;
        }
      }

      const userData = userDoc.data();

      // (2) 교사 이메일 가입은 인증 완료 후 로그인 허용
      const requireEmailVerificationForLogin =
        userData.role === "teacher" &&
        loginMethod === "email" &&
        userData.emailVerificationRequired === true;
      if (
        requireEmailVerificationForLogin &&
        user.emailVerified !== true
      ) {
        try {
          await sendEmailVerification(user);
        } catch (mailError) {
          console.warn("Verification email resend failed:", mailError);
        }
        await signOut(auth);
        setError(
          "이메일 인증 후 로그인해 주세요. 인증 메일을 다시 보냈습니다.",
        );
        showFeedback(
          "이메일 인증 후 로그인해 주세요. 인증 메일을 다시 보냈습니다.",
          "warning",
        );
        return;
      }

      // (3) 레거시 pending 계정 보호
      if (userData.status === "pending") {
        await signOut(auth);
        setError("계정 설정이 진행 중입니다. 잠시 후 다시 시도해 주세요.");
        showFeedback("계정 설정이 진행 중입니다. 잠시 후 다시 시도해 주세요.", "warning");
        return;
      }

      // (4) 🌟 성공 시: 아무것도 하지 않습니다! 
      // App.js의 <Navigate /> 로직이 이 역할을 대신 수행하여 훨씬 부드럽게 넘어갑니다.
      sessionStorage.removeItem("temp_unregistered_user");
      showFeedback(`${userData.name || "회원"}님 환영합니다!`, "success");

    } catch (err) {
      console.error("Login Check Error:", err);
      setError("오류가 발생했습니다.");
      await signOut(auth);
    }
  };

  // 이메일 로그인 핸들러
  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setUnregisteredGoogleUser(null);
    sessionStorage.removeItem("temp_unregistered_user");
    setIsLoading(true); // 🚀 로딩 시작

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );

      // 이 시점에서 Firebase Auth 인증은 성공했습니다. 
      // 이제 DB 데이터를 체크하러 갑니다.
      await checkUserAndNavigate(userCredential.user, "email");

      // 🌟 성공 시에는 setIsLoading(false)를 하지 않습니다!
      // App.js가 userLoading을 감지해서 전체 화면 스피너를 띄울 때까지 
      // 로그인 버튼은 계속 '로딩 중' 상태를 유지해야 화면이 부드럽습니다.

    } catch (err) {
      // ❌ 에러가 발생했을 때만 로딩을 풀어줍니다.
      setIsLoading(false);

      let msg = "로그인 중 문제가 발생했습니다.";
      if (
        err.code === "auth/user-not-found" ||
        err.code === "auth/wrong-password" ||
        err.code === "auth/invalid-credential" ||
        err.code === "auth/invalid-login-credentials"
      ) {
        msg = "아이디가 없거나 비밀번호가 올바르지 않습니다.";
      } else if (err.code === "auth/too-many-requests") {
        msg = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.";
      }

      setError(msg);
      showFeedback(msg, "error");
    }
    // finally { setIsLoading(false); } // 👈 이 줄을 반드시 삭제하거나 주석 처리하세요!
  };

  // 구글 로그인 핸들러
  const handleGoogleLogin = async () => {
    setError("");
    setUnregisteredGoogleUser(null);
    sessionStorage.removeItem("temp_unregistered_user");
    setIsGoogleLoading(true); // 🚀 로딩 시작

    try {
      const result = await signInWithGoogleIdentity(auth);

      // 팝업이 닫히고 인증에 성공했습니다. 
      // 이제 DB에서 유저 정보를 확인하고 이동할 때까지 대기합니다.
      await checkUserAndNavigate(result.user, "google");

      // 🌟 성공 시에는 setIsGoogleLoading(false)를 하지 않습니다.
      // 페이지가 대시보드로 완전히 전환될 때까지 버튼은 '로딩 중'이어야 부드럽습니다.

    } catch (error) {
      // ❌ 에러 발생 시(또는 팝업을 그냥 닫았을 때) 로딩을 해제합니다.
      setIsGoogleLoading(false);

      console.error("Google Login Error:", error);
      if (
        error.code !== "auth/popup-closed-by-user" &&
        error.code !== "auth/cancelled-popup-request"
      ) {
        setError("구글 로그인 중 문제가 발생했습니다.");
        showFeedback("구글 로그인에 실패했습니다.", "error");
      }
    }
    // finally { setIsGoogleLoading(false); } // 👈 삭제하세요!
  };

  // 회원가입 페이지로 이동 (데이터 전달)
  const handleGoToSignup = () => {
    const userData = unregisteredGoogleUser;
    sessionStorage.removeItem("temp_unregistered_user");

    navigate("/signup/teacher", {
      state: {
        isGoogleLogin: true,
        uid: userData.uid,
        email: userData.email,
        name: userData.name,
        fromLogin: true,
      },
    });
  };

  // 다른 계정으로 로그인 (초기화)
  const handleExit = async () => {
    await signOut(auth);
    sessionStorage.removeItem("temp_unregistered_user");
    setUnregisteredGoogleUser(null);
  };

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_transparent_30%),linear-gradient(180deg,#f8fbff_0%,#eef4ff_42%,#f8fafc_100%)] font-sans text-slate-800">
      <KakaoInquiryFab />
      {/* =========================================
          1. GNB (네비게이션 바)
      ========================================= */}
      <nav className="fixed top-0 z-50 w-full border-b border-white/60 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* 로고 */}
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
              F
            </div>
            <span className="text-xl font-bold text-slate-900">Finclass</span>
          </Link>

          {/* 데스크탑 버튼 */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              to="/signup/teacher"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-full transition shadow-lg shadow-blue-200"
            >
              회원가입
            </Link>
          </div>

          {/* 모바일 메뉴 버튼 */}
          <div className="md:hidden flex items-center">
            <IconButton
              label={isMobileMenuOpen ? "Close menu" : "Open menu"}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-slate-600"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </IconButton>
          </div>
        </div>

        {/* 모바일 메뉴 드롭다운 */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-100 p-4 flex flex-col gap-4 shadow-xl">
            <Link
              to="/signup/teacher"
              className="w-full text-center px-5 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              회원가입
            </Link>
          </div>
        )}
      </nav>

      {/* =========================================
          2. 메인 컨텐츠 영역
      ========================================= */}
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-4 pt-20">
        {/* 배경 블러 효과 */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-[20%] right-[10%] w-[40%] h-[40%] bg-blue-100 rounded-full blur-3xl opacity-40"></div>
          <div className="absolute bottom-[10%] left-[10%] w-[40%] h-[40%] bg-indigo-100 rounded-full blur-3xl opacity-40"></div>
        </div>

        <div className="w-full max-w-[400px] relative z-10">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              로그인
            </h1>
            <p className="text-slate-500 mt-2 text-sm">
              오늘도 즐거운 금융 생활을 시작해봐요!
            </p>
          </div>

          {/* 조건부 렌더링: 미가입 구글 유저 안내 vs 로그인 폼 */}
          {unregisteredGoogleUser ? (
            <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden animate-fade-in-up">
              <div className="p-8">
                <div className="flex flex-col items-center mb-6 text-center">
                  <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mb-4">
                    <AlertCircle size={32} />
                  </div>
                  <h2 className="text-xl font-bold text-slate-800">
                    등록되지 않은 계정입니다
                  </h2>
                  <p className="text-slate-500 text-sm mt-1 break-all px-4">
                    {unregisteredGoogleUser.email}
                  </p>
                </div>

                <div className="bg-slate-50 rounded-xl p-5 space-y-4 text-sm mb-6 border border-slate-100">
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-600 font-bold text-xs mt-0.5">
                      T
                    </span>
                    <p className="text-slate-700 leading-snug">
                      <span className="font-bold text-slate-900">선생님</span>
                      이시라면
                      <br />
                      아래 버튼을 눌러 가입을 진행해주세요.
                    </p>
                  </div>
                  <div className="w-full h-px bg-slate-200"></div>
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 font-bold text-xs mt-0.5">
                      S
                    </span>
                    <p className="text-slate-700 leading-snug">
                      <span className="font-bold text-slate-900">학생</span>
                      이라면
                      <br />
                      선생님께 계정 생성을 요청해주세요.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <Button tone="blue" kind="solid" size="md"
                    onClick={handleGoToSignup}
                    className="w-full transition flex items-center justify-center gap-2"
                  >
                    <UserPlus size={18} />
                    선생님으로 회원가입 하기
                  </Button>
                  <Button size="md"
                    variant="outline"
                    kind="outline"
                    onClick={handleExit}
                    className="w-full transition flex items-center justify-center gap-2"
                  >
                    <ArrowLeft size={18} />
                    다른 계정으로 로그인
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
              <div className="p-8">
                <div className="flex items-center gap-2 mb-6">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <Shield size={20} />
                  </div>
                  <h2 className="text-xl font-bold text-slate-800">
                    계정 정보 입력
                  </h2>
                </div>

                {error && (
                  <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded-r animate-fade-in flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
                    <span className="font-medium">{error}</span>
                  </div>
                )}

                <form onSubmit={handleLogin} className="space-y-5">
                  <div>
                    <label
                      htmlFor="email"
                      className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1"
                    >
                      이메일
                    </label>
                    <input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      className="w-full px-4 py-3 rounded-xl border border-blue-200 bg-slate-50 text-slate-800 focus:bg-blue-50/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="relative">
                    <label
                      htmlFor="password"
                      className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1"
                    >
                      비밀번호
                    </label>
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="w-full px-4 py-3 rounded-xl border border-blue-200 bg-slate-50 text-slate-800 focus:bg-blue-50/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <Button
                      variant="ghost"
                      kind="ghost"
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-[34px] p-1 text-slate-400 hover:text-blue-600 transition-colors"
                      tabIndex={-1}
                    >
                      <span className="text-xs font-medium">
                        {showPassword ? "숨기기" : "보기"}
                      </span>
                    </Button>
                  </div>

                  <Button
                    type="submit"
                    isLoading={isLoading}
                    loadingText={"\uB85C\uADF8\uC778 \uC911..."}
                    kind="solid"
                    tone="blue"
                    size="lg"
                    icon={LogIn}
                    className="w-full"
                  >
                    {"\uC774\uBA54\uC77C\uB85C \uB85C\uADF8\uC778"}
                    {/*
                    이메일로 로그인
                    */}
                  </Button>
                </form>

                <div className="relative flex py-6 items-center">
                  <div className="flex-grow border-t border-slate-100"></div>
                  <span className="flex-shrink-0 mx-4 text-xs text-slate-400 font-medium">
                    소셜 계정으로 계속하기
                  </span>
                  <div className="flex-grow border-t border-slate-100"></div>
                </div>

                <Button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isLoading}
                  isLoading={isGoogleLoading}
                  loadingText={"\uB85C\uADF8\uC778 \uC911..."}
                  variant="outline"
                  tone="slate"
                  size="lg"
                  className="w-full"
                >
                  <GoogleIcon />
                  {"Google \uACC4\uC815\uC73C\uB85C \uB85C\uADF8\uC778"}
                  {/*
                    <div className="group-hover:scale-110 transition-transform">
                      <GoogleIcon />
                    </div>
                  )}
                  {isGoogleLoading ? "로그인 중..." : "Google 계정으로 로그인"}
                  */}
                </Button>
              </div>

              <div className="bg-slate-50 px-8 py-5 border-t border-slate-100 text-center">
                <p className="text-sm text-slate-500">
                  계정이 없으신가요?{" "}
                  <Link
                    to="/signup/teacher"
                    className="font-bold text-blue-600 hover:text-blue-700 hover:underline transition-colors ml-1"
                  >
                    선생님 계정 만들기
                  </Link>
                </p>
              </div>
            </div>
          )}

          <p className="mt-8 text-center text-xs text-slate-400">
            &copy; {new Date().getFullYear()} FinClass. Education purpose only.
          </p>
        </div>
      </div>
    </div>
  );
}
