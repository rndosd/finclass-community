import { formatConfiguredMoney } from "../utils/numberDisplay";
import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auth, db, functions } from "../firebase";
import { onIdTokenChanged, signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  doc,
  getDoc,
  onSnapshot,
} from "firebase/firestore";
import { useClassInfo } from "../hooks/user/useClassInfo";
import { useStudentRoster } from "../hooks/user/useStudentRoster";
import { useUserProfile } from "../hooks/user/useUserProfile";
import {
  normalizeRoutePath,
  sanitizeSwitchedStudentPath,
} from "../utils/accountSwitch";
import {
  TOKEN_PERMISSION_MAP,
  applyImpliedPermissions,
} from "../constants/permissionCatalog";
import { resolveClassCurrencyUnit } from "../utils/currencyUnit";
import { resolveMissionTokenLabel } from "../utils/missionTokenLabel";
import { useFinclassSiteTools } from "../webmcp/useFinclassSiteTools";
import { UserContext, useUser } from "./UserContextCore";

export { UserContext, useUser };

const ACCOUNT_SWITCH_STORAGE_KEY = "finclass_switched_student_uid";
const SWITCH_OWNER_STORAGE_KEY = "finclass_switch_owner";
const SWITCH_SESSION_STORAGE_KEY = "finclass_switch_session_id";

const CANONICAL_PERMISSION_KEY_MAP = Object.entries(TOKEN_PERMISSION_MAP).reduce(
  (acc, [permissionKey, tokenKey]) => {
    acc[permissionKey] = permissionKey;
    acc[tokenKey] = permissionKey;
    return acc;
  },
  {},
);

const normalizePermissionKey = (key) =>
  CANONICAL_PERMISSION_KEY_MAP[String(key || "").trim()] || String(key || "").trim();

const buildEnabledPermissionKeys = (permissions = {}) => {
  const canonicalPermissions = Object.keys(permissions).reduce((result, key) => {
    if (permissions?.[key] !== true) return result;
    const normalizedKey = normalizePermissionKey(key);
    if (normalizedKey) result[normalizedKey] = true;
    return result;
  }, {});

  const impliedPermissions = applyImpliedPermissions(canonicalPermissions);
  return Object.keys(impliedPermissions)
    .filter((key) => impliedPermissions[key] === true)
    .sort();
};

const hasPermissionClaim = (permissions = {}, key = "") => {
  const normalizedKey = normalizePermissionKey(key);
  if (!normalizedKey) return false;

  const shortKey = TOKEN_PERMISSION_MAP[normalizedKey];
  return permissions?.[normalizedKey] === true || (shortKey ? permissions?.[shortKey] === true : false);
};

const hasMissionAdminClaim = (claims) => {
  const tokenPerms = claims?.permissions;
  return hasPermissionClaim(tokenPerms, "mission_admin");
};

const hasPoliceManagerClaim = (claims) => {
  const tokenPerms = claims?.permissions;
  return hasPermissionClaim(tokenPerms, "permission_group_police");
};

const hasCredentialsManagerClaim = (claims) => {
  const tokenPerms = claims?.permissions;
  return hasPermissionClaim(tokenPerms, "credentials_admin");
};

const canAccessClassRoster = (claims) => {
  const role = claims?.role;
  return (
    role === "teacher" ||
    role === "admin" ||
    hasMissionAdminClaim(claims) ||
    hasPoliceManagerClaim(claims) ||
    hasCredentialsManagerClaim(claims)
  );
};

const readSwitchOwnerFromStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(SWITCH_OWNER_STORAGE_KEY) || "null");
  } catch (_error) {
    return null;
  }
};

const writeSwitchOwnerToStorage = (ownerData) => {
  if (typeof window === "undefined") return;
  if (!ownerData) return;
  sessionStorage.setItem(SWITCH_OWNER_STORAGE_KEY, JSON.stringify(ownerData));
};

const clearSwitchStorage = () => {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(ACCOUNT_SWITCH_STORAGE_KEY);
  sessionStorage.removeItem(SWITCH_OWNER_STORAGE_KEY);
  sessionStorage.removeItem(SWITCH_SESSION_STORAGE_KEY);
};

