/* Cronograma IDIB - app.js
   Login Google + Firestore (sincronia PC/celular) + checklist do cronograma.
   Se o Firebase não estiver configurado, funciona em modo local (sem sync). */

let data = null;
let DIAS = [];
let FASES = {};
let QUESTOES = [];
let SIMULADOS = [];
let ASSUNTOS = {};
let QUESTOES_ATIVAS = []; // cache do banco (sem anuladas)

async function carregarDados() {
  const fetchJ = async (p) => {
    const r = await fetch(p, { cache: 'no-store' });
    if (!r.ok) throw new Error('Falha ao carregar ' + p);
    return r.json();
  };
  data = await fetchJ('./data/cronograma.json');
  DIAS = data.dias;
  FASES = data.fases;
  QUESTOES = await fetchJ('./data/questoes.json');
  SIMULADOS = await fetchJ('./data/simulados/simulados.json');
  ASSUNTOS = await fetchJ('./data/assuntos.json');
  QUESTOES_ATIVAS = QUESTOES.filter(q => q.gabarito && q.gabarito !== '*');
  return data;
}

/* ---------------- Estado ---------------- */
let user = null;            // usuário Firebase (ou fake local)
let progresso = {};         // {dias: {1: {secoes:{tit:bool}, entrega:bool, anotacao, acertos, erros}}}
let db = null, auth = null;
let localOnly = false;
let modoLeitura = false;
let currentFilters = { q: '' };
let estudo = { historico: {} };   // histórico de questões respondidas
let estudoTemp = {};              // estado de uma sessão em andamento (não comitada)
let uid = null;                   // identificador local (uid ou fake)

/* ---------------- Firebase init ---------------- */
function initFirebase() {
  const cfg = window.__FIREBASE_CONFIG__ || {};
  if (!cfg.apiKey || cfg.apiKey.startsWith('SEU_')) return false;
  try {
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    return true;
  } catch (e) {
    console.warn('Falha ao iniciar Firebase, modo local:', e);
    return false;
  }
}

/* ---------------- Persistência local ---------------- */
function loadLocal() {
  try { progresso = JSON.parse(localStorage.getItem('cronograma_progresso') || '{}').dias || {}; } catch { progresso = {}; }
  try {
    estudo = JSON.parse(localStorage.getItem('cronograma_estudo') || '{}');
    if (!estudo.historico) estudo = { historico: {} };
  } catch { estudo = { historico: {} }; }
  try { estudoTemp = JSON.parse(localStorage.getItem('cronograma_estudo_temp') || '{}'); } catch { estudoTemp = {}; }
}
function saveLocal() {
  try { localStorage.setItem('cronograma_progresso', JSON.stringify({ dias: progresso })); } catch {}
  try { localStorage.setItem('cronograma_estudo', JSON.stringify(estudo)); } catch {}
  try { localStorage.setItem('cronograma_estudo_temp', JSON.stringify(estudoTemp)); } catch {}
}

const diaRef = () => db && user && db.collection('usuarios').doc(user.uid).collection('progresso').doc('dias');
const estudoRef = () => db && user && db.collection('usuarios').doc(user.uid).collection('progresso').doc('estudo');

/* ---------------- Fluxo de login ---------------- */
async function onLogin() {
  uid = (user && user.uid) || localStorage.getItem('cronograma_usuario') || 'local';
  renderAll();
  showApp();
}
async function onLogout() {
  if (auth) {
    await auth.signOut();
    user = null;
    progresso = {};
    estudo = { historico: {} };
    showLogin();
  } else {
    localStorage.removeItem('cronograma_usuario');
    user = null;
    progresso = {};
    estudo = { historico: {} };
    showLogin();
  }
}

function showLogin() {
  document.getElementById('view-loading').classList.add('hidden');
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-app').classList.add('hidden');
}
function showApp() {
  document.getElementById('view-loading').classList.add('hidden');
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');
}
function showSplash() {
  document.getElementById('view-loading').classList.remove('hidden');
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.add('hidden');
}

