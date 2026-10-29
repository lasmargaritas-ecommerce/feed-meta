// Generador de feed de catálogo Meta desde VTEX (API pública de búsqueda).
// Funciona en Node 18+ y en el navegador (misma lógica).
const DEFAULTS = {
  base: 'https://www.lasmargaritas.com.ar',
  currency: 'ARS',
  minStock: 2,            // en stock solo si hay >= minStock unidades
  unlimitedQty: 99999,    // VTEX devuelve 99999 para stock ilimitado
  excludeSkus: [],        // SKUs ilimitados (u otros) que NO se pautan
  pageSize: 50,
  maxWindow: 2500,        // límite de paginación de la API de búsqueda
  concurrency: 3,
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const stripHtml = s => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const money = (v, cur) => `${Number(v).toFixed(2)} ${cur}`;
const validGtin = e => /^\d{8}$|^\d{12,14}$/.test(String(e || '').trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      const total = (r.headers.get('resources') || '').split('/')[1];
      return { data: await r.json(), total: total ? Number(total) : null };
    } catch (e) { if (i === tries - 1) throw e; await sleep(800 * (i + 1)); }
  }
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Recorre el árbol de categorías; si una categoría supera 2.500 productos baja a sus hijas.
async function collectProducts(cfg, log) {
  const { data: tree } = await getJson(`${cfg.base}/api/catalog_system/pub/category/tree/5`);
  const products = new Map();
  const searchUrl = (path, from, to) => `${cfg.base}/api/catalog_system/pub/products/search?fq=C:${path}&_from=${from}&_to=${to}`;
  async function walk(node, path) {
    const p = `${path}${node.id}/`;
    const { total } = await getJson(searchUrl(p, 0, 0));
    if (!total) return;
    if (total > cfg.maxWindow && node.children?.length) {
      for (const ch of node.children) await walk(ch, p);
      return; // productos asignados solo al padre >2500: caso raro, se reporta abajo
    }
    const pages = [];
    for (let f = 0; f < Math.min(total, cfg.maxWindow); f += cfg.pageSize) pages.push(f);
    await pool(pages, cfg.concurrency, async f => {
      const { data } = await getJson(searchUrl(p, f, f + cfg.pageSize - 1));
      for (const pr of data) products.set(pr.productId, pr);
    });
    log && log(`cat ${p} -> ${total} (acum ${products.size})`);
  }
  for (const node of tree) await walk(node, '/');
  return [...products.values()];
}

const band = (v, cuts, labels) => labels[cuts.findIndex(c => v <= c)] ?? labels[labels.length - 1];

function toItems(products, cfg) {
  const items = [];
  for (const p of products) {
    const multi = p.items.length > 1;
    const catPath = (p.categories?.[0] || '').split('/').filter(Boolean);
    for (const it of p.items) {
      const seller = it.sellers.find(s => s.sellerDefault) || it.sellers.find(s => s.sellerId === '1') || it.sellers[0];
      if (!seller) continue;
      const co = seller.commertialOffer;
      const qty = co.AvailableQuantity || 0;
      const unlimited = qty >= cfg.unlimitedQty;
      const excluded = cfg.excludeSkus.includes(String(it.itemId));
      const inStock = co.IsAvailable && qty >= cfg.minStock && co.Price > 0 && !excluded;
      const list = co.ListPrice > co.Price ? co.ListPrice : co.Price;
      const disc = list > 0 ? Math.round((1 - co.Price / list) * 100) : 0;
      const imgs = (it.images || []).map(i => i.imageUrl).filter(Boolean);
      let title = multi && it.name && !p.productName.toLowerCase().includes(it.name.toLowerCase()) ? `${p.productName} - ${it.name}` : p.productName;
      items.push({
        id: String(it.itemId),
        item_group_id: String(p.productId),
        title: title.slice(0, 200),
        description: (stripHtml(p.description) || title).slice(0, 9999),
        availability: inStock ? 'in stock' : 'out of stock',
        condition: 'new',
        price: co.Price > 0 ? money(list, cfg.currency) : null,
        sale_price: co.Price > 0 && co.Price < list ? money(co.Price, cfg.currency) : null,
        link: `${cfg.base}/${p.linkText}/p?skuId=${it.itemId}`,
        image_link: imgs[0] || null,
        additional_image_link: imgs.slice(1, 10),
        brand: p.brand,
        gtin: validGtin(it.ean) ? it.ean.trim() : null,
        mpn: it.referenceId?.[0]?.Value || null,
        product_type: catPath.join(' > '),
        custom_label_0: p.brand,
        custom_label_1: catPath[0] || '',
        custom_label_2: disc <= 0 ? 'sin descuento' : band(disc, [15, 30, 50], ['desc 1-15', 'desc 16-30', 'desc 31-50', 'desc 51+']),
        custom_label_3: unlimited ? 'stock ilimitado' : qty <= 0 ? 'sin stock' : qty < cfg.minStock ? 'bajo minimo' : qty < 100 ? 'stock medio' : 'stock alto',
        custom_label_4: it.isKit || /combo|kit|pack/i.test(p.productName) ? 'combo/kit' : 'individual',
        _qty: qty, _unlimited: unlimited, _price: co.Price,
      });
    }
  }
  return items;
}

function toXml(items, cfg) {
  const tag = (k, v) => v === null || v === undefined || v === '' ? '' : `<g:${k}>${esc(v)}</g:${k}>`;
  const rows = items.filter(i => i.price && i.image_link).map(i => '<item>' +
    tag('id', i.id) + tag('item_group_id', i.item_group_id) + tag('title', i.title) + tag('description', i.description) +
    tag('availability', i.availability) + tag('condition', i.condition) + tag('price', i.price) + tag('sale_price', i.sale_price) +
    tag('link', i.link) + tag('image_link', i.image_link) + i.additional_image_link.map(u => tag('additional_image_link', u)).join('') +
    tag('brand', i.brand) + tag('gtin', i.gtin) + tag('mpn', i.mpn) + tag('product_type', i.product_type) +
    ['custom_label_0','custom_label_1','custom_label_2','custom_label_3','custom_label_4'].map(k => tag(k, i[k])).join('') +
    '</item>');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>` +
    `<title>Las Margaritas</title><link>${esc(cfg.base)}</link><description>Feed de catálogo Meta generado desde VTEX</description>` +
    rows.join('\n') + `</channel></rss>`;
}

function report(products, items) {
  const c = (f) => items.filter(f).length;
  return {
    generated_at: new Date().toISOString(),
    products: products.length,
    skus_total: items.length,
    skus_in_feed: c(i => i.price && i.image_link),
    in_stock: c(i => i.availability === 'in stock'),
    out_of_stock: c(i => i.availability === 'out of stock'),
    unlimited_stock: c(i => i._unlimited),
    excluded_no_price: c(i => !i.price),
    excluded_no_image: c(i => !i.image_link),
    without_gtin: c(i => !i.gtin),
    multi_variant_products: new Set(items.filter((i, k, a) => a.filter(x => x.item_group_id === i.item_group_id).length > 1).map(i => i.item_group_id)).size,
    links_not_main_domain: c(i => !i.link.startsWith('https://www.lasmargaritas.com.ar/')),
  };
}

async function buildFeed(opts = {}, log) {
  const cfg = { ...DEFAULTS, ...opts };
  const products = await collectProducts(cfg, log);
  const items = toItems(products, cfg);
  return { xml: toXml(items, cfg), report: report(products, items), items };
}

if (typeof module !== 'undefined') module.exports = { buildFeed, DEFAULTS };
