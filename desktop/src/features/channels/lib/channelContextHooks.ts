import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addChannelContextFiles,
  getChannelInstructions,
  listChannelContextFiles,
  removeChannelContextFile,
  setChannelInstructions,
} from "@/shared/api/channelContext";

export const channelContextFilesKey = (channelId: string | null) =>
  ["channel-context-files", channelId ?? "none"] as const;
export const channelInstructionsKey = (channelId: string | null) =>
  ["channel-instructions", channelId ?? "none"] as const;

export function useChannelContextFilesQuery(
  channelId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: channelContextFilesKey(channelId),
    queryFn: () => {
      if (!channelId) return Promise.reject(new Error("No channel selected"));
      return listChannelContextFiles(channelId);
    },
    enabled: enabled && channelId !== null,
  });
}

export function useAddChannelContextFilesMutation(channelId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!channelId) return Promise.reject(new Error("No channel selected"));
      return addChannelContextFiles(channelId);
    },
    onSuccess: (files) => {
      queryClient.setQueryData(channelContextFilesKey(channelId), files);
    },
  });
}

export function useRemoveChannelContextFileMutation(channelId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => {
      if (!channelId) return Promise.reject(new Error("No channel selected"));
      return removeChannelContextFile(channelId, name);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: channelContextFilesKey(channelId),
      });
    },
  });
}

export function useChannelInstructionsQuery(
  channelId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: channelInstructionsKey(channelId),
    queryFn: () => {
      if (!channelId) return Promise.reject(new Error("No channel selected"));
      return getChannelInstructions(channelId);
    },
    enabled: enabled && channelId !== null,
  });
}

export function useSetChannelInstructionsMutation(channelId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => {
      if (!channelId) return Promise.reject(new Error("No channel selected"));
      return setChannelInstructions(channelId, content);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: channelInstructionsKey(channelId),
      });
    },
  });
}
