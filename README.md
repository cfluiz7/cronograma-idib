# Cronograma IDIB — app web

App de checklist do cronograma de estudos para o concurso da **Prefeitura de Acaraú/CE —
Técnico de Informática (IDIB, prova 06/12/2026)**, transformado em aplicativo web
mobile-first, com login Google e progresso sincronizado entre PC e celular.

## Funcionalidades

- **81 dias** de estudo extraídos do cronograma original (16/09 a 05/12/2026).
- **4 abas:** Hoje · Cronograma · Fases · Progresso.
- **Checklist por dia:** Conhecimentos Específicos, Língua Portuguesa,
  Raciocínio Lógico + Informática, e a "Entrega do dia".
- Campos de **Acertei ___/___**, **erro mais comum** e **anotações** por dia.
- **Barra de progresso** por dia, por fase e por disciplina.
- **Login com Google** (Firebase Auth) e **sincronia via Firestore** — o progresso é o
  mesmo no PC e no celular.
- **PWA:** instala na tela inicial do celular e funciona offline.

## Estrutura

```
cronograma-app/
├── index.html          # página (cole aqui o firebaseConfig)
├── app.js              # lógica (login, checklist, sync)
├── style.css           # visual mobile-first
├── manifest.json       # PWA
├── sw.js               # service worker (offline)
├── icons/              # ícones PWA
├── data/cronograma.json # os 81 dias extraídos do PDF
├── firestore.rules     # regras de segurança do Firestore
└── CONFIGURACAO.md     # GUIA passo a passo (Leia!)
```

## Como usar agora (sem configuração)

```bash
cd cronograma-app
python3 -m http.server 8080
# abra http://localhost:8080
```

Clique em "Entrar com Google" — sem Firebase configurado, o app entra em **modo local**
(pede um nome e guarda o progresso só naquele navegador).

## Sincronizar PC + celular (com Google)

Siga o **`CONFIGURACAO.md`** passo a passo (criar projeto Firebase grátis, ativar
login Google, criar Firestore, publicar as regras, colar o `firebaseConfig` no
`index.html`).

## Público no celular (opções grátis)

1. **Firebase Hosting:** `npm i -g firebase-tools` → `firebase login` →
   `firebase init hosting` → `firebase deploy` (site `https://<projeto>.web.app`).
2. **Netlify Drop:** arraste a pasta em https://app.netlify.com/drop.
3. **Rede local:** `python3 -m http.server 8080` no PC e abra `http://IP_DO_PC:8080`
   no celular (mesma rede Wi-Fi).

Depois, no celular, use "Adicionar à tela inicial" para instalar como app.

## Regenerar os dados do cronograma

Os dados em `data/cronograma.json` foram extraídos de
`cronograma_diario_tecnico_informatica.pdf` (via `pdftotext`). O script de extração e
a limpeza ficaram ad-hoc em /tmp; a estrutura final do JSON:

```json
{ "gerado_em": "...", "prova": "06/12/2026", "total_dias": 81,
  "fases": { "1": {"rotulo":"FASE 1","nome":"BASE","cor":"#1e88e5"}, ... },
  "dias": [ { "dia":1, "data":"16/09", "dia_semana":"Quarta", "fase_id":"1",
              "fase_nome":"BASE","fase_rotulo":"FASE 1",
              "secoes":[{"titulo":"...","conteudo":"..."}],
              "entrega":"10 questões — corrigir" } ] }
```