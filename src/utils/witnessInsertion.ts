// Insert vkey (signature) witnesses into a transaction's witness set.
//
// The cardinal rule: never re-encode the transaction body. The transaction id
// (and therefore every signature) is the blake2b-256 hash of the body's exact
// CBOR bytes. So we walk the transaction at the byte level, rebuild only the
// witness-set element, and splice it back in place — leaving the body, the
// is_valid flag, and the auxiliary data byte-for-byte untouched.
//
// Accepted paste formats (parseWitnessInput):
//   - raw hex or base64 of any of the below
//   - cardano-cli text envelope JSON: { "type": ..., "cborHex": "8200825820..." }
//   - a full witness set map:        a100 81 82 5820<vkey> 5840<sig>
//   - a cli witness envelope:        82 00 82 5820<vkey> 5840<sig>   ([tag, witness])
//   - a bare vkey witness:           82 5820<vkey> 5840<sig>
//   - a full signed transaction (its vkey witnesses are extracted)

import { blake2b } from "@noble/hashes/blake2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { normalizeHexOrBase64 } from "./inputNormalization";

export interface VkeyWitness {
  vkey: Uint8Array; // 32-byte ed25519 public key
  signature: Uint8Array; // 64-byte ed25519 signature
}

// ---------------------------------------------------------------------------
// hex helpers
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Hex string has an odd length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("Hex string contains non-hex characters");
    out[i] = byte;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Minimal CBOR reader that tracks byte offsets
// ---------------------------------------------------------------------------

const MAJOR_UNSIGNED = 0;
const MAJOR_BYTES = 2;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;
const MAJOR_TAG = 6;
const MAJOR_SIMPLE = 7;
const INDEFINITE = 31;
const BREAK = 0xff;

interface Head {
  major: number;
  ai: number; // additional info (low 5 bits)
  arg: number; // decoded argument (length / value); meaningless when indefinite
  indefinite: boolean;
  headEnd: number; // offset just past the head bytes
}

function readHead(buf: Uint8Array, pos: number): Head {
  if (pos >= buf.length) throw new Error("Unexpected end of CBOR input");
  const initial = buf[pos];
  const major = initial >> 5;
  const ai = initial & 0x1f;
  let arg = 0;
  let headEnd = pos + 1;
  let indefinite = false;
  if (ai < 24) {
    arg = ai;
  } else if (ai === 24) {
    arg = buf[headEnd];
    headEnd += 1;
  } else if (ai === 25) {
    arg = (buf[headEnd] << 8) | buf[headEnd + 1];
    headEnd += 2;
  } else if (ai === 26) {
    arg = buf[headEnd] * 2 ** 24 + (buf[headEnd + 1] << 16) + (buf[headEnd + 2] << 8) + buf[headEnd + 3];
    headEnd += 4;
  } else if (ai === 27) {
    // 8-byte argument. Lengths this large never appear in our structures, but
    // we still advance the cursor correctly so skipItem stays in sync.
    let v = 0;
    for (let i = 0; i < 8; i++) v = v * 256 + buf[headEnd + i];
    arg = v;
    headEnd += 8;
  } else if (ai === INDEFINITE) {
    indefinite = true;
  } else {
    throw new Error(`Reserved CBOR additional info ${ai}`);
  }
  if (headEnd > buf.length) throw new Error("Unexpected end of CBOR input");
  return { major, ai, arg, indefinite, headEnd };
}

// Advance past one complete CBOR item, returning the offset just past it.
function skipItem(buf: Uint8Array, pos: number): number {
  const h = readHead(buf, pos);
  switch (h.major) {
    case MAJOR_UNSIGNED:
    case 1: // negative
      return h.headEnd;
    case MAJOR_BYTES:
    case 3: // text string
      if (h.indefinite) {
        let p = h.headEnd;
        while (buf[p] !== BREAK) p = skipItem(buf, p);
        return p + 1;
      }
      return h.headEnd + h.arg;
    case MAJOR_ARRAY: {
      let p = h.headEnd;
      if (h.indefinite) {
        while (buf[p] !== BREAK) p = skipItem(buf, p);
        return p + 1;
      }
      for (let i = 0; i < h.arg; i++) p = skipItem(buf, p);
      return p;
    }
    case MAJOR_MAP: {
      let p = h.headEnd;
      if (h.indefinite) {
        while (buf[p] !== BREAK) {
          p = skipItem(buf, p); // key
          p = skipItem(buf, p); // value
        }
        return p + 1;
      }
      for (let i = 0; i < h.arg; i++) {
        p = skipItem(buf, p); // key
        p = skipItem(buf, p); // value
      }
      return p;
    }
    case MAJOR_TAG:
      return skipItem(buf, h.headEnd); // tag wraps exactly one item
    case MAJOR_SIMPLE:
      // floats/simple values: any payload is already counted in headEnd
      return h.headEnd;
    default:
      throw new Error(`Unsupported CBOR major type ${h.major}`);
  }
}

