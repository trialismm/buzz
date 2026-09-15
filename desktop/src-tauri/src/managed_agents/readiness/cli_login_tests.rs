//! `cli_login::requirements` integration tests: binary resolution, the
//! login probe, the API-key connection override, and the codex adapter
//! version gate. Split out of `readiness.rs` to keep that file within the
//! repository size gate; the helpers here run the test binary itself as a
//! portable stand-in for an installed CLI.

use super::*;

// ── cli_login_requirements: resolve_command integration ─────────────

/// Construct a minimal `KnownAcpRuntime` stub for testing cli_login_requirements.
/// `commands` are the adapter binaries; `underlying_cli` is the CLI name.
fn make_cli_runtime(
    commands: &'static [&'static str],
    underlying_cli: Option<&'static str>,
) -> KnownAcpRuntime {
    KnownAcpRuntime {
        id: "test-cli-runtime",
        label: "Test CLI",
        commands,
        aliases: &[],
        avatar_url: "",
        mcp_command: None,
        mcp_hooks: false,
        underlying_cli,
        cli_install_commands: &[],
        cli_install_commands_windows: &[],
        adapter_install_commands: &[],
        cli_install_instructions_url: "",
        adapter_install_instructions_url: "",
        cli_install_hint: "",
        adapter_install_hint: "",
        skill_dir: None,
        supports_acp_model_switching: false,
        config_file_path: None,
        config_file_format: None,
        model_env_var: None,
        provider_env_var: None,
        provider_locked: false,
        default_env: &[],
        supports_acp_native_config: false,
        thinking_env_var: None,
        effort_normalization: None,
        effort_accepted_values: None,
        max_tokens_env_var: None,
        context_limit_env_var: None,
        max_rounds_env_var: None,
        required_normalized_fields: &[],
        login_hint: None,
        auth_probe_args: None,
    }
}

/// Returns the absolute path of the currently-running test binary as a `&'static str`.
/// Host-portable stand-in for a "present" binary: absolute path so `find_command` resolves
/// it via `path.exists()`. Leaked allocation is intentional — process exits after tests.
fn present_binary_str() -> &'static str {
    let path = std::env::current_exe().expect("current_exe must be available in tests");
    Box::leak(path.to_string_lossy().into_owned().into_boxed_str())
}

