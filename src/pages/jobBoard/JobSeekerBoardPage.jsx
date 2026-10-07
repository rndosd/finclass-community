import JobBoardInbox from "./JobBoardInbox";
import JobSeekerDiscoveryList from "./JobSeekerDiscoveryList";
import { appAlert, appConfirm, appPrompt } from "../../utils/appDialogs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BriefcaseBusiness,
  Plus,
  Search as SearchIcon,
} from "lucide-react";

import AppLayout from "../../components/layout/AppLayout";
import {
  Button,
  CategoryChipBar,
  Modal,
  PageHeader,
  PageLoader,
  SurfaceLoader,
} from "../../components/ui";
import { useFeedback } from "../../contexts/FeedbackContext";
import { useUser } from "../../contexts/UserContext";
import {
  useJobSeekerServiceRequestsQuery,
  useMyReceivedJobSeekerRequestsQuery,
  useMySentJobSeekerRequestsQuery,
  useJobSeekerCategoriesQuery,
  useJobSeekerServicesQuery,
} from "./hooks/useJobSeekerBoardData";
import {
  reviewJobSeekerRequest,
  completeJobSeekerRequest,
  createJobSeekerCategory,
  createJobSeekerRequest,
  createJobSeekerService,
  deleteJobSeekerCategory,
  reorderJobSeekerCategories,
  updateJobSeekerCategory,
  updateJobSeekerService,
} from "./services/jobSeekerBoardService";
import {
  JobBoardModeTabs,
  RequestModal,
  ServiceDetailModal,
  ServiceFormModal,
  buildServiceSearchBlob,
  inputClassName,
} from "./JobSeekerBoardPage.parts";

const ALL_CATEGORY = "전체";
const SHOW_CATEGORY_BAR = false;

const CATEGORY_ICON_OPTIONS = [
  "Sparkles",
  "PaintBrush",
  "BookOpen",
  "Pencil",
  "Laptop",
  "Film",
  "AcademicCap",
  "Tag",
  "Star",
  "Wrench",
];

const CATEGORY_COLOR_OPTIONS = ["blue", "indigo", "cyan", "emerald", "violet", "rose", "orange", "slate"];

