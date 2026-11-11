export function decodeEntities(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return ({amp:'&',lt:'<',gt:'>',quot:'"',apos: "'",nbsp:' '})[entity.toLowerCase()];
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : match;
  });
}
export const providers = {
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
export function gmPost(url, body, headers, signal) {
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
