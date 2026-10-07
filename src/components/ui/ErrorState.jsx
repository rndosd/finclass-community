import { CircleAlert } from "lucide-react";
import Button from "./Button";

export default function ErrorState({ title = "정보를 불러오지 못했습니다.", description = "연결 상태를 확인한 뒤 다시 시도해 주세요.", children, onRetry, onReload, retryLabel = "다시 시도", variant = "page", className = "" }) {
  const compact = variant === "section";
  const Heading = compact ? "h2" : "h1";
  return (
    <div role="alert" className={`${compact ? "min-h-44 rounded-xl bg-slate-50 p-4" : "flex min-h-[60vh] items-center justify-center bg-slate-50 p-6"} ${className}`}>
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600" aria-hidden="true"><CircleAlert className="h-6 w-6" /></span>
        <Heading className={`${compact ? "text-base" : "text-xl"} font-bold text-slate-800`}>{title}</Heading>
        {description && <p className="text-sm leading-relaxed text-slate-600">{description}</p>}
        {children && <div className="text-sm leading-relaxed text-slate-600">{children}</div>}
        {(onRetry || onReload) && <div className="flex flex-wrap justify-center gap-2">
          {onRetry && <Button size={compact ? "sm" : "md"} onClick={onRetry}>{retryLabel}</Button>}
          {onReload && <Button size={compact ? "sm" : "md"} tone="slate" kind="outline" onClick={onReload}>페이지 다시 불러오기</Button>}
        </div>}
      </div>
    </div>
  );
}
