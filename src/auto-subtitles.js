import {parseSRT} from './subtitles.js';

export function chooseEnglishSRT(items) {
  const matches=items.filter(item => /\.srt\b/i.test(item.label) && /\bEnglish\b|\ben(?:[-_](?:US|GB))?\b|英语|英文/i.test(item.label));
  if(matches.length!==1)throw new Error(matches.length ? '发现多个英文 SRT，请手动选择并导入' : '下载列表中没有找到英文 SRT，请使用手动导入');
  return matches[0];
}
export function safeCaptionURL(value, origin) {
  const url=new URL(value,origin);
  if(url.protocol==='blob:' && url.origin===origin)return url.href;
  if(url.protocol==='https:' && (url.origin===origin || /(^|\.)kaltura\.com$/i.test(url.hostname)))return url.href;
  throw new Error('字幕下载地址不属于当前播放器或 Kaltura');
}
const checkAbort=signal=>{if(signal.aborted)throw new Error('已取消');};
const pause=(ms,signal)=>new Promise((resolve,reject)=>{
  checkAbort(signal);
  const stop=()=>{clearTimeout(timer);reject(new Error('已取消'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);
  signal.addEventListener('abort',stop,{once:true});
});
async function waitFor(read,signal,timeout=10000) {
  const deadline=Date.now()+timeout;
  do {checkAbort(signal);const result=read();if(result)return result;await pause(150,signal);}while(Date.now()<deadline);
  throw new Error('等待字幕下载列表超时，请稍后重试或手动导入');
}
// Kaltura's download service clicks a detached anchor, so document click handlers
// cannot observe it. Intercept only that exact SRT filename, only during this task.
export function captureSRTClick(page, trigger, filename, signal, timeout=15000) {
  return new Promise((resolve,reject)=>{
    checkAbort(signal);
    const proto=page.HTMLAnchorElement.prototype, original=proto.click;
    let timer, finished=false;
    const finish=(error,value)=>{
      if(finished)return;finished=true;clearTimeout(timer);
      if(proto.click===intercept)proto.click=original;
      signal.removeEventListener('abort',abort);
      error?reject(error):resolve(value);
    };
    const abort=()=>finish(new Error('已取消'));
    function intercept(...args) {
      if(!finished && this.download===filename) {
        try {finish(null,safeCaptionURL(this.href,page.location.origin));}catch(e){finish(e);}
        return; // Import into memory instead of creating an unwanted duplicate file.
      }
      return Reflect.apply(original,this,args);
    }
    proto.click=intercept;
    if(proto.click!==intercept)return finish(new Error('播放器不允许捕获字幕下载，请手动导入'));
    signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(new Error('未捕获到 SRT 下载，播放器版本可能不同，请手动导入')),timeout);
    try {trigger();}catch{finish(new Error('无法触发字幕下载，请手动导入'));}
  });
}
async function readCaption(url,signal) {
  const response=await fetch(url,{signal,credentials:'same-origin'});
  if(!response.ok)throw new Error(`字幕下载失败（HTTP ${response.status}）`);
  const limit=5*1024*1024;
  if(Number(response.headers.get('content-length'))>limit)throw new Error('SRT 超过 5 MB 限制');
  const reader=response.body.getReader();const chunks=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('SRT 超过 5 MB 限制');chunks.push(value);}
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function getKalturaSRT(signal,progress=()=>{}) {
  const page=typeof unsafeWindow==='undefined'?window:unsafeWindow;
  const doc=document;
  const entries=()=>[...doc.querySelectorAll('[data-testid="download-item-download-button"], [aria-label^="Click to download the captions"]')].filter(node=>node.getClientRects().length);
  let opened=false;
  try {
    progress('正在识别播放器的英文 SRT…');
    if(!entries().length){
      const button=await waitFor(()=>doc.querySelector('[data-testid="download-overlay-button"] button, button[aria-label="Download"]'),signal);
      button.click();opened=true;
    }
    const nodes=await waitFor(()=>{const items=entries();return items.length?items:null;},signal);
    const chosen=chooseEnglishSRT(nodes.map(node=>({node,label:node.getAttribute('aria-label')||node.textContent})));
    const filename=chosen.label.match(/(?:captions\s+)?(.+?\.srt)\b/i)?.[1];
    // Prefer the visible filename child. The aria label includes an action prefix.
    const visible=[...chosen.node.querySelectorAll('*')].map(n=>n.textContent.trim()).find(t=>/\.srt$/i.test(t));
    const expected=visible || filename?.replace(/^Click to download the captions\s+/i,'');
    if(!expected)throw new Error('无法识别字幕文件名，请手动导入');
    progress(`正在获取 ${expected}…`);
    const url=await captureSRTClick(page,()=>chosen.node.click(),expected,signal);
    checkAbort(signal);
    const text=await readCaption(url,signal);checkAbort(signal);
    return {cues:parseSRT(text),name:expected};
  }finally{
    if(opened)doc.querySelector('[aria-label="Close Download"]')?.click();
  }
}
