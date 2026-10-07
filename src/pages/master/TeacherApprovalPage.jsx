import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../../components/layout/AppLayout";
import { db } from "../../firebase";
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  orderBy,
} from "firebase/firestore";
import { useFeedback } from "../../contexts/FeedbackContext";
import {
  Card,
  Button,
  Alert,
  PageSkeleton,
  SurfaceLoader,
  TableSkeleton,
} from "../../components/ui";
import {
  RefreshCw,
  ArrowLeft,
  Clock,
  Mail,
  School,
  CheckCircle2,
} from "lucide-react";

const toMillis = (timestamp) => timestamp?.toDate?.()?.getTime?.() || 0;

const getJoinedAt = (teacher) => teacher?.createdAt || teacher?.agreedAt;

const formatCreatedAt = (timestamp) => {
  const date = timestamp?.toDate?.();
  if (!date) return "-";
  return date.toLocaleString("ko-KR");
};

const getStatusBadgeClass = (status) => {
  if (status === "approved") return "bg-emerald-50 text-emerald-700";
  if (status === "pending") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
};

const getStatusLabel = (status) => {
  if (status === "approved") return "가입 완료";
  if (status === "pending") return "설정 중";
  return status || "상태 없음";
};

const TeacherApprovalPage = () => {
  const navigate = useNavigate();
  const { showFeedback } = useFeedback();

  const [recentTeachers, setRecentTeachers] = useState([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasLoadedTeachersRef = useRef(false);

  const fetchRecentTeachers = useCallback(
    async ({ preserveCurrent = false } = {}) => {
      if (preserveCurrent && hasLoadedTeachersRef.current) {
        setIsRefreshing(true);
      } else {
        setIsInitialLoading(true);
      }

      try {
        const usersRef = collection(db, "users");
        const recentQueries = [
          query(
            usersRef,
            where("role", "==", "teacher"),
            orderBy("createdAt", "desc"),
            limit(40),
          ),
          query(
            usersRef,
            where("role", "==", "teacher"),
            orderBy("agreedAt", "desc"),
            limit(40),
          ),
        ];
        const snaps = await Promise.all(recentQueries.map((item) => getDocs(item)));
        const teacherMap = new Map();
        snaps.forEach((snap) => {
          snap.docs.forEach((d) => {
            teacherMap.set(d.id, { id: d.id, ...d.data() });
          });
        });
        const teachers = Array.from(teacherMap.values())
          .sort((a, b) => toMillis(getJoinedAt(b)) - toMillis(getJoinedAt(a)))
          .slice(0, 40);

        setRecentTeachers(teachers);
      } catch (err) {
        console.error("최근 가입자 목록 로드 에러:", err);
        showFeedback("최근 가입자 목록을 불러오지 못했습니다.", "error");
      } finally {
        hasLoadedTeachersRef.current = true;
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    },
    [showFeedback],
  );

  useEffect(() => {
    fetchRecentTeachers();
  }, [fetchRecentTeachers]);

  if (isInitialLoading) {
    return (
      <AppLayout title="교사 최근 가입 내역">
        <div className="mx-auto max-w-6xl space-y-6 p-8">
          <PageSkeleton summaryCards={0} showChart={false} showTable={false} />
          <TableSkeleton columns={5} rows={8} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="교사 최근 가입 내역">
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <Button
          onClick={() => navigate("/admin/master")}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors font-medium group"
        >
          <ArrowLeft
            size={18}
            className="group-hover:-translate-x-1 transition-transform"
          />
          마스터 허브로 돌아가기
        </Button>

        <Card className="border-none shadow-xl shadow-slate-200/60">
          <Card.Header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-50 pb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Clock className="text-blue-600" size={20} />
                <Card.Title className="text-2xl font-bold text-slate-800">
                  최근 교사 가입자
                </Card.Title>
              </div>
              <Card.Description className="text-slate-500">
                승인/거절 없이 최근 가입자 정보만 확인합니다.
              </Card.Description>
            </div>
            <Button size="md"
              variant="outline"
              icon={RefreshCw}
              onClick={() => fetchRecentTeachers({ preserveCurrent: true })}
              isLoading={isRefreshing}
              
            >
              새로고침
            </Button>
          </Card.Header>

          <Card.Content noPadding className="pt-6">
            <SurfaceLoader
              loading={isRefreshing}
              variant="refreshing"
              message="최근 가입자 목록을 새로고침하는 중입니다..."
            >
              {recentTeachers.length === 0 ? (
                <div className="py-20">
                  <Alert
                    type="info"
                    className="bg-blue-50 border-blue-100 text-blue-700 rounded-2xl p-8 text-center flex flex-col items-center gap-3"
                  >
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-2">
                      <CheckCircle2 size={24} className="text-blue-500" />
                    </div>
                    <span className="text-lg font-bold">
                      최근 가입 내역이 없습니다.
                    </span>
                    <p className="text-blue-600/70 text-sm">
                      조건에 맞는 교사 가입 데이터가 아직 없습니다.
                    </p>
                  </Alert>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-100 rounded-2xl shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50/80 border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="p-5">이름</th>
                        <th className="p-5">이메일</th>
                        <th className="p-5">학급명</th>
                        <th className="p-5">상태</th>
                        <th className="p-5">가입 일시</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {recentTeachers.map((teacher) => (
                        <tr
                          key={teacher.id}
                          className="hover:bg-blue-50/30 transition-colors"
                        >
                          <td className="p-5 font-bold text-slate-700">
                            {teacher.name || "-"}
                          </td>
                          <td className="p-5 text-slate-500 font-medium">
                            <div className="flex items-center gap-2">
                              <Mail size={14} className="text-slate-300" />
                              {teacher.email || "-"}
                            </div>
                          </td>
                          <td className="p-5">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg font-bold text-xs">
                              <School size={14} />
                              {teacher.classDocId || "-"}
                            </div>
                          </td>
                          <td className="p-5">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getStatusBadgeClass(teacher.status)}`}
                            >
                              {getStatusLabel(teacher.status)}
                            </span>
                          </td>
                          <td className="p-5 text-slate-500 font-medium">
                            {formatCreatedAt(getJoinedAt(teacher))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SurfaceLoader>
          </Card.Content>
        </Card>
      </div>
    </AppLayout>
  );
};

export default TeacherApprovalPage;
