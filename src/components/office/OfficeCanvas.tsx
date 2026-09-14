import { useEffect, useRef } from "react";
import type { Agent, OfficeMap, OfficeZone, Workstation } from "@/types/domain";
import { attachOfficeBridge } from "@/office/OfficeEventBridge";
import type { OfficeScene } from "@/office/OfficeScene";

interface Props {
  map: OfficeMap;
  zones: OfficeZone[];
  workstations: Workstation[];
  agents: Agent[];
  killSwitch: boolean;
  onSelectAgent: (id: string | null) => void;
}

/**
 * Mounts the Phaser game. Loaded lazily and only on the client.
 */
export default function OfficeCanvas({
  map,
  zones,
  workstations,
  agents,
  killSwitch,
  onSelectAgent,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const gameRef = useRef<import("phaser").Game | null>(null);
  const agentsRef = useRef(agents);
  const selectRef = useRef(onSelectAgent);
  agentsRef.current = agents;
  selectRef.current = onSelectAgent;

  useEffect(() => {
    let disposed = false;
    let detachBridge: (() => void) | null = null;
    (async () => {
      const [{ default: Phaser }, { OfficeScene }] = await Promise.all([
        import("phaser"),
        import("@/office/OfficeScene"),
      ]);
      if (disposed || !hostRef.current) return;
      const game = new Phaser.Game({
        // Canvas is deliberately used here. Some Electron/Chromium GPU combinations
        // create a WebGL context successfully but only paint a black frame.
        // The pixel office is small enough that Canvas is both fast and much more
        // reliable across desktop hardware and remote/virtualized sessions.
        type: Phaser.CANVAS,
        parent: hostRef.current,
        pixelArt: true,
        backgroundColor: "#0c0e16",
        scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
        render: { antialias: false, roundPixels: true },
        scene: [],
      });
      gameRef.current = game;
      game.scene.add("office", OfficeScene, true, {
        map,
        zones,
        workstations,
        agents: agentsRef.current,
        onSelectAgent: (id: string | null) => selectRef.current(id),
        onReady: (scene: OfficeScene) => {
          sceneRef.current = scene;
          detachBridge = attachOfficeBridge(scene);
          scene.setKillSwitch(killSwitch);
        },
      });
    })();
    return () => {
      disposed = true;
      detachBridge?.();
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
    // The map itself is static for a session; agents sync through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.id, map.updated_at]);

  useEffect(() => {
    sceneRef.current?.syncAgents(agents);
  }, [agents]);

  useEffect(() => {
    sceneRef.current?.setKillSwitch(killSwitch);
  }, [killSwitch]);

  return <div ref={hostRef} className="absolute inset-0 h-full w-full" />;
}
