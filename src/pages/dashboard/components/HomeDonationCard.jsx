import donationIllustration from "../../../assets/dashboard/home-donation-v2.webp";
import { HomeCardFrame, HomeCardHeading, HomeCardAction } from "./HomeCardChrome";
import { useNumberFormat as useMoneyDisplay } from "../../../contexts/NumberFormatContext";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { GearSixIcon, HeartIcon, TrophyIcon } from "@phosphor-icons/react";
import { IconButton, Spinner } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { db } from "../../../firebase";
import DonationModal from "../modals/donation/DonationModal";
import DonationAdminModal from "../modals/donation/DonationAdminModal";
import DonationLeaderboardModal from "../modals/donation/DonationLeaderboardModal";
const fetchDonationSummary = async classId => {
  if (!classId) return {
    totalAmount: 0,
    goalAmount: 10000,
    movedToTaxTotal: 0
  };
  const summaryRef = doc(db, `classes/${classId}/dashboardSummary/donationSummary`);
  const snapshot = await getDoc(summaryRef);
  return snapshot.exists() ? snapshot.data() : {
    totalAmount: 0,
    goalAmount: 10000,
    movedToTaxTotal: 0
  };
};
const REFRESH_ON_CLOSE_KEYS = new Set(["donation", "admin"]);
const HomeDonationCard = ({
  displayVariant = "featured"
}) => {
  const {
    formatClassCurrency: formatDisplayMoney
  } = useMoneyDisplay();
  const {
    classId,
    userData,
    classData
  } = useUser();
  const donationSummaryQueryKey = useMemo(() => ["donationSummary", classId], [classId]);
  const currencyUnit = classData?.currencyUnit || "원";
  const isTeacher = userData?.role === "teacher";
  const [modalState, setModalState] = useState({
    donation: false,
    admin: false,
    leaderboard: false
  });
  const {
    data: summary,
    isLoading,
    refetch
  } = useQuery({
    queryKey: donationSummaryQueryKey,
    queryFn: () => fetchDonationSummary(classId),
    enabled: !!classId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnMount: "always",
    refetchOnWindowFocus: false
  });
  const totalAmount = Number(summary?.totalAmount || 0);
  const donationGoal = Number(summary?.goalAmount || 10000);
  const goalBaseAmount = Math.max(totalAmount, 0);
  const showLeaderboardToStudents = Boolean(summary?.showLeaderboardToStudents);
  const rawProgressPercent = donationGoal > 0 ? Math.min(goalBaseAmount / donationGoal * 100, 100) : 0;
  const progressPercentLabel = rawProgressPercent >= 100 ? "100%" : rawProgressPercent === 0 ? "0%" : rawProgressPercent < 10 ? `${rawProgressPercent.toFixed(1)}%` : `${Math.round(rawProgressPercent)}%`;
  const progressBarWidth = rawProgressPercent > 0 ? Math.max(rawProgressPercent, 1) : 0;
  const remainingToGoal = Math.max(donationGoal - goalBaseAmount, 0);
  const openModal = key => {
    setModalState(prev => ({
      ...prev,
      [key]: true
    }));
  };
  const closeModal = key => {
    setModalState(prev => ({
      ...prev,
      [key]: false
    }));
    if (REFRESH_ON_CLOSE_KEYS.has(key)) {
      void refetch();
    }
  };
  const showLeaderboardButton = isTeacher || showLeaderboardToStudents;
  return <>
      <HomeCardFrame type="donation" displayVariant={displayVariant}>
        <HomeCardHeading icon={HeartIcon} tools={<>
          {showLeaderboardButton && <IconButton icon={TrophyIcon} onClick={() => openModal("leaderboard")} label={showLeaderboardToStudents ? "Donation leaderboard" : "Donation leaderboard preview"} tone="amber" size="sm" />}
          {isTeacher && <IconButton icon={GearSixIcon} onClick={() => openModal("admin")} label="Donation admin" tone="slate" size="sm" />}
        </>}>기부 프로젝트</HomeCardHeading>
        <img className="fc-home-art fc-home-donation-art" src={donationIllustration} alt="" decoding="async" />
        {isLoading ? <div className="fc-home-empty"><Spinner size="lg" /></div> : <>
          <div className="fc-home-donation-summary"><div><div className="fc-home-amount"><strong>{formatDisplayMoney(totalAmount)}</strong><span>{currencyUnit}</span></div><p className="fc-home-muted mt-1">목표 {formatDisplayMoney(donationGoal)} {currencyUnit}</p></div><div className="fc-home-donation-percent"><strong>{progressPercentLabel}</strong><small>달성률</small></div></div>
          <progress className="fc-home-progress" max="100" value={progressBarWidth} aria-label="기부 목표 달성률" />
          <p className="fc-home-remaining">{rawProgressPercent >= 100 ? "목표를 달성했습니다." : '달성까지 ' + formatDisplayMoney(remainingToGoal) + currencyUnit + ' 남음'}</p>
        </>}
        <HomeCardAction icon={HeartIcon} onClick={() => openModal("donation")}>기부 참여하기</HomeCardAction>
      </HomeCardFrame>
            {modalState.donation ? <DonationModal isOpen onClose={() => closeModal("donation")} classId={classId} /> : null}

            {modalState.admin && isTeacher ? <DonationAdminModal isOpen onClose={() => closeModal("admin")} classId={classId} /> : null}

            {modalState.leaderboard ? <DonationLeaderboardModal isOpen onClose={() => closeModal("leaderboard")} classId={classId} /> : null}

        </>;
};
export default HomeDonationCard;
