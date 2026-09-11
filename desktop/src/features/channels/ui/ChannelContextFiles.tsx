import { FilePlus2, FolderOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/features/channels/lib/channelAttachmentArchive";
import {
  useAddChannelContextFilesMutation,
  useChannelContextFilesQuery,
  useRemoveChannelContextFileMutation,
} from "@/features/channels/lib/channelContextHooks";
import { revealChannelContextDir } from "@/shared/api/channelContext";
import { Button } from "@/shared/ui/button";

/**
 * Channel context files: reference material agents on this device get in
 * every new session for the channel (`<channel-context>`; small text files
 * inline, the rest listed by path). Local to this device — see
 * `channel_context.rs`.
 */
export function ChannelContextFiles({ channelId }: { channelId: string }) {
  const query = useChannelContextFilesQuery(channelId);
  const addMutation = useAddChannelContextFilesMutation(channelId);
  const removeMutation = useRemoveChannelContextFileMutation(channelId);
  const files = query.data ?? [];
  const busy = addMutation.isPending || removeMutation.isPending;

  const notify = (error: unknown, fallback: string) => {
    toast.error(error instanceof Error ? error.message : fallback);
  };

  return (
    <div className="space-y-3" data-testid="channel-context-files">
      <p className="text-xs text-muted-foreground">
        Reference files for the agents that run on this device. Small text files
        (up to 16 KB each, 32 KB in total) go into every new session as is;
        larger files and binaries are listed by path so the agent reads them
        when they matter. Changes apply from the next session.
      </p>
      {query.error instanceof Error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
          {files.map((file) => (
            <li className="flex items-center gap-3 px-3 py-2" key={file.name}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{file.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {[
                    formatBytes(file.size),
                    file.modifiedAt > 0
                      ? new Date(file.modifiedAt * 1000).toLocaleDateString()
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Button
                aria-label={`Remove ${file.name}`}
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                data-testid="channel-context-remove"
                disabled={busy}
                onClick={() => {
                  removeMutation
                    .mutateAsync(file.name)
                    .catch((error) =>
                      notify(error, "Couldn't remove the file"),
                    );
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No context files yet. Add specs, notes, exports — anything the agents
          here should keep in mind.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="channel-context-add"
          disabled={busy}
          onClick={() => {
            addMutation
              .mutateAsync()
              .catch((error) => notify(error, "Couldn't add files"));
          }}
          size="sm"
          type="button"
        >
          <FilePlus2 className="h-4 w-4" />
          {addMutation.isPending ? "Adding…" : "Add files"}
        </Button>
        <Button
          data-testid="channel-context-reveal"
          onClick={() => {
            revealChannelContextDir(channelId).catch((error) =>
              notify(error, "Couldn't open the folder"),
            );
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <FolderOpen className="h-4 w-4" />
          Open folder
        </Button>
      </div>
    </div>
  );
}
