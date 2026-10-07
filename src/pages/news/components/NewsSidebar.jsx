import React, { useMemo } from "react";
import { BellRing, Newspaper } from "lucide-react";

const toDate = (value) => {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", weekday: "short" }) : "";
};

const NewsSidebar = ({ news = [], categories = [], onOpenNews, selectedNewsId }) => {
  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const sortedNews = useMemo(() => [...news].filter((item) => item.isActive !== false).sort((left, right) => (toDate(right.createdAt)?.getTime() || 0) - (toDate(left.createdAt)?.getTime() || 0)), [news]);
  const importantNews = sortedNews.filter((item) => item.priority === "high").slice(0, 1);
  const latestNews = sortedNews.filter((item) => item.priority !== "high").slice(0, 5);

  const categoryLabel = (item) => categoryMap.get(item.categoryId)?.label || "뉴스";
  const rowClass = (item) => `group w-full px-5 py-4 text-left transition hover:bg-slate-50 ${selectedNewsId === item.id ? "bg-indigo-50/70" : "bg-white"}`;

  return (
    <aside className="h-fit overflow-hidden bg-white lg:sticky lg:top-6">
      <section className="border-b border-slate-200">
        <div className="flex items-center gap-2 px-5 py-4"><BellRing className="h-4 w-4 text-indigo-600" /><h2 className="text-sm font-black text-slate-900">중요 공지</h2></div>
        {importantNews.length ? importantNews.map((item) => (
          <button key={item.id} type="button" onClick={() => onOpenNews?.(item)} className={`${rowClass(item)} border-t border-slate-100`}>
            <div className="flex items-center justify-between gap-2"><span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black text-indigo-600">{categoryLabel(item)}</span><span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-600">중요</span></div>
            <p className="mt-2 line-clamp-2 text-[15px] font-black leading-5 text-slate-900 group-hover:text-indigo-700">{item.title || "제목 없음"}</p>
            <p className="mt-1 line-clamp-1 text-xs font-medium text-slate-400">{item.summary || String(item.content || "").replace(/<[^>]+>/g, " ").trim() || "본문 미리보기가 없습니다."}</p>
          </button>
        )) : <p className="border-t border-slate-100 px-5 py-6 text-center text-xs font-semibold text-slate-400">등록된 중요 공지가 없습니다.</p>}
      </section>

      <section>
        <div className="flex items-center gap-2 px-5 py-4"><Newspaper className="h-4 w-4 text-indigo-600" /><h2 className="text-sm font-black text-slate-900">최신 뉴스</h2></div>
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {latestNews.length ? latestNews.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpenNews?.(item)} className={rowClass(item)}>
              <div className="flex items-center justify-between gap-2"><span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{categoryLabel(item)}</span><span className="text-[11px] font-semibold text-slate-400">{formatDate(item.createdAt)}</span></div>
              <p className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-slate-700 group-hover:text-indigo-700">{item.title || "제목 없음"}</p>
              <p className="mt-1 line-clamp-1 text-xs font-medium text-slate-400">{item.summary || String(item.content || "").replace(/<[^>]+>/g, " ").trim() || "본문 미리보기가 없습니다."}</p>
            </button>
          )) : <p className="px-5 py-6 text-center text-xs font-semibold text-slate-400">등록된 최신 뉴스가 없습니다.</p>}
        </div>
      </section>
    </aside>
  );
};

export default NewsSidebar;
