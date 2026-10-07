import React from "react";
import { BookOpenText, CircleHelp } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUser } from "../../../contexts/UserContext";
import CaseLibraryTabStrip from "./CaseLibraryTabStrip";
import useCaseLibrarySectionUnread from "../hooks/useCaseLibrarySectionUnread";

export default function CaseLibrarySectionTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { classId, userData } = useUser();
  const currentUid = String(userData?.uid || "").trim();
  const { hasNewPosts, hasNewRequests } = useCaseLibrarySectionUnread(
    classId,
    currentUid,
  );

  const activeId = location.pathname.startsWith("/case-library/requests")
    ? "requests"
    : "posts";

  return (
    <CaseLibraryTabStrip
      activeId={activeId}
      items={[
        {
          id: "posts",
          label: "운영사례",
          icon: BookOpenText,
          hasUnread: hasNewPosts,
        },
        {
          id: "requests",
          label: "사례 요청",
          icon: CircleHelp,
          hasUnread: hasNewRequests,
        },
      ]}
      onChange={(nextId) => {
        navigate(nextId === "requests" ? "/case-library/requests" : "/case-library");
      }}
    />
  );
}
