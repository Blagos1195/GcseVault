const practiceBaseNormalize = normalizeRevisionSet;
normalizeRevisionSet = function(set, fallbackId) {
  const result = practiceBaseNormalize(set, fallbackId);
  const practice = set && set.practice && typeof set.practice === 'object' ? set.practice : {};
  result.practice = {catalogues:practice.catalogues && typeof practice.catalogues === 'object' ? practice.catalogues : {}, attempts:Array.isArray(practice.attempts)?practice.attempts:[], mistakes:Array.isArray(practice.mistakes)?practice.mistakes:[], formulas:Array.isArray(practice.formulas)?practice.formulas:[], resources:Array.isArray(practice.resources)?practice.resources:[]};
  return result;
};
state.accountSets.forEach(set => { set.practice = normalizeRevisionSet(set, set.id).practice; });
const practiceBaseSync = syncActiveRevisionSet;
syncActiveRevisionSet = function() { practiceBaseSync(); const set=getActiveRevisionSet(); if(set&&!set.practice)set.practice={catalogues:{},attempts:[],mistakes:[],formulas:[]}; };
function practiceStore(){const set=getActiveRevisionSet();if(!set.practice)set.practice={catalogues:{},attempts:[],mistakes:[],formulas:[],resources:[]};if(!Array.isArray(set.practice.resources))set.practice.resources=[];if(!Array.isArray(set.practice.formulas))set.practice.formulas=[];return set.practice;}
function practiceTopics(){return Object.entries(practiceStore().catalogues).flatMap(([subjectId,c])=>(c.topics||[]).map(topic=>({...topic,subjectId,subject:c.subject,examBoard:c.examBoard})));}
function practiceStats(topic){
 const p=practiceStore(), attempts=p.attempts.filter(a=>a.subjectId===topic.subjectId&&a.topicId===topic.id);
 const marks=attempts.reduce((n,a)=>n+Number(a.marks||0),0),max=attempts.reduce((n,a)=>n+Number(a.maxMarks||0),0);
 const lastAttempt=attempts.reduce((n,a)=>Math.max(n,Number(a.at)||0),0);
 const cards=state.cards.filter(c=>normalizeTopic(c.topic)===normalizeTopic(topic.name)||normalizeTopic(c.topic).includes(normalizeTopic(topic.name)));
 const reviews=cards.reduce((n,c)=>n+Number(state.progress[c.id]?.reviews||0),0),correct=cards.reduce((n,c)=>n+Number(state.progress[c.id]?.correct||0),0);
 const lastCard=cards.reduce((n,c)=>Math.max(n,Number(state.progress[c.id]?.lastReviewed)||0),0),last=Math.max(lastAttempt,lastCard);
 const mistakes=p.mistakes.filter(m=>m.subjectId===topic.subjectId&&m.topicId===topic.id&&!m.resolved).length;
 const accuracy=max?marks/max:null,weak=accuracy===null?.45:1-accuracy,stale=last?Math.min(1,(Date.now()-last)/(21*86400000)):1;
 const recall=reviews?1-correct/reviews:.35,score=weak*.4+stale*.25+(attempts.length?0:.15)+recall*.1+Math.min(1,mistakes/3)*.1;
 return {attempts:attempts.length,marks,max,accuracy,last,mistakes,score,cards:cards.length};
}
function practiceEsc(v){return escapeRevision(String(v??''));}
function practiceSubjectOptions(){return Object.entries(practiceStore().catalogues).map(([id,c])=>'<option value="'+practiceEsc(id)+'">'+practiceEsc(c.subject)+' · '+practiceEsc(c.examBoard)+'</option>').join('');}
function practiceTopicOptions(subject){return (practiceStore().catalogues[subject]?.topics||[]).map(t=>'<option value="'+practiceEsc(t.id)+'">'+practiceEsc(t.name)+'</option>').join('');}
function practiceRecommend(){
 const topics=practiceTopics().map(t=>({...t,stats:practiceStats(t)})).sort((a,b)=>b.stats.score-a.stats.score).slice(0,8);
 if(!Object.keys(practiceStore().catalogues).length)return '<div class="card" style="margin-top:10px"><div class="sec">Exam practice recommendations</div><div class="ps">Upload a private subject catalogue in Settings to get recommendations based on your practice results, flashcard recall and mistakes.</div><button class="btn bp" onclick="state.view=\'settings\';renderRevision()">Upload subjects</button></div>';
 return '<div class="card" style="margin-top:10px"><div class="sec">Recommended exam practice</div><div class="ps">Priorities update from exam marks, flashcard recall, practice recency and unresolved mistakes.</div><div class="knowledge-list">'+topics.map((t,i)=>'<div class="knowledge-item"><div style="flex:1"><div class="knowledge-title">'+practiceEsc(t.name)+'</div><div class="knowledge-meta">'+practiceEsc(t.subject)+' · '+(t.stats.accuracy===null?'No exam results':Math.round(t.stats.accuracy*100)+'% exam accuracy')+' · '+t.stats.mistakes+' open mistakes · '+(t.stats.last?Math.floor((Date.now()-t.stats.last)/86400000)+' days since practice':'Not practised yet')+'</div></div><button class="btn bsm" onclick="practiceSelectTopic(\''+practiceEsc(t.subjectId)+'\',\''+practiceEsc(t.id)+'\')">Select</button></div>').join('')+'</div><div class="sec">Log an exam attempt</div><div class="g2"><div class="fg"><label>Subject</label><select id="practice-subject" onchange="document.getElementById(\'practice-topic\').innerHTML=practiceTopicOptions(this.value)">'+practiceSubjectOptions()+'</select></div><div class="fg"><label>Topic</label><select id="practice-topic">'+practiceTopicOptions(Object.keys(practiceStore().catalogues)[0])+'</select></div><div class="fg"><label>Marks achieved</label><input id="practice-marks" type="number" min="0" step="1"></div><div class="fg"><label>Total marks</label><input id="practice-max" type="number" min="1" step="1"></div><div class="fg"><label>Question source (optional)</label><input id="practice-source" maxlength="160"></div></div><div class="fg"><label>Mistakes / things to revisit (optional)</label><textarea id="practice-notes" rows="2" maxlength="1200"></textarea></div><button class="btn bp" onclick="practiceRecord()">Save attempt</button></div>';
}
function practiceSelectTopic(subjectId,topicId){practiceStore().selectedTopic={subjectId,topicId};saveRevision();state.setMessage='Topic selected. Use the linked flashcards and find exam questions for this topic.';renderRevision();}
function practiceRecord(){
 const subjectId=document.getElementById('practice-subject')?.value,topicId=document.getElementById('practice-topic')?.value;
 const marks=Number(document.getElementById('practice-marks')?.value),maxMarks=Number(document.getElementById('practice-max')?.value);
 const notes=String(document.getElementById('practice-notes')?.value||'').trim().slice(0,1200),source=String(document.getElementById('practice-source')?.value||'').trim().slice(0,160);
 const topic=practiceTopics().find(t=>t.subjectId===subjectId&&t.id===topicId);
 if(!topic||!Number.isFinite(marks)||!Number.isFinite(maxMarks)||maxMarks<=0||marks<0||marks>maxMarks){state.setMessage='Enter a topic and valid marks before saving.';renderRevision();return;}
 const p=practiceStore();p.attempts.push({id:'pa-'+Date.now(),subjectId,topicId,topic:topic.name,marks,maxMarks,notes,source,at:Date.now()});p.attempts=p.attempts.slice(-1000);
 if(notes){p.mistakes.push({id:'pm-'+Date.now(),subjectId,topicId,topic:topic.name,description:notes,at:Date.now(),resolved:false});p.mistakes=p.mistakes.slice(-1000);}
 saveRevision();state.setMessage='Saved '+marks+'/'+maxMarks+' for '+topic.name+'.';renderRevision();
}
function practiceResolve(id){const m=practiceStore().mistakes.find(x=>x.id===id);if(m){m.resolved=true;m.resolvedAt=Date.now();saveRevision();renderRevision();}}
function practiceImport(input){
 const file=input.files?.[0];if(!file)return;
 const reader=new FileReader();
 reader.onload=()=>{
  try{
   const c=JSON.parse(String(reader.result||'')),p=practiceStore();
   if(c.type==='revision-catalogue'&&c.version===1){
    if(!c.subject||!c.examBoard||!Array.isArray(c.topics)||c.topics.length>250)throw new Error('Unsupported subject catalogue.');
    const ids=new Set(),topics=c.topics.map(t=>{
     const id=String(t.id||'').trim(),name=String(t.name||'').trim();
     if(!id||!name||ids.has(id)||!Array.isArray(t.subtopics))throw new Error('Every topic needs a unique ID, name and subtopic list.');
     ids.add(id);
     return{id,name,year:String(t.year||''),area:String(t.area||''),subtopics:t.subtopics.map(String).slice(0,100)};
    });
    const id=String(c.id||normalizeTopic(c.examBoard+' '+c.subject).replace(/\s+/g,'-')).slice(0,100);
    p.catalogues[id]={id,subject:String(c.subject).slice(0,100),examBoard:String(c.examBoard).slice(0,80),qualification:String(c.qualification||'').slice(0,100),source:String(c.source||'').slice(0,300),optionalModule:c.optionalModule||null,topics,updatedAt:Date.now()};
    saveRevision();state.setMessage='Imported '+topics.length+' topics for '+c.subject+'.';renderRevision();return;
   }
   if(c.type!=='revision-course-pack'||c.version!==1||!c.subject||!c.examBoard||!Array.isArray(c.cards)||!Array.isArray(c.resources)||c.cards.length>1000||c.resources.length>500||((c.formulas||[]).length>500))throw new Error('Unsupported course pack format.');
   const subject=String(c.subject).slice(0,100),catalogueId=String(c.catalogueId||normalizeTopic(c.examBoard+' '+subject).replace(/\s+/g,'-')).slice(0,100),catalogue=p.catalogues[catalogueId];
   if(!catalogue)throw new Error('Import the matching subject catalogue first.');
   const topicById=new Map(catalogue.topics.map(t=>[t.id,t]));
   const normal=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
   const cardKey=card=>normal(subject)+'|'+normal(card.front||card.title);
   const existingByKey=new Map(state.cards.map(card=>[normal(card.subject)+'|'+normal(card.title),card]));
   const incoming=c.cards.filter(card=>card&&(card.front||card.title)&&(card.back||card.answer));
   const idMap=new Map(),targetByKey=new Map(),imported=[];
   incoming.forEach((card,index)=>{
    const topic=topicById.get(String(card.topicId||''));
    if(!topic)throw new Error('A flashcard refers to an unknown topic: '+String(card.topicId||''));
    const key=cardKey(card);
    let target=existingByKey.get(key)||targetByKey.get(key);
    if(!target){
     target={id:'cp'+Date.now()+Math.random().toString(36).slice(2,8)+index,subject,topic:topic.name,title:String(card.front||card.title).slice(0,400),answer:String(card.back||card.answer).slice(0,1200),source:String(card.source||c.source||'Course pack').slice(0,300),links:[],difficulty:Math.max(1,Math.min(5,Number(card.difficulty)||2))};
     imported.push(target);
     existingByKey.set(key,target);
    }
    targetByKey.set(key,target);
    idMap.set(String(card.id??index),target.id);
   });
   state.cards.push(...imported);
   incoming.forEach(card=>{
    const target=targetByKey.get(cardKey(card));
    (Array.isArray(card.links)?card.links:[]).forEach(link=>{
     const linkedId=idMap.get(String(link));
     if(!linkedId||linkedId===target.id)return;
     target.links=Array.isArray(target.links)?target.links:[];
     if(!target.links.includes(linkedId))target.links.push(linkedId);
     const linked=cardById(linkedId);
     if(linked){linked.links=Array.isArray(linked.links)?linked.links:[];if(!linked.links.includes(target.id))linked.links.push(target.id);}
    });
   });
   const resourceKey=item=>[item.subjectId,item.topicId,normal(item.kind),normal(item.title)].join('|');
   const existingResources=new Map(p.resources.map(item=>[resourceKey(item),item]));
   const resources=[];c.resources.forEach((item,index)=>{
    const topic=topicById.get(String(item.topicId||''));
    if(!topic)throw new Error('A resource refers to an unknown topic: '+String(item.topicId||''));
    const resource={id:'cr'+Date.now()+Math.random().toString(36).slice(2,7)+index,subject,subjectId:catalogueId,topicId:topic.id,topic:topic.name,kind:String(item.kind||'notes').slice(0,40),title:String(item.title||topic.name).slice(0,180),content:String(item.content||'').slice(0,12000),source:String(item.source||c.source||'Course pack').slice(0,300)};
    if(resource.content&&!existingResources.has(resourceKey(resource))){resources.push(resource);existingResources.set(resourceKey(resource),resource);}
   });
   p.resources.push(...resources);p.resources=p.resources.slice(-500);
   const formulaKey=item=>[item.subjectId,item.topicId,normal(item.name)].join('|');
   const existingFormulas=new Map(p.formulas.map(item=>[formulaKey(item),item]));
   let addedFormulas=0,updatedFormulas=0;
   (Array.isArray(c.formulas)?c.formulas:[]).forEach((item,index)=>{
    const topic=topicById.get(String(item.topicId||''));
    if(!topic)throw new Error('A formula refers to an unknown topic: '+String(item.topicId||''));
    const formula={id:'cf'+Date.now()+Math.random().toString(36).slice(2,7)+index,subjectId:catalogueId,topicId:topic.id,name:String(item.name||'').slice(0,120),expression:String(item.expression||'').slice(0,300),units:String(item.units||'').slice(0,160),conditions:String(item.conditions||'').slice(0,300)};
    if(!formula.name||!formula.expression)return;
    const key=formulaKey(formula),existing=existingFormulas.get(key);
    if(existing){Object.assign(existing,{expression:formula.expression,units:formula.units,conditions:formula.conditions});updatedFormulas++;}
    else{p.formulas.push(formula);existingFormulas.set(key,formula);addedFormulas++;}
   });
   p.formulas=p.formulas.slice(-300);
   saveRevision();
   state.setMessage='Added '+imported.length+' flashcards, '+resources.length+' resources and '+addedFormulas+' formulas. Existing cards and review history were kept; '+updatedFormulas+' formulas updated.';
   state.view='resources';renderRevision();
  }catch(error){state.setMessage=error.message||'Could not import resource file.';renderRevision();}
 };
 reader.readAsText(file);
}
function practiceResourcesView(){
 const resources=practiceStore().resources||[],subjects=[...new Set(resources.map(item=>item.subject))];
 return '<div style="max-width:1000px;margin:0 auto"><div class="pt">Course materials</div><div class="ps">Notes, worked examples, practical guidance and other imported resources for this revision set.</div>'+ (resources.length?subjects.map(subject=>'<div class="card" style="margin-top:10px"><div class="sec" style="margin-top:0">'+practiceEsc(subject)+'</div>'+resources.filter(item=>item.subject===subject).map(item=>'<details class="knowledge-item"><summary class="knowledge-title">'+practiceEsc(item.title)+' <span class="tag tb">'+practiceEsc(item.kind)+'</span><div class="knowledge-meta">'+practiceEsc(item.topic)+'</div></summary><div style="white-space:pre-wrap;font-size:.78rem;line-height:1.65;margin-top:10px">'+practiceEsc(item.content)+'</div><div class="knowledge-meta" style="margin-top:8px">Source: '+practiceEsc(item.source)+'</div></details>').join('')+'</div>').join(''):'<div class="card">No course materials imported yet. Import a course pack from Settings after its matching subject catalogue.</div>')+'</div>';
}
function practiceRemove(id){if(!confirm('Remove this subject and its associated practice history?'))return;const p=practiceStore();delete p.catalogues[id];p.attempts=p.attempts.filter(x=>x.subjectId!==id);p.mistakes=p.mistakes.filter(x=>x.subjectId!==id);saveRevision();renderRevision();}
function practiceSettings(){
 const entries=Object.entries(practiceStore().catalogues);
 return '<div class="card" style="margin-top:10px"><div class="sec">Subject catalogues and course packs</div><div class="ps">Catalogues define topics. Course packs add actual notes, worked examples, practical guidance, equations and flashcards. Imports stay private to this revision set.</div><label class="btn" for="revision-practice-file">Import JSON resource file</label><input id="revision-practice-file" type="file" accept=".json,application/json" hidden onchange="practiceImport(this)"/><div class="knowledge-list">'+entries.map(([id,c])=>'<div class="knowledge-item"><div style="flex:1"><div class="knowledge-title">'+practiceEsc(c.subject)+'</div><div class="knowledge-meta">'+practiceEsc(c.examBoard)+' · '+c.topics.length+' topics · '+c.topics.reduce((n,t)=>n+t.subtopics.length,0)+' subtopics</div></div><button class="btn bsm br" onclick="practiceRemove(\''+practiceEsc(id)+'\')">Remove</button></div>').join('')+'</div><div class="knowledge-meta" style="margin-top:10px">'+practiceStore().resources.length+' imported learning resources in this set.</div><button class="btn" style="margin-top:8px" onclick="state.view=\'resources\';renderRevision()">Open course materials</button></div>';
}
function practiceAnalytics(){
 const p=practiceStore(),topics=practiceTopics().map(t=>({...t,stats:practiceStats(t)})).sort((a,b)=>b.stats.score-a.stats.score);
 const attempts=p.attempts.slice().sort((a,b)=>b.at-a.at),mistakes=p.mistakes.filter(m=>!m.resolved);
 return '<div class="card" style="margin-top:10px"><div class="sec">Exam practice performance</div><div class="g3"><div class="scard"><div class="snum">'+attempts.length+'</div><div class="slbl">Attempts</div></div><div class="scard"><div class="snum">'+attempts.reduce((n,a)=>n+a.marks,0)+'/'+attempts.reduce((n,a)=>n+a.maxMarks,0)+'</div><div class="slbl">Marks recorded</div></div><div class="scard"><div class="snum">'+mistakes.length+'</div><div class="slbl">Open mistakes</div></div></div><div class="knowledge-list">'+topics.map(t=>'<div class="knowledge-item"><div style="flex:1"><div class="knowledge-title">'+practiceEsc(t.name)+'</div><div class="knowledge-meta">'+(t.stats.accuracy===null?'No exam attempts':Math.round(t.stats.accuracy*100)+'% across '+t.stats.attempts+' attempts')+' · '+t.stats.mistakes+' mistakes</div></div></div>').join('')+'</div>'+ (mistakes.length?'<div class="sec">Mistake notebook</div><div class="knowledge-list">'+mistakes.slice().sort((a,b)=>b.at-a.at).map(m=>'<div class="knowledge-item"><div style="flex:1"><div class="knowledge-title">'+practiceEsc(m.topic)+'</div><div class="knowledge-meta">'+practiceEsc(m.description)+'</div></div><button class="btn bsm" onclick="practiceResolve(\''+practiceEsc(m.id)+'\')">Resolved</button></div>').join('')+'</div>':'<div class="ps">No unresolved mistakes.</div>')+'</div>';
}
function practiceConnections(){
 const counts={};state.cards.forEach(card=>(card.links||[]).forEach(id=>{const other=cardById(id);if(other&&card.topic!==other.topic){const key=other.topic||'Uncategorised';counts[key]=(counts[key]||0)+1;}}));
 const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5);
 return top.length?'<div class="card" style="margin-top:10px"><div class="sec">Connected concepts</div><div class="ps">Flashcard links now feed topic relationships, helping identify related material rather than serving only as lines on the graph.</div>'+top.map(([topic,count])=>'<div class="suggestion"><div><div class="suggestion-name">'+practiceEsc(topic)+'</div><div class="suggestion-reason">'+count+' concept connections</div></div></div>').join('')+'</div>':'';
}
const practiceOldOverview=renderOverview;
renderOverview=function(){return practiceOldOverview()+practiceRecommend()+practiceConnections();};
const practiceOldAnalytics=renderAnalytics;
renderAnalytics=function(){return practiceOldAnalytics()+practiceAnalytics();};
const practiceOldSettings=renderSettings;
renderSettings=function(){return practiceOldSettings()+practiceSettings();};


