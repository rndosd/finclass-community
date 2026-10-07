import { appConfirm } from "../../utils/appDialogs";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  DotsSixVertical as GripVertical,
  Minus,
  Plus,
  Sparkle as Sparkles,
  X
} from "@phosphor-icons/react";
import {
  collection,
  deleteDoc,
  doc,
  writeBatch,
} from "firebase/firestore";

import { db } from "../../firebase";
import { adminNavItems } from "../../config/navConfig";
import { useUser } from "../../contexts/UserContext";
import { useClassUiConfig } from "../../contexts/ClassUiConfigContext";
import { useShortcutData } from "../../contexts/ShortcutDataContext";
import DashboardShortcutModal from "../../pages/dashboard/components/DashboardShortcutModal";
import { sanitizeInternalRoutePath } from "../../utils/internalRoute";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import {
  clampShortcutDockPosition,
  getDefaultShortcutDockPosition,
  SHORTCUT_DOCK_WIDTH,
} from "./globalShortcutsDockPosition";

const SHORTCUT_LABEL_ALIASES = {
  "\ud559\uae09 \uacbd\uc81c \uad00\ub9ac": "\uacbd\uc81c \uad00\ub9ac",
  "\ub300\uc2dc\ubcf4\ub4dc \uc124\uc815": "\ud648 \uc124\uc815",
};

const getShortcutDisplayLabel = (label) =>
  SHORTCUT_LABEL_ALIASES[label] || label;

function readDockPreference(storageKey, desktopSidebarWidth) {
  const fallback = {
    isOpen: false,
    isMinimized: false,
    position: getDefaultShortcutDockPosition({ desktopSidebarWidth }),
  };

  if (!storageKey || typeof window === "undefined") return fallback;

  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    if (!saved || typeof saved !== "object") return fallback;
    return {
      isOpen: Boolean(saved.isOpen),
      isMinimized: Boolean(saved.isMinimized),
      position: clampShortcutDockPosition(
        saved.position || fallback.position,
        SHORTCUT_DOCK_WIDTH,
        48,
        { desktopSidebarWidth },
      ),
    };
  } catch (_error) {
    return fallback;
  }
}

