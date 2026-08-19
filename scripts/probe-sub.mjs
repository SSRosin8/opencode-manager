const url = process.argv[2];

if (!url) {
  console.error("Usage: node scripts/probe-sub.mjs <subscription-url>");
  process.exit(1);
}

async function main() {
  // 1) clash UA -> YAML
  let r = await fetch(url, { headers: { "User-Agent": "clash" } });
  let t = await r.text();
  console.log("=== CLASH YAML ===");
  console.log("status", r.status, "len", t.length, "ct", r.headers.get("content-type"));
  console.log("has proxies:", t.includes("proxies:"));
  const types2 = {};
  for (const line of t.split("\n")) {
    const tm = line.match(/^\s+type:\s*([\w-]+)/);
    if (tm) types2[tm[1]] = (types2[tm[1]] || 0) + 1;
  }
  console.log("types from yaml lines", types2);
  const pidx = t.indexOf("proxies:");
  console.log("snippet", t.slice(pidx, pidx + 1200));

  // 2) default base64 (our UA)
  r = await fetch(url, {
    headers: { "User-Agent": "ClashMeta/1.0 (OCFreeRelay; subscription-fetcher)" },
  });
  t = await r.text();
  const decoded = Buffer.from(t.replace(/\s+/g, ""), "base64").toString("utf8");
  console.log("=== B64 DECODE ===");
  const lines = decoded.split(/\r?\n/).filter(Boolean);
  console.log("lines", lines.length);
  const protos = {};
  for (const line of lines) {
    const p = line.split("://")[0];
    protos[p] = (protos[p] || 0) + 1;
  }
  console.log("protos", protos);
  console.log("first", lines[0]?.slice(0, 160));

  // import parser via tsx-less: dynamic from built dist or use node --import tsx
  const { parseSubscriptionBody } = await import("../dist/proxy/clash.js").catch(() =>
    import("../src/proxy/clash.ts")
  );

  const a = parseSubscriptionBody(t, "sub");
  console.log(
    "parse meta-b64",
    a.format,
    "usable",
    a.usableCount,
    "total",
    a.proxies.length,
    "skipped",
    a.skippedCount
  );

  const yamlBody = await (
    await fetch(url, { headers: { "User-Agent": "clash" } })
  ).text();
  const b = parseSubscriptionBody(yamlBody, "sub");
  console.log(
    "parse clash-yaml",
    b.format,
    "usable",
    b.usableCount,
    "total",
    b.proxies.length,
    "skipped",
    b.skippedCount
  );
  console.log(
    "sample",
    b.proxies.slice(0, 8).map((p) => `${p.name}:${p.type}:usable=${p.usable}`)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
