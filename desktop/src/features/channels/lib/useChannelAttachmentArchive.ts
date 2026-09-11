import * as React from "react";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";
import {
  type ArchiveAttachment,
  collectAttachments,
} from "./channelAttachmentArchive";

/** Messages fetched per page; the relay pages by `until` + `before_id`. */
export const ARCHIVE_PAGE_LIMIT = 200;
/** Pages fetched per "load more" press before pausing for the user. */
const PAGES_PER_STEP = 5;

type State = {
  events: RelayEvent[];
  cursor: { until: number; beforeId: string } | null;
  exhausted: boolean;
  loading: boolean;
  error: string | null;
};

const INITIAL: State = {
  events: [],
  cursor: null,
  exhausted: false,
  loading: false,
  error: null,
};

/**
 * Walk a channel's message history backwards (thread replies included — they
 * carry the same `h` tag) and collect every imeta attachment. Bounded: each
 * step fetches at most `PAGES_PER_STEP` pages, then waits for `loadMore`.
 */
export function useChannelAttachmentArchive(channelId: string | null): {
  items: ArchiveAttachment[];
  scannedMessages: number;
  exhausted: boolean;
  loading: boolean;
  error: string | null;
  loadMore: () => void;
} {
  const [state, setState] = React.useState<State>(INITIAL);
  // Generation fence: a page landing after the channel changed is dropped.
  const generation = React.useRef(0);

  const fetchStep = React.useCallback(
    async (id: string, from: State["cursor"], gen: number) => {
      let cursor = from;
      let exhausted = false;
      const pages: RelayEvent[][] = [];
      try {
        for (let page = 0; page < PAGES_PER_STEP && !exhausted; page += 1) {
          const events = await relayClient.fetchEvents({
            kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2],
            "#h": [id],
            limit: ARCHIVE_PAGE_LIMIT,
            ...(cursor
              ? { until: cursor.until, before_id: cursor.beforeId }
              : {}),
          });
          pages.push(events);
          if (events.length < ARCHIVE_PAGE_LIMIT) {
            exhausted = true;
          } else {
            const oldest = events.reduce((a, b) =>
              b.created_at < a.created_at ? b : a,
            );
            cursor = { until: oldest.created_at, beforeId: oldest.id };
          }
        }
        if (generation.current !== gen) return;
        setState((prev) => {
          const seen = new Set(prev.events.map((e) => e.id));
          const fresh = pages.flat().filter((e) => !seen.has(e.id));
          return {
            events: [...prev.events, ...fresh],
            cursor,
            exhausted,
            loading: false,
            error: null,
          };
        });
      } catch (error) {
        if (generation.current !== gen) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error ? error.message : "Couldn't load history.",
        }));
      }
    },
    [],
  );

  React.useEffect(() => {
    generation.current += 1;
    const gen = generation.current;
    setState(INITIAL);
    if (!channelId) return;
    setState((prev) => ({ ...prev, loading: true }));
    void fetchStep(channelId, null, gen);
  }, [channelId, fetchStep]);

  const loadMore = React.useCallback(() => {
    if (!channelId || state.loading || state.exhausted) return;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    void fetchStep(channelId, state.cursor, generation.current);
  }, [channelId, fetchStep, state.cursor, state.exhausted, state.loading]);

  const items = React.useMemo(
    () => collectAttachments(state.events),
    [state.events],
  );

  return {
    items,
    scannedMessages: state.events.length,
    exhausted: state.exhausted,
    loading: state.loading,
    error: state.error,
    loadMore,
  };
}
