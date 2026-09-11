import * as React from "react";
import { Download, FileText, Film, Music, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { invokeTauri } from "@/shared/api/tauri";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  type ArchiveAttachment,
  formatBytes,
  groupBySender,
} from "@/features/channels/lib/channelAttachmentArchive";
import { useChannelAttachmentArchive } from "@/features/channels/lib/useChannelAttachmentArchive";

/**
 * Channel archive ("Archives" in the settings sheet): every attachment in the channel's history (thread
 * replies included), grouped by sender, newest first. Clicking an item jumps
 * to the message that carries it — the message renders the media with its
 * full lightbox/download affordances, so the archive itself stays a finder.
 */
export function ChannelFilesView({
  channelId,
  currentPubkey,
}: {
  channelId: string;
  currentPubkey?: string;
}) {
  const archive = useChannelAttachmentArchive(channelId);
  const groups = React.useMemo(
    () => groupBySender(archive.items),
    [archive.items],
  );
  const senderPubkeys = React.useMemo(
    () => groups.map((group) => group.pubkey),
    [groups],
  );
  const profiles = useUsersBatchQuery(senderPubkeys, {
    enabled: senderPubkeys.length > 0,
  }).data?.profiles;
  const { goChannel } = useAppNavigation();
  // Same Tauri seam the message attachments use: relay-only URL, sanitized
  // name, content re-validated, then the OS save dialog.
  const download = React.useCallback((item: ArchiveAttachment) => {
    invokeTauri("download_file", { filename: item.name, url: item.url }).catch(
      (error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Download failed");
      },
    );
  }, []);
  const jumpTo = React.useCallback(
    (item: ArchiveAttachment) => {
      void goChannel(channelId, {
        messageId: item.eventId,
        threadRootId: item.threadRootId,
      });
    },
    [channelId, goChannel],
  );

  const scanSummary = archive.exhausted
    ? `${archive.items.length} file${archive.items.length === 1 ? "" : "s"} across the whole channel history`
    : `${archive.items.length} file${archive.items.length === 1 ? "" : "s"} in the latest ${archive.scannedMessages} messages`;

  return (
    <div className="space-y-5 pt-3" data-testid="channel-files-view">
      <p
        className="text-xs text-muted-foreground"
        data-testid="channel-files-summary"
      >
        {archive.loading && archive.items.length === 0
          ? "Scanning history…"
          : scanSummary}
      </p>
      {archive.error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {archive.error}
        </p>
      ) : null}
      {groups.length === 0 && !archive.loading ? (
        <p className="text-sm text-muted-foreground">
          Nothing has been shared in this channel yet.
        </p>
      ) : null}
      {groups.map((group) => {
        const label = resolveUserLabel({
          pubkey: group.pubkey,
          currentPubkey,
          profiles,
        });
        const images = group.items.filter((item) => item.kind === "image");
        const others = group.items.filter((item) => item.kind !== "image");
        return (
          <section
            aria-label={`Archived files from ${label}`}
            className="space-y-2"
            data-testid="channel-files-sender-group"
            key={group.pubkey}
          >
            <header className="flex items-center gap-2">
              <ProfileAvatar
                avatarUrl={profiles?.[group.pubkey]?.avatarUrl ?? null}
                className="h-6 w-6"
                label={label}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {label}
              </span>
              <span className="text-xs text-muted-foreground">
                {group.items.length}
              </span>
            </header>
            {images.length > 0 ? (
              <div className="grid grid-cols-3 gap-1.5">
                {images.map((item) => (
                  <div
                    className="group/file relative aspect-square overflow-hidden rounded-lg bg-muted"
                    key={item.key}
                  >
                    <button
                      aria-label={`${item.name}, sent ${formatDate(item.createdAt)}. Jump to message.`}
                      className="h-full w-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="channel-files-item"
                      onClick={() => jumpTo(item)}
                      title={`${item.name} · ${formatDate(item.createdAt)} · Jump to message`}
                      type="button"
                    >
                      <img
                        alt=""
                        className="h-full w-full object-cover transition-transform group-hover/file:scale-105"
                        loading="lazy"
                        src={item.thumb ?? item.url}
                      />
                    </button>
                    <DownloadButton
                      className="absolute right-1 top-1 bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover/file:opacity-100 focus-visible:opacity-100"
                      item={item}
                      onDownload={download}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {others.length > 0 ? (
              <ul className="space-y-1">
                {others.map((item) => (
                  <li className="flex items-center gap-1" key={item.key}>
                    <button
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="channel-files-item"
                      onClick={() => jumpTo(item)}
                      title="Jump to message"
                      type="button"
                    >
                      <FileKindIcon kind={item.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {item.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {[formatBytes(item.size), formatDate(item.createdAt)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                    <DownloadButton item={item} onDownload={download} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
      {!archive.exhausted ? (
        <Button
          className="w-full"
          data-testid="channel-files-load-more"
          disabled={archive.loading}
          onClick={archive.loadMore}
          size="sm"
          type="button"
          variant="outline"
        >
          {archive.loading ? "Loading…" : "Scan older messages"}
        </Button>
      ) : null}
    </div>
  );
}

function DownloadButton({
  className,
  item,
  onDownload,
}: {
  className?: string;
  item: ArchiveAttachment;
  onDownload: (item: ArchiveAttachment) => void;
}) {
  return (
    <button
      aria-label={`Download ${item.name}`}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      data-testid="channel-files-download"
      onClick={() => onDownload(item)}
      title={`Download ${item.name}`}
      type="button"
    >
      <Download aria-hidden="true" className="h-3.5 w-3.5" />
    </button>
  );
}

function FileKindIcon({ kind }: { kind: ArchiveAttachment["kind"] }) {
  const className = "h-4 w-4 shrink-0 text-muted-foreground";
  switch (kind) {
    case "video":
      return <Film aria-hidden="true" className={className} />;
    case "audio":
      return <Music aria-hidden="true" className={className} />;
    case "image":
      return <Paperclip aria-hidden="true" className={className} />;
    default:
      return <FileText aria-hidden="true" className={className} />;
  }
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
