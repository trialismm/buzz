import { toast } from "sonner";

import { useUpdateChannelMutation } from "@/features/channels/hooks";
import {
  clearChannelRenameRequest,
  useChannelRenameRequest,
} from "@/features/sidebar/lib/renameChannelRequest";
import { NameDialog } from "@/shared/ui/NameDialog";

/**
 * The one "Rename channel" dialog for the sidebar; opened from a channel's
 * context menu through `renameChannelRequest`. Saves through the same
 * mutation as Channel settings, so caches and other members update the same
 * way.
 */
export function RenameChannelDialogHost() {
  const channel = useChannelRenameRequest();
  const mutation = useUpdateChannelMutation(channel?.id ?? null);
  const { mutateAsync } = mutation;

  return (
    <NameDialog
      description="Everyone in the channel sees the new name."
      error={mutation.error instanceof Error ? mutation.error.message : null}
      initialValue={channel?.name ?? ""}
      isPending={mutation.isPending}
      onConfirm={(name) => {
        void mutateAsync({ name })
          .then(() => {
            toast.success(`Channel renamed to #${name}`);
            clearChannelRenameRequest();
          })
          .catch(() => {
            // The dialog stays open and shows the mutation error.
          });
      }}
      onOpenChange={(open) => {
        if (!open) {
          mutation.reset();
          clearChannelRenameRequest();
        }
      }}
      open={channel !== null}
      testId="rename-channel-dialog"
      title="Rename channel"
    />
  );
}
