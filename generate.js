// Uso: node generate.js  -> escribe public/feed.xml y public/report.json
const fs = require('fs');
const { buildFeed } = require('./feed-core');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
(async () => {
  const t = Date.now();
  const { xml, report } = await buildFeed(cfg, m => console.log(m));
  report.seconds = Math.round((Date.now() - t) / 1000);
  // Corte de seguridad: si el feed viene vacío o cae >30% vs. la corrida anterior, no se publica.
  let prev = null;
  for (const f of ['/public/report.json', '/report-diario.json']) { try { prev = JSON.parse(fs.readFileSync(__dirname + f, 'utf8')); break; } catch {} }
  if (report.skus_in_feed < 500 || (prev && report.skus_in_feed < prev.skus_in_feed * 0.7)) {
    console.error('ABORT: caída anormal de SKUs', report, prev && prev.skus_in_feed); process.exit(1);
  }
  fs.mkdirSync(__dirname + '/public', { recursive: true });
  fs.writeFileSync(__dirname + '/public/feed.xml', xml);
  fs.writeFileSync(__dirname + '/public/report.json', JSON.stringify(report, null, 2));
  console.log(report);
})().catch(e => { console.error(e); process.exit(1); });
