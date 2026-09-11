import {
  HARNESS_DEFAULT_PERMISSION_MODE,
  type PermissionMode,
  readPermissionMode,
} from "@/features/agents/lib/permissionMode";

/**
 * Chat-level (session) permission tier, mirroring what the harness resolves
 * for a channel: the composer's per-channel pick (sent as the
 * `buzz:permission-mode` tag), else the instance env, else the persona env,
 * else the harness default. `live` is the session `mode` the config surface
 * last captured; it only speaks when nothing is configured because it may
 * describe another channel's session.
 */
export function resolveSessionPermissionMode({
  override,
  instanceEnv,
  personaEnv,
  live,
}: {
  override: PermissionMode | null;
  instanceEnv: Record<string, string> | null | undefined;
  personaEnv: Record<string, string> | null | undefined;
  live: PermissionMode | null;
}): {
  mode: PermissionMode;
  source: "session" | "instance" | "persona" | "live" | "default";
} {
  if (override) return { mode: override, source: "session" };
  const instance = readPermissionMode(instanceEnv ?? {});
  if (instance) return { mode: instance, source: "instance" };
  const persona = readPermissionMode(personaEnv ?? {});
  if (persona) return { mode: persona, source: "persona" };
  if (live) return { mode: live, source: "live" };
  return { mode: HARNESS_DEFAULT_PERMISSION_MODE, source: "default" };
}
