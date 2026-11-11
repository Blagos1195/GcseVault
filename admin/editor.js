const app=document.getElementById("app");
const params=new URLSearchParams(location.search);
const kind=params.get("kind")||"";
const id=params.get("id")||"";
let selected=null;
let loaded=false;
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
window.openModal=html=>{document.getElementById("modal").innerHTML=html;document.getElementById("modal-bg").classList.add("open");};
window.closeModal=()=>document.getElementById("modal-bg").classList.remove("open");
window.render=renderEditor;
function renderEditor(){
  if(!AdminManager.getToken()){
    app.innerHTML='<h1>Submission editor</h1><p class="sub">Admin sign-in is required.</p><button onclick="VaultUser.showAccountDialog()">Account settings</button><button class="primary" onclick="AdminManager.login()">Sign in to admin</button><a class="button" href="./">Return to queue</a>';
    return;
  }
  if(!loaded){
    app.innerHTML='<div class="loading">Loading submission…</div>';
    if(!AdminManager.loading)AdminManager.refresh().then(()=>{selected=AdminManager.items.find(item=>item._kind===kind&&String(item.id)===id)||null;loaded=true;renderEditor();});
    return;
  }
  if(!selected){
    app.innerHTML='<div class="notice">This submission is no longer in the pending queue.</div><a class="button" href="./">Return to queue</a>';
    return;
  }
  const data={...selected};delete data._source;delete data._kind;delete data._pending;
  app.innerHTML=`<div class="toolbar"><div><h1>Edit submission</h1><p class="sub">${esc(selected._source)} · ${esc(selected.id)}</p></div><a class="button" href="./">Back to queue</a></div>
  <div class="editor-layout"><section class="editor-main"><h2>Submitted content</h2><p class="sub">Edit the complete submission as JSON. All editable fields are included below; the submission ID and original submission time are protected.</p><textarea id="submission-json" spellcheck="false" aria-label="Complete submission JSON">${esc(JSON.stringify(data,null,2))}</textarea><div id="editor-error" role="alert"></div><div class="actions" style="margin-top:14px"><button class="primary" onclick="saveSubmission()">Save changes</button>${selected._kind==="feedback"?"":`<button class="success" onclick="moderateSubmission('approve')">Approve and publish</button><button class="danger" onclick="moderateSubmission('reject')">Reject</button>`}</div></section>
  <aside class="sidebar"><h2>Submission details</h2><dl><dt>Source</dt><dd>${esc(selected._source)}</dd><dt>Submitted by</dt><dd>${esc(selected.submittedBy||"Not recorded")}</dd><dt>Submitted</dt><dd>${esc(selected.submittedAt||selected.timestamp||"Not recorded")}</dd><dt>Record ID</dt><dd>${esc(selected.id)}</dd><dt>Current title</dt><dd>${esc(selected.text||selected.event||selected.title||"Untitled")}</dd></dl><div class="notice">Only the content fields are editable. Internal account/session details are not exposed here.</div></aside></div>`;
}
async function saveSubmission(){
  const output=document.getElementById("editor-error");
  let data;
  try{data=JSON.parse(document.getElementById("submission-json").value);}catch(error){output.className="error";output.textContent="Invalid JSON: "+error.message;return;}
  if(!data||typeof data!=="object"||Array.isArray(data)){output.className="error";output.textContent="The submission must be a JSON object.";return;}
  data.id=selected.id;
  if(selected.submittedAt)data.submittedAt=selected.submittedAt;
  if(selected.submittedBy)data.submittedBy=selected.submittedBy;
  const routes={quote:"/update-pending",date:"/dv/update-pending","revision-note":"/revision/public/update"};
  const path=routes[kind];
  if(!path){output.className="error";output.textContent="This submission type cannot be edited.";return;}
  const body={id};
  if(kind==="revision-note")body.note=data;else body.data=data;
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}${path}`,{method:"POST",headers:{"Content-Type":"application/json","X-Session-Token":AdminManager.getToken()},body:JSON.stringify(body)});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    selected={...selected,...data};
    output.className="success-text";output.textContent="Changes saved.";
    await AdminManager.refresh();
  }catch(error){output.className="error";output.textContent=error.message;}
}
async function moderateSubmission(action){
  const routes={quote:{approve:"/approve",reject:"/reject"},date:{approve:"/dv/approve",reject:"/dv/reject"},"revision-note":{approve:"/revision/public/approve",reject:"/revision/public/reject"}};
  const path=routes[kind]?.[action];
  if(!path)return;
  if(!confirm(`${action==="approve"?"Approve and publish":"Reject"} this submission?`))return;
  try{
    const response=await fetch(`${VaultUser.WORKER_URL}${path}`,{method:"POST",headers:{"Content-Type":"application/json","X-Session-Token":AdminManager.getToken()},body:JSON.stringify({id})});
    if(!response.ok)throw new Error(await response.text()||`HTTP ${response.status}`);
    location.href="./";
  }catch(error){const output=document.getElementById("editor-error");output.className="error";output.textContent=error.message;}
}
window.render=renderEditor;
if(AdminManager.getToken())AdminManager.refresh().then(()=>{selected=AdminManager.items.find(item=>item._kind===kind&&String(item.id)===id)||null;renderEditor();});else renderEditor();
