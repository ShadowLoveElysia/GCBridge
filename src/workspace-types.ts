export interface Opinion {
  id: string;
  text: string;
  kind: "viewpoint" | "consensus" | "disagreement" | "question";
  status: "proposed" | "adopted" | "adjusted" | "deferred" | "rejected";
  rationale: string;
  sourceRequestId?: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}
export interface ContextItem {
  id: string;
  title: string;
  text: string;
  createdAt: string;
}
export interface Snapshot {
  id: string;
  title: string;
  createdAt: string;
  throughTurn: number;
  markdown: string;
  opinions: Opinion[];
}
export interface WorkspaceData {
  parent?: { sessionId: string; throughTurn: number; title: string };
  profileId?: string;
  inheritedTokens?: number;
  opinions: Opinion[];
  contextItems: ContextItem[];
  snapshots: Snapshot[];
}
