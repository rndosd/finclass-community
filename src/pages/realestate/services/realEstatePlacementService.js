import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase';

export const saveRealEstatePlacement = async ({ classId, seats, expectedRevision, requestId, labels }) => {
  const callable = httpsCallable(functions, 'saveRealEstatePlacement');
  const result = await callable({ classId, seats, expectedRevision, requestId, labels });
  return result.data;
};

export const saveRealEstateDeskDisplayScale = async ({ classId, deskDisplayScale, requestId }) => {
  const callable = httpsCallable(functions, 'saveRealEstateDeskDisplayScale');
  const result = await callable({ classId, deskDisplayScale, requestId });
  return result.data;
};

export const createRealEstateSeat = async (classId, requestId) => {
  const callable = httpsCallable(functions, 'createRealEstateSeat');
  const result = await callable({ classId, requestId });
  return result.data;
};

export const saveRealEstateAssignments = async (payload) => {
  const callable = httpsCallable(functions, 'saveRealEstateAssignments');
  const result = await callable(payload);
  return result.data;
};

export const setRealEstateSeatActive = async (classId, deskId, isActive) => {
  const callable = httpsCallable(functions, 'setRealEstateSeatActive');
  const result = await callable({ classId, deskId, isActive });
  return result.data;
};
