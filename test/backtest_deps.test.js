import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// ELI-1172: the replay tool keeps zero dependencies. Only the backtester needs the
// CDP client, so backtest/package.json pins it to one exact version and a committed
// lockfile records its integrity hash. One install command, everywhere it is named.

const url = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFileSync(url(path), "utf8");
const readJson = (path) => JSON.parse(read(path));

const DEP_KEYS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const INSTALL = "npm ci --prefix backtest";
const CDP = "chrome-remote-interface";

// An exact version is plain x.y.z with an optional prerelease or build tag.
// Anything else (^, ~, >=, x, *, a tag name, a hyphen range or ||) is a range.
export function isExactVersion(spec) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(spec);
}

function section(doc, heading) {
  const start = doc.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `doc has a "${heading}" section`);
  const next = doc.indexOf("\n## ", start + 3);
  return doc.slice(start, next === -1 ? undefined : next);
}

test("isExactVersion accepts x.y.z and rejects every range form", () => {
  for (const ok of ["0.33.3", "1.0.0", "2.1.0-beta.1", "1.2.3+build.5"]) {
    assert.equal(isExactVersion(ok), true, ok);
  }
  for (const bad of ["^0.33.3", "~0.33.3", ">=0.33.3", "<1.0.0", "=0.33.3", "0.33.x", "0.33", "*", "",
    "latest", "0.33.3 - 0.34.0", "0.33.3 || 0.34.0", " 0.33.3", "v0.33.3", "git+https://x/y.git"]) {
    assert.equal(isExactVersion(bad), false, JSON.stringify(bad));
  }
});

test("root package.json declares no dependency of any kind and has no lockfile", () => {
  const root = readJson("package.json");
  for (const key of DEP_KEYS) assert.equal(Object.hasOwn(root, key), false, `root package.json has ${key}`);
  assert.equal(existsSync(url("package-lock.json")), false, "root package-lock.json exists");
});

test("backtest/package.json pins chrome-remote-interface to one exact version", () => {
  const pkg = readJson("backtest/package.json");
  assert.equal(pkg.private, true, "backtest/package.json is private so it can never be published");
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [CDP]);
  for (const key of DEP_KEYS) {
    for (const [name, spec] of Object.entries(pkg[key] ?? {})) {
      assert.ok(isExactVersion(spec), `${key}.${name} is a range: ${spec}`);
    }
  }
});

test("backtest/package-lock.json is committed and locks the pinned version with an integrity hash", () => {
  const pkg = readJson("backtest/package.json");
  const lock = readJson("backtest/package-lock.json");
  const pin = pkg.dependencies[CDP];
  assert.ok(lock.lockfileVersion >= 3, `lockfileVersion ${lock.lockfileVersion}`);
  assert.equal(lock.name, pkg.name);
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
  const entries = Object.entries(lock.packages).filter(([path]) => path !== "");
  assert.ok(entries.length > 0, "the lockfile lists the installed packages");
  for (const [path, entry] of entries) {
    assert.match(entry.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//, `${path} resolves from the npm registry`);
    assert.match(entry.integrity ?? "", /^sha512-/, `${path} has a sha512 integrity hash`);
  }
  assert.equal(lock.packages[`node_modules/${CDP}`].version, pin);
});

test("backtest/README.md and read.mjs give the same install command", () => {
  const readme = section(read("backtest/README.md"), "The CDP client");
  assert.ok(readme.includes("```\n" + INSTALL + "\n```"), "backtest/README.md shows the install command in a code block");
  const readMjs = read("backtest/mc_b_dot/read.mjs");
  const loadCdp = readMjs.slice(readMjs.indexOf("\n", readMjs.indexOf("import { pathToFileURL }")), readMjs.indexOf("const USAGE"));
  assert.equal(loadCdp.split(INSTALL).length - 1, 2, "read.mjs names the command in its comment and its error");
  assert.match(loadCdp, new RegExp(`new Error\\(\`[^\`]*${INSTALL}`), "the E_CDP_LIB error names the command");
  for (const [name, text] of [["backtest/README.md", readme], ["read.mjs", loadCdp]]) {
    assert.doesNotMatch(text, /npm install/, `${name} still names npm install`);
  }
});

test("AGENTS.md Setup names the backtest install step", () => {
  const setup = section(read("AGENTS.md"), "Setup");
  assert.ok(setup.includes(INSTALL), "AGENTS.md Setup names npm ci --prefix backtest");
  assert.doesNotMatch(setup, /no lockfile/);
});

test("CI runs node --test without installing anything", () => {
  const workflow = read(".github/workflows/tests.yml");
  assert.doesNotMatch(workflow, /npm (ci|install|i)\b|yarn|pnpm/);
  assert.match(workflow, /^\s*- run: node --test\s*$/m);
});
