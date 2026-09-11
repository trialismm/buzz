import * as React from "react";
import {
  addToolRules,
  parseToolRules,
  readToolPolicy,
  TOOL_POLICY_PRESETS,
  withToolPolicy,
} from "@/features/agents/lib/toolPolicy";
import { cn } from "@/shared/lib/cn";
import { Textarea } from "@/shared/ui/textarea";
import {
  PERSONA_FIELD_CONTROL_CLASS,
  PERSONA_FIELD_SHELL_CLASS,
  PERSONA_LABEL_OPTIONAL_CLASS,
} from "./agentConfigOptions";
import type { EnvVarsValue } from "./EnvVarsEditor";

/**
 * Tool policy editor bound to an env map (see `lib/toolPolicy.ts`): deny and
 * allow rules in Claude Code's `Tool` / `Tool(specifier)` syntax, one per
 * line, plus quick-add presets. Deny rules win; the harness enforces them
 * even under Run everything. The create dialog binds it to the persona's env,
 * the edit dialog to the instance's env, which wins at spawn.
 */
export function ToolPolicyField({
  disabled,
  envVars,
  id,
  onEnvVarsChange,
}: {
  disabled?: boolean;
  envVars: EnvVarsValue;
  id: string;
  onEnvVarsChange: (next: EnvVarsValue) => void;
}) {
  const policy = readToolPolicy(envVars);
  // Text is local state so a half-typed rule doesn't get dropped by the
  // validator mid-keystroke; the env only holds the valid rules.
  const [denyText, setDenyText] = React.useState(policy.deny.join("\n"));
  const [allowText, setAllowText] = React.useState(policy.allow.join("\n"));
  const denyParsed = parseToolRules(denyText);
  const allowParsed = parseToolRules(allowText);

  const commit = (deny: string[], allow: string[]) => {
    onEnvVarsChange(withToolPolicy(envVars, { deny, allow }));
  };
  const applyPreset = (rules: readonly string[]) => {
    const deny = addToolRules(denyParsed.rules, rules);
    setDenyText(deny.join("\n"));
    commit(deny, allowParsed.rules);
  };

  return (
    <div className="space-y-2">
      <div>
        <span className="text-sm font-medium text-foreground">
          Tool policy
          <span className={PERSONA_LABEL_OPTIONAL_CLASS}>Optional</span>
        </span>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Claude Code permission rules, one per line: <code>Write</code>,{" "}
          <code>Bash(git push:*)</code>, <code>Edit(src/**)</code>. Deny wins
          and holds even under Run everything.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TOOL_POLICY_PRESETS.map((preset) => {
          const applied = preset.deny.every((rule) =>
            denyParsed.rules.includes(rule),
          );
          return (
            <button
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                applied
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              data-testid={`tool-policy-preset-${preset.label.toLowerCase().replace(/\s+/g, "-")}`}
              disabled={disabled || applied}
              key={preset.label}
              onClick={() => applyPreset(preset.deny)}
              title={preset.description}
              type="button"
            >
              + {preset.label}
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <RuleList
          disabled={disabled}
          id={`${id}-deny`}
          invalid={denyParsed.invalid}
          label="Deny"
          onChange={(text) => {
            setDenyText(text);
            commit(parseToolRules(text).rules, allowParsed.rules);
          }}
          placeholder={"Write\nBash(git push:*)"}
          value={denyText}
        />
        <RuleList
          disabled={disabled}
          id={`${id}-allow`}
          invalid={allowParsed.invalid}
          label="Allow"
          onChange={(text) => {
            setAllowText(text);
            commit(denyParsed.rules, parseToolRules(text).rules);
          }}
          placeholder={"Bash(pnpm test:*)"}
          value={allowText}
        />
      </div>
    </div>
  );
}

function RuleList({
  disabled,
  id,
  invalid,
  label,
  onChange,
  placeholder,
  value,
}: {
  disabled?: boolean;
  id: string;
  invalid: string[];
  label: string;
  onChange: (text: string) => void;
  placeholder: string;
  value: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <div className={PERSONA_FIELD_SHELL_CLASS}>
        <Textarea
          aria-describedby={invalid.length > 0 ? errorId : undefined}
          aria-invalid={invalid.length > 0 || undefined}
          className={cn(
            "min-h-20 resize-y px-3 py-2 font-mono text-xs leading-5",
            PERSONA_FIELD_CONTROL_CLASS,
          )}
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          value={value}
        />
      </div>
      {invalid.length > 0 ? (
        <p className="text-xs text-destructive" id={errorId}>
          Not a rule (ignored): {invalid.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
