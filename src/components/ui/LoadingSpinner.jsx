import React from "react";
import Spinner from "./Spinner";
import SurfaceLoader from "./SurfaceLoader";
import { useDelayedBusy } from "../../hooks/useDelayedBusy";

const cx = (...classes) => classes.filter(Boolean).join(" ");
const DEFAULT_ACTION_MESSAGE = "\uCC98\uB9AC \uC911\u2026";
const DEFAULT_LOADING_MESSAGE = "\uBD88\uB7EC\uC624\uB294 \uC911\u2026";

function InlineLoadingSpinner({
  open,
  message,
  className,
  size,
  tone,
  delay,
  minVisible,
}) {
  const resolvedInlineMessage = message || DEFAULT_ACTION_MESSAGE;
  const isVisible = useDelayedBusy(open, { delay, minVisible });

  if (!isVisible) {
    return null;
  }

  return (
    <div className={cx("inline-flex items-center justify-center", className)}>
      <Spinner size={size} tone={tone} message={message} label={resolvedInlineMessage} />
    </div>
  );
}

export default function LoadingSpinner({
  open = true,
  full = false,
  fullScreen = false,
  message = "",
  overlayClassName = "",
  className = "",
  size = "md",
  tone = "indigo",
  delay = 120,
  minVisible = 320,
}) {
  const isFull = full || fullScreen;

  if (isFull) {
    return (
      <SurfaceLoader
        loading={open}
        variant="app-blocking"
        message={message || DEFAULT_LOADING_MESSAGE}
        tone={tone}
        size={size === "md" ? "lg" : size}
        className={className}
        overlayClassName={overlayClassName}
        delay={delay}
        minVisible={minVisible}
      />
    );
  }

  return (
    <InlineLoadingSpinner
      open={open}
      message={message}
      className={className}
      size={size}
      tone={tone}
      delay={delay}
      minVisible={minVisible}
    />
  );
}
