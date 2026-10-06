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
let dashboardStatusFilter = 'ALL';
let pendingProfilePhotoDataUrl = null;
const state = {patients:[],agenda:[],applications:[],receivables:[],expenses:[],stock:[],reminders:[],stockMovements:[],users:[],professionals:[],services:[],cashSessions:[],cashMovements:[]};

const viewMeta = {
  dashboard:['Painel','Acompanhe os atendimentos e pendências de hoje.','+ Novo paciente','patient'],
  agenda:['Agenda','Consultas, retornos e aplicações.','+ Novo agendamento','appointment'],
  patients:['Pacientes','Cadastro e ficha dos pacientes.','+ Novo paciente','patient'],
  applications:['Aplicações','Histórico de medicação, dose e cobrança.','+ Nova aplicação','application'],
  finance:['Financeiro','Resumo de entradas, despesas e saldo.','',''],
  receivables:['A Receber','Controle de valores pendentes e pagos.','+ Novo a receber','receivable'],
  expenses:['Despesas','Saídas e comprovantes.','+ Nova despesa','expense'],
  professionals:['Profissionais','Equipe clínica, especialidades e comissões.','+ Novo Profissional','professional'],
  services:['Serviços','Procedimentos, duração e valores oferecidos pela clínica.','+ Novo Serviço','service'],
  stock:['Estoque','Medicamentos, materiais, lotes e validades.','+ Novo item','stock'],
  reminders:['Lembretes','Tarefas internas, prioridades e pendências.','+ Novo lembrete','reminder'],
  reports:['Relatórios','Relatórios operacionais e financeiros.','Exportar PDF','print'],
  users:['Usuários','Gerencie os acessos individuais da equipe.','+ Novo usuário','user'],
  help:['Ajuda','Guia rápido para a equipe usar o sistema.','+ Novo agendamento','appointment']
};

boot().catch(handleBootError);

async function boot(){
  try{
    setTheme(localStorage.getItem('clinicTheme')||document.documentElement.dataset.theme||'rose',false);
  }catch(_e){
    document.documentElement.dataset.theme='rose';
  }

  if(el('clinicName')) el('clinicName').textContent = cfg.CLINIC_NAME || 'Gestão Clínica';
  setDefaultMonths();
  bindEvents();

  // Nunca deixar o usuário olhando para uma tela branca enquanto o Supabase carrega.
  showOnly('loginScreen');

  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY){
    showOnly('setupScreen');
    return;
  }

  let createClient;
  try{
    ({createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'));
  }catch(primaryErr){
    try{
      ({createClient}=await import('https://esm.sh/@supabase/supabase-js@2'));
    }catch(fallbackErr){
      throw new Error('Não foi possível carregar a conexão do sistema. Recarregue a página em alguns segundos.');
    }
  }

  supabase = createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });

  const {data:{session}} = await supabase.auth.getSession();
  if(session){
    await enterApp(session.user);
  }else{
    showOnly('loginScreen');
    await refreshBootstrapState();
  }

  supabase.auth.onAuthStateChange(async (_evt,session)=>{
    if(!session){
      currentUser=null;
      showOnly('loginScreen');
    }
  });

  setTimeout(refreshIcons,80);
}

function handleBootError(err){
  console.error('Falha ao iniciar o sistema:',err);
  try{showOnly('loginScreen');}catch(_e){}
  const box=el('loginError');
  if(box){
    box.textContent=err?.message||'Não foi possível iniciar o sistema. Recarregue a página.';
    box.classList.remove('hidden');
  }else{
    document.body.innerHTML='<div style="padding:32px;font-family:Arial,sans-serif;color:#0f172a"><h2>Não foi possível iniciar o sistema</h2><p>Recarregue a página em alguns segundos.</p></div>';
  }
}

function showOnly(id){ ['setupScreen','loginScreen','app'].forEach(x=>el(x).classList.add('hidden')); el(id).classList.remove('hidden'); }
function setDefaultMonths(){ ['agendaMonth','appMonth','expenseMonth','reportMonth'].forEach(id=>{ if(el(id)) el(id).value=monthISO(); }); if(el('reportMonth')) syncReportMonthControls?.(); }
function bindEvents(){
  el('loginForm')?.addEventListener('submit',login);
  el('bootstrapBtn')?.addEventListener('click',bootstrapFirstUser);
  el('logoutBtn')?.addEventListener('click',logout);
  el('refreshBtn')?.addEventListener('click',()=>loadAll(true));
  el('topAction')?.addEventListener('click',()=>handleAction(viewMeta[currentView]?.[3]));
  el('printReportBtn')?.addEventListener('click',()=>window.print());
  el('reportPrevMonth')?.addEventListener('click',()=>shiftReportMonth(-1));
  el('reportNextMonth')?.addEventListener('click',()=>shiftReportMonth(1));
  el('reportMonthLabel')?.addEventListener('click',()=>{el('reportMonth').value=monthISO();syncReportMonthControls();renderReports(activeReportTab());});
  el('reportPeriodButtons')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-report-period]'); if(!b)return;
    el('reportPeriodPreset').value=b.dataset.reportPeriod;
    qsa('#reportPeriodButtons [data-report-period]').forEach(x=>x.classList.toggle('active',x===b));
    renderReports(activeReportTab());
  });
  el('exportExcelBtn')?.addEventListener('click',exportCurrentReportCsv);
  el('newUserBtn')?.addEventListener('click',()=>openUserForm());
  el('quickAppointmentBtn')?.addEventListener('click',()=>openForm('appointment'));
  el('profilePhotoBtn')?.addEventListener('click',openProfilePhotoModal);
  el('sidebarProfileBtn')?.addEventListener('click',openProfilePhotoModal);
  el('chooseProfilePhotoBtn')?.addEventListener('click',()=>el('profilePhotoInput')?.click());
  el('profilePhotoInput')?.addEventListener('change',previewProfilePhoto);
  el('saveProfilePhotoBtn')?.addEventListener('click',saveProfilePhoto);
  el('removeProfilePhotoBtn')?.addEventListener('click',removeProfilePhoto);
  document.addEventListener('click',e=>{if(e.target.closest('[data-close-profile]')) closeProfilePhotoModal();});
  el('openCashBtn')?.addEventListener('click',()=>handleCashAction('open'));
  el('printCashBtn')?.addEventListener('click',()=>printCashSummary());
  el('themeButton')?.addEventListener('click',e=>{e.stopPropagation();el('themeMenu')?.classList.toggle('hidden');});
  el('themeMenu')?.addEventListener('click',e=>{const b=e.target.closest('[data-theme-choice]');if(!b)return;setTheme(b.dataset.themeChoice);el('themeMenu')?.classList.add('hidden');});
  el('globalSearch')?.addEventListener('input',renderGlobalSearch);
  el('globalSearch')?.addEventListener('focus',renderGlobalSearch);
  el('notificationBtn')?.addEventListener('click',e=>{e.stopPropagation();el('notificationPanel')?.classList.toggle('hidden');});
  el('agendaStatus')?.addEventListener('change',renderAgenda);
  el('dashboardStatusTabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-dashboard-filter]');if(!b)return;dashboardStatusFilter=b.dataset.dashboardFilter;qsa('#dashboardStatusTabs button').forEach(x=>x.classList.toggle('active',x===b));renderDashboard();});

  el('nav')?.addEventListener('click',e=>{
    const b=e.target.closest('button[data-view]');
    if(b) switchView(b.dataset.view);
  });

  document.querySelector('.module-tabs')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-finance-tab]');
    if(b) setFinanceTab(b.dataset.financeTab);
  });

  el('helpSearch')?.addEventListener('input',renderHelpSearch);
  el('whatsappSupportBtn')?.addEventListener('click',()=>window.open('https://wa.me/?text='+encodeURIComponent('Olá, preciso de ajuda com o sistema Gestão Clínica.'),'_blank','noopener'));
  document.addEventListener('click',e=>{
    const guide=e.target.closest('[data-help-topic]');
    if(guide){switchView('help');setTimeout(()=>document.getElementById(guide.dataset.helpTopic)?.scrollIntoView({behavior:'smooth',block:'start'}),50);}
    const cash=e.target.closest('[data-cash-action]');
    if(cash) handleCashAction(cash.dataset.cashAction);
  });

  document.querySelector('.report-tabs')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-report-tab]');
    if(!b)return;
    qsa('.report-tabs button').forEach(x=>x.classList.toggle('active',x===b));
    renderReports(b.dataset.reportTab);
  });

  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-view-go]'); if(b) switchView(b.dataset.viewGo);
    const q=e.target.closest('[data-quick]'); if(q) handleAction(q.dataset.quick);
    const pr=e.target.closest('[data-patient-result]'); if(pr) choosePatient(pr.dataset.patientResult,pr.dataset.patientName||'');
    const prof=e.target.closest('[data-professional-result]'); if(prof) chooseProfessional(prof.dataset.professionalResult,prof.dataset.professionalName||'');
    if(!e.target.closest('.patient-combobox')) qsa('.patient-results').forEach(x=>x.classList.add('hidden'));
    if(!e.target.closest('.notification-wrap')) el('notificationPanel')?.classList.add('hidden');
    if(!e.target.closest('.theme-picker-wrap')) el('themeMenu')?.classList.add('hidden');
    if(!e.target.closest('#globalSearchWrap')) el('globalSearchResults')?.classList.add('hidden');
    if(e.target.closest('[data-close="modal"]')) closeModal();
  });

  document.addEventListener('input',e=>{
    if(e.target.matches('.patient-search-input')) renderPatientResults(e.target);
    if(e.target.matches('.professional-search-input')) renderProfessionalResults(e.target);
    if(e.target.matches('.money-input')) normalizeMoneyInput(e.target);
  });

  document.addEventListener('focusout',e=>{if(e.target.matches('.money-input')) finishMoneyInput(e.target);});
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();el('globalSearch')?.focus();}
    if(e.key==='Escape'){el('globalSearchResults')?.classList.add('hidden');el('notificationPanel')?.classList.add('hidden');el('themeMenu')?.classList.add('hidden');}
  });

  el('modalForm')?.addEventListener('submit',saveModal);

  [['patientSearch','patients'],['agendaSearch','agenda'],['applicationSearch','applications'],['receivableSearch','receivables'],['expenseSearch','expenses'],['professionalSearch','professionals'],['serviceSearch','services'],['stockSearch','stock'],['reminderSearch','reminders']]
    .forEach(([id,v])=>el(id)?.addEventListener('input',()=>render(v)));

  ['agendaMonth','appMonth','expenseMonth','reportMonth','receivableStatus','stockFilter','reminderStatus']
    .forEach(id=>el(id)?.addEventListener('change',()=>render(id==='reportMonth'?'reports':currentView)));
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
  e.preventDefault();
  const btn=el('loginBtn');
  const errorBox=el('loginError');
  const email=el('loginEmail').value.trim();
  const password=el('loginPassword').value;

  errorBox.textContent='';
  errorBox.classList.add('hidden');

  if(!email || !password){
    errorBox.textContent='Informe o e-mail e a senha.';
    errorBox.classList.remove('hidden');
    return;
  }

  const originalText=btn.textContent;
  btn.disabled=true;
  btn.textContent='Entrando...';

  let timer;
  try{
    const loginPromise=supabase.auth.signInWithPassword({email,password});
    const timeoutPromise=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('TIMEOUT_LOGIN')),12000);
    });

    const {data,error}=await Promise.race([loginPromise,timeoutPromise]);

    if(error){
      const msg=String(error.message||'').toLowerCase();
      if(msg.includes('invalid login')||msg.includes('invalid credentials')){
        throw new Error('E-mail ou senha incorretos.');
      }
      if(msg.includes('email not confirmed')){
        throw new Error('Este e-mail ainda precisa ser confirmado.');
      }
      throw error;
    }

    if(!data?.user){
      throw new Error('Não foi possível carregar o usuário.');
    }

    await enterApp(data.user);
  }catch(err){
    let message=err?.message||'Não foi possível entrar.';
    if(message==='TIMEOUT_LOGIN') message='A conexão demorou demais. Tente novamente.';
    errorBox.textContent=message;
    errorBox.classList.remove('hidden');
  }finally{
    clearTimeout(timer);
    btn.disabled=false;
    btn.textContent=originalText;
  }
}
async function logout(){ await supabase.auth.signOut(); showOnly('loginScreen'); await refreshBootstrapState(); }
function renderUserAvatars(){
  const name=(currentProfile?.full_name||currentUser?.email||'G').trim();
  const initial=(name[0]||'G').toUpperCase();
  const url=currentProfile?.avatar_url||'';
  ['userAvatar','topUserAvatar','profilePhotoPreview'].forEach(id=>{
    const node=el(id); if(!node)return;
    node.textContent='';
    node.classList.toggle('has-photo',!!url);
    if(url){
      const img=document.createElement('img');
      img.src=url; img.alt='Foto de perfil';
      node.appendChild(img);
    }else{
      node.textContent=initial;
    }
  });
}

