import type { MetadataRoute } from "next";

/**
 * The portal as an installable app (ADR-0006, feature 006 FR-015): iPhones receive push only when
 * the portal is added to the home screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Guidesk",
    short_name: "Guidesk",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
