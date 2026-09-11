import { Pencil, Save, X } from "lucide-react";
import * as React from "react";
import {
  useChannelInstructionsQuery,
  useSetChannelInstructionsMutation,
} from "@/features/channels/lib/channelContextHooks";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";
import { Textarea } from "@/shared/ui/textarea";

/**
 * Channel instructions: the owner's standing rules for this channel, stored
 * on the relay (kind 48106) and injected by buzz-acp as
 * `<channel-instructions>` into every new agent session here. Only the
 * agent owner's event is honored, so this edits the caller's own document.
 */
export function ChannelInstructions({ channelId }: { channelId: string }) {
  const query = useChannelInstructionsQuery(channelId);
  const setMutation = useSetChannelInstructionsMutation(channelId);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const content = query.data?.content ?? "";

  if (query.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading instructions…</p>
    );
  }
  if (query.error instanceof Error) {
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {query.error.message}
      </p>
    );
  }
  if (isEditing) {
    return (
      <div className="space-y-3">
        <Textarea
          aria-label="Channel instructions"
          className="min-h-48 font-mono text-sm"
          data-testid="channel-instructions-editor"
          disabled={setMutation.isPending}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            "Standing rules for agents in this channel, in Markdown.\n\ne.g. Always answer in Korean. Never push to main. Prefer pnpm."
          }
          value={draft}
        />
        <div className="flex gap-2">
          <Button
            data-testid="channel-instructions-save"
            disabled={setMutation.isPending}
            onClick={() => {
              void setMutation
                .mutateAsync(draft)
                .then(() => setIsEditing(false))
                .catch(() => {
                  // Surfaced below via setMutation.error.
                });
            }}
            size="sm"
            type="button"
          >
            <Save className="h-4 w-4" />
            {setMutation.isPending ? "Saving…" : "Save instructions"}
          </Button>
          <Button
            data-testid="channel-instructions-cancel"
            disabled={setMutation.isPending}
            onClick={() => {
              setIsEditing(false);
              setDraft("");
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <X className="h-4 w-4" />
            Cancel
          </Button>
        </div>
        {setMutation.error instanceof Error ? (
          <p className="text-sm text-destructive">
            {setMutation.error.message}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Agents read these as their standing rules for this channel, from their
        next session on. Stored on the relay under your key.
      </p>
      {content.trim() ? (
        <div
          className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3"
          data-testid="channel-instructions-content"
        >
          <Markdown content={content} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No instructions set for this channel.
        </p>
      )}
      <Button
        data-testid="channel-instructions-edit"
        onClick={() => {
          setDraft(content);
          setIsEditing(true);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        <Pencil className="h-4 w-4" />
        {content.trim() ? "Edit instructions" : "Write instructions"}
      </Button>
    </div>
  );
}
