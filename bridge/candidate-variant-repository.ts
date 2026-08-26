import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ComfyApiPrompt } from "./comfy-client.js";
import type { MediaOutput } from "./studio-job.js";

export type CandidateVariantKind = "face" | "upscale" | "face_upscale";
export type CandidateVariantStage = "face" | "upscale";
export type CandidateVariantStatus =
  | "prepared"
  | "submitted"
  | "queued"
  | "rendering"
  | "ready"
  | "failed";

type VariantRow = {
  id: string;
  source_job_id: string;
  source_candidate_index: number;
  kind: CandidateVariantKind;
  stage: CandidateVariantStage;
  status: CandidateVariantStatus;
  prompt_id: string | null;
  queue_number: number | null;
  api_prompt_json: string;
  filename_prefix: string;
  output_filename: string | null;
  output_subfolder: string | null;
  output_type: MediaOutput["type"] | null;
  output_format: string | null;
  intermediate_filename: string | null;
  intermediate_subfolder: string | null;
  intermediate_type: MediaOutput["type"] | null;
  intermediate_format: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function media(
  filename: string | null,
  subfolder: string | null,
  type: MediaOutput["type"] | null,
  format: string | null,
): MediaOutput | null {
  if (!filename || !type) return null;
  const query = new URLSearchParams({ filename, subfolder: subfolder ?? "", type });
  return {
    filename,
    subfolder: subfolder ?? "",
    type,
    format: format ?? "video/mp4",
    mediaPath: `/api/media?${query.toString()}`,
  };
}

function mapRow(row: VariantRow) {
  return {
    id: row.id,
    sourceJobId: row.source_job_id,
    sourceCandidateIndex: row.source_candidate_index,
    kind: row.kind,
    stage: row.stage,
    status: row.status,
    promptId: row.prompt_id,
    queueNumber: row.queue_number,
    filenamePrefix: row.filename_prefix,
    output: media(
      row.output_filename,
      row.output_subfolder,
      row.output_type,
      row.output_format,
    ),
    intermediateOutput: media(
      row.intermediate_filename,
      row.intermediate_subfolder,
      row.intermediate_type,
      row.intermediate_format,
    ),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CandidateVariantRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
  }

  create(input: {
    sourceJobId: string;
    sourceCandidateIndex: number;
    kind: CandidateVariantKind;
    stage: CandidateVariantStage;
    prompt: ComfyApiPrompt;
    filenamePrefix: string;
  }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO candidate_variants(
        id, source_job_id, source_candidate_index, kind, stage, status,
        api_prompt_json, filename_prefix, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)`,
    ).run(
      id,
      input.sourceJobId,
      input.sourceCandidateIndex,
      input.kind,
      input.stage,
      JSON.stringify(input.prompt),
      input.filenamePrefix,
      now,
      now,
    );
    return this.get(id)!;
  }

  markQueued(id: string, promptId: string, queueNumber: number | null) {
    this.database.prepare(
      `UPDATE candidate_variants SET prompt_id = ?, queue_number = ?,
       status = 'submitted', error = NULL, updated_at = ? WHERE id = ?`,
    ).run(promptId, queueNumber, new Date().toISOString(), id);
  }

  updateStatus(
    id: string,
    status: CandidateVariantStatus,
    output: MediaOutput | null = null,
    error: string | null = null,
  ) {
    this.database.prepare(
      `UPDATE candidate_variants SET status = ?, output_filename = ?,
       output_subfolder = ?, output_type = ?, output_format = ?, error = ?,
       updated_at = ? WHERE id = ?`,
    ).run(
      status,
      output?.filename ?? null,
      output?.subfolder ?? null,
      output?.type ?? null,
      output?.format ?? null,
      error,
      new Date().toISOString(),
      id,
    );
  }

  advanceToFace(
    id: string,
    prompt: ComfyApiPrompt,
    filenamePrefix: string,
    intermediate: MediaOutput,
    promptId: string,
    queueNumber: number | null,
  ) {
    this.database.prepare(
      `UPDATE candidate_variants SET stage = 'face', status = 'submitted',
       prompt_id = ?, queue_number = ?, api_prompt_json = ?, filename_prefix = ?,
       intermediate_filename = ?, intermediate_subfolder = ?,
       intermediate_type = ?, intermediate_format = ?, error = NULL,
       updated_at = ? WHERE id = ?`,
    ).run(
      promptId,
      queueNumber,
      JSON.stringify(prompt),
      filenamePrefix,
      intermediate.filename,
      intermediate.subfolder,
      intermediate.type,
      intermediate.format,
      new Date().toISOString(),
      id,
    );
  }

  get(id: string) {
    const row = this.database.prepare(
      "SELECT * FROM candidate_variants WHERE id = ?",
    ).get(id) as VariantRow | undefined;
    return row ? mapRow(row) : null;
  }

  raw(id: string) {
    return this.database.prepare(
      "SELECT * FROM candidate_variants WHERE id = ?",
    ).get(id) as VariantRow | undefined;
  }

  listForJob(jobId: string) {
    return (this.database.prepare(
      `SELECT * FROM candidate_variants
       WHERE source_job_id = ? ORDER BY created_at DESC`,
    ).all(jobId) as unknown as VariantRow[]).map(mapRow);
  }

  listForCandidate(jobId: string, candidateIndex: number) {
    return (this.database.prepare(
      `SELECT * FROM candidate_variants
       WHERE source_job_id = ? AND source_candidate_index = ?
       ORDER BY created_at DESC`,
    ).all(jobId, candidateIndex) as unknown as VariantRow[]).map(mapRow);
  }

  recoverable() {
    return this.database.prepare(
      `SELECT id, prompt_id, api_prompt_json FROM candidate_variants
       WHERE prompt_id IS NOT NULL AND status NOT IN ('ready', 'failed')`,
    ).all() as unknown as Array<{
      id: string;
      prompt_id: string;
      api_prompt_json: string;
    }>;
  }

  count() {
    return (this.database.prepare(
      "SELECT COUNT(*) AS count FROM candidate_variants",
    ).get() as { count: number }).count;
  }

  close() {
    this.database.close();
  }
}
