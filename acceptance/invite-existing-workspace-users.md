# GH-77: Invite existing users to workspaces

## Description
Admins can use the existing invitation form to add an existing account to their workspace. Existing accounts retain their global role and receive no invitation email. Brand-new accounts keep the existing invitation behavior.

## Interface contract
POST /functions/v1/invite-user retains {email, role, workspaceIds:string[]} and authenticated bearer authorization. Existing successful membership additions return HTTP 200 {success:true, action:'added', user_id, email, role, status, workspaces:string[], workspace_names:string[], email_sent:false}. workspaces/names describe only newly added targets in request order. New-account success adds action:'invited' to the existing response. Errors retain {message:string} and non-2xx status.

Existing profiles must be matched case-insensitively with exact email semantics (literal percent/underscore cannot broaden lookup). Active and pending are eligible; disabled is rejected. Lookup/database errors must fail rather than create a second account or claim success. Membership writes must preserve existing membership metadata, profile role/status and active workspace. System may select multiple workspaces; admins may only add to workspaces they belong to. Developer existing-account attempts return a message explaining that the person already has an account and a workspace admin must add them. No existing-account path calls Auth create/invite/link APIs.

## Acceptance mapping
| ID | Scenario | Required proof |
|---|---|---|
| AC1 | Admin adds active account from Alpha to Beta | Membership exists, Added <email> to Beta toast, row visible without reload |
| AC2 | Selected role differs from existing role | Profile role unchanged |
| AC3 | Existing account addition | No email/auth invitation call; email_sent:false |
| AC4 | Already member of all targets | Error states already member of target workspace; no writes |
| AC5 | Disabled existing account | Disabled error; no membership/role writes |
| AC6 | Pending existing account | Added using same membership flow, status unchanged |
| AC7 | Mixed-case input | Existing lowercase account found |
| AC8 | System mixed existing/missing targets | Only missing targets inserted; existing membership untouched; all-present error |
| AC9 | Developer existing-account invite | Existing-account/workspace-admin error; no changes |
| AC10 | Admin unauthorized workspace | Authorization rejection; unauthorized membership absent |
| AC11 | Brand-new email | Account/invitation behavior preserved; Invitation sent to <email> toast |

## UI/async conventions
Keep current styling, form components and global toast ownership. Immediate Inviting indicator and disabled submit prevent repeat submission. Form retains input on error, clears on success, and clears pending in finally. Store awaits list refresh so completion includes the new row. Closing a dialog does not cancel backend work; global notification still reports outcome, reopened list/reload reads backend memberships. No new pending-state persistence, panels or storage. Domain restrictions compare case-insensitively. Existing developer modal uses the same store action.

## Verification
Capture failing regression on unfixed code before implementation; rerun green after fix. Unit/handler boundary tests are unit evidence, not E2E. Playwright exercises real local Supabase/Auth and actual invite handler with valid fixtures; capture success/error/pending UI evidence. Obtain final full unit regression and required E2E evidence. Independent reviewer checks criteria and evidence.

## Exclusions
Auth-only accounts, per-workspace roles, role changes through invite, existing-account email, account reactivation, developers adding existing users, admins browsing users outside their workspaces.

## Test status
- [x] AC1–AC11: covered by 17 handler and 3 store tests, plus 4 actual-backend integration/browser tests.
- [x] Regression: real handler and local Supabase returned 400 on the unfixed base; membership succeeds after the fix.
- [x] Full unit regression: 14 files / 271 tests passed. Production build passed.
- [x] Browser: repeated form submissions produce one request; close during pending still delivers global completion, reopening and reload show membership; disabled/developer and already-member errors retain retry state.
- [x] Visual evidence: `test-results/screenshots/gh77-*-pending.png`, `gh77-added-row.png`, `gh77-disabled.png`, `gh77-developer.png`, `gh77-reloaded-membership.png`.
- [x] Independent final review: Ready for PR. General unrelated browser suite was not run; focused real-backend invite coverage and full unit suite provide this change's verification.
