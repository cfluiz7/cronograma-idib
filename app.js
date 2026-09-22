/* Cronograma IDIB - app.js
   Login Google + Firestore (sincronia PC/celular) + checklist do cronograma.
   Se o Firebase não estiver configurado, funciona em modo local (sem sync). */

let data = null;
let DIAS = [];
let FASES = {};

async function carregarDados() {
  const r = await fetch('./data/cronograma.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Falha ao carregar cronograma.json');
  data = await r.json();
  DIAS = data.dias;
  FASES = data.fases;
  return data;
}

/* ---------------- Estado ---------------- */
let user = null;            // usuário Firebase (ou fake local)
let progresso = {};         // {dias: {1: {secoes:{tit:bool}, entrega:bool, anotacao, acertos, erros}}}
let db = null, auth = null;
let localOnly = false;
let modoLeitura = false;
let currentFilters = { q: '' };

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
}
function saveLocal() {
  try { localStorage.setItem('cronograma_progresso', JSON.stringify({ dias: progresso })); } catch {}
}

const diaRef = () => db && user && db.collection('usuarios').doc(user.uid).collection('progresso').doc('dias');

/* ---------------- Fluxo de login ---------------- */
async function onLogin() {
  renderAll();
  showApp();
}
async function onLogout() {
  if (auth) {
    await auth.signOut();
    user = null;
    progresso = {};
    showLogin();
  } else {
    localStorage.removeItem('cronograma_usuario');
    user = null;
    progresso = {};
    showLogin();
  }
}

function showLogin() {
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-app').classList.add('hidden');
}
function showApp() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');
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
      progresso = d;
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
  } catch (e) { console.warn('Falha ao salvar no Firestore:', e.message); }
}
function iniciarEscuta() {
  if (!usarFirestore()) return;
  diaRef().onSnapshot(snap => {
    if (snap.exists) {
      modoLeitura = true;
      progresso = snap.data().dias || {};
      saveLocal();
      renderAll();
      modoLeitura = false;
    }
  }, err => console.warn('Escuta Firestore falhou:', err.message));
}

/* ---------------- Render ---------------- */
const $ = id => document.getElementById(id);

function esc(t) {
  const d = document.createElement('div');
  d.textContent = t == null ? '' : t;
  return d.innerHTML;
}

function setConteudo(id, html) {
  $(id).innerHTML = html;
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
  else if (diaHojeAlvo()) status = `Próximo dia do cronograma (dia ${diaAtual()})`;
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
  });
}

/* ---------------- renderAll ---------------- */
function renderAll() {
  $('user-name').textContent = user && user.displayName ? user.displayName.split(' ')[0] : '';
  renderHoje();
  renderListaDias();
  renderFases();
  renderProgresso();
  if (modalDia) {
    const d = DIAS.find(x => x.dia === modalDia);
    if (d) openDia(d);
  }
}

/* ---------------- Init ---------------- */
async function init() {
  loadLocal();
  bindEvents();

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
    auth.onAuthStateChanged(async u => {
      if (u) {
        user = u;
        await carregarProgressoRemoto();
        iniciarEscuta();
        showApp();
        renderAll();
      } else {
        user = null;
        progresso = {};
        showLogin();
      }
    });
  } else {
    // Modo local: usuário clica em "Entrar com Google" e entra sem conta
    localOnly = true;
    // Se já estava logado antes (nome salvo), mantém
    const saved = localStorage.getItem('cronograma_usuario');
    if (saved) {
      user = { displayName: saved, fake: true };
      showApp();
      renderAll();
    }
  }
}

init();