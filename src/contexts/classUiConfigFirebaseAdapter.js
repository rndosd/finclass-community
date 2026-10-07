import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import {
  readCachedSidebarSettings,
  writeCachedSidebarSettings,
} from "./classUiConfigCache";

export function retainFirebaseClassUiConfigSubscription({
  classId,
  onSettings,
}) {
  return onSnapshot(
    doc(db, `classes/${classId}/displaySettings/sidebar`),
    (snap) => {
      const nextSettings = snap.exists() ? snap.data() : {};
      writeCachedSidebarSettings(classId, nextSettings);
      onSettings(nextSettings);
    },
    (error) => {
      console.error("[ClassUiConfig] sidebar settings error:", error);
      onSettings((prev) => prev ?? readCachedSidebarSettings(classId) ?? {});
    },
  );
}
