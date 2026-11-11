export function parseSRT(input) {
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
export function activeCues(cues, time) {
  return cues.filter(c => c.start <= time && time < c.end);
}
export function batches(texts, maxItems = 50, maxChars = 4500) {
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
