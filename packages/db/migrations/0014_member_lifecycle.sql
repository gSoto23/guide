-- Membership lifecycle, ownership, workspace deletion, and account purge (spec 001 US5).
--
-- Request context (guidesk_app): owners and admins change roles between admin and agent and remove
-- members, never the owner's row and never themselves; any member except the owner can leave.
-- Ownership transfer, workspace deletion, and restore change owner-only state, so they run
-- through SECURITY DEFINER functions that check the caller is the owner. Purges run only in the
-- worker (owner connection); guidesk_app cannot call them.

GRANT UPDATE (role, updated_at) ON membership TO guidesk_app;
--> statement-breakpoint
GRANT DELETE ON membership TO guidesk_app;
--> statement-breakpoint
CREATE POLICY membership_change_role ON membership FOR UPDATE TO guidesk_app
  USING (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND role <> 'owner'
    AND user_id <> app_current_user_id()
  )
  WITH CHECK (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND role IN ('admin', 'agent')
    AND user_id <> app_current_user_id()
  );
--> statement-breakpoint
CREATE POLICY membership_remove ON membership FOR DELETE TO guidesk_app
  USING (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND role <> 'owner'
    AND user_id <> app_current_user_id()
  );
--> statement-breakpoint
CREATE POLICY membership_leave ON membership FOR DELETE TO guidesk_app
  USING (
    workspace_id = app_current_workspace_id()
    AND user_id = app_current_user_id()
    AND role <> 'owner'
  );
