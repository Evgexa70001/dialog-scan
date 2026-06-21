const ITEM_NAME_PREFIXES = new Set([
  'ПРЕДМЕТ', 'АКСЕССУАР', 'СКИН', 'НАШИВКА', 'ТОВАР', 'НАЗВАНИЕ',
  'ЛЕГЕНДАРНЫЙ ПРЕДМЕТ', 'ЛЕГЕНДАРНЫЙ АКСЕССУАР', 'ЛЕГЕНДАРНАЯ ОДЕЖДА',
  'КОЛЛЕКЦИОННЫЙ АКСЕССУАР', 'ЛЕГЕНДАРНАЯ НАШИВКА', 'ОРУЖИЕ', 'ОДЕЖДА',
]);

function stripColors(value) {
  return String(value ?? '').replace(/\{[0-9A-Fa-f]{6}\}/g, '');
}

function cleanKey(value) {
  return stripColors(value).toUpperCase().replace(/\s+/g, ' ').trim();
}

function moneyFromText(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function stripNamePrefix(name) {
  name = stripColors(String(name ?? '')).replace(/\s+/g, ' ').trim();
  if (!name) return name;
  const m = name.match(/^([^:\n]{1,120}):\s*(.+)$/);
  if (!m) return name;
  const prefix = cleanKey(m[1]);
  const rest = m[2].trim();
  if (!rest) return name;
  if (ITEM_NAME_PREFIXES.has(prefix) || /^[A-ZА-ЯЁ\s\-]+$/.test(prefix)) {
    return rest;
  }
  return name;
}

function sanitizeName(name) {
  name = stripColors(name).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  name = stripNamePrefix(name);
  if (!name) return null;
  return name.slice(0, 200);
}

function dialogItemName(value) {
  return stripNamePrefix(stripColors(value).trim());
}

function extractTransferFrom(text) {
  const plain = stripColors(text).replace(/\r/g, '');
  if (!/перенос/i.test(plain)) return null;
  const patterns = [
    /перенос[\s\S]*?\sс\s+(?:аксессуара|предмета|оружия|скина|одежды|нашивки)\s+[«"']([^»"'\n]+)[»"']/i,
    /перенос[\s\S]*?(?:аксессуара|предмета|оружия|скина|одежды|нашивки)\s+[«"']([^»"'\n]+)[»"']/i,
    /перенос[\s\S]*?\sс\s+[«"']([^»"'\n]+)[»"']/i,
  ];
  for (const re of patterns) {
    const m = plain.match(re);
    const name = sanitizeName(m && m[1]);
    if (name) return name;
  }
  return null;
}

function extractTraitsFrom(text) {
  let plain = stripColors(text).replace(/\r/g, '');
  const plainLower = plain.toLowerCase();
  if (/примен/i.test(plainLower) && /перенос/i.test(plainLower)) return null;
  if (/перенос всех характеристик/i.test(plainLower)) return null;
  if (!/характеристик/i.test(plainLower)) return null;
  if (!/^\s*\*/m.test(plain) && !/у данного/i.test(plainLower) && !/применен/i.test(plainLower)) {
    return null;
  }
  plain = plain.replace(/^\s*\*\s*/, '');
  const patterns = [
    /характеристик[\s\S]*?\sс\s+(?:предмета|аксессуара|оружия|скина|одежды|нашивки)\s+[«"']([^»"'\n]+)[»"']/i,
    /применен[аыо]?\s+все\s+характеристик[\s\S]*?\sс\s+(?:предмета|аксессуара|оружия|скина|одежды|нашивки)\s+[«"']([^»"'\n]+)[»"']/i,
    /характеристик[\s\S]*?\sс\s+[«"']([^»"'\n]+)[»"']/i,
  ];
  for (const re of patterns) {
    const m = plain.match(re);
    const name = sanitizeName(m && m[1]);
    if (name) return name;
  }
  return null;
}

function resolveItemOrigin(text) {
  const transferFrom = extractTransferFrom(text);
  if (transferFrom) return { traits_from: null, transfer_from: transferFrom };
  const traitsFrom = extractTraitsFrom(text);
  return { traits_from: traitsFrom || null, transfer_from: null };
}

function extractDialogName(text) {
  const plain = stripColors(text).replace(/\./g, '');
  const patterns = [
    /Легендарный предмет:\s*\{[0-9A-Fa-f]{6}\}(.+?)\{[0-9A-Fa-f]{6}\}/,
    /Легендарный предмет:\s*\{[0-9A-Fa-f]{6}\}([^{]+)/,
    /Легендарный аксессуар:\s*\{[0-9A-Fa-f]{6}\}(.+?)\{[0-9A-Fa-f]{6}\}/,
    /Легендарная одежда:\s*\{[0-9A-Fa-f]{6}\}(.+?)\{[0-9A-Fa-f]{6}\}/,
    /Коллекционный аксессуар:\s*\{[0-9A-Fa-f]{6}\}(.+?)\{[0-9A-Fa-f]{6}\}/,
    /Предмет:\s*\{[0-9A-Fa-f]{6}\}(.+?)\{[0-9A-Fa-f]{6}\}/,
    /Аксессуар:\s*\{[0-9A-Fa-f]{6}\}(.+?)\{[0-9A-Fa-f]{6}\}/,
    /Скин:\s*\{[0-9A-Fa-f]{6}\}(.+?)\{[0-9A-Fa-f]{6}\}/,
    /Скин:\s*\{[0-9A-Fa-f]{6}\}([^{}\n]+)/,
    /Нашивка:\s*\{[0-9A-Fa-f]{6}\}(.+?)\{[0-9A-Fa-f]{6}\}/,
    /\{FDCF28\}(.+?)\{FFFFFF\}/,
    /\{FF332C\}(.+?)\{FFFFFF\}/,
  ];
  for (const re of patterns) {
    const m = plain.match(re);
    const part = m && m[1] ? String(m[1]).trim() : null;
    if (!part || part.length <= 1) continue;
    if (part.includes('Стоимость') || part.includes('Игрок')) continue;
    return stripNamePrefix(part);
  }
  return null;
}

function isItemDialog(title, text) {
  title = String(title ?? '');
  text = String(text ?? '');
  if (title.includes('Продажа предмет') || title.includes('Покупка предмет')) return true;
  const titleUpper = cleanKey(title);
  if (titleUpper.includes('ПРОДАЖА ПРЕДМЕТ') || titleUpper.includes('ПОКУПКА ПРЕДМЕТ')) return true;
  if (text.includes('Стоимость:') && (
    text.includes('Предмет:') || text.includes('Аксессуар:') || text.includes('Скин:') ||
    text.includes('Легендарный предмет:') || text.includes('Легендарный аксессуар:') ||
    text.includes('Легендарная одежда:') || text.includes('Коллекционный аксессуар:')
  )) return true;
  return false;
}

function extractAmounts(text) {
  const plain = stripColors(text).replace(/\r/g, '').replace(/,/g, '').replace(/\./g, '').replace(/\{[0-9A-Fa-f]{6}\}/g, '');
  const kol = (
    plain.match(/В\s+наличии:\s*(\d+)/i) ||
    plain.match(/В\s+наличии:[^\d]*(\d+)\s*шт/i) ||
    plain.match(/Продает[^\d]*(\d+)\s*шт/i) ||
    plain.match(/Количество:[^\d]*(\d+)\s*шт/i)
  );
  const pok = (
    plain.match(/[Ии]грок[^\d]*покупает:\s*(\d+)/) ||
    plain.match(/[Ии]грок[^\d]*покупает:[^\d]*(\d+)\s*шт/i) ||
    plain.match(/[Пп]окупает:\s*(\d+)\s*шт/i) ||
    plain.match(/[Пп]окупает[^\d]*(\d+)\s*шт/i) ||
    plain.match(/Куплю[^\d]*(\d+)\s*шт/i) ||
    plain.match(/Скупает[^\d]*(\d+)\s*шт/i)
  );
  return [Number(kol && kol[1]) || 1, Number(pok && pok[1]) || 1];
}

function dialogCount(text, title, kind, button1) {
  const [kol, pok] = extractAmounts(text);
  title = String(title ?? '');
  if (title.includes('Покупка предмет')) return kol;
  if (title.includes('Продажа предмет')) return pok;
  if (kind === 'sell') return kol;
  if (kind === 'buy') return pok;
  button1 = String(button1 ?? '');
  if (button1.includes('Купить')) return kol;
  if (button1.includes('Продать')) return pok;
  return Math.max(kol, pok);
}

function lineLooksLikeMeta(upper) {
  const keys = [
    'ПРИ ', 'МОЖНО', 'РАЗРЕШЕНО', 'КОЛИЧЕСТВО', 'ВВЕДИТЕ', 'ОСТАЛОСЬ', 'СТОИМОСТЬ',
    'ИГРОК ПОКУПАЕТ', 'ИГРОК ПРОДА', 'У ВАС В НАЛИЧИИ', 'В НАЛИЧИИ', 'ПОДРОБНЕЕ', 'ПРЕДУПРЕЖДЕНИЕ',
    'ПЕРЕНОС', 'ПРИМЕНЁН ПЕРЕНОС', 'ПРИМЕНЕН ПЕРЕНОС',
    'ХАРАКТЕРИСТИК', 'ПРИМЕНЕНЫ ВСЕ', 'У ДАННОГО',
  ];
  return keys.some((k) => upper.includes(k));
}

function parsePrice(clean) {
  const priceLine = clean.match(/[Сс]тоимость:\s*([^\n]+)/);
  if (!priceLine) return null;
  const cash = priceLine[1].match(/:CASH:([\d.]+)/);
  if (cash) return moneyFromText(cash[1]);
  const priceMatch = priceLine[1].match(/([\d.,\s]+)/);
  return moneyFromText(priceMatch && priceMatch[1]);
}

function parseDialogItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = raw.title ?? '';
  const text = raw.text ?? '';
  const button1 = raw.button1 ?? '';
  if (!isItemDialog(title, text)) return null;

  const clean = stripColors(text).replace(/\r/g, '');
  const upper = cleanKey(clean);
  const titleUpper = cleanKey(title);
  const titleRaw = String(title);
  const titleIsBuy = titleUpper.includes('ПОКУПКА ПРЕДМЕТ') || titleRaw.includes('Покупка предмет');
  const titleIsSell = titleUpper.includes('ПРОДАЖА ПРЕДМЕТ') || titleRaw.includes('Продажа предмет');

  let kind = raw.kind === 'buy' || raw.kind === 'sell' ? raw.kind : null;
  if (!kind) {
    if (titleIsBuy) kind = 'sell';
    else if (titleIsSell) kind = 'buy';
    else if (upper.includes('ИГРОК ПОКУПАЕТ')) kind = 'buy';
    else if (upper.includes('ИГРОК ПРОДА')) kind = 'sell';
    else if (upper.includes('В НАЛИЧИИ')) kind = titleIsBuy ? 'sell' : 'buy';
  }

  const count = dialogCount(clean, title, kind, button1);
  if (!kind || !count || count <= 0) return null;

  let name = extractDialogName(text);
  if (!name) {
    for (const line of clean.split('\n')) {
      const value = dialogItemName(line);
      const valueUpper = cleanKey(value);
      if (value && !lineLooksLikeMeta(valueUpper)) {
        name = value;
        break;
      }
    }
  }
  name = sanitizeName(name);
  if (!name) return null;

  return {
    kind,
    name,
    count: Math.floor(count),
    price: parsePrice(clean),
    ...resolveItemOrigin(text),
    slot: raw.slot,
  };
}

function itemStackKey(item) {
  return cleanKey(item.name) + '\0' + String(item.price ?? '')
    + '\0' + cleanKey(item.traits_from || item.transfer_from || '');
}

function stackItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = itemStackKey(item);
    const prev = map.get(key);
    if (prev) {
      prev.count += item.count;
      const slot = Number(item.slot) || 0;
      const prevSlot = Number(prev.slot) || 0;
      if (!prevSlot || (slot && slot < prevSlot)) prev.slot = item.slot;
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values()).sort((a, b) => (Number(a.slot) || 0) - (Number(b.slot) || 0));
}

function parseScanItems(items) {
  const out = [];
  if (!Array.isArray(items)) return out;
  for (const raw of items) {
    const parsed = parseDialogItem(raw);
    if (parsed) out.push(parsed);
  }
  return stackItems(out);
}

function splitParsedItems(items) {
  const sell = [];
  const buy = [];
  for (const item of items || []) {
    if (item.kind === 'sell') sell.push(item);
    else if (item.kind === 'buy') buy.push(item);
  }
  return { sell: stackItems(sell), buy: stackItems(buy) };
}

function countParsedKinds(items) {
  let sell = 0;
  let buy = 0;
  for (const item of items || []) {
    if (item.kind === 'sell') sell += 1;
    else if (item.kind === 'buy') buy += 1;
  }
  return { sell, buy };
}

module.exports = {
  parseDialogItem,
  parseScanItems,
  splitParsedItems,
  countParsedKinds,
  stripNamePrefix,
};
