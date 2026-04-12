const ZONES=["100 M - ma3raz","100 M - De Fermo","Shorsh","Rwanga","Cihan City","150 M - Slava","Kasnazan","English Village exit","Aland Stake","100 M - Italy1","Baharka road","Ainkawa 108","150 M - Ganjan","100 M - Empire","Dream city - star tower","Rashken road","120 M - Aram City"];
const ZONE_COLORS={"100 M - ma3raz":"#97C459","100 M - De Fermo":"#5DCAA5","Shorsh":"#F0997B","Rwanga":"#5DCAA5","Cihan City":"#ED93B1","150 M - Slava":"#B4B2A9","Kasnazan":"#AFA9EC","English Village exit":"#FAC775","Aland Stake":"#85B7EB","100 M - Italy1":"#EF9F27","Baharka road":"#85B7EB","Ainkawa 108":"#F5C4B3","150 M - Ganjan":"#F0997B","100 M - Empire":"#7F77DD","Dream city - star tower":"#D4537E","Rashken road":"#378ADD","120 M - Aram City":"#BA7517"};
const TRUCKS=["B13","B14","B15","B16","B17","B18","B19","B20","B21","B22","B23","B24","B25","B26","B27","B28","B29"];
const RIDERS=["Abdulkareem Sabah","Abdulmalik Samer","Abdulqadr Farhad Osman","Abdulrahman Abu-Bakir","Ahmed Ayad Ali","Ahmed Sabr","Amin Rahman Mohammed","Ayad Mohammed","Bilal Ismail","Dana Mohammed","Darya Mohammed","Dashty Osman","Hakar Nadr","Hardi Osman","Harem Arif","Haval Qadr Hussein","Hemn Younis","Hersh Anwar","Hikmat Omar","Ibrahim Aswad","Ibrahim Khalil","Ismail Ali","Karzan Abdulrahman","Kawa Rasheed","Kaywan Majid","Mohammed Muzafar","Mohammed Najat Hasan","Mohammed Sattar","Mukhles Amir Hasan","Musaab Hazhar Jabar","Safar Rajab","Saman Salman","Shwan Ismail Ahmad","Shwan Jalal","Yousif Sardar Sabr","Zhyar Shams al-Din"];
const DEFAULT_ORDERS=[]; // Empty as per original
let orders=[], nextId=1, page=1, editId=null, currentTab='orders';
/** True when /orders API is reachable — shared DB; false means localStorage-only (not shared). */
let serverMode=false;
let pollTimer=null;
let visibilityHooked=false;
const POLL_MS=15000;
const PAGE=15;
const STORAGE_KEY='fuel-orders-data';
const THEME_KEY='fuel-orders-theme';
const TOKEN_KEY='fuel-orders-token';
const ROLE_KEY='fuel-orders-role';
let authToken=null;
let userRole='editor';
let authRequired=false;
let fuelListenerHooked=false;
let teamLoginEnabled=false;
let userLoginEnabled=false;
let signupEnabledState=false;

function getStoredAuth(){
  authToken = localStorage.getItem(TOKEN_KEY);
  const r = localStorage.getItem(ROLE_KEY);
  userRole = r === 'viewer' ? 'viewer' : 'editor';
}

function apiFetch(url, options = {}){
  const headers = { ...options.headers };
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  return fetch(url, { ...options, headers });
}

function applyRoleUI(){
  document.body.classList.toggle('role-viewer', userRole === 'viewer');
  document.body.classList.toggle('role-editor', userRole !== 'viewer');
  const badge = document.getElementById('roleBadge');
  const logoutBtn = document.getElementById('logoutBtn');
  if (badge && logoutBtn) {
    if (authRequired) {
      badge.style.display = 'inline-block';
      logoutBtn.style.display = 'inline-block';
      badge.textContent = userRole === 'viewer' ? 'Viewer' : 'Editor';
    } else {
      badge.style.display = 'none';
      logoutBtn.style.display = 'none';
    }
  }
}

function configureAuthPanels(st){
  teamLoginEnabled = !!st.teamLoginEnabled;
  userLoginEnabled = !!st.userLoginEnabled;
  signupEnabledState = !!st.signupEnabled;
  const userBlock = document.getElementById('authUserBlock');
  const hint = document.getElementById('authLoginHint');
  const linkSu = document.getElementById('linkToSignup');
  const openHint = document.getElementById('authOpenHint');
  if(openHint) openHint.classList.add('hidden');
  if(userBlock){
    userBlock.classList.toggle('hidden', !userLoginEnabled);
    const em = document.getElementById('loginEmail');
    if(em) em.required = !!(userLoginEnabled && !teamLoginEnabled);
  }
  if(hint){
    if(userLoginEnabled && teamLoginEnabled){
      hint.textContent = 'Use your email and password, or leave email empty and use the shared team password.';
    } else if(userLoginEnabled){
      hint.textContent = 'Sign in with the email and password you registered.';
    } else if(teamLoginEnabled){
      hint.textContent = 'Enter the team password from your administrator.';
    } else {
      hint.textContent = '';
    }
  }
  if(linkSu) linkSu.classList.toggle('hidden', !signupEnabledState);
  showAuthPanel('login');
}

