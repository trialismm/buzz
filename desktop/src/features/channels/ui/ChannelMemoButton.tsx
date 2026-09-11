import * as React from "react";
import { Eye, NotebookPen, Pencil } from "lucide-react";
import {
  channelMemoKey,
  setChannelMemo,
  useChannelMemo,
} from "@/features/channels/lib/channelMemoStore";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Textarea } from "@/shared/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/**
 * One-click channel memo: a private Markdown note pad for what to ask this
 * channel next. Lives in the header next to Channel settings, opens as a
 * popover, autosaves to this device (see `channelMemoStore`). Never sent.
 */
export function ChannelMemoButton({
  channelId,
  channelName,
}: {
  channelId: string;
  channelName: string;
}) {
  const relayOrigin = useRelayOrigin();
  const key = channelMemoKey(relayOrigin, channelId);
  const memo = useChannelMemo(key);
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const hasMemo = memo.content.trim().length > 0;
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open && !preview) {
      // Focus after the popover mounts so typing can start immediately.
      const id = window.requestAnimationFrame(() =>
        textareaRef.current?.focus(),
      );
      return () => window.cancelAnimationFrame(id);
    }
  }, [open, preview]);

  return (
    <Popover modal={false} onOpenChange={setOpen} open={open}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label={hasMemo ? "Open memo (has notes)" : "Open memo"}
              className="relative"
              data-testid="channel-memo-trigger"
              size="icon"
              type="button"
              variant="outline"
            >
              <NotebookPen />
              {hasMemo ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary"
                  data-testid="channel-memo-dot"
                />
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Memo — private notes for this channel</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2 p-3"
        data-testid="channel-memo-popover"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            Memo · {channelName}
          </span>
          <Button
            aria-label={preview ? "Edit memo" : "Preview memo"}
            aria-pressed={preview}
            className="h-7 px-2 text-xs"
            data-testid="channel-memo-preview-toggle"
            onClick={() => setPreview((value) => !value)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {preview ? (
              <Pencil className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {preview ? "Edit" : "Preview"}
          </Button>
        </div>
        {preview ? (
          <div
            className="max-h-[60vh] min-h-32 overflow-y-auto rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm"
            data-testid="channel-memo-preview"
          >
            {hasMemo ? (
              <Markdown content={memo.content} />
            ) : (
              <p className="text-muted-foreground">Nothing noted yet.</p>
            )}
          </div>
        ) : (
          <Textarea
            aria-label={`Memo for ${channelName}`}
            className="max-h-[60vh] min-h-48 resize-y font-mono text-xs leading-5"
            data-testid="channel-memo-editor"
            onChange={(event) => setChannelMemo(key, event.target.value)}
            placeholder={"Things to ask here next…\n\n- [ ] Markdown works"}
            ref={textareaRef}
            spellCheck={false}
            value={memo.content}
          />
        )}
        <p className="text-2xs text-muted-foreground">
          {memo.updatedAt > 0
            ? `Saved on this device · ${formatSavedAt(memo.updatedAt)}`
            : "Saved on this device as you type. Never sent to the channel."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function formatSavedAt(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
