import { appConfirm } from "../../../utils/appDialogs";
import React from "react";
import {
  Cog8ToothIcon,
  BuildingLibraryIcon,
  UsersIcon,
  ChartBarIcon,
  TrophyIcon,
  BanknotesIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import { useUser } from "../../../contexts/UserContext";
import { Button } from "../../../components/ui";
import { useBank } from "../../../contexts/BankContext"; // ✨ 컨텍스트 임포트

/* ---------------------------
 * 🔴 알림 배지 컴포넌트
 * ------------------------- */
function NotificationBadge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <div
      className="
      absolute -top-2 -right-2 z-20 
      flex h-6 w-6 items-center justify-center 
      rounded-full bg-red-500 
      ring-2 ring-white shadow-md 
      animate-bounce-short
    "
    >
      <span className="text-[10px] font-black text-white">
        {count > 99 ? "99+" : count}
      </span>
    </div>
  );
}

/* ---------------------------
 * 🎨 재사용 카드
 * ------------------------- */
function AdminCard({
  title,
  description,
  icon: Icon,
  themeColor = "blue",
  children,
  badgeCount = 0,
}) {
  const colorMap = {
    blue: {
      bg: "bg-blue-50",
      text: "text-blue-600",
      icon: "text-blue-600",
      border: "hover:border-blue-200",
    },
    indigo: {
      bg: "bg-indigo-50",
      text: "text-indigo-600",
      icon: "text-indigo-600",
      border: "hover:border-indigo-200",
    },
    emerald: {
      bg: "bg-emerald-50",
      text: "text-emerald-600",
      icon: "text-emerald-600",
      border: "hover:border-emerald-200",
    },
    green: {
      bg: "bg-green-50",
      text: "text-green-600",
      icon: "text-green-600",
      border: "hover:border-green-200",
    },
    purple: {
      bg: "bg-purple-50",
      text: "text-purple-600",
      icon: "text-purple-600",
      border: "hover:border-purple-200",
    },
    orange: {
      bg: "bg-orange-50",
      text: "text-orange-600",
      icon: "text-orange-600",
      border: "hover:border-orange-200",
    },
  };

  const theme = colorMap[themeColor] || colorMap.blue;

  return (
    <div
      className={`relative flex flex-col h-full bg-white rounded-2xl border border-gray-100 shadow-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${theme.border}`}
    >
      <NotificationBadge count={badgeCount} />
      <div className="p-6 flex-1">
        <div className="flex items-start space-x-5">
          <div
            className={`flex-shrink-0 w-14 h-14 ${theme.bg} rounded-2xl flex items-center justify-center shadow-inner`}
          >
            <Icon className={`w-7 h-7 ${theme.icon}`} />
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <h3 className="text-lg font-bold text-gray-900 mb-2 tracking-tight">
              {title}
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed break-keep">
              {description}
            </p>
          </div>
        </div>
      </div>
      <div className="p-6 pt-0 mt-auto">{children}</div>
    </div>
  );
}

/* ---------------------------
 * 🎨 액션 버튼
 * ------------------------- */
function QuickActionButton({ onClick, children, themeColor = "blue" }) {
  return (
    <Button
      onClick={onClick}
      tone={themeColor}
      size="md"
      rounded="xl"
      fullWidth
      className="group py-3.5 text-sm font-semibold shadow-md"
    >
      <span>{children}</span>
      <ArrowRightIcon className="w-4 h-4 ml-2 opacity-70 group-hover:translate-x-1 transition-transform duration-200" />
    </Button>
  );
}

/* ---------------------------
 * 메인 탭 컴포넌트
 * ------------------------- */
