// src/pages/admin/modals/PasswordResetModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  CheckCircle,
  LockKeyhole,
  Search,
  X,
} from "lucide-react";
import { db, functions } from "../../../firebase";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import StudentSelector from "../../../components/ui/StudentSelector";
import {
  Button,
  CardSkeleton,
  Modal,
  SurfaceLoader,
  TableSkeleton,
} from "../../../components/ui";

const resetPassword = httpsCallable(functions, "resetPassword");
const RESETTABLE_ROLES = new Set(["student", "teacher", "admin"]);
const ADMIN_RESULT_LIMIT = 80;

const normalizeText = (value) => String(value ?? "").trim();
const normalizeSearchText = (value) => normalizeText(value).toLowerCase();

const compareAdminUsers = (left, right) => {
  const roleOrder = { admin: 0, teacher: 1, student: 2 };
  const leftRoleOrder = roleOrder[left.role] ?? Number.MAX_SAFE_INTEGER;
  const rightRoleOrder = roleOrder[right.role] ?? Number.MAX_SAFE_INTEGER;

  if (leftRoleOrder !== rightRoleOrder) {
    return leftRoleOrder - rightRoleOrder;
  }

  const leftClass = normalizeText(left.className || left.classId);
  const rightClass = normalizeText(right.className || right.classId);
  const classCompare = leftClass.localeCompare(rightClass, "ko");
  if (classCompare !== 0) return classCompare;

  const leftNumber = Number(left.studentNumber);
  const rightNumber = Number(right.studentNumber);
  const leftHasNumber = Number.isFinite(leftNumber);
  const rightHasNumber = Number.isFinite(rightNumber);

  if (leftHasNumber && rightHasNumber && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  if (leftHasNumber && !rightHasNumber) return -1;
  if (!leftHasNumber && rightHasNumber) return 1;

  const leftLabel = normalizeText(left.name || left.email || left.uid);
  const rightLabel = normalizeText(right.name || right.email || right.uid);
  return leftLabel.localeCompare(rightLabel, "ko");
};

const getRoleLabel = (role) => {
  if (role === "admin") return "관리자";
  if (role === "teacher") return "교사";
  return "학생";
};

const getRoleBadgeClass = (role) => {
  if (role === "admin") return "bg-rose-50 text-rose-700 border-rose-100";
  if (role === "teacher") return "bg-blue-50 text-blue-700 border-blue-100";
  return "bg-emerald-50 text-emerald-700 border-emerald-100";
};

function InlineAlert({ message, type }) {
  if (!message) return null;

  const styles = {
    success: "bg-green-50 text-green-700",
    error: "bg-red-50 text-red-700",
    info: "bg-blue-50 text-blue-700",
  };

  const icons = {
    success: CheckCircle,
    error: AlertTriangle,
    info: AlertTriangle,
  };

  const Icon = icons[type] || AlertTriangle;

  return (
    <div className={`mt-4 p-3 rounded-md text-sm flex items-center gap-2 ${styles[type] || styles.info}`}>
      <Icon className="h-5 w-5 flex-shrink-0" />
      <p>{message}</p>
    </div>
  );
}

export default function PasswordResetModal({ isOpen, onClose }) {
  const { userData, loading, isTeacher, isAdmin } = useUser();
  const { showFeedback } = useFeedback();

  const [selectedUids, setSelectedUids] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [isProcessing, setIsProcessing] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [isAdminUsersLoading, setIsAdminUsersLoading] = useState(false);
  const [adminSearch, setAdminSearch] = useState("");

  const canReset = !!userData && (isTeacher || isAdmin);

  const matchedAdminUsers = useMemo(() => {
    if (!isAdmin) return [];

    const keyword = normalizeSearchText(adminSearch);
    return adminUsers.filter((user) => {
      if (!keyword) return true;

      return [
        user.name,
        user.email,
        user.uid,
        user.className,
        user.classId,
      ].some((value) => normalizeSearchText(value).includes(keyword));
    });
  }, [adminSearch, adminUsers, isAdmin]);

  const visibleAdminUsers = useMemo(
    () => matchedAdminUsers.slice(0, ADMIN_RESULT_LIMIT),
    [matchedAdminUsers],
  );

  const selectedAdminUser = useMemo(
    () => adminUsers.find((user) => user.uid === selectedUids[0]) || null,
    [adminUsers, selectedUids],
  );

  useEffect(() => {
    if (isOpen) return;

    setSelectedUids([]);
    setMessage({ text: "", type: "" });
    setAdminSearch("");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isAdmin) return undefined;

    let isCancelled = false;

    const fetchAllUsers = async () => {
      setIsAdminUsersLoading(true);

      try {
        const snapshot = await getDocs(collection(db, "users"));
        if (isCancelled) return;

        const users = snapshot.docs
          .map((document) => {
            const data = document.data() || {};
            const role = normalizeSearchText(data.role);

            return {
              uid: document.id,
              name: normalizeText(data.name),
              email: normalizeText(data.email),
              role,
              classId: normalizeText(data.classId),
              className: normalizeText(data.className || data.classId),
              studentNumber: data.studentNumber,
            };
          })
          .filter((user) => user.uid && RESETTABLE_ROLES.has(user.role))
          .sort(compareAdminUsers);

        setAdminUsers(users);
      } catch (error) {
        if (isCancelled) return;

        console.error("전체 사용자 목록 로드 오류:", error);
        setAdminUsers([]);
        showFeedback("전체 사용자 목록을 불러오지 못했습니다.", "error");
      } finally {
        if (!isCancelled) {
          setIsAdminUsersLoading(false);
        }
      }
    };

    fetchAllUsers();

    return () => {
      isCancelled = true;
    };
  }, [isAdmin, isOpen, showFeedback]);

  const handleReset = async () => {
    if (selectedUids.length === 0) {
      const errorMsg = "초기화할 대상을 선택해 주세요.";
      setMessage({ text: errorMsg, type: "error" });
      showFeedback(errorMsg, "warning");
      return;
    }

    setIsProcessing(true);
    setMessage({ text: "", type: "" });

    try {
      const result = await resetPassword({ uid: selectedUids[0] });
      const successMsg = result?.data?.message || "비밀번호가 초기화되었습니다.";

      setMessage({ text: successMsg, type: "success" });
      showFeedback(successMsg, "success");
      setSelectedUids([]);
    } catch (err) {
      console.error("비밀번호 초기화 오류:", err);

      const errorMsg =
        err?.message || err?.code || "알 수 없는 오류가 발생했습니다.";

      setMessage({ text: errorMsg, type: "error" });
      showFeedback(errorMsg, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={!isProcessing ? onClose : undefined}
      size={isAdmin ? "md" : "sm"}
      closeOnOverlayClick={!isProcessing}
    >
      <Modal.Header>
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-full">
            <LockKeyhole className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">비밀번호 초기화</h2>
            <p className="text-xs text-slate-500">권한: {userData?.role || "알 수 없음"}</p>
          </div>
        </div>
        <Button tone="slate" kind="ghost" size="icon-md"
          onClick={!isProcessing ? onClose : undefined}
          className="transition-colors"
          aria-label="닫기"
          disabled={isProcessing}
        >
          <X className="h-5 w-5" />
        </Button>
      </Modal.Header>

      <Modal.Body>
        <SurfaceLoader
          loading={loading}
          skeleton={<CardSkeleton bare className="min-h-[16rem]" />}
          minHeightClassName="min-h-[16rem]"
          className="rounded-3xl"
        >
          {!userData ? (
            <div className="py-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
              <p className="font-medium text-slate-700">로그인이 필요합니다.</p>
              <p className="mt-1 text-sm text-slate-500">로그인 후 다시 시도해 주세요.</p>
            </div>
          ) : !canReset ? (
            <div className="py-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
              <p className="mb-1 font-semibold text-slate-800">접근 권한이 없습니다.</p>
              <p className="text-sm text-slate-600">이 기능을 사용할 권한이 없습니다.</p>
            </div>
          ) : isAdmin ? (
            <>
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">최종관리자 모드</p>
                  <p className="mt-1 text-xs text-amber-700">
                    전체 유저를 대상으로 이름, 이메일, UID 일부를 검색해 비밀번호를 초기화할 수 있습니다.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-tighter text-slate-400">
                    대상 검색
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={adminSearch}
                      onChange={(event) => setAdminSearch(event.target.value)}
                      placeholder="이름, 이메일, UID, 학급명으로 검색"
                      disabled={isProcessing || isAdminUsersLoading}
                      className="w-full rounded-xl border border-blue-200 bg-blue-50/50 py-2.5 pl-10 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-indigo-50 disabled:cursor-not-allowed disabled:bg-slate-50"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {isAdminUsersLoading
                      ? "전체 유저 목록을 불러오는 중입니다..."
                      : `검색 결과 ${matchedAdminUsers.length.toLocaleString()}명${
                          matchedAdminUsers.length > visibleAdminUsers.length
                            ? ` 중 ${visibleAdminUsers.length.toLocaleString()}명 표시`
                            : ""
                        }`}
                  </p>
                </div>

                <SurfaceLoader
                  loading={isAdminUsersLoading}
                  skeleton={<TableSkeleton bare columns={2} rows={5} />}
                  minHeightClassName="min-h-[18rem]"
                  className="rounded-3xl"
                >
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    {visibleAdminUsers.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <p className="text-sm font-semibold text-slate-700">
                          검색 조건에 맞는 사용자가 없습니다.
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          이름이나 이메일, UID 일부를 다시 입력해 주세요.
                        </p>
                      </div>
                    ) : (
                      <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                        {visibleAdminUsers.map((targetUser) => {
                          const isSelected = selectedUids[0] === targetUser.uid;
                          const secondaryId = targetUser.email || targetUser.uid;
                          const classLabel = targetUser.className || "소속 없음";

                          return (
                            <Button
                              key={targetUser.uid}
                              type="button"
                              onClick={() => setSelectedUids([targetUser.uid])}
                              disabled={isProcessing}
                              className={`w-full px-4 py-3 text-left transition ${
                                isSelected
                                  ? "bg-indigo-50"
                                  : "bg-white hover:bg-slate-50"
                              } disabled:cursor-not-allowed disabled:opacity-70`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-slate-800">
                                      {targetUser.name || "이름 없음"}
                                    </span>
                                    <span
                                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getRoleBadgeClass(targetUser.role)}`}
                                    >
                                      {getRoleLabel(targetUser.role)}
                                    </span>
                                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                      {classLabel}
                                    </span>
                                  </div>
                                  <p className="mt-1 truncate text-xs text-slate-600">
                                    {secondaryId}
                                  </p>
                                  {targetUser.email && targetUser.email !== targetUser.uid && (
                                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                      UID: {targetUser.uid}
                                    </p>
                                  )}
                                </div>
                                {isSelected && (
                                  <CheckCircle className="h-5 w-5 flex-shrink-0 text-indigo-600" />
                                )}
                              </div>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </SurfaceLoader>

                {selectedAdminUser && (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                    <p className="text-xs font-semibold text-indigo-700">선택된 대상</p>
                    <p className="mt-1 text-sm font-semibold text-indigo-900">
                      {selectedAdminUser.name || "이름 없음"} ({getRoleLabel(selectedAdminUser.role)})
                    </p>
                    <p className="mt-0.5 break-all text-xs text-indigo-700">
                      {selectedAdminUser.email || selectedAdminUser.uid}
                    </p>
                  </div>
                )}

                <Button size="sm"
                  tone="blue"
                  fullWidth
                  onClick={handleReset}
                  disabled={isAdminUsersLoading || selectedUids.length === 0}
                  isLoading={isProcessing}
                  icon={CheckCircle}
                  
                >
                  비밀번호 초기화
                </Button>
              </div>

              <InlineAlert message={message.text} type={message.type} />
            </>
          ) : (
            <>
              <div className="space-y-5">
                <StudentSelector
                  label="초기화할 대상 선택"
                  selectedUids={selectedUids}
                  onChange={setSelectedUids}
                  includeTeacher={true}
                  singleSelect={true}
                  multiple={false}
                />

                <Button size="sm"
                  tone="blue"
                  fullWidth
                  onClick={handleReset}
                  disabled={selectedUids.length === 0}
                  isLoading={isProcessing}
                  icon={CheckCircle}
                  
                >
                  비밀번호 초기화
                </Button>
              </div>

              <InlineAlert message={message.text} type={message.type} />
            </>
          )}
        </SurfaceLoader>
      </Modal.Body>

      <Modal.Footer>
        <Button
          variant="outline"
          fullWidth
          onClick={!isProcessing ? onClose : undefined}
          disabled={isProcessing}
        >
          닫기
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
