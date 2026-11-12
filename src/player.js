import {activeCues} from './subtitles.js';
// Keep a user-selected loaded video; replace an empty preloader only when
// exactly one media element has metadata. Never guess between two loaded streams.
export function selectVideo(videos, current) {
  const loaded = videos.filter(v => v.isConnected && v.readyState >= 1 &&
    (Number.isFinite(v.duration) ? v.duration > 0 : v.duration === Infinity));
  if (loaded.includes(current)) return current;
  if (loaded.length === 1) return loaded[0];
  return null;
}

// Discover only this frame and open shadow roots. Cross-origin frames run their own script.
export function discover(root = document) {
  const videos = [], frames = [];
  const visit = r => {
    videos.push(...r.querySelectorAll('video'));
    frames.push(...r.querySelectorAll('iframe'));
    for (const node of r.querySelectorAll('*')) if (node.shadowRoot) visit(node.shadowRoot);
  };
  visit(root); return {videos,frames};
}
export function inspectPlayer() {
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
export function cleanSubtitleLines(text = '') {
  return text.replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n')
    .map(line => line.trim()).filter(Boolean).join('\n');
}
const clampSubtitle = (value, max) => Math.min(max, Math.max(0, value));
export function subtitleColor(value, fallback = '#ffffff') {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}
export function subtitleBackground(color, transparency) {
  const hex = subtitleColor(color, '#000000');
  const rgb = [1,3,5].map(start => parseInt(hex.slice(start,start+2),16));
  return `rgba(${rgb.join(',')},${subtitleAlpha(transparency)})`;
}
export function subtitleAlpha(transparency) {
  const value = Number(transparency);
  return 1 - clampSubtitle(Number.isFinite(value) ? value : 22, 100) / 100;
}
// Store fractions of available travel, keeping the complete box inside the video.
export function subtitlePlacement(rect, width, height, position) {
  const dx = Math.max(0, rect.width - width), dy = Math.max(0, rect.height - height);
  const custom = Number.isFinite(position?.x) && Number.isFinite(position?.y);
  return {left:rect.left + (custom ? clampSubtitle(position.x, 1) * dx : dx / 2),
    top:rect.top + (custom ? clampSubtitle(position.y, 1) * dy : Math.max(0, dy - Math.max(48, rect.height * .12)))};
}
export function mountRenderer(getState, onPositionChange = () => {}) {
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