// Read a byte string item, returning its content and the offset past it.
function readByteString(buf: Uint8Array, pos: number): { bytes: Uint8Array; next: number } {
  const h = readHead(buf, pos);
  if (h.major !== MAJOR_BYTES || h.indefinite) {
    throw new Error("Expected a definite-length byte string");
  }
  const start = h.headEnd;
  const end = start + h.arg;
  if (end > buf.length) throw new Error("Byte string runs past end of input");
  return { bytes: buf.slice(start, end), next: end };
}

// ---------------------------------------------------------------------------
// CBOR writers (definite-length, canonical head encoding)
// ---------------------------------------------------------------------------

function encodeHead(major: number, arg: number): Uint8Array {
  const tag = major << 5;
  if (arg < 24) return new Uint8Array([tag | arg]);
  if (arg < 0x100) return new Uint8Array([tag | 24, arg]);
  if (arg < 0x10000) return new Uint8Array([tag | 25, arg >> 8, arg & 0xff]);
  if (arg < 0x100000000) {
    return new Uint8Array([tag | 26, (arg >>> 24) & 0xff, (arg >> 16) & 0xff, (arg >> 8) & 0xff, arg & 0xff]);
  }
  throw new Error("Argument too large to encode");
}

function encodeByteString(bytes: Uint8Array): Uint8Array {
  return concatBytes(encodeHead(MAJOR_BYTES, bytes.length), bytes);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Encode a single vkey witness as [vkey, signature].
function encodeVkeyWitness(w: VkeyWitness): Uint8Array {
  return concatBytes(encodeHead(MAJOR_ARRAY, 2), encodeByteString(w.vkey), encodeByteString(w.signature));
}

// ---------------------------------------------------------------------------
// Witness input parsing
// ---------------------------------------------------------------------------

// Pull every [vkey, signature] pair out of a definite/indefinite array that is
// the value of witness-set key 0.
function readVkeyArray(buf: Uint8Array, pos: number): VkeyWitness[] {
  const h = readHead(buf, pos);
  if (h.major !== MAJOR_ARRAY) throw new Error("vkey witnesses are not an array");
  const out: VkeyWitness[] = [];
  let p = h.headEnd;
  const readOne = () => {
    const item = readHead(buf, p);
    if (item.major !== MAJOR_ARRAY || item.arg !== 2) throw new Error("malformed vkey witness");
    const vk = readByteString(buf, item.headEnd);
    const sig = readByteString(buf, vk.next);
    out.push({ vkey: vk.bytes, signature: sig.bytes });
    p = sig.next;
  };
  if (h.indefinite) {
    while (buf[p] !== BREAK) readOne();
  } else {
    for (let i = 0; i < h.arg; i++) readOne();
  }
  return out;
}

// Find witness-set key 0 inside a map and return its vkey witnesses (or []).
function vkeysFromWitnessSetMap(buf: Uint8Array, pos: number): VkeyWitness[] {
  const h = readHead(buf, pos);
  if (h.major !== MAJOR_MAP) throw new Error("not a map");
  let p = h.headEnd;
  const entries = h.indefinite ? Infinity : h.arg;
  for (let i = 0; i < entries; i++) {
    if (h.indefinite && buf[p] === BREAK) break;
    const keyHead = readHead(buf, p);
    const valuePos = keyHead.headEnd;
    if (keyHead.major === MAJOR_UNSIGNED && keyHead.arg === 0) {
      return readVkeyArray(buf, valuePos);
    }
    p = skipItem(buf, valuePos); // skip this value
  }
  return [];
}

export class WitnessParseError extends Error {}

// Parse pasted witness text (any supported format) into vkey witnesses.
export function parseWitnessInput(text: string): VkeyWitness[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new WitnessParseError("Nothing to add — paste a witness first.");

  // Text-envelope JSON: { "type": ..., "description": ..., "cborHex": "..." }
  let hex: string;
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new WitnessParseError("Input looks like JSON but could not be parsed.");
    }
    const cborHex = (parsed as { cborHex?: unknown })?.cborHex;
    if (typeof cborHex !== "string") {
      throw new WitnessParseError('JSON is missing a string "cborHex" field.');
    }
    hex = cborHex.trim();
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new WitnessParseError('"cborHex" is not valid hex.');
    }
  } else {
    hex = normalizeHexOrBase64(trimmed).hex;
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length === 0) {
      throw new WitnessParseError("Input is not valid hex or base64.");
    }
  }

  let buf: Uint8Array;
  try {
    buf = hexToBytes(hex);
  } catch (e) {
    throw new WitnessParseError(e instanceof Error ? e.message : "Could not decode hex.");
  }

  let witnesses: VkeyWitness[];
  try {
    witnesses = decodeWitnessBytes(buf);
  } catch (e) {
    throw new WitnessParseError(
      `Could not interpret this as a witness: ${e instanceof Error ? e.message : "unknown CBOR error"}`,
    );
  }

  for (const w of witnesses) {
    if (w.vkey.length !== 32) throw new WitnessParseError("Public key is not 32 bytes.");
    if (w.signature.length !== 64) throw new WitnessParseError("Signature is not 64 bytes.");
  }
  if (witnesses.length === 0) {
    throw new WitnessParseError("No vkey (signature) witnesses found in the input.");
  }
  return witnesses;
}

