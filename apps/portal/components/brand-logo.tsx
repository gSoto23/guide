/**
 * The official Guidesk logo (docs/brand/logo, direction "A · Bienvenida"): the full-color lockup on
 * light backgrounds and the light-wordmark version in dark mode. Served as static SVG files from
 * /brand, so it adds no JavaScript to any route (feature 014 brand polish).
 */
export function BrandLogo({ alt, height = 28 }: { alt: string; height?: number }) {
  const width = Math.round((height * 199.46) / 48.35);
  return (
    <picture className="brand-logo">
      <source srcSet="/brand/guidesk-logo-dark.svg" media="(prefers-color-scheme: dark)" />
      <img src="/brand/guidesk-logo.svg" alt={alt} width={width} height={height} />
    </picture>
  );
}
