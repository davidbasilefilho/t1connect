# T1 Connect — plano de paridade e host Rust

Proposta de engenharia, 26 de novembro de 2026. Nenhum rewrite, serviço, conta
externa, fork permanente ou integração com credenciais foi criado para este plano.

## Decisão de produto

Substituir **T3 Connect**, não **T3 Code**. Preservar T3 Code upstream como app
desktop/web/mobile, servidor de ambientes, origem dos eventos, executor de agentes e
dono dos protocolos normais de sessão. T1 Connect fornece o plano de controle
auto-hospedável e o componente host/CLI que participa dele, inicialmente em um
ambiente opt-in e administrado pelo próprio dono. O PR #1 é uma referência
executável JS do laboratório, não um host T3 Code nem um substituto já compatível.

Nos fluxos upstream o relay cuida de conta, descoberta, vínculo, concessões de
bootstrap, alocação de rotas/túneis, presença operacional e notificações. Ele não
intermedeia normalmente as requisições HTTP/WebSocket de threads. Elas seguem para
o servidor T3 Code pelo endpoint alcançável daquele ambiente. O host valida provas
assinadas, vincula credenciais ao dispositivo, mantém política e aprovações e
aplica autorização de sessão e RPC. Webhooks, guest links e push têm caminhos
auxiliares próprios. Um eventual túnel não vira uma autoridade para conceder
permissões e não hospeda turnos. [Arquitetura][connect] · [Auth do host][auth] ·
[Fluxo cliente][conn] · [Fonte relay][relay]

## Compatibilidade e escolha de caminho

Fontes inspecionadas em T3 Code v0.1.12 (ca81b7b) e T1OS ba0c04c (pin T3 Code
v0.1.10). A conclusão a seguir é de leitura de código, não de smoke test dos
binários oficiais instalados. Nenhum cliente autenticou numa conta externa.

| Superfície | Comprovado no source | Validação ainda necessária |
| --- | --- | --- |
| Host/CLI instalado | O resolver aceita em runtime T3CODE_RELAY_URL, T3CODE_CLERK_PUBLISHABLE_KEY, T3CODE_CLERK_CLI_OAUTH_CLIENT_ID e T3CODE_HOSTED_APP_URL, com valores embutidos como fallback. A URL do Clerk deriva da publishable key. O CLI usa PKCE com loopback e tem grant de autorização por dispositivo independente para headless/SSH. T3CODE_CLERK_JWT_TEMPLATE é do login dos clientes gráficos, não o client ID do CLI. [Resolver][servercfg] · [Build][serverbuild] · [Setup][setup] | Aplicar no processo interativo, no serviço do sistema e no app desktop que inicia o servidor pode ter precedência e herança diferentes. Validar DNS, certificados, retorno PKCE e o caminho headless em fixtures, inclusive quando o hosted web origin também precisa mudar. |
| Web e renderer desktop | Web lê Vite import.meta.env, o build injeta VITE_T3CODE_RELAY_URL, publishable key e template JWT, e o build de desktop também recebe configuração pública. Não foi localizada preferência suportada que troque o perfil Connect do binário gráfico oficial instalado. Adicionar ambiente/endereço direto é outra função. Com chaves de produção, o browser também exige HTTPS, porta padrão e domínio/subdomínio compatível com a Frontend API do Clerk. O renderer Electron segue seu próprio caminho de auth. [Web publicConfig][webcfg] · [Vite][webbuild] · [Desktop Vite][desktop] · [Script de config][publiccfg] | Demonstrar que um pacote recompilado aponta só para o relay/IdP de teste e que Web/desktop respeitam origem, redirecionamento e armazenamento isolados. Confirmar passkey apenas em build assinado e com entitlement/domínio próprios. |
| iOS/iPadOS/Android | App lê Expo Constants.expoConfig.extra. EAS injeta valores de build. Redirects Android dependem do package/variante; Apple depende de associated domains, entitlement, team/bundle e callbacks/serviços autorizados. Build oficial usa configuração, identidade de assinatura e canal OTA da origem. [App config][mobilebuild] · [Mobile publicConfig][mobilecfg] · [Configuração e redirects][setup] | Confirmar rotas, variantes, deep links e armazenamento por plataforma. Apps oficiais das lojas não ganham nova conta/relay simplesmente por trocar um env no servidor. Sem cooperação upstream, binários próprios são recompilação upstream com identidade própria, não atualização da loja oficial. |
| Relay, notificações e assinatura | Configuração pública de cliente não substitui a secret do relay. Sessão Clerk para audiência configurada ou bearer OAuth viram principal de conta; token DPoP tem escopo, chave e prova. Relays próprios também precisam persistência, estados, issuer e prova compatíveis. APNs, FCM e Live Activities são integrações com identidade do app e chaves distintas. [Relay API][relayapi] · [Relay bootstrap][connector] · [Operação e FCM][setup] · [Mobile notifications][notifications] | Validar emissão/mint/redeem, sign-in/reauth, app token/registration e suspensão. Não presumir que seeds, push tokens, entitlements ou assinaturas das lojas oficiais são reutilizáveis em outro serviço. Fixture de push sem produção primeiro. |

