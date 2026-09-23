---
name: concurso-study-platform
description: Use when working in the Acaraú/CE Técnico de Informática (IDIB) study app or scripts. Loads the full study-system model (edital → cronograma → assuntos → questões → simulados → análise → revisão espaçada), data pipeline conventions, and verification workflow for this project.
---

# Concurso Study Platform (IDIB Acaraú/CE)

Projeto de estudo: app web PWA em `cronograma-app/` + dados gerados por scripts Python em
`scripts/`. Concurso real: **Prefeitura de Acaraú/CE — Técnico de Informática (IDIB,
prova 06/12/2026)**.

## Fontes de verdade (nunca inventar)

- **Edital/Anexo IV:** `/tmp/edital_acarau.txt` (conteúdo programático).
- **Banco de questões:** `/home/luizfarias/ACARAU_ESTUDOS/02_QUESTOES/QUESTOES_IDIB.json`.
- **Taxonomia canônica:** `cronograma-app/data/assuntos.json` (disciplinas › assuntos com
  keywords).
- **Classificação/simulados:** `scripts/gen_simulados.py` (`classify()` é o canônico) e
  `scripts/gen_questoes_digitais.py` (gera `data/questoes.json`, `simulados/simulados.json`,
  `questoes_stats.json`). Reexecute depois de mudar o banco/taxonomia.

## Modelo de estudo

Matriz: 50q/100pts — LP 14 (28), RL 6 (12), Informática geral 6 (12), Específicos 24 (48).
Aprovado = ≥50% por disciplina.

Fluxo: cronograma 81 dias → assunto do edital → questão → desempenho
(`estudo.historico`) → **revisão espaçada** (1/3/7/14/30 dias, erradas primeiro) → simulados
(3×50, seeds 42/137/2026) → mapa de fraquezas + caderno de erros.

## App (cronograma-app)

- SPA ES Modules puro, **sem bundler**. `app.js` (~1200 linhas), `index.html`, `style.css`.
- 6 abas: hoje · questoes · simulados · cronograma · analise · biblioteca.
- Persistência: `localStorage` (sempre) + Firestore (quando Google logado).
  **Merge sem clobber:** `mergeProgresso` por dia e `mergeHistorico` por questão, decidido
  pelo `updatedAt` maior. `modoLeitura` protege contra eco do `onSnapshot`.
- PWA: `sw.js` v3 — cache `cronograma-idib-v3`, network-first p/ navegação,
  stale-while-revalidate p/ assets. **Novos arquivos de dados → adicionar a `CORE`.**
- Firebase config já é REAL no `index.html` (não colar nada).

## Regras

1. Nunca inventar dados de prova/questão/conteúdo nem URLs (YouTube = busca real via
   `https://www.youtube.com/results?search_query=...`).
2. `node --check app.js` após qualquer mudança no app.js.
3. Testes Playwright (modo local, `localhost`): subir `python3 -m http.server` na pasta
   `cronograma-app` e rodar os cenários em `AGENTS.md` (splash / questoes / sw / merge).
   No teste, `add_init_script` **não re-executa** em `reload`; use `page.route` p/ bloquear
   o SDK Firebase (`**/firebase-*-compat.js`) e hook `window.__APP__` (só em localhost).
4. Não quebrar o que funciona; seguir estilo atual (funções por aba, `$`/`show`/`hide`,
   delegação de eventos). Sem overengineering.
5. Não commitar sem pedido explícito; nunca versionar segredos (`.gitignore` cobre Firebase).

## Documentação

- `cronograma-app/README.md` e `CONFIGURACAO.md` (guia Firebase — inclui autorizar domínio
  da Vercel `cronograma-idib.vercel.app` em Authorized domains).
- `00_DOCUMENTACAO/05_ARCHITECTURE_APP.md`, `06_DATA_MODEL_APP.md`, `07_STUDY_SYSTEM.md`.