// Position is local to each origin/frame role; the panel stays inside the viewport.
export function floatingUI(host, button, panel) {
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
