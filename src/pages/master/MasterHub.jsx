import React from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import Button from "../../components/ui/Button";
import { ArrowRight, Bell, Database, ShieldCheck, TrendingUp } from "lucide-react";
const menuItems = [{
  title: "공지 관리",
  desc: "운영 공지와 시스템 안내 문구를 확인하고 정리합니다.",
  path: "/admin/notices",
  icon: <Bell className="h-6 w-6" />,
  color: "bg-orange-500"
}, {
  title: "주식 보정 도구",
  desc: "주식 가격과 관련 데이터를 보정할 때 사용하는 운영 도구입니다.",
  path: "/admin/stock-adjustment",
  icon: <TrendingUp className="h-6 w-6" />,
  color: "bg-emerald-500"
}, {
  title: "주식 카테고리 관리",
  desc: "공용 주식 카테고리와 종목 표시 구조를 관리합니다.",
  path: "/admin/stock-categories",
  icon: <Database className="h-6 w-6" />,
  color: "bg-violet-500"
}];
const MasterHub = () => {
  const navigate = useNavigate();
  const visibleMenuItems = menuItems.filter(item => !item.hidden);
  return <AppLayout title="마스터 허브">
      <div className="mx-auto max-w-6xl space-y-7 p-6 sm:p-8 animate-in fade-in duration-500">
        <header className="flex items-center gap-3 border-b border-slate-200 pb-6">
          <div className="rounded-lg bg-indigo-600 p-2 text-white shadow-lg shadow-indigo-200">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="tracking-tight text-slate-800 text-[28px] leading-9 font-extrabold sm:text-[32px] sm:leading-10">
              마스터 허브
            </h1>
            <p className="font-medium text-slate-500">
              운영 전반의 설정과 관리 도구를 한곳에서 확인합니다.
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleMenuItems.map(item => <Button key={item.path} variant="ghost" kind="ghost" onClick={() => navigate(item.path)} className="group relative grid min-h-[124px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start justify-start gap-4 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md">
              <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white shadow-sm transition-transform group-hover:scale-105 ${item.color}`}>
                {item.icon}
              </div>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-base font-black leading-6 text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{item.desc}</p>
              </div>
              <ArrowRight className="mt-2 h-5 w-5 shrink-0 text-slate-300 transition-colors group-hover:text-indigo-500" />
            </Button>)}
        </div>
      </div>
    </AppLayout>;
};
export default MasterHub;
