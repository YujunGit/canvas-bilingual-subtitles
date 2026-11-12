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
