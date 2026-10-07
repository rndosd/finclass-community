import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "../firebase";
import { useUser } from "./UserContext";

const EMPTY_SHORTCUTS = Object.freeze([]);
const ShortcutDataContext = createContext(null);

export function ShortcutDataProvider({ children }) {
  const { classId, userData, authTransitioning } = useUser();
  const isTeacher = userData?.role === "teacher";
  const uid = userData?.uid;
  const [shortcuts, setShortcuts] = useState(EMPTY_SHORTCUTS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (authTransitioning || !classId || !uid || !isTeacher) {
      setShortcuts(EMPTY_SHORTCUTS);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const shortcutsRef = collection(
      db,
      "classes",
      classId,
      "displaySettings",
      "dashboard",
      "shortcuts",
    );
    const shortcutsQuery = query(shortcutsRef, orderBy("order", "asc"));
    let cancelled = false;

    const unsubscribe = onSnapshot(
      shortcutsQuery,
      (snapshot) => {
        if (cancelled) return;
        setShortcuts(
          snapshot.docs.map((shortcutDoc) => ({
            id: shortcutDoc.id,
            ...shortcutDoc.data(),
          })),
        );
        setLoading(false);
      },
      (error) => {
        if (cancelled) return;
        console.error("[ShortcutData] shortcut subscription failed:", error);
        setShortcuts(EMPTY_SHORTCUTS);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [authTransitioning, classId, isTeacher, uid]);

  const value = useMemo(() => ({ shortcuts, loading }), [loading, shortcuts]);

  return (
    <ShortcutDataContext.Provider value={value}>
      {children}
    </ShortcutDataContext.Provider>
  );
}

export function useShortcutData() {
  return useContext(ShortcutDataContext) || {
    shortcuts: EMPTY_SHORTCUTS,
    loading: false,
  };
}
