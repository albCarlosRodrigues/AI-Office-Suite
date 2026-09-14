import { useEffect, useRef } from "react";
import { resolveCharacterSprite } from "@/office/registries";
import type { Agent } from "@/types/domain";
import { cn } from "@/lib/utils";

/**
 * Renders the same Modern Interiors character used in the office,
 * facing down and idle, so lists and cards match the map.
 */
export function AgentAvatar({
  agent,
  size = 32,
  className,
}: {
  agent: Pick<Agent, "character_sprite_id" | "color" | "name"> & { kind?: Agent["kind"] };
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const def = resolveCharacterSprite(agent.character_sprite_id);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // The idle sheet is ordered left, up, right, down.
      ctx.drawImage(image, def.frameWidth * 3, 0, def.frameWidth, def.frameHeight, 0, 0, 16, 32);
    };
    image.src = def.idleUrl;
    return () => {
      image.onload = null;
    };
  }, [agent.character_sprite_id, agent.color, agent.kind]);
  return (
    <canvas
      ref={ref}
      width={16}
      height={32}
      aria-label={agent.name}
      className={cn("pixelated shrink-0 rounded-sm", className)}
      style={{
        width: size,
        height: size * 2,
        backgroundColor: `${agent.color}22`,
        boxShadow: `inset 0 0 0 1px ${agent.color}55`,
      }}
    />
  );
}
