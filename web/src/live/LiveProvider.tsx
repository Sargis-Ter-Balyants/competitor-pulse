import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Competitor, Snapshot } from "../api/client";

type LiveValue = {
  competitors: Competitor[] | null;
  fixtureIds: string[];
  pollIntervalMs: number | null;
  connected: boolean;
  connectionError: string | null;
  snapshotsFor: (id: string) => Snapshot[] | null;
  errorFor: (id: string) => string | null;
  watch: (id: string | null) => void;
};

const LiveContext = createContext<LiveValue | null>(null);

type ServerMessage =
  | { type: "connected"; pollIntervalMs?: number; fixtureIds?: string[]; competitors?: Competitor[] }
  | { type: "competitors"; competitors?: Competitor[] }
  | { type: "snapshots"; competitorId?: string; snapshots?: Snapshot[] }
  | { type: "error"; competitorId?: string; error?: string };

export function LiveProvider({ children }: { children: ReactNode }) {
  const [competitors, setCompetitors] = useState<Competitor[] | null>(null);
  const [fixtureIds, setFixtureIds] = useState<string[]>([]);
  const [pollIntervalMs, setPollIntervalMs] = useState<number | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const watchRef = useRef<string | null>(null);

  const watch = useCallback((id: string | null) => {
    watchRef.current = id;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(id ? { type: "subscribe", competitorId: id } : { type: "unsubscribe" }));
  }, []);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const next = new WebSocket(`${protocol}//${window.location.host}/api/live`);
      socket = next;
      socketRef.current = next;
      next.onopen = () => {
        setConnected(true);
        setConnectionError(null);
        if (watchRef.current) next.send(JSON.stringify({ type: "subscribe", competitorId: watchRef.current }));
      };
      next.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === "connected") {
          if (Array.isArray(message.competitors)) setCompetitors(message.competitors);
          if (Array.isArray(message.fixtureIds)) setFixtureIds(message.fixtureIds);
          if (typeof message.pollIntervalMs === "number") setPollIntervalMs(message.pollIntervalMs);
        } else if (message.type === "competitors" && Array.isArray(message.competitors)) {
          setCompetitors(message.competitors);
        } else if (message.type === "snapshots" && message.competitorId && Array.isArray(message.snapshots)) {
          const competitorId = message.competitorId;
          setSnapshots((current) => ({ ...current, [competitorId]: message.snapshots ?? [] }));
          setErrors((current) => {
            if (!(competitorId in current)) return current;
            const rest = { ...current };
            delete rest[competitorId];
            return rest;
          });
        } else if (message.type === "error" && message.competitorId && message.error) {
          setErrors((current) => ({ ...current, [message.competitorId!]: message.error! }));
        }
      };
      next.onclose = () => {
        setConnected(false);
        if (stopped) return;
        setConnectionError("Live connection lost. Reconnecting…");
        retry = setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
      socketRef.current = null;
    };
  }, []);

  const value = useMemo<LiveValue>(
    () => ({
      competitors,
      fixtureIds,
      pollIntervalMs,
      connected,
      connectionError,
      snapshotsFor: (id) => snapshots[id] ?? null,
      errorFor: (id) => errors[id] ?? null,
      watch,
    }),
    [competitors, fixtureIds, pollIntervalMs, connected, connectionError, snapshots, errors, watch],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error("useLive must be used inside LiveProvider");
  return value;
}
