# LendLoop — Plano de execução

Marque `[x]` conforme cada item for concluído. Cada fase termina com um checkpoint para revisarmos juntos antes de seguir.

## Decisões de arquitetura (propostas)

- **Papéis (admin/user)** ficam numa tabela `users` no Convex. O usuário é criado ou atualizado no primeiro login a partir da identidade do Clerk. Os admins são definidos pela variável `ADMIN_EMAILS` no Convex, para não confiar em nada que vem do cliente.
- **Autorização**: helpers no Convex (`requireUser`, `requireAdmin`, `requireOwner`) chamados em **toda** query e mutation. A UI só esconde botões; quem bloqueia é o backend.
- **Convex → n8n**: a mutation agenda uma action (`ctx.scheduler.runAfter`), e essa action faz o POST para o webhook do n8n com assinatura HMAC-SHA256 e timestamp, para evitar replay. O payload leva só o que é necessário: e-mail do destinatário, nome da ferramenta, status e datas.
- **n8n → Convex**: HTTP actions do Convex (`/overdue-loans` e `/reminder-status`), protegidas por HMAC. O write-back é idempotente com a chave `loanId + data do lembrete`.
- **E-mail local**: Mailpit no docker-compose. Recebe SMTP de verdade e tem uma UI para ver os e-mails, sem precisar de credencial externa.
- **Confiabilidade**: retry nos nós HTTP do n8n, um Error Workflow dedicado que loga as falhas (e opcionalmente grava no Convex) e uma tabela `automationEvents` para auditoria. Essa tabela também alimenta o bônus "Reminder sent 2 days ago".

---

## Fase 0 — Setup do projeto
- [x] `git init` + `.gitignore` (incluindo `.env*`) + `.nvmrc` (Node 22)
- [x] Scaffold Next.js 16 (App Router, TypeScript, Tailwind, ESLint)
- [x] Instalar o Convex (validado num deployment local anônimo)
- [x] Instalar o Clerk (v7) e configurar `ClerkProvider` + `ConvexProviderWithClerk` + `src/proxy.ts`
- [x] `convex/auth.config.ts`
- [ ] **Você**: ativar a integração Convex no Clerk (gera o JWT "convex") e definir `CLERK_JWT_ISSUER_DOMAIN` no Convex
- [x] `.env.example` com todas as variáveis documentadas
- [ ] **Você**: criar as contas e apps no Clerk e no Convex e preencher o `.env.local`
- [ ] ✅ Checkpoint: app sobe, login funciona, Convex conectado

## Fase 1 — Modelo de dados (Convex schema)
- [x] `users` (tokenIdentifier, email, name, role, trustedLender)
- [x] `tools` (ownerId, name, category, condition, description, createdAt)
- [x] `loans` (toolId, borrowerId, lenderId, startDate, endDate, status: pending/approved/declined/returned, timestamps)
- [x] `automationEvents` (loanId, type, status, idempotencyKey, createdAt)
- [x] Índices (by_owner, by_borrower, by_lender, by_status_endDate, by_idempotencyKey)
- [x] Categorias, condições e status como enums validados no backend (`convex/lib/validators.ts`)

## Fase 2 — Backend e controle de acesso
- [ ] Helpers de auth: `getCurrentUser`, `requireUser`, `requireAdmin`
- [ ] `users.ensure`: cria ou atualiza o usuário no login e aplica o papel via `ADMIN_EMAILS`
- [ ] `tools.listPublic`: só nome e categoria, sem login
- [ ] `tools.list`: com disponibilidade e filtro por categoria (requer login)
- [ ] `tools.create / update / remove`: só o dono; `remove` também pelo admin
- [ ] `loans.request`: valida datas, impede pedir a própria ferramenta e impede conflito com empréstimo aprovado
- [ ] `loans.approve / decline`: só o lender
- [ ] `loans.markReturned`: lender (ou borrower, a definir)
- [ ] `loans.myRequests / incoming / all` (`all` só para admin)
- [ ] `users.setTrustedLender`: só admin
- [ ] Validação de inputs (tamanho máximo de texto, datas coerentes)
- [ ] ✅ Checkpoint: testar regras de acesso chamando as funções direto

## Fase 3 — Frontend
- [ ] Página pública: nome, tagline, lista pública e botão "Sign in to lend or borrow"
- [ ] Layout logado com navegação (Tools, My listings, My requests, Incoming, Admin)
- [ ] Tools: lista com status de disponibilidade, filtro por categoria e ação "Request"
- [ ] Modal ou form de pedido com período de datas
- [ ] My listings: criar, editar e excluir
- [ ] My requests: status dos meus pedidos
- [ ] Incoming requests: aprovar, recusar e marcar como devolvido
- [ ] Admin: remover qualquer anúncio, ver todos os empréstimos, marcar Trusted Lender
- [ ] Badge "Trusted Lender" nas ferramentas
- [ ] Estados de loading, vazio e erro
- [ ] ✅ Checkpoint: fluxo completo manual com 2 usuários + 1 admin

## Fase 4 — Integração Convex ↔ n8n
- [ ] `docker-compose.yml`: n8n + Mailpit (com volume persistente)
- [ ] Utilitário HMAC no Convex (assinar e verificar, comparação em tempo constante, janela de timestamp)
- [ ] Action `notifications.send`, disparada ao criar um pedido e a cada mudança de status
- [ ] HTTP action `GET /overdue-loans` (assinada, retorna dados mínimos)
- [ ] HTTP action `POST /reminder-status` (assinada, idempotente)
- [ ] Registro em `automationEvents` (enviado, falhou, lembrete)

## Fase 5 — Workflows n8n
- [ ] **WF1 Request Notification**: Webhook → verifica HMAC → Switch por status → e-mail (Mailpit) → resposta
- [ ] **WF2 Overdue Reminders**: Schedule diário → GET assinado → loop → e-mail → POST de write-back assinado
- [ ] **WF3 Error Handler**: Error Trigger → loga e notifica (e-mail para o admin)
- [ ] Retry configurado nos nós HTTP e de e-mail
- [ ] Segredos via credentials e env do n8n (nada hardcoded)
- [ ] Exportar os JSONs para `n8n/workflows/` e conferir que não há segredos neles
- [ ] ✅ Checkpoint: testar os dois fluxos de ponta a ponta + simular uma falha

## Fase 6 — Bônus
- [ ] Mostrar "Reminder sent 2 days ago" e "Notification sent" em cada empréstimo
- [ ] (Opcional) Testes unitários dos helpers de auth e HMAC

## Fase 7 — Documentação e entrega
- [ ] README: visão geral, setup local passo a passo, variáveis de ambiente
- [ ] README: diagrama de arquitetura
- [ ] README: decisões de segurança e minimização de dados
- [ ] README: nota "O que eu mudaria para produção"
- [ ] Revisão final (lint, typecheck, varredura de segredos)
- [ ] **Você**: criar o repositório no GitHub e fazer o push
- [ ] **Você**: conferir a vaga original e enviar o e-mail de candidatura
