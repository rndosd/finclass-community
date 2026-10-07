import React, { useState } from "react";
import { ArrowLeft, Crown, DoorOpen, ShieldCheck } from "lucide-react";

import vipLoungeCrestAsset from "../../../assets/vip/vip-lounge-crest-v1.webp";
import { formatVipRequirementLabel } from "../utils/vipLounge";

const TEXT = {
  back: "\uc0c1\uc810\uc73c\ub85c \ub3cc\uc544\uac00\uae30",
  defaultName: "VIP \ub77c\uc6b4\uc9c0",
  eyebrow: "PRIVATE LOUNGE",
  lead: "\uc120\uc0dd\ub2d8\uc774 \uc815\ud55c \uc785\uc7a5 \uae30\uc900\uc5d0 \ub530\ub77c \uc774\uc6a9\ud560 \uc218 \uc788\ub294 \uc804\uc6a9 \uacf5\uac04\uc785\ub2c8\ub2e4.",
  memberPass: "MEMBER PASS",
  teacherPass: "\uad50\uc0ac \uad00\ub9ac \uad8c\ud55c",
  allowedPass: "\uc785\uc7a5 \uac00\ub2a5",
  reviewPass: "\uad8c\ud55c \ud655\uc778 \ud544\uc694",
  teacherHelp: "\uad00\ub9ac\uc790 \uad8c\ud55c\uc73c\ub85c \ubc14\ub85c \uc785\uc7a5\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
  allowedHelp: "",
  reviewHelp: "\uc120\uc0dd\ub2d8\uc758 \uc548\ub0b4\ub97c \ud655\uc778\ud55c \ub4a4 \uc774\uc6a9\ud560 \uc218 \uc788\uc5b4\uc694.",
  statusReady: "\uc785\uc7a5 \uc900\ube44 \uc644\ub8cc",
  statusCode: "\ucd08\ub300 \ucf54\ub4dc \ud655\uc778",
  statusBlocked: "\uc785\uc7a5 \uad8c\ud55c \ud544\uc694",
  codeLabel: "\ucd08\ub300 \ucf54\ub4dc",
  codePlaceholder: "\ucd08\ub300 \ucf54\ub4dc\ub97c \uc785\ub825\ud558\uc138\uc694",
  blocked: "\uc544\uc9c1 \uc785\uc7a5 \uad8c\ud55c\uc774 \ud655\uc778\ub418\uc9c0 \uc54a\uc558\uc5b4\uc694.",
  blockedHelp: "\uc120\uc0dd\ub2d8\uc774 \uc815\ud55c \uc785\uc7a5 \uae30\uc900\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.",
  codeHelp: "\ucd08\ub300 \ucf54\ub4dc\ub294 \uc120\uc0dd\ub2d8\uc5d0\uac8c \ud655\uc778\ud574 \uc8fc\uc138\uc694.",
  wrongCode: "\ucd08\ub300 \ucf54\ub4dc\uac00 \ub9de\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.",
  enter: "\ub77c\uc6b4\uc9c0 \uc785\uc7a5",
  stepPermission: "\uad8c\ud55c \ud655\uc778",
  stepCode: "\ucf54\ub4dc \uc785\ub825",
  stepEnter: "\uc785\uc7a5 \uc644\ub8cc",
};

const VIP_DISPLAY_STYLE = { fontFamily: '"Gowun Batang", serif' };

