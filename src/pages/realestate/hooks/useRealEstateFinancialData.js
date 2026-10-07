import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { mergeStoredLayout, REAL_ESTATE_STORAGE_VERSION } from '../utils/storageLayout';

export const useRealEstateFinancialData = ({ classId, layout, all = false, deskId = '', includeContracts = false, uid, canManage }) => {
  const propertyDeskId = all ? "" : deskId;
  const migrated = layout?.storageSchemaVersion === REAL_ESTATE_STORAGE_VERSION;
  const scope = migrated && classId && (all || deskId) ? `${classId}:${all ? '*' : deskId}` : '';
  const [propertyState, setPropertyState] = useState({ scope: '', records: new Map(), ready: false, error: null });
  const [contractState, setContractState] = useState({ scope: '', records: new Map(), ready: false, error: null });

  useEffect(() => {
    if (!scope) return undefined;
    setPropertyState({ scope, records: new Map(), ready: false, error: null });
    const ref = all ? collection(db, 'classes', classId, 'real_estate', 'properties', 'items')
      : doc(db, 'classes', classId, 'real_estate', 'properties', 'items', propertyDeskId);
    let cancelled = false;
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (cancelled) return;
      const documents = all ? snapshot.docs : snapshot.exists() ? [snapshot] : [];
      const records = new Map(documents.map((record) => [record.id, record.data()]));
      setPropertyState({ scope, records, ready: true, error: documents.length || all ? null : new Error('부동산 원문을 찾을 수 없습니다.') });
    }, (error) => { if (!cancelled) setPropertyState({ scope, records: new Map(), ready: true, error }); });
    return () => { cancelled = true; unsubscribe(); };
  }, [scope, classId, all, propertyDeskId]);

  const properties = useMemo(() => propertyState.scope === scope ? propertyState.records : new Map(), [propertyState, scope]);
  const contractIds = useMemo(() => {
    if (!includeContracts || !scope) return [];
    const ids = new Set();
    properties.forEach((property) => {
      if (property.rentContractId) ids.add(property.rentContractId);
      if (property.saleContractId && (canManage || property.fields?.ownerId === uid || property.fields?.buyerId === uid)) ids.add(property.saleContractId);
    });
    return [...ids].sort();
  }, [properties, scope, includeContracts, canManage, uid]);
  const contractKey = JSON.stringify(contractIds);
  const contractScope = `${scope}:${contractKey}`;
  useEffect(() => {
    if (!scope || !includeContracts) return undefined;
    const ids = JSON.parse(contractKey);
    const pending = new Set(ids), records = new Map(), errors = new Map();
    let cancelled = false;
    const publish = () => setContractState({ scope: contractScope, records: new Map(records), ready: pending.size === 0, error: errors.values().next().value || null });
    setContractState({ scope: contractScope, records: new Map(), ready: ids.length === 0, error: null });
    const unsubscribes = ids.map((id) => onSnapshot(doc(db, 'classes', classId, 'real_estate', 'contracts', 'records', id), (snapshot) => {
      if (cancelled) return;
      if (!snapshot.exists()) {
        if (snapshot.metadata?.fromCache) return;
        records.delete(id); errors.set(id, new Error('계약 원문을 찾을 수 없습니다.')); pending.delete(id); publish();
        return;
      }
      records.set(id, snapshot.data()); pending.delete(id); errors.delete(id); publish();
    }, (error) => { if (!cancelled) { errors.set(id, error); pending.delete(id); publish(); } }));
    return () => { cancelled = true; unsubscribes.forEach((unsubscribe) => unsubscribe()); };
  }, [classId, scope, includeContracts, contractKey, contractScope]);

  const currentContracts = useMemo(() => contractState.scope === contractScope ? contractState.records : new Map(), [contractState, contractScope]);
  const result = useMemo(() => {
    if (!migrated || !scope) return { layout, ready: true, error: null };
    const error = (propertyState.scope === scope && propertyState.error) ||
      (includeContracts && contractState.scope === contractScope && contractState.error);
    let merged;
    try {
      if (propertyState.scope === scope && propertyState.ready && !propertyState.error) {
        const required = all ? (layout.groups || []).flatMap((g) => g.desks || []).map((d) => d.id) : [deskId];
        if (required.some((id) => !properties.has(id))) throw new Error('일부 책상의 부동산 원문을 찾을 수 없습니다.');
      }
      merged = mergeStoredLayout(layout, properties, currentContracts);
    } catch (mergeError) { return { layout, ready: false, error: mergeError }; }
    return { layout: merged, ready: !error && propertyState.scope === scope && propertyState.ready &&
      (!includeContracts || (contractState.scope === contractScope && contractState.ready)), error: error || null };
  }, [layout, migrated, scope, propertyState, contractState, contractScope, includeContracts, properties, currentContracts, all, deskId]);
  return result;
};
