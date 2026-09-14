# Validação da candidata 1.4.0 — missão ainda parcial

1. Agente Acme: GPT existente, ID 2c10fb31-1718-484f-a2f1-d6da2195ed74.
2. Hierarquia: Codex c096348e-7837-440b-abfb-5aea0873b340 → GPT → Claudinho 35fec107-d2e6-47f0-ac98-12ce353b907b. Vínculos persistidos no store desktop, sem duplicar agentes; binário instalado não substituído.
3. PRX: backend e driver CDP local adaptados; 127.0.0.1:9223 recusou conexão. Sessão real do backend não validada.
4. LocalAnt: tradução de ferramentas e encaminhamento à fila/Gateway existentes. Testes de negação, aprovação e execução passaram.
5. FreeClaude: transporte TypeScript baseado no protocolo Messages do adaptador OpenRouter de codeaashu/free-claude-code. Proxy Python não iniciado.
6. OpenRouter: chave existente do Free-Claude reutilizada após autorização explícita, autenticação oficial passou. Provider a838b328-2e16-476c-b113-ad4af136055c associado ao Claudinho com nvidia/nemotron-3.5-lightning:free. Sondagem real pelo backend e leitura de volta do SecretStore passaram; estado CONNECTED persistido.
7. Secrets: armazenamento existente via SecretStore/Windows DPAPI. Verificação de ausência da chave em plaintext no store e no vault passou. Backups locais com sufixo before-openrouter-1789422892645.bak preservados junto aos arquivos originais. Nenhuma credencial real adicionada ao código ou ao instalador.
8. Chat: painel lateral, participantes, seletor de missão, mensagens do mission_events, links de missão e IDs de tarefa. Sem mensagens fictícias. Smoke visual de produção confirmou mapa, três avatares e painel coexistindo em janela ampla.
9. Movimento: handlers existentes preservados; REPORT_TO_MANAGER/ESCALATED encaminhados ao reportToManager. Novo ciclo animado completo ainda não validado.
10. E2E: teste de integração de adaptadores com HTTP falso e leitura/escrita/processo reais num fixture passou. Não é E2E da missão inteira no engine/desktop.
11. Testes: 127 passaram; 2 sondagens opt-in foram SKIPPED na suíte padrão. Sondagem real OpenRouter executada separadamente e aprovada.
12. Coverage incluindo integrações: statements 64.65%, branches 48.52%, functions 65.58%, lines 66.66%. Thresholds existentes passaram. Engine e driver CDP não têm cobertura E2E.
13. Typecheck: PASS.
14. Lint: PASS, zero erros e 12 warnings preexistentes.
15. Build de produção: PASS; versão 1.4.0 exibida no smoke da interface, usando dados temporários separados.
16. npm audit: PASS, zero vulnerabilidades em 766 dependências reportadas.
17. Smoke real: OpenRouter PASS em harness temporário, incluindo providerForHealth com chave relida do SecretStore. PRX não executado: porta 9223 indisponível. Canal PRX - Geral aberto no Chrome autenticado; não equivale a teste do backend. Fixture LocalAnt PASS.
18. Pendências: requirements-ledger registra PARTIAL para fluxo completo, driver PRX real, ferramentas adicionais, rastreabilidade e movimento completo. Codex ainda precisa de provider real. A definição de pronto integral não foi atingida.
19. Novo setup.exe: gerado posteriormente por solicitação explícita do usuário, dispensando o restart real nesta entrega. Packaging e smoke isolado passaram; fluxo completo permanece parcial. Ver docs/releases/1.4.0.md.
20. Versão anterior 1.3.1; versão candidata do código 1.4.0.
21. Caminho do novo setup.exe: release/AI Pixel Office Setup 1.4.0.exe.
22. Tamanho do novo setup.exe: 150.695.894 bytes.
23. SHA-256 do novo setup.exe: 2698E5E7733F6E9B0A458583FF789A972C43B6BD12709BACD874E1D34341E200.

O instalador anterior não foi substituído. O mecanismo existente permanece
electron-builder/NSIS, comando `npm run desktop:build`. Não foram feitos commit,
push ou PR. A instalação real do usuário continua na versão anterior.

Espaço solicitado criado: [PRX - Geral](https://chatgpt.com/g/g-p-6aa868af0cd0819188e1d6d1fda02e29/project).

## Continuação — conexão OpenRouter

O teste real detectou blocos `thinking` e respostas interrompidas por `max_tokens`.
O adaptador agora descarta blocos de raciocínio e aceita somente o texto final;
respostas incompletas e chamadas de ferramenta fora do contrato são rejeitadas.
Cinco testes de regressão foram adicionados. A simulação da organização foi
preservada: o provedor Codex ainda aponta para Local Simulation e o PRX ainda
não responde. Não há evidência de execução de missão real completa.

Foi solicitado iniciar um Chrome separado para o PRX, mas a porta não ficou
disponível nas sondagens seguintes. O usuário então solicitou usar seu Chrome
já aberto; a conversa foi aberta e o login foi confirmado pela interface.
A investigação adicional do processo foi bloqueada pelo serviço de aprovação
por limite de uso. Não confundir esse bloqueio operacional com falha da chave
OpenRouter, que foi autenticada e testada com sucesso.
