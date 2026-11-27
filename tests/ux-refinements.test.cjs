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
