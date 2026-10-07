import "../../dashboard/homeCards.css";
import React, { useRef, useState } from "react";
import { ArrowUp, ArrowDown, Settings2 } from "lucide-react";
import { CARD_INFO } from "../constants/dashboardCards";
import { Button, Modal } from "../../../components/ui";
import { useFeedback } from "../../../contexts/FeedbackContext";
import { cardVisibilityKey, createCardDraft, moveVisibleCard } from "../utils/dashboardCardDraft";

const HOME_LABELS = {news:"최근 뉴스",asset:"내 자산",mission:"오늘의 과제",credit:"신용 점수",donation:"기부 프로젝트"};
const DashboardCardsTab = ({
  settings,
  saving,
  onApply
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => createCardDraft(settings));
  const [applying, setApplying] = useState(false);
  const pending = useRef(false);
  const {
    showFeedback
  } = useFeedback();
  const visible = draft.cardOrder.filter(key => draft[cardVisibilityKey(key)]);
  const savedVisible = createCardDraft(settings).cardOrder.filter(key => settings[cardVisibilityKey(key)]);
  const busy = saving || applying;
  const close = () => {
    if (!pending.current && !saving) setEditing(false);
  };
  const apply = async () => {
    if (pending.current || saving) return;
    pending.current = true;
    setApplying(true);
    try {
      const success = await onApply(createCardDraft(draft));
      if (success === true) {
        showFeedback("홈 카드 설정을 적용했습니다.", "success");
        setEditing(false);
      }
    } catch {
      showFeedback("설정을 저장하지 못했어요. 다시 시도해 주세요.", "error");
    } finally {
      pending.current = false;
      setApplying(false);
    }
  };
  return <div className="p-5">
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-800">홈 카드 설정</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">보여줄 카드를 고르고 순서를 조정한 후 한 번에 적용하세요.</p></div><Button icon={Settings2} kind="soft" disabled={busy} onClick={() => {
        setDraft(createCardDraft(settings));
        setEditing(true);
      }}>편집</Button></div>
    <div className="mt-5 space-y-2">{savedVisible.map((key, index) => <div key={key} className="flex items-center gap-3 rounded-xl bg-blue-50/70 p-3 text-sm"><span className="text-xs font-bold text-blue-600">{index + 1}</span><span className="font-semibold text-slate-700">{HOME_LABELS[key]}</span></div>)}{savedVisible.length === 0 && <p className="py-6 text-center text-sm text-slate-500">표시할 카드가 없습니다.</p>}</div>

    <Modal isOpen={editing} onClose={close} title="홈 카드 설정" size="md" className="fc-home-settings-modal" closeOnOverlayClick={!busy}>
      <p className="text-sm leading-relaxed text-slate-500">표시할 카드와 순서를 선택하세요. 적용하면 학생 홈에 반영됩니다.</p>
      <fieldset disabled={busy} className="fc-home-settings-options">{Object.keys(CARD_INFO).map(key => <label key={key} className="flex cursor-pointer items-center gap-2 rounded-[10px] bg-[#f5f8ff] p-[9px] text-sm"><input className="h-[17px] w-[17px] accent-[#387aff]" type="checkbox" checked={draft[cardVisibilityKey(key)]} onChange={event => {const checked=event.target.checked;setDraft(prev => ({...prev,[cardVisibilityKey(key)]:checked,cardOrder:checked?[...prev.cardOrder.filter(item=>item!==key),key]:prev.cardOrder}));}}/>{HOME_LABELS[key]}</label>)}</fieldset>
      <h4 className="fc-home-settings-order-heading">표시 순서</h4>
      <ol className="fc-home-settings-order">{visible.map((key,index) => <li key={key} className="flex items-center gap-2 border-b border-[#edf1f7] py-[10px] text-sm"><span className="flex-1">{index+1}. {HOME_LABELS[key]}</span><Button kind="soft" size="xs" aria-label={HOME_LABELS[key]+" 위로 이동"} disabled={busy||index===0} onClick={()=>setDraft(prev=>moveVisibleCard(prev,key,-1))} className="!min-h-8 !rounded-[7px] !bg-[#f0f5ff] !p-[6px]"><ArrowUp size={20}/></Button><Button kind="soft" size="xs" aria-label={HOME_LABELS[key]+" 아래로 이동"} disabled={busy||index===visible.length-1} onClick={()=>setDraft(prev=>moveVisibleCard(prev,key,1))} className="!min-h-8 !rounded-[7px] !bg-[#f0f5ff] !p-[6px]"><ArrowDown size={20}/></Button></li>)}</ol>
      {visible.length===0&&<p className="py-6 text-sm text-slate-500">표시할 카드가 없습니다.</p>}
      <div className="fc-home-settings-actions"><Button kind="soft" disabled={busy} onClick={close} className="!rounded-xl !bg-[#eff4fc] !text-[#627b9f]">취소</Button><Button disabled={busy} onClick={apply} className="!rounded-xl !bg-[#377aff]">{busy?"적용 중...":"적용"}</Button></div>
    </Modal>
  </div>;
};
export default DashboardCardsTab;
