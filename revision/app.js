const REVISION_KEY = 'revision_knowledge_cards';
const REVISION_PROGRESS_KEY = 'revision_knowledge_progress';
const starterCards = [
  {id:'r1',subject:'History',topic:'Industrial Revolution',title:'Why did cities grow?',answer:'Factories created jobs, drawing people from rural areas into expanding industrial cities.',links:['r2'],difficulty:2},
  {id:'r2',subject:'History',topic:'Industrial Revolution',title:'What was urbanisation?',answer:'The movement of people from the countryside to towns and cities.',links:['r1','r3'],difficulty:1},
  {id:'r3',subject:'History',topic:'Industrial Revolution',title:'What problems did urbanisation cause?',answer:'Overcrowding, poor sanitation, disease, pollution and unsafe housing.',links:['r2'],difficulty:3},
  {id:'r4',subject:'Science',topic:'Cells',title:'What do mitochondria do?',answer:'They release energy through aerobic respiration.',links:[],difficulty:2}
];
const storedCards = JSON.parse(localStorage.getItem(REVISION_KEY) || 'null');
const onlyDemoCards = Array.isArray(storedCards) && storedCards.length > 0 && storedCards.every(card => ['r1','r2','r3','r4'].includes(card.id));
const revisionAccountSetsKey = 'revision_account_sets';
const revisionActiveSetKey = 'revision_active_set';
const DEFAULT_REVISION_SET_ID = 'default';
function normalizeRevisionSet(set, fallbackId){
  const id = set && set.id ? String(set.id) : fallbackId || `${DEFAULT_REVISION_SET_ID}-${Date.now()}`;
  return {
    id,
    name: set && set.name ? String(set.name) : 'My main set',
    cards: Array.isArray(set && set.cards) ? set.cards : [],
    progress: set && set.progress && typeof set.progress === 'object' ? set.progress : {},
    xp: Number(set && set.xp) || 0,
    streak: Number(set && set.streak) || 0,
    lastReview: set && set.lastReview ? String(set.lastReview) : '',
    dailyGoal: Math.max(1, Math.min(200, Number(set && set.dailyGoal) || 20)),
    published: Boolean(set && set.published),
    syllabus: Array.isArray(set && set.syllabus) ? set.syllabus : [],
    syllabusDone: set && set.syllabusDone && typeof set.syllabusDone === 'object' ? set.syllabusDone : {},
    reviewLog: Array.isArray(set && set.reviewLog) ? set.reviewLog : [],
    practice: set && set.practice && typeof set.practice === 'object' ? {
      catalogues: set.practice.catalogues && typeof set.practice.catalogues === 'object' ? set.practice.catalogues : {},
      attempts: Array.isArray(set.practice.attempts) ? set.practice.attempts : [],
      mistakes: Array.isArray(set.practice.mistakes) ? set.practice.mistakes : [],
      formulas: Array.isArray(set.practice.formulas) ? set.practice.formulas : [],
      resources: Array.isArray(set.practice.resources) ? set.practice.resources : []
    } : {catalogues:{},attempts:[],mistakes:[],formulas:[],resources:[]}
  };
}
const revisionStartupUserKey = VaultUser.getAccountSession() ? VaultUser.getKey() : null;
let revisionStartupSnapshot = null;
try {
  revisionStartupSnapshot = JSON.parse(localStorage.getItem(`revision_local_snapshot:${revisionStartupUserKey || 'anonymous'}`) || 'null');
} catch {}
const revisionUseLegacyLocal = !VaultUser.getKey();
const existingRevisionSets = revisionStartupSnapshot?.accountSets || (revisionUseLegacyLocal ? JSON.parse(localStorage.getItem(revisionAccountSetsKey) || 'null') : null);
const activeSetId = revisionStartupSnapshot?.activeSetId || (revisionUseLegacyLocal ? localStorage.getItem(revisionActiveSetKey) : null) || DEFAULT_REVISION_SET_ID;
const existingSetList = Array.isArray(existingRevisionSets) && existingRevisionSets.length ? existingRevisionSets.map(set => normalizeRevisionSet(set, DEFAULT_REVISION_SET_ID)) : [];
const fallbackSet = normalizeRevisionSet({
  id: activeSetId,
  name: 'My main set',
  cards: revisionStartupSnapshot?.cards || (revisionUseLegacyLocal && !onlyDemoCards ? (storedCards || []) : []),
  progress: revisionStartupSnapshot?.progress || (revisionUseLegacyLocal ? JSON.parse(localStorage.getItem(REVISION_PROGRESS_KEY) || '{}') : {}),
  xp: Number(revisionStartupSnapshot?.xp ?? (revisionUseLegacyLocal ? localStorage.getItem('revision_xp') : 0)) || 0,
  streak: Number(revisionStartupSnapshot?.streak ?? (revisionUseLegacyLocal ? localStorage.getItem('revision_streak') : 0)) || 0,
  lastReview: revisionStartupSnapshot?.lastReview || (revisionUseLegacyLocal ? localStorage.getItem('revision_last_review') : '') || ''
}, activeSetId);
const initialRevisionSets = existingSetList.length ? existingSetList : [fallbackSet];
const selectedRevisionSet = initialRevisionSets.find(set => set.id === activeSetId) || initialRevisionSets[0];
const state = {
  cards: Array.isArray(selectedRevisionSet?.cards) ? selectedRevisionSet.cards : (revisionStartupSnapshot?.cards || (revisionUseLegacyLocal && !onlyDemoCards ? (storedCards || []) : [])),
  progress: selectedRevisionSet && selectedRevisionSet.progress ? selectedRevisionSet.progress : (revisionStartupSnapshot?.progress || (revisionUseLegacyLocal ? JSON.parse(localStorage.getItem(REVISION_PROGRESS_KEY) || '{}') : {})),
  accountSets: initialRevisionSets,
  activeSetId: selectedRevisionSet ? selectedRevisionSet.id : DEFAULT_REVISION_SET_ID,
  publishSetId: selectedRevisionSet ? selectedRevisionSet.id : DEFAULT_REVISION_SET_ID,
  view: 'overview', selected: null, studyIndex: 0, revealed: false,
  xp: Number(selectedRevisionSet?.xp ?? revisionStartupSnapshot?.xp ?? (revisionUseLegacyLocal ? localStorage.getItem('revision_xp') : 0)),
  streak: Number(selectedRevisionSet?.streak ?? revisionStartupSnapshot?.streak ?? (revisionUseLegacyLocal ? localStorage.getItem('revision_streak') : 0)),
  lastReview: selectedRevisionSet?.lastReview || revisionStartupSnapshot?.lastReview || (revisionUseLegacyLocal ? localStorage.getItem('revision_last_review') : '') || '',
  publicNotes: [], aiResult: null, aiNotice:'', syncing: false, syncStatus: 'local', accountMessage: '', accountMessageType: 'success', themeMessage: '', setMessage: '', confirmClearData:false, publicMessage: '', publicMessageType: 'success', aiDraft: {subject:'',level:'',notes:'',setName:'',count:'30',source:'',mode:'new'}, editingSetId: null, confirmDeleteSetId: null, setMessageType: 'success', linkSource: null, editingCard: null,
  studyQueue: [], studySessionActive: false, sessionReviewed: 0, bulkSelected: [], libraryQuery:'', librarySubject:'all', libraryTopic:'all', libraryDue:'all', librarySort:'due', connectionCardId:null, connectionTargetId:null, connectionRevealed:false, syllabusDraft:'', uploadMessage:'', analyticsRange:30
};

function getActiveRevisionSet(){
  return state.accountSets.find(set => set.id === state.activeSetId) || state.accountSets[0] || normalizeRevisionSet({id:DEFAULT_REVISION_SET_ID,name:'My main set',cards:state.cards,progress:state.progress,xp:state.xp,streak:state.streak,lastReview:state.lastReview}, DEFAULT_REVISION_SET_ID);
}
function syncActiveRevisionSet(){
  const activeSet = getActiveRevisionSet();
  if (!activeSet) return;
  activeSet.cards = state.cards;
  activeSet.progress = state.progress;
  activeSet.xp = state.xp;
  activeSet.streak = state.streak;
  activeSet.lastReview = state.lastReview;
  activeSet.syllabus = activeSet.syllabus || [];
  activeSet.syllabusDone = activeSet.syllabusDone || {};
  activeSet.reviewLog = activeSet.reviewLog || [];
  localStorage.setItem(revisionAccountSetsKey, JSON.stringify(state.accountSets));
  localStorage.setItem(revisionActiveSetKey, state.activeSetId);
}
let revisionActiveScope=revisionStartupUserKey;
function revisionLocalUpdatedAtKey(userKey=revisionUserKey()){
  if(!userKey)return 'revision_local_updated_at';
  const key=`revision_local_updated_at:${userKey}`;
  const legacy=localStorage.getItem('revision_local_updated_at');
  if(!localStorage.getItem(key)&&legacy&&!localStorage.getItem('revision_local_updated_at_migrated')){
    localStorage.setItem(key,legacy);
    localStorage.setItem('revision_local_updated_at_migrated','1');
  }
  return key;
}
function saveRevision(remote=false){
  if(!remote)localStorage.setItem(revisionLocalUpdatedAtKey(revisionActiveScope),new Date().toISOString());
  localStorage.setItem(REVISION_KEY,JSON.stringify(state.cards));
  localStorage.setItem(REVISION_PROGRESS_KEY,JSON.stringify(state.progress));
  localStorage.setItem('revision_xp',String(state.xp));
  localStorage.setItem('revision_streak',String(state.streak));
  localStorage.setItem('revision_last_review',state.lastReview);
  syncActiveRevisionSet();
  if(!remote)syncRevisionSoon();
}
function revisionSnapshotKey(userKey){
  return `revision_local_snapshot:${userKey||'anonymous'}`;
}
function captureRevisionSnapshot(userKey=revisionActiveScope){
  const updatedAt=localStorage.getItem(revisionLocalUpdatedAtKey(userKey))||'';
  if(userKey&&updatedAt)localStorage.setItem(revisionLocalUpdatedAtKey(userKey),updatedAt);
  localStorage.setItem('revision_local_updated_at_migrated','1');
  const snapshot={
    accountSets:state.accountSets,
    activeSetId:state.activeSetId,
    cards:state.cards,
    progress:state.progress,
    xp:state.xp,
    streak:state.streak,
    lastReview:state.lastReview,
    updatedAt
  };
  localStorage.setItem(revisionSnapshotKey(userKey),JSON.stringify(snapshot));
}
function restoreRevisionSnapshot(userKey){
  let snapshot=null;
  try{snapshot=JSON.parse(localStorage.getItem(revisionSnapshotKey(userKey))||'null');}catch{}
  if(snapshot){
    state.accountSets=Array.isArray(snapshot.accountSets)?snapshot.accountSets.map(set=>normalizeRevisionSet(set,DEFAULT_REVISION_SET_ID)):initialRevisionSets;
    state.bulkSelected=[];
    state.activeSetId=snapshot.activeSetId||state.accountSets[0]?.id||DEFAULT_REVISION_SET_ID;
    state.publishSetId=state.activeSetId;
    state.cards=Array.isArray(snapshot.cards)?snapshot.cards:[];
    state.progress=snapshot.progress&&typeof snapshot.progress==='object'?snapshot.progress:{};
    state.xp=Number(snapshot.xp)||0;
    state.streak=Number(snapshot.streak)||0;
    state.lastReview=snapshot.lastReview||'';
    if(snapshot.updatedAt)localStorage.setItem(revisionLocalUpdatedAtKey(userKey),snapshot.updatedAt);
    else localStorage.removeItem(revisionLocalUpdatedAtKey(userKey));
  }else{
    state.accountSets=[normalizeRevisionSet({id:DEFAULT_REVISION_SET_ID,name:'My main set',cards:[],progress:{},xp:0,streak:0,lastReview:''},DEFAULT_REVISION_SET_ID)];
    state.activeSetId=DEFAULT_REVISION_SET_ID;
    state.publishSetId=DEFAULT_REVISION_SET_ID;
    state.cards=[];
    state.progress={};
    state.xp=0;
    state.streak=0;
    state.lastReview='';
    localStorage.removeItem(revisionLocalUpdatedAtKey(userKey));
  }
  revisionActiveScope=userKey||null;
  saveRevision(true);
}
window.prepareRevisionAccountLogout=function(){
  captureRevisionSnapshot(revisionActiveScope);
};
window.finishRevisionAccountLogout=function(){
  restoreRevisionSnapshot(null);
  state.syncStatus='local';
  state.accountMessage='';
  renderRevision();
};
window.prepareRevisionAccountSwitch=function(){
  captureRevisionSnapshot(revisionActiveScope);
};
window.activateRevisionAccount=function(userKey){
  const key=VaultUser.getAccountSession()?userKey:null;
  if(key&&!localStorage.getItem(revisionSnapshotKey(key))){
    let anonymous=null;
    try{anonymous=JSON.parse(localStorage.getItem(revisionSnapshotKey('anonymous'))||'null');}catch{}
    if(anonymous&&(anonymous.cards?.length||anonymous.accountSets?.some(set=>set.cards?.length))&&window.confirm("This device has revision data that is not linked to an account. Import it into "+VaultUser.getUsername()+"? Choose Cancel to keep it separate.")){
      localStorage.setItem(revisionSnapshotKey(key),JSON.stringify(anonymous));
    }
  }
  restoreRevisionSnapshot(key);
  state.syncStatus=key?'syncing':'local';
  state.accountMessage='';
  state.accountMessageType='success';
  renderRevision();
};

window.addEventListener('storage',event=>{
  if(event.key!=='vault_account_session'&&event.key!=='vault_userKey')return;
  const next=VaultUser.getAccountSession()?VaultUser.getKey():null;
  if(next===revisionActiveScope)return;
  captureRevisionSnapshot(revisionActiveScope);
  restoreRevisionSnapshot(next);
  state.accountMessage=next?'Another tab changed accounts. This account’s Revision data is loading.':'Another tab signed out. Anonymous Revision data is now active.';
  state.accountMessageType='success';
  renderRevision();
  if(next)loadRevision();
});