1. **Usar T3 Code oficial instalado via pareamento direto** para validar o plano de
   dados em uma rede privada alcançável. Funciona sem login Connect, sem substituir
   host/app e sem copiar código. Não cobre conta/discovery, bootstrap automático
   mediado por relay, provisionamento do túnel, transição de rotas Connect, push
   Connect ou links que dependem do endpoint gerenciado. Não vender a experiência
   como paridade. [Guia de acesso][remote] · [Rotas/identidade][remote-arch]
2. **Primeira trilha de paridade gerenciada**: verificar se builds a partir de
   upstream intacto e um perfil explícito, com host/CLI upstream, bastam usando
   um relay T1 compatível. A [.env.example][env-example] é configuração de source build, não preferência de app instalado. Cobrir Vite, Expo, variáveis runtime do host, domínio
   HTTPS, issuer, audiência/template, callbacks, registro do cliente OAuth/PKCE,
   device grant, origens/CORS, associação Apple e limites de assinatura. URLs/chaves
   bastam apenas para seleção do perfil em uma build/configuração compatível que
   já tenha os contratos, identidades, permissões e destinos configurados. Elas
   não implementam descoberta, provisioning, prova, autorização, push ou
   políticas do host. Compatibilidade temporária com Clerk próprio é uma opção
   de avaliação futura e opt-in, não requisito estratégico. Nada é ativado agora.
3. **Patch/adaptador mínimo, de preferência upstream**, só quando (2) demonstrar
   lacuna. Propor perfil Connect selecionável, escopo e trust discovery verificável,
   um ponto de extensão de identidade se necessário, origens e redirects explícitos
   e remoção segura da conta/cache quando trocar de perfil. Um IdP que não emite
   as identidades esperadas pelo cliente não substitui Clerk apenas por DNS ou
   variável. Preferir login padrão interoperável quando o upstream permitir. Um
   pequeno build fino pode carregar perfis explícitos enquanto a mudança não for
   aceita. Apps oficiais de loja só mudam via versão/participação upstream,
   inclusive push/assinatura. Não criar clientes T1 independentes sem demonstrar
   a incompatibilidade e apresentar a decisão ao mantenedor.

Os schemas upstream publicados em contracts e as implementações client-runtime,
relay e environment auth são verificáveis no source. Isso não demonstra uma API
pública estável para terceiros nem promessa drop-in entre versões. Extrair
matriz por versão e fixtures de conformidade, não redistribuir fonte sem
necessidade. O próprio T1 é Apache-2.0. Para qualquer derivado MIT, registrar
arquivo, commit, licença, alterações e avisos originais e manter os avisos
distribuídos. Sem marcas/logo de upstream como identidade própria.

## Matriz de paridade

