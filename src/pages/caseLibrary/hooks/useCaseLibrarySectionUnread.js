import { useEffect, useState } from "react";
import { subscribeCaseLibrarySectionUnread } from "../services/caseLibraryReadStateService";

const DEFAULT_STATE = Object.freeze({
  posts: false,
  requests: false,
});

export default function useCaseLibrarySectionUnread(classId, uid) {
  const [state, setState] = useState(DEFAULT_STATE);

  useEffect(() => {
    if (!classId || !uid) {
      setState(DEFAULT_STATE);
      return undefined;
    }

    return subscribeCaseLibrarySectionUnread({
      classId,
      uid,
      onChange: (nextState) => {
        setState({
          posts: nextState?.posts === true,
          requests: nextState?.requests === true,
        });
      },
      onError: (error) => {
        console.error("[useCaseLibrarySectionUnread] subscribe failed:", error);
        setState(DEFAULT_STATE);
      },
    });
  }, [classId, uid]);

  return {
    hasNewPosts: state.posts,
    hasNewRequests: state.requests,
  };
}
