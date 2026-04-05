import type { CSSProperties } from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  style?: CSSProperties;
}

export default function Toggle({
  checked,
  onChange,
  disabled,
  style,
}: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0,
        width: 44,
        height: 24,
        borderRadius: 999,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "var(--color-primary)" : "var(--color-border)",
        position: "relative",
        transition: "background 0.15s ease",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: 999,
          background: "#fff",
          transition: "left 0.15s ease",
        }}
      />
    </button>
  );
}
