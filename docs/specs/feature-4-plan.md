# Plano de implementação: Fase 4 — Integração Convex ↔ n8n

Spec: [feature-4.md](feature-4.md). Este arquivo reúne o plano e a lista de tarefas; marque `[x]` conforme for concluindo.

## Visão geral

Sete tarefas em três blocos. Primeiro vem o HMAC, que tem maior risco técnico e é base de tudo. Depois as notificações que saem do Convex. Por fim os endpoints que o n8n chama. O `docker-compose` e o script de assinatura fecham o teste manual de ponta a ponta. Cada tarefa entrega um caminho completo e testado, e o sistema continua funcionando depois de cada uma.

## Decisões de arquitetura

As perguntas em aberto da spec foram resolvidas com a proposta padrão:

- **Retry:** não há retry no Convex; a falha fica registrada como `failed`.
- **Cancelamento pelo borrower:** não notifica o lender.
- **`workflow_error`:** fica para a Fase 5.
- **Chave HMAC:** uma só para as duas direções.
- **Ponto único de gatilho:** `transition()` agenda a notificação de mudança de status, e `loans.request` agenda a do pedido novo. Assim nenhuma rota de status fica sem notificação.
- **Leitura do Convex nas HTTP actions e na action:** passa por funções `internal*`. Nenhuma função pública nova é criada, então o cliente não ganha nenhuma superfície de ataque.
- **Só a action fala com a rede:** queries e mutations continuam puras, e a action recebe tudo que precisa via `ctx.runQuery`.

## Grafo de dependências

```
T1 hmac.ts ──┬── T2 notificação do pedido ── T3 notificação de status
             ├── T4 GET /overdue-loans ── T5 POST /reminder-status
             └── T7 sign-request.mjs + e2e manual
T6 docker-compose (independente) ───────────┘
```

O T6 pode rodar em paralelo com qualquer outra tarefa. O T2/T3 e o T4/T5 são independentes entre si depois do T1. Os dois blocos compartilham apenas `automationEvents`, cujo schema não muda.

## Lista de tarefas

### Bloco 1: Fundação

- [x] **T1: Helper de HMAC** (S)
  - **O quê:** criar `sign` e `verifyRequest` em `convex/lib/hmac.ts`, seguindo o formato da spec (`timestamp\nMETHOD\npath\nbody`, janela de 300s, `crypto.subtle.verify`, fail closed sem secret).
  - **Aceite:**
    - [x] Uma assinatura correta passa; corpo, path, método ou timestamp adulterados falham.
    - [x] Header ausente, hex malformado, timestamp que não é número e secret vazio retornam `false`, sem lançar exceção.
  - **Verificar:** `npx vitest run convex/lib/hmac.test.ts`. É aqui que se confirma se `crypto.subtle` funciona no edge-runtime do convex-test (o maior risco técnico do plano).
  - **Depende de:** nada.
  - **Arquivos:** `convex/lib/hmac.ts`, `convex/lib/hmac.test.ts`.

### Bloco 2: Notificações saindo

- [x] **T2: Notificar o lender quando chega um pedido** (M)
  - **O quê:** criar `convex/notifications.ts` com `send` (internalAction), `loadPayload` (internalQuery) e `record` (internalMutation). O `loans.request` agenda `send` com `status: "pending"`. A action monta o payload mínimo, verifica a idempotência por `notify:${loanId}:${status}`, faz o POST assinado com timeout de 10s e registra `sent` ou `failed`.
  - **Aceite:**
    - [x] Depois de `request`, sai um POST para `N8N_WEBHOOK_URL` com os headers de assinatura válidos e `recipient.email` igual ao do lender (o e-mail do borrower não aparece no corpo).
    - [x] Uma resposta 500, um erro de rede ou `N8N_WEBHOOK_URL` ausente registram `failed` com `detail`, e a mutation do usuário continua tendo sucesso.
    - [x] Rodar `send` duas vezes para o mesmo `loanId:status` gera um único POST.
  - **Verificar:** `npx vitest run convex/notifications.test.ts` (com `fetch` mockado via `vi.stubGlobal`, fake timers e `t.finishAllScheduledFunctions`) e `npm test` (os 22 testes atuais continuam verdes).
  - **Depende de:** T1.
  - **Arquivos:** `convex/notifications.ts`, `convex/notifications.test.ts`, `convex/loans.ts`.

- [x] **T3: Notificar o borrower a cada mudança de status** (S)
  - **O quê:** `transition()` em `convex/lib/lifecycle.ts` agenda `send` depois do `patch`, com o destinatário escolhido pela tabela da spec.
  - **Aceite:**
    - [x] `approve`, `decline` e `markReturned` notificam o borrower com o `status` correto.
    - [x] Um `approve` que recusa automaticamente pedidos sobrepostos notifica cada borrower recusado.
    - [x] Remover uma ferramenta notifica os borrowers dos empréstimos cancelados.
  - **Verificar:** `npx vitest run convex/notifications.test.ts` e `npm test`.
  - **Depende de:** T2.
  - **Arquivos:** `convex/lib/lifecycle.ts`, `convex/notifications.test.ts`.

#### Checkpoint A (depois de T1–T3)

- [x] `npm test`, `npm run typecheck` e `npm run lint` passam.
- [ ] No navegador, pedir e aprovar continua funcionando com o n8n desligado, e `automationEvents` mostra `failed` no dashboard do Convex.
- [ ] Revisar com você antes de seguir.

### Bloco 3: Endpoints para o n8n

