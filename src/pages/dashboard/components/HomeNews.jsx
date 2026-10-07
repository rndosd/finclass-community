import { HomeCardFrame, HomeCardHeading } from "./HomeCardChrome";
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Spinner } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { CaretRightIcon, NewspaperIcon } from "@phosphor-icons/react";

// ?? ?귐딅만???묒눖??疫꿸퀡而??뚣끉??? ???袁る７??
import { useLiveNews } from "../../news/hooks/useNewsQueries";

// 筌뤴뫀??獄???뺥돩??

const HomeNews = ({ isTeacher, canManage, displayVariant = "featured" }) => {
  const { classId } = useUser();
  const navigate = useNavigate();
  const today = new Date();
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {year:"numeric",month:"long",day:"numeric"}).format(today) + " (" + new Intl.DateTimeFormat("ko-KR", {weekday:"short"}).format(today) + ")";
  const isCompact = displayVariant === "compact";

  // 1?るㅄ源??귐딅만???묒눖?? ????뺣궖??뽰뒠 筌ㅼ뮇????곷뮞 5揶쏆뮆彛??紐꾪뀱
  const {
    data,
    isLoading: newsLoading,
    isError,
    error,
  } = useLiveNews(classId, {
    category: "all", // ????뺣궖??뺣뮉 ?袁⑷퍥 燁삳똾?믤⑥쥓??癒?퐣 筌ㅼ뮇???뽰몵嚥?揶쎛?紐꾩긾
    pageSize: 5,
    dashboardOnly: true,
    live: false,
  });

  // 2?るㅄ源??귐딅만???묒눖?? ??곷뮞 ??る?(??륁젟/????

  // ?怨쀬뵠????꿸퉪??(筌ㅼ뮇??1??륁뵠筌왖??5揶쏆뮆彛?????
  const newsList = useMemo(() => data || [], [data]);
  const prioritizedNewsList = useMemo(
    () =>
      [...newsList].sort((a, b) => {
        const aUrgent = a?.priority === "high" ? 1 : 0;
        const bUrgent = b?.priority === "high" ? 1 : 0;
        return bUrgent - aUrgent;
      }),
    [newsList],
  );
  const visibleNewsList = useMemo(
    () => (isCompact ? prioritizedNewsList.slice(0, 3) : prioritizedNewsList),
    [isCompact, prioritizedNewsList],
  );


  // 燁삳똾?믤⑥쥓???類ｋ궖 (筌뤴뫀???袁⑤뼎??

  // ?紐껊굶??嚥≪뮇彛?
  const handleNewsClick = (item) => {
    if (!item?.id) return;
    const params = new URLSearchParams();
    if (item.categoryId && item.categoryId !== "popular") {
      params.set("category", item.categoryId);
    }
    params.set("news", item.id);
    navigate("/news?" + params.toString());
  };


  return (
    <>
      <HomeCardFrame type="news" displayVariant={displayVariant}>
        <HomeCardHeading icon={NewspaperIcon} tools={<time dateTime={new Date().toLocaleDateString('en-CA')}>{dateLabel}</time>}>이번 주 학급 소식</HomeCardHeading>
          <div className="min-w-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
            {newsLoading ? (
              <div className="flex justify-center py-10">
                <Spinner size="md" className="text-sky-500" />
              </div>
            ) : isError ? (
              <div className="text-center text-rose-500 py-4 text-xs font-bold">
                {error?.message || "소식을 불러오지 못했습니다."}
              </div>
            ) : newsList.length > 0 ? (
              <div className="fc-home-news-list">
                {visibleNewsList.map((item) => {
                  const isUrgent = item.priority === "high";
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      onClick={() => handleNewsClick(item)}
                      kind="ghost"
                      tone="slate"
                      className={`group flex w-full items-center justify-between border-0 px-1 py-3 text-left transition-colors ${
                        isUrgent
                          ? "bg-rose-50/45 hover:bg-rose-50/80"
                          : "bg-transparent hover:bg-white/70"
                      }`}
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        {isUrgent && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-black bg-rose-100 text-rose-700 border border-rose-200">
                            긴급
                          </span>
                        )}
                        <span
                          className={`line-clamp-1 break-keep leading-snug transition-colors ${
                            isUrgent
                              ? "text-[14px] sm:text-[15px] font-black text-rose-700 group-hover:text-rose-800"
                              : "text-[13px] sm:text-[14px] font-bold text-slate-700 group-hover:text-sky-700"
                          }`}
                        >
                          {item.title}
                        </span>
                      </div>
                      <CaretRightIcon
                        size={15}
                        className={`group-hover:translate-x-0.5 transition-all flex-shrink-0 ${
                          isUrgent
                            ? "text-rose-300 group-hover:text-rose-500"
                            : "text-slate-300 group-hover:text-sky-500"
                        }`}
                      />
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 sm:h-40 text-slate-400 border-2 border-dashed border-slate-100 rounded-[2rem]">
                <p className="text-xs font-bold">등록된 주요 소식이 없습니다.</p>
                {!isCompact && (isTeacher || canManage) && (
                  <p className="text-[10px] text-sky-500 mt-2 font-medium">
                    뉴스 센터에서 "대시보드에 표시"를 체크해 보세요.
                  </p>
                )}
              </div>
            )}
          </div>
      </HomeCardFrame>

    </>
  );
};

export default HomeNews;
