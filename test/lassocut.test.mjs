// node --test cli/test
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, resolveConfig, expandInputs, outputPath, run, DEFAULT_API_URL, UsageError } from "../lassocut.mjs";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

async function tmpdir() {
  return mkdtemp(path.join(os.tmpdir(), "lassocut-"));
}

// A fake API that records each request and answers with the given status/body.
async function fakeApi(respond) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      const fields = Object.fromEntries([...body.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)].map((m) => [m[1], m[2]]));
      const files = [...body.matchAll(/name="([^"]+)"; filename="([^"]+)"/g)].map((m) => [m[1], m[2]]);
      seen.push({ url: req.url, key: req.headers["x-api-key"], fields, files });
      respond(res, seen.length);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/v1.0`, seen, close: () => server.close() };
}

const ok = (res) => { res.writeHead(200, { "Content-Type": "image/png", "X-Credits-Charged": "0.25" }); res.end(PNG); };
const quiet = { log: () => {}, error: () => {} };

test("flags: values, inline values, repeatable options, aliases", () => {
  const { opts, inputs } = parseArgs(["--size", "full", "--bg-color=fff", "--extra-api-option", "crop=true",
    "--extra-api-option", "roi=0 0 50% 50%", "-h", "a.jpg"]);
  assert.equal(opts.size, "full");
  assert.equal(opts["bg-color"], "fff");
  assert.deepEqual(opts["extra-api-option"], ["crop=true", "roi=0 0 50% 50%"]);
  assert.equal(opts.help, true);
  assert.deepEqual(inputs, ["a.jpg"]);
  assert.throws(() => parseArgs(["--nope"]), UsageError);
  assert.throws(() => parseArgs(["--size"]), UsageError);
});

test("config: key and URL from flags, then LASSOCUT_*, then REMOVE_BG_*", () => {
  assert.throws(() => resolveConfig({ "extra-api-option": [] }, {}), UsageError);
  let cfg = resolveConfig({ "extra-api-option": [] }, { REMOVE_BG_API_KEY: "old" });
  assert.equal(cfg.apiKey, "old");
  assert.equal(cfg.apiUrl, DEFAULT_API_URL);
  cfg = resolveConfig({ "extra-api-option": [] }, { REMOVE_BG_API_KEY: "old", LASSOCUT_API_KEY: "new", LASSOCUT_API_URL: "https://x.test/v1.0/" });
  assert.equal(cfg.apiKey, "new");
  assert.equal(cfg.apiUrl, "https://x.test/v1.0");
  cfg = resolveConfig({ "api-key": "flag", "api-url": "https://y.test/v1.0", "extra-api-option": ["crop=true"] }, { LASSOCUT_API_KEY: "env" });
  assert.equal(cfg.apiKey, "flag");
  assert.equal(cfg.apiUrl, "https://y.test/v1.0");
  assert.deepEqual(cfg.fields, { size: "auto", type: "auto", format: "png", channels: "rgba", crop: "true" });
  assert.throws(() => resolveConfig({ "api-key": "k", format: "gif", "extra-api-option": [] }, {}), UsageError);
});

test("inputs: files, folders and patterns; output names keep the -removebg suffix", async () => {
  const dir = await tmpdir();
  for (const n of ["a.jpg", "b.PNG", "notes.txt"]) await writeFile(path.join(dir, n), "x");
  assert.deepEqual(await expandInputs([dir]), [path.join(dir, "a.jpg"), path.join(dir, "b.PNG")]);
  assert.deepEqual(await expandInputs([path.join(dir, "*.jpg")]), [path.join(dir, "a.jpg")]);
  const cfg = resolveConfig({ "api-key": "k", "extra-api-option": [] }, {});
  assert.equal(outputPath(path.join(dir, "a.jpg"), cfg), path.join(dir, "a-removebg.png"));
  const cfg2 = resolveConfig({ "api-key": "k", "output-directory": "out", "output-suffix": "", format: "webp", "extra-api-option": [] }, {});
  assert.equal(outputPath(path.join(dir, "a.jpg"), cfg2), path.join("out", "a.webp"));
});

test("processes images against the API and writes the results", async () => {
  const api = await fakeApi(ok);
  const dir = await tmpdir();
  await writeFile(path.join(dir, "a.jpg"), "img-a");
  await writeFile(path.join(dir, "b.jpg"), "img-b");
  await writeFile(path.join(dir, "bg.jpg"), "bg");
  const code = await run(["--api-key", "k", "--api-url", api.url, "--size", "preview", "--bg-image-file",
    path.join(dir, "bg.jpg"), "--extra-api-option", "crop=true", path.join(dir, "a.jpg"), path.join(dir, "b.jpg")], quiet);
  api.close();
  assert.equal(code, 0);
  assert.equal(api.seen.length, 2);
  for (const r of api.seen) {
    assert.equal(r.url, "/v1.0/removebg");
    assert.equal(r.key, "k");
    assert.deepEqual(r.fields, { size: "preview", type: "auto", format: "png", channels: "rgba", crop: "true" });
    assert.deepEqual(r.files.map((f) => f[0]).sort(), ["bg_image_file", "image_file"]);
  }
  assert.deepEqual(await readFile(path.join(dir, "a-removebg.png")), PNG);
  assert.ok(existsSync(path.join(dir, "b-removebg.png")));
});

test("skips existing results unless --reprocess-existing", async () => {
  const api = await fakeApi(ok);
  const dir = await tmpdir();
  await writeFile(path.join(dir, "a.jpg"), "img");
  await writeFile(path.join(dir, "a-removebg.png"), "old");
  await run(["--api-key", "k", "--api-url", api.url, path.join(dir, "a.jpg")], quiet);
  assert.equal(api.seen.length, 0);
  await run(["--api-key", "k", "--api-url", api.url, "--reprocess-existing", path.join(dir, "a.jpg")], quiet);
  api.close();
  assert.equal(api.seen.length, 1);
});

test("reports API errors, retries 429 after Retry-After, exits 1 on failure", async () => {
  const api = await fakeApi((res, n) => {
    if (n === 1) { res.writeHead(429, { "Retry-After": "0", "Content-Type": "application/json" }); return res.end("{}"); }
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ errors: [{ title: "Could not identify foreground in image." }] }));
  });
  const dir = await tmpdir();
  await writeFile(path.join(dir, "a.jpg"), "img");
  const errors = [];
  const code = await run(["--api-key", "k", "--api-url", api.url, path.join(dir, "a.jpg")], { log: () => {}, error: (m) => errors.push(m) });
  api.close();
  assert.equal(code, 1);
  assert.equal(api.seen.length, 2);
  assert.match(errors[0], /Could not identify foreground/);
});

test("asks before large batches; -1 never asks", async () => {
  const api = await fakeApi(ok);
  const dir = await tmpdir();
  const files = [];
  for (const n of ["a", "b", "c"]) { files.push(path.join(dir, `${n}.jpg`)); await writeFile(files.at(-1), "x"); }
  let asked = 0;
  const code = await run(["--api-key", "k", "--api-url", api.url, "--confirm-batch-over", "2", ...files],
    { ...quiet, confirm: async () => { asked++; return false; } });
  assert.equal(code, 1);
  assert.equal(asked, 1);
  assert.equal(api.seen.length, 0);
  await run(["--api-key", "k", "--api-url", api.url, "--confirm-batch-over", "-1", ...files],
    { ...quiet, confirm: async () => { asked++; return false; } });
  api.close();
  assert.equal(asked, 1);
  assert.equal(api.seen.length, 3);
});

test("login: opens lassocut, waits for approval, saves the key; logout forgets it", async () => {
  let polls = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url.startsWith("/v1.0/connect/")) res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/v1.0/connect/start") {
        assert.equal(JSON.parse(body).client, "cli");
        res.end(JSON.stringify({ device_code: "dev", user_code: "ABCD-EFGH", verification_url: "https://www.lassocut.com/connect/?code=ABCD-EFGH", interval: 0, expires_in: 60 }));
      } else if (req.url === "/v1.0/connect/poll") {
        polls++;
        res.end(JSON.stringify(polls < 2 ? { status: "pending" } : { status: "approved", api_key: "rbg_from_login" }));
      } else {
        assert.equal(req.headers["x-api-key"], "rbg_from_login");   // later runs use the saved key
        res.writeHead(200, { "Content-Type": "image/png" }); res.end(PNG);
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = await tmpdir();
  const env = { LASSOCUT_API_URL: `http://127.0.0.1:${server.address().port}/v1.0`, LASSOCUT_CONFIG: path.join(dir, "config.json") };
  const opened = [], lines = [];
  try {
    const code = await run(["login"], { env, log: (l) => lines.push(l), error: () => {}, openUrl: (u) => opened.push(u), sleep: async () => {} });
    assert.equal(code, 0);
    assert.deepEqual(opened, ["https://www.lassocut.com/connect/?code=ABCD-EFGH"]);
    assert.ok(lines.some((l) => l.includes("ABCD-EFGH")));
    assert.equal(JSON.parse(await readFile(env.LASSOCUT_CONFIG, "utf8")).api_key, "rbg_from_login");
    const img = path.join(dir, "a.jpg");
    await writeFile(img, PNG);
    assert.equal(await run([img], { env, ...quiet }), 0);
    assert.equal(await run(["logout"], { env, ...quiet }), 0);
    assert.equal(existsSync(env.LASSOCUT_CONFIG), false);
    assert.throws(() => resolveConfig(parseArgs([img]).opts, env), /lassocut login/);
  } finally {
    server.close();
  }
});
