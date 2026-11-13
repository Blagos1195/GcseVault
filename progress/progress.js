const progressStatus=document.getElementById("status");
const progressDashboard=document.getElementById("dashboard");
const signInPanel=document.getElementById("sign-in");
const progressAccount=document.getElementById("account-name");
const progressUpdated=document.getElementById("updated-at");

function showProgressSignIn(message){
  progressStatus.textContent=message;
  signInPanel.hidden=false;
  progressDashboard.hidden=true;
  progressAccount.hidden=true;
}

function setProgressValue(id,value){
  document.getElementById(id).textContent=String(value);
}

function renderProgressSummary(data){
  const quote=data.quoteVault||{};
  const date=data.dateVault||{};
  const revision=data.revision||{};
  setProgressValue("qv-due",quote.due||0);
  setProgressValue("qv-scheduled",quote.scheduled||0);
  setProgressValue("qv-mastered",quote.mastered||0);
  setProgressValue("qv-xp",quote.xp||0);
  setProgressValue("dv-due",date.due||0);
  setProgressValue("dv-scheduled",date.scheduled||0);
  setProgressValue("dv-mastered",date.mastered||0);
  setProgressValue("dv-xp",date.xp||0);
  setProgressValue("revision-reviewed",revision.reviewed||0);
  setProgressValue("revision-total",revision.cards||0);
  setProgressValue("revision-sets",revision.sets||0);
  setProgressValue("revision-due",revision.due||0);
  setProgressValue("revision-xp",revision.xp||0);
  document.getElementById("revision-bar").style.width=(revision.cards?Math.min(100,(revision.reviewed/revision.cards)*100):0)+"%";
  const username=data.account?.username||VaultUser.getUsername()||"Signed-in account";
  progressAccount.textContent="Signed in as "+username+(data.account?.streak? " · "+data.account.streak+" day streak":"");
  progressAccount.hidden=false;
  progressStatus.hidden=true;
  progressDashboard.hidden=false;
  signInPanel.hidden=true;
  const timestamps=[quote.updatedAt,date.updatedAt,revision.updatedAt].filter(Boolean).sort();
  progressUpdated.textContent=timestamps.length?"Synced data updated "+new Date(timestamps[timestamps.length-1]).toLocaleString():"No synced study data yet";
}

async function loadProgressSummary(){
  const token=VaultUser.getAccountSession();
  if(!token){
    showProgressSignIn("You are not signed in.");
    return;
  }
  progressStatus.hidden=false;
  progressStatus.textContent="Loading your progress…";
  signInPanel.hidden=true;
  progressDashboard.hidden=true;
  try{
    const response=await fetch(VaultUser.WORKER_URL+"/account/progress-summary",{headers:{"X-Account-Session":token}});
    const data=await VaultUser.readResponse(response);
    if(token!==VaultUser.getAccountSession())return;
    if(response.status===401){
      showProgressSignIn("Your session needs a password sign-in.");
      return;
    }
    if(!response.ok)throw new Error(data.error||data.message||"Could not load your progress.");
    renderProgressSummary(data);
  }catch(error){
    progressStatus.textContent=error.message||"Could not load your progress. Check your connection and try again.";
  }
}

document.getElementById("refresh").addEventListener("click",loadProgressSummary);
window.addEventListener("storage",event=>{
  if(event.key==="vault_account_session")loadProgressSummary();
});
loadProgressSummary();
