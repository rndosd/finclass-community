import React from "react";
import { Link } from "react-router-dom";
import KakaoInquiryFab from "../../components/support/KakaoInquiryFab";

export default function LandingPage() {
  return <main className="mx-auto max-w-4xl space-y-6 px-6 py-16 text-slate-800">
    <h1 className="text-3xl font-bold">핀클래스 학급 경제</h1>
    <p>교사와 학생이 미션, 은행, 상점과 거래 기록을 함께 사용하는 학급 경제 앱입니다.</p>
    <p>이 사이트는 별도로 설치한 운영 환경입니다. 계정과 학급 데이터는 이 사이트의 운영자가 관리합니다.</p>
    <nav className="flex flex-wrap gap-4">
      <Link className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white" to="/login">로그인</Link>
      <Link className="rounded-lg border px-4 py-2" to="/signup/teacher">교사 가입</Link>
      <Link className="px-4 py-2 text-blue-700 underline" to="/privacy">개인정보 처리 안내</Link>
      <Link className="px-4 py-2 text-blue-700 underline" to="/support-info">운영 안내</Link>
    </nav>
    <KakaoInquiryFab />
  </main>;
}
