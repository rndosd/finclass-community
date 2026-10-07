import {
  orderBy,
  query,
  where,
} from "firebase/firestore";

export const buildJobPostApplicationsQuery = ({ applicationsRef, authorUid = "" }) => {
  const normalizedAuthorUid = String(authorUid || "").trim();
  if (normalizedAuthorUid) {
    return query(applicationsRef, where("authorUid", "==", normalizedAuthorUid));
  }
  return query(applicationsRef, orderBy("appliedAt", "desc"));
};
