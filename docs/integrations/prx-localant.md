# PRX + LocalAnt (1.4.0)

O transporte deriva dos scripts PRX existentes em `A:\Ambiente\DeliciasDoRio-issue9-prx`,
sem incorporar o fluxo de negócio daquele projeto. PRX não é ProBridge/macOS.

Em Provedores, selecione o backend **GPT — PRX + LocalAnt**. Configure o endpoint CDP
local, o ID exato do target, a URL exata da conversa e o nome acessível do editor.
O aplicativo ChatGPT precisa estar autenticado e disponibilizar esse target. Nenhuma
credencial de ChatGPT é copiada. A configuração não inicia nem autentica o ChatGPT.
Use **Test connection** para enviar uma solicitação curta. Esse teste usa a cota normal
do plano ChatGPT; a integração não oferece uso ilimitado.

`PrxChatBackend` implementa `ExecutionBackend`. Os pedidos carregam sessionId,
conversationId, agentId, requestId, lastMessageId e os IDs de missão/tarefa/run nas
execuções de tarefas, planejamento, reuniões, revisão e resumo. Um marcador
aleatório correlaciona a resposta; texto antigo ou envelope inválido não é aceito.
AbortSignal e timeout encerram a espera. Uma trava impede dois escritores simultâneos
na mesma sessão. A posição da conversa é conferida antes do envio e da leitura.

O driver depende de seletores da interface do ChatGPT; mudanças de interface podem
exigir ajuste. O driver foi adaptado de scripts locais, mas não foi validado numa
sessão real nesta entrega. Não há fallback silencioso para API ou simulação.

LocalAnt é uma interface de ferramentas dentro do runtime, não outro servidor MCP.
read/write/bash/apply_patch e project_run_* são mapeados para handlers existentes.
As ferramentas não implementadas (grep/glob/list_files/edit dedicado) não ganham
execução implícita. Pedidos do gerente passam por permissões, fila durável,
aprovação e ToolExecutionGateway. As decisões do modelo nunca concedem permissões.
Resultados são lidos do ArtifactStore com verificação de hash antes de voltar ao gerente.

O workspace é configurado no formulário do agente. Caminhos de ferramentas são
validados contra esse workspace pelo PathGuard. Aprovações aparecem na tela existente.
O gerente não executa shell pelo PRX, e uma resposta textual não vira Evidence.

Fluxo de pergunta: NEEDS_CLARIFICATION → REPORT_TO_MANAGER → decisão estruturada
CONTINUE/REVISE/REQUEST_TOOL/ESCALATE/STOP. A continuação mantém o comando e a política;
REQUEST_TOOL usa a fila existente. Pedidos de escalada são encaminhados ao provedor
do Codex quando configurado. O fluxo completo ainda precisa de validação E2E.

Teste opcional: `npm run test:prx`, com `AI_OFFICE_PRX_PROVIDER_ID` e
`AI_OFFICE_DATA_FILE` apontando para a configuração desktop. Sem opt-in, é SKIPPED.
`npm run test:localant` verifica o gateway com fixture local; não prova uma sessão MCP.

Espaço criado no ChatGPT em 14/09/2026: **PRX - Geral**. A conversa de inicialização
respondeu OK pelo navegador. Isso não é um teste do transporte PRX.
Conversa: https://chatgpt.com/g/g-p-6aa868af0cd0819188e1d6d1fda02e29-prx-geral/c/6aa868d5-27a4-83e9-aebe-006d9b6738e3
O endpoint 127.0.0.1:9223 recusou conexões nesta verificação. Não foi iniciado um
servidor de depuração nem alterada a configuração de segurança do navegador.
