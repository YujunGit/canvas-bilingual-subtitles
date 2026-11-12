// ==UserScript==
// @name         Canvas / Kaltura Bilingual Subtitles
// @namespace    local.canvas-bilingual
// @license      MIT
// @version      0.3.2
// @updateURL    http://127.0.0.1:8765/canvas-bilingual.meta.js
// @downloadURL  http://127.0.0.1:8765/canvas-bilingual.user.js
// @description  Inspect player, import SRT, translate with Google v2 or Azure
// @match        https://*.instructure.com/*
// @match        https://cdnapisec.kaltura.com/*
// @match        https://*.mediaspace.kaltura.com/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      translation.googleapis.com
// @connect      api.cognitive.microsofttranslator.com
// @run-at       document-idle
// ==/UserScript==

(function(){
"use strict";
function parseSRT(input) {
  const blocks = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n+/);
  const stamp = '(\\d{2,}):([0-5]\\d):([0-5]\\d)[,.](\\d{3})';
  const timing = new RegExp(`^${stamp}\\s*-->\\s*${stamp}\\s*$`);
  const cues = blocks.map((block, i) => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const m = lines.shift()?.trim().match(timing);
    if (!m || !lines.join('').trim()) throw new Error(`SRT 第 ${i + 1} 段格式错误`);
    const seconds = n => +m[n] * 3600 + +m[n+1] * 60 + +m[n+2] + +m[n+3] / 1000;
    const start = seconds(1), end = seconds(5);
    if (end <= start) throw new Error(`SRT 第 ${i+1} 段结束时间无效`);
    return {start, end, text: lines.join('\n').replace(/<\/?(?:b|i|u|font)\b[^>]*>/gi, '')};
  });
  return cues.sort((a,b) => a.start - b.start);
}
function activeCues(cues, time) {
  return cues.filter(c => c.start <= time && time < c.end);
}
function batches(texts, maxItems = 50, maxChars = 4500) {
  const result = []; let batch = [], count = 0;
  for (const text of texts) {
    const size = text.length; // UTF-16 is conservative for supplementary characters.
    if (size > maxChars) throw new Error('单条字幕超过批次字符上限，请先拆分');
    if (batch.length && (batch.length >= maxItems || count + size > maxChars)) {
      result.push(batch); batch = []; count = 0;
    }
    batch.push(text); count += size;
  }
  if (batch.length) result.push(batch);
  return result;
}

function decodeEntities(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return ({amp:'&',lt:'<',gt:'>',quot:'"',apos: "'",nbsp:' '})[entity.toLowerCase()];
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : match;
  });
}
const providers = {
  google: {
    id: 'google', version: 1, name: 'Google Cloud Translation v2',
    language: lang => ({'zh-Hans':'zh-CN','zh-Hant':'zh-TW'}[lang] || lang),
    async translate(texts, cfg, post) {
      const data = await post('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(cfg.key),
        {q:texts, source:'en', target:this.language(cfg.target), format:'text'}, {});
      return data?.data?.translations?.map(t => decodeEntities(t.translatedText));
    }
  },
  azure: {
    id:'azure', version:1, name:'Azure AI Translator', language:lang => lang,
    async translate(texts, cfg, post) {
      const headers = {'Ocp-Apim-Subscription-Key':cfg.key};
      if (cfg.region) headers['Ocp-Apim-Subscription-Region'] = cfg.region;
      const data = await post('https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=' + encodeURIComponent(this.language(cfg.target)),
        texts.map(Text => ({Text})), headers);
      return Array.isArray(data) ? data.map(t => t.translations?.[0]?.text) : undefined;
    }
  }
};
function gmPost(url, body, headers, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('已取消'));
    let request;
    const abort = () => { request?.abort(); finish(new Error('已取消')); };
    const finish = (error, value) => {
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    request = GM_xmlhttpRequest({method:'POST', url, anonymous:true, timeout:30000,
      headers:{'Content-Type':'application/json', ...headers}, data:JSON.stringify(body),
      onload:r => {
        if (r.status < 200 || r.status >= 300) {
          const error = new Error(`翻译服务 HTTP ${r.status}；检查密钥、区域、配额`);
          error.status = r.status;
          const retry = r.responseHeaders?.match(/^retry-after:\s*(.+)$/im)?.[1];
          error.retryMs = retry ? (/^\d+$/.test(retry.trim()) ? Number(retry)*1000 : Math.max(0, Date.parse(retry)-Date.now())) : 0;
          return finish(error);
        }
        try { finish(null, JSON.parse(r.responseText)); } catch { finish(new Error('翻译服务返回非 JSON 数据')); }
      },
      onerror:() => finish(new Error('网络错误；可手动重试，已完成批次已缓存')),
      ontimeout:() => finish(new Error('请求超时；为避免重复计费不自动重试')),
      onabort:() => finish(new Error('已取消'))
    });
    signal?.addEventListener('abort', abort, {once:true});
  });
}

