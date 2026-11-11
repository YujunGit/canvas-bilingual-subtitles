import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSRT,activeCues,batches} from '../src/subtitles.js';
import {providers,gmPost,decodeEntities} from '../src/providers.js';
import {translateCues,cacheKey} from '../src/translation.js';
const fixture=await readFile(new URL('./fixtures/lecture.srt',import.meta.url),'utf8');
const cues=parseSRT(fixture);
test('uploaded SRT: all blocks preserved',()=>{
 assert.equal(cues.length,(fixture.match(/-->/g)||[]).length);
 assert.equal(cues[0].start,.8);assert.equal(cues[0].end,3.495);
 assert.match(cues[0].text,/So from last\ntime we figured out/);
 assert(cues.every(c=>c.end>c.start));
 console.log(JSON.stringify({cues:cues.length,first:cues[0].start,last:cues.at(-1).end,characters:cues.reduce((n,c)=>n+c.text.length,0),batches:batches([...new Set(cues.map(c=>c.text))]).length}));
});
test('BOM, CRLF, markup, invalid input',()=>{
 assert.equal(parseSRT('\uFEFF'+fixture.replace(/\n/g,'\r\n')).length,cues.length);
 assert.equal(parseSRT('00:00:01,000 --> 00:00:02,000\n<b>Hello</b>')[0].text,'Hello');
 for(const s of ['transcript only','1\n00:00:02,000 --> 00:00:01,000\na','1\n00:61:00,000 --> 00:62:00,000\na'])assert.throws(()=>parseSRT(s));
});
test('sync boundaries, overlaps, backward seek',()=>{
 const c=[{start:1,end:3},{start:2,end:4}];
 assert.equal(activeCues(c,0).length,0);assert.equal(activeCues(c,2).length,2);
 assert.equal(activeCues(c,3).length,1);assert.equal(activeCues(c,4).length,0);assert.equal(activeCues(c,1).length,1);
});
test('batch limits',()=>{assert.deepEqual(batches(['aa','bb','cc'],2,4),[['aa','bb'],['cc']]);assert.throws(()=>batches(['long'],1,3));});
test('provider payloads',async()=>{
 const cfg={key:'test-secret',target:'zh-Hans',region:'eastus'};
 const google=await providers.google.translate(['hello'],cfg,async(u,b)=>{
 assert.match(u,/translation.googleapis.com/);assert.equal(b.target,'zh-CN');assert.equal(b.format,'text');assert.deepEqual(b.q,['hello']);return {data:{translations:[{translatedText:'你好'}]}};
 });assert.deepEqual(google,['你好']);
 const azure=await providers.azure.translate(['hello'],cfg,async(u,b,h)=>{
 assert.match(u,/to=zh-Hans/);assert.deepEqual(b,[{Text:'hello'}]);assert.equal(h['Ocp-Apim-Subscription-Region'],'eastus');return [{translations:[{text:'你好'}]}];
 });assert.deepEqual(azure,['你好']);
});
const config={provider:'azure',key:'test',target:'zh-Hans',region:''};
function memory(){const m=new Map();return {get:async k=>m.get(k),set:async(k,v)=>m.set(k,v),m};}
test('cache, deduplication, provider/language isolation, cue mapping',async()=>{
 const store=memory(),signal=new AbortController().signal;let calls=0;
 const post=async(u,b)=>{calls++;return b.map(x=>({translations:[{text:'译'+x.Text}]}));};
 const input=[{start:0,end:1,text:'hello'},{start:2,end:3,text:'hello'}];
 const output=await translateCues(input,config,store,post,signal);
 assert.equal(calls,1);assert.equal(output[1].start,2);assert.equal(output[1].translation,'译hello');
 await translateCues(input,config,store,post,signal);assert.equal(calls,1);
 assert.notEqual(cacheKey(providers.azure,config,'hello'),cacheKey(providers.google,config,'hello'));
 await translateCues(input,{...config,target:'ja'},store,post,signal);assert.equal(calls,2);
});
test('malformed responses and cancellation',async()=>{
 const store=memory();await assert.rejects(translateCues(cues,config,store,async()=>[],new AbortController().signal),/响应/);assert.equal(store.m.size,0);
 const c=new AbortController();c.abort();await assert.rejects(translateCues(cues,config,store,()=>{throw Error('unexpected');},c.signal),/取消/);
});
test('partial batch resume',async()=>{
 const store=memory();let calls=0;const input=Array.from({length:51},(_,i)=>({start:i,end:i+1,text:String(i)}));
 await assert.rejects(translateCues(input,config,store,async(u,b)=>{if(++calls===2)throw Error('offline');return b.map(x=>({translations:[{text:x.Text}]}));},new AbortController().signal),/offline/);assert.equal(store.m.size,50);
});
test('transport redacts server body',async()=>{
 globalThis.GM_xmlhttpRequest=o=>{queueMicrotask(()=>o.onload({status:403,responseText:'test-secret',responseHeaders:''}));return {abort(){}};};
 await assert.rejects(gmPost('https://example.invalid',{},{},new AbortController().signal),e=>e.status===403&&!e.message.includes('test-secret'));delete globalThis.GM_xmlhttpRequest;
});

test('Google HTML entities are decoded once and never rendered as HTML',()=>{assert.equal(decodeEntities('A &amp; B &#39; &lt;b&gt;'),'A & B \' <b>');assert.equal(decodeEntities('&#x1f600;'),'😀');});

import {selectVideo} from '../src/player.js';
test('Kaltura preloader does not capture subtitle clock',()=>{
 const empty={isConnected:true,readyState:0,duration:NaN};
 const lecture={isConnected:true,readyState:4,duration:469.252};
 assert.equal(selectVideo([empty],null),null);
 assert.equal(selectVideo([lecture,empty],empty),lecture);
 assert.equal(selectVideo([empty,lecture],null),lecture);
 assert.equal(selectVideo([lecture,empty],lecture),lecture);
 const second={...lecture};
 assert.equal(selectVideo([lecture,second],null),null);
 assert.equal(selectVideo([lecture,second],second),second);
 assert.equal(selectVideo([{...lecture,isConnected:false}],lecture),null);
});

import {cleanSubtitleLines} from '../src/player.js';
test('subtitle display removes empty translated rows, including cached text',()=>{
 assert.equal(cleanSubtitleLines('并将这些权重\n \n代入概率公式。'), '并将这些权重\n代入概率公式。');
 assert.equal(cleanSubtitleLines(' a\r\n\r\nb\u2029\u2029c '),'a\nb\nc');
 assert.equal(cleanSubtitleLines(undefined),'');
});
