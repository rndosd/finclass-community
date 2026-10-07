import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Clock3,
  Diamond,
  Home,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "../../components/ui";
import { useUser } from "../../contexts/UserContext";

const AccessDeniedPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { reason, service, detail, plan } = location.state || {};
  const { userData } = useUser();

  const isPlanBlock = reason === "PLAN";
  const isTimeBlock = reason === "TIME_WINDOW";
  const isTeacherView =
    userData?.role === "teacher" || userData?.role === "admin";

  const theme = isPlanBlock
    ? {
        bgClass: "bg-indigo-50",
        borderClass: "border-indigo-500",
        icon: <Diamond className="w-10 h-10 text-indigo-500" />,
        iconBg: "bg-indigo-100",
        title: isTeacherView ? "플랜 제한 안내" : "이용 제한 안내",
        btnColor: "indigo",
      }
    : isTimeBlock
      ? {
          bgClass: "bg-blue-50",
          borderClass: "border-blue-500",
          icon: <Clock3 className="w-10 h-10 text-blue-500" />,
          iconBg: "bg-blue-100",
          title: "이용 시간이 아니에요",
          btnColor: "indigo",
        }
      : {
          bgClass: "bg-orange-50",
          borderClass: "border-orange-500",
          icon: <ShieldAlert className="w-10 h-10 text-orange-500" />,
          iconBg: "bg-orange-100",
          title: "이용 권한이 없어요",
          btnColor: "slate",
        };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f5ff] p-6">
      <div
        className={`w-full max-w-md rounded-[2.5rem] border-t-[12px] ${theme.borderClass} bg-white p-10 text-center shadow-2xl transition-all`}
      >
        <div
          className={`${theme.iconBg} mx-auto mb-8 flex h-24 w-24 rotate-3 items-center justify-center rounded-3xl shadow-sm`}
        >
          {theme.icon}
        </div>

        <h2 className="mb-3 text-3xl font-black tracking-tight text-slate-800">
          {theme.title}
        </h2>

        <p className="mb-10 px-4 text-sm leading-relaxed text-slate-500">
          {isPlanBlock
            ? isTeacherView
              ? "플랜 조정은 선생님이 아니라 관리자만 가능합니다."
              : "현재 플랜에서 제한된 기능입니다. 선생님께 문의해 주세요."
            : isTimeBlock
              ? "선생님이 설정한 학급 사용 가능 시간에만 접속할 수 있습니다."
              : "접근권한이 있는 계정으로 로그인해야 이용할 수 있습니다."}
        </p>

        <div
          className={`${theme.bgClass} mb-8 rounded-2xl border border-white/50 p-6 text-left shadow-inner`}
        >
          {isPlanBlock ? (
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">
                플랜 안내
              </span>
              {isTeacherView ? (
                <p className="break-keep font-medium text-slate-700">
                  이 설치본의 운영자에게 기능 설정을 문의하세요.<br />현재 플랜: <span className="font-bold text-indigo-600">{plan}</span>
                  {service ? (
                    <>
                      <br />
                      제한 기능: <span className="text-indigo-700">[{service}]</span>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="break-keep font-medium text-slate-700">
                  현재 플랜에서는 이 기능을 사용할 수 없습니다.
                  <br />
                  선생님께 문의해 주세요.
                </p>
              )}
            </div>
          ) : isTimeBlock ? (
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">
                사용 시간 안내
              </span>
              <p className="break-keep font-medium text-slate-700">
                {detail || "현재는 이용 시간이 아니에요."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-orange-400">
                권한 안내
              </span>
              <p className="break-keep font-medium text-slate-700">
                {detail ? <>현재 <span className="font-bold text-orange-600">[{detail}]</span> 권한이 없습니다.</> : "이 화면을 이용할 권한이 없습니다."}
                <br />
                권한 설정 후 다시 시도해 주세요.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Button
            color={theme.btnColor}
            size="lg"
            className="w-full"
            onClick={() => navigate("/dashboard")}
          >
            <Home className="mr-2 h-5 w-5" /> 대시보드로 돌아가기
          </Button>

          <Button tone="slate" kind="ghost" size="sm"
            onClick={() => navigate(-1)}
            className="flex items-center justify-center gap-1 transition-all"
          >
            <ArrowLeft className="h-4 w-4" /> 이전 페이지로
          </Button>
        </div>

        {!isPlanBlock && !isTimeBlock && (
          <div className="mt-8 border-t border-slate-50 pt-6">
            <Button tone="slate" kind="ghost" size="xs"
              onClick={() => window.location.reload()}
              className="mx-auto flex items-center justify-center gap-1"
            >
              <RefreshCw className="h-3 w-3" /> 권한이 갱신됐다면 새로고침해 주세요.
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccessDeniedPage;
