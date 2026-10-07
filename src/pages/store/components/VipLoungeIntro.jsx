import React, { useMemo } from "react";
import "@fontsource/gowun-batang/korean-400.css";
import "@fontsource/gowun-batang/korean-700.css";
import "@fontsource/gowun-batang/latin-400.css";
import "@fontsource/gowun-batang/latin-700.css";
import { ArrowRight, Crown, Gem, ShieldCheck, Sparkles } from "lucide-react";

import vipLearningAsset from "../../../assets/vip/vip-benefit-learning-v1.webp";
import vipPriorityAsset from "../../../assets/vip/vip-benefit-priority-v1.webp";
import vipRewardAsset from "../../../assets/vip/vip-benefit-reward-v1.webp";
import vipLoungeDeskAsset from "../../../assets/vip/vip-lounge-desk-v1.webp";
import { sanitizeRichHtml } from "../../../utils/sanitizeRichHtml";
import { formatVipRequirementLabel, stripHtmlToText } from "../utils/vipLounge";

const VIP_DISPLAY_STYLE = {
  fontFamily: '"Gowun Batang", serif',
};

const TEXT = {
  defaultName: "VIP \uB77C\uC6B4\uC9C0",
  intro:
    "\uC120\uC0DD\uB2D8\uC774 \uC815\uD55C \uC785\uC7A5 \uAE30\uC900\uC5D0 \uB530\uB77C \uC774\uC6A9\uD560 \uC218 \uC788\uB294 \uD2B9\uBCC4\uD55C \uACF5\uAC04\uC785\uB2C8\uB2E4. \uB77C\uC6B4\uC9C0 \uC548\uB0B4\uB97C \uD655\uC778\uD558\uACE0 \uC804\uC6A9 \uC0C1\uD488\uC744 \uB9CC\uB098 \uBCF4\uC138\uC694.",
  storyFallback:
    "\uC120\uC0DD\uB2D8\uC774 \uC900\uBE44\uD55C \uB77C\uC6B4\uC9C0 \uC18C\uAC1C\uC640 \uC774\uC6A9 \uC548\uB0B4\uB97C \uD655\uC778\uD574 \uBCF4\uC138\uC694.",
  benefitsFallback:
    "\uC120\uC0DD\uB2D8\uC774 \uC791\uC131\uD55C \uC774\uC6A9 \uAE30\uAC04, \uCC38\uC5EC \uBC29\uBC95, \uC720\uC758\uC0AC\uD56D\uC774 \uD45C\uC2DC\uB429\uB2C8\uB2E4.",
  approved: "\uC785\uC7A5 \uC2B9\uC778",
  productAccess: "\uC804\uC6A9 \uC0C1\uD488 \uC774\uC6A9 \uAC00\uB2A5",
  viewProducts: "\uC804\uC6A9 \uC0C1\uD488 \uB458\uB7EC\uBCF4\uAE30",
  representativeImage: "\uB77C\uC6B4\uC9C0 \uB300\uD45C \uC774\uBBF8\uC9C0",
  storyTitle: "\uB77C\uC6B4\uC9C0 \uC774\uC57C\uAE30",
  benefitsTitle: "\uB77C\uC6B4\uC9C0 \uC774\uC6A9 \uC548\uB0B4",
};

const loungeBenefits = [
  {
    title: "\uD559\uC2B5 \uC751\uC6D0 \uD61C\uD0DD",
    description: "VIP \uB77C\uC6B4\uC9C0\uC5D0\uC11C\uB9CC \uB9CC\uB098\uB294 \uD2B9\uBCC4\uD55C \uC548\uB0B4",
    asset: vipLearningAsset,
  },
  {
    title: "\uC6B0\uC120 \uCC38\uC5EC \uAE30\uD68C",
    description: "\uB77C\uC6B4\uC9C0 \uC774\uC6A9 \uB300\uC0C1\uC5D0\uAC8C \uBA3C\uC800 \uC54C\uB824\uC8FC\uB294 \uC18C\uC2DD",
    asset: vipPriorityAsset,
  },
  {
    title: "\uC804\uC6A9 \uC0C1\uD488 \uC548\uB0B4",
    description: "\uC120\uC0DD\uB2D8\uC774 \uC900\uBE44\uD55C \uB77C\uC6B4\uC9C0 \uC804\uC6A9 \uC0C1\uD488",
    asset: vipRewardAsset,
  },
];

const RichBlock = ({ title, html, fallback }) => {
  const safeHtml = useMemo(() => sanitizeRichHtml(html), [html]);
  const hasContent = stripHtmlToText(safeHtml).length > 0;

  return (
    <section className="min-w-0 rounded-3xl border border-[#b89a56]/20 bg-[linear-gradient(135deg,rgba(255,255,255,0.065),rgba(255,255,255,0.018))] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:p-6">
      <p style={VIP_DISPLAY_STYLE} className="font-serif text-sm font-semibold tracking-[0.06em] text-[#e8cf8a]">{title}</p>
      {hasContent ? (
        <div
          className="vip-lounge-rich mt-4 text-sm leading-relaxed text-slate-100"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-slate-300">{fallback}</p>
      )}
    </section>
  );
};