function showAuthPanel(which){
  const login = document.getElementById('panelLogin');
  const signup = document.getElementById('panelSignup');
  const linkSu = document.getElementById('linkToSignup');
  const linkLi = document.getElementById('linkToLogin');
  if(which === 'signup'){
    if(login) login.classList.add('hidden');
    if(signup) signup.classList.remove('hidden');
    if(linkSu) linkSu.classList.add('hidden');
    if(linkLi) linkLi.classList.remove('hidden');
  } else {
    if(signup) signup.classList.add('hidden');
    if(login) login.classList.remove('hidden');
    if(linkSu) linkSu.classList.toggle('hidden', !signupEnabledState);
    if(linkLi) linkLi.classList.add('hidden');
  }
}

function showLogin(){
  const auth = document.getElementById('authScreen');
  const main = document.getElementById('mainApp');
  if(auth){
    auth.classList.remove('hidden');
    auth.setAttribute('aria-hidden', 'false');
  }
  if(main) main.classList.add('main-hidden');
}

function hideLogin(){
  const auth = document.getElementById('authScreen');
  const main = document.getElementById('mainApp');
  if(auth){
    auth.classList.add('hidden');
    auth.setAttribute('aria-hidden', 'true');
  }
  if(main) main.classList.remove('main-hidden');
}

async function submitSignup(){
  const err = document.getElementById('signupError');
  const btn = document.getElementById('btnSignupSubmit');
  if(err){ err.style.display = 'none'; err.textContent = ''; }
  const emailEl = document.getElementById('signupEmail');
  const p1 = document.getElementById('signupPassword');
  const p2 = document.getElementById('signupPassword2');
  const codeEl = document.getElementById('signupCode');
  const email = emailEl ? emailEl.value.trim().toLowerCase() : '';
  const password = p1 ? p1.value : '';
  const signupCode = codeEl ? codeEl.value : '';
  if(password !== (p2 ? p2.value : '')){
    if(err){ err.textContent = 'Passwords do not match'; err.style.display = 'block'; }
    return;
  }
  if(btn){ btn.disabled = true; btn.dataset._t = btn.textContent; btn.textContent = 'Creating…'; }
  try{
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, signupCode }),
    });
    let data = {};
    try{ data = await res.json(); } catch(e){}
    if(!res.ok){
      const msg = data.error || 'Registration failed';
      if(err){ err.textContent = msg; err.style.display = 'block'; }
      showToast(msg, 'error');
      return;
    }
    showToast('Account created — sign in below.', 'success');
    showAuthPanel('login');
    const le = document.getElementById('loginEmail');
    if(le) le.value = email;
    const lp = document.getElementById('loginPassword');
    if(lp) lp.value = '';
    if(p1) p1.value = '';
    if(p2) p2.value = '';
    if(codeEl) codeEl.value = '';
  } catch(e){
    showToast('Network error.', 'error');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = btn.dataset._t || 'Create account'; }
  }
}

async function submitLogin(){
  const err = document.getElementById('loginError');
  const btn = document.getElementById('btnLoginSubmit');
  const em = document.getElementById('loginEmail');
  const pw = document.getElementById('loginPassword');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const email = em && em.value ? em.value.trim().toLowerCase() : '';
  const password = pw ? pw.value : '';
  if(userLoginEnabled && !teamLoginEnabled && !email){
    showToast('Email is required.', 'error');
    if(err){ err.textContent = 'Email is required'; err.style.display = 'block'; }
    return;
  }
  if(!password){
    showToast('Enter a password.', 'error');
    return;
  }
  if (btn) { btn.disabled = true; btn.dataset._t = btn.textContent; btn.textContent = 'Signing in…'; }
  try {
    const body = email ? { email, password } : { password };
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (err) { err.textContent = 'Invalid credentials'; err.style.display = 'block'; }
      showToast('Invalid credentials', 'error', 3500);
      return;
    }
    const data = await res.json();
    authToken = data.token;
    userRole = data.role;
    localStorage.setItem(TOKEN_KEY, authToken);
    localStorage.setItem(ROLE_KEY, userRole);
    if (pw) pw.value = '';
    if (em) em.value = '';
    const ok = await loadDataCore();
    if (!ok) {
      if (err) { err.textContent = 'Could not load orders'; err.style.display = 'block'; }
      showToast('Signed in but could not load orders.', 'error');
    } else {
      showToast('Signed in', 'success', 2200);
    }
  } catch (e) {
    showToast('Network error — check your connection.', 'error');
    if (err) { err.textContent = 'Network error'; err.style.display = 'block'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset._t || 'Sign in'; }
  }
}

