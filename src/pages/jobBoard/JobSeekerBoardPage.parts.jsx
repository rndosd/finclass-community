import { appAlert } from "../../utils/appDialogs";
import { useNumberFormat as useConfiguredMoney } from "../../contexts/NumberFormatContext";
import { useEffect, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  CheckCircle2,
  EyeOff,
  FileText,
  HandCoins,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";

import { Badge, Button, Modal, Textarea , Tabs} from "../../components/ui";

const SERVICE_CATEGORIES = ["전체"];
const DEFAULT_SERVICE_CATEGORY = "서비스";

const SERVICE_STATUS_META = {
  pending_approval: { label: "승인 대기", tone: "amber" },
  active: { label: "공개", tone: "emerald" },
  hidden: { label: "숨김", tone: "slate" },
  deleted: { label: "삭제됨", tone: "rose" },
  suspended: { label: "일시중지", tone: "amber" },
};

const REQUEST_STATUS_META = {
  requested: { label: "제안 대기", tone: "indigo" },
  accepted: { label: "수락", tone: "sky" },
  rejected: { label: "거절", tone: "rose" },
  completed: { label: "완료", tone: "emerald" },
  paid: { label: "지급 완료", tone: "green" },
  cancelled: { label: "취소", tone: "slate" },
};

const REQUEST_FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "requested", label: "제안 대기" },
  { value: "accepted", label: "수락" },
  { value: "completed", label: "완료" },
  { value: "paid", label: "지급 완료" },
  { value: "closed", label: "거절/취소" },
];

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50";

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatDateTime = (value) => {
  const time = toMillis(value);
  if (!time) return "-";
  return new Date(time).toLocaleString("ko-KR");
};

const formatAmount = (amount, currencyUnit) =>
  `${Number(amount || 0).toLocaleString("ko-KR")}${currencyUnit}`;

const formatPrice = (service, currencyUnit, formatter) => {
  if (!service || service.priceMode === "negotiable") return "협의";
  return formatter ? `${formatter(service.priceAmount)}${currencyUnit}` : formatAmount(service.priceAmount, currencyUnit);
};

const getStatusMeta = (status, metaMap) =>
  metaMap[status] || { label: status || "-", tone: "slate" };

const buildServiceSearchBlob = (service) =>
  [
    service?.title,
    service?.summary,
    service?.description,
    service?.ownerName,
    service?.category,
    service?.availabilityText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const getProfileStats = (service) => {
  const ratingCount = Number(service?.ratingCount || 0);
  const ratingAverage =
    ratingCount > 0 ? Number(service?.ratingAverage || 0).toFixed(1) : "-";
  const reviewText = `${ratingAverage} (${ratingCount})`;
  return { reviewText };
};

const ProfileStatsLine = ({ service }) => {
  const { reviewText } = getProfileStats(service);
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-sm font-black text-slate-700">
      <span className="text-amber-400">★</span>
      <span>{reviewText}</span>
    </span>
  );
};

const jobBoardModeTabs = [
  { id: "recruit", label: "구인", icon: BriefcaseBusiness },
  { id: "seeker", label: "구직", icon: Search },
];



const JobBoardModeTabs = ({ active, onNavigate }) => (
  <Tabs ariaLabel="구인·구직 게시판 보기" idPrefix="job-board-mode" tabs={jobBoardModeTabs} activeTab={active} onTabChange={onNavigate} variant="underline" size="md" className="max-w-full" />
);

const CategoryChips = ({ value, onChange }) => (
  <div className="flex gap-2 overflow-x-auto pb-1">
    {SERVICE_CATEGORIES.map((category) => {
      const isActive = value === category;
      return (
        <Button
          key={category}
          type="button"
          onClick={() => onChange(category)}
          className={`shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition ${
            isActive
              ? "border-blue-500 bg-blue-600 text-white shadow-sm"
              : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50"
          }`}
        >
          {category}
        </Button>
      );
    })}
  </div>
);