function cacheKey(provider, cfg, text) {
  return JSON.stringify([provider.id, provider.version, 'en', provider.language(cfg.target), text]);
}
async function translateCues(cues, cfg, store, post, signal, progress = () => {}) {
  const provider = providers[cfg.provider];
  if (!provider || !cfg.key.trim()) throw new Error('请选择服务并填写 API Key');
  const unique = [...new Set(cues.map(c => c.text))];
  const values = new Map();
  for (const text of unique) {
    const cached = await store.get(cacheKey(provider, cfg, text));
    if (typeof cached === 'string') values.set(text, cached);
  }
  const pending = unique.filter(t => !values.has(t));
  let done = values.size;
  progress(done, unique.length);
  for (const batch of batches(pending)) {
    if (signal.aborted) throw new Error('已取消');
    let translated;
    for (let attempt=0; ; attempt++) {
      try { translated = await provider.translate(batch, cfg, (u,b,h) => post(u,b,h,signal)); break; }
      catch (e) {
        if (signal.aborted || e.status !== 429 || attempt >= 2) throw e;
        const delay = Math.max(e.retryMs || 0, 1000 * 2**attempt);
        if (delay > 60000) throw new Error('服务要求等待超过一分钟，请稍后重试');
        await new Promise((resolve,reject) => {
          const stop = () => { clearTimeout(timer); reject(new Error('已取消')); };
          const timer = setTimeout(() => {signal.removeEventListener('abort',stop);resolve();}, delay);
          signal.addEventListener('abort',stop,{once:true});
        });
      }
    }
    if (signal.aborted) throw new Error('已取消');
    if (!Array.isArray(translated) || translated.length !== batch.length || translated.some(t => typeof t !== 'string'))
      throw new Error('翻译响应条数或类型错误，未缓存该批次');
    for (let i=0;i<batch.length;i++) {
      values.set(batch[i], translated[i]);
      await store.set(cacheKey(provider,cfg,batch[i]), translated[i]);
    }
    done += batch.length; progress(done,unique.length);
  }
  if (signal.aborted) throw new Error('已取消');
  return cues.map(c => ({...c, translation:values.get(c.text)}));
}

// Keep a user-selected loaded video; replace an empty preloader only when
// exactly one media element has metadata. Never guess between two loaded streams.
function selectVideo(videos, current) {
  const loaded = videos.filter(v => v.isConnected && v.readyState >= 1 &&
    (Number.isFinite(v.duration) ? v.duration > 0 : v.duration === Infinity));
  if (loaded.includes(current)) return current;
  if (loaded.length === 1) return loaded[0];
  return null;
}

