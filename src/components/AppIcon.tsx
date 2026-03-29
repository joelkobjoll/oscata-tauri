type IconName =
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
  | "refresh-cw";

export default function AppIcon({
  name,
  size = 18,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const icon = (() => {
    switch (name) {
      case "grid":
        return (
          <>
            <rect x="3" y="3" width="7" height="7" rx="1.5" {...common} />
            <rect x="14" y="3" width="7" height="7" rx="1.5" {...common} />
            <rect x="3" y="14" width="7" height="7" rx="1.5" {...common} />
            <rect x="14" y="14" width="7" height="7" rx="1.5" {...common} />
          </>
        );
      case "movie":
        return (
          <>
            <rect x="3" y="5" width="18" height="14" rx="2.5" {...common} />
            <path d="M7 3v4M12 3v4M17 3v4M7 17v4M12 17v4M17 17v4" {...common} />
          </>
        );
      case "tv":
        return (
          <>
            <rect x="4" y="5" width="16" height="12" rx="2.5" {...common} />
            <path d="M9 21h6M12 17v4M8 3l4 4 4-4" {...common} />
          </>
        );
      case "docs":
        return (
          <>
            <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" {...common} />
            <path d="M14 3v6h6M9 13h6M9 17h6" {...common} />
          </>
        );
      case "download":
        return (
          <>
            <path d="M12 4v10" {...common} />
            <path d="m8 10 4 4 4-4" {...common} />
            <path d="M4 19v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" {...common} />
          </>
        );
      case "settings":
        return (
          <>
            <path d="M10.3 3.3 9.6 5.5a7.2 7.2 0 0 0-1.5.9L5.9 5.7 4.3 7.3l.7 2.2a7.2 7.2 0 0 0-.9 1.5l-2.2.7v2.3l2.2.7c.2.5.5 1 .9 1.5l-.7 2.2 1.6 1.6 2.2-.7c.5.4 1 .7 1.5.9l.7 2.2h2.3l.7-2.2c.5-.2 1-.5 1.5-.9l2.2.7 1.6-1.6-.7-2.2c.4-.5.7-1 .9-1.5l2.2-.7v-2.3l-2.2-.7a7.2 7.2 0 0 0-.9-1.5l.7-2.2-1.6-1.6-2.2.7a7.2 7.2 0 0 0-1.5-.9l-.7-2.2z" {...common} />
            <circle cx="12" cy="12" r="3.2" {...common} />
          </>
        );
      case "activity":
        return <path d="M3 12h4l2.2-5 4.2 10 2.3-5H21" {...common} />;
      case "search":
        return (
          <>
            <circle cx="11" cy="11" r="6.5" {...common} />
            <path d="m20 20-3.5-3.5" {...common} />
          </>
        );
      case "refresh":
        return (
          <>
            <path d="M20 11a8 8 0 0 0-14.7-3M4 13a8 8 0 0 0 14.7 3" {...common} />
            <path d="M20 4v7h-7M4 20v-7h7" {...common} />
          </>
        );
      case "trash":
        return (
          <>
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" {...common} />
            <path d="M10 11v6M14 11v6" {...common} />
          </>
        );
      case "check-square":
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2.5" {...common} />
            <path d="m8 12 3 3 5-6" {...common} />
          </>
        );
      case "close":
        return <path d="m6 6 12 12M18 6 6 18" {...common} />;
      case "edit":
        return (
          <>
            <path d="M12 20h9" {...common} />
            <path d="m16.5 3.5 4 4L8 20l-5 1 1-5z" {...common} />
          </>
        );
      case "folder":
        return (
          <>
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" {...common} />
          </>
        );
      case "chevron-down":
        return <path d="m6 9 6 6 6-6" {...common} />;
      case "chevron-right":
        return <path d="m9 6 6 6-6 6" {...common} />;
      case "star":
        return <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9z" {...common} />;
      case "more-horizontal":
        return (
          <>
            <circle cx="5" cy="12" r="1.8" {...common} />
            <circle cx="12" cy="12" r="1.8" {...common} />
            <circle cx="19" cy="12" r="1.8" {...common} />
          </>
        );
      case "clock":
        return (
          <>
            <circle cx="12" cy="12" r="9" {...common} />
            <path d="M12 7v5l3 2" {...common} />
          </>
        );
      case "check":
        return <path d="m5 12 4 4 10-10" {...common} />;
      case "refresh-cw":
        return (
          <>
            <path d="M21 12a9 9 0 0 0-15.3-6.4" {...common} />
            <path d="M3 4v6h6" {...common} />
            <path d="M3 12a9 9 0 0 0 15.3 6.4" {...common} />
            <path d="M21 20v-6h-6" {...common} />
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {icon}
    </svg>
  );
}
