#!/usr/bin/env node
/**
 * Đặt giá theo nước cho MỌI sản phẩm mua một lần và gói đăng ký của 1 app trên Google Play.
 * Giá gốc = giá US hiện tại của từng sản phẩm / base plan; giá nước X = giá US / hệ số của X (bảng RULES bên dưới),
 * quy sang tiền địa phương bằng pricing:convertRegionPrices (tỷ giá và cách làm tròn của Google Play).
 * Chỉ đổi các nước trong RULES mà sản phẩm đang bán; mọi nước khác giữ nguyên.
 *
 *   node scripts/play-pricing.js com.muchie.ai.chat            # xem trước, không sửa gì (ghi bảng ra backups/*.csv)
 *   node scripts/play-pricing.js com.muchie.ai.chat --apply    # áp dụng
 *   node scripts/play-pricing.js com.muchie.ai.chat --set-us coin_pack_29.99=29.99 [--apply]
 *     → đặt lại giá US của sản phẩm đó trước, rồi tính các nước trong RULES theo giá US mới.
 *   node scripts/play-pricing.js com.muchie.ai.chat --us-percent -15 [--apply]
 *     → CHỈ đổi giá US: giá US hiện tại × (1 + n/100), làm tròn tới cent; mọi nước khác giữ nguyên (bỏ qua RULES).
 *   node scripts/play-pricing.js com.muchie.ai.chat --only FR,DE [--apply]
 *     → chỉ đổi các nước này (phải có trong RULES); các nước khác trong RULES giữ nguyên dù tỷ giá đã đổi.
 *
 * --apply: lưu bản sao từng sản phẩm vào backups/ trước khi sửa, sửa xong đọc lại để xác nhận.
 * Gói đăng ký: giá mới chỉ áp dụng cho người đăng ký mới; người đang đăng ký giữ giá cũ.
 * Cần file key service account ở secrets/play-service-account.json.
 */
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require(path.join(__dirname, '../backend/node_modules/google-auth-library'));

/** Hệ số chia theo nước (mã ISO 3166-1). */
const RULES = {
  MX: 1.3, FR: 1.3,
  GE: 1.5, HU: 1.5, JO: 1.5, PH: 1.5, SA: 1.5, TH: 1.5, TR: 1.5, VN: 1.5,
  BR: 2, CO: 2, EG: 2, MY: 2, PK: 2, UA: 2, UZ: 2,
  AR: 2.5, IN: 2.5, ID: 2.5, IQ: 2.5, MA: 2.5, PE: 2.5,
  BD: 3,
};

const args = process.argv.slice(2);
const apply = args.includes('--apply');
/** --set-us <productId>=<giá USD>: đặt lại giá US (gốc) của sản phẩm, có thể lặp lại. */
const usOverrides = new Map();
args.forEach((a, i) => {
  if (a !== '--set-us') return;
  const [id, price] = String(args[i + 1] ?? '').split('=');
  if (!id || !(Number(price) > 0)) {
    console.error('--set-us cần dạng <productId>=<giá USD>, ví dụ coin_pack_29.99=29.99');
    process.exit(1);
  }
  usOverrides.set(id, Number(price));
});
/** --us-percent <n>: chỉ đổi giá US theo phần trăm (âm = giảm), không đụng nước nào khác. */
const usPercentArg = args.includes('--us-percent') ? Number(args[args.indexOf('--us-percent') + 1]) : null;
if (usPercentArg !== null && !(Number.isFinite(usPercentArg) && usPercentArg > -100)) {
  console.error('--us-percent cần một số > -100, ví dụ --us-percent -15');
  process.exit(1);
}
/** --only <mã nước,...>: chỉ đổi các nước này. */
const onlyArg = args[args.indexOf('--only') + 1];
const only = args.includes('--only') ? new Set(String(onlyArg ?? '').toUpperCase().split(',').filter(Boolean)) : null;
if (only) {
  const unknownRegions = [...only].filter((r) => !RULES[r]);
  if (!only.size || unknownRegions.length) {
    console.error(`--only: nước không có trong RULES: ${unknownRegions.join(', ') || '(trống)'}`);
    process.exit(1);
  }
}
const [pkg] = args.filter((a, i) => !a.startsWith('--') && !['--set-us', '--only', '--us-percent'].includes(args[i - 1]));
if (!pkg) {
  console.error('Cách dùng: node scripts/play-pricing.js <packageName> [--apply]');
  process.exit(1);
}

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const ROOT = path.join(__dirname, '..');
const auth = new GoogleAuth({
  keyFile: path.join(ROOT, 'secrets/play-service-account.json'),
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const regionName = new Intl.DisplayNames(['vi'], { type: 'region' });

/** Money {currencyCode, units, nanos} <-> số thực. */
const toMoney = (currencyCode, amount) => {
  const units = Math.floor(amount);
  return { currencyCode, units: String(units), nanos: Math.round((amount - units) * 1e9) };
};
const fromMoney = (m) => Number(m?.units ?? 0) + Number(m?.nanos ?? 0) / 1e9;
const fmt = (m) => {
  if (!m?.currencyCode) return '—';
  const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currencyCode }).resolvedOptions()
    .maximumFractionDigits === 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currencyCode, maximumFractionDigits: whole ? 0 : 2 })
    .format(fromMoney(m));
};
const samePrice = (a, b) => a?.currencyCode === b?.currencyCode && Math.abs(fromMoney(a) - fromMoney(b)) < 1e-9;

