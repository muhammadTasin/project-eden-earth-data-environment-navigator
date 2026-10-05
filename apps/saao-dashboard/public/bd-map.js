/**
 * The overview's map of Bangladesh: all 544 upazilas coloured by one layer at a time (NASA MODIS, the NASA water
 * replay, GLDAS groundwater, today's NASA update, PEST-CHEMGRIDS, the SRDI soil atlas), NASA GIBS imagery underneath
 * or on top. Hover for the value; click for the upazila's facts (in the panel under the map) and to plan for it. Needs Leaflet (window.L, loaded
 * from cdnjs in index.html); without it the panel says so and the place list keeps working.
 */

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const gibs = (layer, time, matrix, ext) =>
  `${GIBS}/${layer}/default/${time ? `${time}/` : ''}${matrix}/{z}/{y}/{x}.${ext}`;

// Ramps, light to dark, in the story site's hues; each passes the dataviz ordinal checks (one hue, monotone lightness,
// steps >= 0.06 apart). The diverging scales put the warm (dry, fewer) arm and the cool or green arm around a neutral.
const GREEN = ['#E6EFE2', '#C7DDC1', '#A2C69E', '#78AB7A', '#4F8C5C', '#2F6B48', '#1D4A31'];
const BLUE = ['#E2ECF7', '#BCD4EE', '#8FB5E0', '#6497CF', '#3F79BD', '#2B5E9C', '#1C4272'];
const AMBER = ['#F5EBDC', '#EBD3B0', '#DFB680', '#D19956', '#C77B26', '#9A5A14', '#6E3C10'];
const NEUTRAL = '#E4DED4';
const DRY_WET = ['#7E470F', '#C77B26', '#E5C397', NEUTRAL, '#A9C7E8', '#4F86C4', '#1F4F86'];
const FEWER_MORE = ['#9A5A14', '#DFB680', NEUTRAL, '#A2C69E', '#2F6B48'];
const NO_DATA = '#D8D2C8';

const GROUPS = {
  crops: ['ফসল (নাসা MODIS)', 'Crops (NASA MODIS)'],
  water: ['পানি (নাসা)', 'Water (NASA)'],
  now: ['এখনকার অবস্থা (দৈনিক নাসা হালনাগাদ)', 'Now (daily NASA update)'],
  soil: ['মাটি ও কীটনাশক', 'Soil and pesticide'],
};