export function UserProvider({ children }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState({
    user: null,
    claims: null,
    classId: null,
    profileFallback: null,
    loading: true,
  });
  const [switchOwnerData, setSwitchOwnerData] = useState(
    readSwitchOwnerFromStorage
  );
  const [pendingAccountSwitchPath, setPendingAccountSwitchPath] = useState(null);
  const [authTransitioning, setAuthTransitioning] = useState(false);
  const authTransitionRef = useRef(null);
  const permissionRefreshRef = useRef("");
  const previousAuthScopeRef = useRef(null);

  const completeAccountSwitchRedirect = useCallback(() => {
    setPendingAccountSwitchPath(null);
  }, []);

  const waitForListenerCleanup = useCallback(
    () =>
      new Promise((resolve) => {
        setTimeout(resolve, 200);
      }),
    []
  );

  const settleAuthTransition = useCallback(async (resolvedUid = null) => {
    const pendingTransition = authTransitionRef.current;
    if (!pendingTransition) {
      setAuthTransitioning(false);
      return;
    }

    if (
      pendingTransition.expectedUid &&
      pendingTransition.expectedUid !== resolvedUid
    ) {
      return;
    }

    if (pendingTransition.timeoutId) {
      clearTimeout(pendingTransition.timeoutId);
    }

    authTransitionRef.current = null;
    pendingTransition.resolve?.(resolvedUid);
    setAuthTransitioning(false);
  }, []);

  const abortAuthTransition = useCallback((error) => {
    const pendingTransition = authTransitionRef.current;
    if (pendingTransition?.timeoutId) {
      clearTimeout(pendingTransition.timeoutId);
    }

    authTransitionRef.current = null;
    pendingTransition?.reject?.(error);
    setAuthTransitioning(false);
  }, []);

  const beginAuthTransition = useCallback(
    (expectedUid) => {
      if (authTransitionRef.current?.timeoutId) {
        clearTimeout(authTransitionRef.current.timeoutId);
      }

      authTransitionRef.current?.reject?.(
        new Error("Superseded by a new account transition."),
      );

      setAuthTransitioning(true);

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          abortAuthTransition(new Error("Account transition timed out."));
        }, 10000);

        authTransitionRef.current = {
          expectedUid: expectedUid || null,
          resolve,
          reject,
          timeoutId,
        };
      });
    },
    [abortAuthTransition],
  );

  const performAccountTransition = useCallback(
    async ({ token, expectedUid }) => {
      const transitionPromise = beginAuthTransition(expectedUid);
      void transitionPromise.catch(() => undefined);

      try {
        await waitForListenerCleanup();
        await signInWithCustomToken(auth, token);
        await transitionPromise;
        return true;
      } catch (error) {
        abortAuthTransition(error);
        throw error;
      }
    },
    [abortAuthTransition, beginAuthTransition, waitForListenerCleanup],
  );

  useEffect(() => {
    let unsubPending = null;

    const authUnsubscribe = onIdTokenChanged(auth, async (user) => {
      try {
        if (unsubPending) {
          unsubPending();
          unsubPending = null;
        }

        if (!user) {
          if (!authTransitionRef.current) {
            setSwitchOwnerData(null);
            setPendingAccountSwitchPath(null);
            clearSwitchStorage();
            setSession({
              user: null,
              claims: null,
              classId: null,
              profileFallback: null,
              loading: false,
            });
          }
          return;
        }

        const tokenResult = await user.getIdTokenResult();
        const claims = tokenResult.claims || {};
        const role = claims.role;

        if (!role) {
          try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            const userDoc = userSnap.exists() ? userSnap.data() : null;
            const fallbackRole = userDoc?.role || null;
            const fallbackClassId = userDoc?.classId || null;
            const isApprovedUser =
              userDoc?.status === "approved" && !!fallbackRole;

            if (isApprovedUser) {
              setSession({
                user,
                claims: {
                  ...claims,
                  role: fallbackRole,
                  classId: claims.classId || fallbackClassId || null,
                },
                classId: claims.classId || fallbackClassId || null,
                profileFallback: userDoc,
                loading: false,
              });
              return;
            }
          } catch (_e) {
            // no-op
          }

          unsubPending = onSnapshot(doc(db, "users", user.uid), (snap) => {
            if (snap.data()?.status === "approved") window.location.reload();
          });

          setSession({
            user,
            claims: { role: "pending" },
            classId: null,
            profileFallback: null,
            loading: false,
          });
          return;
        }

        let resolvedClassId = claims.classId || null;
        let profileFallback = null;
        try {
          const userSnap = await getDoc(doc(db, "users", user.uid));
          if (userSnap.exists()) {
            const userDoc = userSnap.data();
            profileFallback = userDoc;
            const userDocClassId = userDoc?.classId || null;
            if (!resolvedClassId && userDocClassId) {
              resolvedClassId = userDocClassId;
            }
          }
        } catch (_e) {
          // no-op
        }

        setSession({
          user,
          claims,
          classId: resolvedClassId,
          profileFallback,
          loading: false,
        });
      } catch (error) {
        console.error("[UserContext] auth state handling failed:", error);
      } finally {
        await settleAuthTransition(user?.uid || null);
      }
    });

    return () => {
      if (unsubPending) unsubPending();
      authUnsubscribe();
    };
  }, [settleAuthTransition]);

  useEffect(() => {
    const nextAuthScope = session.user
      ? `${session.user.uid}:${session.claims?.sw === true ? "switch" : "base"}`
      : "guest";

    if (previousAuthScopeRef.current === null) {
      previousAuthScopeRef.current = nextAuthScope;
      return;
    }

    if (previousAuthScopeRef.current !== nextAuthScope) {
      queryClient.clear();
    }

    previousAuthScopeRef.current = nextAuthScope;
  }, [queryClient, session.claims?.sw, session.user]);

  const uid = session.user?.uid || null;
  const classId = session.classId;
  const role = session.claims?.role || null;
  const isTokenSwitching = session.claims?.sw === true;
  const activeClassId = authTransitioning ? null : classId;
  const activeUid = authTransitioning ? null : uid;

  useEffect(() => {
    if (session.loading) return;
    if (!isTokenSwitching) {
      setSwitchOwnerData(null);
      clearSwitchStorage();
    }
  }, [isTokenSwitching, session.loading]);

  const { classData, classReady } = useClassInfo(activeClassId);
  const { data: rawUserData, profileReady } = useUserProfile(activeClassId, activeUid);
  const effectiveProfile = rawUserData || session.profileFallback || null;
  const isAccountSwitching = isTokenSwitching;
  const switchedStudentUid = isAccountSwitching ? uid : null;

  const tokenPermissionSignature = useMemo(
    () => buildEnabledPermissionKeys(session.claims?.permissions || {}).join("|"),
    [session.claims?.permissions],
  );
  const profilePermissionSignature = useMemo(
    () => buildEnabledPermissionKeys(effectiveProfile?.permissions || {}).join("|"),
    [effectiveProfile?.permissions],
  );
  const tokenPermissionSet = useMemo(
    () => new Set(tokenPermissionSignature ? tokenPermissionSignature.split("|") : []),
    [tokenPermissionSignature],
  );
  const profilePermissionSet = useMemo(
    () => new Set(profilePermissionSignature ? profilePermissionSignature.split("|") : []),
    [profilePermissionSignature],
  );
  const hasLiveRosterPermission = useMemo(
    () =>
      profilePermissionSet.has("mission_admin") ||
      profilePermissionSet.has("permission_group_police") ||
      profilePermissionSet.has("credentials_admin"),
    [profilePermissionSet],
  );
  const hasClaimRosterPermission = useMemo(
    () => canAccessClassRoster(session.claims),
    [session.claims],
  );
  const canAccessRoster =
    role === "teacher" ||
    role === "admin" ||
    (effectiveProfile ? hasLiveRosterPermission : hasClaimRosterPermission);

  const { data: studentList = [], error: studentRosterError, isLoading: studentRosterLoading } = useStudentRoster(activeClassId, {
    enabled: !authTransitioning && !!activeClassId && canAccessRoster,
    version: classData?.studentRosterVersion,
    ready: classData?.classId === activeClassId,
  });

  const canSwitchAccount = useMemo(
    () =>
      !authTransitioning &&
      !isTokenSwitching &&
      canAccessRoster &&
      (role === "teacher" || role === "admin"),
    [authTransitioning, canAccessRoster, isTokenSwitching, role],
  );

  useEffect(() => {
    if (!session.user || !effectiveProfile || !profileReady || !role) {
      permissionRefreshRef.current = "";
      return;
    }

    if (role === "teacher" || role === "admin" || role === "pending") {
      permissionRefreshRef.current = "";
      return;
    }

    if (profilePermissionSignature === tokenPermissionSignature) {
      permissionRefreshRef.current = "";
      return;
    }

    const refreshKey = `${session.user.uid}:${profilePermissionSignature}->${tokenPermissionSignature}`;
    if (permissionRefreshRef.current === refreshKey) {
      return;
    }

    permissionRefreshRef.current = refreshKey;
    session.user.getIdToken(true).catch((error) => {
      console.error("[UserContext] permission claim refresh failed:", error);
      permissionRefreshRef.current = "";
    });
  }, [
    effectiveProfile,
    profilePermissionSignature,
    profileReady,
    role,
    session.user,
    tokenPermissionSignature,
  ]);

  const startSwitchCallable = useMemo(
    () => httpsCallable(functions, "startSwitchToStudent"),
    []
  );
  const returnSwitchCallable = useMemo(
    () => httpsCallable(functions, "returnToTeacher"),
    []
  );

  const switchToStudent = useCallback(
    async (targetUid, redirectPath = "/dashboard") => {
      if (
        authTransitioning ||
        !canSwitchAccount ||
        !targetUid ||
        !classId ||
        !session.user?.uid
      ) {
        return false;
      }

      try {
        const result = await startSwitchCallable({
          targetStudentUid: targetUid,
          classId,
        });
        const token = result?.data?.token;
        if (!token) {
          throw new Error("Failed to issue switch token.");
        }

        const ownerPayload = {
          uid: session.user.uid,
          name: effectiveProfile?.name || session.user.displayName || "",
          role: session.claims?.role || null,
          classId,
        };
        const nextPath = sanitizeSwitchedStudentPath(redirectPath);

        if (typeof window !== "undefined") {
          sessionStorage.setItem(ACCOUNT_SWITCH_STORAGE_KEY, String(targetUid));
          if (result?.data?.sessionId) {
            sessionStorage.setItem(
              SWITCH_SESSION_STORAGE_KEY,
              String(result.data.sessionId)
            );
          }
          writeSwitchOwnerToStorage(ownerPayload);
        }
        setSwitchOwnerData(ownerPayload);
        setPendingAccountSwitchPath(nextPath);

        return await performAccountTransition({
          token,
          expectedUid: targetUid,
        });
      } catch (error) {
        console.error("[UserContext] switchToStudent failed:", error);
        abortAuthTransition(error);
        setSwitchOwnerData(null);
        setPendingAccountSwitchPath(null);
        clearSwitchStorage();
        return false;
      }
    },
    [
      authTransitioning,
      abortAuthTransition,
      canSwitchAccount,
      classId,
      performAccountTransition,
      session.user,
      session.claims?.role,
      effectiveProfile,
      startSwitchCallable,
    ]
  );

  const clearAccountSwitch = useCallback(async (redirectPath = "/dashboard") => {
    if (authTransitioning || !isAccountSwitching) return false;

    try {
      const result = await returnSwitchCallable({});
      const token = result?.data?.token;
      if (!token) {
        throw new Error("Failed to issue return token.");
      }

      const teacherUid =
        switchOwnerData?.uid || session.claims?.originTeacherUid || null;
      if (!teacherUid) {
        throw new Error("Missing teacher uid for account return.");
      }
      setPendingAccountSwitchPath(normalizeRoutePath(redirectPath));
      const restored = await performAccountTransition({
        token,
        expectedUid: teacherUid,
      });

      if (!restored) {
        return false;
      }

      setSwitchOwnerData(null);
      clearSwitchStorage();
      return true;
    } catch (error) {
      console.error("[UserContext] clearAccountSwitch failed:", error);
      abortAuthTransition(error);
      setPendingAccountSwitchPath(null);
      return false;
    }
  }, [
    abortAuthTransition,
    authTransitioning,
    isAccountSwitching,
    performAccountTransition,
    returnSwitchCallable,
    session.claims?.originTeacherUid,
    switchOwnerData?.uid,
  ]);

  const hasPermission = useCallback(
    (key) => {
      const normalizedKey = normalizePermissionKey(key);
      if (!role || !normalizedKey) return false;
      if (!isAccountSwitching && (role === "admin" || role === "teacher")) {
        return true;
      }

      if (effectiveProfile) {
        return profilePermissionSet.has(normalizedKey);
      }

      return tokenPermissionSet.has(normalizedKey);
    },
    [effectiveProfile, isAccountSwitching, profilePermissionSet, role, tokenPermissionSet]
  );

  const value = useMemo(() => {
    const currencyUnit = resolveClassCurrencyUnit(classData);
    const missionTokenLabel = resolveMissionTokenLabel(classData);
    const isAdmin = role === "admin";
    const isTeacher = role === "teacher" || role === "admin";
    const teacherDisplayName =
      String(classData?.teacherDisplayName || classData?.teacherName || "").trim() ||
      String(effectiveProfile?.name || session.user?.displayName || "").trim() ||
      "선생님";
    const canReadRoster =
      canAccessRoster ||
      hasPermission("mission_admin") ||
      hasPermission("permission_group_police");

    const fallbackOwnerFromClaims =
      isAccountSwitching && session.claims?.originTeacherUid
        ? {
            uid: session.claims.originTeacherUid,
            role: session.claims.originTeacherRole || "teacher",
            classId: session.claims.originClassId || classId || null,
            name: "",
          }
        : null;

    const accountOwnerData = isAccountSwitching
      ? switchOwnerData || fallbackOwnerFromClaims
      : session.user && (effectiveProfile || isAdmin)
      ? {
          ...(effectiveProfile || {}),
          uid: session.user.uid,
          classId,
          role,
          teacherDisplayName,
        }
      : null;

    const userData =
      session.user && (effectiveProfile || isAdmin)
        ? {
            ...(effectiveProfile || {}),
            uid: session.user.uid,
            classId,
            role,
            teacherDisplayName,
          }
        : null;

    const shouldWaitForProfile = !!(
      session.user &&
      classId &&
      role &&
      role !== "admin" &&
      role !== "pending" &&
      !session.profileFallback
    );
    const isProfileLoading = !!(
      shouldWaitForProfile &&
      (!profileReady || !rawUserData)
    );
    const shouldWaitForClass = !!(
      session.user &&
      classId &&
      role &&
      role !== "pending"
    );
    const isClassLoading = !!(
      shouldWaitForClass &&
      !classReady
    );
    const finalLoading = !!(session.loading || isProfileLoading || isClassLoading);
    const permissionProfileReady = !!(
      !session.user ||
      !classId ||
      isAdmin ||
      isTeacher ||
      profileReady
    );

    return {
      userData,
      classId,
      classData,
      teacherDisplayName,
      studentList: canReadRoster ? studentList : [],
      studentRosterOnly: Number(classData?.studentRosterVersion) === 1,
      studentRosterError,
      studentRosterLoading,

      loading: finalLoading || authTransitioning,
      permissionProfileReady,
      user: session.user,
      isTeacher,
      isAdmin,
      accountOwnerData,
      canSwitchAccount,
      isAccountSwitching,
      pendingAccountSwitchPath,
      completeAccountSwitchRedirect,
      switchedStudentUid,
      switchToStudent,
      clearAccountSwitch,
      authTransitioning,

      currencyUnit,
      missionTokenLabel,
      formatCurrency: (amount) =>
        `${formatConfiguredMoney(amount, classData?.numberFormat)} ${currencyUnit}`,
      hasPermission,
    };
  }, [
    rawUserData,
    effectiveProfile,
    session,
    classData,
    studentList,
    studentRosterError,
    studentRosterLoading,
    hasPermission,
    classId,
    canAccessRoster,
    role,
    canSwitchAccount,
    isAccountSwitching,
    pendingAccountSwitchPath,
    completeAccountSwitchRedirect,
    switchedStudentUid,
    switchToStudent,
    clearAccountSwitch,
    switchOwnerData,
    authTransitioning,
    classReady,
    profileReady,
  ]);

  useFinclassSiteTools(value);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
