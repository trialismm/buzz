import { Pencil } from "lucide-react";
import * as React from "react";

import { useAcpRuntimesQuery, usePersonasQuery } from "@/features/agents/hooks";
import {
  connectionCatalogFor,
  readAgentConnection,
} from "@/features/agents/lib/agentConnection";
import {
  type CostEstimate,
  estimateModelCost,
  formatUsd,
  type ModelRates,
  setPricingOverride,
  usePricingOverrides,
} from "@/features/agents/lib/modelPricing";
import { useAgentUsageSeries } from "@/features/profile/lib/useAgentUsageSeries";
import {
  formatTokens,
  sumTrailingBuckets,
  type WindowUsage,
} from "@/features/profile/lib/usageWindow";
import { ProfileSectionGroup } from "@/features/profile/ui/UserProfilePanelFields";
import { currentRuntimeEntry } from "@/features/profile/ui/profileRuntimeQuickControlsState";
import type { AgentUsageModel } from "@/shared/api/tauriArchive";
import type { ManagedAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

const WINDOW_DAYS = 30;
const ROWS: { label: string; days: number }[] = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

/**
 * Runtime-tab card: what this agent consumed, from the locally archived
 * NIP-AM turn metrics. Tokens are always shown. Cost is shown only for an
 * API-key connection (a harness login is billed by the subscription, not per
 * token) and comes in two provenances — *reported* by the harness (Claude
 * Code prices its own turns) or *estimated* here from the owner's rate table
 * × the tokens of turns that carried a billing identity (Codex on an API
 * key). The two are never added together.
 */
export function AgentUsageSection({ agent }: { agent: ManagedAgent }) {
  const runtimesQuery = useAcpRuntimesQuery();
  const personasQuery = usePersonasQuery();
  const runtimeId = runtimesQuery.data
    ? currentRuntimeEntry(runtimesQuery.data, agent.agentCommand)?.id
    : undefined;
  const persona = personasQuery.data?.find((p) => p.id === agent.personaId);
  const showCost =
    connectionCatalogFor(runtimeId) !== null &&
    readAgentConnection(
      { ...(persona?.envVars ?? {}), ...agent.envVars },
      runtimeId,
    ).mode === "api-key";

  const seriesQuery = useAgentUsageSeries(agent.pubkey, WINDOW_DAYS);
  const overrides = usePricingOverrides();
  const series = seriesQuery.data;
  const agentUsage = series?.agents[0];
  const buckets = React.useMemo(() => agentUsage?.buckets ?? [], [agentUsage]);
  const rows = React.useMemo(
    () =>
      ROWS.map((row) => ({
        ...row,
        usage: sumTrailingBuckets(buckets, row.days),
      })),
    [buckets],
  );
  const models = agentUsage?.models ?? [];
  const priced = models
    .map((row) => ({ row, estimate: estimateModelCost(row, overrides) }))
    .filter((entry) => entry.row.pricingAuthority !== null);
  const estimatedTotal = priced.reduce(
    (sum, entry) => (entry.estimate ? sum + entry.estimate.usd : sum),
    0,
  );
  const anyEstimate = priced.some((entry) => entry.estimate !== null);
  const anyApproximate = priced.some((entry) => entry.estimate?.approximate);
  const unpriced = priced.filter((entry) => entry.estimate === null);

  if (seriesQuery.isError) {
    return (
      <UsageShell>
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Usage could not be read from the local archive.
        </p>
      </UsageShell>
    );
  }
  if (series && !series.collectionEnabled) {
    return (
      <UsageShell>
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Turn metrics are not being archived. Turn on agent metrics in Settings
          → Local archive to see usage here.
        </p>
      </UsageShell>
    );
  }

  return (
    <UsageShell>
      <table
        className="w-full text-xs tabular-nums"
        data-testid="user-profile-usage-table"
      >
        <thead>
          <tr className="text-2xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-1.5 text-left font-medium">Window</th>
            <th className="px-1.5 py-1.5 text-right font-medium">Turns</th>
            <th className="px-1.5 py-1.5 text-right font-medium">In</th>
            <th className="px-1.5 py-1.5 text-right font-medium">Out</th>
            {showCost ? (
              <th
                className="px-4 py-1.5 text-right font-medium"
                title="Cost as reported by the harness"
              >
                Cost
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <UsageRow
              key={row.label}
              label={row.label}
              showCost={showCost}
              usage={row.usage}
            />
          ))}
        </tbody>
      </table>
      {showCost && (anyEstimate || unpriced.length > 0) ? (
        <div className="space-y-2 border-t border-border/40 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Estimated, 30 days
              {anyApproximate ? " (cache split unknown — upper bound)" : ""}
            </span>
            <span
              className="font-mono text-sm text-foreground"
              data-testid="user-profile-usage-estimated"
            >
              {anyEstimate ? `≈ ${formatUsd(estimatedTotal)}` : "—"}
            </span>
          </div>
          <ul className="space-y-1">
            {priced.map(({ row, estimate }) => (
              <PricedModelRow
                estimate={estimate}
                key={`${row.harness ?? ""}|${row.model ?? ""}|${row.pricingAuthority ?? ""}|${row.pricingModel ?? ""}`}
                row={row}
              />
            ))}
          </ul>
        </div>
      ) : null}
      <p className="px-4 pb-3 pt-1 text-2xs leading-4 text-muted-foreground">
        Tokens as reported by the harness per turn.
        {showCost
          ? " Reported cost comes from the harness (Claude Code); estimates use your rate table × tokens for turns that carry a billing identity (Codex on an API key)."
          : " Cost is shown for API-key connections only."}{" "}
        History begins when metric archiving was enabled on this device.
      </p>
    </UsageShell>
  );
}

