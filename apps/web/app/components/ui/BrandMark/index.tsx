type BrandMarkProps = {
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
};

/** Hollow の 2 円マーク（spec/design/icons）。`currentColor` で描く線画。 */
export function BrandMark({
  width = 26,
  height = 16,
  strokeWidth = 1.4,
  className = "",
}: BrandMarkProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 26 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      role="img"
      aria-label="Hollow"
      className={className}
    >
      <circle cx="9" cy="8" r="6.4" />
      <circle cx="17" cy="8" r="6.4" />
    </svg>
  );
}
