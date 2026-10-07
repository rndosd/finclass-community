import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { Modal, Button } from '../../../components/ui';
import { db } from '../../../firebase';
import {
  collectionGroup,
  query,
  orderBy,
  where,
  Timestamp,
  doc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { X } from 'lucide-react';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { useUser } from '../../../contexts/UserContext';
import { useStudentRoster } from '../../../hooks/user/useStudentRoster';
import dayjs from 'dayjs';
import BillModalsAndFilters from './components/BillModalsAndFilters';
import BillTable from './components/BillTable';
import { fetchFilteredCursorPage } from '../../realestate/utils/firestoreCursorPaging';
import { getTaxBillOverdueDays } from '../../../utils/taxBillUtils';

const ITEMS_PER_PAGE = 15;
const HISTORY_SCAN_BATCH_SIZE = 60;

const EMPTY_PAGE_ENTRY = {
  items: [],
  hasMore: false,
  nextCursor: null,
};

const TaxBillHistoryModal = ({ isOpen, onClose, classId }) => {
  const [pageEntries, setPageEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedBillForCancel, setSelectedBillForCancel] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [selectedBillIds, setSelectedBillIds] = useState(new Set());
  const [showBatchCancelModal, setShowBatchCancelModal] = useState(false);
  const activeLoadIdRef = useRef(0);

  const { showFeedback } = useFeedback();
  const { userData, classData, studentList = [] } = useUser();
  const { data: rosterStudents = [] } = useStudentRoster(classId, {
    version: classData?.studentRosterVersion,
    enabled: isOpen && !!classId,
    ready: classData?.classId === classId,
  });

  const currencyUnit = classData?.currencyUnit || '원';

  const studentMap = useMemo(() => {
    const nextMap = new Map();
    [...(studentList || []), ...(rosterStudents || [])].forEach((student) => {
      const key = student?.uid || student?.id;
      if (!key) return;

      const name =
        student?.name ||
        student?.displayName ||
        `학생 ${student?.studentNumber || ''}`.trim();
      nextMap.set(key, name);
    });
    return nextMap;
  }, [rosterStudents, studentList]);

  useEffect(() => {
    if (!isOpen) return;

    const today = dayjs();
    const sevenDaysAgo = today.subtract(6, 'day');
    setStartDate(sevenDaysAgo.format('YYYY-MM-DD'));
    setEndDate(today.format('YYYY-MM-DD'));
    setCurrentPage(1);
    setSelectedBillIds(new Set());
  }, [isOpen]);

  const resolveStudentName = useCallback(
    (bill) => {
      return (
        bill.studentName ||
        studentMap.get(bill.studentUid) ||
        studentMap.get(bill.uid) ||
        studentMap.get(bill.userUid) ||
        (bill.studentNumber
          ? `학생 ${bill.studentNumber}`
          : bill.studentUid || bill.uid || '-')
      );
    },
    [studentMap],
  );

  const isBillPaid = useCallback(
    (bill) =>
      bill?.isPaid === true ||
      bill?.isPaid === 'true' ||
      bill?.status === 'paid',
    [],
  );

  const currentPageEntry = pageEntries[currentPage - 1] || EMPTY_PAGE_ENTRY;
  const bills = currentPageEntry.items || [];
  const hasNextPage = Boolean(currentPageEntry.hasMore);
  const hasPreviousPage = currentPage > 1;

  const buildBillsQuery = useCallback(() => {
    return query(
      collectionGroup(db, 'taxBills'),
      where('classId', '==', classId),
      where(
        'issuedAt',
        '>=',
        Timestamp.fromDate(dayjs(startDate).startOf('day').toDate()),
      ),
      where(
        'issuedAt',
        '<=',
        Timestamp.fromDate(dayjs(endDate).endOf('day').toDate()),
      ),
      orderBy('issuedAt', 'desc'),
    );
  }, [classId, endDate, startDate]);

  const loadPage = useCallback(
    async ({ pageNumber, startCursor = null, replace = false }) => {
      const loadId = activeLoadIdRef.current + 1;
      activeLoadIdRef.current = loadId;
      setIsLoading(true);

      try {
        const pageEntry = await fetchFilteredCursorPage({
          baseQuery: buildBillsQuery(),
          startCursor,
          pageSize: ITEMS_PER_PAGE,
          scanBatchSize: HISTORY_SCAN_BATCH_SIZE,
          filterFn: (bill) => {
            if (paymentFilter === 'unpaid') return !isBillPaid(bill);
            if (paymentFilter === 'paid') return isBillPaid(bill);
            return true;
          },
          mapDoc: (docSnap) => {
            const data = docSnap.data();
            const parentStudentUid = docSnap.ref.parent.parent?.id || null;
            return {
              id: docSnap.id,
              ...data,
              studentUid: data.studentUid || parentStudentUid,
            };
          },
        });

        if (loadId !== activeLoadIdRef.current) return;

        setPageEntries((prev) => {
          const nextEntries = replace ? [] : [...prev];
          nextEntries[pageNumber - 1] = pageEntry;
          return nextEntries;
        });
        setCurrentPage(pageNumber);
      } catch (error) {
        if (loadId !== activeLoadIdRef.current) return;

        console.error('[TaxBillHistoryModal] load failed:', error);
        showFeedback(
          '고지서 발급 내역을 불러오는 중 오류가 발생했습니다.',
          'error',
        );
        setPageEntries([]);
      } finally {
        if (loadId === activeLoadIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [buildBillsQuery, isBillPaid, paymentFilter, showFeedback],
  );

  useEffect(() => {
    if (!isOpen || !classId || !startDate || !endDate) {
      activeLoadIdRef.current += 1;
      setPageEntries([]);
      setCurrentPage(1);
      setIsLoading(false);
      return;
    }

    setSelectedBillIds(new Set());
    setSelectedBillForCancel(null);
    void loadPage({
      pageNumber: 1,
      startCursor: null,
      replace: true,
    });
  }, [classId, endDate, isOpen, loadPage, paymentFilter, startDate]);

  const canCancelBill = useCallback(
    (bill) => {
      if (isBillPaid(bill)) {
        return { canCancel: false, reason: '이미 납부된 고지서입니다.' };
      }

      if (bill.issuedBy && bill.issuedBy !== userData?.uid) {
        return { canCancel: false, reason: '발급자만 취소할 수 있습니다.' };
      }

      return { canCancel: true, reason: null };
    },
    [isBillPaid, userData?.uid],
  );

  const toggleBillSelection = (billId) => {
    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) {
        next.delete(billId);
      } else {
        next.add(billId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const cancellableBills = bills.filter((bill) => canCancelBill(bill).canCancel);
    const cancellableIds = cancellableBills.map((bill) => bill.id);

    if (cancellableIds.every((id) => selectedBillIds.has(id))) {
      setSelectedBillIds((prev) => {
        const next = new Set(prev);
        cancellableIds.forEach((id) => next.delete(id));
        return next;
      });
      return;
    }

    setSelectedBillIds((prev) => {
      const next = new Set(prev);
      cancellableIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const reloadFirstPage = useCallback(async () => {
    await loadPage({
      pageNumber: 1,
      startCursor: null,
      replace: true,
    });
  }, [loadPage]);

  const handleSelectedBillsCancel = async () => {
    const selectedBills = bills.filter((bill) => selectedBillIds.has(bill.id));
    if (selectedBills.length === 0) return;

    setIsCancelling(true);
    try {
      const batch = writeBatch(db);

      selectedBills.forEach((bill) => {
        const billPath = `classes/${classId}/students/${bill.studentUid}/taxBills/${bill.id}`;
        batch.delete(doc(db, billPath));
      });

      await batch.commit();

      showFeedback(`${selectedBills.length}개의 고지서를 취소했습니다.`, 'success');
      setSelectedBillIds(new Set());
      setShowBatchCancelModal(false);
      await reloadFirstPage();
    } catch (error) {
      console.error('[TaxBillHistoryModal] selected cancel failed:', error);
      showFeedback('고지서 취소 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCancelBill = async () => {
    if (!selectedBillForCancel) return;

    setIsCancelling(true);
    try {
      const billPath = `classes/${classId}/students/${selectedBillForCancel.studentUid}/taxBills/${selectedBillForCancel.id}`;
      await deleteDoc(doc(db, billPath));

      showFeedback('고지서를 성공적으로 취소했습니다.', 'success');
      setShowCancelModal(false);
      setSelectedBillForCancel(null);
      setSelectedBillIds(new Set());
      await reloadFirstPage();
    } catch (error) {
      console.error('[TaxBillHistoryModal] cancel failed:', error);
      showFeedback('고지서 취소 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleBatchCancel = async (billsToCancel) => {
    if (billsToCancel.length === 0) return;

    setIsCancelling(true);
    try {
      const batch = writeBatch(db);

      billsToCancel.forEach((bill) => {
        const billPath = `classes/${classId}/students/${bill.studentUid}/taxBills/${bill.id}`;
        batch.delete(doc(db, billPath));
      });

      await batch.commit();

      showFeedback(`${billsToCancel.length}개의 고지서를 취소했습니다.`, 'success');
      setSelectedBillIds(new Set());
      await reloadFirstPage();
    } catch (error) {
      console.error('[TaxBillHistoryModal] batch cancel failed:', error);
      showFeedback('일괄 취소 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsCancelling(false);
    }
  };

  const handlePageChange = async (nextPage) => {
    if (nextPage < 1) return;

    if (pageEntries[nextPage - 1]) {
      setCurrentPage(nextPage);
      setSelectedBillIds(new Set());
      return;
    }

    const previousEntry = pageEntries[nextPage - 2];
    if (!previousEntry?.hasMore || !previousEntry?.nextCursor) return;

    setSelectedBillIds(new Set());
    await loadPage({
      pageNumber: nextPage,
      startCursor: previousEntry.nextCursor,
      replace: false,
    });
  };

  const getUnpaidDays = (bill) => {
    if (isBillPaid(bill)) return 0;
    return getTaxBillOverdueDays(bill);
  };

  const unpaidBills = bills.filter((bill) => !isBillPaid(bill));
  const cancellableBillsOnPage = bills.filter(
    (bill) => canCancelBill(bill).canCancel,
  );
  const selectedCancellableBills = bills.filter(
    (bill) => selectedBillIds.has(bill.id) && canCancelBill(bill).canCancel,
  );

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-center justify-between border-b p-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                세금 고지서 발급 내역
              </h2>
              <div className="mt-1 flex items-center gap-4">
                {unpaidBills.length > 0 && (
                  <p className="text-sm text-orange-600">
                    현재 페이지 미납 {unpaidBills.length}건
                  </p>
                )}
                {selectedBillIds.size > 0 && (
                  <p className="text-sm text-blue-600">
                    {selectedBillIds.size}개 선택됨
                  </p>
                )}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <BillModalsAndFilters.FiltersAndActions
            paymentFilter={paymentFilter}
            setPaymentFilter={setPaymentFilter}
            bills={bills}
            unpaidBills={unpaidBills}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            selectedBillIds={selectedBillIds}
            selectedCancellableBills={selectedCancellableBills}
            onUnpaidBatchCancel={handleBatchCancel}
            isCancelling={isCancelling}
            setShowBatchCancelModal={setShowBatchCancelModal}
          />

          <BillTable
            bills={bills}
            isLoading={isLoading}
            currentPage={currentPage}
            hasPreviousPage={hasPreviousPage}
            hasNextPage={hasNextPage}
            handlePageChange={handlePageChange}
            paymentFilter={paymentFilter}
            selectedBillIds={selectedBillIds}
            toggleBillSelection={toggleBillSelection}
            toggleSelectAll={toggleSelectAll}
            cancellableBillsOnPage={cancellableBillsOnPage}
            resolveStudentName={resolveStudentName}
            canCancelBill={canCancelBill}
            getUnpaidDays={getUnpaidDays}
            setSelectedBillForCancel={setSelectedBillForCancel}
            setShowCancelModal={setShowCancelModal}
            currencyUnit={currencyUnit}
          />
        </div>
      </Modal>

      <BillModalsAndFilters.BatchCancelModal
        isOpen={showBatchCancelModal}
        onClose={() => setShowBatchCancelModal(false)}
        onConfirm={handleSelectedBillsCancel}
        selectedBills={selectedCancellableBills}
        isLoading={isCancelling}
        currencyUnit={currencyUnit}
        resolveStudentName={resolveStudentName}
      />

      <BillModalsAndFilters.CancelConfirmModal
        isOpen={showCancelModal}
        onClose={() => {
          setShowCancelModal(false);
          setSelectedBillForCancel(null);
        }}
        onConfirm={handleCancelBill}
        billInfo={selectedBillForCancel}
        isLoading={isCancelling}
        currencyUnit={currencyUnit}
      />
    </>
  );
};

export default TaxBillHistoryModal;