const ServiceCard = ({
  service,
  services,
  isOwnService,
  isTeacher,
  onOpen,
  onRequest,
  currencyUnit,
}) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();

  const serviceList = services?.length ? services : [service].filter(Boolean);
  const primaryService = serviceList[0] || service || {};
  const statusMeta = getStatusMeta(primaryService.status, SERVICE_STATUS_META);

  const handleCardKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(primaryService);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(primaryService)}
      onKeyDown={handleCardKeyDown}
      className="block min-h-[250px] w-full cursor-pointer rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-blue-100"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge tone="blue">{primaryService.category || "미분류"}</Badge>
              {isOwnService || isTeacher ? (
                <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
              ) : null}
            </div>
            <h3 className="mt-3 line-clamp-1 text-xl font-black leading-7 text-slate-950">
              {primaryService.ownerName || "이름 없음"}
            </h3>
          </div>
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
            <BriefcaseBusiness className="h-5 w-5" />
          </div>
        </div>

        <p className="mt-4">
          <ProfileStatsLine service={primaryService} />
        </p>

        <div className="mt-4 space-y-2">
          {serviceList.slice(0, 4).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-left">
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-black text-slate-800">
                    {item.title || "서비스 이름 없음"}
                  </span>
                  <span className="shrink-0 text-xs font-black text-slate-500">
                    {formatPrice(item, currencyUnit, formatConfiguredAmount)}
                  </span>
                </span>
              </span>
              {!isOwnService && item.status === "active" ? (
                <Button
                  size="sm"
                  tone="blue"
                  icon={Send}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRequest(item);
                  }}
                >
                  의뢰
                </Button>
              ) : null}
            </div>
          ))}
          {serviceList.length > 4 ? (
            <p className="px-1 text-xs font-bold text-slate-400">
              외 {serviceList.length - 4}개 더 있음
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const ServiceFormModal = ({
  isOpen,
  onClose,
  initialService,
  onSubmit,
  isSubmitting,
  currencyUnit,
}) => {
  const [form, setForm] = useState({
    title: "",
    summary: "",
    description: "",
    serviceItems: [{ title: "", priceAmount: "" }],
    category: "",
    priceMode: "from",
    priceAmount: "",
    availabilityText: "",
    averageDurationText: "",
    strengthsText: "",
    requirementsText: "",
    status: "active",
  });

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      title: initialService?.title || "",
      summary: initialService?.summary || "",
      description: initialService?.description || "",
      serviceItems: initialService
        ? [{ title: initialService?.title || "", priceAmount: String(initialService?.priceAmount ?? "") }]
        : [{ title: "", priceAmount: "" }],
      category: initialService?.category || DEFAULT_SERVICE_CATEGORY,
      priceMode: initialService?.priceMode || "from",
      priceAmount:
        initialService?.priceMode === "negotiable"
          ? ""
          : String(initialService?.priceAmount ?? ""),
      availabilityText: initialService?.availabilityText || "",
      averageDurationText: initialService?.averageDurationText || "",
      strengthsText: initialService?.strengthsText || "",
      requirementsText: initialService?.requirementsText || "",
      status:
        initialService?.status === "hidden"
          ? "hidden"
          : initialService?.status === "pending_approval"
            ? "pending_approval"
            : "active",
    });
  }, [initialService, isOpen]);

  const setField = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const setServiceItemField = (index, field, value) =>
    setForm((current) => ({
      ...current,
      serviceItems: current.serviceItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));

  const addServiceItem = () =>
    setForm((current) => ({
      ...current,
      serviceItems: [...current.serviceItems, { title: "", priceAmount: "" }],
    }));

  const removeServiceItem = (index) =>
    setForm((current) => ({
      ...current,
      serviceItems:
        current.serviceItems.length <= 1
          ? current.serviceItems
          : current.serviceItems.filter((_, itemIndex) => itemIndex !== index),
    }));

  const handleSubmit = () => {
    if (!form.summary.trim()) return appAlert("서비스 설명을 입력해 주세요.");
    const hasPriceAmount = Number(form.priceAmount || 0) > 0;
    const basePayload = {
      summary: form.summary.trim(),
      description: form.description.trim() || form.summary.trim(),
      category: form.category || DEFAULT_SERVICE_CATEGORY,
      availabilityText: form.availabilityText,
      averageDurationText: form.averageDurationText,
      strengthsText: form.strengthsText,
      requirementsText: form.requirementsText,
      status: initialService ? form.status : "pending_approval",
    };
    if (!initialService) {
      const services = form.serviceItems
        .map((item) => {
          const title = item.title.trim();
          const priceAmount = Number(item.priceAmount || 0);
          if (!title) return null;
          return {
            ...basePayload,
            title,
            priceMode: priceAmount > 0 ? "from" : "negotiable",
            priceAmount: priceAmount > 0 ? priceAmount : 0,
          };
        })
        .filter(Boolean);
      if (services.length === 0) return appAlert("서비스 목록을 한 개 이상 입력해 주세요.");
      onSubmit({ services });
      return;
    }
    if (!form.title.trim()) return appAlert("서비스 이름을 입력해 주세요.");
    onSubmit({
      ...basePayload,
      title: form.title.trim(),
      priceMode: hasPriceAmount ? "from" : "negotiable",
      priceAmount: hasPriceAmount ? Number(form.priceAmount || 0) : 0,
    });
  };

  const showStatusToggle = Boolean(initialService && form.status !== "pending_approval");

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialService ? "서비스 수정" : "서비스 등록"}
      size="lg"
    >
      <div className="space-y-5">
        {initialService ? (
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">서비스 이름</label>
            <input
              className={inputClassName}
              value={form.title}
              onChange={(event) => setField("title", event.target.value)}
              placeholder="예: 발표 자료 정리 도와주기"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">서비스 목록 및 희망 가격</label>
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              {form.serviceItems.map((item, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                  <input
                    className={inputClassName}
                    value={item.title}
                    onChange={(event) => setServiceItemField(index, "title", event.target.value)}
                    placeholder="예: 발표 자료 정리"
                  />
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      className={`${inputClassName} pr-14`}
                      value={item.priceAmount}
                      onChange={(event) =>
                        setServiceItemField(index, "priceAmount", event.target.value)
                      }
                      placeholder="예: 500"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-400">
                      {currencyUnit}
                    </span>
                  </div>
                  <Button
                    kind="outline"
                    tone="slate"
                    icon={XCircle}
                    onClick={() => removeServiceItem(index)}
                    disabled={form.serviceItems.length <= 1}
                  >
                    삭제
                  </Button>
                </div>
              ))}
              <Button kind="outline" tone="blue" icon={Plus} onClick={addServiceItem}>
                행 추가
              </Button>
            </div>
            <p className="text-xs font-semibold text-slate-500">
              가격을 비워두면 협의로 등록됩니다.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">서비스 설명</label>
          <input
            className={inputClassName}
            value={form.summary}
            onChange={(event) => setField("summary", event.target.value)}
            placeholder="예: 자료를 보기 좋게 정리하고 발표 순서를 같이 맞춰줘요."
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">상세 설명 (선택)</label>
          <Textarea
            rows={4}
            className="rounded-2xl border-slate-200 px-4 py-3"
            value={form.description}
            onChange={(event) => setField("description", event.target.value)}
            placeholder="어떤 도움을 줄 수 있는지 조금 더 자세히 적어 주세요."
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">내 강점</label>
          <input
            className={inputClassName}
            value={form.strengthsText}
            onChange={(event) => setField("strengthsText", event.target.value)}
            placeholder="예: 꼼꼼해요, 약속을 잘 지켜요, 친구 말을 잘 들어요."
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">가능한 시간 (선택)</label>
            <input
              className={inputClassName}
              value={form.availabilityText}
              onChange={(event) => setField("availabilityText", event.target.value)}
              placeholder="예: 점심시간, 방과 후"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">예상 소요 시간 (선택)</label>
            <input
              className={inputClassName}
              value={form.averageDurationText}
              onChange={(event) => setField("averageDurationText", event.target.value)}
              placeholder="예: 20분, 하루"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">의뢰 전 확인할 내용 (선택)</label>
          <Textarea
            rows={3}
            className="rounded-2xl border-slate-200 px-4 py-3"
            value={form.requirementsText}
            onChange={(event) => setField("requirementsText", event.target.value)}
            placeholder="친구가 미리 준비해야 할 자료나 조건이 있다면 적어 주세요."
          />
        </div>

        {initialService ? (
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">희망 가격</label>
            <div className="relative">
              <input
                type="number"
                min="0"
                className={`${inputClassName} pr-24`}
                value={form.priceAmount}
                onChange={(event) => setField("priceAmount", event.target.value)}
                placeholder="예: 500"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-bold text-slate-400">
                {currencyUnit}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-500">
              대략 받고 싶은 금액이 있으면 적고, 잘 모르겠으면 비워두세요.
            </p>
          </div>
        ) : null}

        {showStatusToggle ? (
          <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <span>
              <span className="block text-sm font-bold text-slate-700">공개 상태</span>
              <span className="text-xs font-semibold text-slate-500">
                켜두면 친구들이 이 서비스를 보고 의뢰할 수 있어요.
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={form.status === "active"}
              onChange={(event) => setField("status", event.target.checked ? "active" : "hidden")}
            />
          </label>
        ) : (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800">
            {initialService
              ? "이 서비스는 선생님 승인 대기 중입니다. 승인되면 친구들이 보고 의뢰할 수 있어요."
              : "새 서비스는 등록 후 선생님 승인을 거쳐 공개됩니다."}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button kind="outline" tone="slate" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button tone="blue" icon={initialService ? Pencil : Plus} onClick={handleSubmit} isLoading={isSubmitting}>
            {initialService ? "수정" : "등록"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const RequestModal = ({ isOpen, onClose, service, onSubmit, isSubmitting, currencyUnit }) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();

  const [form, setForm] = useState({
    requestMessage: "",
    proposedRewardAmount: "",
    note: "",
  });

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      requestMessage: "",
      proposedRewardAmount:
        service?.priceMode === "negotiable" ? "" : String(service?.priceAmount || ""),
      note: "",
    });
  }, [isOpen, service?.id, service?.priceAmount, service?.priceMode]);

  if (!service) return null;

  const setField = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const handleSubmit = () => {
    if (!form.requestMessage.trim()) return appAlert("제안 내용을 입력해 주세요.");
    onSubmit({
      requestMessage: form.requestMessage.trim(),
      dueAt: null,
      proposedRewardAmount: Number(form.proposedRewardAmount || 0),
      note: form.note.trim(),
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="의뢰하기" size="lg">
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{service.category || "미분류"}</Badge>
            <Badge tone="sky">{formatPrice(service, currencyUnit, formatConfiguredAmount)}</Badge>
          </div>
          <p className="mt-3 text-lg font-black text-slate-900">
            {service.ownerName || service.title}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            어떤 도움을 받고 싶은지 친구에게 알려 주세요.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">의뢰 내용</label>
          <Textarea
            rows={5}
            className="rounded-2xl border-slate-200 px-4 py-3"
            value={form.requestMessage}
            onChange={(event) => setField("requestMessage", event.target.value)}
            placeholder="무엇을 도와주면 좋을지 적어 주세요."
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">제안 보상</label>
            <div className="relative">
              <input
                type="number"
                min="0"
                className={`${inputClassName} pr-24`}
                value={form.proposedRewardAmount}
                onChange={(event) => setField("proposedRewardAmount", event.target.value)}
                placeholder="0"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-bold text-slate-400">
                {currencyUnit}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">참고사항</label>
            <Textarea
              className={`${inputClassName} min-h-24 resize-y`}
              value={form.note}
              onChange={(event) => setField("note", event.target.value)}
              placeholder="꼭 알아야 할 내용"
              rows={3}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button kind="outline" tone="slate" onClick={onClose}>
            취소
          </Button>
          <Button tone="blue" icon={Send} onClick={handleSubmit} isLoading={isSubmitting}>
            의뢰 보내기
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const ServiceDetailModal = ({
  isOpen,
  onClose,
  service,
  services = [],
  serviceRequests,
  currencyUnit,
  isOwnService,
  isTeacher,
  canRequest,
  onRequest,
  onEdit,
  onDelete,
  onHide,
  onShow,
  onManageRequests,
}) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();

  if (!service) return null;
  const statusMeta = getStatusMeta(service.status, SERVICE_STATUS_META);
  const canManage = isOwnService || isTeacher;
  const serviceList = services.length ? services : [service];
  const serviceGuideItems = [
    { label: "가능한 시간", value: service.availabilityText },
    { label: "예상 소요 시간", value: service.averageDurationText },
    { label: "의뢰 전 확인", value: service.requirementsText },
  ].filter((item) => item.value);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="서비스 상세" size="xl">
      <div className="space-y-6">
        <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="blue">{service.category || "미분류"}</Badge>
                <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
              </div>
              <h2 className="mt-3 text-2xl font-black text-slate-950">
                {service.ownerName || service.title || "이름 없음"}
              </h2>
              <p className="mt-2 text-sm font-bold text-slate-600">
                {service.summary || service.title || "한 줄 소개 없음"}
              </p>
              <p className="mt-2">
                <ProfileStatsLine service={service} />
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canRequest ? (
                <Button tone="blue" icon={Send} onClick={() => onRequest(service)}>
                  의뢰하기
                </Button>
              ) : null}
              {canManage ? (
                <>
                  <Button kind="outline" tone="slate" icon={Pencil} onClick={() => onEdit(service)}>
                    수정
                  </Button>
                  {service.status === "active" ? (
                    <Button kind="outline" tone="slate" icon={EyeOff} onClick={() => onHide(service)}>
                      숨김
                    </Button>
                  ) : service.status === "hidden" ? (
                    <Button kind="outline" tone="blue" icon={CheckCircle2} onClick={() => onShow(service)}>
                      공개
                    </Button>
                  ) : service.status === "pending_approval" && isTeacher ? (
                    <Button kind="outline" tone="blue" icon={CheckCircle2} onClick={() => onShow(service)}>
                      승인
                    </Button>
                  ) : null}
                  <Button kind="outline" tone="red" icon={Trash2} onClick={() => onDelete(service)}>
                    삭제
                  </Button>
                </>
              ) : null}
            </div>
          </div>

        </div>

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-black text-slate-900">서비스 목록</h3>
          <div className="space-y-2">
            {serviceList.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-800">
                    {item.title || "서비스 이름 없음"}
                  </p>
                  {item.summary ? (
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
                      {item.summary}
                    </p>
                  ) : null}
                  {canManage ? (
                    <>
                      <Button size="sm" kind="outline" tone="slate" icon={Pencil} onClick={() => onEdit(item)}>
                        수정
                      </Button>
                      {item.status === "active" ? (
                        <Button size="sm" kind="outline" tone="slate" icon={EyeOff} onClick={() => onHide(item)}>
                          숨김
                        </Button>
                      ) : item.status === "hidden" ? (
                        <Button size="sm" kind="outline" tone="blue" icon={CheckCircle2} onClick={() => onShow(item)}>
                          표시
                        </Button>
                      ) : item.status === "pending_approval" && isTeacher ? (
                        <Button size="sm" kind="outline" tone="blue" icon={CheckCircle2} onClick={() => onShow(item)}>
                          승인
                        </Button>
                      ) : null}
                      <Button size="sm" kind="outline" tone="red" icon={Trash2} onClick={() => onDelete(item)}>
                        삭제
                      </Button>
                    </>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="text-sm font-black text-slate-600">
                    {formatPrice(item, currencyUnit, formatConfiguredAmount)}
                  </p>
                  {canRequest && item.status === "active" ? (
                    <Button size="sm" tone="blue" icon={Send} onClick={() => onRequest(item)}>
                      의뢰하기
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        {serviceGuideItems.length > 0 ? (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-black text-slate-900">이용 안내</h3>
            <div className="grid gap-3 md:grid-cols-3">
              {serviceGuideItems.map((item) => (
                <div key={item.label} className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-black text-slate-400">{item.label}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-black text-slate-900">상세 설명</h3>
            <p className="whitespace-pre-wrap text-sm font-medium leading-7 text-slate-700">
              {service.description || "-"}
            </p>
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-black text-slate-900">내 강점</h3>
            <p className="whitespace-pre-wrap text-sm font-medium leading-7 text-slate-600">
              {service.strengthsText || "아직 입력된 내용이 없습니다."}
            </p>
          </section>
        </div>

        {canManage ? (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900">받은 의뢰</h3>
                <p className="text-xs font-semibold text-slate-500">
                  {serviceRequests.length}건
                </p>
              </div>
              <Button kind="outline" tone="blue" onClick={onManageRequests}>
                내 일 현황에서 관리
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
};

const RequestRow = ({
  request,
  direction,
  currencyUnit,
  isTeacher,
  busyKey,
  isExpanded,
  onToggle,
  onAccept,
  onReject,
  onComplete,
  onPay,
}) => {
  const { formatClassCurrency: formatConfiguredAmount } = useConfiguredMoney();
  const formatAmount = (value, unit = "") => `${formatConfiguredAmount(value)}${unit || ""}`;

  const meta = getStatusMeta(request.status, REQUEST_STATUS_META);
  const nameLabel = direction === "received" ? request.requesterName : request.providerName;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="grid gap-3 px-4 py-3 md:grid-cols-[150px_minmax(0,1fr)_120px_minmax(220px,auto)] md:items-center">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-slate-900">{nameLabel || "-"}</p>
          <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
            {request.serviceTitle}
          </p>
        </div>
        <Button type="button" onClick={() => onToggle(request)} className="min-w-0 text-left">
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-600">
            {request.requestMessage}
          </p>
        </Button>
        <p className="text-sm font-black text-slate-700">
          {formatAmount(request.proposedRewardAmount, currencyUnit)}
        </p>
        <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <Button size="sm" kind="outline" tone="slate" icon={FileText} onClick={() => onToggle(request)}>
            {isExpanded ? "접기" : "상세"}
          </Button>
          {direction === "received" && request.status === "requested" ? (
            <>
              <Button
                size="sm"
                tone="blue"
                icon={CheckCircle2}
                onClick={() => onAccept(request)}
                isLoading={busyKey === `request:accept:${request.id}`}
              >
                수락
              </Button>
              <Button
                size="sm"
                kind="outline"
                tone="red"
                icon={XCircle}
                onClick={() => onReject(request)}
                isLoading={busyKey === `request:reject:${request.id}`}
              >
                거절
              </Button>
            </>
          ) : null}
          {request.status === "accepted" ? (
            <Button
              size="sm"
              kind="outline"
              tone="blue"
              icon={CheckCircle2}
              onClick={() => onComplete(request)}
              isLoading={busyKey === `request:complete:${request.id}`}
            >
              완료
            </Button>
          ) : null}
          {isTeacher && ["accepted", "completed"].includes(request.status) ? (
            <Button
              size="sm"
              tone="blue"
              icon={HandCoins}
              onClick={() => onPay(request)}
              isLoading={busyKey === `request:pay:${request.id}`}
            >
              지급
            </Button>
          ) : null}
        </div>
      </div>

      {isExpanded ? (
        <div className="bg-slate-50 px-4 py-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl bg-white px-4 py-3">
              <p className="text-xs font-black text-slate-400">제안 내용</p>
              <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">
                {request.requestMessage || "-"}
              </p>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3">
              <p className="text-xs font-black text-slate-400">참고사항</p>
              <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">
                {request.note || "-"}
              </p>
            </div>
          </div>
          {request.rejectionReason ? (
            <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              거절 사유: {request.rejectionReason}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const RequestManagementModal = ({
  isOpen,
  onClose,
  receivedRequests,
  sentRequests,
  initialDirection = "received",
  currencyUnit,
  isTeacher,
  busyKey,
  onAccept,
  onReject,
  onComplete,
  onPay,
}) => {
  const [direction, setDirection] = useState("received");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    setDirection(initialDirection);
    setStatusFilter("all");
    setExpandedIds([]);
  }, [initialDirection, isOpen]);

  const baseRequests = direction === "received" ? receivedRequests : sentRequests;
  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") return baseRequests;
    if (statusFilter === "closed") {
      return baseRequests.filter((request) =>
        ["rejected", "cancelled"].includes(request.status),
      );
    }
    return baseRequests.filter((request) => request.status === statusFilter);
  }, [baseRequests, statusFilter]);

  const toggleExpanded = (request) => {
    setExpandedIds((current) =>
      current.includes(request.id)
        ? current.filter((id) => id !== request.id)
        : [...current, request.id],
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="의뢰 관리" size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-2xl border border-slate-200 bg-white p-1">
            <Button
              type="button"
              onClick={() => setDirection("received")}
              className={`rounded-xl px-4 py-2 text-sm font-black transition ${
                direction === "received"
                  ? "bg-blue-600 text-white"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              받은 제안
            </Button>
            <Button
              type="button"
              onClick={() => setDirection("sent")}
              className={`rounded-xl px-4 py-2 text-sm font-black transition ${
                direction === "sent"
                  ? "bg-blue-600 text-white"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              보낸 제안
            </Button>
          </div>
          <select
            className="rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-2 text-sm font-bold text-slate-700"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            {REQUEST_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="hidden border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black text-slate-400 md:grid md:grid-cols-[150px_minmax(0,1fr)_120px_minmax(220px,auto)]">
            <span>{direction === "received" ? "제안한 친구" : "도움 줄 친구"}</span>
            <span>제안</span>
            <span>보상</span>
            <span className="text-right">처리</span>
          </div>
          {filteredRequests.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm font-bold text-slate-400">
              표시할 의뢰가 없습니다.
            </div>
          ) : (
            filteredRequests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                direction={direction}
                currencyUnit={currencyUnit}
                isTeacher={isTeacher}
                busyKey={busyKey}
                isExpanded={expandedIds.includes(request.id)}
                onToggle={toggleExpanded}
                onAccept={onAccept}
                onReject={onReject}
                onComplete={onComplete}
                onPay={onPay}
              />
            ))
          )}
        </div>
      </div>
    </Modal>
  );
};

export {
  SERVICE_CATEGORIES,
  SERVICE_STATUS_META,
  REQUEST_STATUS_META,
  inputClassName,
  formatAmount,
  formatDateTime,
  formatPrice,
  buildServiceSearchBlob,
  JobBoardModeTabs,
  CategoryChips,
  ServiceCard,
  ServiceFormModal,
  RequestModal,
  ServiceDetailModal,
  RequestManagementModal,
  Search,
};
