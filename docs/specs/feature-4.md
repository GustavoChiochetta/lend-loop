# Spec: Fase 4 — Integração Convex ↔ n8n

Status: **implementada** na branch `feat/fase-4-n8n`. Referência: [PLAN.md](../../PLAN.md), Fase 4. Plano de execução: [feature-4-plan.md](feature-4-plan.md).

## Premissas

1. O Convex continua no **deployment local anônimo** (`127.0.0.1:3210`, site em `:3211`), rodando no host. Então o Convex chama o n8n em `http://localhost:5678`, e o n8n (no Docker) chama o Convex em `http://host.docker.internal:3211`.
2. Uma **única** chave compartilhada (`N8N_HMAC_SECRET`) assina as duas direções, como já está no `.env.example`.
3. Os workflows do n8n são da **Fase 5**. Aqui entra só o lado Convex, o `docker-compose.yml` e um script para testar o webhook manualmente.
4. Não entra nenhuma dependência nova. O HMAC usa Web Crypto (`crypto.subtle`), que existe no runtime padrão do Convex e no Node 22.
5. O Convex **não faz retry**. A falha fica registrada em `automationEvents`, e o retry é responsabilidade do n8n (Fase 5). Veja Decisões.

## Objetivo

Toda mudança relevante num empréstimo deve gerar uma notificação assinada para o n8n, e o n8n deve conseguir buscar os empréstimos atrasados e registrar os lembretes, sempre por canais autenticados com HMAC e carregando só os dados necessários.

Histórias:

- **Lender**: recebo um e-mail quando alguém pede minha ferramenta.
- **Borrower**: recebo um e-mail quando meu pedido é aprovado, recusado ou cancelado, e quando o lender confirma a devolução.
- **Borrower atrasado**: recebo um lembrete diário enquanto não devolvo (o envio é da Fase 5; aqui ficam os endpoints).
- **Admin/avaliador**: vejo em `automationEvents` o que foi enviado, o que falhou e por quê.

## Escopo

### 1. `docker-compose.yml`

- `n8n` (imagem `n8nio/n8n` com versão fixa) na porta `5678`, volume nomeado `n8n_data`, e `extra_hosts: host.docker.internal:host-gateway` para funcionar também no Linux.
- `mailpit` (imagem `axllent/mailpit` com versão fixa): SMTP na `1025` e UI na `8025`.
- Variáveis do n8n vêm de um `.env.n8n` lido pelo compose (`N8N_HMAC_SECRET`, `CONVEX_SITE_URL`), nunca hardcoded. O arquivo fica fora do `.env.local` para o Next.js nunca carregá-lo, e o `.gitignore` já o ignora. Entra um bloco novo no `.env.example`.

### 2. HMAC — `convex/lib/hmac.ts`

Formato da assinatura (o mesmo nas duas direções):

```
X-LendLoop-Timestamp: <unix seconds>
X-LendLoop-Signature: sha256=<hex>

mensagem = `${timestamp}\n${METHOD}\n${path}\n${rawBody}`   // GET: rawBody = ""
```

Método e path entram na mensagem para impedir que uma assinatura válida de um endpoint seja reaproveitada em outro.

```ts
// Os dois headers prontos para enviar.
export async function signedHeaders(secret: string, method: string, path: string, body: string): Promise<Record<string, string>>;
// true só se: headers presentes, |agora - timestamp| <= 300s, assinatura confere.
export async function verifyRequest(secret: string, req: Request, body: string): Promise<boolean>;
```

- A comparação é feita com `crypto.subtle.verify("HMAC", ...)`, que já é de tempo constante, em vez de comparar strings.
- Hex malformado, timestamp que não é número ou ausente: retorna `false`, nunca lança exceção.
- Sem `N8N_HMAC_SECRET` configurado, todo request é rejeitado (fail closed). Quem garante isso é a borda: o `signedRoute` em `convex/http.ts` recusa antes de chamar `verifyRequest`, e o envio registra `failed` sem chamar `signedHeaders`.

### 3. Notificações saindo — `convex/notifications.ts`

**Gatilho.** Um módulo só: `convex/lib/lifecycle.ts`. O `openLoan` cria o pedido como `pending` e o `transition()` muda o status; os dois agendam `internal.notifications.send` com o status novo. Assim ficam cobertos de graça os declínios automáticos do `approve` e os cancelamentos de `cancelLoansOfRemovedTool`. Como o agendamento é transacional, se a mutation falhar nada é enviado. O `seed:demo` insere empréstimos direto, de propósito, para os dados de exemplo não dispararem avisos.

**Destinatário por status** (a tabela `AUDIENCE` em `convex/notifications.ts`):

| status | destinatário | `event` |
|---|---|---|
| `pending` | lender | `loan.requested` |
| `approved`, `declined`, `cancelled`, `returned` | borrower | `loan.status_changed` |

**`internalAction send({ loanId, status })`:**

