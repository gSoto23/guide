-- Security review of US3–US5 (spec 001 T103). Findings and tests: checklists/security.md §8.
--
-- 1. Invitations follow their state machine in the database too: only open invitations change,
--    and a resend must replace the token.
-- 2. Accepting needs an inviter who is still an owner or admin of the workspace, so a removed or
--    demoted admin's invitations stop working.
-- 3. The request role is empty for non-owners of a workspace pending deletion, so RLS refuses
--    their writes even if the deletion lands mid-request.
-- 4. Account purge removes the rest of the personal data and uses a random pseudonym that no
--    remaining row can link back to the user.

-- 1. Invitation updates from the request context: open invitations only; pending → revoked or
-- expired, or pending → pending as a resend (new token, one more send).
DROP POLICY invitation_update ON invitation;
--> statement-breakpoint
CREATE POLICY invitation_update ON invitation FOR UPDATE TO guidesk_app
  USING (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND status = 'pending'
  )
  WITH CHECK (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND status IN ('pending', 'revoked', 'expired')
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invitation_check_transition() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  -- The worker, migrations, and SECURITY DEFINER functions run as the owner.
  IF current_user <> 'guidesk_app' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('revoked', 'expired')
     AND NEW.token_hash = OLD.token_hash AND NEW.send_count = OLD.send_count THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'pending'
     AND NEW.token_hash <> OLD.token_hash AND NEW.send_count = OLD.send_count + 1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid invitation change' USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER invitation_check_transition BEFORE UPDATE ON invitation
  FOR EACH ROW EXECUTE FUNCTION invitation_check_transition();
--> statement-breakpoint
-- 2. accept_invitation: the inviter must still be an owner or admin, and the workspace row is
-- locked so a concurrent deletion or purge can't interleave.
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
       SELECT 1 FROM public.workspace w
       WHERE w.id = inv.workspace_id AND w.status = 'active'
       FOR SHARE
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.membership m
       WHERE m.workspace_id = inv.workspace_id
         AND m.user_id = inv.invited_by
         AND m.role IN ('owner', 'admin')
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
--> statement-breakpoint
-- 3. The request role, as withRlsContext reads it: non-owners get none while the workspace is
-- pending deletion. SECURITY DEFINER so the workspace status is read whatever workspace_read shows.
CREATE OR REPLACE FUNCTION app_membership_role(p_workspace_id uuid, p_user_id text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT m.role FROM public.membership m
    JOIN public.workspace w ON w.id = m.workspace_id
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_user_id
      AND p_user_id = public.app_current_user_id()
      AND (w.status = 'active' OR m.role = 'owner')
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_membership_role(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_membership_role(uuid, text) TO guidesk_app;
--> statement-breakpoint
-- 4a. Pseudonymization may also replace a purged user's ID in ownership.transferred metadata
-- (`new_owner`). Every other change is still rejected.
CREATE OR REPLACE FUNCTION security_event_reject_changes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('app.security_event_pseudonymize', true) = 'on'
     AND (to_jsonb(NEW) - 'actor_user_id' - 'metadata') = (to_jsonb(OLD) - 'actor_user_id' - 'metadata')
     AND (NEW.metadata - 'new_owner') IS NOT DISTINCT FROM (OLD.metadata - 'new_owner')
     AND (
       NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
       OR (
         OLD.actor_user_id IS NOT NULL
         AND OLD.actor_user_id NOT LIKE 'deleted:%'
         AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id LIKE 'deleted:%')
       )
     )
     AND (
       NEW.metadata -> 'new_owner' IS NOT DISTINCT FROM OLD.metadata -> 'new_owner'
       OR (
         OLD.metadata ->> 'new_owner' NOT LIKE 'deleted:%'
         AND NEW.metadata ->> 'new_owner' LIKE 'deleted:%'
       )
     )
     AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'security_event is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
-- 4b. Account purge (FR-028), replacing 0014's version:
-- * a random pseudonym, stored instead of the user ID everywhere the ID would remain;
-- * invitations addressed to the user, sign-in codes, lockout counters, and rate-limit counters
--   are deleted;
-- * the user's workspaces are locked before checking for other members.
CREATE OR REPLACE FUNCTION purge_account(p_user_id text)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  pseudonym text := 'deleted:' || left(replace(gen_random_uuid()::text, '-', ''), 16);
  account_email text;
  email_hash text;
BEGIN
  PERFORM 1 FROM public.account_deletion_request r
  WHERE r.user_id = p_user_id AND r.status = 'scheduled' AND r.purge_after <= now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no deletion due for this account' USING ERRCODE = 'GD410';
  END IF;
  PERFORM 1 FROM public.workspace w
  WHERE w.id IN (
    SELECT own.workspace_id FROM public.membership own
    WHERE own.user_id = p_user_id AND own.role = 'owner'
  )
  FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.membership own
    WHERE own.user_id = p_user_id AND own.role = 'owner'
      AND EXISTS (
        SELECT 1 FROM public.membership other
        WHERE other.workspace_id = own.workspace_id AND other.user_id <> p_user_id
      )
  ) THEN
    RAISE EXCEPTION 'owns a workspace with other members' USING ERRCODE = 'GD409';
  END IF;
  SELECT lower(btrim(u.email)) INTO account_email FROM public."user" u WHERE u.id = p_user_id;
  email_hash := encode(sha256(convert_to(coalesce(account_email, ''), 'UTF8')), 'hex');

  INSERT INTO public.security_event (type, outcome, workspace_id, target_type, target_id)
  SELECT 'workspace.purged', 'success', own.workspace_id, 'workspace', own.workspace_id::text
  FROM public.membership own WHERE own.user_id = p_user_id AND own.role = 'owner';
  DELETE FROM public.workspace w
  WHERE w.id IN (
    SELECT own.workspace_id FROM public.membership own
    WHERE own.user_id = p_user_id AND own.role = 'owner'
  );

  PERFORM set_config('app.security_event_pseudonymize', 'on', true);
  UPDATE public.security_event e SET actor_user_id = pseudonym WHERE e.actor_user_id = p_user_id;
  UPDATE public.security_event e
  SET metadata = jsonb_set(e.metadata, '{new_owner}', to_jsonb(pseudonym))
  WHERE e.metadata ->> 'new_owner' = p_user_id;
  PERFORM set_config('app.security_event_pseudonymize', 'off', true);

  IF account_email IS NOT NULL THEN
    DELETE FROM public.invitation i WHERE i.email = account_email;
    -- Compared by suffix, not LIKE: addresses may contain _ or %.
    DELETE FROM public.verification v
    WHERE right(v.identifier, length(account_email)) = account_email;
  END IF;
  DELETE FROM public.auth_lockout l WHERE l.key IN ('user:' || p_user_id, 'email:' || email_hash);
  DELETE FROM public.rate_limit_bucket b
  WHERE right(b.key, length(p_user_id) + 1) = ':' || p_user_id
     OR right(b.key, length(email_hash) + 1) = ':' || email_hash;
  DELETE FROM public."user" u WHERE u.id = p_user_id;
  UPDATE public.account_deletion_request r
  SET status = 'completed', user_id = pseudonym
  WHERE r.user_id = p_user_id;
  INSERT INTO public.security_event (type, outcome, actor_user_id, target_type)
  VALUES ('account.deleted', 'success', pseudonym, 'user');
  RETURN pseudonym;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_account(text) FROM PUBLIC;
