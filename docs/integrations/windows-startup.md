# Inicialização Windows — candidata 1.4.0

## Arquitetura

O launcher Electron existente (`desktop/main.cjs`) inicia o servidor do AI Office
e abre sua interface como antes. Em seguida, `startup/launch.cjs` persiste um plano
completo, sem credenciais, e cria outro processo Electron em modo
`--runtime-bootstrapper`. Não foi adicionado outro empacotador ou runtime de ferramentas.

O processo é criado por `Win32_Process.Create` (CIM/WMI), com `ShowWindow=0`.
Não herda pipes, console ou dependência do job do controlador. O PowerShell
intermediário usa `windowsHide`, modo não interativo e timeout. Esse mecanismo
foi escolhido porque `detached: true`/`unref()` sozinhos não demonstram escape de
um job Windows que pode encerrar seus descendentes.

O helper grava `ready.json` com nonce e PID, depois espera até dez segundos por
`commit`. O launcher verifica nonce, PID e existência do processo antes de gravar
esse commit. Somente então o helper pode identificar e encerrar conflitos.
Sem commit, registra HANDOFF_TIMEOUT e termina sem encerrar aplicativos.
Após o commit não há consulta ao pai, IPC, stdin ou stdout dependente dele.

## Descoberta e processos

- ChatGPT: descoberta dos pacotes AppX das famílias OpenAI Codex/ChatGPT Desktop
  reconhecidas, usando InstallLocation e existência de `app/ChatGPT.exe`. Uma
  instalação em execução é preferida; ambiguidade é erro, não escolha arbitrária.
- CDP: `GET http://127.0.0.1:9223/json`, procurando page + `app://-/index.html`.
  IDs são redescobertos em cada conexão. Um target correto e um dono de porta da
  instalação esperada permitem reutilização sem restart.
- Conflitos ChatGPT: somente ExecutablePath da instalação selecionada.
  CloseMainWindow é tentado antes de encerramento forçado. PID, executable e
  CreationDate são conferidos novamente antes de cada encerramento.
- Claudinho: projeto Free-Claude existente, com server.py, api/app.py, api/routes.py,
  pyproject.toml, uv.lock, .env e ambiente Python já configurado. Descobre uv no PATH
  ou instalação pessoal. O launcher não copia secrets nem modifica o .env.
- Comando oficial adaptado apenas para loopback e dependências já instaladas:
  `uv run --frozen --no-sync uvicorn server:app --app-dir <projeto> --host 127.0.0.1 --port 8082 --timeout-graceful-shutdown 5`.
- Health real do proxy: `/health` deve retornar `{"status":"healthy"}`. Dono da
  porta também precisa corresponder ao projeto, nunca apenas ao nome python/node.
  O redirecionador de venv Windows é reconhecido pelo Python base de pyvenv.cfg,
  launcher e uvicorn da .venv e argumento app-dir exato.
- Serviços saudáveis são reutilizados. Serviço alheio na porta causa FAILED,
  nunca encerramento indiscriminado. Serviços externos continuam vivos quando
  o Office fecha, para serem reutilizados no próximo lançamento.

O proxy 8082 é um serviço local adicional já solicitado. O adaptador FreeClaude
do AI Office continua usando Messages/OpenRouter diretamente: health do proxy
não comprova o caminho de inferência nem altera a configuração do agente.

## Configuração, estado e logs

Arquivos em `<userData>/startup`: config.json (pasta do projeto), status.json,
startup.log, startup.lock e subpastas por nonce com plan/ready/commit. O projeto
é procurado em diretórios irmãos no desenvolvimento; se não encontrado, um
seletor nativo solicita a pasta uma vez. Não é necessário abrir um terminal.
Dependências ausentes produzem erro; não há instalação/download silencioso de
um projeto ou runtime Python desconhecido.

Lock exclusivo com PID e CreationDate evita duplicação. Recuperação de lock
obsoleto é serializada; locks ilegíveis ou recuperação interrompida falham fechados.
Há no máximo 20 sondagens por componente, backoff até 1,5 s, HTTP até 1,5 s,
operações Windows até 15 s e encerramento com duas esperas limitadas.
Não existem loops infinitos de reinício.

A tela Provedores mostra o último estado de inicialização e sua data. Não é um
monitor contínuo de saúde: status RUNNING significa a última validação de startup,
não garantia de que o processo permaneça vivo para sempre. Logs próprios contêm
timestamp, componente, PID, porta, ação/estado e códigos de erro, sem comandos,
credenciais ou mensagens do usuário.

O NSIS/electron-builder existente inclui os helpers através de desktop/**/*.
Fixtures, testes e script de diagnóstico ficam excluídos do empacotamento.
Nome, App ID, versão candidata 1.4.0 e diretórios de dados foram preservados.
`--skip-runtime-bootstrap` existe somente para smoke isolado da interface;
usá-lo não comprova startup real dos agentes.

## Evidências e limites

- Testes unitários: reutilização, restart após handoff, conflitos, processos
  alheios, idempotência, timeout, ocultação configurada, argumentos e identidade.
- Teste Windows real: um filho criado via CIM completou após encerramento do
  pai descartável criado exclusivamente pelo teste.
- Teste Electron real: helper correto emitiu ready e abortou sem commit,
  registrando HANDOFF_TIMEOUT, sem STOPPING.
- Descoberta AppX e uv: validada nesta máquina, sem versão fixa no código.
- Claudinho real: iniciado ocultamente, `/health` respondeu healthy; segunda
  sondagem confirmou identidade e reutilização do PID 21124 na porta 8082.
- Typecheck, lint (12 warnings preexistentes), build e suíte Vitest passaram.
- A ausência visual de consoles persistentes e a sequência destrutiva completa
  ChatGPT → encerramento → CDP 9223 não foram verificadas por QA visual real.
- O setup.exe 1.4.0 foi produzido em seguida por solicitação explícita do usuário,
  sem restart real. Packaging e smoke isolado passaram (docs/releases/1.4.0.md).
  O aceite integral do runtime ainda depende do restart, target desktop e fluxo multiagente.

Não declarar a missão integralmente concluída com base apenas nos testes mockados.
Nenhum ChatGPT/Codex real foi encerrado durante esta implementação.

## Testes

`npm test` executa Vitest e os testes Node do launcher.
`npm run test:startup` executa o conjunto do launcher. Os dois testes Windows
reais exigem `AI_OFFICE_TEST_WINDOWS_BOOTSTRAP=1`; sem opt-in ficam SKIPPED.
Esses testes reais utilizam fixtures e handoff sem commit; nunca autorizam o
encerramento do host atual. A cobertura Vitest não inclui os módulos CJS desktop.
