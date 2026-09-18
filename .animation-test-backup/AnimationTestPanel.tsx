import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { Agent } from "@/types/domain";

import { officeBus, type OfficeAnimationTestAction } from "@/office/eventBus";

interface Props {
  agents: Agent[];

  selectedAgentId: string | null;

  onSelectAgent: (id: string | null) => void;
}

interface ActionDefinition {
  action: OfficeAnimationTestAction;

  label: string;

  group: "state" | "movement" | "control";
}

const ACTIONS: ActionDefinition[] = [
  // Estados
  {
    action: "idle",
    label: "Idle",
    group: "state",
  },

  {
    action: "thinking",
    label: "Pensando",
    group: "state",
  },

  {
    action: "working",
    label: "Trabalhando",
    group: "state",
  },

  {
    action: "meeting",
    label: "Reunião",
    group: "state",
  },

  // Movimento
  {
    action: "whiteboard",
    label: "Quadro",
    group: "movement",
  },

  {
    action: "water",
    label: "Água",
    group: "movement",
  },

  {
    action: "coffee",
    label: "Café",
    group: "movement",
  },

  {
    action: "sofa",
    label: "Sofá",
    group: "movement",
  },

  {
    action: "armchair",
    label: "Poltrona",
    group: "movement",
  },

  {
    action: "supervisor",
    label: "Superior",
    group: "movement",
  },

  {
    action: "home",
    label: "Mesa",
    group: "movement",
  },

  // Outros
  {
    action: "talk",
    label: "Fala",
    group: "control",
  },

  {
    action: "reset",
    label: "Reset",
    group: "control",
  },
];

