import { DurableRuntimeStore } from "./store.server";
import { audit } from "./helpers";
import { CancellationService } from "./cancellation-service.server";

export class DurableRuntimeControl {
  constructor(private readonly store: DurableRuntimeStore) {}

  setKillSwitch(active: boolean, now = Date.now()) {
    return this.store.transaction((state) => {
      state.killSwitch = active;
      audit(state, active ? "KILL_SWITCH_ACTIVATED" : "KILL_SWITCH_DEACTIVATED", {}, {}, now);
    });
  }

  cancelMission(missionId: string, now = Date.now()) {
    return this.store.snapshot().then((state) => {
      if (!state.missions.some((item) => item.id === missionId))
        throw new Error("MISSION_NOT_FOUND");
      return new CancellationService(this.store).request(
        { missionId, reason: "Mission cancelled", requestedBy: "runtime-control" },
        now,
      );
    });
  }
}
