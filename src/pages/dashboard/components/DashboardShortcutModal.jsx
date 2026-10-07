import { CheckIcon, XIcon } from "@phosphor-icons/react";
import Button from "../../../components/ui/Button";
import IconButton from "../../../components/ui/IconButton";

export default function DashboardShortcutModal({
  open,
  groupedAvailableAdminLinks,
  selectedAdminLinkKeys,
  hasSelectableAdminLinks,
  selectedShortcutLinks,
  onClose,
  onToggleShortcut,
  onChangeLabel,
  onSubmit
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}>
      
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(event) => event.stopPropagation()}>
        
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-800">바로가기 추가</h2>
          <IconButton
            icon={XIcon}
            label="닫기"
            onClick={onClose}
            tone="slate"
            size="sm"
            className="text-slate-400 hover:text-slate-600"
          />
        </div>

        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600">
              어떤 메뉴를 바로가기로 추가할까요? <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-slate-400">
              여러 메뉴를 한 번에 선택해서 바로가기로 추가할 수 있어요.
            </p>
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              {Object.entries(groupedAvailableAdminLinks).map(([sectionLabel, links]) =>
              <div key={sectionLabel} className="space-y-2">
                  <div className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {sectionLabel}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {links.map((link) => {
                    const isSelected = selectedAdminLinkKeys.includes(link.key);

                    return (
                      <Button
                        key={link.key}
                        type="button"
                        onClick={() => onToggleShortcut(link.key)}
                        disabled={link.alreadyAdded}
                        kind="ghost"
                        tone="slate"
                        className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${
                        link.alreadyAdded ?
                        "cursor-not-allowed border-slate-200 bg-white/70 text-slate-300" :
                        isSelected ?
                        "border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm" :
                        "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50/60"}`
                        }>
                        
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{link.label}</div>
                          </div>
                          <div className="shrink-0">
                            {link.alreadyAdded ?
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-400">
                                추가됨
                              </span> :

                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                            isSelected ?
                            "border-indigo-500 bg-indigo-500 text-white" :
                            "border-slate-300 bg-white text-transparent"}`
                            }>
                            
                                <CheckIcon size={13} weight="bold" />
                              </span>
                          }
                          </div>
                        </Button>);

                  })}
                  </div>
                </div>
              )}

              {!hasSelectableAdminLinks ?
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
                  추가할 수 있는 메뉴가 더 없습니다.
                </div> :
              null}
            </div>
          </div>

          {selectedShortcutLinks.length > 0 ?
          <div className="space-y-2 pt-2">
              <label className="block text-xs font-semibold text-slate-600">표시 이름</label>
              <div className="space-y-2">
                {selectedShortcutLinks.map((link) =>
              <div
                key={link.key}
                className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                
                    <div className="mb-2 text-xs font-semibold text-slate-500">{link.label}</div>
                    <input
                  type="text"
                  className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm shadow-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder={`${link.label} 이름 입력`}
                  value={link.customLabel}
                  onChange={(event) => onChangeLabel(link.key, event.target.value)} />
                
                  </div>
              )}
              </div>
            </div> :
          null}
        </div>

        <div className="flex flex-col-reverse justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row">
          <Button size="sm" kind="ghost" tone="slate" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            tone="blue"
            kind="solid"
            onClick={onSubmit}
            disabled={selectedShortcutLinks.length === 0}>
            
            {selectedShortcutLinks.length > 1 ?
            `${selectedShortcutLinks.length}개 추가하기` :
            "추가하기"}
          </Button>
        </div>
      </div>
    </div>);

}
