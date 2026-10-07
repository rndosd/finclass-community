import React from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import GlobalUpdateNoticeAdmin from "./components/GlobalUpdateNoticeAdmin";
import { ArrowLeft, Bell } from "lucide-react";
import { Button } from "../../components/ui";

const NoticeManagementPage = () => {
  const navigate = useNavigate();
  return (
    <AppLayout title="전역 공지 관리">
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Button tone="slate" kind="ghost" size="md"
          onClick={() => navigate("/admin/master")}
          className="flex items-center gap-2 transition-colors"
        >
          <ArrowLeft size={18} /> 마스터 허브로 돌아가기
        </Button>
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
          <header className="mb-6 flex items-center gap-3">
            <Bell className="text-orange-500" />
            <h2 className="text-xl font-bold text-slate-800">
              시스템 공지 발행
            </h2>
          </header>
          <GlobalUpdateNoticeAdmin />
        </div>
      </div>
    </AppLayout>
  );
};

export default NoticeManagementPage;
