import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ComfyApiPrompt } from "./comfy-client.js";

export type CreativeAssetKind = "character" | "object";
export type CreativeReferenceRole =
  | "primary"
  | "face"
  | "full_body"
  | "front"
  | "side"
  | "back"
  | "detail"
  | "style"
  | "other";

type AssetRow = {
  id: string;
  kind: CreativeAssetKind;
  name: string;
  description: string;
  generation_prompt: string;
  status: "draft" | "ready" | "generating" | "failed";
  created_at: string;
  updated_at: string;
  reference_count?: number;
};

type ReferenceRow = {
  id: string;
  asset_id: string;
  generation_id: string | null;
  label: string;
  role: CreativeReferenceRole;
  position: number;
  file: string;
  name: string;
  source: "upload" | "generated";
  width: number | null;
  height: number | null;
  created_at: string;
};

type GenerationRow = {
  id: string;
  asset_id: string;
  prompt: string;
  seed: string;
  status: "prepared" | "queued" | "running" | "ready" | "failed";
  prompt_id: string | null;
  queue_number: number | null;
  filename_prefix: string;
  output_filename: string | null;
  output_subfolder: string | null;
  output_type: "input" | "output" | "temp" | null;
  output_format: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const roles = new Set<CreativeReferenceRole>([
  "primary",
  "face",
  "full_body",
  "front",
  "side",
  "back",
  "detail",
  "style",
  "other",
]);

function text(value: unknown, field: string, maximum: number, required = false) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if ((required && !normalized) || normalized.length > maximum) {
    throw new Error(`${field} non valido`);
  }
  return normalized;
}

function kind(value: unknown): CreativeAssetKind {
  if (value !== "character" && value !== "object") {
    throw new Error("Tipo asset non valido");
  }
  return value;
}

function role(value: unknown): CreativeReferenceRole {
  return roles.has(value as CreativeReferenceRole)
    ? (value as CreativeReferenceRole)
    : "other";
}

function mediaFromFile(file: string, name: string) {
  const match = /^(.*?)(?: \[(input|output|temp)\])?$/.exec(file.trim());
  const annotatedPath = (match?.[1] ?? file).replace(/\\/g, "/");
  const type = (match?.[2] ?? "input") as "input" | "output" | "temp";
  const slash = annotatedPath.lastIndexOf("/");
  const filename = slash >= 0 ? annotatedPath.slice(slash + 1) : annotatedPath;
  const subfolder = slash >= 0 ? annotatedPath.slice(0, slash) : "";
  const query = new URLSearchParams({ filename, subfolder, type });
  return {
    file,
    name,
    filename,
    subfolder,
    type,
    mediaPath: `/api/media?${query.toString()}`,
  };
}

function referenceFromRow(row: ReferenceRow) {
  return {
    id: row.id,
    assetId: row.asset_id,
    generationId: row.generation_id,
    label: row.label,
    role: row.role,
    position: row.position,
    source: row.source,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    ...mediaFromFile(row.file, row.name),
  };
}

