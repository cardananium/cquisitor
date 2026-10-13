// One line about the registry copy in use. The view shows it beside every
// registry label, so the viewer can see what the name rests on.

import type { RegistryState } from "./registry";

export function describeRegistrySource(state: RegistryState): string {
  const count = state.bundle.scripts.size;
  if (count === 0) {
    return state.status === "ready" ? "No registry data is loaded." : "Loading the registry…";
  }
  const scripts = `${count} scripts`;
  if (state.bundle.source === "network" && state.fetchedAt) {
    return `${scripts} · fetched ${new Date(state.fetchedAt).toISOString().slice(0, 10)} from raw.githubusercontent.com`;
  }
  return `${scripts} · snapshot shipped with the app`;
}

/** The upstream generation time of the copy in use, when it reported one. */
export function describeRegistryAge(state: RegistryState): string {
  return state.bundle.generatedAt
    ? `The registry generated this index ${state.bundle.generatedAt.slice(0, 10)}.`
    : "";
}