const LAYERS = [
  { id: 'cropsNow', group: 'crops', name: ['বছরে কয়টি ফসল', 'Crops a year'], note: ['MODIS, ২০২১–২৬', 'MODIS, 2021–26'],
    value: r => r.cropsNow, breaks: [1.0, 1.4, 1.8, 2.2, 2.6], colors: GREEN.slice(1), digits: 1, source: 'crops' },
  { id: 'cropsChange', group: 'crops', name: ['ফসলের সংখ্যা বেড়েছে না কমেছে', 'Change in crops a year'], note: ['২০০১–০৬ থেকে ২০২১–২৬', '2001–06 to 2021–26'],
    value: r => (r.cropsNow == null || r.cropsThen == null ? null : r.cropsNow - r.cropsThen), breaks: [-0.6, -0.2, 0.2, 0.6],
    colors: FEWER_MORE, digits: 1, signed: true, source: 'crops' },
  { id: 'winterNdvi', group: 'crops', name: ['শীতের ফসলের সবুজ', 'Winter crop greenness'], note: ['MODIS NDVI-র শীর্ষ, ২০২১–২৬', 'MODIS NDVI peak, 2021–26'],
    value: r => r.winterNdvi, breaks: [0.4, 0.5, 0.6, 0.7, 0.8], colors: GREEN.slice(1), digits: 2, source: 'crops' },
  { id: 'boroWater', group: 'water', name: ['বোরোর সেচ চাহিদা', 'Boro irrigation need'], note: ['মিমি, নাসা ২৫ মৌসুমের রিপ্লে, জেলার পয়েন্ট', 'mm, NASA 25-season replay, district point'],
    value: r => r.boroIrrigationMm, breaks: [500, 600, 650, 700, 750], colors: BLUE.slice(1), digits: 0, unit: ['মিমি', 'mm'], source: 'water', district: true },
  { id: 'groundwater', group: 'water', name: ['ভূগর্ভস্থ পানি কমার হার', 'Groundwater falling'], note: ['মিমি/বছর, নাসা GLDAS (GRACE), জেলা', 'mm a year, NASA GLDAS (GRACE), district'],
    value: r => (r.groundwaterMmPerYear == null ? null : -r.groundwaterMmPerYear), breaks: [2, 3, 4, 5, 6], colors: AMBER.slice(1), digits: 1,
    unit: ['মিমি/বছর', 'mm/yr'], source: 'water', district: true },
  { id: 'rain7', group: 'now', name: ['গত ৭ দিনের বৃষ্টি', 'Rain in the last 7 days'], note: ['মিমি, GPM IMERG', 'mm, GPM IMERG'],
    value: r => r.rain7, breaks: [5, 15, 30, 60, 100], colors: BLUE.slice(1), digits: 0, unit: ['মিমি', 'mm'], source: 'live' },
  { id: 'rain30', group: 'now', name: ['৩০ দিনের বৃষ্টি, স্বাভাবিকের তুলনায়', 'Rain in 30 days against normal'], note: ['%, নাসা POWER', '%, NASA POWER'],
    value: r => r.rainPctOfNormal, breaks: [50, 75, 90, 110, 125, 150], colors: DRY_WET, digits: 0, unit: ['%', '%'], source: 'live' },
  { id: 'soilWet', group: 'now', name: ['মাটির রস, গত ১০ বছরের তুলনায়', 'Soil wetness against the past 10 years'], note: ['নাসা POWER', 'NASA POWER'],
    value: r => r.soilStatus, source: 'live',
    categories: [['dry', 'স্বাভাবিকের চেয়ে শুকনো', 'Drier than usual', '#C77B26'], ['normal', 'স্বাভাবিক', 'Usual', NEUTRAL], ['wet', 'স্বাভাবিকের চেয়ে ভেজা', 'Wetter than usual', '#4F86C4']] },
  { id: 'pestRice', group: 'soil', name: ['ধানে কীটনাশক', 'Pesticide on rice'], note: ['কেজি/হেক্টর/বছর, নাসা SEDAC PEST-CHEMGRIDS (মাঝামাঝি অনুমান)', 'kg/ha a year, NASA SEDAC PEST-CHEMGRIDS (mid estimate)'],
    value: r => (r.pesticideRice ? (r.pesticideRice[0] + r.pesticideRice[1]) / 2 : null), breaks: [0.45, 0.55, 0.65, 0.75, 0.9], colors: AMBER.slice(1),
    digits: 2, unit: ['কেজি/হে.', 'kg/ha'], source: 'pesticide' },
  { id: 'organicMatter', group: 'soil', name: ['মাটির জৈব পদার্থ', 'Soil organic matter'], note: ['SRDI মাটি উর্বরতা অ্যাটলাস', 'SRDI soil fertility atlas'],
    value: r => r.organicMatter, source: 'soil',
    categories: [['Very Low', 'খুব কম', 'Very low', GREEN[1]], ['Low', 'কম', 'Low', GREEN[2]], ['Medium', 'মাঝারি', 'Medium', GREEN[3]],
      ['Optimum', 'উপযুক্ত', 'Optimum', GREEN[4]], ['High', 'বেশি', 'High', GREEN[5]], ['Very High', 'খুব বেশি', 'Very high', GREEN[6]]] },
];

