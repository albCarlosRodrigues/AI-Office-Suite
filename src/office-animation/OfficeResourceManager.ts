import type { OfficeResource } from "./types";

class OfficeResourceManager {
  private occupants = new Map<OfficeResource, string>();

  acquire(resource: OfficeResource, agentId: string): boolean {
    const current = this.occupants.get(resource);

    if (current && current !== agentId) {
      return false;
    }

    this.occupants.set(resource, agentId);
    return true;
  }

  release(resource: OfficeResource, agentId: string): void {
    if (this.occupants.get(resource) === agentId) {
      this.occupants.delete(resource);
    }
  }

  releaseAll(agentId: string): void {
    for (const [resource, owner] of this.occupants.entries()) {
      if (owner === agentId) {
        this.occupants.delete(resource);
      }
    }
  }

  isAvailable(resource: OfficeResource): boolean {
    return !this.occupants.has(resource);
  }

  owner(resource: OfficeResource): string | undefined {
    return this.occupants.get(resource);
  }
}

export const officeResources = new OfficeResourceManager();
