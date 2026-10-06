const cfg = window.APP_CONFIG || {};
const money = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const dateBR = v => v ? new Date(String(v).slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR') : '';
const todayISO = () => new Date().toISOString().slice(0,10);
const monthISO = () => new Date().toISOString().slice(0,7);
const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];
const el = id => document.getElementById(id);
const escapeHtml = s => String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

let supabase = null;
let currentUser = null;
let currentProfile = null;
let currentView = 'dashboard';
let modalContext = null;
const state = {patients:[],agenda:[],applications:[],receivables:[],expenses:[],stock:[],reminders:[],stockMovements:[],users:[]};

const viewMeta = {
  dashboard:['Painel','Acompanhe os atendimentos e pendências de hoje.','+ Novo paciente','patient'],
  agenda:['Agenda','Consultas, retornos e aplicações.','+ Novo agendamento','appointment'],
  patients:['Pacientes','Cadastro e ficha dos pacientes.','+ Novo paciente','patient'],
  applications:['Aplicações','Histórico de medicação, dose e cobrança.','+ Nova aplicação','application'],
  finance:['Financeiro','Resumo de entradas, despesas e saldo.','+ Nova aplicação','application'],
  receivables:['A Receber','Controle de valores pendentes e pagos.','+ Novo a receber','receivable'],
  expenses:['Despesas','Saídas e comprovantes.','+ Nova despesa','expense'],
  stock:['Estoque','Medicamentos, materiais, lotes e validades.','+ Novo item','stock'],
  reminders:['Lembretes','Tarefas internas, prioridades e pendências.','+ Novo lembrete','reminder'],
  reports:['Relatórios','Fechamento mensal para impressão/PDF.','Gerar PDF','print'],
  users:['Usuários','Gerencie os acessos individuais da equipe.','+ Novo usuário','user']
};

boot();

async function boot(){
  el('clinicName').textContent = cfg.CLINIC_NAME || 'Gestão Clínica';
  setDefaultMonths();
  bindEvents();
  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY){ showOnly('setupScreen'); return; }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data:{session}} = await supabase.auth.getSession();
  if(session){ await enterApp(session.user); } else { showOnly('loginScreen'); await refreshBootstrapState(); }
  supabase.auth.onAuthStateChange(async (_evt,session)=>{ if(!session){ currentUser=null; showOnly('loginScreen'); } });
}

function showOnly(id){ ['setupScreen','loginScreen','app'].forEach(x=>el(x).classList.add('hidden')); el(id).classList.remove('hidden'); }
function setDefaultMonths(){ ['agendaMonth','appMonth','expenseMonth','reportMonth'].forEach(id=>{ if(el(id)) el(id).value=monthISO(); }); }
function bindEvents(){
  el('loginForm').addEventListener('submit',login);
  el('bootstrapBtn').addEventListener('click',bootstrapFirstUser);
  el('logoutBtn').addEventListener('click',logout);
  el('refreshBtn').addEventListener('click',()=>loadAll(true));
  el('topAction').addEventListener('click',()=>handleAction(viewMeta[currentView][3]));
  el('printReportBtn').addEventListener('click',()=>window.print());
  el('newUserBtn')?.addEventListener('click',()=>openUserForm());
  el('nav').addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(b)switchView(b.dataset.view)});
  document.addEventListener('click',e=>{ const b=e.target.closest('[data-view-go]'); if(b) switchView(b.dataset.viewGo); const q=e.target.closest('[data-quick]'); if(q) handleAction(q.dataset.quick); if(e.target.closest('[data-close="modal"]')) closeModal(); });
  el('modalForm').addEventListener('submit',saveModal);
  [['patientSearch','patients'],['agendaSearch','agenda'],['applicationSearch','applications'],['receivableSearch','receivables'],['expenseSearch','expenses'],['stockSearch','stock'],['reminderSearch','reminders']].forEach(([id,v])=>el(id).addEventListener('input',()=>render(v)));
  ['agendaMonth','appMonth','expenseMonth','reportMonth','receivableStatus','stockFilter','reminderStatus'].forEach(id=>el(id).addEventListener('change',()=>render(id==='reportMonth'?'reports':currentView)));
}

async function refreshBootstrapState(){
  try{
    const {data,error}=await supabase.rpc('bootstrap_available');
    if(error) throw error;
    const available=data===true;
    el('bootstrapBtn').classList.toggle('hidden',!available);
    el('loginHint').textContent=available?'Primeiro acesso: informe o e-mail e uma senha com pelo menos 8 caracteres e clique em “Criar primeiro acesso”.':'Acesso restrito à equipe da clínica.';
  }catch(_e){
    el('bootstrapBtn').classList.add('hidden');
  }
}

