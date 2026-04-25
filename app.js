// ============================================================
// PELADA DO TORNEIRA — APP.JS  (Firebase multi-user v3)
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

// ─── BOOT ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  const saved = localStorage.getItem(LS_CONFIG);
  if (!saved) { showSetup(true); return; }
  const cfg = JSON.parse(saved);
  if (cfg.local) { useFirebase = false; }
  else { useFirebase = true; initFB(cfg); }
  const su = localStorage.getItem(LS_USER);
  if (!su) { await loadData(); showLogin(true); return; }
  currentUser = JSON.parse(su);
  await loadData();
  showApp();
}

async function entrar() {
  const nome = document.getElementById('loginNome').value.trim();
  if (!nome) { showToast('Digite seu nome'); return; }
  const match = fuzzyFind(nome, appData.jogadores);
  if (match) {
    const isAdmin = (appData.admins || []).includes(match.id);
    currentUser = { id: match.id, nome: match.nome, isAdmin };
  } else {
    const id = 'p' + Date.now();
    const nj = { id, nome, nota: 5.0, domingos: [], criadoEm: Date.now() };
    appData.jogadores.push(nj);
    await firestoreSet('jogadores', id, nj);
    // First user = admin
    if (appData.jogadores.length === 1 || appData.admins.length === 0) {
      appData.admins = [id];
      await firestoreSet('config', 'admins', { list: [id] });
    }
    currentUser = { id, nome, isAdmin: (appData.admins || []).includes(id) };
    saveLocal();
  }
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
  if (!j.domingos?.length) return 0;
  const s = j.domingos.map(d=>scoreRaw(d.gols,d.assists,d.vitorias));
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
  document.getElementById('hAvatar').textContent=(currentUser?.nome||'?')[0].toUpperCase();
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
  const n=appData.jogadores.length;
  document.getElementById('homeSub').textContent=currentUser?`Bem-vindo, ${currentUser.nome}!`:'';
  document.getElementById('homeMsg').textContent=n===0?'Nenhum jogador cadastrado ainda':`${n} jogadores cadastrados`;
  document.getElementById('homeStats').textContent=n>0?`Acesse Jogadores para ver todos`:'';
}

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
    return `
    <div class="prow" onclick="openPerfil('${j.id}')">
      <div class="p-avatar">${j.nome[0].toUpperCase()}</div>
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
    const possible=fuzzyFind(nome,appData.jogadores);
    if(possible&&possible.nome.toLowerCase()!==nome.toLowerCase())
      if(!confirm(`Já existe "${possible.nome}". Cadastrar mesmo assim?`)) return;
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
function renderRanking() {
  const list=document.getElementById('rankList');
  if(!appData.jogadores.length){list.innerHTML=`<div class="empty"><div class="empty-ico">🏆</div><div class="empty-txt">Nenhum jogador ainda.</div></div>`;return;}
  const sorted=calcIdx(appData.jogadores).sort((a,b)=>b.IF-a.IF);
  list.innerHTML=sorted.map((ix,i)=>{
    const cl=i===0?'g':i===1?'s':i===2?'b':'';
    const lbl=i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
    return `
    <div class="prow" onclick="openPerfil('${ix.id}')">
      <div class="rank-n ${cl}">${lbl}</div>
      <div class="p-info">
        <div class="p-name">${ix.nome}</div>
        <div class="p-meta">Nota: ${ix.nota.toFixed(1)} · α=${ix.alpha.toFixed(4)} · ${ix.n} dom.</div>
      </div>
      <div class="${ix.n>0?'p-if':'p-if empty'}">${ix.n>0?ix.IF.toFixed(2):'—'}</div>
    </div>`;
  }).join('');
}

// ─── PERFIL ──────────────────────────────────────────────────
function openPerfil(id) {
  const j=appData.jogadores.find(x=>x.id===id); if(!j) return;
  const ix=calcIdx(appData.jogadores).find(x=>x.id===id);
  const nd=nDom(j);
  const tg=j.domingos.reduce((s,d)=>s+d.gols,0);
  const ta=j.domingos.reduce((s,d)=>s+d.assists,0);
  const tv=j.domingos.reduce((s,d)=>s+d.vitorias,0);
  const histHTML=!j.domingos.length?`<div style="color:var(--t3);font-size:13px;text-align:center;padding:16px">Sem dados registrados</div>`:
    [...j.domingos].reverse().map(d=>`
    <div class="hist">
      <div class="hdate">${d.data}</div>
      <div class="hstats">
        <div>⚽ <span>${d.gols}</span></div>
        <div>🎯 <span>${d.assists}</span></div>
        <div>🏆 <span>${d.vitorias}</span></div>
        <div>Score <span>${scoreRaw(d.gols,d.assists,d.vitorias).toFixed(4)}</span></div>
      </div>
    </div>`).join('');
  document.getElementById('perfilBody').innerHTML=`
    <div class="m-title">${j.nome}</div>
    <div class="m-sub">Nota opinativa: ${j.nota?.toFixed(1)}</div>
    <div class="pills">
      <div class="pill"><div class="pill-v">${nd>0&&ix?ix.IF.toFixed(2):'—'}</div><div class="pill-l">Índice</div></div>
      <div class="pill"><div class="pill-v">${tg}</div><div class="pill-l">Gols</div></div>
      <div class="pill"><div class="pill-v">${ta}</div><div class="pill-l">Assists</div></div>
      <div class="pill"><div class="pill-v">${tv}</div><div class="pill-l">Vitórias</div></div>
    </div>
    ${ix&&nd>0?`
    <div class="card" style="margin-bottom:12px">
      <div class="section-lbl">CÁLCULO DETALHADO</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--t2);line-height:2.2">
        n = ${ix.n} · Score acum = ${scoreAcum(j).toFixed(4)}<br>
        S_adj (shrinkage k=5) = ${ix.sAdj.toFixed(4)}<br>
        S_adj normalizado = ${ix.sAdjN.toFixed(4)}<br>
        Nota normalizada = ${ix.notaN.toFixed(4)}<br>
        α(${ix.n}) = ${ix.alpha.toFixed(4)}<br>
        <span style="color:var(--gold)">IF = ${ix.alpha.toFixed(4)}×${ix.notaN.toFixed(4)} + ${(1-ix.alpha).toFixed(4)}×${ix.sAdjN.toFixed(4)} = ${ix.IF.toFixed(4)}</span>
      </div>
    </div>`:''}
    <div class="section-lbl" style="margin-bottom:8px">HISTÓRICO</div>
    ${histHTML}`;
  openModal('modalPerfil');
}
function openPerfilProprio() { if(currentUser) openPerfil(currentUser.id); }

// ─── OPCOES ──────────────────────────────────────────────────
function renderOpcoes() {
  document.getElementById('sliderAlea').value=appData.config?.aleatoriedade??15;
  updateAlea();
  renderRestList();
}
function updateAlea() {
  const v=document.getElementById('sliderAlea').value;
  document.getElementById('aleaVal').textContent=v+'%';
  if(!appData.config) appData.config={};
  appData.config.aleatoriedade=parseInt(v);
  if(useFirebase&&db_fire&&currentUser?.isAdmin) firestoreSet('config','main',appData.config).catch(()=>{});
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
      </button>`:''}
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
let flow={step:'sel',presentes:[],times:[],data:'',statsIdx:0,statsOrder:[],statsData:{}};
const T_NAMES=['Time 1','Time 2','Time 3','Time 4'];
const T_COLORS=['t0','t1','t2','t3'];

