import { appConfirm } from "../../utils/appDialogs";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Trash2, ArrowLeft, ShieldAlert } from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import { Button } from "../../components/ui";
import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../../firebase";
import { useFeedback } from "../../contexts/FeedbackContext";

const GlobalResetPage = () => {
  const navigate = useNavigate();
  const { showFeedback } = useFeedback();
  const [isLoading, setIsLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const REQUIRED_TEXT = "모든 데이터 일괄 삭제";

  const handleGlobalReset = async () => {
    if (confirmText !== REQUIRED_TEXT) return;

    const finalCheck = (await appConfirm(
      "⚠️ [최종 경고]\n이 작업은 절대로 되돌릴 수 없습니다.\n플랫폼의 모든 학급, 학생, 경제 데이터를 파기하시겠습니까?"
    ));

    if (!finalCheck) return;

    setIsLoading(true);

    try {
      showFeedback("전역 초기화를 시작합니다... (최대 수 분 소요될 수 있습니다)", "info");

      const functionsInstance = getFunctions(app, "asia-northeast3");

      // ✅ timeout 추가 (9분 = 540000ms)
      const globalResetAllClasses = httpsCallable(
        functionsInstance,
        "globalResetAllClasses",
        { timeout: 600000 } // 10분으로 약간 여유
      );

      const result = await globalResetAllClasses();

      if (result.data?.success) {
        showFeedback(
          result.data.message || "시스템 전역 데이터 초기화가 완료되었습니다.",
          "success"
        );
        navigate("/admin/master");
      } else {
        showFeedback("초기화가 완료되었으나 응답 형식이 예상과 다릅니다.", "warning");
      }
    } catch (error) {
      console.error("Global Reset Error:", error);

      // deadline-exceeded 안내 메시지 명확화
      if (error.code === "deadline-exceeded") {
        showFeedback(
          "요청 시간이 초과되었습니다. 서버에서는 작업이 계속 진행 중일 수 있습니다. 잠시 후 로그를 확인하세요.",
          "warning"
        );
      } else {
        showFeedback(`초기화 실패: ${error.message}`, "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppLayout title="전체 데이터 초기화">
      <div className="max-w-3xl mx-auto p-8 space-y-8 animate-in zoom-in-95 duration-300">
        <Button
          onClick={() => navigate("/admin/master")}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors font-medium group"
        >
          <ArrowLeft
            size={18}
            className="group-hover:-translate-x-1 transition-transform"
          />
          마스터 허브로 돌아가기
        </Button>

        <div className="bg-white border-2 border-rose-100 rounded-3xl overflow-hidden shadow-2xl shadow-rose-100">
          <div className="bg-rose-500 p-6 text-white flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-full">
              <ShieldAlert size={32} />
            </div>
            <div>
              <h2 className="text-2xl font-black italic tracking-tighter">
                DANGER ZONE
              </h2>
              <p className="text-rose-100 text-sm font-medium opacity-90">
                전역 데이터 파기 시스템
              </p>
            </div>
          </div>

          <div className="p-8 space-y-6">
            <div className="flex items-start gap-4 p-5 bg-amber-50 rounded-2xl border border-amber-100">
              <AlertTriangle className="text-amber-600 shrink-0" size={24} />
              <div className="text-sm text-amber-900 leading-relaxed">
                <p className="font-bold mb-2 text-base">
                  데이터 파기 시 다음 사항이 적용됩니다:
                </p>
                <ul className="list-disc pl-5 space-y-1.5 opacity-90 font-medium">
                  <li>모든 학급의 하위 경제/활동 데이터 삭제</li>
                  <li>모든 학생 Auth 계정 및 users 문서 삭제</li>
                  <li>모든 활동 로그 및 거래 기록 영구 삭제</li>
                  <li className="text-rose-600 font-bold underline decoration-2 underline-offset-4">
                    삭제된 데이터는 복구할 수 없습니다.
                  </li>
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block text-slate-700 font-bold text-center">
                승인을 위해 아래 문구를 정확히 입력하세요.
                <span className="block text-rose-500 mt-2 text-xl font-black">
                  "{REQUIRED_TEXT}"
                </span>
              </label>

              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="문구를 입력해 주세요"
                className="w-full h-16 text-center text-xl font-bold border-2 border-blue-200 rounded-xl focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 transition-all outline-none bg-slate-50 focus:bg-blue-50/50"
              />
            </div>

            <Button size="md"
              className="w-full h-16"
              color={confirmText === REQUIRED_TEXT ? "rose" : "slate"}
              disabled={confirmText !== REQUIRED_TEXT || isLoading}
              onClick={handleGlobalReset}
              isLoading={isLoading}
            >
              <Trash2 className="mr-2" size={24} />
              시스템 데이터 전체 삭제 실행
            </Button>

            <p className="text-center text-slate-400 text-[11px] leading-tight font-medium">
              본 기능은 정기 데이터 파기 지침에 따라 수행됩니다.
              <br />
              실행 기록은 관리자 로그에 저장됩니다.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default GlobalResetPage;
