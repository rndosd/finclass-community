import React, { createContext, useContext, useCallback } from "react";
import { toast } from "react-toastify";
import "./feedbackToast.css";

const FeedbackContext = createContext(null);

const FEEDBACK_TONES = {
  success: { background: "linear-gradient(135deg, #d1fae5, #e8faf0)", border: "#86d9ad", accent: "#047857" },
  error: { background: "linear-gradient(135deg, #ffe0e5, #fff0f2)", border: "#f5a3b2", accent: "#be123c" },
  warning: { background: "linear-gradient(135deg, #ffedb0, #fff6d7)", border: "#e7bb53", accent: "#92400e" },
  info: { background: "linear-gradient(135deg, #dbeafe, #eff6ff)", border: "#93c5fd", accent: "#1d4ed8" },
};

function FeedbackMessage({ message }) {
  if (typeof message !== "string") return message;
  const [title, ...description] = message.split(/\r?\n/);
  return <div className="finclass-feedback-message">
    <strong className="finclass-feedback-title">{title}</strong>
    {description.length > 0 && <div className="finclass-feedback-description">{description.join("\n")}</div>}
  </div>;
}

const normalizeFeedbackMessage = (message) => {
  if (typeof message !== "string") return message;

  try {
    return message.normalize("NFC");
  } catch (_error) {
    return message;
  }
};

export const FeedbackProvider = ({ children }) => {
  const showFeedback = useCallback(
    (message, variant = "info", options = {}) => {
      const normalizedMessage = normalizeFeedbackMessage(message);
      const tone = FEEDBACK_TONES[variant] || FEEDBACK_TONES.info;
      const messageLength = typeof normalizedMessage === "string" ? normalizedMessage.length : 0;
      const defaultDuration = variant === "error" || variant === "warning" ? 6000 : 3500;
      const { style: customStyle, progressStyle: customProgressStyle, className: customClassName, ...customOptions } = options;
      const commonOptions = {
        containerId: "global-toaster",
        position: "top-right",
        autoClose: Math.min(12000, Math.max(defaultDuration, messageLength * 70)),
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        theme: "light",
        newestOnTop: true,
        style: {
          borderRadius: "14px",
          boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)",
          border: `1px solid ${tone.border}`,
          background: tone.background,
          color: "#1e293b",
          "--feedback-accent": tone.accent,
          fontSize: "14px",
          fontWeight: "500",
          padding: "16px 18px",
          minHeight: "74px",

          // ✨ [수정됨] 단어 끊김 방지 및 줄바꿈 처리
          wordBreak: "keep-all", // 단어 단위로 줄바꿈 (한글 필수)
          whiteSpace: "pre-wrap", // \n 줄바꿈 인식 및 자동 줄바꿈 허용
          lineHeight: "1.5", // 줄 간격도 살짝 넓혀 가독성 확보
          overflowWrap: "anywhere",
          ...customStyle,
        },
        progressStyle: {
          background: tone.accent,
          height: "3px",
          borderRadius: "0 0 16px 16px",
          ...customProgressStyle,
        },
        className: typeof customClassName === "function"
          ? (context) => `${customClassName(context)} finclass-feedback-toast`
          : `finclass-feedback-toast ${customClassName || ""}`,
        ...customOptions,
      };
      const notify = variant === "success" ? toast.success : variant === "error" ? toast.error : variant === "warning" ? toast.warn : toast.info;
      // Preserve custom React content/functions; only format plain string messages.
      notify(typeof normalizedMessage === "string" ? <FeedbackMessage message={normalizedMessage} /> : normalizedMessage, commonOptions);
    },
    [],
  );

  const clearFeedback = useCallback(() => {
    toast.clearWaitingQueue({ containerId: "global-toaster" });
    toast.dismiss();
  }, []);

  return (
    <FeedbackContext.Provider value={{ showFeedback, clearFeedback }}>
      {children}
    </FeedbackContext.Provider>
  );
};

export const useFeedback = () => {
  const ctx = useContext(FeedbackContext);
  if (!ctx)
    throw new Error("useFeedback must be used within a FeedbackProvider");
  return ctx;
};
