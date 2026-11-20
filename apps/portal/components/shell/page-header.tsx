import type { ReactNode } from "react";

/**
 * The header of a main page (feature 015 FR-007, contract portal-shell): the title, an optional
 * help line, and the page's primary action, placed at the end on wide screens.
 */
export function PageHeader({
  title,
  titleId,
  help,
  action,
}: {
  title: ReactNode;
  titleId?: string;
  help?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1 id={titleId}>{title}</h1>
        {help ? <p className="page-header-help">{help}</p> : null}
      </div>
      {action ? <div className="page-header-action">{action}</div> : null}
    </header>
  );
}
