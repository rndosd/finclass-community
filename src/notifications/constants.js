import {
  Bell,
  BellRing,
  Calendar,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  Shield,
  Zap,
  CheckCircle,
  XCircle,
  FileText,
  CreditCard,
  Building,
  Gift,
  MessageSquare,
  BookOpenText,
} from "lucide-react";

/**
 * Notification type constants.
 * Shared across services and UI layers.
 */
export const NOTIFICATION_TYPES = {
  // Bank
  DEPOSIT_REQUEST: "deposit_request",
  LOAN_REQUEST: "loan_request",
  DEPOSIT_APPROVED: "deposit_approved",
  DEPOSIT_REJECTED: "deposit_rejected",
  LOAN_APPROVED: "loan_approved",
  LOAN_REJECTED: "loan_rejected",
  DEPOSIT_MATURITY: "deposit_ready_for_withdrawal",
  DEPOSIT_IMMINENT: "deposit_maturity_3days",
  LOAN_DUE: "loan_repayment_due",
  LOAN_IMMINENT: "loan_repayment_3days",
  LOAN_NOTICE: "loan_repayment_7days",

  // Tax and credit
  TAX_BILL: "tax_bill_issued",
  CREDIT_CHANGE: "credit_score_change",

  // Police
  POLICE_REPORT_NEW: "police_report_new",
  POLICE_REPORT_DONE: "police_report_applied",
  POLICE_REPORT_REJECT: "police_report_ignored",
  POLICE_PENALTY: "police_penalty_applied",
  POLICE_FINE_PAID: "police_fine_paid",
  POLICE_RULE_NEW: "police_rule_activated",
  POLICE_RULE_CHANGE: "police_rule_fine_changed",

  // Penalties and appeals
  FINE_APPLIED: "fine_applied",
  APPEAL_SUBMITTED: "appeal_submitted",
  APPEAL_APPROVED: "appeal_approved",
  APPEAL_REJECTED: "appeal_rejected",

  // Store and mission
  STORE_ORDER: "store_order_received",
  STORE_DONE: "store_order_completed",
  STORE_GIFT_RECEIVED: "store_gift_received",
  MISSION_REMINDER: "mission_reminder",
  MARKETPLACE_SALE_DONE: "marketplace_sale_completed",
  NEWS_PUBLISHED: "news_published",
  STORE_PRICE_CHANGED: "store_price_changed",

  // Case library
  CASE_LIBRARY_POST_COMMENT: "case_library_post_comment",
  CASE_LIBRARY_POST_REPLY: "case_library_post_reply",
  CASE_LIBRARY_POST_RECOMMEND: "case_library_post_recommend",
  CASE_LIBRARY_REQUEST_ANSWER: "case_library_request_answer",
  CASE_LIBRARY_REQUEST_REPLY: "case_library_request_reply",

  // System
  EMERGENCY: "emergency",
  SYSTEM: "system_announcement",
  DEFAULT: "default",
};

/**
 * Notification UI and routing metadata.
 * - path: route to navigate when clicked
 * - icon: Lucide icon
 * - label: category label shown in dropdown
 */
