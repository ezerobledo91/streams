#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const HTTP_OK_STATUSES = new Set([200, 201, 202, 203, 204, 206, 301, 302, 303, 307, 308, 401, 403, 405]);
const ACCEPTED_EXTENSIONS = new Set([".m3u", ".m3u8"]);
const HTTP_PROTOCOL_RE = /^https?:\/\//i;

function parseArgs(argv) {
  const options = {
    input: "C:\\Users\\ezerr\\OneDrive\\Escritorio\\Ezequiel\\apps\\listas m3u\\_curated",
    output: "",
    timeoutMs: 3200,
    concurrency: 20,
    retries: 1,
    httpOnly: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) {
      options.input = argv[++i];
      continue;
    }
    if (arg === "--output" && argv[i + 1]) {
      options.output = argv[++i];
      continue;
    }
    if (arg === "--timeout" && argv[i + 1]) {
      options.timeoutMs = Number.parseInt(argv[++i], 10) || options.timeoutMs;
      continue;
    }
    if (arg === "--concurrency" && argv[i + 1]) {
      options.concurrency = Number.parseInt(argv[++i], 10) || options.concurrency;
      continue;
    }
    if (arg === "--retries" && argv[i + 1]) {
      options.retries = Number.parseInt(argv[++i], 10) || options.retries;
      continue;
    }
    if (arg === "--http-only") {
      options.httpOnly = true;
      continue;
    }
  }

  options.input = path.resolve(options.input);
  if (!options.output) {
    const base = options.input.endsWith("_curated")
      ? `${options.input}_alive`
      : path.join(options.input, "_alive");
    options.output = path.resolve(base);
  } else {
    options.output = path.resolve(options.output);
  }

  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function canonicalizeUrl(raw) {
  const value = String(raw || "").trim();
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function walkPlaylistFiles(rootDir) {
  const out = [];
  const queue = [rootDir];

  while (queue.length) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || /_alive$/i.test(entry.name)) continue;
        queue.push(fullPath);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (ACCEPTED_EXTENSIONS.has(ext)) {
        out.push(fullPath);
      }
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function extractNameFromExtinf(extinf) {
  const raw = String(extinf || "");
  const commaIndex = raw.indexOf(",");
  const name = commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw;
  return name.replace(/^#EXTINF:[^,]*,?/i, "").trim() || "Canal";
}

function parseM3uFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = content.split("\n");
  const entries = [];
  let pendingExtinf = "";

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) continue;

    if (/^#EXTINF:/i.test(line)) {
      pendingExtinf = line;
      continue;
    }

    if (line.startsWith("#")) continue;

    if (/^(https?|rtmp|rtsp|udp|mms):\/\//i.test(line)) {
      const extinf = pendingExtinf || `#EXTINF:-1,${line}`;
      entries.push({
        extinf,
        name: extractNameFromExtinf(extinf),
        url: line
      });
      pendingExtinf = "";
    }
  }

  return entries;
}

async function probeUrl(url, timeoutMs, retries) {
  if (!HTTP_PROTOCOL_RE.test(url)) {
    return {
      ok: true,
      status: "skip-non-http",
      reason: "non-http protocol"
    };
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          range: "bytes=0-1",
          "user-agent": "m3u-probe/1.0"
        },
        signal: controller.signal
      });
      if (HTTP_OK_STATUSES.has(response.status)) {
        return {
          ok: true,
          status: response.status,
          reason: "alive"
        };
      }
      if (attempt === retries) {
        return {
          ok: false,
          status: response.status,
          reason: `http-${response.status}`
        };
      }
    } catch (error) {
      if (attempt === retries) {
        return {
          ok: false,
          status: "error",
          reason: error?.name === "AbortError" ? "timeout" : (error?.message || "network-error")
        };
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, status: "error", reason: "unknown" };
}

