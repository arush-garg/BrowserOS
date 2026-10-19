AUDIT: BrowserOS External MCP Mutation Authorization & Page Ownership
=======================================================================

SCOPE: Crate /Users/ag/Development/BrowserOS/packages/browseros-agent/apps/claw-server-rust

EXISTING APIs (exact path:line, current behavior):

1. src/services/sessions/tab_ownership.rs:141-143
   pub async fn owner_of_page(&self, page_id: &PageId) -> Option<ConvoId>
   Reads the conversation ID that owns a given page. Pure read; never blocks or rejects.

2. src/services/sessions/tab_ownership.rs:145-158
   pub async fn claim_page(&self, convo_id: ConvoId, page_id: PageId)
   Claims a page for a conversation. If previous owner differed, removes page from
   previous convo's tab set. Used by effects when an agent creates a new tab.

3. src/services/sessions/tab_ownership.rs:54-64
   struct Inner { page_owners: HashMap<PageId, ConvoId>, convos: HashMap<ConvoId, ConvoTabs> }
   Dual RwLock-protected maps: page→owner and convo→tabs-set. Both locks held together
   to prevent mismatched views during reassignment.

4. src/api/mcp/dispatch.rs:40
   pub struct ToolIdentity { session: Arc<Session>, agent: ClientIdentity,
   ownership_key: ConvoId, agent_label: String }
   Per-conversation ownership key, distinct from transport-session and profile ids.

5. src/api/mcp/dispatch.rs:38-39
   Ownership key is separate from session_id; enables per-conversation isolation without
   tying to transport session lifecycle.

6. src/api/mcp/effects/ownership_claims.rs:68-98
   record_new_page() auto-claims a newly-created page: records to tab_activity,
   enqueues claim_tab_for_session in session_tabs, and (via PageOwnership) records
   the agent as owner. Shared by tabs-new effect and script hooks.

7. src/api/mcp/guards/mod.rs:1-5
   Explicit declaration: "Page ownership is deliberately NOT among [guards], and must
   never be added back." Ownership is a label, never a permission.

8. src/api/mcp/effects/page_ownership_notice.rs:1-29
   Header comment (the definitive design rationale):
   - "Ownership is a LABEL, never a permission"
   - "This module exists so an agent knows whose tab it is looking at"
   - "must never gate a dispatch, and nothing here may turn a result into an error"
   - "Agents are allowed to act on the user's tabs and on other agents' tabs"
   - "The rule: ownership answers 'whose is this', never 'may I'"
   - History: a prior `guards::page_ownership` was removed because (a) user's own tabs
     became permanently unreachable, (b) lost session handles orphaned agent pages mid-task.

RISK ASSESSMENT: Blocking User's Own Tabs & Legacy Clients

BLOCKING USER TABS (HIGH RISK):
- Any guard that rejects dispatches against pages not owned by the calling convo will
  permanently block the user from their own tabs. The page_ownership_notice.rs header
  explicitly documents this failure mode: "The user's own tabs became permanently
  unreachable. The guard's own comment conceded it: unclaimed user pages were rejected
  and never auto-claimed."
- User tabs that were opened before an agent session start have no ownership key, so
  they would be rejected or orphaned.
- The system deliberately avoids this: ownership is purely informational; agents may
  act on any tab including the user's.

LEGACY CLIENTS (MEDIUM RISK):
- Pre-2026-07-28 MCP revisions had protocol-level sessions; removing session handle could
  mint a new identity and orphan pages mid-task (as documented in page_ownership_notice.rs:17-19).
- However, the current architecture uses per-conversation ownership_key: ConvoId which
  is stable across session transitions.
- Legacy clients without the ownership_key field will have it default to None/empty, which
  is safe because ownership is a label — the absence of a key simply means "unknown owner,"
  not "denied access."

MINIMAL SAFE NEXT STEPS (NO LIVE-BROWSER TESTS REQUIRED):

1. EXPOSE owner_of_page as a read-only MCP capability so agents can inspect tab ownership
   without any restriction. Add to the MCP tool registry as a read tool (like get_tab_info)
   that returns the ConvoId owning each page. Never gated by dispatch.

2. IMPLEMENT minimal "per-session ownership distinction" via the existing ownership_key:
   - The ToolIdentity already carries ownership_key: ConvoId (dispatch.rs:40)
   - No new API needed; the field exists and is populated during connection
   - Agents can read it via context.call.identity.ownership_key to know which convo they're in
   - This is already sufficient to distinguish per-session ownership without adding guards

3. ADD optional off-line test harness:
   - Unit test owner_of_page / claim_page interactions in tab_ownership.rs
   - Verify that claiming page P for convo A then querying owner_of_page(P) returns A
   - Verify that after claiming, previous owner's convo loses the page from its tab set
   - These are pure Rust tests; no browser needed

4. DO NOT add any guard that checks ownership before dispatch. The guards/mod.rs
   explicitly documents why this was removed and must not be repeated.

RISK: Blocking legacy clients or user tabs by treating ownership_key as a permission
boundary would recreate the exact failure mode already documented and rejected in
page_ownership_notice.rs. The architecture correctly treats ownership as a label only.

OUTCOME: The narrow existing APIs (owner_of_page, claim_page, ownership_key in ToolIdentity)
already provide per-session ownership distinction as a label. No new implementation is
safe or necessary without live-browser tests — the risk of breaking user tab access outweighs
any hypothetical benefit. Minimal next steps: expose owner_of_page read-only, add unit
tests, and absolutely forbid adding ownership-based dispatch guards.