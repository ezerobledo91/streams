const { safeText } = require("./utils");

async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 12000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: safeText(options.method || "GET").toUpperCase() || "GET",
      headers: {
        accept: "application/json",
        ...(options.headers || {})
      },
      body: options.body,
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 220)}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchJson };
