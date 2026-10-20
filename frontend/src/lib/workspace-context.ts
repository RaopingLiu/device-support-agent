import { createContext, useContext } from "react";
import type { Draft, DraftPayload, Overview, Session, Ticket } from "./types";

export type Operation = "chat" | "draft" | "session" | null;
export interface Workspace {
  overview: Overview;
  session: Session;
  busy: Operation;
  notice: string;
  clearNotice: () => void;
  send: (message: string) => Promise<void>;
  newSession: (scenario: string) => Promise<boolean>;
  editDraft: (d: Draft, payload: DraftPayload) => Promise<void>;
  confirmDraft: (d: Draft) => Promise<Ticket | undefined>;
  cancelDraft: (d: Draft) => Promise<void>;
}
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider is missing");
  return value;
}
