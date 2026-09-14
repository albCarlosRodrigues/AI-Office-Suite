const { writeFileSync } = require("node:fs");
// Bounded fixture only. Never opens a port, reads credentials or touches application processes.
setTimeout(() => writeFileSync(process.argv[2], String(process.pid)), 1800);
