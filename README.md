# AI Pixel Office — aplicativo local

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

## Personalização do escritório

Na tela **Escritório**, use **Personalizar escritório** para alterar as dimensões da planta,
criar, mover, redimensionar ou remover cômodos, escolher pisos e paredes, reposicionar estações de
trabalho e decorar com o catálogo completo do Modern Office Revamped 1.2. A aparência e a cor de
cada personagem podem ser alteradas em **Agentes > Editar**.