--> statement-breakpoint
-- The caller must own the workspace named in the request context.
CREATE OR REPLACE FUNCTION app_caller_owns(p_workspace_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT p_workspace_id = public.app_current_workspace_id()
      AND EXISTS (
        SELECT 1 FROM public.membership m
        WHERE m.workspace_id = p_workspace_id
          AND m.user_id = public.app_current_user_id()
          AND m.role = 'owner'
      )
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_caller_owns(uuid) FROM PUBLIC;
--> statement-breakpoint
-- Ownership transfer (FR-026): the target must be an admin of the workspace. The previous owner
-- becomes an admin. Raises GD403 when the caller is not the owner, GD409 when the target is not
-- an admin of this workspace.
CREATE OR REPLACE FUNCTION transfer_ownership(p_workspace_id uuid, p_target_membership_id uuid)
  RETURNS TABLE (previous_owner_id text, new_owner_id text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  target public.membership%ROWTYPE;
  caller text := public.app_current_user_id();
BEGIN
  IF NOT public.app_caller_owns(p_workspace_id) THEN
    RAISE EXCEPTION 'not the owner' USING ERRCODE = 'GD403';
  END IF;
  SELECT m.* INTO target FROM public.membership m
  WHERE m.id = p_target_membership_id AND m.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR target.role <> 'admin' THEN
    RAISE EXCEPTION 'target_not_admin' USING ERRCODE = 'GD409';
  END IF;
  -- Demote first: the one-owner index is checked per statement.
  UPDATE public.membership m SET role = 'admin'
  WHERE m.workspace_id = p_workspace_id AND m.user_id = caller AND m.role = 'owner';
  UPDATE public.membership m SET role = 'owner' WHERE m.id = target.id;
  INSERT INTO public.security_event (type, outcome, actor_user_id, workspace_id, target_type, target_id, metadata)
  VALUES ('ownership.transferred', 'success', caller, p_workspace_id, 'membership', target.id::text,
          jsonb_build_object('new_owner', target.user_id));
  previous_owner_id := caller;
  new_owner_id := target.user_id;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
-- Workspace deletion (FR-027): pending for 30 days, restorable by the owner. Raises GD403 when the
-- caller is not the owner, GD409 when the workspace is not active.
CREATE OR REPLACE FUNCTION schedule_workspace_deletion(p_workspace_id uuid)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  purge_at timestamptz := now() + interval '30 days';
BEGIN
  IF NOT public.app_caller_owns(p_workspace_id) THEN
    RAISE EXCEPTION 'not the owner' USING ERRCODE = 'GD403';
  END IF;
  UPDATE public.workspace w
  SET status = 'pending_deletion', deleted_at = now(), purge_after = purge_at
  WHERE w.id = p_workspace_id AND w.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace is not active' USING ERRCODE = 'GD409';
  END IF;
  -- Open invitations stop working with the workspace.
  UPDATE public.invitation i SET status = 'revoked'
  WHERE i.workspace_id = p_workspace_id AND i.status = 'pending';
  INSERT INTO public.security_event (type, outcome, actor_user_id, workspace_id, target_type, target_id, metadata)
  VALUES ('workspace.deletion_scheduled', 'success', public.app_current_user_id(), p_workspace_id,
          'workspace', p_workspace_id::text, jsonb_build_object('purge_after', purge_at));
  RETURN purge_at;
END
$$;
--> statement-breakpoint
-- Restore within 30 days. Raises GD403 when the caller is not the owner, GD410 when the workspace
-- is not pending deletion or its window has passed.
CREATE OR REPLACE FUNCTION restore_workspace(p_workspace_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF NOT public.app_caller_owns(p_workspace_id) THEN
    RAISE EXCEPTION 'not the owner' USING ERRCODE = 'GD403';
  END IF;
  UPDATE public.workspace w
  SET status = 'active', deleted_at = NULL, purge_after = NULL
  WHERE w.id = p_workspace_id AND w.status = 'pending_deletion' AND w.purge_after > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nothing to restore' USING ERRCODE = 'GD410';
  END IF;
  INSERT INTO public.security_event (type, outcome, actor_user_id, workspace_id, target_type, target_id)
  VALUES ('workspace.restored', 'success', public.app_current_user_id(), p_workspace_id,
          'workspace', p_workspace_id::text);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION transfer_ownership(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION schedule_workspace_deletion(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION restore_workspace(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION transfer_ownership(uuid, uuid) TO guidesk_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION schedule_workspace_deletion(uuid) TO guidesk_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION restore_workspace(uuid) TO guidesk_app;
--> statement-breakpoint
-- Worker job (daily): permanently deletes workspaces whose 30 days have passed (FR-027). Members
-- and invitations go with them; security events stay.
CREATE OR REPLACE FUNCTION purge_due_workspaces()
  RETURNS TABLE (purged_workspace_id uuid, purged_name text)
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  due record;
BEGIN
  FOR due IN
    SELECT w.id, w.name FROM public.workspace w
    WHERE w.status = 'pending_deletion' AND w.purge_after <= now()
    FOR UPDATE
  LOOP
    INSERT INTO public.security_event (type, outcome, workspace_id, target_type, target_id)
    VALUES ('workspace.purged', 'success', due.id, 'workspace', due.id::text);
    DELETE FROM public.workspace w WHERE w.id = due.id;
    purged_workspace_id := due.id;
    purged_name := due.name;
    RETURN NEXT;
  END LOOP;
END
$$;
--> statement-breakpoint
-- Worker job (daily): completes a scheduled account deletion after 30 days (FR-028).
-- * Workspaces the user owns alone are deleted with the account.
-- * If the user still owns a workspace with other members, nothing happens (GD409): the job retries
--   daily, and support follows up.
-- * Security events keep only a "deleted:" pseudonym of the actor (append-only log, SEC-16).
-- Returns the pseudonym.
CREATE OR REPLACE FUNCTION purge_account(p_user_id text)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  pseudonym text := 'deleted:' || left(md5(p_user_id), 16);
BEGIN
  PERFORM 1 FROM public.account_deletion_request r
  WHERE r.user_id = p_user_id AND r.status = 'scheduled' AND r.purge_after <= now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no deletion due for this account' USING ERRCODE = 'GD410';
  END IF;
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
  PERFORM set_config('app.security_event_pseudonymize', 'off', true);
  DELETE FROM public."user" u WHERE u.id = p_user_id;
  UPDATE public.account_deletion_request r SET status = 'completed' WHERE r.user_id = p_user_id;
  INSERT INTO public.security_event (type, outcome, actor_user_id, target_type)
  VALUES ('account.deleted', 'success', pseudonym, 'user');
  RETURN pseudonym;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_due_workspaces() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_account(text) FROM PUBLIC;
