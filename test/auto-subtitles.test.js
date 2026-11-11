import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseEnglishSRT,safeCaptionURL,captureSRTClick} from '../src/auto-subtitles.js';
test('select only unambiguous English SRT',()=>{
 const en={label:'Click to download the captions Lecture.srt English'};
 assert.equal(chooseEnglishSRT([{label:'Lecture.mp4'},en,{label:'Lecture.srt French'}]),en);
 assert.throws(()=>chooseEnglishSRT([{label:'Lecture.txt English'}]),/没有/);
 assert.throws(()=>chooseEnglishSRT([en,{label:'Other.srt English'}]),/多个/);
});
test('caption URL restricts protocols, hosts and blob origin',()=>{
 const origin='https://cdnapisec.kaltura.com';
 assert.equal(safeCaptionURL('blob:'+origin+'/123',origin),'blob:'+origin+'/123');
 for(const url of ['javascript:alert(1)','https://kaltura.com.evil.test/a','blob:https://evil.test/a','http://cdnapisec.kaltura.com/a'])assert.throws(()=>safeCaptionURL(url,origin));
});
function fixture(){
 let clicks=0;class Anchor {click(){clicks++;}}
 return {page:{HTMLAnchorElement:Anchor,location:{origin:'https://cdnapisec.kaltura.com'}},Anchor,get clicks(){return clicks;}};
}
test('capture detached SRT anchor, let other downloads proceed, restore prototype',async()=>{
 const f=fixture(),original=f.Anchor.prototype.click;
 const href=await captureSRTClick(f.page,()=>{
  const unrelated=new f.Anchor();unrelated.download='video.mp4';unrelated.click();
  const a=new f.Anchor();a.download='Lecture.srt';a.href='blob:https://cdnapisec.kaltura.com/123';a.click();
 },'Lecture.srt',new AbortController().signal);
 assert.match(href,/^blob:/);assert.equal(f.clicks,1);assert.equal(f.Anchor.prototype.click,original);
});
test('cancel and timeout restore download behavior',async()=>{
 const f=fixture(),original=f.Anchor.prototype.click,c=new AbortController();
 const p=captureSRTClick(f.page,()=>{},'a.srt',c.signal);c.abort();
 await assert.rejects(p,/取消/);assert.equal(f.Anchor.prototype.click,original);
 await assert.rejects(captureSRTClick(f.page,()=>{},'a.srt',new AbortController().signal,5),/未捕获/);
 assert.equal(f.Anchor.prototype.click,original);
});