function generationFromRow(row: GenerationRow) {
  const output =
    row.output_filename && row.output_type
      ? mediaFromFile(
          `${row.output_subfolder ? `${row.output_subfolder}/` : ""}${row.output_filename} [${row.output_type}]`,
          row.output_filename,
        )
      : null;
  return {
    id: row.id,
    assetId: row.asset_id,
    prompt: row.prompt,
    seed: Number(row.seed),
    status: row.status,
    promptId: row.prompt_id,
    queueNumber: row.queue_number,
    filenamePrefix: row.filename_prefix,
    output,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CreativeLibraryRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
  }

  list(kindValue?: unknown) {
    const filter = kindValue === undefined ? null : kind(kindValue);
    const rows = this.database
      .prepare(
        `SELECT creative_assets.*,
                COUNT(creative_asset_references.id) AS reference_count
         FROM creative_assets
         LEFT JOIN creative_asset_references
           ON creative_asset_references.asset_id = creative_assets.id
         WHERE (? IS NULL OR creative_assets.kind = ?)
         GROUP BY creative_assets.id
         ORDER BY creative_assets.updated_at DESC`,
      )
      .all(filter, filter) as unknown as AssetRow[];
    return rows.map((row) => {
      const hero = this.references(row.id)[0] ?? null;
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        description: row.description,
        generationPrompt: row.generation_prompt,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        referenceCount: row.reference_count ?? 0,
        hero,
      };
    });
  }

  get(assetId: string) {
    const row = this.database
      .prepare("SELECT * FROM creative_assets WHERE id = ?")
      .get(assetId) as AssetRow | undefined;
    if (!row) return null;
    const references = this.references(assetId);
    const generations = (
      this.database
        .prepare(
          `SELECT * FROM creative_generations
           WHERE asset_id = ? ORDER BY created_at DESC`,
        )
        .all(assetId) as unknown as GenerationRow[]
    ).map(generationFromRow);
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      description: row.description,
      generationPrompt: row.generation_prompt,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      referenceCount: references.length,
      hero: references[0] ?? null,
      references,
      generations,
    };
  }

  create(raw: { kind?: unknown; name?: unknown; description?: unknown; generationPrompt?: unknown }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO creative_assets(
          id, kind, name, description, generation_prompt, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      )
      .run(
        id,
        kind(raw.kind),
        text(raw.name, "Nome", 100, true),
        text(raw.description, "Descrizione", 4_000),
        text(raw.generationPrompt, "Prompt", 8_000),
        now,
        now,
      );
    return this.get(id)!;
  }

  update(assetId: string, raw: { name?: unknown; description?: unknown; generationPrompt?: unknown }) {
    const current = this.get(assetId);
    if (!current) throw new Error("Asset non trovato");
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE creative_assets
         SET name = ?, description = ?, generation_prompt = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        raw.name === undefined ? current.name : text(raw.name, "Nome", 100, true),
        raw.description === undefined
          ? current.description
          : text(raw.description, "Descrizione", 4_000),
        raw.generationPrompt === undefined
          ? current.generationPrompt
          : text(raw.generationPrompt, "Prompt", 8_000),
        now,
        assetId,
      );
    return this.get(assetId)!;
  }

  delete(assetId: string) {
    const result = this.database
      .prepare("DELETE FROM creative_assets WHERE id = ?")
      .run(assetId);
    if (result.changes !== 1) throw new Error("Asset non trovato");
  }

  addReference(
    assetId: string,
    raw: {
      file?: unknown;
      name?: unknown;
      label?: unknown;
      role?: unknown;
      source?: "upload" | "generated";
      width?: unknown;
      height?: unknown;
      generationId?: string | null;
    },
  ) {
    const asset = this.get(assetId);
    if (!asset) throw new Error("Asset non trovato");
    if (asset.references.length >= 12) throw new Error("Massimo 12 reference per asset");
    const id = randomUUID();
    const now = new Date().toISOString();
    const position = asset.references.length;
    const normalizedRole = role(raw.role);
    const name = text(raw.name, "Nome file", 240, true);
    this.database
      .prepare(
        `INSERT INTO creative_asset_references(
          id, asset_id, generation_id, label, role, position, file, name,
          source, width, height, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        assetId,
        raw.generationId ?? null,
        text(raw.label, "Etichetta", 100) ||
          (normalizedRole === "primary" ? "Reference principale" : name),
        normalizedRole,
        position,
        text(raw.file, "File", 1_024, true),
        name,
        raw.source === "generated" ? "generated" : "upload",
        Number.isInteger(raw.width) ? Number(raw.width) : null,
        Number.isInteger(raw.height) ? Number(raw.height) : null,
        now,
      );
    this.database
      .prepare("UPDATE creative_assets SET status = 'ready', updated_at = ? WHERE id = ?")
      .run(now, assetId);
    return this.get(assetId)!;
  }

  removeReference(referenceId: string) {
    const row = this.database
      .prepare("SELECT asset_id FROM creative_asset_references WHERE id = ?")
      .get(referenceId) as { asset_id: string } | undefined;
    if (!row) throw new Error("Reference non trovata");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("DELETE FROM creative_asset_references WHERE id = ?")
        .run(referenceId);
      const remaining = this.references(row.asset_id);
      remaining.forEach((reference, position) => {
        this.database
          .prepare("UPDATE creative_asset_references SET position = ? WHERE id = ?")
          .run(position, reference.id);
      });
      this.database
        .prepare(
          `UPDATE creative_assets SET status = ?, updated_at = ? WHERE id = ?`,
        )
        .run(remaining.length ? "ready" : "draft", new Date().toISOString(), row.asset_id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.get(row.asset_id)!;
  }

  createGeneration(
    assetId: string,
    prepared: { id: string; prompt: string; seed: number; filenamePrefix: string; apiPrompt: ComfyApiPrompt },
  ) {
    if (!this.get(assetId)) throw new Error("Asset non trovato");
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO creative_generations(
          id, asset_id, prompt, seed, status, api_prompt_json,
          filename_prefix, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'prepared', ?, ?, ?, ?)`,
      )
      .run(
        prepared.id,
        assetId,
        prepared.prompt,
        String(prepared.seed),
        JSON.stringify(prepared.apiPrompt),
        prepared.filenamePrefix,
        now,
        now,
      );
    this.database
      .prepare("UPDATE creative_assets SET status = 'generating', updated_at = ? WHERE id = ?")
      .run(now, assetId);
  }

  markGenerationQueued(id: string, promptId: string, queueNumber: number | null) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE creative_generations
         SET status = 'queued', prompt_id = ?, queue_number = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(promptId, queueNumber, now, id);
  }

  markGenerationRunning(id: string) {
    this.database
      .prepare(
        `UPDATE creative_generations SET status = 'running', updated_at = ?
         WHERE id = ? AND status IN ('prepared', 'queued')`,
      )
      .run(new Date().toISOString(), id);
  }

  markGenerationFailed(id: string, message: string) {
    const row = this.generation(id);
    if (!row) return;
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE creative_generations
         SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(message.slice(0, 1_000), now, id);
    this.database
      .prepare("UPDATE creative_assets SET status = 'failed', updated_at = ? WHERE id = ?")
      .run(now, row.asset_id);
  }

  markGenerationReady(
    id: string,
    output: { filename: string; subfolder: string; type: "input" | "output" | "temp"; format: string },
  ) {
    const row = this.generation(id);
    if (!row) throw new Error("Generazione non trovata");
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE creative_generations
         SET status = 'ready', output_filename = ?, output_subfolder = ?,
             output_type = ?, output_format = ?, error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(output.filename, output.subfolder, output.type, output.format, now, id);
    const existing = this.database
      .prepare("SELECT id FROM creative_asset_references WHERE generation_id = ?")
      .get(id);
    if (!existing) {
      this.addReference(row.asset_id, {
        generationId: id,
        file: `${output.subfolder ? `${output.subfolder}/` : ""}${output.filename} [${output.type}]`,
        name: output.filename,
        label: "Krea 2 sheet",
        role: "primary",
        source: "generated",
      });
    }
  }

  pendingGenerations() {
    return this.database
      .prepare(
        `SELECT * FROM creative_generations
         WHERE status IN ('prepared', 'queued', 'running')
           AND prompt_id IS NOT NULL`,
      )
      .all() as unknown as GenerationRow[];
  }

  generation(id: string) {
    return this.database
      .prepare("SELECT * FROM creative_generations WHERE id = ?")
      .get(id) as GenerationRow | undefined;
  }

  private references(assetId: string) {
    return (
      this.database
        .prepare(
          `SELECT * FROM creative_asset_references
           WHERE asset_id = ?
           ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END,
                    position, created_at`,
        )
        .all(assetId) as unknown as ReferenceRow[]
    ).map(referenceFromRow);
  }

  close() {
    this.database.close();
  }
}
