import React, { useState, useEffect, useMemo } from "react";
import { db } from "../firebase";
import { onSnapshot } from "firebase/firestore";
import { useUser } from "./UserContext";
import { NotificationContext, useNotifications } from "./NotificationContextCore";
import { subscribeDocCount } from "../notifications/adapters/subscribeDocCount";
import { subscribeMissionBadge } from "../notifications/adapters/missionBadgeAdapter";
import { subscribeNoticeBadge } from "../notifications/adapters/noticeBadgeAdapter";
import { subscribePoliceBadge } from "../notifications/adapters/policeBadgeAdapter";
import { subscribeBankBadge } from "../notifications/adapters/bankBadgeAdapter";
import { subscribeCredentialBadge } from "../notifications/adapters/credentialBadgeAdapter";
import { subscribeMarketplaceBadge } from "../notifications/adapters/marketplaceBadgeAdapter";
import { subscribeCaseLibraryBadge } from "../notifications/adapters/caseLibraryBadgeAdapter";
import { subscribeRealEstateBadge } from "../notifications/adapters/realEstateBadgeAdapter";
import { subscribeTaxBadge } from "../notifications/adapters/taxBadgeAdapter";
import {
  buildAssemblySummaryCacheFromCurrentSummary,
  buildAssemblySummaryCacheFromLegacySummary,
  getAssemblyClassSummaryRef,
  getAssemblyPendingCountFromCachedSummary,
  getAssemblyPendingCountFromCurrentSummary,
  getAssemblyPendingCountFromLegacySummary,
  getAssemblyUserSummaryRef,
  readCachedAssemblySummary,
  requestAssemblySummaryRepair,
  writeCachedAssemblySummary,
} from "../pages/assembly/services/assemblySummaryService";
import {
  createEmptyNotificationActionCounts,
  createEmptyNotificationActionFlags,
  createEmptyNotificationActivityCounts,
  createEmptyNotificationActivityFlags,
  getNotificationStateMainRef,
} from "../utils/notificationState";
import { requestNotificationStateRepair } from "../notifications/services/notificationStateRepairService";

export { NotificationContext, useNotifications };
const EMPTY_BADGES = Object.freeze({
  notices: false,
  ...createEmptyNotificationActionFlags(),
  ...createEmptyNotificationActivityFlags(),
});
const EMPTY_BADGE_COUNTS = Object.freeze({
  notices: 0,
  ...createEmptyNotificationActionCounts(),
  ...createEmptyNotificationActivityCounts(),
});

