import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  Clock,
  Inbox,
  XCircle,
} from "lucide-react";

import {
  Badge,
  Button,
  Modal,
} from "../../components/ui";
import {
  formatDateTime,
  formatReward,
  getSelectionTypeLabel,
} from "./JobBoardPage.parts";

const TEXT = {
  title: "\uACF5\uACE0 \uC2B9\uC778 \uAD00\uB9AC",
  description:
    "\uD559\uC0DD\uC774 \uC791\uC131\uD55C \uAD6C\uC778 \uACF5\uACE0\uB97C \uAC80\uD1A0\uD558\uACE0 \uACF5\uAC1C \uC5EC\uBD80\uB97C \uCC98\uB9AC\uD569\uB2C8\uB2E4.",
  selected: "\uC120\uD0DD",
  selectAll: "\uC804\uCCB4 \uC120\uD0DD",
  bulkApprove: "\uC120\uD0DD \uC2B9\uC778",
  bulkReject: "\uC120\uD0DD \uBC18\uB824",
  approve: "\uC2B9\uC778",
  reject: "\uBC18\uB824",
  detail: "\uC0C1\uC138",
  close: "\uB2EB\uAE30",
  emptyTitle: "\uC2B9\uC778 \uB300\uAE30 \uACF5\uACE0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
  emptyDescription:
    "\uD559\uC0DD \uACF5\uACE0 \uC2B9\uC778\uC774 \uD544\uC694\uD560 \uB54C \uC774\uACF3\uC5D0 \uBAA8\uC544\uC11C \uBCF4\uC5EC\uC90D\uB2C8\uB2E4.",
  author: "\uC791\uC131\uC790",
  reward: "\uBCF4\uC0C1",
  slots: "\uBAA8\uC9D1",
  deadline: "\uB9C8\uAC10",
  noDeadline: "\uC120\uD0DD \uC548 \uD568",
};

export default function JobPostApprovalModal({
  busyKey,
  currencyUnit,
  isOpen,
  onClose,
  onModerate,
  onOpenPost,
  posts = [],
}) {
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds((currentIds) => {
      const availableIds = new Set(posts.map((post) => post.id));
      return currentIds.filter((id) => availableIds.has(id));
    });
  }, [isOpen, posts]);

  const selectedPosts = useMemo(
    () => posts.filter((post) => selectedIds.includes(post.id)),
    [posts, selectedIds],
  );
  const allSelected = posts.length > 0 && selectedIds.length === posts.length;
  const isProcessing = Boolean(busyKey?.startsWith("post:approval:"));

  const togglePost = (postId) => {
    if (isProcessing) return;
    setSelectedIds((currentIds) =>
      currentIds.includes(postId)
        ? currentIds.filter((id) => id !== postId)
        : [...currentIds, postId],
    );
  };

  const toggleAll = () => {
    if (isProcessing) return;
    setSelectedIds(allSelected ? [] : posts.map((post) => post.id));
  };

  const handleBulkAction = async (action) => {
    if (!selectedPosts.length) return;
    await onModerate(selectedPosts, action);
    setSelectedIds([]);
  };

  const handleSingleAction = async (post, action) => {
    await onModerate([post], action);
    setSelectedIds((currentIds) => currentIds.filter((id) => id !== post.id));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={TEXT.title} size="lg">
      <div className="flex max-h-[75vh] flex-col">
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">{TEXT.title}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                {TEXT.description}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={!posts.length || isProcessing}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            {selectedIds.length > 0
              ? `${selectedIds.length}${TEXT.selected}`
              : TEXT.selectAll}
          </label>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 ? (
              <>
                <Button
                  size="xs"
                  kind="outline"
                  tone="rose"
                  onClick={() => handleBulkAction("reject")}
                  disabled={isProcessing}
                >
                  {TEXT.bulkReject}
                </Button>
                <Button
                  size="xs"
                  tone="blue"
                  onClick={() => handleBulkAction("approve")}
                  disabled={isProcessing}
                  isLoading={isProcessing}
                >
                  {TEXT.bulkApprove}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="min-h-[260px] flex-1 space-y-2 overflow-y-auto pr-1">
          {posts.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-100 bg-white px-4 text-center">
              <Inbox className="mb-3 h-10 w-10 text-slate-200" />
              <p className="text-sm font-black text-slate-700">{TEXT.emptyTitle}</p>
              <p className="mt-1 text-xs font-semibold text-slate-400">
                {TEXT.emptyDescription}
              </p>
            </div>
          ) : (
            posts.map((post) => {
              const selected = selectedIds.includes(post.id);
              return (
                <div
                  key={post.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => togglePost(post.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      togglePost(post.id);
                    }
                  }}
                  className={`rounded-2xl border p-4 transition ${
                    selected
                      ? "border-blue-200 bg-blue-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => togglePost(post.id)}
                      onClick={(event) => event.stopPropagation()}
                      disabled={isProcessing}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-base font-black text-slate-900">
                            {post.title}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {TEXT.author} {post.authorName || post.teacherName || "-"}
                          </p>
                        </div>
                        <span className="text-[11px] font-semibold tabular-nums text-slate-400">
                          {formatDateTime(post.createdAt)}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge tone="slate">
                          {TEXT.slots} {post.slots || 1}
                        </Badge>
                        <Badge tone="emerald">
                          {TEXT.reward} {formatReward(post.rewardAmount, currencyUnit)}
                        </Badge>
                        <Badge tone="indigo">{getSelectionTypeLabel(post.selectionType)}</Badge>
                        <Badge tone="amber">
                          {TEXT.deadline}{" "}
                          {post.applyDeadlineAt
                            ? formatDateTime(post.applyDeadlineAt)
                            : TEXT.noDeadline}
                        </Badge>
                      </div>
                    </div>
                    <div
                      className="flex shrink-0 items-center gap-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        size="xs"
                        kind="ghost"
                        tone="slate"
                        onClick={() => onOpenPost(post)}
                        disabled={isProcessing}
                      >
                        {TEXT.detail}
                      </Button>
                      <Button tone="emerald" kind="ghost" size="icon-md"
                        type="button"
                        title={TEXT.approve}
                        aria-label={TEXT.approve}
                        onClick={() => handleSingleAction(post, "approve")}
                        disabled={isProcessing}
                        className="transition disabled:opacity-50"
                      >
                        <CheckCircle className="h-5 w-5" />
                      </Button>
                      <Button tone="red" kind="ghost" size="icon-md"
                        type="button"
                        title={TEXT.reject}
                        aria-label={TEXT.reject}
                        onClick={() => handleSingleAction(post, "reject")}
                        disabled={isProcessing}
                        className="transition disabled:opacity-50"
                      >
                        <XCircle className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isProcessing}>
            {TEXT.close}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
