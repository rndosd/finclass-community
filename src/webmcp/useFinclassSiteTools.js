import { useEffect, useRef } from "react";

import { registerFinclassSiteTools } from "./finclassSiteTools";

export const useFinclassSiteTools = (context) => {
  const contextRef = useRef(context);
  contextRef.current = {
    ...context,
    currentPath:
      typeof window === "undefined"
        ? "/"
        : `${window.location.pathname}${window.location.search}${window.location.hash}`,
  };

  const role = String(context?.userData?.role || "");
  const canRegister = Boolean(
    !context?.loading &&
      context?.classId &&
      ["teacher", "admin"].includes(role) &&
      !context?.isAccountSwitching,
  );
  const userUid = context?.userData?.uid || null;

  useEffect(() => {
    if (!canRegister || typeof document === "undefined") return undefined;
    const modelContext = document.modelContext;
    if (typeof modelContext?.registerTool !== "function") return undefined;

    let disposed = false;
    let unregister = null;

    void registerFinclassSiteTools({
      modelContext,
      getContext: () => contextRef.current,
    })
      .then((cleanup) => {
        if (disposed) {
          void cleanup();
          return;
        }
        unregister = cleanup;
      })
      .catch((error) => {
        console.warn("[WebMCP] 핀클래스 Site tools 등록에 실패했습니다.", error);
      });

    return () => {
      disposed = true;
      if (unregister) void unregister();
    };
  }, [canRegister, userUid]);
};
