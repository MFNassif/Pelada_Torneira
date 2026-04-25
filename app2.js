// ============================================================
// PELADA DO TORNEIRA — APP.JS  (v6 — novo fluxo de sorteio)
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs,
  onSnapshot, updateDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';


// ─── CONSTANTS ───────────────────────────────────────────────
const K_SHRINKAGE = 5;
const W_VIT       = 0.75;
const LS_CONFIG   = 'pelada_fb_config';
const LS_USER     = 'pelada_user';
const LS_LOCAL    = 'pelada_local_v2';

let db_fire = null;
let useFirebase = false;
let currentUser = null;
let appData = { jogadores: [], restricoes: [], config: { aleatoriedade: 15 }, admins: [], nextId: 1, presenca: null, financas: {} };
let unsubscribe = null;

// ─── HELPER: convert Firestore times obj back to array of arrays ─
function timesToArr(times, count) {
  if (!times) return [];
  if (Array.isArray(times)) return times; // already array (local)
  // Convert {t0:[...], t1:[...]} back to [[...],[...]]
  const n = count || Object.keys(times).length;
  const arr = [];
  for (let i = 0; i < n; i++) {
    const t = times['t' + i];
    if (t) arr.push(t);
  }
  return arr;
}


// ─── FIREBASE ────────────────────────────────────────────────
function salvarFirebaseConfig() {
  const cfg = {
    apiKey:            document.getElementById('cfg_apiKey').value.trim(),
    authDomain:        document.getElementById('cfg_authDomain').value.trim(),
    projectId:         document.getElementById('cfg_projectId').value.trim(),
    storageBucket:     document.getElementById('cfg_storageBucket').value.trim(),
    messagingSenderId: document.getElementById('cfg_messagingSenderId').value.trim(),
    appId:             document.getElementById('cfg_appId').value.trim(),
  };
  if (!cfg.apiKey || !cfg.projectId) { showToast('Preencha API Key e Project ID'); return; }
  localStorage.setItem(LS_CONFIG, JSON.stringify(cfg));
  useFirebase = true;
  initFB(cfg);
  showSetup(false); showLogin(true);
}

function usarSemFirebase() {
  useFirebase = false;
  localStorage.setItem(LS_CONFIG, JSON.stringify({ local: true }));
  showSetup(false); showLogin(true);
}

function initFB(cfg) {
  try {
    const app = initializeApp(cfg);
    db_fire = getFirestore(app);
  } catch(e) { console.error(e); showToast('Erro Firebase'); }
}

// ─── HARDCODED FIREBASE CONFIG ──────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBcR4DWJ8Ckth5LFw8B35Jy50pdEqR2XKg",
  authDomain: "pelada-do-torneira.firebaseapp.com",
  projectId: "pelada-do-torneira",
  storageBucket: "pelada-do-torneira.firebasestorage.app",
  messagingSenderId: "330686521415",
  appId: "1:330686521415:web:49455477ca203881ae5162"
};

window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  useFirebase = true;
  initFB(FIREBASE_CONFIG);
  await loadData();
  const su = localStorage.getItem(LS_USER);
  if (!su) { showLogin(true); return; }
  currentUser = JSON.parse(su);
  currentUser.isAdmin = (appData.admins || []).includes(currentUser.id);
  localStorage.setItem(LS_USER, JSON.stringify(currentUser));
  // Auto-gerar mensalidade do mês para mensalistas
  await checkMensalidadeAtual();
  // Auto-check: remove avulsos não pagos após sáb 12h
  await checkAvulsosInadimplentes();
  showApp();
}

async function entrar() {
  const nome = document.getElementById('loginNome').value.trim();
  if (!nome) { showToast('Digite seu nome'); return; }

  const match = appData.jogadores.find(j => j.nome.toLowerCase() === nome.toLowerCase());

  if (match) {
    if (match.senha) {
      showPasswordStep(match, 'login');
    } else {
      showPasswordStep(match, 'criar');
    }
  } else {
    currentUser = { id: 'guest_' + Date.now(), nome, isAdmin: false, isGuest: true };
    localStorage.setItem(LS_USER, JSON.stringify(currentUser));
    showLogin(false);
    showApp();
  }
}

function showPasswordStep(jogador, modo) {
  const loginCard = document.getElementById('loginCard');
  const isLogin = modo === 'login';
  loginCard.innerHTML = `
    <div style="font-family:'Oswald',sans-serif;font-size:18px;font-weight:700;color:var(--gold-lt);margin-bottom:4px">
      ${isLogin ? 'BEM-VINDO,' : 'CRIAR SENHA,'}
    </div>
    <div style="font-size:13px;color:var(--t2);margin-bottom:18px">${jogador.nome}</div>
    ${!isLogin ? `<div style="font-size:11px;color:var(--t2);margin-bottom:12px">Crie uma senha para proteger sua conta</div>` : ''}
    <div class="field">
      <label>${isLogin ? 'Senha' : 'Nova senha'}</label>
      <input class="input" id="inputSenha" type="password" placeholder="••••••" maxlength="30" onkeydown="if(event.key==='Enter')confirmarSenha('${jogador.id}','${modo}')">
    </div>
    ${!isLogin ? `
    <div class="field">
      <label>Confirmar senha</label>
      <input class="input" id="inputSenha2" type="password" placeholder="••••••" maxlength="30">
    </div>` : ''}
    <button class="btn btn-gold" onclick="confirmarSenha('${jogador.id}','${modo}')">
      ${isLogin ? 'ENTRAR' : 'CRIAR SENHA E ENTRAR'}
    </button>
    <button class="btn btn-ghost mt8" onclick="voltarLogin()">← VOLTAR</button>
  `;
  setTimeout(() => document.getElementById('inputSenha')?.focus(), 100);
}

function voltarLogin() {
  document.getElementById('loginCard').innerHTML = `
    <div class="field">
      <label>Seu nome na pelada</label>
      <input class="input" id="loginNome" placeholder="Como te chamam?" maxlength="25" onkeydown="if(event.key==='Enter')entrar()">
    </div>
    <button class="btn btn-gold" onclick="entrar()">ENTRAR ⚽</button>
    <div style="font-size:11px;color:var(--t3);text-align:center;margin-top:12px">Nenhuma senha necessária</div>
  `;
}

function hashSenha(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return 'h' + Math.abs(h).toString(36);
}

async function confirmarSenha(jogadorId, modo) {
  const inp = document.getElementById('inputSenha');
  const senha = inp?.value?.trim();
  if (!senha || senha.length < 4) { showToast('Senha deve ter pelo menos 4 caracteres'); return; }

  // Re-load from appData to get latest
  const j = appData.jogadores.find(x => x.id === jogadorId);
  if (!j) { showToast('Jogador não encontrado'); return; }

  if (modo === 'criar') {
    const senha2 = document.getElementById('inputSenha2')?.value?.trim();
    if (senha !== senha2) { showToast('Senhas não coincidem'); return; }
    j.senha = hashSenha(senha);
    await firestoreSet('jogadores', jogadorId, j);
    saveLocal();
    showToast('Senha criada! ✅');
  } else {
    const hash = hashSenha(senha);
    // Accept both new hash and old btoa (migration)
    let ok = hash === j.senha;
    if (!ok) { try { ok = btoa(unescape(encodeURIComponent(senha))) === j.senha; } catch(e) {} }
    if (!ok) {
      showToast('Senha incorreta ❌');
      inp.value = ''; inp.focus(); return;
    }
    // Migrate to new hash
    if (j.senha !== hash) { j.senha = hash; await firestoreSet('jogadores', jogadorId, j); saveLocal(); }
  }

  const isAdmin = (appData.admins || []).includes(j.id);
  currentUser = { id: j.id, nome: j.nome, isAdmin, foto: j.foto || null };
  localStorage.setItem(LS_USER, JSON.stringify(currentUser));
  showLogin(false);
  showApp();
}

// ─── DATA ────────────────────────────────────────────────────
async function loadData() {
  if (useFirebase && db_fire) { await loadFB(); subscribeRT(); }
  else loadLocal();
}

async function loadFB() {
  try {
    const [js, rs, cfg, adm] = await Promise.all([
      getDocs(collection(db_fire,'jogadores')),
      getDocs(collection(db_fire,'restricoes')),
      getDoc(doc(db_fire,'config','main')),
      getDoc(doc(db_fire,'config','admins')),
    ]);
    appData.jogadores = js.docs.map(d=>d.data());
    appData.restricoes = rs.docs.map(d=>d.data());
    appData.config = cfg.exists() ? cfg.data() : { aleatoriedade:15 };
    appData.admins = adm.exists() ? (adm.data().list||[]) : [];
    try {
      const sortSnap = await getDoc(doc(db_fire,'config','ultimoSorteio'));
      appData.ultimoSorteio = sortSnap.exists() ? sortSnap.data() : null;
    } catch(e) { appData.ultimoSorteio = null; }
    try {
      const histSnap = await getDocs(collection(db_fire,'peladasHist'));
      appData.peladasHist = histSnap.docs.map(d=>d.data());
    } catch(e) { appData.peladasHist = []; }
    // Load presença
    try {
      const presSnap = await getDoc(doc(db_fire,'config','presenca'));
      appData.presenca = presSnap.exists() ? presSnap.data() : null;
    } catch(e) { appData.presenca = null; }
    // Load finanças
    try {
      const finSnap = await getDocs(collection(db_fire,'financas'));
      appData.financas = {};
      finSnap.docs.forEach(d => { appData.financas[d.id] = d.data(); });
    } catch(e) { appData.financas = {}; }
    // Load comunicados
    try {
      const comSnap = await getDocs(collection(db_fire,'comunicados'));
      appData.comunicados = comSnap.docs.map(d=>d.data()).sort((a,b)=>(b.criadoEm||0)-(a.criadoEm||0));
    } catch(e) { appData.comunicados = []; }

    if (appData.admins.length===0 && currentUser) {
      appData.admins=[currentUser.id];
      await firestoreSet('config','admins',{list:[currentUser.id]});
    }
    if (currentUser) {
      currentUser.isAdmin = appData.admins.includes(currentUser.id);
      localStorage.setItem(LS_USER,JSON.stringify(currentUser));
    }
  } catch(e) { console.error(e); loadLocal(); }
}

function subscribeRT() {
  if (unsubscribe) unsubscribe();
  if (!db_fire) return;
  unsubscribe = onSnapshot(collection(db_fire,'jogadores'), snap => {
    appData.jogadores = snap.docs.map(d=>d.data());
    refreshScreen();
  });
  onSnapshot(doc(db_fire,'config','ultimoSorteio'), snap => {
    appData.ultimoSorteio = snap.exists() ? snap.data() : null;
    if (curScreen === 'home') renderHome();
  });
  onSnapshot(collection(db_fire,'peladasHist'), snap => {
    appData.peladasHist = snap.docs.map(d=>d.data());
    if (curScreen === 'home') renderPeladasHistorico();
  });
  onSnapshot(doc(db_fire,'config','presenca'), snap => {
    appData.presenca = snap.exists() ? snap.data() : null;
    if (curScreen === 'home') renderPresenca();
  });
  onSnapshot(collection(db_fire,'financas'), snap => {
    appData.financas = {};
    snap.docs.forEach(d => { appData.financas[d.id] = d.data(); });
    if (curScreen === 'financas') renderFinancas();
    if (curScreen === 'home') renderPresenca();
  });
  onSnapshot(collection(db_fire,'comunicados'), snap => {
    appData.comunicados = snap.docs.map(d=>d.data()).sort((a,b)=>(b.criadoEm||0)-(a.criadoEm||0));
    if (curScreen === 'home') renderComunicados();
  });
}

function loadLocal() {
  const raw = localStorage.getItem(LS_LOCAL);
  if (raw) appData = { ...appData, ...JSON.parse(raw) };
}

function saveLocal() { localStorage.setItem(LS_LOCAL, JSON.stringify(appData)); }

async function firestoreSet(col, id, data) {
  if (useFirebase && db_fire) await setDoc(doc(db_fire,col,id), data);
}
async function firestoreDelete(col, id) {
  if (useFirebase && db_fire) await deleteDoc(doc(db_fire,col,id));
}

// ─── MATH ────────────────────────────────────────────────────
function scoreRaw(g,a,v) { return +(g + a + W_VIT*v).toFixed(4); }
function scoreAcum(j) {
  const ativos = (j.domingos||[]).filter(d=>!d.ausente);
  if (!ativos.length) return 0;
  const s = ativos.map(d=>scoreRaw(d.gols||0,d.assists||0,d.vitorias||0));
  return +(s.reduce((a,x)=>a+x,0)/s.length).toFixed(4);
}
function nDom(j) { return j.domingos?.length||0; }
function medioGrupo(jogs) {
  const a=jogs.filter(j=>nDom(j)>0);
  if(!a.length) return 0;
  return +(a.reduce((s,j)=>s+scoreAcum(j),0)/a.length).toFixed(4);
}
function nDomAtivo(j) { return (j.domingos||[]).filter(d=>!d.ausente).length; }
function scoreAdj(j,med) {
  const n=nDomAtivo(j);  // only active days count for confidence
  return +((n*scoreAcum(j)+K_SHRINKAGE*med)/(n+K_SHRINKAGE)).toFixed(4);
}
function alpha(n) {
  // Peso da NOTA OPINATIVA — decresce conforme acumulam domingos
  // dom 0→1.0, 1→0.9, 2→0.8, 3→0.75, 4→0.65, 5→0.6, 6→0.55, 7→0.5
  // dom 8-19: interpolação linear de 0.50 até 0.25
  // dom 20+: cap mínimo de 0.25 (75% stats)
  const table = [1.0, 0.9, 0.8, 0.75, 0.65, 0.6, 0.55, 0.5];
  if (n < table.length) return +table[n].toFixed(4);
  if (n >= 20) return 0.25;
  // Linear interpolation from 0.50 at n=7 to 0.25 at n=20
  return +(0.50 + (n - 7) * (0.25 - 0.50) / (20 - 7)).toFixed(4);
}
function normGroup(vals) {
  const mn=Math.min(...vals),mx=Math.max(...vals);
  if(mx===mn) return vals.map(()=>0.5);
  return vals.map(v=>+((v-mn)/(mx-mn)).toFixed(4));
}
function calcIdx(jogs) {
  if(!jogs.length) return [];
  const med=medioGrupo(jogs);
  const adjs=jogs.map(j=>scoreAdj(j,med));
  const notas=jogs.map(j=>+(j.nota||5).toFixed(1));
  const adjN=normGroup(adjs), notN=normGroup(notas);
  return jogs.map((j,i)=>{
    const n=nDomAtivo(j),a=alpha(n);
    const IF=+((a*notN[i]+(1-a)*adjN[i])*10).toFixed(4); // 0-10 scale
    return {id:j.id,nome:j.nome,nota:notas[i],notaN:notN[i],sAdj:adjs[i],sAdjN:adjN[i],alpha:a,IF,n,nTotal:nDom(j)};
  });
}

// ─── FINANÇAS HELPERS ────────────────────────────────────────
function getFinancasJogador(jogadorId) {
  return appData.financas?.[jogadorId] || { debitos: [], pagamentos: [] };
}

function semanasAtraso5du() {
  // Conta semanas de atraso após o PRÓXIMO prazo de pagamento (get5DiasUteis)
  // Antes do prazo: 0 semanas (sem multa, pode confirmar presença)
  // Após o prazo: 1 semana = R$5, 2 semanas = R$10, etc.
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const prazo = get5DiasUteis(); // próximo vencimento (ex: 08/05/2026)
  prazo.setHours(23, 59, 59, 999);
  if (hoje <= prazo) return 0; // ainda dentro do prazo
  const inicioPrazo = new Date(prazo);
  inicioPrazo.setHours(0, 0, 0, 0);
  const diffDias = Math.floor((hoje - inicioPrazo) / (24 * 60 * 60 * 1000));
  return Math.floor(diffDias / 7); // 1 semana completa = R$5
}

function totalDebitoJogador(jogadorId) {
  const fin = getFinancasJogador(jogadorId);
  const total = (fin.debitos||[]).reduce((s,d) => s + (d.valor||0), 0);
  const pago = (fin.pagamentos||[]).reduce((s,p) => s + (p.valor||0), 0);
  let saldo = Math.max(0, total - pago); // never show negative balance
  // Add automatic weekly late fee for mensalistas with unpaid mensal debts
  if (jogadorMensalista(jogadorId)) {
    const semanas = semanasAtraso5du();
    if (semanas > 0) {
      // Check if there are any unpaid mensal debts (saldo from mensais > 0)
      const saldoMensais = (fin.debitos||[])
        .filter(d => d.tipo === 'mensal')
        .reduce((s,d) => s + (d.valor||0), 0);
      const pagoMensais = (fin.pagamentos||[])
        .filter(p => p.descricao?.toLowerCase().includes('mensalidade'))
        .reduce((s,p) => s + (p.valor||0), 0);
      if (saldoMensais > pagoMensais) {
        saldo += semanas * 5; // R$5/week auto-applied
      }
    }
  }
  return +(saldo).toFixed(2);
}

function jogadorInadimplente(jogadorId) {
  const fin = getFinancasJogador(jogadorId);
  const debitos = fin.debitos || [];
  const pagamentos = fin.pagamentos || [];
  const totalPago = pagamentos.reduce((s,p) => s + (p.valor||0), 0);

  // Multas sempre bloqueiam (independente de tipo ou prazo)
  const totalMultas = debitos
    .filter(d => d.tipo === 'multa')
    .reduce((s,d) => s + (d.valor||0), 0);
  // Pró-rata: desconta pagamentos dos não-multas primeiro, depois das multas
  const totalNaoMultas = debitos
    .filter(d => d.tipo !== 'multa')
    .reduce((s,d) => s + (d.valor||0), 0);
  const pagoParaMultas = Math.max(0, totalPago - totalNaoMultas);
  if (totalMultas > pagoParaMultas) return true;

  // Avulsos: qualquer débito não pago bloqueia
  if (!jogadorMensalista(jogadorId)) {
    return totalDebitoJogador(jogadorId) > 0;
  }

  // Mensalista: mensalidade só bloqueia APÓS o 5du
  const passou5du = semanasAtraso5du() > 0;
  if (!passou5du) return false; // dentro do prazo — pode confirmar mesmo com mensalidade pendente

  // Após 5du: bloqueia se tiver qualquer saldo devedor
  return totalDebitoJogador(jogadorId) > 0;
}

function jogadorMensalista(jogadorId) {
  const j = appData.jogadores.find(x => x.id === jogadorId);
  return j?.tipoJogador === 'mensalista';
}

async function adicionarDebito(jogadorId, tipo, valor, descricao) {
  return adicionarDebitoComData(jogadorId, tipo, valor, descricao, new Date().toLocaleDateString('pt-BR'));
}

async function adicionarDebitoComData(jogadorId, tipo, valor, descricao, data) {
  const fin = getFinancasJogador(jogadorId);
  if (!fin.debitos) fin.debitos = [];
  fin.debitos.push({ id: 'd'+Date.now(), tipo, valor, descricao, data, quitado: false });
  if (!appData.financas) appData.financas = {};
  appData.financas[jogadorId] = fin;
  await firestoreSet('financas', jogadorId, fin);
  saveLocal();
}

async function darBaixa(jogadorId, valor, descricao) {
  return darBaixaComData(jogadorId, valor, descricao, new Date().toLocaleDateString('pt-BR'));
}

async function darBaixaComData(jogadorId, valor, descricao, data) {
  const fin = getFinancasJogador(jogadorId);
  if (!fin.pagamentos) fin.pagamentos = [];
  fin.pagamentos.push({ id: 'p'+Date.now(), valor, descricao, data });
  appData.financas[jogadorId] = fin;
  await firestoreSet('financas', jogadorId, fin);
  saveLocal();
}