async function bootstrapFirstUser(){
  const email=el('loginEmail').value.trim();
  const password=el('loginPassword').value;
  el('loginError').classList.add('hidden');
  if(!email || password.length<8){
    el('loginError').textContent='Informe um e-mail válido e uma senha com pelo menos 8 caracteres.';
    el('loginError').classList.remove('hidden');
    return;
  }
  const btn=el('bootstrapBtn'); btn.disabled=true;
  try{
    const {data:available,error:checkError}=await supabase.rpc('bootstrap_available');
    if(checkError) throw checkError;
    if(!available) throw new Error('O primeiro acesso já foi criado.');
    const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:'Glaucia'},emailRedirectTo:window.location.origin+'/'}});
    if(error) throw error;
    if(data.session && data.user){
      await enterApp(data.user);
      toast('Primeiro acesso criado com sucesso.');
    }else{
      el('loginError').textContent='Conta criada. Confira o e-mail para confirmar o cadastro e depois entre no sistema.';
      el('loginError').classList.remove('hidden');
      await refreshBootstrapState();
    }
  }catch(err){
    el('loginError').textContent=err?.message||'Não foi possível criar o primeiro acesso.';
    el('loginError').classList.remove('hidden');
  }finally{ btn.disabled=false; }
}

async function login(e){
  e.preventDefault(); const btn=el('loginBtn'); btn.disabled=true; el('loginError').classList.add('hidden');
  const {data,error}=await supabase.auth.signInWithPassword({email:el('loginEmail').value.trim(),password:el('loginPassword').value});
  btn.disabled=false;
  if(error){ el('loginError').textContent='Não foi possível entrar. Confira o e-mail e a senha.';el('loginError').classList.remove('hidden');return; }
  await enterApp(data.user);
}
async function logout(){ await supabase.auth.signOut(); showOnly('loginScreen'); await refreshBootstrapState(); }
async function enterApp(user){
  currentUser=user;
  const {data}=await supabase.from('profiles').select('*').eq('id',user.id).maybeSingle(); currentProfile=data||{full_name:user.email,role:'staff',active:true};
  if(currentProfile.active===false){ await supabase.auth.signOut(); toast('Usuário sem acesso ao sistema.',true); return; }
  el('userName').textContent=currentProfile.full_name||user.email; el('userRole').textContent=(currentProfile.role||'Equipe').toUpperCase(); el('userAvatar').textContent=(currentProfile.full_name||user.email||'G')[0].toUpperCase();
  el('usersNavBtn')?.classList.toggle('hidden',currentProfile.role!=='admin');
  showOnly('app'); await loadAll();
}

async function loadAll(showToast=false){
  const tables=['patients','appointments','applications','receivables','expenses','stock_items','team_reminders','stock_movements'];
  const keys=['patients','agenda','applications','receivables','expenses','stock','reminders','stockMovements'];
  const results=await Promise.all(tables.map(t=>supabase.from(t).select('*').order('created_at',{ascending:false})));
  const err=results.find(r=>r.error)?.error; if(err){toast('Erro ao carregar dados: '+err.message,true);return;}
  results.forEach((r,i)=>state[keys[i]]=r.data||[]);
  if(currentProfile?.role==='admin') await loadUsers();
  renderAll(); if(showToast) toast('Dados atualizados.');
}

