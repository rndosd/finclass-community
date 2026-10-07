import React from "react";
import { Link } from "react-router-dom";

// Installation template, not an assertion about a new operator's policy.
export default function PrivacyPolicyPage() {
  return <main className="mx-auto max-w-3xl space-y-5 px-6 py-12">
    <h1 className="text-2xl font-bold">개인정보 처리 안내 준비 중</h1>
    <p>이 설치본의 운영자는 실제 운영 환경에 맞는 개인정보처리방침을 작성해야 합니다. 현재 문서는 설치용 초안이며 원본 서비스의 개인정보처리방침을 대신하지 않습니다.</p>
    <p>운영 주체와 연락처, 수집 항목과 목적, 보유·삭제 기준, 이용자의 요청 방법, 외부 서비스에 전달되는 정보와 보호 조치를 안내한 뒤 실제 학생의 이용을 시작하세요.</p>
    <Link to="/" className="text-blue-700 underline">홈으로</Link>
  </main>;
}
