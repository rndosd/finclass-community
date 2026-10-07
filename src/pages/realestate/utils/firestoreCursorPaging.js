import { getDocs, limit, query, startAfter } from 'firebase/firestore';

const defaultMapDoc = (docSnap) => ({ id: docSnap.id, ...docSnap.data() });

export const fetchCursorPage = async ({
  baseQuery,
  startCursor = null,
  pageSize = 20,
  mapDoc = defaultMapDoc,
}) => {
  const constraints = [];
  if (startCursor) constraints.push(startAfter(startCursor));
  constraints.push(limit(pageSize + 1));

  const snap = await getDocs(query(baseQuery, ...constraints));
  const docs = snap.docs;
  const hasMore = docs.length > pageSize;
  const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
  const nextCursor = hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;

  return {
    items: pageDocs.map(mapDoc),
    hasMore,
    nextCursor,
  };
};

export const fetchFilteredCursorPage = async ({
  baseQuery,
  startCursor = null,
  pageSize = 20,
  scanBatchSize = 60,
  filterFn = () => true,
  mapDoc = defaultMapDoc,
}) => {
  const items = [];
  let cursor = startCursor;
  let hasMore = false;
  let exhausted = false;

  while (items.length < pageSize && !exhausted) {
    const constraints = [];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(scanBatchSize));

    const snap = await getDocs(query(baseQuery, ...constraints));
    const docs = snap.docs;

    if (!docs.length) {
      exhausted = true;
      break;
    }

    let reachedPageSize = false;

    for (let index = 0; index < docs.length; index += 1) {
      const docSnap = docs[index];
      cursor = docSnap;

      const mapped = mapDoc(docSnap);
      if (filterFn(mapped)) {
        items.push(mapped);
      }

      if (items.length === pageSize) {
        reachedPageSize = true;
        hasMore = index < docs.length - 1 || docs.length === scanBatchSize;
        break;
      }
    }

    if (reachedPageSize) break;
    if (docs.length < scanBatchSize) exhausted = true;
  }

  return {
    items,
    hasMore,
    nextCursor: hasMore ? cursor : null,
  };
};