function switchRevisionSet(setId){
  const selected = state.accountSets.find(set => set.id === setId);
  if (!selected) return;
  state.activeSetId = selected.id;
  state.bulkSelected = [];
  state.publishSetId = selected.id;
  state.cards = Array.isArray(selected.cards) ? selected.cards : [];
  state.progress = selected.progress && typeof selected.progress === 'object' ? selected.progress : {};
  state.xp = Number(selected.xp) || 0;
  state.streak = Number(selected.streak) || 0;
  state.lastReview = selected.lastReview || '';
  state.selected = null;
  state.view = 'overview';
  saveRevision();
  renderRevision();
}
function addRevisionSet(name = 'New set'){
  const newSet = normalizeRevisionSet({id:`set-${Date.now()}`,name,name,cards:[],progress:{},xp:0,streak:0,lastReview:''}, `set-${Date.now()}`);
  state.accountSets.push(newSet);
  state.bulkSelected = [];
  state.activeSetId = newSet.id;
  state.publishSetId = newSet.id;
  state.cards = [];
  state.progress = {};
  state.xp = 0;
  state.streak = 0;
  state.lastReview = '';
  saveRevision();
  renderRevision();
  return newSet;
}
function duplicateRevisionSet(setId){
  const source=state.accountSets.find(set=>set.id===setId);
  if(!source)return;
  const copy=JSON.parse(JSON.stringify(source));
  const baseName=(source.name||'Revision set').slice(0,74)+' (copy)';
  const names=new Set(state.accountSets.map(set=>set.name));
  let name=baseName;
  let suffix=2;
  while(names.has(name)){
    const ending=' (copy '+suffix+++')';
    name=(source.name||'Revision set').slice(0,80-ending.length)+ending;
  }
  copy.id=globalThis.crypto?.randomUUID?.()||'set-'+Date.now()+'-'+Math.random().toString(36).slice(2,9);
  copy.name=name;
  copy.published=false;
  const index=state.accountSets.findIndex(set=>set.id===setId);
  state.accountSets.splice(index+1,0,normalizeRevisionSet(copy,copy.id));
  state.setMessage='Created a copy of “'+source.name+'”.';
  state.setMessageType='success';
  saveRevision();
  renderRevision();
  return copy.id;
}
function moveRevisionSet(setId,direction){
  const index=state.accountSets.findIndex(set=>set.id===setId);
  const next=index+Number(direction);
  if(index<0||next<0||next>=state.accountSets.length)return;
  const [set]=state.accountSets.splice(index,1);
  state.accountSets.splice(next,0,set);
  saveRevision();
  renderRevision();
}
function deleteRevisionSet(setId){
  if (state.accountSets.length <= 1) {
    state.bulkSelected = [];
    state.accountSets = [normalizeRevisionSet({id:DEFAULT_REVISION_SET_ID,name:'My main set',cards:[],progress:{},xp:0,streak:0,lastReview:''}, DEFAULT_REVISION_SET_ID)];
    state.activeSetId = DEFAULT_REVISION_SET_ID;
    state.publishSetId = DEFAULT_REVISION_SET_ID;
    state.cards = [];
    state.progress = {};
    state.xp = 0;
    state.streak = 0;
    state.lastReview = '';
    saveRevision();
    renderRevision();
    return;
  }
  const index = state.accountSets.findIndex(set => set.id === setId);
  if (index < 0) return;
  const [removed] = state.accountSets.splice(index, 1);
  state.bulkSelected = [];
  const fallback = state.accountSets[0];
  state.activeSetId = fallback.id;
  state.publishSetId = fallback.id;
  state.cards = Array.isArray(fallback.cards) ? fallback.cards : [];
  state.progress = fallback.progress && typeof fallback.progress === 'object' ? fallback.progress : {};
  state.xp = Number(fallback.xp) || 0;
  state.streak = Number(fallback.streak) || 0;
  state.lastReview = fallback.lastReview || '';
  saveRevision();
  renderRevision();
  return removed;
}
function renameRevisionSet(setId){
  if (!state.accountSets.some(set => set.id === setId)) return;
  state.editingSetId = setId;
  renderRevision();
}
function saveRevisionSetName(setId){
  const target = state.accountSets.find(set => set.id === setId);
  const input = document.getElementById(`revision-set-name-${setId}`);
  if (!target || !input || !input.value.trim()) return;
  target.name = input.value.trim().slice(0, 80);
  state.editingSetId = null;
  saveRevision();
  renderRevision();
}
function publishRevisionSet(setId){
  const target = state.accountSets.find(set => set.id === setId);
  if (!target) { state.setMessage = 'Choose a revision set to publish.'; state.setMessageType = 'error'; renderRevision(); return; }
  if (!target) return;
  if (!revisionUserKey() || !revisionUsername()) {
    state.accountMessage = 'Link your shared account before publishing a set.';
    state.accountMessageType = 'error';
    state.view = 'settings';
    renderRevision();
    return;
  }
  state.setMessage = `Submitting “${target.name}” for review…`;
  state.setMessageType = 'success';
  renderRevision();
  const payload = { userKey: revisionUserKey(), note: { title: target.name, subject: 'General', level: '', cards: Array.isArray(target.cards) ? target.cards : [] } };
  fetch(`${ThemeManager.WORKER_URL}/revision/public`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)})
    .then(response => response.ok ? response.json() : response.json().then(data => Promise.reject(new Error(data.error || 'Could not publish set.'))))
    .then(() => { target.published = true; state.setMessage = `“${target.name}” submitted for admin review.`; state.setMessageType = 'success'; saveRevision(); renderRevision(); })
    .catch(error => { state.setMessage = error.message || 'Could not publish this set.'; state.setMessageType = 'error'; renderRevision(); });
}
function publishSelectedRevisionSet(){publishRevisionSet(state.publishSetId||state.activeSetId);}
function renderPublishSetControl(){
  const selected=state.accountSets.some(set=>set.id===state.publishSetId)?state.publishSetId:state.activeSetId;
  return `<div class="fg" style="margin-top:12px"><label for="revision-publish-set">Pick a set to publish</label><select id="revision-publish-set" onchange="state.publishSetId=this.value">${state.accountSets.map(set=>`<option value="${escapeRevision(set.id)}" ${set.id===selected?'selected':''}>${escapeRevision(set.name)} · ${(set.cards||[]).length} cards</option>`).join('')}</select><div style="margin-top:8px"><button class="btn bp" type="button" onclick="publishSelectedRevisionSet()">Publish selected set</button></div>${state.setMessage?`<div class="qfb ${state.setMessageType==='error'?'qwr':'qok'}" role="status" style="margin-top:9px">${escapeRevision(state.setMessage)}</div>`:''}</div>`;
}
function promptNewRevisionSet(){const name=(prompt('Name your new revision set:','New set')||'').trim();if(name)addRevisionSet(name);}
function requestDeleteRevisionSet(setId){state.confirmDeleteSetId=setId;renderRevision();}
function cancelDeleteRevisionSet(){state.confirmDeleteSetId=null;renderRevision();}
function confirmDeleteRevisionSet(setId){state.confirmDeleteSetId=null;deleteRevisionSet(setId);}
function bindAIFormEvents(){
  const page = document.getElementById('page');
  if (!page) return;
  page.querySelectorAll('[data-ai-field]').forEach((field) => {
    field.value = state.aiDraft[field.dataset.aiField] || '';
    field.oninput = (event) => {
      state.aiDraft[field.dataset.aiField] = event.target.value;
    };
  });
}
function bindSettingsEvents(){
  document.querySelectorAll('[data-revision-theme]').forEach(button=>button.onclick=()=>applyRevisionTheme(button.dataset.revisionTheme));
}
function escapeRevision(value){return UI.escapeHTML(String(value||''));}
function cardById(id){return state.cards.find(card=>card.id===id);}
function linkedCards(card){return (card.links||[]).map(cardById).filter(Boolean);}
function topicStats(){
  const stats={};
  state.cards.forEach(card=>{stats[card.topic]??={total:0,reviewed:0,due:0};stats[card.topic].total++;if(state.progress[card.id])stats[card.topic].reviewed++;if(!state.progress[card.id]||state.progress[card.id].due<=Date.now())stats[card.topic].due++;});
  return stats;
}
function suggestedTopics(){
  return Object.entries(topicStats()).sort(([,a],[,b])=>b.due-a.due||a.reviewed/a.total-b.reviewed/b.total).slice(0,4);
}
function cardIsDue(card){return !state.progress[card.id]?.due||Number(state.progress[card.id].due)<=Date.now();}
function dueCards(cards=state.cards){return cards.filter(cardIsDue);}
function formatDue(value){if(!value)return 'New';const remaining=Number(value)-Date.now();if(remaining<=0)return 'Due now';if(remaining<3600000)return `Due in ${Math.max(1,Math.ceil(remaining/60000))}m`;if(remaining<86400000)return `Due in ${Math.ceil(remaining/3600000)}h`;return `Due ${new Date(Number(value)).toLocaleDateString()}`;}
function cardReviewStats(card){const progress=state.progress[card.id]||{};return{due:cardIsDue(card),reviews:Number(progress.reviews)||0,correct:Number(progress.correct)||0,accuracy:progress.reviews?Math.round((Number(progress.correct)||0)/progress.reviews*100):null};}
function startStudySession(mode='due',limit=20,topic=''){
  const pool=topic?state.cards.filter(card=>card.topic===topic):state.cards;
  const candidates=mode==='all'?pool:mode==='weak'?pool.filter(card=>state.progress[card.id]?.reviews).sort((a,b)=>(state.progress[a.id]?.ease||2.5)-(state.progress[b.id]?.ease||2.5)):dueCards(pool);
  state.studyQueue=candidates.slice().sort((a,b)=>Number(state.progress[a.id]?.due||0)-Number(state.progress[b.id]?.due||0)).slice(0,Math.max(1,Number(limit)||20)).map(card=>card.id);
  state.studySessionActive=true;state.sessionReviewed=0;state.studyIndex=0;state.revealed=false;state.view='cards';renderRevision();
}
function currentStudyCard(){
  const queue=state.studySessionActive?state.studyQueue:state.cards.map(card=>card.id);
  if(!queue.length)return null;
  const id=queue[Math.min(state.studyIndex,queue.length-1)];
  return cardById(id)||null;
}
function rateCard(id,rating){
  const previous=state.progress[id]||{};const reviews=(Number(previous.reviews)||0)+1;const ease=Number(previous.ease)||2.5;
  const grade=Math.max(0,Math.min(3,Number(rating)||0));
  const nextEase=Math.max(1.3,ease+(grade===3?0.15:grade===2?0:grade===1?-0.2:-0.35));
  const repetitions=grade===0?0:(Number(previous.repetitions)||0)+1;
  let interval=grade===0?10*60*1000:grade===1?24*60*60*1000:repetitions===1?24*60*60*1000:repetitions===2?3*24*60*60*1000:Math.round((Number(previous.intervalDays)||3)*nextEase*86400000);
  if(grade===3&&grade>0)interval=Math.round(interval*1.4);
  state.progress[id]={score:grade,due:Date.now()+interval,ease:nextEase,repetitions,intervalDays:interval/86400000,reviews,correct:(Number(previous.correct)||0)+(grade>=2?1:0),lastReviewed:Date.now()};
  const set=getActiveRevisionSet();set.reviewLog=Array.isArray(set.reviewLog)?set.reviewLog:[];set.reviewLog.push({cardId:id,rating:grade,at:Date.now(),topic:cardById(id)?.topic||''});set.reviewLog=set.reviewLog.slice(-5000);
  awardRevisionXP();
  if(state.studySessionActive){state.sessionReviewed++;state.studyQueue=state.studyQueue.filter(cardId=>cardId!==id);if(state.studyQueue.length)state.studyIndex=Math.min(state.studyIndex,state.studyQueue.length-1);else{state.studySessionActive=false;state.view='overview';state.setMessage=`Session complete: ${state.sessionReviewed} card${state.sessionReviewed===1?'':'s'} reviewed.`;}}
  else state.studyIndex=(state.studyIndex+1)%Math.max(state.cards.length,1);
  state.revealed=false;saveRevision();renderRevision();
}
function dueSummary(){const due=dueCards();return{due:due.length,total:state.cards.length,reviewed:state.cards.length-due.length};}
function dailyReviewCount(){
  const now=new Date();
  now.setHours(0,0,0,0);
  const start=now.getTime();
  return (getActiveRevisionSet().reviewLog||[]).filter(entry=>Number(entry.at)>=start&&Number(entry.at)<start+86400000).length;
}
function updateDailyGoal(){
  const input=document.getElementById('revision-daily-goal');
  const value=Number(input?.value);
  if(!Number.isFinite(value)||value<1)return;
  getActiveRevisionSet().dailyGoal=Math.max(1,Math.min(200,Math.round(value)));
  saveRevision();
  renderRevision();
}