export default function GlobalShortcutsDock({ desktopSidebarWidth = 0 }) {
  const navigate = useNavigate();
  const { classId, userData } = useUser();
  const { sidebarSettings } = useClassUiConfig();
  const { shortcuts } = useShortcutData();
  const isTeacher = userData?.role === "teacher";
  const storageKey = useMemo(
    () =>
      classId && userData?.uid
        ? `finclass_global_shortcuts_bar_v2:${classId}:${userData.uid}`
        : null,
    [classId, userData?.uid],
  );

  const [dockPreference, setDockPreference] = useState(() =>
    readDockPreference(null, desktopSidebarWidth),
  );
  const [preferenceReady, setPreferenceReady] = useState(false);
  const [isShortcutModalOpen, setIsShortcutModalOpen] = useState(false);
  const [shortcutLabelsByKey, setShortcutLabelsByKey] = useState({});
  const [selectedAdminLinkKeys, setSelectedAdminLinkKeys] = useState([]);

  const dockRef = useRef(null);
  const dragStateRef = useRef(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    setPreferenceReady(false);
    setDockPreference(readDockPreference(storageKey, desktopSidebarWidth));
    setPreferenceReady(true);
  }, [desktopSidebarWidth, storageKey]);

  useEffect(() => {
    if (!preferenceReady || !storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(dockPreference));
    } catch (_error) {
      // A blocked localStorage should not prevent shortcut navigation.
    }
  }, [dockPreference, preferenceReady, storageKey]);

  useEffect(() => {
    if (!dockPreference.isOpen || typeof window === "undefined") return undefined;

    const keepDockInViewport = () => {
      const width = dockRef.current?.offsetWidth || SHORTCUT_DOCK_WIDTH;
      const height = dockRef.current?.offsetHeight || 48;
      setDockPreference((previous) => ({
        ...previous,
        position: clampShortcutDockPosition(previous.position, width, height, {
          desktopSidebarWidth,
        }),
      }));
    };

    window.addEventListener("resize", keepDockInViewport);
    const frame = window.requestAnimationFrame(keepDockInViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", keepDockInViewport);
    };
  }, [desktopSidebarWidth, dockPreference.isMinimized, dockPreference.isOpen]);

  const getDisplayLabelForPath = useCallback(
    (path, fallback) => {
      const entry = sidebarSettings?.[path];
      return entry && typeof entry === "object" && entry.customLabel
        ? entry.customLabel
        : fallback;
    },
    [sidebarSettings],
  );

  const existingShortcutPaths = useMemo(
    () => new Set(shortcuts.map((shortcut) => shortcut.path).filter(Boolean)),
    [shortcuts],
  );

  const availableAdminLinks = useMemo(() => {
    const links = [];
    adminNavItems.forEach((section) => {
      if (section.role === "admin" || !section.children) return;
      section.children.forEach((child) => {
        if (!child.path) return;
        const sectionLabel =
          typeof section.label === "string" ? section.label : "기타";
        const baseLabel = typeof child.label === "string" ? child.label : "메뉴";
        links.push({
          key: `${sectionLabel}-${child.path}`,
          sectionLabel,
          label: getDisplayLabelForPath(child.path, baseLabel),
          path: child.path,
          alreadyAdded: existingShortcutPaths.has(child.path),
        });
      });
    });
    return links;
  }, [existingShortcutPaths, getDisplayLabelForPath]);

  const availableAdminLinkMap = useMemo(
    () =>
      availableAdminLinks.reduce((map, link) => {
        map[link.key] = link;
        return map;
      }, {}),
    [availableAdminLinks],
  );

  const groupedAvailableAdminLinks = useMemo(
    () =>
      availableAdminLinks.reduce((groups, link) => {
        if (!groups[link.sectionLabel]) groups[link.sectionLabel] = [];
        groups[link.sectionLabel].push(link);
        return groups;
      }, {}),
    [availableAdminLinks],
  );

  const selectedShortcutLinks = useMemo(
    () =>
      selectedAdminLinkKeys
        .map((key) => {
          const link = availableAdminLinkMap[key];
          if (!link || link.alreadyAdded) return null;
          return {
            ...link,
            customLabel: shortcutLabelsByKey[key] ?? link.label,
          };
        })
        .filter(Boolean),
    [availableAdminLinkMap, selectedAdminLinkKeys, shortcutLabelsByKey],
  );

  useEffect(() => {
    setShortcutLabelsByKey((previous) => {
      const next = {};
      selectedShortcutLinks.forEach((link) => {
        next[link.key] = previous[link.key] ?? link.label;
      });
      const previousKeys = Object.keys(previous);
      const nextKeys = Object.keys(next);
      const isSame =
        previousKeys.length === nextKeys.length &&
        nextKeys.every((key) => previous[key] === next[key]);
      return isSame ? previous : next;
    });
  }, [selectedShortcutLinks]);

  const resetShortcutModal = useCallback(() => {
    setIsShortcutModalOpen(false);
    setShortcutLabelsByKey({});
    setSelectedAdminLinkKeys([]);
  }, []);

  const toggleShortcutSelection = useCallback(
    (linkKey) => {
      const target = availableAdminLinkMap[linkKey];
      if (!target || target.alreadyAdded) return;
      setSelectedAdminLinkKeys((previous) =>
        previous.includes(linkKey)
          ? previous.filter((key) => key !== linkKey)
          : [...previous, linkKey],
      );
    },
    [availableAdminLinkMap],
  );

  const handleAddShortcut = useCallback(async () => {
    if (!classId || !userData?.uid || selectedShortcutLinks.length === 0) return;

    try {
      const shortcutsRef = collection(
        db,
        "classes",
        classId,
        "displaySettings",
        "dashboard",
        "shortcuts",
      );
      const batch = writeBatch(db);
      const baseOrder = Date.now();
      selectedShortcutLinks.forEach((link, index) => {
        batch.set(doc(shortcutsRef), {
          label: link.customLabel.trim() || link.label,
          path: link.path,
          order: baseOrder + index,
          createdAt: new Date(),
          createdBy: userData.uid,
        });
      });
      await batch.commit();
      resetShortcutModal();
    } catch (error) {
      console.error("[GlobalShortcutsDock] shortcut add failed:", error);
    }
  }, [classId, resetShortcutModal, selectedShortcutLinks, userData?.uid]);

  const handleDeleteShortcut = useCallback(
    async (shortcutId, event) => {
      event.stopPropagation();
      if (!classId || !(await appConfirm("이 바로가기를 삭제하시겠습니까?", {"title":"삭제 확인","confirmLabel":"삭제하기","tone":"rose"}))) return;
      try {
        await deleteDoc(
          doc(
            db,
            "classes",
            classId,
            "displaySettings",
            "dashboard",
            "shortcuts",
            shortcutId,
          ),
        );
      } catch (error) {
        console.error("[GlobalShortcutsDock] shortcut delete failed:", error);
      }
    },
    [classId],
  );

  const startDragging = useCallback((event) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClickRef.current = false;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: dockPreference.position,
    };
  }, [dockPreference.position]);

  const continueDragging = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startClientX;
    const deltaY = event.clientY - dragState.startClientY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) {
      suppressClickRef.current = true;
    }

    const width = dockRef.current?.offsetWidth || SHORTCUT_DOCK_WIDTH;
    const height = dockRef.current?.offsetHeight || 48;
    const position = clampShortcutDockPosition(
      {
        x: dragState.startPosition.x + deltaX,
        y: dragState.startPosition.y + deltaY,
      },
      width,
      height,
      { desktopSidebarWidth },
    );
    setDockPreference((previous) => ({ ...previous, position }));
  }, [desktopSidebarWidth]);

  const stopDragging = useCallback((event) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  }, []);

  if (!isTeacher || !classId) return null;

  const toggleDock = () => {
    setDockPreference((previous) => ({
      ...previous,
      isOpen: !previous.isOpen,
      isMinimized: previous.isOpen ? previous.isMinimized : false,
    }));
  };

  const dockLayer = dockPreference.isOpen ? (
    <>
      {dockPreference.isMinimized ? (
        <button
          ref={dockRef}
          type="button"
          aria-label="바로가기 도크 펼치기"
          title="바로가기 펼치기"
          className="fixed z-[80] flex h-10 w-10 cursor-grab touch-none items-center justify-center rounded-xl border border-blue-200 bg-white text-blue-600 shadow-lg shadow-slate-300/40 transition hover:bg-blue-50 active:cursor-grabbing"
          style={{
            left: dockPreference.position.x,
            top: dockPreference.position.y,
          }}
          onPointerDown={startDragging}
          onPointerMove={continueDragging}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            setDockPreference((previous) => ({
              ...previous,
              isMinimized: false,
            }));
          }}
        >
          <Sparkles size={18} />
        </button>
      ) : (
        <aside
          ref={dockRef}
          aria-label="바로가기 도크"
          data-tour="dashboard-quick-links"
          className="fixed z-[80] flex h-12 w-[min(720px,calc(100vw-32px))] flex-row items-stretch overflow-hidden rounded-2xl border border-slate-200/90 bg-white font-sans shadow-lg shadow-slate-900/10"
          style={{
            left: dockPreference.position.x,
            top: dockPreference.position.y,
          }}
        >
          <div className="flex shrink-0 items-center border-r border-slate-100 bg-slate-50/90 pr-1">
            <div
              className="flex h-full shrink-0 cursor-grab touch-none select-none items-center gap-1.5 px-2 active:cursor-grabbing"
              onPointerDown={startDragging}
              onPointerMove={continueDragging}
              onPointerUp={stopDragging}
              onPointerCancel={stopDragging}
            >
              <GripVertical size={17} className="shrink-0 text-slate-300" />
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                <Sparkles size={16} />
              </div>
              <div className="hidden">
                <p className="truncate text-sm font-extrabold text-slate-800">바로가기</p>
                <p className="text-[10px] font-medium text-slate-400">잡아서 위치 이동</p>
              </div>
            </div>
            <IconButton
              icon={Minus}
              label="바로가기 도크 축소"
              tone="slate"
              size="sm"
              className="h-8 w-8 rounded-lg text-slate-400 hover:bg-white"
              onClick={() =>
                setDockPreference((previous) => ({
                  ...previous,
                  isMinimized: true,
                }))
              }
            />
            <IconButton
              icon={X}
              label="바로가기 도크 닫기"
              tone="slate"
              size="sm"
              className="h-8 w-8 rounded-lg text-slate-400 hover:bg-white"
              onClick={() => {
                resetShortcutModal();
                setDockPreference((previous) => ({
                  ...previous,
                  isOpen: false,
                }));
              }}
            />
          </div>

          <div className="flex min-w-0 flex-1 items-center overflow-x-auto px-1.5">
            {shortcuts.length > 0 ? (
              <div className="flex w-full min-w-max items-center gap-1">
                {shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="group flex min-w-[112px] flex-1 items-center rounded-xl border border-transparent bg-slate-50/80 p-0.5 transition hover:border-blue-100 hover:bg-blue-50/70"
                  >
                    <Button
                      type="button"
                      kind="ghost"
                      tone="slate"
                      size="xs"
                      title={getShortcutDisplayLabel(shortcut.label)}
                      className="flex h-8 min-w-0 flex-1 items-center rounded-lg px-2 py-1 text-left font-sans leading-5"
                      onClick={() => {
                        const targetPath = sanitizeInternalRoutePath(shortcut.path);
                        if (targetPath) navigate(targetPath);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">
                        {getShortcutDisplayLabel(shortcut.label)}
                      </span>
                    </Button>
                    <IconButton
                      icon={X}
                      label={`${shortcut.label} 삭제`}
                      tone="red"
                      size="sm"
                      className="h-8 w-8 shrink-0 rounded-lg text-slate-400 hover:bg-white hover:text-rose-500"
                      onClick={(event) => handleDeleteShortcut(shortcut.id, event)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-8 items-center rounded-lg border border-dashed border-slate-200 px-3 [&>p+p]:hidden">
                <p className="text-sm font-bold text-slate-500">등록된 바로가기가 없어요.</p>
                <p className="mt-1 text-xs text-slate-400">자주 쓰는 관리 메뉴를 추가해 보세요.</p>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center border-l border-slate-100 bg-slate-50/70 p-1.5">
            <Button
              type="button"
              data-tour="dashboard-shortcut-add"
              icon={Plus}
              tone="blue"
              kind="soft"
              size="xs"
              className="h-8 shrink-0 justify-center whitespace-nowrap rounded-lg px-2 font-sans text-xs leading-5"
              onClick={() => setIsShortcutModalOpen(true)}
            >
              바로가기 추가
            </Button>
          </div>
        </aside>
      )}

      <DashboardShortcutModal
        open={isShortcutModalOpen}
        groupedAvailableAdminLinks={groupedAvailableAdminLinks}
        selectedAdminLinkKeys={selectedAdminLinkKeys}
        hasSelectableAdminLinks={availableAdminLinks.some(
          (link) => !link.alreadyAdded,
        )}
        selectedShortcutLinks={selectedShortcutLinks}
        onClose={resetShortcutModal}
        onToggleShortcut={toggleShortcutSelection}
        onChangeLabel={(linkKey, value) =>
          setShortcutLabelsByKey((previous) => ({
            ...previous,
            [linkKey]: value,
          }))
        }
        onSubmit={handleAddShortcut}
      />
    </>
  ) : null;

  return (
    <>
      <IconButton
        icon={Sparkles}
        label={dockPreference.isOpen ? "바로가기 도크 닫기" : "바로가기 도크 열기"}
        title="바로가기"
        tone="blue"
        size="sm"
        active={dockPreference.isOpen}
        data-tour="global-shortcuts-trigger"
        className={
          dockPreference.isOpen
            ? "rounded-full bg-blue-50 text-blue-600"
            : "rounded-full text-slate-400 hover:bg-blue-50 hover:text-blue-600"
        }
        onClick={toggleDock}
      />
      {typeof document !== "undefined" && dockLayer
        ? createPortal(dockLayer, document.body)
        : null}
    </>
  );
}