export const NOTIFICATION_CONFIG = {
  // --- Bank (/bank) ---
  [NOTIFICATION_TYPES.DEPOSIT_REQUEST]: {
    path: "/bank",
    icon: BellRing,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    label: "\uC608\uAE08 \uC694\uCCAD \uC548\uB0B4",
  },
  [NOTIFICATION_TYPES.LOAN_REQUEST]: {
    path: "/bank",
    icon: BellRing,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    label: "\uB300\uCD9C \uC694\uCCAD \uC548\uB0B4",
  },
  [NOTIFICATION_TYPES.DEPOSIT_APPROVED]: {
    path: "/bank",
    icon: CheckCircle,
    color: "text-green-600",
    bgColor: "bg-green-50",
    label: "\uC608\uAE08 \uC2B9\uC778 \uC644\uB8CC",
  },
  [NOTIFICATION_TYPES.DEPOSIT_REJECTED]: {
    path: "/bank",
    icon: XCircle,
    color: "text-red-600",
    bgColor: "bg-red-50",
    label: "\uC608\uAE08 \uC694\uCCAD \uAC70\uC808",
  },
  [NOTIFICATION_TYPES.LOAN_APPROVED]: {
    path: "/bank",
    icon: CheckCircle,
    color: "text-green-600",
    bgColor: "bg-green-50",
    label: "\uB300\uCD9C \uC2B9\uC778 \uC644\uB8CC",
  },
  [NOTIFICATION_TYPES.LOAN_REJECTED]: {
    path: "/bank",
    icon: XCircle,
    color: "text-red-600",
    bgColor: "bg-red-50",
    label: "\uB300\uCD9C \uC694\uCCAD \uAC70\uC808",
  },
  [NOTIFICATION_TYPES.DEPOSIT_MATURITY]: {
    path: "/bank",
    icon: DollarSign,
    color: "text-green-600",
    bgColor: "bg-green-50",
    label: "\uC608\uAE08 \uB9CC\uAE30 \uB3C4\uB798",
  },
  [NOTIFICATION_TYPES.DEPOSIT_IMMINENT]: {
    path: "/bank",
    icon: Calendar,
    color: "text-yellow-600",
    bgColor: "bg-yellow-50",
    label: "\uC608\uAE08 \uB9CC\uAE30 \uC784\uBC15",
  },
  [NOTIFICATION_TYPES.LOAN_DUE]: {
    path: "/bank",
    icon: AlertTriangle,
    color: "text-red-600",
    bgColor: "bg-red-50",
    label: "\uB300\uCD9C \uC0C1\uD658 \uC548\uB0B4",
  },
  "bank.transfer_received": {
    path: "/bank",
    icon: DollarSign,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    label: "\uC785\uAE08 \uC54C\uB9BC",
  },

  // --- Tax (/tax) ---
  [NOTIFICATION_TYPES.TAX_BILL]: {
    path: "/tax",
    icon: CreditCard,
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    label: "\uC138\uAE08 \uACE0\uC9C0\uC11C \uBC1C\uAE09",
  },
  "tax.bill_issued": {
    path: "/tax",
    icon: CreditCard,
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    label: "\uC138\uAE08 \uACE0\uC9C0\uC11C \uBC1C\uAE09",
  },
  [NOTIFICATION_TYPES.CREDIT_CHANGE]: {
    path: "/credit",
    icon: TrendingUp,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    label: "\uC2E0\uC6A9\uC810\uC218 \uBCC0\uACBD",
  },

  // --- Police (/police) ---
  [NOTIFICATION_TYPES.POLICE_REPORT_NEW]: {
    path: "/police",
    icon: AlertTriangle,
    color: "text-red-600",
    bgColor: "bg-red-50",
    label: "\uC2E0\uADDC \uC2E0\uACE0 \uC811\uC218",
  },
  [NOTIFICATION_TYPES.POLICE_PENALTY]: {
    path: "/police",
    icon: Shield,
    color: "text-red-600",
    bgColor: "bg-red-50",
    label: "\uBC8C\uC810 \uC801\uC6A9 \uC548\uB0B4",
  },
  [NOTIFICATION_TYPES.APPEAL_SUBMITTED]: {
    path: "/police",
    icon: FileText,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    label: "\uBC18\uC131\uBB38 \uC81C\uCD9C \uC644\uB8CC",
  },

  // --- Store and mission (/store, /missions) ---
  [NOTIFICATION_TYPES.STORE_ORDER]: {
    path: "/store",
    icon: Building,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    label: "\uC8FC\uBB38 \uC811\uC218 \uC548\uB0B4",
  },
  [NOTIFICATION_TYPES.STORE_GIFT_RECEIVED]: {
    path: "/store",
    icon: Gift,
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    label: "\uC120\uBB3C \uB3C4\uCC29",
  },
  "store.gift_received": {
    path: "/store",
    icon: Gift,
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    label: "\uC120\uBB3C \uB3C4\uCC29",
  },
  "store.redemption_approved": {
    path: "/store",
    icon: CheckCircle,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    label: "\uC0C1\uC810 \uAD50\uD658 \uC2B9\uC778",
  },
  "store.redemption_rejected": {
    path: "/store",
    icon: XCircle,
    color: "text-red-600",
    bgColor: "bg-red-50",
    label: "\uC0C1\uC810 \uAD50\uD658 \uAC70\uC808",
  },
  [NOTIFICATION_TYPES.MISSION_REMINDER]: {
    path: "/missions",
    icon: AlertTriangle,
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    label: "과제 수행 알림",
  },
  "mission.approved": {
    path: "/missions",
    icon: CheckCircle,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    label: "과제 승인",
  },
  "mission.submitted": {
    path: "/missions",
    icon: FileText,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    label: "과제 제출",
  },
  "mission.rejected": {
    path: "/missions",
    icon: XCircle,
    color: "text-red-600",
    bgColor: "bg-red-50",
    label: "과제 거절",
  },
  [NOTIFICATION_TYPES.MARKETPLACE_SALE_DONE]: {
    path: "/marketplace",
    icon: CheckCircle,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    label: "\uC911\uACE0\uAC70\uB798 \uD310\uB9E4 \uC644\uB8CC",
  },
  [NOTIFICATION_TYPES.NEWS_PUBLISHED]: {
    path: "/news",
    icon: BellRing,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
    label: "\uC0C8 \uB274\uC2A4",
  },
  [NOTIFICATION_TYPES.STORE_PRICE_CHANGED]: {
    path: "/store",
    icon: TrendingUp,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    label: "\uC0C1\uC810 \uAC00\uACA9 \uBCC0\uB3D9",
  },

  // --- Case library (/case-library) ---
  [NOTIFICATION_TYPES.CASE_LIBRARY_POST_COMMENT]: {
    path: "/case-library",
    icon: MessageSquare,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    label: "\uAC00\uC774\uB4DC\uBD81 \uB313\uAE00",
  },
  [NOTIFICATION_TYPES.CASE_LIBRARY_POST_REPLY]: {
    path: "/case-library",
    icon: MessageSquare,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
    label: "\uAC00\uC774\uB4DC\uBD81 \uB2F5\uAE00",
  },
  [NOTIFICATION_TYPES.CASE_LIBRARY_POST_RECOMMEND]: {
    path: "/case-library",
    icon: BookOpenText,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    label: "\uAC00\uC774\uB4DC\uBD81 \uCD94\uCC9C",
  },
  [NOTIFICATION_TYPES.CASE_LIBRARY_REQUEST_ANSWER]: {
    path: "/case-library/requests",
    icon: MessageSquare,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    label: "\uC0AC\uB840 \uC694\uCCAD \uB2F5\uBCC0",
  },
  [NOTIFICATION_TYPES.CASE_LIBRARY_REQUEST_REPLY]: {
    path: "/case-library/requests",
    icon: MessageSquare,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
    label: "\uC0AC\uB840 \uC694\uCCAD \uC758\uACAC",
  },

  // --- System ---
  [NOTIFICATION_TYPES.EMERGENCY]: {
    path: "/dashboard",
    icon: Zap,
    color: "text-red-600",
    bgColor: "bg-red-50",
    label: "\uAE34\uAE09 \uC54C\uB9BC",
  },
  [NOTIFICATION_TYPES.SYSTEM]: {
    path: "/dashboard",
    icon: Bell,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    label: "\uC2DC\uC2A4\uD15C \uACF5\uC9C0",
  },
  [NOTIFICATION_TYPES.DEFAULT]: {
    path: "/dashboard",
    icon: Bell,
    color: "text-slate-600",
    bgColor: "bg-slate-50",
    label: "\uC77C\uBC18 \uC54C\uB9BC",
  },
};

export const getNotificationConfig = (type) => {
  return (
    NOTIFICATION_CONFIG[type] || NOTIFICATION_CONFIG[NOTIFICATION_TYPES.DEFAULT]
  );
};
