import { appConfirm } from "../../utils/appDialogs";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { AlertTriangle, UserCog, KeyRound } from "lucide-react";
import AppLayout from "../../components/layout/AppLayout";
import { Button, InfoTooltip, PageHeader, RepresentativeTitlePill } from "../../components/ui";
import { useUser } from "../../contexts/UserContext";
import { useFeedback } from "../../contexts/FeedbackContext";
import { auth, functions } from "../../firebase";
import useEquippedTitle from "../../hooks/credentials/useEquippedTitle";
const DELETE_CONFIRM_TEXT = "탈퇴";
const ACCOUNT_ROLE_LABELS = { teacher: "교사", student: "학생", admin: "관리자" };

export default function AccountManagement() {
  const navigate = useNavigate();
  const { userData, classId } = useUser();
  const { showFeedback } = useFeedback();
  const { equippedTitles } = useEquippedTitle(classId, userData?.uid);

  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const isTeacherAccount = userData?.role === "teacher";
  const canDelete = useMemo(
    () => isTeacherAccount && confirmText.trim() === DELETE_CONFIRM_TEXT,
    [isTeacherAccount, confirmText],
  );
  const accountQuestGuide = useMemo(
    () => ({
      type: "quest",
      title: "계정 도우미",
      launcherTitle: "계정 도우미",
      launcherDescription: "기본 정보와 비밀번호 변경 위치를 확인합니다.",
      subtitle: "내 계정 정보와 보안 설정을 점검합니다.",
      storageKey: userData?.uid
        ? `finclass_account_quest_${userData.uid}`
        : "finclass_account_quest",
      tourKey: "ACCOUNT_QUEST_TOUR",
      quests: [
        {
          id: "profile",
          title: "기본 정보 확인하기",
          description: "이름, 역할, 대표 칭호 같은 계정 정보를 확인합니다.",
          completed: Boolean(userData),
          manualComplete: true,
          objectives: [
            {
              id: "profile-ready",
              label: "계정 기본 정보 확인",
              completed: Boolean(userData),
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="account-profile"]',
              title: "기본 정보",
              content: "현재 계정의 이름, 역할, 대표 칭호를 확인합니다.",
            },
          ],
        },
      ],
      extraQuests: [
        {
          id: "password",
          title: "비밀번호 변경 위치 확인하기",
          description: "비밀번호를 바꿔야 할 때 사용하는 버튼 위치를 확인합니다.",
          completed: false,
          manualComplete: true,
          objectives: [
            {
              id: "password-location",
              label: "비밀번호 변경 버튼 확인",
              completed: false,
            },
          ],
          locationSteps: [
            {
              target: '[data-tour="account-password"]',
              title: "비밀번호 변경",
              content: "이 버튼으로 비밀번호 변경 화면으로 이동합니다.",
            },
          ],
        },
      ],
    }),
    [userData],
  );

  const handleDeleteMyTeacherAccount = async () => {
    if (!isTeacherAccount) {
      return;
    }

    if (!canDelete) {
      showFeedback(`확인 문구 '${DELETE_CONFIRM_TEXT}'를 입력해 주세요.`, "warning");
      return;
    }

    const confirmed = (await appConfirm(
      "정말로 계정을 탈퇴하시겠습니까?\n탈퇴가 완료되면 복구할 수 없습니다.",
    ));
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const fn = httpsCallable(functions, "deleteMyTeacherAccount");
      await fn({});

      showFeedback("계정 탈퇴가 완료되었습니다.", "success");
      await signOut(auth).catch(() => {});
      navigate("/login", { replace: true });
    } catch (error) {
      const code = error?.code || "";
      const message = error?.message || "탈퇴 중 문제가 생겼어요. 계정 상태를 확인해 주세요.";

      if (code === "functions/failed-precondition") {
        showFeedback(message, "warning");
      } else {
        showFeedback(message, "error");
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AppLayout showSidebar pageGuide={accountQuestGuide}>
      <div className="min-h-screen bg-[#f0f5ff] p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader title="계정 관리" icon={UserCog} />

        <section
          data-tour="account-profile"
          className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-800">기본 정보</h2>
          <div data-tour="account-password" className="shrink-0">
            <Button tone="blue" kind="soft" icon={KeyRound} onClick={() => navigate("/changepassword", { state: { returnTo: "/account" } })}>
              비밀번호 변경
            </Button>
          </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <p className="text-slate-500">이름</p>
              <p className="font-semibold text-slate-800">{userData?.name || "-"}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <p className="text-slate-500">역할</p>
              <p className="font-semibold text-slate-800">{ACCOUNT_ROLE_LABELS[userData?.role] || userData?.role || "-"}</p>
            </div>
            <div className="sm:col-span-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="flex items-center gap-1.5">
                <p className="text-slate-500">대표 칭호</p>
                <InfoTooltip
                  content="대표 칭호는 홈 화면에 표시되는 칭호입니다. 칭호 도감에서 '대표 칭호로 추가'를 눌러 표시할 칭호를 선택할 수 있습니다."
                  label="대표 칭호 설명"
                />
              </div>
              {equippedTitles.length ? (
                <div className="mt-3 flex flex-wrap gap-3">
                  {equippedTitles.map((title) => (
                    <RepresentativeTitlePill key={title.id} item={title} />
                  ))}
                </div>
              ) : (
                <p className="font-semibold text-slate-800">선택된 대표 칭호 없음</p>
              )}
            </div>
          </div>


        </section>

        {isTeacherAccount && (
          <section className="bg-white border border-red-200 rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              <h2 className="text-lg font-bold">위험 구역</h2>
            </div>

            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              선생님 계정 탈퇴를 진행할 수 있습니다. 탈퇴 전 학급 정리와 데이터 상태를 꼭 확인해 주세요.
            </p>

            <div className="mt-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={`확인 문구 '${DELETE_CONFIRM_TEXT}' 입력`}
                className="w-full sm:max-w-sm px-3 py-2.5 rounded-xl border border-blue-200 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300"
              />
              <Button
                tone="red"
                kind="solid"
                onClick={handleDeleteMyTeacherAccount}
                isLoading={isDeleting}
                disabled={!canDelete || isDeleting}
              >
                선생님 계정 탈퇴
              </Button>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}


