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
  initFotoInput(); // registra handler do input permanente de foto
  await loadData();
  const su = localStorage.getItem(LS_USER);
  if (!su) { showLogin(true); voltarLogin(); return; }
  currentUser = JSON.parse(su);
  // Guests are never persisted — if somehow stored, clear and show login
  if (currentUser.isGuest) {
    currentUser = null;
    localStorage.removeItem(LS_USER);
    showLogin(true); voltarLogin(); return;
  }
  currentUser.isAdmin = (appData.admins || []).includes(currentUser.id);
  // Refresh foto from jogadores data
  const jAtual = appData.jogadores.find(x => x.id === currentUser.id);
  if (jAtual) currentUser.foto = jAtual.foto || null;
  localStorage.setItem(LS_USER, JSON.stringify(currentUser));
  // Auto-check: remove avulsos não pagos após sáb 12h
  await checkAvulsosInadimplentes();
  // Auto-check: cancela pelada se < 12 confirmados a menos de 24h
  await checkCancelamentoPelada();
  showApp();
}

async function entrar() {
  const nome = document.getElementById('loginNome').value.trim();
  if (!nome) { showToast('Digite seu nome'); return; }

  const match = appData.jogadores.find(j => normAccent(j.nome) === normAccent(nome));

  if (match) {
    // Jogador cadastrado → pede senha
    if (match.senha) {
      showPasswordStep(match, 'login');
    } else {
      showPasswordStep(match, 'criar');
    }
  } else {
    // Nome não cadastrado → entra como visitante (sem salvar, sem conta)
    currentUser = { id: 'guest_' + Date.now(), nome, isAdmin: false, isGuest: true };
    // NÃO salva no localStorage — sessão temporária
    showLogin(false);
    showApp();
  }
}

function entrarComoVisitante() {
  // Entra sem nome — visitante anônimo
  currentUser = { id: 'guest_anon', nome: 'Visitante', isAdmin: false, isGuest: true };
  showLogin(false);
  showApp();
}