function logout(){
  authToken = null;
  userRole = 'editor';
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  stopSharedPolling();
  orders = [];
  nextId = 1;
  serverMode = false;
  render();
  showLogin();
  applyRoleUI();
}

async function boot(){
  getStoredAuth();
  let st = { authEnabled: false };
  try {
    st = await fetch('/api/auth/status').then((r) => r.json());
  } catch (e) {}
  if (st.version) setAppVersion(st.version);
  configureAuthPanels(st);
  authRequired = !!st.authEnabled;
  if (!authRequired) {
    authToken = null;
    userRole = 'editor';
    hideLogin();
    await loadDataCore();
    applyRoleUI();
    return;
  }
  if (!authToken) {
    showLogin();
    const params = new URLSearchParams(window.location.search);
    const a = params.get('auth');
    if (a === 'signup' && signupEnabledState) showAuthPanel('signup');
    else if (a === 'login') showAuthPanel('login');
    if (a) history.replaceState({}, '', window.location.pathname);
    applyRoleUI();
    return;
  }
  const ok = await loadDataCore();
  if (!ok) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    authToken = null;
    showLogin();
    applyRoleUI();
    return;
  }
  applyRoleUI();
}

function applyTheme(theme){
  const dark = theme === 'dark';
  document.body.classList.toggle('theme-dark', dark);
  const btn = document.getElementById('themeToggle');
  if(btn) btn.textContent = dark ? 'Light' : 'Dark';
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme(){
  applyTheme(document.body.classList.contains('theme-dark') ? 'light' : 'dark');
}

function loadTheme(){
  const saved = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(saved);
}

function showToast(message, variant = 'info', duration = 4400){
  const host = document.getElementById('toastHost');
  if(!host) return;
  const el = document.createElement('div');
  el.className = 'toast toast-' + variant;
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 280);
  }, duration);
}

function setAppVersion(v){
  const el = document.getElementById('appVersion');
  if(el && v) el.textContent = '· v' + v;
}


function debounce(func, wait=300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const debounceRender = debounce(render);

function applyServerOrders(list){
  orders = Array.isArray(list) ? list : [];
  nextId = orders.length ? Math.max(...orders.map(o => Number(o.id))) + 1 : 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({orders, nextId}));
}

function startSharedPolling(){
  if(pollTimer || !serverMode) return;
  pollTimer = setInterval(refreshOrdersFromServer, POLL_MS);
}

function stopSharedPolling(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
}

async function refreshOrdersFromServer(){
  if(!serverMode) return;
  try{
    const res = await apiFetch('/orders');
    if(res.status === 401 && authRequired){ showLogin(); return; }
    if(!res.ok) return;
    const list = await res.json();
    applyServerOrders(list);
    populateFilters();
    render();
    if(currentTab === 'reports') renderReports();
  } catch(e){ /* keep current UI if request fails */ }
}

async function loadDataCore(){
  try{
    const res = await apiFetch('/orders');
    if(res.status === 401) return false;
    if(res.ok){
      serverMode = true;
      applyServerOrders(await res.json());
    } else {
      throw new Error();
    }
  } catch(e){
    if(authRequired) return false;
    serverMode = false;
    const saved = localStorage.getItem(STORAGE_KEY);
    if(saved){
      const data = JSON.parse(saved);
      orders = data.orders || [];
      nextId = data.nextId || (orders.length ? Math.max(...orders.map(o => o.id)) + 1 : 1);
    } else {
      orders = [];
      nextId = 1;
    }
  }
  populateFilters();
  render();
  if(serverMode) startSharedPolling();
  if(!visibilityHooked){
    visibilityHooked=true;
    document.addEventListener('visibilitychange', onVisibilityForSync);
  }
  hideLogin();
  applyRoleUI();
  return true;
}

async function loadData(){
  await loadDataCore();
}

function onVisibilityForSync(){
  if(document.visibilityState === 'visible' && serverMode) refreshOrdersFromServer();
}

async function persistData(){
  const el=document.getElementById('saveIndicator');
  if(!el) return;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2000);
}