// Feriados nacionais fixos [dia, mes] (1-indexed)
const FERIADOS_BR = [
  [1,1],[21,4],[1,5],[7,9],[12,10],[2,11],[15,11],[20,11],[25,12]
];
function isFeriadoBR(d) {
  return FERIADOS_BR.some(([fd,fm]) => d.getDate()===fd && d.getMonth()+1===fm);
}

function calc5DiasUteis(mes, ano) {
  // mes: 0-indexed (JS style). Returns day number of 5th business day (excl. feriados).
  let count = 0, dia = 1;
  while (count < 5) {
    const d = new Date(ano, mes, dia);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !isFeriadoBR(d)) count++;
    if (count < 5) dia++;
  }
  return dia; // just the day number
}

function get5DiasUteis() {
  // Returns the next relevant 5du deadline (this month or next if already past)
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  const mesHoje = hoje.getMonth();
  const anoHoje = hoje.getFullYear();
  const dia5du = calc5DiasUteis(mesHoje, anoHoje);
  const prazo = new Date(anoHoje, mesHoje, dia5du);
  prazo.setHours(23,59,59,999);
  if (hoje > prazo) {
    // Past deadline — show next month
    const proxMes = mesHoje === 11 ? 0 : mesHoje + 1;
    const proxAno = mesHoje === 11 ? anoHoje + 1 : anoHoje;
    const dia5duProx = calc5DiasUteis(proxMes, proxAno);
    return new Date(proxAno, proxMes, dia5duProx);
  }
  return prazo;
}

function getPeriodoMensalidade() {
  // Returns { inicio, prazo, inicioPt, prazoPt } for the current billing period
  // Period start = day after last 5du, Period end = next 5du (deadline)
  const hoje = new Date();
  hoje.setHours(0,0,0,0);

  const mesHoje = hoje.getMonth();   // 0-indexed
  const anoHoje = hoje.getFullYear();

  // 5du of current month
  const dia5duAtual = calc5DiasUteis(mesHoje, anoHoje);
  const prazo5duAtual = new Date(anoHoje, mesHoje, dia5duAtual);
  prazo5duAtual.setHours(23,59,59,999);

  let inicioPeriodo, prazoPeriodo;

  if (hoje <= prazo5duAtual) {
    // Still within this month's deadline
    // Period start = day after last month's 5du
    const mesAnt = mesHoje === 0 ? 11 : mesHoje - 1;
    const anoAnt = mesHoje === 0 ? anoHoje - 1 : anoHoje;
    const dia5duAnt = calc5DiasUteis(mesAnt, anoAnt);
    inicioPeriodo = new Date(anoAnt, mesAnt, dia5duAnt + 1);
    prazoPeriodo = prazo5duAtual;
  } else {
    // Past this month's deadline — current period is from day after 5du_atual to next month's 5du
    inicioPeriodo = new Date(anoHoje, mesHoje, dia5duAtual + 1);
    const proxMes = mesHoje === 11 ? 0 : mesHoje + 1;
    const proxAno = mesHoje === 11 ? anoHoje + 1 : anoHoje;
    const dia5duProx = calc5DiasUteis(proxMes, proxAno);
    prazoPeriodo = new Date(proxAno, proxMes, dia5duProx);
    prazoPeriodo.setHours(23,59,59,999);
  }

  return {
    inicio: inicioPeriodo,
    prazo: prazoPeriodo,
    inicioPt: inicioPeriodo.toLocaleDateString('pt-BR'),
    prazoPt: prazoPeriodo.toLocaleDateString('pt-BR'),
  };
}

function getMesReferencia() {
  // Returns the month string for which mensalidade is currently due
  const hoje = new Date();
  const diaHoje = hoje.getDate();
  const mesHoje = hoje.getMonth();
  const anoHoje = hoje.getFullYear();
  const dia5du = calc5DiasUteis(mesHoje, anoHoje);
  if (diaHoje > dia5du) {
    const proxMes = mesHoje === 11 ? 0 : mesHoje + 1;
    const proxAno = mesHoje === 11 ? anoHoje + 1 : anoHoje;
    return new Date(proxAno, proxMes, 1).toLocaleString('pt-BR',{month:'long',year:'numeric'});
  }
  return new Date(anoHoje, mesHoje, 1).toLocaleString('pt-BR',{month:'long',year:'numeric'});
}

// ─── FUZZY ───────────────────────────────────────────────────
function lev(a,b) {
  a=a.toLowerCase();b=b.toLowerCase();
  const dp=Array.from({length:a.length+1},(_,i)=>[i,...Array(b.length).fill(0)]);
  for(let j=0;j<=b.length;j++)dp[0][j]=j;
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++)
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[a.length][b.length];
}
function fuzzyFind(nome,lista) {
  const n=nome.toLowerCase().trim();
  const ex=lista.find(j=>j.nome.toLowerCase()===n); if(ex) return ex;
  const ct=lista.find(j=>j.nome.toLowerCase().includes(n)||n.includes(j.nome.toLowerCase())); if(ct) return ct;
  let best=null,bd=Infinity;
  for(const j of lista){const d=lev(n,j.nome.toLowerCase());if(d<bd){bd=d;best=j;}}
  return bd<=Math.max(3,Math.floor(n.length*.45))?best:null;
}

// ─── NAV ─────────────────────────────────────────────────────
let curScreen='home';
function goTo(s) {
  // Close float menu if open
  document.getElementById('userFloatMenu')?.remove();
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.remove('active'));
  document.getElementById('sc-'+s)?.classList.add('active');
  document.getElementById('nav-'+s)?.classList.add('active');
  curScreen=s;
  if(s==='home') renderHome();
  if(s==='jogadores') renderJogs();
  if(s==='ranking') renderRanking();
  if(s==='opcoes') renderOpcoes();
  if(s==='financas') renderFinancas();
}
function refreshScreen() { goTo(curScreen); }

// ─── VISIBILITY ──────────────────────────────────────────────
function showSetup(v) { document.getElementById('setupScreen').style.display=v?'block':'none'; }
function showLogin(v) { document.getElementById('loginScreen').style.display=v?'flex':'none'; }
function showApp() {
  const shell=document.getElementById('appShell');
  shell.style.display='flex';
  const hAvatar = document.getElementById('hAvatar');
  if (currentUser?.foto) {
    hAvatar.innerHTML = `<img src="${currentUser.foto}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  } else {
    hAvatar.textContent = (currentUser?.nome||'?')[0].toUpperCase();
  }
  document.getElementById('hNome').textContent=currentUser?.nome||'—';
  document.getElementById('hAdminDot').style.display=currentUser?.isAdmin?'block':'none';
  document.getElementById('adminJogBtn').style.display=currentUser?.isAdmin?'block':'none';
  document.getElementById('adminRestBtn').style.display=currentUser?.isAdmin?'block':'none';
  document.getElementById('adminCard').style.display=currentUser?.isAdmin?'block':'none';
  document.getElementById('btnSortear').style.display=currentUser?.isAdmin?'flex':'none';
  const btnCom = document.getElementById('btnComunicado');
  if (btnCom) btnCom.style.display = currentUser?.isAdmin ? 'block' : 'none';
  renderHome();
}

// ─── HOME ────────────────────────────────────────────────────
function renderHome() {
  const isAdmin = currentUser?.isAdmin;
  document.getElementById('homeSub').textContent = currentUser ? `Bem-vindo, ${currentUser.nome}!` : '';
  document.getElementById('btnSortear').style.display = isAdmin ? 'flex' : 'none';
  const btnComH = document.getElementById('btnComunicado');
  if (btnComH) btnComH.style.display = isAdmin ? 'block' : 'none';
  renderComunicados();

  const sorteio = appData.ultimoSorteio;
  const msg = document.getElementById('homeMsg');
  const stats = document.getElementById('homeStats');
  const adminControls = document.getElementById('homeAdminControls');

  const sorteioTimesArr = timesToArr(sorteio?.times, sorteio?.timesCount);
  if (!sorteio || !sorteio.times || sorteioTimesArr.length === 0) {
    msg.innerHTML = `<div style="font-family:'Oswald',sans-serif;font-size:16px;color:var(--t2);letter-spacing:1px">TIMES AINDA NÃO SORTEADOS</div>`;
    stats.innerHTML = '';
    if (adminControls) adminControls.innerHTML = '';
  } else {
    const T_COLORS = ['t0','t1','t2','t3'];
    const statusLabel = sorteio.status === 'confirmado'
      ? `<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:99px;padding:4px 12px;font-size:11px;color:#22c55e;margin-bottom:12px">● PARTIDA EM ANDAMENTO</div>`
      : '';

    const timesHTML = sorteioTimesArr.map((t, ti) => `
      <div class="team-card ${T_COLORS[ti]}" style="margin-bottom:8px">
        <div class="t-name"><div class="t-dot"></div>Time ${ti+1}</div>
        ${t.map(id => {
          const j = appData.jogadores.find(x=>x.id===id);
          return `<div class="t-player"><span>${j?.nome||id}</span></div>`;
        }).join('')}
      </div>`).join('');

    msg.innerHTML = statusLabel + timesHTML;
    stats.innerHTML = `<div style="font-size:10px;color:var(--t3);margin-top:4px">Sorteado em ${sorteio.data}</div>`;

    if (adminControls && isAdmin && sorteio.status === 'confirmado') {
      adminControls.innerHTML = `
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="flex:1;min-width:120px" onclick="abrirEdicaoTimes()">✏️ EDITAR TIMES</button>
          <button class="btn btn-danger" style="flex:1;min-width:120px" onclick="cancelarPartidaHome()">❌ CANCELAR</button>
          <button class="btn btn-gold" style="flex:1" onclick="concluirPartidaHome()">🏁 CONCLUIR</button>
        </div>`;
    } else if (adminControls) {
      adminControls.innerHTML = '';
    }
  }

  renderComunicados();
  renderPeladasHistorico();
  renderPresenca();
}

// ─── COMUNICADOS ─────────────────────────────────────────────
function renderComunicados() {
  const cont = document.getElementById('homeComunicados');
  if (!cont) return;
  const coms = appData.comunicados || [];
  if (!coms.length) { cont.innerHTML = ''; return; }
  const isAdmin = currentUser?.isAdmin;
  cont.innerHTML = `
    <div class="section-lbl" style="margin-top:16px">COMUNICADOS</div>
    ${coms.map(com => `
      <div class="card" style="margin-bottom:8px;border-left:3px solid var(--gold);padding-left:14px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="flex:1">
            <div style="font-family:'Oswald',sans-serif;font-size:13px;font-weight:600;color:var(--gold-lt);letter-spacing:1px;margin-bottom:4px">${com.titulo}</div>
            <div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap">${com.texto}</div>
            <div style="font-size:10px;color:var(--t3);margin-top:6px">${com.autor} · ${new Date(com.criadoEm).toLocaleDateString('pt-BR')}</div>
          </div>
          ${isAdmin ? `<button onclick="removerComunicado('${com.id}')" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:18px;line-height:1;flex-shrink:0">×</button>` : ''}
        </div>
      </div>`).join('')}`;
}

