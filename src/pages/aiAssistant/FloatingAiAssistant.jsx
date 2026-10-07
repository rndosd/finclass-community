import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { Bot, LoaderCircle, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { Button } from "../../components/ui";
import { usePlanConfig } from "../../contexts/PlanConfigContext";
import { useUser } from "../../contexts/UserContext";
import { functions } from "../../firebase";
import CashChangeAnswerCard from "./components/CashChangeAnswerCard";
const EXAMPLE_QUESTION = "김민수 현금이 최근 7일 동안 왜 줄었어?";
const createMessageId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
function PlainAssistantMessage({
  text
}) {
  return <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
      {String(text || "답변을 만들지 못했습니다. 질문을 조금 더 구체적으로 입력해주세요.")}
    </div>;
}
export default function FloatingAiAssistant() {
  const {
    userData,
    classId
  } = useUser();
  const {
    currentPlan,
    loading: planLoading
  } = usePlanConfig();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [isAnswering, setIsAnswering] = useState(false);
  const [activeContext, setActiveContext] = useState(null);
  const [hasBlockingDialog, setHasBlockingDialog] = useState(false);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const requestSequenceRef = useRef(0);
  const normalizedPlan = String(currentPlan || "").toUpperCase();
  const useJev = false;
  const canUseAssistant = userData?.role === "teacher" && !planLoading && (normalizedPlan === "AI_PRO" || false);
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (canUseAssistant) return;
    setOpen(false);
  }, [canUseAssistant]);
  useEffect(() => {
    requestSequenceRef.current += 1;
    setOpen(false);
    setInput("");
    setMessages([]);
    setIsAnswering(false);
    setActiveContext(null);
  }, [classId, userData?.uid]);
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 120);
    const handleKeyDown = event => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth"
    });
  }, [isAnswering, messages, open]);
  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 639px)");
    const syncBlockingDialog = () => {
      setHasBlockingDialog(mobileViewport.matches && Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')));
    };
    syncBlockingDialog();
    const observer = new MutationObserver(syncBlockingDialog);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    mobileViewport.addEventListener("change", syncBlockingDialog);
    return () => {
      observer.disconnect();
      mobileViewport.removeEventListener("change", syncBlockingDialog);
    };
  }, []);
  if (!canUseAssistant) return null;
  const pushQuestion = async question => {
    const trimmed = String(question || "").trim();
    if (!trimmed || isAnswering || !classId) return;
    const pendingMessageId = createMessageId("assistant-pending");
    setMessages(previous => [...previous, {
      id: createMessageId("user"),
      role: "user",
      text: trimmed
    }, {
      id: pendingMessageId,
      role: "assistant",
      pending: true,
      text: "학급 기록에서 근거를 확인하고 있습니다."
    }]);
    setIsAnswering(true);
    const requestSequence = ++requestSequenceRef.current;
    try {
      const chat = httpsCallable(functions, "chatWithAgentAssistant");
      const result = await chat({
        classId,
        message: trimmed,
        activeContext,
        ...{}
      });
      if (requestSequence !== requestSequenceRef.current) return;
      const response = result.data || {};
      const supportsCashChange = response.questionCapability === "assets.explain_cash_change";
      const resolvedStudent = response.route?.routes?.[0]?.subjects?.find(({
        type
      }) => type === "student");
      if (supportsCashChange && resolvedStudent?.id) {
        setActiveContext({
          studentUid: resolvedStudent.id,
          student: {
            uid: resolvedStudent.id,
            name: resolvedStudent.label || null
          }
        });
      } else if (supportsCashChange && response.route?.status === "needs_clarification") {
        setActiveContext({
          pendingCapability: "assets.explain_cash_change",
          pendingQuestion: trimmed
        });
      }
      setMessages(previous => previous.map(message => message.id === pendingMessageId ? {
        ...message,
        pending: false,
        text: supportsCashChange || false ? response.content : "현재는 학생 현금 변화 분석을 지원합니다. 학생 이름이나 번호와 기간 선택을 포함해 질문해주세요.",
        answerEnvelope: supportsCashChange ? response.answerEnvelope || null : null,
        recordsTruncated: response.recordsTruncated === true,
        recordsUnavailable: response.recordsUnavailable === true,
        jev: null
      } : message));
    } catch (error) {
      if (requestSequence !== requestSequenceRef.current) return;
      console.error("[FloatingAiAssistant] chat failed:", error);
      setMessages(previous => previous.map(message => message.id === pendingMessageId ? {
        ...message,
        pending: false,
        error: true,
        text: "답변을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."
      } : message));
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setIsAnswering(false);
      }
    }
  };
  const handleSubmit = event => {
    event.preventDefault();
    const question = input;
    setInput("");
    void pushQuestion(question);
  };
  const panel = <>
      {!open && !hasBlockingDialog ? <Button type="button" className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-xl shadow-slate-500/30 transition hover:scale-105 hover:bg-indigo-700 sm:z-[140]" onClick={() => setOpen(true)} aria-label="AI 도우미 열기">
          <Bot className="h-6 w-6" />
        </Button> : null}

      
    </>;
  return createPortal(panel, document.body);
}