const VipBenefitCard = ({ asset, title, description }) => (
  <article className="group relative min-w-0 overflow-hidden rounded-3xl border border-[#b89a56]/20 bg-[#151516]/90 px-4 py-5 shadow-[0_14px_30px_rgba(0,0,0,0.22)] transition duration-300 hover:-translate-y-0.5 hover:border-[#dfc37a]/45 hover:bg-[#1a1a1b] sm:px-5">
    <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[#efd690]/60 to-transparent opacity-60" />
    <div className="flex items-center gap-4">
      <img
        src={asset}
        alt=""
        aria-hidden="true"
        className="h-16 w-16 shrink-0 object-contain transition duration-300 group-hover:scale-105"
      />
      <div className="min-w-0">
        <h3 style={VIP_DISPLAY_STYLE} className="font-serif text-base font-bold tracking-[0.01em] text-[#fff8df]">{title}</h3>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-400">{description}</p>
      </div>
    </div>
  </article>
);

const VipLoungeIntro = ({ lounge, onViewProducts }) => {
  const requirementLabel = formatVipRequirementLabel(lounge);
  const heroImageUrl = lounge?.loungeImageUrl || vipLoungeDeskAsset;
  const loungeName = lounge?.name || TEXT.defaultName;
  const loungeTagline = lounge?.loungeTagline?.trim() || TEXT.intro;

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-[#b89a56]/30 bg-[#0c0c0d] text-white shadow-[0_28px_80px_rgba(0,0,0,0.48)]">
      <div className="relative min-h-[470px] overflow-hidden sm:min-h-[500px] lg:min-h-[530px]">
        <img
          src={heroImageUrl}
          alt={`${loungeName} ${TEXT.representativeImage}`}
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,0.18),rgba(3,5,10,0.52)_44%,rgba(3,5,10,0.9)),linear-gradient(90deg,rgba(2,4,8,0.1),rgba(2,4,8,0.08)_45%,rgba(2,4,8,0.86))] lg:bg-[linear-gradient(90deg,rgba(2,4,8,0.12),rgba(2,4,8,0.02)_38%,rgba(2,4,8,0.9)),linear-gradient(180deg,rgba(3,5,10,0.18),transparent_52%,rgba(3,5,10,0.48))]" />
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#f2d88f]/70 to-transparent" />

        <div className="relative flex min-h-[470px] items-end px-5 py-7 sm:min-h-[500px] sm:px-8 sm:py-9 lg:min-h-[530px] lg:items-center lg:px-10 lg:py-12">
          <div className="w-full max-w-xl lg:ml-auto lg:max-w-md">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#ddbf6d]/35 bg-[#0e1017]/75 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-[#f7dfa0] backdrop-blur-md">
                <Crown className="h-3.5 w-3.5" />
                VIP Lounge
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-bold text-emerald-100 backdrop-blur-md">
                <ShieldCheck className="h-3.5 w-3.5" />
                {TEXT.approved}
              </span>
            </div>

            <h1 style={VIP_DISPLAY_STYLE} className="mt-5 font-serif text-4xl font-bold leading-tight tracking-[0.01em] text-[#fff9e7] drop-shadow-[0_4px_18px_rgba(0,0,0,0.8)] sm:text-[2.45rem] lg:text-[2.7rem]">
              {loungeName}
            </h1>
            <p className="mt-4 max-w-xl text-sm font-semibold leading-relaxed text-slate-200 drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)] sm:text-base">{loungeTagline}</p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0b0d13]/70 px-3.5 py-2 text-xs font-bold text-slate-100 backdrop-blur-md">
                <Gem className="h-4 w-4 text-[#e6c86f]" />
                {requirementLabel}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0b0d13]/70 px-3.5 py-2 text-xs font-bold text-slate-100 backdrop-blur-md">
                <Sparkles className="h-4 w-4 text-[#e6c86f]" />
                {TEXT.productAccess}
              </span>
            </div>

            <button
              type="button"
              onClick={onViewProducts}
              style={VIP_DISPLAY_STYLE}
              className="group mt-7 inline-flex items-center gap-2 rounded-2xl border border-[#f2d88f]/45 bg-[linear-gradient(135deg,#f6e1a6,#c99b42)] px-5 py-3 font-serif text-base font-bold tracking-[0.01em] text-[#1a150a] shadow-[0_10px_28px_rgba(177,128,37,0.3),inset_0_1px_0_rgba(255,255,255,0.8)] transition hover:-translate-y-0.5 hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f5d97f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0d]"
            >
              {TEXT.viewProducts}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="relative p-5 sm:p-7 lg:p-9">
        <div className="grid gap-3 md:grid-cols-3">
          {loungeBenefits.map((benefit) => (
            <VipBenefitCard key={benefit.title} {...benefit} />
          ))}
        </div>

        <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <RichBlock
            title={TEXT.storyTitle}
            html={lounge?.loungeDescriptionHtml}
            fallback={TEXT.storyFallback}
          />
          <RichBlock
            title={TEXT.benefitsTitle}
            html={lounge?.benefitsHtml}
            fallback={TEXT.benefitsFallback}
          />
        </div>
      </div>
    </section>
  );
};

export default VipLoungeIntro;