async function probeMany(urls, options) {
  const unique = [...new Set(urls.map((url) => canonicalizeUrl(url)))];
  const results = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const index = cursor++;
      const url = unique[index];
      const result = await probeUrl(url, options.timeoutMs, options.retries);
      results.set(url, result);
    }
  }

  const workers = [];
  const amount = Math.max(1, options.concurrency);
  for (let i = 0; i < amount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

function buildOutputM3u(entries, title) {
  const lines = [`#EXTM3U x-tvg-name="${title}"`];
  for (const entry of entries) {
    lines.push(entry.extinf);
    lines.push(entry.url);
  }
  return `${lines.join("\n")}\n`;
}

function writeAliveOutputs(parsedByFile, probeMap, options) {
  ensureDir(options.output);
  const report = {
    generatedAt: new Date().toISOString(),
    input: options.input,
    output: options.output,
    options: {
      timeoutMs: options.timeoutMs,
      concurrency: options.concurrency,
      retries: options.retries,
      httpOnly: options.httpOnly
    },
    totals: {
      files: parsedByFile.length,
      entries: 0,
      alive: 0,
      dead: 0,
      skippedNonHttp: 0
    },
    perFile: [],
    deadLinks: []
  };

  for (const item of parsedByFile) {
    const relative = path.relative(options.input, item.filePath);
    const outPath = path.join(options.output, relative);
    ensureDir(path.dirname(outPath));

    const aliveEntries = [];
    let deadCount = 0;
    let skippedNonHttp = 0;

    for (const entry of item.entries) {
      const key = canonicalizeUrl(entry.url);
      const probe = probeMap.get(key) || { ok: false, status: "missing", reason: "missing-probe" };
      const isNonHttp = probe.status === "skip-non-http";
      const keep = probe.ok && (!options.httpOnly || !isNonHttp);

      report.totals.entries += 1;
      if (isNonHttp) {
        report.totals.skippedNonHttp += 1;
        skippedNonHttp += 1;
      }

      if (keep) {
        aliveEntries.push(entry);
        report.totals.alive += 1;
      } else {
        deadCount += 1;
        report.totals.dead += 1;
        report.deadLinks.push({
          file: relative,
          name: entry.name,
          url: entry.url,
          status: probe.status,
          reason: probe.reason
        });
      }
    }

    const title = path.basename(relative, path.extname(relative));
    fs.writeFileSync(outPath, buildOutputM3u(aliveEntries, `${title} (alive)`), "utf8");

    report.perFile.push({
      file: relative,
      total: item.entries.length,
      alive: aliveEntries.length,
      dead: deadCount,
      skippedNonHttp
    });
  }

  const deadTxtPath = path.join(options.output, "dead_links.txt");
  const deadTxt = report.deadLinks
    .map((item) => `${item.file} | ${item.name} | ${item.status} | ${item.reason} | ${item.url}`)
    .join("\n");
  fs.writeFileSync(deadTxtPath, deadTxt ? `${deadTxt}\n` : "", "utf8");
  fs.writeFileSync(path.join(options.output, "probe_report.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!fs.existsSync(options.input)) {
    throw new Error(`No existe input: ${options.input}`);
  }

  const files = walkPlaylistFiles(options.input);
  if (!files.length) {
    throw new Error(`No se encontraron playlists .m3u/.m3u8 en: ${options.input}`);
  }

  const parsedByFile = files.map((filePath) => ({
    filePath,
    entries: parseM3uFile(filePath)
  }));

  const allUrls = parsedByFile.flatMap((item) => item.entries.map((entry) => entry.url));
  const probeMap = await probeMany(allUrls, options);
  const report = writeAliveOutputs(parsedByFile, probeMap, options);

  console.log("Probe completado.");
  console.log(`Input: ${options.input}`);
  console.log(`Output: ${options.output}`);
  console.log(`Playlists: ${report.totals.files}`);
  console.log(`Entradas: ${report.totals.entries}`);
  console.log(`Vivas: ${report.totals.alive}`);
  console.log(`Caidas: ${report.totals.dead}`);
  console.log(`No-HTTP: ${report.totals.skippedNonHttp}`);
}

main().catch((error) => {
  console.error("Error:", error?.message || error);
  process.exitCode = 1;
});

