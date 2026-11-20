import type { IconData, IconShape } from "./data.js";

function shape(item: IconShape, index: number) {
  if ("d" in item) return <path key={index} d={item.d} />;
  if ("r" in item) return <circle key={index} cx={item.cx} cy={item.cy} r={item.r} />;
  return (
    <rect key={index} x={item.x} y={item.y} width={item.width} height={item.height} rx={item.rx} />
  );
}

/**
 * One icon from the Guidesk set. Always next to a visible text label, so it is hidden from
 * assistive technology (spec FR-015). Colors come from the text color.
 */
export function Icon({
  data,
  size = 20,
  className,
}: {
  data: IconData;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `icon ${className}` : "icon"}
    >
      {data.map(shape)}
    </svg>
  );
}