function parseCSV(text){
  const lines=text.trim().split(/\r?\n/).filter(l=>l.trim());
  const rows=[];
  const regex=/\s*(?:"([^"]*(?:""[^"]*)*)"|([^",]*))(?:,|$)/g;
  for(const line of lines.slice(1)){
    const values=[];
    let m;
    regex.lastIndex=0;
    while((m=regex.exec(line))!==null){
      const value = m[1] !== undefined ? m[1].replace(/""/g,'"') : m[2];
      values.push(value || '');
      if(regex.lastIndex >= line.length) break;
    }
    rows.push(values);
  }
  return rows;
}

function importCSV(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const rows = parseCSV(e.target.result);
    let serverAvailable = true;
    for(const cols of rows){
      if(cols.length < 11) continue;
      const date = cols[0].trim() || new Date().toLocaleDateString('en-US');
      const name = cols[1].trim().replace(/^"|"$/g,'') || '/';
      const phone = cols[2].trim();
      const zone = cols[3].trim().replace(/^"|"$/g,'') || ZONES[0];
      const truck = cols[4].trim();
      const rider = cols[5].trim();
      const fuel = cols[6].trim() || 'Muhasan';
      const price = parseInt(cols[7].replace(/,/g,'')) || 0;
      const liters = parseFloat(cols[8].replace(/,/g,'')) || 0;
      const status = cols[9].trim() || 'Completed';
      const notes = cols[10].trim().replace(/^"|"$/g,'');
      const orderData = {date,name,phone,zone,truck,rider,fuel,price,liters,status,notes};
      try{
        const res = await apiFetch('/orders', {
          method: 'POST',
          body: JSON.stringify(orderData)
        });
        if(res.ok){
          const {id} = await res.json();
          orderData.id = id;
          orders.push(orderData);
          nextId = Math.max(nextId, id + 1);
        } else {
          serverAvailable = false;
          break;
        }
      } catch(e){
        serverAvailable = false;
        break;
      }
    }
    if(serverAvailable && authRequired && userRole === 'editor'){
      try{
        await apiFetch('/api/audit/event', { method: 'POST', body: JSON.stringify({ action: 'CSV_IMPORT', detail: { rows: rows.length } }) });
      } catch(e){}
    }
    if(!serverAvailable){
      // Fallback to localStorage
      for(const cols of rows){
        if(cols.length < 11) continue;
        const date = cols[0].trim() || new Date().toLocaleDateString('en-US');
        const name = cols[1].trim().replace(/^"|"$/g,'') || '/';
        const phone = cols[2].trim();
        const zone = cols[3].trim().replace(/^"|"$/g,'') || ZONES[0];
        const truck = cols[4].trim();
        const rider = cols[5].trim();
        const fuel = cols[6].trim() || 'Muhasan';
        const price = parseInt(cols[7].replace(/,/g,'')) || 0;
        const liters = parseFloat(cols[8].replace(/,/g,'')) || 0;
        const status = cols[9].trim() || 'Completed';
        const notes = cols[10].trim().replace(/^"|"$/g,'');
        orders.push({id:nextId++,date,name,phone,zone,truck,rider,fuel,price,liters,status,notes});
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({orders, nextId}));
    }
    populateFilters();
    render();
    renderReports();
    showToast('Imported ' + rows.length + ' rows.', 'success');
  };
  reader.readAsText(file,'utf-8');
  event.target.value = '';
}

function parseDate(str){
  const p=str.split('/');
  if(p.length===3) return new Date(parseInt(p[2]),parseInt(p[0])-1,parseInt(p[1]));
  return new Date(str);
}

function getDateRange(){
  const p=document.getElementById('rPeriod').value;
  const now=new Date();
  let from,to;
  if(p==='today'){from=new Date(now.getFullYear(),now.getMonth(),now.getDate());to=new Date(from);to.setDate(to.getDate()+1);}
  else if(p==='week'){from=new Date(now);from.setDate(now.getDate()-now.getDay());to=new Date(now);to.setDate(to.getDate()+1);}
  else if(p==='month'){from=new Date(now.getFullYear(),now.getMonth(),1);to=new Date(now.getFullYear(),now.getMonth()+1,1);}
  else if(p==='all'){from=new Date(2000,0,1);to=new Date(2100,0,1);}
  else if(p==='custom'){
    const fv=document.getElementById('rFrom').value;
    const tv=document.getElementById('rTo').value;
    from=fv?new Date(fv):new Date(2000,0,1);
    to=tv?new Date(tv):new Date(2100,0,1);
    to.setDate(to.getDate()+1);
  }
  return{from,to};
}

function renderReports(){
  const p=document.getElementById('rPeriod').value;
  document.getElementById('rFrom').style.display=p==='custom'?'block':'none';
  document.getElementById('rTo').style.display=p==='custom'?'block':'none';
  const{from,to}=getDateRange();
  const groupBy=document.getElementById('rGroupBy').value;
  const metric=document.getElementById('rMetric').value;
  const inRange=orders.filter(o=>{const d=parseDate(o.date);return d>=from&&d<to&&o.status==='Completed';});
  const totalOrders=inRange.length;
  const totalLiters=inRange.reduce((a,b)=>a+b.liters,0);
  const totalRev=inRange.reduce((a,b)=>a+b.price,0);
  const cancelled=orders.filter(o=>{const d=parseDate(o.date);return d>=from&&d<to&&o.status==='Cancelled';}).length;
  document.getElementById('reportStats').innerHTML=`
    <div class="report-stat"><div class="lbl">Completed orders</div><div class="val" style="color:#1D9E75">${totalOrders}</div></div>
    <div class="report-stat"><div class="lbl">Total liters</div><div class="val" style="color:#BA7517">${Math.round(totalLiters).toLocaleString()}</div></div>
    <div class="report-stat"><div class="lbl">Total revenue (IQD)</div><div class="val" style="color:#534AB7">${totalRev.toLocaleString()}</div></div>
    <div class="report-stat"><div class="lbl">Avg liters / order</div><div class="val">${totalOrders?parseFloat((totalLiters/totalOrders).toFixed(1)):0}</div></div>
    <div class="report-stat"><div class="lbl">Cancelled orders</div><div class="val" style="color:#A32D2D">${cancelled}</div></div>
    <div class="report-stat"><div class="lbl">Avg revenue / order</div><div class="val">${totalOrders?Math.round(totalRev/totalOrders).toLocaleString():0}</div></div>
  `;
  const map={};
  inRange.forEach(o=>{
    let key;
    if(groupBy==='zone') key=o.zone;
    else if(groupBy==='rider') key=o.rider||'Unassigned';
    else if(groupBy==='truck') key=o.truck;
    else if(groupBy==='fuel') key=o.fuel;
    else if(groupBy==='date') key=o.date;
    if(!map[key]) map[key]={count:0,liters:0,price:0};
    map[key].count++;map[key].liters+=o.liters;map[key].price+=o.price;
  });
  const rows=Object.entries(map).sort((a,b)=>b[1][metric]-a[1][metric]);
  const maxVal=rows.length?rows[0][1][metric]:1;
  const metricLabel=metric==='liters'?'Liters':metric==='price'?'Revenue (IQD)':'Orders';
  const groupLabel=groupBy.charAt(0).toUpperCase()+groupBy.slice(1);
  document.getElementById('reportHead').innerHTML=`<th style="width:200px">${groupLabel}</th><th style="width:80px">Orders</th><th style="width:100px">Liters</th><th>Revenue (IQD)</th>`;
  document.getElementById('reportBody').innerHTML=rows.map(([k,v])=>`
    <tr>
      <td title="${k}">${groupBy==='zone'?`<span class="zone-dot" style="background:${ZONE_COLORS[k]||'#aaa'}"></span>`:''}${k}</td>
      <td>${v.count}</td>
      <td>${Math.round(v.liters).toLocaleString()}</td>
      <td>${v.price.toLocaleString()}</td>
    </tr>
  `).join('');
  const barColors=['#534AB7','#1D9E75','#BA7517','#E24B4A','#378ADD','#D4537E','#3B6D11','#854F0B'];
  document.getElementById('barChart').innerHTML=`<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:10px;font-weight:500">${metricLabel} by ${groupLabel}</div>`+rows.slice(0,15).map(([k,v],i)=>{
    const pct=maxVal?Math.max(4,Math.round(v[metric]/maxVal*100)):4;
    const displayVal=metric==='price'?v[metric].toLocaleString():metric==='liters'?Math.round(v[metric]).toLocaleString():v[metric];
    return`<div class="bar-row"><div class="bar-label" title="${k}">${k}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${barColors[i%barColors.length]}"></div></div><div class="bar-val">${displayVal}</div></div>`;
  }).join('');
}

function switchTab(tab){
  currentTab = tab;
  document.body.classList.toggle('report-view', tab==='reports');
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.getAttribute('data-tab') === tab));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  const sec = document.getElementById('sec-'+tab);
  if(sec) sec.classList.add('active');
  if(tab==='reports') renderReports();
  else if(tab==='orders') render();
  else if(tab==='audit') loadAudit();
}

function filterOrderDateRange(o){
  const fromEl = document.getElementById('filterDateFrom');
  const toEl = document.getElementById('filterDateTo');
  const fromVal = fromEl && fromEl.value;
  const toVal = toEl && toEl.value;
  if(!fromVal && !toVal) return true;
  const od = parseDate(o.date);
  if(isNaN(od.getTime())) return true;
  od.setHours(0,0,0,0);
  const t = od.getTime();
  if(fromVal){
    const fd = new Date(fromVal);
    fd.setHours(0,0,0,0);
    if(t < fd.getTime()) return false;
  }
  if(toVal){
    const td = new Date(toVal);
    td.setHours(23,59,59,999);
    if(t > td.getTime()) return false;
  }
  return true;
}

function filtered(){
  const s=document.getElementById('search').value.toLowerCase();
  const z=document.getElementById('filterZone').value;
  const f=document.getElementById('filterFuel').value;
  const st=document.getElementById('filterStatus').value;
  const r=document.getElementById('filterRider').value;
  return orders.filter(o=>{
    if(!filterOrderDateRange(o)) return false;
    if(s&&!o.name.toLowerCase().includes(s)&&!String(o.phone).includes(s)) return false;
    if(z&&o.zone!==z) return false;
    if(f&&o.fuel!==f) return false;
    if(st&&o.status!==st) return false;
    if(r&&o.rider!==r) return false;
    return true;
  });
}

function renderStats(){
  const comp=orders.filter(o=>o.status==='Completed');
  const canc=orders.filter(o=>o.status==='Cancelled').length;
  const pend=orders.filter(o=>o.status==='Pending').length;
  const totalL=comp.reduce((a,b)=>a+b.liters,0);
  document.getElementById('stats').innerHTML=`
    <div class="stat"><div class="lbl">Total orders</div><div class="val">${orders.length}</div></div>
    <div class="stat"><div class="lbl">Completed</div><div class="val green">${comp.length}</div></div>
    <div class="stat"><div class="lbl">Cancelled / Pending</div><div class="val red">${canc} <span style="color:var(--color-text-secondary);font-size:14px">/</span> <span style="color:#BA7517">${pend}</span></div></div>
    <div class="stat"><div class="lbl">Total liters delivered</div><div class="val amber">${Math.round(totalL).toLocaleString()}</div></div>
  `;
}

function render(){
  renderStats();
  const data=filtered();
  const pages=Math.max(1,Math.ceil(data.length/PAGE));
  if(page>pages) page=pages;
  const slice=data.slice((page-1)*PAGE,page*PAGE);
  document.getElementById('tbody').innerHTML=slice.map(o=>`
    <tr>
      <td>${o.date}</td>
      <td title="${o.name}">${o.name}</td>
      <td>${o.phone}</td>
      <td title="${o.zone}"><span class="zone-dot" style="background:${ZONE_COLORS[o.zone]||'#aaa'}"></span>${o.zone}</td>
      <td>${o.truck}</td>
      <td title="${o.rider||'—'}">${o.rider||'—'}</td>
      <td>${o.fuel}</td>
      <td>${o.price?o.price.toLocaleString():'-'}</td>
      <td>${o.liters?o.liters.toFixed(2):'-'}</td>
      <td><span class="badge ${o.status.toLowerCase()}">${o.status}</span></td>
      <td title="${o.notes}">${o.notes||''}</td>
      <td class="editor-only" style="display:flex;gap:4px">
        <button type="button" class="btn sm" onclick="editOrder(${o.id})">Edit</button>
        <button type="button" class="btn sm" style="color:#A32D2D" onclick="deleteOrder(${o.id})">Del</button>
      </td>
    </tr>
  `).join('');
  const total=data.length;
  document.getElementById('pager').innerHTML=total>PAGE?`
    <span>${(page-1)*PAGE+1}–${Math.min(page*PAGE,total)} of ${total}</span>
    <button class="btn" style="height:28px;padding:0 10px" onclick="changePage(-1)" ${page===1?'disabled':''}>‹</button>
    <button class="btn" style="height:28px;padding:0 10px" onclick="changePage(1)" ${page===pages?'disabled':''}>›</button>
  `:'';
}

function changePage(d){page+=d;render()}

function calcLiters(){
  const price=parseInt(document.getElementById('fPrice').value)||0;
  const fuel=document.getElementById('fFuel').value;
  const rate=fuel==='Super'?1500:1350;
  document.getElementById('fLiters').value=price?parseFloat((price/rate).toFixed(2)):'';
}

function populateFilters(){
  const fz=document.getElementById('filterZone');
  while(fz.options.length>1) fz.remove(1);
  ZONES.forEach(z=>{const o=document.createElement('option');o.value=z;o.textContent=z;fz.appendChild(o)});
  const fr=document.getElementById('filterRider');
  while(fr.options.length>1) fr.remove(1);
  RIDERS.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;fr.appendChild(o)});
  const fZone=document.getElementById('fZone');
  if(!fZone.options.length){ZONES.forEach(z=>{const o=document.createElement('option');o.value=z;o.textContent=z;fZone.appendChild(o)});}
  const fTruck=document.getElementById('fTruck');
  if(!fTruck.options.length){TRUCKS.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;fTruck.appendChild(o)});}
  const fRider=document.getElementById('fRider');
  if(fRider.options.length<2){const none=document.createElement('option');none.value='';none.textContent='— select rider —';fRider.appendChild(none);RIDERS.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;fRider.appendChild(o)});}
  if(!fuelListenerHooked){
    fuelListenerHooked=true;
    document.getElementById('fFuel').addEventListener('change',calcLiters);
  }
}

