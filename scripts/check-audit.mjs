// CI dependency audit: fails on any high or critical advisory, except the
// accepted ones listed below. An entry needs a reason and a date to look again.
// Run: node scripts/check-audit.mjs
import { execFileSync } from "node:child_process";

const ACCEPTED = new Map([
  [
    "GHSA-fc5q-39xc-vjpf",
    // picomatch ReDoS via repeated extglobs. Every picomatch version is affected
    // and no fix is released (2026-11-18). It reaches us only through build and
    // test tooling (vite, tinyglobby, vitest), which match globs from this
    // repo's own config, never user input. Remove once a fixed picomatch ships.
    "no fixed release; build-time globs only",
  ],
]);

let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
  raw = error.stdout;
  if (!raw) throw error;
}

const report = JSON.parse(raw);
const blocking = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via !== "object" || !["high", "critical"].includes(via.severity)) continue;
    const id = via.url?.split("/").pop() ?? via.title;
    if (!ACCEPTED.has(id)) blocking.set(id, `${via.severity}: ${via.title} (${via.url})`);
  }
}

if (blocking.size > 0) {
  console.error("Blocking advisories:");
  for (const line of blocking.values()) console.error(`  ${line}`);
  console.error("Fix them, or add a dated, reasoned entry to ACCEPTED in scripts/check-audit.mjs.");
  process.exit(1);
}
console.log(`Audit clean (accepted: ${[...ACCEPTED.keys()].join(", ") || "none"}).`);
