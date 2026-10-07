import React, { useState, useEffect, useCallback } from "react";
import { db } from "../../../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useUser } from "../../../contexts/UserContext";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { Spinner, ToggleSwitch } from "../../../components/ui";
import { GripVertical, Check } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  getSidebarConfigurableItems,
  normalizeSidebarMenuOrder,
} from "../../../components/layout/sidebarMenuUtils";

const SortableMenuItem = ({
  id,
  item,
  settings,
  onToggle,
  onLabelChange,
  index,
  saving,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.4 : 1,
  };

  const getDefaultLabel = (label) => {
    if (typeof label === "string") return label;
    if (React.isValidElement(label)) {
      const children = label.props.children;
      return Array.isArray(children)
        ? children.find((c) => typeof c === "string")
        : typeof children === "string"
          ? children
          : "메뉴";
    }
    return "메뉴";
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col p-3 bg-white rounded-xl border-2 transition-all ${isDragging ? "border-indigo-500 shadow-xl scale-[1.02]" : "border-gray-100 hover:border-indigo-100"}`}
    >
      <div className="flex items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="p-1 cursor-grab text-gray-400 hover:text-indigo-600 transition-colors"
        >
          <GripVertical className="w-5 h-5" />
        </div>
        <div className="flex items-center justify-center w-6 h-6 rounded bg-gray-50 text-[10px] font-bold text-gray-400">
          {index + 1}
        </div>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <item.icon
            className={`w-5 h-5 flex-shrink-0 ${settings[id]?.enabled !== false ? "text-indigo-600" : "text-gray-300"}`}
          />
          <span className="text-sm font-bold text-gray-800 truncate">
            {getDefaultLabel(item.label)}
          </span>
        </div>
        <ToggleSwitch
          checked={settings[id]?.enabled !== false}
          onChange={() => onToggle(id)}
          disabled={saving}
          srLabel={`${getDefaultLabel(item.label)} 메뉴 표시`}
        />
      </div>
      {settings[id]?.enabled !== false && (
        <div className="mt-2 ml-9">
          <input
            type="text"
            value={settings[id]?.customLabel || ""}
            onChange={(e) => onLabelChange(id, e.target.value)}
            placeholder={`기본 이름: ${getDefaultLabel(item.label)}`}
            className="w-full px-3 py-1.5 text-xs border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
            disabled={saving}
          />
        </div>
      )}
    </div>
  );
};

const MenuSettingsTab = () => {
  const { classId } = useUser();
  const { showFeedback } = useFeedback();
  const [menuSettings, setMenuSettings] = useState({});
  const [menuOrder, setMenuOrder] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const sidebarMenuItems = getSidebarConfigurableItems();
  const menuItemsByPath = Object.fromEntries(
    sidebarMenuItems.map((item) => [item.path, item]),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (!classId) return;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(
          doc(db, `classes/${classId}/displaySettings/sidebar`),
        );
        if (snap.exists()) {
          const data = snap.data();
          const order = normalizeSidebarMenuOrder(data.order);
          setMenuSettings(data);
          setMenuOrder(order);
        } else {
          setMenuOrder(normalizeSidebarMenuOrder());
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    })();
  }, [classId]);

  // DB 실시간 저장 함수
  const saveToFirebase = useCallback(
    async (newSettings, newOrder) => {
      if (!classId) return;
      setSaving(true);
      try {
        await setDoc(doc(db, `classes/${classId}/displaySettings/sidebar`), {
          ...newSettings,
          order: newOrder,
        });
      } catch (e) {
        showFeedback("메뉴 설정 저장 중 오류가 발생했습니다.", "error");
      } finally {
        setSaving(false);
      }
    },
    [classId, showFeedback],
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      const oldIdx = menuOrder.indexOf(active.id);
      const newIdx = menuOrder.indexOf(over.id);
      const newOrder = arrayMove(menuOrder, oldIdx, newIdx);

      setMenuOrder(newOrder);
      saveToFirebase(menuSettings, newOrder);
      showFeedback("메뉴 순서가 변경되었습니다.", "success");
    }
  };

  const handleToggle = (path) => {
    const isCurrentlyEnabled = menuSettings[path]?.enabled !== false;
    const newSettings = {
      ...menuSettings,
      [path]: { ...menuSettings[path], enabled: !isCurrentlyEnabled },
    };
    setMenuSettings(newSettings);
    saveToFirebase(newSettings, menuOrder);
    showFeedback("메뉴 가시성이 변경되었습니다.", "info");
  };

  const handleLabelChange = (path, label) => {
    const newSettings = {
      ...menuSettings,
      [path]: { ...menuSettings[path], customLabel: label },
    };
    setMenuSettings(newSettings);
    // 라벨 변경은 입력 중일 수 있으므로 디바운싱 없이 바로 저장하면 부하가 생길 수 있지만,
    // 요구사항에 맞춰 실시간 저장 구조를 유지합니다.
    saveToFirebase(newSettings, menuOrder);
  };

  if (loading)
    return (
      <div className="p-10 flex justify-center">
        <Spinner />
      </div>
    );

  return (
    <div className="p-6">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">
              사이드바 메뉴 설정
            </h3>
            <p className="text-xs text-gray-400 mt-0.5 font-medium">
              항목을 드래그하여 순서를 바꾸거나 이름을 수정하세요.
            </p>
          </div>

          {/* 실시간 저장 상태 배지 */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all duration-300 ${saving ? "bg-amber-50 text-amber-600" : "bg-green-50 text-green-600"}`}
          >
            {saving ? (
              <>
                <Spinner
                  size="xs"
                  color="current"
                  containerClassName="gap-0"
                />{" "}
                {"\uC800\uC7A5 \uC911"}
              </>
            ) : (
              <>
                <Check className="w-3 h-3" /> 모든 변경 저장됨
              </>
            )}
          </div>
        </div>

        <p className="mb-4 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
          메뉴 표시를 끄면 학생의 사이드바에서만 숨겨집니다. 접근 권한은 유지되므로 기존 주소로 들어갈 수 있습니다.
          학생 이용을 막으려면 학생 권한 설정에서 해당 보기·관리 권한과 직업으로 부여된 권한을 확인해 주세요.
        </p>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={menuOrder}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {menuOrder.map((path, idx) => {
                const item = menuItemsByPath[path];

                if (!item) return null;

                return (
                  <SortableMenuItem
                    key={path}
                    id={path}
                    item={item}
                    index={idx}
                    settings={menuSettings}
                    onToggle={handleToggle}
                    onLabelChange={handleLabelChange}
                    saving={saving}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
};

export default MenuSettingsTab;