function switchView(v){
  if(v==='users' && currentProfile?.role!=='admin') return toast('Somente administradores podem gerenciar usuários.',true);
  currentView=v; qsa('.view').forEach(x=>x.classList.remove('active')); el('view-'+v).classList.add('active'); qsa('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  const m=viewMeta[v]; el('pageTitle').textContent=m[0]; el('pageSubtitle').textContent=m[1]; el('pageEyebrow').textContent=v==='dashboard'?'VISÃO GERAL':'GESTÃO CLÍNICA'; el('topAction').textContent=m[2]; render(v);
}
function renderAll(){ Object.keys(viewMeta).forEach(render); }
function render(v){({dashboard:renderDashboard,agenda:renderAgenda,patients:renderPatients,applications:renderApplications,finance:renderFinance,receivables:renderReceivables,expenses:renderExpenses,stock:renderStock,reminders:renderReminders,reports:renderReports,users:renderUsers})[v]?.();}

function renderDashboard(){
  const today=todayISO(), month=monthISO();
  const pending=state.receivables.filter(r=>r.status!=='PAGO').reduce((s,r)=>s+Number(r.amount||0),0);
  const income=state.receivables.filter(r=>r.status==='PAGO' && String(r.paid_at||r.due_date||'').slice(0,7)===month).reduce((s,r)=>s+Number(r.amount||0),0);
  const exp=state.expenses.filter(r=>String(r.date||'').slice(0,7)===month).reduce((s,r)=>s+Number(r.amount||0),0);
  el('mPatients').textContent=state.patients.filter(x=>x.active!==false).length; el('mToday').textContent=state.agenda.filter(x=>x.date===today).length; el('mPending').textContent=money(pending); el('mBalance').textContent=money(income-exp);
  const first=(currentProfile?.full_name||'').trim().split(/\s+/)[0]||'Olá'; el('greeting').textContent=`Olá, ${first}!`; el('todayLabel').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const todays=state.agenda.filter(x=>x.date===today).sort((a,b)=>String(a.time).localeCompare(String(b.time))).slice(0,7);
  el('todayAppointments').innerHTML=todays.length?todays.map(a=>`<div class="list-item"><div><strong>${escapeHtml(a.patient_name||'Paciente')}</strong><small>${escapeHtml(a.time||'')} • ${escapeHtml(a.type||'Atendimento')} • ${escapeHtml(a.professional||'')}</small></div>${badge(a.status)}</div>`).join(''):'<div class="empty">Nenhum atendimento hoje.</div>';
  const rem=state.reminders.filter(r=>r.status!=='CONCLUÍDO').sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999'))).slice(0,6);
  el('homeReminders').innerHTML=rem.length?rem.map(r=>`<div class="list-item"><div><strong>${escapeHtml(r.title)}</strong><small>${dateBR(r.date)}${r.responsible?' • '+escapeHtml(r.responsible):''}</small></div>${badge(r.priority||'NORMAL')}</div>`).join(''):'<div class="empty">Sem pendências abertas.</div>';
}
function renderPatients(){ const q=el('patientSearch').value.toLowerCase(); const rows=state.patients.filter(p=>[p.name,p.phone,p.cpf].join(' ').toLowerCase().includes(q)); el('patientRows').innerHTML=rows.length?rows.map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.phone||'')}</td><td>${escapeHtml(p.cpf||'')}</td><td>${escapeHtml(p.billing_type||'')}</td><td title="${escapeHtml(p.notes||'')}">${escapeHtml((p.notes||'').slice(0,45))}</td><td class="row-actions"><button class="mini-btn" onclick="window.appEdit('patient','${p.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('patients','${p.id}','${escapeHtml(p.name)}')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum paciente encontrado.</td></tr>'; }
function renderAgenda(){
  const month=el('agendaMonth').value||monthISO(), q=el('agendaSearch').value.toLowerCase(); const rows=state.agenda.filter(a=>String(a.date||'').startsWith(month)&&[a.patient_name,a.professional,a.type].join(' ').toLowerCase().includes(q)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  el('agendaRows').innerHTML=rows.length?rows.map(a=>`<tr><td>${dateBR(a.date)}</td><td>${escapeHtml(a.time||'')}</td><td><strong>${escapeHtml(a.patient_name||'')}</strong></td><td>${escapeHtml(a.type||'')}</td><td>${escapeHtml(a.professional||'')}</td><td>${badge(a.status)}</td><td class="row-actions"><button class="mini-btn" onclick="window.appEdit('appointment','${a.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('appointments','${a.id}','agendamento')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum agendamento no período.</td></tr>';
  renderCalendar(month,rows);
}
function renderCalendar(month,rows){ const [y,m]=month.split('-').map(Number), first=new Date(y,m-1,1), start=new Date(y,m-1,1-first.getDay()), cells=[]; for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const iso=d.toISOString().slice(0,10);const dayRows=rows.filter(a=>a.date===iso).slice(0,3);cells.push(`<div class="cal-day ${d.getMonth()!==m-1?'other':''} ${iso===todayISO()?'today':''}"><div class="cal-num">${d.getDate()}</div>${dayRows.map(a=>`<span class="cal-chip">${escapeHtml(a.time||'')} ${escapeHtml(a.patient_name||'')}</span>`).join('')}</div>`)} el('agendaCalendar').innerHTML=`<div class="cal-head">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(x=>`<div>${x}</div>`).join('')}</div><div class="cal-grid">${cells.join('')}</div>`; }
function renderApplications(){ const month=el('appMonth').value||monthISO(),q=el('applicationSearch').value.toLowerCase(); const rows=state.applications.filter(a=>String(a.date||'').startsWith(month)&&[a.patient_name,a.medication].join(' ').toLowerCase().includes(q)); el('applicationRows').innerHTML=rows.length?rows.map(a=>`<tr><td>${dateBR(a.date)}</td><td><strong>${escapeHtml(a.patient_name||'')}</strong></td><td>${escapeHtml(a.medication||'')}</td><td>${escapeHtml(a.dose||'')}</td><td>${money(a.amount)}</td><td>${badge(a.payment_status||'PENDENTE')}</td><td class="row-actions"><button class="mini-btn" onclick="window.appEdit('application','${a.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('applications','${a.id}','aplicação')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhuma aplicação no período.</td></tr>'; }
function renderReceivables(){ const q=el('receivableSearch').value.toLowerCase(),st=el('receivableStatus').value; const rows=state.receivables.filter(r=>(!st||r.status===st)&&[r.patient_name,r.description].join(' ').toLowerCase().includes(q)).sort((a,b)=>String(a.due_date||'').localeCompare(String(b.due_date||''))); el('receivableRows').innerHTML=rows.length?rows.map(r=>`<tr><td>${dateBR(r.due_date)}</td><td><strong>${escapeHtml(r.patient_name||'')}</strong></td><td>${escapeHtml(r.description||'')}</td><td>${money(r.amount)}</td><td>${badge(r.status)}</td><td>${escapeHtml(r.payment_method||'')}</td><td class="row-actions">${r.status!=='PAGO'?`<button class="mini-btn" onclick="window.markPaid('${r.id}')">Marcar pago</button>`:''}<button class="mini-btn" onclick="window.appEdit('receivable','${r.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('receivables','${r.id}','recebimento')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum valor encontrado.</td></tr>'; }
function renderExpenses(){ const month=el('expenseMonth').value||monthISO(),q=el('expenseSearch').value.toLowerCase(); const rows=state.expenses.filter(r=>String(r.date||'').startsWith(month)&&[r.category,r.description].join(' ').toLowerCase().includes(q)); el('expenseRows').innerHTML=rows.length?rows.map(r=>`<tr><td>${dateBR(r.date)}</td><td>${escapeHtml(r.category||'')}</td><td><strong>${escapeHtml(r.description||'')}</strong></td><td>${money(r.amount)}</td><td>${escapeHtml(r.payment_method||'')}</td><td class="row-actions"><button class="mini-btn" onclick="window.appEdit('expense','${r.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('expenses','${r.id}','despesa')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhuma despesa no período.</td></tr>'; }
function renderStock(){ const q=el('stockSearch').value.toLowerCase(),f=el('stockFilter').value, now=new Date(), in60=new Date(Date.now()+60*864e5); const rows=state.stock.filter(s=>[s.name,s.category,s.lot].join(' ').toLowerCase().includes(q)).filter(s=>f!=='low'||Number(s.current_qty)<=Number(s.minimum_qty||0)).filter(s=>f!=='expiring'||(s.expiry_date&&new Date(s.expiry_date)<=in60)); el('stockRows').innerHTML=rows.length?rows.map(s=>`<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.category||'')}</td><td>${Number(s.current_qty||0)} ${escapeHtml(s.unit||'')}</td><td>${Number(s.minimum_qty||0)}</td><td>${escapeHtml(s.lot||'')}</td><td>${s.expiry_date?dateBR(s.expiry_date):''}</td><td class="row-actions"><button class="mini-btn" onclick="window.stockMove('${s.id}')">Movimentar</button><button class="mini-btn" onclick="window.appEdit('stock','${s.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('stock_items','${s.id}','item')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum item encontrado.</td></tr>'; }
function renderReminders(){ const q=el('reminderSearch').value.toLowerCase(),st=el('reminderStatus').value; const rows=state.reminders.filter(r=>(!st||r.status===st)&&[r.title,r.description,r.responsible].join(' ').toLowerCase().includes(q)); el('reminderCards').innerHTML=rows.length?rows.map(r=>`<article class="reminder-card ${r.status!=='CONCLUÍDO'&&r.date&&r.date<todayISO()?'overdue':''}">${badge(r.priority||'NORMAL')}<h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(r.description||'')}</p><div class="reminder-foot"><span>${dateBR(r.date)} ${escapeHtml(r.time||'')}</span><span>${escapeHtml(r.responsible||'')}</span></div><div class="row-actions">${r.status!=='CONCLUÍDO'?`<button class="mini-btn" onclick="window.completeReminder('${r.id}')">Concluir</button>`:''}<button class="mini-btn" onclick="window.appEdit('reminder','${r.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('team_reminders','${r.id}','lembrete')">Excluir</button></div></article>`).join(''):'<div class="empty">Nenhum lembrete encontrado.</div>'; }
function renderFinance(){ const month=monthISO(), paid=state.receivables.filter(r=>r.status==='PAGO'&&String(r.paid_at||r.due_date||'').slice(0,7)===month), exp=state.expenses.filter(r=>String(r.date||'').slice(0,7)===month), pending=state.receivables.filter(r=>r.status!=='PAGO'); const income=paid.reduce((s,r)=>s+Number(r.amount||0),0), expenses=exp.reduce((s,r)=>s+Number(r.amount||0),0); el('fIncome').textContent=money(income);el('fExpenses').textContent=money(expenses);el('fBalance').textContent=money(income-expenses);el('fPending').textContent=money(pending.reduce((s,r)=>s+Number(r.amount||0),0)); el('financeIncomeList').innerHTML=paid.slice(0,6).map(r=>`<div class="list-item"><div><strong>${escapeHtml(r.patient_name||r.description||'Recebimento')}</strong><small>${dateBR(r.paid_at||r.due_date)}</small></div><strong>${money(r.amount)}</strong></div>`).join('')||'<div class="empty">Sem recebimentos no mês.</div>'; el('financeExpenseList').innerHTML=exp.slice(0,6).map(r=>`<div class="list-item"><div><strong>${escapeHtml(r.description||r.category||'Despesa')}</strong><small>${dateBR(r.date)}</small></div><strong>${money(r.amount)}</strong></div>`).join('')||'<div class="empty">Sem despesas no mês.</div>'; }
function renderReports(){ const month=el('reportMonth').value||monthISO(), paid=state.receivables.filter(r=>r.status==='PAGO'&&String(r.paid_at||r.due_date||'').slice(0,7)===month), exp=state.expenses.filter(r=>String(r.date||'').startsWith(month)), apps=state.applications.filter(a=>String(a.date||'').startsWith(month)), pending=state.receivables.filter(r=>r.status!=='PAGO'); const income=paid.reduce((s,r)=>s+Number(r.amount||0),0), expenses=exp.reduce((s,r)=>s+Number(r.amount||0),0); el('reportPeriod').textContent=new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});el('rIncome').textContent=money(income);el('rExpenses').textContent=money(expenses);el('rBalance').textContent=money(income-expenses);el('rPending').textContent=money(pending.reduce((s,r)=>s+Number(r.amount||0),0)); el('reportApps').innerHTML=`<div class="list-item"><div><strong>Total de aplicações</strong></div><strong>${apps.length}</strong></div><div class="list-item"><div><strong>Valor registrado</strong></div><strong>${money(apps.reduce((s,a)=>s+Number(a.amount||0),0))}</strong></div>`; el('reportFinance').innerHTML=`<div class="list-item"><div><strong>Recebimentos pagos</strong></div><strong>${paid.length}</strong></div><div class="list-item"><div><strong>Despesas registradas</strong></div><strong>${exp.length}</strong></div>`; }

async function callAdminUsers(body){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session) throw new Error('Sua sessão expirou. Entre novamente.');
  const res=await fetch(cfg.SUPABASE_URL+'/functions/v1/admin-users',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':cfg.SUPABASE_ANON_KEY},
    body:JSON.stringify(body)
  });
  const json=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(json.error||'Não foi possível gerenciar os usuários.');
  return json;
}
async function loadUsers(){
  if(currentProfile?.role!=='admin') return;
  try{ const data=await callAdminUsers({action:'list'}); state.users=data.users||[]; renderUsers(); }
  catch(err){ if(currentView==='users') toast(err.message,true); }
}
function renderUsers(){
  if(!el('userRows')) return;
  if(currentProfile?.role!=='admin'){el('userRows').innerHTML='';return;}
  const rows=state.users||[];
  el('userRows').innerHTML=rows.length?rows.map(u=>`<tr>
    <td><strong>${escapeHtml(u.full_name||'')}</strong></td>
    <td>${escapeHtml(u.email||'')}</td>
    <td>${badge(u.role==='admin'?'ADMIN':'EQUIPE')}</td>
    <td>${badge(u.active?'ATIVO':'BLOQUEADO')}</td>
    <td>${u.last_sign_in_at?new Date(u.last_sign_in_at).toLocaleString('pt-BR'):'Nunca'}</td>
    <td class="row-actions"><button class="mini-btn" onclick="window.editUser('${u.id}')">Editar</button></td>
  </tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum usuário cadastrado.</td></tr>';
}
function openUserForm(id=null){
  if(currentProfile?.role!=='admin') return toast('Somente administradores podem gerenciar usuários.',true);
  const u=id?state.users.find(x=>x.id===id):null;
  modalContext={type:'user',id,record:u||{}};
  el('modalEyebrow').textContent='ACESSO';
  el('modalTitle').textContent=id?'Editar usuário':'Novo usuário';
  el('modalBody').innerHTML=
    field('full_name','Nome completo','text',u?.full_name||'','span2')+
    (id?field('email','E-mail','email',u?.email||'','span2').replace('<input ','<input disabled '):field('email','E-mail','email','','span2'))+
    field('role','Perfil','select',`<option value="staff" ${u?.role!=='admin'?'selected':''}>EQUIPE</option><option value="admin" ${u?.role==='admin'?'selected':''}>ADMINISTRADOR</option>`)+
    field('active','Acesso','select',`<option value="true" ${u?.active!==false?'selected':''}>ATIVO</option><option value="false" ${u?.active===false?'selected':''}>BLOQUEADO</option>`)+
    field('password',id?'Nova senha (opcional)':'Senha inicial','password','','span2');
  el('modal').classList.remove('hidden'); el('modal').setAttribute('aria-hidden','false');
}
window.editUser=id=>openUserForm(id);
function badge(v){ const t=String(v||'').toUpperCase(); const cls=/PAGO|FINALIZADO|CONCLUÍDO|ATENDIDO|BAIXA/.test(t)?'ok':/CANCELADO|ATRASADO|ALTA/.test(t)?'danger':'warn'; return `<span class="badge ${cls}">${escapeHtml(v||'')}</span>`; }
function toast(msg,error=false){ const t=el('toast');t.textContent=msg;t.className='toast'+(error?' error':'');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),3200); }
function patientOptions(selected=''){ return `<option value="">Selecione</option>`+state.patients.filter(p=>p.active!==false).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${escapeHtml(p.name)}</option>`).join(''); }
function field(name,label,type='text',value='',opts=''){ if(type==='textarea')return `<div class="field ${opts}"><label>${label}</label><textarea name="${name}">${escapeHtml(value)}</textarea></div>`; if(type==='select')return `<div class="field ${opts}"><label>${label}</label><select name="${name}">${value}</select></div>`; return `<div class="field ${opts}"><label>${label}</label><input name="${name}" type="${type}" value="${escapeHtml(value)}" /></div>`; }

function handleAction(type){ if(type==='print'){window.print();return;} if(type==='user'){openUserForm();return;} openForm(type); }
function openForm(type,id=null){
  const map={patient:['Paciente','patient'],appointment:['Agendamento','appointment'],application:['Aplicação','application'],receivable:['Valor a receber','receivable'],expense:['Despesa','expense'],stock:['Item de estoque','stock'],reminder:['Lembrete','reminder'],stockMove:['Movimentação de estoque','stockMove']};
  const [title]=map[type]||['Registro']; const record=id?getRecord(type,id):{}; modalContext={type,id,record}; el('modalTitle').textContent=(id?'Editar ':'Novo ')+title.toLowerCase(); el('modalBody').innerHTML=formHtml(type,record); el('modal').classList.remove('hidden'); el('modal').setAttribute('aria-hidden','false');
}
function getRecord(type,id){ const m={patient:'patients',appointment:'agenda',application:'applications',receivable:'receivables',expense:'expenses',stock:'stock',reminder:'reminders'}; return state[m[type]]?.find(x=>x.id===id)||{}; }
function formHtml(type,r){
  if(type==='patient') return field('name','Nome','text',r.name,'span2')+field('phone','Telefone','text',r.phone)+field('birth_date','Data de nascimento','date',r.birth_date)+field('cpf','CPF','text',r.cpf)+field('email','E-mail','email',r.email)+field('billing_type','Tipo de cobrança','select',`<option ${r.billing_type==='PARTICULAR'?'selected':''}>PARTICULAR</option><option ${r.billing_type==='MENSAL'?'selected':''}>MENSAL</option>`)+field('billing_day','Dia de vencimento','number',r.billing_day)+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='appointment') return field('patient_id','Paciente','select',patientOptions(r.patient_id),'span2')+field('date','Data','date',r.date||todayISO())+field('time','Hora','time',r.time)+field('type','Tipo','text',r.type||'Consulta')+field('professional','Profissional','text',r.professional)+field('status','Status','select',`<option ${r.status==='AGENDADO'?'selected':''}>AGENDADO</option><option ${r.status==='CONFIRMADO'?'selected':''}>CONFIRMADO</option><option ${r.status==='ATENDIDO'?'selected':''}>ATENDIDO</option><option ${r.status==='CANCELADO'?'selected':''}>CANCELADO</option>`)+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='application') return field('patient_id','Paciente','select',patientOptions(r.patient_id),'span2')+field('date','Data','date',r.date||todayISO())+field('medication','Medicação','text',r.medication)+field('dose','Dose','text',r.dose)+field('amount','Valor','number',r.amount)+field('billing','Cobrança','select',`<option ${r.billing==='AVULSA'?'selected':''}>AVULSA</option><option ${r.billing==='MENSAL'?'selected':''}>MENSAL</option>`)+field('payment_status','Status do pagamento','select',`<option ${r.payment_status==='PENDENTE'?'selected':''}>PENDENTE</option><option ${r.payment_status==='PAGO'?'selected':''}>PAGO</option>`)+field('payment_method','Forma de pagamento','text',r.payment_method)+field('due_date','Vencimento','date',r.due_date)+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='receivable') return field('patient_id','Paciente','select',patientOptions(r.patient_id),'span2')+field('description','Descrição','text',r.description,'span2')+field('due_date','Vencimento','date',r.due_date||todayISO())+field('amount','Valor','number',r.amount)+field('status','Status','select',`<option ${r.status==='PENDENTE'?'selected':''}>PENDENTE</option><option ${r.status==='PAGO'?'selected':''}>PAGO</option>`)+field('payment_method','Forma de pagamento','text',r.payment_method)+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='expense') return field('date','Data','date',r.date||todayISO())+field('category','Categoria','text',r.category)+field('description','Descrição','text',r.description,'span2')+field('amount','Valor','number',r.amount)+field('payment_method','Forma de pagamento','text',r.payment_method)+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='stock') return field('name','Item','text',r.name,'span2')+field('category','Categoria','text',r.category)+field('unit','Unidade','text',r.unit||'un')+field('current_qty','Quantidade atual','number',r.current_qty)+field('minimum_qty','Estoque mínimo','number',r.minimum_qty)+field('lot','Lote','text',r.lot)+field('expiry_date','Validade','date',r.expiry_date)+field('unit_cost','Custo unitário','number',r.unit_cost);
  if(type==='reminder') return field('title','Título','text',r.title,'span2')+field('date','Data','date',r.date||todayISO())+field('time','Hora','time',r.time)+field('priority','Prioridade','select',`<option ${r.priority==='BAIXA'?'selected':''}>BAIXA</option><option ${!r.priority||r.priority==='NORMAL'?'selected':''}>NORMAL</option><option ${r.priority==='ALTA'?'selected':''}>ALTA</option>`)+field('responsible','Responsável','text',r.responsible)+field('status','Status','select',`<option ${!r.status||r.status==='ABERTO'?'selected':''}>ABERTO</option><option ${r.status==='CONCLUÍDO'?'selected':''}>CONCLUÍDO</option>`)+field('description','Descrição','textarea',r.description,'span2');
  if(type==='stockMove') return field('stock_id','Item','select',`<option value="${r.id}" selected>${escapeHtml(r.name)}</option>`,'span2')+field('movement_type','Tipo','select','<option>ENTRADA</option><option>SAÍDA</option>')+field('quantity','Quantidade','number','1')+field('notes','Observações','textarea','','span2');
  return '';
}
function closeModal(){ el('modal').classList.add('hidden'); modalContext=null; }
async function saveModal(e){
  e.preventDefault(); const fd=new FormData(e.target), raw=Object.fromEntries(fd.entries()), {type,id,record}=modalContext; const save=el('modalSave'); save.disabled=true;
  try{
    if(type==='user'){
      const payload={action:id?'update':'create',id:id||undefined,full_name:raw.full_name,email:raw.email,role:raw.role,active:raw.active==='true',password:raw.password||''};
      await callAdminUsers(payload);
      closeModal(); await loadUsers(); toast(id?'Usuário atualizado.':'Novo usuário criado.');
      save.disabled=false; return;
    }
    let table,payload;
    if(type==='patient'){table='patients';payload={name:raw.name,phone:raw.phone,birth_date:raw.birth_date||null,cpf:raw.cpf,email:raw.email,billing_type:raw.billing_type,billing_day:raw.billing_day?Number(raw.billing_day):null,notes:raw.notes,active:true};}
    if(type==='appointment'){table='appointments';const p=state.patients.find(x=>x.id===raw.patient_id);payload={patient_id:raw.patient_id,patient_name:p?.name||'',date:raw.date,time:raw.time,type:raw.type,professional:raw.professional,status:raw.status,notes:raw.notes};}
    if(type==='application'){table='applications';const p=state.patients.find(x=>x.id===raw.patient_id);payload={patient_id:raw.patient_id,patient_name:p?.name||'',date:raw.date,medication:raw.medication,dose:raw.dose,amount:Number(raw.amount||0),billing:raw.billing,payment_status:raw.payment_status,payment_method:raw.payment_method,due_date:raw.due_date||null,notes:raw.notes};}
    if(type==='receivable'){table='receivables';const p=state.patients.find(x=>x.id===raw.patient_id);payload={patient_id:raw.patient_id,patient_name:p?.name||'',description:raw.description,due_date:raw.due_date,amount:Number(raw.amount||0),status:raw.status,payment_method:raw.payment_method,notes:raw.notes,paid_at:raw.status==='PAGO'?(record.paid_at||todayISO()):null};}
    if(type==='expense'){table='expenses';payload={date:raw.date,category:raw.category,description:raw.description,amount:Number(raw.amount||0),payment_method:raw.payment_method,notes:raw.notes};}
    if(type==='stock'){table='stock_items';payload={name:raw.name,category:raw.category,unit:raw.unit,current_qty:Number(raw.current_qty||0),minimum_qty:Number(raw.minimum_qty||0),lot:raw.lot,expiry_date:raw.expiry_date||null,unit_cost:Number(raw.unit_cost||0),active:true};}
    if(type==='reminder'){table='team_reminders';payload={title:raw.title,date:raw.date,time:raw.time||null,priority:raw.priority,responsible:raw.responsible,status:raw.status,description:raw.description,completed_at:raw.status==='CONCLUÍDO'?(record.completed_at||new Date().toISOString()):null};}
    if(type==='stockMove'){ await saveStockMovement(raw); save.disabled=false; return; }
    payload.updated_at=new Date().toISOString(); let res=id?await supabase.from(table).update(payload).eq('id',id):await supabase.from(table).insert(payload); if(res.error) throw res.error; await audit(id?'UPDATE':'INSERT',table,id||'',payload); closeModal(); await loadAll(); toast('Registro salvo.');
  }catch(err){toast(err.message||'Erro ao salvar.',true);}finally{save.disabled=false;}
}
async function saveStockMovement(raw){ const item=state.stock.find(x=>x.id===raw.stock_id); if(!item) throw new Error('Item não encontrado.'); const qty=Number(raw.quantity||0); if(qty<=0) throw new Error('Informe uma quantidade válida.'); const newQty=raw.movement_type==='ENTRADA'?Number(item.current_qty||0)+qty:Number(item.current_qty||0)-qty; if(newQty<0) throw new Error('A saída é maior que o estoque atual.'); const {error:e1}=await supabase.from('stock_items').update({current_qty:newQty,updated_at:new Date().toISOString()}).eq('id',item.id); if(e1) throw e1; const {error:e2}=await supabase.from('stock_movements').insert({item_id:item.id,item_name:item.name,date:todayISO(),movement_type:raw.movement_type,quantity:qty,balance_after:newQty,notes:raw.notes,user_name:currentProfile?.full_name||currentUser.email}); if(e2) throw e2; await audit('STOCK_MOVE','stock_items',item.id,{type:raw.movement_type,quantity:qty,balance_after:newQty}); closeModal(); await loadAll(); toast('Estoque atualizado.'); }
async function audit(action,module,record_id,details){ try{await supabase.from('audit_log').insert({user_id:currentUser.id,user_name:currentProfile?.full_name||currentUser.email,action,module,record_id:String(record_id||''),details});}catch(_e){} }

window.appEdit=(type,id)=>openForm(type,id);
window.stockMove=id=>{const r=state.stock.find(x=>x.id===id);modalContext=null;openForm('stockMove',null);modalContext.record=r; el('modalBody').innerHTML=formHtml('stockMove',r)};
window.appDelete=async(table,id,label)=>{ if(!confirm(`Excluir ${label}?`))return; const {error}=await supabase.from(table).delete().eq('id',id); if(error)return toast(error.message,true); await audit('DELETE',table,id,{label}); await loadAll(); toast('Registro excluído.'); };
window.markPaid=async id=>{const {error}=await supabase.from('receivables').update({status:'PAGO',paid_at:todayISO(),updated_at:new Date().toISOString()}).eq('id',id); if(error)return toast(error.message,true);await audit('MARK_PAID','receivables',id,{});await loadAll();toast('Pagamento registrado.');};
window.completeReminder=async id=>{const {error}=await supabase.from('team_reminders').update({status:'CONCLUÍDO',completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);if(error)return toast(error.message,true);await audit('COMPLETE','team_reminders',id,{});await loadAll();toast('Lembrete concluído.');};