- [x] **T4: `GET /overdue-loans`** (M)
  - **O quê:** criar `convex/http.ts` com o `httpRouter` e `convex/automation.ts` com `overdue` (internalQuery que usa o índice `by_status_endDate`). A rota verifica o HMAC e responde 401 sem corpo quando a assinatura falha.
  - **Aceite:**
    - [x] Sem assinatura, com assinatura inválida ou com timestamp velho: 401.
    - [x] Com assinatura válida: devolve só empréstimos `approved` com `endDate < hoje`, no formato da spec e com `daysOverdue` correto.
    - [x] Empréstimos com lembrete `sent` hoje (`reminder:${loanId}:${hoje}`) ficam de fora.
  - **Verificar:** `npx vitest run convex/http.test.ts` (com `t.fetch`).
  - **Depende de:** T1.
  - **Arquivos:** `convex/http.ts`, `convex/automation.ts`, `convex/http.test.ts`.

- [x] **T5: `POST /reminder-status`** (S)
  - **O quê:** criar a rota e `recordReminder` (internalMutation) em `convex/automation.ts`. O corpo é lido uma vez, verificado e só então passa por `JSON.parse`. As regras de upsert e validação são as da spec.
  - **Aceite:**
    - [x] `loanId` inválido ou inexistente, data inválida, status fora do enum, `detail` com mais de 500 caracteres ou JSON quebrado: 400.
    - [x] Repetir o mesmo `sent` deixa um único evento, e `failed` seguido de `sent` vira `sent`.
    - [x] Depois de um `sent` hoje, o empréstimo some do `GET /overdue-loans`.
  - **Verificar:** `npx vitest run convex/http.test.ts`.
  - **Depende de:** T4.
  - **Arquivos:** `convex/http.ts`, `convex/automation.ts`, `convex/http.test.ts`.

#### Checkpoint B (depois de T4–T5)

- [x] `npm test`, `npm run typecheck` e `npm run lint` passam.
- [x] `npx convex dev` sobe sem erro e as rotas aparecem em `:3211`.

### Bloco 4: Infra e verificação manual

- [x] **T6: `docker-compose.yml` e variáveis de ambiente** (S)
  - **O quê:** serviços `n8n` e `mailpit` com versões fixas, volume `n8n_data` e `extra_hosts: host.docker.internal:host-gateway`. As variáveis vêm de `.env`. Adicionar o bloco novo no `.env.example` e garantir que `.env` está no `.gitignore`.
  - **Aceite:**
    - [x] `docker compose up -d` deixa o n8n em `:5678` e o Mailpit em `:8025`.
    - [x] Um workflow criado no n8n sobrevive a `docker compose down && docker compose up -d`.
    - [x] `git status` não mostra nenhum arquivo com segredo.
  - **Verificar:** subir, abrir as duas UIs, reiniciar e conferir a persistência.
  - **Depende de:** nada (pode ser feita em paralelo).
  - **Arquivos:** `docker-compose.yml`, `.env.example`, `.gitignore`.

- [x] **T7: Script de assinatura e teste de ponta a ponta** (S)
  - **O quê:** criar `scripts/sign-request.mjs` (Node puro, mesmo formato do T1), que recebe o método, o path e o corpo e imprime os headers prontos para usar no `curl`. Documentar o uso no README, numa seção curta da Fase 4.
  - **Aceite:**
    - [x] Os headers gerados recebem 200 nos dois endpoints; alterar um byte do corpo dá 401.
    - [ ] Com um webhook de teste no n8n (`/webhook-test/loan-notification`), pedir e aprovar pela UI faz chegar dois POSTs com o payload da spec, e `automationEvents` registra `sent`.
  - **Verificar:** roteiro manual com `curl` mais o fluxo no navegador.
  - **Depende de:** T3, T5 e T6.
  - **Arquivos:** `scripts/sign-request.mjs`, `README.md`.

#### Checkpoint final

- [x] Todos os critérios de sucesso da spec (1 a 6) estão atendidos.
- [x] Marcar a Fase 4 como concluída no `PLAN.md`.
- [ ] Revisar com você antes da Fase 5.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| `crypto.subtle` indisponível ou diferente no edge-runtime do convex-test | Alto | O T1 vem primeiro e testa isso logo. Se falhar, testar `sign`/`verify` no ambiente Node do Vitest (`// @vitest-environment node`) e manter o convex-test só para as rotas. |
| Ações agendadas pelos testes existentes rodando em segundo plano (fetch real, escrita depois do fim do teste) | Médio | O `send` sai cedo quando não há `N8N_WEBHOOK_URL`. Se os 22 testes ficarem instáveis, usar `vi.useFakeTimers()` no setup compartilhado. |
| O Convex local não alcança o n8n, ou o n8n no Docker não alcança o Convex | Médio | Usar `localhost:5678` para chegar ao n8n e `host.docker.internal:3211` para chegar ao Convex, com `extra_hosts` no compose. Validado no T7. |
| Diferença de relógio entre o n8n e o Convex derrubando assinaturas | Baixo | Janela de 300s; os dois rodam na mesma máquina. |
| Divergência entre o formato de assinatura do Convex e o do n8n/script | Médio | O formato fica definido num lugar só (spec e T1), e o script do T7 é testado contra os endpoints reais. |

## Perguntas em aberto

Nenhuma bloqueante. Se você quiser outra resposta para alguma das quatro decisões da spec (retry, cancelamento, `workflow_error`, chave única), mude antes do T2: só o T2 e o T3 seriam afetados.
