import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db, auth } from "../firebase";
import { useUser } from "./UserContext";
import {
  INITIAL_PLAN_FEATURES,
  mergePlanConfig,
} from "../pages/master/constants/planManager";

const PlanConfigContext = createContext(null);

const PLAN_TOKEN_SYNC_RETRY_MS = 1500;
const PLAN_TOKEN_SYNC_MAX_ATTEMPTS = 8;

export function PlanConfigProvider({ children }) {
  const { userData, classData, loading: userLoading } = useUser();
  const [globalConfig, setGlobalConfig] = useState(() =>
    mergePlanConfig(INITIAL_PLAN_FEATURES),
  );
  const [tokenPlan, setTokenPlan] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const planTokenSyncTimeoutRef = useRef(null);
  const planTokenSyncAttemptRef = useRef(0);
  const planTokenSyncTargetRef = useRef("");
  const hasUserData = Boolean(userData);

  const clearPlanTokenSyncTimer = () => {
    if (planTokenSyncTimeoutRef.current) {
      clearTimeout(planTokenSyncTimeoutRef.current);
      planTokenSyncTimeoutRef.current = null;
    }
  };

  useEffect(() => () => clearPlanTokenSyncTimer(), []);

  useEffect(() => {
    if (userLoading) return;

    if (!hasUserData) {
      setGlobalConfig(mergePlanConfig(INITIAL_PLAN_FEATURES));
      setConfigLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, "system", "planConfig"),
      (snap) => {
        setGlobalConfig(
          mergePlanConfig(snap.exists() ? snap.data() : INITIAL_PLAN_FEATURES),
        );
        setConfigLoading(false);
      },
      (error) => {
        console.error("[PlanConfig] failed to load global plan config:", error);
        setGlobalConfig(mergePlanConfig(INITIAL_PLAN_FEATURES));
        setConfigLoading(false);
      },
    );

    return () => unsubscribe();
  }, [hasUserData, userLoading]);

  useEffect(() => {
    const isTeacher = userData?.role === "teacher";
    let cancelled = false;

    clearPlanTokenSyncTimer();
    planTokenSyncAttemptRef.current = 0;
    planTokenSyncTargetRef.current = "";

    if (isTeacher && auth.currentUser) {
      auth.currentUser
        .getIdTokenResult()
        .then((result) => {
          if (cancelled) return;
          const planFromToken = result.claims.plan?.toUpperCase();
          setTokenPlan(planFromToken || "FREE");
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("[PlanConfig] failed to load token plan:", error);
          setTokenPlan("FREE");
        });
    } else {
      setTokenPlan(null);
    }

    return () => {
      cancelled = true;
    };
  }, [userData?.role, userData?.uid]);

  useEffect(() => {
    const isTeacher = userData?.role === "teacher";
    const classPlan = classData?.planType?.toUpperCase();
    const syncKey = `${userData?.uid || ""}:${classPlan || ""}`;

    if (!isTeacher || !auth.currentUser || !classPlan || tokenPlan === null) {
      clearPlanTokenSyncTimer();
      return undefined;
    }

    if (tokenPlan === classPlan) {
      clearPlanTokenSyncTimer();
      planTokenSyncAttemptRef.current = 0;
      planTokenSyncTargetRef.current = syncKey;
      return undefined;
    }

    if (planTokenSyncTargetRef.current !== syncKey) {
      planTokenSyncTargetRef.current = syncKey;
      planTokenSyncAttemptRef.current = 0;
    }

    let cancelled = false;

    const scheduleRefresh = (delayMs) => {
      clearPlanTokenSyncTimer();
      planTokenSyncTimeoutRef.current = setTimeout(async () => {
        if (cancelled || !auth.currentUser) return;

        const attempt = planTokenSyncAttemptRef.current + 1;
        planTokenSyncAttemptRef.current = attempt;

        try {
          await auth.currentUser.getIdToken(true);
          const refreshed = await auth.currentUser.getIdTokenResult();
          if (cancelled) return;

          const refreshedPlan = refreshed.claims.plan?.toUpperCase() || "FREE";
          setTokenPlan(refreshedPlan);

          if (refreshedPlan === classPlan) {
            planTokenSyncAttemptRef.current = 0;
            return;
          }

          if (attempt < PLAN_TOKEN_SYNC_MAX_ATTEMPTS) {
            scheduleRefresh(PLAN_TOKEN_SYNC_RETRY_MS);
            return;
          }

          console.warn("[PlanConfig] token plan sync timed out", {
            classPlan,
            refreshedPlan,
            uid: userData?.uid || null,
          });
        } catch (error) {
          if (cancelled) return;

          if (attempt < PLAN_TOKEN_SYNC_MAX_ATTEMPTS) {
            scheduleRefresh(PLAN_TOKEN_SYNC_RETRY_MS);
            return;
          }

          console.error("[PlanConfig] token refresh failed after retries:", error);
        }
      }, delayMs);
    };

    scheduleRefresh(
      planTokenSyncAttemptRef.current === 0 ? 0 : PLAN_TOKEN_SYNC_RETRY_MS,
    );

    return () => {
      cancelled = true;
      clearPlanTokenSyncTimer();
    };
  }, [classData?.planType, tokenPlan, userData?.role, userData?.uid]);

  const value = useMemo(() => {
    const isStudent = userData?.role === "student";
    const isTeacher = userData?.role === "teacher";
    const isAdmin = userData?.role === "admin";

    const isBasicLoading = userLoading || configLoading;
    const isWaitingForToken =
      isTeacher && tokenPlan === null && !classData?.planType;
    const isWaitingForClassData = Boolean(
      isStudent && userData?.classId && !classData,
    );
    const isWaitingForRole = Boolean(userData && !userData.role);
    const loading = Boolean(
      isBasicLoading ||
        isWaitingForToken ||
        isWaitingForClassData ||
        isWaitingForRole,
    );

    let currentPlan = "LOADING";

    if (!loading && userData) {
      const planFromClass = classData?.planType?.toUpperCase();

      if (isAdmin) {
        currentPlan = "ADMIN_PASS";
      } else if (isTeacher) {
        currentPlan = planFromClass || tokenPlan || "FREE";
      } else if (isStudent) {
        currentPlan = planFromClass || "FREE";
      }
    } else if (!loading && !userData) {
      currentPlan = "FREE";
    }

    const getPagePolicy = (pageKey) => {
      if (loading || currentPlan === "LOADING") return null;
      if (currentPlan === "ADMIN_PASS") {
        return {
          accessible: true,
          activityLog: true,
          creditLog: true,
        };
      }
      if (!pageKey) return null;

      return globalConfig?.[currentPlan]?.pages?.[pageKey] || null;
    };

    const checkPageAccess = (pageKey) => {
      if (loading || currentPlan === "LOADING") return true;
      if (currentPlan === "ADMIN_PASS") return true;

      const pagePolicy = getPagePolicy(pageKey);
      if (!pagePolicy) return true;

      return pagePolicy.accessible !== false;
    };

    const checkAccess = (pageKey) => checkPageAccess(pageKey);

    const getPlanLimit = (limitKey) => {
      if (loading || currentPlan === "LOADING") return null;
      if (currentPlan === "ADMIN_PASS") return 99999;
      return globalConfig?.[currentPlan]?.limits?.[limitKey] ?? null;
    };

    return {
      globalConfig,
      loading,
      currentPlan,
      checkAccess,
      checkPageAccess,
      getPagePolicy,
      getPlanLimit,
    };
  }, [globalConfig, configLoading, userData, classData, tokenPlan, userLoading]);

  return (
    <PlanConfigContext.Provider value={value}>
      {children}
    </PlanConfigContext.Provider>
  );
}

export const usePlanConfig = () => {
  const context = useContext(PlanConfigContext);
  if (!context) {
    throw new Error("usePlanConfig must be used within a PlanConfigProvider");
  }
  return context;
};
