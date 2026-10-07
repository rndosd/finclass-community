import React from "react";
import { Button, InputField } from "../../../components/ui";

export default function ClassResetPanel({ type, studentCount, initialCapital, onCapitalChange, confirmation, onConfirmationChange, className, disabled, busy, onExecute }) {
  const activity = type === "activity";
  const kept = activity
    ? ["학생 명단과 로그인 아이디·비밀번호", "개인정보 동의와 직접 부여한 권한", "수업 설정과 상품·직업·과제 목록"]
    : ["교사·관리자 로그인 계정", "학급 기본정보"];
  const cleared = activity
    ? ["학생·교사의 현금, 예금, 대출, 보유 자산", "학생 직업과 직업에 따른 권한", "거래·구매·과제 제출 등 활동 기록", "부동산 소유와 임대 관계"]
    : ["학생 명단과 로그인 계정", "모든 활동 기록과 보유 자산", "상품·직업·과제 목록과 하위 수업 설정"];
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-5 md:p-6">
        <h2 className="text-lg font-bold text-slate-900">{activity ? "명단은 그대로, 활동은 처음부터" : "학생 계정과 수업 데이터 전체 정리"}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {activity ? "같은 학생들과 경제활동을 새로 시작할 때 사용하세요. 기존 아이디와 비밀번호로 계속 로그인할 수 있습니다." : "다음 학년도를 준비할 때 사용하세요. 학생 계정도 삭제되므로 새 명단을 등록해야 합니다."}
        </p>
      </div>
      <div className="space-y-5 p-5 md:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">그대로 유지</h3>
            <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-relaxed text-slate-600">{kept.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4">
            <h3 className="text-sm font-semibold text-rose-700">{activity ? "초기화" : "삭제"}</h3>
            <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-relaxed text-slate-600">{cleared.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-slate-600">대상 학생 <strong className="text-slate-900">{studentCount}명</strong> · 삭제된 기록은 되돌릴 수 없습니다. 교사의 경제 상태도 초기화됩니다.</p>
        <div className="space-y-4 border-t border-slate-100 pt-5">
          {activity && <InputField id="reset-initial-capital" label="학생 한 명당 지급할 시작 현금" type="number" min="0" max="100000000" step="1" value={initialCapital} onChange={onCapitalChange} disabled={disabled} wrapperClassName="max-w-md" hint="예금·대출·보유 자산·과제 토큰은 0, 신용점수는 700으로 시작합니다. 교사 현금은 10,000으로 초기화됩니다." />}
          <InputField id={`reset-confirm-${type}`} label="확인을 위해 학급 이름을 입력해 주세요" placeholder={className} value={confirmation} onChange={onConfirmationChange} disabled={disabled} autoComplete="off" wrapperClassName="max-w-md" hint={`‘${className}’과 똑같이 입력하면 실행할 수 있습니다.`} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5">
          <p className="text-xs leading-relaxed text-slate-500">학생들이 활동하지 않는 시간에 실행해 주세요.</p>
          <Button variant={activity ? "primary" : "destructive"} onClick={onExecute} disabled={disabled || !className || confirmation !== className} isLoading={busy}>
            {activity ? "활동 기록 초기화" : "학급 전체 초기화"}
          </Button>
        </div>
      </div>
    </div>
  );
}
