const { json } = require('./naver-client');

const GOOD_WORDS = ['surge', 'jump', 'beat', 'growth', 'record', 'upgrade', 'buy', 'profit', 'strong', 'rally', 'demand', 'partnership', '突破', '上涨', '增长', '利好', '超预期', '上调', '买入', '盈利', '订单', '强劲', '涨'];
const BAD_WORDS = ['fall', 'drop', 'miss', 'weak', 'downgrade', 'sell', 'loss', 'risk', 'probe', 'ban', 'tariff', 'slump', '下跌', '下降', '利空', '不及预期', '下调', '卖出', '亏损', '风险', '调查', '禁令', '关税', '跌'];

function decodeEntities(text = '') {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(text = '') {
  return decodeEntities(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function classify(title = '', summary = '') {
  const text = `${title} ${summary}`.toLowerCase();
  const good = GOOD_WORDS.reduce((count, word) => count + (text.includes(word.toLowerCase()) ? 1 : 0), 0);
  const bad = BAD_WORDS.reduce((count, word) => count + (text.includes(word.toLowerCase()) ? 1 : 0), 0);
  if (good > bad) return { tone: '利好', score: good - bad, reason: '标题/摘要包含偏积极关键词' };
  if (bad > good) return { tone: '利空', score: bad - good, reason: '标题/摘要包含偏消极关键词' };
  return { tone: '中性', score: 0, reason: '未识别出明显利好或利空关键词' };
}

function parseRss(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks.slice(0, 12)) {
    const get = tag => decodeEntities((block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [])[1] || '');
    const title = stripTags(get('title'));
    const summary = stripTags(get('description'));
    const link = stripTags(get('link'));
    const publishedAt = stripTags(get('pubDate'));
    const source = stripTags(get('source')) || 'Google News';
    if (!title) continue;
    items.push({ title, summary, link, publishedAt, source, ...classify(title, summary) });
  }
  return items;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  const symbol = String(event.queryStringParameters?.symbol || '').trim();
  const name = String(event.queryStringParameters?.name || symbol).trim();
  if (!symbol && !name) return json(400, { error: 'Missing symbol or name' });

  const queries = [
    `${name} 股票`,
    `${name} ${symbol}`,
    `${name} stock`,
    symbol
  ];
  try {
    let news = [];
    for (const item of queries) {
      const query = encodeURIComponent(item);
      const url = `https://news.google.com/rss/search?q=${query}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
      const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 KoreaTick/1.0' } });
      if (!response.ok) continue;
      const xml = await response.text();
      news = parseRss(xml);
      if (news.length) break;
    }
    return json(200, { source: 'Google News RSS', symbol, name, news, serverTime: Date.now(), note: '利好/利空为关键词初判，仅供快速筛选。' });
  } catch (error) {
    return json(502, { error: error?.message || '新闻请求失败', news: [], serverTime: Date.now() });
  }
};
