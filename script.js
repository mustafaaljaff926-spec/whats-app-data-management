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
    const res = await fetch('/orders');
    if(!res.ok) return;
    const list = await res.json();
    applyServerOrders(list);
    populateFilters();
    render();
    if(currentTab === 'reports') renderReports();
  } catch(e){ /* keep current UI if request fails */ }
}

async function loadData(){
  try{
    const res = await fetch('/orders');
    if(res.ok){
      serverMode = true;
      applyServerOrders(await res.json());
    } else {
      throw new Error();
    }
  } catch(e){
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
        const res = await fetch('/orders', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
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
    alert('Imported '+rows.length+' rows.');
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
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.textContent.toLowerCase().includes(tab==='orders'?'order':'report')));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+tab).classList.add('active');
  if(tab==='reports') renderReports();
  else if(tab==='orders') render();
}

function filtered(){
  const s=document.getElementById('search').value.toLowerCase();
  const z=document.getElementById('filterZone').value;
  const f=document.getElementById('filterFuel').value;
  const st=document.getElementById('filterStatus').value;
  const r=document.getElementById('filterRider').value;
  return orders.filter(o=>{
    if(s&&!o.name.toLowerCase().includes(s)&&!o.phone.includes(s)) return false;
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
      <td style="display:flex;gap:4px">
        <button class="btn sm" onclick="editOrder(${o.id})">Edit</button>
        <button class="btn sm" style="color:#A32D2D" onclick="deleteOrder(${o.id})">Del</button>
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
  document.getElementById('fFuel').addEventListener('change',calcLiters);
}

function openModal(){
  editId=null;
  document.getElementById('modalTitle').textContent='New Order';
  document.getElementById('fDate').value=new Date().toISOString().split('T')[0];
  ['fName','fPhone','fPrice','fLiters','fNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fStatus').value='Completed';
  document.getElementById('fRider').value='';
  document.getElementById('modalBg').classList.add('open');
}

function editOrder(id){
  const o=orders.find(x=>x.id===id);if(!o)return;
  editId=id;
  document.getElementById('modalTitle').textContent='Edit Order';
  const parts=o.date.split('/');
  document.getElementById('fDate').value=`${parts[2]}-${String(parts[0]).padStart(2,'0')}-${String(parts[1]).padStart(2,'0')}`;
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

async function saveOrder(){
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
      const res = await fetch(`/orders/${editId}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(orderData)
      });
      if(res.ok){
        success = true;
        const idx = orders.findIndex(o => o.id === editId);
        orders[idx] = {id: editId, ...orderData};
        serverMode = true;
        startSharedPolling();
      }
    } catch(e){}
    if(!success){
      // Fallback to localStorage
      const idx = orders.findIndex(o => o.id === editId);
      orders[idx] = {id: editId, ...orderData};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({orders, nextId}));
    }
  } else {
    try{
      const res = await fetch('/orders', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
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
      }
    } catch(e){}
    if(!success){
      // Fallback to localStorage
      orderData.id = nextId++;
      orders.push(orderData);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({orders, nextId}));
    }
  }
  page=1; // Reset to first page to show new order
  closeModal();
  render();
  renderReports(); // Always update reports to ensure consistency
  persistData(); // Show save indicator
}

async function deleteOrder(id){
  if(!confirm('Delete this order?'))return;
  let success = false;
  try{
    const res = await fetch(`/orders/${id}`, {method: 'DELETE'});
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
  document.getElementById('filterZone').value='';
  document.getElementById('filterFuel').value='';
  document.getElementById('filterStatus').value='';
  document.getElementById('filterRider').value='';
  render();
}

async function resetSystem(){
  if(!confirm('Reset system and delete all saved orders?')) return;
  let success = false;
  try{
    const allOrders = [...orders];
    for(const o of allOrders){
      const res = await fetch(`/orders/${o.id}`, {method: 'DELETE'});
      if(!res.ok) throw new Error();
    }
    success = true;
  } catch(e){}
  if(success){
    orders = [];
    nextId = 1;
  } else {
    // Fallback
    orders = [];
    nextId = 1;
    localStorage.removeItem(STORAGE_KEY);
  }
  populateFilters();
  render();
  renderReports();
}

loadTheme();
loadData();