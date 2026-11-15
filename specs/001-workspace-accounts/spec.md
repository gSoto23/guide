# Feature Specification: Workspaces, Accounts, Roles and Invitations

**Feature Branch**: `001-workspace-accounts`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "Start spec 001: workspaces, accounts, roles and invitations (PRD F01), including users in several workspaces, onboarding questions, and host account protection (NFR-13, SEC-05)."

**Sources**: [PRD F01](../../docs/product/prd.md#f01--workspaces-accounts-and-roles) · [NFR-13](../../docs/product/prd.md#7-non-functional-requirements) · [Security controls](../../docs/architecture/security.md#4-controls) · [Data model](../../docs/architecture/overview.md#6-data-model-conceptual) · [Personas](../../docs/product/personas.md)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign up and get a workspace (Priority: P1)

Ana, an individual host, hears about Guidesk and wants to try it from her phone. She signs up
with her Google account or her email address, answers up to three quick questions (how many
properties she manages, which PMS she uses, her country and language), and lands in her own
workspace, ready to create her first property.

**Why this priority**: Nothing else in Guidesk works without an account and a workspace. It is
also the first impression, and the PRD's "time to guide" goal (≤ 30 minutes) starts here.

**Independent Test**: A new person signs up with each supported method on a phone, verifies
their email, and reaches the "create your first property" step as the owner of a new workspace.

**Acceptance Scenarios**:

1. **Given** a person without an account, **When** they sign up with Google, **Then** an account
   and a workspace are created, they are its owner, and they see the onboarding questions.
2. **Given** a person without an account, **When** they sign up with their email address,
   **Then** they receive a one-time code by email; entering it verifies the address, signs them
   in, and continues to the onboarding questions. No password is ever created.
3. **Given** the onboarding questions, **When** the person skips all of them, **Then** they still
   reach the "create your first property" step, and their language defaults to the browser's.
4. **Given** the person answers "10+ properties" and a PMS, **When** they finish onboarding,
   **Then** they see the manager path (bulk options first). **Given** they answer "1–2", **Then**
   they see the individual-host path.
5. **Given** a one-time code older than 10 minutes or already used, **When** the person enters
   it, **Then** it is rejected and they can request a new one.

---

### User Story 2 - Sign in securely and protect the account (Priority: P1)

Marco, a manager with 60 units, signs in every day from his phone and laptop. Because his
account can reveal the access codes of 60 homes, Guidesk requires a second factor, asks him to
confirm his identity again before sensitive actions, warns him about sign-ins from new devices,
and lets him close sessions he does not recognize.

**Why this priority**: Account takeover is Guidesk's top threat (constitution, Principle VI).
These protections must exist before any pilot host stores an access code.

**Independent Test**: An owner of a workspace with more than 2 properties is forced to enroll a
second factor before revealing a restricted value; a sign-in from a new device sends an alert;
revoking a session signs that device out.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they register a passkey, **Then** they can sign in next
   time with it alone.
2. **Given** an owner or admin of a workspace with more than 2 properties and no second factor,
   **When** they attempt a sensitive action, **Then** they must enroll a second factor first.
3. **Given** a user who last authenticated more than 10 minutes ago, **When** they try to reveal
   a door code, **Then** they must re-authenticate before it is shown.
4. **Given** a sign-in from a device the account has not used before, **When** it succeeds,
   **Then** the user receives an email alert with the device and approximate location.
5. **Given** the session list, **When** the user revokes a session, **Then** that device is
   signed out at its next request.
6. **Given** a user who enrolled a second factor, **When** they lose it, **Then** they can sign
   in with a one-time recovery code.

---

### User Story 3 - Invite the team with roles (Priority: P2)

Marco invites two support agents and an operations admin by email. Each invitee accepts and joins
Marco's workspace with the role he chose. Agents handle guest conversations; the admin manages
properties and settings; only Marco controls the workspace itself.

**Why this priority**: Managers (persona P2) cannot run Guidesk alone. Invitations are needed for
the pilot's 3–5 managers, but individual hosts can start without them.

**Independent Test**: An owner invites a person with the `agent` role; the invitee accepts with
the invited email and can use the inbox but cannot invite members or change settings.

**Acceptance Scenarios**:

1. **Given** an owner or admin, **When** they invite an email address with the `admin` or `agent`
   role, **Then** the invitee receives an invitation email valid for 7 days.
2. **Given** an invitation, **When** the invitee signs in or signs up with the invited email and
   accepts, **Then** they join that workspace with that role, and no new workspace is created for
   them.
3. **Given** an invitation, **When** someone opens it while signed in with a different email,
   **Then** they cannot accept it and are told to use the invited address.
4. **Given** a pending invitation, **When** the owner revokes it, **Then** the link stops working.
5. **Given** a workspace at its seat limit, **When** an admin tries to invite someone, **Then**
   the invitation is blocked with an explanation.

---

### User Story 4 - Work across several workspaces (Priority: P2)

Luisa is a co-host for two managers and also rents out her own apartment. She uses one Guidesk
account, belongs to three workspaces with a different role in each, and switches between them
without mixing any data.

**Why this priority**: Co-hosting is common in short-term rentals. Without it, people create
duplicate accounts, which breaks security alerts and audit trails. It is cheap to support now and
expensive to retrofit (PRD FR-01.6).

**Independent Test**: A user who is a member of two workspaces switches between them and sees
only the current workspace's data and the actions their role allows there.

**Acceptance Scenarios**:

1. **Given** a user in several workspaces, **When** they switch workspace, **Then** every screen
   shows only that workspace's data, and the current workspace is always visible.
2. **Given** a user with `admin` in workspace A and `agent` in workspace B, **When** they open
   workspace B, **Then** only agent actions are available.
3. **Given** a user who already owns a workspace, **When** they create another workspace,
   **Then** they become its owner, and plan limits apply to each workspace separately.
4. **Given** a user who signs in again, **When** they have several workspaces, **Then** they land
   in the last workspace they used.

---

### User Story 5 - Manage members, ownership, and personal data (Priority: P3)

Owners and admins change roles and remove members. Owners transfer ownership or delete the
workspace. Any user can leave a workspace, change their email, export their personal data, or
delete their account.

**Why this priority**: Required for a healthy lifecycle and for data-protection rights (NFR-04),
but the pilot can begin with manual handling of rare cases.

**Independent Test**: An owner removes a member who is signed in elsewhere, and that member loses
access within one minute; a user exports their data and receives a complete file.

**Acceptance Scenarios**:

1. **Given** a member signed in on another device, **When** an owner removes them, **Then** they
   lose access to that workspace within 1 minute.
2. **Given** an owner who wants to leave, **When** they try, **Then** they must first transfer
   ownership to an existing admin.
3. **Given** an owner, **When** they delete the workspace after re-authenticating and typing its
   name, **Then** members are notified and the workspace can be restored for 30 days, after which
   it is permanently deleted.
4. **Given** a user, **When** they request an export of their personal data, **Then** they receive
   it within 30 days (target 7 days).
5. **Given** a user who owns a workspace with other members, **When** they try to delete their
   account, **Then** they are asked to transfer ownership or delete the workspace first.
6. **Given** a user who changes their email, **When** they confirm the new address, **Then** the
   old address receives a notice and all other sessions are signed out.

### Edge Cases

- **Same email, two sign-in methods:** a person signs up with email and later uses Google with the
  same address. They reach the same account and never get a duplicate.
- **Email capitalization:** `Ana@Example.com` and `ana@example.com` are the same account.
- **Expired or used invitation:** opening it shows a clear message and a way to ask for a new one.
- **Invitation to an existing member:** the inviter is told the person is already a member.
- **Owner removal attempt:** an admin cannot remove, demote, or replace the owner.
- **Last workspace removed:** a user removed from their only workspace is offered to create one.
- **Lost second factor and recovery codes:** recovery goes through a documented manual identity
  check by Guidesk support, and the event is logged.
- **Workspace crosses the MFA threshold:** when a third property is added, owners and admins
  without a second factor are prompted, and sensitive actions stay blocked until they enroll.
- **One-time code email never arrives:** the user can resend it, with a limit on how often.
- **Lost access to the email inbox:** a user with a passkey can still sign in and change the
  account email; without a passkey, recovery goes through the manual identity check.
- **Removed mid-action:** a member removed while a page is open cannot save changes afterward.
- **Ownership transfer to a member without a second factor** in a workspace above the threshold:
  the new owner must enroll before the transfer completes.

## Requirements *(mandatory)*

### Functional Requirements

**Sign-up and identity**

- **FR-001**: People MUST be able to sign up and sign in with a Google account, with a passkey, or
  with their email address through a one-time code or link sent to that address. Guidesk MUST NOT
  use passwords. *(Decided 2026-11-14: passwordless.)*
- **FR-002**: Email ownership MUST be verified at sign-up: by the one-time code or link for email
  sign-up, or by Google for Google sign-up. One-time codes and links expire after 10 minutes,
  work once, and can be resent with a rate limit.
- **FR-003**: Each email address MUST map to exactly one account, compared case-insensitively.
  Signing in with Google using an email that already has an account MUST reach that same account.
- **FR-004**: On first sign-up (not when accepting an invitation), the system MUST create a
  workspace with the user as its owner. Its default name comes from the user's name and can be
  changed.
- **FR-005**: Onboarding MUST ask at most three questions: properties managed (1–2, 3–10, 10+),
  PMS used (a list plus "none" and "other"), and country and preferred language. Every question
  can be skipped; the preferred language defaults to the browser language. Answers can be edited
  later.
- **FR-006**: The onboarding answers MUST select the onboarding path (individual host or manager)
  and MUST be available to Guidesk in aggregate to prioritize PMS importers.
- **FR-007**: After onboarding, the user MUST land on the "create your first property" step
  (handoff to feature 002).

**Account protection**

- **FR-008**: Users MUST be able to register one or more passkeys and sign in with them. The
  system MUST offer passkey setup after the first sign-in.
- **FR-009**: Multi-factor sign-in MUST be required for owners and admins of any workspace with
  more than 2 properties, and for Guidesk staff. A passkey sign-in satisfies it on its own; an
  email or Google sign-in must be followed by a passkey or an authenticator-app code. Other users
  MUST be prompted to add a passkey but may decline.
- **FR-010**: Users with a second factor MUST receive one-time recovery codes, which they can
  regenerate after re-authenticating.
- **FR-011**: The system MUST require re-authentication within the last 10 minutes before these
  sensitive actions:
  - revealing or exporting restricted values (such as door codes);
  - connecting, changing, or disconnecting integrations;
  - inviting members, changing roles, removing members, or transferring ownership;
  - deleting a workspace or the account;
  - changing the account email or removing a second factor.
- **FR-012**: The system MUST email the user when their account signs in from a new device.
- **FR-013**: Users MUST be able to see their active sessions (device, approximate location, last
  activity) and revoke any of them. Changing the email or removing a second factor MUST revoke
  all other sessions.
- **FR-014**: Sign-in attempts, including one-time code entries, MUST be rate-limited per account
  and per source. Repeated failures MUST temporarily block attempts and notify the account
  owner. Sign-up, sign-in, and recovery
  messages MUST NOT reveal whether an email address has an account.
- **FR-015**: Sessions MUST expire after 7 days of inactivity and after 30 days at most.

**Workspaces and roles**

- **FR-016**: Each workspace MUST have exactly one owner and any number of admins and agents.
  Permissions follow this matrix:

  | Capability | Owner | Admin | Agent |
  |---|---|---|---|
  | Edit workspace settings | Yes | Yes | No |
  | Plan, limits, and billing | Yes | No | No |
  | Invite and remove members, change roles (never the owner) | Yes | Yes | No |
  | Transfer ownership, delete the workspace | Yes | No | No |
  | Create, edit, and publish properties and guides | Yes | Yes | No |
  | Connect and manage integrations | Yes | Yes | No |
  | Handle guest conversations and approve drafts | Yes | Yes | Yes |
  | Reveal restricted values (with re-authentication) | Yes | Yes | No |
  | View the workspace's security log | Yes | Yes | No |

  *(Decided 2026-11-14: agents never see restricted values.)* When a guest needs one, the agent
  points them to the verified guide section or escalates to an owner or admin.

- **FR-017**: Every request MUST be limited to the workspaces the user belongs to and the actions
  their role allows there. Attempts to reach another workspace's data MUST be denied without
  revealing whether that data exists, and MUST be logged.

**Invitations**

- **FR-018**: Owners and admins MUST be able to invite people by email with the `admin` or `agent`
  role. Invitations expire after 7 days and can be resent or revoked.
- **FR-019**: An invitation MUST be accepted only by an account whose verified email matches the
  invited address. Each invitation link works once.
- **FR-020**: Accepting an invitation MUST add a membership to the existing workspace and MUST NOT
  create a new workspace. A person who signs up through an invitation still sets their
  preferred language.
- **FR-021**: Invitations MUST respect the workspace's seat limit (defined in feature 011). During
  the free pilot, Guidesk sets the limits.

**Several workspaces**

- **FR-022**: A user MUST be able to belong to several workspaces, with a role per workspace, and
  switch between them from any screen in no more than two taps. The current workspace MUST always
  be visible.
- **FR-023**: Users MUST be able to create additional workspaces, of which they become the owner.
- **FR-024**: At sign-in, the system MUST open the workspace the user used last.

**Membership lifecycle and personal data**

- **FR-025**: Owners and admins MUST be able to change roles and remove members (admins never
  the owner). Removal MUST take effect within 1 minute in all of that member's sessions.
- **FR-026**: Members MUST be able to leave a workspace. An owner MUST transfer ownership to an
  existing admin before leaving.
- **FR-027**: Owners MUST be able to delete a workspace after re-authenticating and typing its
  name. Members MUST be notified. The workspace MUST be restorable for 30 days and then
  permanently deleted.
- **FR-028**: Users MUST be able to export their personal account data and delete their account,
  completed within 30 days (NFR-04). Account deletion MUST be blocked while the user owns a
  workspace that has other members.
- **FR-029**: Users MUST be able to change their account email after verifying the new address
  with a one-time code.
  The old address MUST receive a notice.

**Audit and experience**

- **FR-030**: The system MUST record these events in an append-only security log:
  - sign-ins (successful and failed);
  - second-factor and passkey changes, recovery-code use, and session revocations;
  - invitations sent, accepted, and revoked;
  - role changes, removals, ownership transfers, and workspace deletion or restoration;
  - email changes;
  - denied cross-workspace attempts.

  Owners and admins see their workspace's events; every user sees their own account events.
- **FR-031**: All screens and emails in this feature MUST be available in Spanish and English,
  following the user's preferred language.
- **FR-032**: Every flow in this feature MUST be fully usable on a phone (NFR-12).

### Key Entities *(include if feature involves data)*

- **User**: a person's identity across Guidesk, with email, name, preferred language, sign-in
  methods, and second factors. Not owned by any workspace.
- **Workspace**: a customer account (an individual host or a management company) that owns
  properties, settings, and plan limits.
- **Membership**: links one user to one workspace with one role (`owner`, `admin`, `agent`). A user
  can have many memberships; a workspace has exactly one owner membership.
- **Invitation**: a pending offer to join a workspace, with the invited email, role, inviter,
  expiry, and status (pending, accepted, revoked, expired).
- **Session**: a signed-in device, with device description, approximate location, and last
  activity.
- **Second factor**: a passkey or authenticator app enrolled by a user, plus recovery codes.
- **One-time code**: a short-lived, single-use code or link sent by email to sign in or verify an
  address.
- **Onboarding profile**: the user's answers to the onboarding questions.
- **Security event**: an append-only record of a security-relevant action, with actor, workspace
  (when applicable), time, and outcome.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The median new host goes from opening the sign-up page to the "create your first
  property" step in under 2 minutes on a phone, and 90% do it in under 3 minutes.
- **SC-002**: At least 70% of new sign-ups answer the PMS question.
- **SC-003**: 95% of invitees who accept join the correct workspace within 2 minutes of opening
  the email, and no invitee ends up with an unintended new workspace.
- **SC-004**: Zero cross-workspace data exposures, in automated isolation tests and during the
  pilot.
- **SC-005**: 100% of sensitive actions by owners and admins of workspaces above the threshold are
  performed with a second factor (verified from the security log).
- **SC-006**: Removed members lose access within 1 minute in 100% of tested cases.
- **SC-007**: Switching workspaces takes at most two taps, and the new workspace appears in under
  2 seconds.
- **SC-008**: Every event type listed in FR-030 appears in the security log within 1 minute.
- **SC-009**: Personal-data export and account deletion requests complete within 30 days, with a
  target of 7 days.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

### Threats (STRIDE)

- **S**: Phishing or credential stuffing takes over a manager account that can reveal many homes'
  access codes.
- **S**: An invitation email is forwarded or intercepted, and someone else joins the workspace.
- **S**: Someone uses a session left open on a shared or stolen device.
- **E**: An admin tries to become owner, or an agent tries to gain admin powers.
- **I**: A member reaches another workspace's data, through workspace switching or by changing an
  identifier.
- **I**: Sign-up, sign-in, or recovery messages reveal which emails have accounts (enumeration).
- **I**: A support agent leaks a door code they did not need to see.
- **R**: A dispute over who changed a role, removed a member, or deleted a workspace.
- **D**: Repeated verification or invitation emails are used to flood an inbox.

### Controls Applied

- **SEC-05**: passkeys, required second factor above the threshold, re-authentication for
  sensitive actions, new-device alerts, revocable sessions (FR-008 to FR-015).
- **SEC-11**: browser protections against session theft and forged requests.
- **SEC-14**: every request scoped to the user's memberships, with workspace isolation enforced
  at every layer (FR-017).
- **SEC-16**: append-only security log (FR-030).
- **SEC-20**: only the data listed in Key Entities is collected; onboarding answers are internal
  data, reported in aggregate.

### Abuse Cases (Acceptance Criteria)

- **AC-SEC-001**: Given repeated wrong one-time codes or failed second-factor checks on one
  account, when the failures exceed the limit, then further attempts are blocked for a period and
  the account owner is notified.
- **AC-SEC-002**: Given an invitation opened by an account with a different email, when that
  account tries to accept, then it is refused and nothing about the workspace beyond its name is
  shown.
- **AC-SEC-003**: Given an admin, when they try to change the owner's role, remove the owner, or
  transfer ownership to themselves, then the action is refused and logged.
- **AC-SEC-004**: Given a member of workspace A, when they request any workspace B resource by
  changing an identifier, then access is denied without confirming that the resource exists, and
  the attempt is logged.
- **AC-SEC-005**: Given an owner of a workspace with 3 properties and no second factor, when they
  try to reveal a door code, then they must enroll a second factor first.
- **AC-SEC-006**: Given a removed member with an open session, when they try any action in that
  workspace one minute after removal, then it is refused.
- **AC-SEC-007**: Given any email address, when someone submits it to sign-up, sign-in, or
  recovery, then the response is the same whether or not an account exists.
- **AC-SEC-008**: Given repeated requests to resend a one-time code or invitation, when they
  exceed the limit, then sending pauses for a period.
- **AC-SEC-009**: Given a member with the `agent` role, when they try to reveal a restricted
  value, then it is refused and logged.

### Platform Policies

No platform policies (PC-xx) apply: this feature handles host accounts only and never touches
guests, guest data, or OTA content.

## Assumptions

- The property count used for the second-factor threshold comes from feature 002.
- Seat and workspace limits are defined in feature 011; during the free pilot, Guidesk configures
  them per workspace.
- Guidesk staff accounts and support access belong to the back-office (feature 015); this feature
  only requires staff to use a second factor.
- Sign in with Apple, enterprise single sign-on, per-property permissions, and an owner read-only
  role are out of scope (per-property permissions and the read-only role are feature 021).
- Session lifetimes (7 days idle, 30 days maximum) and the 10-minute re-authentication window are
  initial defaults, to be tuned with pilot feedback.
- Transactional emails (verification, invitations, alerts) depend on the email provider chosen
  in the plan (OQ-29).
- The authentication provider is chosen in the plan (OQ-21) and must support passkeys,
  authenticator apps, re-authentication, and session revocation.
- The 30-day workspace restore window and the export format are defaults pending the legal review
  (OQ-35).
