/**
 * Builds dist/billwatch-human.mjs: the human pages as ONE self-contained module for the live
 * Pages _worker.js. It has no imports, so it works whether the deploy bundles _worker.js,
 * uses a _worker.js/ directory, or uploads a single unbundled file (paste mode).
 *
 *   npm run build            write dist/billwatch-human.mjs
 *   npm run build -- --check fail if the committed file is out of date
 *
 * The module graph is ours and deliberately simple, so a small, strict transform is enough:
 * each source module is wrapped in its own function scope (no name collisions), its
 * `import { a } from './x.mjs'` lines become `const { a } = __x;`, and its `export` keywords
 * are dropped and collected. Anything outside that subset fails the build loudly.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('src/', ROOT);
export const OUTPUT = new URL('dist/billwatch-human.mjs', ROOT);
const ENTRY = 'app';
// Public surface of the bundle: [exported name, source module].
const PUBLIC = [['handleHumanRequest', 'app'], ['ownsHumanRoute', 'routes']];

const IMPORT_LINE = /^import\s*\{([^}]*)\}\s*from\s*'\.\/([a-z0-9-]+)\.mjs';?\s*$/;
const EXPORT_DECL = /^export\s+(?:async\s+function\*?|function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/;
// Worker code may only read data through env.ASSETS and env.BILLWATCH_CLICKS. These patterns
// keep network access, Node-only APIs, tracking parameters and literal prices out of the bundle.
const FORBIDDEN = [
  [/\bimport\s*\(|\bimport\.meta\b/, 'dynamic import or import.meta'],
  [/\brequire\s*\(/, 'require()'],
  [/\bprocess\./, 'Node process object'],
  [/(?:^|[^.\w$])fetch\s*\(|\b(?:globalThis|self)\.fetch\b/, 'global fetch (use env.ASSETS)'],
  [/[?&](?:ref|aff|affid|aff_id|affiliate|utm_[a-z]+|coupon|partner|clickid|irclickid|gclid|fbclid)=/i, 'affiliate or tracking parameter'],
  [/\$\s?\d/, 'literal dollar price'],
];

const variable = (name) => `__${name.replace(/[^A-Za-z0-9_$]/g, '_')}`;

async function load(name, modules, stack = []) {
  if (modules.has(name)) return;
  if (stack.includes(name)) throw new Error(`Import cycle: ${[...stack, name].join(' -> ')}`);
  const source = await readFile(new URL(`${name}.mjs`, SRC), 'utf8');
  const deps = [];
  for (const line of source.split('\n')) {
    const match = IMPORT_LINE.exec(line);
    if (match) deps.push(match[2]);
  }
  for (const dep of deps) await load(dep, modules, [...stack, name]);
  modules.set(name, source); // insertion order = dependencies first
}

function transform(name, source) {
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(source)) throw new Error(`src/${name}.mjs: ${label} is not allowed in worker code.`);
  }
  const exported = [];
  const body = source.split('\n').map((line, index) => {
    const where = `src/${name}.mjs:${index + 1}`;
    const imported = IMPORT_LINE.exec(line);
    if (imported) {
      const names = imported[1].split(',').map((part) => part.trim()).filter(Boolean).map((spec) => {
        const [from, local] = spec.split(/\s+as\s+/);
        if (!/^[A-Za-z_$][\w$]*$/.test(from) || (local && !/^[A-Za-z_$][\w$]*$/.test(local))) throw new Error(`${where}: unsupported import "${spec}".`);
        return local ? `${from}: ${local}` : from;
      });
      return `const { ${names.join(', ')} } = ${variable(imported[2])};`;
    }
    if (/^\s*import\b/.test(line)) throw new Error(`${where}: only single-line named imports from ./*.mjs are supported.`);
    const declared = EXPORT_DECL.exec(line);
    if (declared) {
      exported.push(declared[1]);
      return line.replace(/^export\s+/, '');
    }
    if (/^\s*export\b/.test(line)) throw new Error(`${where}: only "export function/const/let/class" declarations are supported.`);
    return line;
  });
  return { body: body.join('\n').trimEnd(), exported };
}

export async function bundle() {
  const modules = new Map();
  await load(ENTRY, modules);
  const digest = createHash('sha256');
  const parts = [];
  const exportsOf = new Map();
  for (const [name, source] of modules) {
    digest.update(`${name}\n${source}\n`);
    const { body, exported } = transform(name, source);
    exportsOf.set(name, exported);
    parts.push(`// ---- src/${name}.mjs\nconst ${variable(name)} = (() => {\n${body}\nreturn Object.freeze({ ${exported.join(', ')} });\n})();`);
  }
  for (const [name, module] of PUBLIC) {
    if (!exportsOf.get(module)?.includes(name)) throw new Error(`Public name ${name} is not exported by src/${module}.mjs.`);
  }
  const surface = PUBLIC.map(([name, module]) => `${name}: ${variable(module)}.${name}`).join(', ');
  return [
    '// BillWatch human pages: worker module. GENERATED FILE, do not edit by hand.',
    '// Built by human-site/scripts/build.mjs from human-site/src/ (run `npm run build` in human-site/).',
    `// Source digest (sha256): ${digest.digest('hex')}`,
    '// Defines one name, BillWatchHuman. No imports, no network requests, no secrets, no prices.',
    '// Wiring, homepage switch and paste-mode instructions: human-site/RUNBOOK.md.',
    '',
    'const BillWatchHuman = (() => {',
    parts.join('\n\n'),
    '',
    `return Object.freeze({ ${surface} });`,
    '})();',
    '',
    'export { BillWatchHuman };',
    '',
  ].join('\n');
}

async function main() {
  const text = await bundle();
  if (process.argv.includes('--check')) {
    const current = await readFile(OUTPUT, 'utf8').catch(() => '');
    if (current !== text) {
      console.error('dist/billwatch-human.mjs is out of date. Run `npm run build` in human-site/ and commit the result.');
      process.exitCode = 1;
      return;
    }
    console.log('dist/billwatch-human.mjs is up to date.');
    return;
  }
  await mkdir(new URL('dist/', ROOT), { recursive: true });
  await writeFile(OUTPUT, text);
  console.log(`Wrote ${fileURLToPath(OUTPUT)} (${Buffer.byteLength(text)} bytes). Nothing was deployed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
