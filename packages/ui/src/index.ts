/** Shared UI for the portal and, from spec 004, the guest guide. */
export const UI_PACKAGE = "@guidesk/ui";
export {
  GuideDocumentView,
  type GuideDocumentViewProps,
  type RenderableDocument,
} from "./guide-renderer/guide-document.js";
export { Icon } from "./icons/icon.js";
export * from "./icons/data.js";
export {
  ICONS,
  REASON_ICONS,
  SECTION_ICONS,
  reasonIcon,
  sectionIcon,
  type IconName,
} from "./icons/registry.js";
export { BrandMark, Illustration } from "./illustrations/illustration.js";
export * from "./illustrations/data.js";
export { ILLUSTRATIONS, type IllustrationName } from "./illustrations/registry.js";
export { REASON_ICON_DATA, reasonIconData } from "./icons/reasons.js";
export { SECTION_ICON_DATA, sectionIconData } from "./icons/sections.js";