async function enterApp(user){
  currentUser=user;
  const {data}=await supabase.from('profiles').select('*').eq('id',user.id).maybeSingle(); currentProfile=data||{full_name:user.email,role:'staff',active:true};
  if(currentProfile.active===false){ await supabase.auth.signOut(); toast('Usuário sem acesso ao sistema.',true); return; }
  el('userName').textContent=currentProfile.full_name||user.email; el('userRole').textContent=(currentProfile.role||'Equipe').toUpperCase();
  if(el('topUserName')) el('topUserName').textContent=currentProfile.full_name||user.email;
  if(el('topUserRole')) el('topUserRole').textContent=(currentProfile.role||'Equipe').toUpperCase();
  renderUserAvatars();
  el('usersNavBtn')?.classList.toggle('hidden',currentProfile.role!=='admin');
  showOnly('app'); await loadAll();
}

async function loadAll(showToast=false){
  const tables=['patients','appointments','applications','receivables','expenses','stock_items','team_reminders','stock_movements','professionals','services','cash_sessions','cash_movements'];
  const keys=['patients','agenda','applications','receivables','expenses','stock','reminders','stockMovements','professionals','services','cashSessions','cashMovements'];
  const results=await Promise.all(tables.map(t=>supabase.from(t).select('*').order('created_at',{ascending:false})));
  const err=results.find(r=>r.error)?.error; if(err){toast('Erro ao carregar dados: '+err.message,true);return;}
  results.forEach((r,i)=>state[keys[i]]=r.data||[]);
  if(currentProfile?.role==='admin') await loadUsers();
  renderAll(); renderNotifications(); refreshIcons(); if(showToast) toast('Dados atualizados.');
}

