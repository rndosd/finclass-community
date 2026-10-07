import {
  BookOpen,
  Coffee,
  Cookie,
  Crown,
  Gamepad2,
  Gift,
  Package,
  PackageOpen,
  Palette,
  Sparkles,
  Star,
  Ticket,
  Trophy,
} from "lucide-react";

import {
  PRODUCT_TYPE_ASSET_OPTIONS,
  getProductTypeAsset,
  getProductTypeAssetKey,
} from "../../../assets/illustrations/productTypes";
import { isRandomBoxItem } from "./randomBox";

export const STORE_ITEM_ICON_OPTIONS = PRODUCT_TYPE_ASSET_OPTIONS;

export const isStoreItemIconHidden = (item = {}) =>
  String(item?.itemIcon || "").trim() === "none";

const STORE_ITEM_ICON_MAP = {
  Sparkles,
  Ticket,
  Gift,
  Coffee,
  Cookie,
  BookOpen,
  Gamepad2,
  Trophy,
  Palette,
  Crown,
  Package,
  PackageOpen,
  Star,
};

export const getStoreItemIcon = (item = {}) => {
  if (isRandomBoxItem(item) || item?.itemType === "random_box") return PackageOpen;
  const selectedIcon = STORE_ITEM_ICON_MAP[item.itemIcon];
  if (selectedIcon) return selectedIcon;
  if (item.itemType === "ticket") return Ticket;
  return Sparkles;
};

export const getStoreItemAssetKey = getProductTypeAssetKey;

export const getStoreItemAsset = getProductTypeAsset;