Status atual de todas as linhas fora das funções sintéticas do PR #1: **não
implementado**. A matriz define cobertura e evidencia onde o comportamento ainda
deve ser observado em instalações de teste próprias. Testes aqui são propostas.

| Fluxo e fonte primária | Lacuna no laboratório | Alternativa proposta | Aceitação ponta a ponta |
| --- | --- | --- | --- |
| Instalação, primeiro uso, background, modo remoto, status e desligamento [remote] [background] | Três CLIs JS e serviço candidato, sem instalação ou host integrado | Companion Rust opt-in, com lifecycle separado do T3 Code; os mesmos comandos e status distinguem instalado/ligado/conectado | Em VM sem credenciais, instalar só com opt-in, sem acesso por padrão. Ligar, observar status, fechar UI e testar política de persistência; desligar preserva estado e corta rotas esperadas. |
| Login desktop/web/mobile, CLI PKCE e device grant headless [setup] [servercfg] | Só CA descartável e aprovação local | Perfil upstream compatível, depois identidade plugável; conta não equivale a autorização do host | Em cada plataforma de teste, login, negação/cancelamento, timeout, logout/relogin, conta errada, callback inválido e headless sem encaminhar callback; sem dados sensíveis em logs. |
| Adicionar ambiente, convite/QR, aprovação, múltiplos dispositivos, recuperação/rotação [remote] [auth] | Grant sintético preso a um certificado/tarefa | Manter bootstrap e aprovação do T3 Code, e recuperar conta/descoberta sem recuperar privilégios revogados | Novo dispositivo pendente até dono aprovar; invólucro vence e não pode ser reutilizado; negar/recuperar/chave nova/reparear sem ampliar escopo; interface distingue identidade de rota. |
| Descoberta, vínculo, status, desvínculo e roteamento [relay] [connector] [remote-arch] | Sem catálogo nem relay | Registro de ambientes com chaves por host, estado de rota fora do caminho dos turnos | Criar, listar, vincular, desligar, lidar com host offline, recolher rotas obsoletas; conta não vinculada não descobre ambiente, e uma sessão ativa continua quando só discovery fica indisponível. |
| Limites por conta e vínculo opcional T3 Chat [remote] | Sem multiambiente nem quotas | Paridade de capacidade e UX com quotas locais administráveis. Não copiar vínculo pago nem exigir conta T3 Chat. | Atingir limite sem afetar vínculos autorizados; elevar/reduzir quota sem ampliar escopos e recuperar ambiente existente após bloqueio de novos vínculos. |
| Conectividade LAN/VPN/SSH, endpoint gerenciado e troca de rota [remote] [remote-arch] | Loopback, nenhum acesso remoto; SSH/LAN já pertencem ao T3 Code | Reusar acesso direto e seleção de rota upstream, adicionar transporte privado auto-hospedado somente para a rota Connect | Dois nós descartáveis, sem publicação real, atravessam rede simulada/NAT, trocam Wi-Fi/rota e voltam ao caminho direto sem perder namespace de sessão; porta/origem permitidas são as do host explicitamente pareado. |
| Reconexão, replay, autenticação e continuidade [conn] [auth] | Replay sintético com cursor SQLite e reinício do daemon, não streams T3 | T3 Code continua dono dos streams e mutações. Adaptador Connect nunca reexecuta ação; restaura só descoberta/rota/concessão | Tarefa sintética no desktop, cliente alterna rota/perde link/reinicia; verifica sequência e snapshot, nenhuma ação duplicada, respostas sem avanço de cursor inválido; dados persistem sem discovery. |
| Controles normais de threads e sessão [usage] [auth] [remote] | Apenas visualização do progresso de uma ação fixa | Reutilizar UI e RPC upstream para listar/abrir/iniciar, mensagem/esteer, fila, interrupção/retry, aprovação, permissões e histórico; terminal/browser somente no próprio host onde permitido | Nos clientes upstream suportados, executar roteiro com provedor falso, compartilhar estado, cancelar, retomar, aceitar/negar aprovação e verificar que escopos host limitam a ação. Nenhuma execução arbitrária introduzida por T1. |
| Sessões, revogação de dispositivo, desconexão de conta, remoção de ambiente [remote] [auth] [connect] | Revogação sintética imediata verificada inclusive em TLS reutilizado e após segundo restart | Revogar grant no ponto de autoridade correto; remover capacidade já emitida/rota e impedir refresh; sessão local independente de conta | Revogar em fluxo ativo, testar novo acesso negado, race com refresh/reconnect, manter os demais dispositivos e rotas permitidos; reiniciar e repetir; descrever limite de dados já recebidos. |
| Clientes e UX nas plataformas suportadas [upstream-readme] [mobilecfg] [conn] | CLI Linux somente | T3 Code desktop Windows/macOS/Linux, web, iOS/iPadOS e Android. Fonte/design permanece upstream | Matriz real por versão; link/QR funciona, alternar contas/rotas, erros de confiança legíveis, status/reconnect visíveis, teclado/foco e leitor de tela no fluxo crítico. Plataforma sem smoke fica explicitamente sem selo. |
| Notificações, push, Live Activities [notifications] [relay] [setup] | Sem notificação | Adaptador de evento mínimo, opt-in e dedupe; APNs/FCM só quando autorizado e com identidade correta; equivalente local/push simulado primeiro | Fixtures recebem eventos permitidos e cada notificação/ação abre a sessão certa. Vencimento, duplicação, logout, opt-out e atraso passam. Push real assinado só em ambiente autorizado separado; não confundir mock com serviço de loja. |
| Guest links, links entre ambientes e webhooks [guests] [remote-arch] [connect] | Sem compartilhamento, links ou forwarding | Separar recursos opcionais suportados e betas. Em T3 Code, preservar projeção de guest, identidade/grant de peer e validação de payload no host | Link limitado a thread/escopo e revogável, origem/nonce vinculados, confirmação explícita de peer, nenhum acesso lateral em outro ambiente. Fixture de webhook não publica serviço ou executa comandos. |
| Auto-hospedagem, administração, exclusão, upgrade e rollback [relay] [setup] [t1os] | Apenas laboratório, sem carga/ops de produção | Perfis privados versionados; identidade e transportes substituíveis; backup/restore, auditoria saneada e coleta opt-in. Não acoplar arquitetura à de Cloudflare | Instalar offline em VM, testar estado de rota e health, backup/restauração e manutenção, rota/tokens/links revogados não voltam; limpar sem modificar a configuração T3 Code/T1OS original. |

