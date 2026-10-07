import {
  Backpack,
  BookOpen,
  Gift,
  GraduationCap,
  Heart,
  Newspaper,
  Sparkles,
  Star,
  Tag,
  Ticket,
  Trophy,
  ShoppingCart,
} from "lucide-react";

import { Badge } from "../../../components/ui";

export const TITLE_CATEGORY_ICON_MAP = {
  Tag,
  BookOpen,
  Backpack,
  AcademicCap: GraduationCap,
  Sparkles,
  Star,
  Trophy,
  Gift,
  ShoppingCart,
  Newspaper,
  Heart,
  Ticket,
};

export default function TitleCategoryBadge({
  label,
  iconKey = "Tag",
  colorKey = "blue",
  size = "md",
  variant = "soft",
  className = "",
}) {
  if (!label) return null;

  const Icon = TITLE_CATEGORY_ICON_MAP[iconKey] || Tag;

  return (
    <Badge
      tone={colorKey || "blue"}
      size={size}
      variant={variant}
      icon={Icon}
      className={className}
    >
      {label}
    </Badge>
  );
}
