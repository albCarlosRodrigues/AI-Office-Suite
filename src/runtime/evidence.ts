import { createHash } from "node:crypto";

export type EvidenceType =
  "runtime" | "model_claim" | "human" | "external_api" | "test" | "build" | "git" | "filesystem";
export interface ProvenanceEvidence {
  id: string;
  type: EvidenceType;
  source: string;
  createdBy: string;
  createdAt: string;
  artifactRef: string;
  sha256: string;
  verified: boolean;
  verifier: "local-runtime" | "human" | null;
}

export function createEvidence(
  input: Omit<ProvenanceEvidence, "id" | "createdAt" | "sha256"> & { content: string },
): ProvenanceEvidence {
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sha256: createHash("sha256").update(input.content).digest("hex"),
  };
}

export function isRuntimeVerified(evidence: ProvenanceEvidence): boolean {
  return (
    evidence.verified && evidence.verifier === "local-runtime" && evidence.type !== "model_claim"
  );
}