## Rust e operação do host sem Node

- Workspace Cargo proposto: protocol (tipos, validação de envelopes e limites),
  policy (identidades, approvals, grants e transições), storage (SQLite, migrations
  e journal), hostd (transporte e lifecycle), hostctl (admin local) e contract-tests.
  O adaptador Connect fica separado de qualquer endpoint de T3 Code. Relay
  auto-hospedado e clientes upstream não são dependências para instalar o hostd.
  Não reimplementar o HTTP/WS de threads ou o servidor de ambientes T3 Code.
- Compatibilidade em camadas: o primeiro Rust mantém wire v1 do JS apenas para
  testes diferenciais de mTLS, autorizações, cursor e revogação. Comparar ambos
  com cerimônia externa idêntica. Depois validar o adaptador contra releases
  upstream específicos, com negociação explícita, rejeição fechada de versões
  desconhecidas e fallback apenas para rotas configuradas e autorizadas.
- Componentes candidatos, não selecionados ou instalados: Tokio (runtime),
  rustls (TLS), serde e rusqlite. Antes da seleção, comparar licenças, advisories,
  baseline de dependências, cadeia nativa/C, manutenção, MSRV e portabilidade.
  Criptografia via biblioteca revisada; sem algoritmos próprios ou tráfego de
  dados fora da rota do host. Capabilities específicas e segredo nunca no log.