function abrirNovoComunicado() {
  if (!currentUser?.isAdmin) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'modalComunicado';
  overlay.innerHTML = `
    <div class="modal">
      <div class="mhandle"></div>
      <div class="m-title">NOVO COMUNICADO</div>
      <div class="m-sub">Visível para todos na home</div>
      <div class="field"><label>Título</label><input class="input" id="comTitulo" placeholder="Ex: Cancelamento do domingo" maxlength="60"></div>
      <div class="field"><label>Mensagem</label><textarea class="input" id="comTexto" rows="4" placeholder="Escreva o comunicado..." style="resize:none;height:auto"></textarea></div>
      <button class="btn btn-gold" onclick="salvarComunicado()">PUBLICAR</button>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalComunicado').remove()">CANCELAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function salvarComunicado() {
  const titulo = document.getElementById('comTitulo')?.value?.trim();
  const texto = document.getElementById('comTexto')?.value?.trim();
  if (!titulo || !texto) { showToast('Preencha título e mensagem'); return; }
  const id = 'com_' + Date.now();
  const com = { id, titulo, texto, autor: currentUser.nome, criadoEm: Date.now() };
  if (!appData.comunicados) appData.comunicados = [];
  appData.comunicados.unshift(com);
  await firestoreSet('comunicados', id, com);
  saveLocal();
  document.getElementById('modalComunicado')?.remove();
  renderComunicados();
  showToast('Comunicado publicado 📢');
}

async function removerComunicado(id) {
  if (!currentUser?.isAdmin) return;
  appData.comunicados = (appData.comunicados||[]).filter(c=>c.id!==id);
  await firestoreDelete('comunicados', id);
  saveLocal();
  renderComunicados();
  showToast('Comunicado removido');
}

// ─── PRESENÇA ─────────────────────────────────────────────────
const DESCRICAO_PELADA = `Pelada do Torneira
R. Juscelino Barbosa 254
11:30 às 13:00
Pix: mfnassif16@gmail.com`;

const REGRAS_PELADA = `• 1ª partida: 10 min, sem limite de gol (2 primeiros times completos)
• Demais partidas: 7 min ou 2 gols
• Mensalista: R$80/mês, prioridade até Sex 12h
• Avulso: R$25/pelada, pagar até Sáb 12h
• Falta sem aviso <24h: mensalista R$10 / avulso R$25
• Mensalidade em atraso: multa R$5/semana após 5º dia útil`;

function renderPresenca() {
  const cont = document.getElementById('homePresenca');
  if (!cont) return;
  const sorteio = appData.ultimoSorteio;
  // Presença aparece após resultado MVP da última pelada (ou se nunca houve pelada)
  const peladas = appData.peladasHist || [];
  const ultimaPelada = peladas.length > 0 ? [...peladas].sort((a,b)=>(b.savedAt||0)-(a.savedAt||0))[0] : null;
  const votacaoAberta = ultimaPelada?.votacao?.status === 'aberta';
  if (!sorteio || sorteio.status !== 'confirmado') { cont.innerHTML = ''; return; }
  if (votacaoAberta) {
    cont.innerHTML = `
      <div class="section-lbl" style="margin-top:16px">LISTA DE PRESENÇA</div>
      <div class="card" style="text-align:center;padding:20px;border-color:rgba(234,179,8,.2);background:rgba(234,179,8,.04)">
        <div style="font-size:24px;margin-bottom:8px">⏳</div>
        <div style="font-family:'Oswald',sans-serif;font-size:14px;letter-spacing:1px;color:var(--gold-lt)">AGUARDANDO RESULTADO MVP</div>
        <div style="font-size:11px;color:var(--t2);margin-top:6px">A lista de presença será liberada após a votação ser concluída</div>
      </div>`;
    return;
  }

  const presenca = appData.presenca || { confirmados: [], espera: [], data: sorteio.data };
  const confirmados = presenca.confirmados || [];
  const espera = presenca.espera || [];
  const total = confirmados.length;
  const vagas = total >= 20 ? 20 : 15;
  const vagasEspera = 5;
  const horario = total >= 20 ? '11:30 às 13:30' : '11:30 às 13:00';

  const now = Date.now();
  const peladaDate = parsePeladaDate(sorteio.data);
  const h24 = 24 * 60 * 60 * 1000;
  const dentro24h = peladaDate && (peladaDate - now) < h24;
  // Mensalista priority until Friday 12h before sunday pelada
  const sexta12h = peladaDate ? (peladaDate - (2*24*60*60*1000) + (12*60*60*1000) - (11.5*60*60*1000)) : null;
  // simpler: priority period ends Friday 12:00 = sunday 11:30 - ~47.5h
  const fimPrioridadeMensalista = peladaDate ? peladaDate - (47.5 * 60*60*1000) : null;
  const dentroPrioridade = fimPrioridadeMensalista && now < fimPrioridadeMensalista;
  const aposJanelaMensalista = !dentroPrioridade; // avulsos can confirm after friday 12h

  const userId = currentUser?.id;
  const jaConfirmado = confirmados.includes(userId);
  const naEspera = espera.includes(userId);
  const inadimplente = userId && !currentUser?.isGuest ? jogadorInadimplente(userId) : false;
  const ehMensalista = userId ? jogadorMensalista(userId) : false;
  const listaCheia = confirmados.length >= vagas;
  const esperaCheia = espera.length >= vagasEspera;

  // Can confirm: not guest, not inadimplente, has a spot or waiting list available
  const podeConfirmar = userId && !currentUser?.isGuest && !inadimplente && !jaConfirmado && !naEspera;

  // Build sorted name list
  const confirmadosNomes = confirmados.map(id => {
    const j = appData.jogadores.find(x => x.id === id);
    return { id, nome: j?.nome || id, mensalista: jogadorMensalista(id) };
  }).sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const esperaNomes = espera.map(id => {
    const j = appData.jogadores.find(x => x.id === id);
    return { id, nome: j?.nome || id };
  });

  const descricaoAtual = DESCRICAO_PELADA.replace('11:30 às 13:00', horario);

  cont.innerHTML = `
    <div class="section-lbl" style="margin-top:16px">LISTA DE PRESENÇA</div>
    <div class="card shield-card" style="margin-bottom:12px">
      <div style="white-space:pre-line;font-size:13px;color:var(--text);line-height:1.7;margin-bottom:14px;font-weight:500">${descricaoAtual}</div>

      ${confirmadosNomes.length > 0 ? `
      <div style="margin-bottom:10px">
        ${confirmadosNomes.map((p,i) => `
          <div style="font-size:13px;padding:3px 0;color:${p.id===userId?'var(--gold)':'var(--text)'};display:flex;align-items:center;gap:6px">
            <span style="color:var(--t2);min-width:18px">${i+1}.</span>
            <span>${p.nome}${p.mensalista?'<span style="font-size:9px;color:var(--gold);margin-left:4px">M</span>':''}</span>
            ${p.id===userId?'<span style="font-size:9px;color:var(--gold)">← você</span>':''}
          </div>`).join('')}
      </div>` : `<div style="font-size:12px;color:var(--t3);margin-bottom:10px">Nenhuma confirmação ainda</div>`}

      ${esperaNomes.length > 0 ? `
      <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
        <div style="font-size:10px;letter-spacing:1px;color:var(--t2);margin-bottom:6px">LISTA DE ESPERA</div>
        ${esperaNomes.map((p,i) => `
          <div style="font-size:12px;padding:2px 0;color:${p.id===userId?'var(--gold)':'var(--t2)'}">
            ${i+1}. ${p.nome}${p.id===userId?' ← você':''}
          </div>`).join('')}
      </div>` : ''}

      <div style="font-size:10px;color:var(--t3);margin-top:10px;margin-bottom:12px">${total}/${vagas} confirmados · ${espera.length}/${vagasEspera} espera</div>

      ${inadimplente ? `
        <div style="background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.3);border-radius:8px;padding:10px 12px;font-size:12px;color:#ef4444;margin-bottom:10px">
          ⚠️ Você possui pendências financeiras. Regularize para confirmar presença.
        </div>` : ''}

      ${jaConfirmado ? `
        <button class="btn btn-danger" onclick="desmarcarPresenca()" style="font-size:14px">
          ${dentro24h ? '❌ DESMARCAR (multa R$10)' : 'DESMARCAR'}
        </button>` :
       naEspera ? `
        <button class="btn btn-ghost" onclick="desmarcarPresenca()">SAIR DA LISTA DE ESPERA</button>` :
       podeConfirmar ? (
         listaCheia && !ehMensalista && dentro48h ? `
          <button class="btn btn-ghost" ${esperaCheia?'disabled':''} onclick="confirmarPresenca()">
            ${esperaCheia ? 'LISTA DE ESPERA CHEIA' : 'ENTRAR NA LISTA DE ESPERA'}
          </button>` :
         listaCheia && esperaCheia ? `
          <button class="btn btn-ghost" disabled>LISTA COMPLETA</button>` :
         `<button class="btn btn-gold" onclick="confirmarPresenca()">✅ CONFIRMAR PRESENÇA</button>`
       ) : (!userId || currentUser?.isGuest ? '' :
        `<button class="btn btn-ghost" disabled>CONFIRMAR PRESENÇA</button>`
       )}
    </div>`;
}

async function checkMensalidadeAtual() {
  // Mensalidades são geradas MANUALMENTE pelo admin
  // Não gera débitos automaticamente para evitar cobranças antes do prazo
  return;
}

async function checkAvulsosInadimplentes() {
  if (!appData.presenca?.confirmados) return;
  const sorteio = appData.ultimoSorteio;
  if (!sorteio) return;
  const peladaDate = parsePeladaDate(sorteio.data);
  if (!peladaDate) return;
  // Sábado 12h = domingo 11:30 - 23.5h
  const sab12h = peladaDate - (23.5 * 60 * 60 * 1000);
  if (Date.now() < sab12h) return; // not yet saturday 12h

  const presenca = appData.presenca;
  let changed = false;
  const removidos = [];

  for (const id of [...(presenca.confirmados||[])]) {
    if (jogadorMensalista(id)) continue;
    if (!jogadorInadimplente(id)) continue;
    // Avulso inadimplente after sab 12h — remove from list
    presenca.confirmados = presenca.confirmados.filter(x=>x!==id);
    removidos.push(id);
    changed = true;
  }

  if (changed) {
    // Promote from espera
    for (const removidoId of removidos) {
      if ((presenca.espera||[]).length > 0) {
        const promovido = presenca.espera[0];
        presenca.espera = presenca.espera.slice(1);
        presenca.confirmados.push(promovido);
        if (!jogadorMensalista(promovido)) {
          await adicionarDebito(promovido, 'avulso', 25, `Pelada ${sorteio.data} (promovido)`);
        }
      }
    }
    appData.presenca = presenca;
    await firestoreSet('config', 'presenca', presenca);
    saveLocal();
  }
}

function parsePeladaDate(dateStr) {
  if (!dateStr) return null;
  // dd/mm/yyyy
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  return new Date(+parts[2], +parts[1]-1, +parts[0], 11, 30).getTime();
}

async function confirmarPresenca() {
  if (!currentUser || currentUser.isGuest) { showToast('Faça login para confirmar'); return; }
  if (jogadorInadimplente(currentUser.id)) { showToast('Regularize suas pendências financeiras'); return; }

  const sorteio = appData.ultimoSorteio;
  if (!sorteio) return;

  const presenca = appData.presenca || { confirmados: [], espera: [], data: sorteio.data };
  const confirmados = presenca.confirmados || [];
  const espera = presenca.espera || [];

  if (confirmados.includes(currentUser.id) || espera.includes(currentUser.id)) {
    showToast('Você já está na lista'); return;
  }

  const now = Date.now();
  const peladaDate = parsePeladaDate(sorteio.data);
  const h48 = 48 * 60 * 60 * 1000;
  const dentro48h = peladaDate && (peladaDate - now) < h48;
  const vagas = confirmados.length >= 20 ? 20 : 15;
  const listaCheia = confirmados.length >= vagas;
  const ehMensalista = jogadorMensalista(currentUser.id);

  if (listaCheia) {
    // During priority window: only mensalistas can confirm
    if (dentroPrioridade && !ehMensalista) {
      showToast('⏳ Lista reservada para mensalistas até Sex 12h');
      return;
    }
    // Mensalista after priority window can displace last avulso confirmed
    if (ehMensalista && aposJanelaMensalista) {
      const ultimoAvulso = [...confirmados].reverse().find(id => !jogadorMensalista(id));
      if (ultimoAvulso) {
        presenca.confirmados = confirmados.filter(id => id !== ultimoAvulso);
        if (!presenca.espera) presenca.espera = [];
        presenca.espera.unshift(ultimoAvulso);
        presenca.confirmados.push(currentUser.id);
        showToast('Vaga garantida como mensalista ✅');
      } else {
        if (espera.length >= 5) { showToast('Lista de espera cheia'); return; }
        presenca.espera.push(currentUser.id);
        showToast('Adicionado à lista de espera');
      }
    } else {
      if (espera.length >= 5) { showToast('Lista de espera cheia'); return; }
      presenca.espera = [...espera, currentUser.id];
      showToast('Adicionado à lista de espera');
    }
  } else {
    // During priority window: only mensalistas
    if (dentroPrioridade && !ehMensalista) {
      showToast('⏳ Lista reservada para mensalistas até Sex 12h');
      return;
    }
    presenca.confirmados = [...confirmados, currentUser.id];
    // Avulso: register R$25 debt — must pay by saturday 12h
    if (!ehMensalista) {
      const sab12h = peladaDate ? new Date(peladaDate - (24*60*60*1000)).setHours(12,0,0,0) : null;
      const sab12hStr = sab12h ? new Date(sab12h).toLocaleString('pt-BR') : 'Sáb 12h';
      await adicionarDebito(currentUser.id, 'avulso', 25, `Pelada ${sorteio.data} (pagar até ${sab12hStr})`);
    }
    showToast('Presença confirmada! ✅');
  }

  appData.presenca = presenca;
  await firestoreSet('config', 'presenca', presenca);
  saveLocal();
  renderPresenca();
}

async function desmarcarPresenca() {
  if (!currentUser) return;
  const presenca = appData.presenca;
  if (!presenca) return;

  const now = Date.now();
  const peladaDate = parsePeladaDate(presenca.data || appData.ultimoSorteio?.data);
  const h24 = 24 * 60 * 60 * 1000;
  const dentro24h = peladaDate && (peladaDate - now) < h24;

  const naEspera = (presenca.espera||[]).includes(currentUser.id);

  if (!naEspera && dentro24h) {
    const ehMens = jogadorMensalista(currentUser.id);
    const multaValor = ehMens ? 10 : 25;
    const msg = ehMens ? 'R$10 (mensalista)' : 'R$25 (avulso)';
    if (!confirm(`Desmarcar com menos de 24h gera multa de ${msg}. Confirmar?`)) return;
    await adicionarDebito(currentUser.id, 'multa', multaValor, `Desmarcou com <24h — Pelada ${appData.presenca?.data||''}`);
  }

  if (naEspera) {
    presenca.espera = presenca.espera.filter(id => id !== currentUser.id);
  } else {
    presenca.confirmados = (presenca.confirmados||[]).filter(id => id !== currentUser.id);
    // Promote first from espera
    if ((presenca.espera||[]).length > 0) {
      const promovido = presenca.espera[0];
      presenca.espera = presenca.espera.slice(1);
      presenca.confirmados.push(promovido);
      // Avulso promovido recebe débito R$25
      if (!jogadorMensalista(promovido)) {
        const sorteioData = appData.ultimoSorteio?.data;
        await adicionarDebito(promovido, 'avulso', 25, `Pelada ${sorteioData} (promovido da espera)`);
      }
      showToast('Vaga aberta — próximo da espera foi promovido');
    }
    // Remove avulso debt if cancelling with >24h
    if (!naEspera && !dentro24h && !jogadorMensalista(currentUser.id)) {
      const fin = getFinancasJogador(currentUser.id);
      // Remove last avulso debt for this pelada
      if (fin.debitos) {
        const sorteioData = appData.ultimoSorteio?.data;
        const idx = [...fin.debitos].reverse().findIndex(d => d.tipo==='avulso' && d.descricao?.includes(sorteioData));
        if (idx >= 0) {
          fin.debitos.splice(fin.debitos.length-1-idx, 1);
          await firestoreSet('financas', currentUser.id, fin);
        }
      }
    }
  }

  appData.presenca = presenca;
  await firestoreSet('config', 'presenca', presenca);
  saveLocal();
  renderPresenca();
  if (!naEspera && !dentro24h) showToast('Presença desmarcada');
}

// ─── HISTÓRICO DE PELADAS NA HOME ────────────────────────────
function renderPeladasHistorico() {
  const container = document.getElementById('homePeladasHist');
  if (!container) return;
  const isAdmin = currentUser?.isAdmin;

  // Collect all unique dates from players' domingos
  const datasSet = new Set();
  for (const j of appData.jogadores) {
    for (const d of (j.domingos||[])) {
      if (d.data) datasSet.add(d.data);
    }
  }
  // Also include dates from peladasHist that might not be in jogadores yet
  for (const p of (appData.peladasHist||[])) {
    if (p.data) datasSet.add(p.data);
  }

  if (!datasSet.size) { container.innerHTML = ''; return; }

  // Sort dates descending (dd/mm/yyyy format)
  const parseDMY = s => { const [d,m,y] = s.split('/'); return new Date(+y,+m-1,+d).getTime(); };
  const datas = [...datasSet].sort((a,b) => parseDMY(b) - parseDMY(a));

  // Deduplicate peladasHist by id
  const histSeen = new Set();
  const histUnique = (appData.peladasHist||[]).filter(p => {
    if (!p.id || histSeen.has(p.id)) return false;
    histSeen.add(p.id); return true;
  });

  container.innerHTML = `
    <div class="section-lbl" style="margin-top:16px">PELADAS ANTERIORES</div>
    ${datas.map(data => {
      // Find matching peladaHist record for this date
      const p = histUnique.find(x => x.data === data);
      const votAberta = p?.votacao?.status === 'aberta';
      const podeVotar = votAberta && currentUser && !currentUser.isGuest
        && p.votacao?.elegiveisVotar?.includes(currentUser.id)
        && !p.votacao?.votos?.[currentUser.id];
      const totalVotos = Object.keys(p?.votacao?.votos||{}).length;
      const totalEleg = p?.votacao?.elegiveisVotar?.length||0;
      const mvpNome = p?.mvp?.nome || (votAberta ? '...' : '—');
      // Count players who played this date (from jogadores' domingos)
      const jogadoresNaData = appData.jogadores.filter(j =>
        (j.domingos||[]).some(d => d.data === data && !d.ausente)
      ).length;

      const clickFn = p ? `openPeladaDetalhe('${p.id}')` : `openPeladaDetalheByData('${data}')`;
      return `
      <div class="pelada-hist-card" onclick="${clickFn}" style="cursor:pointer;${podeVotar?'border-color:rgba(234,179,8,.5);':''}">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:18px">${podeVotar?'⭐':'🏆'}</div>
          <div style="flex:1">
            <div style="font-family:'Oswald',sans-serif;font-size:14px;font-weight:700;letter-spacing:1px;color:var(--gold-lt)">PELADA DO TORNEIRA ${data}</div>
            <div style="font-size:11px;color:var(--t2);margin-top:2px">
              ${jogadoresNaData} jogadores
              ${p ? ` · ${votAberta
                ? `<span style="color:#eab308">⏳ Votação: ${totalVotos}/${totalEleg}</span>`
                : `MVP: ${mvpNome}`}` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${isAdmin && p && votAberta ? `<button onclick="event.stopPropagation();encerrarVotacaoForce('${p.id}')" style="background:rgba(234,179,8,.15);border:1px solid rgba(234,179,8,.3);border-radius:8px;color:#eab308;font-size:11px;padding:4px 10px;cursor:pointer;font-family:'DM Sans',sans-serif">⚡ MVP</button>` : ''}
            ${isAdmin && p ? `<button onclick="event.stopPropagation();excluirPelada('${p.id}')" style="background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);border-radius:8px;color:#ef4444;font-size:11px;padding:4px 10px;cursor:pointer;font-family:'DM Sans',sans-serif">🗑️</button>` : ''}
            ${isAdmin && !p ? `<button onclick="event.stopPropagation();excluirPeladaPorData('${data}')" style="background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);border-radius:8px;color:#ef4444;font-size:11px;padding:4px 10px;cursor:pointer;font-family:'DM Sans',sans-serif">🗑️</button>` : ''}
            <div style="color:${podeVotar?'#eab308':'var(--t3)'};font-size:16px">${podeVotar?'VOTAR':'›'}</div>
          </div>
        </div>
      </div>`;
    }).join('')}`;
}

// ─── DETALHE DA PELADA ────────────────────────────────────────
function openPeladaDetalhe(peladaId) {
  const p = (appData.peladasHist||[]).find(x=>x.id===peladaId);
  if (!p) return;

  const v = p.votacao;
  const meuVoto = v?.votos?.[currentUser?.id];
  const jaVotou = !!meuVoto;
  const podeVotar = currentUser && !currentUser.isGuest
    && v?.status === 'aberta'
    && v?.elegiveisVotar?.includes(currentUser.id)
    && !jaVotou
    && !v?.nominees?.find(n => n.id === currentUser.id); // nominees cannot vote for themselves... actually they can for others
  // Actually: nominees CAN vote, just not for themselves (handled in votarMvp)
  const podeVotarFinal = currentUser && !currentUser.isGuest
    && v?.status === 'aberta'
    && v?.elegiveisVotar?.includes(currentUser.id)
    && !jaVotou;

  // Time remaining
  let tempoHTML = '';
  if (v?.status === 'aberta') {
    const remaining = Math.max(0, v.elapsesAt - Date.now());
    const horas = Math.floor(remaining / 3600000);
    const min = Math.floor((remaining % 3600000) / 60000);
    const totalVotos = Object.keys(v.votos||{}).length;
    const totalEleg = v.elegiveisVotar?.length || 0;
    tempoHTML = `<div style="background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.25);border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#eab308;font-weight:600;margin-bottom:6px">⏳ VOTAÇÃO MVP ABERTA</div>
      <div style="font-size:12px;color:var(--t2)">Encerra em <strong style="color:var(--text)">${horas}h ${min}min</strong> · ${totalVotos}/${totalEleg} votos</div>
      ${currentUser?.isAdmin ? `<button onclick="encerrarVotacaoForce('${p.id}')" style="margin-top:8px;background:rgba(234,179,8,.15);border:1px solid rgba(234,179,8,.3);border-radius:8px;color:#eab308;font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:1px;padding:6px 14px;cursor:pointer;width:100%">⚡ ENCERRAR VOTAÇÃO AGORA</button>` : ''}
    </div>`;
  }

  // Voting UI
  let votacaoHTML = '';
  if (v && v.nominees?.length > 0) {
    if (v.status === 'encerrada' || p.mvp) {
      // Show result
      const contagem = {};
      for (const vt of Object.values(v.votos||{})) contagem[vt] = (contagem[vt]||0)+1;
      votacaoHTML = `
        <div class="section-lbl">VOTAÇÃO MVP</div>
        ${v.nominees.map(n => {
          const votos = contagem[n.id]||0;
          const isWinner = p.mvp?.id === n.id;
          return `<div style="background:${isWinner?'rgba(201,168,76,.1)':'var(--s2)'};border:1px solid ${isWinner?'var(--border-gold)':'var(--border)'};border-radius:10px;padding:11px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px">
            <div style="font-size:20px">${isWinner?'⭐':'👤'}</div>
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px;color:${isWinner?'var(--gold-lt)':'var(--text)'}">${n.nome}${isWinner?' <span style="font-size:10px;color:var(--gold)">MVP</span>':''}</div>
              <div style="font-size:11px;color:var(--t2)">Score ${n.scoreDia.toFixed(2)} · ⚽${n.gols} 🎯${n.assists} 🏆${n.vitorias}</div>
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:16px;color:${isWinner?'var(--gold)':'var(--t2)'};">${votos} voto${votos!==1?'s':''}</div>
          </div>`;
        }).join('')}`;
    } else if (v.status === 'aberta') {
      // Show voting buttons if eligible
      if (podeVotarFinal) {
        votacaoHTML = `
          <div class="section-lbl">VOTE NO MVP</div>
          <div style="font-size:12px;color:var(--t2);margin-bottom:12px">Quem foi o melhor dessa pelada?</div>
          ${v.nominees.map(n => {
            const isSelf = n.id === currentUser?.id;
            return `<div style="background:var(--s2);border:1px solid var(--border-gold);border-radius:10px;padding:11px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px">
              <div style="flex:1">
                <div style="font-weight:600;font-size:14px">${n.nome}${isSelf?' <span style="font-size:10px;color:var(--t2)">(você)</span>':''}</div>
                <div style="font-size:11px;color:var(--t2)">Score ${n.scoreDia.toFixed(2)} · ⚽${n.gols} 🎯${n.assists} 🏆${n.vitorias}</div>
              </div>
              ${isSelf
                ? `<div style="font-size:11px;color:var(--t3);font-style:italic">Não pode votar em si</div>`
                : `<button class="btn btn-gold" style="width:auto;padding:8px 16px;font-size:13px" onclick="votarMvp('${p.id}','${n.id}')">VOTAR</button>`
              }
            </div>`;
          }).join('')}`;
      } else if (jaVotou) {
        const nomineeVotado = v.nominees.find(n=>n.id===meuVoto);
        votacaoHTML = `
          <div class="section-lbl">VOTAÇÃO MVP</div>
          <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;font-size:13px;color:var(--t2)">
            ✅ Você votou em <strong style="color:var(--text)">${nomineeVotado?.nome||meuVoto}</strong>. Aguardando demais votantes.
          </div>
          ${v.nominees.map(n => `
            <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:10px">
              <div style="flex:1"><div style="font-weight:600;font-size:13px">${n.nome}</div>
              <div style="font-size:11px;color:var(--t2)">Score ${n.scoreDia.toFixed(2)} · ⚽${n.gols} 🎯${n.assists} 🏆${n.vitorias}</div></div>
              ${meuVoto===n.id?'<div style="color:var(--gold);font-size:12px">✅ Seu voto</div>':''}
            </div>`).join('')}`;
      } else {
        // Not eligible to vote
        const totalVotos = Object.keys(v.votos||{}).length;
        const totalEleg = v.elegiveisVotar?.length || 0;
        votacaoHTML = `
          <div class="section-lbl">VOTAÇÃO MVP</div>
          <div style="font-size:12px;color:var(--t2);margin-bottom:10px">Votação em andamento (${totalVotos}/${totalEleg}). Candidatos:</div>
          ${v.nominees.map(n => `
            <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:6px">
              <div style="font-weight:600;font-size:13px">${n.nome}</div>
              <div style="font-size:11px;color:var(--t2)">Score ${n.scoreDia.toFixed(2)} · ⚽${n.gols} 🎯${n.assists} 🏆${n.vitorias}</div>
            </div>`).join('')}`;
      }
    }
  }

  // Podium block
  let podioHTML = '';
  if (p.podio) {
    const medals = ['🥇','🥈','🥉'];
    const lugares = [p.podio.primeiro, p.podio.segundo, p.podio.terceiro];
    podioHTML = `<div class="section-lbl" style="margin-top:14px">PÓDIO DO DIA</div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        ${lugares.map((pl,i) => pl ? `
          <div style="flex:1;background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 8px;text-align:center">
            <div style="font-size:22px">${medals[i]}</div>
            <div style="font-size:11px;font-weight:600;margin-top:4px;color:var(--text)">${pl.nome}</div>
            <div style="font-size:10px;color:var(--t2);margin-top:2px">${pl.scoreDia.toFixed(2)}</div>
          </div>` : '').join('')}
      </div>`;
  }

  // Full stats table
  const rows = (p.jogadores||[])
    .filter(j => !j.ausente)
    .sort((a,b) => b.scoreDia - a.scoreDia)
    .map((j,i) => {
      const isMvp = p.mvp?.id === j.id;
      const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
      return `
      <div class="prow rank-row" style="${isMvp?'border-color:var(--gold);background:rgba(201,168,76,.06)':''}">
        <div class="rank-row-top">
          <div class="rank-n ${i===0?'g':i===1?'s':i===2?'b':''}">${medal}</div>
          <div class="rank-name-col">
            <div class="p-name">${j.nome}${isMvp?' <span style="background:linear-gradient(135deg,var(--gold),var(--gold-lt));color:#000;font-size:9px;padding:2px 8px;border-radius:99px;font-family:Oswald,sans-serif;letter-spacing:1px;margin-left:5px">MVP ⭐</span>':''}</div>
          </div>
        </div>
        <div class="rank-stats-row">
          <div class="rank-stat"><div class="rs-v">${j.scoreDia.toFixed(2)}</div><div class="rs-l">Score</div></div>
          <div class="rank-stat"><div class="rs-v">${j.gols}</div><div class="rs-l">⚽</div></div>
          <div class="rank-stat"><div class="rs-v">${j.assists}</div><div class="rs-l">🎯</div></div>
          <div class="rank-stat"><div class="rs-v">${j.vitorias}</div><div class="rs-l">🏆</div></div>
        </div>
      </div>`;
    }).join('');

  // Build reactions HTML for each player
  const reacoes = p.reacoes || {};
  const rowsComReacoes = (p.jogadores||[])
    .filter(j => !j.ausente)
    .sort((a,b) => b.scoreDia - a.scoreDia)
    .map((j,i) => {
      const isMvp = p.mvp?.id === j.id;
      const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
      const minhasReacoes = reacoes[j.id] || {};
      const emojisBtns = ['🔥','👑','💀','🎯','⚽','😂','👏','💪','🌈','💩'].map(em => {
        const count = Object.values(minhasReacoes).filter(r=>r===em).length;
        const minha = currentUser && minhasReacoes[currentUser.id] === em;
        return `<button onclick="reagir('${p.id}','${j.id}','${em}')" style="background:${minha?'rgba(201,168,76,.2)':'rgba(255,255,255,.05)'};border:1px solid ${minha?'var(--border-gold)':'rgba(255,255,255,.08)'};border-radius:99px;padding:3px 8px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:3px;color:var(--text)">${em}${count>0?`<span style="font-size:10px;color:var(--t2)">${count}</span>`:''}</button>`;
      }).join('');
      return `
      <div class="prow rank-row" style="${isMvp?'border-color:var(--gold);background:rgba(201,168,76,.06)':''}">
        <div class="rank-row-top">
          <div class="rank-n ${i===0?'g':i===1?'s':i===2?'b':''}">${medal}</div>
          <div class="rank-name-col">
            <div class="p-name">${j.nome}${isMvp?' <span style="background:linear-gradient(135deg,var(--gold),var(--gold-lt));color:#000;font-size:9px;padding:2px 8px;border-radius:99px;font-family:Oswald,sans-serif;letter-spacing:1px;margin-left:5px">MVP ⭐</span>':''}</div>
          </div>
        </div>
        <div class="rank-stats-row">
          <div class="rank-stat"><div class="rs-v">${j.scoreDia.toFixed(2)}</div><div class="rs-l">Score</div></div>
          <div class="rank-stat"><div class="rs-v">${j.gols}</div><div class="rs-l">⚽</div></div>
          <div class="rank-stat"><div class="rs-v">${j.assists}</div><div class="rs-l">🎯</div></div>
          <div class="rank-stat"><div class="rs-v">${j.vitorias}</div><div class="rs-l">🏆</div></div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.05)">
          ${emojisBtns}
        </div>
      </div>`;
    }).join('');

  document.getElementById('peladaDetalheTitle').textContent = `PELADA ${p.data}`;
  // Add delete button for admins
  const delBtn = document.getElementById('btnExcluirPelada');
  if (delBtn) delBtn.style.display = currentUser?.isAdmin ? 'block' : 'none';
  if (delBtn) delBtn.onclick = () => excluirPelada(p.id);
  document.getElementById('peladaDetalheMvp').innerHTML = tempoHTML + podioHTML + votacaoHTML;
  document.getElementById('peladaDetalheList').innerHTML = `<div class="section-lbl" style="margin-top:4px">ESTATÍSTICAS COMPLETAS</div>` + rowsComReacoes;
  openModal('modalPeladaDetalhe');
}
window.openPeladaDetalhe = openPeladaDetalhe;
// ─── DETALHE POR DATA (sem peladaHist) ───────────────────────
function openPeladaDetalheByData(data) {
  // If there's a peladasHist record for this date, use the full detail view
  const pHist = (appData.peladasHist||[]).find(x => x.data === data);
  if (pHist) { openPeladaDetalhe(pHist.id); return; }

  // Otherwise build from jogadores' domingos (manually inserted data)
  const jogadoresNaData = appData.jogadores
    .map(j => {
      const dom = (j.domingos||[]).find(d => d.data === data);
      if (!dom || dom.ausente) return null;
      const scoreDia = (dom.gols||0) + (dom.assists||0) + 0.75*(dom.vitorias||0);
      return { id: j.id, nome: j.nome, gols: dom.gols||0, assists: dom.assists||0, vitorias: dom.vitorias||0, scoreDia };
    })
    .filter(Boolean)
    .sort((a,b) => b.scoreDia - a.scoreDia);

  if (!jogadoresNaData.length) { showToast('Nenhuma estatística encontrada para esta data'); return; }

  const rowsHTML = jogadoresNaData.map((j, i) => {
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
    return `
    <div class="prow rank-row">
      <div class="rank-row-top">
        <div class="rank-n ${i===0?'g':i===1?'s':i===2?'b':''}">${medal}</div>
        <div class="rank-name-col"><div class="p-name">${j.nome}</div></div>
      </div>
      <div class="rank-stats-row">
        <div class="rank-stat"><div class="rs-v">${j.scoreDia.toFixed(2)}</div><div class="rs-l">Score</div></div>
        <div class="rank-stat"><div class="rs-v">${j.gols}</div><div class="rs-l">⚽</div></div>
        <div class="rank-stat"><div class="rs-v">${j.assists}</div><div class="rs-l">🎯</div></div>
        <div class="rank-stat"><div class="rs-v">${j.vitorias}</div><div class="rs-l">🏆</div></div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('peladaDetalheTitle').textContent = `PELADA ${data}`;
  const delBtn = document.getElementById('btnExcluirPelada');
  if (delBtn) {
    delBtn.style.display = currentUser?.isAdmin ? 'block' : 'none';
    delBtn.onclick = () => excluirPeladaPorData(data);
  }
  document.getElementById('peladaDetalheMvp').innerHTML = '';
  document.getElementById('peladaDetalheList').innerHTML =
    `<div class="section-lbl" style="margin-top:4px">ESTATÍSTICAS COMPLETAS</div>` + rowsHTML;
  openModal('modalPeladaDetalhe');
}
window.openPeladaDetalheByData = openPeladaDetalheByData;

