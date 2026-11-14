-- Account-protection tables are used only in the system context (auth hooks and guards on the
-- owner connection). Request transactions (guidesk_app) get no access (least privilege).
REVOKE ALL ON session_assurance, known_device, step_up_challenge, auth_lockout FROM guidesk_app;
