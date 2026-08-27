import {
  existsSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";

// Normal finalization and filesystem timestamp rounding can put updated_at a
// little after the output mtime. Only a much larger lag identifies legacy polling.
export const CORRUPTION_LAG_MS = 5 * 60 * 1_000;

type CandidateRow = {
  job_id: string;
  candidate_index: number;
  status: string;
  output_filename: string | null;
  output_subfolder: string | null;
  output_type: string | null;
  created_at: string;
  updated_at: string;
};

type SkipReason =
  | "missing-output-metadata"
  | "unsupported-output-type"
  | "unsafe-output-path"
  | "output-not-found"
  | "invalid-timestamp"
  | "output-before-candidate"
  | "timestamp-not-corrupt"
  | "changed-after-backup";

export type ProcessingTimeRepair = {
  jobId: string;
  candidateIndex: number;
  outputFilename: string;
  outputSubfolder: string | null;
  outputPath: string;
  previousUpdatedAt: string;
  repairedUpdatedAt: string;
  processingSeconds: number;
};

export type ProcessingTimeRepairSkip = {
  jobId: string;
  candidateIndex: number;
  reason: SkipReason;
  detail?: string;
};

export type ProcessingTimeRepairResult = {
  mode: "dry-run" | "apply";
  databasePath: string;
  comfyOutputDir: string;
  backupPath: string | null;
  scannedReady: number;
  eligible: number;
  updated: number;
  repairs: ProcessingTimeRepair[];
  skipped: ProcessingTimeRepairSkip[];
};

export type ProcessingTimeRepairOptions = {
  databasePath: string;
  comfyOutputDir: string;
  apply?: boolean;
  bridgeStopped?: boolean;
  backupPath?: string;
  now?: Date;
};

function normalizedAbsolute(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} obbligatorio`);
  return path.resolve(trimmed);
}

function samePath(left: string, right: string) {
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}

function isWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function storedPath(value: string) {
  return value.replace(/[\\/]+/g, path.sep);
}

function skip(
  row: CandidateRow,
  reason: SkipReason,
  detail?: string,
): ProcessingTimeRepairSkip {
  return {
    jobId: row.job_id,
    candidateIndex: row.candidate_index,
    reason,
    ...(detail ? { detail } : {}),
  };
}

function scanReadyCandidates(
  database: DatabaseSync,
  outputRoot: string,
) {
  const rows = database.prepare(
    `SELECT job_id, candidate_index, status, output_filename,
            output_subfolder, output_type, created_at, updated_at
     FROM candidates
     WHERE status = 'ready'
     ORDER BY created_at DESC, job_id, candidate_index`,
  ).all() as unknown as CandidateRow[];
  const repairs: ProcessingTimeRepair[] = [];
  const skipped: ProcessingTimeRepairSkip[] = [];

  for (const row of rows) {
    if (!row.output_filename) {
      skipped.push(skip(row, "missing-output-metadata"));
      continue;
    }
    if (row.output_type !== "output") {
      skipped.push(skip(
        row,
        "unsupported-output-type",
        row.output_type ?? "null",
      ));
      continue;
    }

    const filename = storedPath(row.output_filename);
    if (path.basename(filename) !== filename) {
      skipped.push(skip(row, "unsafe-output-path", row.output_filename));
      continue;
    }
    const logicalPath = path.resolve(
      outputRoot,
      storedPath(row.output_subfolder ?? ""),
      filename,
    );
    if (!isWithin(outputRoot, logicalPath)) {
      skipped.push(skip(row, "unsafe-output-path", logicalPath));
      continue;
    }

    let resolvedOutput: string;
    let outputStat;
    try {
      resolvedOutput = realpathSync(logicalPath);
      if (!isWithin(outputRoot, resolvedOutput)) {
        skipped.push(skip(row, "unsafe-output-path", resolvedOutput));
        continue;
      }
      outputStat = statSync(resolvedOutput);
      if (!outputStat.isFile()) throw new Error("non è un file");
    } catch (error) {
      skipped.push(skip(
        row,
        "output-not-found",
        error instanceof Error ? error.message : logicalPath,
      ));
      continue;
    }

    const created = Date.parse(row.created_at);
    const updated = Date.parse(row.updated_at);
    const outputModified = outputStat.mtimeMs;
    if (
      !Number.isFinite(created)
      || !Number.isFinite(updated)
      || !Number.isFinite(outputModified)
    ) {
      skipped.push(skip(row, "invalid-timestamp"));
      continue;
    }
    if (outputModified < created) {
      skipped.push(skip(
        row,
        "output-before-candidate",
        outputStat.mtime.toISOString(),
      ));
      continue;
    }
    if (updated <= outputModified + CORRUPTION_LAG_MS) {
      skipped.push(skip(row, "timestamp-not-corrupt"));
      continue;
    }

    repairs.push({
      jobId: row.job_id,
      candidateIndex: row.candidate_index,
      outputFilename: row.output_filename,
      outputSubfolder: row.output_subfolder,
      outputPath: resolvedOutput,
      previousUpdatedAt: row.updated_at,
      repairedUpdatedAt: outputStat.mtime.toISOString(),
      processingSeconds: Math.max(0, (outputModified - created) / 1_000),
    });
  }

  return { scannedReady: rows.length, repairs, skipped };
}

function backupName(databasePath: string, now: Date) {
  const stamp = now.toISOString().replace(/[-:.]/g, "");
  return `${databasePath}.processing-times-${stamp}.backup.sqlite`;
}

function assertDatabaseAndOutput(databasePath: string, outputRoot: string) {
  if (!statSync(databasePath).isFile()) {
    throw new Error(`Database non valido: ${databasePath}`);
  }
  if (!statSync(outputRoot).isDirectory()) {
    throw new Error(`Cartella output ComfyUI non valida: ${outputRoot}`);
  }
}

function readOnlyScan(databasePath: string, outputRoot: string) {
  const database = new DatabaseSync(databasePath, {
    readOnly: true,
    timeout: 5_000,
  });
  try {
    return scanReadyCandidates(database, outputRoot);
  } finally {
    database.close();
  }
}

async function createVerifiedBackup(
  databasePath: string,
  destination: string,
  expected: ProcessingTimeRepair[],
) {
  if (samePath(databasePath, destination)) {
    throw new Error("Il backup non può coincidere con il database sorgente");
  }
  if (existsSync(destination)) {
    throw new Error(`Il backup esiste già, non verrà sovrascritto: ${destination}`);
  }
  if (!statSync(path.dirname(destination)).isDirectory()) {
    throw new Error(`Cartella backup non valida: ${path.dirname(destination)}`);
  }

  const source = new DatabaseSync(databasePath, {
    readOnly: true,
    timeout: 5_000,
  });
  try {
    await backup(source, destination);
  } finally {
    source.close();
  }

  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    const integrity = snapshot.prepare("PRAGMA integrity_check").get() as
      | Record<string, unknown>
      | undefined;
    if (!integrity || Object.values(integrity)[0] !== "ok") {
      throw new Error(`Backup SQLite non integro: ${destination}`);
    }
    const row = snapshot.prepare(
      `SELECT status, updated_at, output_filename, output_subfolder
       FROM candidates WHERE job_id = ? AND candidate_index = ?`,
    );
    for (const repair of expected) {
      const candidate = row.get(
        repair.jobId,
        repair.candidateIndex,
      ) as {
        status: string;
        updated_at: string;
        output_filename: string | null;
        output_subfolder: string | null;
      } | undefined;
      if (
        candidate?.status !== "ready"
        || candidate.updated_at !== repair.previousUpdatedAt
        || candidate.output_filename !== repair.outputFilename
        || candidate.output_subfolder !== repair.outputSubfolder
      ) {
        throw new Error(
          `Il backup non copre lo stato atteso di ${repair.jobId}/${repair.candidateIndex}`,
        );
      }
    }
  } finally {
    snapshot.close();
  }
}

export async function repairProcessingTimes(
  options: ProcessingTimeRepairOptions,
): Promise<ProcessingTimeRepairResult> {
  const databasePath = normalizedAbsolute(options.databasePath, "--database");
  const outputPath = normalizedAbsolute(options.comfyOutputDir, "--comfy-output");
  assertDatabaseAndOutput(databasePath, outputPath);
  const outputRoot = realpathSync(outputPath);
  const apply = options.apply === true;
  if (apply && options.bridgeStopped !== true) {
    throw new Error(
      "Apply rifiutato: arresta il bridge e passa --bridge-stopped. "
      + "Senza --apply lo script esegue soltanto un dry-run.",
    );
  }

  const initial = readOnlyScan(databasePath, outputRoot);
  if (!apply) {
    return {
      mode: "dry-run",
      databasePath,
      comfyOutputDir: outputRoot,
      backupPath: null,
      scannedReady: initial.scannedReady,
      eligible: initial.repairs.length,
      updated: 0,
      repairs: initial.repairs,
      skipped: initial.skipped,
    };
  }
  if (initial.repairs.length === 0) {
    return {
      mode: "apply",
      databasePath,
      comfyOutputDir: outputRoot,
      backupPath: null,
      scannedReady: initial.scannedReady,
      eligible: 0,
      updated: 0,
      repairs: [],
      skipped: initial.skipped,
    };
  }

  const backupPath = normalizedAbsolute(
    options.backupPath ?? backupName(databasePath, options.now ?? new Date()),
    "--backup",
  );
  await createVerifiedBackup(databasePath, backupPath, initial.repairs);

  const database = new DatabaseSync(databasePath, { timeout: 1_000 });
  const applied: ProcessingTimeRepair[] = [];
  const changedAfterBackup: ProcessingTimeRepairSkip[] = [];
  try {
    database.exec("BEGIN EXCLUSIVE");
    const current = scanReadyCandidates(database, outputRoot);
    const expected = new Map(
      initial.repairs.map((repair) => [
        `${repair.jobId}:\0${repair.candidateIndex}`,
        repair,
      ]),
    );
    const update = database.prepare(
      `UPDATE candidates SET updated_at = ?
       WHERE job_id = ? AND candidate_index = ?
         AND status = 'ready' AND output_type = 'output'
         AND updated_at = ? AND output_filename = ?
         AND output_subfolder IS ?`,
    );
    const handled = new Set<string>();

    for (const repair of current.repairs) {
      const key = `${repair.jobId}:\0${repair.candidateIndex}`;
      const beforeBackup = expected.get(key);
      if (
        !beforeBackup
        || beforeBackup.previousUpdatedAt !== repair.previousUpdatedAt
        || beforeBackup.repairedUpdatedAt !== repair.repairedUpdatedAt
        || beforeBackup.outputFilename !== repair.outputFilename
        || beforeBackup.outputSubfolder !== repair.outputSubfolder
      ) {
        changedAfterBackup.push({
          jobId: repair.jobId,
          candidateIndex: repair.candidateIndex,
          reason: "changed-after-backup",
        });
        handled.add(key);
        continue;
      }
      const latestMtime = statSync(repair.outputPath).mtime.toISOString();
      if (latestMtime !== repair.repairedUpdatedAt) {
        changedAfterBackup.push({
          jobId: repair.jobId,
          candidateIndex: repair.candidateIndex,
          reason: "changed-after-backup",
          detail: "Il file output è cambiato durante l'operazione",
        });
        handled.add(key);
        continue;
      }
      const result = update.run(
        repair.repairedUpdatedAt,
        repair.jobId,
        repair.candidateIndex,
        repair.previousUpdatedAt,
        repair.outputFilename,
        repair.outputSubfolder,
      );
      if (result.changes !== 1) {
        throw new Error(
          `Aggiornamento concorrente rilevato per ${repair.jobId}/${repair.candidateIndex}`,
        );
      }
      applied.push(repair);
      handled.add(key);
    }
    for (const repair of initial.repairs) {
      const key = `${repair.jobId}:\0${repair.candidateIndex}`;
      if (!handled.has(key)) {
        changedAfterBackup.push({
          jobId: repair.jobId,
          candidateIndex: repair.candidateIndex,
          reason: "changed-after-backup",
          detail: "Il candidato non è più idoneo alla riparazione",
        });
      }
    }
    database.exec("COMMIT");
    return {
      mode: "apply",
      databasePath,
      comfyOutputDir: outputRoot,
      backupPath,
      scannedReady: current.scannedReady,
      eligible: initial.repairs.length,
      updated: applied.length,
      repairs: applied,
      skipped: [...current.skipped, ...changedAfterBackup],
    };
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original error if SQLite already rolled back.
    }
    throw error;
  } finally {
    database.close();
  }
}

type CliOptions = ProcessingTimeRepairOptions & { help?: boolean };

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    databasePath: "",
    comfyOutputDir: "",
    apply: false,
    bridgeStopped: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--dry-run") {
      options.apply = false;
    } else if (arg === "--bridge-stopped") {
      options.bridgeStopped = true;
    } else if (arg === "--database" || arg === "--comfy-output" || arg === "--backup") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Valore mancante per ${arg}`);
      }
      index += 1;
      if (arg === "--database") options.databasePath = value;
      else if (arg === "--comfy-output") options.comfyOutputDir = value;
      else options.backupPath = value;
    } else {
      throw new Error(`Argomento sconosciuto: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    "Ripara updated_at dei soli candidati video ready corrotti dal bridge legacy.",
    "",
    "Dry-run (predefinito):",
    "  npm run repair:processing-times -- --database <db.sqlite> --comfy-output <output-dir>",
    "",
    "Apply, soltanto a bridge fermo:",
    "  npm run repair:processing-times -- --database <db.sqlite> --comfy-output <output-dir> --apply --bridge-stopped [--backup <backup.sqlite>]",
    "",
    "L'apply crea e verifica un backup SQLite consistente prima di ogni modifica.",
    "Sono idonei solo timestamp oltre 5 minuti successivi alla mtime del file output.",
  ].join("\n");
}

async function main() {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const result = await repairProcessingTimes(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (samePath(invokedPath, fileURLToPath(import.meta.url))) {
  void main();
}
