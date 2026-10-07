import { useCallback, useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./tutorial.css";

const TutorialContainer = ({ steps, tourKey, forceRun = false }) => {
  const driverRef = useRef(null);
  const waitTimerRef = useRef(null);
  const advanceTimerRef = useRef(null);
  const advanceCleanupRef = useRef(null);

  const clearWaitTimer = useCallback(() => {
    if (!waitTimerRef.current) return;
    window.clearTimeout(waitTimerRef.current);
    waitTimerRef.current = null;
  }, []);

  const clearAdvanceWatcher = useCallback(() => {
    if (advanceTimerRef.current) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }

    if (advanceCleanupRef.current) {
      advanceCleanupRef.current();
      advanceCleanupRef.current = null;
    }
  }, []);

  const waitForElement = useCallback((selector, callback, timeoutMs = 15000) => {
    if (!selector || typeof document === "undefined") return;

    clearWaitTimer();
    const startedAt = Date.now();

    const tick = () => {
      const element = document.querySelector(selector);
      if (element) {
        waitTimerRef.current = null;
        callback(element);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        waitTimerRef.current = null;
        return;
      }

      waitTimerRef.current = window.setTimeout(tick, 250);
    };

    tick();
  }, [clearWaitTimer]);

  const startAdvanceWatcher = useCallback((element, advanceOn, onAdvance) => {
    if (!element || !advanceOn) return;

    clearAdvanceWatcher();

    const inputElement =
      element.matches?.("input, textarea, select") || element.isContentEditable
        ? element
        : element.querySelector?.("input, textarea, select, [contenteditable='true']");

    if (!inputElement) return;

    const normalize = (value) => String(value ?? "").trim();
    const getValue = () =>
      inputElement.isContentEditable
        ? normalize(inputElement.textContent)
        : normalize(inputElement.value);

    const isSatisfied = () => {
      const value = getValue();
      if (advanceOn.equals !== undefined) {
        return value === String(advanceOn.equals);
      }

      if (advanceOn.minLength !== undefined) {
        return value.length >= Number(advanceOn.minLength);
      }

      if (advanceOn.numberMin !== undefined) {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue >= Number(advanceOn.numberMin);
      }

      return Boolean(value);
    };

    const scheduleAdvance = () => {
      if (advanceTimerRef.current) {
        window.clearTimeout(advanceTimerRef.current);
      }

      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null;
        if (isSatisfied()) {
          clearAdvanceWatcher();
          onAdvance?.();
        }
      }, advanceOn.delayMs ?? 700);
    };

    const handleValueChange = () => {
      if (isSatisfied()) {
        scheduleAdvance();
        return;
      }

      if (advanceTimerRef.current) {
        window.clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    };

    inputElement.addEventListener("input", handleValueChange);
    inputElement.addEventListener("change", handleValueChange);
    advanceCleanupRef.current = () => {
      inputElement.removeEventListener("input", handleValueChange);
      inputElement.removeEventListener("change", handleValueChange);
    };

    if (advanceOn.allowInitial === true) {
      handleValueChange();
    }
  }, [clearAdvanceWatcher]);

  useEffect(() => {
    const isCompleted = localStorage.getItem(`tutorial_${tourKey}`);
    if (isCompleted && !forceRun) return undefined;

    if (!steps || steps.length === 0) return undefined;

    try {
      const moveNextWhenTargetIsReady = (driverInstance, currentIndex) => {
        clearAdvanceWatcher();
        const currentStep = steps[currentIndex];
        const nextStep = steps[currentIndex + 1];
        const waitTarget = currentStep?.waitForTarget || nextStep?.target;

        if (!nextStep) {
          driverInstance.destroy();
          return;
        }

        if (!waitTarget || waitTarget === "body" || document.querySelector(waitTarget)) {
          driverInstance.moveNext();
          return;
        }

        waitForElement(
          waitTarget,
          () => {
            if (driverInstance.getActiveIndex() === currentIndex) {
              driverInstance.moveNext();
            }
          },
          currentStep?.waitTimeoutMs,
        );
      };

      driverRef.current = driver({
        showProgress: true,
        allowClose: true,
        overlayClickBehavior: "none",
        nextBtnText: "다음",
        prevBtnText: "이전",
        doneBtnText: "완료",
        steps: steps.map((step, index) => ({
          element: step.target === "body" || !step.target ? null : step.target,
          popover: { title: step.title, description: step.content },
          onHighlighted: (_element, _step, { driver: driverInstance }) => {
            clearWaitTimer();
            clearAdvanceWatcher();

            if (step.waitForTarget) {
              waitForElement(
                step.waitForTarget,
                () => {
                  if (driverInstance.getActiveIndex() === index) {
                    driverInstance.moveNext();
                  }
                },
                step.waitTimeoutMs,
              );
            }

            if (step.advanceOn) {
              startAdvanceWatcher(_element, step.advanceOn, () => {
                if (driverInstance.getActiveIndex() === index) {
                  moveNextWhenTargetIsReady(driverInstance, index);
                }
              });
            }
          },
        })),
        onNextClick: (_element, _step, { driver: driverInstance }) => {
          const currentIndex = driverInstance.getActiveIndex();
          moveNextWhenTargetIsReady(driverInstance, currentIndex);
        },
        onPrevClick: (_element, _step, { driver: driverInstance }) => {
          clearWaitTimer();
          clearAdvanceWatcher();
          driverInstance.movePrevious();
        },
        onDestroyed: () => {
          clearWaitTimer();
          clearAdvanceWatcher();
          if (!forceRun) localStorage.setItem(`tutorial_${tourKey}`, "true");
        },
      });
    } catch (_error) {
      return undefined;
    }

    const startTimer = setTimeout(() => {
      driverRef.current?.drive();
    }, 500);

    return () => {
      clearTimeout(startTimer);
      clearWaitTimer();
      clearAdvanceWatcher();
      if (driverRef.current) driverRef.current.destroy();
    };
  }, [
    clearAdvanceWatcher,
    clearWaitTimer,
    forceRun,
    startAdvanceWatcher,
    steps,
    tourKey,
    waitForElement,
  ]);

  return null;
};

export default TutorialContainer;