function normalizeTopic(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function syllabusCoverage(item){const target=normalizeTopic(typeof item==='string'?item:item.text);const ignored=new Set(['and','the','for','with','from','into','that','this']);const words=target.split(' ').filter(word=>word.length>2&&!ignored.has(word));if(!words.length)return 0;return state.cards.filter(card=>{const haystack=normalizeTopic(`${card.topic} ${card.title} ${card.answer}`);const hits=words.filter(word=>haystack.includes(word)).length;return haystack.includes(target)||hits/words.length>=0.6;}).length;}
function toggleSyllabusDone(index){const set=getActiveRevisionSet();set.syllabusDone=set.syllabusDone||{};set.syllabusDone[index]=!set.syllabusDone[index];saveRevision();renderRevision();}
function saveSyllabus(){const set=getActiveRevisionSet();set.syllabus=(document.getElementById('syllabus-items')?.value||'').split(/\r?\n/).map(text=>text.trim()).filter(Boolean).slice(0,200);set.syllabusDone={};state.syllabusDraft='';saveRevision();renderRevision();}
function beginConnectionReview(cardId){const card=cardById(cardId);const other=card&&linkedCards(card)[0];if(!card||!other)return;state.connectionCardId=card.id;state.connectionTargetId=other.id;state.connectionRevealed=false;state.view='connection';renderRevision();}
function rateConnection(rating){const card=cardById(state.connectionCardId),other=cardById(state.connectionTargetId);if(!card||!other)return;const key=`link:${[card.id,other.id].sort().join(':')}`;const prior=state.progress[key]||{};const grade=Number(rating)||0;const now=Date.now();state.progress[key]={score:grade,reviews:(prior.reviews||0)+1,correct:(prior.correct||0)+(grade>=2?1:0),ease:Math.max(1.3,(prior.ease||2.5)+(grade>=2?0:-0.2)),due:now+(grade===0?600000:grade===1?86400000:grade===2?259200000:345600000),lastReviewed:now};const set=getActiveRevisionSet();set.reviewLog=Array.isArray(set.reviewLog)?set.reviewLog:[];set.reviewLog.push({link:key,rating:grade,at:now,topic:card.topic||''});set.reviewLog=set.reviewLog.slice(-5000);state.connectionRevealed=false;saveRevision();state.view='overview';renderRevision();}
function downloadBlob(filename,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();URL.revokeObjectURL(url);}
function exportRevisionSet(format='json'){
  const set=getActiveRevisionSet();
  if(format==='csv'){
    const quote=value=>`"${String(value??'').replace(/"/g,'""')}"`;
    const rows=[['front','back','subject','topic','source','links'],...state.cards.map(card=>[card.title,card.answer,card.subject,card.topic,card.source||'',(card.links||[]).map(id=>cardById(id)?.title||'').join('|')])];
    downloadBlob(`${set.name.replace(/[^a-z0-9_-]+/gi,'-')}.csv`,rows.map(row=>row.map(quote).join(',')).join('\r\n'),'text/csv');
  }else downloadBlob(`${set.name.replace(/[^a-z0-9_-]+/gi,'-')}.json`,JSON.stringify({...set,cards:state.cards,progress:state.progress},null,2),'application/json');
}
function parseCSV(text){const rows=[];let row=[],cell='',quoted=false;for(let index=0;index<text.length;index++){const char=text[index];if(char==='"'&&quoted&&text[index+1]==='"'){cell+='"';index++;}else if(char==='"')quoted=!quoted;else if(char===','&&!quoted){row.push(cell);cell='';}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[index+1]==='\n')index++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell='';}else cell+=char;}row.push(cell);if(row.some(value=>value.trim()))rows.push(row);return rows;}
async function loadExternalScript(src,globalName){if(window[globalName])return;await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(new Error('Could not load the document reader library.'));document.head.appendChild(script);});if(!window[globalName])throw new Error('Document reader failed to initialize.');}
async function extractRevisionFile(file){const extension=file.name.split('.').pop().toLowerCase();if(['txt','md','csv'].includes(extension))return await file.text();if(extension==='pdf'){await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;const pages=[];for(let index=1;index<=pdf.numPages;index++){const page=await pdf.getPage(index);const content=await page.getTextContent();pages.push(content.items.map(item=>item.str).join(' '));}return pages.join('\n');}if(extension==='docx'){await loadExternalScript('https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js','mammoth');return(await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}throw new Error('Choose a .txt, .md, .csv, .pdf, or .docx file.');}
async function handleRevisionFile(inputId,targetId){const file=document.getElementById(inputId)?.files?.[0];if(!file)return;try{const text=await extractRevisionFile(file);const target=document.getElementById(targetId);if(target){target.value=[target.value.trim(),text].filter(Boolean).join('\n\n');target.dispatchEvent(new Event('input',{bubbles:true}));}state.uploadMessage=`Imported text from ${file.name}.`;if(state.view==='ai')state.aiDraft.source=file.name;renderRevision();}catch(error){state.uploadMessage=error.message||'Could not read that file.';renderRevision();}}
function importRevisionFile(input){
  const file=input.files?.[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const text=String(reader.result||'');let sourceCards=[];let csvMode=false;let jsonData=null;
      if(file.name.toLowerCase().endsWith('.json')){const data=JSON.parse(text);jsonData=Array.isArray(data)?null:data;sourceCards=Array.isArray(data)?data:Array.isArray(data.cards)?data.cards:[];}
      else{
        csvMode=true;const rows=parseCSV(text);const headings=rows[0].map(value=>value.trim().toLowerCase());
        const frontIndex=headings.indexOf('front'),backIndex=headings.indexOf('back');
        sourceCards=rows.slice(frontIndex>=0&&backIndex>=0?1:0).map(row=>({title:row[frontIndex>=0?frontIndex:0]||'',answer:row[backIndex>=0?backIndex:1]||'',subject:row[headings.indexOf('subject')]||'Imported',topic:row[headings.indexOf('topic')]||'Imported',source:row[headings.indexOf('source')]||'',linkedTitles:(row[headings.indexOf('links')]||'').split('|').filter(Boolean)}));
      }
      sourceCards=sourceCards.filter(card=>(card.title||card.front)&&(card.answer||card.back));
      if(!sourceCards.length)throw new Error('No valid front/back flashcards were found.');
      const sourceId=(card,index)=>String(card.id||`import-row-${index}`);
      const idMap=new Map(sourceCards.map((card,index)=>[sourceId(card,index),`imp${Date.now()}${Math.random().toString(36).slice(2,7)}`]));
      const clean=sourceCards.map((card,index)=>({id:idMap.get(sourceId(card,index)),subject:String(card.subject||'Imported'),topic:String(card.topic||'Imported'),title:String(card.title||card.front),answer:String(card.answer||card.back),source:String(card.source||''),links:[],difficulty:2}));
      const byTitle=new Map(clean.map(card=>[card.title.toLowerCase(),card]));
      sourceCards.forEach((source,index)=>{const card=clean[index];const ids=csvMode?(source.linkedTitles||[]).map(title=>byTitle.get(String(title).toLowerCase())?.id).filter(Boolean):(Array.isArray(source.links)?source.links.map(id=>idMap.get(String(id))).filter(Boolean):[]);card.links=ids.filter(id=>id!==card.id);});
      const importedProgress={};
      if(jsonData?.progress&&typeof jsonData.progress==='object')sourceCards.forEach((source,index)=>{const oldId=sourceId(source,index);const newId=idMap.get(oldId);if(newId&&jsonData.progress[oldId])importedProgress[newId]=jsonData.progress[oldId];});
      const reviewLog=Array.isArray(jsonData?.reviewLog)?jsonData.reviewLog.map(entry=>({...entry,cardId:idMap.get(String(entry.cardId||''))||entry.cardId})).slice(-5000):[];
      const name=String(jsonData?.name||file.name.replace(/\.(json|csv)$/i,''));const imported=normalizeRevisionSet({id:`set-${Date.now()}`,name,cards:clean,progress:importedProgress,xp:Number(jsonData?.xp)||0,streak:Number(jsonData?.streak)||0,lastReview:jsonData?.lastReview||'',syllabus:jsonData?.syllabus||[],syllabusDone:jsonData?.syllabusDone||{},reviewLog,practice:jsonData?.practice});
      state.accountSets.push(imported);state.activeSetId=imported.id;state.cards=clean;state.progress=imported.progress;state.xp=imported.xp;state.streak=imported.streak;state.lastReview=imported.lastReview;state.view='overview';state.setMessage=`Imported ${clean.length} cards from ${file.name}, preserving connections and progress.`;saveRevision();renderRevision();
    }catch(error){state.setMessage=error.message||'Could not import this file.';renderRevision();}
  };
  reader.readAsText(file);
}
function topicAnalytics(){const grouped={};state.cards.forEach(card=>{const topic=card.topic||'Untopiced';const stats=cardReviewStats(card);grouped[topic]??={total:0,reviewed:0,due:0,correct:0,reviews:0,links:0};grouped[topic].total++;grouped[topic].reviewed+=stats.reviews>0?1:0;grouped[topic].due+=stats.due?1:0;grouped[topic].correct+=Number(state.progress[card.id]?.correct)||0;grouped[topic].reviews+=stats.reviews;grouped[topic].links+=(card.links||[]).length;});return grouped;}
function revisionUserKey(){return VaultUser.getAccountSession()?VaultUser.getKey():null;}
function revisionUsername(){return VaultUser.getUsername();}
let revisionSyncTimer=null;
let revisionSyncQueued=false;
let revisionRemoteUpdatedAt=null;
let revisionConflictData=null;
let revisionSyncConflict=false;
function syncRevisionSoon(){
  clearTimeout(revisionSyncTimer);
  if(typeof navigator!=='undefined'&&!navigator.onLine){
    state.syncStatus='offline';
    state.accountMessage='Offline. Changes are saved on this device and will sync when you reconnect.';
    state.accountMessageType='success';
    return;
  }
  if(revisionActiveScope===revisionUserKey()&&revisionUserKey()&&revisionUsername()&&VaultUser.getAccountSession()&&!revisionSyncConflict)revisionSyncTimer=setTimeout(syncRevision,700);
}
window.addEventListener('pagehide',()=>{clearTimeout(revisionSyncTimer);if(revisionActiveScope===revisionUserKey()&&revisionUserKey()&&revisionUsername()&&VaultUser.getAccountSession()&&!revisionSyncConflict)syncRevision(true);});
function applyRevisionRemoteData(data){
  const remoteSets = Array.isArray(data.accountSets) && data.accountSets.length
    ? data.accountSets.map(set => normalizeRevisionSet(set, DEFAULT_REVISION_SET_ID))
    : initialRevisionSets;
  state.accountSets = remoteSets;
  const activeSet = remoteSets.find(set => set.id === data.activeSetId) || remoteSets[0];
  if (activeSet) state.activeSetId = activeSet.id;
  state.cards = Array.isArray(data.cards) ? data.cards : (Array.isArray(activeSet?.cards) ? activeSet.cards : []);
  state.progress = data.progress && typeof data.progress === 'object' ? data.progress : (activeSet && activeSet.progress ? activeSet.progress : {});
  state.xp = Number(data.xp) || state.xp || 0;
  state.streak = Number(data.streak) || state.streak || 0;
  state.lastReview = data.lastReview || (activeSet && activeSet.lastReview ? activeSet.lastReview : state.lastReview) || '';
  const syncedSet = getActiveRevisionSet();
  if (syncedSet) {
    syncedSet.cards = state.cards;
    syncedSet.progress = state.progress;
    syncedSet.xp = state.xp;
    syncedSet.streak = state.streak;
    syncedSet.lastReview = state.lastReview;
  }
  if(data.updatedAt)localStorage.setItem(revisionLocalUpdatedAtKey(),data.updatedAt);
  saveRevision(true);
}
async function syncRevision(keepalive=false){
  if(revisionActiveScope!==revisionUserKey())return;
  if(!revisionUserKey()||!revisionUsername()||!VaultUser.getAccountSession()){if(!VaultUser.getAccountSession())VaultUser.showAccountDialog();return;}
  if(revisionSyncConflict)return;
  if(state.syncing){revisionSyncQueued=true;return;}
  state.syncing=true;
  state.syncStatus='syncing';
  const syncUserKey=revisionUserKey();
  const syncToken=VaultUser.getAccountSession();
  const syncLocalKey=revisionLocalUpdatedAtKey();
  let syncAgain=false;
  try{
    const localUpdatedAt=localStorage.getItem(syncLocalKey)||'';
    const payload = {
      userKey: syncUserKey,
      username: revisionUsername(),
      expectedUpdatedAt: revisionRemoteUpdatedAt || '',
      localUpdatedAt,
      cards: state.cards,
      progress: state.progress,
      accountSets: state.accountSets,
      activeSetId: state.activeSetId,
      xp: state.xp,
      streak: state.streak,
      lastReview: state.lastReview
    };
    const response=await fetch(`${ThemeManager.WORKER_URL}/revision/sync`,{method:'POST',headers:{'Content-Type':'application/json','X-Account-Session':syncToken},body:JSON.stringify(payload),keepalive});
    if(syncToken!==VaultUser.getAccountSession()||syncUserKey!==revisionUserKey()||revisionActiveScope!==syncUserKey)return;
    if(response.status===409){
      const conflict=await response.json();
      if(syncToken!==VaultUser.getAccountSession()||syncUserKey!==revisionUserKey()||revisionActiveScope!==syncUserKey)return;
      revisionConflictData=conflict.data;
      revisionSyncConflict=true;
      state.syncStatus='conflict';
      state.accountMessage='Revision data changed on another device. Your local copy has been preserved.';
      state.accountMessageType='error';
      renderRevision();
      return;
    }
    if(!response.ok){const detail=await response.text();throw new Error(`/revision/sync returned HTTP ${response.status}${detail?`: ${detail.slice(0,180)}`:''}`);}
    const result=await response.json();
    if(syncToken!==VaultUser.getAccountSession()||syncUserKey!==revisionUserKey()||revisionActiveScope!==syncUserKey)return;
    state.syncStatus='synced';
    state.accountMessage='';
    revisionRemoteUpdatedAt=result.data?.updatedAt||revisionRemoteUpdatedAt;
    if(localStorage.getItem(syncLocalKey)===localUpdatedAt&&revisionRemoteUpdatedAt)localStorage.setItem(syncLocalKey,revisionRemoteUpdatedAt);
    else syncAgain=true;
  }catch(error){
    if(syncToken===VaultUser.getAccountSession()&&syncUserKey===revisionUserKey()&&revisionActiveScope===syncUserKey){
      state.syncStatus='error';
      state.accountMessage='Could not reach the Worker at /revision/sync. Your local copy is still saved on this device.';
      window.VaultBugReporter?.capture(error,{detail:'Revision account sync'});
      state.accountMessageType='error';
    }
  }finally{
    state.syncing=false;
    if(syncAgain||revisionSyncQueued){revisionSyncQueued=false;if(!revisionSyncConflict)syncRevisionSoon();}
  }
}
async function resolveRevisionSyncConflict(choice){
  if(!revisionSyncConflict)return;
  if(choice==='remote'&&revisionConflictData){
    revisionRemoteUpdatedAt=revisionConflictData.updatedAt||null;
    revisionSyncConflict=false;
    const remote=revisionConflictData;
    revisionConflictData=null;
    applyRevisionRemoteData(remote);
    state.accountMessage='The other device’s copy has been loaded.';
    state.accountMessageType='success';
    renderRevision();
    return;
  }
  revisionRemoteUpdatedAt=revisionConflictData?.updatedAt||null;
  revisionSyncConflict=false;
  revisionConflictData=null;
  state.accountMessage='Keeping this device’s copy. Syncing it as the latest version.';
  state.accountMessageType='success';
  await syncRevision();
  renderRevision();
}
let revisionLoadPromise=null;
let revisionLoadQueued=false;
async function loadRevision(){
  if(revisionLoadPromise){revisionLoadQueued=true;return revisionLoadPromise;}
  const run=(async()=>{
    const requestedUserKey=revisionUserKey();
    const requestedToken=VaultUser.getAccountSession();
    if(revisionActiveScope!==requestedUserKey||!requestedUserKey||!requestedToken)return;
    if(!localStorage.getItem(revisionSnapshotKey(requestedUserKey)))captureRevisionSnapshot(requestedUserKey);
    state.syncStatus='syncing';
    try{
      const response=await fetch(`${ThemeManager.WORKER_URL}/revision/sync?userKey=${encodeURIComponent(requestedUserKey)}`,{headers:{'X-Account-Session':requestedToken}});
      if(requestedToken!==VaultUser.getAccountSession()||requestedUserKey!==revisionUserKey()||revisionActiveScope!==requestedUserKey)return;
      if(!response.ok){const detail=await response.text();throw new Error(`/revision/sync returned HTTP ${response.status}${detail?`: ${detail.slice(0,180)}`:''}`);}
      const payload=await response.json();
      if(requestedToken!==VaultUser.getAccountSession()||requestedUserKey!==revisionUserKey()||revisionActiveScope!==requestedUserKey)return;
      if(payload.found&&payload.data){
        const localUpdatedAt=localStorage.getItem(revisionLocalUpdatedAtKey())||'';
        if(localUpdatedAt&&payload.data.updatedAt&&localUpdatedAt>payload.data.updatedAt){
          revisionRemoteUpdatedAt=payload.data.updatedAt;
          state.view='settings';
          revisionConflictData=payload.data;
          revisionSyncConflict=true;
          state.syncStatus='conflict';
          state.accountMessage='This device has newer unsynced revision changes. Choose which copy to keep in Settings.';
          state.accountMessageType='error';
          renderRevision();
          return;
        }
        revisionRemoteUpdatedAt=payload.data.updatedAt||null;
        state.syncStatus='synced';
        state.accountMessage='';
        applyRevisionRemoteData(payload.data);
        renderRevision();
      }else{
        revisionRemoteUpdatedAt=null;
        await syncRevision();
      }
    }catch(error){
      if(requestedToken===VaultUser.getAccountSession()&&requestedUserKey===revisionUserKey()){
        const offline=typeof navigator!=='undefined'&&!navigator.onLine;
        state.syncStatus=offline?'offline':'error';
        state.accountMessage=offline?'Offline. Your local copy is available and will sync when connection returns.':`Could not load synced revision data from /revision/sync. Your local copy has been preserved.`;
        state.accountMessageType=offline?'success':'error';
        window.VaultBugReporter?.capture(error,{detail:'Revision account data load'});
      }
    }
  })();
  revisionLoadPromise=run;
  try{await run;}finally{
    revisionLoadPromise=null;
    if(revisionLoadQueued){revisionLoadQueued=false;void loadRevision();}
  }
}
window.addEventListener('offline',()=>{
  state.syncStatus='offline';
  state.accountMessage='Offline. Changes are saved on this device and will sync when you reconnect.';
  state.accountMessageType='success';
  renderRevision();
});
window.addEventListener('online',()=>{
  if(revisionUserKey()&&VaultUser.getAccountSession())syncRevision();
  else{state.syncStatus='local';renderRevision();}
});
async function loadPublicNotes(){try{const response=await fetch(`${ThemeManager.WORKER_URL}/revision/public${revisionUserKey()?`?userKey=${encodeURIComponent(revisionUserKey())}`:''}`);const payload=await response.json();state.publicNotes=payload.notes||[];renderRevision();await checkRevisionSubmissionNotifications();}catch(error){state.publicNotes=[];}}
async function checkRevisionSubmissionNotifications(){
  if(!VaultUser.getAccountSession()||window._activeRevisionNotice)return;
  try{
    const response=await fetch(`${ThemeManager.WORKER_URL}/submissions/notifications`,{headers:{'X-Account-Session':VaultUser.getAccountSession()}});
    if(!response.ok)return;
    const data=await response.json();
    const notice=(data.notifications||[]).find(item=>item.site==='revision');
    if(!notice)return;
    window._activeRevisionNotice=notice;
    const approved=notice.status==='approved';
    const title=String(notice.title||'Untitled revision notes').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const message=approved?`Your revision notes “${title}” were approved. Choose whether to keep your original cards or use the edited version.`:`Your revision notes “${title}” were not approved. Your private cards remain in your account.`;
    openModal(`<div><h2>Submission update</h2><p>${message}</p><div class="actions">${approved?'<button class="btn" onclick="resolveRevisionSubmissionNotification(&quot;keep&quot;)">Keep my original</button><button class="btn bg" onclick="resolveRevisionSubmissionNotification(&quot;replace&quot;)">Use edited version</button>':'<button class="btn bg" onclick="resolveRevisionSubmissionNotification(&quot;keep&quot;)">Keep my notes in my account</button>'}</div></div>`);
  }catch(error){}
}
async function resolveRevisionSubmissionNotification(choice){
  const notice=window._activeRevisionNotice;
  if(!notice)return;
  try{
    const response=await fetch(`${ThemeManager.WORKER_URL}/submissions/notifications/resolve`,{method:'POST',headers:{'Content-Type':'application/json','X-Account-Session':VaultUser.getAccountSession()},body:JSON.stringify({id:notice.id,choice})});
    if(!response.ok)throw new Error('Could not save your choice.');
    if(notice.status==='approved'&&choice==='replace'&&Array.isArray(notice.payload?.approved?.cards)){
      state.cards=notice.payload.approved.cards;
      saveRevision();
      renderRevision();
    }
    window._activeRevisionNotice=null;
    closeModal();
    await checkRevisionSubmissionNotifications();
  }catch(error){alert(error.message);}
}
function awardRevisionXP(){
  const today=new Date().toISOString().slice(0,10);const previous=state.lastReview;
  state.xp+=10;
  if(previous!==today){const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);state.streak=previous===yesterday?state.streak+1:1;state.lastReview=today;}
}
async function syncRevisionTheme(){
  if(!revisionUserKey()||!VaultUser.getAccountSession())return;
  try{
    const response=await fetch(`${ThemeManager.WORKER_URL}/lb/get?userKey=${encodeURIComponent(revisionUserKey())}`);
    if(!response.ok)throw new Error(`Could not load the shared theme (HTTP ${response.status}).`);
    const data=await response.json();
    if(!data.found||!data.user?.theme)return;
    const themesResult=await ThemeManager.loadServerCustomThemes('global');
    if(!themesResult.synced)throw themesResult.error||new Error('Could not sync saved themes.');
    if(ThemeManager.getAllThemes('global')[data.user.theme]){
      await ThemeManager.applyTheme(data.user.theme,'global',false);
      state.themeMessage=`${ThemeManager.getAllThemes('global')[data.user.theme].label||data.user.theme} loaded from your shared account.`;
    }else{
      state.themeMessage='Your shared account has a theme that is not available on this device.';
    }
    renderRevision();
  }catch(error){
    console.warn('Revision theme sync failed:',error);
    state.themeMessage='Could not sync your shared theme. Your current theme has been kept.';
    renderRevision();
  }
}
async function syncRevisionThemes(){
  if(!VaultUser.getAccountSession()){VaultUser.showAccountDialog();return;}
  state.themeMessage='Syncing themes…';renderRevision();
  const result=await ThemeManager.loadServerCustomThemes('global');
  state.themeMessage=result.synced?'Saved themes synced with your shared account.':(result.error?.message||'Theme sync failed. Your local themes have been kept.');
  renderRevision();
}
async function applyRevisionTheme(key){
  const result=await ThemeManager.applyTheme(key,'global');
  const label=ThemeManager.getAllThemes('global')[key]?.label||key;
  state.themeMessage=result.synced?`${label} theme synced to your shared account.`:result.error?`${label} applied here, but could not sync: ${result.error.message}`:`${label} applied on this device. Sign in to sync it across devices.`;
  renderRevision();
}
function clearRevisionData(){state.cards=[];state.progress={};state.xp=0;state.streak=0;state.lastReview='';state.confirmClearData=false;saveRevision();renderRevision();}
function renderGraph(){
  const query=String(state.graphQuery||'').trim().toLowerCase();
  const cards=state.cards.filter(card=>!query||[card.title,card.answer,card.subject,card.topic,card.source,...linkedCards(card).map(link=>link.title)].some(value=>String(value||'').toLowerCase().includes(query)));
  if(!cards.length)return '<div class="map-empty">'+(query?'No cards match this search.':'No cards in this revision set yet. Add or import cards to build your knowledge map.')+'</div>';
  const columns=Math.min(4,Math.max(1,cards.length));
  const cellWidth=190,cellHeight=112,gap=22,nodeWidth=190,nodeHeight=78;
  const rows=Math.ceil(cards.length/columns),width=columns*cellWidth+(columns-1)*gap,height=rows*cellHeight;
  const positions=cards.map((card,index)=>({x:(index%columns)*(cellWidth+gap),y:Math.floor(index/columns)*cellHeight,card}));
  const byId=new Map(positions.map(node=>[node.card.id,node]));
  const paths=positions.flatMap(node=>linkedCards(node.card).map(link=>{
    const target=byId.get(link.id);
    if(!target||node.card.id.localeCompare(link.id)>0)return '';
    const x1=node.x+nodeWidth/2,y1=node.y+nodeHeight/2,x2=target.x+nodeWidth/2,y2=target.y+nodeHeight/2;
    const bend=Math.max(24,Math.abs(x2-x1)*.28);
    return '<path d="M '+x1+' '+y1+' C '+(x1+(x2>=x1?bend:-bend))+' '+y1+', '+(x2+(x2>=x1?-bend:bend))+' '+y2+', '+x2+' '+y2+'"></path>';
  })).join('');
  const nodes=positions.map(node=>'<button type="button" class="graph-node'+(state.selected===node.card.id?' active':'')+'" style="left:'+node.x+'px;top:'+node.y+'px;width:'+nodeWidth+'px;height:'+nodeHeight+'px" aria-pressed="'+String(state.selected===node.card.id)+'" onclick="selectRevisionCard(\''+escapeRevision(node.card.id)+'\')"><span>'+escapeRevision(node.card.topic||node.card.subject||'')+'</span><strong>'+escapeRevision(node.card.title)+'</strong></button>').join('');
  return '<div class="graph-wrap"><div class="graph" style="width:'+width+'px;height:'+height+'px"><svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none">'+paths+'</svg>'+nodes+'</div></div><div class="map-summary">Showing '+cards.length+' of '+state.cards.length+' cards · Lines show linked ideas</div>';
}
function filterKnowledgeMap(value){
  state.graphQuery=value;
  const map=document.getElementById('knowledge-map-content');
  if(map)map.innerHTML=renderGraph();
  const selection=document.getElementById('knowledge-map-selection');
  if(selection)selection.innerHTML=renderGraphSelection(cardById(state.selected));
}
function renderGraphSelection(selected){
  if(!selected)return '<div class="map-selection-empty">Select a card to see its answer and connected ideas.</div>';
  const query=String(state.graphQuery||'').trim().toLowerCase();
  const isVisible=!query||[selected.title,selected.answer,selected.subject,selected.topic,selected.source,...linkedCards(selected).map(link=>link.title)].some(value=>String(value||'').toLowerCase().includes(query));
  const links=linkedCards(selected);
  const connections=links.length?links.map(link=>'<button type="button" class="graph-connection" onclick="selectRevisionCard(\''+escapeRevision(link.id)+'\')">'+escapeRevision(link.title)+'</button>').join(''):'<span class="knowledge-meta">No linked cards yet.</span>';
  return '<section class="graph-selection"><div class="graph-selection-content">'+(isVisible?'':'<div class="map-selection-note">This selected card is hidden by the current search filter.</div>')+'<div class="knowledge-meta">'+escapeRevision(selected.subject)+' · '+escapeRevision(selected.topic)+'</div><h2>'+escapeRevision(selected.title)+'</h2><p>'+escapeRevision(selected.answer)+'</p>'+(selected.source?'<div class="knowledge-meta graph-source">Source: '+escapeRevision(selected.source)+'</div>':'')+'<div class="graph-connections"><h3>Connected cards</h3>'+connections+'</div></div><div class="graph-selection-actions"><button type="button" class="btn bp" onclick="startStudy(\''+escapeRevision(selected.id)+'\')">Review card</button><button type="button" class="btn" onclick="editRevisionCard(\''+escapeRevision(selected.id)+'\')">Edit</button></div></section>';
}
function renderCardList(cards=state.cards){
  return `<div class="knowledge-list">${cards.map(card=>`<div class="knowledge-item${state.selected===card.id?' active':''}" onclick="selectRevisionCard('${card.id}')"><span class="knowledge-dot"></span><div><div class="knowledge-title">${escapeRevision(card.title)}</div><div class="knowledge-meta">${escapeRevision(card.subject)} · ${escapeRevision(card.topic)} · ${linkedCards(card).length} linked idea${linkedCards(card).length===1?'':'s'} · ${formatDue(state.progress[card.id]?.due)}</div>${card.source?`<div class="knowledge-meta">Source: ${escapeRevision(card.source)}</div>`:''}<div class="knowledge-links">${linkedCards(card).map(link=>`<span class="knowledge-link" onclick="event.stopPropagation();selectRevisionCard('${link.id}')">↗ ${escapeRevision(link.title)}</span>`).join('')}</div></div></div>`).join('')}</div>`;
}
function renderSuggestions(){
  const suggestions=suggestedTopics();
  return `<div class="card"><div class="sec" style="margin-top:0">Suggested next topics</div>${suggestions.length?suggestions.map(([topic,stats])=>`<div class="suggestion"><div><div class="suggestion-name">${escapeRevision(topic)}</div><div class="suggestion-reason">${stats.due} card${stats.due===1?'':'s'} due · ${stats.reviewed}/${stats.total} reviewed</div></div><button class="btn bsm" onclick="startTopic('${encodeURIComponent(topic)}')">Study</button></div>`).join(''):'<div class="ps">Add cards to receive recommendations.</div>'}</div>`;
}
function renderBulkCardList(cards){
  return `<div class="knowledge-list">${cards.map(card=>`<div class="knowledge-item${state.selected===card.id?' active':''}" onclick="selectRevisionCard('${escapeRevision(card.id)}')"><input type="checkbox" data-bulk-card="${escapeRevision(card.id)}" ${state.bulkSelected.includes(card.id)?'checked':''} aria-label="Select ${escapeRevision(card.title)}" onclick="event.stopPropagation()"><span class="knowledge-dot"></span><div><div class="knowledge-title">${escapeRevision(card.title)}</div><div class="knowledge-meta">${escapeRevision(card.subject)} · ${escapeRevision(card.topic)} · ${linkedCards(card).length} linked ideas · ${formatDue(state.progress[card.id]?.due)}</div></div></div>`).join('')}</div>`;
}
function applyBulkEdit(){
  const ids=new Set(state.bulkSelected);
  if(!ids.size)return;
  const subject=document.getElementById('bulk-subject')?.value.trim()||'';
  const topic=document.getElementById('bulk-topic')?.value.trim()||'';
  if(!subject&&!topic)return;
  state.cards.forEach(card=>{if(!ids.has(card.id))return;if(subject)card.subject=subject;if(topic)card.topic=topic;});
  state.bulkSelected=[];
  saveRevision();
  renderRevision();
}
function deleteBulkSelected(){
  const ids=new Set(state.bulkSelected);
  if(!ids.size||!confirm(`Delete ${ids.size} selected revision cards? This cannot be undone.`))return;
  state.cards=state.cards.filter(card=>!ids.has(card.id));
  state.cards.forEach(card=>card.links=(card.links||[]).filter(id=>!ids.has(id)));
  ids.forEach(id=>delete state.progress[id]);
  Object.keys(state.progress).forEach(key=>{if(key.startsWith('link:')&&key.slice(5).split(':').some(id=>ids.has(id)))delete state.progress[key];});
  const set=getActiveRevisionSet();
  set.reviewLog=(set.reviewLog||[]).filter(entry=>!ids.has(entry.cardId)&&!(entry.link&&entry.link.slice(5).split(':').some(id=>ids.has(id))));
  state.bulkSelected=[];
  if(ids.has(state.selected))state.selected=null;
  saveRevision();
  renderRevision();
}
function renderLibrary(){
  const subjects=[...new Set(state.cards.map(card=>card.subject||'General'))].sort();
  const topics=[...new Set(state.cards.map(card=>card.topic||'Untopiced'))].sort();
  const query=state.libraryQuery.toLowerCase();
  let cards=state.cards.filter(card=>(state.librarySubject==='all'||(card.subject||'General')===state.librarySubject)&&(state.libraryTopic==='all'||(card.topic||'Untopiced')===state.libraryTopic)&&(state.libraryDue==='all'||(state.libraryDue==='due'?cardIsDue(card):!cardIsDue(card)))&&(!query||`${card.title} ${card.answer} ${card.source||''}`.toLowerCase().includes(query)));
  cards.sort((a,b)=>state.librarySort==='alpha'?a.title.localeCompare(b.title):state.librarySort==='topic'?a.topic.localeCompare(b.topic)||a.title.localeCompare(b.title):Number(state.progress[a.id]?.due||0)-Number(state.progress[b.id]?.due||0));
  return `<div><div class="pt">Card library</div><div class="ps">Find, filter and sort cards in this set.</div><div class="card"><div class="g2"><div class="fg"><label for="library-search">Search cards</label><input id="library-search" type="text" value="${escapeRevision(state.libraryQuery)}" placeholder="Search term, definition, source"></div><div class="fg"><label for="library-subject">Subject</label><select id="library-subject"><option value="all">All subjects</option>${subjects.map(subject=>`<option${state.librarySubject===subject?' selected':''}>${escapeRevision(subject)}</option>`).join('')}</select></div><div class="fg"><label for="library-topic">Topic</label><select id="library-topic"><option value="all">All topics</option>${topics.map(topic=>`<option${state.libraryTopic===topic?' selected':''}>${escapeRevision(topic)}</option>`).join('')}</select></div><div class="fg"><label for="library-due">Review status</label><select id="library-due"><option value="all"${state.libraryDue==='all'?' selected':''}>All cards</option><option value="due"${state.libraryDue==='due'?' selected':''}>Due now</option><option value="scheduled"${state.libraryDue==='scheduled'?' selected':''}>Scheduled later</option></select></div><div class="fg"><label for="library-sort">Sort by</label><select id="library-sort"><option value="due"${state.librarySort==='due'?' selected':''}>Due date</option><option value="alpha"${state.librarySort==='alpha'?' selected':''}>Front A–Z</option><option value="topic"${state.librarySort==='topic'?' selected':''}>Topic</option></select></div></div><div class="knowledge-meta">${cards.length} matching cards</div><div class="card" style="margin:10px 0"><div class="knowledge-title">Bulk edit</div><div class="knowledge-meta">${state.bulkSelected.length} selected</div><div class="g2"><div class="fg"><label for="bulk-subject">Set subject</label><input id="bulk-subject" type="text" placeholder="Leave blank to keep existing"></div><div class="fg"><label for="bulk-topic">Set topic</label><input id="bulk-topic" type="text" placeholder="Leave blank to keep existing"></div></div><div style="display:flex;gap:7px;flex-wrap:wrap"><label><input id="library-select-all" type="checkbox" ${cards.length&&cards.every(card=>state.bulkSelected.includes(card.id))?'checked':''}> Select all filtered</label><button class="btn bsm bp" onclick="applyBulkEdit()" ${state.bulkSelected.length?'':'disabled'}>Update selected</button><button class="btn bsm br" onclick="deleteBulkSelected()" ${state.bulkSelected.length?'':'disabled'}>Delete selected</button></div></div>${renderBulkCardList(cards)}</div></div>`;
}
function bindLibraryEvents(){
  const query=document.getElementById('library-search'),subject=document.getElementById('library-subject'),topic=document.getElementById('library-topic'),due=document.getElementById('library-due'),sort=document.getElementById('library-sort');
  if(query)query.oninput=()=>{state.libraryQuery=query.value;const cursor=query.selectionStart;renderRevision();const next=document.getElementById('library-search');next?.focus();next?.setSelectionRange(cursor,cursor);};
  if(subject)subject.onchange=()=>{state.librarySubject=subject.value;renderRevision();};
  if(topic)topic.onchange=()=>{state.libraryTopic=topic.value;renderRevision();};
  if(due)due.onchange=()=>{state.libraryDue=due.value;renderRevision();};
  if(sort)sort.onchange=()=>{state.librarySort=sort.value;renderRevision();};
  const selectAll=document.getElementById('library-select-all');
  if(selectAll)selectAll.onchange=()=>{const visible=[...document.querySelectorAll('[data-bulk-card]')].map(input=>input.dataset.bulkCard);state.bulkSelected=selectAll.checked?[...new Set([...state.bulkSelected,...visible])]:state.bulkSelected.filter(id=>!visible.includes(id));renderRevision();};
  document.querySelectorAll('[data-bulk-card]').forEach(input=>input.onchange=()=>{state.bulkSelected=input.checked?[...new Set([...state.bulkSelected,input.dataset.bulkCard])]:state.bulkSelected.filter(id=>id!==input.dataset.bulkCard);renderRevision();});
}
function renderAnalytics(){
  const topics=topicAnalytics();const due=dueSummary();const set=getActiveRevisionSet();
  const totalReviews=state.cards.reduce((sum,card)=>sum+(Number(state.progress[card.id]?.reviews)||0),0);
  const totalCorrect=state.cards.reduce((sum,card)=>sum+(Number(state.progress[card.id]?.correct)||0),0);
  const syllabus=Array.isArray(set.syllabus)?set.syllabus:[];
  const activity=Array.from({length:7},(_,index)=>{const date=new Date();date.setHours(0,0,0,0);date.setDate(date.getDate()-(6-index));const next=date.getTime()+86400000;return{label:date.toLocaleDateString(undefined,{weekday:'short'}),count:(set.reviewLog||[]).filter(entry=>Number(entry.at)>=date.getTime()&&Number(entry.at)<next).length};});
  const maxActivity=Math.max(1,...activity.map(day=>day.count));
  const topicEntries=Object.entries(topics).sort(([,a],[,b])=>b.due-a.due||(a.reviews?a.correct/a.reviews:0)-(b.reviews?b.correct/b.reviews:0));
  return `<div style="max-width:900px;margin:0 auto"><div class="pt">Progress and coverage</div><div class="ps">Review history, due cards and syllabus coverage for ${escapeRevision(set.name)}.</div><div class="g3"><div class="scard"><div class="snum">${due.due}</div><div class="slbl">Due now</div></div><div class="scard"><div class="snum">${totalReviews}</div><div class="slbl">Reviews</div></div><div class="scard"><div class="snum">${totalReviews?Math.round(totalCorrect/totalReviews*100):0}%</div><div class="slbl">Recall accuracy</div></div></div><div class="card" style="margin-top:10px"><div class="sec" style="margin-top:0">Recent study activity</div><div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;align-items:end;height:84px">${activity.map(day=>`<div style="display:flex;flex-direction:column;justify-content:end;align-items:center;gap:4px;height:100%"><span class="knowledge-meta">${day.count||''}</span><div title="${day.count} reviews" style="width:100%;max-width:38px;height:${Math.max(4,day.count/maxActivity*48)}px;background:var(--teal);border-radius:3px 3px 0 0"></div><span class="knowledge-meta">${day.label}</span></div>`).join('')}</div></div><div class="card" style="margin-top:10px"><div class="sec" style="margin-top:0">Topic performance · weakest first</div>${topicEntries.length?`<div class="knowledge-list">${topicEntries.map(([topic,stats])=>`<div class="knowledge-item"><div style="flex:1"><div class="knowledge-title">${escapeRevision(topic)}</div><div class="knowledge-meta">${stats.total} cards · ${stats.due} due · ${stats.reviewed} reviewed · ${stats.reviews?Math.round(stats.correct/stats.reviews*100):0}% recall accuracy · ${stats.links/2|0} connections</div></div><button class="btn bsm" onclick="startStudySession('due',50,'${escapeRevision(topic)}')">Study due</button></div>`).join('')}</div>`:'<div class="ps">Add cards to see topic analytics.</div>'}</div><div class="card" style="margin-top:10px"><div class="sec" style="margin-top:0">Syllabus coverage</div><div class="fg"><label for="syllabus-items">Paste syllabus points, one per line</label><textarea id="syllabus-items" rows="5" placeholder="Cell structure\nDiffusion and osmosis\nActive transport">${escapeRevision(state.syllabusDraft||syllabus.join('\n'))}</textarea></div><button class="btn bp" type="button" onclick="saveSyllabus()">Save syllabus checklist</button>${syllabus.length?`<div class="knowledge-list">${syllabus.map((item,index)=>{const count=syllabusCoverage(item);const checked=Boolean(set.syllabusDone?.[index]);return`<label class="knowledge-item"><input type="checkbox" ${checked?'checked':''} onchange="toggleSyllabusDone(${index})"><span style="flex:1"><span class="knowledge-title">${escapeRevision(item)}</span><span class="knowledge-meta">${count} matching card${count===1?'':'s'}${checked?' · Marked complete':''}</span></span></label>`;}).join('')}</div>`:''}</div></div>`;
}
function renderConnectionReview(){
  const card=cardById(state.connectionCardId);if(!card)return '<div class="pt">Connection review</div><div class="ps">Choose a linked card to review its connection.</div>';
  const other=cardById(state.connectionTargetId);if(!other)return '<div class="pt">Connection review</div><div class="ps">This idea has no linked cards yet.</div>';
  return `<div style="max-width:680px;margin:0 auto"><div class="pt">Review the connection</div><div class="ps">Explain how these two ideas are related before revealing the link.</div><div class="card" style="text-align:center;padding:24px"><div class="g2"><div class="scard"><div class="knowledge-title">${escapeRevision(card.title)}</div></div><div class="scard"><div class="knowledge-title">${escapeRevision(other.title)}</div></div></div>${state.connectionRevealed?`<div class="qfb qok">${escapeRevision(card.answer)} ${escapeRevision(other.answer)}</div>`:'<div class="ps" style="margin-top:16px">Think through the relationship between these ideas.</div>'}<div style="display:flex;gap:7px;justify-content:center;margin-top:14px;flex-wrap:wrap">${state.connectionRevealed?`<button class="btn br" onclick="rateConnection(0)">Again</button><button class="btn" onclick="rateConnection(1)">Hard</button><button class="btn bp" onclick="rateConnection(2)">Good</button><button class="btn bg" onclick="rateConnection(3)">Easy</button>`:`<button class="btn bp" onclick="state.connectionRevealed=true;renderRevision()">Reveal connection</button>`}<button class="btn" onclick="state.view='overview';renderRevision()">Back</button></div></div></div>`;
}
function renderSessionSummary(){return `<div class="card" style="margin-top:10px"><div class="knowledge-title">Study session</div><div class="knowledge-meta">${state.studyQueue.length} cards remaining · ${state.sessionReviewed} reviewed this session</div></div>`;}
let revisionCourseSelection = null;
async function loadRevisionCourseSelection(){
  try{const local=JSON.parse(localStorage.getItem('revision_course_selection')||'null');if(Array.isArray(local))revisionCourseSelection=local;}catch{}
  try{const saved=await VaultUser.getCourseSelections();if(Array.isArray(saved?.revision)){revisionCourseSelection=saved.revision;localStorage.setItem('revision_course_selection',JSON.stringify(revisionCourseSelection));}else if(revisionCourseSelection&&VaultUser.getAccountSession())await VaultUser.saveCourseSelections('revision',revisionCourseSelection);}catch(error){console.error('Revision course selection sync failed:',error);}
  if(!Array.isArray(revisionCourseSelection)){revisionCourseSelection=state.accountSets.map(set=>set.id);showRevisionCourseSelection(true);}else state.accountSets.forEach(set=>set.courseIncluded=revisionCourseSelection.includes(set.id));
}
function showRevisionCourseSelection(){
  const selected=new Set(revisionCourseSelection||state.accountSets.map(set=>set.id));
  const overlay=document.createElement('div');overlay.id='revision-course-selection';overlay.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.78);display:grid;place-items:center;padding:18px;overflow:auto';
  overlay.innerHTML='<section class="card" style="width:min(560px,100%);max-height:90vh;overflow:auto;padding:22px"><div class="pt">Which revision sets are part of your course?</div><div class="ps">Only selected sets count towards your course progress. You can still open and study every set.</div><div style="display:grid;gap:9px;margin:18px 0">'+state.accountSets.map(set=>'<label style="display:flex;gap:9px;align-items:center;padding:10px;border:1px solid var(--border2);border-radius:9px"><input type="checkbox" data-revision-course value="'+escapeRevision(set.id)+'" '+(selected.has(set.id)?'checked':'')+'><span>'+escapeRevision(set.name)+'</span></label>').join('')+'</div><button class="btn bp" style="width:100%" onclick="saveRevisionCourseSelection()">Save course sets</button></section>';
  document.body.appendChild(overlay);
}
async function saveRevisionCourseSelection(){
  const selected=[...document.querySelectorAll('[data-revision-course]:checked')].map(input=>input.value);
  if(!selected.length){state.setMessage='Select at least one revision set.';state.setMessageType='error';return;}
  revisionCourseSelection=selected;localStorage.setItem('revision_course_selection',JSON.stringify(selected));state.accountSets.forEach(set=>set.courseIncluded=selected.includes(set.id));
  try{await VaultUser.saveCourseSelections('revision',selected);}catch(error){state.setMessage='Could not sync course selections. They remain selected on this device.';state.setMessageType='error';}
  document.getElementById('revision-course-selection')?.remove();saveRevision();renderRevision();
}
function editRevisionCourseSelection(){showRevisionCourseSelection();}
function renderRevisionSetOverview(){
  return `<section class="card" style="margin:12px 0"><div class="overview-section-heading"><h2>Your revision sets</h2><span>${state.accountSets.length} set${state.accountSets.length===1?'':'s'}</span></div><div class="knowledge-meta" style="margin-bottom:10px">Keep different subjects, courses or revision projects separate. Each set has its own cards and progress.</div><div class="g2">${state.accountSets.map(set=>{const cards=Array.isArray(set.cards)?set.cards:[];const progress=set.progress||{};const reviewed=cards.filter(card=>Number(progress[card.id]?.reviews)>0).length;const due=cards.filter(card=>!progress[card.id]?.due||Number(progress[card.id].due)<=Date.now()).length;const active=set.id===state.activeSetId;return `<div class="scard" style="text-align:left;border:1px solid ${active?'var(--purple)':'var(--border2)'};min-width:0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><strong>${escapeRevision(set.name||'Revision set')}</strong><span class="tag ${active?'tp':'tg'}">${active?'Active':'Saved'}</span></div><div class="knowledge-meta" style="margin-top:7px">${cards.length} cards · ${due} due · ${reviewed} reviewed · ${Number(set.xp)||0} XP</div>${!active?`<button class="btn bsm" style="margin-top:9px" type="button" onclick="switchRevisionSet('${escapeRevision(set.id)}')">Open set</button>`:`<div class="knowledge-meta" style="margin-top:9px">You are revising this set</div>`}</div>`;}).join('')}</div><button class="btn bp" style="margin-top:10px" type="button" onclick="promptNewRevisionSet()">＋ Create a revision set</button><button class="btn" style="margin:10px 0 0 6px" type="button" onclick="state.view='settings';renderRevision()">Manage sets</button><button class="btn" style="margin:10px 0 0 6px" type="button" onclick="editRevisionCourseSelection()">Choose course sets</button></section>`;
}
function renderOverview(){
  const selected=cardById(state.selected);
  const due=dueSummary();
  const dailyGoal=Math.max(1,Number(getActiveRevisionSet().dailyGoal)||20);
  const dailyReviews=dailyReviewCount();
  const dailyPercent=Math.min(100,Math.round(dailyReviews/dailyGoal*100));
  const reviewed=state.cards.filter(card=>(Number(state.progress[card.id]?.reviews)||0)>0).length;
  const weak=state.cards.some(card=>(Number(state.progress[card.id]?.reviews)||0)>0);
  const hasCards=state.cards.length>0;
  const heroTitle=!hasCards?'Build your revision set':due.due?due.due+' cards ready to review':'You are up to date';
  const heroText=!hasCards?'Import a course pack or add a few cards to start tracking what you know.':due.due?'Work through the cards due today. Your review schedule updates as you go.':'Nothing is due right now. Use the time to revisit difficult cards or study a topic.';
  return `<div class="overview">
    <div class="pt">Overview</div>
    <div class="ps">${escapeRevision(getActiveRevisionSet().name)} · Your revision activity and next steps.</div>
    ${renderRevisionSetOverview()}
    <section class="card" style="margin:10px 0">
      <div class="overview-section-heading"><h2>Daily study goal</h2><span>${dailyReviews}/${dailyGoal} reviews</span></div>
      <div style="height:8px;background:var(--surface2);border-radius:8px;overflow:hidden"><div style="height:100%;width:${dailyPercent}%;background:var(--teal);border-radius:8px"></div></div>
      <div style="display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin-top:10px">
        <div class="fg" style="max-width:130px;margin:0"><label for="revision-daily-goal">Reviews per day</label><input id="revision-daily-goal" type="number" min="1" max="200" value="${dailyGoal}"></div>
        <button class="btn bsm" onclick="updateDailyGoal()">Save goal</button>
        <span class="knowledge-meta">${dailyPercent>=100?'Daily goal reached.':(dailyGoal-dailyReviews)+' more reviews to reach today\'s goal.'}</span>
      </div>
    </section>
    <section class="overview-hero">
      <div class="overview-hero-copy">
        <div class="overview-kicker">NEXT STEP</div>
        <h2>${heroTitle}</h2>
        <p>${heroText}</p>
        <div class="overview-actions">
          ${hasCards?'<div class="fg"><label for="session-length">Session size</label><select id="session-length"><option value="10">10 cards</option><option value="20" selected>20 cards</option><option value="50">50 cards</option><option value="100">100 cards</option></select></div>':''}
          ${!hasCards?'<button class="btn bp" onclick="state.view=\'create\';renderRevision()">Add a flashcard</button><button class="btn" onclick="state.view=\'settings\';renderRevision()">Import a course pack</button>':due.due?'<button class="btn bp" onclick="startStudySession(\'due\',document.getElementById(\'session-length\').value)">Start review</button>':'<button class="btn bp" onclick="startStudySession(\'all\',document.getElementById(\'session-length\').value)">Study all cards</button>'}
          ${hasCards&&weak?'<button class="btn" onclick="startStudySession(\'weak\',document.getElementById(\'session-length\').value)">Review difficult cards</button>':''}
          ${hasCards?'<button class="btn" onclick="state.view=\'analytics\';renderRevision()">View progress</button>':''}
        </div>
      </div>
      ${hasCards?'<div class="overview-hero-count"><strong>'+due.due+'</strong><span>due now</span></div>':'<div class="overview-hero-count"><strong>0</strong><span>cards added</span></div>'}
    </section>
    ${hasCards?`<div class="overview-stats">
      <div class="scard"><div class="snum">${state.cards.length}</div><div class="slbl">Flashcards</div></div>
      <div class="scard"><div class="snum">${reviewed}</div><div class="slbl">Cards reviewed</div></div>
      <div class="scard"><div class="snum">${state.cards.reduce((n,c)=>n+(c.links||[]).length,0)/2|0}</div><div class="slbl">Concept links</div></div>
    </div>
    <div class="overview-grid">
      <section class="overview-section">
        <div class="overview-section-heading"><h2>Your knowledge map</h2><span>${state.cards.length} cards</span></div>
        ${renderGraph()}
      </section>
      <aside class="overview-section">
        ${renderSuggestions()}
        ${selected?`<div class="card" style="margin-top:14px"><div class="sec" style="margin-top:0">Selected card</div><div class="knowledge-title">${escapeRevision(selected.title)}</div><p style="font-size:.86rem;line-height:1.65;color:var(--text2);margin-top:8px">${escapeRevision(selected.answer)}</p>${selected.source?`<div class="knowledge-meta">Source: ${escapeRevision(selected.source)}</div>`:''}<div class="overview-selected-actions"><button class="btn bp" onclick="startStudy('${selected.id}')">Review card</button>${linkedCards(selected).length?`<button class="btn" onclick="beginConnectionReview('${selected.id}')">Review links</button>`:''}<button class="btn" onclick="linkRevisionCard('${selected.id}')">Link idea</button><button class="btn" onclick="editRevisionCard('${selected.id}')">Edit</button><button class="btn br" onclick="deleteRevisionCard('${selected.id}')">Delete</button></div></div>`:''}
      </aside>
    </div>`:'<div class="overview-empty"><h2>Your revision space is ready</h2><p>Start with one flashcard, or import a course pack to add topics, notes, equations and cards together.</p></div>'}
  </div>`;
}
function renderCards(){
  const card=currentStudyCard();
  if(!card)return `<div class="pt">${state.studySessionActive?'Session complete':'Flashcards'}</div><div class="ps">${state.studySessionActive?'Nice work. No cards remain in this session.':'No cards yet.'}</div>${renderSessionSummary()}<button class="btn" onclick="state.studySessionActive=false;state.view='overview';renderRevision()">Back to overview</button>`;
  const queueLength=state.studySessionActive?state.studyQueue.length:state.cards.length;
  const progress=cardReviewStats(card);
  return `<div style="max-width:620px;margin:0 auto"><div class="pt">${state.studySessionActive?'Study session':'Flashcards'}</div><div class="ps">${state.studySessionActive?`${state.studyQueue.length} remaining · ${state.sessionReviewed} reviewed`:`${state.studyIndex%Math.max(queueLength,1)+1} of ${queueLength}`} · ${escapeRevision(card.topic)} · ${formatDue(state.progress[card.id]?.due)}</div><div class="card" style="min-height:230px;display:flex;flex-direction:column;justify-content:center;text-align:center"><div class="tag tp">${escapeRevision(card.topic)}</div><div style="font-size:1.15rem;font-weight:600;margin:18px 0">${escapeRevision(card.title)}</div>${state.revealed?`<p style="font-size:.85rem;color:var(--text2);line-height:1.7">${escapeRevision(card.answer)}</p>${card.source?`<div class="knowledge-meta" style="margin-top:7px">Source: ${escapeRevision(card.source)}</div>`:''}<div class="knowledge-links" style="justify-content:center;margin-top:14px">${linkedCards(card).map(link=>`<span class="knowledge-link" onclick="selectRevisionCard('${link.id}')">↗ ${escapeRevision(link.title)}</span>`).join('')}</div>`:'<div class="ps">Try to answer, then reveal the explanation.</div>'}<div style="display:flex;justify-content:center;gap:7px;margin-top:20px;flex-wrap:wrap">${state.revealed?`<button class="btn br" onclick="rateCard('${card.id}',0)">Again · 10m</button><button class="btn" onclick="rateCard('${card.id}',1)">Hard · 1d</button><button class="btn bp" onclick="rateCard('${card.id}',2)">Good · ${progress.reviews?'adaptive':'1d'}</button><button class="btn bg" onclick="rateCard('${card.id}',3)">Easy · longer</button>`:`<button class="btn bp" onclick="state.revealed=true;renderRevision()">Reveal answer</button>`}</div></div>${state.studySessionActive?renderSessionSummary():''}<div style="display:flex;gap:7px;margin-top:9px;justify-content:center"><button class="btn" onclick="state.studySessionActive=false;state.view='overview';renderRevision()">End session</button>${linkedCards(card).length?`<button class="btn" onclick="beginConnectionReview('${card.id}')">Review a connection</button>`:''}</div></div>`;
}
function renderGraphView(){
  const selected=cardById(state.selected);
  return '<div class="pt">Knowledge map</div><div class="ps">Cards are grouped by subject and topic. Select a card to see its answer and connected ideas.</div><div class="map-toolbar"><label for="knowledge-map-search">Find a card</label><input id="knowledge-map-search" type="search" value="'+escapeRevision(state.graphQuery||'')+'" placeholder="Search titles, topics and answers…" oninput="filterKnowledgeMap(this.value)"></div><div id="knowledge-map-content">'+renderGraph()+'</div><div id="knowledge-map-selection">'+renderGraphSelection(selected)+'</div>';
}
function renderCreateCard(){return `<div style="max-width:620px;margin:0 auto"><div class="pt">Create a revision card</div><div class="ps">Add a source reference so you can check the original material later.</div><form class="card" onsubmit="event.preventDefault();submitRevisionCard()"><div class="g2"><div class="fg"><label for="new-card-subject">Subject</label><input id="new-card-subject" type="text" placeholder="e.g. Biology" required></div><div class="fg"><label for="new-card-topic">Topic</label><input id="new-card-topic" type="text" placeholder="e.g. Cells" required></div></div><div class="fg"><label for="new-card-title">Front / term</label><input id="new-card-title" type="text" placeholder="What should you remember?" required></div><div class="fg"><label for="new-card-answer">Back / definition</label><textarea id="new-card-answer" rows="6" placeholder="Write the definition or explanation..." required></textarea></div><div class="fg"><label for="new-card-source">Source reference (optional)</label><input id="new-card-source" type="text" placeholder="Book, page, URL, or document"></div><div class="fg"><label for="new-card-difficulty">Difficulty</label><select id="new-card-difficulty"><option value="1">Easy</option><option value="2" selected>Medium</option><option value="3">Hard</option></select></div><div style="display:flex;gap:7px;flex-wrap:wrap"><button class="btn bp" type="submit">＋ Add card</button><button class="btn" type="button" onclick="state.view='overview';renderRevision()">Cancel</button></div></form></div>`;}
function renderSettings(){
  const activeSet = getActiveRevisionSet();
  const themes = ThemeManager.getAllThemes('global');
  const selectedTheme = localStorage.getItem('vt_theme') || 'default';
  const syncLabel = state.syncStatus==='syncing' ? 'Syncing changes…' : state.syncStatus==='synced' ? 'All changes synced' : state.syncStatus==='offline' ? 'Offline · saved on this device' : state.syncStatus==='error' ? 'Sync needs attention' : state.syncStatus==='conflict' ? 'Sync conflict needs a decision' : 'Saved on this device';
  const syncStatus = `<div class="knowledge-meta" role="status">${syncLabel}</div>`;
  const accountStatus = (state.accountMessage ? `<div class="qfb ${state.accountMessageType==='error'?'qwr':'qok'}" role="status">${escapeRevision(state.accountMessage)}</div>` : '') + syncStatus;
  const themeStatus = state.themeMessage ? `<div class="knowledge-meta" role="status" style="margin-top:8px">${escapeRevision(state.themeMessage)}</div>` : '';
  return `<div style="max-width:820px;margin:0 auto">
    <div class="pt">Settings & account</div>
    <div class="ps">Your cards stay on this device. Sign in to sync them across devices or publish notes.</div>
    <div class="card">
      <div class="sec" style="margin-top:0">Shared account</div>
      <div class="srow">
        <div>
          <div class="knowledge-title">${escapeRevision(revisionUsername() || 'GCSE Vault account')}</div>
          <div class="knowledge-meta">${VaultUser.getAccountSession() ? 'Signed in · Revision sync is available across devices' : revisionUserKey() ? 'Existing account linked · set a password to enable syncing' : 'Sign in or create an account to sync your sets across devices'}</div>
        </div>
        <button class="btn bsm" type="button" onclick="VaultUser.showAccountDialog()">${VaultUser.getAccountSession() ? 'Manage account' : 'Sign in / Create account'}</button>
      </div>
      ${VaultUser.getAccountSession() ? '<button class="btn bsm" type="button" style="margin-top:8px" onclick="syncRevision()">Sync now</button>' : ''}
      ${accountStatus}
      ${revisionSyncConflict?'<div class="qfb qwr" role="status">Changes exist on this device and another device. Your local data has not been overwritten.<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px"><button class="btn bsm" type="button" onclick="resolveRevisionSyncConflict(\'remote\')">Load other device copy</button><button class="btn bsm bp" type="button" onclick="resolveRevisionSyncConflict(\'local\')">Keep this device copy</button></div></div>':''}
      <div class="srow">
        <div>
          <div class="knowledge-title">Revision XP</div>
          <div class="knowledge-meta">${state.xp} XP · ${state.streak} day streak · +10 XP per successful review</div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:10px">
      <div class="sec" style="margin-top:0">Appearance</div>
      <div class="knowledge-meta" style="margin-bottom:8px">Theme selection syncs with your shared account.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:7px">
        ${Object.entries(themes).map(([key,theme])=>`<button class="revision-theme-choice" type="button" data-revision-theme="${escapeRevision(key)}" aria-pressed="${key===selectedTheme}" style="text-align:left;padding:8px;border:1px solid ${key===selectedTheme?'var(--purple)':'var(--border2)'};border-radius:7px;background:${escapeRevision(theme['--bg2']||'var(--bg2)')};color:${escapeRevision(theme['--text']||'var(--text)')};cursor:pointer"><span style="display:flex;gap:4px;margin-bottom:6px"><i style="width:15px;height:7px;background:${escapeRevision(theme['--gold']||'var(--gold)')};border-radius:4px"></i><i style="width:15px;height:7px;background:${escapeRevision(theme['--purple']||'var(--purple)')};border-radius:4px"></i><i style="width:15px;height:7px;background:${escapeRevision(theme['--teal']||'var(--teal)')};border-radius:4px"></i></span><span style="font-size:.72rem;font-weight:600">${escapeRevision(theme.label||key)}${key===selectedTheme?' · Active':''}</span></button>`).join('')}
      </div>
      ${VaultUser.getAccountSession()?`<button class="btn bsm" type="button" style="margin-top:9px" onclick="syncRevisionThemes()">Sync saved themes</button>`:''}
      ${themeStatus}
    </div>
    <div class="card" style="margin-top:10px">
      <div class="sec" style="margin-top:0">Saved sets</div>
      ${state.setMessage?`<div class="qfb qok" role="status">${escapeRevision(state.setMessage)}</div>`:''}
      <div class="knowledge-list">
        ${state.accountSets.map(set => `
          <div class="knowledge-item${set.id===state.activeSetId ? ' active' : ''}">
            <span class="knowledge-dot"></span>
            <div style="flex:1;min-width:0;">
              ${state.editingSetId===set.id?`<input id="revision-set-name-${escapeRevision(set.id)}" type="text" maxlength="80" value="${escapeRevision(set.name||'Revision set')}" aria-label="Set name" style="max-width:320px">`:`<div class="knowledge-title">${escapeRevision(set.name || 'Revision set')}</div>`}
              <div class="knowledge-meta">${Array.isArray(set.cards) ? set.cards.length : 0} cards · ${set.published ? 'Published' : 'Private'} · ${set.id === activeSet.id ? 'Active set' : 'Stored set'}</div>
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn bsm" type="button" onclick="switchRevisionSet('${set.id}')">Switch</button>
              <button class="btn bsm" type="button" onclick="duplicateRevisionSet('${set.id}')">Duplicate</button>
              <button class="btn bsm" type="button" onclick="moveRevisionSet('${set.id}',-1)" ${state.accountSets.indexOf(set)===0?'disabled':''} aria-label="Move ${escapeRevision(set.name)} up">↑</button>
              <button class="btn bsm" type="button" onclick="moveRevisionSet('${set.id}',1)" ${state.accountSets.indexOf(set)===state.accountSets.length-1?'disabled':''} aria-label="Move ${escapeRevision(set.name)} down">↓</button>
              ${state.editingSetId===set.id?`<button class="btn bsm bp" type="button" onclick="saveRevisionSetName('${set.id}')">Save name</button><button class="btn bsm" type="button" onclick="state.editingSetId=null;renderRevision()">Cancel</button>`:`<button class="btn bsm" type="button" onclick="renameRevisionSet('${set.id}')">Edit</button>`}
              ${state.confirmDeleteSetId===set.id?`<span class="knowledge-meta" style="align-self:center">Delete this set?</span><button class="btn bsm br" type="button" onclick="confirmDeleteRevisionSet('${set.id}')">Confirm</button><button class="btn bsm" type="button" onclick="cancelDeleteRevisionSet()">Cancel</button>`:`<button class="btn bsm br" type="button" onclick="requestDeleteRevisionSet('${set.id}')">Delete</button>`}
            </div>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">
        <button class="btn bp" type="button" onclick="addRevisionSet()">＋ New set</button>
        <button class="btn" type="button" onclick="exportRevisionSet('json')">Export JSON</button>
        <button class="btn" type="button" onclick="exportRevisionSet('csv')">Export CSV</button>
        <label class="btn" for="revision-import-file">Import JSON / CSV</label><input id="revision-import-file" type="file" accept=".json,.csv,text/csv,application/json" hidden onchange="importRevisionFile(this)">
      </div>
      ${renderPublishSetControl()}
    </div>
    <div class="card" style="margin-top:10px">
      <div class="sec" style="margin-top:0">Notes</div>
      <div class="srow">
        <div>
          <div class="knowledge-title">${state.cards.length} private cards</div>
          <div class="knowledge-meta">Edit, link, publish, or remove your own cards.</div>
        </div>
        ${state.confirmClearData?`<div><span class="knowledge-meta">Delete cards and progress from this device?</span> <button class="btn br bsm" type="button" onclick="clearRevisionData()">Confirm clear</button><button class="btn bsm" type="button" onclick="state.confirmClearData=false;renderRevision()">Cancel</button></div>`:`<button class="btn br" type="button" onclick="state.confirmClearData=true;renderRevision()">Clear local data</button>`}
      </div>
    </div>
  </div>`;
}
function renderPublicNotes(){return `<div style="max-width:850px;margin:0 auto"><div class="pt">Public notes</div><div class="ps">Browse shared study notes. Public notes are copied into your workspace only when you choose to import them.</div><div class="card" style="margin:10px 0"><div class="sec" style="margin-top:0">Share a revision set</div><div class="knowledge-meta">Choose exactly which set to submit for admin review. Your other sets remain private.</div>${renderPublishSetControl()}</div><div style="display:flex;gap:7px;margin-bottom:10px;flex-wrap:wrap"><button class="btn" onclick="loadPublicNotes()">Refresh</button></div><div class="knowledge-list">${state.publicNotes.length?state.publicNotes.map(note=>`<div class="card"><div class="tag tg">${escapeRevision(note.subject)}${note.level?' · '+escapeRevision(note.level):''}</div><div class="knowledge-title" style="margin-top:6px">${escapeRevision(note.title)}</div><div class="knowledge-meta">${note.cards?.length||0} cards · ${escapeRevision(note.updatedAt||'')}</div><div style="display:flex;gap:6px;margin-top:8px"><button class="btn bsm" onclick="importPublicNote('${note.id}')">＋ Import copy</button>${note.owned?`<button class="btn bsm br" onclick="deletePublicNote('${note.id}')">Delete</button>`:''}</div></div>`).join(''):'<div class="ps">No public notes have been published yet.</div>'}</div></div>`;}
function renderLeaderboard(){return `<div style="max-width:620px;margin:0 auto"><div class="pt">Revision leaderboard</div><div class="ps">Earn 10 XP each time you successfully review a card.</div><div class="card"><div id="revision-leaderboard-list" class="knowledge-list"><div class="ps">Loading leaderboard...</div></div></div></div>`;}
function normalizeAIResult(raw, additionalIds=[]){
  let payload = raw;
  if (typeof raw === 'string') {
    try { payload = JSON.parse(raw); } catch (error) { payload = {}; }
  }
  if (payload && payload.choices && Array.isArray(payload.choices)) {
    const content = payload.choices[0]?.message?.content;
    if (typeof content === 'string') {
      try { payload = JSON.parse(content); } catch (error) {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          try { payload = JSON.parse(match[0]); } catch (retryError) { payload = {}; }
        }
      }
    }
  }
  const flashcards = Array.isArray(payload?.flashcards) ? payload.flashcards.map((item, index) => ({
    id: String(item?.id || `c${index + 1}`).trim(),
    front: String(item?.front || '').trim(),
    back: String(item?.back || '').trim()
  })).filter(item => item.front || item.back) : [];
  const cardIds = new Set([...flashcards.map(card => card.id),...additionalIds]);
  const links = Array.isArray(payload?.links) ? payload.links.map(item => ({
    from_id: String(item?.from_id || '').trim(),
    to_id: String(item?.to_id || '').trim()
  })).filter(item => item.from_id !== item.to_id && cardIds.has(item.from_id) && cardIds.has(item.to_id)) : [];
  return { flashcards, links };
}
function renderAIResult(result){
  const normalized = normalizeAIResult(result || {},state.cards.map(card=>card.id));
  const titles = new Map([...state.cards.map(card=>[card.id,card.title]),...normalized.flashcards.map(card => [card.id, card.front])]);
  return `<div class="card" style="margin-top:10px"><div class="sec" style="margin-top:0">${normalized.flashcards.length} flashcards · ${normalized.links.length} links</div>${normalized.flashcards.length?`<div class="g2" style="margin-top:8px">${normalized.flashcards.map(card=>`<div class="dr dr-ok"><div class="tag tp">${escapeRevision(card.front)}</div><div style="margin-top:5px;color:var(--text2)">${escapeRevision(card.back)}</div></div>`).join('')}</div>`:'<div class="ps">No new flashcards generated.</div>'}${normalized.links.length?`<div style="margin-top:10px"><div class="sec" style="margin-top:0">Connections</div>${normalized.links.map(link=>`<div class="dr dr-near">${escapeRevision(titles.get(link.from_id)||link.from_id)} ↔ ${escapeRevision(titles.get(link.to_id)||link.to_id)}</div>`).join('')}</div>`:''}</div>`;
}
function bindAIFormEvents(){
  const page = document.getElementById('page');
  if (!page) return;
  page.querySelectorAll('[data-ai-field]').forEach((field) => {
    const key = field.dataset.aiField;
    const value = state.aiDraft[key] ?? '';
    if (field.tagName === 'TEXTAREA') {
      field.value = value;
    } else {
      field.value = value;
    }
    field.oninput = (event) => {
      state.aiDraft[key] = event.target.value;
    };
  });
  const modeField=page.querySelector('#ai-mode');
  if(modeField)modeField.onchange=()=>{state.aiDraft.mode=modeField.value;state.aiResult=null;state.aiNotice='';AdminManager.error='';renderRevision();};
}
function aiActionLabel(mode=state.aiDraft.mode||'new'){
  return mode==='add'?'Find missing cards':mode==='links'?'Find links':'Generate flashcards';
}
const RevisionAIManager = {
  token: null,
  getToken(){return this.token || sessionStorage.getItem('revision_ai_session') || null;},
  async login(){
    const accountToken=VaultUser.getAccountSession();
    if(!accountToken)throw new Error('Sign in to your GCSE Vault account first.');
    const response=await fetch(`${ThemeManager.WORKER_URL}/ai/auth`,{method:'POST',headers:{'X-Account-Session':accountToken}});
    const data=await VaultUser.readResponse(response);
    if(!response.ok){const error=new Error(response.status===404?'The AI sign-in endpoint is not deployed yet. The Worker needs updating.':data.error||data.message||(response.status===403?'This account does not have AI access.':'Could not sign in.'));error.status=response.status;throw error;}
    this.token=data.token;
    sessionStorage.setItem('revision_ai_session',data.token);
    return data;
  },
  async logout(){
    const token=this.getToken();
    this.token=null;
    sessionStorage.removeItem('revision_ai_session');
    if(token)await fetch(`${ThemeManager.WORKER_URL}/ai/logout`,{method:'POST',headers:{'X-AI-Session':token},keepalive:true}).catch(()=>{});
  }
};
function renderAI(){
  const loggedIn=Boolean(RevisionAIManager.getToken());
  return `<div style="max-width:760px;margin:0 auto"><div class="pt">AI revision tools</div><div class="ps">Generate, extend, or reconnect flashcards. Results are previewed first; they are not saved until you apply them.</div>${!loggedIn?`<div class="ai-warning">AI generation is locked. An account with AI access must sign in before provider credits can be used.</div><div class="card" style="max-width:380px;margin-top:10px"><div class="knowledge-meta">Account: ${escapeRevision(revisionUsername()||'Not linked')}</div><button class="btn bg" onclick="loginRevisionAI()" ${VaultUser.getAccountSession()?'':'disabled'}>Sign in with account</button>${AdminManager.error?`<div class="qfb qwr">${escapeRevision(AdminManager.error)}</div>`:''}</div>`:`<div class="card"><div class="g2"><div class="fg"><label for="ai-mode">Action</label><select data-ai-field="mode" id="ai-mode"><option value="new"${state.aiDraft.mode==='new'?' selected':''}>Create a new set</option><option value="add"${state.aiDraft.mode==='add'?' selected':''}>Add missing cards to active set</option><option value="links"${state.aiDraft.mode==='links'?' selected':''}>Repair links in active set</option></select></div><div class="fg"><label>Set name</label><input data-ai-field="setName" type="text" id="ai-set-name" placeholder="e.g. Cell Biology" value="${escapeRevision(state.aiDraft.setName || '')}"></div><div class="fg"><label>Subject</label><input data-ai-field="subject" type="text" id="ai-subject" placeholder="e.g. Biology" value="${escapeRevision(state.aiDraft.subject || '')}"></div><div class="fg"><label>Level</label><input data-ai-field="level" type="text" id="ai-level" placeholder="e.g. GCSE, A-Level" value="${escapeRevision(state.aiDraft.level || '')}"></div><div class="fg"><label for="ai-count">New flashcards</label><input data-ai-field="count" type="number" id="ai-count" min="5" max="100" step="1" value="${escapeRevision(state.aiDraft.count || '30')}"></div><div class="fg"><label for="ai-source">Source reference (optional)</label><input data-ai-field="source" type="text" id="ai-source" placeholder="Textbook, page, URL" value="${escapeRevision(state.aiDraft.source || '')}"></div></div><div class="fg"><label>Topic notes / syllabus content</label><textarea data-ai-field="notes" id="ai-notes" rows="12" placeholder="Paste all the material for the topic here...">${escapeRevision(state.aiDraft.notes || '')}</textarea></div><div class="fg"><label for="ai-file">Attach notes file (.txt, .md, .csv, .pdf, .docx)</label><input id="ai-file" type="file" accept=".txt,.md,.csv,.pdf,.docx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onchange="handleRevisionFile('ai-file','ai-notes')"></div>${state.uploadMessage?`<div class="knowledge-meta" role="status">${escapeRevision(state.uploadMessage)}</div>`:''}${state.aiNotice?`<div class="qfb ${state.aiNotice.startsWith('No flashcards')?'qwr':'qok'}" role="status">${escapeRevision(state.aiNotice)}</div>`:''}<div style="display:flex;gap:7px;flex-wrap:wrap"><button class="btn bp" onclick="requestRevisionAI()">✦ ${aiActionLabel()}</button><button class="btn" onclick="lockRevisionAI()">Lock AI</button></div>${state.aiResult?`${renderAIResult(state.aiResult)}<button class="btn bg" style="margin-top:8px" onclick="importAIResult()">${state.aiDraft.mode==='links'?'＋ Apply connections':state.aiDraft.mode==='add'?'＋ Add cards to active set':'＋ Create new set'}</button>`:''}</div>`}</div>`;
}
function openModal(html){
  const modal=document.getElementById('modal');
  const backdrop=document.getElementById('modal-bg');
  if(!modal||!backdrop)return;
  modal.innerHTML=html;
  backdrop.classList.add('open');
}
function closeModal(){
  document.getElementById('modal-bg')?.classList.remove('open');
}
window.openModal=openModal;
window.closeModal=closeModal;
function renderRevision(){
  const setSwitcher=document.getElementById('revision-set-switcher');
  if(setSwitcher){setSwitcher.innerHTML=state.accountSets.map(set=>`<option value="${escapeRevision(set.id)}">${escapeRevision(set.name)} · ${(set.cards||[]).length}</option>`).join('');setSwitcher.value=state.activeSetId;setSwitcher.title=`Current set: ${getActiveRevisionSet().name}`;}
  document.querySelectorAll('#revision-nav select').forEach(select=>{select.value=[...select.options].some(option=>option.value===state.view)?state.view:'';});
  document.getElementById('page').innerHTML=state.view==='resources'?practiceResourcesView():state.view==='cards'?renderCards():state.view==='create'?renderCreateCard():state.view==='edit'?renderEditCard():state.view==='link'?renderLinkCard():state.view==='graph'?renderGraphView():state.view==='library'?renderLibrary():state.view==='analytics'?renderAnalytics():state.view==='connection'?renderConnectionReview():state.view==='ai'?renderAI():state.view==='public'?renderPublicNotes():state.view==='leaderboard'?renderLeaderboard():state.view==='settings'?renderSettings():renderOverview();
  const sidebarStats=document.getElementById('sidebar-stats');
  if(sidebarStats)sidebarStats.textContent=`${state.cards.length} cards · ${state.cards.reduce((n,c)=>n+(c.links||[]).length,0)/2|0} links`;
  const sidebarProgress=document.getElementById('sidebar-progress');
  if(sidebarProgress)sidebarProgress.textContent=`${state.xp} XP · ${state.cards.filter(card=>Number(state.progress[card.id]?.reviews)>0).length} reviewed`;
  if(state.view==='leaderboard')loadRevisionLeaderboard();
  if(state.view==='ai')bindAIFormEvents();
  if(state.view==='settings')bindSettingsEvents();
  if(state.view==='library')bindLibraryEvents();
}
function selectRevisionCard(id){state.selected=id;state.view=state.view==='cards'?'cards':state.view;renderRevision();}
function startTopic(topic){const decoded=decodeURIComponent(topic);const index=state.cards.findIndex(card=>card.topic===decoded);if(index>=0){state.studyIndex=index;state.revealed=false;state.view='cards';renderRevision();}}
function startStudy(id){const index=state.cards.findIndex(card=>card.id===id);if(index>=0){state.studyIndex=index;state.revealed=false;state.view='cards';renderRevision();}}
async function loadRevisionLeaderboard(){try{const response=await fetch(`${ThemeManager.WORKER_URL}/revision/leaderboard`);const payload=await response.json();const target=document.getElementById('revision-leaderboard-list');if(!target)return;target.innerHTML=(payload.users||[]).map((user,index)=>`<div class="knowledge-item"><span class="knowledge-dot"></span><div><div class="knowledge-title">${index+1}. ${escapeRevision(user.username)}</div><div class="knowledge-meta">${user.xp||0} XP · ${user.streak||0} day streak</div></div></div>`).join('')||'<div class="ps">No revision accounts yet.</div>';}catch(error){const target=document.getElementById('revision-leaderboard-list');if(target)target.innerHTML='<div class="ps">Leaderboard unavailable.</div>';}}
async function publishRevisionNotes(){publishSelectedRevisionSet();}
async function importPublicNote(id){const note=state.publicNotes.find(item=>item.id===id);if(!note)return;const existing=new Set(state.cards.map(card=>String(card.title).toLowerCase()));const imported=(note.cards||[]).filter(card=>!existing.has(String(card.title||'').toLowerCase())).map(card=>({...card,id:'import'+Date.now()+Math.random().toString(36).slice(2,6),links:[]}));state.cards.push(...imported);saveRevision();state.selected=imported[0]?.id||state.selected;state.view='overview';renderRevision();}
async function deletePublicNote(id){if(!VaultUser.getAccountSession()){VaultUser.showAccountDialog();return;}if(!confirm('Delete this public note set?'))return;try{await fetch(`${ThemeManager.WORKER_URL}/revision/public/delete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userKey:revisionUserKey(),id})});await loadPublicNotes();}catch(error){alert('Could not delete public notes.');}}
async function lockRevisionAI(){await RevisionAIManager.logout();state.aiResult=null;AdminManager.error='';renderRevision();}
async function loginRevisionAI(){try{await RevisionAIManager.login();AdminManager.error='';}catch(error){AdminManager.error=error.status===404?'The AI sign-in endpoint is not deployed yet. The Worker needs updating.':error.message;}renderRevision();}
async function requestRevisionAI(){
  const notes=document.getElementById('ai-notes')?.value||'';
  const requestedMode=document.getElementById('ai-mode')?.value||'new';
  if(!notes.trim()&&requestedMode!=='links'){state.aiNotice='Add topic notes or attach a notes file before generating flashcards.';renderRevision();return;}
  state.aiDraft.mode=requestedMode;
  state.aiResult=null;
  state.aiNotice='';
  const button=document.querySelector('#page .bp');
  const showStatus=(message,isError=false)=>{
    let status=document.getElementById('revision-ai-status');
    if(!status){
      status=document.createElement('div');
      status.id='revision-ai-status';
      status.className=`qfb ${isError?'qwr':'ai-warning'}`;
      status.setAttribute('role','status');
      status.setAttribute('aria-live','polite');
      button?.parentElement?.insertAdjacentElement('afterend',status);
    }
    status.className=`qfb ${isError?'qwr':'ai-warning'}`;
    status.textContent=message;
  };
  const controller=new AbortController();
  const startedAt=Date.now();
  let timer;
  const timeout=setTimeout(()=>controller.abort(),300000);
  if(button){button.disabled=true;button.textContent=requestedMode==='add'?'Finding missing cards...':requestedMode==='links'?'Finding links...':'Generating flashcards...';}
  showStatus('Sending your notes to the worker...');
  timer=setInterval(()=>showStatus(`Waiting for the AI response (${Math.floor((Date.now()-startedAt)/1000)}s). The model does not provide live progress.`),1000);
  try{
    const token=RevisionAIManager.getToken();
    if(!token) throw new Error('AI access session expired. Please sign in again.');
    const count=Math.max(5,Math.min(100,Number(document.getElementById('ai-count')?.value)||30));
    const mode=requestedMode;
    state.aiDraft.mode=mode;
    state.aiDraft.count=String(count);
    const subject=document.getElementById('ai-subject')?.value.trim()||'';
    const level=document.getElementById('ai-level')?.value.trim()||'';
    const source=document.getElementById('ai-source')?.value.trim()||'';
    const existingCards=mode==='new'?[]:state.cards.map(card=>({id:card.id,front:card.title,back:card.answer}));
    const material=[subject?`Subject: ${subject}`:'',level?`Level: ${level}`:'',source?`Source reference: ${source}`:'',notes.trim()||'Find useful connections among the existing cards.'].filter(Boolean).join('\n\n');
    const response=await fetch(`${ThemeManager.WORKER_URL}/generate`,{method:'POST',headers:{'Content-Type':'application/json','X-AI-Session':token},body:JSON.stringify({count,mode,existingCards,material}),signal:controller.signal});
    showStatus('Response received. Reading the study guide...');
    const data=await response.json();
    if(!response.ok){if(response.status===401||response.status===403)RevisionAIManager.logout();throw new Error(data.error||`HTTP ${response.status}`);}
    state.aiResult=normalizeAIResult(data,existingCards.map(card=>card.id));
    state.aiNotice=mode==='links'?`Preview ready: ${state.aiResult.links.length} connections. Nothing has been changed yet.`:state.aiResult.flashcards.length?`Preview ready: ${state.aiResult.flashcards.length} flashcards and ${state.aiResult.links.length} links. Nothing has been saved yet.`:'No flashcards were returned. Add more topic notes or check that the requested action matches the content.';
    AdminManager.error='';
    renderRevision();
  }catch(error){
    const message=error.name==='AbortError'?'No response after 5 minutes. The browser stopped waiting; the worker may still have completed the request. Check worker logs before retrying.':error.message||'Study guide generation failed.';
    AdminManager.error=message;
    renderRevision();
    showStatus(message,true);
  } finally {
    clearTimeout(timeout);
    clearInterval(timer);
    const readyButton=document.querySelector('#page .bp');
    if(readyButton){readyButton.disabled=false;readyButton.textContent=`✦ ${aiActionLabel()}`;}
  }
}
function importAIResult(){
  const mode=state.aiDraft.mode||'new';
  const result=normalizeAIResult(state.aiResult||{},mode==='new'?[]:state.cards.map(card=>card.id));
  const subject=document.getElementById('ai-subject')?.value.trim()||'General';
  const level=document.getElementById('ai-level')?.value.trim()||'';
  const requestedName=document.getElementById('ai-set-name')?.value.trim()||'';
  const baseName=requestedName||`${subject}${level?` ${level}`:''} study guide`;
  let name=baseName;let suffix=2;
  if(mode==='new')while(state.accountSets.some(set=>set.name.toLowerCase()===name.toLowerCase()))name=`${baseName} (${suffix++})`;
  const makeId=()=>`ai${Date.now()}${Math.random().toString(36).slice(2,7)}`;
  const idMap=new Map();
  if(mode!=='new')state.cards.forEach(card=>idMap.set(card.id,card.id));
  const cards=result.flashcards.filter(item=>item.front||item.back).map(item=>{
    const id=mode==='links'&&cardById(item.id)?item.id:makeId();idMap.set(item.id,id);
    return {id,subject,topic:mode==='new'?name:(item.topic||getActiveRevisionSet().name),title:item.front,answer:item.back,source:document.getElementById('ai-source')?.value.trim()||state.aiDraft.source||'',links:[],difficulty:2};
  });
  const targetCards=mode==='new'?cards:[...state.cards,...cards];
  result.links.forEach(link=>{
    const from=idMap.get(link.from_id),to=idMap.get(link.to_id);
    if(!from||!to||from===to)return;
    const first=targetCards.find(card=>card.id===from),second=targetCards.find(card=>card.id===to);
    if(first&&!first.links.includes(to))first.links.push(to);
    if(second&&!second.links.includes(from))second.links.push(from);
  });
  if(mode==='links'){
    if(!result.links.length){state.setMessage='No valid links were returned for this set.';renderRevision();return;}
    state.aiResult=null;state.setMessage=`Repaired ${result.links.length} connections in “${getActiveRevisionSet().name}”.`;state.view='overview';saveRevision();renderRevision();return;
  }
  if(!cards.length){state.setMessage='The AI did not return any flashcards to apply.';renderRevision();return;}
  if(mode==='add'){
    state.cards.push(...cards);state.selected=cards[0].id;state.aiResult=null;state.setMessage=`Added ${cards.length} flashcards and ${result.links.length} connections to “${getActiveRevisionSet().name}”.`;
  }else{
    const newSet=normalizeRevisionSet({id:`set-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,name,cards,progress:{},xp:0,streak:0,lastReview:'',published:false});
    state.accountSets.push(newSet);state.activeSetId=newSet.id;state.publishSetId=newSet.id;state.cards=newSet.cards;state.progress={};state.xp=0;state.streak=0;state.lastReview='';
    state.selected=cards[0].id;state.aiResult=null;state.setMessage=`Saved ${cards.length} flashcards with ${result.links.length} connections in “${name}”.`;
  }
  state.view='overview';
  saveRevision();renderRevision();
}
function linkRevisionCard(id){
  const source=cardById(id);const choices=state.cards.filter(card=>card.id!==id);if(!source||!choices.length)return;
  const promptText=choices.map((card,index)=>`${index+1}. ${card.title}`).join('\n');const choice=Number(prompt(`Link "${source.title}" to which idea?\n\n${promptText}`));const target=choices[choice-1];if(!target)return;
  source.links=source.links||[];target.links=target.links||[];if(!source.links.includes(target.id))source.links.push(target.id);if(!target.links.includes(source.id))target.links.push(source.id);saveRevision();renderRevision();
}
function createRevisionCard(){
  const title=prompt('What idea should this card explain?');if(!title?.trim())return;
  const answer=prompt('What is the answer or explanation?')||'';const topic=prompt('Which topic is it part of?','My topic')||'My topic';
  const card={id:'r'+Date.now(),subject:'Custom',topic:topic.trim(),title:title.trim(),answer:answer.trim(),links:[],difficulty:2};state.cards.push(card);saveRevision();state.selected=card.id;renderRevision();
}
function submitRevisionCard(){const subject=document.getElementById('new-card-subject').value.trim();const topic=document.getElementById('new-card-topic').value.trim();const title=document.getElementById('new-card-title').value.trim();const answer=document.getElementById('new-card-answer').value.trim();const source=document.getElementById('new-card-source').value.trim();const difficulty=Number(document.getElementById('new-card-difficulty').value)||2;if(!subject||!topic||!title||!answer)return;const card={id:'r'+Date.now(),subject,topic,title,answer,source,links:[],difficulty};state.cards.push(card);state.selected=card.id;saveRevision();state.view='overview';renderRevision();}
function editRevisionCard(id){const card=cardById(id);if(!card)return;const title=prompt('Edit idea:',card.title);if(!title?.trim())return;const answer=prompt('Edit explanation:',card.answer);const topic=prompt('Edit topic:',card.topic);card.title=title.trim();card.answer=(answer||'').trim();card.topic=(topic||card.topic).trim();saveRevision();renderRevision();}
function deleteRevisionCard(id){const card=cardById(id);if(!card)return;state.cards=state.cards.filter(item=>item.id!==id);state.cards.forEach(item=>item.links=(item.links||[]).filter(linkId=>linkId!==id));delete state.progress[id];state.selected=null;saveRevision();renderRevision();}

const revisionSidebar = document.getElementById('sidebar');
const revisionHbg = document.getElementById('hbg');
const revisionOverlay = document.getElementById('overlay');
const revisionMobileMenu = document.getElementById('revision-mobile-menu');

function closeRevisionSidebar(){
  if(revisionSidebar)revisionSidebar.classList.remove('open');
  if(revisionOverlay)revisionOverlay.style.display='none';
  if(revisionHbg)revisionHbg.setAttribute('aria-expanded','false');
  if(revisionMobileMenu)revisionMobileMenu.setAttribute('aria-expanded','false');
}

document.querySelectorAll('#revision-nav select').forEach(select=>select.addEventListener('change',closeRevisionSidebar));
document.querySelectorAll('.ni').forEach(item => {
  item.addEventListener('click', () => {
    const nextView = item.dataset.view || 'overview';
    state.view = nextView;
    renderRevision();
    document.getElementById('page').scrollTop = 0;
    closeRevisionSidebar();
  });
});
if(revisionMobileMenu){revisionMobileMenu.addEventListener('click',()=>{if(!revisionSidebar)return;const isOpen=revisionSidebar.classList.toggle('open');if(revisionOverlay)revisionOverlay.style.display=isOpen?'block':'none';revisionMobileMenu.setAttribute('aria-expanded',String(isOpen));});}
if (revisionHbg) {
  revisionHbg.addEventListener('click', () => {
    if (!revisionSidebar) return;
    const isOpen = revisionSidebar.classList.toggle('open');
    if (revisionOverlay) revisionOverlay.style.display = isOpen ? 'block' : 'none';
    revisionHbg.setAttribute('aria-expanded',String(isOpen));
  });
}
if (revisionOverlay) revisionOverlay.addEventListener('click',closeRevisionSidebar);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeRevisionSidebar();});
const revisionQuickCreate = document.getElementById('new-card');
if (revisionQuickCreate) {
  revisionQuickCreate.addEventListener('click', () => {
    state.view = 'create';
    renderRevision();
  });
}


