# FreeClaude / OpenRouter (1.4.0)

Referência correta: https://github.com/codeaashu/free-claude-code e a cópia local
`A:\Ambiente\free-claude-code`. A referência momadhuynh04/freeClaude discutida
anteriormente era outro projeto.

O backend TypeScript utiliza o padrão de transporte nativo Messages do adaptador
OpenRouter dessa cópia: POST /api/v1/messages, system separado e blocos text.
Roda dentro do AI Office. Não inicia o proxy Python na porta 8082 nem o Claude Code
CLI; nenhuma ferramenta autônoma desses programas contorna o executor local.
Essa escolha reaproveita o protocolo, não importa todo o projeto Python.

Em Provedores escolha **Claudinho — FreeClaude / OpenRouter**, informe o modelo
desejado e a API key. O modelo é livre e não tem default fixo. A URL base é visível
na configuração; apenas a origem oficial HTTPS OpenRouter é permitida para impedir
encaminhamento de credenciais para hosts arbitrários. O formato da resposta é
validado. Erros classificam INVALID_KEY, MODEL_UNAVAILABLE, RATE_LIMITED ou ERROR,
sem copiar o corpo de erro do provedor, que poderia conter a credencial.

A chave é entregue ao serviço de segredos existente e persistida no SecretStore.
O JSON local contém a referência, não a chave. Nenhuma chave foi incluída no código
ou adicionada ao instalador. Modelos gratuitos do OpenRouter ainda têm limites e
disponibilidade próprios; não há promessa de custo zero ou ausência de cota.

O agente continua sendo Claudinho, WORKER subordinado ao GPT. A migração de Acme
reutiliza IDs, posições e permissões. Não desativa simulação automaticamente e não
declara conexão antes do teste. O Codex existente mantém seu provedor anterior;
a conexão real do líder também precisa estar configurada para uma missão inteira.

Teste opcional `npm run test:openrouter`: configure AI_OFFICE_OPENROUTER_PROVIDER_ID
e AI_OFFICE_DATA_FILE. A chave é lida exclusivamente do SecretStore. Sem opt-in o
teste é SKIPPED. O teste automático de integração usa HTTP falso e efeitos reais
num fixture temporário; não comprova conectividade real com OpenRouter.

# Conexão local verificada em 14/09/2026

O Claudinho existente da Acme Robots está associado ao provider
`a838b328-2e16-476c-b113-ad4af136055c`, usando o modelo configurável
`nvidia/nemotron-3.5-lightning:free`. A chave existente do Free-Claude foi
reutilizada com autorização explícita, armazenada via Windows DPAPI e relida
para uma sondagem real do backend que retornou CONNECTED. Não há chave em
plaintext no store, no vault ou no código alterado.

O transporte aceita blocos de raciocínio, mas retorna somente o texto final.
Respostas cortadas (`max_tokens`) e blocos de ferramenta não autorizados pelo
contrato são rejeitados. A simulação permanece ativa até que PRX e o líder
também estejam configurados e o fluxo completo seja validado.