export function AnimationTestPanel({ agents, selectedAgentId, onSelectAgent }: Props) {
  const [open, setOpen] = useState(true);

  const [enabled, setEnabled] = useState(import.meta.env.DEV);

  const [agentId, setAgentId] = useState("");

  /*
   * Em produção o painel pode ser aberto com:
   *
   * /office?animationTest=1
   */
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);

    if (params.get("animationTest") === "1") {
      setEnabled(true);
    }
  }, []);

  /*
   * Mantém o agente escolhido sincronizado
   * com a seleção do escritório.
   */
  useEffect(() => {
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) {
      setAgentId(selectedAgentId);

      return;
    }

    if (agentId && agents.some((agent) => agent.id === agentId)) {
      return;
    }

    setAgentId(agents[0]?.id ?? "");
  }, [agents, agentId, selectedAgentId]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId) ?? null,

    [agents, agentId],
  );

  if (!enabled) {
    return null;
  }

  const run = (action: OfficeAnimationTestAction) => {
    if (!agentId) {
      return;
    }

    onSelectAgent(agentId);

    officeBus.emit({
      type: "debug:animation",

      agentId,

      action,
    });
  };

  /*
   * Botão reduzido.
   */
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="
          absolute
          right-3
          top-3
          z-[100]
          rounded-md
          border
          border-primary/40
          bg-card/95
          px-3
          py-2
          font-mono
          text-[10px]
          uppercase
          tracking-wider
          text-primary
          shadow-xl
          backdrop-blur
          hover:bg-accent
        "
      >
        Anim test
      </button>
    );
  }

  const stateActions = ACTIONS.filter((item) => item.group === "state");

  const movementActions = ACTIONS.filter((item) => item.group === "movement");

  const controlActions = ACTIONS.filter((item) => item.group === "control");

  return (
    <div
      className="
        absolute
        right-3
        top-3
        z-[100]
        w-[230px]
        overflow-hidden
        rounded-lg
        border
        border-border/80
        bg-card/95
        shadow-2xl
        backdrop-blur
      "
    >
      {/* CABEÇALHO */}

      <div
        className="
          flex
          items-center
          justify-between
          border-b
          border-border
          px-3
          py-2
        "
      >
        <div>
          <p
            className="
              font-mono
              text-[10px]
              font-semibold
              uppercase
              tracking-wider
              text-primary
            "
          >
            Animation Test
          </p>

          <p
            className="
              text-[9px]
              text-muted-foreground
            "
          >
            somente visual
          </p>
        </div>

        <button
          type="button"
          title="Minimizar"
          onClick={() => setOpen(false)}
          className="
            rounded
            px-2
            py-1
            font-mono
            text-xs
            text-muted-foreground
            hover:bg-accent
            hover:text-foreground
          "
        >
          —
        </button>
      </div>

      <div
        className="
          space-y-3
          p-3
        "
      >
        {/* AGENTE */}

        <div>
          <label
            className="
              mb-1
              block
              font-mono
              text-[9px]
              uppercase
              text-muted-foreground
            "
          >
            Agente
          </label>

          <select
            value={agentId}
            onChange={(event) => {
              const id = event.target.value;

              setAgentId(id);

              onSelectAgent(id || null);
            }}
            className="
              h-8
              w-full
              rounded-md
              border
              border-border
              bg-background
              px-2
              text-[11px]
              text-foreground
              outline-none
              focus:border-primary/60
            "
          >
            {agents.length === 0 && <option value="">Nenhum agente</option>}

            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>

        {/* STATUS ATUAL */}

        {selectedAgent && (
          <div
            className="
              rounded-md
              border
              border-border/60
              bg-background/60
              px-2
              py-1.5
            "
          >
            <div
              className="
                flex
                items-center
                justify-between
                gap-2
              "
            >
              <span
                className="
                  truncate
                  text-[10px]
                  font-medium
                "
              >
                {selectedAgent.name}
              </span>

              <span
                className="
                  shrink-0
                  font-mono
                  text-[9px]
                  text-primary
                "
              >
                {selectedAgent.status}
              </span>
            </div>

            <p
              className="
                truncate
                text-[9px]
                text-muted-foreground
              "
            >
              {selectedAgent.role}
            </p>
          </div>
        )}

        {/* ESTADOS */}

        <Section title="Estado">
          {stateActions.map((item) => (
            <TestButton key={item.action} label={item.label} onClick={() => run(item.action)} />
          ))}
        </Section>

        {/* MOVIMENTOS */}

        <Section title="Movimento">
          {movementActions.map((item) => (
            <TestButton key={item.action} label={item.label} onClick={() => run(item.action)} />
          ))}
        </Section>

        {/* CONTROLES */}

        <Section title="Controle">
          {controlActions.map((item) => (
            <button
              key={item.action}
              type="button"
              disabled={!agentId}
              onClick={() => run(item.action)}
              className={
                item.action === "reset"
                  ? `
                      h-8
                      rounded-md
                      border
                      border-destructive/40
                      px-2
                      font-mono
                      text-[9px]
                      uppercase
                      text-destructive
                      hover:bg-destructive/10
                    `
                  : `
                      h-8
                      rounded-md
                      border
                      border-border
                      bg-background/70
                      px-2
                      font-mono
                      text-[9px]
                      uppercase
                      text-muted-foreground
                      hover:bg-accent
                      hover:text-foreground
                    `
              }
            >
              {item.label}
            </button>
          ))}
        </Section>

        <p
          className="
            border-t
            border-border/60
            pt-2
            text-[9px]
            leading-relaxed
            text-muted-foreground
          "
        >
          Os comandos deste painel não devem alterar o estado persistido do agente.
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;

  children: ReactNode;
}) {
  return (
    <div>
      <p
        className="
          mb-1.5
          font-mono
          text-[9px]
          uppercase
          tracking-wide
          text-muted-foreground
        "
      >
        {title}
      </p>

      <div
        className="
          grid
          grid-cols-2
          gap-1.5
        "
      >
        {children}
      </div>
    </div>
  );
}

function TestButton({
  label,
  onClick,
}: {
  label: string;

  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        h-8
        rounded-md
        border
        border-border
        bg-background/70
        px-2
        font-mono
        text-[9px]
        text-foreground
        transition-colors
        hover:border-primary/50
        hover:bg-primary/10
        hover:text-primary
      "
    >
      {label}
    </button>
  );
}
