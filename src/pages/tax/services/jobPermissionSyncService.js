import { httpsCallable } from "firebase/functions";

import { functions } from "../../../firebase";

const assignStudentJobsCallable = httpsCallable(functions, "assignStudentJobs");

export const assignStudentJobs = async ({
  classId,
  assignments = [],
  source = "",
} = {}) => {
  const response = await assignStudentJobsCallable({
    classId,
    assignments,
    source,
  });

  return response.data || { studentCount: 0, updatedCount: 0 };
};
