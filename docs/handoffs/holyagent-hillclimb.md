# Repasse para HolyAgent — hillclimb reutilizável

Candidatos para a sessão existente considerar, sem criar uma sessão ou código
duplicado. Têm aplicação a desempenho, segurança defensiva, confiabilidade,
documentação, experiência de usuário e de desenvolvimento. Não pressupõem
linguagem, framework, runtime de agente ou interface gráfica específicos.

1. **Um ledger para cada mudança material.** Registrar baseline imutável,
   hipótese falsificável, única diferença sob teste, workload/versões/ambiente,
   critérios e decisão manter/reverter/pendente. Sempre registrar candidatos
   rejeitados; não reclassificar uma medida depois de vê-la. Dividir correção
   de otimização. Uma correção útil pode demonstrar guardrails sem reivindicar
   redução de latência.
2. **Verificar se o tratamento ocorreu.** Adicionar um controle negativo e
   observar a variável manipulada, não só o resultado final. Uma opção habilitada
   sem efeito observável, um linter que não processou a extensão ou um hook apenas
   instalado não são evidência. Para checks de DX, provar que um caso bom passa e
   que um caso ruim mínimo e sintético falha sem alterar o conteúdo esperado.
3. **Comparação e ruído.** Manter carga e condições fixas, separar warm/cold,
   idle/burst, medir repetidamente com ordem AB/BA, guardar amostras e quantis com
   cardinalidade, faixa/MAD e limites. Se a hipótese não exceder o ruído,
   classificar como inconclusiva. Não comparar teste local com cliente móvel,
   benchmark de processo com rede real, ou tempo de workflow com latência do
   produto. Crescimento de custo e riscos têm gates independentes.
4. **Resiliência e UX no mesmo nível de desempenho.** Reaplicar critérios
   observáveis de autorização, perdas/duplicatas, estado, recuperação, cancelamento,
   timeout, IO indisponível, mensagens de erro e acessibilidade quando a mudança
   os afeta. Usar fixtures descartáveis e observação de logs saneados. Não transformar
   casos defensivos em reprodução ofensiva.
5. **Prontidão verificável.** Vincular base/head e comandos à revisão. Separar
   ausência de conflito, evidência local, check remoto e aprovação exigida. Para
   ferramenta de verificação, script compartilhado, lockfile e execução real;
   checar hooks no evento Git instalado. Não mascarar indisponibilidade nem
   "verde" em outro commit. Continuar trabalho reversível e isolado quando um
   ambiente não permite a validação completa.
6. **Recibo de ativação e telemetria.** Distinga dist-tag resolvida, instalação,
   resposta de versão, dry-run, backend disponível, integração realmente ativa e
   coordenação observada. Não atribua trabalho a uma harness não selecionada.
   Registre, quando a harness disponibiliza, modelo/versão, chamadas, turnos,
   tokens de entrada/saída/cache e latência do agente em trilha separada. Caso
   contrário marque indisponível sem inferência a partir do texto ou tempo de
   sessão. Não exigir acesso a credenciais ou telemetria global para medir.

Evidência da experiência de origem: [registro de iterações do PR #1][ledger],
[benchmark de transporte e de reinício][measurements] e
[execuções de CI por commit][ci]. As regras e gates são candidatos para adaptação,
não mudanças já aplicadas ao HolyAgent.

[ledger]: https://github.com/davidbasilefilho/t1connect/blob/work/private-lab/docs/iterations.md
[measurements]: https://github.com/davidbasilefilho/t1connect/blob/work/private-lab/docs/benchmark.md
[ci]: https://github.com/davidbasilefilho/t1connect/pull/1/checks