1. Busca os dados mínimos com a `internalQuery` `payload` (nome da ferramenta, datas, nome e e-mail do destinatário, via `loanContact`).
2. Se já existe evento `sent` com `idempotencyKey = notify:${loanId}:${status}`, não faz nada.
3. Faz POST para `N8N_WEBHOOK_URL` com o corpo abaixo, assinado.
4. Registra o resultado com a `internalMutation` `record`: `type: "request_notification"`, `status: "sent"` (resposta 2xx) ou `"failed"` (`detail` com o status HTTP, o erro de rede, `"N8N_WEBHOOK_URL not set"` ou `"N8N_HMAC_SECRET not set"`). Timeout do fetch: 10s.

```json
{
  "event": "loan.status_changed",
  "loanId": "k17...",
  "status": "approved",
  "recipient": { "email": "bob@example.com", "name": "Bob" },
  "tool": { "name": "Cordless drill" },
  "startDate": "2026-11-10",
  "endDate": "2026-11-12"
}
```

Minimização: só o e-mail do **destinatário**. Nada do e-mail da outra parte, nem descrição da ferramenta ou IDs de usuário. Essa projeção existe num lugar só, `loanContact` em `convex/lib/contacts.ts`, usado também pelo `/overdue-loans`.

**Idempotência.** Os eventos são identificados por uma referência, `{ kind: "notify", loanId, status }` ou `{ kind: "reminder", loanId, date }`. O `convex/lib/events.ts` deriva dela o `type` e a chave (`notify:<loanId>:<status>` ou `reminder:<loanId>:<data>`), e expõe só `recordEvent` e `wasSent`. O formato das chaves não pode mudar, porque o banco já tem linhas com ele; os testes o fixam.

### 4. `GET /overdue-loans` — `convex/http.ts`

- Assinado. Assinatura inválida ou fora da janela: `401` com corpo vazio, sem dizer o motivo.
- Retorna os empréstimos `approved` com `endDate < hoje` (índice `by_status_endDate`), **excluindo** os que já têm lembrete `sent` hoje. Assim o n8n pode rodar de novo no mesmo dia sem mandar e-mail duplicado.
- Resposta `200`:

```json
{
  "date": "2026-11-04",
  "loans": [
    {
      "loanId": "k17...",
      "borrower": { "email": "bob@example.com", "name": "Bob" },
      "tool": { "name": "Cordless drill" },
      "endDate": "2026-11-01",
      "daysOverdue": 3
    }
  ]
}
```

### 5. `POST /reminder-status` — `convex/http.ts`

- Assinado; o corpo cru é lido **uma vez** e usado tanto na verificação quanto no `JSON.parse`.
- Corpo: `{ "loanId": string, "date": "YYYY-MM-DD", "status": "sent" | "failed", "detail"?: string }`.
- Validação: o formato do corpo, a data ISO (`isIsoDate`), o status (`isAutomationEventStatus`) e o tamanho do `detail` (`LIMITS.automationDetail`, 500) são checados no `parseReminder` em `convex/http.ts`. O ID (`ctx.db.normalizeId`) e a existência do empréstimo são checados na mutation `recordReminder`. Qualquer violação: `400`.
- Idempotente pela chave `reminder:${loanId}:${date}`:
  - Não existe evento: insere.
  - Existe `failed` e chegou `sent`: atualiza para `sent` (um retry que deu certo).
  - Existe `sent`: não faz nada.
  - Em todos os casos responde `200 { "ok": true }`.
- Sem endpoint para `workflow_error` nesta fase (veja Decisões).

### 6. `.env.example` e README

- Documentar `N8N_WEBHOOK_URL`, `N8N_HMAC_SECRET` (Convex) e `N8N_HMAC_SECRET` + `CONVEX_SITE_URL` (compose).
- Script `scripts/sign-request.mjs`, que importa o `signedHeaders` de `convex/lib/hmac.ts` e imprime um `curl` assinado, para testar os endpoints sem o n8n. Roda com `npm run -s sign -- <METHOD> </path> [body]`, que usa o type stripping do Node 22 e lê o segredo do `.env.n8n`.

### Fora de escopo

Workflows do n8n, envio de e-mail, UI de "Notification sent / Reminder sent" (Fase 6), retry no Convex e rotação de segredo.

## Tech stack

Convex `^1.49` (HTTP actions, scheduler, internal functions), Web Crypto, Docker Compose, n8n e Mailpit. Testes com Vitest 5 + convex-test (`t.fetch` para as HTTP actions, `t.finishAllScheduledFunctions` com fake timers para o scheduler).

