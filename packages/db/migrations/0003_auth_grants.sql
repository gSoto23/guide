-- Least privilege for request transactions (SEC-14, data model §1).
-- Identity tables are used by the auth library through the owner connection. guidesk_app (the
-- role requests run as) gets no access to them, except display fields of user for member lists.
REVOKE ALL ON "account", "session", "verification", "two_factor", "passkey", "rate_limit" FROM guidesk_app;
--> statement-breakpoint
REVOKE ALL ON "user" FROM guidesk_app;
--> statement-breakpoint
GRANT SELECT (id, name, email, image, preferred_language) ON "user" TO guidesk_app;