const JobSeekerCategoryModal = ({
  isOpen,
  onClose,
  category,
  onSubmit,
  isSubmitting,
}) => {
  const [form, setForm] = useState({
    name: "",
    iconKey: "Tag",
    colorKey: "blue",
    isActive: true,
  });

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      name: category?.label || category?.name || "",
      iconKey: category?.iconKey || "Tag",
      colorKey: category?.colorKey || "blue",
      isActive: category?.active !== false,
    });
  }, [category, isOpen]);

  const setField = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const handleSubmit = () => {
    if (!form.name.trim()) return appAlert("카테고리 이름을 입력해 주세요.");
    onSubmit(form);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={category ? "서비스 카테고리 수정" : "서비스 카테고리 추가"}
      size="md"
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">카테고리 이름</label>
          <input
            className={inputClassName}
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
            placeholder="예: 정리 도우미"
            disabled={isSubmitting}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">아이콘</label>
            <select
              className={inputClassName}
              value={form.iconKey}
              onChange={(event) => setField("iconKey", event.target.value)}
              disabled={isSubmitting}
            >
              {CATEGORY_ICON_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">색상</label>
            <select
              className={inputClassName}
              value={form.colorKey}
              onChange={(event) => setField("colorKey", event.target.value)}
              disabled={isSubmitting}
            >
              {CATEGORY_COLOR_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span>
            <span className="block text-sm font-black text-slate-800">목록에 표시</span>
            <span className="mt-1 block text-xs font-semibold text-slate-500">
              끄면 카테고리는 보관되지만 친구 목록에는 보이지 않습니다.
            </span>
          </span>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setField("isActive", event.target.checked)}
            disabled={isSubmitting}
            className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button kind="outline" tone="slate" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button tone="blue" onClick={handleSubmit} isLoading={isSubmitting}>
            저장
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default function JobSeekerBoardPage() {
  const navigate = useNavigate();
  const { classId, classData, userData, loading, isTeacher } = useUser();
  const { showFeedback } = useFeedback();
  const currencyUnit = classData?.currencyUnit || "머니";


  const [requestDirection, setRequestDirection] = useState("received");
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORY);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [editingService, setEditingService] = useState(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [requestTarget, setRequestTarget] = useState(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [busyKey, setBusyKey] = useState("");

  const { data: services = [], snapshotLoading: isServicesLoading, snapshotError: servicesError, retrySnapshot: retryServices } = useJobSeekerServicesQuery({
    classId,
  });
  const { data: customCategories = [] } = useJobSeekerCategoriesQuery({
    classId,
    enabled: Boolean(classId),
  });

  const receivedRequests = useMyReceivedJobSeekerRequestsQuery({classId, userUid: userData?.uid, enabled: Boolean(classId && userData?.uid && requestDirection === 'received')});
  const sentRequests = useMySentJobSeekerRequestsQuery({classId, userUid: userData?.uid, enabled: Boolean(classId && userData?.uid && requestDirection === 'sent')});
  const requestQuery = requestDirection === 'received' ? receivedRequests : sentRequests;
  const manageRequests = () => navigate('/job-board/me?tab=requests&direction=' + requestDirection + '&status=all');
  const handleRequestAction = async (request, action) => {
    if (busyKey) return;
    let rejectionReason;
    if (action === 'reject') {
      rejectionReason = await appPrompt('거절 사유를 입력해 주세요.', '', {title: '의뢰 거절', confirmLabel: '거절하기'});
      if (rejectionReason === null) return;
      if (!rejectionReason.trim()) return appAlert('거절 사유를 입력해 주세요.');
    }
    if (action === 'complete' && !(await appConfirm('이 의뢰를 완료했다고 알릴까요?', {title: '완료 알리기', confirmLabel: '완료 알리기'}))) return;
    setBusyKey('request:' + action + ':' + request.id);
    try {
      const payload = {classId, serviceId: request.serviceId, requestId: request.id};
      if (action === 'complete') await completeJobSeekerRequest(payload);
      else await reviewJobSeekerRequest({...payload, action, rejectionReason});
      showFeedback(action === 'accept' ? '의뢰를 수락했습니다.' : action === 'reject' ? '의뢰를 거절했습니다.' : '완료를 알렸습니다.', 'success');
    } catch (error) {showFeedback(error.message || '의뢰를 처리하지 못했습니다.', 'error');}
    finally {setBusyKey('');}
  };

  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId) || null,
    [selectedServiceId, services],
  );
  const selectedOwnerServices = useMemo(() => {
    if (!selectedService) return [];
    return services
      .filter(
        (service) =>
          service.status !== "deleted" &&
          service.ownerUid === selectedService.ownerUid,
      )
      .sort((a, b) => {
        const aTime = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
        const bTime = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
  }, [selectedService, services]);
  const canManageSelectedService = Boolean(
    selectedService && (isTeacher || selectedService.ownerUid === userData?.uid),
  );
  const { data: selectedServiceRequests = [] } = useJobSeekerServiceRequestsQuery({
    classId,
    serviceId: selectedService?.id,
    enabled: Boolean(classId && selectedService?.id && canManageSelectedService),
  });

  const categoryItems = useMemo(() => {
    const allCategory = {
      id: ALL_CATEGORY,
      label: ALL_CATEGORY,
      iconKey: "Sparkles",
      colorKey: "blue",
      locked: true,
      editable: false,
      deletable: false,
      reorderable: false,
    };
    const customItems = customCategories.map((category) => ({
      id: category.name,
      label: category.name,
      iconKey: category.iconKey || "Tag",
      colorKey: category.colorKey || "blue",
      active: category.isActive !== false,
      editable: true,
      deletable: true,
      reorderable: true,
      raw: category,
    }));
    return [allCategory, ...customItems.filter((item) => item.label)];
  }, [customCategories]);

  const visibleCategoryItems = useMemo(
    () => categoryItems.filter((category) => category.active !== false),
    [categoryItems],
  );

  const activeServices = useMemo(
    () =>
      services.filter((service) => {
        if (service.status === "deleted") return false;
        const canSeeInactive = isTeacher || service.ownerUid === userData?.uid;
        if (service.status !== "active" && !canSeeInactive) return false;
        if (categoryFilter !== ALL_CATEGORY && service.category !== categoryFilter) return false;
        const lowerSearch = searchTerm.trim().toLowerCase();
        if (lowerSearch && !buildServiceSearchBlob(service).includes(lowerSearch)) return false;
        return true;
      }),
    [categoryFilter, isTeacher, searchTerm, services, userData?.uid],
  );

  const canCreateService = Boolean(userData?.uid);
  const canManageCategories = Boolean(isTeacher || userData?.role === "admin");
  const shouldPreserveList =
    services.length > 0 || Boolean(searchTerm.trim()) || categoryFilter !== ALL_CATEGORY;

  const openServiceForm = (service = null) => {
    setEditingService(service);
    setServiceModalOpen(true);
  };

  const closeServiceForm = () => {
    if (busyKey === "service:create" || busyKey === "service:update") return;
    setServiceModalOpen(false);
    setEditingService(null);
  };

  const closeCategoryModal = () => {
    if (busyKey === "category:save") return;
    setCategoryModalOpen(false);
    setEditingCategory(null);
  };

  const handleSaveCategory = async (payload) => {
    if (!classId) return;
    setBusyKey("category:save");
    try {
      if (editingCategory?.raw?.id) {
        await updateJobSeekerCategory({
          classId,
          categoryId: editingCategory.raw.id,
          updates: payload,
        });
        showFeedback("서비스 카테고리를 수정했습니다.", "success");
      } else {
        await createJobSeekerCategory({
          classId,
          category: {
            ...payload,
            order: customCategories.length + 1,
          },
        });
        showFeedback("서비스 카테고리를 추가했습니다.", "success");
      }
      closeCategoryModal();
    } catch (error) {
      showFeedback(error.message || "카테고리를 저장하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleDeleteCategory = async (item) => {
    if (!classId || !item?.raw?.id) return;
    if (!(await appConfirm(`"${item.label}" 카테고리를 삭제할까요?`, {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    setBusyKey(`category:delete:${item.raw.id}`);
    try {
      await deleteJobSeekerCategory({ classId, categoryId: item.raw.id });
      if (categoryFilter === item.label) setCategoryFilter(ALL_CATEGORY);
      showFeedback("서비스 카테고리를 삭제했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "카테고리를 삭제하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleReorderCategories = async (items) => {
    if (!classId) return;
    const customItems = items.filter((item) => item?.raw?.id).map((item) => item.raw);
    try {
      await reorderJobSeekerCategories({ classId, categories: customItems });
    } catch (error) {
      showFeedback(error.message || "카테고리 순서를 저장하지 못했습니다.", "error");
    }
  };

  const handleSaveService = async (payload) => {
    if (!classId) return;
    const actionKey = editingService ? "service:update" : "service:create";
    setBusyKey(actionKey);
    try {
      if (editingService) {
        await updateJobSeekerService({
          classId,
          serviceId: editingService.id,
          updates: payload,
        });
        showFeedback("서비스를 수정했습니다.", "success");
      } else {
        const services = Array.isArray(payload?.services) ? payload.services : [payload];
        await Promise.all(
          services.map((service) =>
            createJobSeekerService({
              classId,
              service,
              owner: userData,
            }),
          ),
        );
        showFeedback(
          services.length > 1 ? `서비스 ${services.length}개를 등록했습니다.` : "서비스를 등록했습니다.",
          "success",
        );
      }
      setServiceModalOpen(false);
      setEditingService(null);
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleSetServiceStatus = async (service, status) => {
    if (!classId || !service) return;
    setBusyKey(`service:status:${service.id}`);
    try {
      await updateJobSeekerService({
        classId,
        serviceId: service.id,
        updates: { status },
      });
      showFeedback(status === "active" ? "서비스를 공개했습니다." : "서비스를 숨겼습니다.", "success");
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleDeleteService = async (service) => {
    if (!classId || !service) return;
    if (!(await appConfirm("이 구직 서비스를 삭제할까요? 삭제하면 목록에서 숨겨집니다.", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
    setBusyKey(`service:delete:${service.id}`);
    try {
      await updateJobSeekerService({
        classId,
        serviceId: service.id,
        updates: { status: "deleted" },
      });
      if (selectedServiceId === service.id) {
        setSelectedServiceId("");
      }
      showFeedback("구직 서비스를 삭제했습니다.", "success");
    } catch (error) {
      showFeedback(error.message || "구직 서비스를 삭제하지 못했습니다.", "error");
    } finally {
      setBusyKey("");
    }
  };

  const handleCreateRequest = async (payload) => {
    if (!classId || !requestTarget) return;
    setBusyKey(`request:create:${requestTarget.id}`);
    try {
      await createJobSeekerRequest({
        classId,
        serviceId: requestTarget.id,
        request: payload,
        requester: userData,
      });
      showFeedback("의뢰를 보냈습니다.", "success");
      setRequestTarget(null);
    } catch (error) {
      showFeedback(error.message, "error");
    } finally {
      setBusyKey("");
    }
  };

  if ((loading || isServicesLoading) && services.length === 0) {
    return (
      <AppLayout showSidebar showDefaultHeader={false}>
        <PageLoader
          fullHeight={false}
          className="min-h-screen"
          message="서비스를 불러오는 중입니다..."
        />
      </AppLayout>
    );
  }

  if (!classId) {
    return (
      <AppLayout showSidebar showDefaultHeader={false}>
        <div className="min-h-screen bg-[#f0f5ff] p-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600">
            학급 정보가 없어 서비스 페이지를 사용할 수 없습니다.
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showSidebar showDefaultHeader={false}>
      <div className="min-h-screen space-y-6 bg-[#f0f5ff] p-4 sm:p-6 lg:p-8">
        <PageHeader
          title="구직 게시판"
          subtitle="도움이 필요할 때 찾고, 내가 잘하는 일을 등록해요."
          icon={BriefcaseBusiness}
          rightSlot={
            <JobBoardModeTabs
              active="seeker"
              onNavigate={(mode) => navigate(mode === "recruit" ? "/job-board" : "/job-board/seeker")}
            />
          }
        />

        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <a href="#job-board-inbox" className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 underline underline-offset-4 lg:hidden">{requestDirection === 'received' ? '받은 의뢰' : '보낸 의뢰'} 바로 보기</a>
          <div className="hidden lg:block" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {canCreateService ? (
              <Button tone="blue" icon={Plus} onClick={() => openServiceForm()}>
                서비스 등록
              </Button>
            ) : null}
            <Button kind="outline" tone="slate" onClick={() => navigate('/job-board/me?tab=services')}>내 서비스 관리</Button>
          </div>
        </div>

        <main className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
          <div className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
            {SHOW_CATEGORY_BAR ? (
              <CategoryChipBar
                items={canManageCategories ? categoryItems : visibleCategoryItems}
                selectedId={categoryFilter}
                onSelect={setCategoryFilter}
                title="도움 줄 친구 카테고리"
                className="mt-0"
                canEdit={canManageCategories}
                onAdd={() => {
                  setEditingCategory(null);
                  setCategoryModalOpen(true);
                }}
                onEdit={(item) => {
                  if (!item?.raw) return;
                  setEditingCategory(item);
                  setCategoryModalOpen(true);
                }}
                onDelete={handleDeleteCategory}
                onReorder={handleReorderCategories}
                addLabel="카테고리 추가"
              />
            ) : null}
            <div className={`${SHOW_CATEGORY_BAR ? "mt-4 " : ""}relative w-full sm:max-w-xl lg:max-w-2xl`}>
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className={`${inputClassName} h-11 pl-11`}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="이름, 서비스, 설명으로 검색"
              />
            </div>
          </div>

          <SurfaceLoader
            loading={isServicesLoading}
            variant={shouldPreserveList ? "refreshing" : "surface-loading"}
            preserveContent={shouldPreserveList}
            minHeightClassName="min-h-[360px]"
            message={shouldPreserveList ? "서비스 목록을 새로고침하는 중입니다..." : "서비스를 불러오는 중입니다..."}
          >
            {servicesError ? <div role="alert" className="rounded-2xl border border-slate-200 bg-white p-6"><p className="text-sm font-semibold text-rose-700">서비스를 불러오지 못했습니다.</p><Button className="mt-3" kind="outline" tone="slate" onClick={retryServices}>다시 시도</Button></div>
              : activeServices.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
                <p>{searchTerm || categoryFilter !== ALL_CATEGORY ? '조건에 맞는 서비스가 없습니다.' : '아직 등록된 서비스가 없습니다.'}</p>
                {searchTerm || categoryFilter !== ALL_CATEGORY ? <Button className="mt-3" kind="outline" tone="slate" onClick={() => {setSearchTerm(''); setCategoryFilter(ALL_CATEGORY);}}>전체 서비스 보기</Button> : <p className="mt-2">내가 잘 도울 수 있는 일을 서비스로 등록해 보세요.</p>}
              </div> : <JobSeekerDiscoveryList services={activeServices} currencyUnit={currencyUnit} userUid={userData?.uid} isTeacher={isTeacher} onOpen={service => setSelectedServiceId(service.id)} onRequest={setRequestTarget} />}
          </SurfaceLoader>
          </div>
          <JobBoardInbox kind="requests" rows={requestQuery.data || []} currencyUnit={currencyUnit}
            loading={requestQuery.snapshotLoading} error={requestQuery.snapshotError} onRetry={requestQuery.retrySnapshot}
            direction={requestDirection} onDirectionChange={setRequestDirection} busyKey={busyKey}
            onAccept={request => handleRequestAction(request, 'accept')}
            onReject={request => handleRequestAction(request, 'reject')}
            onComplete={request => handleRequestAction(request, 'complete')}
            onOpen={request => navigate('/job-board/me?tab=requests&direction=' + requestDirection + '&status=all&requestId=' + encodeURIComponent(request.id))} onManage={manageRequests} onOwn={() => navigate('/job-board/me?tab=services')}
          />
        </main>

        <ServiceFormModal
          isOpen={serviceModalOpen}
          onClose={closeServiceForm}
          initialService={editingService}
          onSubmit={handleSaveService}
          isSubmitting={busyKey === "service:create" || busyKey === "service:update"}
          currencyUnit={currencyUnit}
        />

        <JobSeekerCategoryModal
          isOpen={categoryModalOpen}
          onClose={closeCategoryModal}
          category={editingCategory}
          onSubmit={handleSaveCategory}
          isSubmitting={busyKey === "category:save"}
        />

        <RequestModal
          isOpen={Boolean(requestTarget)}
          onClose={() => {
            if (requestTarget && busyKey === `request:create:${requestTarget.id}`) return;
            setRequestTarget(null);
          }}
          service={requestTarget}
          onSubmit={handleCreateRequest}
          isSubmitting={Boolean(requestTarget) && busyKey === `request:create:${requestTarget?.id}`}
          currencyUnit={currencyUnit}
        />

        <ServiceDetailModal
          isOpen={Boolean(selectedService)}
          onClose={() => setSelectedServiceId("")}
          service={selectedService}
          services={selectedOwnerServices}
          serviceRequests={selectedServiceRequests}
          currencyUnit={currencyUnit}
          isOwnService={selectedService?.ownerUid === userData?.uid}
          isTeacher={isTeacher}
          canRequest={Boolean(
            selectedService &&
              selectedService.status === "active" &&
              selectedService.ownerUid !== userData?.uid,
          )}
          onRequest={setRequestTarget}
          onEdit={openServiceForm}
          onDelete={handleDeleteService}
          onHide={(service) => handleSetServiceStatus(service, "hidden")}
          onShow={(service) => handleSetServiceStatus(service, "active")}
          onManageRequests={() =>
            navigate("/job-board/me?tab=requests&direction=received&status=all")
          }
        />
      </div>
    </AppLayout>
  );
}
