import * as React from "react";

import {
  CACHE_PROFILE_LABELS,
  type CacheProfile,
  setCacheTimerSettings,
  useCacheTimerSettings,
} from "@/features/agents/lib/cacheTimer";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { SettingsOptionRow } from "./SettingsOptionGroup";

const PROFILES = Object.keys(CACHE_PROFILE_LABELS) as CacheProfile[];

/**
 * Appearance rows for the sidebar's prompt-cache timers: on/off, and the
 * estimated cache lifetime per connection (providers publish no guarantee,
 * so the owner can correct the estimates).
 */
export function CacheTimerSettingsRows() {
  const settings = useCacheTimerSettings();
  const idPrefix = React.useId();
  return (
    <>
      <SettingsOptionRow data-testid="cache-timer-row">
        <div className="min-w-0">
          <label className="text-sm font-medium" htmlFor={`${idPrefix}-switch`}>
            Prompt cache timers
          </label>
          <p
            className="text-sm font-normal text-muted-foreground/70"
            data-settings-subcopy
          >
            A countdown on sidebar rows from your agent's last turn: while it
            runs, the next turn re-reads the context at about a tenth of the
            price. Shown for sessions above{" "}
            {new Intl.NumberFormat().format(settings.minContextTokens)} tokens.
          </p>
        </div>
        <Switch
          checked={settings.enabled}
          data-testid="cache-timer-toggle"
          id={`${idPrefix}-switch`}
          onCheckedChange={(enabled) =>
            setCacheTimerSettings({ ...settings, enabled })
          }
        />
      </SettingsOptionRow>
      {settings.enabled ? (
        <SettingsOptionRow data-testid="cache-timer-ttl-row">
          <div className="min-w-0">
            <p className="text-sm font-medium">Cache lifetime (minutes)</p>
            <p
              className="text-sm font-normal text-muted-foreground/70"
              data-settings-subcopy
            >
              Estimates — adjust them if your turns hit or miss the cache sooner
              than the timer says.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PROFILES.map((profile) => (
              <div className="space-y-1" key={profile}>
                <label
                  className="block text-xs text-muted-foreground"
                  htmlFor={`${idPrefix}-${profile}`}
                >
                  {CACHE_PROFILE_LABELS[profile]}
                </label>
                <Input
                  className="h-8 w-24"
                  id={`${idPrefix}-${profile}`}
                  inputMode="numeric"
                  min={1}
                  onChange={(event) => {
                    const minutes = Number(event.target.value);
                    if (!Number.isFinite(minutes) || minutes <= 0) return;
                    setCacheTimerSettings({
                      ...settings,
                      ttlMinutes: {
                        ...settings.ttlMinutes,
                        [profile]: minutes,
                      },
                    });
                  }}
                  type="number"
                  value={settings.ttlMinutes[profile]}
                />
              </div>
            ))}
          </div>
        </SettingsOptionRow>
      ) : null}
    </>
  );
}
