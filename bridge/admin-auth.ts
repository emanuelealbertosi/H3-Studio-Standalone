import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SESSION_COOKIE = "h3_admin_session";
const SESSION_SECONDS = 12 * 60 * 60;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(value: string | undefined) {
  const result = new Map<string, string>();
  for (const part of (value ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    result.set(part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim()));
  }
  return result;
}

export class AdminAuthService {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
  }

  close() {
    this.database.close();
  }

  isConfigured() {
    return Boolean(
      this.database.prepare("SELECT 1 FROM admin_credentials WHERE id = 1").get(),
    );
  }

  createPassword(password: string) {
    if (this.isConfigured()) throw new Error("La password Admin è già configurata");
    this.validatePassword(password);
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO admin_credentials(id, password_salt, password_hash, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?)`,
    ).run(salt.toString("base64"), hash.toString("base64"), now, now);
  }

  updatePassword(currentPassword: string, nextPassword: string) {
    if (!this.verifyPassword(currentPassword)) throw new Error("Password Admin corrente errata");
    this.validatePassword(nextPassword);
    const salt = randomBytes(16);
    const hash = scryptSync(nextPassword, salt, 64);
    this.database.prepare(
      `UPDATE admin_credentials
       SET password_salt = ?, password_hash = ?, updated_at = ?
       WHERE id = 1`,
    ).run(salt.toString("base64"), hash.toString("base64"), new Date().toISOString());
    this.database.prepare("DELETE FROM admin_sessions").run();
  }

  verifyPassword(password: string) {
    const row = this.database.prepare(
      "SELECT password_salt, password_hash FROM admin_credentials WHERE id = 1",
    ).get() as { password_salt: string; password_hash: string } | undefined;
    if (!row || typeof password !== "string") return false;
    const expected = Buffer.from(row.password_hash, "base64");
    const actual = scryptSync(password, Buffer.from(row.password_salt, "base64"), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  createSession() {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
    this.pruneSessions();
    this.database.prepare(
      "INSERT INTO admin_sessions(token_hash, created_at, expires_at) VALUES (?, ?, ?)",
    ).run(tokenHash(token), now.toISOString(), expires.toISOString());
    return token;
  }

  isAuthenticated(cookieHeader: string | undefined) {
    const token = parseCookies(cookieHeader).get(SESSION_COOKIE);
    if (!token) return false;
    const row = this.database.prepare(
      "SELECT expires_at FROM admin_sessions WHERE token_hash = ?",
    ).get(tokenHash(token)) as { expires_at: string } | undefined;
    if (!row) return false;
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.database.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash(token));
      return false;
    }
    return true;
  }

  revoke(cookieHeader: string | undefined) {
    const token = parseCookies(cookieHeader).get(SESSION_COOKIE);
    if (token) this.database.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash(token));
  }

  sessionCookie(token: string) {
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
  }

  clearCookie() {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }

  private validatePassword(password: string) {
    if (typeof password !== "string" || password.length < 10 || password.length > 200) {
      throw new Error("La password Admin deve contenere fra 10 e 200 caratteri");
    }
  }

  private pruneSessions() {
    this.database.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  }
}
