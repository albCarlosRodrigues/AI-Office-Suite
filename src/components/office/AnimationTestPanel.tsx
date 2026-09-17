import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  Agent,
} from "@/types/domain";

import {
  officeBus,
  type OfficeAnimationTestAction,
} from "@/office/eventBus";

interface Props {
  agents: Agent[];

  selectedAgentId:
    | string
    | null;

  onSelectAgent: (
    id: string | null,
  ) => void;
}

interface TestAction {
  action:
    OfficeAnimationTestAction;

  label: string;
}

export function AnimationTestPanel({
  agents,
  selectedAgentId,
  onSelectAgent,
}: Props) {
  const [
    open,
    setOpen,
  ] = useState(true);

  const [
    agentId,
    setAgentId,
  ] = useState("");

  const [
    lastAction,
    setLastAction,
  ] =
    useState<
      OfficeAnimationTestAction |
      null
    >(null);

  useEffect(() => {
    if (
      selectedAgentId &&
      agents.some(
        (agent) =>
          agent.id ===
          selectedAgentId,
      )
    ) {
      setAgentId(
        selectedAgentId,
      );

      return;
    }

    if (
      !agentId &&
      agents.length > 0
    ) {
      setAgentId(
        agents[0]?.id ?? "",
      );
    }
  }, [
    agents,
    selectedAgentId,
    agentId,
  ]);

  const agent =
    useMemo(
      () =>
        agents.find(
          (item) =>
            item.id ===
            agentId,
        ) ?? null,

      [
        agents,
        agentId,
      ],
    );

  const execute = (
    action:
      OfficeAnimationTestAction,
  ) => {
    if (!agentId) {
      return;
    }

    /*
     * Importante:
     * nenhum status real e consultado aqui.
     *
     * O painel sempre manda o comando.
     */
    officeBus.emit({
      type: "debug:animation",
      agentId,
      action,
    });

    onSelectAgent(
      agentId,
    );

    setLastAction(
      action,
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() =>
          setOpen(true)
        }
        className="
          absolute
          right-3
          top-3
          z-[200]
          rounded-md
          border
          border-primary/50
          bg-card/95
          px-3
          py-2
          font-mono
          text-[10px]
          uppercase
          text-primary
          shadow-xl
          backdrop-blur
        "
      >
        Anim Test
      </button>
    );
  }

  return (
    <div
      className="
        absolute
        right-3
        top-3
        z-[200]
        w-[250px]
        overflow-hidden
        rounded-lg
        border
        border-primary/30
        bg-card/95
        shadow-2xl
        backdrop-blur
      "
    >
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
              font-bold
              uppercase
              tracking-wider
              text-primary
            "
          >
            Force Animation
          </p>

          <p
            className="
              text-[9px]
              text-muted-foreground
            "
          >
            independente do estágio
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setOpen(false)
          }
          className="
            rounded
            px-2
            py-1
            text-muted-foreground
            hover:bg-accent
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
        <div>
          <p
            className="
              mb-1
              font-mono
              text-[9px]
              uppercase
              text-muted-foreground
            "
          >
            Agente
          </p>

          <select
            value={agentId}
            onChange={(
              event,
            ) => {
              const id =
                event.target.value;

              setAgentId(id);

              onSelectAgent(
                id || null,
              );
            }}
            className="
              h-8
              w-full
              rounded
              border
              border-border
              bg-background
              px-2
              text-xs
            "
          >
            {agents.map(
              (item) => (
                <option
                  key={item.id}
                  value={item.id}
                >
                  {item.name}
                </option>
              ),
            )}
          </select>
        </div>

        {agent && (
          <div
            className="
              rounded
              border
              border-border/60
              bg-background/70
              p-2
            "
          >
            <div
              className="
                flex
                justify-between
                gap-2
              "
            >
              <span
                className="
                  truncate
                  text-[10px]
                  font-semibold
                "
              >
                {agent.name}
              </span>

              <span
                className="
                  font-mono
                  text-[9px]
                  text-muted-foreground
                "
              >
                REAL:
                {" "}
                {agent.status}
              </span>
            </div>

            <p
              className="
                mt-1
                font-mono
                text-[9px]
                text-primary
              "
            >
              TESTE:
              {" "}
              {lastAction ??
                "nenhum"}
            </p>
          </div>
        )}

        <Section title="Estado">
          <Action
            label="Idle"
            onClick={() =>
              execute("idle")
            }
          />

          <Action
            label="Pensando"
            onClick={() =>
              execute(
                "thinking",
              )
            }
          />

          <Action
            label="Trabalhando"
            onClick={() =>
              execute(
                "working",
              )
            }
          />

          <Action
            label="Reunião"
            onClick={() =>
              execute(
                "meeting",
              )
            }
          />
        </Section>

        <Section title="Objetos">
          <Action
            label="Quadro"
            onClick={() =>
              execute(
                "whiteboard",
              )
            }
          />

          <Action
            label="Água"
            onClick={() =>
              execute("water")
            }
          />

          <Action
            label="Café"
            onClick={() =>
              execute("coffee")
            }
          />

          <Action
            label="Sofá"
            onClick={() =>
              execute("sofa")
            }
          />

          <Action
            label="Poltrona"
            onClick={() =>
              execute(
                "armchair",
              )
            }
          />

          <Action
            label="Superior"
            onClick={() =>
              execute(
                "supervisor",
              )
            }
          />
        </Section>

        <Section title="Movimento">
          <Action
            label="↑ Cima"
            onClick={() =>
              execute(
                "walk-up",
              )
            }
          />

          <Action
            label="↓ Baixo"
            onClick={() =>
              execute(
                "walk-down",
              )
            }
          />

          <Action
            label="← Esquerda"
            onClick={() =>
              execute(
                "walk-left",
              )
            }
          />

          <Action
            label="→ Direita"
            onClick={() =>
              execute(
                "walk-right",
              )
            }
          />

          <Action
            label="Mesa"
            onClick={() =>
              execute("home")
            }
          />

          <Action
            label="Fala"
            onClick={() =>
              execute("talk")
            }
          />
        </Section>

        <button
          type="button"
          onClick={() => {
            execute("reset");

            setLastAction(
              null,
            );
          }}
          className="
            h-9
            w-full
            rounded-md
            border
            border-destructive/50
            bg-destructive/10
            font-mono
            text-[10px]
            font-semibold
            uppercase
            text-destructive
            hover:bg-destructive/20
          "
        >
          Reset / Estado real
        </button>

        <p
          className="
            text-[9px]
            leading-relaxed
            text-muted-foreground
          "
        >
          Enquanto o modo de teste
          estiver ativo, atualizações
          reais do agente não substituem
          a animação escolhida.
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
          tracking-wider
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

function Action({
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
        bg-background/80
        px-2
        font-mono
        text-[9px]
        hover:border-primary/50
        hover:bg-primary/10
        hover:text-primary
      "
    >
      {label}
    </button>
  );
}