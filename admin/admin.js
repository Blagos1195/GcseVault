const app=document.getElementById("app");
const ADMIN_PUSH_PUBLIC_KEY="BOaU8cDpW3gJFdhWh1mTVif8dfn-vKB3AzVnWKnKDLUxLwLMWZri33_jBy7iJWAt7QHvDCCVSt3E9wqb1B3asCs";
let adminPushEnabled=false;
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
window.openModal=html=>{document.getElementById("modal").innerHTML=html;document.getElementById("modal-bg").classList.add("open");};
window.closeModal=()=>document.getElementById("modal-bg").classList.remove("open");
window.render=renderAdmin;
let moderationLog = [];
let adminNotifications = [];
let adminNotificationPoll = null;
async function loadAdminNotifications(notify = false){
  const token=AdminManager.getToken();
  if(!token)return;
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}/admin/notifications`,{headers:{'X-Session-Token':token}});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    const data=await response.json();
    adminNotifications=data.notifications||[];
    const unread=adminNotifications.filter(item=>!item.read_at);
    renderAdmin();
  }catch(error){AdminManager.error=error.message;renderAdmin();}
}
function adminPushKeyBytes(value){
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const binary=atob(normalized+'='.repeat((4-normalized.length%4)%4));
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
async function checkAdminPushSubscription(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window))return;
  try{
    const registration=await navigator.serviceWorker.getRegistration('./');
    adminPushEnabled=Boolean(registration&&await registration.pushManager.getSubscription());
    renderAdmin();
  }catch{}
}
async function enableAdminPushNotifications(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){
    AdminManager.error='This browser does not support Web Push notifications.';
    renderAdmin();
    return;
  }
  try{
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Allow notifications in your browser settings to enable push alerts.');
    const registration=await navigator.serviceWorker.register('./push-sw.js',{scope:'./'});
    await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:adminPushKeyBytes(ADMIN_PUSH_PUBLIC_KEY)});
    const response=await fetch(VaultUser.WORKER_URL+'/admin/push/subscribe',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Session-Token':AdminManager.getToken()},
      body:JSON.stringify(subscription.toJSON())
    });
    if(!response.ok)throw new Error(await response.text()||'HTTP '+response.status);
    adminPushEnabled=true;
    AdminManager.error='';
    renderAdmin();
  }catch(error){
    AdminManager.error=error.message||'Could not enable push notifications.';
    renderAdmin();
  }
}
async function markAdminNotificationRead(id){
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}/admin/notifications/read`,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':AdminManager.getToken()},body:JSON.stringify({ids:[id]})});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    const notification=adminNotifications.find(item=>item.id===id);
    if(notification)notification.read_at=new Date().toISOString();
    renderAdmin();
  }catch(error){AdminManager.error=error.message;renderAdmin();}
}
async function markAdminNotificationsRead(){
  const ids=adminNotifications.filter(item=>!item.read_at).map(item=>item.id);
  if(!ids.length)return;
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}/admin/notifications/read`,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':AdminManager.getToken()},body:JSON.stringify({ids})});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    const now=new Date().toISOString();
    adminNotifications=adminNotifications.map(item=>item.read_at?item:{...item,read_at:now});
    renderAdmin();
  }catch(error){AdminManager.error=error.message;renderAdmin();}
}
async function deleteAdminNotification(id){
  if(!confirm("Delete this notification?"))return;
  await deleteAdminNotifications([id]);
}
async function clearReadAdminNotifications(){
  const ids=adminNotifications.filter(item=>item.read_at).map(item=>item.id);
  if(!ids.length)return;
  if(!confirm(`Delete all ${ids.length} read notifications?`))return;
  await deleteAdminNotifications(ids);
}
async function deleteAdminNotifications(ids){
  const endpoint='/admin/notifications/delete';
  try{
    const response=await fetch(VaultUser.WORKER_URL+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':AdminManager.getToken()},body:JSON.stringify({ids})});
    if(!response.ok){
      const detail=(await response.text()).trim();
      if(response.status===404)throw new Error(`The deployed Worker does not recognise POST ${endpoint} (HTTP 404). The latest Worker code on main includes this endpoint, so Cloudflare needs to deploy the latest main commit. Response: ${detail||response.statusText||'Not found'}`);
      throw new Error(`Could not delete notifications: HTTP ${response.status} ${response.statusText}. ${detail}`.trim());
    }
    const deleted=new Set(ids);
    adminNotifications=adminNotifications.filter(item=>!deleted.has(item.id));
    AdminManager.error='';
    renderAdmin();
  }catch(error){AdminManager.error=error.message||String(error);renderAdmin();}
}
function renderAdminNotifications(){
  const unread=adminNotifications.filter(item=>!item.read_at).length;
  const read=adminNotifications.length-unread;
  const pushLabel=adminPushEnabled?'Push notifications enabled':'Enable push notifications';
  return `<section class="panel"><div class="toolbar"><div><h2>Notifications</h2><p class="sub">${unread} unread · ${read} read</p></div><div class="actions"><button onclick="enableAdminPushNotifications()">${pushLabel}</button><button onclick="markAdminNotificationsRead()" ${unread?'':'disabled'}>Mark all read</button><button class="danger" onclick="clearReadAdminNotifications()" ${read?'':'disabled'}>Clear read</button></div></div><div class="queue">${adminNotifications.map(item=>`<article class="item ${item.read_at?'notification-read':''}"><div><div class="meta"><span class="tag">${esc(item.site)}</span><span>${esc(item.submitter)}</span><span>${esc(item.created_at)}</span><span class="tag">${item.read_at?'Read':'Unread'}</span></div><h2>${esc(item.title)}</h2><p>Submission ID: ${esc(item.item_id)}</p></div><div class="item-actions">${item.read_at?'':`<button onclick="markAdminNotificationRead('${esc(item.id)}')">Mark read</button>`}<button class="danger" onclick="deleteAdminNotification('${esc(item.id)}')">Delete</button></div></article>`).join('')||'<div class="empty">No submission notifications.</div>'}</div></section>`;
}
async function loadModerationLog(){
  if(!AdminManager.getToken())return;
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}/admin/moderation-log`,{headers:{'X-Session-Token':AdminManager.getToken()}});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    moderationLog=(await response.json()).entries||[];
    renderAdmin();
  }catch(error){AdminManager.error=error.message;renderAdmin();}
}
async function setLeaderboardHidden(username,hidden){
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}/admin/leaderboard-visibility`,{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':AdminManager.getToken()},body:JSON.stringify({username,hidden})});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    await AdminManager.refresh();
  }catch(error){AdminManager.error=error.message;renderAdmin();}
}
function renderOwnerAccounts(){
  if(AdminManager.role!=='owner')return '';
  const query=(window.adminAccountQuery||'').trim().toLowerCase();
  const role=window.adminAccountRole||'all';
  const users=(AdminManager.users||[]).filter(user=>(role==='all'||user.role===role)&&String(user.username).toLowerCase().includes(query));
  const pageSize=50;
  const pageCount=Math.max(1,Math.ceil(users.length/pageSize));
  const page=Math.min(window.adminAccountPage||0,pageCount-1);
  const visibleUsers=users.slice(page*pageSize,(page+1)*pageSize);
  return `<section class="panel" style="margin-top:18px">
    <h2>Owner controls</h2>
    <p class="sub">Manage account permissions, AI access, leaderboard visibility and legacy storage.</p>
    <div class="actions" style="margin-bottom:14px">
      <button onclick="AdminManager.migrateStorage()" ${AdminManager.migrating?'disabled':''}>${AdminManager.migrating?'Migrating storage…':'Migrate legacy storage to D1'}</button>
      <button onclick="AdminManager.refresh()">Refresh accounts</button>
    </div>
    ${AdminManager.migrationStatus?`<div class="notice">${esc(AdminManager.migrationStatus)}</div>`:''}
    <div class="filters">
      <input aria-label="Search accounts" placeholder="Search usernames…" value="${esc(query)}" oninput="window.adminAccountQuery=this.value"><button onclick="window.adminAccountPage=0;renderAdmin()">Search</button>
      <select aria-label="Filter accounts by role" onchange="window.adminAccountRole=this.value;window.adminAccountPage=0;renderAdmin()">
        <option value="all" ${role==='all'?'selected':''}>All roles</option>
        <option value="user" ${role==='user'?'selected':''}>Users</option>
        <option value="admin" ${role==='admin'?'selected':''}>Admins</option>
        <option value="owner" ${role==='owner'?'selected':''}>Owners</option>
      </select>
      <span class="sub">Showing ${users.length?Math.min(page*pageSize+1,users.length):0}–${Math.min((page+1)*pageSize,users.length)} of ${users.length} matching accounts</span>
    </div>
    <div class="queue">${visibleUsers.map(user=>`<article class="item">
      <div><strong>${esc(user.username)}</strong><p>Current role: ${esc(user.role)} · AI access: ${user.role!=='user'?'Inherited':user.ai_access?'Enabled':'Disabled'} · Leaderboard: ${user.leaderboard_hidden?'Hidden':'Visible'}</p></div>
      <div class="item-actions">
        <select aria-label="Role for ${esc(user.username)}" data-username="${esc(user.username)}" onchange="changeAccountRole(this)" ${user.role==='owner'?'disabled':''}>
          <option value="user" ${user.role==='user'?'selected':''}>User</option>
          <option value="admin" ${user.role==='admin'?'selected':''}>Admin</option>
        </select>
        <select aria-label="AI access for ${esc(user.username)}" data-username="${esc(user.username)}" onchange="AdminManager.setAIAccess(this.dataset.username,this.value==='1')" ${user.role!=='user'?'disabled':''}>
          <option value="0" ${!user.ai_access?'selected':''}>AI off</option>
          <option value="1" ${user.ai_access?'selected':''}>AI on</option>
        </select>
        <select aria-label="Leaderboard visibility for ${esc(user.username)}" data-username="${esc(user.username)}" onchange="setLeaderboardHidden(this.dataset.username,this.value==='1')">
          <option value="0" ${user.leaderboard_hidden?'':'selected'}>Leaderboard visible</option>
          <option value="1" ${user.leaderboard_hidden?'selected':''}>Leaderboard hidden</option>
        </select>
      </div>
    </article>`).join('')||'<div class="empty">No accounts match this filter.</div>'}</div><div class="actions" style="margin-top:12px"><button onclick="changeAccountPage(-1)" ${page===0?'disabled':''}>Previous</button><span class="sub">Page ${page+1} of ${pageCount}</span><button onclick="changeAccountPage(1)" ${page>=pageCount-1?'disabled':''}>Next</button></div>
  </section>`;
}
function changeAccountPage(direction){window.adminAccountPage=Math.max(0,(window.adminAccountPage||0)+direction);renderAdmin();}

async function changeAccountRole(select){
  const username=select.dataset.username;
  const role=select.value;
  if(!confirm(`Change ${username}'s role to ${role}?`)){
    await AdminManager.refresh();
    return;
  }
  select.disabled=true;
  await AdminManager.setRole(username,role);
}
function renderApprovalHistory(){
  return `<section class="panel" style="margin-top:18px"><h2>Moderation history</h2><p class="sub">Who reviewed, approved, denied or removed each submission, and when.</p><div class="queue">${moderationLog.map(entry=>`<article class="item"><div class="meta"><span class="tag">${esc(entry.site)}</span><span>${esc(entry.action)} by ${esc(entry.moderator)}</span><span>${esc(entry.acted_at)}</span></div><h2>${esc(entry.item_title)}</h2><p>Submitted by ${esc(entry.submitted_by)} · Record ${esc(entry.item_id)}</p></article>`).join('')||'<div class="empty">No approvals recorded yet.</div>'}</div></section>`;
}
function itemTitle(item){
  if(item._kind==="quote")return item.text||"Quote submission";
  if(item._kind==="date")return item.event||"Date submission";
  return item.title||item.description||"Feedback submission";
}
function itemSummary(item){
  if(item._kind==="quote")return [item.char,item.work,item.loc].filter(Boolean).join(" · ");
  if(item._kind==="date")return [item.year,item.topic].filter(Boolean).join(" · ");
  if(item._kind==="revision-note")return [item.subject,item.level,`${item.cards?.length||0} linked cards`].filter(Boolean).join(" · ");
  if(item._kind==="feedback")return [item.sourceApplication,item.errorName,item.browser,item.device,item.page].filter(Boolean).join(" · ") + (item.description ? " · " + item.description.slice(0,500) : "");
  return item.description||item.message||"";
}
function feedbackDetails(item){
  if(item._kind!=="feedback")return "";
  const fields=[
    ["Application",item.sourceApplication],
    ["Error type",item.errorName],
    ["Location",item.errorLocation],
    ["Page",item.page],
    ["Browser",item.browser],
    ["Device",item.device],
    ["App version",item.appVersion],
    ["Occurred",item.timestamp],
    ["Fingerprint",item.fingerprint]
  ].filter(([,value])=>value);
  const description=item.description||"No error description was captured.";
  return `<details class="feedback-diagnostics"><summary>Full error report · ${fields.length} diagnostic fields</summary><div class="diagnostic-fields">${fields.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div><h3>Captured message and context</h3><pre>${esc(description)}</pre>${item.errorStack?`<h3>JavaScript stack trace</h3><pre>${esc(item.errorStack)}</pre>`:""}<p class="sub">Report ID: ${esc(item.id||"Unavailable")}</p></details>`;
}
function login(){
  if(!VaultUser.getAccountSession()){VaultUser.showAccountDialog();return;}
  AdminManager.login().then(()=>{renderAdmin();loadModerationLog();loadAdminNotifications(false);checkAdminPushSubscription();});
}
function renderAdmin(){
  const token=AdminManager.getToken();
  document.getElementById("account-state").textContent=AdminManager.username?AdminManager.username:"";
  if(!token){
    app.innerHTML=`<h1>Moderation workspace</h1><p class="sub">Review and edit submissions from across GCSE Vault.</p><section class="panel"><h2>Admin sign in</h2><p class="sub">${VaultUser.getAccountSession()?"Your GCSE Vault account is signed in. Continue with its admin permissions.":"Sign into your GCSE Vault account first, then return here."}</p><div class="actions"><button class="primary" onclick="login()">Sign in to admin</button><button onclick="VaultUser.showAccountDialog()">Account settings</button></div>${AdminManager.error?`<div class="error">${esc(AdminManager.error)}</div>`:""}${!AdminManager.ownerInitialized?`<label class="field-label" for="admin-bootstrap-key">One-time owner setup key</label><input id="admin-bootstrap-key" type="password" autocomplete="off"><button onclick="bootstrapAdmin()">Set up owner</button>`:""}</section>`;
    if(!AdminManager.statusChecked)AdminManager.checkStatus();
    return;
  }
  if(!AdminManager.role){
    app.innerHTML='<div class="loading">Checking admin permissions…</div>';
    if(!AdminManager.loading)AdminManager.refresh();
    return;
  }
  const items=AdminManager.items||[];
  const q=window.adminQuery||"";
  const kind=window.adminKind||"all";
  const tab=window.adminTab||"review";
  const matches=item=>(kind==="all"||item._kind===kind)&&JSON.stringify(item).toLowerCase().includes(q.toLowerCase());
  const pending=items.filter(item=>item._pending!==false&&item._kind!=="feedback");
  const published=items.filter(item=>item._pending===false);
  const feedback=items.filter(item=>item._kind==="feedback");
  const pendingFiltered=pending.filter(matches);
  const publishedFiltered=published.filter(matches);
  const feedbackFiltered=feedback.filter(item=>JSON.stringify(item).toLowerCase().includes(q.toLowerCase()));
  const unread=adminNotifications.filter(item=>!item.read_at).length;
  const pendingCount=pending.length;
  const publishedCount=published.length;
  const counts=items.reduce((out,item)=>(out[item._kind]=(out[item._kind]||0)+1,out),{});
  const tabButton=(id,label,count)=>`<button class="admin-tab ${tab===id?'active':''}" onclick="window.adminTab='${id}';renderAdmin()" ${tab===id?'aria-current="page"':''}>${label}<span>${count}</span></button>`;
  let content="";
  if(tab==="review"||tab==="published"||tab==="feedback"){
    const selected=tab==="review"?pendingFiltered:tab==="published"?publishedFiltered:feedbackFiltered;
    const title=tab==="review"?"Awaiting review":tab==="published"?"Published content":"Feedback";
    content=`<div class="toolbar"><div><h2>${title}</h2><p class="sub">${selected.length} ${selected.length===1?'item':'items'}</p></div></div><div class="filters"><input aria-label="Search submissions" placeholder="Search content or submitter…" value="${esc(q)}" oninput="window.adminQuery=this.value"><button onclick="renderAdmin()">Search</button><select aria-label="Filter submission type" onchange="window.adminKind=this.value;renderAdmin()"><option value="all" ${kind==="all"?'selected':''}>All types</option><option value="quote" ${kind==="quote"?'selected':''}>QuoteVault</option><option value="date" ${kind==="date"?'selected':''}>DateVault</option><option value="revision-note" ${kind==="revision-note"?'selected':''}>Revision notes</option><option value="feedback" ${kind==="feedback"?'selected':''}>Feedback</option></select></div><section class="queue">${selected.map(item=>`<article class="item"><div><div class="meta"><span class="tag">${esc(item._source||item._kind)}</span><span>${esc(item.submittedBy||"Submitter not recorded")}</span><span>${esc(item.submittedAt||item.timestamp||"Date not recorded")}</span><span class="tag">${item._pending===false?"Published":item._kind==="feedback"?"Feedback":"Pending"}</span></div><h2>${esc(itemTitle(item))}</h2><p>${esc(itemSummary(item))}</p>${feedbackDetails(item)}</div><div class="item-actions"><a class="button primary" href="editor.html?kind=${encodeURIComponent(item._kind)}&id=${encodeURIComponent(item.id)}">Open editor</a>${renderQueueActions(item)}</div></article>`).join("")||'<div class="empty">Nothing in this section matches your filters.</div>'}</section>`;
  }else if(tab==="notifications"){
    content=renderAdminNotifications();
  }else if(tab==="users"){
    content=AdminManager.role==="owner"?renderOwnerAccounts():'<div class="empty">Only the owner can manage accounts.</div>';
  }else if(tab==="history"){
    content=renderApprovalHistory();
  }
  app.innerHTML=`<div class="toolbar"><div><h1>Admin workspace</h1><p class="sub">${esc(AdminManager.username)} · ${esc(AdminManager.role)} access</p></div><div class="actions"><button onclick="AdminManager.refresh()">Refresh</button><button onclick="AdminManager.logout()">Sign out</button></div></div>
  <div class="stats"><div class="stat"><strong>${pendingCount}</strong> awaiting review</div><div class="stat"><strong>${publishedCount}</strong> published</div><div class="stat"><strong>${counts.quote||0}</strong> quotes</div><div class="stat"><strong>${counts.date||0}</strong> dates</div><div class="stat"><strong>${counts['revision-note']||0}</strong> revision notes</div><div class="stat"><strong>${counts.feedback||0}</strong> feedback</div></div>
  <nav class="admin-tabs" aria-label="Admin sections">${tabButton("review","To review",pendingCount)}${tabButton("published","Published",publishedCount)}${tabButton("feedback","Feedback",feedback.length)}${tabButton("notifications","Notifications",unread)}${AdminManager.role==="owner"?tabButton("users","Users",(AdminManager.users||[]).length):""}${tabButton("history","History",moderationLog.length)}</nav>
  ${AdminManager.error?`<div class="error">${esc(AdminManager.error)}</div>`:""}
  ${AdminManager.loading?'<div class="notice">Refreshing submissions…</div>':""}
  ${content}`;
}
async function bootstrapAdmin(){
  const input=document.getElementById("admin-bootstrap-key");
  AdminManager.bootstrap();
  if(input)input.value="";
}
async function moderate(kind,action,id){
  const routes={quote:{approve:"/approve",reject:"/reject"},date:{approve:"/dv/approve",reject:"/dv/reject"},"revision-note":{approve:"/revision/public/approve",reject:"/revision/public/reject"}};
  const path=routes[kind]?.[action];
  if(!path)return;
  if(!confirm(`${action==="approve"?"Approve and publish":"Reject"} this submission?`))return;
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}${path}`,{method:"POST",headers:{"Content-Type":"application/json","X-Session-Token":AdminManager.getToken()},body:JSON.stringify({id})});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    await AdminManager.refresh();
    await loadModerationLog();
  }catch(error){AdminManager.error=error.message;renderAdmin();}
}
async function deleteFeedback(id){
  if(!confirm("Permanently delete this feedback item?"))return;
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}/feedback/delete`,{method:"POST",headers:{"Content-Type":"application/json","X-Session-Token":AdminManager.getToken()},body:JSON.stringify({id})});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    await AdminManager.refresh();
  }catch(error){AdminManager.error=error.message;renderAdmin();}
}
if(AdminManager.getToken()){
  AdminManager.refresh().then(()=>{loadModerationLog();loadAdminNotifications(false);checkAdminPushSubscription();});
  if(!adminNotificationPoll)adminNotificationPoll=setInterval(()=>loadAdminNotifications(false),30000);
}else AdminManager.checkStatus();

