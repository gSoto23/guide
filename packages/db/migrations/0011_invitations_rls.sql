-- Invitations: row-level security and acceptance (spec 001 US3, research R4, AC-SEC-002).
--
-- Request context (guidesk_app): owners and admins of the current workspace list, create, resend,
-- and revoke invitations. Nobody can mark an invitation accepted directly: acceptance goes only
-- through accept_invitation(), which checks the token, the expiry, and the verified email.
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitation_system ON invitation FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON invitation TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (status, token_hash, send_count, last_sent_at) ON invitation TO guidesk_app;
--> statement-breakpoint
CREATE POLICY invitation_read ON invitation FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
CREATE POLICY invitation_create ON invitation FOR INSERT TO guidesk_app
  WITH CHECK (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND invited_by = app_current_user_id()
    AND status = 'pending'
    AND role IN ('admin', 'agent')
  );
--> statement-breakpoint
CREATE POLICY invitation_update ON invitation FOR UPDATE TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND status IN ('pending', 'revoked', 'expired')
  );
--> statement-breakpoint
-- Accepts an invitation for the signed-in user (FR-019, FR-020). Raises:
-- * GD410 when the token is unknown, already used, revoked, expired, or the workspace is not active;
-- * GD403 when the user's verified email does not match the invited address (the invitation stays
--   open for its real owner).
-- Never creates a workspace. Accepting again as a member is idempotent ("already_member").
CREATE OR REPLACE FUNCTION accept_invitation(p_token_hash text, p_user_id text)
  RETURNS TABLE (joined_workspace_id uuid, granted_role text, result text, inviter_id text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  inv public.invitation%ROWTYPE;
  account_email text;
  account_verified boolean;
  existing_role text;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM public.app_current_user_id() THEN
    RAISE EXCEPTION 'an invitation can only be accepted by the signed-in user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT i.* INTO inv FROM public.invitation i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND
     OR inv.status <> 'pending'
     OR inv.expires_at <= now()
     OR NOT EXISTS (
       SELECT 1 FROM public.workspace w WHERE w.id = inv.workspace_id AND w.status = 'active'
     ) THEN
    RAISE EXCEPTION 'invitation_gone' USING ERRCODE = 'GD410';
  END IF;

  SELECT u.email, u.email_verified INTO account_email, account_verified
  FROM public."user" u WHERE u.id = p_user_id;
  IF account_email IS NULL
     OR account_verified IS NOT TRUE
     OR lower(btrim(account_email)) <> inv.email THEN
    RAISE EXCEPTION 'email_mismatch' USING ERRCODE = 'GD403';
  END IF;

  SELECT m.role INTO existing_role
  FROM public.membership m
  WHERE m.workspace_id = inv.workspace_id AND m.user_id = p_user_id;
  IF existing_role IS NOT NULL THEN
    granted_role := existing_role;
    result := 'already_member';
  ELSE
    INSERT INTO public.membership (workspace_id, user_id, role, invited_by)
    VALUES (inv.workspace_id, p_user_id, inv.role, inv.invited_by);
    granted_role := inv.role;
    result := 'joined';
  END IF;

  UPDATE public.invitation i
  SET status = 'accepted', accepted_by = p_user_id, accepted_at = now()
  WHERE i.id = inv.id;
  UPDATE public."user" u SET last_workspace_id = inv.workspace_id::text WHERE u.id = p_user_id;
  INSERT INTO public.security_event
    (type, outcome, actor_user_id, workspace_id, target_type, target_id, metadata)
  VALUES (
    'invitation.accepted', 'success', p_user_id, inv.workspace_id, 'invitation', inv.id::text,
    jsonb_build_object('role', granted_role, 'result', result)
  );

  joined_workspace_id := inv.workspace_id;
  inviter_id := inv.invited_by;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION accept_invitation(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION accept_invitation(text, text) TO guidesk_app;