function practiceAddFormula(){
 const subjectId=document.getElementById('formula-subject')?.value,topicId=document.getElementById('formula-topic')?.value;
 const name=String(document.getElementById('formula-name')?.value||'').trim().slice(0,120);
 const expression=String(document.getElementById('formula-expression')?.value||'').trim().slice(0,300);
 const units=String(document.getElementById('formula-units')?.value||'').trim().slice(0,160);
 const conditions=String(document.getElementById('formula-conditions')?.value||'').trim().slice(0,300);
 if(!subjectId||!topicId||!name||!expression)return;
 const p=practiceStore();p.formulas.push({id:'pf-'+Date.now(),subjectId,topicId,name,expression,units,conditions});p.formulas=p.formulas.slice(-300);saveRevision();renderRevision();
}
function practiceDeleteFormula(id){const p=practiceStore();p.formulas=p.formulas.filter(f=>f.id!==id);saveRevision();renderRevision();}
function practiceFormulaWorkspace(){
 const p=practiceStore();
 return '<div class="card" style="margin-top:10px"><div class="sec">Formula and equation workspace</div><div class="ps">Keep important equations with their symbols, units and conditions. These are private to this revision set.</div><div class="g2"><div class="fg"><label>Subject</label><select id="formula-subject" onchange="document.getElementById(\'formula-topic\').innerHTML=practiceTopicOptions(this.value)">'+practiceSubjectOptions()+'</select></div><div class="fg"><label>Topic</label><select id="formula-topic">'+practiceTopicOptions(Object.keys(p.catalogues)[0])+'</select></div><div class="fg"><label>Name</label><input id="formula-name" maxlength="120" placeholder="e.g. SUVAT equation"></div><div class="fg"><label>Equation</label><input id="formula-expression" maxlength="300" placeholder="e.g. v = u + at"></div><div class="fg"><label>Units / symbols</label><input id="formula-units" maxlength="160" placeholder="e.g. v in m s⁻¹, t in s"></div><div class="fg"><label>Conditions</label><input id="formula-conditions" maxlength="300" placeholder="e.g. constant acceleration"></div></div><button class="btn bp" onclick="practiceAddFormula()">Save formula</button>'+(p.formulas.length?'<div class="knowledge-list">'+p.formulas.map(f=>'<div class="knowledge-item"><div style="flex:1"><div class="knowledge-title">'+practiceEsc(f.name)+' · '+practiceEsc(f.expression)+'</div><div class="knowledge-meta">'+practiceEsc(p.catalogues[f.subjectId]?.subject||'')+' · '+practiceEsc(f.units)+' · '+practiceEsc(f.conditions)+'</div></div><button class="btn bsm br" onclick="practiceDeleteFormula(\''+practiceEsc(f.id)+'\')">Delete</button></div>').join('')+'</div>':'')+'</div>';
}
const practiceStatsBeforeLinks=practiceStats;
practiceStats=function(topic){
 const result=practiceStatsBeforeLinks(topic);
 const topicCards=state.cards.filter(card=>normalizeTopic(card.topic)===normalizeTopic(topic.name));
 const ids=new Set(topicCards.map(card=>card.id));
 result.connected=topicCards.reduce((n,card)=>n+(card.links||[]).filter(id=>{const other=cardById(id);return other&&!ids.has(id)&&other.topic!==card.topic;}).length,0);
 result.score=Math.min(1,result.score+Math.min(.08,result.connected*.01));
 return result;
};
const practiceAnalyticsBeforeFormula=practiceAnalytics;
practiceAnalytics=function(){return practiceAnalyticsBeforeFormula()+practiceFormulaWorkspace();};
importPublicNote = async function(id){
 const note=state.publicNotes.find(item=>item.id===id);if(!note)return;
 const incoming=Array.isArray(note.cards)?note.cards:[];
 const existingByTitle=new Map(state.cards.map(card=>[String(card.title||'').toLowerCase(),card.id]));
 const idMap=new Map(incoming.map((card,index)=>{const oldId=String(card.id||index),existingId=existingByTitle.get(String(card.title||'').toLowerCase());return[oldId,existingId||('imp'+Date.now()+Math.random().toString(36).slice(2,7))];}));
 const imported=incoming.filter(card=>!existingByTitle.has(String(card.title||'').toLowerCase())).map((card,index)=>({...card,id:idMap.get(String(card.id||index)),links:(Array.isArray(card.links)?card.links:[]).map(link=>idMap.get(String(link))).filter(Boolean)}));
 state.cards.push(...imported);
 imported.forEach(card=>(card.links||[]).forEach(id=>{const other=cardById(id);if(other){other.links=other.links||[];if(!other.links.includes(card.id))other.links.push(card.id);}}));
 saveRevision();state.selected=imported[0]?.id||state.selected;state.view='overview';renderRevision();
};