// Discover only this frame and open shadow roots. Cross-origin frames run their own script.
function discover(root = document) {
  const videos = [], frames = [];
  const visit = r => {
    videos.push(...r.querySelectorAll('video'));
    frames.push(...r.querySelectorAll('iframe'));
    for (const node of r.querySelectorAll('*')) if (node.shadowRoot) visit(node.shadowRoot);
  };
  visit(root); return {videos,frames};
}
function inspectPlayer() {
  const {videos,frames} = discover();
  return {origin:location.origin, inFrame:window !== window.top,
    videos:videos.map((v,i) => ({index:i, connected:v.isConnected, time:v.currentTime,
      duration:Number.isFinite(v.duration)?v.duration:null, readyState:v.readyState,
      tracks:[...v.textTracks].map(t => ({language:t.language,kind:t.kind,mode:t.mode,cues:t.cues?.length ?? null}))})),
    frames:frames.map(f => {
      let origin = 'unknown'; try {origin=new URL(f.src,location.href).origin;} catch {}
      return {origin, sandbox:f.getAttribute('sandbox')};
    })};
}
// Providers may return paragraph separators or blank lines for a single cue.
// Keep meaningful line breaks, but never render empty subtitle rows.
function cleanSubtitleLines(text = '') {
  return text.replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n')
    .map(line => line.trim()).filter(Boolean).join('\n');
}
const clampSubtitle = (value, max) => Math.min(max, Math.max(0, value));
function subtitleColor(value, fallback = '#ffffff') {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}
function subtitleBackground(color, transparency) {
  const hex = subtitleColor(color, '#000000');
  const rgb = [1,3,5].map(start => parseInt(hex.slice(start,start+2),16));
  return `rgba(${rgb.join(',')},${subtitleAlpha(transparency)})`;
}
function subtitleAlpha(transparency) {
  const value = Number(transparency);
  return 1 - clampSubtitle(Number.isFinite(value) ? value : 22, 100) / 100;
}
// Store fractions of available travel, keeping the complete box inside the video.
function subtitlePlacement(rect, width, height, position) {
  const dx = Math.max(0, rect.width - width), dy = Math.max(0, rect.height - height);
  const custom = Number.isFinite(position?.x) && Number.isFinite(position?.y);
  return {left:rect.left + (custom ? clampSubtitle(position.x, 1) * dx : dx / 2),
    top:rect.top + (custom ? clampSubtitle(position.y, 1) * dy : Math.max(0, dy - Math.max(48, rect.height * .12)))};
}
function mountRenderer(getState, onPositionChange = () => {}) {
  const host = document.createElement('div');
  const shadow = host.attachShadow({mode:'closed'});
  const box = document.createElement('div');
  box.title='拖动字幕可调整位置';
  box.style.cssText='pointer-events:auto;cursor:grab;touch-action:none;user-select:none;box-sizing:border-box;white-space:pre-line;text-align:center;color:white;background:rgba(0,0,0,.78);padding:6px 12px;border-radius:6px;font:clamp(14px,2.1vw,24px)/1.4 system-ui;overflow-wrap:anywhere;max-height:40vh;overflow:hidden';
  shadow.append(box);
  host.style.cssText='position:fixed;pointer-events:none;z-index:2147483646;display:none';
  document.documentElement.append(host);
  let last = '', drag = null;
  const finish = (event, save = false) => {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const previous = drag; drag = null;
    if (box.hasPointerCapture(previous.id)) box.releasePointerCapture(previous.id);
    box.style.cursor='grab';
    if (save && previous.position) onPositionChange(previous.position);
    render();
  };
  box.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();event.stopPropagation();
    const rect=host.getBoundingClientRect();
    drag={id:event.pointerId, video:getState().video, x:event.clientX-rect.left, y:event.clientY-rect.top};
    box.setPointerCapture(event.pointerId);box.style.cursor='grabbing';
  });
  box.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();event.stopPropagation();
    const rect=drag.video.getBoundingClientRect();
    const dx=Math.max(0,rect.width-host.offsetWidth), dy=Math.max(0,rect.height-host.offsetHeight);
    drag.position={x:dx ? clampSubtitle(event.clientX-drag.x-rect.left,dx)/dx : .5,
      y:dy ? clampSubtitle(event.clientY-drag.y-rect.top,dy)/dy : 0};
    render();
  });
  box.addEventListener('pointerup', event => {event.stopPropagation();finish(event,true);});
  box.addEventListener('pointercancel', event => finish(event));
  box.addEventListener('lostpointercapture', event => finish(event));
  box.addEventListener('click', event => {event.preventDefault();event.stopPropagation();});
  const render = () => {
    const {video,cues,mode,offset,enabled,transparency=22,position=null,textColor='#ffffff',backgroundColor='#000000'} = getState();
    if (drag && (drag.video!==video || !video?.isConnected || !enabled || document.fullscreenElement===video)) {finish();return;}
    if (!video?.isConnected || !enabled) {host.style.display='none';return;}
    const fullscreen = document.fullscreenElement;
    // Native video fullscreen cannot contain a DOM overlay.
    if (fullscreen === video) {host.style.display='none';return;}
    const parent = fullscreen || document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    const r=video.getBoundingClientRect();
    const active=activeCues(cues, video.currentTime-offset);
    const content=active.map(c => mode==='original'?cleanSubtitleLines(c.text):mode==='translated'?cleanSubtitleLines(c.translation):[cleanSubtitleLines(c.text),cleanSubtitleLines(c.translation)].filter(Boolean).join('\n')).join('\n');
    box.style.color=subtitleColor(textColor);
    box.style.background=subtitleBackground(backgroundColor,transparency);
    if(!drag && content!==last){box.textContent=content;last=content;}
    host.style.display=(drag ? last : content) && r.width && r.height ? 'block':'none';
    host.style.width=`${r.width*.88}px`;
    box.style.maxHeight=`${Math.min(r.height,window.innerHeight*.4)}px`;
    const placement=subtitlePlacement(r,host.offsetWidth,host.offsetHeight,drag?.position || position);
    host.style.left=`${placement.left}px`;host.style.top=`${placement.top}px`;
  };
  const timer=setInterval(render,100);
  const stop=()=>{clearInterval(timer);finish();host.remove();};
  stop.cancelDrag=()=>finish();
  return stop;
}