export const NotificationProvider = ({ children }) => {
  const { userData, classId, hasPermission, authTransitioning } = useUser();
  const [badges, setBadges] = useState(EMPTY_BADGES);
  const [badgeCounts, setBadgeCounts] = useState(EMPTY_BADGE_COUNTS);
  const [unreadNoticeCount, setUnreadNoticeCount] = useState(0);
  const [isMainLoading, setIsMainLoading] = useState(true);
  const [isBankLoading, setIsBankLoading] = useState(true);
  const isTeacher = userData?.role === "teacher" || userData?.role === "admin";
  const permissionFlags = useMemo(
    () => ({
      isMissionManager: isTeacher || hasPermission("mission_admin"),
      isBankManager: hasPermission("bank_admin"),
      isPoliceManager: hasPermission("permission_group_police"),
      isMarketplaceManager: isTeacher || hasPermission("marketplace_admin"),
      canViewAssembly: hasPermission("page_assembly_view"),
    }),
    [hasPermission, isTeacher],
  );
  const {
    isMissionManager,
    isBankManager,
    isPoliceManager,
    isMarketplaceManager,
    canViewAssembly,
  } = permissionFlags;

  useEffect(() => {
    if (authTransitioning || !classId || !userData?.uid) {
      setBadges(EMPTY_BADGES);
      setBadgeCounts(EMPTY_BADGE_COUNTS);
      setUnreadNoticeCount(0);
      setIsMainLoading(false);
      setIsBankLoading(false);
      return;
    }

    setIsMainLoading(true);
    setIsBankLoading(true);

    const unsubs = [];
    const uid = userData.uid;

    // Main badge first-snapshot tracking
    let mainNoticeReady = false;
    let mainMissionReady = false;
    let mainCredentialsReady = false;
    let mainTaxReady = isTeacher;
    let mainPoliceReady = false;
    let mainMarketplaceReady = false;
    let mainRealEstateReady = false;
    let mainAssemblyReady = !canViewAssembly;
    let mainCaseLibraryReady = !isTeacher;
    const markMainReady = () => {
      if (
        mainNoticeReady &&
        mainMissionReady &&
        mainCredentialsReady &&
        mainTaxReady &&
        mainPoliceReady &&
        mainMarketplaceReady &&
        mainRealEstateReady &&
        mainAssemblyReady &&
        mainCaseLibraryReady
      ) {
        setIsMainLoading(false);
      }
    };

    const applyNoticesCount = (count) => {
      const noticesCount = Number(count || 0);
      setUnreadNoticeCount(noticesCount);
      setBadges((prev) => ({ ...prev, notices: noticesCount > 0 }));
      setBadgeCounts((prev) => ({ ...prev, notices: noticesCount }));
      if (!mainNoticeReady) {
        mainNoticeReady = true;
        markMainReady();
      }
    };

    const notificationStateMainRef = getNotificationStateMainRef(db, classId, uid);
    const requestStudentNotificationRepair = () => {
      void requestNotificationStateRepair({
        classId,
        studentUid: uid,
      }).catch((error) => {
        console.error(
          "[NotificationContext] notification state repair request error:",
          error,
        );
      });
    };
    unsubs.push(
      subscribeNoticeBadge({
        notificationStateMainRef,
        applyCount: applyNoticesCount,
        requestStudentNotificationRepair,
      }),
    );

    // mission badge summary doc
    // - teacher/mission_admin: pending approvals
    // - student: submittable missions
    const applyMissionBadge = (count) => {
      const missionsCount = Number(count || 0);
      setBadgeCounts((prev) => ({ ...prev, missions: missionsCount }));
      setBadges((prev) => ({ ...prev, missions: missionsCount > 0 }));

      if (!mainMissionReady) {
        mainMissionReady = true;
        markMainReady();
      }
    };

    unsubs.push(
      subscribeMissionBadge({
        db,
        classId,
        isMissionManager,
        notificationStateMainRef,
        applyCount: applyMissionBadge,
        requestStudentNotificationRepair,
      }),
    );

    const applyCredentialsBadge = (count) => {
      const credentialsCount = Number(count || 0);
      setBadgeCounts((prev) => ({ ...prev, credentials: credentialsCount }));
      setBadges((prev) => ({
        ...prev,
        credentials: credentialsCount > 0,
      }));
      if (!mainCredentialsReady) {
        mainCredentialsReady = true;
        markMainReady();
      }
    };

    unsubs.push(
      subscribeCredentialBadge({
        db,
        classId,
        isTeacher,
        notificationStateMainRef,
        applyCount: applyCredentialsBadge,
        requestStudentNotificationRepair,
      }),
    );

    const applyTaxBadge = (count) => {
      const unpaidTaxCount = Number(count || 0);
      setBadgeCounts((prev) => ({ ...prev, tax: unpaidTaxCount }));
      setBadges((prev) => ({ ...prev, tax: unpaidTaxCount > 0 }));
      if (!mainTaxReady) {
        mainTaxReady = true;
        markMainReady();
      }
    };

    unsubs.push(
      subscribeTaxBadge({
        isTeacher,
        notificationStateMainRef,
        applyCount: applyTaxBadge,
        requestStudentNotificationRepair,
      }),
    );

    const applyPoliceBadge = (count) => {
      const policeCount = Number(count || 0);
      setBadgeCounts((prev) => ({ ...prev, police: policeCount }));
      setBadges((prev) => ({ ...prev, police: policeCount > 0 }));
      if (!mainPoliceReady) {
        mainPoliceReady = true;
        markMainReady();
      }
    };

    // police badge
    // manager/teacher: subscribe to pending report summary
    // student: read own police action count from notification state
    unsubs.push(
      subscribePoliceBadge({
        db,
        classId,
        isTeacher,
        isPoliceManager,
        notificationStateMainRef,
        applyCount: applyPoliceBadge,
        requestStudentNotificationRepair,
      }),
    );

    const applyMarketplaceBadge = (count) => {
      const marketplaceCount = Number(count || 0);
      setBadgeCounts((prev) => ({ ...prev, marketplace: marketplaceCount }));
      setBadges((prev) => ({ ...prev, marketplace: marketplaceCount > 0 }));
      if (!mainMarketplaceReady) {
        mainMarketplaceReady = true;
        markMainReady();
      }
    };

    unsubs.push(
      subscribeMarketplaceBadge({
        db,
        classId,
        isMarketplaceManager,
        notificationStateMainRef,
        applyCount: applyMarketplaceBadge,
        requestStudentNotificationRepair,
      }),
    );

    const applyAssemblyBadge = (count) => {
      const assemblyCount = Number(count || 0);
      setBadgeCounts((prev) => ({ ...prev, assembly: assemblyCount }));
      setBadges((prev) => ({ ...prev, assembly: assemblyCount > 0 }));
      if (!mainAssemblyReady) {
        mainAssemblyReady = true;
        markMainReady();
      }
    };

    if (canViewAssembly) {
      const startAssemblyLegacyFallback = () =>
        (() => {
          let classSummaryReady = false;
          let userSummaryReady = false;
          let classSummaryData = null;
          let userSummaryData = null;
          let userSummaryExists = false;
          let repairRequested = false;
          let cancelled = false;
          let cachedAssemblySummary = readCachedAssemblySummary(classId, uid);

          const persistCachedAssemblySummary = (nextCacheValue) => {
            const normalizedValue = writeCachedAssemblySummary(
              classId,
              uid,
              nextCacheValue,
            );
            if (normalizedValue) {
              cachedAssemblySummary = normalizedValue;
            }
            return normalizedValue;
          };

          const requestRepair = () => {
            if (repairRequested || cancelled) {
              return;
            }

            repairRequested = true;
            void requestAssemblySummaryRepair({
              classId,
              studentUid: uid,
            }).catch((error) => {
              console.error(
                "[NotificationContext] assembly summary repair request error:",
                error,
              );
            });
          };

          const resolveAssemblyBadge = () => {
            if (!classSummaryReady || !userSummaryReady || cancelled) {
              return;
            }

            const currentSummaryCount = getAssemblyPendingCountFromCurrentSummary({
              classSummary: classSummaryData,
              userSummary: userSummaryData,
              userSummaryExists,
            });
            if (currentSummaryCount != null) {
              persistCachedAssemblySummary(
                buildAssemblySummaryCacheFromCurrentSummary({
                  classSummary: classSummaryData,
                  userSummary: userSummaryData,
                  userSummaryExists,
                }),
              );
              applyAssemblyBadge(currentSummaryCount);
              return;
            }

            const legacySummaryCount = getAssemblyPendingCountFromLegacySummary(
              classSummaryData,
              uid,
            );
            if (legacySummaryCount != null) {
              persistCachedAssemblySummary(
                buildAssemblySummaryCacheFromLegacySummary(
                  classSummaryData,
                  uid,
                  cachedAssemblySummary,
                ),
              );
              requestRepair();
              applyAssemblyBadge(legacySummaryCount);
              return;
            }

            const cachedPendingCount = getAssemblyPendingCountFromCachedSummary(
              cachedAssemblySummary,
            );
            if (cachedPendingCount != null) {
              requestRepair();
              applyAssemblyBadge(cachedPendingCount);
              return;
            }

            const openVotingBillCount = Number(
              classSummaryData?.openVotingBillCount || 0,
            );
            requestRepair();
            applyAssemblyBadge(openVotingBillCount > 0 ? openVotingBillCount : 0);
          };

          const classSummaryUnsub = onSnapshot(
            getAssemblyClassSummaryRef(classId),
            (snap) => {
              classSummaryData = snap.exists() ? snap.data() || {} : null;
              classSummaryReady = true;
              resolveAssemblyBadge();
            },
            (error) => {
              console.error(
                "[NotificationContext] assembly class summary snapshot error:",
                error,
              );
              classSummaryData = null;
              classSummaryReady = true;
              resolveAssemblyBadge();
            },
          );

          const userSummaryUnsub = onSnapshot(
            getAssemblyUserSummaryRef(classId, uid),
            (snap) => {
              userSummaryExists = snap.exists();
              userSummaryData = userSummaryExists ? snap.data() || {} : null;
              userSummaryReady = true;
              resolveAssemblyBadge();
            },
            (error) => {
              console.error(
                "[NotificationContext] assembly user summary snapshot error:",
                error,
              );
              userSummaryExists = false;
              userSummaryData = null;
              userSummaryReady = true;
              resolveAssemblyBadge();
            },
          );

          return () => {
            cancelled = true;
            classSummaryUnsub();
            userSummaryUnsub();
          };
        })();

      if (isTeacher) {
        unsubs.push(startAssemblyLegacyFallback());
      } else {
        unsubs.push(
          subscribeDocCount({
            ref: notificationStateMainRef,
            applyCount: applyAssemblyBadge,
            selectCount: (data) => Number(data?.actions?.assembly || 0),
            canUseData: (data) => data?.actionsUpdatedAt?.assembly != null,
            onMissingData: requestStudentNotificationRepair,
            onSnapshotError: (error) => {
              console.error(
                "[NotificationContext] assembly state snapshot error:",
                error,
              );
            },
          }),
        );
      }
    } else {
      applyAssemblyBadge(0);
      markMainReady();
    }

    const applyRealEstateBadge = (count) => {
      const realestateCount = Number(count || 0);
      setBadgeCounts((prev) => ({ ...prev, realestate: realestateCount }));
      setBadges((prev) => ({ ...prev, realestate: realestateCount > 0 }));
      if (!mainRealEstateReady) {
        mainRealEstateReady = true;
        markMainReady();
      }
    };

    unsubs.push(
      subscribeRealEstateBadge({
        isTeacher,
        notificationStateMainRef,
        applyCount: applyRealEstateBadge,
        requestStudentNotificationRepair,
      }),
    );

    const applyCaseLibraryBadge = (count) => {
      const caseLibraryCount = Number(count || 0);
      setBadgeCounts((prev) => ({ ...prev, caseLibrary: caseLibraryCount }));
      setBadges((prev) => ({
        ...prev,
        caseLibrary: caseLibraryCount > 0,
      }));
      if (!mainCaseLibraryReady) {
        mainCaseLibraryReady = true;
        markMainReady();
      }
    };

    unsubs.push(
      subscribeCaseLibraryBadge({
        classId,
        uid,
        isTeacher,
        applyCount: applyCaseLibraryBadge,
      }),
    );

    // bank summary badge (manager: pending approvals, student: maturity/repayment actions)
    let bankReady = false;
    const markBankReady = () => {
      if (bankReady) setIsBankLoading(false);
    };
    const applyBankBadge = (count) => {
      const bankCount = Number(count || 0);
      setBadgeCounts((prev) => ({ ...prev, bank: bankCount }));
      setBadges((prev) => ({ ...prev, bank: bankCount > 0 }));
      if (!bankReady) {
        bankReady = true;
        markBankReady();
      }
    };

    unsubs.push(
      subscribeBankBadge({
        db,
        classId,
        isTeacher,
        isBankManager,
        notificationStateMainRef,
        applyCount: applyBankBadge,
        requestStudentNotificationRepair,
      }),
    );

    return () => unsubs.forEach((unsub) => unsub());
  }, [
    classId,
    isTeacher,
    isBankManager,
    isMarketplaceManager,
    isMissionManager,
    isPoliceManager,
    canViewAssembly,
    userData?.uid,
    authTransitioning,
  ]);

  const hasAnyNotification = Object.values(badges).some((v) => v === true);
  const actionBadges = {
    tax: Number(badgeCounts.tax || 0),
    missions: Number(badgeCounts.missions || 0),
    bank: Number(badgeCounts.bank || 0),
    credentials: Number(badgeCounts.credentials || 0),
    police: Number(badgeCounts.police || 0),
    marketplace: Number(badgeCounts.marketplace || 0),
    realestate: Number(badgeCounts.realestate || 0),
    assembly: Number(badgeCounts.assembly || 0),
    caseLibrary: Number(badgeCounts.caseLibrary || 0),
  };
  const value = {
    badges,
    badgeCounts,
    actionBadges,
    unreadNoticeCount,
    hasAnyNotification,
    isLoading: isMainLoading || isBankLoading,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};
