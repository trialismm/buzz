import { Globe, Pencil, Plus, Terminal, Trash2 } from "lucide-react";
import * as React from "react";

import {
  type AgentConnector,
  CONNECTOR_KIND_LABELS,
  type ConnectorKind,
  connectorErrors,
  connectorTarget,
  formatArgs,
  formatKeyValueLines,
  parseArgs,
  parseKeyValueLines,
  readAgentConnectors,
  withAgentConnectors,
} from "@/features/agents/lib/agentConnectors";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  PERSONA_FIELD_CONTROL_CLASS,
  PERSONA_FIELD_SHELL_CLASS,
  PERSONA_LABEL_OPTIONAL_CLASS,
} from "./agentConfigOptions";
import type { EnvVarsValue } from "./EnvVarsEditor";

/**
 * Connectors editor bound to the persona env (see `lib/agentConnectors.ts`):
 * MCP servers every session of this agent gets. Each entry is a local
 * command (stdio) or an HTTP server; env values and headers are shown masked
 * in the list and in full only while editing.
 */
export function AgentConnectorsField({
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
  const connectors = readAgentConnectors(envVars);
  // `null` = list view; a number = editing that index; -1 = adding.
  const [editing, setEditing] = React.useState<number | null>(null);

  const commit = (next: AgentConnector[]) => {
    onEnvVarsChange(withAgentConnectors(envVars, next));
  };
  const remove = (index: number) => {
    commit(connectors.filter((_, i) => i !== index));
  };
  const save = (connector: AgentConnector) => {
    const next =
      editing === null || editing < 0
        ? [...connectors, connector]
        : connectors.map((c, i) => (i === editing ? connector : c));
    commit(next);
    setEditing(null);
  };

  return (
    <div className="space-y-2" data-testid={id}>
      <div>
        <span className="text-sm font-medium text-foreground">
          Connectors
          <span className={PERSONA_LABEL_OPTIONAL_CLASS}>Optional</span>
        </span>
        <p className="mt-0.5 text-xs text-muted-foreground">
          MCP servers every session of this agent can use — a local command or
          an HTTP server. Stored on this device only. Codex and Claude Code take
          both kinds; buzz-agent takes local commands.
        </p>
      </div>
      {connectors.length > 0 ? (
        <ul className="divide-y divide-border/55 rounded-lg border border-border/60">
          {connectors.map((connector, index) =>
            editing === index ? (
              <li className="p-3" key={`${connector.name}-edit`}>
                <ConnectorForm
                  disabled={disabled}
                  id={`${id}-edit`}
                  initial={connector}
                  onCancel={() => setEditing(null)}
                  onSave={save}
                  taken={connectors
                    .filter((_, i) => i !== index)
                    .map((c) => c.name)}
                />
              </li>
            ) : (
              <li
                className="flex items-center gap-3 px-3 py-2"
                data-testid={`${id}-row-${connector.name}`}
                key={connector.name}
              >
                {connector.kind === "http" ? (
                  <Globe
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                ) : (
                  <Terminal
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {connector.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {CONNECTOR_KIND_LABELS[connector.kind]}
                    </span>
                  </span>
                  <span
                    className="block truncate font-mono text-xs text-muted-foreground/70"
                    title={connectorTarget(connector)}
                  >
                    {connectorTarget(connector)}
                    {secretCount(connector) > 0
                      ? ` · ${secretCount(connector)} ${connector.kind === "http" ? "header" : "env"}${secretCount(connector) === 1 ? "" : "s"} ••••`
                      : ""}
                  </span>
                </span>
                <Button
                  aria-label={`Edit connector ${connector.name}`}
                  disabled={disabled || editing !== null}
                  onClick={() => setEditing(index)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  aria-label={`Remove connector ${connector.name}`}
                  disabled={disabled || editing !== null}
                  onClick={() => remove(index)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ),
          )}
        </ul>
      ) : null}
      {editing === -1 ? (
        <div className="rounded-lg border border-border/60 p-3">
          <ConnectorForm
            disabled={disabled}
            id={`${id}-new`}
            initial={null}
            onCancel={() => setEditing(null)}
            onSave={save}
            taken={connectors.map((c) => c.name)}
          />
        </div>
      ) : (
        <Button
          data-testid={`${id}-add`}
          disabled={disabled || editing !== null}
          onClick={() => setEditing(-1)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Add connector
        </Button>
      )}
    </div>
  );
}

function secretCount(connector: AgentConnector): number {
  return Object.keys(
    connector.kind === "http" ? connector.headers : connector.env,
  ).length;
}

type Draft = {
  kind: ConnectorKind;
  name: string;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
};

function draftFrom(connector: AgentConnector | null): Draft {
  if (!connector) {
    return {
      kind: "stdio",
      name: "",
      command: "",
      args: "",
      env: "",
      url: "",
      headers: "",
    };
  }
  return {
    kind: connector.kind,
    name: connector.name,
    command: connector.kind === "stdio" ? connector.command : "",
    args: connector.kind === "stdio" ? formatArgs(connector.args) : "",
    env:
      connector.kind === "stdio" ? formatKeyValueLines(connector.env, "=") : "",
    url: connector.kind === "http" ? connector.url : "",
    headers:
      connector.kind === "http"
        ? formatKeyValueLines(connector.headers, ":")
        : "",
  };
}

function connectorFrom(draft: Draft): {
  connector: AgentConnector;
  invalidLines: string[];
} {
  const name = draft.name.trim();
  if (draft.kind === "http") {
    const { map, invalid } = parseKeyValueLines(draft.headers, ":");
    return {
      connector: { kind: "http", name, url: draft.url.trim(), headers: map },
      invalidLines: invalid,
    };
  }
  const { map, invalid } = parseKeyValueLines(draft.env, "=");
  return {
    connector: {
      kind: "stdio",
      name,
      command: draft.command.trim(),
      args: parseArgs(draft.args),
      env: map,
    },
    invalidLines: invalid,
  };
}

function ConnectorForm({
  disabled,
  id,
  initial,
  onCancel,
  onSave,
  taken,
}: {
  disabled?: boolean;
  id: string;
  initial: AgentConnector | null;
  onCancel: () => void;
  onSave: (connector: AgentConnector) => void;
  taken: string[];
}) {
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(initial));
  const { connector, invalidLines } = connectorFrom(draft);
  const errors = connectorErrors(connector, taken);
  const canSave = errors.length === 0 && invalidLines.length === 0;
  const set = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  return (
    <div className="space-y-3" data-testid={id}>
      <div
        className="flex gap-1 rounded-md bg-muted/50 p-0.5"
        data-testid={`${id}-kind`}
      >
        {(Object.keys(CONNECTOR_KIND_LABELS) as ConnectorKind[]).map((kind) => (
          <button
            aria-pressed={draft.kind === kind}
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs transition-colors",
              draft.kind === kind
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            disabled={disabled}
            key={kind}
            onClick={() => set({ kind })}
            type="button"
          >
            {CONNECTOR_KIND_LABELS[kind]}
          </button>
        ))}
      </div>
      <Field id={`${id}-name`} label="Name">
        <Input
          autoComplete="off"
          className={PERSONA_FIELD_CONTROL_CLASS}
          disabled={disabled}
          id={`${id}-name`}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="github"
          value={draft.name}
        />
      </Field>
      {draft.kind === "stdio" ? (
        <>
          <Field id={`${id}-command`} label="Command">
            <Input
              autoComplete="off"
              className={cn("font-mono", PERSONA_FIELD_CONTROL_CLASS)}
              disabled={disabled}
              id={`${id}-command`}
              onChange={(event) => set({ command: event.target.value })}
              placeholder="npx"
              value={draft.command}
            />
          </Field>
          <Field id={`${id}-args`} label="Arguments">
            <Input
              autoComplete="off"
              className={cn("font-mono", PERSONA_FIELD_CONTROL_CLASS)}
              disabled={disabled}
              id={`${id}-args`}
              onChange={(event) => set({ args: event.target.value })}
              placeholder="-y @modelcontextprotocol/server-github"
              value={draft.args}
            />
          </Field>
          <Field
            hint="One KEY=value per line. Kept on this device."
            id={`${id}-env`}
            label="Environment"
          >
            <Textarea
              className={cn(
                "min-h-16 resize-y px-3 py-2 font-mono text-xs leading-5",
                PERSONA_FIELD_CONTROL_CLASS,
              )}
              disabled={disabled}
              id={`${id}-env`}
              onChange={(event) => set({ env: event.target.value })}
              placeholder="GITHUB_TOKEN=ghp_…"
              spellCheck={false}
              value={draft.env}
            />
          </Field>
        </>
      ) : (
        <>
          <Field id={`${id}-url`} label="URL">
            <Input
              autoComplete="off"
              className={cn("font-mono", PERSONA_FIELD_CONTROL_CLASS)}
              disabled={disabled}
              id={`${id}-url`}
              inputMode="url"
              onChange={(event) => set({ url: event.target.value })}
              placeholder="https://mcp.example.com/mcp"
              value={draft.url}
            />
          </Field>
          <Field
            hint="One Name: value per line. Kept on this device."
            id={`${id}-headers`}
            label="Headers"
          >
            <Textarea
              className={cn(
                "min-h-16 resize-y px-3 py-2 font-mono text-xs leading-5",
                PERSONA_FIELD_CONTROL_CLASS,
              )}
              disabled={disabled}
              id={`${id}-headers`}
              onChange={(event) => set({ headers: event.target.value })}
              placeholder="Authorization: Bearer …"
              spellCheck={false}
              value={draft.headers}
            />
          </Field>
        </>
      )}
      {invalidLines.length > 0 ? (
        <p className="text-xs text-destructive">
          Not a {draft.kind === "http" ? "Name: value" : "KEY=value"} line:{" "}
          {invalidLines.join(", ")}
        </p>
      ) : null}
      {errors.length > 0 && (draft.name || draft.command || draft.url) ? (
        <p className="text-xs text-destructive">{errors.join(" ")}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          disabled={disabled}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          data-testid={`${id}-save`}
          disabled={disabled || !canSave}
          onClick={() => onSave(connector)}
          size="sm"
          type="button"
        >
          {initial ? "Save connector" : "Add connector"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  children,
  hint,
  id,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  id: string;
  label: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <div className={PERSONA_FIELD_SHELL_CLASS}>{children}</div>
      {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