async function excluirPeladaPorData(data) {
  if (!currentUser?.isAdmin) return;
  const jogadoresComData = appData.jogadores.filter(j => (j.domingos||[]).some(d => d.data === data));
  if (!confirm(`Excluir pelada de ${data}? Remove estatísticas de ${jogadoresComData.length} jogadores.`)) return;
  if (!confirm('Tem certeza? Esta ação não pode ser desfeita.')) return;
  for (const j of jogadoresComData) {
    j.domingos = (j.domingos||[]).filter(d => d.data !== data);
    await firestoreSet('jogadores', j.id, j);
  }
  closeModal('modalPeladaDetalhe');
  renderPeladasHistorico();
  showToast(`Pelada de ${data} excluída`);
}
window.excluirPeladaPorData = excluirPeladaPorData;


async function excluirPelada(peladaId) {
  if (!currentUser?.isAdmin) return;
  const p = (appData.peladasHist||[]).find(x=>x.id===peladaId);
  if (!p) return;
  if (!confirm(`Excluir pelada de ${p.data}? As estatísticas dos jogadores serão removidas.`)) return;
  if (!confirm('Tem certeza? Esta ação não pode ser desfeita.')) return;

  // Remove stats from each player
  for (const jp of (p.jogadores||[])) {
    const j = appData.jogadores.find(x=>x.id===jp.id);
    if (!j) continue;
    // Remove the domingo entry matching this pelada's date
    const before = j.domingos?.length || 0;
    j.domingos = (j.domingos||[]).filter(d => d.data !== p.data);
    // Also remove mvp flag if this was the MVP pelada
    if (p.mvp?.id === j.id && j.mvps > 0) j.mvps--;
    if (j.domingos.length !== before) {
      await firestoreSet('jogadores', j.id, j);
    }
  }

  // Delete pelada from Firebase
  await firestoreDelete('peladasHist', peladaId);
  appData.peladasHist = (appData.peladasHist||[]).filter(x=>x.id!==peladaId);
  saveLocal();
  closeModal('modalPeladaDetalhe');
  renderPeladasHistorico();
  showToast('Pelada excluída e estatísticas removidas');
}
window.excluirPelada = excluirPelada;

async function reagir(peladaId, jogadorId, emoji) {
  if (!currentUser || currentUser.isGuest) { showToast('Faça login para reagir'); return; }
  const p = (appData.peladasHist||[]).find(x=>x.id===peladaId);
  if (!p) return;
  if (!p.reacoes) p.reacoes = {};
  if (!p.reacoes[jogadorId]) p.reacoes[jogadorId] = {};
  // Toggle: se já reagiu com esse emoji, remove; senão, troca/adiciona
  if (p.reacoes[jogadorId][currentUser.id] === emoji) {
    delete p.reacoes[jogadorId][currentUser.id];
  } else {
    p.reacoes[jogadorId][currentUser.id] = emoji;
  }
  await firestoreSet('peladasHist', peladaId, p);
  const idx = (appData.peladasHist||[]).findIndex(x=>x.id===peladaId);
  if (idx>=0) appData.peladasHist[idx] = p;
  saveLocal();
  openPeladaDetalhe(peladaId); // re-render
}
window.reagir = reagir;
// ─── JOGADORES ───────────────────────────────────────────────
function renderJogs() {
  const list=document.getElementById('jogList');
  const ct=document.getElementById('jogCount');
  const n=appData.jogadores.length;
  ct.textContent=`${n} jogador${n!==1?'es':''} cadastrado${n!==1?'s':''}`;
  if(!n){list.innerHTML=`<div class="empty"><div class="empty-ico">⚽</div><div class="empty-txt">Nenhum jogador ainda.<br>Admins podem cadastrar jogadores.</div></div>`;return;}
  const idxMap=Object.fromEntries(calcIdx(appData.jogadores).map(i=>[i.id,i]));
  list.innerHTML=appData.jogadores.map(j=>{
    const ix=idxMap[j.id], nd=nDom(j);
    const isAdm=(appData.admins||[]).includes(j.id);
    const ifStr=nd>0?ix?.IF.toFixed(2):null;
    const isOnline = currentUser?.id === j.id;
    return `
    <div class="prow" onclick="openPerfil('${j.id}')">
      <div class="p-avatar" style="${j.foto?'padding:0;overflow:hidden':''}${isOnline?';border-color:var(--gold)':''}">
        ${j.foto?`<img src="${j.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:j.nome[0].toUpperCase()}
      </div>
      <div class="p-info">
        <div class="p-name">${j.nome}${isAdm?'<span class="badge-adm">ADMIN</span>':''}</div>
        <div class="p-meta">Nota: ${j.nota?.toFixed(1)} · ${nd} domingo${nd!==1?'s':''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:7px">
        <div class="${ifStr?'p-if':'p-if empty'}">${ifStr||'—'}</div>
        ${currentUser?.isAdmin?`
          <button class="icon-btn" onclick="event.stopPropagation();openCadastro('${j.id}')">✏️</button>
          <button class="icon-btn danger" onclick="event.stopPropagation();removerJog('${j.id}')">🗑️</button>
        `:''}
      </div>
    </div>`;
  }).join('');
}

function openCadastro(id=null) {
  document.getElementById('cadastroTitle').textContent=id?'EDITAR JOGADOR':'CADASTRAR JOGADOR';
  document.getElementById('inpNome').value='';
  document.getElementById('inpNota').value='';
  document.getElementById('editId').value=id||'';
  if(id){const j=appData.jogadores.find(x=>x.id===id);if(j){document.getElementById('inpNome').value=j.nome;document.getElementById('inpNota').value=j.nota?.toFixed(1);const sel=document.getElementById('inpTipo');if(sel)sel.value=j.tipoJogador||'avulso';}}
  openModal('modalCadastro');
}

async function salvarJogador() {
  if(!currentUser?.isAdmin){showToast('Sem permissão');return;}
  const nome=document.getElementById('inpNome').value.trim();
  const notaVal=parseFloat(document.getElementById('inpNota').value);
  const editId=document.getElementById('editId').value;
  if(!nome){showToast('Digite um nome');return;}
  if(isNaN(notaVal)||notaVal<0||notaVal>10){showToast('Nota deve ser 0–10');return;}
  const nota=+notaVal.toFixed(1);
  const tipo = document.getElementById('inpTipo')?.value || 'avulso';
  if(editId){
    const j=appData.jogadores.find(x=>x.id===editId);
    if(j){j.nome=nome;j.nota=nota;j.tipoJogador=tipo;await firestoreSet('jogadores',editId,j);}
  } else {
    // Check mensalista limit
    if (tipo==='mensalista' && appData.jogadores.filter(j=>j.tipoJogador==='mensalista').length >= 15) {
      showToast('Limite de 15 mensalistas atingido'); return;
    }
    const id='p'+Date.now();
    const nj={id,nome,nota,tipoJogador:tipo,domingos:[],criadoEm:Date.now()};
    appData.jogadores.push(nj);
    await firestoreSet('jogadores',id,nj);
  }
  saveLocal(); closeModal('modalCadastro'); renderJogs();
  showToast(editId?'Jogador atualizado':'Jogador cadastrado! ✅');
}

async function removerJog(id) {
  if(!currentUser?.isAdmin) return;
  const j=appData.jogadores.find(x=>x.id===id);
  if(!confirm(`Remover ${j?.nome}? Todos os dados serão perdidos.`)) return;
  appData.jogadores=appData.jogadores.filter(x=>x.id!==id);
  // Remove restricoes involving this player from Firestore too
  const restParaRemover = appData.restricoes.filter(r=>r.p1===id||r.p2===id);
  appData.restricoes=appData.restricoes.filter(r=>r.p1!==id&&r.p2!==id);
  await firestoreDelete('jogadores',id);
  await Promise.all(restParaRemover.map(r=>firestoreDelete('restricoes',r.id)));
  // Also remove from admins if applicable
  if ((appData.admins||[]).includes(id)) {
    appData.admins = appData.admins.filter(a=>a!==id);
    await firestoreSet('config','admins',{list:appData.admins});
  }
  saveLocal(); renderJogs(); showToast('Jogador removido');
}

// ─── RANKING ─────────────────────────────────────────────────
let rankStat = 'IF';
let rankDir  = 'desc';

function setRankStat(v) {
  rankStat = v;
  document.querySelectorAll('.rank-chip').forEach(c => c.classList.toggle('sel', c.dataset.v === v));
  renderRankList();
}
function setRankDir(v) {
  rankDir = v;
  document.querySelectorAll('.rank-dir').forEach(c => c.classList.toggle('sel', c.dataset.v === v));
  renderRankList();
}

function renderRanking() {
  document.querySelectorAll('.rank-chip').forEach(c => c.classList.toggle('sel', c.dataset.v === rankStat));
  document.querySelectorAll('.rank-dir').forEach(c  => c.classList.toggle('sel', c.dataset.v === rankDir));
  renderRankList();
}

function renderRankList() {
  const list = document.getElementById('rankList');
  if (!appData.jogadores.length) {
    list.innerHTML = `<div class="empty"><div class="empty-ico">🏆</div><div class="empty-txt">Nenhum jogador ainda.</div></div>`;
    return;
  }

  const idxArr = calcIdx(appData.jogadores);
  const idxMap = Object.fromEntries(idxArr.map(x => [x.id, x]));

  const rows = appData.jogadores.map(j => {
    const ix = idxMap[j.id];
    const nd = nDom(j);
    const tg = j.domingos.reduce((s,d) => s + (d.gols||0),    0);
    const ta = j.domingos.reduce((s,d) => s + (d.assists||0),  0);
    const tv = j.domingos.reduce((s,d) => s + (d.vitorias||0), 0);
    return { j, ix, nd, tg, ta, tv,
      IF:   (nd > 0 && ix) ? ix.IF   : -1,
      nota: j.nota ?? 0
    };
  });

  const mul = rankDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    let va, vb;
    switch (rankStat) {
      case 'IF':       va = a.IF;   vb = b.IF;   break;
      case 'nota':     va = a.nota; vb = b.nota; break;
      case 'gols':     va = a.tg;   vb = b.tg;   break;
      case 'assists':  va = a.ta;   vb = b.ta;   break;
      case 'vitorias': va = a.tv;   vb = b.tv;   break;
      case 'domingos': va = a.nd;   vb = b.nd;   break;
      case 'mvps':     va = a.j.mvps||0; vb = b.j.mvps||0; break;
      default:         va = a.IF;   vb = b.IF;
    }
    return mul * (va - vb);
  });

  list.innerHTML = rows.map((r, i) => {
    const { j, ix, nd, tg, ta, tv } = r;
    const isAdm = (appData.admins || []).includes(j.id);
    const medal = rankDir === 'desc'
      ? (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`)
      : `#${i+1}`;
    const cl = (rankDir==='desc') ? (i===0?'g':i===1?'s':i===2?'b':'') : '';

    const IF_str  = nd > 0 && ix ? ix.IF.toFixed(2)  : '—';
    const nota_str = j.nota?.toFixed(1) ?? '—';
    const mvps = j.mvps || 0;

    return `<div class="prow rank-row" onclick="openPerfil('${j.id}')">
      <div class="rank-row-top">
        <div class="rank-n ${cl}">${medal}</div>
        <div class="rank-name-col">
          <div class="p-name">${j.nome}${isAdm ? '<span class="badge-adm">ADM</span>' : ''}${mvps>0?`<span style="background:linear-gradient(135deg,var(--gold),var(--gold-lt));color:#000;font-size:8px;padding:1px 6px;border-radius:99px;font-family:Oswald,sans-serif;letter-spacing:1px;margin-left:5px">⭐${mvps}</span>`:''}
          </div>
        </div>
      </div>
      <div class="rank-stats-row">
        <div class="rank-stat ${rankStat==='nota'     ?'hl':''}"><div class="rs-v">${nota_str}</div><div class="rs-l">Nota</div></div>
        <div class="rank-stat ${rankStat==='IF'       ?'hl':''}"><div class="rs-v">${IF_str}</div><div class="rs-l">Rating</div></div>
        <div class="rank-stat ${rankStat==='gols'     ?'hl':''}"><div class="rs-v">${tg}</div><div class="rs-l">⚽</div></div>
        <div class="rank-stat ${rankStat==='assists'  ?'hl':''}"><div class="rs-v">${ta}</div><div class="rs-l">🎯</div></div>
        <div class="rank-stat ${rankStat==='vitorias' ?'hl':''}"><div class="rs-v">${tv}</div><div class="rs-l">🏆</div></div>
        <div class="rank-stat ${rankStat==='domingos' ?'hl':''}"><div class="rs-v">${nd}</div><div class="rs-l">Dom</div></div>
        <div class="rank-stat ${rankStat==='mvps'     ?'hl':''}"><div class="rs-v">${mvps>0?'⭐'+mvps:'—'}</div><div class="rs-l">MVP</div></div>
      </div>
    </div>`;
  }).join('');
}

