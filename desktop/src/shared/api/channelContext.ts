import { invokeTauri } from "@/shared/api/tauri";

/** A file in the channel's local context folder (see `channel_context.rs`). */
export type ChannelContextFile = {
  name: string;
  size: number;
  /** Unix seconds; 0 when unknown. */
  modifiedAt: number;
};

export async function listChannelContextFiles(
  channelId: string,
): Promise<ChannelContextFile[]> {
  return invokeTauri<ChannelContextFile[]>("list_channel_context_files", {
    channelId,
  });
}

/** Opens the OS file picker; resolves to the folder's new listing. */
export async function addChannelContextFiles(
  channelId: string,
): Promise<ChannelContextFile[]> {
  return invokeTauri<ChannelContextFile[]>("add_channel_context_files", {
    channelId,
  });
}

export async function removeChannelContextFile(
  channelId: string,
  name: string,
): Promise<void> {
  await invokeTauri("remove_channel_context_file", { channelId, name });
}

export async function revealChannelContextDir(
  channelId: string,
): Promise<void> {
  await invokeTauri("reveal_channel_context_dir", { channelId });
}

export type ChannelInstructions = {
  content: string;
  eventId: string | null;
  updatedAt: number | null;
};

export async function getChannelInstructions(
  channelId: string,
): Promise<ChannelInstructions> {
  const raw = await invokeTauri<{
    content: string;
    event_id: string | null;
    updated_at: number | null;
  }>("get_channel_instructions", { channelId });
  return {
    content: raw.content ?? "",
    eventId: raw.event_id ?? null,
    updatedAt: raw.updated_at ?? null,
  };
}

export async function setChannelInstructions(
  channelId: string,
  content: string,
): Promise<{ eventId: string }> {
  const raw = await invokeTauri<{ ok: boolean; event_id: string }>(
    "set_channel_instructions",
    { channelId, content },
  );
  return { eventId: raw.event_id };
}
