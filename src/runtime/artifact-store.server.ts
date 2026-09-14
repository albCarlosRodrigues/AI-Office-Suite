import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredArtifact {
  artifactRef: string;
  sha256: string;
  mediaType: string;
  size: number;
  createdAt: string;
}

export class FileArtifactStore {
  constructor(private readonly root: string) {}
  async put(content: string | Uint8Array, mediaType = "text/plain"): Promise<StoredArtifact> {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const id = randomUUID();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const metadata: StoredArtifact = {
      artifactRef: `artifact:${id}`,
      sha256,
      mediaType,
      size: bytes.byteLength,
      createdAt: new Date().toISOString(),
    };
    await mkdir(this.root, { recursive: true });
    const temporary = path.join(this.root, `${id}.tmp`);
    await writeFile(temporary, bytes);
    await rename(temporary, path.join(this.root, `${id}.bin`));
    await writeFile(path.join(this.root, `${id}.json`), JSON.stringify(metadata));
    return metadata;
  }
  async get(artifactRef: string): Promise<{ metadata: StoredArtifact; content: Uint8Array }> {
    const id = artifactRef.replace(/^artifact:/, "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("INVALID_ARTIFACT_REF");
    const metadata = JSON.parse(
      await readFile(path.join(this.root, `${id}.json`), "utf8"),
    ) as StoredArtifact;
    const content = await readFile(path.join(this.root, `${id}.bin`));
    const hash = createHash("sha256").update(content).digest("hex");
    if (hash !== metadata.sha256) throw new Error("ARTIFACT_INTEGRITY_FAILURE");
    return { metadata, content };
  }
}
