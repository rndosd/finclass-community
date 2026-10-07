import React from "react";
import { Users } from "lucide-react";

import { Modal } from "../../../components/ui";

const getClassLabel = (classItem) =>
  classItem?.className || classItem?.classDocId || "이름 없는 학급";

const getTeacherLabel = (classItem) =>
  classItem?.teacherName || "담임 미지정";

const getRecentActivityCount = (classItem) =>
  Number(classItem?.recent7dCount || 0);

const formatTimestamp = (value) => {
  if (!value || typeof value.toDate !== "function") return "-";
  return value.toDate().toLocaleString("ko-KR");
};

const ClassActivityModal = ({
  isOpen,
  onClose,
  rankedClasses = [],
  generatedAt = null,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="최근 7일 활동 순위"
    size="lg"
  >
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        마지막 갱신 {formatTimestamp(generatedAt)}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-100">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 font-medium text-slate-500">
            <tr>
              <th className="w-16 p-4 text-left">순위</th>
              <th className="p-4 text-left">학급 정보</th>
              <th className="p-4 text-right">최근 7일 로그</th>
              <th className="p-4 text-center">학생 수</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rankedClasses.map((classItem, index) => (
              <tr
                key={classItem.classId || index}
                className="transition-colors hover:bg-slate-50"
              >
                <td className="p-4">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                      index < 3
                        ? "bg-amber-100 text-amber-600"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {index + 1}
                  </div>
                </td>
                <td className="p-4">
                  <div className="font-bold text-slate-800">
                    {getClassLabel(classItem)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {getTeacherLabel(classItem)} · 활동일{" "}
                    {Number(classItem?.recent7dActiveDays || 0)}일
                  </div>
                </td>
                <td className="p-4 text-right">
                  <span className="font-mono font-bold text-indigo-600">
                    {getRecentActivityCount(classItem).toLocaleString()}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex items-center justify-center gap-1 text-slate-500">
                    <Users size={12} />
                    <span className="text-xs">
                      {Number(classItem?.totalStudents || 0).toLocaleString()}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rankedClasses.length === 0 && (
          <div className="py-20 text-center text-slate-400">
            최근 7일 활동 데이터가 없습니다.
          </div>
        )}
      </div>
    </div>
  </Modal>
);

export default ClassActivityModal;
