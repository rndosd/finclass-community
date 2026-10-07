import React, { useMemo } from "react";
import { Badge, Modal } from "../../../components/ui";
import {
  PERMISSION_GUIDE_INTRO,
  PERMISSION_GUIDE_ITEMS,
  PERMISSION_GUIDE_SCOPE_META,
} from "../permissionGuideConfig";

export default function PermissionGuideModal({ isOpen, onClose }) {
  const groupedItems = useMemo(
    () =>
      PERMISSION_GUIDE_ITEMS.reduce((acc, item) => {
        const groupName = item.group || "기타";
        if (!acc[groupName]) acc[groupName] = [];
        acc[groupName].push(item);
        return acc;
      }, {}),
    [],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="권한 설명 가이드"
      size="lg"
    >
      <div className="space-y-6">
        <div className="rounded-3xl border border-indigo-100 bg-indigo-50/70 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo" variant="solid">
              권한 읽는 법
            </Badge>
            <Badge tone="slate" variant="soft">
              현재 코드 기준
            </Badge>
          </div>
          <div className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
            {PERMISSION_GUIDE_INTRO.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>

        {Object.entries(groupedItems).map(([groupName, items]) => (
          <section key={groupName} className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-slate-900">{groupName}</h3>
              <span className="text-xs font-medium text-slate-400">
                {items.length}개 권한
              </span>
            </div>

            <div className="space-y-3">
              {items.map((item) => {
                const scopeMeta =
                  PERMISSION_GUIDE_SCOPE_META[item.scope] ||
                  PERMISSION_GUIDE_SCOPE_META.page;

                return (
                  <div
                    key={item.key}
                    className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color={item.color || "slate"} variant="soft">
                        {item.label}
                      </Badge>
                      <Badge tone={scopeMeta.tone} variant="outline">
                        {scopeMeta.label}
                      </Badge>
                    </div>

                    <div className="mt-3 space-y-2">
                      <p className="text-sm leading-6 text-slate-700">
                        {item.summary}
                      </p>
                      <p className="text-sm leading-6 text-slate-500">
                        <span className="font-bold text-slate-700">
                          선생님과 비교:
                        </span>{" "}
                        {item.teacherGap}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
