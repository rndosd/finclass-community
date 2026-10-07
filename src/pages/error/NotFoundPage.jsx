// src/pages/error/NotFoundPage.jsx

import React from "react";
import { Link } from "react-router-dom";
import { FileQuestion } from "lucide-react";
import KakaoInquiryFab from "../../components/support/KakaoInquiryFab";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_transparent_30%),linear-gradient(180deg,#f8fbff_0%,#eef4ff_42%,#f8fafc_100%)] px-4 text-center">
      <KakaoInquiryFab />
      <div className="w-full max-w-md rounded-[2rem] border border-blue-100 bg-white/90 p-10 shadow-xl shadow-blue-100/50">
        <FileQuestion className="mx-auto mb-4 h-16 w-16 text-slate-400" />
        <h1 className="mb-2 text-6xl font-bold text-slate-700">404</h1>
        <p className="mb-2 text-xl font-semibold text-slate-800">
          페이지를 찾을 수 없습니다
        </p>
        <p className="mb-6 text-slate-500">
          주소를 잘못 입력하셨거나, 페이지가 삭제되었을 수 있습니다.
        </p>
        <Link
          to="/"
          className="inline-flex rounded-xl bg-blue-600 px-6 py-3 font-medium text-white transition hover:bg-blue-700"
        >
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
