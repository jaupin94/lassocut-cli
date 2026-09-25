#!/usr/bin/env node
// lassocut CLI: remove image backgrounds in bulk with the lassocut API.
// Copyright (c) 2026 JAUPIN Design LLC. No dependencies: Node 18+ (fetch, FormData, Blob).
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

export const VERSION = "1.0.0";
export const DEFAULT_API_URL = "https://api.lassocut.com/v1.0";
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".bmp", ".tif", ".tiff"]);
const OUTPUT_EXT = { png: ".png", jpg: ".jpg", webp: ".webp", zip: ".zip" };

// name -> { value: takes a value?, list: repeatable? }
const FLAGS = {
  "api-key": { value: true }, "api-url": { value: true }, size: { value: true }, type: { value: true },
  format: { value: true }, channels: { value: true }, "bg-color": { value: true }, "bg-image-file": { value: true },
  "output-directory": { value: true }, "output-suffix": { value: true }, "confirm-batch-over": { value: true },
  concurrency: { value: true }, "extra-api-option": { value: true, list: true },
  "reprocess-existing": {}, "skip-png-format-optimization": {}, help: {}, version: {},
};
const ALIASES = { h: "help", v: "version" };

export const HELP = `lassocut ${VERSION}: remove image backgrounds from the command line

Usage:
  lassocut [flags] <file | folder | pattern>...

Flags:
  --api-key string             API key, or set LASSOCUT_API_KEY (REMOVE_BG_API_KEY also works)
  --api-url string             API base URL (default "${DEFAULT_API_URL}"), or set LASSOCUT_API_URL
  --size string                preview, full, 50MP or auto (default "auto")
  --type string                auto, person, product, car, animal, graphic, transportation (default "auto")
  --format string              png, jpg, webp or zip (default "png")
  --channels string            rgba or alpha (default "rgba")
  --bg-color string            background colour: hex like 81d4fa, or a name like white
  --bg-image-file string       background image file
  --output-directory string    where results go (default: next to each input)
  --output-suffix string       added to result file names (default "-removebg")
  --reprocess-existing         redo images whose result already exists
  --confirm-batch-over int     ask before processing more images than this, -1 never asks (default 50)
  --concurrency int            images processed at the same time (default 4)
  --extra-api-option k=v       any other API parameter, repeatable (e.g. crop=true)
  -h, --help                   this help
  -v, --version                version

Docs: https://www.lassocut.com/docs/
`;

export function parseArgs(argv) {
  const opts = { "extra-api-option": [] }, inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-") || arg === "-") { inputs.push(arg); continue; }
    let [name, inline] = arg.replace(/^--?/, "").split(/=(.*)/s, 2);
    name = ALIASES[name] || name;
    const spec = FLAGS[name];
    if (!spec) throw new UsageError(`unknown flag: ${arg}`);
    if (!spec.value) { opts[name] = true; continue; }
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined) throw new UsageError(`missing value for --${name}`);
    if (spec.list) opts[name].push(value); else opts[name] = value;
  }
  return { opts, inputs };
}

export class UsageError extends Error {}

