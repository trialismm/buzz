import { type Project, projectsQueryKey } from "@/features/projects/hooks";
import type { ProjectEventTemplate } from "@/features/projects/projectCreation";
import { validateProjectEventEnvelope } from "@/features/projects/projectModels";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { getIdentity } from "@/shared/api/tauriIdentity";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_PROJECT_ANNOUNCEMENT } from "@/shared/constants/kinds";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Replacement project event that only changes the `name` tag. Built from the
 * live signed head, never from the cached read model, so every other tag —
 * `d` (the slug, which keeps the project address stable), description,
 * channel binding, members, unknown extensions — survives the rename.
 */
export function buildProjectRenameTemplate({
  liveHead,
  name,
  ownerPubkey,
}: {
  liveHead: RelayEvent;
  name: string;
  ownerPubkey: string;
}): ProjectEventTemplate {
  if (ownerPubkey.trim().toLowerCase() !== liveHead.pubkey.toLowerCase()) {
    throw new Error("Only the project owner can rename a project.");
  }
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name is required.");
  let replaced = false;
  const tags = liveHead.tags.flatMap((tag) => {
    if (tag[0] !== "name") return [tag];
    if (replaced) return [];
    replaced = true;
    return [["name", trimmed]];
  });
  if (!replaced) tags.push(["name", trimmed]);
  validateProjectEventEnvelope(tags, liveHead.content);
  return { kind: KIND_PROJECT_ANNOUNCEMENT, content: liveHead.content, tags };
}

/** Fetch the owner's live head, patch the name, sign and publish. */
export async function renameProject(
  project: Pick<Project, "dtag" | "owner">,
  name: string,
): Promise<void> {
  const identity = await getIdentity();
  const [liveHead] = await relayClient.fetchEvents({
    kinds: [KIND_PROJECT_ANNOUNCEMENT],
    authors: [project.owner],
    "#d": [project.dtag],
    limit: 1,
  });
  if (!liveHead) {
    throw new Error(
      "Could not find this project on the relay. Refresh and try again.",
    );
  }
  const template = buildProjectRenameTemplate({
    liveHead,
    name,
    ownerPubkey: identity.pubkey,
  });
  await relayClient.publishEvent(
    await signRelayEvent(template),
    "Timed out renaming project.",
    "Failed to rename project.",
  );
}

export function useRenameProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, name }: { project: Project; name: string }) =>
      renameProject(project, name),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: projectsQueryKey }),
  });
}
