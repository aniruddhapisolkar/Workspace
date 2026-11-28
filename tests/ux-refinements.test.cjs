const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../Workspace.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const section = (from, to) => {
  const start = html.indexOf(from), end = html.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Missing source section ${from}`);
  return html.slice(start, end);
};
const plain = value => JSON.parse(JSON.stringify(value));

test('all executable scripts parse', () => {
  for (const [, attrs, source] of scripts) {
    const type = attrs.match(/\btype="([^"]+)"/);
    if (!type || type[1] === 'text/javascript') new vm.Script(source);
  }
});

test('empty folder cleanup never selects folders containing files, Trash or unselected children', () => {
  const ctx=vm.createContext({});vm.runInContext(section('function emptyFolderCandidates(', 'function emptyFoldersDialog('),ctx);
  const w={archiveFolder:'archive',notes:[{folder:'occupied',deleted:1}],folders:[{id:'parent',parent:null},{id:'child',parent:'parent'},{id:'other',parent:'parent'},{id:'occupied',parent:null},{id:'archive',parent:null},{id:'trashed',parent:'occupied',deleted:1}]};
  assert.deepEqual(plain(ctx.emptyFolderCandidates(w)).map(f=>f.id),['parent','child','other']);
  assert.deepEqual(plain(ctx.emptyFolderRoots(w,new Set(['parent','child']))),['child']);
  assert.deepEqual(plain(ctx.emptyFolderRoots(w,new Set(['parent','child','other','occupied','archive']))),['parent']);
});

test('file conflicts detect sibling and batch collisions and reserve unique case-insensitive names', () => {
  const ctx=vm.createContext({wikiKey:s=>String(s||'').toLowerCase()});vm.runInContext(section('function availableFileTitle(', 'function fileConflictDialog('),ctx);
  const existing={id:'old',title:'Study',folder:'to'},a={id:'a',title:'study',folder:'from'},b={id:'b',title:'Study',folder:'another'},c={id:'c',title:'fresh',folder:'from'},d={id:'d',title:'FRESH',folder:'another'},w={notes:[existing,a,b,c,d]};
  const rows=ctx.fileMoveConflicts(w,[a,b,c,d],'to');assert.deepEqual(plain(rows).map(r=>[r.file.id,r.existing?.id||null]),[['a','old'],['b','old'],['d',null]]);
  assert.equal(ctx.availableFileTitle('Study',new Set(['study','study (2)'])),'Study (3)');
  existing.deleted=1;assert.deepEqual(plain(ctx.fileMoveConflicts(w,[a,b],'to')).map(r=>[r.file.id,r.existing]),[['b',null]]);
});

test('move conflicts skip, rename and replace without losing incoming file identities', async () => {
  const old={id:'old',title:'Replace',folder:'to'},a={id:'a',title:'Replace',folder:'from'},b={id:'b',title:'Rename',folder:'from'},c={id:'c',title:'Skip',folder:'from'},w={notes:[old,a,b,c,{id:'old-b',title:'Rename',folder:'to'},{id:'old-c',title:'Skip',folder:'to'}],folders:[{id:'to'}],assets:{}};
  const ctx=vm.createContext({workspace:()=>w,wikiKey:s=>String(s||'').toLowerCase(),isMediaFile:()=>false,folderInTrash:()=>false,flushPendingNoteHTML:()=>{},prepareTrashLinkOwners:async()=>[],trashNotes:ids=>w.notes.filter(n=>ids.includes(n.id)).forEach(n=>n.deleted=1),captureWikiReferences:()=>[],maintainWikiReferences:()=>{},updateTitles:()=>{},clearSelections:()=>{},changed:()=>{},renderTree:()=>{},flash:()=>{}});
  vm.runInContext(section('function availableFileTitle(', 'function fileConflictDialog(')+section('async function moveFilesWithConflicts(', 'function moveDialog('),ctx);
  ctx.fileConflictDialog=async rows=>new Map(rows.map(r=>[r.file.id,{action:{a:'replace',b:'rename',c:'skip'}[r.file.id],existing:r.existing}]));
  assert.equal(await ctx.moveFilesWithConflicts(w,[a,b,c],'to'),true);assert.equal(old.deleted,1);assert.equal(a.folder,'to');assert.equal(a.title,'Replace');assert.equal(b.title,'Rename (2)');assert.equal(b.folder,'to');assert.equal(c.folder,'from');
});

test('closing a tab captures the current caret even when focus is on its close button', () => {
  let saved;const ctx=vm.createContext({updateResumePosition:(_view,change)=>saved=change});vm.runInContext(section('function capturePanePosition(', 'function restorePanePosition('),ctx);
  ctx.capturePanePosition({engine:{isReadOnly:()=>false,selection:()=>({from:122,to:122})},scroll:{scrollTop:812,scrollLeft:17}});
  assert.deepEqual(plain(saved),{top:812,left:17,caret:122});
  assert.match(html,/if\(ids.includes\(p.active\)\)\{const view=paneViews.get\(p\);if\(view\)\{capturePanePosition\(view,true\);flushResumePositions\(\);\}\}/);
});

test('custom visual calendar start folds only unused early hours and preserves scheduled blocks', () => {
  const ctx=vm.createContext({settings:()=>({calendarDayStart:360}),validCalendarTimeBlock:r=>!!r&&r.start>=0&&r.end<=1440&&r.end>r.start});vm.runInContext(section('function calendarDayStart(', 'function mountCalendarTimeline('),ctx);
  assert.equal(ctx.calendarDayStart(),360);assert.equal(ctx.calendarDayStart(1440),null);
  const scale=ctx.calendarTimelineScale({start:480,end:1020},[{timeBlock:{start:120,end:180}}],false,360);
  assert.deepEqual(plain(scale.folded).map(r=>[r.start,r.end]),[[0,120],[180,360]]);
  assert.equal(scale.top(180)-scale.top(120),52);assert.ok(Math.abs(scale.minute(scale.top(540))-540)<1e-8);
  assert.equal(ctx.calendarTimelineScale({start:480,end:1020},[],false,null).folded.length,0);
});

test('task splitting preserves duration, color, original reminder and subtasks', () => {
  const key='2026-11-27',w={calendar:{days:{[key]:[{id:'a',text:'Study',depth:0,done:false,color:'blue',reminder:{at:123},timeBlock:{start:480,end:600}},{id:'child',text:'Review',depth:1},{id:'other',text:'Other',depth:0}]}}};
  const ctx=vm.createContext({structuredClone,calendarManageSnapshot:w=>structuredClone(w.calendar),calendarTasks:(key,w)=>structuredClone(w.calendar.days[key]),validCalendarTimeBlock:r=>!!r&&r.start>=0&&r.end<=1440&&r.end>r.start,writeCalendarDay:(key,tasks,w)=>w.calendar.days[key]=tasks,calendarSubtreeEnd:(tasks,i)=>i+1+(tasks[i+1]?.depth>tasks[i].depth?1:0)});
  vm.runInContext(section('function calendarSplitPlan(', 'function calendarSplitDialog('),ctx);
  const plan=ctx.calendarSplitPlan(w,key,'a',540,'second'),rows=plan.after.days[key];assert.deepEqual(rows.map(row=>row.id),['a','child','second','other']);assert.deepEqual(plain(rows[0].timeBlock),{start:480,end:540});assert.deepEqual(plain(rows[2].timeBlock),{start:540,end:600});assert.equal(rows[2].color,'blue');assert.equal(rows[2].reminder,undefined);assert.equal(rows[0].reminder.at,123);assert.equal(w.calendar.days[key][0].timeBlock.end,600);assert.equal(ctx.calendarSplitPlan(w,key,'a',600,'second'),null);
});

test('splitting a recurring block changes only its chosen occurrence', () => {
  const key='2026-11-27',task={id:'r',text:'Repeat',depth:0,rule:{id:'r'},timeBlock:{start:480,end:600}},w={calendar:{repeats:[{id:'r',schedule:{start:480,end:600}}],days:{}}};
  const ctx=vm.createContext({structuredClone,calendarManageSnapshot:w=>structuredClone(w.calendar),calendarTasks:()=>[],calendarTaskFor:()=>structuredClone(task),validCalendarTimeBlock:r=>!!r&&r.end>r.start,writeCalendarDay:(key,tasks,w)=>w.calendar.days[key]={tasks}});vm.runInContext(section('function calendarSplitPlan(', 'function calendarSplitDialog('),ctx);
  const plan=ctx.calendarSplitPlan(w,key,'repeat:r',540,'new');assert.deepEqual(plain(plan.after.days[key].blocks['repeat:r']),{start:480,end:540});assert.deepEqual(plain(plan.after.days[key].tasks[0].timeBlock),{start:540,end:600});assert.deepEqual(plan.after.repeats,w.calendar.repeats);assert.deepEqual(w.calendar.days,{});
});

test('Canvas culls distant connections but keeps edges that cross the current viewport', () => {
  const ctx=vm.createContext({});vm.runInContext(section('function canvasViewportBounds(', 'function mountCanvas('),ctx);
  const viewport=ctx.canvasViewportBounds({x:0,y:0,zoom:1},800,600,100),box=(x,y)=>({x,y,w:100,h:100});
  assert.equal(ctx.canvasConnectionNear(box(-1000,0),box(1000,0),viewport),true);
  assert.equal(ctx.canvasConnectionNear(box(900,900),box(1200,1000),viewport),false);
  assert.equal(ctx.canvasBoundsContain(ctx.canvasViewportBounds({x:0,y:0,zoom:1},800,600,400),viewport),true);
});

test('menus flip above anchors and clamp to narrow viewports', () => {
  const ctx=vm.createContext({});vm.runInContext(section('function menuViewportPosition(', 'let currentMenuAnchor='),ctx);
  assert.deepEqual(plain(ctx.menuViewportPosition({left:760,top:560,bottom:580},240,180,800,600)),{left:554,top:376});
  assert.deepEqual(plain(ctx.menuViewportPosition({left:0,top:0,bottom:20},180,120,200,200)),{left:6,top:24});
});

test('only the active checklist line hides its rendered checkbox on screen', () => {
  assert.match(html, /@media screen\s*\{\.source-editor \.md-task-line\.md-inline-active>input\[data-task-pos\]\{display:none\}\}/);
  assert.match(html, /<input data-md-preview contenteditable="false" type="checkbox" aria-label="Checklist item" data-task-pos=/);
});

test('checklist conversion preserves checked items, indentation and selection', () => {
  const ctx=editorHelpers(), source='Alpha\n  - [x] Beta\n3. Gamma';
  const result=ctx.noteListConversion(source,{from:0,to:source.length},'checklist');
  assert.equal(result.text,'- [ ] Alpha\n  - [x] Beta\n- [ ] Gamma');
  assert.equal(result.text.slice(result.selection.from,result.selection.to),'Alpha\n  - [x] Beta\n- [ ] Gamma');
});

test('table row and column moves preserve cells and column alignment', () => {
  const ctx=vm.createContext({});
  vm.runInContext(section('function reorderTableAxis(', 'function showTableCellGrid('),ctx);
  const rows=[['A','B','C'],['1','2','3'],['4','5','6']],align=['left','center','right'];
  ctx.reorderTableAxis(rows,align,'row',2,1);
  ctx.reorderTableAxis(rows,align,'column',0,2);
  assert.deepEqual(rows,[['B','C','A'],['5','6','4'],['2','3','1']]);
  assert.deepEqual(align,['center','right','left']);
  ctx.reorderTableAxis(rows,align,'column',2,0);
  ctx.reorderTableAxis(rows,align,'row',1,2);
  assert.deepEqual(rows,[['A','B','C'],['1','2','3'],['4','5','6']]);
});

test('archive moves folder subtrees and selected files in and out without deletion', () => {
  const w={folders:[{id:'parent',parent:null},{id:'child',parent:'parent'}],notes:[{id:'inside',folder:'child'},{id:'loose',folder:null}]};
  const ctx=vm.createContext({workspace:()=>w,workspaceIndex:()=>({foldersById:new Map(w.folders.map(f=>[f.id,f]))}),uid:()=> 'archive',invalidateWorkspaceIndex:()=>{},changed:()=>{},captureWikiReferences:()=>[],maintainWikiReferences:()=>{},folderInTrash:()=>false,noteBy:id=>w.notes.find(n=>n.id===id),quietSidebarFolders:new WeakMap(),clearSelections:()=>{},renderTree:()=>{}});
  vm.runInContext(section('function descendants(', "$('#archive-nav').onclick"),ctx);
  ctx.moveArchiveItems(['loose'],['parent','child'],true);
  assert.equal(w.archiveFolder,'archive');assert.equal(w.folders[0].parent,'archive');assert.equal(w.folders[1].parent,'parent');
  assert.equal(ctx.inArchive('child'),true);assert.equal(w.notes[1].folder,'archive');
  ctx.moveArchiveItems(['loose'],['parent'],false);
  assert.equal(ctx.inArchive('child'),false);assert.equal(w.notes[1].folder,null);assert.equal(w.notes[0].folder,'child');
});

test('Archive sits beside Trash and keeps the search panel visible when toggled', () => {
  assert.match(html, /<div class="search-tree-actions"><button id="trash-toggle"[^>]*>Trash<\/button><button id="archive-nav"[^>]*>Archive<\/button>/);
  const w={folders:[],notes:[]},controls=new Map();
  const ctx=vm.createContext({workspace:()=>w,workspaceIndex:()=>({foldersById:new Map(w.folders.map(f=>[f.id,f]))}),uid:()=> 'archive',invalidateWorkspaceIndex:()=>{},changed:()=>{},quietSidebarFolders:new WeakMap(),clearSelections:()=>{},renderTree:()=>{},$:selector=>{if(!controls.has(selector))controls.set(selector,{value:'',setAttribute(key,value){this[key]=value;}});return controls.get(selector);},searchMode:true,trashMode:false,query:'',activeFolder:null});
  vm.runInContext(section('let archiveMode=false,archiveWorkspace=null;', "$('#archive-nav').onclick"),ctx);
  ctx.showArchiveTree(true);ctx.syncArchiveMode();
  assert.equal(ctx.searchMode,true);assert.equal(ctx.activeFolder,'archive');assert.equal(controls.get('#archive-nav')['aria-pressed'],'true');
  ctx.trashMode=true;ctx.syncArchiveMode();
  assert.equal(controls.get('#archive-nav')['aria-pressed'],'false');assert.equal(ctx.activeFolder,null);
  ctx.showArchiveTree(true);ctx.showArchiveTree(false);ctx.syncArchiveMode();
  assert.equal(ctx.searchMode,true);assert.equal(ctx.trashMode,false);assert.equal(ctx.activeFolder,null);
});

function trashLinkHelpers() {
  let id=0;
  const ctx=vm.createContext({uid:()=>String(++id),resolveWikiLink:raw=>({note:{id:raw.split(/[|#]/)[0]}}),wikiDisplay:raw=>raw});
  vm.runInContext(scripts.find(m=>m[1].includes('data-vendor="marked"'))[2],ctx);
  vm.runInContext(section('function wikiScan(', 'function wikiContent(')+section('function trashLinkRows(', 'const quietLegacyLinks='),ctx);
  return ctx;
}

test('trash removes exact incoming wiki and direct links, not literals or unrelated links', () => {
  const ctx=trashLinkHelpers(),source='See [[a#Heading|alias]], [label](note:a) and [old](#note-a). [[b]]\n`[[a]] [label](note:a)`\n```\n[[a]]\n```\n[ref][x]\n\n[x]: note:a';
  const rows=[],ids=new Set(['a']),spans=ctx.trashLinkSpans(source,{id:'owner'},ids);
  assert.deepEqual(plain(spans).map(s=>source.slice(s.start,s.end)),['[[a#Heading|alias]]','[label](note:a)','[old](#note-a)','[ref][x]']);
  const cleaned=ctx.detachTrashLinkTokens(source,rows,spans,'owner');
  assert.equal(cleaned,'See ,  and . [[b]]\n`[[a]] [label](note:a)`\n```\n[[a]]\n```\n\n\n[x]: note:a');
  assert.equal(ctx.reattachTrashLinkTokens(cleaned,rows,ids),source);assert.equal(rows.length,0);
});

test('trash links survive serialization, edits and partial restores in either order', () => {
  const ctx=trashLinkHelpers(),source='one [[a]][[b]][[a]] two [[b]] end',owner={id:'owner'},a=new Set(['a']),b=new Set(['b']);
  for(const batches of [[a,b],[b,a],[new Set(['a','b'])]]){
    let rows=[],cleaned=source;
    for(const ids of batches)cleaned=ctx.detachTrashLinkTokens(cleaned,rows,ctx.trashLinkSpans(cleaned,owner,ids),'owner');
    rows=JSON.parse(JSON.stringify(rows));assert.equal(cleaned,'one  two  end');
    const edited='New '+cleaned+'!';ctx.rebaseTrashLinkPositions(rows,cleaned,edited);cleaned=edited;
    for(const order of [[a,b],[b,a]]){const copy=structuredClone(rows);let text=cleaned;for(const ids of order)text=ctx.reattachTrashLinkTokens(text,copy,ids);assert.equal(text,'New '+source+'!');assert.equal(copy.length,0);}
    const w={trashLinks:structuredClone(rows)};ctx.purgeTrashLinks(w,a);assert.ok(w.trashLinks.every(row=>row.target==='b'));
  }
});

test('file deletion undo, redo and Trash recovery update source and persistent link records together', () => {
  const ctx=trashLinkHelpers(),original='Before [[a#Section|reference]] and [direct](note:a) after.',owner={id:'owner',source:original},target={id:'a',source:'target'},w={id:'w',notes:[owner,target],folders:[],panes:[{tabs:['owner','a'],active:'a'}]};
  const deletionHistories=new Map(),selected=new Set(),selectedFolders=new Set();
  Object.assign(ctx,{workspace:()=>w,noteBy:id=>w.notes.find(n=>n.id===id),sourceForNote:n=>n.source,setSourceNote:(n,s)=>n.source=s,sourceHistory:new Map(),sourceEditors:new WeakMap(),$$:()=>[],$:()=>({focus(){}}),changed:()=>{},render:()=>{},flash:()=>{},invalidateWorkspaceIndex:()=>{},folderInTrash:()=>false,clearSelections:()=>{selected.clear();selectedFolders.clear();},collapseEmptyPanes:()=>{},structuredClone,deletionHistories,selected,selectedFolders,currentPane:0,activeFolder:null,anchorId:null,confirmTrashRestore:(_w,_ids,commit)=>commit()});
  vm.runInContext(section('function trashNotes(', 'function isEditableTarget(')+section('function restoreTrashedNotes(', 'function confirmTrashRestore('),ctx);
  ctx.trashNotes(['a'],true,[owner]);assert.ok(target.deleted);assert.equal(owner.source,'Before  and  after.');assert.equal(w.trashLinks.length,2);
  assert.equal(ctx.undoNoteDeletionPrepared(false),true);assert.equal(target.deleted,0);assert.equal(owner.source,original);assert.equal(w.trashLinks.length,0);
  assert.equal(ctx.undoNoteDeletionPrepared(true,[owner]),true);assert.ok(target.deleted);assert.equal(owner.source,'Before  and  after.');
  const before=owner.source;owner.source='New '+before;ctx.rebaseTrashLinkPositions(w.trashLinks,before,owner.source);w.trashLinks=JSON.parse(JSON.stringify(w.trashLinks));
  ctx.restoreTrashedNotes(['a'],true);assert.equal(target.deleted,0);assert.equal(owner.source,'New '+original);assert.equal(w.trashLinks.length,0);
});

function editorHelpers() {
  const context = vm.createContext({});
  vm.runInContext(section('function codeFenceLine(', 'function literalCodeFenceLength(') +
    section('function mapNotePositionThroughEdits(', 'const sourceParser='), context);
  return context;
}
function difference(before, after) {
  let start = 0, end = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { start, removed: before.slice(start, before.length - end), inserted: after.slice(start, after.length - end) };
}

test('renumbering follows edited lists, preserves nesting and unrelated literal content', () => {
  const ctx = editorHelpers();
  const renumber = (a,b) => ctx.renumberEditedNoteLists(a,b,{from:b.length,to:b.length},difference(a,b)).source;
  assert.equal(renumber('1. A\n2. B\n3. C','1. A\n3. C'),'1. A\n2. C');
  assert.equal(renumber('1. A\n2. B','2. B'),'1. B');
  assert.equal(renumber('1. A\n2. B','1. A\n2. New\n2. B'),'1. A\n2. New\n3. B');
  assert.equal(renumber('1. A\n  1. B\n  2. C\n2. D','1. A\n  2. C\n2. D'),'1. A\n  1. C\n2. D');
  assert.equal(renumber('1. A\n\n2. B','1. A\n\n2. New\n3. B'),'1. A\n\n2. New\n3. B');
  assert.equal(renumber('9. custom\n10. list\n\nOther','9. CUSTOM\n10. LIST\n\nOther'),'9. CUSTOM\n10. LIST\n\nOther');
  assert.equal(renumber('```\n5. data\n```','```\n5. data\n9. data\n```'),'```\n5. data\n9. data\n```');
  assert.equal(renumber('$$\n5. data\n$$','$$\n5. data\n9. data\n$$'),'$$\n5. data\n9. data\n$$');
});

test('case conversion and selection formatting states distinguish active, mixed, and inactive', () => {
  const ctx = editorHelpers();
  const pieces = [{text:'hELLO '},{text:'wORLD. aNOTHER'}];
  assert.deepEqual(plain(ctx.noteCaseTransform(pieces,'sentence')).map(x=>x.text), ['Hello ','world. Another']);
  assert.deepEqual(plain(ctx.noteCaseTransform(pieces,'title')).map(x=>x.text), ['Hello ','World. Another']);
  assert.equal(ctx.noteCaseTransform([{text:'Straße'}],'upper')[0].text,'STRASSE');
  const node = selectors => ({parentElement:{closest:q=>selectors[q]||null}});
  const first = {text:'one',node:node({'strong,b':{},'mark[data-highlight]':{dataset:{highlight:'#F1B5B8'}}})};
  const second = {text:'two',node:node({})};
  assert.equal(ctx.selectionFormatStates([first]).bold,'true');
  assert.equal(ctx.selectionFormatStates([first,second]).bold,'mixed');
  assert.equal(ctx.selectionFormatStates([second]).bold,'false');
  assert.equal(ctx.selectionFormatStates([first]).color,'#F1B5B8');
  assert.equal(ctx.selectionFormatStates([first,second]).color,'');
});

test('superscript/subscript render and preserve normal nested inline formatting', () => {
  const ctx = vm.createContext({console, esc: s=>s, workspace:()=>({assets:{}}), sourceImageRowHTML:()=>false, sourceMediaHTML:()=>'', sourceWikiHTML:()=>'', sourceMathHTML:()=>''});
  vm.runInContext(scripts.find(m=>m[1].includes('data-vendor="marked"'))[2],ctx);
  vm.runInContext(html.match(/const TAB_GROUP_COLORS=\[[^;]+;/)[0]+section('function validNoteHighlight(', 'function normalizeIndentedMarkdown(')+'\nthis.parse=s=>sourceParser.parse(s);',ctx);
  assert.match(ctx.parse('H<sub>2</sub>O and x<sup>**2**</sup>'), /H<sub>2<\/sub>O and x<sup><strong>2<\/strong><\/sup>/);
  const pieces=[{text:'H',kind:'text'},{text:'2',kind:'text'},{text:'O',kind:'text'}];
  const sub=ctx.paintNoteHighlightPieces(pieces,1,2,'sub',true);
  assert.equal(sub.source,'H<sub>2</sub>O');
  assert.equal(sub.source.slice(sub.from,sub.to),'2');
  const existing=[{text:'H',kind:'text'},{text:'<sub>',kind:'highlight-marker'},{text:'23',kind:'text',color:'sub'},{text:'</sub>',kind:'highlight-marker'},{text:'O',kind:'text'}];
  assert.equal(ctx.paintNoteHighlightPieces(existing,6,7,'sup',true).source,'H<sup>2</sup><sub>3</sub>O');
  assert.equal(ctx.paintNoteHighlightPieces(existing,6,8,'',true).source,'H23O');
});

test('batch time shift is atomic, respects locked blocks, and preserves recurrence and spacing', () => {
  const w={calendar:{days:{'2026-11-27':{tasks:[{id:'a',text:'A',timeBlock:{start:540,end:600}},{id:'b',text:'B',timeBlock:{start:660,end:690}},{id:'c',text:'C',timeBlock:{start:720,end:780,locked:true}}],blocks:{},reminders:{a:{at:123}}}},repeats:[{id:'r',schedule:'unchanged'}]}};
  const date='2026-11-27',copy=structuredClone(w);
  const ctx=vm.createContext({structuredClone,calendarManageSnapshot:w=>structuredClone(w.calendar),calendarManageRowId:(key,t)=>JSON.stringify([key,t.id]),calendarBlockId:t=>t.rule?'repeat:'+t.id:t.id,validCalendarTimeBlock:r=>!!r&&Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end<=1440&&r.end>r.start,calendarTasks:(key,w)=>structuredClone(w.calendar.days[key]?.tasks||[]),writeCalendarDay:(key,tasks,w)=>{w.calendar.days[key].tasks=tasks;},calendarTimeTasks:(key,w)=>[...(w.calendar.days[key]?.tasks||[]),{id:'r',text:'Repeat',rule:{id:'r'},timeBlock:w.calendar.days[key]?.blocks['repeat:r']||{start:900,end:930}}],calendarTaskFor:(keyW,key,id)=>[...(keyW.calendar.days[key]?.tasks||[]),{id:'r',text:'Repeat',rule:{id:'r'},timeBlock:keyW.calendar.days[key]?.blocks['repeat:r']||{start:900,end:930}}].find(t=>(t.rule?'repeat:'+t.id:t.id)===id)});
  vm.runInContext(section('function calendarShiftPlan(', 'function calendarShiftDialog('),ctx);
  const selected=[{key:date,id:'a'},{key:date,id:'b'},{key:date,id:'repeat:r'}];
  const plan=ctx.calendarShiftPlan(w,selected,60);
  assert.equal(plan.error,undefined);assert.equal(plan.rows.length,3);
  assert.equal(plan.after.days[date].tasks[0].timeBlock.start,600);assert.equal(plan.after.days[date].tasks[1].timeBlock.start,720);
  assert.equal(plan.after.days[date].tasks[1].timeBlock.start-plan.after.days[date].tasks[0].timeBlock.start,120);
  assert.equal(plan.after.days[date].blocks['repeat:r'].start,960);
  assert.equal(plan.after.repeats[0].schedule,'unchanged');assert.equal(plan.after.days[date].reminders.a.at,123);
  assert.ok(plan.conflicts>0);assert.deepEqual(w,copy);
  assert.ok(ctx.calendarShiftPlan(w,[{key:date,id:'c'}],60).error);
  assert.ok(ctx.calendarShiftPlan(w,selected,-600).error);
  assert.equal(ctx.calendarShiftPlan(w,selected,60,true).rows.length,3);assert.deepEqual(w,copy);
});

test('folder copy names avoid sibling collisions and copied wiki references point to copies', () => {
  const target={id:'old',title:'Study'},owner={id:'original'};
  const ctx=vm.createContext({wikiKey:s=>s.toLowerCase(),wikiScan:s=>({spans:[...s.matchAll(/\[\[([^\]]+)\]\]/g)].map(m=>({start:m.index,end:m.index+m[0].length,raw:m[1]}))}),parseWikiLink:raw=>{const [destination,alias]=raw.split('|'),[file,fragment]=destination.split('#');return{file,fragment,suffix:fragment?'#'+fragment:'',alias};},resolveWikiLink:()=>({note:target}),wikiDisplay:s=>s,wikiNotePath:()=> 'Folder/Study'});
  vm.runInContext(section('function duplicateFolderName(', 'async function duplicateWorkspaceFolder('),ctx);
  assert.equal(ctx.duplicateFolderName('Study',['Study','Study copy','study copy 2']),'Study copy 3');
  assert.equal(ctx.duplicateFolderWikiSource('[[Study]]',owner,{old:'new'},new Map([['old','Folder copy/Study']])),'[Study](note:new)');
  assert.equal(ctx.duplicateFolderWikiSource('[[Study#Intro|Go]]',owner,{old:'new'},new Map([['old','Folder copy/Study']])),'[[Folder copy/Study#Intro|Go]]');
});
