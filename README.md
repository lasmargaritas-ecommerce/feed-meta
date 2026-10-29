# Feed de catálogo Meta — Las Margaritas (VTEX)

Genera `public/feed.xml` (formato Meta/Google RSS) desde la API pública de búsqueda de VTEX.

- Solo productos activos y visibles (la API pública no devuelve el resto).
- Todas las variantes, agrupadas con `item_group_id` = productId. `id` = skuId (igual que el XML actual).
- Disponibilidad: `in stock` si IsAvailable y cantidad >= `minStock` (config.json) y no está en `excludeSkus`.
- custom_label_0 marca · 1 categoría · 2 rango de descuento · 3 rango de stock · 4 combo/kit vs individual.
- Corte de seguridad: no publica si el feed baja de 500 SKUs o cae >30% vs. la corrida anterior.

Uso local: `node generate.js` (Node 18+). Automático: `.github/workflows/feed.yml` (cada hora → GitHub Pages).

Prueba 29/10/2026: 2.560 productos, 5.332 SKUs (4.114 in stock / 1.218 out of stock), 256 productos con variantes, 0 links fuera de lasmargaritas.com.ar, ~30 s, 12 MB.
Nota: la API pública devuelve el stock en rangos (0, 1 = 1–9, 10 = 10–99, 100 = 100+, 99999 = ilimitado). Decisión 29/10: minStock = 10 → solo se pauta desde el rango 10–99 (el rango 1–9 va out of stock, etiqueta "bajo minimo").
