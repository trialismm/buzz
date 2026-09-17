# Agent Configuration — Contributor Rules

Scope: `desktop/src/features/agents/` (config surfaces, shared config renderer,
and the agent config core). Read this before changing how harness / provider /
model / effort configuration is modeled, rendered, persisted, or applied.

Plan of record: `Buzz/Harness-Provider-Model.md` in Morgan's Obsidian vault
(PR sequence, decisions log). PRs: #2140 (rename), #2148 (flag reduction),
#2156 (honest model states), #2158 (Agent Config Core).

## The one rule

**Harness capability facts have exactly one source: the Rust runtime catalog.**
`KnownAcpRuntime` (`desktop/src-tauri/src/managed_agents/discovery/runtime_metadata.rs`)
declares each harness's model/provider/effort env keys and capabilities. Spawn
applies them; `AcpRuntimeCatalogEntry` exposes them over IPC; and
`lib/agentConfigCore.ts` projects them into field descriptors. The frontend
never maintains a rival copy of this table. Setup guidance follows the same
rule: `requires_external_cli` is derived from `KnownAcpRuntime` and projected
to the UI rather than inferred from a runtime ID in a component.

**Second metadata source: command-keyed execution policy.**
`harness_max_parallelism` (`managed_agents/parallelism.rs`) maps the harness's
static command string to a spawn-time cap (`OPENCLAW_MAX_PARALLELISM = 5` for
OpenClaw). This cap is not a `KnownAcpRuntime` field because it applies to
preset harnesses (like OpenClaw) that are not in the builtin catalog. It is
projected onto `AcpRuntimeCatalogEntry.max_parallelism` by all four
catalog-producing constructors (builtin discovery, preset catalog, custom
discovery, custom-save response) using the **static definition command**, not
the resolved `entry.command` (which may be `null` for unavailable entries).
The frontend reads `maxParallelism` from the catalog entry and never keeps a
separate constant.

