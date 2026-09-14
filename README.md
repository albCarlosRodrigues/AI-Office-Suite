# AI Pixel Office — aplicativo local

Arquitetura: [runtime multiagente verificável](docs/architecture/multi-agent-runtime.md) e
[guia operacional](docs/architecture/production-runtime.md), com contratos, hierarquia, workers
supervisionados, gateway de ferramentas, evidência e segurança.

Aplicativo desktop React para organizar e executar missões com uma equipe hierárquica de agentes de IA. Não existe cadastro, login, Supabase ou serviço de nuvem obrigatório.

## Executar no computador

Instale o Node.js 22 ou mais recente e rode:

```sh
npm install
npm run desktop
```

O Electron abre a interface em uma janela própria. O servidor interno aceita conexões apenas em `127.0.0.1`.

Para trabalhar na interface pelo navegador durante o desenvolvimento:

```sh
npm run dev
```

## Gerar o instalador do Windows

```sh
npm run desktop:build
```

O instalador é criado na pasta `release`.

## Dados locais

- No modo de desenvolvimento, os dados ficam em `data/ai-office.json`.
- No aplicativo instalado, ficam na pasta de dados privados do usuário do Windows.
- Na primeira execução, o aplicativo cria automaticamente a empresa de demonstração Pixel Labs.
- Não há sincronização, telemetria ou envio de dados para o Supabase.
- Provedores externos são opcionais. Quando configurados, somente as chamadas explicitamente solicitadas ao provedor usam a rede.

O modo de simulação funciona totalmente offline e é o padrão.

## Demo hierárquica local

Uma instalação nova cria automaticamente a equipe `Codex → GPT → Claudinho`. Codex atua como
Leader/CEO, GPT como Manager em modo conceitual de sessão ChatGPT/MCP e Claudinho como worker
econômico inspirado no free-claude. A relação, permissões, posições e configuração ficam no store
local do usuário.

Na tela **Escritório**, o painel à direita mostra eventos reais das missões como conversa da equipe.
Eventos de entrega fazem o subordinado caminhar até o superior e desenham temporariamente a rota no
chão: Claudinho reporta ao GPT, e o GPT reporta ao Codex depois da revisão. Instalações existentes não
têm agentes ou configurações substituídos pelo seed.

## Validar a fundação operacional

```sh
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
```

O E2E de produto demonstra Leader → Manager → workers, alteração real de arquivo, execução real de
teste, gates e envelope final. O cenário de carga cobre 10 missões com 5 tasks cada. A validação
PostgreSQL exige um Supabase/Postgres descartável; nunca aponte testes para dados de produção.

## Personalização do escritório

Na tela **Escritório**, use **Personalizar escritório** para alterar as dimensões da planta,
criar, mover, redimensionar ou remover cômodos, escolher pisos e paredes, reposicionar estações de
trabalho e decorar com o catálogo completo do Modern Office Revamped 1.2. A aparência e a cor de
cada personagem podem ser alteradas em **Agentes > Editar**.
