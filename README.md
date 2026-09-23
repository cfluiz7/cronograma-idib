# Cronograma IDIB — app web

App de estudo para o concurso da **Prefeitura de Acaraú/CE — Técnico de Informática
(IDIB, prova 06/12/2026)**: cronograma de 81 dias + banco digital de questões + simulados,
mobile-first, com login Google e progresso sincronizado entre PC e celular.

## Funcionalidades

- **81 dias** de estudo extraídos do cronograma original (16/09 a 05/12/2026).
- **6 abas:** Hoje · Questões · Simulados · Cronograma · Análise · Biblioteca.
- **Hoje:** destaques do dia, foco com **revisão espaçada** (1/3/7/14/30 dias) e atalhos
  de treino dos temas fracos.
- **Questões:** banco digital com as questões de provas reais IDIB classificadas por
  **disciplina e assunto do edital**, filtros (grupo, assunto, estado), sessão com
  correção e feedback imediato, e registro por questão no histórico.
- **Simulados:** 3 simulados digitais (50 questões cada, por etapa) com cronômetro,
  navegação, correção automática e resultado com veredicto.
- **Análise:** mapa de fraquezas por disciplina › assunto, caderno de erros e histórico.
- **Biblioteca:** todos os assuntos do edital com botão "▶ YouTube" que abre uma **busca real
  no YouTube** (sem vídeos fixos — você escolhe o que assistir).
- **Pomodoro:** foco de 25 min integrado na aba Hoje (iniciar/pausar/retomar), com contagem
  de sessões por dia.
- **Cronograma:** checklist por dia (Específicos, Língua Portuguesa, Raciocínio Lógico +
  Informática e "Entrega do dia"), campos de acertos/erro/anotações, barras de progresso.
- **Login com Google** (Firebase Auth) e **sincronia via Firestore** com **merge sem
  clobber** (por dia/questão, decide pelo `updatedAt`) — o progresso é o mesmo no PC e
  no celular, mesmo se os dois forem usados fora da ordem.
- **PWA:** instala na tela inicial do celular e funciona offline (service worker
  network-first + stale-while-revalidate).

## Estrutura

```
cronograma-app/
├── index.html               # página (contém o firebaseConfig real)
├── app.js                   # lógica (login, checklist, questões, simulados, sync)
├── style.css               # visual mobile-first
├── manifest.json            # PWA
├── sw.js                    # service worker (offline, v2)
├── icons/                   # ícones PWA
├── data/
│   ├── cronograma.json      # os 81 dias extraídos do PDF
│   ├── assuntos.json        # taxonomia dos assuntos do edital
│   ├── questoes.json        # banco digital (566 questões classificadas)
│   ├── questoes_stats.json  # estatísticas do banco
│   └── simulados/simulados.json  # simulados digitais (3×50)
├── firestore.rules          # regras de segurança do Firestore
└── CONFIGURACAO.md          # GUIA passo a passo (Leia!)
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
login Google, criar Firestore, publicar as regras, autorizar o domínio, colar o
`firebaseConfig` no `index.html`).

## Público no celular (opções grátis)

1. **Vercel:** pronto — publicado em `https://cronograma-idib.vercel.app/`
   (root directory = `cronograma-app/`). Auto-deploy do repo.
2. **Firebase Hosting:** `npm i -g firebase-tools` → `firebase login` →
   `firebase init hosting` → `firebase deploy` (site `https://<projeto>.web.app`).
3. **Netlify Drop:** arraste a pasta em https://app.netlify.com/drop.
4. **Rede local:** `python3 -m http.server 8080` no PC e abra `http://IP_DO_PC:8080`
   no celular (mesma rede Wi-Fi).

Depois, no celular, use "Adicionar à tela inicial" para instalar como app.

## Regenerar os dados

- `data/cronograma.json` foi extraído de `cronograma_diario_tecnico_informatica.pdf`
  (via `pdftotext`) — estrutura: `{gerado_em, prova, total_dias, fases, dias[]}`.
- `scripts/gen_questoes_digitais.py` classifica o banco fonte
  (`02_QUESTOES/QUESTOES_IDIB.json`) e gera `data/questoes.json`,
  `data/questoes_stats.json` e `data/simulados/simulados.json`. Reexecute com:
  `python3 scripts/gen_questoes_digitais.py`.