const VipLoungeGate = ({
  lounge,
  isTeacher = false,
  hasAccess = false,
  onEnter,
  onBack,
}) => {
  const [entryCode, setEntryCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isOpening, setIsOpening] = useState(false);
  const expectedCode = String(lounge?.entryCode || "").trim();
  const requiresCode = !isTeacher && hasAccess && Boolean(expectedCode);
  const isBlocked = !isTeacher && !hasAccess;
  const requirementLabel = formatVipRequirementLabel(lounge);
  const activeStep = isBlocked ? 1 : requiresCode ? 2 : 3;

  const handleEnter = () => {
    if (isOpening || isBlocked) return;

    if (requiresCode && entryCode.trim() !== expectedCode) {
      setErrorMessage(TEXT.wrongCode);
      return;
    }

    setErrorMessage("");
    setIsOpening(true);
    window.setTimeout(() => onEnter?.(), 520);
  };

  const passTitle = isTeacher
    ? TEXT.teacherPass
    : hasAccess
      ? TEXT.allowedPass
      : TEXT.reviewPass;
  const passHelp = isTeacher
    ? TEXT.teacherHelp
    : hasAccess
      ? ""
      : TEXT.reviewHelp;
  const statusText = isBlocked
    ? TEXT.statusBlocked
    : requiresCode
      ? TEXT.statusCode
      : TEXT.statusReady;

  return (
    <section className="fixed inset-0 z-[100] lg:left-[var(--sidebar-width,16rem)] overflow-y-auto bg-[#05070c] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(199,158,76,0.14),transparent_32%),linear-gradient(180deg,#0b101c_0%,#05070c_52%,#020306_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#f0cc7a]/10 to-transparent" />
      <div className="pointer-events-none absolute inset-x-5 top-16 bottom-5 rounded-[5rem_5rem_0_0] border border-[#e7c873]/10" />
      <div className="pointer-events-none absolute inset-x-14 top-28 bottom-14 rounded-[4rem_4rem_0_0] border border-[#e7c873]/[0.06]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5 md:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-[#e5c77c]/50 hover:bg-white/[0.08] hover:text-[#f5dfa1]"
          >
            <ArrowLeft className="h-4 w-4" />
            {TEXT.back}
          </button>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#d8bc72]/35 bg-[#17130c]/75 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-[#f6dea0] shadow-lg shadow-black/20 backdrop-blur-md">
            <Crown className="h-4 w-4" />
            VIP Lounge
          </span>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center py-10 sm:py-12">
          <div className="w-full text-center">
            <p className="text-xs font-black uppercase tracking-[0.4em] text-[#e7c873]">
              {TEXT.eyebrow}
            </p>
            <h1
              style={VIP_DISPLAY_STYLE}
              className="mt-5 text-4xl font-bold leading-tight tracking-[0.01em] text-[#fff9e7] sm:text-5xl lg:text-6xl"
            >
              {lounge?.name || TEXT.defaultName}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm font-semibold leading-relaxed text-slate-300 sm:text-base">
              {TEXT.lead}
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleEnter();
            }}
            className="relative mt-10 w-full max-w-4xl overflow-hidden rounded-[2rem] border border-[#b89a56]/35 bg-[#0d111a]/90 shadow-[0_26px_80px_rgba(0,0,0,0.48)] backdrop-blur-xl"
          >
            <div className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-[#f4d98f] to-transparent" />
            <div className="grid lg:grid-cols-[240px_minmax(0,1fr)]">
              <div className="flex flex-col items-center justify-center border-b border-[#b89a56]/20 bg-[radial-gradient(circle_at_50%_20%,rgba(211,166,74,0.16),transparent_55%),rgba(6,9,15,0.55)] px-6 py-8 text-center lg:border-b-0 lg:border-r">
                                <div className="flex h-32 w-32 items-center justify-center">
                  <img
                    src={vipLoungeCrestAsset}
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full object-contain drop-shadow-[0_0_20px_rgba(231,200,115,0.28)]"
                  />
                </div>
                <p className="mt-6 text-[11px] font-black uppercase tracking-[0.26em] text-[#e9ce81]">
                  {TEXT.memberPass}
                </p>
                <h2
                  style={VIP_DISPLAY_STYLE}
                  className="mt-2 text-2xl font-bold text-[#fff9e7]"
                >
                  {passTitle}
                </h2>
                {passHelp ? (
                  <p className="mt-3 max-w-[190px] text-xs font-semibold leading-relaxed text-slate-400">
                    {passHelp}
                  </p>
                ) : null}
              </div>

              <div className="p-6 sm:p-8 lg:p-10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#e9ce81]">
                      {TEXT.memberPass}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-lg font-bold text-[#fff9e7]">
                      <ShieldCheck className="h-5 w-5 text-[#e6c673]" />
                      {statusText}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">{requirementLabel}</span>
                </div>

                {isBlocked ? (
                  <div className="mt-8 rounded-2xl border border-[#c39445]/25 bg-[#19150d]/70 px-5 py-5">
                    <p className="text-sm font-bold text-[#f3d994]">{TEXT.blocked}</p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">
                      {TEXT.blockedHelp}
                    </p>
                  </div>
                ) : requiresCode ? (
                  <div className="mt-8">
                    <label className="mb-2 block text-sm font-bold text-slate-200">
                      {TEXT.codeLabel}
                    </label>
                    <input
                      type="password"
                      value={entryCode}
                      onChange={(event) => {
                        setEntryCode(event.target.value);
                        setErrorMessage("");
                      }}
                      placeholder={TEXT.codePlaceholder}
                      className="h-14 w-full rounded-2xl border border-white/15 bg-black/30 px-4 text-center text-lg font-bold tracking-[0.18em] text-white outline-none transition focus:border-[#e8ca78] focus:ring-4 focus:ring-[#e8ca78]/10 placeholder:tracking-normal placeholder:text-slate-600"
                    />
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                      {TEXT.codeHelp}
                    </p>
                    {errorMessage ? (
                      <p className="mt-2 text-sm font-bold text-rose-200">
                        {errorMessage}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-8 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.08] px-5 py-5">
                    <p className="text-sm font-bold text-emerald-100">{TEXT.statusReady}</p>
                    {isTeacher && TEXT.teacherHelp ? (
                      <p className="mt-2 text-sm leading-relaxed text-slate-300">
                        {TEXT.teacherHelp}
                      </p>
                    ) : null}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isOpening || isBlocked}
                  className="mt-7 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-[#f3d78a]/55 bg-[linear-gradient(135deg,#f6dfa1,#c5973e)] px-5 font-bold text-[#171209] shadow-[0_12px_28px_rgba(184,133,38,0.24),inset_0_1px_0_rgba(255,255,255,0.75)] transition hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <DoorOpen className="h-5 w-5" />
                  {isOpening ? TEXT.statusReady : TEXT.enter}
                </button>
              </div>
            </div>
          </form>

          <div className="relative mt-10 grid w-full max-w-4xl gap-3 sm:grid-cols-3">
            <div className="pointer-events-none absolute left-[16%] right-[16%] top-5 hidden h-px bg-gradient-to-r from-[#e7c873] via-[#6b6048] to-[#6b6048] sm:block" />
            {[
              ["01", TEXT.stepPermission],
              ["02", TEXT.stepCode],
              ["03", TEXT.stepEnter],
            ].map(([number, label], index) => {
              const isActive = activeStep === index + 1;
              const isComplete = activeStep > index + 1;
              return (
                <div key={number} className="relative z-10 flex flex-col items-center gap-2 text-center">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-full border text-xs font-black transition ${
                      isActive || isComplete
                        ? "border-[#e8c976] bg-[#1a160d] text-[#f2d88e] shadow-[0_0_22px_rgba(224,179,72,0.2)]"
                        : "border-white/15 bg-[#0b0e15] text-slate-500"
                    }`}
                  >
                    {number}
                  </span>
                  <span className={`text-xs font-bold ${isActive || isComplete ? "text-[#f1d78c]" : "text-slate-500"}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {isOpening ? (
        <div className="pointer-events-none absolute inset-0 z-[110] flex items-center justify-center bg-[#e9c86e]/10 backdrop-blur-[2px]">
          <div className="h-px w-2/3 max-w-3xl animate-pulse bg-gradient-to-r from-transparent via-[#f8e3a1] to-transparent shadow-[0_0_60px_rgba(251,191,36,0.85)]" />
        </div>
      ) : null}
    </section>
  );
};

export default VipLoungeGate;
