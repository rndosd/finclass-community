import DOMPurify from "dompurify";

export const sanitizeRichHtml = (html) =>
  DOMPurify.sanitize(typeof html === "string" ? html : "");