async function call(client, method, url, data, attempt = 1) {
  try {
    return (await client.request({ method, url, data })).data;
  } catch (e) {
    // Lỗi tạm thời của Google (429/5xx): đợi rồi thử lại tối đa 5 lần.
    const status = e?.response?.status;
    if ((status === 429 || status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
      return call(client, method, url, data, attempt + 1);
    }
    const err = e?.response?.data?.error;
    // Lỗi 404 của Google trả trang HTML dài; chỉ giữ thông điệp ngắn.
    const message = err?.message ?? (typeof e?.response?.data === 'string' ? `${e.response.status} ${e.response.statusText}` : e.message);
    const error = new Error(message);
    error.status = err?.code ?? e?.response?.status;
    throw error;
  }
}

async function listAll(client, url, key) {
  const out = [];
  let pageToken;
  do {
    const u = new URL(url);
    u.searchParams.set('pageSize', '1000');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const res = await call(client, 'GET', u.toString());
    out.push(...(res[key] ?? []));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

/** Giá quy đổi của Google Play cho 1 mức giá USD (cache theo mức giá). */
const conversions = new Map();
async function convert(client, usd) {
  const key = usd.toFixed(6);
  if (!conversions.has(key)) {
    conversions.set(key, await call(client, 'POST', `${API}/applications/${pkg}/pricing:convertRegionPrices`, {
      price: toMoney('USD', usd),
    }));
  }
  return conversions.get(key);
}

/**
 * Các "đơn vị giá" của 1 sản phẩm: mỗi purchase option (mua một lần) hoặc base plan (đăng ký) có danh sách giá
 * theo nước riêng. configs trỏ thẳng vào object của sản phẩm nên sửa giá ở đây là sửa bản sao sẽ gửi đi.
 */
const UNITS = {
  onetime: (p) => (p.purchaseOptions ?? []).map((o) => ({
    id: o.purchaseOptionId, state: o.state, configs: o.regionalPricingAndAvailabilityConfigs ?? [],
  })),
  subscription: (p) => (p.basePlans ?? []).map((b) => ({
    id: b.basePlanId, state: b.state, configs: b.regionalConfigs ?? [],
  })),
};

/** Tính thay đổi cho 1 sản phẩm; sửa trực tiếp giá trong `product` (bản sao) và trả về danh sách dòng. */
async function plan(client, kind, product) {
  const rows = [];
  for (const unit of UNITS[kind](product)) {
    const usCfg = unit.configs.find((c) => c.regionCode === 'US');
    if (!usCfg?.price || usCfg.price.currencyCode !== 'USD' || !fromMoney(usCfg.price)) {
      rows.push({ unit, skip: 'không có giá US, bỏ qua' });
      continue;
    }
    const override = usOverrides.get(product.productId);
    if (override !== undefined) {
      const after = toMoney('USD', override);
      rows.push({ unit, region: 'US', divisor: 1, us: after, usd: override, before: usCfg.price, after,
        changed: !samePrice(usCfg.price, after) });
      usCfg.price = after;
    }
    if (usPercentArg !== null) {
      // Chỉ đổi giá US; các nước khác (kể cả nước trong RULES) giữ nguyên.
      const usd = Math.round(fromMoney(usCfg.price) * (1 + usPercentArg / 100) * 100) / 100;
      const after = toMoney('USD', usd);
      rows.push({ unit, region: 'US', divisor: 1, us: usCfg.price, usd, before: usCfg.price, after,
        changed: !samePrice(usCfg.price, after) });
      usCfg.price = after;
      continue;
    }
    const us = usCfg.price;
    for (const [region, divisor] of Object.entries(RULES).filter(([r]) => !only || only.has(r))) {
      const cfg = unit.configs.find((c) => c.regionCode === region);
      if (!cfg?.price) {
        rows.push({ unit, region, divisor, skip: 'chưa bán ở nước này' });
        continue;
      }
      const usd = fromMoney(us) / divisor;
      const converted = (await convert(client, usd)).convertedRegionPrices?.[region]?.price;
      if (!converted) {
        rows.push({ unit, region, divisor, skip: 'Google không quy đổi được' });
        continue;
      }
      if (converted.currencyCode !== cfg.price.currencyCode) {
        rows.push({ unit, region, divisor, skip: `tiền tệ khác (${cfg.price.currencyCode} ≠ ${converted.currencyCode})` });
        continue;
      }
      rows.push({ unit, region, divisor, us, usd, before: cfg.price, after: converted, changed: !samePrice(cfg.price, converted) });
      cfg.price = converted;
    }
  }
  return rows;
}

async function main() {
  const client = await auth.getClient();
  console.log(`App: ${pkg}   ${apply ? 'ÁP DỤNG' : 'XEM TRƯỚC (không sửa gì)'}`
    + `${usPercentArg !== null ? `   CHỈ ĐỔI GIÁ US ${usPercentArg > 0 ? '+' : ''}${usPercentArg}%` : ''}\n`);

  const products = [
    ...(await listAll(client, `${API}/applications/${pkg}/oneTimeProducts`, 'oneTimeProducts')).map((p) => ({ kind: 'onetime', p })),
    ...(await listAll(client, `${API}/applications/${pkg}/subscriptions`, 'subscriptions')).map((p) => ({ kind: 'subscription', p })),
  ];
  console.log(`Tìm thấy ${products.filter((x) => x.kind === 'onetime').length} sản phẩm mua một lần, `
    + `${products.filter((x) => x.kind === 'subscription').length} gói đăng ký.\n`);

  const csv = [['loại', 'sản phẩm', 'option/base plan', 'trạng thái', 'nước', 'hệ số', 'giá US', 'USD sau chia', 'giá hiện tại', 'giá mới', 'ghi chú']];
  const planned = [];
  const unknown = [...usOverrides.keys()].filter((id) => !products.some((x) => x.p.productId === id));
  if (unknown.length) throw new Error(`--set-us: không tìm thấy sản phẩm ${unknown.join(', ')}`);

  for (const { kind, p } of products) {
    const next = structuredClone(p);
    const rows = await plan(client, kind, next);
    planned.push({ kind, original: p, next, rows });

    const label = kind === 'onetime' ? 'Mua một lần' : 'Đăng ký';
    console.log(`■ ${label}: ${p.productId}`);
    for (const r of rows) {
      const unit = `${r.unit.id}${r.unit.state && r.unit.state !== 'ACTIVE' ? ` [${r.unit.state}]` : ''}`;
      if (!r.region) {
        console.log(`   ${unit}: ${r.skip}`);
        csv.push([label, p.productId, r.unit.id, r.unit.state ?? '', '', '', '', '', '', '', r.skip]);
        continue;
      }
      const note = r.skip ?? (r.changed ? (fromMoney(r.after) > fromMoney(r.before) ? 'TĂNG GIÁ' : '') : 'giữ nguyên');
      if (!r.skip) {
        console.log(`   ${unit.padEnd(14)} ${r.region} ${String(regionName.of(r.region)).padEnd(20)} ÷${String(r.divisor).padEnd(4)}`
          + ` ${fmt(r.before).padStart(14)} → ${fmt(r.after).padStart(14)}  ${note}`);
      }
      csv.push([label, p.productId, r.unit.id, r.unit.state ?? '', `${r.region} ${regionName.of(r.region)}`, r.divisor,
        r.us ? fmt(r.us) : '', r.usd ? r.usd.toFixed(2) : '', r.before ? fmt(r.before) : '', r.after ? fmt(r.after) : '', note]);
    }
    const skipped = rows.filter((r) => r.region && r.skip);
    if (skipped.length) console.log(`   (bỏ qua: ${skipped.map((r) => `${r.region} – ${r.skip}`).join('; ')})`);
    console.log('');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.join(ROOT, 'backups'), { recursive: true });
  const csvPath = path.join(ROOT, 'backups', `play-pricing-${apply ? 'apply' : 'preview'}-${stamp}.csv`);
  fs.writeFileSync(csvPath, '﻿' + csv.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'));

  const toChange = planned.filter((x) => x.rows.some((r) => r.changed));
  const changeCount = planned.reduce((s, x) => s + x.rows.filter((r) => r.changed).length, 0);
  const increases = planned.flatMap((x) => x.rows.filter((r) => r.changed && fromMoney(r.after) > fromMoney(r.before))
    .map((r) => `${x.original.productId}/${r.unit.id}/${r.region}`));
  console.log(`Tổng: ${changeCount} giá cần đổi trên ${toChange.length} sản phẩm. Bảng chi tiết: ${path.relative(process.cwd(), csvPath)}`);
  if (increases.length) console.log(`Lưu ý: ${increases.length} giá sẽ TĂNG so với hiện tại: ${increases.join(', ')}`);

  if (!apply) {
    console.log('Chưa có gì được thay đổi trên Play Console. Thêm --apply để áp dụng.');
    return;
  }

  for (const { kind, original, next, rows } of toChange) {
    const backup = path.join(ROOT, 'backups', `play-${original.productId}-${stamp}.json`);
    fs.writeFileSync(backup, JSON.stringify(original, null, 2));

    const base = kind === 'onetime' ? 'onetimeproducts' : 'subscriptions';
    const url = new URL(`${API}/applications/${pkg}/${base}/${encodeURIComponent(original.productId)}`);
    url.searchParams.set('updateMask', kind === 'onetime' ? 'purchaseOptions' : 'basePlans');
    const version = original.regionsVersion?.version ?? (await convert(client, 1)).regionVersion?.version;
    url.searchParams.set('regionsVersion.version', version ?? '');
    delete next.regionsVersion; // output only
    try {
      await call(client, 'PATCH', url.toString(), next);
    } catch (e) {
      console.log(`✘ ${original.productId}: ${e.message} (bản sao: ${path.relative(process.cwd(), backup)})`);
      continue;
    }

    // Đọc lại để xác nhận: giá mới đúng, các nước ngoài RULES không đổi.
    const getPath = kind === 'onetime' ? 'oneTimeProducts' : 'subscriptions';
    const after = await call(client, 'GET', `${API}/applications/${pkg}/${getPath}/${encodeURIComponent(original.productId)}`);
    const beforeUnits = UNITS[kind](original);
    const wrong = [];
    const othersChanged = [];
    for (const unit of UNITS[kind](after)) {
      const before = beforeUnits.find((u) => u.id === unit.id);
      for (const cfg of unit.configs) {
        const expected = rows.find((r) => r.unit.id === unit.id && r.region === cfg.regionCode && r.after);
        if (expected && !samePrice(cfg.price, expected.after)) wrong.push(`${unit.id}/${cfg.regionCode}`);
        if (!rows.some((r) => r.unit.id === unit.id && r.region === cfg.regionCode && r.after)) {
          const old = before?.configs.find((c) => c.regionCode === cfg.regionCode);
          if (old && !samePrice(old.price, cfg.price)) othersChanged.push(`${unit.id}/${cfg.regionCode}`);
        }
      }
    }
    const ok = !wrong.length && !othersChanged.length;
    console.log(`${ok ? '✔' : '⚠'} ${original.productId}: đã đổi ${rows.filter((r) => r.changed).length} giá`
      + (wrong.length ? `; chưa khớp: ${wrong.join(', ')}` : '')
      + (othersChanged.length ? `; nước khác bị đổi: ${othersChanged.join(', ')}` : '')
      + ` (bản sao: ${path.relative(process.cwd(), backup)})`);
  }
}

main().catch((e) => {
  console.error(`\nLỗi${e.status ? ` ${e.status}` : ''}: ${e.message}`);
  if (e.status === 401 || e.status === 403) {
    console.error('→ Kiểm tra quyền của service account trong Play Console (Users and permissions) cho app này.');
  }
  process.exit(1);
});