function renderQueueActions(item){
  if(item._kind==="feedback")return '<button class="danger" onclick="deleteFeedback(\''+esc(item.id)+'\')">Delete</button>';
  if(item._pending===false&&item._kind==="revision-note")return '<button class="danger" onclick="deleteRevisionNote(\''+esc(item.id)+'\')">Remove from public site</button>';
  if(item._pending===false)return '<button class="danger" onclick="removePublished(\''+esc(item._kind)+'\',\''+esc(item.id)+'\')">Remove from public site</button>';
  return '<button class="success" onclick="moderate(\''+esc(item._kind)+'\',\'approve\',\''+esc(item.id)+'\')">Approve</button><button class="danger" onclick="moderate(\''+esc(item._kind)+'\',\'reject\',\''+esc(item.id)+'\')">Reject</button>';
}
async function removePublished(kind,id){
  if(!confirm("Remove this approved item from the public site? It will no longer be visible to everyone."))return;
  const path=kind==="quote"?"/delete":"/dv/delete";
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}${path}`,{method:"POST",headers:{"Content-Type":"application/json","X-Session-Token":AdminManager.getToken()},body:JSON.stringify({id})});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    await AdminManager.refresh();
    await loadModerationLog();
  }catch(error){AdminManager.error=error.message;renderAdmin();}
}
async function deleteRevisionNote(id){
  if(!confirm("Delete this public revision note?"))return;
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}/revision/public/admin-delete`,{method:"POST",headers:{"Content-Type":"application/json","X-Session-Token":AdminManager.getToken()},body:JSON.stringify({id})});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    await AdminManager.refresh();
  }catch(error){AdminManager.error=error.message;renderAdmin();}
}
