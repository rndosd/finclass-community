import React, { useState, useRef, useEffect } from "react";
import {
  ShieldCheck,
  Check,
  Info,
  ExternalLink,
  Trash2,
  UserCheck,
} from "lucide-react";
import { Modal, Button } from "../ui";
import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../../firebase";
import { Link } from "react-router-dom";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useUser } from "../../contexts/UserContext";

const PrivacyConsentModal = ({ isOpen, userData }) => {
  const { showFeedback } = useFeedback();
  const { isAccountSwitching, clearAccountSwitch } = useUser();
  const [returningToTeacher, setReturningToTeacher] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [hasReadToBottom, setHasReadToBottom] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  const isTeacher = userData?.role === "teacher" || userData?.role === "admin";

  const handleReturnToTeacher = async () => {
    if (returningToTeacher || loading) return;
    setReturningToTeacher(true);
    try {
      const returnPath = sessionStorage.getItem("finclass_teacher_return_path") || "/dashboard";
      const restored = await clearAccountSwitch(returnPath);
      if (restored) {
        sessionStorage.removeItem("finclass_teacher_return_path");
        showFeedback("교사 계정으로 돌아왔습니다.", "info");
      } else {
        showFeedback("교사 계정 복귀에 실패했습니다. 다시 시도해 주세요.", "error");
      }
    } catch {
      showFeedback("교사 계정 복귀에 실패했습니다. 다시 시도해 주세요.", "error");
    } finally {
      setReturningToTeacher(false);
    }
  };

  // 1. 스크롤 바닥 감지 로직
  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop <= clientHeight + 5) {
      if (!hasReadToBottom) setHasReadToBottom(true);
    }
  };

  // 2. 내용이 짧아 스크롤바가 없는 경우 처리
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      if (scrollHeight <= clientHeight) setHasReadToBottom(true);
    }
  }, [isOpen]);

  // 3. 동의 처리 (Cloud Function 호출)
  const handleAgree = async () => {
    if (!agreed || !hasReadToBottom) return;

    setLoading(true);
    try {
      const functionsInstance = getFunctions(app, "asia-northeast3");
      const updatePrivacyAgreement = httpsCallable(
        functionsInstance,
        "updatePrivacyAgreement",
      );

      const result = await updatePrivacyAgreement({ privacyAgreed: true });

      if (result.data?.success) {
        showFeedback("개인정보 처리방침에 동의하셨습니다.", "success");
      }
    } catch (error) {
      console.error("Consent Error:", error);
      showFeedback(`저장 중 오류가 발생했습니다: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => {}} size="lg">
      <Modal.Header>
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-blue-600" size={24} />
          <span className="font-bold text-slate-900 text-lg">
            개인정보 처리방침 동의
          </span>
        </div>
      </Modal.Header>

      <Modal.Body className="break-keep" style={{ wordBreak: "keep-all" }}>
        {/* 상단 공지 */}
        <div className="mb-4 p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-start gap-3">
          <Info className="text-blue-600 shrink-0 mt-0.5" size={18} />
          <p className="text-xs md:text-sm text-blue-900 leading-relaxed font-medium">
            이 설치본의 개인정보 처리 안내를 확인하세요. 아래의 역할별 안내 사항을
            <strong> 끝까지 읽으셔야 동의 버튼이 활성화됩니다.</strong>
          </p>
        </div>

        {/* 📜 역할별 본문 영역 */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-80 overflow-y-auto p-5 border border-slate-200 rounded-2xl bg-white shadow-inner text-sm text-slate-700 space-y-8"
        >
          {isTeacher ? (
            /* --- 교사용 (관리/행정 중심) --- */
            <div className="space-y-6">
              <section>
                <h4 className="font-extrabold text-slate-900 mb-3 flex items-center gap-2">
                  <UserCheck size={18} className="text-blue-600" />
                  [교사용] 개인정보 수집 및 관리 책임 고지
                </h4>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-[13px] leading-relaxed space-y-2">
                  <p>
                    <strong>수집 항목:</strong> 구글 이메일 주소, 성명, 소속
                    학교/학급 정보
                  </p>
                  <p>
                    <strong>수집 목적:</strong> 교사 인증, 학급 경영 시스템 제공
                    및 수업 데이터 관리
                  </p>
                  <p className="text-blue-700 font-bold underline underline-offset-4">
                    보유 기간: 이 설치본 운영자가 고지한 보관·삭제 기준에 따릅니다.
                  </p>
                </div>
              </section>
              <section className="text-slate-600 text-[13px] leading-relaxed">
                <p>
                  선생님은 학급 관리자로서 학생의 성명, 학번 등 개인 식별 정보를
                  다룰 경우 이를 안전하게 관리할 의무가 있습니다. 핀클래스는
                  교육 활동을 위해 입력된 정보를 본 목적 외에 사용하지 않습니다.
                </p>
              </section>
            </div>
          ) : (
            /* --- 학생용 (수집 항목 현실화 수정) --- */
            <div className="space-y-6">
              <section>
                <h4 className="font-extrabold text-slate-900 mb-3 flex items-center gap-2">
                  <ShieldCheck size={18} className="text-blue-600" />
                  [학생용] 개인정보 보호 및 활동 기록 안내
                </h4>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-[13px] leading-relaxed space-y-2">
                  <p className="text-blue-700 font-bold underline">
                    ● 필수 안내: 핀클래스는 원활한 학급 운영과 경제 교육을 위해
                    선생님이 등록한 최소한의 학생 정보를 저장합니다.
                  </p>
                  <p>
                    <strong>수집 항목:</strong> 성명(또는 별명), 학번(또는
                    번호), 학급 내 경제 활동 기록(코인 보유량, 직업, 거래 내역
                    등)
                  </p>
                  <p>
                    <strong>수집 목적:</strong> 학급 경제 수업 참여 및 개인별
                    활동 결과 기록/조회
                  </p>
                  <p className="text-red-600 font-bold underline underline-offset-4">
                    보유 기간: 담당 선생님과 운영자가 안내한 보관·삭제 기준에 따릅니다.
                  </p>
                </div>
              </section>
              <section className="text-slate-600 text-[13px] leading-relaxed">
                <p>
                  활동 기록의 열람 범위, 보관 기간과 삭제 방법은 담당 선생님과 이 설치본의 운영자가 안내합니다.
                </p>
              </section>
            </div>
          )}

          {/* 공통 파기 정책 */}
          <section className="pt-4 border-t border-slate-100">
            <h4 className="font-extrabold text-slate-900 mb-2 flex items-center gap-2">
              <Trash2 size={18} className="text-red-400" />
              공통 데이터 파기 정책
            </h4>
            <p className="text-[13px] leading-relaxed text-slate-600">
              이 설치본의 운영자가 개인정보처리방침에 보관·삭제 기준과 요청 방법을 안내합니다. 이 초안은 특정 시점의 자동 삭제를 보장하지 않습니다.
            </p>
          </section>

          <div className="py-4 text-center">
            <Link
              to="/privacy"
              target="_blank"
              className="text-xs text-blue-600 font-bold hover:underline inline-flex items-center gap-1 bg-blue-50 px-4 py-2 rounded-full"
            >
              개인정보 처리방침 전문 보기 <ExternalLink size={12} />
            </Link>
          </div>
        </div>

        {/* 체크박스 영역 */}
        <div
          onClick={() => hasReadToBottom && setAgreed(!agreed)}
          className={`p-4 mt-6 rounded-2xl border-2 transition-all flex items-center gap-3 ${
            !hasReadToBottom
              ? "bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed"
              : agreed
                ? "bg-blue-50 border-blue-600 cursor-pointer shadow-sm"
                : "bg-white border-slate-200 cursor-pointer hover:border-blue-300"
          }`}
        >
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${
              agreed
                ? "bg-blue-600 border-blue-600"
                : "bg-white border-slate-300"
            }`}
          >
            {agreed && <Check size={14} className="text-white" />}
          </div>
          <span
            className={`font-bold text-sm md:text-base ${agreed ? "text-blue-700" : "text-slate-600"}`}
          >
            {hasReadToBottom
              ? "상기 내용을 확인하였으며 이에 동의합니다."
              : "내용을 아래 끝까지 읽어주세요 ↓"}
          </span>
        </div>
      </Modal.Body>

      <Modal.Footer>
        {isAccountSwitching && !isTeacher && (
          <Button fullWidth tone="slate" kind="outline" onClick={handleReturnToTeacher}
            isLoading={returningToTeacher} disabled={loading || returningToTeacher}>
            교사로 돌아가기
          </Button>
        )}
        <Button
          className="w-full h-14 rounded-2xl text-lg font-bold shadow-lg"
          color="blue"
          onClick={handleAgree}
          isLoading={loading}
          disabled={!agreed || !hasReadToBottom || returningToTeacher}
        >
          {hasReadToBottom
            ? "확인 및 동의 완료"
            : "스크롤을 내려 내용을 확인해 주세요"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default PrivacyConsentModal;
