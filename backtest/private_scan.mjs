// ELI-778: the rules private_data.test.mjs uses to keep private data out of this public repo.
// They live here so private_scan.test.mjs can check each rule against known leaks.
import { spawnSync } from 'node:child_process';

// Chart ids the tests and the fake chart use. AbC123xy is the made-up valid id in config.test.mjs.
// Any other id would be a real layout.
export const FAKE_CHART_IDS = new Set(['FAKETAB1', 'FAKETAB2', 'Cand1', 'AbC123xy']);

const HOME_RULES = [
  ['windows home', /[A-Za-z]:[\\/]+Users[\\/]/i],
  ['windows appdata', /AppData[\\/]/i],
  ['windows home variable', /%(USERPROFILE|LOCALAPPDATA|APPDATA|HOMEPATH)%/i],
  ['unix home', /(^|[^A-Za-z0-9_.-])\/(home|Users)\/[A-Za-z0-9._-]+/],
];

/** Names of the home-folder rules the text breaks. Empty when it has no home path. */
export function findHomePaths(text) {
  return HOME_RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** Chart layout ids in the text that are not one of the fake ids. */
export function findChartIds(text) {
  const hits = [];
  const patterns = [
    /\/chart\/([A-Za-z0-9]+)(?![A-Za-z0-9])/g,
    /MC_TAB1_LAYOUT_ID\s*=\s*['"]?([A-Za-z0-9]+)/g,
    /MC_TAB1_LAYOUT_ID['"]?\s*:\s*['"]([A-Za-z0-9]+)['"]/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (!FAKE_CHART_IDS.has(m[1])) hits.push(m[1]);
    }
  }
  return hits;
}

/** True for a report, strategy note, trade log or data file that must not be committed. */
export function isPrivateBacktestPath(p) {
  const base = p.split('/').pop();
  return /\.html?$/i.test(p)
    || /master_market_cypher/i.test(p)
    || /(^|\/)handoffs?(\/|$)/i.test(p)
    || /(^|\/)findings[^/]*$/i.test(p)
    || /\.(json|jsonl|ndjson|csv|tsv)$/i.test(p)
    || /trade_?log|fills/i.test(base)
    || (/\.md$/i.test(base) && /report|result|findings|handoff|trades/i.test(base));
}

/** Every file git would commit from root: tracked plus untracked, minus ignored. */
export function committableFiles(root) {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean);
}
