import React from "react";

// A copied installation must not send its users to the original operator.
export default function KakaoInquiryFab({ className = "", label = "문의" }) {
  const value = String(process.env.REACT_APP_SUPPORT_URL || "").trim();
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:") return null;
  return <a className={`fixed bottom-5 left-5 z-50 rounded-lg bg-white px-4 py-2 text-sm font-semibold shadow ${className}`} href={url.href} target="_blank" rel="noreferrer">{label}</a>;
}
