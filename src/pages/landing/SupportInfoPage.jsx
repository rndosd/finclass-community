import React from "react";
import { Link } from "react-router-dom";

export default function SupportInfoPage() {
  return <main className="mx-auto max-w-3xl space-y-5 px-6 py-12">
    <h1 className="text-2xl font-bold">직접 운영하는 핀클래스</h1>
    <p>이 사이트는 소스코드를 이용해 별도로 설치한 서비스입니다. 계정, 학급 데이터, 서버 비용과 문의 응답은 이 설치본의 운영자가 관리합니다.</p>
    <p>기존 서비스의 계정과 데이터는 자동으로 연결되지 않습니다. 문의 채널은 운영자가 설정합니다.</p>
    <Link to="/" className="text-blue-700 underline">홈으로</Link>
  </main>;
}