// ─── PERFIL ──────────────────────────────────────────────────
function openPerfil(id) {
  const j=appData.jogadores.find(x=>x.id===id);
  if(!j) {
    // Guest or unregistered user
    document.getElementById('perfilBody').innerHTML = `
      <div style="text-align:center;padding:32px 16px">
        <div style="font-size:48px;margin-bottom:14px">🚫</div>
        <div class="m-title" style="color:var(--red)">JOGADOR NÃO CADASTRADO</div>
        <div class="m-sub" style="margin-top:8px">Este usuário não possui um perfil na pelada.<br>Solicite ao admin para ser cadastrado.</div>
      </div>`;
    openModal('modalPerfil');
    return;
  }
  const ix=calcIdx(appData.jogadores).find(x=>x.id===id);
  const nd=nDom(j);
  const tg=j.domingos.reduce((s,d)=>s+(d.gols||0),0);
  const ta=j.domingos.reduce((s,d)=>s+(d.assists||0),0);
  const tv=j.domingos.reduce((s,d)=>s+(d.vitorias||0),0);
  const isAdmin = currentUser?.isAdmin;

  const histHTML = !j.domingos.length
    ? `<div style="color:var(--t3);font-size:13px;text-align:center;padding:16px">Sem dados registrados</div>`
    : [...j.domingos].map((d, i) => {
        return `<div class="hist">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <div class="hdate">${d.data}${d.ausente?'<span style="color:#ef4444;font-size:10px;margin-left:8px">FALTOU</span>':''}</div>
            ${isAdmin ? `<div style="display:flex;gap:5px">
              <button class="icon-btn" style="font-size:11px;padding:3px 8px" onclick="abrirEditDomingo('${j.id}',${i})">✏️</button>
              <button class="icon-btn danger" style="font-size:11px;padding:3px 8px" onclick="removerDomingo('${j.id}',${i})">🗑️</button>
            </div>` : ''}
          </div>
          <div class="hstats">
            ${d.ausente
              ? `<div style="color:var(--t3);font-style:italic;font-size:12px">Contabilizado como falta</div>`
              : `<div>⚽ <span>${d.gols||0}</span></div><div>🎯 <span>${d.assists||0}</span></div><div>🏆 <span>${d.vitorias||0}</span></div><div>Score <span>${scoreRaw(d.gols||0,d.assists||0,d.vitorias||0).toFixed(4)}</span></div>`
            }
          </div>
        </div>`;
      }).reverse().join('');

  const canEditPhoto = currentUser?.id === j.id || isAdmin;
  const fotoHTML = j.foto
    ? `<img src="${j.foto}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:2px solid var(--border-gold);display:block;margin:0 auto 12px">`
    : `<div style="width:80px;height:80px;border-radius:50%;background:var(--s3);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-size:32px;color:var(--t2);margin:0 auto 12px">${j.nome[0].toUpperCase()}</div>`;

  document.getElementById('perfilBody').innerHTML=`
    <div style="text-align:center;margin-bottom:14px">
      ${fotoHTML}
      ${canEditPhoto ? `<button onclick="abrirUploadFoto('${j.id}')" style="background:var(--s2);border:1px solid var(--border-gold);border-radius:99px;color:var(--gold);font-size:11px;padding:5px 14px;cursor:pointer;font-family:'DM Sans',sans-serif">📷 ${j.foto ? 'Trocar foto' : 'Adicionar foto'}</button>` : ''}
    </div>
    <div class="m-title" style="text-align:center">${j.nome}</div>
    <div class="m-sub" style="text-align:center">Nota opinativa: ${j.nota?.toFixed(1)}</div>
    ${isAdmin && currentUser?.id !== j.id ? `
    <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:12px">
      <button onclick="abrirEditarNota('${j.id}')" style="background:var(--gold-dim);border:1px solid var(--border-gold);border-radius:99px;color:var(--gold);font-size:11px;padding:5px 14px;cursor:pointer;font-family:'DM Sans',sans-serif">✏️ Editar nota</button>
      <button onclick="toggleAdminPerfil('${j.id}')" style="background:${(appData.admins||[]).includes(j.id)?'rgba(255,68,68,.1)':'rgba(200,241,53,.08)'};border:1px solid ${(appData.admins||[]).includes(j.id)?'rgba(255,68,68,.25)':'var(--border-gold)'};border-radius:99px;color:${(appData.admins||[]).includes(j.id)?'var(--red)':'var(--gold)'};font-size:11px;padding:5px 14px;cursor:pointer;font-family:'DM Sans',sans-serif">
        ${(appData.admins||[]).includes(j.id)?'⬇️ Remover admin':'⬆️ Tornar admin'}
      </button>
      <button onclick="toggleMensalistaPerfil('${j.id}')" style="background:${j.tipoJogador==='mensalista'?'rgba(255,68,68,.1)':'rgba(200,241,53,.08)'};border:1px solid ${j.tipoJogador==='mensalista'?'rgba(255,68,68,.25)':'var(--border-gold)'};border-radius:99px;color:${j.tipoJogador==='mensalista'?'var(--red)':'var(--gold)'};font-size:11px;padding:5px 14px;cursor:pointer;font-family:'DM Sans',sans-serif">
        ${j.tipoJogador==='mensalista'?'⬇️ Tornar avulso':'⬆️ Tornar mensalista'}
      </button>
    </div>` : ''}
    <div class="pills">
      <div class="pill"><div class="pill-v">${nd>0&&ix?ix.IF.toFixed(2):'—'}</div><div class="pill-l">Rating</div></div>
      <div class="pill"><div class="pill-v">${tg}</div><div class="pill-l">Gols</div></div>
      <div class="pill"><div class="pill-v">${ta}</div><div class="pill-l">Assists</div></div>
      <div class="pill"><div class="pill-v">${tv}</div><div class="pill-l">Vitórias</div></div>
    </div>
    ${ix&&nd>0?`
    <div class="card" style="margin-bottom:12px">
      <div class="section-lbl">CÁLCULO DETALHADO</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--t2);line-height:2.2">
        n = ${ix.n} · Score acum = ${scoreAcum(j).toFixed(4)}<br>
        S_adj (Bayesian k=5) = ${ix.sAdj.toFixed(4)}<br>
        S_adj normalizado = ${ix.sAdjN.toFixed(4)}<br>
        Nota normalizada = ${ix.notaN.toFixed(4)}<br>
        α(${ix.n}) = ${ix.alpha.toFixed(4)}<br>
        <span style="color:var(--gold)">Rating = ${ix.alpha.toFixed(4)}×${ix.notaN.toFixed(4)} + ${(1-ix.alpha).toFixed(4)}×${ix.sAdjN.toFixed(4)} = ${ix.IF.toFixed(4)}</span>
      </div>
    </div>`:''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div class="section-lbl" style="margin-bottom:0">HISTÓRICO</div>
      ${isAdmin ? `<button onclick="abrirNovoDomingo('${j.id}')" style="background:var(--gold-dim);border:1px solid var(--border-gold);border-radius:8px;color:var(--gold);font-size:11px;padding:5px 12px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600">+ ADICIONAR</button>` : ''}
    </div>
    ${histHTML}`;
  openModal('modalPerfil');
}
function openPerfilProprio() {
  if (!currentUser) return;
  // Toggle floating menu
  const existing = document.getElementById('userFloatMenu');
  if (existing) { existing.remove(); return; }
  const chip = document.getElementById('hUserChip');
  const rect = chip.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'userFloatMenu';
  menu.style.cssText = `position:fixed;top:${rect.bottom+6}px;right:12px;background:var(--s1);border:1px solid var(--border-gold);border-radius:12px;padding:8px;z-index:300;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,.5)`;
  menu.innerHTML = `
    <div style="padding:8px 10px 10px;border-bottom:1px solid var(--border);margin-bottom:6px">
      <div style="font-family:'Oswald',sans-serif;font-size:14px;color:var(--gold-lt)">${currentUser.nome}</div>
      <div style="font-size:10px;color:var(--t2);margin-top:2px">${currentUser.isAdmin?'Admin':'Jogador'}</div>
    </div>
    <button onclick="document.getElementById('userFloatMenu')?.remove();openPerfil('${currentUser.id}')" style="width:100%;background:none;border:none;color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;padding:9px 10px;text-align:left;cursor:pointer;border-radius:8px;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='none'">👤 Ver perfil</button>
    ${!currentUser.isGuest ? `
    <button onclick="document.getElementById('userFloatMenu')?.remove();abrirUploadFoto('${currentUser.id}')" style="width:100%;background:none;border:none;color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;padding:9px 10px;text-align:left;cursor:pointer;border-radius:8px;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='none'">📷 Alterar foto</button>
    <button onclick="document.getElementById('userFloatMenu')?.remove();abrirMudarSenha()" style="width:100%;background:none;border:none;color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;padding:9px 10px;text-align:left;cursor:pointer;border-radius:8px;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='none'">🔑 Mudar senha</button>` : ''}
    <div style="border-top:1px solid var(--border);margin:6px 0"></div>
    <button onclick="document.getElementById('userFloatMenu')?.remove();sairDaConta()" style="width:100%;background:none;border:none;color:var(--red);font-family:'DM Sans',sans-serif;font-size:13px;padding:9px 10px;text-align:left;cursor:pointer;border-radius:8px;display:flex;align-items:center;gap:8px" onmouseover="this.style.background='rgba(255,68,68,.08)'" onmouseout="this.style.background='none'">🚪 Sair da conta</button>
  `;
  document.body.appendChild(menu);
  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!menu.contains(e.target) && !chip.contains(e.target)) {
        menu.remove(); document.removeEventListener('click', handler);
      }
    });
  }, 10);
}

function abrirEditarNota(jogadorId) {
  if (!currentUser?.isAdmin) return;
  const j = appData.jogadores.find(x=>x.id===jogadorId);
  if (!j) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'modalEditarNota';
  overlay.innerHTML = `
    <div class="modal">
      <div class="mhandle"></div>
      <div class="m-title">EDITAR NOTA</div>
      <div class="m-sub">${j.nome}</div>
      <div class="field">
        <label>Nota Opinativa (0.0 – 10.0)</label>
        <input class="input" id="inputNotaEdit" type="number" min="0" max="10" step="0.1" value="${j.nota?.toFixed(1)||'5.0'}">
      </div>
      <button class="btn btn-gold" onclick="salvarNotaEdit('${jogadorId}')">SALVAR</button>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalEditarNota').remove()">CANCELAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('inputNotaEdit')?.select(), 100);
}

async function salvarNotaEdit(jogadorId) {
  const val = parseFloat(document.getElementById('inputNotaEdit')?.value);
  if (isNaN(val) || val < 0 || val > 10) { showToast('Nota deve ser entre 0 e 10'); return; }
  const j = appData.jogadores.find(x=>x.id===jogadorId);
  if (!j) return;
  j.nota = +val.toFixed(1);
  await firestoreSet('jogadores', jogadorId, j);
  saveLocal();
  document.getElementById('modalEditarNota')?.remove();
  showToast('Nota atualizada ✅');
  openPerfil(jogadorId); // re-render
}

async function toggleAdminPerfil(jogadorId) {
  if (!currentUser?.isAdmin) return;
  if (jogadorId === currentUser.id) { showToast('Não pode alterar seu próprio admin'); return; }
  const admins = appData.admins || [];
  const idx = admins.indexOf(jogadorId);
  if (idx >= 0) admins.splice(idx, 1); else admins.push(jogadorId);
  appData.admins = admins;
  await firestoreSet('config', 'admins', { list: admins });
  saveLocal();
  const j = appData.jogadores.find(x=>x.id===jogadorId);
  showToast(`${j?.nome} → ${admins.includes(jogadorId)?'Admin':'Jogador'}`);
  openPerfil(jogadorId);
}

async function toggleMensalistaPerfil(jogadorId) {
  if (!currentUser?.isAdmin) return;
  const j = appData.jogadores.find(x=>x.id===jogadorId);
  if (!j) return;
  const isMensal = j.tipoJogador === 'mensalista';
  if (!isMensal) {
    const totalMensalistas = appData.jogadores.filter(x=>x.tipoJogador==='mensalista').length;
    if (totalMensalistas >= 15) { showToast('Limite de 15 mensalistas atingido'); return; }
  }
  j.tipoJogador = isMensal ? 'avulso' : 'mensalista';
  await firestoreSet('jogadores', jogadorId, j);
  saveLocal();
  showToast(`${j.nome} → ${j.tipoJogador}`);
  openPerfil(jogadorId);
}

function abrirMudarSenha() {
  if (!currentUser || currentUser.isGuest) { showToast('Faça login com sua conta'); return; }
  const j = appData.jogadores.find(x => x.id === currentUser.id);
  if (!j) { showToast('Jogador não encontrado'); return; }
  // Reuse showPasswordStep in 'mudar' mode
  showPasswordStepMudar(j);
}

function showPasswordStepMudar(jogador) {
  // Open a simple modal
  const overlay = document.createElement('div');
  overlay.id = 'modalMudarSenha';
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal">
      <div class="mhandle"></div>
      <div class="m-title">MUDAR SENHA</div>
      <div class="m-sub">${jogador.nome}</div>
      <div class="field"><label>Senha atual</label><input class="input" id="msSenhaAtual" type="password" placeholder="••••••" maxlength="30"></div>
      <div class="field"><label>Nova senha</label><input class="input" id="msSenhaNova" type="password" placeholder="••••••" maxlength="30"></div>
      <div class="field"><label>Confirmar nova senha</label><input class="input" id="msSenhaNova2" type="password" placeholder="••••••" maxlength="30"></div>
      <button class="btn btn-gold" onclick="salvarNovaSenha('${jogador.id}')">SALVAR SENHA</button>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalMudarSenha').remove()">CANCELAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function salvarNovaSenha(jogadorId) {
  const atual = document.getElementById('msSenhaAtual')?.value?.trim();
  const nova = document.getElementById('msSenhaNova')?.value?.trim();
  const nova2 = document.getElementById('msSenhaNova2')?.value?.trim();
  if (!atual || !nova || !nova2) { showToast('Preencha todos os campos'); return; }
  if (nova.length < 4) { showToast('Nova senha deve ter pelo menos 4 caracteres'); return; }
  if (nova !== nova2) { showToast('Senhas não coincidem'); return; }
  const j = appData.jogadores.find(x => x.id === jogadorId);
  if (!j) return;
  // Verify current
  const hashAtual = hashSenha(atual);
  let ok = hashAtual === j.senha;
  if (!ok) { try { ok = btoa(unescape(encodeURIComponent(atual))) === j.senha; } catch(e) {} }
  if (!ok) { showToast('Senha atual incorreta ❌'); return; }
  j.senha = hashSenha(nova);
  await firestoreSet('jogadores', jogadorId, j);
  saveLocal();
  document.getElementById('modalMudarSenha')?.remove();
  showToast('Senha alterada! ✅');
}

// ─── EDITAR / ADICIONAR DOMINGO ──────────────────────────────
let _editDomingo = { jogadorId: null, idx: null };

function abrirNovoDomingo(jogadorId) {
  _editDomingo = { jogadorId, idx: null };
  const hoje = new Date().toLocaleDateString('pt-BR');
  document.getElementById('editDomingoTitle').textContent = 'ADICIONAR DOMINGO';
  document.getElementById('editDomingoData').value = hoje;
  document.getElementById('editDomingoGols').value = 0;
  document.getElementById('editDomingoAssists').value = 0;
  document.getElementById('editDomingoVitorias').value = 0;
  document.getElementById('editDomingoAusente').checked = false;
  openModal('modalEditDomingo');
}

function abrirEditDomingo(jogadorId, idx) {
  const j = appData.jogadores.find(x => x.id === jogadorId); if (!j) return;
  const d = j.domingos[idx]; if (!d) return;
  _editDomingo = { jogadorId, idx };
  document.getElementById('editDomingoTitle').textContent = 'EDITAR DOMINGO';
  document.getElementById('editDomingoData').value = d.data || '';
  document.getElementById('editDomingoGols').value = d.gols || 0;
  document.getElementById('editDomingoAssists').value = d.assists || 0;
  document.getElementById('editDomingoVitorias').value = d.vitorias || 0;
  document.getElementById('editDomingoAusente').checked = !!d.ausente;
  openModal('modalEditDomingo');
}

async function salvarEditDomingo() {
  if (!currentUser?.isAdmin) { showToast('Sem permissão'); return; }
  const { jogadorId, idx } = _editDomingo;
  const j = appData.jogadores.find(x => x.id === jogadorId); if (!j) return;
  const data     = document.getElementById('editDomingoData').value.trim() || new Date().toLocaleDateString('pt-BR');
  const gols     = Math.max(0, parseInt(document.getElementById('editDomingoGols').value) || 0);
  const assists  = Math.max(0, parseInt(document.getElementById('editDomingoAssists').value) || 0);
  const vitorias = Math.max(0, parseInt(document.getElementById('editDomingoVitorias').value) || 0);
  const ausente  = document.getElementById('editDomingoAusente').checked;
  const entry = ausente ? { data, ausente: true, gols:0, assists:0, vitorias:0 } : { data, gols, assists, vitorias };
  if (!j.domingos) j.domingos = [];
  if (idx === null) j.domingos.push(entry); else j.domingos[idx] = entry;
  await firestoreSet('jogadores', jogadorId, j);
  saveLocal();
  closeModal('modalEditDomingo');
  showToast(idx === null ? 'Domingo adicionado ✅' : 'Domingo atualizado ✅');
  openPerfil(jogadorId);
}

async function removerDomingo(jogadorId, idx) {
  if (!currentUser?.isAdmin) return;
  const j = appData.jogadores.find(x => x.id === jogadorId); if (!j) return;
  const d = j.domingos[idx];
  if (!d) return;

  const ocorrenciasJogador = j.domingos.filter(x => x.data === d.data).length;
  const totalTodos = appData.jogadores.reduce((s, jj) =>
    s + (jj.domingos||[]).filter(x => x.data === d.data).length, 0);

  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'modalRemoverDomingo';
  overlay.innerHTML = `
    <div class="modal">
      <div class="mhandle"></div>
      <div class="m-title">REMOVER DOMINGO</div>
      <div class="m-sub">${d.data}</div>

      <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--t2);margin-bottom:16px;line-height:1.8">
        <div>Jogador: <strong style="color:var(--text)">${j.nome}</strong> — ${ocorrenciasJogador} registro${ocorrenciasJogador!==1?'s':''} nesta data</div>
        <div>Total geral: <strong style="color:var(--text)">${totalTodos} registro${totalTodos!==1?'s':''}</strong> desta data em todos os jogadores</div>
      </div>

      <button class="btn btn-danger" onclick="executarRemoverDomingo('${jogadorId}',${idx},'unico')">
        🗑️ REMOVER SÓ ESTE REGISTRO (${j.nome})
      </button>
      ${ocorrenciasJogador > 1 ? `
      <button class="btn btn-danger mt8" onclick="executarRemoverDomingo('${jogadorId}',${idx},'jogador')">
        🗑️ REMOVER TODOS DE ${j.nome} NESTA DATA (${ocorrenciasJogador})
      </button>` : ''}
      <button class="btn btn-danger mt8" style="background:rgba(255,68,68,.2)" onclick="executarRemoverDomingo('${jogadorId}',${idx},'todos')">
        ⚠️ REMOVER TODOS OS JOGADORES DESTA DATA (${totalTodos})
      </button>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalRemoverDomingo').remove()">CANCELAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function executarRemoverDomingo(jogadorId, idx, modo) {
  const j = appData.jogadores.find(x => x.id === jogadorId); if (!j) return;
  const d = j.domingos[idx]; if (!d) return;
  const data = d.data;
  document.getElementById('modalRemoverDomingo')?.remove();

  if (modo === 'unico') {
    // Remove only this specific entry (by index)
    j.domingos.splice(idx, 1);
    await firestoreSet('jogadores', jogadorId, j);
    showToast('Registro removido');

  } else if (modo === 'jogador') {
    // Remove all entries of this date for this player
    j.domingos = j.domingos.filter(x => x.data !== data);
    await firestoreSet('jogadores', jogadorId, j);
    showToast(`Todos os registros de ${data} removidos de ${j.nome}`);

  } else if (modo === 'todos') {
    // Remove this date from ALL players
    if (!confirm(`Remover a data ${data} de TODOS os jogadores?`)) { openPerfil(jogadorId); return; }
    for (const jj of appData.jogadores) {
      const antes = jj.domingos?.length || 0;
      jj.domingos = (jj.domingos||[]).filter(x => x.data !== data);
      if (jj.domingos.length !== antes) {
        await firestoreSet('jogadores', jj.id, jj);
      }
    }
    showToast(`Data ${data} removida de todos os jogadores`);
  }

  saveLocal();
  openPerfil(jogadorId);
}


