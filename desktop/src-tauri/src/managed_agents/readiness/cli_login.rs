use std::path::Path;

use crate::managed_agents::{
    discovery::{
        classify_runtime, codex_adapter_availability, find_command, resolve_command,
        KnownAcpRuntime,
    },
    runtime::connection::ApiKeyState,
    AcpAvailabilityStatus,
};

use super::{cli_probe, Requirement};

/// Requirements for CLI-login runtimes (claude, codex).
///
/// `api_key` is the agent's Connection choice (see
/// `runtime::connection::api_key_state`): an API-key agent is never asked to
/// log the CLI in — the key is its credential — so the login probe is skipped
/// and a blank key surfaces as an `EnvKey` gap instead. The install checks
/// still apply either way.
pub(super) fn requirements(
    probe_args: &[&str],
    setup_copy: &str,
    runtime: &KnownAcpRuntime,
    api_key: Option<ApiKeyState>,
) -> Vec<Requirement> {
    let adapter_result = runtime
        .commands
        .iter()
        .find_map(|cmd| find_command(cmd).map(|path| (*cmd, path)));
    let underlying_cli_found = runtime
        .underlying_cli
        .map(|cli| find_command(cli).is_some())
        .unwrap_or(false);

    let (availability, _cmd, adapter_path) =
        classify_runtime(adapter_result, runtime.underlying_cli, underlying_cli_found);
    let availability = if runtime.id == "codex" && availability == AcpAvailabilityStatus::Available
    {
        adapter_path
            .as_deref()
            .map(|path| codex_adapter_availability(Path::new(path)))
            .unwrap_or(availability)
    } else {
        availability
    };

    match availability {
        AcpAvailabilityStatus::Available => {
            if let Some(reqs) = api_key_requirements(api_key) {
                return reqs;
            }
            let Some(binary_path) = resolve_command(probe_args[0]) else {
                return vec![missing_requirement(
                    probe_args,
                    setup_copy,
                    AcpAvailabilityStatus::Available,
                )];
            };
            let augmented_path = cli_probe::augmented_path();
            match cli_probe::login_probe(&binary_path, probe_args, augmented_path.as_deref()) {
                cli_probe::ProbeOutcome::LoggedIn => vec![],
                cli_probe::ProbeOutcome::LoggedOut => vec![missing_requirement(
                    probe_args,
                    setup_copy,
                    AcpAvailabilityStatus::Available,
                )],
                cli_probe::ProbeOutcome::ConfigInvalid { stderr_excerpt } => {
                    vec![Requirement::CliConfigInvalid {
                        probe_args: probe_args.iter().map(|value| value.to_string()).collect(),
                        setup_copy: setup_copy.to_string(),
                        diagnostic: stderr_excerpt,
                    }]
                }
            }
        }
        other => vec![missing_requirement(probe_args, setup_copy, other)],
    }
}

/// The verdict an API-key connection replaces the login probe with:
/// `None` for login agents (probe as usual), an empty list when the key is
/// filled in, and the key's `EnvKey` gap when it is blank.
fn api_key_requirements(api_key: Option<ApiKeyState>) -> Option<Vec<Requirement>> {
    let state = api_key?;
    Some(if state.present {
        vec![]
    } else {
        vec![Requirement::EnvKey {
            key: state.key.to_string(),
        }]
    })
}

fn missing_requirement(
    probe_args: &[&str],
    setup_copy: &str,
    availability: AcpAvailabilityStatus,
) -> Requirement {
    Requirement::CliLogin {
        probe_args: probe_args.iter().map(|value| value.to_string()).collect(),
        setup_copy: setup_copy.to_string(),
        availability,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_agents_keep_the_probe_and_api_key_agents_skip_it() {
        assert_eq!(api_key_requirements(None), None);
        assert_eq!(
            api_key_requirements(Some(ApiKeyState {
                key: "ANTHROPIC_API_KEY",
                present: true
            })),
            Some(vec![])
        );
        assert_eq!(
            api_key_requirements(Some(ApiKeyState {
                key: "OPENAI_API_KEY",
                present: false
            })),
            Some(vec![Requirement::EnvKey {
                key: "OPENAI_API_KEY".to_string()
            }])
        );
    }
}
