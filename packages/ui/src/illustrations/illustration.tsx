import type { IllustrationData, IllustrationShape } from "./data.js";

function shape(item: IllustrationShape, index: number) {
  if ("d" in item) return <path key={index} className={item.cls} d={item.d} />;
  if ("r" in item) {
    return <circle key={index} className={item.cls} cx={item.cx} cy={item.cy} r={item.r} />;
  }
  return (
    <rect
      key={index}
      className={item.cls}
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      rx={item.rx}
    />
  );
}

/**
 * A decorative Guidesk illustration (spec FR-017, FR-018). Its size is fixed by the attributes, so
 * it never shifts the layout; the colors follow the app's light and dark tokens.
 */
export function Illustration({
  data,
  width = 240,
  className,
}: {
  data: IllustrationData;
  width?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 240 160"
      width={width}
      height={Math.round((width * 160) / 240)}
      aria-hidden="true"
      focusable="false"
      className={className ? `illustration ${className}` : "illustration"}
    >
      {data.map(shape)}
    </svg>
  );
}

/**
 * The Guidesk mark drawn for 16–31 px (brand guide §2.3: the favicon geometry, thicker walls).
 * Decorative: it always sits next to the word "Guidesk".
 */
export function BrandMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className ? `brand-mark ${className}` : "brand-mark"}
    >
      <path className="il-terra" d="M1 14V5a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4Z" />
      <path className="il-sol" d="M6 14V8a2 2 0 0 1 4 0v6Z" />
    </svg>
  );
}