function practiceStudyTopicCards(subjectId,topicId){
 const topic=practiceTopics().find(t=>t.subjectId===subjectId&&t.id===topicId);if(!topic)return;
 const ids=state.cards.filter(card=>normalizeTopic(card.topic)===normalizeTopic(topic.name)||normalizeTopic(card.topic).includes(normalizeTopic(topic.name))).map(card=>card.id);
 if(!ids.length){state.setMessage='No flashcards are tagged to this topic yet. You can still use the listed subtopics to find exam questions.';renderRevision();return;}
 state.studyQueue=ids;state.studyIndex=0;state.studySessionActive=true;state.sessionReviewed=0;state.revealed=false;state.view='cards';renderRevision();
}
const practiceRecommendBaseDrill=practiceRecommend;
practiceRecommend=function(){
 const base=practiceRecommendBaseDrill(),selected=practiceStore().selectedTopic;
 if(!selected)return base;
 const topic=practiceTopics().find(t=>t.subjectId===selected.subjectId&&t.id===selected.topicId);
 if(!topic)return base;
 const stats=practiceStats(topic);
 return base+'<div class="card" style="margin-top:10px"><div class="sec">Selected topic · '+practiceEsc(topic.name)+'</div><div class="knowledge-meta">'+practiceEsc(topic.subject)+' · '+practiceEsc(topic.examBoard)+' · '+(stats.accuracy===null?'No exam results yet':Math.round(stats.accuracy*100)+'% exam accuracy')+'</div><div class="sec">Subtopics to target</div><div class="knowledge-list">'+(topic.subtopics||[]).map(item=>'<div class="knowledge-item"><span class="knowledge-title">'+practiceEsc(item)+'</span></div>').join('')+'</div><div class="ps">Use these subtopics to choose focused questions from your exam-board materials or past papers. Record the marks above to improve future recommendations.</div><button class="btn" onclick="practiceStudyTopicCards(\''+practiceEsc(topic.subjectId)+'\',\''+practiceEsc(topic.id)+'\')">Review related flashcards</button></div>';
};

renderRevision();
ThemeManager.initTheme('global');
syncRevisionTheme();
loadRevision();
loadPublicNotes();