- Nenhuma operação propensa a panic em código próprio de produção. Tipar erro
  com Result/Option e contexto redigido, incluir timeout/cancelamento/IO. Proibir
  unwrap/expect falíveis, panic!, todo!, unimplemented! e indexação sem checagem
  por lints Clippy no código de produção; revisar slicing, aritmética, conversão,
  locks, canais e outras APIs não cobertas. Exercitar erros de disco e de rede,
  reentrada e shutdown. Não ocultar com panic=abort ou catch_unwind nem estender
  essa afirmação a dependências externas.
- Concorrência estruturada com dono explícito de cada tarefa, fila limitada e
  backpressure, cancelamento propagado e join no shutdown; um escritor ordena
  cada journal. Limitar tarefas/sockets/filas por host e dispositivo. Paralelizar
  só fluxos independentes quando o benchmark comprovar ganho. Testar timeout,
  fila cheia, cancelamento, pausa/reentrada e ordenação sob corridas permitidas.
- Migração: criar schema versionado e importador offline somente após fixtures
  binárias/SQL revisadas. Nenhum daemon JS/Rust escreve no mesmo banco ao mesmo
  tempo. Exportar snapshot coerente, verificar integridade, grant/revogação,
  epoch/idempotência, sequência e limite. Nunca exportar bearer temporário.
  Manter a base T3 Code intocada. Rollback com snapshot verificado ou exportação
  reversível e read-only; se houver gravações pós-corte não descartáveis, bloquear
  rollback automático. Iniciar com estado descartável e sem cutoff real.
- Pipeline: mise resolve rust@stable. Hoje o manifesto oficial aponta Rust 1.100.0
  (12 nov 2026) [stable]. Registrar o resolve em CI/evidência com rustc -Vv,
  cargo -V, alvo, rustfmt, Clippy e versão de rust-analyzer. Enquanto a escolha de
  canal segue rust@stable, builds de comparação/releases futuros reusam o ID
  exato resolvido registrado, sem confundir canal móvel com toolchain reproduzível.
  rustfmt/rust-analyzer/Clippy/rust-src a partir do mesmo toolchain; Cargo.lock
  versionado, cargo --locked nos checks e sem dependências globais do hosts.
- Um conjunto de tasks mise para format check, cargo clippy --locked --workspace
  --all-targets --all-features com warnings como erro, cargo test --locked, check de
  dependências/licenças (cargo-deny/advisory pinado), build --release --locked e smoke
  dos binários. hk e CI chamam as mesmas tasks. UI/integrações TS existentes ou
  futuras continuam com Oxlint, Oxfmt e oxlint-tsgolint real. Sem Python.
- Builds: começar Linux x86_64 para VM T1OS; depois Linux aarch64 e macOS/Windows
  conforme contrato de host real, em runners/VMs por alvo. Registrar GNU/musl,
  linker, SDK e ABI; gerar SBOM, lista/avisos de terceiros e checksums. Repetir em
  dois diretórios/ambientes limpos equivalentes, comparar artefatos não assinados
  e separar assinatura/notarização da comparação. Arquivos Linux binários de
  teste devem responder --version, inicializar sem Node/PATH de ferramentas e
  completar fixture com UID não root. Não publicar artefatos nem assinar no plano.

## Métricas, hipóteses e limiares de avanço

Base JS executável: npm ci com lockfile (dev apenas), npm run verify, npm run demo,
npm run bench -- compare 3 4 e npm run bench:restart -- 6 no PR #1. Reportar versão,
SO, CPU, TLS, SQLite, modos, coletas e monotonic timing conforme [benchmark do
laboratório][bench]. Não usar comparação de TLS fresco versus pooling para
atribuir ganhos ao Rust. A comparação Rust/JS deve usar a mesma rota TLS/pinning,
persistência, fixture, política, CPU, protocolo, número de clientes e versão de
SQLite ou justificar diferenças com ensaio separado. A baseline existente só é
de loopback; CPU atual é do daemon, não da conexão móvel nem do trabalho dos agentes.

