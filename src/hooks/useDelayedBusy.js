import { useEffect, useRef, useState } from "react";

const clearTimer = (timerRef) => {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
};

export function useDelayedBusy(busy, options = {}) {
  const { delay = 120, minVisible = 320 } = options;
  const [isVisible, setIsVisible] = useState(false);
  const shownAtRef = useRef(0);
  const showTimerRef = useRef(null);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    if (busy) {
      clearTimer(hideTimerRef);

      if (isVisible) {
        return undefined;
      }

      if (delay <= 0) {
        shownAtRef.current = Date.now();
        setIsVisible(true);
        return undefined;
      }

      showTimerRef.current = setTimeout(() => {
        shownAtRef.current = Date.now();
        setIsVisible(true);
        showTimerRef.current = null;
      }, delay);

      return () => {
        clearTimer(showTimerRef);
      };
    }

    clearTimer(showTimerRef);

    if (!isVisible) {
      return undefined;
    }

    const elapsed = Date.now() - shownAtRef.current;
    const remaining = Math.max(minVisible - elapsed, 0);

    hideTimerRef.current = setTimeout(() => {
      shownAtRef.current = 0;
      setIsVisible(false);
      hideTimerRef.current = null;
    }, remaining);

    return () => {
      clearTimer(hideTimerRef);
    };
  }, [busy, delay, isVisible, minVisible]);

  useEffect(
    () => () => {
      clearTimer(showTimerRef);
      clearTimer(hideTimerRef);
    },
    [],
  );

  return isVisible;
}

export default useDelayedBusy;