## Comandos

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
docker compose up -d
```

```bash
npx convex env set N8N_WEBHOOK_URL http://localhost:5678/webhook/loan-notification
```

```bash
npx convex env set N8N_HMAC_SECRET "$(openssl rand -hex 32)"
```

```bash
eval "$(npm run -s sign -- GET /overdue-loans)"
```

## Estrutura

```
convex/lib/hmac.ts            signedHeaders / verifyRequest
convex/lib/hmac.test.ts       testes unitários do HMAC
convex/lib/events.ts          EventRef, recordEvent, wasSent (idempotência)
convex/lib/contacts.ts        loanContact (o que o n8n pode saber das pessoas)
convex/notifications.ts       send (internalAction) + payload/record (internal) + tabela AUDIENCE
convex/notifications.test.ts  gatilhos, destinatário, idempotência, falha
convex/automation.ts          internals usados pelas HTTP actions (overdue, recordReminder)
convex/http.ts                signedRoute + /overdue-loans, /reminder-status
convex/http.test.ts           assinatura, validação, idempotência via t.fetch
convex/lib/lifecycle.ts       (alterado) openLoan + transition() agendam a notificação
convex/lib/dates.ts           (alterado) isIsoDate, daysBetween
convex/lib/validators.ts      (alterado) isAutomationEventStatus, LIMITS.automationDetail
convex/loans.ts               (alterado) request usa openLoan
docker-compose.yml
scripts/sign-request.mjs      curl assinado (npm run sign)
.env.example                  (alterado)
```

## Estilo de código

Seguir o que já existe: funções pequenas em `convex/lib`, erros com `appError` nas mutations e comentários só para o porquê. Nas HTTP actions, respostas são `Response` simples e sem detalhes de erro para quem não se autenticou.

Toda rota é registrada pelo `signedRoute`, que só chama o handler depois de a assinatura conferir:

```ts
signedRoute("GET", "/overdue-loans", async (ctx) =>
  Response.json(await ctx.runQuery(internal.automation.overdue, { today: todayIso() })),
);
```

## Estratégia de testes

Vitest + convex-test, no mesmo padrão de `convex/*.test.ts` (`setup()`, `signIn()`, `withCode()`). O `fetch` de saída é mockado com `vi.stubGlobal("fetch", ...)`.

- **hmac**: assinatura correta passa; corpo, path, método ou segredo alterados, timestamp a mais de 300s, header ausente e hex inválido falham.
- **notifications**: `request` notifica o lender; `approve`, `decline` e `markReturned` notificam o borrower, inclusive os pendentes recusados automaticamente; remover a ferramenta notifica os cancelados; o payload contém só o e-mail do destinatário; resposta 500, erro de rede, URL ou segredo ausente registram `failed`; rodar `send` duas vezes manda um único POST; um retry depois de falha vira `sent`; a chave gravada segue o formato `notify:<loanId>:<status>`.
- **http**: 401 sem assinatura, com assinatura inválida, velha ou de outro método, e com o segredo ausente mesmo que a assinatura confira; `/overdue-loans` lista só aprovados vencidos e some com quem já foi lembrado hoje; `/reminder-status` com corpo inválido dá 400 (inclusive array, `detail` que não é texto e acima de 500 caracteres), aceita exatamente 500, repetir não duplica, `failed` seguido de `sent` vira `sent`, e a chave gravada segue o formato `reminder:<loanId>:<data>`.
- Os 24 testes que já existiam continuam passando sem alteração. Total da fase: 43.

## Limites

- **Sempre:** verificar o HMAC antes de qualquer leitura de dados; rodar `npm test` e `npm run typecheck` antes de commitar; fixar as versões das imagens Docker.
- **Perguntar antes:** mudar o schema (ex.: adicionar `"skipped"` ao status de `automationEvents`); adicionar dependência; mudar o formato da assinatura depois que a Fase 5 começar.
- **Nunca:** commitar segredo ou `.env`; logar o corpo assinado ou o secret; devolver e-mail de quem não é o destinatário; deixar uma falha de notificação derrubar a mutation do usuário.

## Critérios de sucesso

1. `docker compose up -d` sobe o n8n (`:5678`) e o Mailpit (`:8025`), e os dados do n8n sobrevivem a `docker compose down && up`.
2. Pedir, aprovar, recusar, cancelar (remoção da ferramenta) e devolver geram cada um exatamente um POST assinado para `N8N_WEBHOOK_URL`, que um webhook de teste do n8n consegue receber.
3. Com o n8n parado, a ação do usuário funciona normalmente e aparece um `automationEvents` `failed` com `detail`.
4. `curl` gerado por `npm run sign` recebe `200` em `/overdue-loans` e passa da assinatura em `/reminder-status`; sem headers, com headers adulterados ou com timestamp velho, recebe `401`.
5. Repetir o mesmo `POST /reminder-status` deixa um único evento.
6. `npm test`, `npm run typecheck` e `npm run lint` passam.

## Decisões

1. **Retry no Convex: não.** O Convex só registra `failed`; o retry fica no n8n. Se for preciso, a alternativa barata é até 3 tentativas via `scheduler.runAfter` com backoff.
2. **Notificar o lender quando o borrower cancela: não.** Hoje não existe cancelamento pelo borrower, só por remoção da ferramenta.
3. **`workflow_error` no Convex: fica para a Fase 5.** O WF3 decide se grava falhas por um terceiro endpoint ou só loga no n8n e avisa o admin.
4. **Chave HMAC: uma só** para as duas direções. Duas chaves limitariam o estrago de um vazamento, mas complicam a configuração local.
