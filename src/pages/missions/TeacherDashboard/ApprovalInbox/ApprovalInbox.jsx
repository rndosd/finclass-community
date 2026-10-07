import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, Inbox, Paperclip, RefreshCw, Search, X } from "lucide-react";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { Button } from "../../../../components/ui";
import Modal from "../../../../components/ui/Modal";
import { useUser } from "../../../../contexts/UserContext";
import { useFeedback } from "../../../../contexts/FeedbackContext";
import { sanitizeRichHtml } from "../../../../utils/sanitizeRichHtml";
import { approveAlwaysAttemptBatch, rejectAlwaysAttemptBatch } from "../../services/missionAlwaysService";
import { confirmMissionAction } from "../../components/MissionActionDialog";
import { getRewardApprovalDefaults, getRewardDisplayText, hasRewardRange, normalizeRewardList } from "../../utils/rewardUtils";
import RewardOverrideFields from "../modals/components/RewardOverrideFields";
import { useApprovalInbox, useInboxSubmission, usePendingAlwaysRows } from "./useApprovalInbox";
import { toRequestDate, usesSubmission } from "./approvalInboxModel";
import "./approvalInbox.css";
dayjs.locale("ko");
const EMPTY = [];
const formatTime = value => {
  const date = toRequestDate(value);
  return date ? dayjs(date).format("MM.DD HH:mm") : "시간 미기록";
};
function SubmissionPreview({
  classId,
  mission,
  row
}) {
  const {
    submission,
    loading,
    error
  } = useInboxSubmission(classId, mission, row);
  const preview = useMemo(() => {
    const html = submission?.contentHtml || submission?.content?.html || "";
    const document = new DOMParser().parseFromString(sanitizeRichHtml(html).replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, "$& "), "text/html");
    const text = (document.body.textContent || "").replace(/\s+/g, " ").trim();
    const images = document.querySelectorAll("img").length;
    const attachments = submission?.content?.attachments?.length || 0;
    return {
      text: text || row.preview,
      media: [images ? `이미지 ${images}개` : "", attachments ? `첨부 ${attachments}개` : ""].filter(Boolean).join(" · ")
    };
  }, [submission, row.preview]);
  return <>{loading && !preview.text ? "제출 내용 불러오는 중…" : error ? "제출 내용을 불러오지 못했습니다. 검토에서 확인해주세요." : <><span className="approval-preview-text">{preview.text || (preview.media ? "" : "작성된 본문 없음")}</span>{preview.media && <small className="approval-media">{preview.media}</small>}</>}</>;
}
function PendingGroup({
  group,
  classId,
  students,
  expanded,
  onExpand,
  selected,
  onSelect,
  onReview,
  onRowsChange,
  disabled,
  search,
  dragRef,
  reviewKey
}) {
  const [pageSize, setPageSize] = useState(50);
  const attempts = usePendingAlwaysRows({
    classId,
    group,
    expanded: group.always && expanded,
    students,
    pageSize
  });
  const rows = group.always ? attempts.rows : group.rows;
  useEffect(() => {
    onRowsChange(group.mission.id, rows);
  }, [group.mission.id, rows, onRowsChange]);
  const visibleRows = rows.filter(row => !search || `${row.student.name || ""} ${group.mission.title}`.toLowerCase().includes(search));
  const selectable = visibleRows;
  const allSelected = selectable.length > 0 && selectable.every(row => selected.has(row.key));
  return <section className="approval-group" aria-label={`${group.mission.title} 승인 대기`}>
    <header className="approval-group-heading">
      {expanded && selectable.length > 0 ? <input ref={element => {
        if (element) element.indeterminate = !allSelected && selectable.some(row => selected.has(row.key));
      }} type="checkbox" aria-label={`${group.mission.title} 표시된 요청 모두 선택`} checked={allSelected} disabled={disabled} onChange={() => onSelect(group, selectable, !allSelected)} /> : <span className="approval-checkbox-space" />}
      <button className="approval-group-toggle" onClick={onExpand} aria-expanded={expanded}>
        <span className="approval-group-title">{group.mission.title}</span>
        {usesSubmission(group.mission) && <span className="approval-submission-marker" role="img" aria-label="제출물 있는 과제" title="제출물 있는 과제"><Paperclip size={15} aria-hidden="true" /></span>}
        <span className="approval-group-count">{group.count}{group.always ? "건" : "명"} 대기</span>
        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
    </header>
    {expanded && <>
      {attempts.error && <div className="approval-error" role="alert">상시 요청을 불러오지 못했습니다. 접었다가 다시 펼쳐주세요.</div>}
      {attempts.loading ? <p className="approval-empty" role="status">대기 요청을 불러오는 중입니다…</p> : <div className="approval-rows" role="table" aria-label={`${group.mission.title} 대기 학생`}>
        {visibleRows.map(row => <div className={`approval-row approval-selectable-row ${group.always ? "is-always" : ""} ${selected.has(row.key) ? "is-selected" : ""} ${reviewKey === row.key ? "is-reviewing" : ""}`} key={row.key} role="row" aria-selected={selected.has(row.key)} aria-current={reviewKey === row.key ? "true" : undefined} tabIndex={reviewKey ? 0 : undefined} onKeyDown={event => {
          if (reviewKey && !disabled && event.target === event.currentTarget && ["Enter", " "].includes(event.key)) {
            event.preventDefault();
            onReview(group, row);
          }
        }} onPointerDown={event => {
          if (disabled || event.button !== 0 || event.pointerType && event.pointerType !== "mouse" || event.target.closest("button, a, textarea, select, .approval-preview")) return;
          const checked = !selected.has(row.key);
          const fromCell = !reviewKey && event.target.tagName !== "INPUT";
          dragRef.current = {
            checked,
            keys: new Set([row.key]),
            group,
            row,
            moved: fromCell
          };
          if (!reviewKey) event.currentTarget.querySelector("input")?.focus({
            preventScroll: true
          });
          if (fromCell) {
            event.preventDefault();
            onSelect(group, [row], checked, true);
          }
        }} onPointerEnter={() => {
          const drag = dragRef.current;
          if (!disabled && drag?.keys && !drag.keys.has(row.key)) {
            if (!drag.moved) onSelect(drag.group, [drag.row], drag.checked, true);
            drag.moved = true;
            drag.keys.add(row.key);
            onSelect(group, [row], drag.checked, true);
          }
        }} onClick={event => {
          if (event.detail > 0 && dragRef.current?.suppressClick && !event.target.closest("button, a")) {
            event.preventDefault();
            dragRef.current = null;
            return;
          }
          if (reviewKey) {
            if (!disabled && !event.target.closest("button, a, input, textarea, select, .approval-select-cell") && !window.getSelection()?.toString()) onReview(group, row);
            return;
          }
          if (disabled || event.target.closest("button, a, textarea, select, .approval-preview")) return;
          if (event.detail > 0 && dragRef.current?.suppressClick) {
            event.preventDefault();
            dragRef.current = null;
            return;
          }
          if (!event.target.closest("input")) onSelect(group, [row], !selected.has(row.key));
        }}>
          <span role="cell" className="approval-select-cell"><input type="checkbox" checked={selected.has(row.key)} disabled={disabled} aria-label={`${row.student.name || "학생"} ${group.always ? `${row.dayKey} ${formatTime(row.submittedAt)} ` : ""}선택`} onChange={event => {
              if (!dragRef.current?.moved && !dragRef.current?.suppressClick || event.nativeEvent.detail === 0) onSelect(group, [row], event.target.checked);
            }} /></span>
          <span className="approval-student" role="cell">{row.student.studentNumber ? <small>{row.student.studentNumber}번</small> : null}{row.student.name || "학생"}</span>
          <span className="approval-preview" role="cell">{group.always && <span className="approval-attempt-date">{row.dayKey ? dayjs(row.dayKey).format("M월 D일 (dd)") : "날짜 미기록"}</span>}{usesSubmission(group.mission) ? <SubmissionPreview classId={classId} mission={group.mission} row={row} /> : !group.always ? "완료 요청" : null}{row.status === "late" && <small className="approval-late">지각 제출</small>}</span>
          <time role="cell" className="approval-time">{formatTime(row.submittedAt)}</time>
          <span role="cell" className="approval-row-action"><Button kind={usesSubmission(group.mission) ? "outline" : "ghost"} tone="blue" size="sm" disabled={disabled} onClick={() => onReview(group, row)}>피드백</Button></span>
        </div>)}
        {!visibleRows.length && <p className="approval-empty">표시할 대기 요청이 없습니다.</p>}
      </div>}
      {group.always && attempts.hasMore && <div className="approval-load-more"><Button kind="outline" tone="slate" onClick={() => setPageSize(size => size + 50)}>대기 요청 더 보기</Button></div>}
    </>}
  </section>;
}
function RequestReview({
  classId,
  group,
  row,
  feedback,
  onFeedback,
  rewardOverride,
  onRewardChange,
  onClose,
  onAction,
  busy,
  nextCount,
  hasSelection,
  embedded = false
}) {
  const {
    classData,
    missionTokenLabel
  } = useUser();
  const {
    submission,
    loading,
    error
  } = useInboxSubmission(classId, group.mission, row);
  const [showGuide, setShowGuide] = useState(false);
  const feedbackId = useId();
  const panelRef = useRef(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const updateHeight = () => {
      panel.style.maxHeight = `${Math.max(240, window.innerHeight - Math.max(80, panel.getBoundingClientRect().top) - (embedded ? hasSelection ? 200 : 128 : hasSelection ? window.innerWidth <= 600 ? 144 : 104 : 16))}px`;
    };
    updateHeight();
    panel.focus({
      preventScroll: true
    });
    window.addEventListener("resize", updateHeight);
    window.addEventListener("scroll", updateHeight, {
      passive: true
    });
    return () => {
      window.removeEventListener("resize", updateHeight);
      window.removeEventListener("scroll", updateHeight);
    };
  }, [row.key, hasSelection, embedded]);
  const html = useMemo(() => sanitizeRichHtml(submission?.contentHtml || submission?.content?.html || ""), [submission]);
  const attachments = submission?.content?.attachments || [];
  const safeAttachments = attachments.map(attachment => typeof attachment === "string" ? attachment : attachment.url).filter(url => typeof url === "string" && /^https?:\/\//i.test(url));
  const blocked = busy || loading || !!error || usesSubmission(group.mission) && !submission;
  return <aside ref={panelRef} tabIndex={-1} className="approval-review" aria-label={`${row.student.name || "학생"} 요청 검토`}>
    <header className="approval-review-header"><div><h2>{group.mission.title}</h2><p>{row.student.name || "학생"} · {group.always && row.dayKey ? `${row.dayKey} · ` : ""}{formatTime(row.submittedAt)} 요청</p></div>
      <button className="approval-icon-button" aria-label="검토 닫기" onClick={onClose} disabled={busy}><X size={20} /></button></header>
    <div className="approval-review-body">
      {!embedded && <Button kind="ghost" tone="slate" size="sm" onClick={() => setShowGuide(value => !value)} aria-expanded={showGuide}>과제 안내 {showGuide ? "접기" : "보기"}</Button>}
      {!embedded && showGuide && <p className="approval-guide">{group.mission.description || "별도 안내가 없습니다."}</p>}
      {loading && <p role="status">제출물을 불러오는 중입니다…</p>}
      {error && <p className="approval-error" role="alert">{error.message || "제출물을 불러오지 못했습니다."}</p>}
      {!loading && !error && usesSubmission(group.mission) && <><h3>제출 내용</h3>{html ? <div className="approval-content prose prose-sm max-w-none" dangerouslySetInnerHTML={{
          __html: html
        }} /> : <p className="approval-guide">작성된 본문이 없습니다. 첨부 파일을 확인해주세요.</p>}
        {safeAttachments.length > 0 && <div className="approval-attachments"><h3>첨부 파일</h3>{safeAttachments.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">첨부 파일 {index + 1} 열기 ↗</a>)}</div>}</>}
      {!usesSubmission(group.mission) && <p className="approval-guide">제출물 없이 완료를 요청한 과제입니다.</p>}
      <div className="approval-rewards"><b>승인 보상</b><span>{normalizeRewardList(group.mission.rewards || []).map(reward => getRewardDisplayText(reward, classData?.currencyUnit || "코인", missionTokenLabel)).join(" · ") || "보상 없음"}</span></div>
      {hasRewardRange(group.mission) && <RewardOverrideFields mission={group.mission} currencyUnit={classData?.currencyUnit} value={rewardOverride} onChange={onRewardChange} disabled={busy} compact />}
      <label className="approval-feedback-label" htmlFor={feedbackId}>피드백 <small>승인 또는 반려할 때 학생에게 전달됩니다.</small></label>
      <textarea id={feedbackId} rows={3} value={feedback} onChange={event => onFeedback(event.target.value)} disabled={busy} placeholder="잘한 점이나 보완할 점을 남겨주세요." />
    </div>
    <footer className="approval-review-footer"><Button kind="outline" tone="rose" disabled={blocked} onClick={() => onAction("reject", [row], group)}>반려</Button><Button tone="blue" disabled={blocked} onClick={() => onAction("approve", [row], group)} icon={Check}>{nextCount > 0 ? "승인하고 다음" : "승인하기"}</Button></footer>
  </aside>;
}
export default function ApprovalInbox({
  classId,
  students = EMPTY,
  missions = EMPTY,
  catalogLoading,
  enabled = true,
  approveMany,
  rejectMany,
  onViewChange,
  scopedMissionId = null,
  embedded = false
}) {
  const {
    showFeedback
  } = useFeedback();
  const [refreshKey, setRefreshKey] = useState(0);
  const inbox = useApprovalInbox({
    classId,
    students,
    missions,
    enabled,
    refreshKey,
    scopedMissionId
  });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(new Set());
  const [selected, setSelected] = useState({
    missionId: null,
    keys: new Set()
  });
  const [review, setReview] = useState(null);
  const [rowMap, setRowMap] = useState({});
  const [drafts, setDrafts] = useState({});
  const [sharedFeedback, setSharedFeedback] = useState("");
  const [showBulkSettings, setShowBulkSettings] = useState(false);
  const inboxRef = useRef(null);
  const [barBounds, setBarBounds] = useState(null);
  const [rewardOverrides, setRewardOverrides] = useState({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const handleRowsChange = useCallback((id, rows) => setRowMap(map => map[id] === rows ? map : {
    ...map,
    [id]: rows
  }), []);
  const scopedGroups = inbox.groups.filter(group => !scopedMissionId || group.mission.id === scopedMissionId);
  const selectedGroups = scopedGroups.map(group => ({
    ...group,
    selectedRows: (rowMap[group.mission.id] || []).filter(row => selected.keys.has(row.key))
  })).filter(group => group.selectedRows.length);
  const selectedGroup = selectedGroups.length === 1 ? selectedGroups[0] : null;
  const selectedRows = selectedGroups.flatMap(group => group.selectedRows);
  const dragRef = useRef(null);
  const actionBusyRef = useRef(false);
  useEffect(() => {
    const endDrag = () => {
      dragRef.current = dragRef.current?.moved ? {
        suppressClick: true
      } : null;
    };
    const cancelDrag = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("blur", cancelDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", cancelDrag);
      window.removeEventListener("blur", cancelDrag);
    };
  }, []);
  const currentReviewGroup = scopedGroups.find(group => group.mission.id === review?.missionId);
  const currentReviewRows = rowMap[review?.missionId] || EMPTY;
  const currentReviewRow = currentReviewRows.find(row => row.key === review?.key);
  const hasSelectionBar = selectedRows.length > 0;
  useEffect(() => {
    if (!hasSelectionBar || !inboxRef.current) return undefined;
    const update = () => {
      const rect = inboxRef.current.getBoundingClientRect();
      const left = Math.max(12, rect.left);
      const width = Math.max(0, Math.min(rect.right, window.innerWidth - 12) - left);
      setBarBounds(previous => previous?.left === left && previous?.width === width ? previous : {
        left,
        width
      });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(inboxRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, {
      passive: true
    });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
    };
  }, [hasSelectionBar]);
  const nextReviewRows = currentReviewRows.filter(row => row.key !== review?.key);
  const normalizedSearch = search.trim().toLowerCase();
  const groups = inbox.groups.filter(group => (!scopedMissionId || group.mission.id === scopedMissionId) && (typeFilter === "all" || (typeFilter === "always" ? group.always : typeFilter === "submission" ? usesSubmission(group.mission) : !group.always && !usesSubmission(group.mission))) && (!normalizedSearch || `${group.mission.title} ${group.states.map(state => state.studentName || "").join(" ")} ${(rowMap[group.mission.id] || group.rows).map(row => row.student.name).join(" ")}`.toLowerCase().includes(normalizedSearch)));
  const totalCount = scopedGroups.reduce((sum, group) => sum + group.count, 0);
  const handleSelect = (group, rows, checked) => {
    setSelected(prev => {
      const keys = new Set(prev.keys);
      rows.forEach(row => checked ? keys.add(row.key) : keys.delete(row.key));
      return {
        missionId: null,
        keys
      };
    });
  };
  const handleReview = (group, row) => {
    setReview({
      missionId: group.mission.id,
      key: row.key
    });
    setCollapsed(prev => {
      const next = new Set(prev);
      inbox.groups.forEach(other => {
        if (other.mission.id !== group.mission.id && !other.always) next.add(other.mission.id);
      });
      return next;
    });
  };
  const performAction = async (action, rows, group, confirmed = false) => {
    if (!confirmed && actionBusyRef.current || !rows.length || !group) return false;
    const scope = `${group.mission.title} · ${rows.length}${group.always ? "건" : "명"}`;
    if (action === "reject" && !confirmed && !(await confirmMissionAction(`${scope}의 요청을 반려할까요?`, {
      title: "선택한 요청 반려",
      confirmLabel: "반려하기"
    }))) return false;
    if (!confirmed) actionBusyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      // Use the established server-owned mutations, with one mission per batch.
      // Successful chunks disappear through the authoritative state listener;
      // a failed later chunk stays available for a guarded retry.
      for (let offset = 0; offset < rows.length; offset += 50) {
        const chunk = rows.slice(offset, offset + 50);
        const feedbackFor = row => !confirmed && review?.key === row.key ? drafts[row.key] ?? row.feedback ?? "" : sharedFeedback.trim() ? sharedFeedback : drafts[row.key] ?? row.feedback ?? null;
        const rewardOverride = hasRewardRange(group.mission) ? rewardOverrides[group.mission.id] || getRewardApprovalDefaults(group.mission) : null;
        if (group.always) {
          const items = chunk.map(row => ({
            studentUid: row.uid,
            attemptId: row.attemptId,
            feedback: feedbackFor(row),
            rewardOverride
          }));
          const batches = action === "approve" ? [[null, items]] : [...items.reduce((map, item) => {
            const reason = item.feedback || "";
            map.set(reason, [...(map.get(reason) || []), item]);
            return map;
          }, new Map())];
          for (const [reason, targets] of batches) {
            const result = await (action === "approve" ? approveAlwaysAttemptBatch : rejectAlwaysAttemptBatch)({
              classId,
              missionId: group.mission.id,
              items: targets,
              ...(action === "reject" ? {
                reason
              } : {})
            });
            if (result?.data?.results?.failed?.length || result?.data?.failedCount || result?.data?.errors?.length) throw new Error("일부 요청을 처리하지 못했습니다. 남은 요청을 확인해주세요.");
          }
        } else if (action === "approve") {
          const result = await approveMany(group.mission.id, chunk.map(row => ({
            uid: row.uid,
            submissionId: usesSubmission(group.mission) ? row.submissionId : null,
            feedback: feedbackFor(row),
            rewardOverride
          })));
          if (result?.data?.results?.failed?.length) throw new Error("일부 요청을 승인하지 못했습니다. 남은 요청을 확인해주세요.");
        } else {
          const byReason = new Map();
          chunk.forEach(row => {
            const reason = feedbackFor(row) || "";
            byReason.set(reason, [...(byReason.get(reason) || []), row]);
          });
          for (const [reason, targets] of byReason) {
            await rejectMany(group.mission.id, {
              submissionIds: usesSubmission(group.mission) ? targets.map(row => row.submissionId).filter(Boolean) : [],
              studentUids: usesSubmission(group.mission) ? [] : targets.map(row => row.uid),
              options: {
                reason,
                revertTo: "rejected"
              }
            });
          }
        }
        setSelected(prev => ({
          ...prev,
          keys: new Set([...prev.keys].filter(key => !chunk.some(row => row.key === key)))
        }));
      }
      showFeedback?.(`${scope} ${action === "approve" ? "승인" : "반려"} 처리했습니다.`, "success");
      if (review?.missionId === group.mission.id) setReview(nextReviewRows[0] ? {
        missionId: group.mission.id,
        key: nextReviewRows[0].key
      } : null);
      return true;
    } catch (error) {
      setActionError(error.message || "처리에 실패했습니다. 남은 요청을 다시 확인해주세요.");
      return false;
    } finally {
      if (!confirmed) {
        setBusy(false);
        actionBusyRef.current = false;
      }
    }
  };
  const performSelectedAction = async action => {
    if (actionBusyRef.current) return;
    if (action === "reject" && !(await confirmMissionAction(`${selectedGroups.length}개 과제의 선택한 요청 ${selectedRows.length}건을 반려할까요?`, {
      title: "선택한 요청 반려",
      confirmLabel: "반려하기"
    }))) return;
    actionBusyRef.current = true;
    setBusy(true);
    try {
      let completed = true;
      for (const group of selectedGroups) {
        if (!(await performAction(action, group.selectedRows, group, true))) {
          completed = false;
          break;
        }
      }
      if (completed) {
        setSharedFeedback("");
        setShowBulkSettings(false);
      }
    } finally {
      actionBusyRef.current = false;
      setBusy(false);
    }
  };
  const visibleSelection = groups.flatMap(group => (rowMap[group.mission.id] || group.rows).filter(row => !normalizedSearch || `${row.student.name || ""} ${group.mission.title}`.toLowerCase().includes(normalizedSearch)));
  const allVisibleSelected = visibleSelection.length > 0 && visibleSelection.every(row => selected.keys.has(row.key));
  if (inbox.selfhost) return <div className="approval-empty">현재 연결에서는 과제별 보기에서 승인할 수 있습니다.<Button kind="outline" onClick={() => onViewChange?.("missions")}>과제별 보기</Button></div>;
  return <div ref={inboxRef} className={`approval-inbox ${embedded ? "is-embedded" : ""}`} data-testid="approval-inbox">
    <div className="approval-toolbar">{!scopedMissionId && <><label className="sr-only" htmlFor="approval-type-filter">과제 종류</label><select id="approval-type-filter" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
      <option value="all">모든 과제</option><option value="completion">제출물 없는 일반과제</option><option value="submission">제출물 있는 과제</option><option value="always">상시과제</option></select></>}
      <div className="approval-search"><Search size={18} /><input aria-label="학생·과제 검색" placeholder="학생·과제 검색" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <span className="approval-total">승인 대기 <b>{totalCount}건</b></span><Button kind="ghost" tone="slate" size="sm" icon={RefreshCw} disabled={busy} onClick={() => setRefreshKey(key => key + 1)}>새로고침</Button></div>
    {(inbox.error || actionError) && <div className="approval-error" role="alert">{actionError || "대기 요청을 불러오지 못했습니다. 새로고침해주세요."}</div>}
    <div className={`approval-workspace ${currentReviewGroup && currentReviewRow ? "has-review" : ""}`}>
      <div className="approval-list" key={refreshKey}>
        {!currentReviewRow && groups.length > 0 && <><p className="approval-selection-help">행을 클릭하거나 드래그해 선택할 수 있어요. 본문은 글자 선택, 버튼은 검토에 사용됩니다. 전체 선택은 불러온 검색 결과에 적용됩니다.</p><div className="approval-row approval-column-labels approval-global-header"><input type="checkbox" aria-label="불러온 검색 결과 전체 선택" disabled={busy || !visibleSelection.length} checked={allVisibleSelected} ref={element => {
              if (element) element.indeterminate = !allVisibleSelected && visibleSelection.some(row => selected.keys.has(row.key));
            }} onChange={() => setSelected({
              missionId: null,
              keys: allVisibleSelected ? new Set() : new Set(visibleSelection.map(row => row.key))
            })} /><span>학생</span><span>요청 내용</span><span>요청 시간</span><span>작업</span></div></>}
        {catalogLoading || inbox.loading ? <div className="approval-empty" role="status">승인 대기 요청을 불러오는 중입니다…</div> : groups.map((group, index) => <React.Fragment key={group.mission.id}>
          {!embedded && (index === 0 || groups[index - 1].always !== group.always) && <h2 className="approval-section-title">{group.always ? "상시과제" : "일반과제"}</h2>}
          <PendingGroup group={group} classId={classId} students={students} expanded={!collapsed.has(group.mission.id) && (!group.always || embedded || collapsed.has(`opened:${group.mission.id}`))} onExpand={() => setCollapsed(prev => {
            const next = new Set(prev);
            if (group.always && !embedded) {
              if (next.has(`opened:${group.mission.id}`)) next.delete(`opened:${group.mission.id}`);else next.add(`opened:${group.mission.id}`);
            } else if (next.has(group.mission.id)) next.delete(group.mission.id);else next.add(group.mission.id);
            return next;
          })} selected={selected.keys} onSelect={handleSelect} onReview={handleReview} reviewKey={currentReviewRow?.key} onRowsChange={handleRowsChange} disabled={busy} search={normalizedSearch} dragRef={dragRef} /></React.Fragment>)}
        {!catalogLoading && !inbox.loading && !inbox.error && !groups.length && <div className="approval-empty"><Inbox size={28} /><h2>{normalizedSearch || typeFilter !== "all" ? "조건에 맞는 대기 요청이 없습니다." : "승인 대기 요청이 없습니다."}</h2><p>{embedded ? "전체 현황·기록에서 학생 상태와 처리 결과를 확인할 수 있어요." : "자동 승인 과제의 기록과 처리 결과는 과제별 보기에서 확인할 수 있어요."}</p></div>}
      </div>
      {currentReviewGroup && currentReviewRow && <RequestReview key={currentReviewRow.key} classId={classId} group={currentReviewGroup} row={currentReviewRow} feedback={drafts[currentReviewRow.key] ?? currentReviewRow.feedback ?? ""} onFeedback={value => setDrafts(prev => ({
        ...prev,
        [currentReviewRow.key]: value
      }))} rewardOverride={rewardOverrides[currentReviewGroup.mission.id] || getRewardApprovalDefaults(currentReviewGroup.mission)} onRewardChange={value => setRewardOverrides(prev => ({
        ...prev,
        [currentReviewGroup.mission.id]: value
      }))} onClose={() => setReview(null)} onAction={performAction} busy={busy} nextCount={nextReviewRows.length} hasSelection={hasSelectionBar} embedded={embedded} />}
    </div>
    {hasSelectionBar && <div className="approval-selection-spacer" aria-hidden="true" />}
    {hasSelectionBar && createPortal(<div className="approval-selection-bar" style={embedded ? undefined : barBounds || undefined} role="region" aria-label="선택한 요청 처리">
      <div className="approval-selection-summary"><strong>{selectedGroup ? selectedGroup.mission.title : `${selectedGroups.length}개 과제`} · {selectedRows.length}{selectedGroup && !selectedGroup.always ? "명" : "건"} 선택</strong><p>{sharedFeedback.trim() ? "일괄 피드백 설정됨" : "개별 피드백 유지"} · {selectedGroups.some(group => rewardOverrides[group.mission.id]) ? "보상 설정됨" : "기본 보상 적용"}</p></div>
      <div className="approval-selection-actions"><Button kind="outline" tone="slate" disabled={busy} onClick={() => setShowBulkSettings(true)}>피드백·보상</Button><Button kind="outline" tone="rose" disabled={busy} onClick={() => performSelectedAction("reject")}>반려</Button><Button tone="blue" disabled={busy} onClick={() => performSelectedAction("approve")}>{busy ? "처리 중…" : `${selectedRows.length}${selectedGroup && !selectedGroup.always ? "명" : "건"} 승인`}</Button></div>
    </div>, embedded ? inboxRef.current : document.body)}
    <Modal isOpen={showBulkSettings && selectedRows.length > 0} onClose={() => setShowBulkSettings(false)} title="일괄 피드백·보상 설정" subtitle={`${selectedGroups.length}개 과제 · ${selectedRows.length}건 선택`} size="lg" footer={<Button tone="blue" onClick={() => setShowBulkSettings(false)}>설정 완료</Button>}>
      <div className="approval-inbox approval-bulk-settings">
        <p className="approval-settings-note">설정한 내용은 승인·반려할 때 전달됩니다. 이 화면에서는 요청을 처리하지 않습니다.</p>
        <label className="approval-shared-feedback">일괄 피드백 <small>입력하면 선택한 모든 요청에 적용됩니다.</small><textarea rows={3} value={sharedFeedback} onChange={event => setSharedFeedback(event.target.value)} disabled={busy} placeholder="승인 또는 반려 시 선택한 요청에 함께 전달됩니다." /></label>
        {selectedGroups.filter(group => hasRewardRange(group.mission)).map(group => <div className="approval-bulk-reward" key={group.mission.id}><b>{group.mission.title} 승인 보상</b><RewardOverrideFields mission={group.mission} value={rewardOverrides[group.mission.id] || getRewardApprovalDefaults(group.mission)} onChange={value => setRewardOverrides(prev => ({
            ...prev,
            [group.mission.id]: value
          }))} disabled={busy} compact columns={3} /></div>)}
      </div>
    </Modal>
  </div>;
}