function switchView(v){
  if(v==='users' && currentProfile?.role!=='admin') return toast('Somente administradores podem gerenciar usuários.',true);
  const meta=viewMeta[v], view=el('view-'+v);
  if(!meta || !view) return toast('Esta tela ainda não está disponível.',true);

  currentView=v;
  qsa('.view').forEach(x=>x.classList.remove('active'));
  view.classList.add('active');
  qsa('#nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));

  el('pageTitle').textContent=meta[0];
  el('pageSubtitle').textContent=meta[1];
  el('pageEyebrow').textContent=v==='dashboard'?'VISÃO GERAL':'GESTÃO CLÍNICA';
  el('topAction').textContent=meta[2];
  el('topAction').classList.toggle('hidden',v==='reports'||v==='finance'||!meta[2]);

  render(v);
  refreshIcons();
}
function renderAll(){ Object.keys(viewMeta).forEach(render); }
function render(v){({dashboard:renderDashboard,agenda:renderAgenda,patients:renderPatients,applications:renderApplications,finance:renderFinance,receivables:renderReceivables,expenses:renderExpenses,professionals:renderProfessionals,services:renderServices,stock:renderStock,reminders:renderReminders,reports:renderReports,users:renderUsers,help:()=>{}})[v]?.();}

function renderDashboard(){
  const today=todayISO(), month=monthISO();
  const pending=state.receivables.filter(r=>r.status!=='PAGO').reduce((s,r)=>s+Number(r.amount||0),0);
  const income=state.receivables.filter(r=>r.status==='PAGO' && String(r.paid_at||r.due_date||'').slice(0,7)===month).reduce((s,r)=>s+Number(r.amount||0),0);
  const exp=state.expenses.filter(r=>String(r.date||'').slice(0,7)===month).reduce((s,r)=>s+Number(r.amount||0),0);
  el('mPatients').textContent=state.patients.filter(x=>x.active!==false).length;
  el('mToday').textContent=state.agenda.filter(x=>x.date===today).length;
  el('mPending').textContent=money(pending); el('mBalance').textContent=money(income-exp);
  const first=(currentProfile?.full_name||'').trim().split(/\s+/)[0]||'Olá';
  el('greeting').textContent=`Olá, ${first}!`;
  el('todayLabel').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const todays=state.agenda.filter(x=>x.date===today).sort((a,b)=>String(a.time||'').localeCompare(String(b.time||'')));
  const norm=s=>String(s||'').toUpperCase();
  el('tabAllCount').textContent=todays.length;
  el('tabWaitingCount').textContent=todays.filter(x=>norm(x.status)==='AGENDADO').length;
  el('tabConfirmedCount').textContent=todays.filter(x=>norm(x.status)==='CONFIRMADO').length;
  el('tabDoneCount').textContent=todays.filter(x=>['ATENDIDO','FINALIZADO','CONCLUÍDO'].includes(norm(x.status))).length;
  const filtered=dashboardStatusFilter==='ALL'?todays:todays.filter(x=>dashboardStatusFilter==='ATENDIDO'?['ATENDIDO','FINALIZADO','CONCLUÍDO'].includes(norm(x.status)):norm(x.status)===dashboardStatusFilter);
  el('todayAppointmentRows').innerHTML=filtered.length?filtered.slice(0,12).map(a=>`<tr><td class="time-cell">${escapeHtml(a.time||'--:--')}</td><td><strong>${escapeHtml(a.patient_name||'Paciente')}</strong><small>${escapeHtml(a.professional||'')}</small></td><td>${escapeHtml(a.type||'Atendimento')}</td><td>${badge(a.status||'AGENDADO')}</td><td class="align-right"><button class="mini-btn" onclick="window.appEdit('appointment','${a.id}')">Editar</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty">Nenhum atendimento neste filtro.</td></tr>';
  const rem=state.reminders.filter(r=>r.status!=='CONCLUÍDO').sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999'))).slice(0,6);
  el('homeReminders').innerHTML=rem.length?rem.map(r=>`<div class="list-item"><div><strong>${escapeHtml(r.title)}</strong><small>${dateBR(r.date)}${r.responsible?' • '+escapeHtml(r.responsible):''}</small></div>${badge(r.priority||'NORMAL')}</div>`).join(''):'<div class="empty">Sem pendências abertas.</div>';
  refreshIcons();
}
function normalizeWhatsAppNumber(phone){
  let digits=String(phone||'').replace(/\D/g,'');
  if(digits.startsWith('0')) digits=digits.replace(/^0+/,'');
  if(!digits)return '';
  if(!digits.startsWith('55') && (digits.length===10 || digits.length===11)) digits='55'+digits;
  return digits;
}
function openPatientWhatsApp(patient){
  const number=normalizeWhatsAppNumber(patient?.phone);
  if(!number)return toast('Este paciente não possui telefone/WhatsApp cadastrado.',true);
  if(number.length<12 || number.length>13)return toast('Confira o número do paciente e inclua o DDD.',true);
  const firstName=String(patient?.name||'').trim().split(/\s+/)[0]||'';
  const msg=`Olá${firstName?', '+firstName:''}! Tudo bem? Entramos em contato pela clínica para falar sobre seu agendamento.`;
  window.open('https://wa.me/'+number+'?text='+encodeURIComponent(msg),'_blank','noopener');
}
function renderPatients(){
  const q=el('patientSearch').value.toLowerCase();
  const rows=state.patients.filter(p=>[p.name,p.phone,p.cpf].join(' ').toLowerCase().includes(q));
  el('patientRows').innerHTML=rows.length?rows.map(p=>`<tr>
    <td><strong>${escapeHtml(p.name)}</strong></td>
    <td>
      <div class="patient-phone-cell">
        <span>${escapeHtml(p.phone||'—')}</span>
        ${p.phone?`<button class="mini-btn whatsapp-btn" type="button" onclick="window.patientWhatsApp('${p.id}')">WhatsApp</button>`:''}
      </div>
    </td>
    <td>${escapeHtml(p.cpf||'')}</td>
    <td>${escapeHtml(p.billing_type||'')}</td>
    <td title="${escapeHtml(p.notes||'')}">${escapeHtml((p.notes||'').slice(0,45))}</td>
    <td class="row-actions"><button class="mini-btn" onclick="window.appEdit('patient','${p.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('patients','${p.id}','${escapeHtml(p.name)}')">Excluir</button></td>
  </tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum paciente encontrado.</td></tr>';
}
function renderCalendar(month,rows){ const [y,m]=month.split('-').map(Number), first=new Date(y,m-1,1), start=new Date(y,m-1,1-first.getDay()), cells=[]; for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const iso=d.toISOString().slice(0,10);const dayRows=rows.filter(a=>a.date===iso).slice(0,3);cells.push(`<div class="cal-day ${d.getMonth()!==m-1?'other':''} ${iso===todayISO()?'today':''}"><div class="cal-num">${d.getDate()}</div>${dayRows.map(a=>`<span class="cal-chip">${escapeHtml(a.time||'')} ${escapeHtml(a.patient_name||'')}</span>`).join('')}</div>`)} el('agendaCalendar').innerHTML=`<div class="cal-head">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(x=>`<div>${x}</div>`).join('')}</div><div class="cal-grid">${cells.join('')}</div>`; }
function renderApplications(){ const month=el('appMonth').value||monthISO(),q=el('applicationSearch').value.toLowerCase(); const rows=state.applications.filter(a=>String(a.date||'').startsWith(month)&&[a.patient_name,a.medication].join(' ').toLowerCase().includes(q)); el('applicationRows').innerHTML=rows.length?rows.map(a=>`<tr><td>${dateBR(a.date)}</td><td><strong>${escapeHtml(a.patient_name||'')}</strong></td><td>${escapeHtml(a.medication||'')}</td><td>${escapeHtml(a.dose||'')}</td><td>${money(a.amount)}</td><td>${badge(a.payment_status||'PENDENTE')}</td><td class="row-actions"><button class="mini-btn" onclick="window.appEdit('application','${a.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('applications','${a.id}','aplicação')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhuma aplicação no período.</td></tr>'; }
function renderReceivables(){ const q=el('receivableSearch').value.toLowerCase(),st=el('receivableStatus').value; const rows=state.receivables.filter(r=>(!st||r.status===st)&&[r.patient_name,r.description].join(' ').toLowerCase().includes(q)).sort((a,b)=>String(a.due_date||'').localeCompare(String(b.due_date||''))); el('receivableRows').innerHTML=rows.length?rows.map(r=>`<tr><td>${dateBR(r.due_date)}</td><td><strong>${escapeHtml(r.patient_name||'')}</strong></td><td>${escapeHtml(r.description||'')}</td><td>${money(r.amount)}</td><td>${badge(r.status)}</td><td>${escapeHtml(r.payment_method||'')}</td><td class="row-actions">${r.status!=='PAGO'?`<button class="mini-btn" onclick="window.markPaid('${r.id}')">Marcar pago</button>`:''}<button class="mini-btn" onclick="window.appEdit('receivable','${r.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('receivables','${r.id}','recebimento')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum valor encontrado.</td></tr>'; }
function renderExpenses(){ const month=el('expenseMonth').value||monthISO(),q=el('expenseSearch').value.toLowerCase(); const rows=state.expenses.filter(r=>String(r.date||'').startsWith(month)&&[r.category,r.description].join(' ').toLowerCase().includes(q)); el('expenseRows').innerHTML=rows.length?rows.map(r=>`<tr><td>${dateBR(r.date)}</td><td>${escapeHtml(r.category||'')}</td><td><strong>${escapeHtml(r.description||'')}</strong></td><td>${money(r.amount)}</td><td>${escapeHtml(r.payment_method||'')}</td><td class="row-actions"><button class="mini-btn" onclick="window.appEdit('expense','${r.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('expenses','${r.id}','despesa')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhuma despesa no período.</td></tr>'; }
function renderProfessionals(){
  const q=(el('professionalSearch')?.value||'').toLowerCase();
  const rows=state.professionals.filter(p=>[p.name,p.specialty,p.phone,p.email].join(' ').toLowerCase().includes(q)).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  el('professionalRows').innerHTML=rows.length?rows.map(p=>`<tr>
    <td><strong>${escapeHtml(p.name||'')}</strong><small>${escapeHtml(p.email||'')}</small></td>
    <td>${escapeHtml(p.specialty||'')}</td>
    <td>${escapeHtml(p.phone||'')}</td>
    <td>${Number(p.commission_percent||0).toLocaleString('pt-BR')}%</td>
    <td>${badge(p.active===false?'INATIVO':'ATIVO')}</td>
    <td class="row-actions"><button class="mini-btn" onclick="window.appEdit('professional','${p.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('professionals','${p.id}','profissional')">Excluir</button></td>
  </tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum profissional cadastrado.</td></tr>';
}

function renderServices(){
  const q=(el('serviceSearch')?.value||'').toLowerCase();
  const rows=state.services.filter(s=>[s.name,s.specialty].join(' ').toLowerCase().includes(q)).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  el('serviceRows').innerHTML=rows.length?rows.map(s=>`<tr>
    <td><strong>${escapeHtml(s.name||'')}</strong></td>
    <td>${escapeHtml(s.specialty||'')}</td>
    <td>${Number(s.duration_minutes||0)} min</td>
    <td>${money(s.price)}</td>
    <td>${badge(s.active===false?'INATIVO':'ATIVO')}</td>
    <td class="row-actions"><button class="mini-btn" onclick="window.appEdit('service','${s.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('services','${s.id}','serviço')">Excluir</button></td>
  </tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum serviço cadastrado.</td></tr>';
}

function renderStock(){ const q=el('stockSearch').value.toLowerCase(),f=el('stockFilter').value, now=new Date(), in60=new Date(Date.now()+60*864e5); const rows=state.stock.filter(s=>[s.name,s.category,s.lot].join(' ').toLowerCase().includes(q)).filter(s=>f!=='low'||Number(s.current_qty)<=Number(s.minimum_qty||0)).filter(s=>f!=='expiring'||(s.expiry_date&&new Date(s.expiry_date)<=in60)); el('stockRows').innerHTML=rows.length?rows.map(s=>`<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.category||'')}</td><td>${Number(s.current_qty||0)} ${escapeHtml(s.unit||'')}</td><td>${Number(s.minimum_qty||0)}</td><td>${escapeHtml(s.lot||'')}</td><td>${s.expiry_date?dateBR(s.expiry_date):''}</td><td class="row-actions"><button class="mini-btn" onclick="window.stockMove('${s.id}')">Movimentar</button><button class="mini-btn" onclick="window.appEdit('stock','${s.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('stock_items','${s.id}','item')">Excluir</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum item encontrado.</td></tr>'; }
function renderReminders(){ const q=el('reminderSearch').value.toLowerCase(),st=el('reminderStatus').value; const rows=state.reminders.filter(r=>(!st||r.status===st)&&[r.title,r.description,r.responsible].join(' ').toLowerCase().includes(q)); el('reminderCards').innerHTML=rows.length?rows.map(r=>`<article class="reminder-card ${r.status!=='CONCLUÍDO'&&r.date&&r.date<todayISO()?'overdue':''}">${badge(r.priority||'NORMAL')}<h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(r.description||'')}</p><div class="reminder-foot"><span>${dateBR(r.date)} ${escapeHtml(r.time||'')}</span><span>${escapeHtml(r.responsible||'')}</span></div><div class="row-actions">${r.status!=='CONCLUÍDO'?`<button class="mini-btn" onclick="window.completeReminder('${r.id}')">Concluir</button>`:''}<button class="mini-btn" onclick="window.appEdit('reminder','${r.id}')">Editar</button><button class="mini-btn danger" onclick="window.appDelete('team_reminders','${r.id}','lembrete')">Excluir</button></div></article>`).join(''):'<div class="empty">Nenhum lembrete encontrado.</div>'; }
function renderFinance(){ const month=monthISO(), paid=state.receivables.filter(r=>r.status==='PAGO'&&String(r.paid_at||r.due_date||'').slice(0,7)===month), exp=state.expenses.filter(r=>String(r.date||'').slice(0,7)===month), pending=state.receivables.filter(r=>r.status!=='PAGO'); const income=paid.reduce((s,r)=>s+Number(r.amount||0),0), expenses=exp.reduce((s,r)=>s+Number(r.amount||0),0); el('fIncome').textContent=money(income);el('fExpenses').textContent=money(expenses);el('fBalance').textContent=money(income-expenses);el('fPending').textContent=money(pending.reduce((s,r)=>s+Number(r.amount||0),0)); el('financeIncomeList').innerHTML=paid.slice(0,6).map(r=>`<div class="list-item"><div><strong>${escapeHtml(r.patient_name||r.description||'Recebimento')}</strong><small>${dateBR(r.paid_at||r.due_date)}</small></div><strong>${money(r.amount)}</strong></div>`).join('')||'<div class="empty">Sem recebimentos no mês.</div>'; el('financeExpenseList').innerHTML=exp.slice(0,6).map(r=>`<div class="list-item"><div><strong>${escapeHtml(r.description||r.category||'Despesa')}</strong><small>${dateBR(r.date)}</small></div><strong>${money(r.amount)}</strong></div>`).join('')||'<div class="empty">Sem despesas no mês.</div>'; }
function setFinanceTab(tab='overview'){
  qsa('.module-tabs [data-finance-tab]').forEach(b=>b.classList.toggle('active',b.dataset.financeTab===tab));
  el('financeOverviewPanel')?.classList.toggle('hidden',tab!=='overview');
  el('financeCashPanel')?.classList.toggle('hidden',tab!=='cash');
  el('financeCommissionsPanel')?.classList.toggle('hidden',tab!=='commissions');
  el('financeMethodsPanel')?.classList.toggle('hidden',tab!=='methods');
  if(tab==='cash') renderCash();
  if(tab==='commissions') renderCommissions();
  if(tab==='methods') renderPaymentMethods();
  if(!qsa('.module-tabs [data-finance-tab].active').length) setFinanceTab('overview');
}
function renderCommissions(){
  const month=monthISO(), total=state.receivables.filter(r=>r.status==='PAGO'&&String(r.paid_at||r.due_date||'').slice(0,7)===month).reduce((a,r)=>a+Number(r.amount||0),0);
  el('commissionRows').innerHTML=state.professionals.filter(p=>p.active!==false).map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>${Number(p.commission_percent||0).toLocaleString('pt-BR')}%</td><td>${money(total)}</td><td>${money(total*Number(p.commission_percent||0)/100)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhum profissional cadastrado.</td></tr>';
}
function renderPaymentMethods(){
  const month=monthISO(), rows=state.receivables.filter(r=>r.status==='PAGO'&&String(r.paid_at||r.due_date||'').slice(0,7)===month), sums={};
  rows.forEach(r=>{const k=r.payment_method||'Não informado';sums[k]=(sums[k]||0)+Number(r.amount||0)});
  el('paymentMethodCards').innerHTML=Object.entries(sums).map(([k,v])=>`<article class="payment-method-card"><span>${escapeHtml(k)}</span><strong>${money(v)}</strong><small>${rows.filter(r=>(r.payment_method||'Não informado')===k).length} recebimento(s)</small></article>`).join('')||'<div class="empty">Sem recebimentos pagos neste mês.</div>';
}
function currentCashSession(){
  return state.cashSessions.find(x=>x.opened_date===todayISO()) || null;
}
function cashSessionMovements(session){
  return session?state.cashMovements.filter(x=>x.session_id===session.id):[];
}
function cashTotals(session){
  const rows=cashSessionMovements(session), opening=Number(session?.opening_balance||0);
  const byMethod={};
  let supplies=0,withdrawals=0;
  rows.forEach(m=>{
    if(m.movement_type==='RECEIPT'){const k=(m.payment_method||'OUTRO').toUpperCase();byMethod[k]=(byMethod[k]||0)+Number(m.amount||0);}
    if(m.movement_type==='SUPPLY') supplies+=Number(m.amount||0);
    if(m.movement_type==='WITHDRAWAL') withdrawals+=Number(m.amount||0);
  });
  const cash=(byMethod['DINHEIRO']||0), pix=(byMethod['PIX']||0), credit=(byMethod['CARTÃO DE CRÉDITO']||0), debit=(byMethod['CARTÃO DE DÉBITO']||0), insurance=(byMethod['CONVÊNIO']||0);
  return {rows,opening,supplies,withdrawals,cash,pix,credit,debit,insurance,expected:opening+cash+supplies-withdrawals};
}
function renderCash(){
  const session=currentCashSession();
  el('cashDateLabel').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  el('cashClosedState').classList.toggle('hidden',!!session);
  el('cashOpenState').classList.toggle('hidden',!session||session.status!=='OPEN');
  el('cashFinishedState').classList.toggle('hidden',!session||session.status!=='CLOSED');
  el('openCashBtn').classList.toggle('hidden',!!session);
  if(!session){refreshIcons();return;}
  const t=cashTotals(session);
  if(session.status==='OPEN'){
    el('cashOpenedBy').textContent=session.opened_by_name||'Usuário';
    el('cashOpenedAt').textContent='Aberto às '+new Date(session.opened_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    el('cashOpeningBalance').textContent=money(t.opening);
    el('cashExpectedCash').textContent=money(t.expected);
    el('cashPixTotal').textContent=money(t.pix);
    el('cashCardTotal').textContent=money(t.credit+t.debit);
    el('cashInsuranceTotal').textContent=money(t.insurance);
    el('cashCashReceipts').textContent=money(t.cash);
    el('cashSupplies').textContent=money(t.supplies);
    el('cashWithdrawals').textContent=money(t.withdrawals);
    el('cashExpectedCash2').textContent=money(t.expected);
    el('cashMovementRows').innerHTML=t.rows.length?t.rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).map(m=>`<tr><td>${new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td><td>${badge(m.movement_type==='RECEIPT'?'RECEBIMENTO':m.movement_type==='SUPPLY'?'SUPRIMENTO':'SANGRIA')}</td><td>${escapeHtml(m.description||'')}</td><td>${escapeHtml(m.payment_method||'—')}</td><td class="align-right"><strong>${money(m.amount)}</strong></td></tr>`).join(''):'<tr><td colspan="5" class="empty">Nenhuma movimentação no caixa.</td></tr>';
  }else{
    el('cashFinishedInfo').textContent=`Fechado por ${session.closed_by_name||'usuário'} em ${new Date(session.closed_at).toLocaleString('pt-BR')}`;
    el('cashClosedExpected').textContent=money(session.expected_cash);
    el('cashClosedCounted').textContent=money(session.closing_counted);
    el('cashClosedDifference').textContent=money(session.difference);
  }
  refreshIcons();
}
async function handleCashAction(action){
  const session=currentCashSession();
  if(action==='open'){
    if(session) return toast('O caixa de hoje já foi aberto.',true);
    const raw=prompt('Informe o fundo de troco do caixa de hoje (ex.: 100,00):','0,00'); if(raw===null)return;
    const opening=parseMoneyInput(raw);
    const {error}=await supabase.from('cash_sessions').insert({opened_date:todayISO(),opened_by:currentUser.id,opened_by_name:currentProfile?.full_name||currentUser.email,opening_balance:opening,status:'OPEN'});
    if(error)return toast(error.message,true); await audit('OPEN_CASH','cash_sessions','',{opening_balance:opening}); await loadAll(); setFinanceTab('cash'); toast('Caixa aberto com sucesso.');
  }
  if(action==='supply'||action==='withdrawal'){
    if(!session||session.status!=='OPEN')return toast('Abra o caixa antes de lançar movimentações.',true);
    const raw=prompt(action==='supply'?'Valor do suprimento:':'Valor da sangria / retirada:','0,00'); if(raw===null)return;
    const amount=parseMoneyInput(raw); if(amount<=0)return toast('Informe um valor válido.',true);
    const reason=prompt('Motivo / observação:','')||'';
    const {error}=await supabase.from('cash_movements').insert({session_id:session.id,movement_date:todayISO(),movement_type:action==='supply'?'SUPPLY':'WITHDRAWAL',payment_method:'DINHEIRO',amount,description:reason,user_id:currentUser.id,user_name:currentProfile?.full_name||currentUser.email});
    if(error)return toast(error.message,true); await loadAll(); setFinanceTab('cash'); toast(action==='supply'?'Suprimento registrado.':'Sangria registrada.');
  }
  if(action==='close'){
    if(!session||session.status!=='OPEN')return toast('Não há caixa aberto para fechar.',true);
    const t=cashTotals(session);
    const raw=prompt(`Dinheiro esperado: ${money(t.expected)}\nDigite o valor contado fisicamente na gaveta:`,'0,00'); if(raw===null)return;
    const counted=parseMoneyInput(raw), diff=counted-t.expected;
    const msg=diff===0?'O caixa bateu exatamente.':`Diferença: ${money(diff)}.`;
    if(!confirm(msg+'\n\nConfirmar fechamento do caixa?'))return;
    const now=new Date().toISOString();
    const {error}=await supabase.from('cash_sessions').update({status:'CLOSED',closing_counted:counted,expected_cash:t.expected,difference:diff,closed_at:now,closed_by:currentUser.id,closed_by_name:currentProfile?.full_name||currentUser.email,updated_at:now}).eq('id',session.id);
    if(error)return toast(error.message,true); await audit('CLOSE_CASH','cash_sessions',session.id,{expected:t.expected,counted,difference:diff}); await loadAll(); setFinanceTab('cash'); toast('Caixa fechado com sucesso.');
  }
}
function printCashSummary(){setFinanceTab('cash');setTimeout(()=>window.print(),80)}
async function registerPaidInCash(receivable){
  const session=currentCashSession();
  if(!session||session.status!=='OPEN'||!receivable)return;
  const {error}=await supabase.from('cash_movements').insert({session_id:session.id,movement_date:todayISO(),movement_type:'RECEIPT',payment_method:receivable.payment_method||'OUTRO',amount:Number(receivable.amount||0),description:(receivable.patient_name?receivable.patient_name+' • ':'')+(receivable.description||'Recebimento'),source_type:'receivable',source_id:receivable.id,user_id:currentUser.id,user_name:currentProfile?.full_name||currentUser.email});
  if(error && !String(error.message||'').toLowerCase().includes('duplicate')) throw error;
}
function renderHelpSearch(){
  const q=(el('helpSearch')?.value||'').trim().toLowerCase();
  let visible=0;
  qsa('.help-guide').forEach(card=>{const show=!q||(card.dataset.helpKeywords+' '+card.textContent).toLowerCase().includes(q);card.classList.toggle('hidden',!show);if(show)visible++;});
  el('helpNoResults')?.classList.toggle('hidden',visible>0);
}
function syncReportMonthControls(){
  const value=el('reportMonth')?.value||monthISO();
  if(el('reportMonth')) el('reportMonth').value=value;
  const [y,m]=value.split('-').map(Number);
  if(el('reportMonthLabel')) el('reportMonthLabel').textContent=new Date(y,m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).replace(/^./,x=>x.toUpperCase());
}
function shiftReportMonth(delta){
  const value=el('reportMonth')?.value||monthISO(), [y,m]=value.split('-').map(Number), d=new Date(y,m-1+delta,1);
  el('reportMonth').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  el('reportPeriodPreset').value='month';
  qsa('#reportPeriodButtons [data-report-period]').forEach(b=>b.classList.toggle('active',b.dataset.reportPeriod==='month'));
  syncReportMonthControls();
  renderReports(activeReportTab());
}
function activeReportTab(){return qs('.report-tabs button.active')?.dataset.reportTab||'agenda';}
function renderReports(tab=activeReportTab()){
  const month=el('reportMonth')?.value||monthISO(), preset=el('reportPeriodPreset')?.value||'month', now=new Date(), week=new Date(now);week.setDate(now.getDate()-((now.getDay()+6)%7));
  const inPeriod=v=>{if(!v)return false;const d=String(v).slice(0,10);if(preset==='today')return d===todayISO();if(preset==='week')return d>=week.toISOString().slice(0,10)&&d<=todayISO();return d.startsWith(month)};
  const appts=state.agenda.filter(a=>inPeriod(a.date)), paid=state.receivables.filter(r=>r.status==='PAGO'&&inPeriod(r.paid_at||r.due_date)), exp=state.expenses.filter(r=>inPeriod(r.date)), apps=state.applications.filter(a=>inPeriod(a.date));
  el('reportTitle').textContent=({agenda:'Relatório de agenda',finance:'Relatório financeiro',treatments:'Relatório de tratamentos',patients:'Relatório de pacientes'})[tab];
  el('reportPeriod').textContent=preset==='today'?'Hoje':preset==='week'?'Esta semana':new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  el('rAppointments').textContent=appts.length;el('rIncome').textContent=money(paid.reduce((a,r)=>a+Number(r.amount||0),0));el('rExpenses').textContent=money(exp.reduce((a,r)=>a+Number(r.amount||0),0));el('rPatients').textContent=state.patients.filter(p=>p.active!==false).length;
  let html='';
  if(tab==='agenda') html=`<div class="tablewrap"><table class="data-table"><thead><tr><th>Data</th><th>Hora</th><th>Paciente</th><th>Tipo</th><th>Profissional</th><th>Status</th></tr></thead><tbody>${appts.length?appts.map(a=>`<tr><td>${dateBR(a.date)}</td><td>${escapeHtml(a.time||'')}</td><td><strong>${escapeHtml(a.patient_name||'')}</strong></td><td>${escapeHtml(a.type||'')}</td><td>${escapeHtml(a.professional||'')}</td><td>${badge(a.status)}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">Sem atendimentos no período.</td></tr>'}</tbody></table></div>`;
  if(tab==='finance') html=`<div class="dashboard-grid"><article class="panel"><div class="panel-head"><h3>Recebimentos</h3></div><div class="list">${paid.length?paid.map(r=>`<div class="list-item"><div><strong>${escapeHtml(r.patient_name||r.description||'Recebimento')}</strong><small>${dateBR(r.paid_at||r.due_date)} • ${escapeHtml(r.payment_method||'')}</small></div><strong>${money(r.amount)}</strong></div>`).join(''):'<div class="empty">Sem recebimentos.</div>'}</div></article><article class="panel"><div class="panel-head"><h3>Despesas</h3></div><div class="list">${exp.length?exp.map(r=>`<div class="list-item"><div><strong>${escapeHtml(r.description||r.category||'Despesa')}</strong><small>${dateBR(r.date)}</small></div><strong>${money(r.amount)}</strong></div>`).join(''):'<div class="empty">Sem despesas.</div>'}</div></article></div>`;
  if(tab==='treatments') html=`<div class="tablewrap"><table class="data-table"><thead><tr><th>Data</th><th>Paciente</th><th>Medicação</th><th>Dosagem</th><th>Valor</th></tr></thead><tbody>${apps.length?apps.map(a=>`<tr><td>${dateBR(a.date)}</td><td><strong>${escapeHtml(a.patient_name||'')}</strong></td><td>${escapeHtml(a.medication||'')}</td><td>${escapeHtml([a.dose,a.dose_unit].filter(Boolean).join(' '))}</td><td>${money(a.amount)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">Sem aplicações no período.</td></tr>'}</tbody></table></div>`;
  if(tab==='patients') html=`<div class="tablewrap"><table class="data-table"><thead><tr><th>Paciente</th><th>Telefone</th><th>CPF</th><th>Cobrança</th><th>Status</th></tr></thead><tbody>${state.patients.length?state.patients.map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.phone||'')}</td><td>${escapeHtml(p.cpf||'')}</td><td>${escapeHtml(p.billing_type||'')}</td><td>${badge(p.active===false?'INATIVO':'ATIVO')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">Nenhum paciente cadastrado.</td></tr>'}</tbody></table></div>`;
  el('reportDynamic').innerHTML=html;refreshIcons();
}
function exportCurrentReportCsv(){
  const tab=activeReportTab(),month=el('reportMonth')?.value||monthISO();let headers=[],rows=[];
  if(tab==='agenda'){headers=['Data','Hora','Paciente','Tipo','Profissional','Status'];rows=state.agenda.filter(a=>String(a.date||'').startsWith(month)).map(a=>[a.date,a.time,a.patient_name,a.type,a.professional,a.status])}
  if(tab==='finance'){headers=['Data','Paciente','Descrição','Valor','Status','Forma'];rows=state.receivables.map(r=>[r.paid_at||r.due_date,r.patient_name,r.description,r.amount,r.status,r.payment_method])}
  if(tab==='treatments'){headers=['Data','Paciente','Medicação','Dosagem','Valor'];rows=state.applications.filter(a=>String(a.date||'').startsWith(month)).map(a=>[a.date,a.patient_name,a.medication,[a.dose,a.dose_unit].filter(Boolean).join(' '),a.amount])}
  if(tab==='patients'){headers=['Paciente','Telefone','CPF','E-mail','Status'];rows=state.patients.map(p=>[p.name,p.phone,p.cpf,p.email,p.active===false?'INATIVO':'ATIVO'])}
  const csv=[headers,...rows].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\n'),blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`relatorio-${tab}-${month}.csv`;a.click();URL.revokeObjectURL(url);
}
function openProfilePhotoModal(){
  pendingProfilePhotoDataUrl=null;
  renderUserAvatars();
  el('profileModal')?.classList.remove('hidden');
  el('profileModal')?.setAttribute('aria-hidden','false');
  refreshIcons();
}
function closeProfilePhotoModal(){
  pendingProfilePhotoDataUrl=null;
  if(el('profilePhotoInput')) el('profilePhotoInput').value='';
  el('profileModal')?.classList.add('hidden');
  el('profileModal')?.setAttribute('aria-hidden','true');
}
function previewProfilePhoto(e){
  const file=e.target.files?.[0];
  if(!file)return;
  if(file.size>2*1024*1024){toast('Escolha uma foto com até 2 MB.',true);e.target.value='';return;}
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      const size=Math.min(img.width,img.height), sx=(img.width-size)/2, sy=(img.height-size)/2;
      const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=256;
      const ctx=canvas.getContext('2d'); ctx.drawImage(img,sx,sy,size,size,0,0,256,256);
      pendingProfilePhotoDataUrl=canvas.toDataURL('image/jpeg',0.82);
      const node=el('profilePhotoPreview'); if(node){node.textContent='';node.classList.add('has-photo');const p=document.createElement('img');p.src=pendingProfilePhotoDataUrl;p.alt='Prévia da foto';node.appendChild(p);}
    };
    img.src=reader.result;
  };
  reader.readAsDataURL(file);
}
async function saveProfilePhoto(){
  if(!pendingProfilePhotoDataUrl)return toast('Escolha uma foto antes de salvar.',true);
  const {error}=await supabase.from('profiles').update({avatar_url:pendingProfilePhotoDataUrl}).eq('id',currentUser.id);
  if(error)return toast(error.message,true);
  currentProfile.avatar_url=pendingProfilePhotoDataUrl;
  renderUserAvatars(); closeProfilePhotoModal(); toast('Foto do perfil atualizada.');
}
async function removeProfilePhoto(){
  const {error}=await supabase.from('profiles').update({avatar_url:null}).eq('id',currentUser.id);
  if(error)return toast(error.message,true);
  currentProfile.avatar_url=null; pendingProfilePhotoDataUrl=null; renderUserAvatars();
  if(el('profilePhotoInput')) el('profilePhotoInput').value='';
  toast('Foto removida.');
}
function refreshIcons(){try{window.lucide?.createIcons({attrs:{'stroke-width':1.8}});}catch(_e){}}
function setTheme(theme,persist=true){
  const allowed=['rose','blue','light','dark'], next=allowed.includes(theme)?theme:'rose';
  document.documentElement.dataset.theme=next;
  qsa('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===next));
  if(persist)localStorage.setItem('clinicTheme',next);
  const colors={rose:'#FF9EA3',blue:'#2457a6',light:'#475569',dark:'#0f172a'};
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',colors[next]);
}
function renderNotifications(){
  if(!el('notificationItems'))return;
  const today=todayISO(), pending=state.reminders.filter(r=>r.status!=='CONCLUÍDO').sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999'))).slice(0,8);
  const count=state.reminders.filter(r=>r.status!=='CONCLUÍDO'&&(!r.date||r.date<=today)).length;
  if(el('notificationCount')){el('notificationCount').textContent=count>99?'99+':String(count);el('notificationCount').classList.toggle('hidden',count===0);}
  el('notificationItems').innerHTML=pending.length?pending.map(r=>`<button type="button" data-view-go="reminders"><span class="notification-dot"></span><div><strong>${escapeHtml(r.title)}</strong><small>${dateBR(r.date)||'Sem data'}${r.responsible?' • '+escapeHtml(r.responsible):''}</small></div></button>`).join(''):'<div class="empty compact-empty">Nenhuma pendência.</div>';
}
function renderGlobalSearch(){
  const input=el('globalSearch'), box=el('globalSearchResults'); if(!input||!box)return;
  const q=input.value.trim().toLowerCase(); if(q.length<1){box.classList.add('hidden');box.innerHTML='';return;}
  const items=[
    ...state.patients.filter(p=>[p.name,p.phone,p.cpf].join(' ').toLowerCase().includes(q)).slice(0,5).map(p=>({type:'Paciente',title:p.name,sub:[p.phone,p.cpf].filter(Boolean).join(' • '),view:'patients'})),
    ...state.agenda.filter(a=>[a.patient_name,a.type,a.professional].join(' ').toLowerCase().includes(q)).slice(0,5).map(a=>({type:'Agenda',title:a.patient_name,sub:`${dateBR(a.date)} ${a.time||''} • ${a.type||''}`,view:'agenda'})),
    ...state.applications.filter(a=>[a.patient_name,a.medication].join(' ').toLowerCase().includes(q)).slice(0,4).map(a=>({type:'Aplicação',title:a.patient_name,sub:`${a.medication||''} • ${dateBR(a.date)}`,view:'applications'}))
  ].slice(0,12);
  box.innerHTML=items.length?items.map(i=>`<button type="button" data-view-go="${i.view}"><span class="search-type">${i.type}</span><div><strong>${escapeHtml(i.title||'')}</strong><small>${escapeHtml(i.sub||'')}</small></div></button>`).join(''):'<div class="empty compact-empty">Nenhum resultado.</div>';
  box.classList.remove('hidden');
}
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
function normalizeSpecialtyLabel(v){
  const raw=String(v||'').trim();
  if(!raw)return '';
  const k=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(k==='medico'||k==='medicina')return 'Medicina';
  return raw.replace(/\s+/g,' ').replace(/\b\w/g,m=>m.toUpperCase());
}
function specialtyOptions(selected=''){
  const dynamic=[...state.professionals.map(x=>x.specialty),...state.services.map(x=>x.specialty)]
    .map(normalizeSpecialtyLabel).filter(Boolean);
  const base=['Clínica Geral','Enfermagem','Estética','Fisioterapia','Medicina','Nutrição','Odontologia','Psicologia','Outra'];
  const values=[...new Set([...base,...dynamic])];
  const current=normalizeSpecialtyLabel(selected);
  return '<option value="">Selecione</option>'+values.map(v=>`<option value="${escapeHtml(v)}" ${v===current?'selected':''}>${escapeHtml(v)}</option>`).join('');
}
function dosageUnitOptions(selected=''){
  const values=['mg','mcg','g','mL','UI','gotas','comprimido(s)','cápsula(s)','ampola(s)','seringa(s)','aplicação(ões)'];
  return '<option value="">Selecione</option>'+values.map(v=>`<option value="${v}" ${v===selected?'selected':''}>${v}</option>`).join('');
}
function medicationField(value=''){
  return `<div class="field"><label>Medicação</label><input name="medication" type="text" autocomplete="off" value="${escapeHtml(value||'')}" placeholder="Digite a medicação..." /></div>`;
}
function stockItemField(value=''){
  return `<div class="field span2"><label>Item</label><input name="name" type="text" autocomplete="off" value="${escapeHtml(value||'')}" placeholder="Digite o nome do item..." /><small class="field-help">Ex.: gaze, luva de procedimento, seringa, álcool 70%.</small></div>`;
}
function stockItemChoices(term=''){
  const base=['Álcool 70%','Algodão','Gaze','Luva de procedimento','Máscara descartável','Seringa 1 mL','Seringa 3 mL','Seringa 5 mL','Agulha','Curativo','Papel toalha','Soro fisiológico'];
  const existing=state.stock.map(x=>x.name).filter(Boolean);
  const q=String(term||'').toLowerCase();
  return [...new Set([...existing,...base])].filter(v=>!q||String(v).toLowerCase().includes(q)).slice(0,18);
}
function renderStockItemOptions(input){
  const wrap=input.closest('.stock-item-combobox'), box=wrap?.querySelector('.stock-item-options'); if(!box)return;
  const items=stockItemChoices(input.value);
  box.innerHTML=items.length?items.map(v=>`<button type="button" data-stock-item="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join(''):'<div class="custom-option-empty">Nenhuma opção encontrada.</div>';
  box.classList.remove('hidden');
}
function stockCategoryOptions(selected=''){
  const values=['Medicamento','Material descartável','Material de limpeza','Material de escritório','Insumo','EPI','Outro'];
  return '<option value="">Selecione</option>'+values.map(v=>`<option value="${v}" ${v===selected?'selected':''}>${v}</option>`).join('');
}
function stockUnitOptions(selected='un'){
  const values=['un','cx','pct','fr','amp','ml','L','g','kg','kit'];
  return values.map(v=>`<option value="${v}" ${v===selected?'selected':''}>${v}</option>`).join('');
}
function appointmentTypeOptions(selected='Consulta'){
  const base=['Consulta','Retorno','Avaliação','Procedimento','Aplicação','Exame','Sessão','Outro'];
  const serviceNames=state.services.filter(x=>x.active!==false).map(x=>String(x.name||'').trim()).filter(Boolean);
  const values=[...new Set([...base,...serviceNames])];
  return values.map(v=>`<option value="${escapeHtml(v)}" ${String(v)===String(selected||'Consulta')?'selected':''}>${escapeHtml(v)}</option>`).join('');
}

function professionalSearchField(selectedId='',selectedName='',opts=''){
  const p=state.professionals.find(x=>x.id===selectedId) || state.professionals.find(x=>String(x.name||'').toLowerCase()===String(selectedName||'').toLowerCase());
  return `<div class="field ${opts}"><label>Profissional</label><div class="patient-combobox professional-combobox"><i data-lucide="search"></i><input class="professional-search-input" type="text" autocomplete="off" placeholder="Digite ou escolha um profissional..." value="${escapeHtml(p?.name||selectedName||'')}" /><input class="professional-id-input" type="hidden" name="professional_id" value="${escapeHtml(p?.id||selectedId||'')}" /><input class="professional-name-input" type="hidden" name="professional" value="${escapeHtml(p?.name||selectedName||'')}" /><div class="patient-results professional-results hidden"></div></div><small class="field-help">Profissionais ativos cadastrados no sistema.</small></div>`;
}

function renderProfessionalResults(input){
  const wrap=input.closest('.professional-combobox');
  const results=wrap?.querySelector('.professional-results');
  const idInput=wrap?.querySelector('.professional-id-input');
  const nameInput=wrap?.querySelector('.professional-name-input');
  if(!results||!idInput||!nameInput)return;

  const term=input.value.trim().toLowerCase();
  if(input.value.trim()!==nameInput.value){idInput.value='';nameInput.value='';}

  const matches=state.professionals
    .filter(p=>p.active!==false && (!term || [p.name,p.specialty].join(' ').toLowerCase().includes(term)))
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')))
    .slice(0,15);

  results.innerHTML=matches.length
    ?matches.map(p=>`<button type="button" data-professional-result="${p.id}" data-professional-name="${escapeHtml(p.name||'')}"><strong>${escapeHtml(p.name||'')}</strong><small>${escapeHtml(p.specialty||'Sem especialidade informada')}</small></button>`).join('')
    :'<div class="patient-no-result">Nenhum profissional ativo cadastrado.</div>';
  results.classList.remove('hidden');
}

function chooseProfessional(id,name){
  const open=[...document.querySelectorAll('.professional-results:not(.hidden)')].pop();
  const wrap=open?.closest('.professional-combobox');
  if(!wrap)return;
  wrap.querySelector('.professional-id-input').value=id;
  wrap.querySelector('.professional-name-input').value=name;
  wrap.querySelector('.professional-search-input').value=name;
  open.classList.add('hidden');
}

function patientSearchField(selectedId='',opts='span2'){
  const p=state.patients.find(x=>x.id===selectedId);
  return `<div class="field ${opts}"><label>Paciente</label><div class="patient-combobox"><i data-lucide="search"></i><input class="patient-search-input" type="text" autocomplete="off" placeholder="Digite nome, telefone ou CPF..." value="${escapeHtml(p?.name||'')}" /><input class="patient-id-input" type="hidden" name="patient_id" value="${escapeHtml(selectedId||'')}" /><div class="patient-results hidden"></div></div><small class="field-help">Digite as primeiras letras e escolha o paciente encontrado.</small></div>`;
}
function renderPatientResults(input){
  const wrap=input.closest('.patient-combobox'), results=wrap?.querySelector('.patient-results'), hidden=wrap?.querySelector('.patient-id-input');
  if(!results||!hidden)return;
  const term=input.value.trim().toLowerCase(); hidden.value='';
  if(!term){results.classList.add('hidden');results.innerHTML='';return;}
  const matches=state.patients.filter(p=>p.active!==false&&[p.name,p.phone,p.cpf].join(' ').toLowerCase().includes(term)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,10);
  results.innerHTML=matches.length?matches.map(p=>`<button type="button" data-patient-result="${p.id}" data-patient-name="${escapeHtml(p.name)}"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml([p.phone,p.cpf].filter(Boolean).join(' • '))}</small></button>`).join(''):'<div class="patient-no-result">Nenhum paciente encontrado.</div>';
  results.classList.remove('hidden');
}
function choosePatient(id,name){
  const open=[...document.querySelectorAll('.patient-results:not(.hidden)')].pop(), wrap=open?.closest('.patient-combobox');
  if(!wrap)return;
  wrap.querySelector('.patient-id-input').value=id; wrap.querySelector('.patient-search-input').value=name; open.classList.add('hidden');
}
function parseMoneyInput(v){
  const s=String(v??'').trim().replace(/R\$\s?/g,'').replace(/\./g,'').replace(',','.');
  const n=Number(s);
  return Number.isFinite(n)?n:0;
}
function normalizeMoneyInput(input){
  let raw=String(input.value||'').replace(/R\$\s?/g,'').replace(/[^0-9,]/g,'');
  if(!raw){input.value='';return;}
  const comma=raw.indexOf(',');
  if(comma>=0){
    const intPart=(raw.slice(0,comma).replace(/^0+(?=\d)/,'')||'0');
    const decPart=raw.slice(comma+1).replace(/\D/g,'').slice(0,2);
    input.value=intPart+','+decPart;
    return;
  }
  const intPart=(raw.replace(/^0+(?=\d)/,'')||'0');
  input.value=intPart+',00';
  try{input.setSelectionRange(intPart.length,intPart.length);}catch(_e){}
}
function moneyField(name,label,value='',opts=''){
  let display='';
  if(value!=='' && value!==null && value!==undefined){
    const n=Number(value);
    display=Number.isFinite(n)?n.toFixed(2).replace('.',','):'';
  }
  return `<div class="field ${opts}"><label>${label}</label><div class="money-wrap"><span>R$</span><input class="money-input" name="${name}" inputmode="decimal" autocomplete="off" value="${escapeHtml(display)}" placeholder="0,00" /></div></div>`;
}
function finishMoneyInput(input){
  if(!input.value.trim()){input.value='';return;}
  const n=parseMoneyInput(input.value);
  input.value=n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function paymentOptions(selected=''){
  const vals=['PIX','DINHEIRO','CARTÃO DE DÉBITO','CARTÃO DE CRÉDITO','TRANSFERÊNCIA','CONVÊNIO','BOLETO','OUTRO'];
  return '<option value="">Selecione</option>'+vals.map(v=>`<option value="${v}" ${v===selected?'selected':''}>${v}</option>`).join('');
}
function field(name,label,type='text',value='',opts=''){ if(type==='textarea')return `<div class="field ${opts}"><label>${label}</label><textarea name="${name}">${escapeHtml(value)}</textarea></div>`; if(type==='select')return `<div class="field ${opts}"><label>${label}</label><select name="${name}">${value}</select></div>`; return `<div class="field ${opts}"><label>${label}</label><input name="${name}" type="${type}" value="${escapeHtml(value)}" /></div>`; }

function handleAction(type){ if(type==='print'){window.print();return;} if(type==='user'){openUserForm();return;} openForm(type); }
function openForm(type,id=null){
  const map={patient:['Paciente','patient'],appointment:['Agendamento','appointment'],application:['Aplicação','application'],receivable:['Valor a receber','receivable'],expense:['Despesa','expense'],professional:['Profissional','professional'],service:['Serviço','service'],stock:['Item de estoque','stock'],reminder:['Lembrete','reminder'],stockMove:['Movimentação de estoque','stockMove']};
  const [title]=map[type]||['Registro']; const record=id?getRecord(type,id):{}; modalContext={type,id,record}; el('modalTitle').textContent=(id?'Editar ':'Novo ')+title.toLowerCase(); el('modalBody').innerHTML=formHtml(type,record); el('modal').classList.remove('hidden'); el('modal').setAttribute('aria-hidden','false');
}
function getRecord(type,id){ const m={patient:'patients',appointment:'agenda',application:'applications',receivable:'receivables',expense:'expenses',professional:'professionals',service:'services',stock:'stock',reminder:'reminders'}; return state[m[type]]?.find(x=>x.id===id)||{}; }
function formHtml(type,r){
  if(type==='patient') return field('name','Nome','text',r.name,'span2')+field('phone','Telefone / WhatsApp','tel',r.phone)+field('birth_date','Data de nascimento','date',r.birth_date)+field('cpf','CPF','text',r.cpf)+field('email','E-mail','email',r.email)+field('billing_type','Tipo de cobrança','select',`<option ${r.billing_type==='PARTICULAR'?'selected':''}>PARTICULAR</option><option ${r.billing_type==='MENSAL'?'selected':''}>MENSAL</option>`)+field('billing_day','Dia de vencimento','number',r.billing_day)+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='appointment') return patientSearchField(r.patient_id)+field('date','Data','date',r.date||todayISO())+field('time','Hora','time',r.time)+field('type','Tipo de atendimento','select',appointmentTypeOptions(r.type||'Consulta'))+professionalSearchField(r.professional_id,r.professional)+field('status','Status','select',`<option ${r.status==='AGENDADO'?'selected':''}>AGENDADO</option><option ${r.status==='CONFIRMADO'?'selected':''}>CONFIRMADO</option><option ${r.status==='ATENDIDO'?'selected':''}>ATENDIDO</option><option ${r.status==='CANCELADO'?'selected':''}>CANCELADO</option>`)+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='application') return patientSearchField(r.patient_id)+field('date','Data','date',r.date||todayISO())+medicationField(r.medication)+field('dose','Dosagem','text',r.dose)+field('dose_unit','Unidade da dosagem','select',dosageUnitOptions(r.dose_unit))+moneyField('amount','Valor',r.amount)+field('billing','Cobrança','select',`<option ${r.billing==='AVULSA'?'selected':''}>AVULSA</option><option ${r.billing==='MENSAL'?'selected':''}>MENSAL</option>`)+field('payment_status','Status do pagamento','select',`<option ${r.payment_status==='PENDENTE'?'selected':''}>PENDENTE</option><option ${r.payment_status==='PAGO'?'selected':''}>PAGO</option>`)+field('payment_method','Forma de pagamento','select',paymentOptions(r.payment_method))+field('due_date','Vencimento','date',r.due_date)+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='receivable') return patientSearchField(r.patient_id)+field('description','Descrição','text',r.description,'span2')+field('due_date','Vencimento','date',r.due_date||todayISO())+moneyField('amount','Valor',r.amount)+field('status','Status','select',`<option ${r.status==='PENDENTE'?'selected':''}>PENDENTE</option><option ${r.status==='PAGO'?'selected':''}>PAGO</option>`)+field('payment_method','Forma de pagamento','select',paymentOptions(r.payment_method))+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='expense') return field('date','Data','date',r.date||todayISO())+field('category','Categoria','text',r.category)+field('description','Descrição','text',r.description,'span2')+moneyField('amount','Valor',r.amount)+field('payment_method','Forma de pagamento','select',paymentOptions(r.payment_method))+field('notes','Observações','textarea',r.notes,'span2');
  if(type==='professional') return field('name','Nome do profissional','text',r.name,'span2')+field('specialty','Especialidade','select',specialtyOptions(r.specialty))+field('phone','Telefone / WhatsApp','text',r.phone)+field('email','E-mail','email',r.email)+field('commission_percent','Comissão padrão (%)','number',r.commission_percent)+field('active','Status','select',`<option value="true" ${r.active!==false?'selected':''}>ATIVO</option><option value="false" ${r.active===false?'selected':''}>INATIVO</option>`);
  if(type==='service') return field('name','Nome do serviço','text',r.name,'span2')+field('specialty','Especialidade','select',specialtyOptions(r.specialty))+field('duration_minutes','Duração (min)','number',r.duration_minutes||30)+moneyField('price','Valor (R$)',r.price)+field('commission_percent','Comissão específica (%)','number',r.commission_percent)+field('active','Status','select',`<option value="true" ${r.active!==false?'selected':''}>ATIVO</option><option value="false" ${r.active===false?'selected':''}>INATIVO</option>`);
  if(type==='stock') return stockItemField(r.name)+field('category','Categoria','select',stockCategoryOptions(r.category))+field('unit','Unidade','select',stockUnitOptions(r.unit||'un'))+field('current_qty','Quantidade atual','number',r.current_qty)+field('minimum_qty','Estoque mínimo','number',r.minimum_qty)+field('lot','Lote','text',r.lot)+field('expiry_date','Validade','date',r.expiry_date)+moneyField('unit_cost','Custo unitário',r.unit_cost);
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
    if(type==='appointment'){if(!raw.patient_id) throw new Error('Selecione um paciente pela busca.');if(!raw.professional_id) throw new Error('Selecione um profissional cadastrado.');table='appointments';const p=state.patients.find(x=>x.id===raw.patient_id);const prof=state.professionals.find(x=>x.id===raw.professional_id);payload={patient_id:raw.patient_id,patient_name:p?.name||'',date:raw.date,time:raw.time,type:raw.type,professional_id:raw.professional_id,professional:prof?.name||raw.professional||'',specialty:prof?.specialty||'',status:raw.status,notes:raw.notes};}
    if(type==='application'){if(!raw.patient_id) throw new Error('Selecione um paciente pela busca.');table='applications';const p=state.patients.find(x=>x.id===raw.patient_id);payload={patient_id:raw.patient_id,patient_name:p?.name||'',date:raw.date,medication:raw.medication,dose:raw.dose,dose_unit:raw.dose_unit||null,amount:parseMoneyInput(raw.amount),billing:raw.billing,payment_status:raw.payment_status,payment_method:raw.payment_method,due_date:raw.due_date||null,notes:raw.notes};}
    if(type==='receivable'){if(!raw.patient_id) throw new Error('Selecione um paciente pela busca.');table='receivables';const p=state.patients.find(x=>x.id===raw.patient_id);payload={patient_id:raw.patient_id,patient_name:p?.name||'',description:raw.description,due_date:raw.due_date,amount:parseMoneyInput(raw.amount),status:raw.status,payment_method:raw.payment_method,notes:raw.notes,paid_at:raw.status==='PAGO'?(record.paid_at||todayISO()):null};}
    if(type==='expense'){table='expenses';payload={date:raw.date,category:raw.category,description:raw.description,amount:parseMoneyInput(raw.amount),payment_method:raw.payment_method,notes:raw.notes};}
    if(type==='professional'){table='professionals';payload={name:raw.name,specialty:raw.specialty,phone:raw.phone,email:raw.email,commission_percent:Number(raw.commission_percent||0),active:raw.active!=='false'};}
    if(type==='service'){table='services';payload={name:raw.name,specialty:raw.specialty,duration_minutes:Number(raw.duration_minutes||30),price:parseMoneyInput(raw.price),commission_percent:raw.commission_percent?Number(raw.commission_percent):null,active:raw.active!=='false'};}
    if(type==='stock'){table='stock_items';payload={name:raw.name,category:raw.category,unit:raw.unit,current_qty:Number(raw.current_qty||0),minimum_qty:Number(raw.minimum_qty||0),lot:raw.lot,expiry_date:raw.expiry_date||null,unit_cost:parseMoneyInput(raw.unit_cost),active:true};}
    if(type==='reminder'){table='team_reminders';payload={title:raw.title,date:raw.date,time:raw.time||null,priority:raw.priority,responsible:raw.responsible,status:raw.status,description:raw.description,completed_at:raw.status==='CONCLUÍDO'?(record.completed_at||new Date().toISOString()):null};}
    if(type==='stockMove'){ await saveStockMovement(raw); save.disabled=false; return; }
    payload.updated_at=new Date().toISOString();
    let res=id
      ?await supabase.from(table).update(payload).eq('id',id).select().maybeSingle()
      :await supabase.from(table).insert(payload).select().maybeSingle();
    if(res.error) throw res.error;
    const saved=res.data;
    if(type==='receivable' && payload.status==='PAGO' && saved) await registerPaidInCash(saved);
    if(type==='application' && payload.payment_status==='PAGO' && saved){
      const session=currentCashSession();
      if(session?.status==='OPEN'){
        const {error:cashErr}=await supabase.from('cash_movements').insert({
          session_id:session.id,movement_date:todayISO(),movement_type:'RECEIPT',
          payment_method:payload.payment_method||'OUTRO',amount:Number(payload.amount||0),
          description:(payload.patient_name?payload.patient_name+' • ':'')+(payload.medication||'Aplicação'),
          source_type:'application',source_id:saved.id,user_id:currentUser.id,
          user_name:currentProfile?.full_name||currentUser.email
        });
        if(cashErr && !String(cashErr.message||'').toLowerCase().includes('duplicate')) throw cashErr;
      }
    }
    await audit(id?'UPDATE':'INSERT',table,id||saved?.id||'',payload);
    closeModal(); await loadAll(); toast('Registro salvo.');
  }catch(err){toast(err.message||'Erro ao salvar.',true);}finally{save.disabled=false;}
}
async function saveStockMovement(raw){ const item=state.stock.find(x=>x.id===raw.stock_id); if(!item) throw new Error('Item não encontrado.'); const qty=Number(raw.quantity||0); if(qty<=0) throw new Error('Informe uma quantidade válida.'); const newQty=raw.movement_type==='ENTRADA'?Number(item.current_qty||0)+qty:Number(item.current_qty||0)-qty; if(newQty<0) throw new Error('A saída é maior que o estoque atual.'); const {error:e1}=await supabase.from('stock_items').update({current_qty:newQty,updated_at:new Date().toISOString()}).eq('id',item.id); if(e1) throw e1; const {error:e2}=await supabase.from('stock_movements').insert({item_id:item.id,item_name:item.name,date:todayISO(),movement_type:raw.movement_type,quantity:qty,balance_after:newQty,notes:raw.notes,user_name:currentProfile?.full_name||currentUser.email}); if(e2) throw e2; await audit('STOCK_MOVE','stock_items',item.id,{type:raw.movement_type,quantity:qty,balance_after:newQty}); closeModal(); await loadAll(); toast('Estoque atualizado.'); }
async function audit(action,module,record_id,details){ try{await supabase.from('audit_log').insert({user_id:currentUser.id,user_name:currentProfile?.full_name||currentUser.email,action,module,record_id:String(record_id||''),details});}catch(_e){} }

window.appEdit=(type,id)=>openForm(type,id);
window.patientWhatsApp=id=>{const p=state.patients.find(x=>x.id===id);if(p)openPatientWhatsApp(p);};
window.stockMove=id=>{const r=state.stock.find(x=>x.id===id);modalContext=null;openForm('stockMove',null);modalContext.record=r; el('modalBody').innerHTML=formHtml('stockMove',r)};
window.appDelete=async(table,id,label)=>{ if(!confirm(`Excluir ${label}?`))return; const {error}=await supabase.from(table).delete().eq('id',id); if(error)return toast(error.message,true); await audit('DELETE',table,id,{label}); await loadAll(); toast('Registro excluído.'); };
window.markPaid=async id=>{
  const receivable=state.receivables.find(r=>r.id===id);
  if(!receivable)return toast('Recebimento não encontrado.',true);
  if(!receivable.payment_method)return toast('Informe a forma de pagamento antes de dar baixa.',true);
  const {error}=await supabase.from('receivables').update({status:'PAGO',paid_at:todayISO(),updated_at:new Date().toISOString()}).eq('id',id);
  if(error)return toast(error.message,true);
  try{await registerPaidInCash({...receivable,status:'PAGO',paid_at:todayISO()});}catch(err){toast('Pagamento salvo, mas não foi possível lançar no caixa: '+err.message,true);}
  await audit('MARK_PAID','receivables',id,{payment_method:receivable.payment_method,amount:receivable.amount});
  await loadAll();toast('Pagamento registrado.');
};
window.completeReminder=async id=>{const {error}=await supabase.from('team_reminders').update({status:'CONCLUÍDO',completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);if(error)return toast(error.message,true);await audit('COMPLETE','team_reminders',id,{});await loadAll();toast('Lembrete concluído.');};