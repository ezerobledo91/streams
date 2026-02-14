const os = require("os");
const { HOST, PORT } = require("../lib/config");

function getLanIpv4List() {
  const interfaces = os.networkInterfaces();
  const out = [];
  for (const rows of Object.values(interfaces || {})) {
    for (const row of rows || []) {
      if (!row || row.internal || row.family !== "IPv4") continue;
      out.push(row.address);
    }
  }
  return [...new Set(out)];
}

const webPort = Number.parseInt(String(process.env.WEB_PORT || "5173"), 10) || 5173;

console.log("");
console.log("URLs para probar en TV/celular:");

if (HOST !== "0.0.0.0") {
  console.log(`- Frontend: http://${HOST}:${webPort}`);
  console.log(`- Backend:  http://${HOST}:${PORT}`);
  console.log("");
  process.exit(0);
}

const lanIps = getLanIpv4List();
if (!lanIps.length) {
  console.log(`- Frontend (local): http://localhost:${webPort}`);
  console.log(`- Backend (local):  http://localhost:${PORT}`);
  console.log("");
  process.exit(0);
}

for (const ip of lanIps) {
  console.log(`- Frontend: http://${ip}:${webPort}`);
  console.log(`- Backend:  http://${ip}:${PORT}`);
}
console.log("");
