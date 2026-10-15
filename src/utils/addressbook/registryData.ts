// Reading the eternl registry's script index.
//
// The same reader takes the file as GitHub serves it and the snapshot this
// repository ships, because the snapshot keeps the upstream shape and only
// shortens each script row to a tuple. Every string is checked and capped
// here: the index names a contract beside the viewer's own labels, so a
// malformed or oversized field must not reach the view.

import type { RegistryBundle, RegistryProject, RegistryScript, RegistrySource } from "./types";

/**
 * A registry key is one script hash (28 bytes), or a payment hash followed by
 * a stake credential hash. The second form names one address; the registry
 * uses it where a protocol pins the delegation part of its contract address.
 */
const HASH_PATTERN = /^([0-9a-f]{56}|[0-9a-f]{112})$/;

/** Hex characters of one credential. */
const CRED_CHARS = 56;

/** Upstream purposes are short words joined by `/`. */
const PURPOSE_PATTERN = /^[A-Z/]{1,48}$/;

const MAX_SCRIPTS = 50_000;
const MAX_PROJECTS = 5_000;
const MAX_LABEL = 64;
const MAX_NAME = 96;
const MAX_CATEGORY = 48;
const MAX_LINK = 200;

/** Control characters, which a label must not carry into the view. */
function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/** Trimmed, free of control characters, and capped. Null when nothing is left. */
export function sanitizeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  let clean = "";
  for (const char of value) {
    clean += isControl(char.codePointAt(0) ?? 0) ? " " : char;
  }
  clean = clean.trim();
  if (clean.length === 0) return null;
  return clean.length > max ? clean.slice(0, max) : clean;
}

function sanitizeLink(value: unknown): string | undefined {
  const text = sanitizeText(value, MAX_LINK);
  if (!text) return undefined;
  return /^https?:\/\//i.test(text) ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readProject(id: string, raw: unknown): RegistryProject | null {
  if (!isRecord(raw)) return null;
  const label = sanitizeText(raw.label, MAX_LABEL);
  if (!label) return null;
  return {
    id,
    label,
    category: sanitizeText(raw.category, MAX_CATEGORY) ?? undefined,
    subCategory: sanitizeText(raw.subCategory, MAX_CATEGORY) ?? undefined,
    link: sanitizeLink(raw.link),
  };
}

/** A script row, as an upstream object or as the snapshot's `[projectId, name, purpose]`. */
function readScript(hash: string, raw: unknown): RegistryScript | null {
  if (!HASH_PATTERN.test(hash)) return null;
  const fields = Array.isArray(raw)
    ? { projectId: raw[0], name: raw[1], purpose: raw[2] }
    : isRecord(raw)
      ? { projectId: raw.projectId, name: raw.name, purpose: raw.purpose }
      : null;
  if (!fields) return null;
  const projectId = sanitizeText(fields.projectId, MAX_LABEL);
  const name = sanitizeText(fields.name, MAX_NAME);
  if (!projectId || !name) return null;
  const purposeText = sanitizeText(fields.purpose, 48);
  const purpose = purposeText && PURPOSE_PATTERN.test(purposeText) ? purposeText : undefined;
  const stakeHash = hash.length > CRED_CHARS ? hash.slice(CRED_CHARS) : undefined;
  return { hash: hash.slice(0, CRED_CHARS), stakeHash, projectId, name, purpose };
}

/**
 * The bundle a parsed index describes. Rows that fail a check are dropped, one
 * by one, so a single bad entry costs its own label and nothing else. Returns
 * null only when the document itself is not an index.
 */
export function parseScriptIndex(raw: unknown, source: RegistrySource): RegistryBundle | null {
  if (!isRecord(raw)) return null;
  const scriptsRaw = raw.scripts;
  const projectsRaw = raw.projects;
  if (!isRecord(scriptsRaw)) return null;

  const projects = new Map<string, RegistryProject>();
  if (isRecord(projectsRaw)) {
    for (const [id, value] of Object.entries(projectsRaw)) {
      if (projects.size >= MAX_PROJECTS) break;
      const cleanId = sanitizeText(id, MAX_LABEL);
      if (!cleanId) continue;
      const project = readProject(cleanId, value);
      if (project) projects.set(cleanId, project);
    }
  }

  // Keyed the way the registry keys it: the payment hash on its own, or the
  // payment hash plus the stake hash. `buildRegistryIndex` adds the reading
  // that ignores the stake part.
  const scripts = new Map<string, RegistryScript>();
  for (const [hash, value] of Object.entries(scriptsRaw)) {
    if (scripts.size >= MAX_SCRIPTS) break;
    const key = hash.toLowerCase();
    const script = readScript(key, value);
    if (script) scripts.set(key, script);
  }

  const metadata = isRecord(raw.metadata) ? raw.metadata : null;
  return {
    projects,
    scripts,
    generatedAt: sanitizeText(metadata?.generatedAt, 40),
    source,
  };
}

/** An empty bundle, for a view that runs before anything is loaded. */
export function emptyBundle(source: RegistrySource = "snapshot"): RegistryBundle {
  return { projects: new Map(), scripts: new Map(), generatedAt: null, source };
}
