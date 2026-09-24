# AGENTS.md — Cronograma IDIB (app web)

Regras para editar este projeto. Leia antes de alterar qualquer arquivo.

## Projeto

App web mobile-first para estudo do concurso da **Prefeitura de Acaraú/CE — Técnico de
Informática (IDIB, prova 06/12/2026)**. Combina cronograma (81 dias) + banco digital de
questões + simulados + análise de fraquezas + revisão espaçada + sincronia Firebase.

## Stack

- **Sem bundler/framework.** SPA em ES Modules puro (1 arquivo `app.js`), `index.html`,
  `style.css`.
- **PWA** com `manifest.json` + `sw.js` (v2: network-first p/ navegação,
  stale-while-revalidate p/ assets).
- **Persistência:** `localStorage` (sempre) + Cloud Firestore (quando logado).
- **Dados:** JSON estático em `data/` (cronograma, assuntos, questões, simulados, stats).
- **Geração dos dados:** Python em `/home/luizfarias/ACARAU_ESTUDOS/scripts/`
  (`gen_questoes_digitais.py`, `gen_simulados.py`).

## Regras obrigatórias

1. **Nunca inventar dados** de prova/questão/conteúdo. Usar o banco fonte real
   (`02_QUESTOES/QUESTOES_IDIB.json`, edital em `/tmp/edital_acarau.txt`).
2. **Nunca inventar URLs** (ex.: links de YouTube). Use busca/seção própria.
3. **Não quebrar o que funciona.** Sempre rodar `node --check app.js` depois de mexer.
4. **Sem overengineering.** Manter o estilo atual (funções por aba, `$`/`show`/`hide`,
   delegação de eventos). Evitar fases/complexidade desnecessária.
5. **Merge sem clobber**: `mergeProgresso` (por dia) e `mergeHistorico` (por questão)
   decidem conflito pelo `updatedAt` maior. Preservar isso.
6. `modoLeitura` deve ser setado/desfeito ao redor de writes vindos de `onSnapshot`.
7. Novos dados devem ser adicionados ao `CORE` do `sw.js` para funcionar offline.
8. Não commitar sem pedido explícito do usuário. Sempre inspecionar `git diff` e nunca
   versionar segredos (`.gitignore` já cobre Firebase).
9. `firebaseConfig` já é **real** e está no `index.html` — não precisa colar nada.

## Testes

Rodar (local, sem Firebase): subir `python3 -m http.server 8080` na pasta `cronograma-app`
ou usar os testes Playwright existentes:

- `/tmp/test_splash_playwright.py` — flash de login/splash (7 checks)
- `/tmp/test_questoes_playwright.py` — fluxo questões/simulados/análise (19 checks)
- `/tmp/test_sw_playwright.py` — service worker offline (4 checks)
- `/tmp/test_merge_playwright.py` — merge sem clobber (6 checks)

## Onde mexer

- `app.js` — toda a lógica. Buscar por função antes de duplicar
  (`renderHoje`, `renderFraquezas`, `iniciarSimuladoComTimer`, `registrarResp`…).
- `index.html` — estrutura das telas: `#view-loading`, `#view-login`, `#view-app` com 5
  abas (`hoje`, `questoes`, `simulados`, `cronograma`, `analise`).
- `style.css` — estilos mobile-first (390px aprox.).
- `sw.js` — cache. VERSÃO do cache muda quando os assets mudam (`cronograma-idib-vN`).
- `data/*.json` — dados. Sempre reexecutar `scripts/gen_questoes_digitais.py` se o banco
  fonte mudar.

## Estado atual (24/09/2026)

- Aba **Hoje** mostra quizzes dos dias anteriores pendentes (`#hoje-pendencias`) com
  revisão de erros por dia; `questoesDoDia` distribui as 10 questões entre os grupos
  das seções do dia.
- Batch de melhorias ("deixe o site perfeito"): `registro()` não polui mais o histórico
  (usa `criarRegistro` para escrita); abas sticky coladas ao topbar variável
  (`--topbar-h` medido em runtime); fallback offline de 5s para o PWA não ficar no
  splash; `alert()` do fim de sessão virou `mostrarToast()`; feedback de erro mostra o
  texto da alternativa correta; resultado do simulado ganhou correção completa por
  questão (certa/errada/em branco + gabarito). SW em `cronograma-idib-v5`.
- Pendente: autorizar domínio `cronograma-idib.vercel.app` no console Firebase
  (ação do usuário — ver `CONFIGURACAO.md` Passo 4.5).