- **Carga**: baseline v1, quatro tarefas × 34 eventos, polling 15 ms, interrupção
  simulada 160 ms após cursor 5, 1/8/32 dispositivos em clones de carga, carga
  repetível de 60 s e modo idle de 2 min após aquecer processo. Rodar blocos AB/BA,
  6 pares mínimos por cenário e 3 blocos independentes para uma alegação de ganho;
  usar p50/p95, ocorrências/falhas, RSS do daemon e cliente separados, medianas por
  host e faixa/MAD dos blocos. Separar idle, burst, cold cache/warm, localhost e
  dois nós isolados. Se o ganho não exceder o ruído observado, não promover.
- **Segurança e correção** (não negociável): 100% dos casos válidos e negativas,
  nenhuma entrega após revogação confirmada, salvo resposta já autorizada
  explicitamente descrita pelo protocolo, zero perda/duplicação/reordenação
  dos eventos duráveis, replay sem mutação, e sem bypass duplicado por rota.
  Medir revogação, TLS, restart abrupto, disk failure, cancelamento, deadline
  e purga. Qualquer regressão reverte o candidato antes de otimização.
- **CPU/RSS**: equivalência primeiro. CPU mediana por quatro tarefas não acima
  de 110% da base com faixa/MAD; RSS de pico no máximo base +8 MiB. Só promover
  hipótese de eficiência com CPU pelo menos 20% inferior ou RSS pelo menos 15%
  inferior, em três blocos além do maior entre 10% e 2×MAD relativa, sem
  regressão em outras métricas. Limiares de 20%/15% excedem a variabilidade
  inicial observada no laboratório; recalibrar a janela se o ambiente for mais
  ruidoso, sem baixar o critério para aprovar uma mudança.
- **Latência**: com carga v1, entrega p95 ≤30 ms e no máximo +5 ms contra
  baseline pareada; pareamento p95 ≤50 ms sem tempo humano; reconexão p95 ≤100 ms
  após restauração; próxima tentativa pós-revogação negada em ≤50 ms local;
  interrupção de processo → novo evento p95 ≤500 ms, sem degradar mais de 100 ms.
  Reportar p50/p95 também sob carga; em rede simulada comparar separadamente a
  sobrecarga da aplicação e a RTT injetada. Nenhum alvo de rede móvel real ainda.
- **Cold start**: medir exec → readiness (não confundir com kill → restart), 25
  amostras por alvo e mesma classe de cache. Orçamento inicial Linux p95 ≤250 ms
  e ≤110% da base medida, para deixar margem no envelope de 500 ms de recuperação.
  Sem baseline de cold start publicada no PR #1. **Throughput**: eventos
  confirmados/s sustentados por 60 s em 1/8/32 clientes, ≥95% da base a mesmo
  p95-alvo com 0 perda e memória limitada. Inicialmente medir para calibrar
  (não usar a quantidade de progressos artificiais como max throughput).
- **Distribuição**: alvo provisório Linux x86_64 ≤25 MiB comprimidos do daemon +
  CLI, suficiente para um companion offline pequeno. Medir tamanho separado de
  ELF não assinado, compactado determinístico e instalação total; custo no JS
  inclui runtime Node para implantação equivalente, reportado separado do código.
  Valores são critérios apurados no futuro, não promessa de economia.
- **UX/DX**: pipeline com erro acionável, uma instalação limpa sem credenciais
  e validação em comandos compartilhados, pareamento/negação/revogação e
  recuperação observáveis. Validar 100% do roteiro teclado no fluxo crítico,
  anúncio de espera/reconnect/erro e falta de segredos em capturas; comparar
  tempo e passos de onboarding (não piorar, metas absolutas só após baseline).
  Tokens/cache/turnos/latência de agentes são uma coleta separada, somente
  quando observável e autorizada; não confundir com CPU/RSS ou duração desta sessão.

## Ordem de entrega e critérios de parada

