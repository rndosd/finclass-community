import { useCallback, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { useFeedback } from '../../../contexts/FeedbackContext';
import { useUser } from '../../../contexts/UserContext';
import { PERMISSION_CONFIG } from '../../admin/PermissionConfig';
import { getPath } from '../utils/taxPathUtils';

const normalizeSalary = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized) return NaN;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return NaN;

  return Math.floor(parsed);
};

const normalizeOptionalHeadcount = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return NaN;

  return Math.floor(parsed);
};

const ALLOWED_PERMISSION_KEYS = new Set(
  PERMISSION_CONFIG.map((permission) => permission.key).filter(Boolean),
);

const normalizeLinkedPermissionKeys = (values) => {
  if (!Array.isArray(values)) return [];

  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter((value) => value && ALLOWED_PERMISSION_KEYS.has(value)),
    ),
  );
};

export const useJobDefinitionsManager = () => {
  const { classId } = useUser();
  const { showFeedback } = useFeedback();

  const [isLoading, setIsLoading] = useState({
    add: false,
    update: false,
    delete: false,
  });

  const setFlag = useCallback((flag, value) => {
    setIsLoading((prev) => ({ ...prev, [flag]: value }));
  }, []);

  const handleAddJob = useCallback(
    async (name, description, salary, targetHeadcount, onSuccess) => {
      if (!classId) {
        showFeedback('학급 정보가 없어 직업을 추가할 수 없습니다.', 'error');
        return;
      }

      const trimmedName = String(name ?? '').trim();
      const trimmedDescription = String(description ?? '').trim();
      const parsedSalary = normalizeSalary(salary);
      const parsedHeadcount = normalizeOptionalHeadcount(targetHeadcount);

      if (!trimmedName || Number.isNaN(parsedSalary) || parsedSalary < 0) {
        showFeedback('직업명과 올바른 급여(0 이상)를 입력해 주세요.', 'error');
        return;
      }

      if (Number.isNaN(parsedHeadcount)) {
        showFeedback('목표 인원은 0 이상의 숫자로 입력해 주세요.', 'error');
        return;
      }

      setFlag('add', true);
      try {
        const jobsPath = getPath('jobDefinitions', classId);
        if (!jobsPath) {
          showFeedback('직업 저장 경로를 찾을 수 없습니다.', 'error');
          return;
        }

        await addDoc(collection(db, jobsPath), {
          name: trimmedName,
          description: trimmedDescription,
          baseSalary: parsedSalary,
          targetHeadcount: parsedHeadcount,
          linkedPermissionKeys: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        showFeedback(`직업 '${trimmedName}'을(를) 추가했습니다.`, 'success');
        if (typeof onSuccess === 'function') {
          onSuccess();
        }
      } catch (err) {
        console.error('[useJobDefinitionsManager] add error:', err);
        showFeedback(`직업 추가 중 오류가 발생했습니다: ${err.message}`, 'error');
      } finally {
        setFlag('add', false);
      }
    },
    [classId, setFlag, showFeedback],
  );

  const handleUpdateJob = useCallback(
    async (jobId, updatedData = {}, options = {}) => {
      if (!classId || !jobId) {
        showFeedback('직업 정보를 저장할 수 없습니다.', 'error');
        return false;
      }

      const {
        successMessage = '직업 정보를 저장했습니다.',
        suppressSuccessFeedback = false,
      } = options;

      const payload = { ...updatedData };

      if (Object.prototype.hasOwnProperty.call(payload, 'baseSalary')) {
        const parsedSalary = normalizeSalary(payload.baseSalary);
        if (Number.isNaN(parsedSalary) || parsedSalary < 0) {
          showFeedback('급여는 0 이상의 숫자로 입력해 주세요.', 'error');
          return false;
        }
        payload.baseSalary = parsedSalary;
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
        payload.description = String(payload.description ?? '').trim();
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'targetHeadcount')) {
        const parsedHeadcount = normalizeOptionalHeadcount(payload.targetHeadcount);
        if (Number.isNaN(parsedHeadcount)) {
          showFeedback('목표 인원은 0 이상의 숫자로 입력해 주세요.', 'error');
          return false;
        }
        payload.targetHeadcount = parsedHeadcount;
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'linkedPermissionKeys')) {
        payload.linkedPermissionKeys = normalizeLinkedPermissionKeys(payload.linkedPermissionKeys);
      }

      payload.updatedAt = serverTimestamp();

      setFlag('update', true);
      try {
        const jobPath = getPath('jobDefinition', classId, { docId: jobId });
        if (!jobPath) {
          showFeedback('직업 저장 경로를 찾을 수 없습니다.', 'error');
          return false;
        }

        await updateDoc(doc(db, jobPath), payload);

        if (!suppressSuccessFeedback) {
          showFeedback(successMessage, 'success');
        }

        return true;
      } catch (err) {
        console.error('[useJobDefinitionsManager] update error:', err);
        showFeedback(`직업 저장 중 오류가 발생했습니다: ${err.message}`, 'error');
        return false;
      } finally {
        setFlag('update', false);
      }
    },
    [classId, setFlag, showFeedback],
  );

  const handleDeleteJob = useCallback(
    async (jobId, jobName) => {
      if (!classId || !jobId) {
        showFeedback('직업을 삭제할 수 없습니다.', 'error');
        return;
      }

      setFlag('delete', true);
      try {
        const jobPath = getPath('jobDefinition', classId, { docId: jobId });
        if (!jobPath) {
          showFeedback('직업 삭제 경로를 찾을 수 없습니다.', 'error');
          return;
        }

        await deleteDoc(doc(db, jobPath));
        showFeedback(`직업 '${jobName || ''}'을(를) 삭제했습니다.`, 'success');
      } catch (err) {
        console.error('[useJobDefinitionsManager] delete error:', err);
        showFeedback(`직업 삭제 중 오류가 발생했습니다: ${err.message}`, 'error');
      } finally {
        setFlag('delete', false);
      }
    },
    [classId, setFlag, showFeedback],
  );

  const handleBatchUpdateJobTargetHeadcounts = useCallback(
    async (updates = [], options = {}) => {
      if (!classId) {
        showFeedback('학급 정보가 없어 목표 인원을 저장할 수 없습니다.', 'error');
        return false;
      }

      const {
        successMessage = '직업 목표 인원을 저장했습니다.',
        suppressSuccessFeedback = false,
      } = options;

      const normalizedUpdates = Array.isArray(updates)
        ? updates
            .map((entry) => {
              const jobId = String(entry?.jobId || '').trim();
              if (!jobId) return null;

              const parsedHeadcount = normalizeOptionalHeadcount(entry?.targetHeadcount);
              if (Number.isNaN(parsedHeadcount)) {
                return { invalid: true };
              }

              return {
                jobId,
                targetHeadcount: parsedHeadcount,
              };
            })
            .filter(Boolean)
        : [];

      if (normalizedUpdates.some((entry) => entry.invalid)) {
        showFeedback('목표 인원은 0 이상의 숫자로 입력해 주세요.', 'error');
        return false;
      }

      if (normalizedUpdates.length === 0) {
        showFeedback('저장할 목표 인원 변경사항이 없습니다.', 'info');
        return false;
      }

      setFlag('update', true);
      try {
        const batch = writeBatch(db);

        for (const entry of normalizedUpdates) {
          const jobPath = getPath('jobDefinition', classId, { docId: entry.jobId });
          if (!jobPath) {
            showFeedback('직업 저장 경로를 찾을 수 없습니다.', 'error');
            return false;
          }

          batch.update(doc(db, jobPath), {
            targetHeadcount: entry.targetHeadcount,
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();

        if (!suppressSuccessFeedback) {
          showFeedback(successMessage, 'success');
        }

        return true;
      } catch (err) {
        console.error('[useJobDefinitionsManager] batch target update error:', err);
        showFeedback(`목표 인원 저장 중 오류가 발생했습니다: ${err.message}`, 'error');
        return false;
      } finally {
        setFlag('update', false);
      }
    },
    [classId, setFlag, showFeedback],
  );

  return {
    isLoading,
    handleAddJob,
    handleUpdateJob,
    handleBatchUpdateJobTargetHeadcounts,
    handleDeleteJob,
    showFeedback,
  };
};
