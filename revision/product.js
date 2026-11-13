const productBaseStats=practiceStats;
practiceStats=function(topic){
 const result=productBaseStats(topic),p=practiceStore();
 const cards=state.cards.filter(card=>normalizeTopic(card.topic)===normalizeTopic(topic.name));
 const reviews=cards.reduce((n,card)=>n+Number(state.progress[card.id]?.reviews||0),0);
 const correct=cards.reduce((n,card)=>n+Number(state.progress[card.id]?.correct||0),0);
 const recall=reviews?correct/reviews:null;
 const lastCard=cards.reduce((n,card)=>Math.max(n,Number(state.progress[card.id]?.lastReviewed)||0),0);
 const lastAttempt=p.attempts.filter(item=>item.subjectId===topic.subjectId&&item.topicId===topic.id).reduce((n,item)=>Math.max(n,Number(item.at)||0),0);
 const last=Math.max(lastCard,lastAttempt),daysSince=last?Math.max(0,Math.floor((Date.now()-last)/86400000)):null;
 const enough=result.attempts>=2||reviews>=5;
 const health=!enough?'Not enough data':((result.accuracy!==null&&result.accuracy<.65)||(reviews>=5&&recall<.65)||result.mistakes>0)?'Needs attention':((result.accuracy===null||result.accuracy>=.8)&&(reviews<5||recall>=.8)&&result.mistakes===0)?'On track':'In progress';
 const evidence=[];if(result.attempts)evidence.push(result.attempts+' exam attempts');if(reviews)evidence.push(reviews+' flashcard reviews');if(result.mistakes)evidence.push(result.mistakes+' open mistakes');
 const signals=[];if(result.accuracy!==null)signals.push({v:1-result.accuracy,w:.5});if(reviews>=3&&recall!==null)signals.push({v:1-recall,w:.25});if(daysSince!==null)signals.push({v:Math.min(1,daysSince/21),w:.15});if(result.mistakes)signals.push({v:Math.min(1,result.mistakes/3),w:.1});
 const total=signals.reduce((n,item)=>n+item.w,0);
 return {...result,reviews,recall,last,daysSince,health,evidence:evidence.join(' · ')||'No recorded practice yet',priority:total?signals.reduce((n,item)=>n+item.v*item.w,0)/total:.5};
};
function productHealthTag(health){
 const cls=health==='Needs attention'?'tc-tag':health==='On track'?'tt':'tb';
 return '<span class="tag '+cls+'">'+practiceEsc(health)+'</span>';
}
function practiceDailyPlan(){
 const due=dueCards().length,p=practiceStore(),mistakes=p.mistakes.filter(item=>!item.resolved).length,unread=p.resources.filter(item=>!item.readAt).length;
 const attention=practiceTopics().map(topic=>({...topic,stats:practiceStats(topic)})).filter(topic=>topic.stats.health==='Needs attention').slice(0,3);
 if(!state.cards.length&&!Object.keys(p.catalogues).length&&!p.resources.length)return '';
 return '<section class="daily-plan card"><div class="overview-section-heading"><h2>Today’s plan</h2><span>Based on your saved revision data</span></div><div class="daily-plan-grid"><div><strong>'+due+'</strong><span>flashcards due</span></div><div><strong>'+mistakes+'</strong><span>open mistakes</span></div><div><strong>'+unread+'</strong><span>unread resources</span></div></div>'+(attention.length?'<div class="daily-attention"><span>Topics needing attention</span>'+attention.map(topic=>'<button type="button" class="btn bsm" onclick="practiceSelectTopic(\''+practiceEsc(topic.subjectId)+'\',\''+practiceEsc(topic.id)+'\')">'+practiceEsc(topic.name)+'</button>').join('')+'</div>':'')+(due?'<button type="button" class="btn bp" style="margin-top:12px" onclick="startStudySession(\'due\',20)">Start today’s review</button>':'')+(mistakes?'<button type="button" class="btn" style="margin:12px 0 0 7px" onclick="state.view=\'analytics\';renderRevision()">Review mistakes</button>':'')+'</section>';
}
const productOriginalOverview=renderOverview;
renderOverview=function(){
 let html=productOriginalOverview();
 if(!state.cards.length)html=html.replace('Your revision space is ready','Set up your revision space').replace('Start with one flashcard, or import a course pack to add topics, notes, equations and cards together.','Import a subject catalogue and its matching course pack to add a structured topic list, flashcards, notes and equations. You can also build a set manually.');
 return html+practiceDailyPlan();
};
const productOriginalRecommend=practiceRecommend;
practiceRecommend=function(){
 const p=practiceStore();
 if(!Object.keys(p.catalogues).length)return productOriginalRecommend();
 const topics=practiceTopics().map(topic=>({...topic,stats:practiceStats(topic)})).sort((a,b)=>b.stats.priority-a.stats.priority).slice(0,8);
 const original=productOriginalRecommend(),formStart=original.indexOf('<div class="sec">Log an exam attempt</div>'),attemptForm=formStart>=0?original.slice(formStart).replace('<button class="btn bp" onclick="practiceRecord()">Save attempt</button>','<div class="fg"><label>Next action (optional)</label><textarea id="practice-next-action" rows="2" maxlength="600" placeholder="e.g. Revisit limiting reactants and try another question"></textarea></div><button class="btn bp" onclick="practiceRecord()">Save attempt</button>'):'</div>';
 const rows=topics.map(topic=>'<div class="knowledge-item"><div style="flex:1"><div class="knowledge-title">'+practiceEsc(topic.name)+' '+productHealthTag(topic.stats.health)+'</div><div class="knowledge-meta">'+practiceEsc(topic.subject)+' · '+practiceEsc(topic.stats.evidence)+' · '+(topic.stats.accuracy===null?'No exam marks yet':Math.round(topic.stats.accuracy*100)+'% exam accuracy')+'</div></div><div class="overview-selected-actions"><button class="btn bsm" onclick="practiceSelectTopic(\''+practiceEsc(topic.subjectId)+'\',\''+practiceEsc(topic.id)+'\')">Select</button><button class="btn bsm bp" onclick="practiceStartTopicReview(\''+practiceEsc(topic.subjectId)+'\',\''+practiceEsc(topic.id)+'\')">Review cards</button></div></div>').join('');
 return '<div class="card" style="margin-top:10px"><div class="sec">Recommended exam practice</div><div class="ps">Priorities use recorded marks, recall, recency and unresolved mistakes. Topics without enough evidence are labelled clearly.</div><div class="knowledge-list">'+rows+'</div>'+attemptForm;
};
function practiceRecord(){
 const subjectId=document.getElementById('practice-subject')?.value,topicId=document.getElementById('practice-topic')?.value;
 const marks=Number(document.getElementById('practice-marks')?.value),maxMarks=Number(document.getElementById('practice-max')?.value);
 const notes=String(document.getElementById('practice-notes')?.value||'').trim().slice(0,1200),nextAction=String(document.getElementById('practice-next-action')?.value||'').trim().slice(0,600),source=String(document.getElementById('practice-source')?.value||'').trim().slice(0,160);
 const topic=practiceTopics().find(item=>item.subjectId===subjectId&&item.id===topicId);
 if(!topic||!Number.isFinite(marks)||!Number.isFinite(maxMarks)||maxMarks<=0||marks<0||marks>maxMarks){state.setMessage='Enter a topic and valid marks before saving.';renderRevision();return;}
 const p=practiceStore(),at=Date.now();
 p.attempts.push({id:'pa-'+at,subjectId,topicId,topic:topic.name,marks,maxMarks,notes,nextAction,source,at});p.attempts=p.attempts.slice(-1000);
 if(notes||nextAction){
  const relatedCards=state.cards.filter(card=>normalizeTopic(card.topic)===normalizeTopic(topic.name)).map(card=>card.id);
  const relatedResources=p.resources.filter(item=>item.subjectId===subjectId&&item.topicId===topicId).map(item=>item.id);
  const relatedFormulas=p.formulas.filter(item=>item.subjectId===subjectId&&item.topicId===topicId).map(item=>item.id);
  p.mistakes.push({id:'pm-'+at,subjectId,topicId,topic:topic.name,description:notes||'Review this topic',nextAction,relatedCardIds:relatedCards,relatedResourceIds:relatedResources,relatedFormulaIds:relatedFormulas,at,resolved:false});
  p.mistakes=p.mistakes.slice(-1000);
 }
 saveRevision();state.setMessage='Saved '+marks+'/'+maxMarks+' for '+topic.name+'.'+(notes||nextAction?' Added to your mistake notebook.':'');renderRevision();
}
function openMistakeResource(encodedId){state.resourceFocus=decodeURIComponent(encodedId);state.view='resources';renderRevision();}
function openMistakeFormula(encodedId){const id=decodeURIComponent(encodedId);state.view='analytics';renderRevision();document.getElementById('formula-'+id)?.scrollIntoView({behavior:'smooth',block:'center'});}
function practiceStartTopicReview(subjectId,topicId){
 const topic=practiceTopics().find(item=>item.subjectId===subjectId&&item.id===topicId);if(!topic)return;
 const cards=state.cards.filter(card=>normalizeTopic(card.topic)===normalizeTopic(topic.name));
 if(cards.length){startStudySession('all',Math.min(50,cards.length),topic.name);return;}
 state.resourceFocus=null;state.view='resources';renderRevision();
}
function practiceToggleResource(id){
 const item=practiceStore().resources.find(resource=>resource.id===id);if(!item)return;
 item.readAt=item.readAt?0:Date.now();saveRevision();renderRevision();
}
function practiceResourcesView(){
 const resources=practiceStore().resources||[],subjects=[...new Set(resources.map(item=>item.subject))],focus=state.resourceFocus,visible=focus?resources.filter(item=>item.id===focus):resources,unread=resources.filter(item=>!item.readAt).length;
 return '<div style="max-width:1000px;margin:0 auto"><div class="pt">Course materials</div><div class="ps">Notes, worked examples, practical guidance and other resources for this revision set. '+unread+' unread.</div>'+ (resources.length?subjects.map(subject=>{const items=visible.filter(item=>item.subject===subject);if(!items.length)return '';return '<div class="card" style="margin-top:10px"><div class="sec" style="margin-top:0">'+practiceEsc(subject)+'</div><div class="knowledge-list">'+items.map(item=>'<details class="knowledge-item" '+(item.id===focus?'open':'')+'><summary class="knowledge-title">'+practiceEsc(item.title)+' <span class="tag tb">'+practiceEsc(item.kind)+'</span> '+(item.readAt?'<span class="tag tt">Reviewed</span>':'<span class="tag bd">Unread</span>')+'<div class="knowledge-meta">'+practiceEsc(item.topic)+'</div></summary><div class="resource-content">'+practiceEsc(item.content)+'</div>'+(item.url&&/^https?:\/\//i.test(item.url)?'<div style="margin-top:9px"><a href="'+practiceEsc(item.url)+'" target="_blank" rel="noopener noreferrer">Open source resource</a></div>':'')+'<div class="knowledge-meta" style="margin-top:8px">Source: '+practiceEsc(item.source)+'</div><button class="btn bsm" style="margin-top:9px" onclick="event.preventDefault();event.stopPropagation();practiceToggleResource(\''+practiceEsc(item.id)+'\')">'+(item.readAt?'Mark unread':'Mark as reviewed')+'</button></details>').join('')+'</div></div>';}).join(''):'<div class="card">No course materials imported yet. Import a course pack from Settings after its matching subject catalogue.</div>')+'</div>';
}
const productFormulaWorkspace=practiceFormulaWorkspace;
practiceFormulaWorkspace=function(){
 let html=productFormulaWorkspace();
 practiceStore().formulas.forEach(item=>{const before='<div class="knowledge-title">'+practiceEsc(item.name)+' · '+practiceEsc(item.expression)+'</div>';const after='<div class="knowledge-title" id="formula-'+practiceEsc(item.id)+'">'+practiceEsc(item.name)+' · '+practiceEsc(item.expression)+'</div>';html=html.replace(before,after);});
 return html;
};
const productOriginalAnalytics=practiceAnalytics;
practiceAnalytics=function(){
 const p=practiceStore(),attempts=p.attempts.slice().sort((a,b)=>b.at-a.at).slice(0,8);
 const recent=attempts.length?'<div class="card" style="margin-top:10px"><div class="sec">Recent exam attempts</div><div class="knowledge-list">'+attempts.map(item=>'<div class="knowledge-item"><div style="flex:1"><div class="knowledge-title">'+practiceEsc(item.topic)+' · '+item.marks+'/'+item.maxMarks+'</div><div class="knowledge-meta">'+new Date(item.at).toLocaleDateString()+' · '+practiceEsc(item.source||'Source not recorded')+'</div>'+(item.notes?'<div class="knowledge-meta">'+practiceEsc(item.notes)+'</div>':'')+(item.nextAction?'<div class="knowledge-meta">Next: '+practiceEsc(item.nextAction)+'</div>':'')+'</div></div>').join('')+'</div></div>':'';
 const actions=p.mistakes.filter(item=>!item.resolved&&item.nextAction);
 const actionPanel=actions.length?'<div class="card" style="margin-top:10px"><div class="sec">Next actions</div><div class="knowledge-list">'+actions.map(item=>'<div class="knowledge-item"><div style="flex:1"><div class="knowledge-title">'+practiceEsc(item.topic)+'</div><div class="knowledge-meta">'+practiceEsc(item.nextAction)+'</div><div class="knowledge-meta">'+(item.relatedCardIds||[]).length+' linked cards · '+(item.relatedResourceIds||[]).length+' resources · '+(item.relatedFormulaIds||[]).length+' formulas</div><div class="overview-selected-actions">'+((item.relatedCardIds||[]).length?'<button class="btn bsm" onclick="practiceStartTopicReview(\''+practiceEsc(item.subjectId)+'\',\''+practiceEsc(item.topicId)+'\')">Review cards</button>':'')+((item.relatedResourceIds||[]).length?'<button class="btn bsm" onclick="openMistakeResource(\''+encodeURIComponent(item.relatedResourceIds[0])+'\')">Open resource</button>':'')+((item.relatedFormulaIds||[]).length?'<button class="btn bsm" onclick="openMistakeFormula(\''+encodeURIComponent(item.relatedFormulaIds[0])+'\')">Open formula</button>':'')+'</div></div></div>').join('')+'</div></div>':'';
 return productOriginalAnalytics()+recent+actionPanel;
};
function searchRevision(query){
 const panel=document.getElementById('revision-search-results');if(!panel)return;
 const q=String(query||'').trim().toLowerCase();
 if(!q){panel.hidden=true;panel.innerHTML='';return;}
 const results=[],add=(type,id,title,meta)=>{if(results.length<16)results.push({type,id,title,meta});};
 state.cards.forEach(card=>{if((card.title+' '+card.topic+' '+(card.subject||'')+' '+card.answer).toLowerCase().includes(q))add('card',card.id,card.title,(card.subject||'Flashcard')+' · '+card.topic);});
 const p=practiceStore();
 p.resources.forEach(item=>{if((item.title+' '+item.topic+' '+item.content+' '+item.source).toLowerCase().includes(q))add('resource',item.id,item.title,item.subject+' · '+item.topic);});
 p.formulas.forEach(item=>{if((item.name+' '+item.expression+' '+item.units+' '+item.conditions).toLowerCase().includes(q))add('formula',item.id,item.name,item.expression);});
 p.mistakes.filter(item=>!item.resolved).forEach(item=>{if((item.topic+' '+item.description+' '+(item.nextAction||'')).toLowerCase().includes(q))add('mistake',item.id,item.topic,'Open mistake · '+item.description);});
 p.attempts.forEach(item=>{if((item.topic+' '+item.source+' '+item.notes+' '+(item.nextAction||'')).toLowerCase().includes(q))add('attempt',item.id,item.topic,'Exam attempt · '+item.marks+'/'+item.maxMarks);});
 (state.publicNotes||[]).forEach(note=>{if((note.title+' '+note.subject+' '+(note.cards||[]).map(card=>(card.title||'')+' '+(card.answer||'')).join(' ')).toLowerCase().includes(q))add('public',note.id,note.title,'Public notes · '+(note.subject||'General'));});
 Object.entries(p.catalogues).forEach(([subjectId,catalogue])=>(catalogue.topics||[]).forEach(topic=>{if((topic.name+' '+(topic.subtopics||[]).join(' ')).toLowerCase().includes(q))add('topic',subjectId+'|'+topic.id,topic.name,catalogue.subject+' · '+catalogue.examBoard);}));
 panel.innerHTML=results.length?results.map(item=>'<button type="button" class="search-result" onclick="openRevisionSearchResult(\''+item.type+'\',\''+encodeURIComponent(String(item.id))+'\')"><span class="search-result-title">'+escapeRevision(item.title)+'</span><span class="search-result-meta">'+escapeRevision(item.meta)+'</span></button>').join(''):'<div class="search-empty">No matching revision content.</div>';
 panel.hidden=false;
}
function openRevisionSearchResult(type,encodedId){
 const id=decodeURIComponent(encodedId),input=document.getElementById('revision-search');if(input)input.value='';
 const panel=document.getElementById('revision-search-results');if(panel){panel.hidden=true;panel.innerHTML='';}
 if(type==='card'){startStudy(id);return;}
 if(type==='resource'){state.resourceFocus=id;state.view='resources';renderRevision();return;}
 if(type==='formula'){state.view='analytics';renderRevision();document.getElementById('formula-'+id)?.scrollIntoView({behavior:'smooth',block:'center'});return;}
 if(type==='mistake'||type==='attempt'){state.view='analytics';renderRevision();return;}
 if(type==='public'){state.view='public';renderRevision();return;}
 if(type==='topic'){const [subjectId,topicId]=id.split('|');practiceSelectTopic(subjectId,topicId);return;}
}
document.getElementById('revision-search')?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.target.value='';searchRevision('');}});
document.addEventListener('click',event=>{if(!event.target.closest('.global-search')){const panel=document.getElementById('revision-search-results');if(panel)panel.hidden=true;}});
function updateRevisionSyncStatus(){
 const target=document.getElementById('sync-status');if(!target)return;
 const status=!navigator.onLine?'offline':state.syncStatus||'local';
 const labels={local:'Local save',pending:'Sync queued',syncing:'Syncing',synced:'Synced',failed:'Sync issue',conflict:'Conflict',offline:'Offline'};
 target.textContent=labels[status]||labels.local;target.dataset.status=status;
 target.title=status==='local'?'Your work is stored in this browser. Sign in to sync across devices.':labels[status];
}
const productOriginalSave=saveRevision;
saveRevision=function(remote=false){
 productOriginalSave(remote);
 if(!remote){state.syncStatus=VaultUser.getAccountSession()?'pending':'local';updateRevisionSyncStatus();}
 if(typeof captureRevisionSnapshot==='function')captureRevisionSnapshot(revisionActiveScope);
};
const productOriginalSyncSoon=syncRevisionSoon;
syncRevisionSoon=function(){
 if(!navigator.onLine){state.syncStatus='local';updateRevisionSyncStatus();return;}
 if(revisionUserKey()&&revisionUsername()&&VaultUser.getAccountSession()){state.syncStatus='pending';updateRevisionSyncStatus();}
 productOriginalSyncSoon();
};
const productOriginalSync=syncRevision;
syncRevision=async function(keepalive=false){
 if(!navigator.onLine){state.syncStatus='local';updateRevisionSyncStatus();return;}
 if(state.syncing)return;
 if(!revisionUserKey()||!revisionUsername()||!VaultUser.getAccountSession()){state.syncStatus='local';updateRevisionSyncStatus();return;}
 state.accountMessage='';state.syncStatus='syncing';updateRevisionSyncStatus();
 await productOriginalSync(keepalive);
 if(revisionSyncConflict)state.syncStatus='conflict';
 else if(state.accountMessage)state.syncStatus='failed';
 else state.syncStatus='synced';
 updateRevisionSyncStatus();
};
const productOriginalLoadRevision=loadRevision;
loadRevision=async function(){
 if(!VaultUser.getAccountSession()){state.syncStatus='local';updateRevisionSyncStatus();return productOriginalLoadRevision();}
 state.syncStatus='syncing';updateRevisionSyncStatus();
 await productOriginalLoadRevision();
 if(revisionSyncConflict)state.syncStatus='conflict';
 else if(state.accountMessage)state.syncStatus='failed';
 else state.syncStatus='synced';
 updateRevisionSyncStatus();
};
window.addEventListener('online',()=>{if(revisionUserKey()&&VaultUser.getAccountSession())syncRevisionSoon();else updateRevisionSyncStatus();});
window.addEventListener('offline',updateRevisionSyncStatus);
const productOriginalSettings=renderSettings;
renderSettings=function(){
 return productOriginalSettings()+'<div class="card" style="margin-top:10px"><div class="sec" style="margin-top:0">Data backup</div><div class="ps">Export a complete copy of this revision set, including cards, review history, subject catalogues, practice attempts, mistakes, formulas and resources. Keep a copy somewhere safe.</div><div class="overview-selected-actions"><button class="btn" type="button" onclick="exportRevisionSet(\'json\')">Export full backup (JSON)</button><button class="btn" type="button" onclick="exportRevisionSet(\'csv\')">Export flashcards (CSV)</button><label class="btn" for="revision-backup-import">Import backup as a new set</label><input id="revision-backup-import" type="file" accept=".json,.csv,application/json,text/csv" hidden onchange="importRevisionFile(this)"></div></div>';
};
updateRevisionSyncStatus();
(async()=>{if(VaultUser.getAccountSession())await loadRevision();await loadRevisionCourseSelection();if(!document.getElementById('revision-course-selection'))renderRevision();})();
