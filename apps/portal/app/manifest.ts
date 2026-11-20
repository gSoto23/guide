import type { MetadataRoute } from "next";

/**
 * The portal as an installable app (ADR-0006, feature 006 FR-015): iPhones receive push only when
 * the portal is added to the home screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Guidesk",
    short_name: "Guidesk",
    // Feature 014 FR-013: the installed app opens where hosts work, not on the public home page.
    start_url: "/start",
    scope: "/",
    display: "standalone",
    // Brand "cal" (docs/brand/README.md §3.1): the splash screen and status bar match the app.
    background_color: "#FFFCF8",
    theme_color: "#FFFCF8",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
