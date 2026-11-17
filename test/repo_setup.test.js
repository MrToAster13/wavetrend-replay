import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ELI-1174: the CI matrix, the stated Node minimum and the test-command docs
// must agree, so a promise in the docs is one CI actually checks.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = read(".github/workflows/tests.yml");
const readme = read("README.md");
const agents = read("AGENTS.md");
const engines = JSON.parse(read("package.json")).engines.node;

function matrixVersions() {
  const line = workflow.match(/^\s*node-version:\s*\[(.*)\]\s*$/m);
  assert.ok(line, "tests.yml has a node-version matrix line");
  return line[1].split(",").map((v) => Number(v.trim().replace(/["']/g, "")));
}

function section(doc, heading) {
  const start = doc.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `AGENTS.md has a "${heading}" section`);
  const next = doc.indexOf("\n## ", start + 3);
  return doc.slice(start, next === -1 ? undefined : next);
}

test("the CI matrix tests exactly the LTS lines 22 and 24", () => {
  assert.deepEqual(matrixVersions(), [22, 24]);
});

test("package.json, README and AGENTS.md name the lowest Node version in the matrix", () => {
  const floor = Math.min(...matrixVersions());
  assert.equal(engines, `>=${floor}.0.0`);
  assert.match(readme, new RegExp(`Node ${floor}\\+`));
  assert.doesNotMatch(readme, /Node (1[0-9]|2[01])\+/);
  assert.match(section(agents, "Setup"), new RegExp(`Node ${floor} or newer`));
});

test("the tests workflow gives the job token read-only contents access", () => {
  assert.match(workflow, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
});

test("AGENTS.md and README name both test globs node --test runs", () => {
  const command = section(agents, "Full test command");
  for (const doc of [command, readme]) {
    assert.ok(doc.includes("test/*.test.js"), "names test/*.test.js");
    assert.ok(doc.includes("backtest/**/*.test.mjs"), "names backtest/**/*.test.mjs");
  }
});

test("AGENTS.md names the Node versions CI runs", () => {
  const command = section(agents, "Full test command");
  assert.match(command, /Node 22 and 24/);
  assert.doesNotMatch(command, /Node 18/);
});
