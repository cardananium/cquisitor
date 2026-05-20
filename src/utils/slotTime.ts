import type { NetworkType } from "@cardananium/cquisitor-lib";

// Post-Shelley anchors: (zero-slot, zero-time in seconds since epoch).
// One slot = 1 second post-Shelley. Pre-Shelley/Byron slots are not handled
// here — they predate any timelock/TTL field users will see.
//
// Mainnet:  Shelley start at slot 4_492_800, 2020-07-29 21:44:51 UTC
// Preprod:  Shelley start at slot 86_400,   2022-06-21 00:00:00 UTC
// Preview:  no Byron era,                    2022-10-25 00:00:00 UTC
const ANCHORS: Record<NetworkType, { zeroSlot: number; zeroTimeSec: number }> = {
  mainnet: { zeroSlot: 4_492_800, zeroTimeSec: 1_596_059_091 },
  preprod: { zeroSlot: 86_400, zeroTimeSec: 1_655_769_600 },
  preview: { zeroSlot: 0, zeroTimeSec: 1_666_656_000 },
};

export function slotToDate(slot: number | bigint, network: NetworkType): Date {
  const slotNum = typeof slot === "bigint" ? Number(slot) : slot;
  const { zeroSlot, zeroTimeSec } = ANCHORS[network];
  return new Date((zeroTimeSec + (slotNum - zeroSlot)) * 1000);
}

export function formatSlotDate(slot: number | bigint, network: NetworkType): string {
  const d = slotToDate(slot, network);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

export function formatDurationSeconds(sec: number): string {
  const abs = Math.abs(sec);
  const fmt = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (abs < 60) return fmt(abs, "second");
  if (abs < 3600) return fmt(Math.round(abs / 60), "minute");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "hour");
  if (abs < 86400 * 30) return fmt(Math.round(abs / 86400), "day");
  if (abs < 86400 * 365) return fmt(Math.round(abs / (86400 * 30)), "month");
  return fmt(Math.round(abs / (86400 * 365)), "year");
}

export function formatSlotRelative(slot: number | bigint, network: NetworkType, now: Date = new Date()): string {
  const target = slotToDate(slot, network).getTime();
  const diffSec = Math.round((target - now.getTime()) / 1000);
  return `${formatDurationSeconds(diffSec)} ${diffSec >= 0 ? "from now" : "ago"}`;
}