/// Leak a runtime slice of `'static` strs for use in `make_cli_runtime`.
fn static_commands(commands: Vec<&'static str>) -> &'static [&'static str] {
    Box::leak(commands.into_boxed_slice())
}

#[test]
fn cli_login_requirements_missing_binary_is_not_ready() {
    // Both adapter and underlying CLI are nonexistent → NotInstalled state
    // → must return a CliLogin requirement with availability=NotInstalled.
    let rt = make_cli_runtime(
        &["__buzz_nonexistent_adapter_abc123__"],
        Some("__buzz_nonexistent_cli_abc123__"),
    );
    let reqs = cli_login::requirements(
        &["__buzz_nonexistent_binary_abc123__", "status"],
        "install the tool first",
        &rt,
        None,
    );
    assert!(
        !reqs.is_empty(),
        "missing binary must produce a CliLogin requirement (NotReady)"
    );
    assert!(
        matches!(reqs[0], Requirement::CliLogin { .. }),
        "requirement must be CliLogin; got {:?}",
        reqs[0]
    );
    if let Requirement::CliLogin {
        ref availability, ..
    } = reqs[0]
    {
        assert_eq!(
            *availability,
            crate::managed_agents::AcpAvailabilityStatus::NotInstalled,
            "both missing → NotInstalled"
        );
    }
}

#[test]
fn cli_login_requirements_adapter_missing_emits_adapter_missing() {
    // Underlying CLI present (use the running test binary as a portable
    // stand-in — it's always present and resolves via absolute path),
    // adapter absent.
    // → AdapterMissing state → no probe run → CliLogin{AdapterMissing}.
    let exe = present_binary_str();
    let rt = make_cli_runtime(&["__buzz_nonexistent_adapter_xyz789__"], Some(exe));
    let reqs = cli_login::requirements(&[exe, "--list"], "install the adapter", &rt, None);
    assert!(
        !reqs.is_empty(),
        "adapter missing must produce a CliLogin requirement"
    );
    if let Requirement::CliLogin {
        ref availability, ..
    } = reqs[0]
    {
        assert_eq!(
            *availability,
            crate::managed_agents::AcpAvailabilityStatus::AdapterMissing,
            "adapter absent, CLI present → AdapterMissing"
        );
    }
}

#[test]
fn cli_login_requirements_cli_missing_emits_cli_missing() {
    // Adapter present (use the running test binary as a portable stand-in),
    // underlying CLI absent.
    // → CliMissing state → no probe run → CliLogin{CliMissing}.
    let exe = present_binary_str();
    let rt = make_cli_runtime(
        static_commands(vec![exe]),              // adapter found via absolute path
        Some("__buzz_nonexistent_cli_abc123__"), // underlying CLI missing
    );
    let reqs = cli_login::requirements(&[exe, "--list"], "install the CLI", &rt, None);
    assert!(
        !reqs.is_empty(),
        "CLI missing must produce a CliLogin requirement"
    );
    if let Requirement::CliLogin {
        ref availability, ..
    } = reqs[0]
    {
        assert_eq!(
            *availability,
            crate::managed_agents::AcpAvailabilityStatus::CliMissing,
            "adapter present, CLI absent → CliMissing"
        );
    }
}

#[test]
fn cli_login_requirements_resolvable_binary_runs_probe_at_resolved_path() {
    // Both adapter and CLI present (use the running test binary as a
    // portable stand-in — always present, resolves via absolute path),
    // probe exits 0 (run with `--list` which lists tests and exits 0).
    // → logged_in = true → requirements is empty (Ready).
    let exe = present_binary_str();
    let rt = make_cli_runtime(static_commands(vec![exe]), Some(exe));
    let reqs = cli_login::requirements(
        &[exe, "--list"],
        "this should not show (probe exits 0)",
        &rt,
        None,
    );
    assert!(
        reqs.is_empty(),
        "expected Ready (no requirements) when probe binary resolves and exits 0; \
         got {:?}",
        reqs
    );
}

#[test]
fn cli_login_requirements_logged_out_emits_available() {
    // Both adapter and CLI present, but probe exits non-zero (logged out).
    // Use the test binary with an unrecognized argument as the probe —
    // libtest exits non-zero for unknown flags on all platforms.
    // → CliLogin{Available} (tooling installed, needs login).
    let exe = present_binary_str();
    let rt = make_cli_runtime(static_commands(vec![exe]), Some(exe));
    let reqs = cli_login::requirements(
        &[exe, "--buzz-probe-fail-xyz"],
        "run `tool login`",
        &rt,
        None,
    );
    assert!(
        !reqs.is_empty(),
        "non-zero probe must produce a CliLogin requirement (logged out)"
    );
    if let Requirement::CliLogin {
        ref availability, ..
    } = reqs[0]
    {
        assert_eq!(
            *availability,
            crate::managed_agents::AcpAvailabilityStatus::Available,
            "tooling installed, probe fails → Available (logged-out)"
        );
    }
}

#[test]
fn cli_login_requirements_api_key_connection_never_asks_for_login() {
    // Same logged-out probe as above, but the agent's Connection is an
    // API key: a filled-in key is Ready, a blank one is the key's EnvKey
    // gap — the login probe is not consulted either way.
    use crate::managed_agents::runtime::connection::ApiKeyState;
    let exe = present_binary_str();
    let rt = make_cli_runtime(static_commands(vec![exe]), Some(exe));
    let probe = [exe, "--buzz-probe-fail-xyz"];
    let filled = cli_login::requirements(
        &probe,
        "run `tool login`",
        &rt,
        Some(ApiKeyState {
            key: "ANTHROPIC_API_KEY",
            present: true,
        }),
    );
    assert!(
        filled.is_empty(),
        "API-key agent with a key must be Ready despite a logged-out CLI; got {filled:?}"
    );
    let blank = cli_login::requirements(
        &probe,
        "run `tool login`",
        &rt,
        Some(ApiKeyState {
            key: "ANTHROPIC_API_KEY",
            present: false,
        }),
    );
    assert_eq!(
        blank,
        vec![Requirement::EnvKey {
            key: "ANTHROPIC_API_KEY".to_string()
        }],
        "a blank key routes to the key field, not to CLI login"
    );
}

// ── codex readiness version gate ───────────────────────────────────────

/// Build a minimal `KnownAcpRuntime` for testing the codex version gate.
/// `adapter_commands` are the exact strings passed to `find_command` — use
/// `&["codex-acp"]` when the binary is on PATH, or `&[<absolute_path>]`
/// when resolving via absolute path.  `underlying_cli` is a portable
/// stand-in so the adapter is not misclassified as `CliMissing`.
fn make_codex_runtime(
    adapter_commands: &'static [&'static str],
    underlying_cli: Option<&'static str>,
) -> KnownAcpRuntime {
    KnownAcpRuntime {
        id: "codex",
        label: "Codex",
        commands: adapter_commands,
        aliases: &[],
        avatar_url: "",
        mcp_command: None,
        mcp_hooks: false,
        underlying_cli,
        cli_install_commands: &[],
        cli_install_commands_windows: &[],
        adapter_install_commands: &[],
        cli_install_instructions_url: "",
        adapter_install_instructions_url: "",
        cli_install_hint: "",
        adapter_install_hint: "",
        skill_dir: None,
        supports_acp_model_switching: false,
        config_file_path: None,
        config_file_format: None,
        model_env_var: None,
        provider_env_var: None,
        provider_locked: false,
        default_env: &[],
        supports_acp_native_config: false,
        thinking_env_var: None,
        effort_normalization: None,
        effort_accepted_values: None,
        max_tokens_env_var: None,
        context_limit_env_var: None,
        max_rounds_env_var: None,
        required_normalized_fields: &[],
        login_hint: None,
        auth_probe_args: None,
    }
}

