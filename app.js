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
const ALPHA_MAX   = 0.7710;
const ALPHA_K     = 0.2860;
const W_VIT       = 0.75;
const LS_CONFIG   = 'pelada_fb_config';
const LS_USER     = 'pelada_user';
const LS_LOCAL    = 'pelada_local_v2';

let db_fire = null;
let useFirebase = false;
let currentUser = null;
let appData = { jogadores: [], restricoes: [], config: { aleatoriedade: 15 }, admins: [], nextId: 1 };
let unsubscribe = null;

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

async function confirmarSenha(jogadorId, modo) {
  const senha = document.getElementById('inputSenha')?.value;
  if (!senha || senha.length < 4) { showToast('Senha deve ter pelo menos 4 caracteres'); return; }

  const j = appData.jogadores.find(x => x.id === jogadorId);
  if (!j) return;

  if (modo === 'criar') {
    const senha2 = document.getElementById('inputSenha2')?.value;
    if (senha !== senha2) { showToast('Senhas não coincidem'); return; }
    j.senha = btoa(senha);
    await firestoreSet('jogadores', jogadorId, j);
    saveLocal();
  } else {
    if (btoa(senha) !== j.senha) { showToast('Senha incorreta'); return; }
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
function scoreAdj(j,med) {
  const n=nDom(j);
  return +((n*scoreAcum(j)+K_SHRINKAGE*med)/(n+K_SHRINKAGE)).toFixed(4);
}
function alpha(n) { return +(ALPHA_MAX/(1+ALPHA_K*n)).toFixed(4); }
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
    const n=nDom(j),a=alpha(n);
    const IF=+(a*notN[i]+(1-a)*adjN[i]).toFixed(4);
    return {id:j.id,nome:j.nome,nota:notas[i],notaN:notN[i],sAdj:adjs[i],sAdjN:adjN[i],alpha:a,IF,n};
  });
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
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.remove('active'));
  document.getElementById('sc-'+s)?.classList.add('active');
  document.getElementById('nav-'+s)?.classList.add('active');
  curScreen=s;
  if(s==='home') renderHome();
  if(s==='jogadores') renderJogs();
  if(s==='ranking') renderRanking();
  if(s==='opcoes') renderOpcoes();
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
  renderHome();
}

// ─── HOME ────────────────────────────────────────────────────
function renderHome() {
  const isAdmin = currentUser?.isAdmin;
  document.getElementById('homeSub').textContent = currentUser ? `Bem-vindo, ${currentUser.nome}!` : '';
  document.getElementById('btnSortear').style.display = isAdmin ? 'flex' : 'none';

  const sorteio = appData.ultimoSorteio;
  const msg = document.getElementById('homeMsg');
  const stats = document.getElementById('homeStats');
  const adminControls = document.getElementById('homeAdminControls');

  if (!sorteio || !sorteio.times || sorteio.times.length === 0) {
    msg.innerHTML = `<div style="font-family:'Oswald',sans-serif;font-size:16px;color:var(--t2);letter-spacing:1px">TIMES AINDA NÃO SORTEADOS</div>`;
    stats.innerHTML = '';
    if (adminControls) adminControls.innerHTML = '';
  } else {
    const T_COLORS = ['t0','t1','t2','t3'];
    const statusLabel = sorteio.status === 'confirmado'
      ? `<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:99px;padding:4px 12px;font-size:11px;color:#22c55e;margin-bottom:12px">● PARTIDA EM ANDAMENTO</div>`
      : '';

    const timesHTML = sorteio.times.map((t, ti) => `
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
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-danger" style="flex:1" onclick="cancelarPartidaHome()">❌ CANCELAR</button>
          <button class="btn btn-gold" style="flex:1" onclick="concluirPartidaHome()">🏁 CONCLUIR</button>
        </div>`;
    } else if (adminControls) {
      adminControls.innerHTML = '';
    }
  }

  renderPeladasHistorico();
}

