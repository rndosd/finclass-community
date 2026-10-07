import subscriptionPassbook from "./subscription-types/subscription-passbook-sprout-v1.webp";
import subscriptionRegularPayment from "./subscription-types/subscription-regular-payment-v1.webp";
import subscriptionGoalSavings from "./subscription-types/subscription-goal-savings-v1.webp";
import subscriptionDrawTicket from "./subscription-types/subscription-draw-ticket-v1.webp";

export const SUBSCRIPTION_TYPE_ASSETS = {
  subscriptionPassbook,
  subscriptionRegularPayment,
  subscriptionGoalSavings,
  subscriptionDrawTicket,
};

export const SUBSCRIPTION_TYPE_ASSET_OPTIONS = [
  { value: "subscriptionPassbook", label: "기본 청약", asset: subscriptionPassbook },
  { value: "subscriptionRegularPayment", label: "꾸준한 납입", asset: subscriptionRegularPayment },
  { value: "subscriptionGoalSavings", label: "목표 저축", asset: subscriptionGoalSavings },
  { value: "subscriptionDrawTicket", label: "추첨 참여", asset: subscriptionDrawTicket },
];

export const getSubscriptionTypeAsset = (product = {}) =>
  SUBSCRIPTION_TYPE_ASSETS[product?.assetKey] || subscriptionPassbook;
