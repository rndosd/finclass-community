import React from "react";
import gallery from "../../../assets/dashboard/home-title-gallery-v5.webp";
import "../homeCards.css";

// Home presentation only. The equipped title records and editor remain unchanged.
export default function HomeTitleGallery({ className, studentName, primaryTitle, secondaryTitle, onOpenTitles }) {
  return <section className="fc-home-title-gallery fc-home-title-gallery--reference" aria-label="대표 칭호 전시대">
    <img src={gallery} alt="" aria-hidden="true" />
    <div className="fc-home-gallery-greeting">
      <p>{className || "나의 학급"}</p>
      <h1>{studentName}님,<span>환영합니다</span></h1>
    </div>
    <button type="button" className="fc-home-gallery-title fc-home-gallery-title--gold" onClick={onOpenTitles} aria-label={`대표 칭호 설정: ${primaryTitle?.name || "칭호 선택"}`}>
      <span>{primaryTitle?.name || "칭호 선택"}</span>
    </button>
    <button type="button" className="fc-home-gallery-title fc-home-gallery-title--navy" onClick={onOpenTitles} aria-label={`두 번째 대표 칭호 설정: ${secondaryTitle?.name || "칭호 선택"}`}>
      <span>{secondaryTitle?.name || "칭호 선택"}</span>
    </button>
  </section>;
}
