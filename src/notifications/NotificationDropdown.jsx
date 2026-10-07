import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  limit,
  getDocs,
  startAfter,
  where,
  writeBatch,
} from "firebase/firestore";
import { useUser } from "../contexts/UserContext";
import { useNotifications } from "../contexts/NotificationContext";
import { getNotificationConfig, NOTIFICATION_TYPES } from "./constants";
import { markCaseLibrarySeen } from "../pages/caseLibrary/services/caseLibraryReadStateService";
import { buildNotificationTargetPath } from "./notificationRoute";
import NotificationDropdownSurface from "./NotificationDropdownSurface";

const PAGE_SIZE = 10;
const DROPDOWN_EXCLUDED_NOTIFICATION_TYPES = new Set([
  NOTIFICATION_TYPES.POLICE_REPORT_NEW,
]);

const filterDropdownNotifications = (notifications) =>
  notifications.filter(
    (notification) => !DROPDOWN_EXCLUDED_NOTIFICATION_TYPES.has(notification?.type),
  );

const NotificationDropdown = () => {
  const { userData, classId, loading: userLoading } = useUser();
  const { unreadNoticeCount } = useNotifications();
  const navigate = useNavigate();
  const authUid = auth.currentUser?.uid || null;
  const resolvedUid = userData?.uid || authUid;
  const buttonRef = useRef(null);
  const scrollSnapshotRef = useRef(null);

  const [notifications, setNotifications] = useState([]);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isPanelActive, setIsPanelActive] = useState(false);
  const [panelStyle, setPanelStyle] = useState({});

  const getNotificationDocRef = useCallback(
    (uid, notificationId) =>
      doc(db, `classes/${classId}/students/${uid}/notifications/${notificationId}`),
    [classId],
  );

  const getNotificationsCollectionRef = useCallback(
    (uid) => collection(db, `classes/${classId}/students/${uid}/notifications`),
    [classId],
  );

  const markOneAsRead = useCallback(
    async (notificationId) => {
      if (!classId || !notificationId) return;

      const uidCandidates = [resolvedUid, authUid].filter(
        (uid, idx, arr) => !!uid && arr.indexOf(uid) === idx,
      );

      let lastError = null;
      for (const uid of uidCandidates) {
        try {
          await updateDoc(getNotificationDocRef(uid, notificationId), {
            isRead: true,
            readAt: serverTimestamp(),
          });
          return;
        } catch (error) {
          lastError = error;
          if (error?.code !== "permission-denied") break;
        }
      }

      if (lastError) throw lastError;
    },
    [authUid, classId, getNotificationDocRef, resolvedUid],
  );

  const markAllUnreadForUid = useCallback(
    async (uid) => {
      if (!classId || !uid) return [];

      const notificationsRef = getNotificationsCollectionRef(uid);
      const unreadQuery = query(notificationsRef, where("isRead", "==", false));
      const unreadSnapshot = await getDocs(unreadQuery);

      if (unreadSnapshot.empty) return [];

      const updatedIds = [];
      const docs = unreadSnapshot.docs;
      const BATCH_SIZE = 400;

      for (let index = 0; index < docs.length; index += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = docs.slice(index, index + BATCH_SIZE);

        chunk.forEach((docSnap) => {
          updatedIds.push(docSnap.id);
          batch.update(docSnap.ref, {
            isRead: true,
            readAt: serverTimestamp(),
          });
        });

        await batch.commit();
      }

      return updatedIds;
    },
    [classId, getNotificationsCollectionRef],
  );

  const updatePanelPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const edgePadding = 12;
    const gap = 10;
    const panelWidth = window.innerWidth >= 640 ? 384 : 320;
    const maxLeft = Math.max(
      edgePadding,
      window.innerWidth - panelWidth - edgePadding,
    );
    const left = Math.min(
      maxLeft,
      Math.max(edgePadding, rect.right - panelWidth),
    );
    const top = Math.max(edgePadding, rect.bottom + gap);
    setPanelStyle({
      left: `${left}px`,
      top: `${top}px`,
    });
  }, []);

  const captureScrollSnapshot = useCallback(() => {
    const mainEl = document.querySelector("main.overflow-y-auto");
    scrollSnapshotRef.current = {
      windowX: window.scrollX,
      windowY: window.scrollY,
      mainEl,
      mainTop: mainEl?.scrollTop ?? null,
      mainLeft: mainEl?.scrollLeft ?? null,
    };
  }, []);

  const focusButtonWithoutScroll = useCallback(() => {
    if (!buttonRef.current) return;
    try {
      buttonRef.current.focus({ preventScroll: true });
    } catch (_error) {
      buttonRef.current.focus();
    }
  }, []);

  const restoreScrollSnapshot = useCallback(() => {
    const snapshot = scrollSnapshotRef.current;
    if (!snapshot) return;

    const applySnapshot = () => {
      window.scrollTo(snapshot.windowX, snapshot.windowY);
      if (snapshot.mainEl && typeof snapshot.mainTop === "number") {
        snapshot.mainEl.scrollTo({
          top: snapshot.mainTop,
          left: snapshot.mainLeft ?? 0,
          behavior: "auto",
        });
      }
    };

    applySnapshot();
    requestAnimationFrame(applySnapshot);
    setTimeout(applySnapshot, 0);
    setTimeout(() => {
      applySnapshot();
      focusButtonWithoutScroll();
    }, 48);
  }, [focusButtonWithoutScroll]);

  useEffect(() => {
    const handleViewportChange = () => updatePanelPosition();
    window.addEventListener("resize", handleViewportChange);
    // capture scroll events from nested containers as well.
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [updatePanelPosition]);

  // Subscribe only while the panel is open.
  useEffect(() => {
    if (!isPanelActive) {
      setIsLoading(false);
      return undefined;
    }

    if (userLoading || !classId || !resolvedUid) {
      if (!userLoading) setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);

    const notificationsRef = collection(
      db,
      `classes/${classId}/students/${resolvedUid}/notifications`,
    );
    const q = query(
      notificationsRef,
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const notifs = filterDropdownNotifications(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })),
        );
        setNotifications(notifs);
        setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
        setHasMore(snapshot.docs.length === PAGE_SIZE);
        setIsLoading(false);
      },
      (error) => {
        console.error("Failed to subscribe notifications:", error);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [classId, isPanelActive, resolvedUid, userLoading]);

  // Pagination: load more notifications.
  const handleLoadMore = async (e) => {
    e.stopPropagation();
    if (!classId || !resolvedUid || !lastDoc || !hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const notificationsRef = collection(
        db,
        `classes/${classId}/students/${resolvedUid}/notifications`,
      );
      const q = query(
        notificationsRef,
        orderBy("createdAt", "desc"),
        startAfter(lastDoc),
        limit(PAGE_SIZE),
      );
      const snapshot = await getDocs(q);

      const newNotifs = filterDropdownNotifications(
        snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })),
      );
      setNotifications((prev) => [...prev, ...newNotifs]);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load more notifications:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Mark as read, then navigate to target path.
  const handleNotificationClick = async (notification) => {
    const config = getNotificationConfig(notification.type);
    const targetPath = buildNotificationTargetPath(notification, config.path);

    if (!notification.isRead) {
      try {
        await markOneAsRead(notification.id);
        setNotifications((prev) =>
          prev.map((item) =>
            item.id === notification.id
              ? {
                  ...item,
                  isRead: true,
                  readAt: item.readAt || new Date(),
                }
              : item,
          ),
        );
      } catch (error) {
        console.error("Failed to mark notification as read:", {
          code: error?.code,
          message: error?.message,
          classId,
          uid: resolvedUid,
          notificationId: notification?.id,
        });
      }
    }

    if (
      targetPath?.startsWith("/case-library") &&
      classId &&
      resolvedUid
    ) {
      void markCaseLibrarySeen({
        classId,
        uid: resolvedUid,
        path: String(targetPath).split("?")[0] || "/case-library",
      }).catch((error) => {
        console.error(
          "Failed to mark case library notification context as seen:",
          error,
        );
      });
    }

    if (targetPath) navigate(targetPath);
  };

  // Mark all unread items as read.
  const markAllAsRead = async () => {
    if (!classId || !resolvedUid) return;
    const uidCandidates = [resolvedUid, authUid].filter(
      (uid, idx, arr) => !!uid && arr.indexOf(uid) === idx,
    );

    let lastError = null;

    for (const uid of uidCandidates) {
      try {
        const updatedIds = await markAllUnreadForUid(uid);

        if (updatedIds.length > 0) {
          const updatedIdSet = new Set(updatedIds);
          setNotifications((prev) =>
            prev.map((notification) =>
              updatedIdSet.has(notification.id)
                ? {
                    ...notification,
                    isRead: true,
                  }
                : notification,
            ),
          );
        }

        return;
      } catch (error) {
        lastError = error;
        if (error?.code !== "permission-denied") break;
      }
    }

    if (lastError) {
      console.error("Failed to mark all notifications as read:", {
        code: lastError?.code,
        message: lastError?.message,
        classId,
        uid: resolvedUid,
      });
    }
  };

  return (
    <NotificationDropdownSurface
      buttonRef={buttonRef}
      panelStyle={panelStyle}
      unreadCount={unreadNoticeCount}
      notifications={notifications}
      hasMore={hasMore}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      onButtonMouseDown={() => {
        captureScrollSnapshot();
        updatePanelPosition();
      }}
      onButtonClick={updatePanelPosition}
      onBeforeEnter={() => {
        setIsPanelActive(true);
        captureScrollSnapshot();
        updatePanelPosition();
      }}
      onAfterEnter={updatePanelPosition}
      onBeforeLeave={restoreScrollSnapshot}
      onAfterLeave={() => {
        setIsPanelActive(false);
        restoreScrollSnapshot();
      }}
      onMarkAllRead={markAllAsRead}
      onNotificationClick={handleNotificationClick}
      onLoadMore={handleLoadMore}
    />
  );
};

export default NotificationDropdown;
