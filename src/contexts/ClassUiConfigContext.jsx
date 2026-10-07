import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { normalizeSidebarSettings, readCachedSidebarSettings } from "./classUiConfigCache";
const resolveSelfhostSidebarSettings = () => {
  throw new Error("Experimental provider is excluded from this installation.");
};
const ClassUiConfigContext = createContext(null);
const ClassUiConfigSourceContext = createContext(null);
export function ClassUiConfigProvider({
  children,
  classId,
  provider = "firebase",
  sidebarSettings: explicitSidebarSettings = null
}) {
  const inheritedSource = useContext(ClassUiConfigSourceContext);
  const canReuseInheritedConfig = provider === "firebase" && explicitSidebarSettings === null && inheritedSource?.provider === "firebase" && inheritedSource?.classId === classId;
  if (canReuseInheritedConfig) {
    return children;
  }
  return <ClassUiConfigBoundary classId={classId} provider={provider} sidebarSettings={explicitSidebarSettings}>
      {children}
    </ClassUiConfigBoundary>;
}
function ClassUiConfigBoundary({
  children,
  classId,
  provider,
  sidebarSettings: explicitSidebarSettings
}) {
  const isSelfhost = false;
  const [sidebarSettings, setSidebarSettings] = useState(() => {
    if (!classId) return {};
    return readCachedSidebarSettings(classId);
  });
  useEffect(() => {
    if (!classId) {
      setSidebarSettings({});
      return undefined;
    }
    const cachedSettings = readCachedSidebarSettings(classId);
    setSidebarSettings(cachedSettings ?? null);
    let disposed = false;
    let unsubscribe = null;
    import("./classUiConfigFirebaseAdapter").then(({
      retainFirebaseClassUiConfigSubscription
    }) => {
      if (disposed) return;
      unsubscribe = retainFirebaseClassUiConfigSubscription({
        classId,
        onSettings: setSidebarSettings
      });
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [classId, explicitSidebarSettings, false]);
  const value = useMemo(() => ({
    sidebarSettings: normalizeSidebarSettings(sidebarSettings),
    menuTitleSettings: normalizeSidebarSettings(sidebarSettings),
    loading: sidebarSettings === null
  }), [sidebarSettings]);
  return <ClassUiConfigSourceContext.Provider value={{
    classId,
    provider
  }}>
      <ClassUiConfigContext.Provider value={value}>
        {children}
      </ClassUiConfigContext.Provider>
    </ClassUiConfigSourceContext.Provider>;
}
export function useClassUiConfig() {
  const context = useContext(ClassUiConfigContext);
  if (!context) {
    return {
      sidebarSettings: null,
      menuTitleSettings: null,
      loading: true
    };
  }
  return context;
}
