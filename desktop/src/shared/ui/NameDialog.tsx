import * as React from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

/**
 * One-field dialog for naming or renaming something. Enter confirms; the
 * confirm button stays disabled while the name is blank, unchanged or a save
 * is in flight. The caller closes it (so a failed save keeps the draft).
 */
export function NameDialog({
  confirmLabel = "Save",
  description,
  error,
  initialValue,
  isPending = false,
  onConfirm,
  onOpenChange,
  open,
  testId,
  title,
}: {
  confirmLabel?: string;
  description?: string;
  error?: string | null;
  initialValue: string;
  isPending?: boolean;
  onConfirm: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  testId?: string;
  title: string;
}) {
  const [draft, setDraft] = React.useState(initialValue);
  const inputId = React.useId();
  React.useEffect(() => {
    if (open) setDraft(initialValue);
  }, [open, initialValue]);
  const trimmed = draft.trim();
  const canConfirm =
    trimmed.length > 0 && trimmed !== initialValue.trim() && !isPending;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid={testId}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canConfirm) onConfirm(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="sr-only" htmlFor={inputId}>
              Name
            </label>
            <Input
              autoComplete="off"
              autoFocus
              disabled={isPending}
              id={inputId}
              onChange={(event) => setDraft(event.target.value)}
              value={draft}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              disabled={isPending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={!canConfirm} type="submit">
              {isPending ? "Saving…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