// ─── FOTO DE PERFIL ──────────────────────────────────────────
async function abrirUploadFoto(jogadorId) {
  if (currentUser?.id !== jogadorId && !currentUser?.isAdmin) { showToast('Sem permissão'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Foto muito grande (máx 2MB)'); return; }
    showToast('Enviando foto...');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      const j = appData.jogadores.find(x => x.id === jogadorId);
      if (!j) return;
      const resized = await resizeImage(base64, 200);
      j.foto = resized;
      await firestoreSet('jogadores', jogadorId, j);
      if (currentUser?.id === jogadorId) {
        currentUser.foto = resized;
        localStorage.setItem(LS_USER, JSON.stringify(currentUser));
        const hAvatar = document.getElementById('hAvatar');
        hAvatar.innerHTML = `<img src="${resized}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
      }
      saveLocal();
      showToast('Foto atualizada! ✅');
      openPerfil(jogadorId);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function resizeImage(base64, maxSize) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
      else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = base64;
  });
}

// ─── OPCOES ──────────────────────────────────────────────────
function renderOpcoes() {
  const v = appData.config?.aleatoriedade??15;
  const isAdmin = currentUser?.isAdmin;
  document.getElementById('sliderWrap').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('sliderLocked').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('sliderLockedVal').textContent = v + '%';
  document.getElementById('sliderAlea').value = v;
  document.getElementById('aleaVal').textContent = v + '%';
  renderRestList();
}
function updateAlea() {
  if(!currentUser?.isAdmin){
    document.getElementById('sliderAlea').value=appData.config?.aleatoriedade??15;
    showToast('Sem permissão'); return;
  }
  const v=document.getElementById('sliderAlea').value;
  document.getElementById('aleaVal').textContent=v+'%';
  if(!appData.config) appData.config={};
  appData.config.aleatoriedade=parseInt(v);
  if(useFirebase&&db_fire) firestoreSet('config','main',appData.config).catch(()=>{});
  saveLocal();
}
function renderRestList() {
  const list=document.getElementById('restList');
  const perm=appData.restricoes.filter(r=>r.duracao==='permanente');
  if(!perm.length){list.innerHTML=`<div style="font-size:12px;color:var(--t3);text-align:center;padding:8px">Nenhuma restrição permanente</div>`;return;}
  list.innerHTML=perm.map(r=>restRowHTML(r)).join('');
}
function restRowHTML(r) {
  const j1=appData.jogadores.find(x=>x.id===r.p1);
  const j2=appData.jogadores.find(x=>x.id===r.p2);
  return `<div class="rrow">
    <div><div class="rtype">${r.tipo==='nunca'?'🚫 Nunca juntos':'🤝 Sempre juntos'} · ${r.duracao}</div>
    <div style="font-size:13px">${j1?.nome||'?'} + ${j2?.nome||'?'}</div></div>
    ${currentUser?.isAdmin?`<button class="del-btn" onclick="removerRest('${r.id}')">×</button>`:''}
  </div>`;
}

// ─── RESTRICOES ──────────────────────────────────────────────
let rTipo='nunca',rDur='permanente';
function setRT(t){rTipo=t;document.getElementById('chipN').classList.toggle('sel',t==='nunca');document.getElementById('chipS').classList.toggle('sel',t==='sempre');}
function setRD(d){rDur=d;document.getElementById('chipP').classList.toggle('sel',d==='permanente');document.getElementById('chipD').classList.toggle('sel',d==='domingo');}

function openModal(id) {
  if(id==='modalRest'){
    const opts=appData.jogadores.map(j=>`<option value="${j.id}">${j.nome}</option>`).join('');
    document.getElementById('rP1').innerHTML=opts;
    document.getElementById('rP2').innerHTML=opts;
    renderRestModalList();
  }
  if(id==='modalAdmin') renderAdminList();
  document.getElementById(id).classList.add('open');
}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open');}));

async function addRestricao() {
  if(!currentUser?.isAdmin) return;
  const p1=document.getElementById('rP1').value,p2=document.getElementById('rP2').value;
  if(p1===p2){showToast('Selecione jogadores diferentes');return;}
  const ex=appData.restricoes.find(r=>((r.p1===p1&&r.p2===p2)||(r.p1===p2&&r.p2===p1))&&r.duracao===rDur);
  if(ex){showToast('Restrição já existe');return;}
  const id='r'+Date.now();
  const nr={id,tipo:rTipo,duracao:rDur,p1,p2};
  appData.restricoes.push(nr);
  await firestoreSet('restricoes',id,nr);
  saveLocal(); renderRestModalList(); renderRestList(); showToast('Restrição adicionada');
}
async function removerRest(id) {
  appData.restricoes=appData.restricoes.filter(r=>r.id!==id);
  await firestoreDelete('restricoes',id);
  saveLocal(); renderRestModalList(); renderRestList(); showToast('Restrição removida');
}
function renderRestModalList() {
  const list=document.getElementById('restModalList'); if(!list) return;
  list.innerHTML=appData.restricoes.length?appData.restricoes.map(r=>restRowHTML(r)).join(''):
    `<div style="font-size:12px;color:var(--t3);text-align:center;padding:8px">Nenhuma restrição</div>`;
}

// ─── ADMINS ──────────────────────────────────────────────────
function renderAdminList() {
  const list=document.getElementById('adminList');
  const admins=appData.admins||[];
  list.innerHTML=appData.jogadores.map(j=>{
    const isAdm=admins.includes(j.id), isMe=j.id===currentUser?.id;
    return `<div class="rrow">
      <div>
        <div class="p-name">${j.nome}${isMe?' <span style="color:var(--t2);font-size:11px">(você)</span>':''}</div>
        <div class="rtype">${isAdm?'✅ Admin':'👤 Jogador'}</div>
      </div>
      ${!isMe?`<button class="btn-sm btn ${isAdm?'btn-danger':'btn-gold'}" style="font-family:inherit;font-size:11px;letter-spacing:0;padding:7px 12px;width:auto" onclick="toggleAdmin('${j.id}')">
        ${isAdm?'Remover':'Tornar admin'}
      </button>`:''
      }
    </div>`;
  }).join('');
}
async function toggleAdmin(id) {
  const admins=appData.admins||[];
  const i=admins.indexOf(id);
  if(i>=0) admins.splice(i,1); else admins.push(id);
  appData.admins=admins;
  await firestoreSet('config','admins',{list:admins});
  saveLocal(); renderAdminList(); showToast('Permissões atualizadas');
}

// ─── FLOW ────────────────────────────────────────────────────
// flow.step: 'sel' → 'times' → (close, back to home with status 'confirmado')
// after confirmar, home shows times + admin controls (cancelar / concluir)
// concluir → 'ausentes' step → 'stats' step
let flow = {
  step: 'sel',
  presentes: [],
  times: [],
  data: '',
  // concluir flow
  ausentes: [],
  statsIdx: 0,
  statsOrder: [],
  statsData: {}
};
const T_NAMES=['Time 1','Time 2','Time 3','Time 4'];
const T_COLORS=['t0','t1','t2','t3'];

function startFlow() {
  if(!currentUser?.isAdmin){showToast('Sem permissão');return;}
  if(appData.jogadores.length<15){showToast('Cadastre pelo menos 15 jogadores');return;}
  openModal('modalDataSorteio');
  document.getElementById('inputDataSorteio').value = new Date().toLocaleDateString('pt-BR');
}

async function confirmarDataSorteio() {
  const data = document.getElementById('inputDataSorteio').value.trim();
  if (!data) { showToast('Informe a data da pelada'); return; }
  closeModal('modalDataSorteio');
  flow={
    step:'sel', presentes:[], times:[], data,
    ausentes:[], statsIdx:0, statsOrder:[], statsData:{}, _saving:false
  };
  appData.restricoes=appData.restricoes.filter(r=>r.duracao!=='domingo');
  // Clear any previous presença when starting new sorteio
  if (appData.presenca) {
    await firestoreDelete('config','presenca');
    appData.presenca = null;
  }
  saveLocal(); renderFlow();
  document.getElementById('flow').style.display='block';
}
function closeFlow() {
  if (flow.step === 'times') {
    // Go back to selection instead of closing
    flow.step = 'sel';
    renderFlow();
    return;
  }
  if (flow.step === 'stats' || flow.step === 'ausentes') {
    if (!confirm('Cancelar inserção de estatísticas? Dados não serão salvos.')) return;
  }
  document.getElementById('flow').style.display='none';
}
function renderFlow() {
  if(flow.step==='saving') return; // actively saving, do not re-render
  const c=document.getElementById('flowContent'),t=document.getElementById('flowTitle');
  if(flow.step==='sel') renderFlowSel(c,t);
  else if(flow.step==='times') renderFlowTimes(c,t);
  else if(flow.step==='ausentes') renderFlowAusentes(c,t);
  else if(flow.step==='stats') { t.textContent=`ESTATÍSTICAS ${flow.statsIdx+1}/${flow.statsOrder.length}`; renderStatsStep(c); }
}

function renderFlowSel(c,t) {
  t.textContent='SELECIONAR PRESENTES';
  const sel=flow.presentes, n=sel.length;
  const valid=n===15||n===20;
  const nTimes = n === 15 ? 3 : n === 20 ? 4 : null;
  const hint = n < 15
    ? `Selecione <strong style="color:var(--gold)">15</strong> ou <strong style="color:var(--gold)">20</strong> jogadores`
    : n === 15 || n === 20
    ? `<span style="color:var(--gold)">✓ ${n} jogadores → ${nTimes} times</span>`
    : `<span style="color:#ef4444">Selecione exatamente 15 ou 20</span>`;

  c.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:13px;color:var(--t2)">${hint}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:22px;color:${valid?'var(--gold)':'var(--t2)'};font-weight:600">${n}</div>
    </div>
    ${appData.jogadores.map(j=>`
      <div class="prow ${sel.includes(j.id)?'sel':''}" onclick="toggleP('${j.id}')">
        <div class="p-avatar">${j.nome[0].toUpperCase()}</div>
        <div class="p-name">${j.nome}</div>
        <div style="font-size:20px">${sel.includes(j.id)?'✅':'⬜'}</div>
      </div>`).join('')}
    <div style="margin-top:14px">
      <button class="btn btn-gold" ${valid?'':'disabled'} onclick="confirmarPresentes()">SORTEAR TIMES (${n})</button>
    </div>`;
}

function renderFlowTimes(c,t) {
  t.textContent='TIMES SORTEADOS';
  const idxMap=Object.fromEntries(calcIdx(appData.jogadores).map(i=>[i.id,i]));
  const sums=flow.times.map(tm=>tm.reduce((s,id)=>s+(idxMap[id]?.IF||0),0));
  const maxS=Math.max(...sums);
  const diffs=[];
  for(let i=0;i<sums.length;i++) for(let j=i+1;j<sums.length;j++) diffs.push(Math.abs(sums[i]-sums[j]));
  const maxD=Math.max(...diffs);
  const bal=maxD<0.1?'Excelente ✨':maxD<0.3?'Bom 👍':maxD<0.6?'Razoável':'Desbalanceado';
  c.innerHTML=`
    <div class="card gold-card" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:12px;color:var(--t2)">Equilíbrio dos times</div>
      <div style="font-family:'Oswald',sans-serif;font-size:15px;font-weight:600;color:var(--gold-lt)">${bal}</div>
    </div>
    ${flow.times.map((tm,ti)=>`
      <div class="team-card ${T_COLORS[ti]}">
        <div class="t-name"><div class="t-dot"></div>${T_NAMES[ti]}</div>
        ${tm.map(id=>{const j=appData.jogadores.find(x=>x.id===id);const ix=idxMap[id];return`<div class="t-player"><span>${j?.nome||id}</span><span class="t-player-if">${ix?.IF.toFixed(2)||'—'}</span></div>`;}).join('')}
        <div class="t-strength">Força: ${sums[ti].toFixed(4)} · ${maxS>0?Math.round(sums[ti]/maxS*100):0}%</div>
      </div>`).join('')}
    <div class="row mt12">
      <button class="btn btn-ghost" onclick="resortear()">🔀 RESORTEAR</button>
      <button class="btn btn-danger" style="flex:0.6" onclick="cancelarSorteio()">✕</button>
      <button class="btn btn-gold" onclick="confirmarTimes()">✅ CONFIRMAR</button>
    </div>`;
}

// ─── Step: selecionar ausentes (quem faltou) ─────────────────
function renderFlowAusentes(c,t) {
  t.textContent = 'QUEM FALTOU?';
  const todos = flow.times.flat();
  const aus = flow.ausentes;
  c.innerHTML = `
    <div style="font-size:13px;color:var(--t2);margin-bottom:14px">
      Marque quem estava no sorteio mas <strong style="color:#ef4444">não compareceu</strong>
    </div>
    ${todos.map(id => {
      const j = appData.jogadores.find(x=>x.id===id);
      const sel = aus.includes(id);
      return `<div class="prow ${sel?'sel':''}" onclick="toggleAusente('${id}')" style="${sel?'border-color:#ef4444;background:rgba(239,68,68,.05)':''}">
        <div class="p-avatar">${j?.nome?.[0]?.toUpperCase()||'?'}</div>
        <div class="p-name">${j?.nome||id}</div>
        <div style="font-size:20px">${sel?'❌':'✅'}</div>
      </div>`;
    }).join('')}
    <div style="margin-top:14px">
      <div style="font-size:11px;color:var(--t3);margin-bottom:10px;text-align:center">
        ${aus.length > 0 ? `${aus.length} falta${aus.length>1?'s':''} — contabilizadas como domingo para ranking` : 'Ninguém faltou? Ótimo!'}
      </div>
      <button class="btn btn-gold" onclick="confirmarAusentes()">CONTINUAR → ESTATÍSTICAS</button>
    </div>`;
}

function toggleAusente(id) {
  const i = flow.ausentes.indexOf(id);
  if (i >= 0) flow.ausentes.splice(i, 1);
  else flow.ausentes.push(id);
  renderFlow();
}

function confirmarAusentes() {
  // Build stats order: only presentes (not ausentes)
  flow.statsOrder = flow.times.flat().filter(id => !flow.ausentes.includes(id));
  flow.statsData = {};
  flow.statsOrder.forEach(id => { flow.statsData[id] = {gols:0, assists:0, vitorias:0}; });
  flow.statsIdx = 0;
  flow.step = 'stats';
  renderFlow();
}

function toggleP(id) {
  const i=flow.presentes.indexOf(id);
  if(i>=0) flow.presentes.splice(i,1);
  else{if(flow.presentes.length>=20){showToast('Máximo 20');return;}flow.presentes.push(id);}
  renderFlow();
}
function confirmarPresentes(){
  if(flow.presentes.length!==15&&flow.presentes.length!==20){showToast('Selecione 15 ou 20');return;}
  sortearTimes();
}
function sortearTimes() {
  const nT=flow.presentes.length===15?3:4;
  const idxMap=Object.fromEntries(calcIdx(appData.jogadores).map(i=>[i.id,i]));
  const alea=(appData.config?.aleatoriedade??15)/100;
  const scores=flow.presentes.map(id=>idxMap[id]?.IF||0);
  const maxScore=Math.max(...scores);
  const noiseBase = maxScore > 0 ? maxScore : 0.5; // guarantee noise when all scores=0
  const scored=flow.presentes.map(id=>{
    const base=idxMap[id]?.IF||0;
    const noise=noiseBase*alea*(Math.random()*2-1);
    const minNoise=noiseBase*0.05*(Math.random()*2-1); // always some shuffle
    return{id,score:base+noise+minNoise};
  }).sort((a,b)=>b.score-a.score);
  const times=Array.from({length:nT},()=>[]);
  for(let i=0;i<scored.length;i++){
    const round=Math.floor(i/nT);
    const pos=round%2===0?i%nT:nT-1-(i%nT);
    times[pos].push(scored[i].id);
  }
  const sum=t=>t.reduce((s,id)=>s+(idxMap[id]?.IF||0),0);
  const imbal=ts=>{let mx=0;for(let i=0;i<ts.length;i++)for(let j=i+1;j<ts.length;j++)mx=Math.max(mx,Math.abs(sum(ts[i])-sum(ts[j])));return mx;};
  let imp=true,it=0;
  while(imp&&it<500){imp=false;it++;
    for(let a=0;a<nT;a++)for(let b=a+1;b<nT;b++)for(let p=0;p<times[a].length;p++)for(let q=0;q<times[b].length;q++){
      const bef=imbal(times);[times[a][p],times[b][q]]=[times[b][q],times[a][p]];
      if(imbal(times)<bef-0.0001)imp=true;else[times[a][p],times[b][q]]=[times[b][q],times[a][p]];
    }
  }
  let vio=false;
  for(const r of appData.restricoes){
    for(const tm of times){
      const h1=tm.includes(r.p1),h2=tm.includes(r.p2);
      if(r.tipo==='nunca'&&h1&&h2){vio=true;break;}
      if(r.tipo==='sempre'&&h1!==h2){vio=true;break;}
    }
    if(vio)break;
  }
  if(vio){flow._r=(flow._r||0)+1;if(flow._r<15){sortearTimes();return;}showToast('⚠️ Restrições não satisfeitas');}
  flow._r=0;flow.times=times;flow.step='times';renderFlow();
}

function resortear(){ sortearTimes(); }

function cancelarSorteio() {
  if(confirm('Cancelar sorteio?')) closeFlow();
}

async function confirmarTimes(){
  // Firestore doesn't support nested arrays — convert to objects
  const timesObj = {};
  const nomesObj = {};
  flow.times.forEach((t, i) => {
    timesObj['t' + i] = t;
    nomesObj['t' + i] = t.map(id => {
      const j = appData.jogadores.find(x=>x.id===id);
      return j?.nome || id;
    });
  });
  const timesData = {
    times: timesObj,
    timesCount: flow.times.length,
    data: flow.data,
    status: 'confirmado',
    sorteadoEm: Date.now(),
    nomes: nomesObj
  };
  // Save locally first as fallback
  appData.ultimoSorteio = timesData;
  saveLocal();
  try {
    await firestoreSet('config', 'ultimoSorteio', timesData);
    document.getElementById('flow').style.display='none';
    goTo('home');
    showToast('Times confirmados! ✅ Todos podem ver.');
  } catch(e) {
    console.error('Firestore error:', e.code, e.message);
    // Even if Firebase fails, show locally
    document.getElementById('flow').style.display='none';
    goTo('home');
    showToast('⚠️ Salvo localmente. Verifique as regras do Firestore no console.');
  }
}

// ─── EDIÇÃO MANUAL DE TIMES ──────────────────────────────────
let editTimesState = null;

function abrirEdicaoTimes() {
  if (!currentUser?.isAdmin) return;
  const sorteio = appData.ultimoSorteio;
  if (!sorteio) return;
  // Deep copy times
  editTimesState = timesToArr(sorteio.times, sorteio.timesCount).map(t => [...t]);
  renderEdicaoTimes();
  openModal('modalEditTimes');
}

function renderEdicaoTimes() {
  const cont = document.getElementById('editTimesContent');
  if (!cont) return;
  const nT = editTimesState.length;
  const dotColors = ['#22c55e','#eab308','#3b82f6','#ef4444'];
  cont.innerHTML = editTimesState.map((tm, ti) => `
    <div class="card" style="margin-bottom:10px;border-color:var(--border-gold)">
      <div class="t-name" style="font-size:13px;margin-bottom:8px"><div style="width:8px;height:8px;border-radius:50%;background:${dotColors[ti]};flex-shrink:0;display:inline-block;margin-right:6px"></div>Time ${ti+1}</div>
      ${tm.map((id, pi) => {
        const j = appData.jogadores.find(x=>x.id===id);
        const opts = timesToArr(appData.ultimoSorteio.times, appData.ultimoSorteio.timesCount).flat().map(pid => {
          const pj = appData.jogadores.find(x=>x.id===pid);
          return `<option value="${pid}" ${pid===id?'selected':''}>${pj?.nome||pid}</option>`;
        }).join('');
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <select class="input" style="flex:1;padding:6px 10px;font-size:12px" onchange="moverJogador(${ti},${pi},this.value)">
            ${opts}
          </select>
        </div>`;
      }).join('')}
    </div>`).join('');
}

function moverJogador(timeIdx, posIdx, novoId) {
  // Swap: find where novoId currently is and swap
  const antigoId = editTimesState[timeIdx][posIdx];
  if (antigoId === novoId) return;
  let found = false;
  for (let t = 0; t < editTimesState.length; t++) {
    const p = editTimesState[t].indexOf(novoId);
    if (p >= 0) { editTimesState[t][p] = antigoId; found = true; break; }
  }
  editTimesState[timeIdx][posIdx] = novoId;
  renderEdicaoTimes();
}

async function salvarEdicaoTimes() {
  if (!currentUser?.isAdmin) return;
  const sorteio = appData.ultimoSorteio;
  // Convert back to Firestore-compatible object
  const timesObjEdit = {};
  const nomesObjEdit = {};
  editTimesState.forEach((t, i) => {
    timesObjEdit['t' + i] = t;
    nomesObjEdit['t' + i] = t.map(id => {
      const j = appData.jogadores.find(x=>x.id===id);
      return j?.nome || id;
    });
  });
  sorteio.times = timesObjEdit;
  sorteio.timesCount = editTimesState.length;
  sorteio.nomes = nomesObjEdit;
  await firestoreSet('config', 'ultimoSorteio', sorteio);
  appData.ultimoSorteio = sorteio;
  saveLocal();
  closeModal('modalEditTimes');
  renderHome();
  showToast('Times atualizados! ✅');
}

// ─── HOME admin actions (cancelar / concluir) ─────────────────
async function cancelarPartidaHome() {
  if (!currentUser?.isAdmin) return;
  if (!confirm('Cancelar partida? Os times e a lista de presença serão removidos.')) return;
  await firestoreDelete('config', 'ultimoSorteio');
  await firestoreDelete('config', 'presenca');
  appData.ultimoSorteio = null;
  appData.presenca = null;
  saveLocal();
  renderHome();
  showToast('Partida cancelada');
}

async function concluirPartidaHome() {
  if (!currentUser?.isAdmin) return;
  const sorteio = appData.ultimoSorteio;
  if (!sorteio) return;
  // Load flow data from current sorteio to proceed to ausentes/stats
  const sorteioArr = timesToArr(sorteio.times, sorteio.timesCount);
  flow = {
    step: 'ausentes',
    presentes: sorteioArr.flat(),
    times: sorteioArr,
    data: sorteio.data,
    ausentes: [],
    statsIdx: 0,
    statsOrder: [],
    statsData: {}
  };
  renderFlow();
  document.getElementById('flow').style.display = 'block';
}

// ─── STATS STEP ───────────────────────────────────────────────
function renderStatsStep(c) {
  const order=flow.statsOrder,idx=flow.statsIdx,total=order.length;
  if(idx>=total){
    if(!flow._saving){
      flow._saving=true;
      flow.step='saving'; // prevent renderFlow from re-entering stats
      // Show saving indicator
      c.innerHTML=`<div style="text-align:center;padding:40px 20px">
        <div class="spin" style="margin:0 auto 16px"></div>
        <div style="font-family:'Oswald',sans-serif;font-size:18px;letter-spacing:2px;color:var(--gold-lt)">SALVANDO...</div>
        <div style="font-size:12px;color:var(--t2);margin-top:8px">Aguarde enquanto as estatísticas são salvas</div>
      </div>`;
      salvarStats();
    }
    return;
  }
  const id=order[idx];
  const j=appData.jogadores.find(x=>x.id===id);
  const ti=flow.times.findIndex(t=>t.includes(id));
  const d=flow.statsData[id];
  const pct=Math.round(idx/total*100);
  c.innerHTML=`
    <div class="prog"><div class="prog-fill" style="width:${pct}%"></div></div>
    <div class="stats-hero">
      <div class="stats-hero-name">${j?.nome||id}</div>
      <div class="stats-hero-team">${T_NAMES[ti]||''}</div>
    </div>
    <div class="stat-grid">
      ${['gols','assists','vitorias'].map((f,fi)=>`
      <div class="stat-box">
        <div class="stat-lbl">${['⚽ Gols','🎯 Assists','🏆 Vitórias'][fi]}</div>
        <div class="counter">
          <button class="cnt-btn" onclick="chgS('${f}',-1)">−</button>
          <div class="cnt-v" id="sv-${f}">${d[f]}</div>
          <button class="cnt-btn" onclick="chgS('${f}',1)">+</button>
        </div>
      </div>`).join('')}
    </div>
    <div class="row">
      ${idx>0?`<button class="btn btn-ghost" onclick="statsB()">← ANTERIOR</button>`:''}
      <button class="btn btn-gold" style="flex:${idx>0?1:2}" onclick="statsN()">
        ${idx<total-1?'PRÓXIMO →':'✅ SALVAR TUDO'}
      </button>
    </div>`;
}
function chgS(f,d){const id=flow.statsOrder[flow.statsIdx];flow.statsData[id][f]=Math.max(0,flow.statsData[id][f]+d);document.getElementById('sv-'+f).textContent=flow.statsData[id][f];}
function statsN(){flow.statsIdx++;renderFlow();}
function statsB(){flow.statsIdx--;renderFlow();}

async function salvarStats() {
  const data = flow.data;
  const todosNoSorteio = flow.times.flat();
  const peladaJogadores = [];

  for (const id of todosNoSorteio) {
    const j = appData.jogadores.find(x => x.id === id);
    if (!j) continue;
    if (!j.domingos) j.domingos = [];
    const ausente = flow.ausentes.includes(id);
    if (ausente) {
      j.domingos.push({ data, ausente: true, gols: 0, assists: 0, vitorias: 0 });
      peladaJogadores.push({ id, nome: j.nome, gols:0, assists:0, vitorias:0, scoreDia:0, ausente:true });
    } else {
      const stats = flow.statsData[id] || { gols: 0, assists: 0, vitorias: 0 };
      j.domingos.push({ data, gols: stats.gols, assists: stats.assists, vitorias: stats.vitorias });
      const scoreDia = +(stats.gols + stats.assists + W_VIT * stats.vitorias).toFixed(4);
      peladaJogadores.push({ id, nome: j.nome, gols:stats.gols, assists:stats.assists, vitorias:stats.vitorias, scoreDia, ausente:false });
    }
    await firestoreSet('jogadores', id, j);
  }

  // Rank presentes by scoreDia to get top-3 nominees for MVP vote
  const presentes = peladaJogadores.filter(j => !j.ausente)
    .sort((a,b) => {
      if (b.scoreDia !== a.scoreDia) return b.scoreDia - a.scoreDia;
      if (b.gols !== a.gols) return b.gols - a.gols;
      if (b.assists !== a.assists) return b.assists - a.assists;
      return b.vitorias - a.vitorias;
    });

  // Top-3 with score > 0 become nominees (can be fewer if less than 3 scored)
  const nominees = presentes.filter(p => p.scoreDia > 0).slice(0, 3);

  // Create pelada record (MVP will be filled after vote)
  const peladaId = 'pelada_' + Date.now();
  const elapsesAt = Date.now() + 24 * 60 * 60 * 1000; // 24h from now
  const elegiveisVotar = presentes.map(p => p.id); // only players who played can vote

  // Convert nested arrays to Firestore-compatible objects
  const timesObjRec = {};
  flow.times.forEach((t, i) => { timesObjRec['t' + i] = t; });

  const peladaRec = {
    id: peladaId,
    data,
    savedAt: Date.now(),
    times: timesObjRec,
    jogadores: peladaJogadores,
    mvp: null,
    podio: null,
    votacao: nominees.length > 0 ? {
      status: 'aberta',        // 'aberta' | 'encerrada'
      nominees: nominees.map(n => ({ id: n.id, nome: n.nome, scoreDia: n.scoreDia, gols: n.gols, assists: n.assists, vitorias: n.vitorias })),
      votos: {},               // { jogadorId: nomineeId }
      elegiveisVotar,          // ids who are allowed to vote
      elapsesAt,               // timestamp 24h after save
    } : null
  };

  // Save to Firebase ONLY — onSnapshot will update appData.peladasHist automatically
  // Do NOT push locally here to avoid duplication when onSnapshot fires
  await firestoreSet('peladasHist', peladaId, peladaRec);
  if (!appData.peladasHist) appData.peladasHist = [];
  // Only add locally if not already there (guard against double-call)
  if (!appData.peladasHist.find(x => x.id === peladaId)) {
    appData.peladasHist.push(peladaRec);
  }

  // If no nominees (everyone scored 0), just save podium from score sort
  if (nominees.length === 0) {
    await finalizarVotacao(peladaId, peladaRec, true);
  }

  // Check no-shows: confirmed but not in statsOrder (absent)
  const presenca = appData.presenca;
  if (presenca?.confirmados) {
    for (const id of presenca.confirmados) {
      const ausente = flow.ausentes.includes(id);
      if (ausente) {
        const multaNoShow = jogadorMensalista(id) ? 10 : 25;
        await adicionarDebito(id, 'multa', multaNoShow, `Faltou sem desmarcar — Pelada ${data}`);
      }
    }
  }
  // Clear presença
  await firestoreDelete('config', 'presenca');
  appData.presenca = null;

  await firestoreDelete('config', 'ultimoSorteio');
  appData.ultimoSorteio = null;
  saveLocal();
  document.getElementById('flow').style.display = 'none';

  if (nominees.length > 0) {
    showToast('📊 Estatísticas salvas! Votação MVP aberta por 24h ⭐');
  } else {
    showToast('Partida concluída! Estatísticas salvas 🎉');
  }
  goTo('home');
}

// ─── VOTAÇÃO MVP ─────────────────────────────────────────────
async function votarMvp(peladaId, nomineeId) {
  if (!currentUser || currentUser.isGuest) { showToast('Você precisa estar logado para votar'); return; }
  const p = (appData.peladasHist||[]).find(x=>x.id===peladaId);
  if (!p || !p.votacao || p.votacao.status !== 'aberta') { showToast('Votação não está aberta'); return; }
  if (!p.votacao.elegiveisVotar.includes(currentUser.id)) { showToast('Só quem jogou pode votar'); return; }
  if (p.votacao.votos[currentUser.id]) { showToast('Você já votou!'); return; }
  // Cannot vote for yourself
  if (nomineeId === currentUser.id) { showToast('Você não pode votar em si mesmo'); return; }

  p.votacao.votos[currentUser.id] = nomineeId;
  await firestoreSet('peladasHist', peladaId, p);

  // Check if all eligible players voted (excluding nominees if they can't self-vote,
  // but actually nominees CAN vote for other nominees)
  const totalElegiveis = p.votacao.elegiveisVotar.length;
  const totalVotos = Object.keys(p.votacao.votos).length;
  if (totalVotos >= totalElegiveis) {
    await finalizarVotacao(peladaId, p, false);
  } else {
    showToast(`Voto registrado! (${totalVotos}/${totalElegiveis})`);
    renderPeladasHistorico();
    // Refresh detalhe modal if open
    if (document.getElementById('modalPeladaDetalhe').classList.contains('open')) {
      openPeladaDetalhe(peladaId);
    }
  }
}

async function finalizarVotacao(peladaId, p, semNominees) {
  if (!semNominees && p.votacao) {
    // Count votes
    const contagem = {};
    for (const v of Object.values(p.votacao.votos)) {
      contagem[v] = (contagem[v]||0) + 1;
    }
    // Find nominee with most votes; tie-break by scoreDia
    const vencedor = p.votacao.nominees.sort((a,b) => {
      const va = contagem[a.id]||0, vb = contagem[b.id]||0;
      if (vb !== va) return vb - va;
      return b.scoreDia - a.scoreDia;
    })[0];
    p.mvp = vencedor || null;
    p.votacao.status = 'encerrada';
  }

  // Build podium: top-3 by scoreDia among presentes (independent of vote)
  const presentes = (p.jogadores||[]).filter(j=>!j.ausente)
    .sort((a,b) => {
      if (b.scoreDia !== a.scoreDia) return b.scoreDia - a.scoreDia;
      if (b.gols !== a.gols) return b.gols - a.gols;
      if (b.assists !== a.assists) return b.assists - a.assists;
      return b.vitorias - a.vitorias;
    });

  p.podio = {
    primeiro:  presentes[0] || null,
    segundo:   presentes[1] || null,
    terceiro:  presentes[2] || null,
  };

  // Award MVP (1st place in vote) on player record
  if (p.mvp) {
    const jMvp = appData.jogadores.find(x => x.id === p.mvp.id);
    if (jMvp) {
      jMvp.mvps = (jMvp.mvps || 0) + 1;
      const lastDom = jMvp.domingos[jMvp.domingos.length - 1];
      if (lastDom) lastDom.mvp = true;
      await firestoreSet('jogadores', jMvp.id, jMvp);
    }
  }

  await firestoreSet('peladasHist', peladaId, p);
  // Update local
  const idx = (appData.peladasHist||[]).findIndex(x=>x.id===peladaId);
  if (idx>=0) appData.peladasHist[idx] = p;
  saveLocal();

  showToast(p.mvp ? `⭐ MVP: ${p.mvp.nome}! Votação encerrada.` : 'Votação encerrada!');
  renderPeladasHistorico();
  if (document.getElementById('modalPeladaDetalhe').classList.contains('open')) {
    openPeladaDetalhe(peladaId);
  }
}

// Auto-close expired votacoes on load
async function checkVotacoesExpiradas() {
  const peladas = appData.peladasHist || [];
  for (const p of peladas) {
    if (p.votacao?.status === 'aberta' && Date.now() > p.votacao.elapsesAt) {
      await finalizarVotacao(p.id, p, false);
    }
  }
}

// ─── FINANCAS SCREEN ─────────────────────────────────────────
function renderFinancas() {
  const cont = document.getElementById('sc-financas');
  if (!cont) return;

  const periodo = getPeriodoMensalidade();
  const prazo5du = periodo.prazo;
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  const atrasado5du = semanasAtraso5du() > 0;
  const prazoStr = periodo.prazoPt;
  const inicioStr = periodo.inicioPt;

  const jogadores = appData.jogadores;
  const isAdmin = currentUser?.isAdmin;

  // Build financial status for each player
  const rows = jogadores.map(j => {
    const saldo = totalDebitoJogador(j.id);
    const fin = getFinancasJogador(j.id);
    const mensalista = jogadorMensalista(j.id);
    const debitos = (fin.debitos||[]);
    const multas = debitos.filter(d=>d.tipo==='multa');
    const mensais = debitos.filter(d=>d.tipo==='mensal');
    const avulsos = debitos.filter(d=>d.tipo==='avulso');
    return { j, saldo, fin, mensalista, multas, mensais, avulsos, debitos };
  }).sort((a,b) => b.saldo - a.saldo); // most indebted first

  const inadimplentes = rows.filter(r => r.saldo > 0);
  const emDia = rows.filter(r => r.saldo <= 0);

  const semanas = semanasAtraso5du();
  // Só mostra atraso se há mensalistas COM mensalidade não paga
  const mensalistasComDebito = jogadores.filter(j =>
    jogadorMensalista(j.id) && (() => {
      const fin = getFinancasJogador(j.id);
      const totalMensais = (fin.debitos||[]).filter(d=>d.tipo==='mensal').reduce((s,d)=>s+(d.valor||0),0);
      const totalPago = (fin.pagamentos||[]).reduce((s,p)=>s+(p.valor||0),0);
      return totalMensais > totalPago;
    })()
  );
  const temInadimplenteMensal = mensalistasComDebito.length > 0;
  const mostrarAtraso = semanas > 0 && temInadimplenteMensal;
  const corAviso = atrasado5du && temInadimplenteMensal ? 'rgba(255,68,68,.1)' : 'rgba(201,168,76,.08)';
  const corBorda = atrasado5du && temInadimplenteMensal ? 'rgba(255,68,68,.3)' : 'var(--border-gold)';
  const corTexto = atrasado5du && temInadimplenteMensal ? '#ef4444' : 'var(--gold-lt)';
  const icone = atrasado5du && temInadimplenteMensal ? '⚠️' : '📅';
  const avisoAtrasado = mostrarAtraso ? ` — ${semanas} sem. em atraso (+R$${(semanas*5).toFixed(0)})` : '';
  const aviso5du = `<div style="background:${corAviso};border:1px solid ${corBorda};border-radius:10px;padding:12px 14px;margin-bottom:16px">
    <div style="font-size:13px;font-weight:700;color:${corTexto}">${icone} MENSALISTAS: Período ${inicioStr} → ${prazoStr}${avisoAtrasado}</div>
    <div style="font-size:11px;color:var(--t2);margin-top:3px">R$80,00 via Pix: mfnassif16@gmail.com · Vencimento: ${prazoStr}</div>
    ${isAdmin ? `<button onclick="gerarMensalidadesMes()" style="margin-top:8px;background:var(--gold-dim);border:1px solid var(--border-gold);border-radius:8px;color:var(--gold);font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:1px;padding:6px 14px;cursor:pointer;width:100%">📋 GERAR MENSALIDADES DO MÊS</button>` : ''}
  </div>`;

  const renderRow = (r) => {
    const { j, saldo, fin, mensalista, multas, avulsos, mensais, debitos } = r;
    const cor = saldo > 0 ? '#ef4444' : '#22c55e';
    const outros = debitos.filter(d=>d.tipo==='outro');
    const debitosDesc = [
      ...mensais.map(d=>`Mensalidade ${d.data}: R$${(+d.valor).toFixed(2)}`),
      ...avulsos.map(d=>`Avulso ${d.descricao} (${d.data||''}): R$${(+d.valor).toFixed(2)}`),
      ...multas.map(d=>`Multa ${d.data}: R$${d.valor} — ${d.descricao}`),
      ...outros.map((d,i)=>`${d.descricao||'Outro'} (${d.data}): R$${d.valor.toFixed(2)}`)
    ].join('<br>');

    return `
    <div class="card" style="margin-bottom:8px;${saldo>0?'border-color:rgba(255,68,68,.25)':''}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:${saldo>0?8:0}px">
        <div class="p-avatar" style="${j.foto?'padding:0;overflow:hidden':''}">${j.foto?`<img src="${j.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:j.nome[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-weight:500;font-size:13px">${j.nome} ${mensalista?'<span style="font-size:9px;background:var(--gold-dim);border:1px solid var(--border-gold);color:var(--gold);padding:1px 6px;border-radius:4px">MENSAL</span>':'<span style="font-size:9px;background:var(--s3);color:var(--t2);padding:1px 6px;border-radius:4px">AVULSO</span>'}</div>
          <div style="font-size:11px;color:var(--t2);margin-top:2px">${debitosDesc || 'Sem débitos'}</div>
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:${cor}">${saldo>0?'R$'+saldo.toFixed(2):'Em dia ✅'}</div>
      </div>
      ${isAdmin ? `
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        ${saldo > 0 ? `<button class="btn btn-gold" style="flex:1;font-size:12px;padding:8px;min-width:90px" onclick="abrirDarBaixa('${j.id}')">💰 DAR BAIXA</button>` : ''}
        <button class="btn btn-ghost" style="flex:1;font-size:12px;padding:8px;min-width:90px" onclick="abrirAddDebito('${j.id}')">+ DÉBITO</button>
        <button class="btn btn-ghost" style="flex:1;font-size:12px;padding:8px;min-width:90px" onclick="abrirEditarDebitos('${j.id}')">✏️ EDITAR</button>
      </div>` : ''}
    </div>`;
  };

  // Render inside the screen
  const inner = cont.querySelector('#financasInner');
  if (!inner) return;
  inner.innerHTML = `
    ${aviso5du}
    ${inadimplentes.length > 0 ? `
      <div class="section-lbl">EM ABERTO (${inadimplentes.length})</div>
      ${inadimplentes.map(renderRow).join('')}` : ''}
    ${emDia.length > 0 ? `
      <div class="section-lbl" style="margin-top:12px">EM DIA (${emDia.length})</div>
      ${emDia.map(renderRow).join('')}` : ''}
  `;
}

function abrirDarBaixa(jogadorId) {
  const j = appData.jogadores.find(x=>x.id===jogadorId);
  const fin = getFinancasJogador(jogadorId);
  const saldo = totalDebitoJogador(jogadorId);
  const debitos = (fin.debitos||[]);
  // Build list of unpaid debts
  const totalPago = (fin.pagamentos||[]).reduce((s,p)=>s+(p.valor||0),0);
  let acumulado = 0;
  const debitosAbertos = debitos.map((d,i) => {
    const desc = d.descricao || d.tipo;
    return { i, desc, valor: d.valor, data: d.data, tipo: d.tipo };
  });

  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'modalDarBaixa';
  overlay.innerHTML = `
    <div class="modal">
      <div class="mhandle"></div>
      <div class="m-title">DAR BAIXA</div>
      <div class="m-sub">${j?.nome} · Saldo devedor: R$${saldo.toFixed(2)}</div>
      <div class="field">
        <label>Selecione o débito</label>
        <select class="input" id="baixaDebitoIdx" onchange="atualizarValorBaixa('${jogadorId}')">
          <option value="-1">— Escolha um débito —</option>
          ${debitosAbertos.map(d => `<option value="${d.i}">${d.desc} — R$${d.valor.toFixed(2)} (${d.data})</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Valor pago (R$)</label>
        <input class="input" id="baixaValor" type="number" step="0.01" min="0" placeholder="80.00">
      </div>
      <div class="field">
        <label>Data do pagamento</label>
        <input class="input" id="baixaDataPag" type="date" value="${new Date().toISOString().split('T')[0]}">
      </div>
      <button class="btn btn-gold" onclick="executarBaixa('${jogadorId}')">REGISTRAR PAGAMENTO</button>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalDarBaixa').remove()">CANCELAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function atualizarValorBaixa(jogadorId) {
  const sel = document.getElementById('baixaDebitoIdx');
  const idx = parseInt(sel?.value);
  if (isNaN(idx) || idx < 0) return;
  const fin = getFinancasJogador(jogadorId);
  const debito = fin.debitos?.[idx];
  if (debito) document.getElementById('baixaValor').value = debito.valor.toFixed(2);
}

async function executarBaixa(jogadorId) {
  const sel = document.getElementById('baixaDebitoIdx');
  const idx = parseInt(sel?.value);
  if (isNaN(idx) || idx < 0) { showToast('Selecione um débito'); return; }
  const val = parseFloat(document.getElementById('baixaValor')?.value);
  const dataInput = document.getElementById('baixaDataPag')?.value;
  if (isNaN(val) || val <= 0) { showToast('Valor inválido'); return; }
  const fin = getFinancasJogador(jogadorId);
  const debito = fin.debitos?.[idx];
  if (!debito) { showToast('Débito não encontrado'); return; }
  const dataFmt = dataInput
    ? new Date(dataInput + 'T12:00:00').toLocaleDateString('pt-BR')
    : new Date().toLocaleDateString('pt-BR');
  const desc = `Baixa: ${debito.descricao || debito.tipo}`;
  await darBaixaComData(jogadorId, val, desc, dataFmt);
  document.getElementById('modalDarBaixa')?.remove();
  renderFinancas();
  showToast('Pagamento registrado ✅');
}

function abrirAddDebito(jogadorId) {
  const j = appData.jogadores.find(x=>x.id===jogadorId);
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'modalAddDebito';
  overlay.innerHTML = `
    <div class="modal">
      <div class="mhandle"></div>
      <div class="m-title">ADICIONAR DÉBITO</div>
      <div class="m-sub">${j?.nome}</div>
      <div class="field"><label>Tipo</label>
        <select class="input" id="debitoTipo">
          <option value="mensal">Mensalidade (R$80)</option>
          <option value="avulso">Avulso (R$25)</option>
          <option value="multa">Multa (R$10)</option>
          <option value="outro">Outro</option>
        </select>
      </div>
      <div class="field"><label>Valor (R$)</label><input class="input" id="debitoValor" type="number" step="0.01" min="0" placeholder="80.00"></div>
      <div class="field"><label>Descrição</label><input class="input" id="debitoDesc" placeholder="Mensalidade março"></div>
      <div class="field"><label>Data</label><input class="input" id="debitoData" type="date"></div>
      <button class="btn btn-gold" onclick="executarAddDebito('${jogadorId}')">ADICIONAR</button>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalAddDebito').remove()">CANCELAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  // Auto-fill valor by tipo
  overlay.querySelector('#debitoTipo').addEventListener('change', e => {
    const vals = {mensal:80, avulso:25, multa:10, outro:''};
    overlay.querySelector('#debitoValor').value = vals[e.target.value] || '';
  });
  overlay.querySelector('#debitoValor').value = 80;
  // Set today as default date
  const today = new Date().toISOString().split('T')[0];
  overlay.querySelector('#debitoData').value = today;
  document.body.appendChild(overlay);
}

async function executarAddDebito(jogadorId) {
  const tipo = document.getElementById('debitoTipo')?.value;
  const val = parseFloat(document.getElementById('debitoValor')?.value);
  const desc = document.getElementById('debitoDesc')?.value?.trim();
  const dataInput = document.getElementById('debitoData')?.value;
  if (isNaN(val) || val <= 0) { showToast('Valor inválido'); return; }
  // Convert date input (yyyy-mm-dd) to pt-BR format
  const dataFmt = dataInput
    ? new Date(dataInput + 'T12:00:00').toLocaleDateString('pt-BR')
    : new Date().toLocaleDateString('pt-BR');
  await adicionarDebitoComData(jogadorId, tipo, val, desc || tipo, dataFmt);
  document.getElementById('modalAddDebito')?.remove();
  renderFinancas();
  showToast('Débito adicionado');
}

function abrirEditarDebitos(jogadorId) {
  if (!currentUser?.isAdmin) return;
  const j = appData.jogadores.find(x=>x.id===jogadorId);
  const fin = getFinancasJogador(jogadorId);
  const debitos = fin.debitos || [];
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'modalEditDebitos';
  overlay.innerHTML = `
    <div class="modal">
      <div class="mhandle"></div>
      <div class="m-title">DÉBITOS</div>
      <div class="m-sub">${j?.nome}</div>
      <div id="editDebitosLista">
        ${debitos.length === 0 ? '<div style="color:var(--t3);text-align:center;padding:16px">Nenhum débito</div>' :
          debitos.map((d,i) => `
          <div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
            <div style="flex:1">
              <div style="font-size:12px;font-weight:500">${d.descricao || d.tipo}</div>
              <div style="font-size:11px;color:var(--t2)">${d.data} · R$${d.valor}</div>
            </div>
            <button onclick="removerDebitoIdx('${jogadorId}',${i})" style="background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);border-radius:6px;color:var(--red);padding:4px 10px;cursor:pointer;font-size:12px">Remover</button>
          </div>`).join('')}
      </div>
      <div class="section-lbl" style="margin-top:14px;margin-bottom:8px">PAGAMENTOS</div>
      <div>
        ${(fin.pagamentos||[]).map((p,i) => `
          <div style="background:rgba(34,197,94,.05);border:1px solid rgba(34,197,94,.15);border-radius:8px;padding:8px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
            <div style="flex:1"><div style="font-size:12px">✅ ${p.descricao}</div><div style="font-size:11px;color:var(--t2)">${p.data} · R$${p.valor}</div></div>
            <button onclick="removerPagamentoIdx('${jogadorId}',${i})" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:16px">×</button>
          </div>`).join('') || '<div style="color:var(--t3);font-size:12px">Nenhum pagamento</div>'}
      </div>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalEditDebitos').remove()">FECHAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function removerDebitoIdx(jogadorId, idx) {
  const fin = getFinancasJogador(jogadorId);
  if (!fin.debitos || !fin.debitos[idx]) return;
  const debito = fin.debitos[idx];
  // Find associated payment (baixa) by matching description
  const descBaixa = `Baixa: ${debito.descricao || debito.tipo}`;
  const pagIdx = (fin.pagamentos||[]).findIndex(p => p.descricao === descBaixa);
  const temPagamento = pagIdx >= 0;
  let removerPag = false;
  if (temPagamento) {
    removerPag = confirm(`Este débito tem uma baixa associada de R$${fin.pagamentos[pagIdx].valor}. Remover também o pagamento?`);
  }
  fin.debitos.splice(idx, 1);
  if (removerPag && pagIdx >= 0) {
    fin.pagamentos.splice(pagIdx, 1);
  }
  appData.financas[jogadorId] = fin;
  await firestoreSet('financas', jogadorId, fin);
  saveLocal();
  document.getElementById('modalEditDebitos')?.remove();
  abrirEditarDebitos(jogadorId);
  renderFinancas();
}

async function removerPagamentoIdx(jogadorId, idx) {
  const fin = getFinancasJogador(jogadorId);
  if (!fin.pagamentos || !fin.pagamentos[idx]) return;
  fin.pagamentos.splice(idx, 1);
  appData.financas[jogadorId] = fin;
  await firestoreSet('financas', jogadorId, fin);
  saveLocal();
  document.getElementById('modalEditDebitos')?.remove();
  abrirEditarDebitos(jogadorId);
  renderFinancas();
}

// ─── GERAR MENSALIDADES (admin) ──────────────────────────────
function getUltimo5du() {
  // Returns the 5du of the REFERENCE month (same month as getMesReferencia)
  const hoje = new Date();
  const mesHoje = hoje.getMonth();
  const anoHoje = hoje.getFullYear();
  const dia5duAtual = calc5DiasUteis(mesHoje, anoHoje);
  const prazoAtual = new Date(anoHoje, mesHoje, dia5duAtual);
  prazoAtual.setHours(23, 59, 59, 999);
  hoje.setHours(0, 0, 0, 0);
  if (hoje > prazoAtual) {
    // Past current month's 5du — use NEXT month's 5du
    const proxMes = mesHoje === 11 ? 0 : mesHoje + 1;
    const proxAno = mesHoje === 11 ? anoHoje + 1 : anoHoje;
    const dia5duProx = calc5DiasUteis(proxMes, proxAno);
    return new Date(proxAno, proxMes, dia5duProx).toLocaleDateString('pt-BR');
  }
  return new Date(anoHoje, mesHoje, dia5duAtual).toLocaleDateString('pt-BR');
}

async function gerarMensalidadesMes() {
  if (!currentUser?.isAdmin) return;
  const mes = getMesReferencia();
  const data5du = getUltimo5du();
  if (!confirm(`Gerar débito de mensalidade (R$80) para todos os mensalistas — ${mes}?`)) return;
  const mensalistas = appData.jogadores.filter(j => j.tipoJogador === 'mensalista');
  let count = 0;
  for (const j of mensalistas) {
    const fin = getFinancasJogador(j.id);
    const jaTemEsseMes = (fin.debitos||[]).some(d => d.tipo==='mensal' && d.descricao?.includes(mes));
    if (!jaTemEsseMes) {
      await adicionarDebitoComData(j.id, 'mensal', 80, `Mensalidade ${mes}`, data5du);
      count++;
    }
  }
  renderFinancas();
  showToast(`Mensalidades geradas: ${count} jogadores`);
}
window.gerarMensalidadesMes = gerarMensalidadesMes;
window.checkMensalidadeAtual = checkMensalidadeAtual;
window.abrirEditarNota = abrirEditarNota;
window.atualizarValorBaixa = atualizarValorBaixa;
window.salvarNotaEdit = salvarNotaEdit;
window.toggleAdminPerfil = toggleAdminPerfil;
window.toggleMensalistaPerfil = toggleMensalistaPerfil;

// ─── TIPO JOGADOR (mensalista/avulso) — managed by admin ─────
async function setTipoJogador(jogadorId, tipo) {
  if (!currentUser?.isAdmin) return;
  const mensalistas = appData.jogadores.filter(j => j.tipoJogador === 'mensalista');
  if (tipo === 'mensalista' && mensalistas.length >= 15) {
    showToast('Limite de 15 mensalistas atingido'); return;
  }
  const j = appData.jogadores.find(x => x.id === jogadorId);
  if (!j) return;
  j.tipoJogador = tipo;
  await firestoreSet('jogadores', jogadorId, j);
  saveLocal();
  renderFinancas();
  showToast(`${j.nome} → ${tipo}`);
}

// ─── EXPORT ──────────────────────────────────────────────────
function exportarExcel() {
  const idxMap=Object.fromEntries(calcIdx(appData.jogadores).map(i=>[i.id,i]));
  let csv='Nome,Nota Opinativa,Rating Final,Score Ajustado,Alpha,Domingos,Gols,Assists,Vitórias\n';
  for(const j of appData.jogadores){
    const ix=idxMap[j.id],nd=nDom(j);
    const tg=j.domingos.reduce((s,d)=>s+(d.gols||0),0);
    const ta=j.domingos.reduce((s,d)=>s+(d.assists||0),0);
    const tv=j.domingos.reduce((s,d)=>s+(d.vitorias||0),0);
    csv+=`${j.nome},${j.nota?.toFixed(1)},${ix&&nd>0?ix.IF.toFixed(4):'—'},${ix&&nd>0?ix.sAdj.toFixed(4):'—'},${ix&&nd>0?ix.alpha.toFixed(4):'—'},${nd},${tg},${ta},${tv}\n`;
  }
  csv+='\n\nHISTÓRICO\nData,Jogador,Gols,Assists,Vitórias,Score,Ausente\n';
  for(const j of appData.jogadores)
    for(const d of j.domingos)
      csv+=`${d.data},${j.nome},${d.gols||0},${d.assists||0},${d.vitorias||0},${d.ausente?'0':scoreRaw(d.gols||0,d.assists||0,d.vitorias||0).toFixed(4)},${d.ausente?'SIM':'NÃO'}\n`;
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`pelada_${new Date().toISOString().slice(0,10)}.csv`;a.click();
  URL.revokeObjectURL(url);showToast('Exportado! 📊');
}

async function confirmReset() {
  if(!currentUser?.isAdmin) return;
  if(!confirm('Resetar TUDO? Irreversível.')) return;
  if(!confirm('Tem certeza absoluta?')) return;
  appData.jogadores=[];appData.restricoes=[];appData.admins=[currentUser.id];
  if(useFirebase&&db_fire){
    const[js,rs]=await Promise.all([getDocs(collection(db_fire,'jogadores')),getDocs(collection(db_fire,'restricoes'))]);
    await Promise.all([...js.docs.map(d=>deleteDoc(d.ref)),...rs.docs.map(d=>deleteDoc(d.ref))]);
    await firestoreSet('config','admins',{list:[currentUser.id]});
    try { await firestoreDelete('config','ultimoSorteio'); } catch(e) {}
  }
  saveLocal();renderHome();showToast('Dados resetados');
}

// ─── LOGOUT ──────────────────────────────────────────────────
function sairDaConta() {
  if (!confirm('Sair da conta?')) return;
  localStorage.removeItem(LS_USER);
  currentUser = null;
  document.getElementById('appShell').style.display = 'none';
  showLogin(true);
  document.getElementById('loginNome').value = '';
}
window.sairDaConta = sairDaConta;
window.abrirUploadFoto = abrirUploadFoto;
window.confirmarSenha = confirmarSenha;
window.voltarLogin = voltarLogin;

// ─── TOAST ───────────────────────────────────────────────────
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600);}