function decodeWitnessBytes(buf: Uint8Array): VkeyWitness[] {
  const h = readHead(buf, 0);

  // A full witness set map: { 0: [...], 1: [...], ... }
  if (h.major === MAJOR_MAP) {
    return vkeysFromWitnessSetMap(buf, 0);
  }

  if (h.major === MAJOR_ARRAY) {
    // A full signed transaction: [body(map), witness_set(map), is_valid?, aux?]
    if (!h.indefinite && (h.arg === 3 || h.arg === 4)) {
      const first = readHead(buf, h.headEnd);
      if (first.major === MAJOR_MAP) {
        const bodyEnd = skipItem(buf, h.headEnd);
        return vkeysFromWitnessSetMap(buf, bodyEnd);
      }
    }

    if (!h.indefinite && h.arg === 2) {
      const first = readHead(buf, h.headEnd);
      // cli witness envelope: [tag, witness]; tag 0 == key witness
      if (first.major === MAJOR_UNSIGNED) {
        if (first.arg !== 0) {
          throw new Error(`unsupported witness tag ${first.arg} (only key witnesses are supported)`);
        }
        return [readSingleVkeyWitness(buf, first.headEnd)];
      }
      // bare vkey witness: [vkey, signature]
      if (first.major === MAJOR_BYTES) {
        return [readSingleVkeyWitness(buf, 0)];
      }
    }

    // An array of bare witnesses: [[vkey, sig], [vkey, sig], ...]
    return readVkeyArray(buf, 0);
  }

  throw new Error("unrecognized top-level CBOR structure");
}

function readSingleVkeyWitness(buf: Uint8Array, pos: number): VkeyWitness {
  const h = readHead(buf, pos);
  if (h.major !== MAJOR_ARRAY || h.arg !== 2) throw new Error("witness is not a 2-element array");
  const vk = readByteString(buf, h.headEnd);
  const sig = readByteString(buf, vk.next);
  return { vkey: vk.bytes, signature: sig.bytes };
}

// ---------------------------------------------------------------------------
// Transaction structure (offsets only — bytes are never decoded/re-encoded)
// ---------------------------------------------------------------------------

interface TxLayout {
  bodyStart: number;
  bodyEnd: number;
  wsetStart: number;
  wsetEnd: number;
}

function locateTxParts(buf: Uint8Array): TxLayout {
  const h = readHead(buf, 0);
  if (h.major !== MAJOR_ARRAY) throw new Error("Transaction is not a CBOR array");
  if (h.indefinite) throw new Error("Indefinite-length transaction array is not supported");
  if (h.arg < 2) throw new Error("Transaction array is too short");
  const bodyStart = h.headEnd;
  const bodyEnd = skipItem(buf, bodyStart);
  const wsetStart = bodyEnd;
  const wsetEnd = skipItem(buf, wsetStart);
  return { bodyStart, bodyEnd, wsetStart, wsetEnd };
}

