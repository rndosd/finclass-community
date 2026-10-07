import { BriefcaseBusiness } from "lucide-react";
import { Badge, Button } from "../../components/ui";
import { formatPrice, SERVICE_STATUS_META } from "./JobSeekerBoardPage.parts";

export default function JobSeekerDiscoveryList({services, currencyUnit, userUid, isTeacher, onOpen, onRequest}) {
  return <section aria-label="친구들의 서비스" className="rounded-2xl border border-slate-200 bg-white px-4 sm:px-5">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 py-5">
      <h2 className="text-xl leading-7 font-bold text-slate-900">친구들의 서비스</h2><span className="text-sm text-slate-500">총 {services.length}개</span>
    </div>
    <div className="divide-y divide-slate-200">{services.map(service => <article key={service.id} className="flex gap-4 py-5">
      <BriefcaseBusiness className="mt-1 hidden h-6 w-6 shrink-0 text-blue-600 sm:block" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button type="button" onClick={() => onOpen(service)} className="break-words text-left text-base font-bold text-slate-900 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">{service.title}</button>
          <span className="text-sm font-semibold tabular-nums text-blue-700">{formatPrice(service, currencyUnit)}</span>
        </div>
        <p className="mt-2 text-sm text-slate-500">{service.ownerName || '서비스 제공자'}{service.ownerUid === userUid ? ' · 내 서비스' : ''}</p>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{service.summary || service.description || '자세한 내용을 확인해 보세요.'}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>{(isTeacher || service.ownerUid === userUid) && <Badge tone={SERVICE_STATUS_META[service.status]?.tone || 'slate'}>{SERVICE_STATUS_META[service.status]?.label || service.status}</Badge>}</div>
          <div className="flex gap-2">
            <Button size="sm" kind="outline" tone="slate" onClick={() => onOpen(service)}>자세히</Button>
            {service.status === 'active' && service.ownerUid !== userUid && <Button size="sm" kind="outline" tone="blue" onClick={() => onRequest(service)}>의뢰하기</Button>}
          </div>
        </div>
      </div>
    </article>)}</div>
  </section>;
}
