const path = require("node:path");
const { writeFileSync } = require("node:fs");
const { launchIndependent } = require("../windows.cjs");
(async () => {
  const pid = await launchIndependent(
    process.execPath,
    [path.join(__dirname, "independent-child.cjs"), process.argv[2]],
    __dirname,
  );
  writeFileSync(process.argv[3], String(pid));
  // Keep this disposable parent alive until the test kills it; the child must outlive it.
  setTimeout(() => process.exit(0), 10000);
})().catch(() => process.exit(1));