function orderDateToInput(o){
  if(!o.date) return new Date().toISOString().split('T')[0];
  if(String(o.date).includes('/')){
    const parts=o.date.split('/');
    if(parts.length===3) return `${parts[2]}-${String(parts[0]).padStart(2,'0')}-${String(parts[1]).padStart(2,'0')}`;
  }
  const d = new Date(o.date);
  if(!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
}

function openModal(){
  if(userRole === 'viewer') return;
  editId=null;
  document.getElementById('modalTitle').textContent='New Order';
  document.getElementById('fDate').value=new Date().toISOString().split('T')[0];
  ['fName','fPhone','fPrice','fLiters','fNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fStatus').value='Completed';
  document.getElementById('fRider').value='';
  document.getElementById('modalBg').classList.add('open');
}

function editOrder(id){
  if(userRole === 'viewer') return;
  const o=orders.find(x=>x.id===id);if(!o)return;
  editId=id;
  document.getElementById('modalTitle').textContent='Edit Order';
  document.getElementById('fDate').value = orderDateToInput(o);
  document.getElementById('fName').value=o.name;
  document.getElementById('fPhone').value=o.phone;
  document.getElementById('fZone').value=o.zone;
  document.getElementById('fTruck').value=o.truck;
  document.getElementById('fRider').value=o.rider||'';
  document.getElementById('fFuel').value=o.fuel;
  document.getElementById('fPrice').value=o.price;
  document.getElementById('fLiters').value=o.liters;
  document.getElementById('fStatus').value=o.status;
  document.getElementById('fNotes').value=o.notes;
  document.getElementById('modalBg').classList.add('open');
}

function closeModal(){document.getElementById('modalBg').classList.remove('open')}

async function saveOrderErrorHint(res){
  if(res.status === 401){
    showToast('Session expired — please sign in again.', 'error');
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    authToken = null;
    showLogin();
    return;
  }
  if(res.status === 403){
    showToast('View-only account cannot save. Use an editor login.', 'error');
    return;
  }
  if(res.status === 429){
    showToast('Too many requests — wait a minute and try again.', 'error');
    return;
  }
  let msg = res.statusText || 'Request failed';
  try{
    const j = await res.json();
    if(j.error) msg = j.error;
  } catch(e){}
  showToast('Could not save: ' + msg, 'error', 6000);
}

async function saveOrder(){
  if(userRole === 'viewer'){
    showToast('View-only — use an editor login to save.', 'error');
    return;
  }
  const saveBtn = document.getElementById('saveOrderBtn');
  if(saveBtn){ saveBtn.disabled = true; saveBtn.dataset._t = saveBtn.textContent; saveBtn.textContent = 'Saving…'; }
  const d=document.getElementById('fDate').value || new Date().toISOString().split('T')[0];
  const parts=d.split('-');
  const y=parts[0]||new Date().getFullYear();
  const m=parts[1]||String(new Date().getMonth()+1).padStart(2,'0');
  const dd=parts[2]||String(new Date().getDate()).padStart(2,'0');
  const date=`${parseInt(m)}/${parseInt(dd)}/${y}`;
  const name=document.getElementById('fName').value.trim()||'/';
  const phone=document.getElementById('fPhone').value.trim();
  const zone=document.getElementById('fZone').value;
  const truck=document.getElementById('fTruck').value;
  const rider=document.getElementById('fRider').value;
  const fuel=document.getElementById('fFuel').value;
  const price=parseInt(document.getElementById('fPrice').value)||0;
  const manualLiters=parseFloat(document.getElementById('fLiters').value);
  const rate=fuel==='Super'?1500:1350;
  const liters=isNaN(manualLiters)?(price?parseFloat((price/rate).toFixed(2)):0):manualLiters;
  const status=document.getElementById('fStatus').value;
  const notes=document.getElementById('fNotes').value.trim();
  const orderData = {date,name,phone,zone,truck,rider,fuel,price,liters,status,notes};
  let success = false;
  if(editId){
    try{
      const res = await apiFetch(`/orders/${editId}`, {
        method: 'PUT',
        body: JSON.stringify(orderData)
      });
      if(res.ok){
        success = true;
        const idx = orders.findIndex(o => o.id === editId);
        orders[idx] = {id: editId, ...orderData};
        serverMode = true;
        startSharedPolling();
      } else if(authRequired || serverMode){
        await saveOrderErrorHint(res);
        if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = saveBtn.dataset._t || 'Save Order'; }
        return;
      }
    } catch(e){
      if(authRequired || serverMode){
        showToast('Network error — could not reach the server.', 'error');
        if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = saveBtn.dataset._t || 'Save Order'; }
        return;
      }
    }
    if(!success){
      const idx = orders.findIndex(o => o.id === editId);
      orders[idx] = {id: editId, ...orderData};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({orders, nextId}));
    }
  } else {
    try{
      const res = await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify(orderData)
      });
      if(res.ok){
        const {id} = await res.json();
        orderData.id = id;
        orders.push(orderData);
        nextId = Math.max(nextId, id + 1);
        success = true;
        serverMode = true;
        startSharedPolling();
      } else if(authRequired || serverMode){
        await saveOrderErrorHint(res);
        if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = saveBtn.dataset._t || 'Save Order'; }
        return;
      }
    } catch(e){
      if(authRequired || serverMode){
        showToast('Network error — could not reach the server.', 'error');
        if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = saveBtn.dataset._t || 'Save Order'; }
        return;
      }
    }
    if(!success){
      orderData.id = nextId++;
      orders.push(orderData);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({orders, nextId}));
    }
  }
  if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = saveBtn.dataset._t || 'Save Order'; }
  page=1;
  closeModal();
  render();
  renderReports();
  persistData();
  if(success) showToast(editId ? 'Order updated' : 'Order saved', 'success');
  else if(!success && !authRequired && !serverMode) showToast('Saved locally (server unreachable)', 'info', 5000);
}