export function resolveConfig(opts, env = process.env) {
  const apiKey = opts["api-key"] || env.LASSOCUT_API_KEY || env.REMOVE_BG_API_KEY;
  if (!apiKey) throw new UsageError("an API key is required: --api-key or LASSOCUT_API_KEY");
  const format = (opts.format || "png").toLowerCase();
  if (!OUTPUT_EXT[format]) throw new UsageError(`unsupported --format: ${opts.format}`);
  const int = (v, d, name) => {
    if (v === undefined) return d;
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) throw new UsageError(`--${name} must be a number`);
    return n;
  };
  const fields = {
    size: opts.size || "auto", type: opts.type || "auto", format, channels: opts.channels || "rgba",
  };
  if (opts["bg-color"]) fields.bg_color = opts["bg-color"];
  for (const kv of opts["extra-api-option"]) {
    const eq = kv.indexOf("=");
    if (eq < 1) throw new UsageError(`--extra-api-option needs key=value, got: ${kv}`);
    fields[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return {
    apiKey, fields,
    apiUrl: (opts["api-url"] || env.LASSOCUT_API_URL || env.REMOVE_BG_API_URL || DEFAULT_API_URL).replace(/\/+$/, ""),
    bgImageFile: opts["bg-image-file"],
    outputDirectory: opts["output-directory"],
    suffix: opts["output-suffix"] ?? "-removebg",
    reprocess: Boolean(opts["reprocess-existing"]),
    confirmOver: int(opts["confirm-batch-over"], 50, "confirm-batch-over"),
    concurrency: Math.max(1, int(opts.concurrency, 4, "concurrency")),
  };
}

// Files, folders (their images, not recursive) and simple * ? patterns in the file name part.
export async function expandInputs(inputs) {
  const out = [];
  for (const input of inputs) {
    if (/[*?]/.test(path.basename(input))) {
      const dir = path.dirname(input), re = globToRegExp(path.basename(input));
      const names = existsSync(dir) ? await readdir(dir) : [];
      out.push(...names.filter((n) => re.test(n)).sort().map((n) => path.join(dir, n)));
    } else if (existsSync(input) && (await stat(input)).isDirectory()) {
      const names = (await readdir(input)).filter((n) => IMAGE_EXT.has(path.extname(n).toLowerCase())).sort();
      out.push(...names.map((n) => path.join(input, n)));
    } else {
      out.push(input);
    }
  }
  return [...new Set(out)];
}

function globToRegExp(pattern) {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}

export function outputPath(input, cfg) {
  const { name, dir } = path.parse(input);
  return path.join(cfg.outputDirectory || dir, `${name}${cfg.suffix}${OUTPUT_EXT[cfg.fields.format]}`);
}

async function callApi(file, cfg, attempt = 1) {
  const form = new FormData();
  form.append("image_file", new Blob([await readFile(file)]), path.basename(file));
  if (cfg.bgImageFile) form.append("bg_image_file", new Blob([await readFile(cfg.bgImageFile)]), path.basename(cfg.bgImageFile));
  for (const [k, v] of Object.entries(cfg.fields)) form.append(k, v);
  const res = await fetch(`${cfg.apiUrl}/removebg`, {
    method: "POST", body: form,
    headers: { "X-Api-Key": cfg.apiKey, "User-Agent": `lassocut-cli/${VERSION}` },
  });
  if ((res.status === 429 || res.status === 503) && attempt < 5) {
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait * 1000));
    return callApi(file, cfg, attempt + 1);
  }
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try { const e = (await res.json()).errors?.[0]; if (e) reason = e.title + (e.detail ? `: ${e.detail}` : ""); } catch {}
    throw new Error(reason);
  }
  return { bytes: Buffer.from(await res.arrayBuffer()), credits: Number(res.headers.get("x-credits-charged") || 0) };
}

export async function run(argv, { log = console.log, error = console.error, confirm = askYesNo, env = process.env } = {}) {
  let parsed, cfg;
  try {
    parsed = parseArgs(argv);
    if (parsed.opts.help || (!parsed.inputs.length && !parsed.opts.version)) { log(HELP); return parsed.opts.help ? 0 : 2; }
    if (parsed.opts.version) { log(VERSION); return 0; }
    cfg = resolveConfig(parsed.opts, env);
  } catch (e) {
    if (e instanceof UsageError) { error(`Error: ${e.message}`); return 2; }
    throw e;
  }
  const files = await expandInputs(parsed.inputs);
  if (cfg.confirmOver >= 0 && files.length > cfg.confirmOver && !(await confirm(`Process ${files.length} images?`))) return 1;
  if (cfg.outputDirectory) await mkdir(cfg.outputDirectory, { recursive: true });

  let failed = 0, credits = 0, next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++], out = outputPath(file, cfg);
      if (!cfg.reprocess && existsSync(out)) { log(`skipped   ${file} (result exists)`); continue; }
      try {
        if (!existsSync(file)) throw new Error("file not found");
        const r = await callApi(file, cfg);
        await writeFile(out, r.bytes);
        credits += r.credits;
        log(`done      ${file} -> ${out}`);
      } catch (e) {
        failed++;
        error(`failed    ${file}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, files.length) }, worker));
  log(`${files.length - failed} of ${files.length} images processed, ${+credits.toFixed(2)} credits used`);
  return failed ? 1 : 0;
}

async function askYesNo(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