export interface AddWitnessResult {
  txHex: string;
  added: number; // newly inserted witnesses
  duplicates: number; // skipped because that pubkey was already present
}

// Splice additional vkey witnesses into a transaction, preserving every other
// byte exactly (body hash and existing signatures stay valid).
export function addVkeyWitnesses(txHex: string, toAdd: VkeyWitness[]): AddWitnessResult {
  const buf = hexToBytes(txHex);
  const layout = locateTxParts(buf);
  const wsetBuf = buf.slice(layout.wsetStart, layout.wsetEnd);

  const head = readHead(wsetBuf, 0);
  if (head.major !== MAJOR_MAP) throw new Error("Witness set is not a CBOR map");
  if (head.indefinite) throw new Error("Indefinite-length witness set is not supported");

  // Walk the witness-set map, copying every entry's raw bytes. Capture key 0
  // (vkey witnesses) so we can merge into it.
  let p = head.headEnd;
  const otherEntries: Uint8Array[] = []; // raw key+value bytes for keys != 0
  let existingVkeys: VkeyWitness[] = [];
  for (let i = 0; i < head.arg; i++) {
    const entryStart = p;
    const keyHead = readHead(wsetBuf, p);
    const valueStart = keyHead.headEnd;
    const valueEnd = skipItem(wsetBuf, valueStart);
    if (keyHead.major === MAJOR_UNSIGNED && keyHead.arg === 0) {
      existingVkeys = readVkeyArray(wsetBuf, valueStart);
    } else {
      otherEntries.push(wsetBuf.slice(entryStart, valueEnd));
    }
    p = valueEnd;
  }

  // Merge, deduping by public key.
  const seen = new Set(existingVkeys.map((w) => bytesToHex(w.vkey)));
  const merged = [...existingVkeys];
  let added = 0;
  let duplicates = 0;
  for (const w of toAdd) {
    const k = bytesToHex(w.vkey);
    if (seen.has(k)) {
      duplicates += 1;
      continue;
    }
    seen.add(k);
    merged.push(w);
    added += 1;
  }

  // Rebuild key 0's array and the whole witness-set map. Key 0 is the smallest
  // unsigned key, so it sorts first — emit it, then the untouched entries.
  const key0Array = concatBytes(encodeHead(MAJOR_ARRAY, merged.length), ...merged.map(encodeVkeyWitness));
  const key0Entry = concatBytes(encodeHead(MAJOR_UNSIGNED, 0), key0Array);
  const mapCount = otherEntries.length + (merged.length > 0 ? 1 : 0);
  const newWsetParts: Uint8Array[] = [encodeHead(MAJOR_MAP, mapCount)];
  if (merged.length > 0) newWsetParts.push(key0Entry);
  newWsetParts.push(...otherEntries);
  const newWset = concatBytes(...newWsetParts);

  // Splice: everything before the witness set + new witness set + everything after.
  const newTx = concatBytes(buf.slice(0, layout.wsetStart), newWset, buf.slice(layout.wsetEnd));
  return { txHex: bytesToHex(newTx), added, duplicates };
}

// ---------------------------------------------------------------------------
// Hashing & signature verification
// ---------------------------------------------------------------------------

// blake2b-256 of the transaction body's exact CBOR bytes — the signing hash /
// transaction id that every vkey witness signs.
export function txBodyHash(txHex: string): Uint8Array {
  const buf = hexToBytes(txHex);
  const layout = locateTxParts(buf);
  return blake2b(buf.slice(layout.bodyStart, layout.bodyEnd), { dkLen: 32 });
}

// blake2b-224 of a public key — the key hash used in required_signers and in
// the validator's `missing_key_hash`.
export function vkeyHash(vkey: Uint8Array): string {
  return bytesToHex(blake2b(vkey, { dkLen: 28 }));
}

export function verifySignature(bodyHash: Uint8Array, w: VkeyWitness): boolean {
  try {
    return ed25519.verify(w.signature, bodyHash, w.vkey);
  } catch {
    return false;
  }
}
