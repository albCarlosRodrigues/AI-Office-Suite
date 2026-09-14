import { rm } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
for (const name of [".output", "dist"]) {
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root) throw new Error("INVALID_BUILD_DIRECTORY");
  await rm(target, { recursive: true, force: true });
}
