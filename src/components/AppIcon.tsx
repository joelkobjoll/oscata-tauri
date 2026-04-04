import {
  Activity,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock,
  Download,
  FileText,
  Filter,
  Folder,
  LayoutGrid,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  RefreshCw,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  Tv2,
  WifiOff,
  X,
} from "lucide-react";
import type { LucideProps } from "lucide-react";

export type IconName =
  | "grid"
  | "movie"
  | "tv"
  | "docs"
  | "download"
  | "settings"
  | "activity"
  | "search"
  | "refresh"
  | "trash"
  | "check-square"
  | "close"
  | "edit"
  | "folder"
  | "chevron-down"
  | "chevron-right"
  | "star"
  | "more-horizontal"
  | "clock"
  | "check"
  | "refresh-cw"
  | "wifi-off"
  | "moon"
  | "sun"
  | "monitor"
  | "filter";

const ICON_MAP: Record<IconName, React.ComponentType<LucideProps>> = {
  grid: LayoutGrid,
  movie: Clapperboard,
  tv: Tv2,
  docs: FileText,
  download: Download,
  settings: Settings,
  activity: Activity,
  search: Search,
  refresh: RefreshCcw,
  trash: Trash2,
  "check-square": CheckSquare,
  close: X,
  edit: Pencil,
  folder: Folder,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  star: Star,
  "more-horizontal": MoreHorizontal,
  clock: Clock,
  check: Check,
  "refresh-cw": RefreshCw,
  "wifi-off": WifiOff,
  moon: Moon,
  sun: Sun,
  monitor: Monitor,
  filter: Filter,
};

export default function AppIcon({
  name,
  size = 18,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}) {
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    />
  );
}