function showPasswordStep(jogador, modo) {
  const loginCard = document.getElementById('loginCard');
  const isLogin = modo === 'login';
  loginCard.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      ${jogador.foto
        ? `<img src="${jogador.foto}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--border-gold)">`
        : `<div style="width:44px;height:44px;border-radius:50%;background:var(--gold-dim);border:2px solid var(--border-gold);display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-size:20px;color:var(--gold)">${jogador.nome[0].toUpperCase()}</div>`
      }
      <div>
        <div style="font-family:'Oswald',sans-serif;font-size:16px;font-weight:700;color:var(--gold-lt)">${jogador.nome.toUpperCase()}</div>
        <div style="font-size:11px;color:var(--t2)">${isLogin ? 'Jogador cadastrado' : '✨ Primeiro acesso — crie sua senha'}</div>
      </div>
    </div>
    <div class="field">
      <label>${isLogin ? 'Sua senha' : 'Criar senha (mín. 4 caracteres)'}</label>
      <input class="input" id="inputSenha" type="password" placeholder="••••••" maxlength="30"
        onkeydown="if(event.key==='Enter')confirmarSenha('${jogador.id}','${modo}')">
    </div>
    ${!isLogin ? `
    <div class="field">
      <label>Confirmar senha</label>
      <input class="input" id="inputSenha2" type="password" placeholder="••••••" maxlength="30">
    </div>` : ''}
    <button class="btn btn-gold" onclick="confirmarSenha('${jogador.id}','${modo}')">
      ${isLogin ? 'ENTRAR ⚽' : 'CRIAR SENHA E ENTRAR ⚽'}
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
    <button class="btn btn-ghost" style="margin-top:8px" onclick="entrarComoVisitante()">👁️ VER SEM CONTA</button>
    <div style="font-size:11px;color:var(--t3);text-align:center;margin-top:10px">
      Jogadores cadastrados precisam de senha
    </div>
  `;
  setTimeout(() => document.getElementById('loginNome')?.focus(), 100);
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
      // Show inline error below the input
      let errMsg = document.getElementById('senhaErroMsg');
      if (!errMsg) {
        errMsg = document.createElement('div');
        errMsg.id = 'senhaErroMsg';
        errMsg.style.cssText = 'color:#ef4444;font-size:12px;margin-top:6px;text-align:center';
        inp.parentElement?.appendChild(errMsg);
      }
      errMsg.textContent = '❌ Senha incorreta. Tente novamente.';
      inp.value = '';
      inp.style.borderColor = '#ef4444';
      inp.focus();
      setTimeout(() => {
        errMsg?.remove();
        inp.style.borderColor = '';
      }, 3000);
      return;
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
    if (curScreen === 'home') {
      renderPeladasHistorico();
      renderPresenca(); // refresh in case votação just closed
    }
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

// ── SCORE DO DIA — fórmula com vitórias ponderadas pela participação ──────
//
// JOGADORES DE LINHA:
//   scoreDia = (G+A) + W_VIT × v × fp
//   fp (fator de participação nas vitórias):
//     share = (G+A do jogador) / (G+A total do time)
//     share ≥ 20% → fp = 1.0  (recebe 100% do peso de vitória)
//     share = 0%  → fp = 0.25 (recebe 25% mínimo — estava em campo)
//     entre 0% e 20%: interpolação linear
//     Se time teve 0 G+A: fp = 1 (ninguém pode ser responsabilizado, distribuição igual)
//
// GOLEIROS:
//   Não marcam G+A por definição. Única métrica disponível = vitórias.
//   scoreDia = W_VIT × v × 2  (peso dobrado, pois vitória é 100% da contribuição)
//   Goleiro com 3 vitórias → 4.5 pts ≈ jogador de linha com 2G+1A e 2 vitórias

const SHARE_CHEIO  = 0.20; // share mínimo para receber 100% do peso de vitória
const FP_MINIMO    = 0.25; // peso mínimo de vitória (0 G+A, mas estava em campo)
const W_VIT_GOLEIRO = W_VIT * 2; // goleiro recebe peso dobrado nas vitórias

function scoreDiaCalc(statsJ, statsTime, isGoleiro) {
  const g = statsJ.gols    || 0;
  const a = statsJ.assists || 0;
  const v = statsJ.vitorias|| 0;

  // ── Goleiro ──────────────────────────────────────────────
  if (isGoleiro) {
    return +(W_VIT_GOLEIRO * v).toFixed(4);
  }

  // ── Jogador de linha ──────────────────────────────────────
  let fp = 1;
  if (statsTime && statsTime.n > 1) {
    const gaTime = (statsTime.gols || 0) + (statsTime.assists || 0);
    if (gaTime > 0) {
      const share = (g + a) / gaTime;
      if (share >= SHARE_CHEIO) {
        fp = 1;
      } else {
        // Interpolação linear: 0% → 0.25, 20% → 1.0
        fp = FP_MINIMO + (share / SHARE_CHEIO) * (1 - FP_MINIMO);
      }
    }
    // gaTime === 0 → fp permanece 1 (ninguém tem G+A, vitórias divididas igual)
  }

  return +((g + a) + W_VIT * v * fp).toFixed(4);
}

// Rating acumulado: fórmula SIMPLES original (gols + assists + 0.75×vitórias).
// Não usa ponderação — o rating reflete consistência de longo prazo.
function scoreAcum(j) {
  const ativos = (j.domingos||[]).filter(d=>!d.ausente);
  if (!ativos.length) return 0;
  const s = ativos.map(d => scoreRaw(d.gols||0, d.assists||0, d.vitorias||0));
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
function scaleToMax10(vals) {
  // Scale so max=10, proportional (no floor at 0)
  const mx = Math.max(...vals);
  if (mx === 0) return vals.map(() => 0);
  return vals.map(v => +(v / mx * 10).toFixed(4));
}

function calcIdx(jogs) {
  if(!jogs.length) return [];
  const med=medioGrupo(jogs);
  const adjs=jogs.map(j=>scoreAdj(j,med));
  const notas=jogs.map(j=>+(j.nota||5).toFixed(1));
  // Scale so max=10, rest proportional — no player gets forced to 0
  const adjN  = scaleToMax10(adjs);   // 0–10, proportional to best stats
  const notaN = scaleToMax10(notas);  // 0–10, proportional to best nota (mesmo referencial)
  return jogs.map((j,i)=>{
    const n=nDomAtivo(j),a=alpha(n);
    const IF=+(a*notaN[i]+(1-a)*adjN[i]).toFixed(4); // 0–10 (both inputs already 0–10)
    return {id:j.id,nome:j.nome,nota:notas[i],notaN:notaN[i],sAdj:adjs[i],sAdjN:adjN[i],alpha:a,IF,n,nTotal:nDom(j)};
  });
}

// ─── FINANÇAS HELPERS ────────────────────────────────────────
// ─── VALORES CONFIGURÁVEIS ───────────────────────────────────
function getValores() {
  const cfg = appData.config || {};
  return {
    mensal:  +(cfg.valorMensal  ?? 80),
    avulso:  +(cfg.valorAvulso  ?? 25),
    multa:   +(cfg.valorMulta   ?? 10),
    multaSem:+(cfg.valorMultaSem?? 5),   // multa por semana de atraso mensalidade
  };
}

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

function totalDebitoJogador(jogadorId, filtroDebito) {
  const fin = getFinancasJogador(jogadorId);
  let debitos = (fin.debitos||[]).filter(d => !d.quitado);
  if (filtroDebito) debitos = debitos.filter(filtroDebito);
  const total = debitos.reduce((s,d) => s + (d.valor||0), 0);
  const pago = (fin.pagamentos||[]).reduce((s,p) => s + (p.valor||0), 0);
  let saldo = Math.max(0, total - pago);
  // Multa semanal automática para mensalistas em atraso
  if (jogadorMensalista(jogadorId)) {
    const semanas = semanasAtraso5du();
    if (semanas > 0) {
      const saldoMensais = debitos
        .filter(d => d.tipo === 'mensal')
        .reduce((s,d) => s + (d.valor||0), 0);
      const pagoMensais = (fin.pagamentos||[])
        .filter(p => p.descricao?.toLowerCase().includes('mensalidade'))
        .reduce((s,p) => s + (p.valor||0), 0);
      if (saldoMensais > pagoMensais) {
        saldo += semanas * getValores().multaSem;
      }
    }
  }
  return +(saldo).toFixed(2);
}

function saldoDebitosPorTipo(jogadorId) {
  // Returns { multas, mensais, avulsos, outros, totalPago }
  // Exclui débitos marcados como quitado:true (cancelados individualmente)
  const fin = getFinancasJogador(jogadorId);
  const debitos = (fin.debitos || []).filter(d => !d.quitado); // só débitos ativos
  const pagamentos = fin.pagamentos || [];
  const totalPago = pagamentos.reduce((s,p) => s + (p.valor||0), 0);

  const somaTipo = tipo => debitos.filter(d=>d.tipo===tipo).reduce((s,d)=>s+(d.valor||0), 0);
  return {
    multas:  somaTipo('multa'),
    mensais: somaTipo('mensal'),
    avulsos: somaTipo('avulso'),
    outros:  somaTipo('outro'),
    totalPago,
    totalDebitos: debitos.reduce((s,d)=>s+(d.valor||0), 0),
  };
}

function jogadorInadimplente(jogadorId) {
  const s = saldoDebitosPorTipo(jogadorId);

  // ── REGRA 1: Multas sempre bloqueiam ──────────────────────
  // Calcula saldo de multas: quanto foi pago vai primeiro para outros débitos,
  // o que sobrar abate as multas
  const debitosNaoMulta = s.mensais + s.avulsos + s.outros;
  const pagoParaMultas = Math.max(0, s.totalPago - debitosNaoMulta);
  if (s.multas > pagoParaMultas) return true;

  // ── REGRA 2: Avulsos — qualquer débito de avulso não pago bloqueia ──
  if (!jogadorMensalista(jogadorId)) {
    // Para avulso: saldo total excluindo mensalidade (que não se aplica)
    const saldoAvulso = Math.max(0, (s.avulsos + s.outros + s.multas) - s.totalPago);
    return saldoAvulso > 0;
  }

  // ── REGRA 3: Mensalista — mensalidade só bloqueia APÓS o 5du ──────
  const passou5du = semanasAtraso5du() > 0;
  if (!passou5du) {
    // Ainda dentro do prazo — só multas e avulsos bloqueiam (já verificados acima)
    // Débitos de avulso para mensalistas também bloqueiam
    const saldoSemMensal = Math.max(0, (s.avulsos + s.outros + s.multas) - s.totalPago);
    return saldoSemMensal > 0;
  }

  // Após 5du: qualquer saldo devedor bloqueia
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

// Chave do caixa: sempre mês calendário atual (vira no dia 1, independente do 5DU)
function getCaixaMesKey() {
  const hoje = new Date();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const ano = hoje.getFullYear();
  return `${ano}-${mes}`; // ex: "2025-04"
}
function getCaixaMesLabel() {
  const hoje = new Date();
  return hoje.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
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
function normAccent(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
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
  const btnSortear = document.getElementById('btnSortear');
  if (btnSortear) {
    btnSortear.style.display = currentUser?.isAdmin ? 'flex' : 'none';
    const confirmados = appData.presenca?.confirmados || [];
    btnSortear.textContent = confirmados.length >= 15
      ? `⚽ SORTEAR TIMES (${confirmados.length} confirmados)`
      : '⚽ SORTEAR TIMES';
  }
  const btnCom = document.getElementById('btnComunicado');
  if (btnCom) btnCom.style.display = currentUser?.isAdmin ? 'block' : 'none';
  renderHome();
}

// ─── HOME ────────────────────────────────────────────────────
function getProximoDomingo() {
  const hoje = new Date();
  const dow = hoje.getDay(); // 0=dom
  const diasAte = dow === 0 ? 7 : 7 - dow; // next sunday (never today)
  const prox = new Date(hoje);
  prox.setDate(hoje.getDate() + diasAte);
  return prox.toLocaleDateString('pt-BR');
}

function renderHome() {
  const isAdmin = currentUser?.isAdmin;
  document.getElementById('homeSub').textContent = currentUser ? `Bem-vindo, ${currentUser.nome}!` : '';

  const sorteio = appData.ultimoSorteio;
  const sorteioAtivo = sorteio && sorteio.times && timesToArr(sorteio.times, sorteio.timesCount).length > 0;

  // Admin buttons: show after presença, hide when times are shown
  const adminBtns = document.getElementById('homeAdminButtons');
  if (adminBtns) adminBtns.style.display = isAdmin && !sorteioAtivo ? 'block' : 'none';

  const btnSortear = document.getElementById('btnSortear');
  if (btnSortear) {
    btnSortear.style.display = isAdmin ? 'flex' : 'none';
    const confirmados = appData.presenca?.confirmados || [];
    btnSortear.textContent = confirmados.length >= 15
      ? `⚽ SORTEAR TIMES (${confirmados.length} confirmados)`
      : '⚽ SORTEAR TIMES';
  }
  const btnCom = document.getElementById('btnComunicado');
  if (btnCom) btnCom.style.display = isAdmin ? 'block' : 'none';

  const msg = document.getElementById('homeMsg');
  const stats = document.getElementById('homeStats');
  const adminControls = document.getElementById('homeAdminControls');

  if (!sorteioAtivo) {
    // No active sorteio — show nothing in msg area (presença handles the list)
    if (msg) msg.innerHTML = '';
    if (stats) stats.innerHTML = '';
    if (adminControls) adminControls.innerHTML = '';
  } else {
    // Times sorteados — hide presença, show times
    const sorteioTimesArr = timesToArr(sorteio.times, sorteio.timesCount);
    const T_COLORS = ['t0','t1','t2','t3'];
    const statusLabel = sorteio.status === 'confirmado'
      ? `<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:99px;padding:4px 12px;font-size:11px;color:#22c55e;margin-bottom:12px">● PARTIDA EM ANDAMENTO</div>`
      : '';

    const timesHTML = sorteioTimesArr.map((t, ti) => `
      <div class="team-card ${T_COLORS[ti]}" style="margin-bottom:8px">
        <div class="t-name"><div class="t-dot"></div>${['Time Vermelho','Time Azul','Time Branco','Time Preto'][ti]||'Time '+(ti+1)}</div>
        ${t.map(id => {
          const j = appData.jogadores.find(x=>x.id===id);
          return `<div class="t-player"><span>${j?.nome||id}</span></div>`;
        }).join('')}
      </div>`).join('');

    if (msg) msg.innerHTML = `<div class="card shield-card" style="margin-bottom:8px">${statusLabel}${timesHTML}</div>`;
    if (stats) stats.innerHTML = `<div style="font-size:10px;color:var(--t3);margin-bottom:8px;padding:0 4px">Sorteado em ${sorteio.data}</div>`;

    // Admin controls (cancelar/concluir) after times
    if (adminControls && isAdmin && sorteio.status === 'confirmado') {
      adminControls.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
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
function getDescricaoPelada(horario) {
  const domingo = getProximoDomingo();
  return `Pelada do Torneira ${domingo}
R. Juscelino Barbosa 254
${horario || '11:30 às 13:00'}
Pix: mfnassif16@gmail.com`;
}
// Keep for backwards compat
const DESCRICAO_PELADA = getDescricaoPelada('11:30 às 13:00');

function getRegrasPelada() {
  const v = getValores();
  return `• 1ª partida: 10 min, sem limite de gol (2 primeiros times completos)
• Demais partidas: 7 min ou 2 gols
• Mensalista: R$${v.mensal.toFixed(0)}/mês, prioridade até Sex 12h
• Avulso: R$${v.avulso.toFixed(0)}/pelada, pagar até Sáb 12h
• Falta sem aviso <24h: mensalista R$${v.multa.toFixed(0)} / avulso R$${v.avulso.toFixed(0)}
• Mensalidade em atraso: multa R$${v.multaSem.toFixed(0)}/semana após 5º dia útil`;
}
// Keep for backwards compat
const REGRAS_PELADA = getRegrasPelada();

function renderPresenca() {
  const cont = document.getElementById('homePresenca');
  if (!cont) return;
  const isAdminUser = currentUser?.isAdmin;

  // ── STATE MACHINE ─────────────────────────────────────────
  // 1. Times confirmados e ativos → esconde lista (times já aparecem na home)
  // 2. Votação MVP aberta → bloqueia com aviso
  // 3. Qualquer outro caso → mostra lista sempre

  const sorteio = appData.ultimoSorteio;
  const timesArr = sorteio ? timesToArr(sorteio.times, Object.keys(sorteio.times||{}).length) : [];
  const timesAtivos = sorteio && sorteio.status === 'confirmado' && timesArr.length > 0;

  if (timesAtivos) { cont.innerHTML = ''; return; }

  // Check votação MVP (dedup)
  const peladasSeen = new Set();
  const peladasUnicas = (appData.peladasHist||[]).filter(p => {
    if (!p.id || peladasSeen.has(p.id)) return false;
    peladasSeen.add(p.id); return true;
  });
  const ultimaPelada = peladasUnicas.length > 0
    ? [...peladasUnicas].sort((a,b)=>(b.savedAt||0)-(a.savedAt||0))[0]
    : null;
  const votacaoAberta = ultimaPelada?.votacao?.status === 'aberta'
    && (ultimaPelada.votacao.elapsesAt || 0) > Date.now();

  if (votacaoAberta) {
    cont.innerHTML = `
      <div class="section-lbl" style="margin-top:16px">LISTA DE PRESENÇA</div>
      <div class="card" style="text-align:center;padding:20px;border-color:rgba(234,179,8,.2);background:rgba(234,179,8,.04)">
        <div style="font-size:24px;margin-bottom:8px">⏳</div>
        <div style="font-family:'Oswald',sans-serif;font-size:14px;letter-spacing:1px;color:var(--gold-lt)">AGUARDANDO RESULTADO MVP</div>
        <div style="font-size:11px;color:var(--t2);margin-top:6px">A lista será liberada após a votação</div>
        ${isAdminUser ? `<button onclick="encerrarVotacaoForce('${ultimaPelada.id}')" style="margin-top:12px;background:rgba(234,179,8,.15);border:1px solid rgba(234,179,8,.3);border-radius:8px;color:#eab308;font-size:12px;padding:6px 16px;cursor:pointer;font-family:'Oswald',sans-serif;letter-spacing:1px">⚡ ENCERRAR VOTAÇÃO AGORA</button>` : ''}
      </div>`;
    return;
  }

  // ── LISTA SEMPRE VISÍVEL ───────────────────────────────────
  const presenca = appData.presenca || { confirmados: [], espera: [], data: '' };
  const dataLista = presenca.data || sorteio?.data || '';
  const confirmados = presenca.confirmados || [];
  const espera = presenca.espera || [];
  const total = confirmados.length;

  // Regra de vagas dinâmica baseada no tamanho de time
  const vagas = getVagasLimite(confirmados, espera);
  const esperaMax = getEsperaLimite(confirmados);
  const n = getTamanhoTime(confirmados);
  // Duração e horário mudam com o número de times
  const nTimes = total >= n*4 ? 4 : total >= n*3 ? 3 : Math.floor(total/n)||1;
  const horario = total >= n*4 ? '11:30 às 13:30' : '11:30 às 13:00';

  const now = Date.now();
  const peladaDate = parsePeladaDate(dataLista);
  const h24 = 24 * 60 * 60 * 1000;
  const h48 = 48 * 60 * 60 * 1000;
  const dentro24h = peladaDate && (peladaDate - now) < h24;
  // Janela de prioridade: mensalistas têm prioridade até 48h antes
  const dentroPrioridade = peladaDate ? now < (peladaDate - h48) : true;

  const userId = currentUser?.id;
  const isGuest = currentUser?.isGuest;
  const ehJogadorCadastrado = !!appData.jogadores.find(x => x.id === userId);
  const jaConfirmado = !!userId && confirmados.includes(userId);
  const naEspera = !!userId && espera.includes(userId);
  const inadimplente = ehJogadorCadastrado && !isGuest ? jogadorInadimplente(userId) : false;
  const ehMensalista = userId ? jogadorMensalista(userId) : false;
  const listaCheia = total >= vagas;
  const esperaCheia = espera.length >= esperaMax;

  // Nomes ordenados alfabeticamente
  const tipoPresenca = presenca.tipo || (presenca.tipoPelada === 'classico' ? 'classico' : 'normal');
  const confirmadosNomes = confirmados.map(id => {
    const j = appData.jogadores.find(x => x.id === id);
    return { id, nome: j?.nome || id, mensalista: jogadorMensalista(id), clube: j?.clube || '' };
  }).sort((a,b) => {
    if (tipoPresenca === 'classico') {
      // Atleticanos first, then cruzeirenses, then others
      const clubeOrder = { 'atleticano': 0, 'cruzeirense': 1 };
      const oa = clubeOrder[a.clube] ?? 2;
      const ob = clubeOrder[b.clube] ?? 2;
      if (oa !== ob) return oa - ob;
    }
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  const esperaNomes = espera.map((id,i) => {
    const j = appData.jogadores.find(x => x.id === id);
    return { id, nome: j?.nome || id, pos: i+1 };
  });

  const localAtual = presenca.local || 'R. Juscelino Barbosa 254';
  const horarioAtual = presenca.horario || horario;
  const dataExibir = dataLista || getProximoDomingo();
  const nomePelada = tipoPresenca === 'classico' ? 'Clássico do Torneira' : 'Pelada do Torneira';

  // ── BOTÃO DO USUÁRIO ──────────────────────────────────────
  let btnHTML = '';
  if (!userId || isGuest) {
    btnHTML = ''; // visitantes: sem botão
  } else if (!ehJogadorCadastrado) {
    btnHTML = `<button class="btn btn-ghost" disabled style="opacity:0.5;cursor:not-allowed">🚫 JOGADOR NÃO CADASTRADO</button>`;
  } else if (inadimplente) {
    btnHTML = `<button class="btn btn-danger" onclick="goTo('financas')" style="opacity:0.9">⚠️ HÁ DÉBITOS EM ABERTO</button>`;
  } else if (jaConfirmado) {
    const multaLabel = dentro24h
      ? ` (multa R$${ehMensalista ? getValores().multa : getValores().avulso})`
      : '';
    btnHTML = `<button class="btn btn-danger" onclick="desmarcarPresenca()">❌ DESMARCAR${multaLabel}</button>`;
  } else if (naEspera) {
    btnHTML = `<button class="btn btn-ghost" onclick="desmarcarPresenca()">SAIR DA LISTA DE ESPERA</button>`;
  } else if (dentroPrioridade && !ehMensalista) {
    btnHTML = `<button class="btn btn-ghost" disabled style="opacity:0.6">⏳ RESERVADO MENSALISTAS (até 48h antes)</button>`;
  } else if (listaCheia && esperaCheia) {
    btnHTML = `<button class="btn btn-ghost" disabled style="opacity:0.5">LISTA COMPLETA</button>`;
  } else if (listaCheia) {
    btnHTML = `<button class="btn btn-gold" onclick="confirmarPresenca()">📋 ENTRAR NA LISTA DE ESPERA</button>`;
  } else {
    btnHTML = `<button class="btn btn-gold" onclick="confirmarPresenca()">✅ CONFIRMAR PRESENÇA</button>`;
  }

  // ── RENDER ────────────────────────────────────────────────
  cont.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:8px">
        <div class="section-lbl" style="margin:0">LISTA DE PRESENÇA</div>
        ${tipoPresenca==='classico'?'<span style="font-size:9px;background:rgba(201,168,76,.15);border:1px solid var(--border-gold);color:var(--gold);padding:2px 8px;border-radius:99px;font-family:Oswald,sans-serif;letter-spacing:1px">CLÁSSICO ⚽</span>':''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="exportarListaPresenca()" style="background:var(--s2);border:1px solid var(--border);border-radius:8px;color:var(--t2);font-size:11px;padding:4px 10px;cursor:pointer;font-family:'DM Sans',sans-serif">📋 Exportar</button>
        ${isAdminUser ? `<button onclick="abrirListaPresenca()" style="display:${!appData.presenca?'block':'none'};background:var(--s2);border:1px solid var(--border);border-radius:8px;color:var(--t2);font-size:11px;padding:4px 10px;cursor:pointer">+ Abrir</button><button onclick="abrirAdminPresenca()" style="background:var(--gold-dim);border:1px solid var(--border-gold);border-radius:8px;color:var(--gold);font-size:11px;padding:4px 12px;cursor:pointer">⚙️ Gerenciar</button>` : ''}
      </div>
      </div>` : ''}
    </div>
    <div class="card shield-card" style="margin-bottom:12px">
      <div style="white-space:pre-line;font-size:13px;color:var(--text);line-height:1.7;margin-bottom:14px;font-weight:500">${nomePelada} ${dataExibir}
${localAtual}
${horarioAtual}
Pix: mfnassif16@gmail.com</div>
      ${confirmadosNomes.length > 0 ? `
      <div style="margin-bottom:10px">
        ${tipoPresenca === 'classico' ? (() => {
          const galos = confirmadosNomes.filter(p => p.clube === 'atleticano');
          const raposas = confirmadosNomes.filter(p => p.clube === 'cruzeirense');
          const semClube = confirmadosNomes.filter(p => !p.clube || (p.clube !== 'atleticano' && p.clube !== 'cruzeirense'));
          const renderJog = (p, i) => `
            <div style="font-size:13px;padding:2px 0;color:${p.id===userId?'var(--gold)':'var(--text)'};display:flex;align-items:center;gap:6px">
              <span style="color:var(--t2);min-width:18px">${i+1}.</span>
              <span>${p.nome}${p.mensalista?'<span style="font-size:9px;color:var(--gold);margin-left:4px">M</span>':''}</span>
              ${p.id===userId?'<span style="font-size:9px;color:var(--gold)">← você</span>':''}
            </div>`;
          return `
            ${galos.length > 0 ? `<div style="font-size:10px;letter-spacing:1px;color:var(--t2);margin:8px 0 4px;font-family:'Oswald',sans-serif">🐓 GALO (${galos.length})</div>${galos.map(renderJog).join('')}` : ''}
            ${raposas.length > 0 ? `<div style="font-size:10px;letter-spacing:1px;color:var(--t2);margin:8px 0 4px;font-family:'Oswald',sans-serif">🦊 CRUZEIRO (${raposas.length})</div>${raposas.map(renderJog).join('')}` : ''}
            ${semClube.length > 0 ? `<div style="font-size:10px;letter-spacing:1px;color:var(--t3);margin:8px 0 4px">SEM CLUBE (${semClube.length})</div>${semClube.map(renderJog).join('')}` : ''}`;
        })() : confirmadosNomes.map((p,i) => `
          <div style="font-size:13px;padding:3px 0;color:${p.id===userId?'var(--gold)':'var(--text)'};display:flex;align-items:center;gap:6px">
            <span style="color:var(--t2);min-width:18px">${i+1}.</span>
            <span>${p.nome}${p.mensalista?'<span style="font-size:9px;color:var(--gold);margin-left:4px">M</span>':''}</span>
            ${p.id===userId?'<span style="font-size:9px;color:var(--gold)">← você</span>':''}
          </div>`).join('')}
      </div>` : `<div style="font-size:12px;color:var(--t3);margin-bottom:10px">Nenhuma confirmação ainda</div>`}
      ${esperaNomes.length > 0 ? `
      <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
        <div style="font-size:10px;letter-spacing:1px;color:var(--t2);margin-bottom:6px">LISTA DE ESPERA</div>
        ${esperaNomes.map(p => `
          <div style="font-size:12px;padding:2px 0;color:${p.id===userId?'var(--gold)':'var(--t2)'}">
            ${p.pos}. ${p.nome}${p.id===userId?' ← você':''}
          </div>`).join('')}
      </div>` : ''}
      <div style="font-size:10px;color:var(--t3);margin-top:10px;margin-bottom:12px">
        ${total}/${vagas} confirmados · ${espera.length}/${esperaMax} espera
        ${total >= n*3 ? ` · <span style="color:var(--gold)">✓ ${nTimes} times / ${nTimes>=4?'2h':'1h30'}</span>` : ''}
      </div>
      ${btnHTML}
    </div>`;
}



async function checkMensalidadeAtual() {
  // Mensalidades são geradas MANUALMENTE pelo admin
  // Não gera débitos automaticamente para evitar cobranças antes do prazo
  return;
}

async function checkAvulsosInadimplentes() {
  // Verifica 24h antes da pelada: avulsos inadimplentes saem da lista → promove da espera
  // NUNCA gera multa aqui (a multa de ausência é gerada ao finalizar a partida)
  const p = appData.presenca;
  if (!p?.confirmados?.length) return;
  const peladaDate = parsePeladaDate(p.data || appData.ultimoSorteio?.data);
  if (!peladaDate) return;
  const h24 = 24 * 60 * 60 * 1000;
  if (Date.now() < peladaDate - h24) return; // Ainda não chegou a janela de 24h

  let changed = false;
  const removidos = [];

  for (const id of [...p.confirmados]) {
    if (jogadorMensalista(id)) continue;
    // Avulso com débito não quitado dentro das 24h → remove da lista
    if (!jogadorInadimplente(id)) continue;
    p.confirmados = p.confirmados.filter(x => x !== id);
    // Move para o FINAL da espera (perdeu a vez por inadimplência)
    p.espera = [...(p.espera||[]), id];
    removidos.push(id);
    changed = true;
  }

  if (changed) {
    // Para cada removido, promover o primeiro da espera (que não seja um dos removidos)
    for (const removido of removidos) {
      const candidatos = (p.espera||[]).filter(id => !removidos.includes(id));
      if (candidatos.length > 0) {
        const promovido = candidatos[0];
        p.espera = p.espera.filter(id => id !== promovido);
        p.confirmados.push(promovido);
        if (!jogadorMensalista(promovido)) {
          await gerarDebitoAvulsoPresenca(promovido, p.data, 'promovido — inadimplente substituído');
        }
      }
    }
    appData.presenca = p;
    await firestoreSet('config', 'presenca', p);
    saveLocal();
    renderPresenca();
  }
}

async function checkCancelamentoPelada() {
  // Roda no boot. Se a lista de presença existir, tiver data marcada,
  // estiver a menos de 24h da pelada E tiver menos de 12 confirmados
  // → cancela automaticamente, emite comunicado e abre lista pro próximo domingo.

  const p = appData.presenca;
  if (!p?.data) return; // sem lista ativa, nada a fazer

  const confirmados = p.confirmados || [];
  const peladaDate = parsePeladaDate(p.data);
  if (!peladaDate) return;

  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;
  const dentro24h = (peladaDate - now) < h24;
  const jaNaoAconteceu = peladaDate > now; // ainda no futuro

  if (!dentro24h || !jaNaoAconteceu) return; // fora da janela
  if (confirmados.length >= 12) return;      // confirmados suficientes

  // Verificar se já foi cancelado (evita comunicado duplicado a cada boot)
  const jaCancelou = (appData.comunicados || []).some(c =>
    c.auto === 'cancelamento' && c.texto?.includes(p.data)
  );
  if (jaCancelou) return;

  // ── Emitir comunicado automático ──────────────────────────
  const proximoDomingo = getProximoDomingoApos(p.data);
  const comId = 'com_cancel_' + Date.now();
  const com = {
    id: comId,
    titulo: '⚠️ PELADA CANCELADA',
    texto: `A pelada de ${p.data} foi cancelada por falta de quórum mínimo (${confirmados.length}/12 confirmados).\n\nA lista para o próximo domingo (${proximoDomingo}) já está aberta. Confirme sua presença!`,
    autor: 'Sistema',
    criadoEm: Date.now(),
    auto: 'cancelamento',
  };
  if (!appData.comunicados) appData.comunicados = [];
  appData.comunicados.unshift(com);
  await firestoreSet('comunicados', comId, com);

  // ── Cancelar débitos de avulso gerados por esta lista ──────
  for (const uid of confirmados) {
    if (jogadorMensalista(uid)) continue;
    const fin = getFinancasJogador(uid);
    if (!fin.debitos) continue;
    let changed = false;
    fin.debitos.forEach(d => {
      if (d.tipo === 'avulso' && !d.quitado && d.descricao?.includes(p.data)) {
        d.quitado = true; // cancela — não vai jogar
        changed = true;
      }
    });
    if (changed) {
      await firestoreSet('financas', uid, fin);
    }
  }

  // ── Abrir nova lista para o próximo domingo ─────────────
  const novaPresenca = { confirmados: [], espera: [], data: proximoDomingo };
  appData.presenca = novaPresenca;
  await firestoreSet('config', 'presenca', novaPresenca);

  saveLocal();
}

function getProximoDomingoApos(dataStr) {
  // Retorna o domingo seguinte ao dataStr (dd/mm/yyyy)
  const base = parsePeladaDate(dataStr);
  if (!base) return getProximoDomingo();
  const d = new Date(base);
  d.setDate(d.getDate() + 7);
  return d.toLocaleDateString('pt-BR');
}

async function gerarMultasAusencia(ausentes, peladaData) {
  // Chamada ao finalizar partida para gerar multas dos ausentes
  for (const uid of ausentes) {
    const ehMens = jogadorMensalista(uid);
    const multaValor = ehMens ? getValores().multa : getValores().avulso;
    // Não gera multa duplicada
    const fin = getFinancasJogador(uid);
    const jaTemMulta = (fin.debitos||[]).some(d =>
      d.tipo==='multa' && d.descricao?.includes('ausente') && d.descricao?.includes(peladaData)
    );
    if (!jaTemMulta) {
      await adicionarDebito(uid, 'multa', multaValor,
        `Ausente sem aviso — Pelada ${peladaData}`);
    }
  }
}

async function abrirListaPresenca() {
  // Admin opens/creates a new presença for the next Sunday
  if (!currentUser?.isAdmin) return;
  const proximoDomingo = getProximoDomingo();
  const novaPresenca = appData.presenca || { confirmados:[], espera:[], data: proximoDomingo, aberta: true };
  if (!novaPresenca.aberta) novaPresenca.aberta = true;
  if (!novaPresenca.data) novaPresenca.data = proximoDomingo;
  appData.presenca = novaPresenca;
  await firestoreSet('config', 'presenca', novaPresenca);
  saveLocal();
  renderPresenca();
  showToast('Lista de presença aberta ✅');
}
function exportarListaPresenca() {
  const presenca = appData.presenca || { confirmados:[], espera:[], data:'', tipo:'normal' };
  const tipo = presenca.tipo || (presenca.tipoPelada === 'classico' ? 'classico' : 'normal');
  const data = presenca.data || getProximoDomingo();
  const local = presenca.local || 'R. Juscelino Barbosa 254';
  const total = (presenca.confirmados||[]).length;
  const horario = presenca.horario || (total >= 20 ? '11:30 às 13:30' : '11:30 às 13:00');
  const pix = 'Pix: mfnassif16@gmail.com';

  const confirmados = presenca.confirmados || [];
  const espera = presenca.espera || [];

  let texto = '';

  if (tipo === 'classico') {
    // Split by clube
    const atleticanos = confirmados
      .map(id => appData.jogadores.find(x=>x.id===id))
      .filter(j => j?.clube === 'atleticano')
      .sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR'));

    const cruzeirenses = confirmados
      .map(id => appData.jogadores.find(x=>x.id===id))
      .filter(j => j?.clube === 'cruzeirense')
      .sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR'));

    const semClube = confirmados
      .map(id => appData.jogadores.find(x=>x.id===id))
      .filter(j => j && !j.clube)
      .sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR'));

    texto = `Clássico do Torneira - ${data}
${local}
${horario}
${pix}

🐓 GALO:
${atleticanos.map((j,i) => `  ${i+1}. ${j.nome}`).join('
') || '  —'}

🦊 CRUZEIRO:
${cruzeirenses.map((j,i) => `  ${i+1}. ${j.nome}`).join('
') || '  —'}${semClube.length > 0 ? '

SEM CLUBE:
' + semClube.map((j,i) => `  ${i+1}. ${j.nome}`).join('
') : ''}`;

  } else {
    // Ordem alfabética
    const nomes = confirmados
      .map(id => appData.jogadores.find(x=>x.id===id)?.nome || id)
      .sort((a,b) => a.localeCompare(b,'pt-BR'));

    texto = `Pelada do Torneira - ${data}
${local}
${horario}
${pix}

${nomes.map((n,i) => `  ${i+1}. ${n}`).join('
')}`;
  }

  // Add espera if any
  if (espera.length > 0) {
    const esperaNomes = espera
      .map(id => appData.jogadores.find(x=>x.id===id)?.nome || id);
    texto += `

LISTA DE ESPERA:
${esperaNomes.map((n,i) => `  ${i+1}. ${n}`).join('
')}`;
  }

  // Copy to clipboard
  if (navigator.clipboard) {
    navigator.clipboard.writeText(texto).then(() => {
      showToast('Lista copiada! ✅ Cole no WhatsApp');
    }).catch(() => fallbackCopy(texto));
  } else {
    fallbackCopy(texto);
  }
}

function fallbackCopy(texto) {
  const ta = document.createElement('textarea');
  ta.value = texto;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast('Lista copiada! ✅');
}

window.exportarListaPresenca = exportarListaPresenca;
window.abrirListaPresenca = abrirListaPresenca;

function abrirAdminPresenca() {
  if (!currentUser?.isAdmin) return;
  // Create presença if doesn't exist yet
  if (!appData.presenca) {
    const novaData = appData.ultimoSorteio?.data || getProximoDomingo();
    appData.presenca = { confirmados:[], espera:[], data: novaData };
    firestoreSet('config','presenca',appData.presenca).catch(()=>{});
    saveLocal();
  }
  const presenca = appData.presenca;
  const sorteio = appData.ultimoSorteio;

  // Build list of all players not yet confirmed
  const naoNaLista = appData.jogadores.filter(j =>
    !presenca.confirmados.includes(j.id) && !(presenca.espera||[]).includes(j.id)
  );

  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'modalAdminPresenca';
  const presAtual = appData.presenca || { confirmados:[], espera:[], data: appData.ultimoSorteio?.data };
  const tipoAtual = presAtual.tipoPelada || 'comum';
  const tamanhoAtual = presAtual.tamanhoTime || 5;
  overlay.innerHTML = `
    <div class="modal" style="max-height:90vh;overflow-y:auto">
      <div class="mhandle"></div>
      <div class="m-title">GERENCIAR LISTA</div>
      <div class="m-sub">Admin · ${presAtual.confirmados.length} confirmados</div>

      <div class="section-lbl" style="margin-bottom:8px">TIPO DE PELADA</div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button id="btnTipoComum" onclick="setTipoPelada('comum')"
          class="${tipoAtual==='comum'?'btn btn-gold':'btn btn-ghost'}" style="flex:1;font-size:13px">
          ⚽ PELADA COMUM
        </button>
        <button id="btnTipoClassico" onclick="setTipoPelada('classico')"
          class="${tipoAtual==='classico'?'btn btn-gold':'btn btn-ghost'}" style="flex:1;font-size:13px">
          🏆 CLÁSSICO
        </button>
      </div>

      <div class="section-lbl" style="margin-bottom:8px">TAMANHO DOS TIMES</div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button onclick="setTamanhoTime(4)" class="${tamanhoAtual===4?'btn btn-gold':'btn btn-ghost'}" style="flex:1;font-size:13px" id="btnT4">4 jogadores</button>
        <button onclick="setTamanhoTime(5)" class="${tamanhoAtual===5?'btn btn-gold':'btn btn-ghost'}" style="flex:1;font-size:13px" id="btnT5">5 jogadores</button>
        <button onclick="setTamanhoTime(6)" class="${tamanhoAtual===6?'btn btn-gold':'btn btn-ghost'}" style="flex:1;font-size:13px" id="btnT6">6 jogadores</button>
      </div>
      <div style="font-size:11px;color:var(--t2);margin-bottom:14px;background:var(--s2);border-radius:8px;padding:8px 12px">
        🧤 Se 2+ goleiros confirmados, o sistema usa 1 jogador a menos por time automaticamente
      </div>

      <div class="section-lbl" style="margin-bottom:8px">TIPO DE PELADA</div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button onclick="setTipoPresenca('normal')" style="flex:1;padding:8px;border-radius:8px;border:1px solid ${presenca.tipo==='classico'?'var(--border)':'var(--border-gold)'};background:${presenca.tipo==='classico'?'var(--s2)':'var(--gold-dim)'};color:${presenca.tipo==='classico'?'var(--t2)':'var(--gold)'};cursor:pointer;font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:1px">NORMAL</button>
        <button onclick="setTipoPresenca('classico')" style="flex:1;padding:8px;border-radius:8px;border:1px solid ${presenca.tipo==='classico'?'var(--border-gold)':'var(--border)'};background:${presenca.tipo==='classico'?'var(--gold-dim)':'var(--s2)'};color:${presenca.tipo==='classico'?'var(--gold)':'var(--t2)'};cursor:pointer;font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:1px">⚽ CLÁSSICO</button>
      </div>
      <div class="section-lbl" style="margin-bottom:8px">LOCAL E HORÁRIO</div>
      <div class="field"><label>Endereço</label>
        <input class="input" id="apLocal" value="R. Juscelino Barbosa 254" maxlength="60">
      </div>
      <div style="display:flex;gap:8px">
        <div class="field" style="flex:1"><label>Início</label>
          <input class="input" id="apHoraIni" value="11:30" maxlength="5">
        </div>
        <div class="field" style="flex:1"><label>Fim</label>
          <input class="input" id="apHoraFim" value="${presenca.confirmados.length>=20?'13:30':'13:00'}" maxlength="5">
        </div>
      </div>
      <button class="btn btn-ghost" style="margin-bottom:16px;font-size:12px" onclick="salvarInfoPelada()">💾 SALVAR LOCAL/HORÁRIO</button>

      <div class="section-lbl" style="margin-bottom:8px">ADICIONAR JOGADOR</div>
      <select class="input" id="apAddJog" style="margin-bottom:8px">
        <option value="">— Selecione —</option>
        ${naoNaLista.map(j=>`<option value="${j.id}">${j.nome}${j.tipoJogador==='mensalista'?' (M)':''}</option>`).join('')}
      </select>
      <div style="display:flex;gap:6px;margin-bottom:16px">
        <button class="btn btn-gold" style="flex:1;font-size:12px" onclick="adminAdicionarPresenca('confirmados')">+ CONFIRMADO</button>
        <button class="btn btn-ghost" style="flex:1;font-size:12px" onclick="adminAdicionarPresenca('espera')">+ ESPERA</button>
      </div>

      <div class="section-lbl" style="margin-bottom:8px">CONFIRMADOS (${presenca.confirmados.length})</div>
      ${presenca.confirmados.map((id,i) => {
        const j = appData.jogadores.find(x=>x.id===id);
        const nome = j?.nome || id;
        const cadastrado = !!j;
        const ehAvulso = j && !jogadorMensalista(id);
        const saldoAvulso = ehAvulso ? (() => {
          const fin = getFinancasJogador(id);
          const peladaData = presenca.data || appData.ultimoSorteio?.data || '';
          // Débitos de avulso não quitados desta pelada
          const debs = (fin.debitos||[]).filter(d =>
            d.tipo==='avulso' && !d.quitado && d.descricao?.includes(peladaData)
          );
          return debs.reduce((s,d)=>s+(d.valor||0),0);
        })() : 0;
        return `<div style="display:flex;align-items:center;gap:6px;padding:7px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--t2);font-size:11px;min-width:18px">${i+1}.</span>
          <div style="flex:1">
            <div style="font-size:13px;color:${cadastrado?'var(--text)':'#ef4444'}">${nome}${!cadastrado?' ⚠️':''}</div>
            ${ehAvulso ? `<div style="font-size:10px;color:${saldoAvulso>0?'#ef4444':'#22c55e'}">${saldoAvulso>0?`Deve R$${saldoAvulso.toFixed(2)}`:'✅ Pago'}</div>` : '<div style="font-size:10px;color:var(--gold)">Mensalista</div>'}
          </div>
          ${ehAvulso && saldoAvulso > 0 ? `<button onclick="adminBaixaAvulsoPresenca('${id}')" style="background:rgba(201,168,76,.15);border:1px solid var(--border-gold);border-radius:6px;color:var(--gold);font-size:10px;padding:3px 8px;cursor:pointer">💰 Pago</button>` : ''}
          <button onclick="adminRemoverPresenca('confirmados','${id}')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 4px">×</button>
        </div>`;
      }).join('')||'<div style="color:var(--t3);font-size:12px">Nenhum</div>'}

      ${(presenca.espera||[]).length>0?`
      <div class="section-lbl" style="margin-top:12px;margin-bottom:8px">ESPERA (${presenca.espera.length})</div>
      ${presenca.espera.map((id,i) => {
        const j = appData.jogadores.find(x=>x.id===id);
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--t2);font-size:12px;min-width:20px">${i+1}.</span>
          <span style="flex:1;font-size:13px">${j?.nome||id}</span>
          <button onclick="adminRemoverPresenca('espera','${id}')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 4px">×</button>
        </div>`;
      }).join('')}` : ''}

      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalAdminPresenca').remove()">FECHAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function setTipoPelada(tipo) {
  const p = appData.presenca;
  if (!p) return;
  p.tipoPelada = tipo;
  appData.presenca = p;
  await firestoreSet('config','presenca',p);
  saveLocal();
  document.getElementById('modalAdminPresenca')?.remove();
  abrirAdminPresenca();
}
window.setTipoPelada = setTipoPelada;

async function setTamanhoTime(n) {
  const p = appData.presenca;
  if (!p) return;
  p.tamanhoTime = n;
  appData.presenca = p;
  await firestoreSet('config','presenca',p);
  saveLocal();
  document.getElementById('modalAdminPresenca')?.remove();
  abrirAdminPresenca();
}
window.setTamanhoTime = setTamanhoTime;

async function adminAdicionarPresenca(lista) {
  const sel = document.getElementById('apAddJog')?.value;
  if (!sel) { showToast('Selecione um jogador'); return; }
  const presenca = appData.presenca || { confirmados:[], espera:[], data: appData.ultimoSorteio?.data };
  if (!presenca[lista]) presenca[lista] = [];
  if (presenca.confirmados.includes(sel) || (presenca.espera||[]).includes(sel)) {
    showToast('Jogador já está na lista'); return;
  }
  presenca[lista].push(sel);
  appData.presenca = presenca;
  await firestoreSet('config', 'presenca', presenca);
  // Se avulso adicionado aos confirmados → gera débito como PENDÊNCIA (não como pago)
  if (lista === 'confirmados' && !jogadorMensalista(sel)) {
    const sorteioData = appData.ultimoSorteio?.data || presenca.data || '';
    await gerarDebitoAvulsoPresenca(sel, sorteioData, 'adicionado pelo admin');
  }
  saveLocal();
  document.getElementById('modalAdminPresenca')?.remove();
  abrirAdminPresenca();
  renderPresenca();
  showToast('Jogador adicionado ✅');
}

async function adminBaixaAvulsoPresenca(jogadorId) {
  const j = appData.jogadores.find(x=>x.id===jogadorId);
  if (!j) return;
  const sorteioData = appData.presenca?.data || appData.ultimoSorteio?.data || '';
  const fin = getFinancasJogador(jogadorId);
  // Encontra o débito de avulso desta pelada não quitado
  const debito = (fin.debitos||[]).find(d =>
    d.tipo==='avulso' && !d.quitado && d.descricao?.includes(sorteioData)
  );
  if (!debito) { showToast('Débito não encontrado'); return; }
  // Marca o débito como quitado individualmente
  debito.quitado = true;
  // Registra o pagamento também (histórico financeiro)
  if (!fin.pagamentos) fin.pagamentos = [];
  fin.pagamentos.push({
    id: 'p'+Date.now(),
    valor: debito.valor,
    descricao: `Avulso pago — Pelada ${sorteioData}`,
    data: new Date().toLocaleDateString('pt-BR')
  });
  appData.financas[jogadorId] = fin;
  await firestoreSet('financas', jogadorId, fin);
  saveLocal();
  showToast(`✅ R$${debito.valor} pago — ${j.nome}`);
  document.getElementById('modalAdminPresenca')?.remove();
  abrirAdminPresenca();
  renderPresenca();
}

async function adminRemoverPresenca(lista, jogadorId) {
  const presenca = appData.presenca;
  if (!presenca) return;

  // Se era confirmado (não espera) e avulso → cancelar débito dessa pelada
  if (lista === 'confirmados' && !jogadorMensalista(jogadorId)) {
    const peladaData = presenca.data || appData.ultimoSorteio?.data || '';
    const fin = getFinancasJogador(jogadorId);
    if (fin.debitos && peladaData) {
      const idxDeb = [...fin.debitos].reverse()
        .findIndex(d => d.tipo==='avulso' && d.descricao?.includes(peladaData) && !d.quitado);
      if (idxDeb >= 0) {
        fin.debitos.splice(fin.debitos.length-1-idxDeb, 1);
        await firestoreSet('financas', jogadorId, fin);
        saveLocal();
      }
    }
  }

  presenca[lista] = (presenca[lista]||[]).filter(x => x !== jogadorId);
  appData.presenca = presenca;
  await firestoreSet('config', 'presenca', presenca);
  saveLocal();
  document.getElementById('modalAdminPresenca')?.remove();
  abrirAdminPresenca();
  renderPresenca();
  showToast('Removido da lista');
}

// Save custom local/horario to presença
async function setTipoPresenca(tipo) {
  if (!currentUser?.isAdmin) return;
  if (!appData.presenca) {
    appData.presenca = { confirmados:[], espera:[], data: appData.ultimoSorteio?.data || getProximoDomingo() };
  }
  // Save to BOTH fields for compatibility
  appData.presenca.tipo = tipo;
  appData.presenca.tipoPelada = tipo === 'classico' ? 'classico' : 'comum';
  await firestoreSet('config', 'presenca', appData.presenca);
  saveLocal();
  renderPresenca();
  document.getElementById('modalAdminPresenca')?.remove();
  abrirAdminPresenca();
  showToast(tipo === 'classico' ? '🐓🦊 Clássico ativado' : '⚽ Pelada normal');
}
window.setTipoPresenca = setTipoPresenca;

async function salvarInfoPelada() {
  const local = document.getElementById('apLocal')?.value?.trim();
  const ini = document.getElementById('apHoraIni')?.value?.trim();
  const fim = document.getElementById('apHoraFim')?.value?.trim();
  const presenca = appData.presenca || { confirmados:[], espera:[], data: appData.ultimoSorteio?.data };
  if (local) presenca.local = local;
  if (ini && fim) presenca.horario = `${ini} às ${fim}`;
  appData.presenca = presenca;
  await firestoreSet('config', 'presenca', presenca);
  saveLocal();
  document.getElementById('modalAdminPresenca')?.remove();
  renderPresenca();
  showToast('Informações salvas ✅');
}

// Toast flutuante de aviso para admins
function alertaAdminNaoCadastrado(nomeUsuario) {
  const alerta = document.createElement('div');
  alerta.style.cssText = `position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#1a0000;border:2px solid #ef4444;border-radius:12px;padding:14px 20px;z-index:999;max-width:320px;width:90%;box-shadow:0 8px 32px rgba(255,68,68,.3)`;
  alerta.innerHTML = `
    <div style="font-family:'Oswald',sans-serif;font-size:13px;letter-spacing:1px;color:#ef4444;margin-bottom:4px">⚠️ ATENÇÃO</div>
    <div style="font-size:13px;color:var(--text)"><strong style="color:#ef4444">${nomeUsuario}</strong> confirmou presença mas <strong>não está cadastrado</strong> como jogador</div>
    <button onclick="this.parentElement.remove()" style="margin-top:10px;background:rgba(255,68,68,.15);border:1px solid rgba(255,68,68,.3);border-radius:8px;color:#ef4444;padding:5px 14px;cursor:pointer;font-size:12px;width:100%">ENTENDIDO</button>`;
  document.body.appendChild(alerta);
  setTimeout(() => alerta?.remove(), 15000); // auto-dismiss 15s
}

function parsePeladaDate(dateStr) {
  if (!dateStr) return null;
  // dd/mm/yyyy
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  return new Date(+parts[2], +parts[1]-1, +parts[0], 11, 30).getTime();
}

// ─── PRESENÇA HELPERS ────────────────────────────────────────
// Retorna o tamanho de time efetivo:
// se há >=2 goleiros confirmados → tamanhoTime - 1 (1 jogador a menos)
// senão usa a config da lista
function getTamanhoTime(confirmados) {
  const p = appData.presenca;
  const base = p?.tamanhoTime || 5;
  const nGoleiros = (confirmados||[]).filter(id => {
    const j = appData.jogadores.find(x=>x.id===id);
    return j?.goleiro;
  }).length;
  if (nGoleiros >= 2) return Math.max(3, base - 1);
  return base;
}

function getVagasLimite(confirmados, espera) {
  // Lógica: times * n + espera n; quando espera cheia → sobe 1 multiplicador
  // Times de n jogadores: 3 times → confirmados = n*3, espera = n
  // Ao completar espera → 4 times → confirmados = n*4 + espera = n
  const n = getTamanhoTime(confirmados);
  const totalConf = (confirmados||[]).length;
  const totalEsp  = (espera||[]).length;
  // Patamar atual de times (começa em 3)
  // Se espera cheia e ainda não no próximo patamar → expande
  if (totalEsp >= n || totalConf >= n*4) return n*4;
  return n*3;
}

function getEsperaLimite(confirmados) {
  const n = getTamanhoTime(confirmados);
  return n;
}

async function promoverDaEspera(presencaObj, motivo) {
  if (!(presencaObj.espera||[]).length) return;
  const promovido = presencaObj.espera[0];
  presencaObj.espera = presencaObj.espera.slice(1);
  presencaObj.confirmados.push(promovido);
  if (!jogadorMensalista(promovido)) {
    const data = presencaObj.data || '';
    await gerarDebitoAvulsoPresenca(promovido, data, `promovido da espera — ${motivo}`);
  }
  return promovido;
}

async function gerarDebitoAvulsoPresenca(uid, presencaData, motivo) {
  // Gera débito de avulso como PENDÊNCIA (quitado: false) — admin dá baixa depois
  const peladaDate = parsePeladaDate(presencaData);
  const h24 = 24 * 60 * 60 * 1000;
  const sab12h = peladaDate ? new Date(peladaDate - h24).setHours(12,0,0,0) : null;
  const sab12hStr = sab12h ? new Date(sab12h).toLocaleDateString('pt-BR') + ' 12h' : 'Sáb 12h';
  const descricao = motivo
    ? `Pelada ${presencaData} — ${motivo} (pagar até ${sab12hStr})`
    : `Pelada ${presencaData} (pagar até ${sab12hStr})`;
  // Verifica se já existe débito para essa pelada (evita duplicata)
  const fin = getFinancasJogador(uid);
  const jaTemDebito = (fin.debitos||[]).some(d => d.tipo==='avulso' && d.descricao?.includes(presencaData) && !d.quitado);
  if (!jaTemDebito) {
    await adicionarDebito(uid, 'avulso', getValores().avulso, descricao);
  }
}

async function confirmarPresenca() {
  if (!currentUser || currentUser.isGuest) { showToast('Faça login para confirmar'); return; }

  const jogador = appData.jogadores.find(x => x.id === currentUser.id);
  if (!jogador) { showToast('Apenas jogadores cadastrados podem confirmar presença'); return; }
  if (jogadorInadimplente(currentUser.id)) {
    showToast('⚠️ Você possui pendências financeiras. Regularize para confirmar.'); return;
  }

  // Auto-create presença se não existir
  if (!appData.presenca) {
    const dataRef = appData.ultimoSorteio?.data || getProximoDomingo();
    appData.presenca = { confirmados:[], espera:[], data: dataRef };
    await firestoreSet('config','presenca', appData.presenca);
    saveLocal();
  }

  const p = appData.presenca;
  if (!p.confirmados) p.confirmados = [];
  if (!p.espera) p.espera = [];

  const uid = currentUser.id;
  if (p.confirmados.includes(uid) || p.espera.includes(uid)) {
    showToast('Você já está na lista'); return;
  }

  const now = Date.now();
  const peladaDate = parsePeladaDate(p.data);
  const h48 = 48 * 60 * 60 * 1000;
  const ehMensalista = jogadorMensalista(uid);

  // Janela de prioridade: somente mensalistas até 48h antes
  const dentroPrioridade = peladaDate ? now < (peladaDate - h48) : true; // sem data = prioridade ativa
  if (dentroPrioridade && !ehMensalista) {
    showToast('⏳ Lista reservada para mensalistas até 48h antes da pelada'); return;
  }

  const vagas = getVagasLimite(p.confirmados, p.espera);
  const esperaMax2 = getEsperaLimite(p.confirmados);
  const listaCheia = p.confirmados.length >= vagas;
  const esperaCheia = p.espera.length >= esperaMax2;

  if (!listaCheia) {
    // Vaga disponível → confirmar
    p.confirmados.push(uid);
    if (!ehMensalista) {
      await gerarDebitoAvulsoPresenca(uid, p.data, null);
    }
    showToast('Presença confirmada! ✅');
  } else if (ehMensalista) {
    // Lista cheia, mensalista → desloca o ÚLTIMO avulso para a espera
    const ultimoAvulso = [...p.confirmados].reverse().find(id => !jogadorMensalista(id));
    if (ultimoAvulso && !esperaCheia) {
      p.confirmados = p.confirmados.filter(id => id !== ultimoAvulso);
      p.espera.push(ultimoAvulso);
      p.confirmados.push(uid);
      const finDesloc = getFinancasJogador(ultimoAvulso);
      if (finDesloc.debitos) {
        const idxDeb = [...finDesloc.debitos].reverse()
          .findIndex(d => d.tipo==='avulso' && d.descricao?.includes(p.data||'') && !d.quitado);
        if (idxDeb >= 0) {
          finDesloc.debitos.splice(finDesloc.debitos.length-1-idxDeb, 1);
          await firestoreSet('financas', ultimoAvulso, finDesloc);
          saveLocal();
        }
      }
      showToast('Vaga garantida! Último avulso foi para a lista de espera ✅');
    } else if (!esperaCheia) {
      p.espera.push(uid);
      showToast('Adicionado à lista de espera');
    } else {
      showToast('Lista e espera completas'); return;
    }
  } else {
    // Lista cheia, avulso → vai para espera
    if (esperaCheia) { showToast(`Lista de espera cheia (${esperaMax2}/${esperaMax2})`); return; }
    p.espera.push(uid);
    showToast('Adicionado à lista de espera ✅');
  }

  appData.presenca = p;
  await firestoreSet('config', 'presenca', p);
  saveLocal();
  renderPresenca();
}

async function desmarcarPresenca() {
  if (!currentUser) return;
  const p = appData.presenca;
  if (!p) return;

  const uid = currentUser.id;
  const naEspera = (p.espera||[]).includes(uid);
  const naLista = (p.confirmados||[]).includes(uid);
  if (!naEspera && !naLista) return;

  const now = Date.now();
  const peladaDate = parsePeladaDate(p.data || appData.ultimoSorteio?.data);
  const h24 = 24 * 60 * 60 * 1000;
  const dentro24h = peladaDate && (peladaDate - now) < h24;
  const ehMens = jogadorMensalista(uid);

  if (naEspera) {
    // Sair da espera — sem penalidade
    p.espera = p.espera.filter(id => id !== uid);
    showToast('Removido da lista de espera');
  } else {
    // Desmarcar da lista confirmada
    if (dentro24h) {
      // < 24h: gera multa automática
      const multaValor = ehMens ? getValores().multa : getValores().avulso;
      const tipoStr = ehMens ? `mensalista — R$${multaValor.toFixed(2)}` : `avulso — R$${multaValor.toFixed(2)} (valor integral)`;
      if (!confirm(`Desmarcar com menos de 24h gera multa de ${tipoStr}. Confirmar?`)) return;
      await adicionarDebito(uid, 'multa', multaValor, `Desmarcou <24h — Pelada ${p.data||''}`);
      showToast(`⚠️ Multa de R$${multaValor} gerada`);
    } else {
      // > 24h: avulso tem débito cancelado
      if (!ehMens) {
        const fin = getFinancasJogador(uid);
        if (fin.debitos) {
          const idx = [...fin.debitos].reverse()
            .findIndex(d => d.tipo==='avulso' && d.descricao?.includes(p.data||'') && !d.quitado);
          if (idx >= 0) {
            fin.debitos.splice(fin.debitos.length-1-idx, 1);
            await firestoreSet('financas', uid, fin);
            saveLocal();
          }
        }
      }
      showToast('Presença desmarcada');
    }

    p.confirmados = p.confirmados.filter(id => id !== uid);

    // Promover primeiro da espera
    if ((p.espera||[]).length > 0) {
      await promoverDaEspera(p, 'vaga liberada');
    }
  }

  appData.presenca = p;
  await firestoreSet('config', 'presenca', p);
  saveLocal();
  renderPresenca();
}

// ─── HISTÓRICO DE PELADAS NA HOME ────────────────────────────
function renderPeladasHistorico() {
  const container = document.getElementById('homePeladasHist');
  if (!container) return;
  const isAdmin = currentUser?.isAdmin;

  // Collect all unique dates from ALL players' domingos
  const datasSet = new Set();
  for (const j of appData.jogadores) {
    for (const d of (j.domingos||[])) {
      if (d.data) datasSet.add(d.data);
    }
  }
  // Also include dates from peladasHist
  for (const p of (appData.peladasHist||[])) {
    if (p.data) datasSet.add(p.data);
  }

  if (!datasSet.size) { container.innerHTML = ''; return; }

  // Sort dates descending (dd/mm/yyyy)
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
      const p = histUnique.find(x => x.data === data);
      const votAberta = p?.votacao?.status === 'aberta';
      const podeVotar = votAberta && currentUser && !currentUser.isGuest
        && p.votacao?.elegiveisVotar?.includes(currentUser.id)
        && !p.votacao?.votos?.[currentUser.id];
      const totalVotos = Object.keys(p?.votacao?.votos||{}).length;
      const totalEleg = p?.votacao?.elegiveisVotar?.length||0;
      const mvpNome = p?.mvp?.nome || (votAberta ? '...' : '—');

      // Count players who played this date (not ausente)
      const jogNaData = appData.jogadores.filter(j =>
        (j.domingos||[]).some(d => d.data === data && !d.ausente)
      ).length;

      return `
      <div class="pelada-hist-card" onclick="${p ? `openPeladaDetalhe('${p.id}')` : `openDetalheSemHist('${data}')`}"
        style="cursor:pointer;${podeVotar ? 'border-color:rgba(234,179,8,.5);' : ''}">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:18px">${podeVotar ? '⭐' : '🏆'}</div>
          <div style="flex:1">
            <div style="font-family:'Oswald',sans-serif;font-size:14px;font-weight:700;letter-spacing:1px;color:var(--gold-lt)">
              ${(histUnique.find(x=>x.data===data)?.tipo==='classico'?'CLÁSSICO':'PELADA')} DO TORNEIRA — ${data}
            </div>
            <div style="font-size:11px;color:var(--t2);margin-top:2px">
              ${jogNaData} jogadores${p ? ` · ${votAberta
                ? `<span style="color:#eab308">⏳ Votação: ${totalVotos}/${totalEleg}</span>`
                : `MVP: ${mvpNome}`}` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${isAdmin && p && votAberta
              ? `<button onclick="event.stopPropagation();encerrarVotacaoForce('${p.id}')"
                  style="background:rgba(234,179,8,.15);border:1px solid rgba(234,179,8,.3);border-radius:8px;color:#eab308;font-size:11px;padding:4px 10px;cursor:pointer;font-family:'DM Sans',sans-serif">⚡ MVP</button>`
              : ''}
            ${isAdmin && p
              ? `<button onclick="event.stopPropagation();excluirPelada('${p.id}')"
                  style="background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.2);border-radius:8px;color:#ef4444;font-size:11px;padding:4px 10px;cursor:pointer;font-family:'DM Sans',sans-serif">🗑️</button>`
              : ''}
            <div style="color:${podeVotar ? '#eab308' : 'var(--t3)'};font-size:16px">${podeVotar ? 'VOTAR' : p ? '›' : ''}</div>
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
  // Check eligibility — elegiveisVotar is an array of player IDs
  // Also check by matching jogador id in peladaJogadores in case elegiveisVotar is missing
  const jogoiuNaPelada = !currentUser?.isGuest && (
    (v?.elegiveisVotar?.includes(currentUser?.id)) ||
    (p.jogadores||[]).some(j => j.id === currentUser?.id && !j.ausente)
  );
  const podeVotar = jogoiuNaPelada && v?.status === 'aberta' && !jaVotou;
  const podeVotarFinal = podeVotar;

  // Time remaining
  let tempoHTML = '';
  if (v?.status === 'aberta' || p.votacaoBolaMurcha?.status === 'aberta') {
    const remaining = Math.max(0, (v?.elapsesAt || p.votacaoBolaMurcha?.elapsesAt || 0) - Date.now());
    const horas = Math.floor(remaining / 3600000);
    const min = Math.floor((remaining % 3600000) / 60000);
    const totalMvp = Object.keys(v?.votos||{}).length;
    const totalBm  = Object.keys(p.votacaoBolaMurcha?.votos||{}).length;
    const totalEleg = v?.elegiveisVotar?.length || p.votacaoBolaMurcha?.elegiveisVotar?.length || 0;
    const meuVotoBm = p.votacaoBolaMurcha?.votos?.[currentUser?.id];
    const meuVotoMvp = v?.votos?.[currentUser?.id];
    tempoHTML = `<div style="background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.25);border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#eab308;font-weight:600;margin-bottom:6px">⏳ VOTAÇÕES ABERTAS</div>
      <div style="font-size:12px;color:var(--t2)">Encerra em <strong style="color:var(--text)">${horas}h ${min}min</strong></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <div style="flex:1;background:rgba(201,168,76,.08);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:10px;color:var(--t2)">⭐ MVP</div>
          <div style="font-size:12px;color:${meuVotoMvp?'#22c55e':'var(--gold)'}">${totalMvp}/${totalEleg} ${meuVotoMvp?'✓ votei':'—'}</div>
        </div>
        <div style="flex:1;background:rgba(239,68,68,.06);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:10px;color:var(--t2)">🎈 Bola Murcha</div>
          <div style="font-size:12px;color:${meuVotoBm?'#22c55e':'#ef4444'}">${totalBm}/${totalEleg} ${meuVotoBm?'✓ votei':'—'}</div>
        </div>
      </div>
      ${currentUser?.isAdmin ? `<button onclick="encerrarVotacaoForce('${p.id}')" style="margin-top:8px;background:rgba(234,179,8,.15);border:1px solid rgba(234,179,8,.3);border-radius:8px;color:#eab308;font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:1px;padding:6px 14px;cursor:pointer;width:100%">⚡ ENCERRAR VOTAÇÕES AGORA</button>` : ''}
    </div>`;
  }

  // ── Voting UI — MVP + Bola Murcha ──────────────────────────
  const bm = p.votacaoBolaMurcha;
  const meuVotoBm  = bm?.votos?.[currentUser?.id];
  const jaVotouBm  = !!meuVotoBm;
  const podeVotarBm = !currentUser?.isGuest
    && !jaVotouBm
    && bm?.status === 'aberta'
    && (bm?.elegiveisVotar?.includes(currentUser?.id)
        || (p.jogadores||[]).some(j=>j.id===currentUser?.id&&!j.ausente));

  function buildVoteStatus(votosObj, elegiveisArr) {
    return (elegiveisArr||[]).map(eid => {
      const jj = appData.jogadores.find(x=>x.id===eid);
      return { id: eid, nome: jj?.nome||eid, votou: !!votosObj?.[eid] };
    });
  }
  function statusPills(arr) {
    return arr.map(s=>`<span style="color:${s.votou?'#22c55e':'var(--t3)'};">${s.nome}${s.votou?'✓':''}</span>`).join(' · ');
  }

  let mvpHTML = '';
  if (v && v.nominees?.length > 0) {
    if (v.status === 'encerrada' || p.mvp) {
      const cont = {}; for (const vt of Object.values(v.votos||{})) cont[vt]=(cont[vt]||0)+1;
      mvpHTML = `<div class="section-lbl">⭐ VOTAÇÃO MVP</div>` +
        v.nominees.map(n=>{
          const vc=cont[n.id]||0, win=p.mvp?.id===n.id;
          return `<div style="background:${win?'rgba(201,168,76,.1)':'var(--s2)'};border:1px solid ${win?'var(--border-gold)':'var(--border)'};border-radius:10px;padding:11px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px">
            <div style="font-size:20px">${win?'⭐':'👤'}</div>
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px;color:${win?'var(--gold-lt)':'var(--text)'}">${n.nome}${win?' <span style="font-size:10px;color:var(--gold)">MVP</span>':''}</div>
              <div style="font-size:11px;color:var(--t2)">Score ${n.scoreDia.toFixed(2)} · ⚽${n.gols} 🎯${n.assists} 🏆${n.vitorias}</div>
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:16px;color:${win?'var(--gold)':'var(--t2)'};">${vc}</div>
          </div>`;
        }).join('') +
``;
    } else if (v.status === 'aberta') {
      if (podeVotarFinal) {
        mvpHTML = `<div class="section-lbl">⭐ VOTE NO MVP</div><div style="font-size:12px;color:var(--t2);margin-bottom:10px">Quem foi o melhor?</div>` +
          v.nominees.map(n=>{
            const self=n.id===currentUser?.id;
            return `<div style="background:var(--s2);border:1px solid var(--border-gold);border-radius:10px;padding:11px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px">
              <div style="flex:1">
                <div style="font-weight:600;font-size:14px">${n.nome}${self?' <span style="font-size:10px;color:var(--t2)">(você)</span>':''}</div>
                <div style="font-size:11px;color:var(--t2)">Score ${n.scoreDia.toFixed(2)} · ⚽${n.gols} 🎯${n.assists} 🏆${n.vitorias}</div>
              </div>
              ${self?`<div style="font-size:11px;color:var(--t3)">Não pode votar em si</div>`:`<button class="btn btn-gold" style="width:auto;padding:8px 16px;font-size:13px" onclick="votarMvp('${p.id}','${n.id}')">VOTAR</button>`}
            </div>`;
          }).join('') +
          `<div style="font-size:10px;color:var(--t2);margin-top:2px"></div>`;
      } else if (jaVotou) {
        const nom = v.nominees.find(n=>n.id===meuVoto);
        mvpHTML = `<div class="section-lbl">⭐ VOTAÇÃO MVP</div>
          <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;font-size:13px;color:var(--t2)">
            ✅ Você votou em <strong style="color:var(--text)">${nom?.nome||meuVoto}</strong></div>` +
          v.nominees.map(n=>`<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:10px">
            <div style="flex:1"><div style="font-weight:600;font-size:13px">${n.nome}</div>
            <div style="font-size:11px;color:var(--t2)">Score ${n.scoreDia.toFixed(2)} · ⚽${n.gols} 🎯${n.assists} 🏆${n.vitorias}</div></div>
            ${meuVoto===n.id?'<div style="color:var(--gold);font-size:12px">✅ seu voto</div>':''}
          </div>`).join('') +
          `<div style="font-size:10px;color:var(--t2);margin-top:2px"></div>`;
      } else {
        mvpHTML = `<div class="section-lbl">⭐ VOTAÇÃO MVP</div><div style="font-size:12px;color:var(--t2);margin-bottom:8px">Candidatos:</div>` +
          v.nominees.map(n=>`<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:6px">
            <div style="font-weight:600;font-size:13px">${n.nome}</div>
            <div style="font-size:11px;color:var(--t2)">Score ${n.scoreDia.toFixed(2)} · ⚽${n.gols} 🎯${n.assists} 🏆${n.vitorias}</div>
          </div>`).join('') +
          `<div style="font-size:10px;color:var(--t2);margin-top:2px"></div>`;
      }
    }
  }

  let bmHTML = '';
  if (bm) {
    const candidatos = (p.jogadores||[]).filter(j=>!j.ausente);
    const contBm = {}; for (const v2 of Object.values(bm.votos||{})) contBm[v2]=(contBm[v2]||0)+1;
    if (bm.status==='encerrada' || p.bolaMurcha) {
      bmHTML = `<div class="section-lbl" style="margin-top:12px">🎈 BOLA MURCHA</div>` +
        candidatos.sort((a,b)=>(contBm[b.id]||0)-(contBm[a.id]||0)).map(n=>{
          const vc=contBm[n.id]||0, lose=p.bolaMurcha?.id===n.id;
          return `<div style="background:${lose?'rgba(239,68,68,.08)':'var(--s2)'};border:1px solid ${lose?'rgba(239,68,68,.3)':'var(--border)'};border-radius:10px;padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
            <div style="font-size:18px">${lose?'🎈':'👤'}</div>
            <div style="flex:1">
              <div style="font-weight:600;font-size:13px;color:${lose?'#ef4444':'var(--text)'}">${n.nome}${lose?' 🎈':''}</div>
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:15px;color:${lose?'#ef4444':'var(--t2)'};">${vc}</div>
          </div>`;
        }).join('') +
        ``;
    } else if (bm.status==='aberta') {
      if (podeVotarBm) {
        bmHTML = `<div class="section-lbl" style="margin-top:12px">🎈 VOTE NA BOLA MURCHA</div>
          <div style="font-size:12px;color:var(--t2);margin-bottom:10px">Quem foi o mais murcho?</div>` +
          candidatos.map(n=>`<div style="background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
            <div style="flex:1"><div style="font-size:13px;font-weight:500">${n.nome}</div></div>
            <button onclick="votarBolaMurcha('${p.id}','${n.id}')" style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:8px;color:#ef4444;font-size:12px;padding:6px 12px;cursor:pointer;font-family:'Oswald',sans-serif;letter-spacing:1px">VOTAR</button>
          </div>`).join('') +
          `<div style="font-size:10px;color:var(--t2);margin-top:2px"></div>`;
      } else if (jaVotouBm) {
        const nomBm = candidatos.find(c=>c.id===meuVotoBm)?.nome||meuVotoBm;
        bmHTML = `<div class="section-lbl" style="margin-top:12px">🎈 BOLA MURCHA</div>
          <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;font-size:13px;color:var(--t2)">
            ✅ Você votou em <strong style="color:#ef4444">${nomBm}</strong></div>
          <div style="font-size:10px;color:var(--t2)"></div>`;
      } else {
        bmHTML = `<div class="section-lbl" style="margin-top:12px">🎈 BOLA MURCHA</div>
          <div style="font-size:12px;color:var(--t2);margin-bottom:6px">Votação em andamento.</div>
          <div style="font-size:10px;color:var(--t2)"></div>`;
      }
    }
  }

  let votacaoHTML = mvpHTML + bmHTML;

  // Podium block
  let podioHTML = '';
  if (p.podio) {
    const medals = ['🥈','🥇','🥉']; // order matches podium display: 2nd-left, 1st-center, 3rd-right
    const lugares = [p.podio.segundo, p.podio.primeiro, p.podio.terceiro]; // podium order: 2nd left, 1st center, 3rd right
    podioHTML = `<div class="section-lbl" style="margin-top:14px">PÓDIO DO DIA</div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        ${lugares.map((pl,i) => pl ? `
          <div style="flex:1;background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 8px;text-align:center">
            <div style="font-size:${i===1?'32':'22'}px">${medals[i]}</div>
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
      const emojisBtns = ['🔥','👑','💀','🎯','⚽','😂','👏','💪','🌈','💩','🚬','🍺'].map(em => {
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

  // DEBUG: log voting state to console
  console.log('[MVP DEBUG]', {
    currentUserId: currentUser?.id,
    elegiveisVotar: v?.elegiveisVotar,
    inclui: v?.elegiveisVotar?.includes(currentUser?.id),
    status: v?.status,
    jaVotou,
    podeVotarFinal,
    votos: v?.votos
  });

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

function openDetalheSemHist(data) {
  // Build a basic stats view from jogadores' domingos for this date
  const jogNaData = appData.jogadores
    .map(j => {
      const dom = (j.domingos||[]).find(d => d.data === data);
      if (!dom) return null;
      const score = dom.ausente ? -1 : +(dom.gols + dom.assists + 0.75 * dom.vitorias).toFixed(2);
      return { id: j.id, nome: j.nome, gols: dom.gols||0, assists: dom.assists||0,
               vitorias: dom.vitorias||0, scoreDia: score, ausente: dom.ausente };
    })
    .filter(Boolean)
    .sort((a,b) => b.scoreDia - a.scoreDia);

  const presentes = jogNaData.filter(j => !j.ausente);
  const ausentes  = jogNaData.filter(j => j.ausente);

  const podioHTML = presentes.length > 0 ? `
    <div class="section-lbl" style="margin-top:4px">PÓDIO DO DIA</div>
    <div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">
      ${[presentes[1], presentes[0], presentes[2]].map((p,i) => p ? `
        <div style="text-align:center;flex:1;max-width:90px">
          <div style="font-size:${i===1?'28':'22'}px">${['🥈','🥇','🥉'][i]}</div>
          <div style="font-size:12px;font-weight:600;margin-top:4px">${p.nome}</div>
          <div style="font-size:10px;color:var(--t2)">${p.scoreDia.toFixed(2)}</div>
        </div>` : '<div style="flex:1"></div>').join('')}
    </div>` : '';

  const rowsHTML = presentes.map((j,i) => `
    <div class="prow rank-row">
      <div class="rank-n ${i===0?'g':i===1?'s':i===2?'b':''}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`}</div>
      <div class="rank-name-col"><div class="p-name">${j.nome}</div></div>
      <div class="rank-stats-row">
        <div class="rank-stat"><div class="rs-v">${j.scoreDia.toFixed(2)}</div><div class="rs-l">Score</div></div>
        <div class="rank-stat"><div class="rs-v">${j.gols}</div><div class="rs-l">⚽</div></div>
        <div class="rank-stat"><div class="rs-v">${j.assists}</div><div class="rs-l">🎯</div></div>
        <div class="rank-stat"><div class="rs-v">${j.vitorias}</div><div class="rs-l">🏆</div></div>
      </div>
    </div>`).join('');

  const ausentesHTML = ausentes.length > 0 ? `
    <div style="font-size:11px;color:var(--t3);margin-top:10px">
      Ausentes: ${ausentes.map(j=>j.nome).join(', ')}
    </div>` : '';

  document.getElementById('peladaDetalheTitle').textContent = `PELADA ${data}`;
  document.getElementById('peladaDetalheMvp').innerHTML = podioHTML;
  document.getElementById('peladaDetalheList').innerHTML =
    `<div class="section-lbl" style="margin-top:4px">ESTATÍSTICAS</div>${rowsHTML}${ausentesHTML}`;

  // Hide delete button for manual entries (no peladaHist id)
  const delBtn = document.getElementById('btnExcluirPelada');
  if (delBtn) delBtn.style.display = 'none';

  openModal('modalPeladaDetalhe');
}
window.openDetalheSemHist = openDetalheSemHist;
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
  if (!confirm(`Excluir pelada de ${data}? Remove estatísticas e débitos de ${jogadoresComData.length} jogadores.`)) return;
  if (!confirm('Tem certeza? Esta ação não pode ser desfeita.')) return;

  for (const j of jogadoresComData) {
    // Remove domingo
    j.domingos = (j.domingos||[]).filter(d => d.data !== data);
    await firestoreSet('jogadores', j.id, j);

    // Remove débitos gerados por esta pelada (avulso + multa de ausência)
    const fin = getFinancasJogador(j.id);
    const antes = (fin.debitos||[]).length;
    fin.debitos = (fin.debitos||[]).filter(d =>
      !(d.descricao?.includes(data) && (d.tipo === 'avulso' || d.tipo === 'multa'))
    );
    if (fin.debitos.length !== antes) {
      await firestoreSet('financas', j.id, fin);
    }
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
  if (!confirm(`Excluir pelada de ${p.data}? As estatísticas e débitos dos jogadores serão removidos.`)) return;
  if (!confirm('Tem certeza? Esta ação não pode ser desfeita.')) return;

  const data = p.data;

  // Remove stats e débitos de cada jogador da pelada
  for (const jp of (p.jogadores||[])) {
    const j = appData.jogadores.find(x=>x.id===jp.id);
    if (!j) continue;

    // Remove domingo
    const before = j.domingos?.length || 0;
    j.domingos = (j.domingos||[]).filter(d => d.data !== data);
    if (p.mvp?.id === j.id && j.mvps > 0) j.mvps--;
    if (j.domingos.length !== before) {
      await firestoreSet('jogadores', j.id, j);
    }

    // Remove débitos gerados por esta pelada (avulso + multa de ausência)
    const fin = getFinancasJogador(jp.id);
    const antes = (fin.debitos||[]).length;
    fin.debitos = (fin.debitos||[]).filter(d =>
      !(d.descricao?.includes(data) && (d.tipo === 'avulso' || d.tipo === 'multa'))
    );
    if (fin.debitos.length !== antes) {
      await firestoreSet('financas', jp.id, fin);
    }
  }

  // Delete pelada from Firebase
  await firestoreDelete('peladasHist', peladaId);
  appData.peladasHist = (appData.peladasHist||[]).filter(x=>x.id!==peladaId);
  saveLocal();
  closeModal('modalPeladaDetalhe');
  renderPeladasHistorico();
  showToast('Pelada excluída — estatísticas e débitos removidos');
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
// ─── JOGADORES / ELENCO ──────────────────────────────────────
let jogFiltro = 'todos';
function setJogFiltro(f) {
  jogFiltro = f;
  document.querySelectorAll('[data-jf]').forEach(c => c.classList.toggle('sel', c.dataset.jf === f));
  renderJogs();
}
window.setJogFiltro = setJogFiltro;

function renderJogs() {
  const list=document.getElementById('jogList');
  const ct=document.getElementById('jogCount');
  const n=appData.jogadores.length;
  ct.textContent=`${n} jogador${n!==1?'es':''} cadastrado${n!==1?'s':''}`;
  let jogs = appData.jogadores;
  if (jogFiltro === 'mensal') jogs = jogs.filter(j => j.tipoJogador === 'mensalista');
  else if (jogFiltro === 'avulso') jogs = jogs.filter(j => j.tipoJogador !== 'mensalista');
  if(!jogs.length){list.innerHTML=`<div class="empty"><div class="empty-ico">⚽</div><div class="empty-txt">Nenhum jogador nesta categoria.</div></div>`;return;}
  const idxMap=Object.fromEntries(calcIdx(appData.jogadores).map(i=>[i.id,i]));
  list.innerHTML=jogs.map(j=>{
    const ix=idxMap[j.id], nd=nDom(j);
    const isAdm=(appData.admins||[]).includes(j.id);
    const ifStr=nd>0?ix?.IF.toFixed(2):null;
    const isOnline = currentUser?.id === j.id;
    const temConta = !!j.senha;
    return `
    <div class="prow" onclick="openPerfil('${j.id}')">
      <div class="p-avatar" style="${j.foto?'padding:0;overflow:hidden':''}${isOnline?';border-color:var(--gold)':''}">
        ${j.foto?`<img src="${j.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:j.nome[0].toUpperCase()}
      </div>
      <div class="p-info">
        <div class="p-name">${j.nome}${isAdm?'<span class="badge-adm">ADMIN</span>':''}</div>
        <div class="p-meta">Nota: ${j.nota?.toFixed(1)} · ${nd} domingo${nd!==1?'s':''}
          · <span style="color:${temConta?'#22c55e':'#94a3b8'};font-size:13px" title="${temConta?'Conta ativa':'Sem conta'}">${temConta?'🟩':'⬜'}</span>
        </div>
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
  // Atualiza labels do select com valores atuais configurados
  const sel=document.getElementById('inpTipo');
  if(sel){
    const v=getValores();
    sel.options[0].text=`Avulso (R$${v.avulso.toFixed(2)}/pelada)`;
    sel.options[1].text=`Mensalista (R$${v.mensal.toFixed(2)}/mês)`;
  }
  if(id){
    const j=appData.jogadores.find(x=>x.id===id);
    if(j){
      document.getElementById('inpNome').value=j.nome;
      document.getElementById('inpNota').value=j.nota?.toFixed(1);
      if(sel)sel.value=j.tipoJogador||'avulso';
      const clube=document.getElementById('inpClube');if(clube)clube.value=j.clube||'';
      const goleiro=document.getElementById('inpGoleiro');if(goleiro)goleiro.checked=!!j.goleiro;
    }
  } else {
    const clube=document.getElementById('inpClube');if(clube)clube.value='';
    const goleiro=document.getElementById('inpGoleiro');if(goleiro)goleiro.checked=false;
  }
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
  const clube = document.getElementById('inpClube')?.value || '';
  const goleiro = document.getElementById('inpGoleiro')?.checked || false;
  // Check duplicate name (accent-insensitive), ignoring the player being edited
  const nomeLower = normAccent(nome);
  const duplicado = appData.jogadores.find(j =>
    normAccent(j.nome) === nomeLower && j.id !== editId
  );
  if (duplicado) { showToast(`Já existe um jogador chamado "${duplicado.nome}"`); return; }

  if(editId){
    const j=appData.jogadores.find(x=>x.id===editId);
    if(j){j.nome=nome;j.nota=nota;j.tipoJogador=tipo;j.clube=clube;j.goleiro=goleiro;await firestoreSet('jogadores',editId,j);}
  } else {
    // Check mensalista limit
    if (tipo==='mensalista' && appData.jogadores.filter(j=>j.tipoJogador==='mensalista').length >= 15) {
      showToast('Limite de 15 mensalistas atingido'); return;
    }
    const id='p'+Date.now();
    const nj={id,nome,nota,tipoJogador:tipo,clube,goleiro,domingos:[],criadoEm:Date.now()};
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
      case 'bm':       va = a.j.bolaMurchas||0; vb = b.j.bolaMurchas||0; break;
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
    const bms  = j.bolaMurchas || 0;

    return `<div class="prow rank-row" onclick="openPerfil('${j.id}')">
      <div class="rank-row-top">
        <div class="rank-n ${cl}">${medal}</div>
        <div class="rank-name-col">
          <div class="p-name">${j.nome}${isAdm ? '<span class="badge-adm">ADM</span>' : ''}${mvps>0?`<span style="background:linear-gradient(135deg,var(--gold),var(--gold-lt));color:#000;font-size:8px;padding:1px 6px;border-radius:99px;font-family:Oswald,sans-serif;letter-spacing:1px;margin-left:5px">⭐${mvps}</span>`:''
            }${bms>0?`<span style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:#ef4444;font-size:8px;padding:1px 6px;border-radius:99px;font-family:Oswald,sans-serif;letter-spacing:1px;margin-left:4px">🎈${bms}</span>`:''}
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
        <div class="rank-stat ${rankStat==='mvps'     ?'hl':''}" style="border-right:1px solid var(--border)"><div class="rs-v">${mvps>0?'⭐'+mvps:'—'}</div><div class="rs-l">MVP</div></div>
        <div class="rank-stat ${rankStat==='bm'       ?'hl':''}" ><div class="rs-v">${bms>0?'🎈'+bms:'—'}</div><div class="rs-l">Murcha</div></div>
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
      ${canEditPhoto ? `<label for="fotoInputGlobal" onclick="window._fotoUploadTarget='${j.id}'" style="display:inline-block;background:var(--s2);border:1px solid var(--border-gold);border-radius:99px;color:var(--gold);font-size:11px;padding:5px 14px;cursor:pointer;font-family:'DM Sans',sans-serif">📷 ${j.foto ? 'Trocar foto' : 'Adicionar foto'}</label>` : ''}
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
        ${j.tipoJogador==='mensalista'?'⬇️ Tornar avulso':`⬆️ Tornar mensalista (R$${getValores().mensal.toFixed(2)}/mês)`}
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
    <label for="fotoInputGlobal" onclick="document.getElementById('userFloatMenu')?.remove();window._fotoUploadTarget='${currentUser.id}'" style="width:100%;display:flex;align-items:center;gap:8px;background:none;border:none;color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;padding:9px 10px;text-align:left;cursor:pointer;border-radius:8px;box-sizing:border-box">📷 Alterar foto</label>
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
// Target do upload atual (síncrono, salvo antes do .click())
let _fotoUploadTarget = null;

// Inicializa o handler do input permanente (chamado uma vez no boot)
function initFotoInput() {
  const inp = document.getElementById('fotoInputGlobal');
  if (!inp) return;
  inp.addEventListener('change', async () => {
    const file = inp.files[0];
    inp.value = ''; // reset para permitir reescolha da mesma foto
    const targetId = _fotoUploadTarget;
    _fotoUploadTarget = null;
    if (!file || !targetId) return;
    const j = appData.jogadores.find(x => x.id === targetId);
    if (!j) return;
    if (file.size > 15 * 1024 * 1024) { showToast('Foto muito grande (máx 15MB)'); return; }
    showToast('Processando foto...');
    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const resized = await resizeImage(base64, 400);
      j.foto = resized;
      await firestoreSet('jogadores', targetId, j);
      if (currentUser?.id === targetId) {
        currentUser.foto = resized;
        localStorage.setItem(LS_USER, JSON.stringify(currentUser));
        const hAvatar = document.getElementById('hAvatar');
        if (hAvatar) hAvatar.innerHTML = `<img src="${resized}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
      }
      saveLocal();
      showToast('✅ Foto atualizada!');
      if (curScreen === 'jogadores') renderJogs();
      else openPerfil(targetId);
    } catch(err) {
      console.error('Erro foto:', err);
      showToast('Erro ao salvar. Tente novamente.');
    }
  });
}

function abrirUploadFoto(jogadorId) {
  // ⚠️ SÍNCRONO: nenhum await antes do .click() — exigência do mobile
  const targetId = jogadorId || currentUser?.id;
  if (!targetId) { showToast('Nenhum jogador identificado'); return; }
  if (currentUser?.id !== targetId && !currentUser?.isAdmin) { showToast('Sem permissão'); return; }
  const j = appData.jogadores.find(x => x.id === targetId);
  if (!j) { showToast('Jogador não cadastrado'); return; }

  document.getElementById('userFloatMenu')?.remove();

  // Salva o alvo de forma síncrona antes do click
  _fotoUploadTarget = targetId;

  // Usa o input permanente do DOM (evita bloqueio mobile com createElement)
  const inp = document.getElementById('fotoInputGlobal');
  if (!inp) { showToast('Erro ao abrir câmera'); return; }
  inp.value = '';
  inp.click(); // última instrução — sem nada async antes
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
function renderRegras() {
  const v = getValores();
  const end = appData.presenca?.local || 'R. Juscelino Barbosa 254';
  const pix = 'mfnassif16@gmail.com';
  // Horário a partir da lista de presença ou padrão
  const horaIni = appData.presenca?.horario?.split(' às ')?.[0] || '11:30';
  const horaFim3 = appData.presenca?.horario?.split(' às ')?.[1] || '13:00';
  const n = getTamanhoTime(appData.presenca?.confirmados||[]);
  const horaFim4 = (() => {
    // Calcula fim com 4 times = +30min
    const [h, m] = horaFim3.split(':').map(Number);
    const total = h*60 + m + 30;
    return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
  })();
  const body = document.getElementById('modalRegrasBody');
  if (!body) return;
  body.innerHTML = `
    <div style="font-size:13px;color:var(--text);line-height:1.9">
      <div style="margin-bottom:14px">
        <div style="font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:2px;color:var(--gold);margin-bottom:6px">MENSALISTAS</div>
        <div>• Pagamento: <strong>R$${v.mensal.toFixed(0)}/mês</strong> até o 5º dia útil</div>
        <div>• Atraso: multa de <strong>R$${v.multaSem.toFixed(0)}/semana</strong></div>
        <div>• Prioridade na lista até <strong>48h antes</strong> da pelada</div>
        <div>• Todas as peladas do mês incluídas</div>
      </div>
      <div style="margin-bottom:14px">
        <div style="font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:2px;color:var(--gold);margin-bottom:6px">AVULSOS</div>
        <div>• Pagamento: <strong>R$${v.avulso.toFixed(0)}/pelada</strong></div>
        <div>• Pagar até <strong>24h antes</strong> ou perde a vaga</div>
        <div>• Pode confirmar após a janela de 48h dos mensalistas</div>
      </div>
      <div style="margin-bottom:14px">
        <div style="font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:2px;color:var(--gold);margin-bottom:6px">PARTIDAS</div>
        <div>• 1ª partida: <strong>10 min, sem limite de gol</strong> (2 primeiros times completos a chegar)</div>
        <div>• Demais: <strong>7 min</strong> ou <strong>2 gols</strong></div>
        <div>• Times de <strong>${n}</strong> jogadores</div>
      </div>
      <div>
        <div style="font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:2px;color:#ef4444;margin-bottom:6px">FALTAS E MULTAS</div>
        <div>• Desmarcar &lt;24h ou não ir:</div>
        <div style="padding-left:12px">Mensalista: <strong>R$${v.multa.toFixed(0)}</strong></div>
        <div style="padding-left:12px">Avulso: <strong>R$${v.avulso.toFixed(0)}</strong></div>
        <div>• Inadimplentes não confirmam presença</div>
      </div>
    </div>
    <div style="background:var(--s2);border-radius:8px;padding:10px 12px;margin-top:14px;font-size:12px;color:var(--t2)">
      📍 ${end}<br>
      ⏰ ${horaIni} às ${horaFim3} (3 times) · até ${horaFim4} (4 times)<br>
      💳 Pix: ${pix}
    </div>`;
}
window.renderRegras = renderRegras;

function renderOpcoes() {
  const v = appData.config?.aleatoriedade??15;
  const isAdmin = currentUser?.isAdmin;
  document.getElementById('sliderWrap').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('sliderLocked').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('sliderLockedVal').textContent = v + '%';
  document.getElementById('sliderAlea').value = v;
  document.getElementById('aleaVal').textContent = v + '%';
  renderRestList();

  // Admin tools block
  const adminTools = document.getElementById('adminToolsOpcoes');
  if (adminTools) {
    adminTools.style.display = isAdmin ? 'block' : 'none';
  }
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
  if(id==='modalRegras') renderRegras();
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
const T_NAMES=['Time Vermelho','Time Azul','Time Branco','Time Preto'];
const T_COLORS=['t0','t1','t2','t3'];

function startFlow() {
  if(!currentUser?.isAdmin){showToast('Sem permissão');return;}
  // Sempre lê o estado mais recente da presença do appData (já sincronizado via onSnapshot)
  const confirmados = appData.presenca?.confirmados || [];
  const n = confirmados.length;
  openModal('modalDataSorteio');
  const dataPres = appData.presenca?.data || new Date().toLocaleDateString('pt-BR');
  document.getElementById('inputDataSorteio').value = dataPres;
  const info = document.getElementById('dataSorteioInfo');
  if (info) {
    if (n === 15 || n === 20) {
      info.textContent = `✅ ${n} confirmados → sorteia ${n===15?3:4} times automaticamente`;
      info.style.color = 'var(--gold)';
    } else if (n > 0) {
      info.textContent = `📋 ${n} confirmados na lista — abrirá seleção manual (sortear requer 10, 15 ou 20)`;
      info.style.color = '#eab308';
    } else {
      info.textContent = 'Sem lista de presença — seleção manual de jogadores';
      info.style.color = 'var(--t2)';
    }
  }
}

async function confirmarDataSorteio() {
  if (!currentUser?.isAdmin) { showToast('Sem permissão'); return; }
  const data = document.getElementById('inputDataSorteio').value.trim();
  if (!data) { showToast('Informe a data da pelada'); return; }
  closeModal('modalDataSorteio');

  // Lê confirmados do appData (sempre sincronizado via onSnapshot)
  // APENAS confirmados (não espera) vão para o sorteio
  const confirmados = (appData.presenca?.confirmados || [])
    .filter(id => appData.jogadores.find(x=>x.id===id)); // só cadastrados
  const n = confirmados.length;

  const tipoPelada = appData.presenca?.tipoPelada || 'comum';
  const tamanhoTime = getTamanhoTime(confirmados);
  const tamanhosValidos = [tamanhoTime*2, tamanhoTime*3, tamanhoTime*4];

  appData.restricoes = appData.restricoes.filter(r=>r.duracao!=='domingo');
  flow = {
    step: 'sel',
    presentes: [...confirmados],
    times:[], data,
    ausentes:[], statsIdx:0, statsOrder:[], statsData:{}, _saving:false,
    semTimes: false,
    tipoPelada,
    tamanhoTime,
  };

  document.getElementById('flow').style.display = 'block';

  if (tipoPelada === 'classico') {
    // Clássico: sorteia diretamente dividindo atleticanos vs cruzeirenses
    saveLocal();
    sortearTimesClassico();
  } else if (tamanhosValidos.includes(n)) {
    saveLocal();
    sortearTimes();
  } else {
    flow.step = 'sel';
    saveLocal();
    renderFlow();
  }
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
  else if(flow.step==='lista') renderFlowLista(c,t);
  else if(flow.step==='times') renderFlowTimes(c,t);
  else if(flow.step==='ausentes') renderFlowAusentes(c,t);
  else if(flow.step==='stats') { t.textContent=`ESTATÍSTICAS ${flow.statsIdx+1}/${flow.statsOrder.length}`; renderStatsStep(c); }
}

function renderFlowLista(c,t) {
  t.textContent = `LISTA (${flow.presentes.length} jogadores)`;
  const aus = flow.ausentes;
  c.innerHTML = `
    <div style="background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.2);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:var(--t2)">
      ⚠️ Lista com <strong style="color:var(--gold-lt)">${flow.presentes.length} jogadores</strong> — sem sorteio de times
      (sorteio requer exatamente 15 ou 20)
    </div>
    <div style="margin-bottom:14px">
      ${flow.presentes.map(id => {
        const j = appData.jogadores.find(x=>x.id===id);
        const ausente = aus.includes(id);
        return `<div class="prow ${ausente?'sel':''}" onclick="toggleAusente('${id}')" style="${ausente?'border-color:#ef4444;background:rgba(239,68,68,.05)':''}">
          <div class="p-avatar">${j?.nome?.[0]?.toUpperCase()||'?'}</div>
          <div class="p-name">${j?.nome||id}</div>
          <div style="font-size:20px">${ausente?'❌':'✅'}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="font-size:11px;color:var(--t3);margin-bottom:10px;text-align:center">
      ${aus.length > 0 ? `${aus.length} falta${aus.length>1?'s':''}` : 'Todos presentes'}
    </div>
    <button class="btn btn-gold" onclick="confirmarListaSemTimes()">CONTINUAR → ESTATÍSTICAS</button>`;
}

function confirmarListaSemTimes() {
  // Fluxo sem times: semTimes=true, statsOrder = presentes não ausentes
  flow.semTimes = true;
  flow.statsOrder = flow.presentes.filter(id => !flow.ausentes.includes(id));
  flow.statsData = {};
  flow.statsOrder.forEach(id => { flow.statsData[id] = {gols:0, assists:0, vitorias:0}; });
  flow.statsIdx = 0;
  flow.step = 'stats';
  renderFlow();
}

function renderFlowSel(c,t) {
  t.textContent='SELECIONAR PRESENTES';
  const sel=flow.presentes;
  // Conta apenas os que são jogadores cadastrados
  const nCadastrados = sel.filter(id => appData.jogadores.find(x=>x.id===id)).length;
  const n = nCadastrados;
  const validSortear = n===10||n===15||n===20;
  const validSemTimes = n>0 && !validSortear;

  let hint;
  if (n===10) hint=`<span style="color:#22c55e">✓ ${n} jogadores → 2 times</span>`;
  else if (n===15) hint=`<span style="color:#22c55e">✓ ${n} jogadores → 3 times</span>`;
  else if (n===20) hint=`<span style="color:#22c55e">✓ ${n} jogadores → 4 times</span>`;
  else if (n===0) hint=`Selecione os jogadores presentes`;
  else {
    const prox = n<10?10:n<15?15:n<20?20:null;
    hint=`<span style="color:#eab308">${n} selecionados${prox?` · faltam ${prox-n} para sortear`:' · mais que 20, remova alguns'}</span>`;
  }

  const confirmadosPres = appData.presenca?.confirmados || [];
  const temPresenca = confirmadosPres.length > 0;

  c.innerHTML=`
    ${temPresenca ? `<div style="background:rgba(201,168,76,.08);border:1px solid var(--border-gold);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--t2)">
      📋 ${confirmadosPres.length} confirmados na lista · <strong style="color:var(--gold-lt)">${n} cadastrados selecionados</strong>
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:13px;color:var(--t2)">${hint}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:22px;color:${validSortear?'#22c55e':'var(--t2)'};font-weight:700">${n}</div>
    </div>
    ${appData.jogadores.map(j=>{
      const isSel = sel.includes(j.id);
      const isConf = confirmadosPres.includes(j.id);
      const tag = j.tipoJogador==='mensalista'
        ? '<span style="font-size:9px;background:var(--gold-dim);color:var(--gold);padding:1px 5px;border-radius:4px;margin-left:4px">M</span>'
        : '';
      const confTag = isConf
        ? '<span style="font-size:9px;color:#22c55e;margin-left:4px">✓ conf.</span>'
        : '';
      return `
      <div class="prow ${isSel?'sel':''}" onclick="toggleP('${j.id}')" style="${isConf?'border-color:rgba(34,197,94,.2);':''}">
        <div class="p-avatar" style="font-size:13px">${j.foto?`<img src="${j.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:j.nome[0].toUpperCase()}</div>
        <div class="p-name">${j.nome}${tag}${confTag}</div>
        <div style="font-size:20px">${isSel?'✅':'⬜'}</div>
      </div>`;
    }).join('')}
    <div style="margin-top:14px;display:flex;gap:8px;flex-direction:column">
      <button class="btn btn-gold" ${validSortear?'':'disabled'} onclick="confirmarPresentes()">
        ⚽ SORTEAR TIMES ${n>0?'('+n+')':''}
      </button>
      <button class="btn btn-ghost" ${validSemTimes?'':'disabled'} onclick="irParaListaSemTimes()"
        style="${validSemTimes?'':'opacity:0.4;cursor:not-allowed'}">
        📋 REGISTRAR SEM TIMES ${n>0?'('+n+')':''}
      </button>
    </div>`;
}


function irParaListaSemTimes() {
  if (flow.presentes.length === 0) { showToast('Selecione pelo menos 1 jogador'); return; }
  // Filtra só cadastrados antes de entrar no fluxo sem times
  flow.presentes = flow.presentes.filter(id => appData.jogadores.find(x=>x.id===id));
  flow.semTimes = true;
  flow.step = 'lista';
  flow.ausentes = [];
  renderFlow();
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
  // Mostra todos os que estavam no sorteio (times ou presentes sem times)
  const todos = flow.semTimes ? flow.presentes : flow.times.flat();
  const aus = flow.ausentes;
  c.innerHTML = `
    <div style="font-size:13px;color:var(--t2);margin-bottom:14px">
      Marque quem estava confirmado mas <strong style="color:#ef4444">não compareceu</strong>
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
        ${aus.length > 0 ? `${aus.length} falta${aus.length>1?'s':''} — multa gerada automaticamente` : 'Ninguém faltou? Ótimo!'}
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

async function confirmarAusentes() {
  // Multas são geradas em salvarStats (não aqui) para evitar duplicação
  // Build stats order: apenas presentes (não ausentes), apenas cadastrados
  const base = flow.semTimes ? flow.presentes : flow.times.flat();
  flow.statsOrder = base.filter(id => !flow.ausentes.includes(id) && appData.jogadores.find(x=>x.id===id));
  flow.statsData = {};
  flow.statsOrder.forEach(id => { flow.statsData[id] = {gols:0, assists:0, vitorias:0}; });
  flow.statsIdx = 0;
  flow.step = 'stats';
  renderFlow();
}

function toggleP(id) {
  const i=flow.presentes.indexOf(id);
  if(i>=0) flow.presentes.splice(i,1);
  else { flow.presentes.push(id); }
  renderFlow();
}
function confirmarPresentes(){
  // Conta só IDs que são jogadores cadastrados (evita IDs fantasmas da presença)
  const validos = flow.presentes.filter(id => appData.jogadores.find(x=>x.id===id));
  const n = validos.length;
  if(n!==10&&n!==15&&n!==20){showToast('Selecione exatamente 10, 15 ou 20 jogadores para sortear');return;}
  flow.presentes = validos;
  sortearTimes();
}
function sortearTimesClassico() {
  // Divide jogadores em Cruzeirenses (Azul) vs Atleticanos (Preto)
  const atleticanos = flow.presentes.filter(id => {
    const j = appData.jogadores.find(x=>x.id===id);
    return j?.clube === 'atleticano';
  });
  const cruzeirenses = flow.presentes.filter(id => {
    const j = appData.jogadores.find(x=>x.id===id);
    return j?.clube === 'cruzeirense';
  });
  const semClube = flow.presentes.filter(id => {
    const j = appData.jogadores.find(x=>x.id===id);
    return !j?.clube;
  });
  // Distribui sem-clube para equilibrar
  semClube.forEach(id => {
    if (atleticanos.length <= cruzeirenses.length) atleticanos.push(id);
    else cruzeirenses.push(id);
  });
  // Time Azul = Cruzeirenses, Time Preto = Atleticanos
  flow.times = [cruzeirenses, atleticanos];
  flow.step = 'times';
  renderFlow();
}
window.sortearTimesClassico = sortearTimesClassico;

function sortearTimes() {
  const n=flow.presentes.length;
  const tSize = flow.tamanhoTime || getTamanhoTime(flow.presentes);
  const nT = n <= tSize*2 ? 2 : n <= tSize*3 ? 3 : 4;
  const idxMap=Object.fromEntries(calcIdx(appData.jogadores).map(i=>[i.id,i]));
  const alea=(appData.config?.aleatoriedade??15)/100;
  const scores=flow.presentes.map(id=>idxMap[id]?.IF||0);
  const maxScore=Math.max(...scores);
  const noiseBase = maxScore > 0 ? maxScore : 0.5;
  const scored=flow.presentes.map(id=>{
    const base=idxMap[id]?.IF||0;
    const noise=noiseBase*alea*(Math.random()*2-1);
    const minNoise=noiseBase*0.05*(Math.random()*2-1);
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
  const dotColors = ['#ef4444','#3b82f6','#f0f0f0','#1a1a1a'];
  cont.innerHTML = editTimesState.map((tm, ti) => `
    <div class="card" style="margin-bottom:10px;border-color:var(--border-gold)">
      <div class="t-name" style="font-size:13px;margin-bottom:8px"><div style="width:8px;height:8px;border-radius:50%;background:${dotColors[ti]};flex-shrink:0;display:inline-block;margin-right:6px"></div>${['Time Vermelho','Time Azul','Time Branco','Time Preto'][ti]||'Time '+(ti+1)}</div>
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
  const temPresenca = (appData.presenca?.confirmados||[]).length > 0;
  const msg = temPresenca
    ? 'Cancelar os times? A lista de presença será mantida.'
    : 'Cancelar a partida?';
  if (!confirm(msg)) return;
  await firestoreDelete('config', 'ultimoSorteio');
  appData.ultimoSorteio = null;
  // Keep presença — lista volta a aparecer na home
  saveLocal();
  renderHome();
  showToast(temPresenca ? 'Times cancelados — lista de presença mantida' : 'Partida cancelada');
}

async function concluirPartidaHome() {
  if (!currentUser?.isAdmin) return;
  const sorteio = appData.ultimoSorteio;
  if (!sorteio) return;
  // Load flow data from current sorteio to proceed to ausentes/stats
  const sorteioArr = timesToArr(sorteio.times, sorteio.timesCount);
  const temTimes = sorteioArr.length > 0;
  flow = {
    step: 'ausentes',
    presentes: sorteioArr.flat(),
    times: sorteioArr,
    data: sorteio.data,
    ausentes: [],
    statsIdx: 0,
    statsOrder: [],
    statsData: {},
    semTimes: !temTimes,
    _saving: false
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

  // ── Quem joga: APENAS confirmados nos times (ou presentes sem times)
  // NUNCA inclui jogadores da lista de espera
  const jogadoresNoJogo = flow.semTimes
    ? flow.presentes.filter(id => appData.jogadores.find(x=>x.id===id))
    : flow.times.flat().filter(id => appData.jogadores.find(x=>x.id===id));

  // Confirmados na lista de presença (para cruzamento de ausências)
  const confirmadosNaPresenca = appData.presenca?.confirmados || [];

  const peladaJogadores = [];

  // ── Pré-calcula stats totais por time para fator de contribuição ─
  const timesStats = {}; // timeIdx → {gols, assists, vitorias, n}
  if (!flow.semTimes) {
    flow.times.forEach((tm, ti) => {
      const totG = tm.reduce((s,id)=>s+(flow.statsData[id]?.gols||0),0);
      const totA = tm.reduce((s,id)=>s+(flow.statsData[id]?.assists||0),0);
      const totV = tm.reduce((s,id)=>s+(flow.statsData[id]?.vitorias||0),0);
      timesStats[ti] = { gols:totG, assists:totA, vitorias:totV, n: tm.length };
    });
  }

  for (const id of jogadoresNoJogo) {
    const j = appData.jogadores.find(x => x.id === id);
    if (!j) continue;
    if (!j.domingos) j.domingos = [];
    const ausente = flow.ausentes.includes(id);
    if (ausente) {
      // Ausente: domingo registrado como ausência (não conta no ranking, mas conta como multa)
      j.domingos.push({ data, ausente: true, gols: 0, assists: 0, vitorias: 0 });
      peladaJogadores.push({ id, nome: j.nome, gols:0, assists:0, vitorias:0, scoreDia:0, ausente:true });
    } else {
      const stats = flow.statsData[id] || { gols: 0, assists: 0, vitorias: 0 };
      const ti = flow.times.findIndex(t=>t.includes(id));
      const ts = (ti >= 0 && timesStats[ti]) ? timesStats[ti] : null;
      const domingoRec = { data, gols: stats.gols, assists: stats.assists, vitorias: stats.vitorias };
      if (ts) { domingoRec.teamStats = { gols: ts.gols, assists: ts.assists }; domingoRec.teamN = ts.n; }
      j.domingos.push(domingoRec);
      const isGoleiro = !!j.goleiro;
      const scoreDia = scoreDiaCalc(
        { gols: stats.gols, assists: stats.assists, vitorias: stats.vitorias },
        ts ? { gols: ts.gols, assists: ts.assists, n: ts.n } : null,
        isGoleiro
      );
      peladaJogadores.push({ id, nome: j.nome, gols:stats.gols, assists:stats.assists, vitorias:stats.vitorias, scoreDia, ausente:false });
    }
    await firestoreSet('jogadores', id, j);
  }

  // ── Multas por ausência ──────────────────────────────────────
  // Gera multa para quem estava CONFIRMADO na lista de presença mas faltou
  // (tanto os marcados como ausentes no flow, quanto os confirmados que nem apareceram no flow)
  const idsNoJogo = new Set(jogadoresNoJogo);
  for (const id of confirmadosNaPresenca) {
    // Se estava no jogo E foi marcado ausente → multa
    // Se estava confirmado mas NEM estava no flow (não compareceu de forma alguma) → multa
    const marcadoAusente = flow.ausentes.includes(id);
    const naoApareceu = !idsNoJogo.has(id);
    if (marcadoAusente || naoApareceu) {
      const ehMens = jogadorMensalista(id);
      const multaValor = ehMens ? getValores().multa : getValores().avulso;
      const fin = getFinancasJogador(id);
      const jaTemMulta = (fin.debitos||[]).some(d =>
        d.tipo==='multa' && d.descricao?.includes('Faltou') && d.descricao?.includes(data)
      );
      if (!jaTemMulta) {
        await adicionarDebito(id, 'multa', multaValor, `Faltou sem desmarcar — Pelada ${data}`);
      }
    }
  }

  // ── Ranking por score para MVP ────────────────────────────────
  const presentes = peladaJogadores.filter(j => !j.ausente)
    .sort((a,b) => {
      if (b.scoreDia !== a.scoreDia) return b.scoreDia - a.scoreDia;
      if (b.gols !== a.gols) return b.gols - a.gols;
      if (b.assists !== a.assists) return b.assists - a.assists;
      return b.vitorias - a.vitorias;
    });

  const nominees = presentes.filter(p => p.scoreDia > 0).slice(0, 3);

  // ── Registro da pelada ────────────────────────────────────────
  const peladaId = 'pelada_' + Date.now();
  const elapsesAt = Date.now() + 24 * 60 * 60 * 1000;
  const elegiveisVotar = presentes.map(p => p.id); // só quem JOGOU pode votar

  const timesObjRec = {};
  flow.times.forEach((t, i) => { timesObjRec['t' + i] = t; });

  const tipoPelada = appData.presenca?.tipo || appData.presenca?.tipoPelada || 'normal';
  const peladaRec = {
    id: peladaId,
    tipo: tipoPelada,
    data,
    savedAt: Date.now(),
    times: flow.semTimes ? {} : timesObjRec,
    jogadores: peladaJogadores,
    mvp: null,
    bolaMurcha: null,
    podio: null,
    votacao: nominees.length > 0 ? {
      status: 'aberta',
      nominees: nominees.map(n => ({ id: n.id, nome: n.nome, scoreDia: n.scoreDia, gols: n.gols, assists: n.assists, vitorias: n.vitorias })),
      votos: {},
      elegiveisVotar,
      elapsesAt,
    } : null,
    // Bola Murcha: todos elegíveis votam em qualquer jogador que jogou (exceto si mesmo)
    votacaoBolaMurcha: presentes.length > 0 ? {
      status: 'aberta',
      candidatos: presentes.map(p => ({ id: p.id, nome: p.nome })),
      votos: {},           // { votanteId: votadoId }
      elegiveisVotar,      // mesmos que o MVP
      elapsesAt,           // expira junto
    } : null,
  };

  await firestoreSet('peladasHist', peladaId, peladaRec);
  if (!appData.peladasHist) appData.peladasHist = [];
  if (!appData.peladasHist.find(x => x.id === peladaId)) {
    appData.peladasHist.push(peladaRec);
  }

  if (nominees.length === 0) {
    await finalizarVotacao(peladaId, peladaRec, true);
  }

  // ── Limpar estado ─────────────────────────────────────────────
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
// ─── RECALCULAR SCORES HISTÓRICOS ───────────────────────────
// Revisa o scoreDia de todos os jogadores em todas as peladas já registradas,
// aplicando scoreDiaCalc (vitórias ponderadas por participação) e recalculando o scoreDia
// armazenado em peladasHist. Não altera domingos[] dos jogadores (base do rating).
async function recalcularScoresDias() {
  if (!currentUser?.isAdmin) return;
  if (!confirm(
    'Recalcular o Score do Dia de todas as peladas históricas?\n\n' +
    'Isso aplica o fator de contribuição individual (gols+assists vs média do time) ' +
    'ao scoreDia exibido em cada pelada. O rating dos jogadores NÃO muda.\n\n' +
    'Clique OK para continuar.'
  )) return;

  let updated = 0;
  for (const pelada of (appData.peladasHist||[])) {
    if (!pelada.jogadores?.length) continue;

    // Reconstrói timesStats a partir dos dados salvos
    const timesStats = {};
    if (pelada.times) {
      const timesArr = Object.values(pelada.times); // [teamArr, teamArr, ...]
      timesArr.forEach((tm, ti) => {
        if (!Array.isArray(tm)) return;
        const totG = tm.reduce((s,id) => s + ((pelada.jogadores.find(j=>j.id===id))?.gols||0), 0);
        const totA = tm.reduce((s,id) => s + ((pelada.jogadores.find(j=>j.id===id))?.assists||0), 0);
        timesStats[ti] = { gols: totG, assists: totA, n: tm.length };
      });
    }

    let changed = false;
    for (const pj of pelada.jogadores) {
      if (pj.ausente) continue;
      const tiIdx = Object.values(pelada.times||{}).findIndex(tm => Array.isArray(tm) && tm.includes(pj.id));
      const ts = (tiIdx >= 0 && timesStats[tiIdx]) ? timesStats[tiIdx] : null;
      const jogador = appData.jogadores.find(x=>x.id===pj.id);
      const isGoleiro = !!jogador?.goleiro;

      const newScore = scoreDiaCalc(
        { gols: pj.gols||0, assists: pj.assists||0, vitorias: pj.vitorias||0 },
        ts ? { gols: ts.gols, assists: ts.assists, n: ts.n } : null,
        isGoleiro
      );

      if (Math.abs(newScore - (pj.scoreDia||0)) > 0.0001) {
        pj.scoreDia = newScore;
        changed = true;
      }
    }

    // Recalcula pódio se existia
    if (changed && pelada.podio) {
      const ativos = pelada.jogadores.filter(j=>!j.ausente);
      const sorted = [...ativos].sort((a,b)=>b.scoreDia-a.scoreDia);
      if (sorted.length >= 1) pelada.podio.primeiro  = sorted[0];
      if (sorted.length >= 2) pelada.podio.segundo   = sorted[1];
      if (sorted.length >= 3) pelada.podio.terceiro  = sorted[2];
    }

    if (changed) {
      await firestoreSet('peladasHist', pelada.id, pelada);
      updated++;
    }
  }
  saveLocal();
  showToast(`✅ ${updated} pelada${updated!==1?'s':''} recalculada${updated!==1?'s':''}!`);
  renderPeladasHistorico();
}

async function votarBolaMurcha(peladaId, candidatoId) {
  if (!currentUser || currentUser.isGuest) { showToast('Você precisa estar logado para votar'); return; }
  const p = (appData.peladasHist||[]).find(x=>x.id===peladaId);
  if (!p || !p.votacaoBolaMurcha || p.votacaoBolaMurcha.status !== 'aberta') {
    showToast('Votação não está aberta'); return;
  }
  if (!p.votacaoBolaMurcha.elegiveisVotar.includes(currentUser.id)) {
    showToast('Só quem jogou pode votar'); return;
  }
  if (p.votacaoBolaMurcha.votos[currentUser.id]) { showToast('Você já votou!'); return; }
  p.votacaoBolaMurcha.votos[currentUser.id] = candidatoId;
  await firestoreSet('peladasHist', peladaId, p);
  const totalVotos = Object.keys(p.votacaoBolaMurcha.votos).length;
  const totalEleg = p.votacaoBolaMurcha.elegiveisVotar.length;
  showToast(`🎈 Voto Bola Murcha registrado! (${totalVotos}/${totalEleg})`);
  renderPeladasHistorico();
  if (document.getElementById('modalPeladaDetalhe').classList.contains('open')) {
    openPeladaDetalhe(peladaId);
  }
}
window.votarBolaMurcha = votarBolaMurcha;

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
    // Count MVP votes
    const contagem = {};
    for (const v of Object.values(p.votacao.votos)) {
      contagem[v] = (contagem[v]||0) + 1;
    }
    const vencedor = p.votacao.nominees.sort((a,b) => {
      const va = contagem[a.id]||0, vb = contagem[b.id]||0;
      if (vb !== va) return vb - va;
      return b.scoreDia - a.scoreDia;
    })[0];
    p.mvp = vencedor || null;
    p.votacao.status = 'encerrada';
  }

  // Finaliza Bola Murcha — conta votos de todos (sem restrição de nominee)
  if (p.votacaoBolaMurcha && p.votacaoBolaMurcha.status === 'aberta') {
    const bm = p.votacaoBolaMurcha;
    const contagemBm = {};
    for (const v of Object.values(bm.votos)) {
      contagemBm[v] = (contagemBm[v]||0) + 1;
    }
    let maxVotos = 0;
    let vencedorBm = null;
    for (const [id, qtd] of Object.entries(contagemBm)) {
      if (qtd > maxVotos) { maxVotos = qtd; vencedorBm = id; }
    }
    if (vencedorBm) {
      const jBmNom = appData.jogadores.find(x=>x.id===vencedorBm);
      p.bolaMurcha = { id: vencedorBm, nome: jBmNom?.nome || vencedorBm, votos: maxVotos };
    }
    bm.status = 'encerrada';
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

  // Award MVP counter
  if (p.mvp) {
    const jMvp = appData.jogadores.find(x => x.id === p.mvp.id);
    if (jMvp) {
      jMvp.mvps = (jMvp.mvps || 0) + 1;
      const lastDom = jMvp.domingos[jMvp.domingos.length - 1];
      if (lastDom) lastDom.mvp = true;
      await firestoreSet('jogadores', jMvp.id, jMvp);
    }
  }

  // Award Bola Murcha counter
  if (p.bolaMurcha) {
    const jBm = appData.jogadores.find(x => x.id === p.bolaMurcha.id);
    if (jBm) {
      jBm.bolaMurchas = (jBm.bolaMurchas || 0) + 1;
      await firestoreSet('jogadores', jBm.id, jBm);
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

  // ── Ciclo: abre lista de presença para o próximo domingo ──
  // Só abre se não há presença já ativa ou sorteio em andamento
  if (!appData.ultimoSorteio && !appData.presenca?.confirmados?.length) {
    const proximoDom = getProximoDomingo();
    const novaPresenca = { confirmados: [], espera: [], data: proximoDom };
    appData.presenca = novaPresenca;
    await firestoreSet('config', 'presenca', novaPresenca);
    saveLocal();
  }
  renderPresenca();
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
  // ── PAINEL DE CONFIGURAÇÃO (admin only) ──────────────────
  const valoresAtualCfg = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button onclick="abrirConfigValores()" style="background:var(--s2);border:1px solid var(--border);border-radius:8px;color:var(--t2);padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;font-family:'DM Sans',sans-serif" title="Configurar valores">
        ⚙️ Valores
      </button>
    </div>`;

  const rows = jogadores.map(j => {
    const saldo = totalDebitoJogador(j.id);
    const fin = getFinancasJogador(j.id);
    const mensalista = jogadorMensalista(j.id);
    const debitos = (fin.debitos||[]);
    const debitosAtivos = debitos.filter(d => !d.quitado); // só pendentes
    const multas = debitosAtivos.filter(d=>d.tipo==='multa');
    const mensais = debitosAtivos.filter(d=>d.tipo==='mensal');
    const avulsos = debitosAtivos.filter(d=>d.tipo==='avulso');
    return { j, saldo, fin, mensalista, multas, mensais, avulsos, debitos };
  }).sort((a,b) => {
    // 1. Mensalistas first
    if (a.mensalista !== b.mensalista) return b.mensalista ? 1 : -1;
    // 2. Indebted before clean
    if ((b.saldo > 0) !== (a.saldo > 0)) return b.saldo > 0 ? 1 : -1;
    // 3. Higher debt first, then alphabetical
    if (b.saldo !== a.saldo) return b.saldo - a.saldo;
    return a.j.nome.localeCompare(b.j.nome, 'pt-BR');
  }); // mensalistas first, indebted before clean

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
  const avisoAtrasado = mostrarAtraso ? ` — ${semanas} sem. em atraso (+R$${(semanas*getValores().multaSem).toFixed(0)})` : '';
  const aviso5du = `<div style="background:${corAviso};border:1px solid ${corBorda};border-radius:10px;padding:12px 14px;margin-bottom:16px">
    <div style="font-size:13px;font-weight:700;color:${corTexto}">${icone} MENSALISTAS: Período ${inicioStr} → ${prazoStr}${avisoAtrasado}</div>
    <div style="font-size:11px;color:var(--t2);margin-top:3px">R$${getValores().mensal.toFixed(2)} via Pix: mfnassif16@gmail.com · Vencimento: ${prazoStr}</div>
    ${isAdmin ? `<button onclick="gerarMensalidadesMes()" style="margin-top:8px;background:var(--gold-dim);border:1px solid var(--border-gold);border-radius:8px;color:var(--gold);font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:1px;padding:6px 14px;cursor:pointer;width:100%">📋 GERAR MENSALIDADES DO MÊS</button>` : ''}
  </div>`;

  const renderRow = (r) => {
    const { j, saldo, fin, mensalista, multas, avulsos, mensais, debitos } = r;
    const cor = saldo > 0 ? '#ef4444' : '#22c55e';
    // Só mostra descrição de débitos ATIVOS (não quitados)
    const outros = debitos.filter(d=>d.tipo==='outro' && !d.quitado);
    const debitosDesc = saldo <= 0 ? '' : [
      ...mensais.map(d=>`Mensalidade ${d.data}: R$${(+d.valor).toFixed(2)}`),
      ...avulsos.map(d=>`${d.descricao||'Avulso'} (${d.data||''}): R$${(+d.valor).toFixed(2)}`),
      ...multas.map(d=>`Multa: ${d.descricao} (${d.data}): R$${(+d.valor).toFixed(2)}`),
      ...outros.map(d=>`${d.descricao||'Outro'} (${d.data}): R$${(+d.valor).toFixed(2)}`)
    ].filter(Boolean).join('<br>');

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

  // ── CAIXA ADMIN PANEL ─────────────────────────────────────
  let caixaHTML = '';
  if (isAdmin) {
    const caixaMes  = getCaixaMesLabel();   // exibição: 'abril de 2026'
    const caixaKey  = '_caixa_' + getCaixaMesKey(); // storage: '_caixa_2026-04'
    const caixaData = appData.financas[caixaKey] || { gastos: [] };
    // Recebido = pagamentos cujo descricao ou data contém o mês de referência
    const recebidoTotal = appData.jogadores.reduce((sum, j) => {
      const fin = getFinancasJogador(j.id);
      return sum + (fin.pagamentos||[]).filter(p =>
        (p.descricao||'').toLowerCase().includes(getCaixaMesLabel().toLowerCase()) ||
        (p.data||'').includes(new Date().getFullYear().toString())
          && (p.data||'').includes(String(new Date().getMonth()+1).padStart(2,'0'))
      ).reduce((s,p) => s+(p.valor||0), 0);
    }, 0);
    // Pendente = todos os débitos em aberto até o mês atual inclusive
    // (exclui APENAS débitos de meses futuros — ex: mensalidade de maio gerada em abril)
    const mesAtualNum = new Date().getMonth() + 1; // 1-12
    const anoAtualNum = new Date().getFullYear();
    function debitoNaoEhFuturo(d) {
      if (!d.data) return true; // sem data → inclui por segurança
      const parts = d.data.split('/');
      if (parts.length === 3) {
        const mm = parseInt(parts[1], 10);
        const aaaa = parseInt(parts[2], 10);
        // Futuro = ano maior, ou mesmo ano com mês maior
        if (aaaa > anoAtualNum) return false;
        if (aaaa === anoAtualNum && mm > mesAtualNum) return false;
      }
      return true;
    }

    const pendente = appData.jogadores.reduce((sum, j) => {
      return sum + Math.max(0, totalDebitoJogador(j.id, debitoNaoEhFuturo));
    }, 0);
    // Gastos do mês
    const gastos = (caixaData.gastos||[]);
    const totalGasto = gastos.reduce((s,g) => s+(g.valor||0), 0);
    const saldo = recebidoTotal - totalGasto;

    caixaHTML = `
      <div class="card" style="border-color:var(--border-gold);margin-bottom:14px">
        <div class="section-lbl" style="margin-bottom:10px">💰 CAIXA — ${caixaMes}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
          <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:10px;padding:12px 8px;text-align:center">
            <div style="font-size:9px;letter-spacing:1px;color:#22c55e;text-transform:uppercase;margin-bottom:4px">Recebido</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#22c55e">R$${recebidoTotal.toFixed(0)}</div>
          </div>
          <div style="background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.25);border-radius:10px;padding:12px 8px;text-align:center">
            <div style="font-size:9px;letter-spacing:1px;color:#eab308;text-transform:uppercase;margin-bottom:4px">Pendente</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#eab308">R$${pendente.toFixed(0)}</div>
          </div>
          <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:12px 8px;text-align:center">
            <div style="font-size:9px;letter-spacing:1px;color:#ef4444;text-transform:uppercase;margin-bottom:4px">Gasto</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#ef4444">R$${totalGasto.toFixed(0)}</div>
          </div>
        </div>
        <div style="background:${saldo>=0?'rgba(34,197,94,.06)':'rgba(239,68,68,.06)'};border:1px solid ${saldo>=0?'rgba(34,197,94,.15)':'rgba(239,68,68,.15)'};border-radius:8px;padding:8px 12px;text-align:center;margin-bottom:12px">
          <span style="font-size:11px;color:var(--t2)">Saldo do mês </span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:${saldo>=0?'#22c55e':'#ef4444'}">R$${saldo.toFixed(0)}</span>
        </div>
        <div class="section-lbl" style="margin-bottom:8px">GASTOS DO MÊS</div>
        ${gastos.length > 0 ? gastos.map((g,i)=>`
          <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1">
              <div style="font-size:13px">${g.descricao}</div>
              <div style="font-size:10px;color:var(--t2)">${g.data||''}</div>
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:13px;color:#ef4444">R$${(+g.valor).toFixed(2)}</div>
            <button onclick="removerGastoCaixa('${getCaixaMesKey()}',${i})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:18px;padding:0 4px">×</button>
          </div>`).join('') : '<div style="font-size:12px;color:var(--t3);margin-bottom:8px">Nenhum gasto registrado</div>'}
        <button class="btn btn-ghost" style="margin-top:8px;font-size:12px" onclick="abrirAddGasto('${getCaixaMesKey()}')">+ REGISTRAR GASTO</button>
      </div>`;
  }

  inner.innerHTML = `
    ${caixaHTML}
    ${isAdmin ? valoresAtualCfg : ''}
    ${aviso5du}
    ${inadimplentes.length > 0 ? `
      <div class="section-lbl">EM ABERTO (${inadimplentes.length})</div>
      ${inadimplentes.map(renderRow).join('')}` : ''}
    ${emDia.length > 0 ? `
      <div class="section-lbl" style="margin-top:12px">EM DIA (${emDia.length})</div>
      ${emDia.map(renderRow).join('')}` : ''}
  `;
}

function abrirAddGasto(mes) {
  if (!currentUser?.isAdmin) return;
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'modalAddGasto';
  overlay.innerHTML = `
    <div class="modal">
      <div class="mhandle"></div>
      <div class="m-title">REGISTRAR GASTO</div>
      <div class="m-sub">${mes}</div>
      <div class="field"><label>Descrição</label><input class="input" id="gastoDesc" placeholder="Ex: Compra de bolas" maxlength="60"></div>
      <div class="field"><label>Valor (R$)</label><input class="input" id="gastoValor" type="number" min="0" step="0.01" placeholder="0.00"></div>
      <button class="btn btn-gold" onclick="salvarGasto('${mes}')">SALVAR</button>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalAddGasto').remove()">CANCELAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(()=>document.getElementById('gastoDesc')?.focus(), 100);
}
window.abrirAddGasto = abrirAddGasto;

async function salvarGasto(mes) {
  const desc  = document.getElementById('gastoDesc')?.value.trim();
  const valor = parseFloat(document.getElementById('gastoValor')?.value);
  if (!desc) { showToast('Informe a descrição'); return; }
  if (isNaN(valor) || valor <= 0) { showToast('Valor inválido'); return; }
  const key = '_caixa_' + mes;
  const caixaData = appData.financas[key] || { gastos: [] };
  caixaData.gastos = caixaData.gastos || [];
  caixaData.gastos.push({ descricao: desc, valor, data: new Date().toLocaleDateString('pt-BR') });
  appData.financas[key] = caixaData;
  await firestoreSet('financas', key, caixaData);
  saveLocal();
  document.getElementById('modalAddGasto')?.remove();
  renderFinancas();
  showToast('Gasto registrado ✅');
}
window.salvarGasto = salvarGasto;

async function removerGastoCaixa(mes, idx) {
  if (!currentUser?.isAdmin) return;
  if (!confirm('Remover este gasto?')) return;
  const key = '_caixa_' + mes;
  const caixaData = appData.financas[key] || { gastos: [] };
  caixaData.gastos = (caixaData.gastos||[]).filter((_,i)=>i!==idx);
  appData.financas[key] = caixaData;
  await firestoreSet('financas', key, caixaData);
  saveLocal();
  renderFinancas();
  showToast('Gasto removido');
}
window.removerGastoCaixa = removerGastoCaixa;

function abrirDarBaixa(jogadorId) {
  if (!currentUser?.isAdmin) { showToast('Sem permissão'); return; }
  const j = appData.jogadores.find(x=>x.id===jogadorId);
  const fin = getFinancasJogador(jogadorId);
  const saldo = totalDebitoJogador(jogadorId);
  const debitos = (fin.debitos||[]);
  // Build list of unpaid debts
  const totalPago = (fin.pagamentos||[]).reduce((s,p)=>s+(p.valor||0),0);
  let acumulado = 0;
  const debitosAbertos = debitos.reduce((acc, d, i) => {
    if (!d.quitado) acc.push({ i, desc: d.descricao || d.tipo, valor: d.valor, data: d.data, tipo: d.tipo });
    return acc;
  }, []);
  if (debitosAbertos.length === 0) { showToast('Nenhum débito em aberto'); return; }

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
  // Marca o débito como quitado (não exclui — mantém histórico)
  debito.quitado = true;
  // Registra pagamento no histórico financeiro
  if (!fin.pagamentos) fin.pagamentos = [];
  fin.pagamentos.push({
    id: 'p' + Date.now(),
    valor: val,
    descricao: `Baixa: ${debito.descricao || debito.tipo}`,
    data: dataFmt
  });
  appData.financas[jogadorId] = fin;
  await firestoreSet('financas', jogadorId, fin);
  saveLocal();
  document.getElementById('modalDarBaixa')?.remove();
  renderFinancas();
  showToast('Pagamento registrado ✅');
}

function abrirAddDebito(jogadorId) {
  if (!currentUser?.isAdmin) { showToast('Sem permissão'); return; }
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
          <option value="mensal">Mensalidade (R$${getValores().mensal.toFixed(2)})</option>
          <option value="avulso">Avulso (R$${getValores().avulso.toFixed(2)})</option>
          <option value="multa">Multa (R$${getValores().multa.toFixed(2)})</option>
          <option value="outro">Outro</option>
        </select>
      </div>
      <div class="field"><label>Valor (R$)</label><input class="input" id="debitoValor" type="number" step="0.01" min="0" placeholder="${getValores().mensal.toFixed(2)}"></div>
      <div class="field"><label>Descrição</label><input class="input" id="debitoDesc" placeholder="Mensalidade março"></div>
      <div class="field"><label>Data</label><input class="input" id="debitoData" type="date"></div>
      <button class="btn btn-gold" onclick="executarAddDebito('${jogadorId}')">ADICIONAR</button>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalAddDebito').remove()">CANCELAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  // Auto-fill valor by tipo
  overlay.querySelector('#debitoTipo').addEventListener('change', e => {
    const vals = {mensal:getValores().mensal, avulso:getValores().avulso, multa:getValores().multa, outro:''};
    overlay.querySelector('#debitoValor').value = vals[e.target.value] || '';
  });
  overlay.querySelector('#debitoValor').value = getValores().mensal;
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

function abrirConfigValores() {
  if (!currentUser?.isAdmin) return;
  const v = getValores();
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'modalConfigValores';
  overlay.innerHTML = `
    <div class="modal">
      <div class="mhandle"></div>
      <div class="m-title">⚙️ VALORES</div>
      <div class="m-sub">Aplicados em novos débitos</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="field" style="margin:0">
          <label>Mensalidade (R$)</label>
          <input class="input" id="cfgMensal" type="number" min="0" step="1" value="${v.mensal}"
            style="text-align:center;font-size:20px;font-weight:700;font-family:'JetBrains Mono',monospace">
        </div>
        <div class="field" style="margin:0">
          <label>Avulso (R$)</label>
          <input class="input" id="cfgAvulso" type="number" min="0" step="1" value="${v.avulso}"
            style="text-align:center;font-size:20px;font-weight:700;font-family:'JetBrains Mono',monospace">
        </div>
        <div class="field" style="margin:0">
          <label>Multa ausência (R$)</label>
          <input class="input" id="cfgMulta" type="number" min="0" step="1" value="${v.multa}"
            style="text-align:center;font-size:20px;font-weight:700;font-family:'JetBrains Mono',monospace">
        </div>
        <div class="field" style="margin:0">
          <label>Multa/semana (R$)</label>
          <input class="input" id="cfgMultaSem" type="number" min="0" step="1" value="${v.multaSem}"
            style="text-align:center;font-size:20px;font-weight:700;font-family:'JetBrains Mono',monospace">
        </div>
      </div>
      <div style="font-size:10px;color:var(--t3);text-align:center;margin-bottom:12px">Só afeta débitos criados após salvar</div>
      <button class="btn btn-gold" onclick="salvarValores()">💾 SALVAR</button>
      <button class="btn btn-ghost mt8" onclick="document.getElementById('modalConfigValores').remove()">CANCELAR</button>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
window.abrirConfigValores = abrirConfigValores;

async function salvarValores() {
  if (!currentUser?.isAdmin) return;
  const mensal   = parseFloat(document.getElementById('cfgMensal')?.value);
  const avulso   = parseFloat(document.getElementById('cfgAvulso')?.value);
  const multa    = parseFloat(document.getElementById('cfgMulta')?.value);
  const multaSem = parseFloat(document.getElementById('cfgMultaSem')?.value);
  if ([mensal,avulso,multa,multaSem].some(v => isNaN(v) || v < 0)) {
    showToast('Valores inválidos'); return;
  }
  if (!appData.config) appData.config = {};
  const old = getValores();
  appData.config.valorMensal   = mensal;
  appData.config.valorAvulso   = avulso;
  appData.config.valorMulta    = multa;
  appData.config.valorMultaSem = multaSem;
  await firestoreSet('config', 'main', appData.config);
  saveLocal();
  document.getElementById('modalConfigValores')?.remove();
  // Ask about recalculating existing open debts
  const mudouMensal = mensal !== old.mensal;
  const mudouAvulso = avulso !== old.avulso;
  const mudouMulta  = multa  !== old.multa;
  if ((mudouMensal || mudouAvulso || mudouMulta) && confirm(
    'Recalcular débitos pendentes com os novos valores?\n\n' +
    (mudouMensal ? `Mensalidade: R$${old.mensal} → R$${mensal}\n` : '') +
    (mudouAvulso ? `Avulso: R$${old.avulso} → R$${avulso}\n` : '') +
    (mudouMulta  ? `Multa: R$${old.multa} → R$${multa}\n` : '') +
    '\nOK = atualiza todos em aberto | Cancelar = mantém valores antigos'
  )) {
    for (const j of appData.jogadores) {
      const fin = getFinancasJogador(j.id);
      if (!fin.debitos) continue;
      let changed = false;
      fin.debitos.forEach(d => {
        if (d.quitado) return;
        if (mudouMensal && d.tipo === 'mensal') { d.valor = mensal; changed = true; }
        if (mudouAvulso && d.tipo === 'avulso') { d.valor = avulso; changed = true; }
        if (mudouMulta  && d.tipo === 'multa')  { d.valor = multa;  changed = true; }
      });
      if (changed) { await firestoreSet('financas', j.id, fin); appData.financas[j.id] = fin; }
    }
    saveLocal();
    showToast('Valores e débitos atualizados ✅');
  } else {
    showToast(`Valores salvos ✅ — Mensal R$${mensal} · Avulso R$${avulso} · Multa R$${multa}`);
  }
  renderFinancas();
}

async function gerarMensalidadesMes() {
  if (!currentUser?.isAdmin) return;
  const mes = getMesReferencia();
  const data5du = getUltimo5du();
  if (!confirm(`Gerar débito de mensalidade (R$${getValores().mensal.toFixed(2)}) para todos os mensalistas — ${mes}?`)) return;
  const mensalistas = appData.jogadores.filter(j => j.tipoJogador === 'mensalista');
  let count = 0;
  for (const j of mensalistas) {
    const fin = getFinancasJogador(j.id);
    const jaTemEsseMes = (fin.debitos||[]).some(d => d.tipo==='mensal' && d.descricao?.includes(mes));
    if (!jaTemEsseMes) {
      await adicionarDebitoComData(j.id, 'mensal', getValores().mensal, `Mensalidade ${mes}`, data5du);
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
  // Close float menu if open
  document.getElementById('userFloatMenu')?.remove();
  localStorage.removeItem(LS_USER);
  currentUser = null;
  // Hide app, show login
  const shell = document.getElementById('appShell');
  if (shell) shell.style.display = 'none';
  showLogin(true);
  // Reset login card
  setTimeout(() => voltarLogin(), 50);
}


function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600);}

// ─── EXPOSE ──────────────────────────────────────────────────
window.salvarFirebaseConfig=salvarFirebaseConfig;
window.usarSemFirebase=usarSemFirebase;
window.entrar=entrar;
window.sairDaConta=sairDaConta;
window.entrarComoVisitante=entrarComoVisitante;
window.confirmarSenha=confirmarSenha;
window.voltarLogin=voltarLogin;
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
window.irParaListaSemTimes=irParaListaSemTimes;
window.confirmarListaSemTimes=confirmarListaSemTimes;
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
  if (!p || p.votacao?.status !== 'aberta') { showToast('Votação não encontrada ou já encerrada'); return; }
  await finalizarVotacao(peladaId, p, false);
  // Force local update so renderPresenca sees it immediately (before onSnapshot fires)
  if (p.votacao) p.votacao.status = 'encerrada';
  const localIdx = (appData.peladasHist||[]).findIndex(x=>x.id===peladaId);
  if (localIdx >= 0) appData.peladasHist[localIdx] = p;
  closeModal('modalPeladaDetalhe');
  renderPresenca();
  renderPeladasHistorico();
  showToast('Votação encerrada! ✅ Lista de presença liberada.');
}
window.encerrarVotacaoForce = encerrarVotacaoForce;
window.checkVotacoesExpiradas=checkVotacoesExpiradas;
window.confirmarPresenca=confirmarPresenca;
window.desmarcarPresenca=desmarcarPresenca;
window.abrirAdminPresenca=abrirAdminPresenca;
window.adminAdicionarPresenca=adminAdicionarPresenca;
window.adminRemoverPresenca=adminRemoverPresenca;
window.salvarInfoPelada=salvarInfoPelada;
window.adminBaixaAvulsoPresenca=adminBaixaAvulsoPresenca;
window.gerarDebitoAvulsoPresenca=gerarDebitoAvulsoPresenca;
window.gerarMultasAusencia=gerarMultasAusencia;
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
window.abrirUploadFoto=abrirUploadFoto;
window.salvarValores=salvarValores;
window.salvarEditDomingo=salvarEditDomingo;
window.setJogFiltro=setJogFiltro;
window.getCaixaMesKey=getCaixaMesKey;
window.getCaixaMesLabel=getCaixaMesLabel;
// Expõe _fotoUploadTarget ao escopo global para labels inline em ES modules
Object.defineProperty(window, '_fotoUploadTarget', {
  get() { return _fotoUploadTarget; },
  set(v) { _fotoUploadTarget = v; }
});