// Position is local to each origin/frame role; the panel stays inside the viewport.
function floatingUI(host, button, panel) {
  const key = `cbs:position:${location.origin}:${window === window.top ? 'page' : 'frame'}`;
  const saved = GM_getValue(key, null);
  let point = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? saved : {x:12, y:Math.max(12, innerHeight * .3)};
  let drag = null, suppressClick = false;
  button.style.touchAction = 'none';
  button.style.cursor = 'grab';
  button.title = '点击打开设置；拖动可移动位置';
  const layout = () => {
    const r = button.getBoundingClientRect();
    point.x = Math.max(0, Math.min(point.x, innerWidth-r.width-6));
    point.y = Math.max(0, Math.min(point.y, innerHeight-r.height-6));
    host.style.left = `${point.x}px`; host.style.top = `${point.y}px`;
    if (!panel.hidden) {
      const width = panel.getBoundingClientRect().width;
      panel.style.left = `${Math.max(4,Math.min(point.x,innerWidth-width-4))}px`;
      const below = point.y+r.height+6;
      const available = innerHeight-below-6;
      panel.style.top = `${available >= Math.min(240,innerHeight*.5) ? below : 6}px`;
      panel.style.maxHeight = `${Math.max(40, available >= Math.min(240,innerHeight*.5) ? available : point.y-12)}px`;
    }
  };
  const open = () => {panel.hidden=false;button.setAttribute('aria-expanded','true');layout();};
  button.addEventListener('pointerdown', e => {
    if(e.button!==0)return;
    suppressClick=false;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:{...point},moved:false};
    button.setPointerCapture(e.pointerId);
  });
  button.addEventListener('pointermove', e => {
    if(!drag || drag.id!==e.pointerId)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(Math.hypot(dx,dy)>5)drag.moved=true;
    if(!drag.moved)return;
    point={x:drag.start.x+dx,y:drag.start.y+dy};layout();
  });
  const finish = e => {
    if(!drag || drag.id!==e.pointerId)return;
    suppressClick=drag.moved;
    if(drag.moved)GM_setValue(key,point);
    drag=null;
  };
  button.addEventListener('pointerup',finish);
  button.addEventListener('pointercancel',finish);
  button.addEventListener('click', e => {
    if(suppressClick && e.detail!==0){suppressClick=false;return;}
    panel.hidden=!panel.hidden;
    button.setAttribute('aria-expanded',String(!panel.hidden));layout();
  });
  button.setAttribute('aria-expanded','false');
  window.addEventListener('resize',layout);
  layout();
  return {open, destroy:()=>window.removeEventListener('resize',layout)};
}


