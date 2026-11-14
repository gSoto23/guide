import type { ReactElement } from "react";
import { render } from "@react-email/render";

export interface RenderedEmail {
  html: string;
  text: string;
}

/** Renders a React Email element to HTML and plain text. */
export async function renderEmail(element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