/* ---------------- Data/hora ---------------- */
function hojeISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}`;
}
function parseData(dd) { // "16/09" -> Date (ano 2026)
  const [d, m] = dd.split('/').map(Number);
  return new Date(2026, m - 1, d);
}
function diffDias(a, b) {
  return Math.round((parseData(a) - parseData(b)) / 86400000);
}
// Dia atual do cronograma (16/09 = dia 1, 05/12 = 81)
function diaAtual() {
  const hoje = hojeISO();
  const d1 = data.dias[0].data;
  const dn = diffDias(hoje, d1) + 1;
  if (dn < 1) return 1;
  if (dn > data.total_dias) return data.total_dias;
  return dn;
}
function diaHojeAlvo() {
  return data.dias.find(d => d.data === hojeISO());
}

/* ---------------- Progresso helpers ---------------- */
function progDia(n) {
  if (!progresso[n]) progresso[n] = { secoes: {}, entrega: false, anotacao: '', acertos: '', erros: '' };
  return progresso[n];
}
function concluidoDia(n) {
  const p = progDia(n);
  return p.entrega === true;
}
function percentDia(n) {
  const p = progDia(n);
  const secoes = DIAS.find(d => d.dia === n).secoes;
  let feitas = 0; const tot = secoes.length + 1;
  secoes.forEach(s => { if (p.secoes[s.titulo]) feitas++; });
  if (p.entrega) feitas++;
  return Math.round(feitas / tot * 100);
}
function totalConcluidos() {
  return DIAS.filter(d => concluidoDia(d.dia)).length;
}
function progressoGeral() {
  return Math.round(totalConcluidos() / DIAS.length * 100);
}
// progresso por disciplina (proporcional por seção)
function progressoDisciplinas() {
  const out = {};
  DIAS.forEach(d => {
    d.secoes.forEach(s => {
      out[s.titulo] = out[s.titulo] || { feitas: 0, total: 0 };
      out[s.titulo].total++;
      if (progDia(d.dia).secoes[s.titulo]) out[s.titulo].feitas++;
    });
  });
  return out;
}

/* ---------------- Firestore sync ---------------- */
function usarFirestore() {
  return db && user;
}
async function carregarProgressoRemoto() {
  if (!usarFirestore()) return;
  try {
    const snap = await diaRef().get();
    if (snap.exists) {
      const d = snap.data().dias || {};
      progresso = mergeProgresso(progresso, d);
    }
    const snap2 = await estudoRef().get();
    if (snap2.exists) {
      const e = snap2.data();
      estudo = { historico: mergeHistorico(estudo.historico, e.historico || {}) };
    }
  } catch (e) { console.warn('Falha ao ler do Firestore:', e.message); }
}
let _saveTimer = null;
function agendarSync(comRender = true) {
  saveLocal();
  if (comRender) renderAll();
  if (usarFirestore()) {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(syncFirestore, 400);
  }
}
async function syncFirestore() {
  if (!usarFirestore() || modoLeitura) return;
  try {
    await diaRef().set({ dias: progresso }, { merge: true });
    await estudoRef().set({ historico: estudo.historico }, { merge: true });
  } catch (e) { console.warn('Falha ao salvar no Firestore:', e.message); }
}
function iniciarEscuta() {
  if (!usarFirestore()) return;
  diaRef().onSnapshot(snap => {
    if (snap.exists) {
      modoLeitura = true;
      progresso = mergeProgresso(progresso, snap.data().dias || {});
      saveLocal();
      renderAll();
      modoLeitura = false;
    }
  }, err => console.warn('Escuta Firestore falhou:', err.message));
  estudoRef().onSnapshot(snap => {
    if (snap.exists) {
      modoLeitura = true;
      estudo = { historico: mergeHistorico(estudo.historico, snap.data().historico || {}) };
      saveLocal();
      renderAll();
      modoLeitura = false;
    }
  }, err => console.warn('Escuta estudo falhou:', err.message));
}
/* merge por dia (última escrita vence só no campo conflitante). Simple: campos por dia
   do vindo de fora só sobrescrevem se o local não tiver valor mais novo (updatedAt). */
function mergeProgresso(local, remoto) {
  const out = JSON.parse(JSON.stringify(local || {}));
  for (const d of Object.keys(remoto || {})) {
    const a = out[d], b = remoto[d];
    if (!b) continue;
    if (!a) { out[d] = b; continue; }
    const tA = a.updatedAt || 0, tB = b.updatedAt || 0;
    out[d] = tB > tA ? b : a;
  }
  return out;
}
function mergeHistorico(local, remoto) {
  const out = JSON.parse(JSON.stringify(local || {}));
  for (const id of Object.keys(remoto || {})) {
    const a = out[id], b = remoto[id];
    if (!b) continue;
    if (!a) { out[id] = b; continue; }
    out[id] = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  }
  return out;
}

/* ---------------- Render ---------------- */
const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

function esc(t) {
  const d = document.createElement('div');
  d.textContent = t == null ? '' : t;
  return d.innerHTML;
}

function setConteudo(id, html) {
  $(id).innerHTML = html;
}

let _toastTimer = null;
function mostrarToast(msg, ms = 3200) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function corFase(fid) {
  return (FASES[fid] && FASES[fid].cor) || '#64748b';
}

function badgeFase(d) {
  return `<span class="badge" style="background:${corFase(d.fase_id)}">${esc(d.fase_rotulo)} · ${esc(d.fase_nome)}</span>`;
}

function cardDia(d, compacto = false) {
  const p = progDia(d.dia);
  const pc = percentDia(d.dia);
  const concluido = concluidoDia(d.dia);
  const hoje = d.data === hojeISO();
  const alvoTag = hoje ? ' <span class="agora">HOJE</span>' : '';
  const checkIcon = concluido ? '&#x2705;' : (pc > 0 ? '&#x25F8;' : '&#x2610;');
  return `<div class="card-dia ${compacto ? 'sm' : ''} ${concluido ? 'ok' : ''} ${hoje ? 'hoje' : ''}" data-dia="${d.dia}">
    <div class="cd-top">
      <span class="cd-num">Dia ${d.dia}<b>${alvoTag}</b></span>
      <span class="cd-data">${esc(d.data)} · ${esc(d.dia_semana)}</span>
    </div>
    <div class="cd-badge">${badgeFase(d)}</div>
    ${!compacto ? `<div class="cd-secoes">${d.secoes.map(s => `<span>${esc(s.titulo)}</span>`).join('')}</div>` : ''}
    <div class="cd-foot">
      <div class="bar"><div class="bar-fill" style="width:${pc}%"></div></div>
      <span class="cd-pct">${pc}% ${checkIcon}</span>
    </div>
  </div>`;
}

function renderListaDias() {
  const q = currentFilters.q.trim().toLowerCase();
  const lista = DIAS.filter(d => {
    if (!q) return true;
    const txt = (d.data + ' ' + d.dia_semana + ' ' + d.fase_rotulo + ' ' + d.fase_nome + ' ' +
      d.secoes.map(s => s.titulo + ' ' + s.conteudo).join(' ')).toLowerCase();
    return txt.includes(q);
  });
  setConteudo('lista-dias', lista.map(d => cardDia(d)).join('') || '<p class="vazio">Nenhum dia encontrado.</p>');
}

function renderHoje() {
  const hoje = diaHojeAlvo();
  const alvo = hoje || DIAS[diaAtual() - 1];
  const d = alvo;
  const p = progDia(d.dia);
  const pc = percentDia(d.dia);
  const concluido = concluidoDia(d.dia);

  let status;
  if (concluido) status = 'Dia concluído!';
  else if (hoje) status = 'Dia de hoje';
  else status = `Dia atual do cronograma (você está no dia ${diaAtual()})`;

  const restantes = Math.max(0, data.total_dias - diaAtual());

  const html = `
    <div class="hoje-card">
      <div class="hc-top">
        <div>
          <span class="hc-titulo">Dia ${d.dia} de ${data.total_dias}</span>
          <span class="hc-data">${esc(d.data)} · ${esc(d.dia_semana)}</span>
        </div>
        ${badgeFase(d)}
      </div>
      <div class="hc-status">${esc(status)}${concluido ? ' &#x2705;' : ''}</div>
      ${d.entrega ? `<div class="hc-entrega">ENTREGA DO DIA: ${esc(d.entrega)}</div>` : ''}
      <div class="hc-bar"><div class="bar-fill" style="width:${pc}%"></div></div>
      <div class="hc-pct">${pc}% do dia concluído</div>
      <button class="btn-abrir" data-dia="${d.dia}">Abrir este dia &#x2192;</button>
    </div>
    <div class="hoje-extra">
      <div class="mini-stats">
        <div class="stat"><b>${totalConcluidos()}</b><span>dias<br>concluídos</span></div>
        <div class="stat"><b>${progressoGeral()}%</b><span>do cronograma</span></div>
        <div class="stat"><b>${restantes}</b><span>dias<br>restantes</span></div>
      </div>
    </div>`;
  setConteudo('hoje-card', html);
  renderPomodoro();
  renderHojePendencias();
}

/* ---------------- Pomodoro ---------------- */
let pomodoro = null;
let pomoTimer = null;
const POMO_DURACAO = 25;
function pomoRestante() {
  if (!pomodoro) return POMO_DURACAO * 60;
  if (pomodoro.fim && !pomodoro.pausado) return Math.max(0, Math.round((pomodoro.fim - Date.now()) / 1000));
  return pomodoro.pausadoEmSegundos != null ? pomodoro.pausadoEmSegundos : POMO_DURACAO * 60;
}
function pomoEstado() {
  if (!pomodoro) return 'parado';
  if (pomodoro.pausado) return 'pausado';
  return 'rodando';
}
function pomoAlvoHoje() {
  const chave = 'cronograma_pomodoro';
  const hoje = new Date().toISOString().slice(0, 10);
  try {
    const obj = JSON.parse(localStorage.getItem(chave) || '{}');
    return (obj[hoje] || 0) + 1;
  } catch { return 0; }
}
function renderPomodoro(pausadoAlterado = false) {
  if (!$('pomodoro')) return;
  const rest = pomoRestante();
  const mm = String(Math.floor(rest / 60)).padStart(2, '0');
  const ss = String(rest % 60).padStart(2, '0');
  const st = pomoEstado();
  const hoje = new Date().toISOString().slice(0, 10);
  let feitosHoje = 0;
  try { feitosHoje = JSON.parse(localStorage.getItem('cronograma_pomodoro') || '{}')[hoje] || 0; } catch {}
  const btn = st === 'parado' ? '<button class="btn-primario full" id="btn-pomo-iniciar">▶ Iniciar foco (25 min)</button>'
    : st === 'rodando' ? '<button class="btn-primario full" id="btn-pomo-pausar">⏸ Pausar</button>'
    : '<button class="btn-primario full" id="btn-pomo-retomar">▶ Retomar</button>';
  const html = `
    <div class="pomo">
      <div class="pomo-titulo">Foco (pomodoro)</div>
      <div class="pomo-tempo ${st === 'rodando' ? 'ativo' : st === 'pausado' ? 'pausado' : ''}">${mm}:${ss}</div>
      <div class="pomo-sub">${st === 'rodando' ? 'focando…' : st === 'pausado' ? 'pausado' : 'pronto para começar'}</div>
      ${btn}
      ${st !== 'parado' ? '<button class="btn-sec" id="btn-pomo-parar">■ Encerrar hora</button>' : ''}
      <div class="pomo-done">Sessões de 25 min hoje: <b>${feitosHoje}</b></div>
    </div>`;
  setConteudo('pomodoro', html);
}
function iniciarPomodoro() {
  pomodoro = { inicio: Date.now(), fim: Date.now() + POMO_DURACAO * 60000, pausado: false, restante: null };
  if (pomoTimer) clearInterval(pomoTimer);
  pomoTimer = setInterval(() => {
    if (!pomodoro || pomodoro.pausado) return;
    if (Date.now() >= pomodoro.fim) { concluirPomodoro(); return; }
    renderPomodoro();
  }, 1000);
  renderPomodoro();
}
function pausarPomodoro() {
  if (!pomodoro || pomodoro.pausado) return;
  pomodoro.pausado = true;
  pomodoro.pausadoEmSegundos = Math.max(0, Math.round((pomodoro.fim - Date.now()) / 1000));
  renderPomodoro();
}
function retomarPomodoro() {
  if (!pomodoro || !pomodoro.pausado) return;
  pomodoro.fim = Date.now() + pomodoro.pausadoEmSegundos * 1000;
  pomodoro.pausado = false;
  renderPomodoro();
}
function encerrarPomodoro(concluido) {
  if (pomoTimer) { clearInterval(pomoTimer); pomoTimer = null; }
  if (concluido) {
    const chave = 'cronograma_pomodoro';
    const hoje = new Date().toISOString().slice(0, 10);
    try {
      const obj = JSON.parse(localStorage.getItem(chave) || '{}');
      obj[hoje] = (obj[hoje] || 0) + 1;
      localStorage.setItem(chave, JSON.stringify(obj));
    } catch {}
  }
  pomodoro = null;
  renderPomodoro();
}
function concluirPomodoro() {
  encerrarPomodoro(true);
}

function renderFases() {
  const html = DIAS[0].fase_nome && Object.keys(FASES).map(fid => {
    const f = FASES[fid];
    const diasFase = DIAS.filter(d => d.fase_id === fid);
    const feitas = diasFase.filter(d => concluidoDia(d.dia)).length;
    const pc = diasFase.length ? Math.round(feitas / diasFase.length * 100) : 0;
    return `<div class="fase-card">
      <div class="fc-head">
        <span class="badge" style="background:${f.cor}">${esc(f.rotulo)}</span>
        <span class="fc-nome">${esc(f.nome)}</span>
      </div>
      <div class="fc-sub">${diasFase.length} dias · ${feitas} concluídos</div>
      <div class="bar"><div class="bar-fill" style="width:${pc}%;background:${f.cor}"></div></div>
      <div class="fc-dias">${diasFase.map(d => `<button class="chip" data-dia="${d.dia}" data-dataref="${d.data}">${d.dia}</button>`).join('')}</div>
    </div>`;
  }).join('');
  setConteudo('lista-fases', html);
}

function renderProgresso() {
  const disc = progressoDisciplinas();
  const totalConcl = totalConcluidos();
  const html = `
    <div class="prog-geral">
      <div class="pg-num">${progressoGeral()}%</div>
      <div class="pg-bar"><div class="bar-fill" style="width:${progressoGeral()}%"></div></div>
      <div class="pg-sub">${totalConcl} de ${DIAS.length} dias concluídos</div>
    </div>
    <div class="prog-disc">
      <h3>Progresso por disciplina</h3>
      ${Object.entries(disc).map(([t, v]) => {
        const pc = v.total ? Math.round(v.feitas / v.total * 100) : 0;
        return `<div class="pdisc">
          <div class="pdisc-label">${esc(t)}</div>
          <div class="bar"><div class="bar-fill" style="width:${pc}%"></div></div>
          <div class="pdisc-pct">${pc}% · ${v.feitas}/${v.total}</div>
        </div>`;
      }).join('')}
    </div>`;
  setConteudo('resumo-progresso', html);
}

/* ------- Modal detalhe do dia ------- */
let modalDia = null;

function openDia(d) {
  modalDia = d.dia;
  const p = progDia(d.dia);
  const pc = percentDia(d.dia);
  $('modal-titulo').innerHTML = `<b>Dia ${d.dia} de ${data.total_dias}</b> <span>${esc(d.data)} · ${esc(d.dia_semana)}</span>`;

  const secoesHtml = d.secoes.map(s => {
    const done = !!p.secoes[s.titulo];
    return `<div class="sec ${done ? 'ok' : ''}" data-sec>
      <label class="sec-check">
        <input type="checkbox" data-sec="${esc(s.titulo)}" ${done ? 'checked' : ''}>
        <span class="sec-titulo">${esc(s.titulo)}</span>
      </label>
      <div class="sec-conteudo">${esc(s.conteudo)}</div>
    </div>`;
  }).join('');

  const entregaHtml = `
    <div class="sec ${p.entrega ? 'ok' : ''}">
      <label class="sec-check">
        <input type="checkbox" data-entrega ${p.entrega ? 'checked' : ''}>
        <span class="sec-titulo">ENTREGA DO DIA</span>
      </label>
      ${d.entrega ? `<div class="sec-conteudo">${esc(d.entrega)}</div>` : ''}
    </div>`;

  const camposHtml = `
    <div class="campos">
      <label>Acertei ___/___ questões
        <input type="text" data-acertos value="${esc(p.acertos)}" placeholder="ex.: 8/10">
      </label>
      <label>Erro mais comum
        <input type="text" data-erros value="${esc(p.erros)}" placeholder="ex.: tabela-verdade">
      </label>
      <label>Anotações
        <textarea data-anotacao rows="3" placeholder="Observações do dia...">${esc(p.anotacao)}</textarea>
      </label>
    </div>`;

  $('modal-corpo').innerHTML = `
    <div class="modal-bar"><div class="bar-fill" style="width:${pc}%"></div></div>
    ${secoesHtml}
    ${entregaHtml}
    ${camposHtml}`;

  $('modal-dia').classList.remove('hidden');
}

function closeModal() {
  $('modal-dia').classList.add('hidden');
  modalDia = null;
}

/* ---------------- Eventos ---------------- */
function bindEvents() {
  // Login
  $('btn-google').addEventListener('click', async () => {
    if (auth) {
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked') {
          $('login-error').textContent = 'Bloqueie pop-ups e tente de novo, ou use outro navegador.';
        } else {
          $('login-error').textContent = 'Erro ao entrar: ' + e.message;
        }
      }
    } else {
      // Sem Firebase: login local com nome
      const nome = (prompt('Nome (modo local, sem sync):') || '').trim() || 'Estudante';
      localStorage.setItem('cronograma_usuario', nome);
      user = { displayName: nome, fake: true };
      onLogin();
    }
  });

  $('btn-logout').addEventListener('click', onLogout);
  $('btn-fechar').addEventListener('click', closeModal);

  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $(`tab-${t.dataset.tab}`).classList.add('active');
    });
  });

  // Busca
  $('busca').addEventListener('input', e => {
    currentFilters.q = e.target.value;
    renderListaDias();
  });

  // ---- Filtros de questões (delegação) ----
  document.addEventListener('change', e => {
    const f = e.target.closest('[data-filtro]');
    if (f) {
      filtroQuestoes[f.dataset.filtro] = f.value;
      if (f.dataset.filtro === 'grupo') filtroQuestoes.assunto = 'todos';
      renderQuestoesHome();
      atualizarContagem();
    }
  });

  document.addEventListener('click', e => {
    // Iniciar sessão de questões
    if (e.target.closest('#btn-iniciar-sessao')) { ativarSessaoPelaLista(); return; }
    // Seleção de alternativa (questões)
    const alt = e.target.closest('[data-alt]');
    if (alt && sessaoQuestoes) {
      const qid = sessaoQuestoes.ids[sessaoQuestoes.idx];
      if (sessaoQuestoes.respondidas[qid]) return; // já respondida
      const l = alt.dataset.alt;
      const certa = l === QUESTOES.find(q => q.id === qid).gabarito;
      sessaoQuestoes.respondidas[qid] = { alt: l, certa };
      if (certa) sessaoQuestoes.certas++; else sessaoQuestoes.erradas++;
      // registra no histórico (uma tentativa por questão na sessão)
      registrarResp(qid, certa);
      renderQuestaoSessao();
      return;
    }
    // Navegação entre questões da sessão
    if (e.target.closest('#btn-q-prox')) { sessaoQuestoes.idx++; renderQuestaoSessao(); return; }
    if (e.target.closest('#btn-q-ant')) { sessaoQuestoes.idx--; renderQuestaoSessao(); return; }
    if (e.target.closest('#btn-q-fim')) {
      const totais = { certas: sessaoQuestoes.certas, erradas: sessaoQuestoes.erradas };
      const eraPendente = sessaoQuestoes && sessaoQuestoes.titulo && sessaoQuestoes.titulo.includes('pendente');
      sessaoQuestoes = null;
      hide('questoes-sessao'); show('questoes-home');
      renderQuestoesHome();
      renderAnalise(); renderHojeFoco(); renderHojePendencias();
      mostrarToast(`Sessão concluída: ${totais.certas} certas · ${totais.erradas} erradas.` + (eraPendente ? ' Marque o dia como concluído na aba Cronograma.' : ''));
      return;
    }
    // Seleção de alternativa (simulado)
    if (alt && sessaoSimulado) {
      const qid = sessaoSimulado.ids[sessaoSimulado.idx];
      sessaoSimulado.respostas[qid] = alt.dataset.alt;
      renderSimuladoSessao();
      return;
    }
    // Iniciar simulado
    if (e.target.closest('[data-sim]')) {
      const i = Number(e.target.closest('[data-sim]').dataset.sim);
      hide('simulados-home'); show('simulado-sessao');
      iniciarSimuladoComTimer(i);
      return;
    }
    // Navegação simulado
    if (e.target.closest('#btn-sim-prox')) { sessaoSimulado.idx++; renderSimuladoSessao(); return; }
    if (e.target.closest('#btn-sim-ant')) { sessaoSimulado.idx--; renderSimuladoSessao(); return; }
    if (e.target.closest('.sim-nav[data-nav]')) {
      sessaoSimulado.idx = Number(e.target.closest('.sim-nav[data-nav]').dataset.nav);
      renderSimuladoSessao();
      return;
    }
    if (e.target.closest('#btn-sim-fim')) { finalizarSimulado(); return; }
    if (e.target.closest('#btn-sim-repetir')) {
      if (!sessaoSimulado) return;
      iniciarSimuladoComTimer(sessaoSimulado.simuladoIndex, true);
      return;
    }
    if (e.target.closest('#btn-sim-voltar')) {
      if (timerSimulado) { clearInterval(timerSimulado); timerSimulado = null; }
      sessaoSimulado = null;
      hide('simulado-sessao'); show('simulados-home');
      renderSimuladosHome();
      return;
    }
    // Para buscar conteúdo no YouTube (URL de busca oficial, sem links inventados)
    if (e.target.closest('[data-yts]')) {
      const q = e.target.closest('[data-yts]').dataset.yts;
      window.open('https://www.youtube.com/results?search_query=' + q, '_blank', 'noopener');
      return;
    }
    // Pomodoro
    if (e.target.closest('#btn-pomo-iniciar')) { iniciarPomodoro(); return; }
    if (e.target.closest('#btn-pomo-pausar')) { pausarPomodoro(); return; }
    if (e.target.closest('#btn-pomo-retomar')) { retomarPomodoro(); return; }
    if (e.target.closest('#btn-pomo-parar')) { encerrarPomodoro(false); return; }
    // Foco de hoje
    if (e.target.closest('#btn-foco-revisao')) {
      filtroQuestoes.estudo = 'revisao';
      const dev = revisoesDevidas();
      if (dev.length) {
        sessaoQuestoes = { ids: dev.slice(0, 10), idx: 0, respondidas: {}, certas: 0, erradas: 0 };
        $('barra-tabs').querySelector('[data-tab=questoes]').click();
        hide('questoes-home'); show('questoes-sessao');
        renderQuestaoSessao();
      }
      return;
    }
    if (e.target.closest('#btn-foco-questoes')) {
      const diaAlvo = diaHojeAlvo();
      if (diaAlvo) {
        const qs = questoesDoDia(diaAlvo);
        if (!qs.length) return;
        sessaoQuestoes = { ids: qs.map(q => q.id), idx: 0, respondidas: {}, certas: 0, erradas: 0, titulo: `Dia ${diaAlvo.dia}` };
        $('barra-tabs').querySelector('[data-tab=questoes]').click();
        hide('questoes-home'); show('questoes-sessao');
        renderQuestaoSessao();
      }
      return;
    }
    // Quiz de um dia anterior pendente
    const btnQuiz = e.target.closest('[data-quiz-dia]');
    if (btnQuiz) {
      const d = DIAS.find(x => x.dia === Number(btnQuiz.dataset.quizDia));
      if (d) {
        const qs = questoesDoDia(d);
        if (!qs.length) return;
        sessaoQuestoes = { ids: qs.map(q => q.id), idx: 0, respondidas: {}, certas: 0, erradas: 0, titulo: `Dia ${d.dia} (pendente)` };
        $('barra-tabs').querySelector('[data-tab=questoes]').click();
        hide('questoes-home'); show('questoes-sessao');
        renderQuestaoSessao();
      }
      return;
    }
    // Treinar erros (análise)
    if (e.target.closest('#btn-treinar-erros')) {
      const erros = QUESTOES_ATIVAS.filter(q => {
        const r = registro(q.id);
        return r && r.tentativas && (r.ultimoErro !== undefined) && !(r.acertoEm && r.acertoEm > r.ultimoErro);
      }).slice(0, 25);
      if (erros.length) {
        filtroQuestoes.estudo = 'erros';
        sessaoQuestoes = { ids: erros.map(q => q.id), idx: 0, respondidas: {}, certas: 0, erradas: 0 };
        $('barra-tabs').querySelector('[data-tab=questoes]').click();
        hide('questoes-home'); show('questoes-sessao');
        renderQuestaoSessao();
      }
      return;
    }
  });

  // Clique nos cards/chips
  document.addEventListener('click', e => {
    const btnDia = e.target.closest('[data-dia]');
    if (btnDia) {
      const d = DIAS.find(x => x.dia === Number(btnDia.dataset.dia));
      if (d) openDia(d);
      return;
    }
  });

  // Mudanças no modal (checklists e campos) - delegação
  $('modal-corpo').addEventListener('change', e => {
    if (!modalDia) return;
    const p = progDia(modalDia);
    const isSec = e.target.dataset.sec;
    if (isSec) { p.secoes[isSec] = e.target.checked; }
    if (e.target.dataset.entrega !== undefined) { p.entrega = e.target.checked; }
    if (e.target.dataset.acertos !== undefined) { p.acertos = e.target.value; }
    if (e.target.dataset.erros !== undefined) { p.erros = e.target.value; }
    p.updatedAt = Date.now();
    agendarSync();
    // atualiza o modal visual sem fechar
    const d = DIAS.find(x => x.dia === modalDia);
    openDia(d);
  });
  $('modal-corpo').addEventListener('input', e => {
    if (!modalDia) return;
    const p = progDia(modalDia);
    if (e.target.dataset.anotacao !== undefined) { p.anotacao = e.target.value; agendarSync(false); }
    if (e.target.dataset.acertos !== undefined) { p.acertos = e.target.value; agendarSync(false); }
    if (e.target.dataset.erros !== undefined) { p.erros = e.target.value; agendarSync(false); }
    p.updatedAt = Date.now();
  });
}

/* ---------------- Questões: estado e dados  ---------------- */
const gruposRotulo = {
  lingua_portuguesa: 'Língua Portuguesa',
  rac_logico: 'Raciocínio Lógico',
  informatica: 'Informática / Específicos'
};
function registro(qid) {
  return estudo.historico[qid] || null;
}
function criarRegistro(qid) {
  if (!estudo.historico[qid]) estudo.historico[qid] = { acertos: 0, tentativas: 0, updatedAt: 0 };
  return estudo.historico[qid];
}
function registrarResp(qid, certa) {
  const r = criarRegistro(qid);
  r.tentativas++;
  if (certa) { r.acertos++; r.acertoEm = Date.now(); } else { r.erroEm = Date.now(); r.ultimoErro = Date.now(); }
  r.updatedAt = Date.now();
  saveLocal();
}
/* Revisão espaçada simples: agenda a cada erro para 1/3/7/14/30 dias após o último erro.
   A cada acerto seguinte, o item sai da lista de devidos (corrigido). */
function revisoesDevidas(hoje = Date.now()) {
  const out = [];
  const diasRestantes = data.total_dias - diaAtual();
  const maxInt = Math.max(1, Math.min(30, diasRestantes));
  const intervalos = [1, 3, 7, 14, 30].filter(i => i <= maxInt);
  for (const qid of Object.keys(estudo.historico)) {
    const r = estudo.historico[qid];
    if (!r.tentativas || r.ultimoErro === undefined) continue;
    // se acertou depois do último erro, não está pendente
    if (r.acertoEm && r.acertoEm > r.ultimoErro) continue;
    const devido = intervalos.some(interv =>
      hoje - r.ultimoErro >= interv * 86400000);
    if (devido) out.push(qid);
  }
  return out;
}

function qByQuery(grupo, assunto) {
  let lista = QUESTOES_ATIVAS;
  if (grupo !== 'todas') lista = lista.filter(q => q.grupo === grupo);
  if (assunto && assunto !== 'todos') lista = lista.filter(q => q.assunto === assunto);
  return lista;
}
function tituloQ(q) {
  return `${q.ano} · ${q.orgao} — ${q.cargo}`;
}

/* ---------------- Aba Questões ---------------- */
let filtroQuestoes = { grupo: 'todas', assunto: 'todos', estudo: 'todas', limite: 10 };
let sessaoQuestoes = null; // { ids:[], idx, certas, erradas, respondidas:{} }
const ALT_LETRAS = ['A', 'B', 'C', 'D'];

function renderQuestoesHome() {
  const grupos = { 'todas': 'Todas', ...gruposRotulo };
  const assuntos = [];
  if (filtroQuestoes.grupo !== 'todas') {
    const tax = ASSUNTOS.disciplinas[filtroQuestoes.grupo === 'informatica' ? 'informatica_geral' : filtroQuestoes.grupo];
    if (tax) Object.entries(tax.assuntos || {}).forEach(([k, v]) => assuntos.push([k, v.rotulo]));
  } else {
    Object.values(ASSUNTOS.disciplinas).forEach(d =>
      Object.entries(d.assuntos || {}).forEach(([k, v]) => assuntos.push([k, v.rotulo])));
  }

  const sel = (n, v, onChange) =>
    `<select data-filtro="${n}" class="sel">${Object.entries(v).map(([k, l]) =>
      `<option value="${k}" ${filtroQuestoes[n] === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  const grupoSel = sel('grupo', grupos);
  const assuntoOpts = `<option value="todos">Todos os assuntos</option>` +
    assuntos.map(([k, l]) => `<option value="${k}" ${filtroQuestoes.assunto === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const assuntoSel = `<select data-filtro="assunto" class="sel">${assuntoOpts}</select>`;

  const html = `
    <div class="q-home">
      <div class="filtros">
        ${grupoSel}${assuntoSel}
        <label class="filtro-linha">Modo
          <select data-filtro="estudo" class="sel">
            <option value="todas" ${filtroQuestoes.estudo==='todas'?'selected':''}>Todas</option>
            <option value="erros" ${filtroQuestoes.estudo==='erros'?'selected':''}>Só erros (caderno)</option>
            <option value="novas" ${filtroQuestoes.estudo==='novas'?'selected':''}>Nunca respondidas</option>
            <option value="revisao" ${filtroQuestoes.estudo==='revisao'?'selected':''}>Revisão devida</option>
          </select>
        </label>
        <label class="filtro-linha">Quantidade
          <select data-filtro="limite" class="sel">
            ${[5,10,15,25,50].map(n=>`<option value="${n}" ${filtroQuestoes.limite==n?'selected':''}>${n}</option>`).join('')}
          </select>
        </label>
        <button class="btn-primario" id="btn-iniciar-sessao">▶ Iniciar sessão de estudo</button>
      </div>
      <div class="q-count" id="q-count"></div>
    </div>`;
  setConteudo('questoes-home', html);
  const lista = sessaoQuestoes ? sessaoQuestoes.ids.map(id => QUESTOES.find(q => q.id === id)) : [];
  atualizarContagem();
}

function ativarSessaoPelaLista() {
  let lista = qByQuery(filtroQuestoes.grupo, filtroQuestoes.assunto);
  if (filtroQuestoes.estudo === 'erros') {
    lista = lista.filter(q => {
      const r = registro(q.id);
      return r && r.tentativas && (r.ultimoErro !== undefined) && !(r.acertoEm && r.acertoEm > r.ultimoErro);
    });
  }
  if (filtroQuestoes.estudo === 'novas') {
    lista = lista.filter(q => !registro(q.id) || registro(q.id).tentativas === 0);
  }
  if (filtroQuestoes.estudo === 'revisao') {
    const dev = new Set(revisoesDevidas());
    lista = lista.filter(q => dev.has(q.id));
  }
  const limit = Math.min(filtroQuestoes.limite, lista.length);
  // embaralha de forma estável para não repetir ordem a cada vez
  const sorted = [...lista].sort(() => Math.random() - 0.5).slice(0, limit);
  if (!sorted.length) { $('q-count').textContent = 'Nenhuma questão nesse filtro.'; return; }
  sessaoQuestoes = { ids: sorted.map(q => q.id), idx: 0, respondidas: {}, certas: 0, erradas: 0 };
  hide('questoes-home');
  show('questoes-sessao');
  renderQuestaoSessao();
}

function atualizarContagem() {
  let lista = qByQuery(filtroQuestoes.grupo, filtroQuestoes.assunto);
  if (filtroQuestoes.estudo !== 'todas') {
    if (filtroQuestoes.estudo === 'erros') lista = lista.filter(q => { const r = registro(q.id); return r && r.tentativas && (r.ultimoErro !== undefined) && !(r.acertoEm && r.acertoEm > r.ultimoErro); });
    if (filtroQuestoes.estudo === 'novas') lista = lista.filter(q => !registro(q.id) || registro(q.id).tentativas === 0);
    if (filtroQuestoes.estudo === 'revisao') { const d = new Set(revisoesDevidas()); lista = lista.filter(q => d.has(q.id)); }
  }
  const el = $('q-count');
  if (el) el.textContent = `${lista.length} questão(ões) disponíveis`;
}

function alternativaHtml(q) {
  return Object.entries(q.alternativas).map(([l, txt]) =>
    `<button class="alt" data-alt="${l}" data-correta="${q.gabarito === l ? 1 : 0}">
       <span class="alt-letra">${l}</span><span class="alt-txt">${esc(txt)}</span>
     </button>`).join('');
}

function renderQuestaoSessao() {
  if (!sessaoQuestoes) return;
  const q = QUESTOES.find(x => x.id === sessaoQuestoes.ids[sessaoQuestoes.idx]);
  const resp = sessaoQuestoes.respondidas[q.id];
  const total = sessaoQuestoes.ids.length;
  const prog = Math.round(sessaoQuestoes.idx / total * 100);
  const html = `
    <div class="q-sessao">
      <div class="q-head">
        <span class="q-prog">Questão ${sessaoQuestoes.idx + 1} de ${total}</span>
        <span class="q-grupo">${esc(sessaoQuestoes.titulo || gruposRotulo[q.grupo] || q.grupo)}</span>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${prog}%"></div></div>
      <div class="q-enunciado">${esc(q.enunciado)}</div>
      <div class="q-alts">${alternativaHtml(q)}</div>
      ${resp !== undefined ? `
        <div class="q-feedback ${resp.certa ? 'certo' : 'errado'}">
          ${resp.certa ? '✔ Correta!' : `✘ Errada — gabarito ${esc(q.gabarito)}: ${esc((q.alternativas[q.gabarito] || '').slice(0, 120))}`}
        </div>` : ''}
      <div class="q-nav">
        <button class="btn-sec" id="btn-q-ant" ${sessaoQuestoes.idx === 0 ? 'disabled' : ''}>‹ Anterior</button>
        ${sessaoQuestoes.idx === total - 1
          ? `<button class="btn-primario" id="btn-q-fim">Finalizar sessão</button>`
          : `<button class="btn-primario" id="btn-q-prox">Próxima ›</button>`}
      </div>
    </div>`;
  setConteudo('questoes-sessao', html);
  marcarAltSel(q.id, resp);
}

function marcarAltSel(qid, resp) {
  if (!resp) return;
  const q = QUESTOES.find(x => x.id === qid);
  document.querySelectorAll('[data-alt]').forEach(b => {
    if (b.dataset.alt === resp.alt) b.classList.add('sel');
    if (b.dataset.alt === q.gabarito) b.classList.add('corr');
  });
}

/* ---------------- Aba Simulados ---------------- */
let sessaoSimulado = null; // { simuladoIndex, ids, idx, respostas:{} }
let timerSimulado = null;

function renderSimuladosHome() {
  const html = SIMULADOS.map((s, i) => {
    const done = sessaoSimulado && sessaoSimulado.simuladoIndex === i;
    const cls = done ? 'ativo' : '';
    return `<div class="sim-card ${cls}">
      <div class="sim-head">
        <b>${esc(s.rotulo)}</b>
        <span class="sim-meta">${s.total} questões · ${s.duracao_min} min</span>
      </div>
      <div class="sim-disc">${Object.entries(s.disciplinas).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}</div>
      <button class="btn-primario" data-sim="${i}">${done ? '↺ Continuar' : '▶ Iniciar'}</button>
    </div>`;
  }).join('');
  setConteudo('simulados-home', html);
}

function iniciarSimulado(i) {
  const s = SIMULADOS[i];
  sessaoSimulado = { simuladoIndex: i, ids: s.questoes, idx: 0, respostas: {}, inicio: Date.now() };
  estudoTemp = { tipo: 'simulado', simulado: i };
  renderSimuladoSessao();
}

function iniciarSimuladoComTimer(i, force) {
  if (force || !sessaoSimulado || sessaoSimulado.simuladoIndex !== i) iniciarSimulado(i);
  else renderSimuladoSessao();
  if (timerSimulado) clearInterval(timerSimulado);
  timerSimulado = setInterval(() => {
    const el = $('sim-tempo');
    if (el && sessaoSimulado) {
      const dec = Math.floor((Date.now() - sessaoSimulado.inicio) / 1000);
      const rest = SIMULADOS[sessaoSimulado.simuladoIndex].duracao_min * 60 - dec;
      const mm = String(Math.floor(Math.max(0, rest) / 60)).padStart(2, '0');
      const ss = String(Math.max(0, rest) % 60).padStart(2, '0');
      el.textContent = `${mm}:${ss}`;
      if (rest <= 0) { clearInterval(timerSimulado); timerSimulado = null; finalizarSimulado(); }
    }
  }, 1000);
}

function renderSimuladoSessao() {
  if (!sessaoSimulado) return;
  const s = SIMULADOS[sessaoSimulado.simuladoIndex];
  const q = QUESTOES.find(x => x.id === sessaoSimulado.ids[sessaoSimulado.idx]);
  const total = s.questoes.length;
  const respostas = sessaoSimulado.respostas;
  const respondidasCount = Object.keys(respostas).length;
  // cronômetro
  const decorrido = Math.floor((Date.now() - sessaoSimulado.inicio) / 1000);
  const restantes = s.duracao_min * 60 - decorrido;
  const mm = String(Math.floor(Math.max(0, restantes) / 60)).padStart(2, '0');
  const ss = String(Math.max(0, restantes) % 60).padStart(2, '0');

  const nav = s.questoes.map((id, n) =>
    `<button class="sim-nav ${n === sessaoSimulado.idx ? 'atual' : ''} ${respostas[id] ? 'resp' : ''}" data-nav="${n}">${n + 1}</button>`).join('');

  const html = `
    <div class="sim-sessao">
      <div class="sim-top">
        <span>${esc(s.rotulo)}</span>
        <span class="sim-tempo" id="sim-tempo">${mm}:${ss}</span>
      </div>
      <div class="sim-navbar">${nav}</div>
      <div class="q-enunciado">${esc(q.enunciado)}</div>
      <div class="q-alts">${alternativaHtml(q)}</div>
      <div class="q-nav">
        <button class="btn-sec" id="btn-sim-ant" ${sessaoSimulado.idx === 0 ? 'disabled' : ''}>‹</button>
        <span class="q-prog">${sessaoSimulado.idx + 1}/${total}</span>
        <button class="btn-sec" id="btn-sim-prox" ${sessaoSimulado.idx === total - 1 ? 'disabled' : ''}>›</button>
      </div>
      <button class="btn-primario full" id="btn-sim-fim">Finalizar e corrigir</button>
    </div>`;
  setConteudo('simulado-sessao', html);
  // re-aplica seleção se já escolheu
  const sel = respostas[q.id];
  if (sel) {
    document.querySelectorAll('[data-alt]').forEach(b => {
      if (b.dataset.alt === sel) b.classList.add('sel');
    });
  }
}

function finalizarSimulado() {
  if (!sessaoSimulado) return;
  const s = SIMULADOS[sessaoSimulado.simuladoIndex];
  const respostas = sessaoSimulado.respostas;
  let certas = 0, emBranco = 0;
  // corrige todas as respondidas no histórico
  s.questoes.forEach(id => {
    const r = respostas[id];
    const q = QUESTOES.find(x => x.id === id);
    if (!q) return;
    if (!r) { emBranco++; return; }
    const certa = r === q.gabarito;
    if (certa) certas++;
    registrarResp(id, certa);
  });
  const total = s.questoes.length;
  const pct = Math.round(certas / total * 100);
  const itens = s.questoes.map((id, i) => {
    const q = QUESTOES.find(x => x.id === id);
    if (!q) return '';
    const r = respostas[id];
    const certa = !!r && r === q.gabarito;
    const status = !r ? 'rev-branco' : certa ? 'rev-certo' : 'rev-errado';
    const sim = !r ? '—' : certa ? '✔' : '✘';
    return `<div class="rev-item ${status}">
      <div class="rev-head"><span class="rev-n">${i + 1}.</span><span class="rev-status">${sim}</span></div>
      <div class="rev-texto">${esc(q.enunciado.slice(0, 160))}${q.enunciado.length > 160 ? '…' : ''}</div>
      ${r ? `<div class="rev-sua">Sua resposta: <b>${esc(r)}</b></div>` : '<div class="rev-sua">Em branco</div>'}
      <div class="rev-gab">Gabarito: <b>${esc(q.gabarito)}</b> — ${esc(q.alternativas[q.gabarito] || '')}</div>
    </div>`;
  }).join('');
  const html = `
    <div class="sim-resultado">
      <h2>${esc(s.rotulo)} — resultado</h2>
      <div class="sim-score">${certas}/${total}</div>
      <div class="sim-pct">${pct}% de acertos</div>
      <div class="sim-detalhe">Em branco: ${emBranco}</div>
      <p class="sim-verdict">${obterVeredicto(pct)}</p>
      <button class="btn-primario" id="btn-sim-repetir">↺ Fazer de novo</button>
      <button class="btn-sec" id="btn-sim-voltar">‹ Voltar aos simulados</button>
      <div class="sim-revisao">
        <h3>Correção completa</h3>
        ${itens}
      </div>
    </div>`;
  setConteudo('simulado-sessao', html);
  if (timerSimulado) { clearInterval(timerSimulado); timerSimulado = null; }
  renderAnalise();
  renderHojeFoco();
}
function obterVeredicto(pct) {
  if (pct >= 80) return 'Excelente! Nível acima da aprovação para esta disciplina simulada.';
  if (pct >= 60) return 'Bom resultado. Reforce os assuntos do mapa de fraquezas.';
  if (pct >= 50) return 'Você atingiu a média mínima. Hora de reforçar o que errou.';
  return 'Abaixo da média. Revise a teoria e refaça as questões erradas.';
}

/* ---------------- Aba Análise ---------------- */
function renderFraquezas() {
  // por disciplina/assunto: acertos/tentativas no histórico
  const dados = {};
  QUESTOES_ATIVAS.forEach(q => {
    const r = registro(q.id);
    if (!r || !r.tentativas) return;
    const key = `${gruposRotulo[q.grupo]} › ${q.assunto_rotulo || q.assunto || q.grupo}`;
    dados[key] = dados[key] || { certas: 0, tot: 0 };
    dados[key].tot += r.tentativas;
    dados[key].certas += r.acertos;
  });
  const ord = Object.entries(dados).sort((a, b) => (a[1].certas / a[1].tot) - (b[1].certas / b[1].tot));
  const html = `
    <h3>Mapa de fraquezas</h3>
    ${ord.length ? ord.map(([k, v]) => {
      const pct = Math.round(v.certas / v.tot * 100);
      const fraca = pct < 70;
      return `<div class="fraca ${fraca ? 'fraca-a' : ''}">
        <div class="fraca-linha"><span>${esc(k)}</span><b>${pct}%</b></div>
        <div class="bar"><div class="bar-fill ${fraca ? 'bar-red' : ''}" style="width:${pct}%"></div></div>
        <div class="fraca-sub">${v.certas}/${v.tot} acertos</div>
      </div>`;
    }).join('') : '<p class="vazio">Responda questões para ver o mapa de fraquezas.</p>'}
    <div class="dica">Assuntos abaixo de 70% merecem reforço.</div>`;
  setConteudo('painel-fraquezas', html);
}

function renderCadernoErros() {
  const erros = QUESTOES_ATIVAS.filter(q => {
    const r = registro(q.id);
    return r && r.tentativas && (r.ultimoErro !== undefined) && !(r.acertoEm && r.acertoEm > r.ultimoErro);
  });
  const html = `
    <h3>Caderno de erros (${erros.length})</h3>
    ${erros.length ? `<button class="btn-primario" id="btn-treinar-erros">▶ Revisar ${Math.min(25, erros.length)} erros</button>` : ''}
    ${erros.slice(0, 8).map(q =>
      `<div class="erro-item"><span class="erro-g">${esc(gruposRotulo[q.grupo])}</span> ${esc(q.enunciado.slice(0, 90))}… <span class="erro-gab">gabarito ${esc(q.gabarito)}</span></div>`
    ).join('')}`;
  setConteudo('painel-erros', html);
}

function renderAnalise() {
  if ($('painel-fraquezas')) renderFraquezas();
  if ($('painel-erros')) renderCadernoErros();
}

/* ---------------- Aba Hoje (extra) ---------------- */
function gruposSecao(titulo) {
  const t = (titulo || '').toUpperCase();
  const out = [];
  if (t.includes('PORTUGU')) out.push('lingua_portuguesa');
  if (t.includes('LÓGICO') || t.includes('LOGICO')) out.push('rac_logico');
  if (t.includes('INFORMÁTICA') || t.includes('INFORMATICA') || t.includes('ESPECÍFICOS') || t.includes('ESPECIFICOS')) out.push('informatica');
  return out;
}
// questões sugeridas para um dia: prioriza as que têm keywords no conteúdo das seções,
// com fallback para as do(s) grupo(s) do dia (nunca inventa conteúdo). Distribui entre
// os grupos do dia para o quiz cobrir as disciplinas do cronograma.
function questoesDoDia(d, limite = 10) {
  if (!d) return [];
  const gruposDia = new Set();
  d.secoes.forEach(s => gruposSecao(s.titulo).forEach(g => gruposDia.add(g)));
  // ordem dos grupos seguindo a ordem das seções do dia
  const ordemGrupos = [];
  d.secoes.forEach(s => gruposSecao(s.titulo).forEach(g => {
    if (!ordemGrupos.includes(g)) ordemGrupos.push(g);
  }));
  const txt = d.secoes.map(s => (s.conteudo || '') + ' ' + s.titulo).join(' ').toLowerCase();
  const pool = QUESTOES_ATIVAS.filter(q => gruposDia.has(q.grupo));
  if (!pool.length) return [];
  const porGrupo = {};
  ordemGrupos.forEach(g => porGrupo[g] = []);
  pool.forEach(q => {
    let sc = 0;
    (q.keywords || []).forEach(k => { if (txt.includes(String(k).toLowerCase())) sc++; });
    const rot = (q.assunto_rotulo || '').toLowerCase();
    if (rot && txt.includes(rot)) sc += 5;
    porGrupo[q.grupo].push({ q, sc });
  });
  ordemGrupos.forEach(g => porGrupo[g].sort((a, b) => b.sc - a.sc));
  const qs = [];
  const porVez = Math.ceil(limite / ordemGrupos.length);
  ordemGrupos.forEach(g => {
    const eleg = porGrupo[g].filter(x => x.sc > 0);
    for (const x of eleg) {
      if (qs.length >= limite) break;
      qs.push(x.q);
    }
  });
  // se ainda falta, completa com as demais do pool (mantendo ordem dos grupos)
  let gi = 0;
  while (qs.length < limite && qs.length < pool.length) {
    const g = ordemGrupos[gi % ordemGrupos.length];
    gi++;
    const item = porGrupo[g].find(x => !qs.includes(x.q));
    if (item) qs.push(item.q);
    else if (ordemGrupos.every(gr => porGrupo[gr].every(x => qs.includes(x.q)))) break;
  }
  return qs.slice(0, limite);
}
function diasPendentes() {
  const atual = diaAtual();
  return DIAS.filter(d => d.dia < atual && !concluidoDia(d.dia));
}
function renderHojePendencias() {
  const el = $('hoje-pendencias');
  const pend = diasPendentes();
  if (!pend.length) { if (el) el.innerHTML = ''; return; }
  const html = `
    <div class="foco pend">
      <div class="foco-titulo">⏪ Dias anteriores pendentes (${pend.length})</div>
      ${pend.map(d => {
        const qs = questoesDoDia(d);
        return `<div class="pend-dia">
          <div class="pend-head">
            <span class="pend-titulo">Dia ${d.dia} · ${esc(d.data)}</span>
            <span class="pend-pct">${percentDia(d.dia)}%</span>
          </div>
          <div class="pend-entrega">${esc(d.entrega || '')}</div>
          ${qs.length ? `<button class="btn-primario btn-secondary" data-quiz-dia="${d.dia}">▶ Quiz do dia ${d.dia} (${qs.length})</button>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  if (el) el.innerHTML = html;
}
function renderHojeFoco() {
  const devidas = revisoesDevidas();
  const diaAlvo = diaHojeAlvo();
  // questões previstas: junta assuntos das seções do dia com o banco
  const previstas = questoesDoDia(diaAlvo, 12);
  const html = `
    <div class="foco">
      <div class="foco-titulo">🎯 Foco de hoje</div>
      <div class="mini-stats">
        <div class="stat"><b>${devidas.length}</b><span>revisões<br>devidas</span></div>
        <div class="stat"><b>${previstas.length}</b><span>questões<br>sugeridas</span></div>
        <div class="stat"><b>${data.total_dias - diaAtual()}</b><span>dias até<br>a prova</span></div>
      </div>
      ${devidas.length ? `<button class="btn-primario" id="btn-foco-revisao">▶ Revisar ${Math.min(10, devidas.length)} devidas</button>` : ''}
      ${previstas.length ? `<button class="btn-primario btn-secondary" id="btn-foco-questoes">▶ ${previstas.length} questões do dia</button>` : ''}
    </div>`;
  setConteudo('hoje-foco', html);
}
function txContains(txt, sub) {
  // sub é palavra; verifica ocorrência com fronteiras simples
  sub = sub.toLowerCase().trim();
  if (!sub) return false;
  return txt.includes(sub);
}

/* ---------------- Aba Biblioteca ---------------- */
function escSearch(s) {
  return encodeURIComponent(s.trim());
}
function renderBiblioteca() {
  if (!$('biblioteca')) return;
  // agrupa pelo número de questões do edital: especificos primeiro (maior peso)
  const disc = Object.keys(ASSUNTOS.disciplinas).sort((a, b) =>
    (ASSUNTOS.disciplinas[b].peso || 0) - (ASSUNTOS.disciplinas[a].peso || 0));
  const html = disc.map(dk => {
    const d = ASSUNTOS.disciplinas[dk];
    const assuntos = Object.keys(d.assuntos);
    return `
      <div class="bib-disc">
        <div class="bib-disc-head">
          <span class="bib-disc-nome">${esc(d.rotulo)}</span>
          <span class="bib-disc-peso">${d.questoes_prova} questões · ${(d.peso || 0).toLocaleString('pt-BR', {maximumFractionDigits:0})} pts</span>
        </div>
        <div class="bib-grid">
          ${assuntos.map(a => {
            const rot = d.assuntos[a].rotulo;
            const q = `concurso ${d.rotulo} ${rot} edital técnico de informática 2026`;
            return `<button class="bib-item" data-yts="${escSearch(q)}">
              <span class="bib-rotulo">${esc(rot)}</span>
              <span class="bib-yt">▶ YouTube</span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
  setConteudo('biblioteca', html);
}

/* ---------------- renderAll ---------------- */
function renderAll() {
  $('user-name').textContent = user && user.displayName ? user.displayName.split(' ')[0] : '';
  renderHoje();
  renderListaDias();
  renderFases();
  renderProgresso();
  renderAnalise();
  renderHojeFoco();
  renderBiblioteca();
  renderQuestoesHome();
  renderSimuladosHome();
  if (sessaoQuestoes) renderQuestaoSessao();
  if (sessaoSimulado) renderSimuladoSessao();
  if (modalDia) {
    const d = DIAS.find(x => x.dia === modalDia);
    if (d) openDia(d);
  }
}

/* ---------------- Init ---------------- */
// hook para testes/inspeção (apenas em localhost)
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.__APP__ = { get QUESTOES() { return QUESTOES; }, get DIAS() { return DIAS; }, get estudo() { return estudo; }, get progresso() { return progresso; }, get sessaoQuestoes() { return sessaoQuestoes; }, get sessaoSimulado() { return sessaoSimulado; }, diaAtual, questoesDoDia, mergeProgresso, mergeHistorico };
}

async function init() {
  // mantém as abas coladas logo abaixo do topbar ao rolar
  const syncTopbarH = () => {
    const tb = document.querySelector('.topbar');
    if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
  };
  syncTopbarH();
  window.addEventListener('resize', syncTopbarH);

  loadLocal();
  bindEvents();
  showSplash();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW falhou:', e.message));
  }

  try {
    await carregarDados();
  } catch (e) {
    console.error(e);
    document.body.innerHTML = '<div class="vazio" style="padding:40px">Não foi possível carregar o cronograma. Verifique se o arquivo data/cronograma.json existe.</div>';
    return;
  }

  const fireOk = initFirebase();
  if (fireOk) {
    // Aguarda o estado de auth (não há timeout arbitrário). Enquanto isso, splash.
    let authPendente = true;
    auth.onAuthStateChanged(async u => {
      if (!authPendente) return;
      if (u) {
        authPendente = false;
        user = u;
        await carregarProgressoRemoto();
        iniciarEscuta();
        showApp();
        renderAll();
      } else {
        authPendente = false;
        user = null;
        progresso = {};
        showLogin();
      }
    }, err => {
      console.error('Erro no onAuthStateChanged:', err);
      showLogin();
    });
    // Fallback offline: se o Firebase não responder e não houver rede, entra em
    // modo local para o PWA continuar funcionando (senão o splash fica eterno).
    setTimeout(() => {
      if (!authPendente) return;
      if (navigator.onLine) return;
      authPendente = false;
      localOnly = true;
      user = null;
      const saved = localStorage.getItem('cronograma_usuario');
      if (saved) {
        user = { displayName: saved, fake: true };
        showApp();
        renderAll();
      } else {
        showLogin();
      }
    }, 5000);
  } else {
    // Modo local: usuário clica em "Entrar com Google" e entra sem conta
    localOnly = true;
    // Se já estava logado antes (nome salvo), mantém
    const saved = localStorage.getItem('cronograma_usuario');
    if (saved) {
      user = { displayName: saved, fake: true };
      showApp();
      renderAll();
    } else {
      showLogin();
    }
  }
}

init();