const app=document.getElementById("app");
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
window.openModal=html=>{document.getElementById("modal").innerHTML=html;document.getElementById("modal-bg").classList.add("open");};
window.closeModal=()=>document.getElementById("modal-bg").classList.remove("open");
window.render=renderAdmin;
let moderationLog = [];
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
  return `<section class="panel" style="margin-top:18px">
    <h2>Owner controls</h2>
    <p class="sub">Manage account permissions, AI access, leaderboard visibility and legacy storage.</p>
    <div class="actions" style="margin-bottom:14px">
      <button onclick="AdminManager.migrateStorage()" \${AdminManager.migrating?'disabled':''}>\${AdminManager.migrating?'Migrating storage…':'Migrate legacy storage to D1'}</button>
      <button onclick="AdminManager.refresh()">Refresh accounts</button>
    </div>
    \${AdminManager.migrationStatus?`<div class="notice">\${esc(AdminManager.migrationStatus)}</div>`:''}
    <div class="filters">
      <input aria-label="Search accounts" placeholder="Search usernames…" value="\${esc(query)}" oninput="window.adminAccountQuery=this.value"><button onclick="renderAdmin()">Search</button>>
      <select aria-label="Filter accounts by role" onchange="window.adminAccountRole=this.value;renderAdmin()">
        <option value="all" \${role==='all'?'selected':''}>All roles</option>
        <option value="user" \${role==='user'?'selected':''}>Users</option>
        <option value="admin" \${role==='admin'?'selected':''}>Admins</option>
        <option value="owner" \${role==='owner'?'selected':''}>Owners</option>
      </select>
      <span class="sub">\${users.length} of \${(AdminManager.users||[]).length} accounts</span>
    </div>
    <div class="queue">\${users.map(user=>`<article class="item">
      <div><strong>\${esc(user.username)}</strong><p>Current role: \${esc(user.role)} · AI access: \${user.role!=='user'?'Inherited':user.ai_access?'Enabled':'Disabled'} · Leaderboard: \${user.leaderboard_hidden?'Hidden':'Visible'}</p></div>
      <div class="item-actions">
        <select aria-label="Role for \${esc(user.username)}" data-username="\${esc(user.username)}" onchange="changeAccountRole(this)" \${user.role==='owner'?'disabled':''}>
          <option value="user" \${user.role==='user'?'selected':''}>User</option>
          <option value="admin" \${user.role==='admin'?'selected':''}>Admin</option>
        </select>
        <select aria-label="AI access for \${esc(user.username)}" data-username="\${esc(user.username)}" onchange="AdminManager.setAIAccess(this.dataset.username,this.value==='1')" \${user.role!=='user'?'disabled':''}>
          <option value="0" \${!user.ai_access?'selected':''}>AI off</option>
          <option value="1" \${user.ai_access?'selected':''}>AI on</option>
        </select>
        <select aria-label="Leaderboard visibility for \${esc(user.username)}" data-username="\${esc(user.username)}" onchange="setLeaderboardHidden(this.dataset.username,this.value==='1')">
          <option value="0" \${user.leaderboard_hidden?'':'selected'}>Leaderboard visible</option>
          <option value="1" \${user.leaderboard_hidden?'selected':''}>Leaderboard hidden</option>
        </select>
      </div>
    </article>`).join('')||'<div class="empty">No accounts match this filter.</div>'}</div>
  </section>`;
}
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
  return `<section class="panel" style="margin-top:18px"><h2>Approval history</h2><p class="sub">Who approved each published submission and when.</p><div class="queue">${moderationLog.map(entry=>`<article class="item"><div class="meta"><span class="tag">${esc(entry.site)}</span><span>Approved by ${esc(entry.moderator)}</span><span>${esc(entry.acted_at)}</span></div><h2>${esc(entry.item_title)}</h2><p>Submitted by ${esc(entry.submitted_by)} · Record ${esc(entry.item_id)}</p></article>`).join('')||'<div class="empty">No approvals recorded yet.</div>'}</div></section>`;
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
  return item.description||item.message||"";
}
function login(){
  if(!VaultUser.getAccountSession()){VaultUser.showAccountDialog();return;}
  AdminManager.login().then(()=>{renderAdmin();loadModerationLog();});
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
  const filtered=items.filter(item=>(kind==="all"||item._kind===kind)&&JSON.stringify(item).toLowerCase().includes(q.toLowerCase()));
  const pendingCount=items.filter(item=>item._pending!==false&&item._kind!=="feedback").length;
  const publishedCount=items.filter(item=>item._pending===false).length;
  const counts=items.reduce((out,item)=>(out[item._kind]=(out[item._kind]||0)+1,out),{});
  app.innerHTML=`<div class="toolbar"><div><h1>Moderation queue</h1><p class="sub">${esc(AdminManager.username)} · ${esc(AdminManager.role)} access</p></div><div class="actions"><button onclick="AdminManager.refresh()">Refresh queue</button><button onclick="AdminManager.logout()">Sign out</button></div></div>
  <div class="stats"><div class="stat"><strong>${pendingCount}</strong> awaiting review</div><div class="stat"><strong>${publishedCount}</strong> published</div><div class="stat"><strong>${counts.quote||0}</strong> quotes</div><div class="stat"><strong>${counts.date||0}</strong> dates</div><div class="stat"><strong>${counts['revision-note']||0}</strong> revision notes</div><div class="stat"><strong>${counts.feedback||0}</strong> feedback</div></div>
  <div class="filters"><input aria-label="Search submissions" placeholder="Search submitted content, source, or submitter…" value="${esc(q)}" oninput="window.adminQuery=this.value"><button onclick="renderAdmin()">Search</button><select aria-label="Filter submission type" onchange="window.adminKind=this.value;renderAdmin()"><option value="all" ${kind==="all"?"selected":""}>All types</option><option value="quote" ${kind==="quote"?"selected":""}>QuoteVault</option><option value="date" ${kind==="date"?"selected":""}>DateVault</option><option value="revision-note" ${kind==="revision-note"?"selected":""}>Revision notes</option><option value="feedback" ${kind==="feedback"?"selected":""}>Feedback</option></select></div>
  ${AdminManager.error?`<div class="error">${esc(AdminManager.error)}</div>`:""}
  ${AdminManager.loading?'<div class="notice">Refreshing submissions…</div>':""}
  <section class="queue">${filtered.map(item=>`<article class="item"><div><div class="meta"><span class="tag">${esc(item._source||item._kind)}</span><span>${esc(item.submittedBy||"Submitter not recorded")}</span><span>${esc(item.submittedAt||item.timestamp||"Date not recorded")}</span><span class="tag">${item._pending===false?"Published":"Pending"}</span></div><h2>${esc(itemTitle(item))}</h2><p>${esc(itemSummary(item))}</p></div><div class="item-actions"><a class="button primary" href="editor.html?kind=${encodeURIComponent(item._kind)}&id=${encodeURIComponent(item.id)}">Open editor</a>${renderQueueActions(item)}</div></article>`).join("")||'<div class="empty">No submissions match this filter.</div>'}</section>${renderOwnerAccounts()}${renderApprovalHistory()}`;
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
if(AdminManager.getToken())AdminManager.refresh().then(loadModerationLog);else AdminManager.checkStatus();

function renderQueueActions(item){
  if(item._kind==="feedback")return '<button class="danger" onclick="deleteFeedback(\\''+esc(item.id)+'\\')">Delete</button>';
  if(item._pending===false&&item._kind==="revision-note")return '<button class="danger" onclick="deleteRevisionNote(\\''+esc(item.id)+'\\')">Remove from public site</button>';
  if(item._pending===false)return '<button class="danger" onclick="removePublished(\\''+esc(item._kind)+'\\',\\''+esc(item.id)+'\\')">Remove from public site</button>';
  return '<button class="success" onclick="moderate(\\''+esc(item._kind)+'\\',\\'approve\\',\\''+esc(item.id)+'\\')">Approve</button><button class="danger" onclick="moderate(\\''+esc(item._kind)+'\\',\\'reject\\',\\''+esc(item.id)+'\\')">Reject</button>';
}
async function removePublished(kind,id){
  if(!confirm("Remove this approved item from the public site? It will no longer be visible to everyone."))return;
  const path=kind==="quote"?"/delete":"/dv/delete";
  try{
    const response=await fetch(`\${VaultUser.WORKER_URL}\${path}`,{method:"POST",headers:{"Content-Type":"application/json","X-Session-Token":AdminManager.getToken()},body:JSON.stringify({id})});
    if(!response.ok)throw new Error(await response.text()||`HTTP \${response.status}`);
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