If you need a new capability fact (a new env key, a native option, a "supports
X" flag): add it to `KnownAcpRuntime` first, expose it on
`AcpRuntimeCatalogEntry`, then project it through the core. Do not shortcut
with a TypeScript lookup table or an id comparison in a component.

## Rules

1. **No hardcoded harness-ID checks in render code.** `runtime.id === "claude"`
   belongs in `deriveAgentConfigFieldModel` (once, with a named reason), never
   in a component. Components ask the field model what exists
   (`hasRenderableAgentConfigField`, `getRenderableEffortField`).
2. **Effort reads/writes go through the descriptor.** Use the effort
   descriptor's `currentPersistence` key — never a raw
   `BUZZ_AGENT_THINKING_EFFORT` literal in UI code. `currentPersistence` is
   where the value lives *today*; `targetApplication` is how the harness
   *should* receive it. They intentionally differ until PR 2.7 migrates
   Goose/Claude — do not "fix" one to match the other without doing the
   migration work.
3. **Field absence has a named reason, not a boolean.** Codex effort is
   `ownedByModelId`; Claude effort is `deferredUntilNativeOptionsAvailable`.
   New absences get new named reasons in `AgentConfigOmission` /
   `render` — never a `showX` prop.
4. **The clearing policy is the named types.** `onContextChange:
   "resetDependentValues"` (user changed harness/provider → dependent values
   reset everywhere) vs `onCatalogMismatch: "explainOnly" | "onboardingCleanup"`
   (an async catalog miss never silently erases saved state outside
   onboarding's named cleanup). Do not add mutation booleans like
   `clearInvalidModel`; extend the policy types.
5. **"Metadata unknown" ≠ "harness lacks the capability".** Passing
   `runtime: undefined` to the core means fields won't render. Surfaces must
   gate on the runtime catalog query settling (loading/error states) rather
   than letting fields silently vanish — see `AgentDefaultsEditor` /
   `DefaultConfigStep` for the pattern.
6. **One canonical behavior, disclosure presets for visibility.** Behavior
   flags were deliberately killed in #2148 (`CANONICAL_CONFIG_BEHAVIORS`).
   Surface differences are expressed via the `disclosure` preset, not new
   boolean props.  **Exception:** `onboarding-essential` hides happy-path
   helper copy (provider/model descriptions) but a non-null model-discovery
   status always bypasses the preset and renders the status line — enforced
   via `shouldShowModelStatusMessage()` (`AgentConfigFields.tsx`).
   Additionally, a successful discovery response that yields no usable options
   (`supportsSwitching:false` or empty model list) synthesizes a warning status
   via `synthesizeEmptyDiscoveryStatus()` and is intentionally **not cached**
   so that closing → reopening the dialog re-runs discovery after the user
   installs or signs into the CLI (`isCacheableDiscoveryResponse()`).
7. **Onboarding setup detects readiness; it does not select defaults.** The
   setup page derives visible and ready harnesses from the runtime catalog and
   only offers install or sign-in actions. The following defaults page is the
   sole onboarding surface that chooses `preferred_runtime`. Its complete draft
   lives in machine-onboarding session state, so Back performs no write and
   restores even incomplete edits when the user returns. Skip abandons that
   draft and advances with zero config writes. Next is the only persistence
   boundary: it consumes the shared renderer's `onValidityChange` signal,
   disables editing while awaiting `set_global_agent_config`, advances only on
   success, and leaves the draft in place with a retryable inline error on
   failure. A harness selection alone does not enable Next when the harness
   requires provider/model/credential config (e.g. buzz-agent with no
   provider). Baked build env and runtime-file config satisfy the gate. Drafts
   intentionally do not survive an app restart.
   `onboarding-agent-defaults.spec.ts` is the acceptance gate for anything
   touching this flow or the shared renderer.
8. **Omit the Model control only after a confirmed successful empty
   discovery on an optional-model harness.** When the field model marks model
   as `acpNative` (Claude Code / Codex), `shouldRenderModelControl` hides the
   picker while discovery is in flight and after IPC resolves with no usable
   options (`modelDiscoverySuccessfulEmpty` / `isSuccessfulEmptyDiscovery`).
   A thrown or unavailable discovery keeps the control so #2246 failure UI can
   render, and must not heal/clear persisted model or effort. Full disclosure
   still shows the control when Custom model is available. Required-model
   harnesses always keep the field. Gate: `defaults hides model when optional
   harness has empty discovery` (and the failed-discovery counterpart) in
   `onboarding-agent-defaults.spec.ts`.
9. **The defaults modal is progressively disclosed.** An unset global config
   starts on the Buzz Agent-first deployment fallback and carries that visible
   harness into the next saved edit. The `progressive-defaults` disclosure
   preset therefore begins at Provider for Buzz Agent, then reveals Model,
   Effort, and Advanced only after a provider is configured. Harnesses whose
   runtime metadata has no provider field skip that gate. Reveals animate their
   height through Motion and become immediate when reduced motion is requested.
   Once the Advanced toggle is visible, its expanded state is exclusively
   user-controlled: provider, harness, and required-env changes must never
   open it automatically in defaults, create, or edit flows. In Create mode,
   `Run on` belongs in Advanced directly after **Who can send instructions**;
   keep it out of the basic create fields. The defaults summary follows
   preferred-harness changes saved while the dialog is open, and its configured
   state includes required credentials as well as provider/model values. If no
   available harness can resolve, Create starts in Customize and lets unavailable
   catalog entries be selected only to expose their setup guidance; submission
   remains blocked.
   Advanced-only required credentials and incomplete remote **Run on** setup
   mark the collapsed Advanced toggle without opening it, and block incomplete
   saves.
   Runtime-file credentials satisfy Global Defaults just as they do Create and
   Edit. In Edit,
   selecting Custom command keeps its required command field beside the harness
   picker rather than hiding it in Advanced.
10. **Catalog visibility is community-scoped relay state, never a global
    definition field.** `AgentDefinition.shared` is only the active
    relay+owner projection returned to the UI. Durable heads and pending
    publications live in the scoped retention database, and explicit share
    toggles await relay acceptance before the UI claims that an agent was
    published or removed. A queued update must stay visibly queued, and the
    catalog itself must render only relay-confirmed publications — never an
    optimistic local persona.
11. **Shared agent access names the consequence where it is selected.** The
   shared respond-to field shows a persistent warning whenever `anyone` **or**
   `allowlist` is selected — both hand the host's access to someone other than
   the owner, so both disclose it and only the audience phrase differs. This
   covers persona-backed create and edit surfaces. Keep that disclosure in
   the shared field instead of adding surface-specific flags. It renders
   directly below the selector for `anyone` but *after* the people picker for
   `allowlist`, so it never sits between the user and the selection they came
   to make. The copy leads with the audience ("Anyone can use this agent to
   access…") so it reads as a warning rather than an explanation, and stays one
   sentence — don't split the mechanism into a second sentence. Both the machine
   and the stakes it names come from `lib/agentAccessWarning.ts`, keyed on an
   optional `runLocation`: instance surfaces resolve it from
   `ManagedAgent.backend` via `runLocationForBackend`, and the create flow from
   `WhereToRunDraft.runOn` via `runLocationForRunOn`. `AgentDialog` is the one
   place that resolves it for dialog surfaces and publishes it through
   `ui/AgentRunLocationContext.tsx`; the field reads that context and lets an
   explicit `runLocation` prop win. Do **not** thread the value as a prop
   through `AgentDefinitionDialog` / `AgentInstanceEditDialog` — neither uses
   the value itself, and the shared context keeps the dialog boundary stable.
   Surfaces rendered outside `AgentDialog` (e.g. `EditRespondToDialog`) pass the
   prop directly. Local names "your
   computer, including files, accounts, and connected tools"; remote names "the
   server it runs on, including any accounts and tools available there" —
   deliberately *not* the owner's files, which aren't theirs to describe on a
   host they don't own. **For a persona-linked deployed agent, the profile Edit
   dialog seeds access from the exact clicked instance and saves access through
   `update_managed_agent`; persona behavior remains the definition default, but
   must never bypass the instance command's stop, persist, publish, and restart
   boundary.** An unknown location falls back to the local wording — never hedge
   with "computer or server". A remote host requires an
   installed `buzz-backend-*` provider, and without one `WhereToRunSection`
   never renders, so "server" would name a concept the owner has never been
   shown; when it *is* remote they picked that host from the selector
   themselves. Never synthesize a run location a surface doesn't have. Don't
   expose `respond-to`, `allowlist`, Nostr, or harness jargon in primary UI
   copy. **The owner-only-access build capability is backend-independent.** When
   `getAgentAccessOwnerOnly()` is true, every managed agent's access control is
   locked to owner-only, including provider-backed agents. A provider backend
   does not prove remote execution and must never create a policy carve-out.
12. **Shared instructions must be reviewable byte-for-byte.** Agent definitions
   execute their `system_prompt` verbatim, so catalog and snapshot review
   surfaces render the literal prompt, never the chat Markdown projection
   (which can conceal spoilers, link destinations, and image sources). Reject
   Unicode default-ignorable, bidirectional-formatting, and non-layout control
   characters at both the untrusted catalog parser and the Rust persistence /
   import boundary. Do not silently strip them: rejection keeps the reviewed
   string identical to the executed string. New sharing paths must reuse the
   same validation before they persist or activate a definition.
13. **Profile runtime sections render only reported agent data.** Missing
   runtime, model, status, command, MCP, advanced, or diagnostics values stay
   absent in every build mode. Do not fill profile or agent-panel gaps with
   development/staging examples, preview controls, or synthetic configuration;
   those values can be mistaken for the viewed agent's real configuration.
   Configuration rows show the effective value regardless of whether it came
   from an explicit choice, global default, config file, or runtime override.
   Do not add provenance lines, shadowed/struck-through values, pre-start
   placeholders, or whole-section dimming; use an em dash for an unknown value.
   Info, activity, agent-configuration, and model-setting rows use the same bare
   16px leading-icon treatment as agent management actions. Keep semantic icons
   visible in profile variants and do not wrap them in background shapes. An
   owned agent profile is entry-point invariant: opening the same deployed
   agent from Agents, a DM, or a channel must expose the same actions, tabs,
   fields, and profile-wide activity selection. Caller context may control the
   panel shell or return navigation, but must not filter or replace profile
   content. Explicit public-key targets are always exact, including stopped,
   archived, and relay-only identities. Only explicit persona navigation may
   select a representative or offer persona Start; a relay persona link cannot
   borrow a local sibling's management controls. See
   [the identity contract](../../../../docs/agent-profile-identity.md).
   The hero's runtime quick controls (`profile/ui/ProfileRuntimeQuickControls.tsx`,
   test ids `user-profile-quick-*`) follow the same contract: they render only
   for the owner of the exact local record, show only reported values (no
   harness pill without an `agentCommand`), and depend on nothing the caller
   supplies, so they are entry-point invariant. Each pill writes through the
   IPC the edit dialogs already use, never a new one: Harness pins an
   instance override (`update_managed_agent` with `agentCommand` +
   `harnessOverride` + that harness's default args) and then reopens the Model
   menu; Model writes to the persona for a linked instance (its effective model
   is `resolve_linked`: definition → global, so `record.model` would be a
   silent no-op) and propagates via `personaManagedAgentUpdate` exactly like
   `submitProfilePersonaDialog`, or sets instance `model` for a definition-less
   record. Pills do not perform live ACP model switches.
   Availability dots read relay presence, never a saved deployment
   receipt or runtime status. Failed/disconnected reads are unknown; lifecycle
   actions retain their separate routing. Current exact-key Online/Away presence
   suppresses Start for an inactive local record without granting Stop authority;
   list/profile/member startup guards must not interpret Offline as proof of safe
   startup. Deletion also consumes that same exact-key availability reader:
   unknown requests shutdown when a channel exists, request failure retains the
   record, and only established Offline keeps the intentional no-request path.
   Unqueried persona siblings are unknown. No presence state grants deletion or
   Stop authority; native local stop-before-remove remains independent. See
   [the availability contract](../../../../docs/agent-availability.md).
   The shared cloud marker means “Not managed on this device” only
   after ownership and successful local inventory are known. It does not imply
   hosting location, availability, or permission. Keep all identity surfaces on
   the shared provenance context, without per-row directory subscriptions. See
   [the provenance contract](../../../../docs/agent-management-provenance.md).
14. **Thinking effort has two surfaces: a local-only WRITE control and a
   read-only two-facts DISPLAY.** The write control is `EffortPickerField`
   (`ui/EffortPickerField.tsx`), a self-contained section component mounted in
   `AgentInstanceEditDialog` beside the Model block. It is **Save-gated, not
   direct-write**: the control is fully controlled by the parent dialog
   (`value`/`onChange`) and owns no mutation. The dialog persists the selection
   by embedding `effortLevel` in the locked `update_managed_agent` IPC call, so
   the effort write is atomic with any access-policy change and can never race
   or survive a Cancel or failed Save. There is no standalone
   `persistAgentEffortLevel` setter. Its gating and option compute live in the
   pure helper `ui/effortPicker.ts` (`effortPickerState`): the picker renders
   only when `agent.backend.type === "local"` **AND** a `thought_level`
   `effortConfigId` has been discovered from the running session (absent
   pre-first-session and for runtimes/models without effort support; the
   profile hero pill additionally falls back to `lib/effortOptionsCache.ts`, a
   per-device snapshot of the last session's options keyed by harness + model,
   so the pill also renders before the first session and after a restart —
   the edit dialog stays session-gated). Local-only
   is load-bearing, not cosmetic — the Rust command rejects non-local backends
   because remote effort is set at deploy time via `policy_env`. Because the
   control reads its inputs from the config surface the dialog already fetches
   (`useAgentConfigSurface`), it integrates into the dialog's existing field
   group without additional IPC. The read-only display is the `thinkingEffort`
   normalized field rendered by `AgentConfigPanel` via `NormalizedRow`, which
   already shows both facts — `field.value` (canonical, the effort the next
   spawn will launch with) and, when a running ACP session differs,
   `field.overriddenValue` struck through (the live session's current effort).
   No component owns "configured vs current" logic; the reader's canonical tier
   ordering feeds both facts. Do not add a second effort write path or restate
   the two-facts logic in a component.

   **Second effort surface, same write path.** The owned-agent profile hero
   renders an immediate-write effort pill (`EffortQuickPicker` in
   `profile/ui/ProfileRuntimeQuickControls.tsx`). It reuses `effortPickerState`
   for gating and options, seeds its current value from the canonical
   `normalized.thinkingEffort.value`, and persists a pick by calling
   `update_managed_agent` with only `pubkey` + `effortLevel`, then invalidates
   the config surface. It is not Save-gated, but it introduces no new IPC or
   setter — the locked `update_managed_agent` field remains the only effort
   write. Keep it that way: extend `effortPickerState`, not the pill.

   **Cut invariant — live mid-conversation effort machinery was deliberately
   removed.** Effort is spawn-scoped only: the worker holds one `startup_effort`
   read from `BUZZ_ACP_EFFORT_LEVEL` and applies it once at session creation
   (`apply_startup_effort` in `buzz-acp/src/pool.rs`); there is no pool-level
   effort authority, no live effort switching, and no effort-ack frame. Do not
   reintroduce a live effort-switch RPC, a pool effort field, or a
   mid-conversation effort control without a plan ruling. The archived live-effort
   machinery lives on `archive/claude-config-gaps-live-effort` for reference only.

15. **The persona `description` is public display metadata.** It is optional,
   capped at 280 characters, and validated through the shared visible-text
   policy (`validate_agent_description_text` in `definition_validation.rs`)
   on the raw authored bytes at create/update, snapshot import, publication,
   inbound sync, and the untrusted catalog parser — rejected, never stripped.
   It is deliberately EXCLUDED from `persona_content_hash`
   (`description_change_does_not_change_content_hash`), so a description-only
   edit never flips the restart badge on linked instances. Only the AUTHORED
   description exists — there is deliberately no derived/generated fallback;
   a blank description publishes an empty kind:0 `about`, exactly as before
   the field existed. Agent and team snapshots carry the authored description
   in the member profile's `about` and validate it before import. The trim/empty
   resolution exists twice and must stay in
   sync (port changes in the same PR): `lib/agentDescription.ts`
   (`effectiveAgentDescription`) feeds display surfaces, and its Rust twin
   (`managed_agents/agent_description.rs`, `effective_agent_description` /
   `record_effective_description`) feeds the publish path, where
   `profile_needs_sync` compares `about` (None == empty) so description edits
   reconcile instead of being clobbered. Persona-linked instances do not own a
   second description copy; snapshot export materializes the definition value
   only into the portable snapshot, and a dangling link resolves no description
   rather than reviving stale instance metadata. The agents-page card face shows the
   authored description as its second line, falling back to the model label
   when none exists (`UnifiedAgentsSection.tsx` composes it;
   `AgentIdentityCard` takes a presentational `subtitle`). The community catalog
   shows the same authored description before consent: a clamped two-line list
   subtitle for scanning and the full safely wrapped value in persona detail.
   The dialog field
   lives in `ui/AgentDescriptionField.tsx` (`AgentIdentityFields`), not
   inline in the over-1000-line dialogs.

16. **Owner-only builds constrain managed runtimes, not relay-agent mentions.**
    The compiled owner-only capability applies when Desktop starts or deploys a
    managed agent. Independently operated relay agents with NIP-OA ownership
    remain eligible in every build when their verified owner's signed
    `respond_to` policy admits the viewer and relay membership includes the
    target channel at publication. Owned nonmembers may be offered for preparation
    and Invite; this is not permission to publish. Final authorization refreshes
    the exact destination and retains captured selected identities across uploads
    and edits. Denial preserves the draft, never silently removes a selected key.
    See `docs/remote-mention-routing.md`. Marked builds require that verified owner coordinate but do
    not require it to equal the viewer; OSS builds retain compatibility with
    self-authored legacy directory records. Keep native discovery and send-time
    revalidation fail closed on invalid ownership or managed policy evidence,
    and on missing membership or directory evidence; do not add a cross-owner
    clamp to either mention path. Local `agents-data-changed` events
    refresh only local persona/team/managed-agent caches; they must never
    invalidate the remote relay directory.

17. **Databricks model discovery has one shared catalog authority.** Desktop and ACP call the shared `buzz-agent` discovery library; Desktop passes the effective merged `DATABRICKS_MODEL_FILTER` explicitly, and the library applies it to raw workspace endpoint IDs and Unity Catalog model-service FQNs after the additive union. A successful filtered-empty catalog is authoritative: it stays empty, disables switching, and never falls through to configured or known-model fallback. UC FQNs retain neutral effort capabilities. A boundary-matched GPT-5-or-newer family in the service-name component selects OpenAI Responses so tools can coexist with reasoning; other FQNs use MLflow Chat Completions. Catalog/schema components never influence routing. Keep this route-only rule identical in the Rust and TypeScript capability interpreters. Global Defaults preserves the discovered model ID as the selected value while its closed trigger renders the provider-scoped display label; do not force the raw persisted ID over that label.

18. **Permission mode is an env-carried harness policy with one vocabulary
    owner.** `buzz-acp` reads `BUZZ_ACP_PERMISSION_MODE` at spawn; Desktop
    stores it as an ordinary (deliberately non-reserved) env var so the
    existing env tiers, spawn snapshot / restart badge, and create/update IPC
    carry it without a record column. `lib/permissionMode.ts` is the only
    module that knows the key and the values (ACP spelling; `buzz-acp` accepts
    them as clap aliases). Pickers offer exactly three
    (`SELECTABLE_PERMISSION_MODES`: Run everything = unset, Read-only =
    `dontAsk`, Plan only = `plan`) because buzz-acp auto-approves every
    permission prompt (`handle_permission_request` → `allow_once`), which
    collapses `default` / `acceptEdits` / `auto` into Run everything. For the
    two read-only modes the harness marks the session read-only
    (`AcpClient::set_session_read_only`) and rejects every prompt except the
    agent's own `buzz` CLI calls, so they hold even though the adapter forwards
    prompts to the harness (Claude Code's plan mode asks before writes; an
    approving client would let them through). Those
    stay parseable and render as legacy until replaced — UI reads/writes through `readPermissionMode` /
    `withPermissionMode`, never a raw string. Surfaces: `PermissionModeField`
    in the create dialog's Configurations column (persona env, definition
    tier), the instance edit dialog's Advanced section via
    `EditAgentAdvancedFields` (instance env, wins at spawn), and the profile
    hero pill, which writes the tier that agent's Edit button edits — the
    persona env for a linked agent (then propagates like the persona editor),
    the instance env otherwise — so the two surfaces never disagree. The raw env editor hides the key so the value has one owner per
    surface. Display shows the configured value, else the live session `mode`
    the config surface reports, else the harness default — never a synthesized
    per-harness guess. It is not a `KnownAcpRuntime` capability: the same
    values apply to every harness `buzz-acp` drives. A fourth, chat-level tier
    sits above all of these: the composer's Permission mode pill
    (`ComposerPermissionModePill`, shown only when the channel has a locally
    managed agent) stores a per-channel pick (`composerPermissionMode.ts`,
    localStorage) and every message sent from that channel carries it as the
    `buzz:permission-mode` tag (`PERMISSION_MODE_TAG`, appended at the
    `MessageComposer` send seam, routed by `splitOutgoingTags`, validated by the
    Tauri backend). The harness reads the tag off the owner's newest message in
    the batch, records it on its `PromptContext` per channel and applies it at
    that turn's `session/new` (rotating the session when the mode changed);
    non-owner tags are ignored. Precedence is session > instance env > persona
    env > harness default (`resolveSessionPermissionMode`). The pill's
    baseline label is the addressed (else first) local agent's configured
    mode. The override is runtime-only on the harness — it forgets it on
    restart — and is never persisted to any env tier. The harness also accepts
    an equivalent `switch_mode` observer control; the Desktop has no UI for it.

19. **Tool policy is an env-carried harness policy in Claude Code's own
    rule syntax.** `lib/toolPolicy.ts` owns `BUZZ_ACP_TOOL_POLICY`
    (`{"allow":[…],"deny":[…]}`, rules like `Write`, `Bash(git push:*)`,
    `Edit(src/**)`, `mcp__server__tool`) and validates rule shape; the raw env
    editor hides the key. Surfaces mirror the permission mode: `ToolPolicyField`
    in the create dialog's Configurations column (persona env) and the instance
    Advanced section (instance env, wins at spawn), with deny/allow lists and
    quick-add presets. buzz-acp sends the rules natively as
    `session/new` `_meta.claudeCode.options.settings.permissions` and also
    vetoes matching prompts at its permission seam; because Claude Code never
    consults the client under `bypassPermissions`, a deny-carrying policy makes
    the harness run non-read-only sessions in explicit `default` mode
    (`session_wire_mode`), so "Run everything" then means "everything not
    denied". Read-only modes stay stricter than any policy. Not a
    `KnownAcpRuntime` capability; other harnesses ignore the meta and only get
    the seam backstop.

20. **Connection (harness login vs API key) is an env-carried choice with a
    per-runtime catalog.** `lib/agentConnection.ts` owns the marker
    `BUZZ_AGENT_CONNECTION` (`api-key` | absent = subscription) and knows, per
    runtime, which env var carries the key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
    and whether the CLI needs an isolated home. Surfaces mirror the permission
    mode: `AgentConnectionField` in the create dialog's Configurations column
    (persona env) and the instance Advanced section (instance env, wins at
    spawn); the raw env editor hides both keys; the profile hero shows a
    read-only pill. The key is a plain env value on the local record, like the
    provider API keys — persona env is never published (`persona_event_content`
    carries no env). Verified facts the catalog encodes: Claude Code honours
    `ANTHROPIC_API_KEY` over a live subscription login with no approval prompt
    in SDK mode; Codex prefers its ChatGPT login, so the Tauri spawn
    (`runtime/connection.rs`) sets `CODEX_HOME=<nest>/homes/codex-api` for an
    API-key Codex agent. Readiness follows the choice: an API-key agent is
    never asked to log the CLI in (`readiness/cli_login.rs` skips the
    `claude auth status` / `codex login status` probe when the key is
    filled in, and reports the key's `env_key` gap when it is blank), so it
    starts even on a machine with no harness login. Only Claude and Codex
    are in the catalog; other runtimes render no field.

21. **Usage and cost come from archived NIP-AM turn metrics, and cost has
    two provenances that are never summed.** The profile Runtime tab's
    Usage card (`profile/ui/AgentUsageSection.tsx`) reads
    `get_agent_usage_series` through `profile/lib/useAgentUsageSeries.ts`
    with DST-safe local-midnight boundaries (`profile/lib/usageWindow.ts`).
    *Reported* cost is what the harness published (`estimatedCostUsd` —
    Claude Code prices its own turns). *Estimated* cost is
    `lib/modelPricing.ts`: the owner's rate table (built-in OpenAI defaults +
    localStorage overrides) × the tokens of per-model rows that carry a
    NIP-AM `pricingIdentity`; rows without one are "price unknown", never
    priced from the session `model` alias. The harness stamps `model` and,
    on an API-key connection, `pricingIdentity` only for Codex — Claude's
    adapter model values are aliases (`default`, `opus[1m]`). Cost is shown
    for API-key connections only; a harness login shows tokens alone.

22. **Connectors are persona-owned MCP servers carried on the env as JSON.**
    `lib/agentConnectors.ts` owns `BUZZ_ACP_MCP_SERVERS` — a JSON array of
    `{kind:"stdio", name, command, args, env}` / `{kind:"http", name, url,
    headers}` on the persona env (local-only tier, like the other env-carried
    choices, so header and env tokens never reach the relay). Edited only in
    the create/edit persona dialog (`AgentConnectorsField`); the instance
    Advanced env editor hides the key. The harness
    (`crates/buzz-acp/src/connectors.rs`) parses the same shape at spawn and
    appends the entries after the built-in dev MCP server in every
    `session/new` (`McpServerSpec`: stdio untagged, HTTP with `type`), drops
    bad entries one at a time with a warning, and rejects the built-in name,
    duplicates and `__` in names (buzz-agent's tool separator). Verified
    against the installed adapters: claude-agent-acp and codex-acp accept
    both kinds from `session/new`; buzz-agent takes stdio only, so HTTP
    connectors are skipped for it. The profile MCP section lists persona
    connectors as "From the agent's persona" rows next to the servers parsed
    from the runtime's own config file.

23. **Browser sign-ins (OAuth connectors) ride ACP URL elicitation and land
    in the channel.** The harness advertises
    `clientCapabilities.elicitation.url` and, on `elicitation/create`
    (`mode: "url"`), replies `accept` at once and posts the link to the
    session's channel as the agent (`crates/buzz-acp/src/elicitation.rs`);
    `elicitation/complete` posts a confirmation. The adapter owns the OAuth
    callback (Claude Code's localhost listener), so the Desktop needs no
    special UI — message links already open in the system browser
    (`shared/ui/markdown/ExternalLinkAnchor.tsx`). Form-mode elicitations are
    declined (no form UI). The channel is remembered per session at
    `session/new` (`note_session_channel`); a session without one only logs
    the URL.

24. **A persona's own working directory is an env-carried opt-in and a
    mini-nest that carries its Skills.** `lib/personaWorkdir.ts` owns
    `BUZZ_PERSONA_WORKDIR=own` on the persona env (local-only, hidden in the
    raw editors, restart badge via the env diff). At spawn
    (`managed_agents/persona_workdir.rs`) the Desktop renders
    `<nest>/personas/<persona-id>/` with `ensure_nest_at` — same AGENTS.md
    conventions and the built-in `buzz-cli` skill — and starts the harness
    there, so `session/new`'s `cwd` follows. Owner skills live in
    `<folder>/.agents/skills/<folder>/SKILL.md` (frontmatter `name`
    required) and are linked into every known runtime skill dir
    (`known_skill_dirs()`: `.claude/skills`, `.codex/skills`,
    `.goose/skills`) so each harness discovers them by its own convention;
    buzz-agent scans `.agents/skills` directly. The `buzz-cli` name is
    reserved. The Skills panel (`PersonaWorkdirField`) lists, imports (OS
    folder picker → copy + link) and removes skills for a saved persona;
    the create dialog shows only the choice. Unix only for links (the nest
    has the same limit).

25. **Prompt-cache timers are estimates fed by archived turn metrics.** The
    harness stamps NIP-AM `contextTokens` from the adapter's
    `usage_update.used` (context occupancy — `turn.inputTokens` sums every
    model call in a turn, so it is not the context size).
    `get_channel_cache_heads` (`archive/cache_heads.rs`) returns the latest
    metric per (channel, agent); `lib/useChannelCacheHeads.ts` keeps the one
    from an agent managed here; `lib/cacheTimer.ts` turns it into a countdown
    from the end of that turn. The lifetime is a per-profile, owner-editable
    estimate (Claude subscription 60 min, Claude API key 5, Codex 5) because
    providers guarantee none, sessions under `minContextTokens` show nothing,
    and the miss penalty is priced only for API-key connections — for Claude
    from the turn's own reported cost (Anthropic's fixed multipliers, write
    tier following the TTL), for Codex from the rate table. The ring
    (`sidebar/ui/ChannelCacheTimer.tsx`) hides while the agent is working and
    its tooltip says not to ping just to keep a cache warm.

## Channel-only runtime controls

Desktop observer controls identify a channel, not a thread session. The harness
rejects `cancel_turn`, `switch_model`, and `switch_mode` with `ambiguous_target`
when that channel has multiple known session scopes, including retained idle
scopes. Do not treat that result as success or a deferred switch. Stop feedback waits for the
harness result matching the control type, channel, and request ID; relay delivery
alone does not prove that a turn was signalled. A missing result is unconfirmed,
not success. The activity pane must use its resolved `sessionChannelId` for
both the outgoing control and result correlation, even without a loaded
`Channel` object. Stop is unavailable in an unscoped all-channel pane.

Per-thread observer controls remain a separate protocol/UI change. Do not tell
users to type `!cancel` beside an inline mention: the owner command requires
kind 9, body exactly `!cancel` after trimming, and the agent's separate `p` tag.
The automatic-mention picker also inserts literal `@Name` into the body, so it
does not provide an exact-command workaround. The UI must state this limitation
rather than offer an ineffective command. An authorized owner can instead use
the CLI with the channel and target thread root:

```sh
buzz messages send --channel <channel-id> --reply-to <thread-root-id> \
  --mention <agent-pubkey> --content '!cancel'
```

## The tests that enforce this

- `lib/agentConfigCore.test.mjs` — field model per harness × scope, clearing
  policy. Update when the capability model changes.
- `ui/agentConfigFieldsContract.test.mjs` — canonical behaviors + disclosure
  presets + `shouldShowModelStatusMessage` status-bypass +
  `shouldRenderModelControl` (successful-empty omit vs failure keep). If this
  fails, you probably reintroduced a per-surface flag or conflated empty with
  failed discovery.
- `ui/usePersonaModelDiscovery.test.mjs` — `synthesizeEmptyDiscoveryStatus`,
  `isCacheableDiscoveryResponse`, `deriveModelDiscoveryPending`,
  `isSuccessfulEmptyDiscovery`. If the "reopen to retry" copy becomes inert
  again, these tests will catch it.
- `ui/respondToFieldContract.test.mjs` — plain-language mode labels, the
  persistent warning contract for shared agent access, and its two render
  positions (after the people picker for `allowlist`).
- `lib/agentAccessWarning.test.mjs` — every mode × run-location copy variant
  plus both resolvers, including unknown-reads-as-local and
  blank-`runOn`-is-not-a-provider.
- `lib/personaCatalogRelay.test.mjs` and
  `ui/personaCatalogOwnerLabel.test.mjs` — reject invisible definition text
  and keep Markdown concealment syntax literal in the review surface.
- `../profile/ui/UserProfileRuntimeContent.test.mjs` — profile runtime panels
  cannot reintroduce build-mode previews or synthetic fallback controls.
- `desktop/tests/e2e/profile.spec.ts` — the owned-agent parity flow compares
  every profile tab when opened from Agents and from the agent's DM.
- `ui/AgentConfigPanelPresentation.test.mjs` — shared profile/agent config rows
  show only effective values, with an em dash for unknown values.
- `ui/effortPicker.test.mjs` — `effortPickerState` gating (local + discovered
  `effortConfigId` renders; provider backend or missing configId hides) and
  option/preselect compute, plus `effortSelectionToPersistedValue` sentinel →
  null. This is where the v4 provider regression is pinned: the write control
  must never render for a provider backend.
- `desktop/tests/e2e/onboarding-agent-defaults.spec.ts` — onboarding behavior
  acceptance coverage for readiness, failure states, defaults, session-draft
  restoration, zero-write Skip, Next save failure/retry, navigation, and
  successful-empty vs failed optional-model discovery.
- `desktop/tests/e2e/agents.spec.ts` — community catalog descriptions remain
  visible in the list and full detail before Add agent, including long
  unbroken Unicode text without horizontal overflow.
- `lib/agentDescription.test.mjs` — authored-description resolution: trim,
  blank/missing → null.
- Rust: `runtime_metadata_env_vars` tests pin spawn-time key application.
- Rust: persona sharing/retention tests pin relay+owner scoping, durable
  enqueue errors, relay rejection/unavailability, and accepted publication.
- Rust: `definition_validation` and inbound persona tests pin the shared
  Unicode/control-character policy at local, import, publish, and sync gates.

## Keep this file true

**If you change how agent configuration is modeled, rendered, persisted,
applied, or cleared — update this file in the same PR.** A rule that no longer
matches the code is worse than no rule; a new pattern that isn't written down
here will be broken by the next agent that never learns it existed. Reviewers:
treat a config-behavior diff without a matching AGENTS.md diff (or an explicit
"no rules changed" note) as incomplete.
