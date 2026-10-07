import { CARD_INFO, DEFAULT_DASHBOARD_SETTINGS } from "../constants/dashboardCards";
export const cardVisibilityKey = key => `show${key.charAt(0).toUpperCase()}${key.slice(1)}Card`;
export const createCardDraft = settings => {
  const keys = Object.keys(CARD_INFO);
  const cardOrder = [...new Set([...(settings?.cardOrder || []), ...keys])].filter(key => keys.includes(key));
  return Object.fromEntries([["cardOrder", cardOrder], ...keys.map(key => [cardVisibilityKey(key), (settings || DEFAULT_DASHBOARD_SETTINGS)[cardVisibilityKey(key)] === true])]);
};
export const moveVisibleCard = (draft, key, direction) => {
  const visible = draft.cardOrder.filter(item => draft[cardVisibilityKey(item)]);
  const index = visible.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= visible.length) return draft;
  [visible[index], visible[target]] = [visible[target], visible[index]];
  let cursor = 0;
  return {
    ...draft,
    cardOrder: draft.cardOrder.map(item => draft[cardVisibilityKey(item)] ? visible[cursor++] : item)
  };
};