async function deleteOrder(id){
  if(!confirm('Delete this order?'))return;
  let success = false;
  try{
    const res = await apiFetch(`/orders/${id}`, {method: 'DELETE'});
    if(res.ok){
      success = true;
      orders = orders.filter(o => o.id !== id);
      serverMode = true;
      startSharedPolling();
    }
  } catch(e){}
  if(!success){
    // Fallback to localStorage
    orders = orders.filter(o => o.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({orders, nextId}));
  }
  render();
  renderReports(); // Update reports after deletion
}

function exportCSV(){
  const list = filtered();
  const header='Date,Customer,Phone,Zone,Truck,Rider,Fuel,Price,Liters,Status,Notes';
  const rows=list.map(o=>[o.date,`"${o.name.replace(/"/g,'""')}"`,o.phone,`"${o.zone.replace(/"/g,'""')}"`,o.truck,`"${(o.rider||'').replace(/"/g,'""')}"`,o.fuel,o.price,o.liters,o.status,`"${(o.notes||'').replace(/"/g,'""')}"`].join(','));
  const csv=header+'\n'+rows.join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='fuel_orders.csv';
  a.click();
}

function getReportOrders(){
  const {from,to}=getDateRange();
  return orders.filter(o=>{
    const d=parseDate(o.date);
    return d>=from && d<to;
  });
}