// ─── EXPOSE ──────────────────────────────────────────────────
window.salvarFirebaseConfig=salvarFirebaseConfig;
window.usarSemFirebase=usarSemFirebase;
window.entrar=entrar;
window.goTo=goTo;
window.startFlow=startFlow;
window.closeFlow=closeFlow;
window.openCadastro=openCadastro;
window.salvarJogador=salvarJogador;
window.removerJog=removerJog;
window.openPerfil=openPerfil;
window.openPerfilProprio=openPerfilProprio;
window.abrirNovoDomingo=abrirNovoDomingo;
window.abrirEditDomingo=abrirEditDomingo;
window.salvarEditDomingo=salvarEditDomingo;
window.removerDomingo=removerDomingo;
window.executarRemoverDomingo=executarRemoverDomingo;
window.executarRemoverDomingo=executarRemoverDomingo;
window.openModal=openModal;
window.closeModal=closeModal;
window.updateAlea=updateAlea;
window.setRT=setRT;
window.setRD=setRD;
window.addRestricao=addRestricao;
window.removerRest=removerRest;
window.toggleAdmin=toggleAdmin;
window.toggleP=toggleP;
window.toggleAusente=toggleAusente;
window.confirmarPresentes=confirmarPresentes;
window.confirmarAusentes=confirmarAusentes;
window.resortear=resortear;
window.cancelarSorteio=cancelarSorteio;
window.confirmarTimes=confirmarTimes;
window.cancelarPartidaHome=cancelarPartidaHome;
window.concluirPartidaHome=concluirPartidaHome;
window.chgS=chgS;
window.statsN=statsN;
window.statsB=statsB;
window.exportarExcel=exportarExcel;
window.confirmReset=confirmReset;
window.setRankStat=setRankStat;
window.setRankDir=setRankDir;
window.confirmarDataSorteio=confirmarDataSorteio;
window.votarMvp=votarMvp;