// ─── HISTÓRICO DE PELADAS NA HOME ────────────────────────────
function renderPeladasHistorico() {
  const container = document.getElementById('homePeladasHist');
  if (!container) return;
  const peladas = appData.peladasHist || [];
  if (!peladas.length) { container.innerHTML = ''; return; }
  const sorted = [...peladas].sort((a,b) => (b.savedAt||0) - (a.savedAt||0));
  container.innerHTML = `
    <div class="section-lbl" style="margin-top:16px">PELADAS ANTERIORES</div>
    ${sorted.map(p => {
      const votAberta = p.votacao?.status === 'aberta';
      const podeVotar = votAberta && currentUser && !currentUser.isGuest
        && p.votacao?.elegiveisVotar?.includes(currentUser.id)
        && !p.votacao?.votos?.[currentUser.id];
      const totalVotos = Object.keys(p.votacao?.votos||{}).length;
      const totalEleg = p.votacao?.elegiveisVotar?.length||0;
      const mvpNome = p.mvp?.nome || (votAberta ? '...' : '—');
      return `
      <div class="pelada-hist-card" onclick="openPeladaDetalhe('${p.id}')" style="${podeVotar?'border-color:rgba(234,179,8,.5);':''}" >
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:18px">${podeVotar?'⭐':'🏆'}</div>
          <div style="flex:1">
            <div style="font-family:'Oswald',sans-serif;font-size:14px;font-weight:700;letter-spacing:1px;color:var(--gold-lt)">PELADA DO TORNEIRA ${p.data}</div>
            <div style="font-size:11px;color:var(--t2);margin-top:2px">
              ${p.jogadores?.filter(j=>!j.ausente).length||0} jogadores ·
              ${votAberta
                ? `<span style="color:#eab308">⏳ Votação: ${totalVotos}/${totalEleg}</span>`
                : `MVP: ${mvpNome}`}
            </div>
          </div>
          <div style="color:${podeVotar?'#eab308':'var(--t3)'};font-size:16px">${podeVotar?'VOTAR':'›'}</div>
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

  document.getElementById('peladaDetalheTitle').textContent = `PELADA ${p.data}`;
  document.getElementById('peladaDetalheMvp').innerHTML = tempoHTML + podioHTML + votacaoHTML;
  document.getElementById('peladaDetalheList').innerHTML = `<div class="section-lbl" style="margin-top:4px">ESTATÍSTICAS COMPLETAS</div>` + rows;
  openModal('modalPeladaDetalhe');
}
window.openPeladaDetalhe = openPeladaDetalhe;
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
  if(id){const j=appData.jogadores.find(x=>x.id===id);if(j){document.getElementById('inpNome').value=j.nome;document.getElementById('inpNota').value=j.nota?.toFixed(1);}}
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
  if(editId){
    const j=appData.jogadores.find(x=>x.id===editId);
    if(j){j.nome=nome;j.nota=nota;await firestoreSet('jogadores',editId,j);}
  } else {
    const id='p'+Date.now();
    const nj={id,nome,nota,domingos:[],criadoEm:Date.now()};
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
  appData.restricoes=appData.restricoes.filter(r=>r.p1!==id&&r.p2!==id);
  await firestoreDelete('jogadores',id);
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
  const j=appData.jogadores.find(x=>x.id===id); if(!j) return;
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
function openPerfilProprio() { if(currentUser) openPerfil(currentUser.id); }

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
  if (!confirm(`Remover domingo ${d?.data}?`)) return;
  j.domingos.splice(idx, 1);
  await firestoreSet('jogadores', jogadorId, j);
  saveLocal();
  showToast('Domingo removido');
  openPerfil(jogadorId);
}


// ─── FOTO DE PERFIL ──────────────────────────────────────────
function abrirUploadFoto(jogadorId) {
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

function confirmarDataSorteio() {
  const data = document.getElementById('inputDataSorteio').value.trim();
  if (!data) { showToast('Informe a data da pelada'); return; }
  closeModal('modalDataSorteio');
  flow={
    step:'sel', presentes:[], times:[], data,
    ausentes:[], statsIdx:0, statsOrder:[], statsData:{}
  };
  appData.restricoes=appData.restricoes.filter(r=>r.duracao!=='domingo');
  saveLocal(); renderFlow();
  document.getElementById('flow').style.display='block';
}
function closeFlow() {
  document.getElementById('flow').style.display='none';
}
function renderFlow() {
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
  const scored=flow.presentes.map(id=>{
    const base=idxMap[id]?.IF||0;
    return{id,score:base+base*alea*(Math.random()*2-1)};
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
  // Save to Firebase so all users see the teams
  const timesData = {
    times: flow.times,
    data: flow.data,
    status: 'confirmado',
    sorteadoEm: Date.now(),
    nomes: flow.times.map(t => t.map(id => {
      const j = appData.jogadores.find(x=>x.id===id);
      return j?.nome || id;
    }))
  };
  await firestoreSet('config', 'ultimoSorteio', timesData);
  appData.ultimoSorteio = timesData;
  saveLocal();
  // Close flow and go back to home — home will show times + admin controls
  document.getElementById('flow').style.display='none';
  goTo('home');
  showToast('Times confirmados! ✅ Todos podem ver.');
}

// ─── HOME admin actions (cancelar / concluir) ─────────────────
async function cancelarPartidaHome() {
  if (!currentUser?.isAdmin) return;
  if (!confirm('Cancelar partida? Os times serão removidos.')) return;
  await firestoreDelete('config', 'ultimoSorteio');
  appData.ultimoSorteio = null;
  saveLocal();
  renderHome();
  showToast('Partida cancelada');
}

async function concluirPartidaHome() {
  if (!currentUser?.isAdmin) return;
  const sorteio = appData.ultimoSorteio;
  if (!sorteio) return;
  // Load flow data from current sorteio to proceed to ausentes/stats
  flow = {
    step: 'ausentes',
    presentes: sorteio.times.flat(),
    times: sorteio.times,
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
  if(idx>=total){salvarStats();return;}
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

  const peladaRec = {
    id: peladaId,
    data,
    savedAt: Date.now(),
    times: flow.times,
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

  if (!appData.peladasHist) appData.peladasHist = [];
  appData.peladasHist.push(peladaRec);
  await firestoreSet('peladasHist', peladaId, peladaRec);

  // If no nominees (everyone scored 0), just save podium from score sort
  if (nominees.length === 0) {
    await finalizarVotacao(peladaId, peladaRec, true);
  }

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
window.checkVotacoesExpiradas=checkVotacoesExpiradas;