function UsageShell({ children }: { children: React.ReactNode }) {
  return (
    <ProfileSectionGroup testId="user-profile-usage-section" title="Usage">
      {children}
    </ProfileSectionGroup>
  );
}

function UsageRow({
  label,
  showCost,
  usage,
}: {
  label: string;
  showCost: boolean;
  usage: WindowUsage;
}) {
  const reported = usage.usage.estimatedCostUsd;
  return (
    <tr
      className="border-t border-border/40"
      data-testid={`user-profile-usage-row-${label}`}
    >
      <td className="whitespace-nowrap px-4 py-1.5 text-foreground">{label}</td>
      <td className="whitespace-nowrap px-1.5 py-1.5 text-right text-muted-foreground">
        {usage.reportCount}
      </td>
      <td className="whitespace-nowrap px-1.5 py-1.5 text-right text-muted-foreground">
        {formatTokens(usage.usage.inputTokens)}
      </td>
      <td className="whitespace-nowrap px-1.5 py-1.5 text-right text-muted-foreground">
        {formatTokens(usage.usage.outputTokens)}
      </td>
      {showCost ? (
        <td className="whitespace-nowrap px-4 py-1.5 text-right text-foreground">
          {reported.value === null
            ? "—"
            : `${reported.incomplete ? "≥" : ""}${formatUsd(reported.value)}`}
        </td>
      ) : null}
    </tr>
  );
}

function PricedModelRow({
  estimate,
  row,
}: {
  estimate: CostEstimate | null;
  row: AgentUsageModel;
}) {
  const authority = row.pricingAuthority ?? "";
  const model = row.pricingModel ?? row.model ?? "unknown model";
  return (
    <li className="flex items-center gap-2 text-xs">
      <span
        className="min-w-0 flex-1 truncate text-foreground"
        title={`${model} · ${authority}`}
      >
        {model}
        <span className="text-muted-foreground">
          {" "}
          · {row.reportCount} turns
        </span>
      </span>
      <span className="font-mono text-muted-foreground">
        {estimate
          ? `${estimate.approximate ? "≤" : "≈"} ${formatUsd(estimate.usd)}`
          : "no rates"}
      </span>
      <RatesEditor authority={authority} estimate={estimate} model={model} />
    </li>
  );
}

const RATE_FIELDS: { key: keyof ModelRates; label: string }[] = [
  { key: "inputPerMillion", label: "Input" },
  { key: "cachedInputPerMillion", label: "Cached input" },
  { key: "outputPerMillion", label: "Output" },
];

/** Popover to set or clear the owner's rates for one billable model. */
function RatesEditor({
  authority,
  estimate,
  model,
}: {
  authority: string;
  estimate: CostEstimate | null;
  model: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rateInputId = React.useId();
  const current = estimate?.resolved.rates;
  const [draft, setDraft] = React.useState<Record<keyof ModelRates, string>>(
    () => toDraft(current),
  );
  React.useEffect(() => {
    if (open) setDraft(toDraft(current));
  }, [open, current]);
  const parsed = parseDraft(draft);
  const source = estimate?.resolved.source;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Edit rates for ${model}`}
          className="text-muted-foreground"
          size="icon-xs"
          title={
            source === "override"
              ? "Your rates"
              : source === "default"
                ? `Built-in defaults (matched ${estimate?.resolved.matchedModel})`
                : "No rates known — set them to estimate cost"
          }
          type="button"
          variant="ghost"
        >
          <Pencil aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3 p-3">
        <div>
          <p className="text-sm font-medium text-foreground">{model}</p>
          <p className="text-2xs text-muted-foreground">
            {authority} · USD per 1M tokens
          </p>
        </div>
        {RATE_FIELDS.map((field) => (
          <div className="space-y-1" key={field.key}>
            <label
              className="block text-xs text-muted-foreground"
              htmlFor={`${rateInputId}-${field.key}`}
            >
              {field.label}
            </label>
            <Input
              id={`${rateInputId}-${field.key}`}
              inputMode="decimal"
              onChange={(event) =>
                setDraft((d) => ({ ...d, [field.key]: event.target.value }))
              }
              placeholder="0"
              value={draft[field.key]}
            />
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <Button
            disabled={source !== "override"}
            onClick={() => {
              setPricingOverride(authority, model, null);
              setOpen(false);
            }}
            size="xs"
            type="button"
            variant="ghost"
          >
            Use defaults
          </Button>
          <Button
            disabled={parsed === null}
            onClick={() => {
              if (!parsed) return;
              setPricingOverride(authority, model, parsed);
              setOpen(false);
            }}
            size="xs"
            type="button"
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function toDraft(
  rates: ModelRates | undefined,
): Record<keyof ModelRates, string> {
  return {
    inputPerMillion: rates ? String(rates.inputPerMillion) : "",
    cachedInputPerMillion: rates ? String(rates.cachedInputPerMillion) : "",
    outputPerMillion: rates ? String(rates.outputPerMillion) : "",
  };
}

function parseDraft(
  draft: Record<keyof ModelRates, string>,
): ModelRates | null {
  const out: Partial<ModelRates> = {};
  for (const field of RATE_FIELDS) {
    const n = Number(draft[field.key].trim());
    if (draft[field.key].trim() === "" || !Number.isFinite(n) || n < 0) {
      return null;
    }
    out[field.key] = n;
  }
  return out as ModelRates;
}