async function encerrarVotacaoForce(peladaId) {
  if (!currentUser?.isAdmin) return;
  if (!confirm('Encerrar a votação MVP agora?')) return;
  const p = (appData.peladasHist||[]).find(x=>x.id===peladaId);
  if (!p || p.votacao?.status !== 'aberta') return;
  await finalizarVotacao(peladaId, p, false);
  closeModal('modalPeladaDetalhe');
  showToast('Votação encerrada! ✅');
}
window.encerrarVotacaoForce = encerrarVotacaoForce;
window.checkVotacoesExpiradas=checkVotacoesExpiradas;
window.confirmarPresenca=confirmarPresenca;
window.desmarcarPresenca=desmarcarPresenca;
window.abrirDarBaixa=abrirDarBaixa;
window.executarBaixa=executarBaixa;
window.abrirAddDebito=abrirAddDebito;
window.executarAddDebito=executarAddDebito;
window.setTipoJogador=setTipoJogador;
window.abrirNovoComunicado=abrirNovoComunicado;
window.salvarComunicado=salvarComunicado;
window.removerComunicado=removerComunicado;
window.abrirEditarDebitos=abrirEditarDebitos;
window.removerDebitoIdx=removerDebitoIdx;
window.removerPagamentoIdx=removerPagamentoIdx;
window.abrirEdicaoTimes=abrirEdicaoTimes;
window.moverJogador=moverJogador;
window.salvarEdicaoTimes=salvarEdicaoTimes;
window.abrirMudarSenha=abrirMudarSenha;
window.salvarNovaSenha=salvarNovaSenha;
