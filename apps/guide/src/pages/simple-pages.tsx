import { Layout, type PageChrome } from "../components/layout.js";

/** G-13: unknown, unpublished, or removed guides; never names the property (FR-011). */
export function UnavailablePage(input: PageChrome) {
  const { t } = input;
  return (
    <Layout {...input} title={t("unavailable.title")}>
      <h1 className="title">{t("unavailable.title")}</h1>
      <p className="lead">{t("unavailable.body")}</p>
    </Layout>
  );
}

export function RootPage(input: PageChrome) {
  const { t } = input;
  return (
    <Layout {...input} title={t("root.title")}>
      <h1 className="title">{t("root.title")}</h1>
      <p className="lead">{t("root.body")}</p>
    </Layout>
  );
}

export function OfflinePage(input: PageChrome) {
  const { t } = input;
  return (
    <Layout {...input} title={t("offline.pageTitle")}>
      <h1 className="title">{t("offline.pageTitle")}</h1>
      <p className="lead">{t("offline.pageBody")}</p>
      <p>{t("locked.fallback")}</p>
    </Layout>
  );
}

export function RateLimitedPage(input: PageChrome) {
  const { t } = input;
  return (
    <Layout {...input} title={t("rateLimited.title")}>
      <h1 className="title">{t("rateLimited.title")}</h1>
      <p className="lead">{t("rateLimited.body")}</p>
    </Layout>
  );
}

/**
 * The stay link exchange page (research R5): it never looks the token up. Its script posts the
 * token and replaces this history entry, so the token leaves the address bar and the history.
 */
export function ExchangePage(input: PageChrome) {
  const { t } = input;
  return (
    <Layout
      {...input}
      title={t("exchange.opening")}
      clientTexts={{
        "exchange.failed": t("exchange.failed"),
        "exchange.retry": t("exchange.retry"),
      }}
    >
      <div id="exchange" data-exchange="true">
        <h1 className="title">{t("exchange.opening")}</h1>
        <noscript>
          <p className="lead">{t("exchange.noscript")}</p>
        </noscript>
      </div>
    </Layout>
  );
}
