import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type ChatAttachment = {
  kind: "picture" | "video" | "audio";
  file: string;
  name: string;
  mediaPath?: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  hasAudio?: boolean;
};

export type ChatActionRecord = {
  type: "generate_video" | "generate_image" | "edit_image" | "generate_anima";
  prompt: string;
  jobId?: string;
  status: "started" | "failed";
  error?: string;
};

type ChatMessageRow = {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  attachments_json: string;
  action_json: string | null;
  status: "pending" | "ready" | "failed";
  error: string | null;
  created_at: string;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function present(row: ChatMessageRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    content: row.content,
    attachments: parseJson<ChatAttachment[]>(row.attachments_json, []),
    action: parseJson<ChatActionRecord | null>(row.action_json, null),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  };
}

export class ChatRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
  }

  ensureThread(projectId: string) {
    const project = this.database.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId);
    if (!project) throw new Error("Progetto Chat non trovato");
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO chat_threads(project_id, created_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(projectId, now, now);
  }

  add(value: {
    projectId: string;
    role: "user" | "assistant";
    content: string;
    attachments?: ChatAttachment[];
    action?: ChatActionRecord | null;
    status?: "pending" | "ready" | "failed";
    error?: string | null;
  }) {
    this.ensureThread(value.projectId);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO chat_messages(
        id, project_id, role, content, attachments_json, action_json, status, error, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      value.projectId,
      value.role,
      value.content,
      JSON.stringify(value.attachments ?? []),
      value.action ? JSON.stringify(value.action) : null,
      value.status ?? "ready",
      value.error ?? null,
      now,
    );
    return this.get(id)!;
  }

  get(id: string) {
    const row = this.database.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as ChatMessageRow | undefined;
    return row ? present(row) : null;
  }

  list(projectId: string, limit = 100) {
    const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
    const rows = this.database.prepare(
      `SELECT * FROM (
        SELECT rowid AS sequence, * FROM chat_messages
        WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
       ) ORDER BY created_at, sequence`,
    ).all(projectId, safeLimit) as unknown as ChatMessageRow[];
    return rows.map(present);
  }

  clear(projectId: string) {
    this.database.prepare("DELETE FROM chat_messages WHERE project_id = ?").run(projectId);
    return { projectId, cleared: true };
  }

  close() { this.database.close(); }
}