function exportReportCSV(){
  const list = getReportOrders();
  const header='Date,Customer,Phone,Zone,Truck,Rider,Fuel,Price,Liters,Status,Notes';
  const rows=list.map(o=>[o.date,`"${o.name.replace(/"/g,'""')}"`,o.phone,`"${o.zone.replace(/"/g,'""')}"`,o.truck,`"${(o.rider||'').replace(/"/g,'""')}"`,o.fuel,o.price,o.liters,o.status,`"${(o.notes||'').replace(/"/g,'""')}"`].join(','));
  const csv=header+'\n'+rows.join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='report_orders.csv';
  a.click();
}

function clearFilters(){
  document.getElementById('search').value='';
  const df = document.getElementById('filterDateFrom');
  const dt = document.getElementById('filterDateTo');
  if(df) df.value = '';
  if(dt) dt.value = '';
  document.getElementById('filterZone').value='';
  document.getElementById('filterFuel').value='';
  document.getElementById('filterStatus').value='';
  document.getElementById('filterRider').value='';
  render();
}

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadAudit(){
  const body = document.getElementById('auditBody');
  if(!body) return;
  body.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
  try{
    const res = await apiFetch('/api/audit?limit=200');
    if(!res.ok) throw new Error();
    const rows = await res.json();
    body.innerHTML = rows.length ? rows.map(r=>{
      const ts = r.ts != null ? (typeof r.ts === 'string' ? r.ts : new Date(r.ts).toISOString()) : '';
      const detail = r.detail != null ? (typeof r.detail === 'object' ? JSON.stringify(r.detail) : String(r.detail)) : '';
      return `<tr><td>${escapeHtml(ts)}</td><td>${escapeHtml(r.role||'')}</td><td>${escapeHtml(r.action||'')}</td><td>${r.orderId!=null?r.orderId:''}</td><td>${escapeHtml(detail)}</td></tr>`;
    }).join('') : '<tr><td colspan="5">No entries yet.</td></tr>';
  } catch(e){
    body.innerHTML = '<tr><td colspan="5">Could not load audit log.</td></tr>';
  }
}

async function resetSystem(){
  if(userRole === 'viewer') return;
  if(!confirm('Reset system and delete all saved orders?')) return;
  let success = false;
  try{
    const res = await apiFetch('/api/orders/reset-all', { method: 'POST' });
    if(res.ok){
      success = true;
      orders = [];
      nextId = 1;
    }
  } catch(e){}
  if(!success && !authRequired){
    try{
      const allOrders = [...orders];
      for(const o of allOrders){
        const res = await apiFetch(`/orders/${o.id}`, {method: 'DELETE'});
        if(!res.ok) throw new Error();
      }
      orders = [];
      nextId = 1;
      success = true;
    } catch(e){
      orders = [];
      nextId = 1;
      localStorage.removeItem(STORAGE_KEY);
    }
  } else if(!success){
    showToast('Could not reset orders.', 'error');
    return;
  }
  populateFilters();
  render();
  renderReports();
  if(success) showToast('All orders cleared', 'success');
}

loadTheme();
boot();