1. **Lab privado JS** (#1). Fechar checkJs/lint/fmt/hooks e CI, eventos locais,
   release nenhuma. As futuras aprovações e rede privada não são promessas do #1.
2. **Conformidade e VM**. Separar PR de contratos/fixtures, smoke de pareamento
   direto com T3 Code pinado no T1OS e estável atual, e monitorar mudança no
   ambiente. O workspace desta sessão não oferece QEMU/libvirt/KVM nem
   namespace de rede isolado utilizável; não confundir parse do systemd com VM.
3. **Cargo host/CLI sem Node**, em pequenos PRs: toolchain/pipeline e unit tests,
   depois wire/projeção e SQLite, depois mTLS/aprovação/revogação e reprodução
   diferencial, depois benchmarks, shutdown/backpressure e empacotamento. Sem
   substituir JS até passar critérios e smoke de equivalência. Manter reversão
   local por versão.
4. **Plano de controle privado**. Primeiro links/discovery/controle de versão e
   prova de contrato com builds upstream em dois nós de teste. Depois rotas e
   tempo de vida, falhas e perda. Manter dados do turno no host/rota autorizados.
5. **Paridade de plataforma**. Passar cada linha da matriz com builds próprios
   de upstream ou suporte negociado, validar assinatura/push separadamente e
   decidir perfil de IdP só com evidência. Não pedir produção/loja
   automaticamente; essas etapas exigem autorização própria.
6. **Operação self-hosted**. Documentar manutenção, restore, rotação, revogação,
   migração e recuperação offline. Só declarar paridade em células testadas e
   registrar limitações reais. Qualquer melhoria segue hipótese → baseline
   → mudança isolada → medida pareada/guardrails → manter ou reverter.

[upstream-readme]: https://github.com/pingdotgg/t3code/blob/v0.1.12/README.md
[remote]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/user/remote-access.md
[remote-arch]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/internals/05_remote.md
[connect]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/internals/06_t3-connect.md
[auth]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/internals/04_environment-auth.md
[conn]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/internals/09_connection-runtime.md
[setup]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/operations/02_connect-setup.md
[env-example]: https://github.com/pingdotgg/t3code/blob/v0.1.12/.env.example
[relay]: https://github.com/pingdotgg/t3code/blob/v0.1.12/infra/relay/README.md
[relayapi]: https://github.com/pingdotgg/t3code/blob/v0.1.12/infra/relay/src/http/Api.ts
[connector]: https://github.com/pingdotgg/t3code/blob/v0.1.12/infra/relay/src/environments/EnvironmentConnector.ts
[servercfg]: https://github.com/pingdotgg/t3code/blob/v0.1.12/apps/server/src/cloud/publicConfig.ts
[serverbuild]: https://github.com/pingdotgg/t3code/blob/v0.1.12/apps/server/vite.config.ts
[webcfg]: https://github.com/pingdotgg/t3code/blob/v0.1.12/apps/web/src/cloud/publicConfig.ts
[webbuild]: https://github.com/pingdotgg/t3code/blob/v0.1.12/apps/web/vite.config.ts
[desktop]: https://github.com/pingdotgg/t3code/blob/v0.1.12/apps/desktop/vite.config.ts
[publiccfg]: https://github.com/pingdotgg/t3code/blob/v0.1.12/scripts/lib/public-config.ts
[mobilebuild]: https://github.com/pingdotgg/t3code/blob/v0.1.12/apps/mobile/app.config.ts
[mobilecfg]: https://github.com/pingdotgg/t3code/blob/v0.1.12/apps/mobile/src/features/cloud/publicConfig.ts
[notifications]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/user/mobile-notifications.md
[background]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/user/background-service.md
[usage]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/user/usage.md
[guests]: https://github.com/pingdotgg/t3code/blob/v0.1.12/docs/user/guest-links.md
[t1os]: https://github.com/davidbasilefilho/t1os/blob/ba0c04cec2891117a4cd3027c85f541a691a38bf/runtime/agent/README.md
[stable]: https://static.rust-lang.org/dist/2026-11-12/channel-rust-stable.toml
[bench]: https://github.com/davidbasilefilho/t1connect/blob/work/private-lab/docs/benchmark.md