function startFlow() {
  if(!currentUser?.isAdmin){showToast('Sem permissão');return;}
  if(appData.jogadores.length<15){showToast('Cadastre pelo menos 15 jogadores');return;}
  flow={step:'sel',presentes:[],times:[],data:new Date().toLocaleDateString('pt-BR'),statsIdx:0,statsOrder:[],statsData:{}};
  appData.restricoes=appData.restricoes.filter(r=>r.duracao!=='domingo');
  saveLocal(); renderFlow();
  document.getElementById('flow').style.display='block';
}
function closeFlow() {
  if(flow.step==='partida'){if(!confirm('Cancelar? Dados não serão salvos.')) return;}
  document.getElementById('flow').style.display='none';
}
function renderFlow() {
  const c=document.getElementById('flowContent'),t=document.getElementById('flowTitle');
  if(flow.step==='sel') renderFlowSel(c,t);
  else if(flow.step==='times') renderFlowTimes(c,t);
  else if(flow.step==='partida') renderFlowPartida(c,t);
  else if(flow.step==='stats') { t.textContent=`ESTATÍSTICAS ${flow.statsIdx+1}/${flow.statsOrder.length}`; renderStatsStep(c); }
}

function renderFlowSel(c,t) {
  t.textContent='SELECIONAR PRESENTES';
  const sel=flow.presentes,n=sel.length,valid=n===15||n===20;
  c.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:13px;color:var(--t2)">Selecione <strong style="color:var(--gold)">15</strong> ou <strong style="color:var(--gold)">20</strong></div>
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
      <button class="btn btn-gold" onclick="confirmarTimes()">✅ CONFIRMAR</button>
    </div>`;
}

function renderFlowPartida(c,t) {
  t.textContent='PARTIDA EM ANDAMENTO';
  c.innerHTML=`
    <div style="text-align:center;padding:24px 0 28px">
      <img src="logo.jpg" style="width:80px;height:80px;border-radius:12px;border:2px solid var(--border-gold);box-shadow:0 0 30px rgba(201,168,76,.2);margin-bottom:12px;display:block;margin-left:auto;margin-right:auto">
      <div style="font-family:'Oswald',sans-serif;font-size:22px;font-weight:700;letter-spacing:3px;color:var(--gold-lt)">BOA PELADA!</div>
      <div style="font-size:12px;color:var(--t2);margin-top:4px">${flow.data}</div>
    </div>
    ${flow.times.map((tm,ti)=>`
      <div class="team-card ${T_COLORS[ti]}" style="margin-bottom:8px">
        <div class="t-name"><div class="t-dot"></div>${T_NAMES[ti]}</div>
        ${tm.map(id=>{const j=appData.jogadores.find(x=>x.id===id);return`<div class="t-player"><span>${j?.nome||id}</span></div>`;}).join('')}
      </div>`).join('')}
    <div class="row mt16">
      <button class="btn btn-danger" onclick="cancelarPartida()">❌ CANCELAR</button>
      <button class="btn btn-gold" onclick="finalizarPartida()">🏁 FINALIZAR</button>
    </div>`;
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
  // Local search
  const sum=t=>t.reduce((s,id)=>s+(idxMap[id]?.IF||0),0);
  const imbal=ts=>{let mx=0;for(let i=0;i<ts.length;i++)for(let j=i+1;j<ts.length;j++)mx=Math.max(mx,Math.abs(sum(ts[i])-sum(ts[j])));return mx;};
  let imp=true,it=0;
  while(imp&&it<500){imp=false;it++;
    for(let a=0;a<nT;a++)for(let b=a+1;b<nT;b++)for(let p=0;p<times[a].length;p++)for(let q=0;q<times[b].length;q++){
      const bef=imbal(times);[times[a][p],times[b][q]]=[times[b][q],times[a][p]];
      if(imbal(times)<bef-0.0001)imp=true;else[times[a][p],times[b][q]]=[times[b][q],times[a][p]];
    }
  }
  // Check restrictions
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
function resortear(){sortearTimes();}
function confirmarTimes(){flow.step='partida';renderFlow();}
function cancelarPartida(){if(confirm('Cancelar? Times descartados.'))document.getElementById('flow').style.display='none';}
function finalizarPartida(){
  flow.step='stats';flow.statsIdx=0;
  flow.statsOrder=flow.times.flat();
  flow.statsData={};
  flow.statsOrder.forEach(id=>{flow.statsData[id]={gols:0,assists:0,vitorias:0};});
  renderFlow();
}

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
  const data=flow.data;
  for(const id in flow.statsData){
    const j=appData.jogadores.find(x=>x.id===id); if(!j) continue;
    if(!j.domingos) j.domingos=[];
    j.domingos.push({data,...flow.statsData[id]});
    await firestoreSet('jogadores',id,j);
  }
  saveLocal();
  document.getElementById('flow').style.display='none';
  showToast('Estatísticas salvas! 🎉');
  renderHome();
}

// ─── EXPORT ──────────────────────────────────────────────────
function exportarExcel() {
  const idxMap=Object.fromEntries(calcIdx(appData.jogadores).map(i=>[i.id,i]));
  let csv='Nome,Nota Opinativa,Índice Final,Score Ajustado,Alpha,Domingos,Gols,Assists,Vitórias\n';
  for(const j of appData.jogadores){
    const ix=idxMap[j.id],nd=nDom(j);
    const tg=j.domingos.reduce((s,d)=>s+d.gols,0);
    const ta=j.domingos.reduce((s,d)=>s+d.assists,0);
    const tv=j.domingos.reduce((s,d)=>s+d.vitorias,0);
    csv+=`${j.nome},${j.nota?.toFixed(1)},${ix&&nd>0?ix.IF.toFixed(4):'—'},${ix&&nd>0?ix.sAdj.toFixed(4):'—'},${ix&&nd>0?ix.alpha.toFixed(4):'—'},${nd},${tg},${ta},${tv}\n`;
  }
  csv+='\n\nHISTÓRICO\nData,Jogador,Gols,Assists,Vitórias,Score\n';
  for(const j of appData.jogadores)
    for(const d of j.domingos)
      csv+=`${d.data},${j.nome},${d.gols},${d.assists},${d.vitorias},${scoreRaw(d.gols,d.assists,d.vitorias).toFixed(4)}\n`;
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
  }
  saveLocal();renderHome();showToast('Dados resetados');
}

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
window.openModal=openModal;
window.closeModal=closeModal;
window.updateAlea=updateAlea;
window.setRT=setRT;
window.setRD=setRD;
window.addRestricao=addRestricao;
window.removerRest=removerRest;
window.toggleAdmin=toggleAdmin;
window.toggleP=toggleP;
window.confirmarPresentes=confirmarPresentes;
window.resortear=resortear;
window.confirmarTimes=confirmarTimes;
window.cancelarPartida=cancelarPartida;
window.finalizarPartida=finalizarPartida;
window.chgS=chgS;
window.statsN=statsN;
window.statsB=statsB;
window.exportarExcel=exportarExcel;
window.confirmReset=confirmReset;
