import { copy, house, Icon, layers, link, pencil } from "@guidesk/ui";

/**
 * The icon of each way to add a property (feature 017 FR-015). Rendered by server pages and passed
 * into the client `StartOptionsPanel`, so the icons add no JavaScript to the route (research R8).
 */
export const START_OPTION_ICONS = {
  listing: <Icon data={copy} size={22} />,
  pms: <Icon data={link} size={22} />,
  csv: <Icon data={layers} size={22} />,
  duplicate: <Icon data={house} size={22} />,
  blank: <Icon data={pencil} size={22} />,
};