const PH = {
  'Very Strongly Acidic': ['খুব বেশি অম্লীয়', 'very strongly acidic'], 'Strongly Acidic': ['বেশ অম্লীয়', 'strongly acidic'],
  'Slightly Acidic': ['সামান্য অম্লীয়', 'slightly acidic'], Neutral: ['নিরপেক্ষ', 'neutral'], 'Slightly Alkaline': ['সামান্য ক্ষারীয়', 'slightly alkaline'],
};
const STATUS = { dry: ['শুকনো', 'dry'], normal: ['স্বাভাবিক', 'usual'], wet: ['ভেজা', 'wet'] };

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
// the pilot (Talanda union) sits in Tanore upazila
const norm = (id) => (id === 'talanda_tanore' ? 'ADM3_Tanore' : id);

export function initBdMap({ tr, num, escapeHtml, choose, currentId }) {
  const el = document.getElementById('bdMap');
  const select = document.getElementById('mapLayer');
  if (!el || !select) return null;
  const L = window.L;
  if (!L) {
    el.innerHTML = `<p class="map-fallback">${tr('মানচিত্র লোড হয়নি (ইন্টারনেট সংযোগ দেখুন); ওপরের তালিকা থেকে উপজেলা বেছে নিন।', 'The map did not load (check the internet connection); pick an upazila from the list above.')}</p>`;
    return null;
  }

  let layerId = (() => { try { return localStorage.getItem('eden.mapLayer') || 'cropsNow'; } catch { return 'cropsNow'; } })();
  if (!LAYERS.some(l => l.id === layerId)) layerId = 'cropsNow';
  let rows = {};
  let sources = {};
  let selected = norm(currentId());
  let inspected = selected; // the upazila whose facts the panel shows
  const panel = document.getElementById('mapFacts');
  let upazilaLayer = null;
  let fitted = false; // the country view waits until the map is on screen (the role picker hides it at first)
  const byId = new Map();

  const map = L.map(el, { zoomSnap: 0.25, minZoom: 5, maxZoom: 12, preferCanvas: true, maxBounds: [[12, 78], [34, 102]] })
    .setView([23.75, 90.3], 7);
  const canvas = L.canvas({ padding: 0.5 });
  const day = yesterday();

  const base = {
    street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }),
    modis: L.tileLayer(gibs('MODIS_Terra_CorrectedReflectance_TrueColor', day, 'GoogleMapsCompatible_Level9', 'jpg'), { maxNativeZoom: 9, maxZoom: 12, attribution: `NASA GIBS: MODIS Terra ${day}` }),
    viirs: L.tileLayer(gibs('VIIRS_NOAA20_CorrectedReflectance_TrueColor', day, 'GoogleMapsCompatible_Level9', 'jpg'), { maxNativeZoom: 9, maxZoom: 12, attribution: `NASA GIBS: VIIRS NOAA-20 ${day}` }),
    marble: L.tileLayer(gibs('BlueMarble_ShadedRelief_Bathymetry', null, 'GoogleMapsCompatible_Level8', 'jpg'), { maxNativeZoom: 8, maxZoom: 12, attribution: 'NASA GIBS: Blue Marble' }),
  };
  const overlays = {
    flood: L.tileLayer(gibs('MODIS_Combined_Flood_3-Day', day, 'GoogleMapsCompatible_Level9', 'png'), { maxNativeZoom: 9, maxZoom: 12, opacity: 0.9, attribution: 'NASA LANCE MODIS flood' }),
    imerg: L.tileLayer(gibs('IMERG_Precipitation_Rate', day, 'GoogleMapsCompatible_Level6', 'png'), { maxNativeZoom: 6, maxZoom: 12, opacity: 0.75, attribution: 'NASA GPM IMERG' }),
    smap: L.tileLayer(gibs('SMAP_L4_Analyzed_Root_Zone_Soil_Moisture', 'default', 'GoogleMapsCompatible_Level6', 'png'), { maxNativeZoom: 6, maxZoom: 12, opacity: 0.75, attribution: 'NASA SMAP L4' }),
    ndvi: L.tileLayer(gibs('MODIS_Terra_NDVI_8Day', 'default', 'GoogleMapsCompatible_Level9', 'png'), { maxNativeZoom: 9, maxZoom: 12, opacity: 0.8, attribution: 'NASA MODIS NDVI' }),
    labels: L.tileLayer(gibs('Reference_Labels_15m', null, 'GoogleMapsCompatible_Level13', 'png'), { maxNativeZoom: 13, maxZoom: 13, attribution: 'NASA GIBS reference labels' }),
  };
  base.street.addTo(map);
  const districts = L.geoJSON(null, { renderer: canvas, interactive: false, style: { color: '#1D2320', weight: 1.1, opacity: 0.65, fill: false } });

  const spec = () => LAYERS.find(l => l.id === layerId);
  const unit = (s) => (s.unit ? ` ${tr(s.unit[0], s.unit[1])}` : '');
  const fmt = (s, v) => `${s.signed && v > 0 ? '+' : ''}${num(Number(v).toFixed(s.digits))}`;
  const classOf = (s, v) => s.breaks.reduce((k, b) => (v >= b ? k + 1 : k), 0);

  function colorOf(s, r) {
    const v = r ? s.value(r) : null;
    if (v == null) return null;
    if (s.categories) return s.categories.find(c => c[0] === v)?.[3] ?? null;
    return s.colors[classOf(s, v)];
  }

  function valueText(s, r) {
    const v = r ? s.value(r) : null;
    if (v == null) return tr('তথ্য নেই', 'no data');
    if (s.categories) {
      const c = s.categories.find(x => x[0] === v);
      return c ? tr(c[1], c[2]) : String(v);
    }
    return `${fmt(s, v)}${unit(s)}`;
  }

  function style(feature) {
    const id = feature.properties.id;
    const fill = colorOf(spec(), rows[id]);
    const on = id === selected;
    const looked = id === inspected && !on;
    return {
      renderer: canvas,
      color: on || looked ? '#1D2320' : '#4A463F', weight: on ? 3 : looked ? 2 : 0.45, opacity: on || looked ? 1 : 0.55,
      dashArray: looked ? '5 3' : undefined,
      fillColor: fill ?? NO_DATA, fillOpacity: fill ? 0.82 : 0.45, ...(fill || looked ? {} : { dashArray: '3 3' }),
    };
  }

  function legend() {
    const s = spec();
    const items = s.categories
      ? s.categories.map(c => [c[3], tr(c[1], c[2])])
      : s.colors.map((c, k) => {
        const lo = s.breaks[k - 1];
        const hi = s.breaks[k];
        const label = k === 0 ? `< ${fmt(s, hi)}` : k === s.breaks.length ? `≥ ${fmt(s, lo)}` : `${fmt(s, lo)} – ${fmt(s, hi)}`;
        return [c, label];
      });
    const counts = new Map();
    for (const r of Object.values(rows)) {
      const c = colorOf(s, r) ?? NO_DATA;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const sourceNote = sources[s.source] ? `<p class="map-source">${escapeHtml(sources[s.source])}</p>` : '';
    const districtNote = s.district ? `<p class="map-caveat">${tr('জেলার পয়েন্টের মান: একই জেলার সব উপজেলায় একই রং।', 'District-point value: every upazila of a district shares its colour.')}</p>` : '';
    const liveNote = s.source === 'live' ? `<p class="map-caveat">${tr('নাসা POWER-এর সাম্প্রতিক সপ্তাহগুলো আর্কাইভের চেয়ে শুকনো পড়ে; SMAP দিয়ে মেলানো পর্যন্ত "শুকনো" অস্থায়ী।', "NASA POWER's newest weeks read drier than its archive; treat 'dry' as provisional until SMAP confirms it.")}</p>` : '';
    const pestNote = s.source === 'pesticide' ? `<p class="map-caveat">${tr('মডেলের অনুমান (মাটি শোধনের ফিউমিগ্যান্ট বাদে), মাঠের মাপ নয়।', 'A model estimate (soil fumigants left out), not a farm measurement.')}</p>` : '';
    const cropNote = s.source === 'crops' ? `<p class="map-caveat">${tr('উপজেলার কেন্দ্রের একটি ২৫০ মি পিক্সেল: প্রসঙ্গ হিসেবে দেখুন।', 'One 250 m pixel at the upazila centre: read it as context.')}</p>` : '';
    document.getElementById('mapLegend').innerHTML = `
      <div class="map-legend-title"><strong>${escapeHtml(tr(s.name[0], s.name[1]))}</strong> <span>${escapeHtml(tr(s.note[0], s.note[1]))}</span></div>
      <ul class="map-legend-list">
        ${items.map(([c, label]) => `<li><span class="map-swatch" style="background:${c}"></span>${escapeHtml(label)} <small>(${num(counts.get(c) ?? 0)})</small></li>`).join('')}
        <li><span class="map-swatch map-swatch-none"></span>${tr('তথ্য নেই', 'No data')} <small>(${num(counts.get(NO_DATA) ?? 0)})</small></li>
      </ul>
      ${districtNote}${liveNote}${pestNote}${cropNote}${sourceNote}`;
  }

  function tableView() {
    const box = document.getElementById('mapTable');
    if (!box) return;
    const s = spec();
    const here = rows[selected];
    if (!here) { box.innerHTML = ''; return; }
    const list = Object.entries(rows).filter(([, r]) => r.district === here.district)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    box.innerHTML = `
      <summary>${escapeHtml(tr(`${here.district} জেলার উপজেলাগুলো: ${s.name[0]} (সারণি)`, `${here.district} district's upazilas: ${s.name[1]} (table)`))}</summary>
      <table class="data-table map-table-grid"><thead><tr><th>${tr('উপজেলা', 'Upazila')}</th><th>${escapeHtml(tr(s.name[0], s.name[1]))}</th></tr></thead>
      <tbody>${list.map(([id, r]) => `<tr${id === selected ? ' class="is-here"' : ''}><td>${escapeHtml(r.name)}</td><td>${escapeHtml(valueText(s, r))}</td></tr>`).join('')}</tbody></table>`;
  }

  function facts(id) {
    const r = rows[id];
    if (!r) return `<p class="map-hint">${tr('মানচিত্রে কোনো উপজেলায় চাপ দিন: তার নাসা তথ্য এখানে আসবে, আর সেখান থেকেই পরিকল্পনা খুলবেন।', 'Click an upazila on the map: its NASA facts appear here, and you can open its plan from here.')}</p>`;
    const crops = r.cropsNow == null ? tr('তথ্য নেই', 'no data') : `${num(r.cropsThen?.toFixed(1) ?? '—')} → ${num(r.cropsNow.toFixed(1))}`;
    const rice = r.pesticideRice ? `${num(r.pesticideRice[0].toFixed(2))}–${num(r.pesticideRice[1].toFixed(2))} ${tr('কেজি/হে.', 'kg/ha')}` : '—';
    const other = r.pesticideOther ? `${num(r.pesticideOther[0].toFixed(2))}–${num(r.pesticideOther[1].toFixed(2))}` : '—';
    const status = r.rainStatus ? ` (${tr(...(STATUS[r.rainStatus] ?? [r.rainStatus, r.rainStatus]))})` : '';
    const rain = r.rainPctOfNormal == null ? '—' : `${tr(`স্বাভাবিকের ${num(r.rainPctOfNormal)}%`, `${r.rainPctOfNormal}% of normal`)}${status}`;
    const omClass = LAYERS.find(l => l.id === 'organicMatter').categories.find(c => c[0] === r.organicMatter);
    const om = omClass ? tr(omClass[1], omClass[2].toLowerCase()) : '—';
    const ph = r.ph ? tr(...(PH[r.ph] ?? [r.ph, r.ph])) : '—';
    const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
    return `
      <div class="map-popup">
        <strong>${escapeHtml(r.name)}</strong> <span>${escapeHtml(r.district)}</span>
        <table>
          ${row(tr('বছরে ফসল (MODIS, ২০০১–০৬ → ২০২১–২৬)', 'Crops a year (MODIS, 2001–06 → 2021–26)'), crops)}
          ${row(tr('শীতের সবুজ (NDVI)', 'Winter greenness (NDVI)'), r.winterNdvi == null ? '—' : num(r.winterNdvi.toFixed(2)))}
          ${row(tr('বোরোর সেচ (জেলা)', 'Boro irrigation (district)'), r.boroIrrigationMm == null ? '—' : `${num(r.boroIrrigationMm)} ${tr('মিমি', 'mm')}`)}
          ${row(tr('ভূগর্ভস্থ পানি (জেলা)', 'Groundwater (district)'), r.groundwaterMmPerYear == null ? '—' : `${num(r.groundwaterMmPerYear)} ${tr('মিমি/বছর', 'mm/yr')}`)}
          ${row(tr('৩০ দিনের বৃষ্টি', 'Rain, 30 days'), rain)}
          ${row(tr('ধানে কীটনাশক', 'Pesticide on rice'), rice)}
          ${row(tr('ডাল-তেলফসলে কীটনাশক', 'On pulses and oilseeds'), other)}
          ${row(tr('জৈব পদার্থ · মাটির pH', 'Organic matter · soil pH'), `${om} · ${ph}`)}
        </table>
        ${id === selected
          ? `<p class="map-hint">${tr('ড্যাশবোর্ড এখন এই উপজেলার পরিকল্পনা দেখাচ্ছে; তুলনা করতে মানচিত্রে অন্য উপজেলায় চাপ দিন।', 'The dashboard is planning for this upazila; click another one on the map to compare.')}</p>`
          : `<button type="button" class="btn btn-primary btn-sm" data-choose="${escapeHtml(id)}">${tr('এই উপজেলার পরিকল্পনা দেখুন', 'Plan for this upazila')}</button>`}
      </div>`;
  }

  function paint() {
    if (upazilaLayer) {
      upazilaLayer.setStyle(style);
      upazilaLayer.eachLayer(l => l.closeTooltip()); // an open tooltip would keep the old layer's text
    }
    legend();
    tableView();
    if (panel) panel.innerHTML = facts(inspected);
  }
  panel?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-choose]');
    if (btn) choose(btn.dataset.choose);
  });

  function fillSelect() {
    select.innerHTML = Object.entries(GROUPS).map(([g, label]) => `
      <optgroup label="${escapeHtml(tr(label[0], label[1]))}">
        ${LAYERS.filter(l => l.group === g).map(l => `<option value="${l.id}"${l.id === layerId ? ' selected' : ''}>${escapeHtml(tr(l.name[0], l.name[1]))}</option>`).join('')}
      </optgroup>`).join('');
  }

  select.addEventListener('change', () => {
    layerId = select.value;
    try { localStorage.setItem('eden.mapLayer', layerId); } catch { /* remembered for this page only */ }
    paint();
  });

  let layersControl = null;
  function controls() {
    if (layersControl) layersControl.remove();
    layersControl = L.control.layers({
      [tr('রাস্তার মানচিত্র (OSM)', 'Street map (OSM)')]: base.street,
      [tr('নাসা MODIS ছবি (গতকাল)', 'NASA MODIS image (yesterday)')]: base.modis,
      [tr('নাসা VIIRS ছবি (গতকাল)', 'NASA VIIRS image (yesterday)')]: base.viirs,
      [tr('নাসা ব্লু মার্বেল', 'NASA Blue Marble')]: base.marble,
    }, {
      ...(upazilaLayer ? { [tr('উপজেলার রং', 'Upazila colours')]: upazilaLayer } : {}),
      [tr('জেলার সীমানা', 'District borders')]: districts,
      [tr('বন্যা, ৩ দিন (নাসা MODIS)', 'Flood, 3 days (NASA MODIS)')]: overlays.flood,
      [tr('বৃষ্টি, গতকাল (নাসা IMERG)', 'Rain, yesterday (NASA IMERG)')]: overlays.imerg,
      [tr('শিকড় অঞ্চলের রস (নাসা SMAP)', 'Root-zone moisture (NASA SMAP)')]: overlays.smap,
      [tr('সবুজ, ৮ দিন (নাসা MODIS NDVI)', 'Greenness, 8 days (NASA MODIS NDVI)')]: overlays.ndvi,
      [tr('জায়গার নাম', 'Place names')]: overlays.labels,
    }, { collapsed: true, position: 'topright' }).addTo(map);
  }

  // full screen, for a closer look
  const Full = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const a = L.DomUtil.create('a', 'leaflet-bar map-full');
      a.href = '#';
      a.setAttribute('role', 'button');
      a.title = tr('পূর্ণ পর্দা', 'Full screen');
      a.textContent = '⛶';
      L.DomEvent.on(a, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        const wrap = el.closest('.bd-map-wrap') ?? el;
        if (document.fullscreenElement) document.exitFullscreen();
        else wrap.requestFullscreen?.();
      });
      return a;
    },
  });
  new Full().addTo(map);
  document.addEventListener('fullscreenchange', () => setTimeout(() => map.invalidateSize(), 150));

  fillSelect();
  controls();

  Promise.all([
    fetch('data/bd_upazilas.geojson').then(r => r.json()),
    fetch('data/bd_districts.geojson').then(r => r.json()),
    fetch('/api/v1/map/upazilas').then(r => (r.ok ? r.json() : { upazilas: {}, sources: {} })),
  ]).then(([upazilas, districtShapes, values]) => {
    rows = values.upazilas;
    sources = values.sources ?? {};
    districts.addData(districtShapes).addTo(map);
    upazilaLayer = L.geoJSON(upazilas, {
      renderer: canvas,
      attribution: 'Upazila outlines: geoBoundaries (CC BY 4.0)',
      style,
      onEachFeature(feature, layer) {
        byId.set(feature.properties.id, layer);
        layer.bindTooltip(() => {
          const r = rows[feature.properties.id];
          return `<strong>${escapeHtml(feature.properties.name)}</strong>, ${escapeHtml(feature.properties.district)}<br>${escapeHtml(tr(spec().name[0], spec().name[1]))}: ${escapeHtml(valueText(spec(), r))}`;
        }, { sticky: true, direction: 'top', className: 'map-tip' });
        layer.on('mouseover', () => { if (feature.properties.id !== selected) layer.setStyle({ weight: 2, color: '#1D2320', opacity: 1 }); });
        layer.on('mouseout', () => upazilaLayer.resetStyle(layer));
        layer.on('click', () => {
          inspected = feature.properties.id;
          paint();
          panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      },
    }).addTo(map);
    districts.bringToFront();
    controls();
    paint();
    // the whole country first (the box may have changed size while the outlines loaded); a choice flies in
    fitCountry();
  }).catch(() => {
    document.getElementById('mapLegend').innerHTML = `<p class="map-caveat">${tr('মানচিত্রের তথ্য আনা যায়নি।', 'The map data could not be loaded.')}</p>`;
  });

  function fitCountry() {
    if (fitted || !upazilaLayer || !el.clientWidth) return;
    map.invalidateSize();
    map.fitBounds(upazilaLayer.getBounds(), { padding: [8, 8] });
    el.dataset.view = 'country';
    fitted = true;
  }

  function focus(id) {
    const layer = byId.get(norm(id));
    if (layer) map.flyToBounds(layer.getBounds(), { maxZoom: 9, duration: 0.8 });
  }

  return {
    setPlace(id) {
      selected = norm(id);
      inspected = selected;
      paint();
      focus(selected);
    },
    refreshLanguage() {
      fillSelect();
      controls();
      paint();
    },
    invalidate() { map.invalidateSize(); fitCountry(); },
  };
}