/// Build a temp dir containing a `codex-acp` script with the given body,
/// prepend it to PATH, and clear the resolve cache.  Returns the temp dir
/// and the original PATH string for restoration.
#[cfg(unix)]
fn setup_temp_codex_acp(script_body: &str) -> (tempfile::TempDir, String) {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().expect("create temp dir");
    let bin = dir.path().join("codex-acp");
    std::fs::write(&bin, script_body).expect("write script");
    std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).expect("chmod script");

    let original_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", dir.path().display(), original_path);
    std::env::set_var("PATH", &new_path);
    crate::managed_agents::clear_resolve_cache();

    (dir, original_path)
}

#[cfg(unix)]
fn leaked_adapter_commands(bin: &std::path::Path) -> &'static [&'static str] {
    let command = Box::leak(bin.display().to_string().into_boxed_str());
    Box::leak(vec![command as &'static str].into_boxed_slice())
}

/// Restore PATH and clear the resolve cache after a PATH-mutating test.
#[cfg(unix)]
fn restore_path(original: &str) {
    std::env::set_var("PATH", original);
    crate::managed_agents::clear_resolve_cache();
}

/// Codex readiness: outdated adapter (exits non-zero) → AdapterOutdated,
/// login probe skipped.
#[cfg(unix)]
#[test]
fn cli_login_requirements_codex_outdated_adapter_emits_adapter_outdated() {
    let _guard = crate::managed_agents::lock_path_mutex();

    let (dir, orig) = setup_temp_codex_acp("#!/bin/sh\nexit 1\n");
    let exe = present_binary_str();
    // Use the fixture's absolute adapter path here. Bare `codex-acp`
    // intentionally prefers Buzz's managed npm shim when it exists, which
    // would make this version-gate regression test depend on machine state.
    let rt = make_codex_runtime(
        leaked_adapter_commands(&dir.path().join("codex-acp")),
        Some(exe),
    );
    let reqs = cli_login::requirements(
        &[exe, "--buzz-probe-must-not-run-xyz"],
        "run `codex login`",
        &rt,
        None,
    );

    restore_path(&orig);
    drop(dir);

    assert!(
        !reqs.is_empty(),
        "outdated codex adapter must produce a requirement; got {reqs:?}"
    );
    if let Requirement::CliLogin {
        ref availability, ..
    } = reqs[0]
    {
        assert_eq!(
            *availability,
            crate::managed_agents::AcpAvailabilityStatus::AdapterOutdated,
            "0.x codex adapter must yield AdapterOutdated; got {availability:?}"
        );
    } else {
        panic!("expected CliLogin requirement; got {:?}", reqs[0]);
    }
}

/// Codex readiness: adapter exits 0 but output is not a parseable version
/// → AdapterOutdated (garbage output treated as outdated, same as non-zero).
#[cfg(unix)]
#[test]
fn cli_login_requirements_codex_garbage_version_output_emits_adapter_outdated() {
    let _guard = crate::managed_agents::lock_path_mutex();

    let (dir, orig) = setup_temp_codex_acp("#!/bin/sh\necho 'not a version string'\nexit 0\n");
    let exe = present_binary_str();
    let rt = make_codex_runtime(
        leaked_adapter_commands(&dir.path().join("codex-acp")),
        Some(exe),
    );
    let reqs = cli_login::requirements(
        &[exe, "--buzz-probe-must-not-run-xyz"],
        "run `codex login`",
        &rt,
        None,
    );

    restore_path(&orig);
    drop(dir);

    assert!(
        !reqs.is_empty(),
        "garbage version output must produce a requirement; got {reqs:?}"
    );
    if let Requirement::CliLogin {
        ref availability, ..
    } = reqs[0]
    {
        assert_eq!(
            *availability,
            crate::managed_agents::AcpAvailabilityStatus::AdapterOutdated,
            "unparseable version output must yield AdapterOutdated; got {availability:?}"
        );
    } else {
        panic!("expected CliLogin requirement; got {:?}", reqs[0]);
    }
}

// ── codex tests ───────────────────────────────────────────────────────

#[test]
fn codex_not_ready_copy_does_not_mention_openai_api_key() {
    // codex uses its own credential store via `codex login` (OAuth or API key).
    // The nudge copy must NOT say "set OPENAI_API_KEY".
    // Use a not-installed runtime so the requirement is always emitted
    // regardless of whether codex is on the test machine's PATH.
    let rt = make_cli_runtime(&["__buzz_nonexistent_adapter_xyz789__"], None);
    let reqs = cli_login::requirements(
        &["codex", "login", "status"],
        "run `codex login`",
        &rt,
        None,
    );
    // Whether codex is installed or not, the copy (if any) must not mention OPENAI_API_KEY.
    for req in &reqs {
        if let Requirement::CliLogin { setup_copy, .. } = req {
            assert!(
                !setup_copy.contains("OPENAI_API_KEY"),
                "codex nudge copy must not mention OPENAI_API_KEY; got: {setup_copy:?}"
            );
            assert!(
                setup_copy.contains("codex login"),
                "codex nudge copy should mention `codex login`; got: {setup_copy:?}"
            );
        }
    }
}