export default function BankAdminTab({
  onOpenProductModal,
  onOpenApprovalModal,
  onOpenDepositProductModal,
  onOpenLoanProductModal,
  onOpenTierRateModal,
  onOpenLoanLimitModal,
  onOpenSubscriptionManagementModal,
  onOpenSubscriptionOverviewModal,
  onOpenOverviewModal,
}) {
  const { hasPermission, isTeacher } = useUser();

  // 🚀 [중요] BankContext에서 실시간 승인 대기 숫자 가져오기
  const { totalPendingCount } = useBank();

  // 1. 권한 체크
  const isBankAdmin = hasPermission("bank_admin");
  const showProducts = isTeacher || isBankAdmin;
  const showApprovals = isTeacher || isBankAdmin;
  const showOverview = isTeacher;
  const showSubscription = isTeacher;
  const showTierRate = isTeacher;
  const showLoanLimit = isTeacher;

  if (
    !showProducts &&
    !showApprovals &&
    !showOverview &&
    !showSubscription &&
    !showTierRate &&
    !showLoanLimit
  ) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
        <div className="text-gray-300 text-6xl mb-4">🔒</div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">
          접근 권한이 제한됨
        </h3>
        <p className="text-gray-500">은행 관리자 권한이 필요합니다.</p>
      </div>
    );
  }

  const handleProductModal =
    onOpenProductModal ||
    (async () => {
      if (onOpenDepositProductModal && onOpenLoanProductModal) {
        if (
          (await appConfirm(
            "어떤 상품을 관리하시겠습니까?\n\n[확인] 예금 상품 관리\n[취소] 대출 상품 관리",
          ))
        ) {
          onOpenDepositProductModal();
        } else {
          onOpenLoanProductModal();
        }
      } else if (onOpenDepositProductModal) onOpenDepositProductModal();
      else if (onOpenLoanProductModal) onOpenLoanProductModal();
    });

  return (
    <div className="space-y-10 pb-10">
      <div data-tour="bank-admin-summary" className="text-center space-y-3 max-w-2xl mx-auto">
        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">
          은행 관리 센터
        </h2>
        <p className="text-gray-500 text-lg">
          예금·대출 상품 설계부터 실시간 거래 승인까지, 우리 반 은행의 모든
          업무를 관리하세요.
        </p>
      </div>

      <div
        data-tour="bank-admin-grid"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6"
      >
        {showProducts && (
          <AdminCard
            title="은행 상품 관리"
            description="학생들이 가입할 예금과 대출 상품을 만들고 이자율을 설정합니다."
            icon={Cog8ToothIcon}
            themeColor="blue"
          >
            <QuickActionButton onClick={handleProductModal} themeColor="blue">
              상품 설정하기
            </QuickActionButton>
          </AdminCard>
        )}

        {showApprovals && (
          <AdminCard
            title="거래 승인 관리"
            description="학생들의 예금 가입 및 대출 신청 내역을 검토하고 승인합니다."
            icon={BuildingLibraryIcon}
            themeColor="indigo"
            // ✨ 컨텍스트에서 온 숫자를 배지에 주입
            badgeCount={totalPendingCount}
          >
            <QuickActionButton
              onClick={() => onOpenApprovalModal("savings")}
              themeColor="indigo"
            >
              {/* ✨ 실시간 숫자에 따른 버튼 텍스트 변경 */}
              {totalPendingCount > 0 ? `승인하기` : "승인 내역 관리"}
            </QuickActionButton>
          </AdminCard>
        )}

        {showOverview && (
          <AdminCard
            title="예금·대출 현황"
            description="전체 학생의 자산 현황과 대출 잔액을 한눈에 파악합니다."
            icon={BanknotesIcon}
            themeColor="emerald"
          >
            <QuickActionButton
              onClick={onOpenOverviewModal}
              themeColor="emerald"
            >
              자산 현황 보기
            </QuickActionButton>
          </AdminCard>
        )}

        {showSubscription && (
          <AdminCard
            title="주택청약 관리"
            description="청약 상품을 개설하고 가입자 추첨 및 당첨자 관리를 진행합니다."
            icon={TrophyIcon}
            themeColor="green"
          >
            <div className="space-y-2">
              <QuickActionButton
                onClick={onOpenSubscriptionManagementModal}
                themeColor="green"
              >
                청약 프로그램 관리
              </QuickActionButton>
              <Button
                type="button"
                onClick={onOpenSubscriptionOverviewModal}
                tone="green"
                kind="outline"
                size="md"
                rounded="lg"
                fullWidth
                
              >
                청약 현황 보기
              </Button>
            </div>
          </AdminCard>
        )}

        {showTierRate && (
          <AdminCard
            title="등급별 금리 조정"
            description="신용등급에 따라 예금·대출 금리를 올리거나 낮춥니다."
            icon={ChartBarIcon}
            themeColor="purple"
          >
            <QuickActionButton
              onClick={onOpenTierRateModal}
              themeColor="purple"
            >
              이율 정책 설정
            </QuickActionButton>
          </AdminCard>
        )}

        {showLoanLimit && (
          <AdminCard
            title="개별 대출 한도"
            description="학생 개인별 신용도나 상황에 맞춰 대출 한도를 조정합니다."
            icon={UsersIcon}
            themeColor="orange"
          >
            <QuickActionButton
              onClick={onOpenLoanLimitModal}
              themeColor="orange"
            >
              한도 조정하기
            </QuickActionButton>
          </AdminCard>
        )}
      </div>
    </div>
  );
}
