export const REAL_ESTATE_STORAGE_VERSION = 3;
const seatFields = new Set(['id', 'permanentId', 'number', 'label', 'studentId', 'studentName', 'teamId', 'isActive', 'row', 'col']);

// Only requested desks are enriched. Unread financial fields stay absent; the
// caller must wait for financialReady before presenting financial information.
export const mergeStoredDesk = (seat, property, contracts = new Map()) => {
  if (!property || property.version !== REAL_ESTATE_STORAGE_VERSION || property.deskId !== seat.id) {
    throw new Error('부동산 원문이 배치 정보와 일치하지 않습니다.');
  }
  if (Object.keys(property.fields || {}).some((key) => seatFields.has(key))) throw new Error('부동산 원문에 잘못된 자리 정보가 있습니다.');
  const desk = { ...property.fields, ...seat };
  if (property.rentContractId !== (desk.rentContractId || undefined)) throw new Error('임대 계약 연결 정보가 일치하지 않습니다.');
  for (const [id, kind] of [[property.rentContractId, 'rent'], [property.saleContractId, 'sale']]) {
    if (!id || !contracts.has(id)) continue;
    const record = contracts.get(id);
    if (record.version !== REAL_ESTATE_STORAGE_VERSION || record.deskId !== seat.id || record.kind !== kind) {
      throw new Error('계약 원문이 책상 정보와 일치하지 않습니다.');
    }
    if (kind === 'rent') {
      if (Object.keys(record.fields || {}).some((key) => !key.startsWith('rent') || key === 'rentContractId')) throw new Error('임대 계약 원문이 올바르지 않습니다.');
      Object.assign(desk, record.fields);
    }
    else desk.contractState = record.state;
  }
  return desk;
};

export const mergeStoredLayout = (layout, properties, contracts = new Map()) => {
  if (layout?.storageSchemaVersion !== REAL_ESTATE_STORAGE_VERSION) return layout;
  return { ...layout, groups: (layout.groups || []).map((group) => ({
    ...group,
    desks: (group.desks || []).map((seat) => properties.has(seat.id)
      ? mergeStoredDesk(seat, properties.get(seat.id), contracts) : seat),
  })) };
};