function chooseEnglishSRT(items) {
  const matches=items.filter(item => /\.srt\b/i.test(item.label) && /\bEnglish\b|\ben(?:[-_](?:US|GB))?\b|英语|英文/i.test(item.label));
  if(matches.length!==1)throw new Error(matches.length ? '发现多个英文 SRT，请手动选择并导入' : '下载列表中没有找到英文 SRT，请使用手动导入');
  return matches[0];
}
function safeCaptionURL(value, origin) {
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
function captureSRTClick(page, trigger, filename, signal, timeout=15000) {
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
async function getKalturaSRT(signal,progress=()=>{}) {
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

(() => {
  'use strict';
  const defaults={provider:'google',target:'zh-Hans',googleKey:'',azureKey:'',region:'',mode:'bilingual',offset:0,autoImport:true,autoTranslate:false};
  let cfg={...defaults,...GM_getValue('cbs:config',{})};
  // Keep mode independent so another frame saving its config cannot overwrite it.
  const savedMode=GM_getValue('cbs:display-mode',cfg.mode);
  cfg.mode=['bilingual','original','translated'].includes(savedMode)?savedMode:'bilingual';
  let cues=[], video=null, controller=null, enabled=true, source='';
  let importController=null, autoAttempted=false;
  const appearanceKey=`cbs:subtitle-appearance:${location.origin}:${window===window.top?'page':'frame'}`;
  let appearance={transparency:22,position:null,textColor:'#ffffff',backgroundColor:'#000000',...GM_getValue(appearanceKey,{})};
  const cachePrefix='cbs:cache:';
  const digest=async key => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const store={
    async get(key){const row=GM_getValue(cachePrefix+await digest(key),null);return row && Date.now()-row.at<30*86400000?row.text:undefined;},
    async set(key,text){GM_setValue(cachePrefix+await digest(key),{at:Date.now(),text});}
  };
  // Independent cache entries avoid lost updates between frames/tabs.
  const trimCache=() => {
    const keys=GM_listValues().filter(k=>k.startsWith(cachePrefix));
    const rows=keys.map(k=>({k,at:GM_getValue(k,{}).at || 0})).sort((a,b)=>b.at-a.at);
    rows.forEach((r,i)=>{if(i>=5000 || Date.now()-r.at>30*86400000)GM_deleteValue(r.k);});
  };
  trimCache();
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:12px;top:12px;z-index:2147483647';
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>
  *{box-sizing:border-box} :host{font:14px/1.5 system-ui;color:#e9eef9}button,input,select{font:inherit}button{cursor:pointer;background:#2463bb;color:white;border:0;border-radius:6px;padding:6px 10px;margin:3px}button:disabled{opacity:.5;cursor:default}section{position:fixed;background:#172235;padding:14px;border:1px solid #53647b;border-radius:12px;width:340px;max-width:90vw;max-height:80vh;overflow:auto;box-shadow:0 8px 30px #0008}label{display:block;margin:8px 0}input:not([type=checkbox]),select{display:block;width:100%;padding:5px;background:#fff;color:#111;border-radius:4px;border:1px solid #aaa}input[type=color]{height:36px;padding:2px;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.4 monospace}small{color:#b9c9df}h3{margin:0} [hidden]{display:none!important}</style>
  <button id="toggle">双语字幕</button><section hidden id="panel"><h3>Canvas 双语字幕 · v0.3.2</h3>
  <small>可自动获取当前视频的英文 SRT；开启自动翻译后会发送给所选服务。</small>
  <button id="inspect">检测播放器</button><label>绑定视频<select id="video"></select></label><small id="playerSummary"></small><details><summary>高级诊断（排查时展开）</summary><pre id="diagnostic"></pre></details>
  <button id="autoGet">自动获取并翻译</button><label><input id="autoImport" type="checkbox"> 打开视频后自动获取英文字幕</label><label><input id="autoTranslate" type="checkbox"> 获取后自动翻译（可能按量计费）</label><small id="subtitleSource">尚未导入字幕</small><label>手动导入英文 SRT<input id="file" type="file" accept=".srt,text/plain,application/x-subrip"></label>
  <label>翻译服务<select id="provider"></select></label>
  <label>API Key（本地保存）<input id="key" type="password" autocomplete="off"></label>
  <label id="regionLabel">Azure 区域（按资源配置填写）<input id="region" placeholder="例如 eastus；全局单服务资源可留空"></label>
  <label>目标语言<select id="target"><option value="zh-Hans">简体中文</option><option value="zh-Hant">繁體中文</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
  <button id="save">保存设置</button><button id="forget">删除已存密钥</button>
  <p><small>翻译会将英文字幕发送给所选服务，可能按量计费。密钥保存在 Tampermonkey 存储中，并非系统钥匙串。</small></p>
  <button id="translate">批量翻译</button><button id="cancel" disabled>取消</button><button id="clear">清空翻译缓存</button>
  <label>显示模式<select id="mode"><option value="bilingual">双语</option><option value="original">仅英文</option><option value="translated">仅译文</option></select></label>
  <label>字幕延迟（秒，正数让字幕晚出现）<input id="offset" type="number" step="0.1" value="0"></label>
  <label>字幕文字颜色<input id="textColor" type="color" value="#ffffff"></label>
  <label>字幕背景颜色<input id="backgroundColor" type="color" value="#000000"></label>
  <label>字幕背景透明度：<output id="transparencyValue"></output><input id="transparency" type="range" min="0" max="100" step="1"></label>
  <small>0% 为不透明背景，100% 为完全透明；文字保持不透明。拖动显示中的字幕可调整位置，松开后自动保存。</small>
  <button id="resetSubtitlePosition">恢复字幕默认位置</button>
  <label><input id="enabled" type="checkbox" checked> 显示字幕</label>
  <p id="status" role="status" aria-live="polite">尚未导入字幕</p></section>`;
  document.documentElement.append(host);
  const $=id=>root.getElementById(id);
  const status=text=>{$('status').textContent=text;};
  for(const p of Object.values(providers))$('provider').add(new Option(p.name,p.id));
  const loadFields=()=>{
    $('provider').value=cfg.provider;$('target').value=cfg.target;$('region').value=cfg.region;
    $('key').value=cfg.provider==='google'?cfg.googleKey:cfg.azureKey;
    $('autoImport').checked=cfg.autoImport;$('autoTranslate').checked=cfg.autoTranslate;
    $('mode').value=cfg.mode;$('offset').value=cfg.offset;$('regionLabel').hidden=cfg.provider!=='azure';
  };
  loadFields();
  $('mode').onchange=()=>{
    cfg.mode=$('mode').value;
    GM_setValue('cbs:display-mode',cfg.mode);
  };
  for(const [id,fallback] of [['textColor','#ffffff'],['backgroundColor','#000000']]){
    appearance[id]=subtitleColor(appearance[id],fallback);
    $(id).value=appearance[id];
    $(id).oninput=()=>{appearance[id]=$(id).value;};
    $(id).onchange=()=>{appearance[id]=$(id).value;GM_setValue(appearanceKey,appearance);};
  }
  $('transparency').value=100*(1-subtitleAlpha(appearance.transparency));
  const updateTransparency=()=>{
    appearance.transparency=Number($('transparency').value);
    $('transparencyValue').textContent=`${appearance.transparency}%`;
  };
  updateTransparency();
  $('transparency').oninput=updateTransparency;
  $('transparency').onchange=()=>{updateTransparency();GM_setValue(appearanceKey,appearance);};
  const readFields=()=>({...cfg,provider:$('provider').value,target:$('target').value,region:$('region').value.trim(),
    [ $('provider').value==='google'?'googleKey':'azureKey' ]:$('key').value.trim(),
    autoImport:$('autoImport').checked,autoTranslate:$('autoTranslate').checked,mode:$('mode').value,offset:Number($('offset').value)||0});
  const invalidate=()=>{cues=cues.map(({translation,...cue})=>cue);};
  $('provider').onchange=()=>{cfg= {...cfg,provider:$('provider').value};$('key').value=cfg.provider==='google'?cfg.googleKey:cfg.azureKey;$('regionLabel').hidden=cfg.provider!=='azure';invalidate();};
  $('target').onchange=invalidate;
  $('save').onclick=()=>{cfg=readFields();GM_setValue('cbs:config',cfg);status('设置已保存到 Tampermonkey 本地存储');};
  $('forget').onclick=()=>{cfg.googleKey='';cfg.azureKey='';$('key').value='';GM_setValue('cbs:config',cfg);status('已删除两个服务的已存密钥');};
  const floating=floatingUI(host,$('toggle'),$('panel'));
  GM_registerMenuCommand('双语字幕设置 / 播放器诊断',()=>{floating.open();scan();});
  let videoList=[];
  const scan=()=>{
    videoList=discover().videos;
    $('video').replaceChildren();
    $('video').add(new Option('请选择视频',''));
    videoList.forEach((v,i)=>$('video').add(new Option(`视频 ${i+1} · ${Math.round(v.duration)||'?'} 秒`,String(i))));
    video=selectVideo(videoList,video);
    $('video').value=video?String(videoList.indexOf(video)):'';
    $('playerSummary').textContent=video ? '已连接课程视频，可导入字幕。' : '请先播放视频，再检测并选择已加载的视频。';
    $('diagnostic').textContent=JSON.stringify(inspectPlayer(),null,2);
    if(!videoList.length)$('diagnostic').textContent+='\n本帧没有 video。若列出跨域 iframe，请在播放器帧中使用脚本；不能据此断言无字幕。';
  };
  $('inspect').onclick=scan;
  $('video').onchange=()=>{video=$('video').value===''?null:videoList[Number($('video').value)];};
  $('file').onchange=async()=>{
    scan();
    const file=$('file').files[0];if(!file)return;
    try{
      if(file.size>5*1024*1024)throw new Error('SRT 超过 5 MB 限制');
      const buffer=await file.arrayBuffer();
      const parsed=parseSRT(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
      autoAttempted=true;$('subtitleSource').textContent=`手动导入：${file.name}（${parsed.length} 段）`;cues=parsed;source=video?.currentSrc || '';status(`已解析 ${cues.length} 段，${cues.at(-1).end.toFixed(3)} 秒；可先用仅英文模式验证同步`);
    }catch(e){status(e.message);}
  };
  const busy=value=>{
    for(const id of ['file','provider','key','region','target','save','forget','translate','clear','autoGet','autoImport','autoTranslate'])$(id).disabled=value;
    $('cancel').disabled=!value;
  };
  const runTranslation=async()=>{
    scan();
    if(!video)return status('尚未找到已加载的课程视频；请先播放视频，再检测并选择视频');
    if(!cues.length)return status('请先导入 SRT');
    cfg=readFields();const snapshot={...cfg,key:cfg.provider==='google'?cfg.googleKey:cfg.azureKey};
    controller=new AbortController();busy(true);
    try{
      cues=await translateCues(cues,snapshot,store,gmPost,controller.signal,(done,total)=>status(`翻译 / 缓存：${done} / ${total} 条独立文本`));
      status(`完成 ${cues.length} 段；再次导入相同字幕并翻译会使用缓存`);trimCache();
    }catch(e){status(e.message);}finally{controller=null;busy(false);}
  };
  $('translate').onclick=runTranslation;
  const autoGet=async(translate=false)=>{
    if(importController || controller)return;
    scan();if(!video)return status('请先加载视频，再自动获取字幕');
    autoAttempted=true;
    const selectedVideo=video, selectedSource=video.currentSrc;
    const pending=new AbortController();importController=pending;busy(true);
    const timeout=setTimeout(()=>pending.abort(),30000);
    let imported=false;
    try{
      const result=await getKalturaSRT(pending.signal,status);
      if(pending.signal.aborted || video!==selectedVideo || !video.isConnected || video.currentSrc!==selectedSource)throw new Error('视频已切换，请重新获取字幕');
      cues=result.cues;source=video.currentSrc;imported=true;
      $('subtitleSource').textContent=`自动导入：${result.name}（${cues.length} 段）`;
      status(`已自动导入 ${cues.length} 段英文字幕`);
    }catch(e){status(`${e.message}；仍可手动导入 SRT`);}
    finally{clearTimeout(timeout);importController=null;busy(false);}
    if(imported && translate)await runTranslation();
  };
  $('autoGet').onclick=()=>autoGet(true);
  for(const id of ['autoImport','autoTranslate'])$(id).onchange=()=>{
    cfg=readFields();GM_setValue('cbs:config',cfg);
    if(!cfg.autoImport)importController?.abort();
    if(cfg.autoImport && !cues.length)autoAttempted=false;
  };
  $('cancel').onclick=()=>{importController?.abort();controller?.abort();};
  $('clear').onclick=()=>{for(const key of GM_listValues())if(key.startsWith(cachePrefix))GM_deleteValue(key);status('已清空翻译缓存（当前显示保留）');};
  $('enabled').onchange=()=>{enabled=$('enabled').checked;};
  const stop=mountRenderer(()=>({video,cues,mode:$('mode').value,offset:Number($('offset').value)||0,enabled,...appearance}),position=>{
    appearance.position=position;GM_setValue(appearanceKey,appearance);
  });
  $('resetSubtitlePosition').onclick=()=>{
    stop.cancelDrag();appearance.position=null;GM_setValue(appearanceKey,appearance);
    status('字幕已恢复默认底部位置');
  };
  // Watch SPA replacement without silently binding a second video or retaining captions for another source.
  const monitor=setInterval(()=>{
    if(!video || video.readyState===0){
      const candidate=selectVideo(discover().videos,video);
      if(candidate && candidate!==video){video=candidate;source=video.currentSrc;scan();}
    }
    if(video && (!video.isConnected || (source && video.currentSrc && source!==video.currentSrc))){
      importController?.abort();controller?.abort();cues=[];video=null;source='';autoAttempted=false;scan();status('播放器或视频源已更换，请重新导入对应 SRT');
    }
    if(video && !source && cues.length)source=video.currentSrc;
    if(video && cfg.autoImport && !autoAttempted && !cues.length && !importController && !controller)void autoGet(cfg.autoTranslate);
  },1000);
  window.addEventListener('pagehide',()=>{importController?.abort();controller?.abort();stop();floating.destroy();clearInterval(monitor);host.remove();},{once:true});
  scan();
})();

})();
