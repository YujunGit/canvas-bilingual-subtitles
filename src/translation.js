import {providers} from './providers.js';
import {batches} from './subtitles.js';
export function cacheKey(provider, cfg, text) {
  return JSON.stringify([provider.id, provider.version, 'en', provider.language(cfg.target), text]);
}
export async function translateCues(cues, cfg, store, post, signal, progress = () => {}) {
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
