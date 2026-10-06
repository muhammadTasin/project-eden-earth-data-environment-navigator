/**
 * Project EDEN — Earth Data & Environment Navigator (SAAO dashboard)
 *
 * Every number comes from the API, which reads the generated research release.
 * Language: static text carries data-i18n (Bangla in index.html, English in i18n.js); dynamic text is built
 * here with tr(bangla, english). Switching language re-renders everything from the cached API responses.
 */
import { EN } from './i18n.js';
import { initBdMap } from './bd-map.js';
import { initPortals } from './portals.js';
import { accessToken, authConfig, supabaseSignOut } from './auth-client.js';

let lang = 'bn';
let currentAdvice = null;
let currentOverview = null;
let currentNarration = null;
let currentDataRelease = null;
let selectedOptionId = null;
let officers = [];
let officerSession = null; // { source: 'supabase' | 'demo', officer, token (demo only) }
let homeArea = null; // the manager's own area from the verified token site: { siteId, placeId, nameBangla, nameEnglish, district }
let homeAreaApplied = false; // the page switched to the manager's own area once after sign-in
let demoMode = false; // the server runs with DEMO_MODE=true: the demo officer login is offered
let officerDesk = null;
let officerKnowledge = null;
let officerNotice = null; // result of the last saved observation
let audioState = 'idle'; // idle | playing | done | novoice
let audioTimer = null;

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const tr = (bn, en) => (lang === 'en' ? en : bn);
// Shown instead of fertilizer amounts at a place with no SRDI soil card (the same words as the server's NO_SOIL_CARD)
const noSoilCard = () => tr('এই এলাকার মাটির কার্ড (SRDI) যোগ করা হয়নি, সার-পরামর্শ দেওয়া যাচ্ছে না', 'This area’s soil card (SRDI) has not been added, so fertilizer advice cannot be given');
const bnDigits = (value) => String(value).replace(/\d/g, d => BN_DIGITS[Number(d)]);
// Digits in the current language; a leading minus becomes '−' but ranges like 2003-07 keep their hyphen
const num = (value) => (lang === 'en' ? String(value) : bnDigits(value)).replace(/(^|[\s(:])-(?=[0-9০-৯])/g, '$1−');
const bigNum = (value) => Math.round(value).toLocaleString(lang === 'en' ? 'en-US' : 'bn-BD');
const isoDate = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return lang === 'en' ? `${d} ${EN_MONTHS[m - 1]} ${y}` : `${bnDigits(d)} ${BN_MONTHS[m - 1]} ${bnDigits(y)}`;
};
const bnDateOf = (text) => (text.endsWith('ি') || text.endsWith('ে') ? `${text}র` : text.endsWith('ই') ? `${text}য়ের` : `${text}ের`);
const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const setText = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text;
};
const setHtml = (id, html) => {
  const el = $(id);
  if (el) el.innerHTML = html;
};

const LAND = {
  high: ['উঁচু জমি', 'High land'],
  medium_high: ['মাঝারি উঁচু জমি', 'Medium-high land'],
  medium_low: ['মাঝারি নিচু জমি', 'Medium-low land'],
  low: ['নিচু জমি', 'Low land'],
  very_low: ['খুব নিচু জমি', 'Very low land'],
};
const AMAN = {
  'BRRI dhan71': 'ব্রি ধান৭১',
  'BRRI dhan87': 'ব্রি ধান৮৭',
  'BRRI dhan103': 'ব্রি ধান১০৩',
  'BRRI dhan49': 'ব্রি ধান৪৯',
  'BRRI dhan75': 'ব্রি ধান৭৫',
};
const land = (key) => tr(...(LAND[key] || [key, key]));
const amanName = (variety) => tr(AMAN[variety] || variety, variety);

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

function applyStaticText() {
  document.documentElement.lang = lang;
  document.title = tr('Project EDEN — Earth Data & Environment Navigator · ফসল চক্র সিদ্ধান্ত সহায়ক সেবা', 'Project EDEN — Earth Data & Environment Navigator · crop rotation decision support');
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.dataset.bn === undefined) el.dataset.bn = el.innerHTML;
    const english = EN[el.dataset.i18n];
    el.innerHTML = lang === 'en' && english !== undefined ? english : el.dataset.bn;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    if (el.dataset.bnTitle === undefined) el.dataset.bnTitle = el.title;
    const english = EN[el.dataset.i18nTitle];
    el.title = lang === 'en' && english !== undefined ? english : el.dataset.bnTitle;
  });
  document.querySelectorAll('[data-num]').forEach(el => {
    el.textContent = num(el.dataset.num);
  });
  $('langBn').classList.toggle('active', lang === 'bn');
  $('langEn').classList.toggle('active', lang === 'en');
}

window.setLanguage = function(next) {
  lang = next === 'en' ? 'en' : 'bn';
  try {
    localStorage.setItem('eden.lang', lang);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  applyStaticText();
  renderAll();
};

function renderAll() {
  if (currentOverview) renderOverview(currentOverview);
  if (currentAdvice) {
    renderPlannerResults(currentAdvice);
    renderComparisonGrid(currentAdvice);
    renderTimeline(selectedOption());
    renderEvidence(currentAdvice);
    renderCompanion(currentAdvice);
    renderIpm(currentAdvice);
  }
  renderNarration();
  if (currentDataRelease) renderQuality(currentDataRelease);
  renderDataSources();
  renderClimateTrend();
  renderProfile();
  renderOfficer();
  renderAudioButton();
  window.updateWeights();
  window.updateObsWeights();
}

// ---------------------------------------------------------------------------
// Navigation and sliders
// ---------------------------------------------------------------------------

window.switchScreen = function(screenId) {
  document.querySelectorAll('.screen-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
  $(screenId)?.classList.add('active');
  document.querySelector(`[data-screen="${screenId}"]`)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (screenId === 'screen-overview') setTimeout(() => bdMap?.invalidate(), 50); // a hidden map has no size
};

document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => window.switchScreen(btn.getAttribute('data-screen')));
});

window.updateWeights = function() {
  for (const [slider, label] of [['weightWater', 'valWeightWater'], ['weightIncome', 'valWeightIncome'], ['weightSoil', 'valWeightSoil'], ['weightPest', 'valWeightPest']]) {
    setText(label, `${num($(slider).value)}%`);
  }
};

window.updateObsWeights = function() {
  for (const [slider, label] of [['obsWater', 'valObsWater'], ['obsIncome', 'valObsIncome'], ['obsSoil', 'valObsSoil'], ['obsPestPriority', 'valObsPest']]) {
    setText(label, `${num($(slider).value)}%`);
  }
};

// ---------------------------------------------------------------------------
// SCREEN 1: overview (dated research values, sample farmer rows, field pest reports)
// ---------------------------------------------------------------------------

async function loadOverview() {
  let res = await fetch(`/api/v1/overview?place=${encodeURIComponent(currentPlace)}`);
  if (!res.ok) {
    currentPlace = PILOT_PLACE;
    res = await fetch('/api/v1/overview');
  }
  currentOverview = await res.json();
  currentPlaceLive = null;
  if (currentOverview.scope.place_kind === 'upazila') {
    const live = await fetch(`/api/v1/live/upazila?id=${encodeURIComponent(currentPlace)}`);
    if (live.ok) currentPlaceLive = await live.json();
  }
  renderOverview(currentOverview);
  applyPlaceText();
}

function renderOverview(o) {
  setText('releaseTag', `${tr('রিলিজ', 'Release')}: ${o.data_release.version}`);

  renderRainStat(o);

  const smap = o.local_satellite_conditions.smap;
  if (!smap) {
    setText('statSmapValue', '—');
    setText('statSmapSub', tr('এই জায়গার SMAP মাটির রস পরের ধাপে যোগ হবে', 'SMAP soil moisture for this place comes in the next step'));
  }
  if (smap) {
    setText('statSmapValue', `${num(smap.rootZoneM3M3.toFixed(2))} m³/m³`);
    const past = smap.sameDatePastYears.map(p => tr(`${num(p.year)} সালে ${num(p.rootZoneM3M3.toFixed(2))}`, `${p.year}: ${p.rootZoneM3M3.toFixed(2)}`)).join(', ');
    setText('statSmapSub', `${isoDate(smap.date)}; ${tr('একই সময়ে', 'same time in')} ${past}`);
    setText('dataDateBadge', `${tr('সর্বশেষ ডেটা', 'Latest data')}: ${isoDate(smap.date)}`);
  }

  setText('statVarietyValue', tr(o.recommended.amanVarietyBangla, o.recommended.amanVariety));
  setText('statVarietySub', tr(`${bnDateOf(o.recommended.fieldFreeDateBangla)} মধ্যে জমি খালি`, `Field free by ${o.recommended.fieldFreeDateEnglish}`));

  const pilot = o.scope.place_kind !== 'upazila';
  setText('mapPinLabel', pilot
    ? `${tr('তানোর পাইলট পয়েন্ট', 'Tanore pilot point')} (${num(o.scope.lat)}° N, ${num(o.scope.lon)}° E)`
    : `${o.scope.district} ${tr('জেলার পয়েন্ট', 'district point')} (${num(o.scope.lat.toFixed(2))}° N, ${num(o.scope.lon.toFixed(2))}° E)`);
  setText('specSoil', o.context.soilTypeBangla
    ? tr(`${o.context.soilTypeBangla}, ${o.context.landTypeBangla}`, `${o.context.soilTypeEnglish}, ${o.context.landTypeEnglish}`)
    : tr('এই উপজেলার SRDI কার্ড এখনো যোগ হয়নি', 'This upazila’s SRDI card is not added yet'));
  const gw = o.context.groundwater;
  setText('specGroundwater', gw ? tr(
    `বছরে ${num(gw.trendMmPerYear)} মিমি (${num(gw.period.replace(' to ', ' থেকে '))}: ${num(gw.changeMm)} মিমি)`,
    `${gw.trendMmPerYear} mm a year (${gw.changeMm} mm, ${gw.period})`,
  ) : '—');
  const green = o.context.winterGreenness;
  setText('specGreenness', green
    ? `NDVI ${num(green.early.peakNdvi)} → ${num(green.recent.peakNdvi)}; ${tr('বছরে ফসল', 'crops a year')} ${num(green.early.cyclesPerYear)} → ${num(green.recent.cyclesPerYear)}`
    : tr('এখনো শুধু পাইলট এলাকায়', 'Pilot places only so far'));
  setText('specBmd', o.context.bmdStation ? tr(
    `${o.context.bmdStationBangla} (${num(o.context.bmdStationKm)} কিমি দূরে)`,
    `${pilot ? 'Shah Mokhdum, Rajshahi (41895)' : o.context.bmdStation}, ${o.context.bmdStationKm} km away`,
  ) : tr('১০০ কিমির মধ্যে BMD স্টেশন নেই; তাপমাত্রা সংশোধন ছাড়া', 'No BMD station within 100 km; temperatures uncorrected'));

  const alert = o.active_alerts[0];
  if (alert) {
    setText('alertTitle', `${tr('সতর্কতা', 'Alert')}: ${tr(alert.titleBangla, alert.titleEnglish)}`);
    setText('alertText', tr(alert.textBangla, alert.textEnglish));
    setText('alertSolution', tr(alert.recommendationBangla, alert.recommendationEnglish));
  }

  const status = {
    callback: ['badge-warning', 'কল-ব্যাক অনুরোধ', 'Call-back requested'],
    verified: ['badge-success', 'কর্মকর্তা যাচাইকৃত', 'Officer-verified'],
    pending: ['badge-neutral', 'মাঠ যাচাই বাকি', 'Field check pending'],
  };
  setHtml('recentFarmersTable', (o.recent_farmer_contacts || []).map(f => {
    const [cls, bn, en] = status[f.status] || status.pending;
    return `
    <tr>
      <td><strong>${escapeHtml(tr(f.name, f.nameEnglish))}</strong> <span class="tag tag-yellow">${tr('নমুনা', 'sample')}</span></td>
      <td>${escapeHtml(tr(f.village, f.villageEnglish))} (${escapeHtml(land(f.landType))})</td>
      <td>${f.nextSeasonRotation ? `<small>${tr('এ মৌসুম', 'This season')}:</small> ` : ''}<span class="tag tag-green">${escapeHtml(tr(f.rotation, f.rotationEnglish))}</span>${f.nextSeasonRotation ? `<br><small>${tr('আগামী মৌসুম', 'Next season')}: ${escapeHtml(tr(f.nextSeasonRotation, f.nextSeasonRotationEnglish))}</small>` : ''}</td>
      <td><span class="badge ${cls}">${tr(bn, en)}</span></td>
      <td><button class="btn btn-sm" onclick="switchScreen('screen-officer')">${tr('কর্মকর্তা ডেস্ক', 'Officer desk')}</button></td>
    </tr>`;
  }).join(''));

  const reports = pestReportsHtml(o.pest_reports || []);
  setHtml('overviewPestReports', reports);
  setHtml('ipmField', reports);
  setText('policyRelease', o.data_release.version);
  if (o.early_warnings) renderWarnings(o.early_warnings, o.aman_replay);
  applyAreaScope();
}

// ---------------------------------------------------------------------------
// Which area the page describes, and which parts belong only to the manager's own area
// ---------------------------------------------------------------------------

/** The dashboard names the Tanore pilot 'talanda_tanore' and its upazila row 'ADM3_Tanore': one place. */
const samePlace = (a, b) => (a === 'ADM3_Tanore' ? PILOT_PLACE : a) === (b === 'ADM3_Tanore' ? PILOT_PLACE : b);

/** The place the numbers on the page describe, as "Upazila, District" (the overview scope the server answered with). */
function placeLabel() {
  const scope = currentOverview?.scope;
  if (!scope || scope.place_kind !== 'upazila') return tr('তানোর, রাজশাহী', 'Tanore, Rajshahi');
  return `${scope.upazila}, ${scope.district}`;
}

function homeAreaLabel() {
  if (!homeArea) return '';
  if (samePlace(homeArea.placeId, PILOT_PLACE)) return tr('তানোর, রাজশাহী', 'Tanore, Rajshahi');
  return tr(`${homeArea.nameBangla}${homeArea.district ? `, ${homeArea.district}` : ''}`, `${homeArea.nameEnglish}`);
}

/** A signed-in manager looking at an area other than their own (their own = the site in their verified token). */
function isAwayFromHome() {
  return Boolean(officerSession && homeArea && !samePlace(currentPlace, homeArea.placeId));
}

/** The climate answer, only when it was fetched for the place now on screen. */
function climateForThisPlace() {
  return climateTrend.state === 'ok' && climateTrend.place === currentPlace ? climateTrend.data : null;
}

const dateTime = (iso) => new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
const dateRangeText = (from, to) => `${isoDate(from)} – ${isoDate(to)}`;

/** One primary 30-day rainfall figure (NASA POWER, with its source and dates); the release snapshot is a labelled second line. */
function renderRainStat(o) {
  const snap = o.local_satellite_conditions.rain_last_30_days; // exists for the Tanore pilot only
  const power = climateForThisPlace()?.indicators?.rainfall;
  const area = placeLabel();
  const snapLine = snap ? tr(
    `স্ন্যাপশট, লাইভ নয় (${dateRangeText(snap.from, snap.to)}): ${num(Math.round(snap.imergLateMm))} মিমি, স্বাভাবিকের ${num(snap.pctOfNormal.imergLate)}% (IMERG Late), ${num(snap.pctOfNormal.imergAdjusted)}% (সমন্বিত), ${num(snap.pctOfNormal.merra2)}% (MERRA-2); ${snap.verdictBangla}`,
    `Snapshot, not live (${dateRangeText(snap.from, snap.to)}): ${Math.round(snap.imergLateMm)} mm, ${snap.pctOfNormal.imergLate}% of normal (IMERG Late), ${snap.pctOfNormal.imergAdjusted}% (corrected), ${snap.pctOfNormal.merra2}% (MERRA-2); ${snap.verdict}`,
  ) : '';
  if (power && power.totalMm !== null && power.totalMm !== undefined) {
    const pct = power.anomalyPercent === null || power.anomalyPercent === undefined ? null : Math.round(100 + power.anomalyPercent);
    setText('statRainValue', `${num(Math.round(power.totalMm))} ${tr('মিমি', 'mm')}`);
    setText('statRainSub', tr(
      `NASA POWER, ${area}, ${dateRangeText(power.dateRange.from, power.dateRange.to)}${pct === null ? '' : `: ১০ বছরের স্বাভাবিক ${num(Math.round(power.normalMm))} মিমির ${num(pct)}%`}`,
      `NASA POWER, ${area}, ${dateRangeText(power.dateRange.from, power.dateRange.to)}${pct === null ? '' : `: ${pct}% of the 10-year normal of ${Math.round(power.normalMm)} mm`}`,
    ));
    setText('statRainSub2', snapLine);
  } else if (snap) {
    setText('statRainValue', `${num(Math.round(snap.imergLateMm))} ${tr('মিমি', 'mm')}`);
    setText('statRainSub', snapLine);
    setText('statRainSub2', '');
  } else if (currentPlaceLive) {
    const p = currentPlaceLive.power;
    setText('statRainValue', `${num(Math.round(p.rain30))} ${tr('মিমি', 'mm')}`);
    setText('statRainSub', tr(
      `দৈনিক হালনাগাদ ফাইল (NASA POWER), ${area}: স্বাভাবিকের ${num(p.rain30PctOfNormal ?? '—')}%; ${isoDate(p.date)} পর্যন্ত`,
      `Daily update file (NASA POWER), ${area}: ${p.rain30PctOfNormal ?? '—'}% of normal; to ${isoDate(p.date)}`));
    setText('statRainSub2', '');
  } else {
    setText('statRainValue', '—');
    setText('statRainSub', tr('দৈনিক নাসা হালনাগাদ এখনো চলেনি', 'The daily NASA update has not run yet'));
    setText('statRainSub2', '');
  }
}

/** "How fresh is this data": the live NASA POWER download and the dated release snapshot, never mixed up. */
function renderFreshness() {
  const o = currentOverview;
  if (!o) return;
  const area = placeLabel();
  let power;
  if (!officerSession) {
    power = tr('NASA POWER আবহাওয়া: ম্যানেজার হিসেবে প্রবেশ করলে দেখা যাবে', 'NASA POWER weather: shown after a manager signs in');
  } else if (climateTrend.state === 'error') {
    power = tr(`NASA POWER আবহাওয়া (${area}): এখন পাওয়া যায়নি`, `NASA POWER weather (${area}): not available now`);
  } else if (!climateForThisPlace()) {
    power = tr(`NASA POWER আবহাওয়া (${area}): আসছে…`, `NASA POWER weather (${area}): loading…`);
  } else {
    const c = climateForThisPlace();
    const source = c.dataSource === 'live' ? tr('সরাসরি ডাউনলোড', 'live download')
      : c.dataSource === 'fixture' ? tr('নমুনা ফাইল', 'sample file') : tr('সংরক্ষিত কপি', 'saved copy');
    power = tr(
      `NASA POWER আবহাওয়া (${area}): ${isoDate(c.dataDateRange.to)} পর্যন্ত · ${source} · ডাউনলোড ${dateTime(c.fetchedAt)}`,
      `NASA POWER weather (${area}): to ${isoDate(c.dataDateRange.to)} · ${source} · downloaded ${dateTime(c.fetchedAt)}`);
  }
  const smap = o.local_satellite_conditions.smap;
  const rain = o.local_satellite_conditions.rain_last_30_days;
  const snapshot = o.scope.place_kind === 'upazila' || !smap
    ? tr('স্যাটেলাইট রিলিজ স্ন্যাপশট: শুধু তানোর পাইলটের জন্য; এই এলাকায় আছে ২০০১–২০২৫ সালের জেলা রিপ্লে (ইতিহাস, লাইভ নয়)',
      'Satellite release snapshot: for the Tanore pilot only; this area has the 2001–2025 district replay (history, not live)')
    : tr(
      `স্যাটেলাইট রিলিজ স্ন্যাপশট ${o.data_release.version} (লাইভ নয়): SMAP ${isoDate(smap.date)}${rain ? `, বৃষ্টি ${isoDate(rain.to)}` : ''} পর্যন্ত`,
      `Satellite release snapshot ${o.data_release.version} (not live): SMAP to ${isoDate(smap.date)}${rain ? `, rain to ${isoDate(rain.to)}` : ''}`);
  setText('freshPower', power);
  setText('freshSnapshot', snapshot);
}

/**
 * Applies "which area is this" to the page: area names on card titles, the manager's own area in the header, the comparison banner,
 * and the parts that belong only to the manager's own area (farmers, call-backs, observations, SRDI card, alerts, officer notes),
 * which are replaced by a plain note while another area is selected.
 */
function applyAreaScope() {
  const away = isAwayFromHome();
  const label = placeLabel();
  document.querySelectorAll('[data-area-name]').forEach(el => { el.textContent = label; });

  const geoHome = $('geoHome');
  if (geoHome) {
    geoHome.hidden = !(officerSession && homeArea);
    geoHome.textContent = `${tr('আপনার এলাকা', 'Your area')}: ${homeAreaLabel()}`;
  }
  document.querySelector('.location-badge')?.classList.toggle('geo-away', away);
  const banner = $('areaBanner');
  if (banner) {
    banner.hidden = !away;
    setText('areaBannerText', tr(`তুলনা, আপনার এলাকা নয়: ${label}। আপনার এলাকা: ${homeAreaLabel()}। কৃষক, কল-ব্যাক, মাঠ পর্যবেক্ষণ, মাটির কার্ড ও সতর্কতা শুধু আপনার এলাকার জন্য।`,
      `Comparison, not your area: ${label}. Your area: ${homeAreaLabel()}. Farmers, call-backs, field observations, the soil card and alerts are only for your own area.`));
  }
  for (const id of ['screen-officer', 'screen-delivery']) $(id)?.classList.add('private-block');
  document.querySelectorAll('.private-block').forEach(block => {
    block.classList.toggle('is-away', away);
    let note = block.querySelector(':scope > .private-away-note');
    if (away && !note) {
      note = document.createElement('p');
      note.className = 'private-away-note';
      block.append(note);
    }
    if (note) {
      note.hidden = !away;
      note.textContent = tr('এই এলাকার জন্য কর্মকর্তার তথ্য নেই', 'No officer data for this area');
    }
  });
  const hasWarnings = Boolean(currentOverview?.early_warnings);
  if ($('warningsHeading')) $('warningsHeading').hidden = !hasWarnings;
  if ($('warningsRow')) $('warningsRow').hidden = !hasWarnings;
  renderFreshness();
}

/** The manager's own area comes from the verified token (GET /api/v1/manager/area); the demo officer is the Talanda site. */
async function loadHomeArea() {
  homeArea = null;
  if (!officerSession) return;
  if (officerSession.source === 'demo') {
    if (officerSession.officer?.site === 'talanda') homeArea = { siteId: 'talanda', placeId: PILOT_PLACE, nameBangla: 'তালন্দ, তানোর', nameEnglish: 'Talanda, Tanore', district: 'Rajshahi' };
  } else {
    try {
      const res = await fetch('/api/v1/manager/area', { headers: { Authorization: `Bearer ${await officerToken()}` } });
      homeArea = res.ok ? await res.json() : null;
    } catch {
      homeArea = null;
    }
  }
  // right after sign-in the page opens on the manager's own area, whatever area was picked before
  if (homeArea && !homeAreaApplied) {
    homeAreaApplied = true;
    if (!samePlace(currentPlace, homeArea.placeId)) {
      syncPlaceSelects(homeArea.placeId);
      await choosePlace(homeArea.placeId, { skipClimate: true });
    }
  }
  applyAreaScope();
}

window.returnToMyArea = async function() {
  if (!homeArea) return;
  syncPlaceSelects(homeArea.placeId);
  await choosePlace(homeArea.placeId);
};


// "3 of 5" -> "৫টির ৩টি" in Bangla, unchanged in English
const ofText = (s) => {
  const m = /^(\d+) of (\d+)$/.exec(s || '');
  return m ? tr(`${num(m[2])}টির ${num(m[1])}টি`, s) : s;
};
const monthName = (m) => tr(BN_MONTHS[m - 1], EN_MONTHS[m - 1]);

function haorChartSvg(h) {
  const W = 560, H = 190, L = 34, R = 8, T = 12, B = 26, max = 400;
  const bw = (W - L - R) / h.seasons.length;
  const y = (v) => T + (H - T - B) * (1 - Math.min(v, max) / max);
  const fill = (s) => (s.label === 'flood' ? '#d97706' : s.label === 'no flood' ? '#0284c7' : '#94a3b8');
  const bars = h.seasons.map((s, i) => `<rect x="${(L + i * bw + 2).toFixed(1)}" y="${y(s.sohraMax3Mm).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(H - B - y(s.sohraMax3Mm)).toFixed(1)}" rx="2" fill="${fill(s)}"><title>${s.year}: ${s.sohraMax3Mm} mm</title></rect>`).join('');
  const rule = (v, dash, label) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#b91c1c" stroke-width="1.5" stroke-dasharray="${dash}"/><text x="${W - R}" y="${y(v) - 4}" text-anchor="end" font-size="11" fill="#b91c1c">${label}</text>`;
  const years = h.seasons.map((s, i) => (s.year % 4 === 1 ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#64748b">${num(s.year)}</text>` : '')).join('');
  const axis = [0, 100, 200, 300, 400].map(v => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${num(v)}</text>`).join('');
  const label = tr('সোহরায় বসন্তের সর্বোচ্চ ৩ দিনের বৃষ্টি, ২০০১–২০২৫', 'Largest 3-day spring rain at Sohra, 2001–2025');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" aria-label="${label}">${axis}${bars}${rule(h.watchMm, '5 4', tr(`সতর্কতা ${num(h.watchMm)} মিমি`, `watch ${h.watchMm} mm`))}${rule(h.warningMm, '2 3', tr(`বিপদ ${num(h.warningMm)} মিমি`, `warning ${h.warningMm} mm`))}${years}</svg>`;
}

function cattleChartSvg(c) {
  const W = 560, H = 150, L = 34, R = 8, T = 10, B = 24;
  const bw = (W - L - R) / 12;
  const y = (v) => T + (H - T - B) * (1 - v);
  const bars = c.months.map((m, i) => `<rect x="${(L + i * bw + 3).toFixed(1)}" y="${y(m.dangerShare).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${(H - B - y(m.dangerShare)).toFixed(1)}" rx="2" fill="${c.noReliefMonths.includes(m.month) ? '#b91c1c' : '#f59e0b'}"><title>${EN_MONTHS[m.month - 1]}: ${Math.round(m.dangerShare * 100)}%</title></rect>`).join('');
  const months = c.months.map((m, i) => `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(monthName(m.month).slice(0, lang === 'en' ? 3 : 4))}</text>`).join('');
  const axis = [0, 0.5, 1].map(v => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${num(Math.round(v * 100))}%</text>`).join('');
  const label = tr('মাসভিত্তিক বিপদসীমার ঘণ্টা', 'Share of hours in the danger bands, by month');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" aria-label="${label}">${axis}${bars}${months}</svg>`;
}

function renderWarnings(w, amanReplay) {
  const h = w.haor;
  const badge = $('haorStatus');
  const liveSohra = h.live?.upstream?.[0];
  if (h.live?.inSeason && liveSohra && ['watch', 'warning'].includes(liveSohra.level)) {
    badge.className = liveSohra.level === 'warning' ? 'badge badge-danger' : 'badge badge-warning';
    badge.textContent = tr(`${liveSohra.level === 'warning' ? 'বিপদ' : 'সতর্কতা'}: সোহরায় ৩ দিনে ${num(liveSohra.rain3Adj)} মিমি`, `${liveSohra.level === 'warning' ? 'Warning' : 'Watch'}: ${liveSohra.rain3Adj} mm in 3 days at Sohra`);
  } else if (h.status.state === 'in_season') {
    badge.className = 'badge badge-warning';
    badge.textContent = tr('মৌসুম চলছে: নজরদারি', 'In season: monitoring');
  } else {
    badge.className = 'badge badge-neutral';
    badge.textContent = tr(`মৌসুম শুরু ${isoDate(h.status.nextStart)}`, `Season opens ${isoDate(h.status.nextStart)}`);
  }
  setText('haorRule', tr(
    `১৫ মার্চ–১৫ মে: মেঘালয়ের সোহরায় (চেরাপুঞ্জি) ৩ দিনে ${num(h.watchMm)} মিমি বৃষ্টি হলে সতর্কতা, ${num(h.warningMm)} মিমি হলে বিপদবার্তা। সোহরা পৃথিবীর সবচেয়ে বৃষ্টিবহুল স্থানের একটি, তাই কোনো কল যাওয়ার আগে নদীর পানির উচ্চতা (FFWC) দিয়ে নিশ্চিত হতে হবে।`,
    `15 Mar–15 May: ${h.watchMm} mm of rain in 3 days at Sohra (Cherrapunji, Meghalaya) raises a watch, ${h.warningMm} mm a warning. Sohra is one of the wettest places on Earth, so river gauges (FFWC) must confirm before any call goes out.`,
  ));
  setHtml('haorChart', haorChartSvg(h));
  setText('haorLegend', tr('কমলা: বন্যার বছর (FFWC) • নীল: বন্যাহীন বছর • ধূসর: রিপোর্ট নেই', 'Orange: flood years (FFWC) • Blue: no-flood years • Grey: no report'));
  const watch = h.skill.find(s => s.thresholdMm === h.watchMm);
  const dhan28 = h.escapeOnCalendar.find(e => e.variety === 'BRRI dhan28');
  const others = h.escapeOnCalendar.filter(e => e.variety !== 'BRRI dhan28');
  const othersEarly = h.escapeTwoWeeksEarly.filter(e => e.variety !== 'BRRI dhan28');
  const worstOther = Math.max(...others.map(e => e.burstsBeforeHarvest));
  const worstEarly = Math.max(...othersEarly.map(e => e.burstsBeforeHarvest));
  setHtml('haorFacts', [
    liveHaorLines(h.live),
    watch ? tr(
      `<li><strong>২৫ বছরের পরীক্ষা:</strong> ${num(h.watchMm)} মিমি নিয়মে বন্যার বছর ধরা পড়ে ${ofText(watch.floodYearsCaught)}, বন্যাহীন বছরে ভুল সংকেত ${ofText(watch.noFloodYearsFlagged)}; সংকেত ${ofText(watch.seasonsFlagged)} মৌসুমে।</li>`,
      `<li><strong>25-year hindcast:</strong> the ${h.watchMm} mm rule catches ${watch.floodYearsCaught} flood years, with false alarms in ${watch.noFloodYearsFlagged} no-flood years; it flags ${watch.seasonsFlagged} springs.</li>`,
    ) : '',
    dhan28 ? tr(
      `<li><strong>কোন বোরো বাঁচে:</strong> ${num(h.warningMm)} মিমির ঢলে ব্রি ধান২৮ পাকার আগে ধরা পড়েছে ${num(dhan28.bursts)}টির ${num(dhan28.burstsBeforeHarvest)}টিতে; অন্য ${num(others.length)}টি জাত (${others.map(e => num(e.variety.replace('BRRI dhan', ''))).join(', ')}) সর্বোচ্চ ${num(worstOther)}টিতে; দুই সপ্তাহ আগে বুনলে ${num(worstEarly)}টিতে।</li>`,
      `<li><strong>Which Boro escapes:</strong> ${h.warningMm} mm bursts caught BRRI dhan28 before harvest in ${dhan28.burstsBeforeHarvest} of ${dhan28.bursts}; the other ${others.length} varieties (BRRI dhan${others.map(e => e.variety.replace('BRRI dhan', '')).join(', ')}) in at most ${worstOther}; sown two weeks early, ${worstEarly}.</li>`,
    ) : '',
    tr('<li>হাওরের ফসল চক্র এখনো মডেল করা হয়নি; এটি আগাম সতর্কতা ব্যবস্থা।</li>', '<li>Rotation advice is not modelled for the haor yet; this is the early-warning system.</li>'),
  ].join(''));

  const n = w.warmNights;
  const flower = (variety) => amanReplay?.find(r => r.variety === variety);
  const f71 = flower('BRRI dhan71');
  const f49 = flower('BRRI dhan49');
  const sig = (t) => (t.kendallP < 0.05 ? tr('তাৎপর্যপূর্ণ', 'significant') : tr(`স্পষ্ট নয় (p ${num(t.kendallP.toFixed(2))})`, `not clear (p ${t.kendallP.toFixed(2)})`));
  setHtml('nightFacts', [
    tr(
      `<li><strong>ব্রি ধান৭১</strong> (ফুল ~${f71?.floweringBangla ?? ''}): রাতের গড় ${num(n.dhan71.mean1991to2005.toFixed(1))}°C (১৯৯১–২০০৫) থেকে ${num(n.dhan71.mean2011to2025.toFixed(1))}°C (২০১১–২০২৫); প্রতি দশকে +${num(n.dhan71.trendPerDecade)}°C, ${sig(n.dhan71)}।</li>`,
      `<li><strong>BRRI dhan71</strong> (flowers ~${f71?.floweringEnglish ?? ''}): nights averaged ${n.dhan71.mean1991to2005.toFixed(1)}°C in 1991–2005 and ${n.dhan71.mean2011to2025.toFixed(1)}°C in 2011–2025; +${n.dhan71.trendPerDecade}°C a decade, ${sig(n.dhan71)}.</li>`,
    ),
    tr(
      `<li><strong>ব্রি ধান৪৯</strong> (ফুল ~${f49?.floweringBangla ?? ''}): প্রতি দশকে +${num(n.dhan49.trendPerDecade)}°C, ${sig(n.dhan49)}।</li>`,
      `<li><strong>BRRI dhan49</strong> (flowers ~${f49?.floweringEnglish ?? ''}): +${n.dhan49.trendPerDecade}°C a decade, ${sig(n.dhan49)}.</li>`,
    ),
    tr(
      `<li><strong>সুখবর:</strong> ২০ নভেম্বরে বোনা গমে দানা পুষ্টের গরম দিন প্রতি দশকে ${num(Math.abs(n.wheat20Nov.trendPerDecade).toFixed(1))}টি কমেছে (${sig(n.wheat20Nov)})।</li>`,
      `<li><strong>Good news:</strong> hot days at grain filling for wheat sown on 20 Nov fell by ${Math.abs(n.wheat20Nov.trendPerDecade).toFixed(1)} a decade (${sig(n.wheat20Nov)}).</li>`,
    ),
    tr('<li>আগাম আমন পানি ও সময় বাঁচায়, কিন্তু উষ্ণ রাতে ফুল আসে; কর্মকর্তারা চিটা ও ফলন নজরে রাখবেন।</li>', '<li>Early Aman saves water and time but flowers into warmer nights; officers should watch for empty grains and yield.</li>'),
  ].join(''));

  const c = w.cattleHeat;
  const noRelief = c.noReliefMonths.map(monthName);
  const peak = Math.round(c.peakDangerShare * 100);
  const cattleBadge = $('cattleBadge');
  cattleBadge.textContent = tr(`${num(c.noReliefMonths.length)} মাস রাতেও স্বস্তি নেই`, `${c.noReliefMonths.length} months without night relief`);
  setText('cattleLead', tr(
    `${noRelief[0]}–${noRelief[noRelief.length - 1]}: রাতেও তাপ-আর্দ্রতা সূচক (THI) ৭২-এর নিচে নামে না; ${monthName(c.peakMonth)}-এ ${num(peak)}% ঘণ্টা বিপদসীমায়।`,
    `${noRelief[0]}–${noRelief[noRelief.length - 1]}: the temperature-humidity index (THI) stays above 72 even at night; in ${monthName(c.peakMonth)} ${peak}% of hours are in the danger bands.`,
  ));
  setHtml('cattleChart', cattleChartSvg(c));
  const [first, , , last] = c.coolestHours;
  setHtml('cattleFacts', [
    tr(
      `<li>দিনের সবচেয়ে ঠান্ডা সময় রাত ${num(first)}–${num(last)}: খাওয়ানো ও ভারী কাজ ভোরের দিকে রাখুন, ছায়া ও পানি দিন।</li>`,
      `<li>The coolest hours are ${first}–${last}: keep feeding and heavy work near dawn; give shade and water.</li>`,
    ),
    tr('<li>উৎস: নাসা POWER ঘণ্টাভিত্তিক তাপমাত্রা ও আর্দ্রতা (২০২৩–২০২৫), THI (NRC ১৯৭১)।</li>', '<li>Source: NASA POWER hourly temperature and humidity (2023–2025), THI (NRC 1971).</li>'),
  ].join(''));
}

function renderLedger(advice) {
  const rows = advice.options.filter(o => o.ledger);
  const yesNo = (v) => (v ? tr('হ্যাঁ', 'yes') : tr('না', 'no'));
  setHtml('ledgerTable', `
    <table class="data-table ledger-table">
      <thead><tr>
        <th>${tr('চক্র', 'Rotation')}</th>
        <th>${tr('ভূগর্ভস্থ পানি তোলা (ঘনমিটার/হেক্টর)', 'Groundwater pumped (m³/ha)')}</th>
        <th>${tr('জলাবদ্ধ ধানের দিন (মিথেন সূচক)', 'Flooded-rice days (methane proxy)')}</th>
        <th>${tr('ইউরিয়া (কেজি/হেক্টর)', 'Urea (kg/ha)')}</th>
        <th>${tr('ডাল ফসল', 'Legume')}</th>
        <th>${tr('খালি জমির দিন', 'Bare days')}</th>
        <th>${tr('বালাই স্কোর', 'Pest score')}</th>
      </tr></thead>
      <tbody>${rows.map(o => `
        <tr class="${o.isBaseline ? 'baseline-row' : o.rank === 1 ? 'top-row' : ''}">
          <td>${escapeHtml(tr(o.nameBangla, o.nameEnglish))}${o.isBaseline ? ` <span class="tag tag-yellow">${tr('প্রচলিত', 'current practice')}</span>` : ''}</td>
          <td>${bigNum(o.ledger.groundwaterPumpedM3PerHa)}</td>
          <td>${num(o.ledger.floodedRiceDays)}</td>
          <td>${o.ledger.ureaKgHa === null ? '—' : num(o.ledger.ureaKgHa)}</td>
          <td>${yesNo(o.ledger.legume)}</td>
          <td>${num(o.ledger.bareDays)}</td>
          <td>${num(Math.round((o.scores.pest ?? 0) * 100))}</td>
        </tr>`).join('')}
      </tbody>
    </table>${rows.some(o => o.ledger.ureaKgHa === null) ? `<p class="muted small">${escapeHtml(noSoilCard())}</p>` : ''}`);
}

function pestReportsHtml(reports) {
  if (!reports.length) {
    return `<p class="muted">${tr('এখনো কোনো বালাইয়ের খবর নেই। কর্মকর্তা মাঠে বালাই দেখলে এখানে আসবে।', 'No pest reports yet. They appear here when an officer logs a pest in the field.')}</p>`;
  }
  return reports.map(r => `
    <div class="pest-report">
      <span class="pest-name">🐛 ${escapeHtml(tr(r.bn, r.en))}</span>
      <span>${tr(`${num(r.fields)}টি জমি`, `${r.fields} field${r.fields === 1 ? '' : 's'}`)}${r.highSeverity ? ` • <span class="badge badge-danger">${tr(`${num(r.highSeverity)}টিতে বেশি`, `${r.highSeverity} severe`)}</span>` : ''}</span>
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// SCREENS 2-3: planner and comparison, from /api/v1/advice
// ---------------------------------------------------------------------------

window.runPlannerCalculation = async function(options = {}) {
  const weight = (id) => parseFloat($(id).value) / 100;
  try {
    const res = await fetch('/api/v1/advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unionId: currentPlace,
        unionNameBangla: 'তালন্দ ইউনিয়ন',
        upazila: 'Tanore',
        district: 'Rajshahi',
        landType: $('planLandType').value,
        currentAmanCrop: $('planAmanCrop').value,
        preferredCrops: selectedCrops(),
        heroCrop: $('planHeroCrop')?.value || undefined,
        avoidCrops: $('planNoRice')?.checked ? ['rice'] : undefined,
        season: '2026-aman',
        farmerPriorities: { water: weight('weightWater'), income: weight('weightIncome'), soil: weight('weightSoil'), pest: weight('weightPest') },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setHtml('plannerResultsContainer', `<p class="officer-error">${escapeHtml(data.error || tr('পরামর্শ তৈরি করা যায়নি', 'Could not build the advice'))}</p>`);
      return;
    }
    currentAdvice = data;
    selectedOptionId = data.options[0].id;
    renderPlannerResults(data);
    renderComparisonGrid(data);
    renderTimeline(selectedOption());
    renderEvidence(data);
    renderCompanion(data);
    renderIpm(data);
    await loadNarration(selectedOption());
    if (options.switchScreenAfter !== false) window.switchScreen('screen-comparison');
  } catch (err) {
    console.error('Failed to calculate advice:', err);
  }
};

function selectedOption() {
  return currentAdvice?.options.find(o => o.id === selectedOptionId) || currentAdvice?.options[0];
}

function renderPlannerResults(advice) {
  setText('plannerCountBadge', tr(`${num(advice.options.length)}টি বিকল্প তৈরি হয়েছে`, `${advice.options.length} options generated`));

  const note = $('thisSeasonNote');
  note.hidden = !advice.this_season;
  note.textContent = advice.this_season ? tr(`এই মৌসুম: ${advice.this_season.noteBangla}`, `This season: ${advice.this_season.noteEnglish}`) : '';
  renderCropChoice(advice);

  setHtml('plannerResultsContainer', advice.options.map((opt, idx) => `
    <div class="candidate-card-summary ${idx === 0 ? 'selected' : ''}" onclick="selectCandidateOption('${opt.id}')">
      <div class="candidate-top">
        <h4>${num(opt.rank)}. ${escapeHtml(tr(opt.nameBangla, opt.nameEnglish))}</h4>
        <span class="candidate-score-pill">${tr('স্কোর', 'Score')}: ${num(Math.round(opt.totalWeightedScore * 100))}%</span>
      </div>
      ${coverageTag(advice, opt.id)}
      <p class="candidate-meta">
        ${tr('জমি খালি', 'Field free')}: <strong>${escapeHtml(tr(opt.fieldFreeDateBangla, opt.fieldFreeDateEnglish))}</strong>${opt.isBaseline ? ` • ${tr('বর্তমান প্রচলিত চক্র', 'current practice')}` : ''}${opt.id === advice.this_season_option_id ? ` <span class="tag tag-green">${tr('এ মৌসুমে সম্ভব', 'possible this season')}</span>` : ''}
      </p>
      <div class="candidate-action">${escapeHtml(tr(opt.approvedActionBangla[2] || '', (opt.approvedActionEnglish || [])[2] || ''))}</div>
    </div>
  `).join(''));
}

const DIMENSIONS = {
  water: ['পানির সাশ্রয় (Water)', 'Water saving'],
  heat: ['তাপমাত্রা সহনশীলতা (Heat)', 'Heat tolerance'],
  flood: ['প্লাবন নিরাপত্তা (Flood)', 'Flood safety'],
  soil: ['মাটি স্বাস্থ্য (Soil)', 'Soil health'],
  fodder: ['গবাদিপশুর খাদ্য (Fodder)', 'Livestock fodder'],
  income: ['আয় (Income)', 'Income'],
  pest: ['বালাই চাপ ও কীটনাশক (Pest)', 'Pest pressure & pesticide'],
};

function dimensionTag(detail) {
  if (detail?.staleOrMissing) return tr('নমুনা', 'sample');
  if (detail?.provenance?.measuredOrModeled === 'assumed') return tr('অনুমান', 'assumed');
  return '';
}

function renderComparisonGrid(advice) {
  setHtml('comparisonCardsGrid', advice.options.map(opt => {
    const isRec = opt.rank === 1;
    return `
      <div class="comp-card ${isRec ? 'recommended' : ''}">
        <div class="comp-card-badge">
          ${isRec ? `<span class="badge badge-success">${tr('⭐ সর্বোচ্চ সুপারিশকৃত (Rank #১)', '⭐ Top recommendation (rank #1)')}</span>` : `<span class="badge badge-neutral">${tr(`বিকল্প #${num(opt.rank)}`, `Option #${opt.rank}`)}</span>`}
          ${opt.isBaseline ? `<span class="badge badge-warning">${tr('বর্তমান প্রচলিত', 'Current practice')}</span>` : ''}
        </div>
        <h3 class="comp-card-title">${escapeHtml(tr(opt.nameBangla, opt.nameEnglish))}</h3>
        <div class="dimensions-breakdown">
          ${Object.entries(opt.scores).map(([dimId, score]) => {
            const pct = Math.round(score * 100);
            const detail = opt.dimensionDetails[dimId];
            const tag = dimensionTag(detail);
            return `
              <div class="dim-item">
                <div class="dim-header">
                  <span>${tr(...(DIMENSIONS[dimId] || [dimId, dimId]))}${tag ? ` <span class="tag tag-yellow">${tag}</span>` : ''}</span>
                  <span>${num(pct)}/${num(100)}</span>
                </div>
                <div class="dim-bar-wrap"><div class="dim-bar-fill ${dimId}" style="width: ${pct}%"></div></div>
                <span class="dim-note">${escapeHtml(tr(detail?.summaryBangla, detail?.summaryEnglish))}</span>
              </div>`;
          }).join('')}
        </div>
        <div class="field-free-indicator">
          <span>${tr('জমি খালি হওয়ার তারিখ:', 'Field free by:')}</span>
          <strong>${escapeHtml(tr(opt.fieldFreeDateBangla, opt.fieldFreeDateEnglish))}</strong>
        </div>
        <button class="btn btn-sm ${isRec ? 'btn-primary' : 'btn-secondary'}" style="margin-top: 12px;" onclick="selectCandidateOption('${opt.id}')">
          ${isRec ? tr('এই চক্রটি নিশ্চিত করুন', 'Confirm this rotation') : tr('বিস্তারিত দেখুন', 'See details')}
        </button>
      </div>`;
  }).join(''));
}

function renderTimeline(option) {
  if (!option) return;
  setHtml('timelineContainer', option.timeline.map(slot => `
    <div class="timeline-month-col">
      <div class="month-label">${tr(slot.monthNameBangla, slot.monthNameEnglish)}</div>
      <div class="slot-indicator ${slot.status}">${escapeHtml(tr(slot.cropName, slot.cropNameEnglish))}</div>
    </div>
  `).join(''));
}

window.selectCandidateOption = async function(optionId) {
  if (!currentAdvice) return;
  selectedOptionId = optionId;
  renderTimeline(selectedOption());
  renderStewardship(selectedOption());
  await loadNarration(selectedOption());
  window.switchScreen('screen-delivery');
};

// ---------------------------------------------------------------------------
// SCREEN 4: evidence built from the advice and the overview
// ---------------------------------------------------------------------------

function renderEvidence(advice) {
  const top = advice.options[0];
  const [monsoon, rabi] = top.cropSequence;
  // Plans built around another crop may have no Aman: the monsoon phase is then another crop or an empty field
  const aman = monsoon.seasonType === 'Aman' ? monsoon : { variety: monsoon.crop, varietyBangla: monsoon.cropBangla };
  const water = top.dimensionDetails.water?.metrics || {};
  const soil = top.dimensionDetails.soil?.metrics || {};
  const income = top.dimensionDetails.income?.metrics || {};
  const boro = advice.options.find(o => o.isBaseline);
  const o = currentOverview;

  setText('evidenceTitle', tr(`${aman.varietyBangla} → ${rabi.cropBangla} কেন তালন্দ ইউনিয়নের জন্য শীর্ষে?`, `Why ${aman.variety} → ${rabi.crop.toLowerCase()} tops the list for Talanda union`));
  setText('evidenceRelease', `${advice.release.id}, ${tr('গবেষণা কমিট', 'research commit')} ${advice.release.researchCommit}`);

  setText('evRescueBig', water.amanRescueIrrigationSeasons === undefined ? '—' : `${num(water.amanRescueIrrigationSeasons)} / ${num(water.totalSeasonsSimulated)}`);
  if (water.amanRescueIrrigationSeasons === undefined) setText('evRescueText', tr('এই চক্রে বর্ষায় আমন ধান নেই, তাই সম্পূরক সেচও নেই। নিচে প্রতিটি আমন জাতের হিসাব তুলনার জন্য।', 'This rotation has no Aman rice in the monsoon, so no rescue irrigation. Each Aman variety is listed below for comparison.'));
  else setText('evRescueText', tr(
    `২০০১–২০২৫ সালের ${num(water.totalSeasonsSimulated)} মৌসুমের ${num(water.amanRescueIrrigationSeasons)}টিতে ${aman.varietyBangla}-এ ফুল আসার সময় সম্পূরক সেচ লেগেছে (বছর: ${num(water.rescueYears)})।`,
    `In ${water.amanRescueIrrigationSeasons} of the ${water.totalSeasonsSimulated} seasons from 2001 to 2025, ${aman.variety} needed rescue irrigation at flowering (years: ${water.rescueYears}).`,
  ));
  if (o) {
    setHtml('evRescueList', [
      ...o.aman_replay.map(r => tr(
        `<li><strong>${escapeHtml(r.varietyBangla)}</strong> (${escapeHtml(r.noteBangla)}): ফুল ~${r.floweringBangla}, ${num(r.rescueSeasons)}/${num(r.totalSeasons)} মৌসুমে সেচ, জমি খালি ~${r.fieldFreeBangla}</li>`,
        `<li><strong>${escapeHtml(r.variety)}</strong> (${escapeHtml(r.noteEnglish)}): flowers ~${r.floweringEnglish}, irrigation in ${r.rescueSeasons}/${r.totalSeasons} seasons, field free ~${r.fieldFreeEnglish}</li>`,
      )),
      tr('<li><strong>তথ্যসূত্র:</strong> NASA POWER (FAO-56 ET0) ও GPM IMERG Final দৈনিক বৃষ্টি, ধানক্ষেতের পানির হিসাব।</li>', '<li><strong>Source:</strong> NASA POWER (FAO-56 ET0) and GPM IMERG Final daily rain in a paddy water balance.</li>'),
      tr('<li><strong>স্থানিক স্কেল:</strong> তানোর পাইলট পয়েন্টের গ্রিড সেল; একক জমির মাপ নয়।</li>', '<li><strong>Scale:</strong> the grid cell at the Tanore pilot point, not a single field.</li>'),
      o.soil_carbon ? tr(
        `<li><strong>যাচাই (SMAP GPP):</strong> শুকনো মৌসুমে আমনের উৎপাদন কমেনি (rho ${num(o.soil_carbon.dryDaysVsAmanGppRho)}, ${num(o.soil_carbon.dryDaysVsAmanGppSeasons)} মৌসুম): কৃষক সেচ দেন, তাই সম্পূরক সেচকে খরচ ধরা হয়েছে, ফসলহানি নয়।</li>`,
        `<li><strong>Check (SMAP GPP):</strong> Aman productivity did not drop in the dry seasons (rho ${o.soil_carbon.dryDaysVsAmanGppRho}, ${o.soil_carbon.dryDaysVsAmanGppSeasons} seasons): farmers irrigate, so rescue water counts as a cost, not a lost crop.</li>`,
      ) : '',
    ].join(''));
  }

  const smap = o?.local_satellite_conditions?.smap;
  const gldas = o?.context?.rootZoneGldasMm;
  const years = smap?.nov10Years || [];
  setText('evSoilBig', smap ? `${num(smap.nov10TypicalM3M3.toFixed(2))} m³/m³` : '—');
  setText('evSoilText', smap ? tr(
    `১০ নভেম্বরে শিকড় অঞ্চলের গড় আর্দ্রতা (SMAP L4, ${num(years[0])}–${num(years[years.length - 1])})। আমন আগে কাটলে এই রস রবির বীজ পায়।`,
    `Typical root-zone moisture on 10 Nov (SMAP L4, ${years[0]}–${years[years.length - 1]}). Harvest Aman early and the Rabi seed gets this moisture.`,
  ) : '');
  const boroSoil = boro?.dimensionDetails.soil?.metrics;
  setHtml('evSoilList', [
    gldas ? tr(
      `<li><strong>GLDAS-2.2:</strong> ১০ থেকে ১৯ নভেম্বরে শিকড় অঞ্চল থেকে আরও ~${num(gldas.lostNov10To19)} মিমি পানি শুকায়; SMAP-এর সাথে মিল (Spearman ${num(gldas.smapSpearman)})।</li>`,
      `<li><strong>GLDAS-2.2:</strong> the root zone loses another ~${gldas.lostNov10To19} mm between 10 and 19 Nov; it agrees with SMAP (Spearman ${gldas.smapSpearman}).</li>`,
    ) : '',
    soil.rotationUreaKgHa === null ? `<li>${escapeHtml(noSoilCard())}</li>` : tr(
      `<li><strong>SRDI তালন্দ কার্ড:</strong> ${escapeHtml(soil.srdiSoilType || '')}; ইউরিয়া ${num(soil.rabiUreaKgHa)} কেজি/হেক্টর (${rabi.cropBangla})।</li>`,
      `<li><strong>SRDI Talanda card:</strong> Kharia soil; urea ${soil.rabiUreaKgHa} kg/ha for ${rabi.crop.toLowerCase()}.</li>`,
    ),
    boroSoil && soil.rotationUreaKgHa !== null ? tr(
      `<li><strong>পুরো চক্রে ইউরিয়া:</strong> ${num(soil.rotationUreaKgHa)} কেজি/হেক্টর, বোরো চক্রে ${num(boroSoil.rotationUreaKgHa)} কেজি।</li>`,
      `<li><strong>Urea for the whole rotation:</strong> ${soil.rotationUreaKgHa} kg/ha, against ${boroSoil.rotationUreaKgHa} kg/ha with Boro.</li>`,
    ) : '',
    o?.soil_carbon ? tr(
      `<li><strong>SMAP L4 কার্বন:</strong> মাটির জৈব কার্বন ~${bigNum(o.soil_carbon.soilCarbonGm2)} গ্রাম/বর্গমিটার (২০১৬–২০২৫), বছরে ${num('+' + o.soil_carbon.soilCarbonTrendGm2PerYear)}।</li>`,
      `<li><strong>SMAP L4 carbon:</strong> soil organic carbon ~${bigNum(o.soil_carbon.soilCarbonGm2)} g/m² (2016–2025), ${'+' + o.soil_carbon.soilCarbonTrendGm2PerYear} a year.</li>`,
    ) : '',
  ].join(''));

  if (o && o.context.groundwater && o.context.winterGreenness && o.season_summary.dominantPattern) {
    const gw = o.context.groundwater;
    const green = o.context.winterGreenness;
    const boroWater = boro?.dimensionDetails.water?.metrics;
    setText('evGroundBig', tr(`বছরে ${num(gw.trendMmPerYear)} মিমি`, `${gw.trendMmPerYear} mm a year`));
    setText('evGroundText', tr(
      `তানোরে GRACE-নির্ভর GLDAS-2.2 অনুযায়ী ভূগর্ভস্থ পানি কমছে: ${num(gw.period.replace(' to ', ' থেকে '))} সময়ে ${num(gw.changeMm)} মিমি।`,
      `GRACE-based GLDAS-2.2 shows Tanore’s groundwater falling: ${gw.changeMm} mm from ${gw.period}.`,
    ));
    setHtml('evGroundList', [
      tr(
        `<li><strong>MODIS:</strong> শীতের সর্বোচ্চ সবুজ (NDVI) ${num(green.early.peakNdvi)} থেকে ${num(green.recent.peakNdvi)}; বছরে গড় ফসল ${num(green.early.cyclesPerYear)} থেকে ${num(green.recent.cyclesPerYear)}।</li>`,
        `<li><strong>MODIS:</strong> peak winter greenness (NDVI) rose from ${green.early.peakNdvi} to ${green.recent.peakNdvi}; crops a year from ${green.early.cyclesPerYear} to ${green.recent.cyclesPerYear}.</li>`,
      ),
      tr(
        `<li><strong>প্রধান চক্র (${num(o.season_summary.landUseYear)}):</strong> ${escapeHtml(o.season_summary.dominantPatternBangla)}, উপজেলার ${num(o.season_summary.dominantPatternPct)}% জমি; ফসলের নিবিড়তা ${num(o.season_summary.croppingIntensity)}।</li>`,
        `<li><strong>Main rotation (${o.season_summary.landUseYear}):</strong> ${escapeHtml(o.season_summary.dominantPattern)} on ${o.season_summary.dominantPatternPct}% of the upazila’s land; cropping intensity ${o.season_summary.croppingIntensity}.</li>`,
      ),
      boroWater ? tr(
        `<li><strong>রবিতে সেচ:</strong> বোরো ~${num(boroWater.rabiNetIrrigationMm)} মিমি, ${rabi.cropBangla} ~${num(water.rabiNetIrrigationMm)} মিমি।</li>`,
        `<li><strong>Rabi irrigation:</strong> Boro ~${boroWater.rabiNetIrrigationMm} mm, ${rabi.crop.toLowerCase()} ~${water.rabiNetIrrigationMm} mm.</li>`,
      ) : '',
    ].join(''));
  }

  setText('evIncomeBig', tr(`${bigNum(income.illustrativeTotalBdtPerHa || 0)} ৳`, `BDT ${bigNum(income.illustrativeTotalBdtPerHa || 0)}`));
  setText('evIncomeText', tr('দুই মৌসুমের নিট লাভের নমুনা হিসাব (দলের অনুমান), যাচাই করা বাজারদর নয়।', 'Sample net profit over two seasons (team estimate), not verified market prices.'));
  setHtml('evIncomeList', [
    o && o.context.cattlePerKm2 ? tr(
      `<li><strong>গবাদিপশু:</strong> ${o.scope.place_kind === 'upazila' ? o.scope.district : 'রাজশাহী'}তে প্রতি বর্গকিমিতে ~${num(Math.round(o.context.cattlePerKm2))}টি গরু (FAO GLW4, ২০১৫)।</li>`,
      `<li><strong>Livestock:</strong> about ${Math.round(o.context.cattlePerKm2)} cattle per km² in ${o.scope.place_kind === 'upazila' ? o.scope.district : 'Rajshahi'} (FAO GLW4, 2015).</li>`,
    ) : '',
    typeof income.districtYieldTPerHa === 'number' ? tr(
      `<li><strong>জেলার গড় ফলন:</strong> ${rabi.cropBangla} ${num(income.districtYieldTPerHa)} টন/হেক্টর (BBS ২০২৪-২৫)।</li>`,
      `<li><strong>District yield:</strong> ${rabi.crop.toLowerCase()} ${income.districtYieldTPerHa} t/ha (BBS 2024-25).</li>`,
    ) : '',
    tr('<li><strong>বাকি:</strong> DAM খামার-দর ও কৃষকের খরচ সংগ্রহের পর আয়ের স্কোর বদলাবে।</li>', '<li><strong>Pending:</strong> the income score will change once DAM farm-gate prices and farmer costs are in.</li>'),
  ].join(''));
}

// ---------------------------------------------------------------------------
// SCREEN 5: less pesticide (IPM)
// ---------------------------------------------------------------------------

function renderStewardship(option) {
  const icons = { water: '💧', fertilizer: '🌱', pesticide: '🐛', soil: '🟫', metals: '⚠️' };
  setHtml('stewardshipList', (option?.stewardship || []).map(t => `
    <li class="care-item ${t.kind}">
      <span class="care-icon" aria-hidden="true">${icons[t.kind] || '•'}</span>
      <div><p>${escapeHtml(tr(t.bn, t.en))}</p><span class="ipm-source">${escapeHtml(t.source)}</span></div>
    </li>`).join(''));
}

function renderIpm(advice) {
  renderLedger(advice);
  renderStewardship(selectedOption() || advice.options[0]);
  const top = advice.options[0];
  const boro = advice.options.find(o => o.isBaseline);
  const column = (opt) => {
    const m = opt.dimensionDetails.pest?.metrics || {};
    const yesNo = (v) => (v ? tr('হ্যাঁ', 'yes') : tr('না', 'no'));
    const resistant = m.resistantVariety && m.resistantVariety !== 'none listed' ? tr('আছে (BWMRI)', `${m.resistantVariety} (BWMRI)`) : tr('তালিকাভুক্ত নেই', 'none listed');
    return `
      <div class="ipm-column ${opt.isBaseline ? 'baseline' : 'recommended'}">
        <h4>${escapeHtml(tr(opt.nameBangla, opt.nameEnglish))}</h4>
        <div class="ipm-score">${num(Math.round((opt.scores.pest ?? 0) * 100))}<small>/${num(100)}</small></div>
        <ul class="kv-list">
          <li><span>${tr('ধানের পোকার চক্র ভাঙে', 'Breaks the rice-pest cycle')}</span><strong>${yesNo(m.breaksRicePestCycle)}</strong></li>
          ${m.rotationUreaKgHa === null || m.rotationUreaKgHa === undefined ? '' : `<li><span>${tr('পুরো চক্রে ইউরিয়া (SRDI)', 'Rotation urea (SRDI)')}</span><strong>${num(m.rotationUreaKgHa)} ${tr('কেজি/হেক্টর', 'kg/ha')}</strong></li>`}
          <li><span>${tr('রোগ প্রতিরোধী জাত', 'Disease-resistant variety')}</span><strong>${resistant}</strong></li>
          <li><span>${tr('সময়মতো বোনা', 'Sown on time')}</span><strong>${yesNo(m.sownOnTime)}</strong></li>
        </ul>
      </div>`;
  };
  const noCard = top.dimensionDetails.pest?.metrics.rotationUreaKgHa === null;
  const topUrea = top.dimensionDetails.pest?.metrics.rotationUreaKgHa;
  const boroUrea = boro?.dimensionDetails.pest?.metrics.rotationUreaKgHa;
  const less = topUrea && boroUrea ? Math.round((100 * (boroUrea - topUrea)) / boroUrea) : null;
  setHtml('ipmCompare', `
    ${column(top)}
    ${boro && boro.id !== top.id ? column(boro) : ''}
    ${noCard ? `<p class="ipm-summary">${escapeHtml(noSoilCard())}</p>` : ''}
    ${less !== null && less > 0 ? `<p class="ipm-summary">${tr(`প্রস্তাবিত চক্রে বছরে ইউরিয়া ${num(less)}% কম, আর ধানের পোকার চক্র ভাঙে। কম নাইট্রোজেন আর খাবারের বিরতি মানে কম পোকা, তাই কম স্প্রে।`, `The recommended rotation uses ${less}% less urea a year and breaks the rice-pest cycle. Less nitrogen and a break in the food supply mean fewer pests, so fewer sprays.`)}</p>` : ''}
  `);

  setHtml('ipmSteps', (top.ipmActions || []).map(tip => `
    <li><span>${escapeHtml(tr(tip.bn, tip.en))}</span> <span class="ipm-source">${escapeHtml(tip.source)}</span></li>
  `).join(''));

  setHtml('ipmRanking', [...advice.options].sort((a, b) => (b.scores.pest ?? 0) - (a.scores.pest ?? 0)).map(opt => {
    const pct = Math.round((opt.scores.pest ?? 0) * 100);
    return `
      <div class="dim-item">
        <div class="dim-header"><span>${escapeHtml(tr(opt.nameBangla, opt.nameEnglish))}</span><span>${num(pct)}/${num(100)}</span></div>
        <div class="dim-bar-wrap"><div class="dim-bar-fill pest" style="width: ${pct}%"></div></div>
        <span class="dim-note">${escapeHtml(tr(opt.dimensionDetails.pest?.summaryBangla, opt.dimensionDetails.pest?.summaryEnglish))}</span>
      </div>`;
  }).join(''));
}

// ---------------------------------------------------------------------------
// SCREEN 6: Krishi officer desk
// ---------------------------------------------------------------------------

async function loadOfficers() {
  officers = await (await fetch('/api/v1/officers')).json();
  renderOfficerSelect();
}

function renderOfficerSelect() {
  const select = $('officerSelect');
  const chosen = select.value;
  select.innerHTML = officers.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(tr(`${o.nameBangla}, ${o.blockBangla}`, `${o.nameEnglish}, ${o.blockEnglish}`))}</option>`).join('');
  if (chosen) select.value = chosen;
}

/** The token for officer API calls: the demo token in a demo session, otherwise the Supabase access token (kept fresh by Supabase). */
async function officerToken() {
  if (officerSession?.source === 'demo') return officerSession.token;
  return accessToken();
}

async function officerFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await officerToken()}` },
  });
  if (res.status === 401 || res.status === 403) {
    await window.officerSignOut();
    throw new OfficerAccessError(res.status);
  }
  return res;
}

/** The server refused the officer token: 401 (no or expired session) or 403 (signed in, but not an officer). */
class OfficerAccessError extends Error {
  constructor(status) {
    super('Officer session refused');
    this.status = status;
  }
}

window.officerSignIn = async function(event) {
  event.preventDefault();
  const error = $('officerLoginError');
  error.hidden = true;
  const res = await fetch('/api/v1/officer/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ officerId: $('officerSelect').value, accessCode: $('officerCode').value }),
  });
  if (!res.ok) {
    error.textContent = tr('কর্মকর্তা বা প্রবেশ কোড ভুল।', 'Wrong officer or access code.');
    error.hidden = false;
    return;
  }
  officerSession = { ...(await res.json()), source: 'demo' };
  $('officerCode').value = '';
  try {
    sessionStorage.setItem('eden.officer', JSON.stringify(officerSession));
  } catch {
    // storage blocked: the session lasts until this page closes
  }
  await loadOfficerDesk();
};

window.officerSignOut = async function() {
  officerSession = null;
  homeArea = null;
  homeAreaApplied = false;
  climateTrend = { state: 'loading', data: null, error: null, place: null };
  officerDesk = null;
  officerKnowledge = null;
  officerNotice = null;
  try {
    sessionStorage.removeItem('eden.officer');
  } catch {
    // nothing stored
  }
  renderOfficer();
  renderClimateTrend();
  applyAreaScope();
  renderProfile();
  await supabaseSignOut();
};

/** Loads the desk. Returns 'ok', 'denied' (no valid officer session: the session was cleared) or 'unavailable' (server or network problem). */
async function loadOfficerDesk() {
  if (!officerSession) return 'denied';
  try {
    const [deskRes, knowledgeRes] = await Promise.all([officerFetch('/api/v1/officer/desk'), officerFetch('/api/v1/officer/knowledge')]);
    if (!deskRes.ok || !knowledgeRes.ok) return 'unavailable';
    officerDesk = await deskRes.json();
    officerKnowledge = await knowledgeRes.json();
  } catch (err) {
    return err instanceof OfficerAccessError ? 'denied' : 'unavailable';
  }
  if (officerDesk.officer) officerSession.officer = officerDesk.officer;
  renderOfficer();
  renderProfile();
  if (!$('obsFarmer').dataset.chosen) window.prefillObservation(officerDesk.queue[0]?.farmerId);
  await loadHomeArea();
  window.loadDataSources();
  window.loadClimateTrend();
  return 'ok';
}

function farmerEntry(farmerId) {
  return officerDesk?.farmers.find(f => f.farmer.id === farmerId);
}

function renderProfile() {
  const o = officerSession?.officer;
  if (o) {
    setText('saaoName', tr(o.nameBangla, o.nameEnglish));
    setText('saaoRole', tr(`SAAO, ${o.blockBangla} • প্রবেশ করেছেন`, `SAAO, ${o.blockEnglish} • signed in`));
  } else {
    setText('saaoName', tr('নমুনা কর্মকর্তা', 'Sample officer'));
    setText('saaoRole', tr('SAAO, তালন্দ ব্লক', 'SAAO, Talanda block'));
  }
}

function renderOfficer() {
  renderOfficerSelect();
  const signedIn = Boolean(officerSession && officerDesk);
  $('officerLogin').hidden = signedIn || !demoMode;
  $('officerSignedOut').hidden = signedIn || demoMode;
  $('officerWorkspace').hidden = !signedIn;
  const badge = $('officerStateBadge');
  badge.className = `badge ${signedIn ? 'badge-success' : 'badge-warning'}`;
  badge.textContent = signedIn
    ? tr(`প্রবেশ করেছেন: ${officerSession.officer?.nameBangla ?? ''}`, `Signed in: ${officerSession.officer?.nameEnglish ?? ''}`)
    : tr('শুধু ম্যানেজারদের জন্য', 'Managers only');
  if (!signedIn) return;
  renderQueue();
  renderFarmerOptions();
  renderRegister();
  renderKnowledge();
  renderObservationResult();
}

const LEVELS = {
  urgent: ['badge-danger', 'জরুরি', 'Urgent'],
  high: ['badge-warning', 'বেশি', 'High'],
  normal: ['badge-neutral', 'সাধারণ', 'Normal'],
};

function renderQueue() {
  setHtml('officerQueue', officerDesk.queue.map(item => {
    const f = farmerEntry(item.farmerId)?.farmer;
    const [cls, bn, en] = LEVELS[item.level];
    return `
      <div class="queue-item ${item.level}">
        <div class="queue-top">
          <strong>${escapeHtml(tr(f?.nameBangla, f?.nameEnglish))}</strong>
          <span class="badge ${cls}">${tr(bn, en)} • ${num(item.score)}</span>
        </div>
        <ul class="reason-list">${item.reasons.map(r => `<li>${escapeHtml(tr(r.bn, r.en))}</li>`).join('')}</ul>
        <div class="queue-actions">
          <button class="btn btn-sm btn-primary" type="button" onclick="prefillObservation('${item.farmerId}', true)">${tr('পর্যবেক্ষণ লিখুন', 'Record observation')}</button>
          ${item.openCallbackId ? `<button class="btn btn-sm btn-secondary" type="button" onclick="resolveCallback('${item.openCallbackId}')">${tr('কল করা হয়েছে', 'Called back')}</button>` : ''}
        </div>
      </div>`;
  }).join(''));
}

function renderFarmerOptions() {
  const select = $('obsFarmer');
  const chosen = select.value;
  select.innerHTML = officerDesk.farmers.map(({ farmer }) => `<option value="${farmer.id}">${escapeHtml(tr(`${farmer.nameBangla} (${farmer.villageBangla})`, `${farmer.nameEnglish} (${farmer.villageEnglish})`))}</option>`).join('');
  if (chosen) select.value = chosen;
}

function renderRegister() {
  setHtml('officerFarmers', officerDesk.farmers.map(({ farmer, observation, queue, advice }) => {
    const current = observation?.currentAmanCrop ?? farmer.currentAmanCrop;
    const landType = observation?.landType ?? farmer.landType;
    const status = observation
      ? `<span class="badge badge-success">${tr('কর্মকর্তা যাচাইকৃত', 'Officer-verified')}</span><br><small>${isoDate(observation.date)}${observation.pestSeen !== 'none' ? ` • 🐛 ${escapeHtml(tr(officerDesk.pestNames[observation.pestSeen].bn, officerDesk.pestNames[observation.pestSeen].en))}` : ''}</small>`
      : `<span class="badge badge-neutral">${tr('মাঠ যাচাই বাকি', 'Field check pending')}</span>`;
    const callback = queue?.openCallbackId ? ` <span class="badge badge-warning">${tr('কল-ব্যাক', 'Call-back')}</span>` : '';
    return `
      <tr>
        <td><strong>${escapeHtml(tr(farmer.nameBangla, farmer.nameEnglish))}</strong> <span class="tag tag-yellow">${tr('নমুনা', 'sample')}</span><br><small>${escapeHtml(farmer.phoneMasked)}</small></td>
        <td>${escapeHtml(land(landType))}<br><small>${escapeHtml(amanName(current))}</small></td>
        <td>${advice.thisSeasonOptionBangla && advice.thisSeasonOptionBangla !== advice.topOptionBangla
          ? `<small>${tr('এ মৌসুম', 'This season')}:</small> ${escapeHtml(tr(advice.thisSeasonOptionBangla, advice.thisSeasonOptionEnglish))}<br><small>${tr('আগামী মৌসুম', 'Next season')}: ${escapeHtml(tr(advice.topOptionBangla, advice.topOptionEnglish))}</small>`
          : `${escapeHtml(tr(advice.topOptionBangla, advice.topOptionEnglish))}<br><small>${tr('জমি খালি', 'Field free')}: ${escapeHtml(tr(advice.fieldFreeBangla, advice.fieldFreeEnglish))}</small>`}</td>
        <td><small>${escapeHtml(advice.thisSeason ? tr(advice.thisSeason.noteBangla, advice.thisSeason.noteEnglish) : '')}</small></td>
        <td>${status}${callback}</td>
      </tr>`;
  }).join(''));
}

function renderKnowledge() {
  const k = officerKnowledge;
  if (!k) return;
  const kg = (v) => num(Number.isInteger(v) ? v : v.toFixed(1));
  const srdiBlock = !k.srdi ? `<div class="knowledge-block"><p class="muted">${escapeHtml(noSoilCard())}</p></div>` : `
    <div class="knowledge-block">
      <h4>${tr('SRDI তালন্দ কার্ড (মাঝারি উঁচু জমি, কেজি/হেক্টর)', 'SRDI Talanda card (medium-high land, kg/ha)')}</h4>
      <p class="muted">${escapeHtml(tr(`${k.srdi.soilTypeBangla}; কৃষকের অ্যাপে শুধু ইউরিয়া, টিএসপি, এমওপি যায়।`, 'Kharia soil; the farmer app shows only urea, TSP and MoP.'))}</p>
      <div class="table-responsive"><table class="data-table compact">
        <thead><tr><th>${tr('ফসল', 'Crop')}</th><th>${tr('ইউরিয়া', 'Urea')}</th><th>TSP</th><th>MoP</th><th>${tr('জিপসাম', 'Gypsum')}</th><th>${tr('জিংক সালফেট', 'Zinc sulphate')}</th><th>${tr('বরিক এসিড', 'Boric acid')}</th></tr></thead>
        <tbody>${k.srdi.rows.map(r => `<tr><td>${escapeHtml(tr(r.cropBangla, r.cropEnglish))}</td><td>${kg(r.dose.ureaKgHa)}</td><td>${kg(r.dose.tspKgHa)}</td><td>${kg(r.dose.mopKgHa)}</td><td>${kg(r.dose.gypsumKgHa)}</td><td>${kg(r.dose.zincSulphateKgHa)}</td><td>${kg(r.dose.boricAcidKgHa)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
  `;
  setHtml('officerKnowledge', `
    ${srdiBlock}
    <div class="knowledge-block">
      <h4>${tr('আমন রি-প্লে (২০০১–২০২৫)', 'Aman replay (2001–2025)')}</h4>
      <div class="table-responsive"><table class="data-table compact">
        <thead><tr><th>${tr('জাত', 'Variety')}</th><th>${tr('ফুল', 'Flowering')}</th><th>${tr('জমি খালি', 'Field free')}</th><th>${tr('সম্পূরক সেচের বছর', 'Rescue-irrigation years')}</th></tr></thead>
        <tbody>${k.amanReplay.map(r => `<tr><td>${escapeHtml(tr(r.varietyBangla, r.variety))}</td><td>${escapeHtml(tr(r.floweringBangla, r.floweringEnglish))}</td><td>${escapeHtml(tr(r.fieldFreeBangla, r.fieldFreeEnglish))}</td><td>${num(r.rescueSeasons)}/${num(r.totalSeasons)}: ${num(r.rescueYears.join(', '))}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="knowledge-block">
      <h4>${tr('রবি রি-প্লে', 'Rabi replay')}</h4>
      <div class="table-responsive"><table class="data-table compact">
        <thead><tr><th>${tr('ফসল', 'Crop')}</th><th>${tr('বপন (সময়সীমা)', 'Sowing (window)')}</th><th>${tr('সেচ, মিমি (p10–p90)', 'Irrigation, mm (p10–p90)')}</th><th>${tr('অতিরিক্ত গরম', 'Heat exposure')}</th></tr></thead>
        <tbody>${k.rabiReplay.map(r => `<tr><td>${escapeHtml(tr(r.cropBangla, r.cropEnglish))}${r.key.includes('(') ? ` <small>${escapeHtml(r.key.slice(r.key.indexOf('(')))}</small>` : ''}</td><td>${escapeHtml(tr(r.sowingBangla, r.sowingEnglish))}${r.windowEnglish ? ` <small>(${escapeHtml(r.windowEnglish)}, ${escapeHtml(r.windowSource)})</small>` : ''}</td><td>${num(r.netIrrigationMm)} (${num(r.netIrrigationRangeMm[0])}–${num(r.netIrrigationRangeMm[1])})</td><td>${r.heat ? tr(`${num(r.heat.hotDays)}/${num(r.heat.windowDays)} দিন > ${num(r.heat.thresholdC)}°C`, `${r.heat.hotDays}/${r.heat.windowDays} days > ${r.heat.thresholdC}°C`) : '—'}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="knowledge-block">
      <h4>${tr('তথ্যের সীমাবদ্ধতা', 'Data caveats')}</h4>
      <ul class="evidence-list">${k.caveats.map(c => `<li>${escapeHtml(tr(c.bn, c.en))}</li>`).join('')}</ul>
      <h4>${tr('প্রযুক্তিগত নোট (ইংরেজি)', 'Technical notes')}</h4>
      <p class="muted">${escapeHtml(k.saaoNotes)}</p>
    </div>
  `);
}

window.prefillObservation = function(farmerId, scroll = false) {
  const entry = farmerEntry(farmerId);
  if (!entry) return;
  const { farmer, observation } = entry;
  const select = $('obsFarmer');
  select.value = farmer.id;
  select.dataset.chosen = farmer.id;
  $('obsLand').value = observation?.landType ?? farmer.landType;
  $('obsAman').value = observation?.currentAmanCrop ?? farmer.currentAmanCrop;
  $('obsIrrigation').value = observation?.irrigation ?? farmer.irrigation;
  $('obsPest').value = observation?.pestSeen ?? 'none';
  $('obsSeverity').value = observation?.pestSeverity ?? 'low';
  const p = observation?.priorities ?? { water: 0.5, income: 0.2, soil: 0.2, pest: 0.1 };
  $('obsWater').value = Math.round(p.water * 100);
  $('obsIncome').value = Math.round(p.income * 100);
  $('obsSoil').value = Math.round(p.soil * 100);
  $('obsPestPriority').value = Math.round(p.pest * 100);
  $('obsNote').value = observation?.noteBangla ?? '';
  window.updateObsWeights();
  if (scroll) $('observationForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.submitObservation = async function(event) {
  event.preventDefault();
  const weight = (id) => parseFloat($(id).value) / 100;
  const body = {
    farmerId: $('obsFarmer').value,
    landType: $('obsLand').value,
    currentAmanCrop: $('obsAman').value,
    irrigation: $('obsIrrigation').value,
    pestSeen: $('obsPest').value,
    pestSeverity: $('obsSeverity').value,
    priorities: { water: weight('obsWater'), income: weight('obsIncome'), soil: weight('obsSoil'), pest: weight('obsPestPriority') },
    noteBangla: $('obsNote').value,
    resolveCallbacks: $('obsResolve').checked,
  };
  const res = await officerFetch('/api/v1/officer/observations', { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  officerNotice = res.ok ? { farmerId: body.farmerId, advice: data.advice } : { error: data.error };
  if (res.ok) {
    await Promise.all([loadOfficerDesk(), loadOverview()]);
  }
  renderObservationResult();
};

function renderObservationResult() {
  const box = $('observationResult');
  if (!officerNotice) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (officerNotice.error) {
    box.className = 'obs-result error';
    box.textContent = officerNotice.error;
    return;
  }
  const farmer = farmerEntry(officerNotice.farmerId)?.farmer;
  const advice = officerNotice.advice;
  const top = advice.options[0];
  const now = advice.options.find(o => o.id === advice.this_season_option_id);
  box.className = 'obs-result';
  box.innerHTML = `
    <strong>${escapeHtml(tr(`${farmer?.nameBangla ?? ''}-এর পরামর্শ হালনাগাদ হয়েছে`, `Advice updated for ${farmer?.nameEnglish ?? ''}`))}</strong>
    ${now && now.id !== top.id ? `<p>${tr('এ মৌসুমে', 'This season')}: ${escapeHtml(tr(now.nameBangla, now.nameEnglish))}</p>` : ''}
    <p>${now && now.id !== top.id ? tr('আগামী মৌসুমে', 'Next season') : tr('শীর্ষ চক্র', 'Top rotation')}: ${escapeHtml(tr(top.nameBangla, top.nameEnglish))}</p>
    ${advice.this_season ? `<p>${escapeHtml(tr(advice.this_season.noteBangla, advice.this_season.noteEnglish))}</p>` : ''}
    ${advice.verification ? `<p><span class="badge badge-success">${tr('কর্মকর্তা যাচাইকৃত', 'Officer-verified')}</span> ${escapeHtml(advice.verification.noteBangla)}</p>` : ''}
  `;
}

window.resolveCallback = async function(callbackId) {
  await officerFetch(`/api/v1/officer/callbacks/${encodeURIComponent(callbackId)}/resolve`, { method: 'POST', body: '{}' });
  await Promise.all([loadOfficerDesk(), loadOverview()]);
};

window.officerReset = async function() {
  await officerFetch('/api/v1/officer/reset', { method: 'POST', body: '{}' });
  officerNotice = null;
  delete $('obsFarmer').dataset.chosen;
  await Promise.all([loadOfficerDesk(), loadOverview()]);
};

// ---------------------------------------------------------------------------
// SCREEN 8: the spoken text comes from the server's checked template
// ---------------------------------------------------------------------------

async function loadNarration(opt) {
  if (!opt || !currentAdvice) return;
  try {
    const res = await fetch('/api/v1/narrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advice: currentAdvice, selectedOptionId: opt.id }),
    });
    currentNarration = await res.json();
    renderNarration();
  } catch (err) {
    console.error('Narration failed:', err);
  }
}

function renderNarration() {
  if (!currentNarration) return;
  // Farmers always hear Bangla; English mode adds a translation underneath
  setText('previewBanglaText', currentNarration.banglaSpeechText);
  const gloss = $('previewEnglishGloss');
  gloss.hidden = lang !== 'en' || !currentNarration.englishGloss;
  gloss.textContent = currentNarration.englishGloss ? `English translation: ${currentNarration.englishGloss}` : '';
  setText('audioTime', tr(`~${num(currentNarration.durationSecondsEstimate)} সেকেন্ড`, `~${currentNarration.durationSecondsEstimate} seconds`));
  setText('narrationEngineTag', currentNarration.status === 'verified_template' ? tr('✓ ভেরিফাইড টেমপ্লেট (Verified Template)', '✓ Verified template') : `✓ ${currentNarration.status}`);
}

function renderAudioButton() {
  const labels = {
    idle: tr('বাংলা ভয়েস শুনুন (Audio Preview)', 'Play the Bangla voice (audio preview)'),
    playing: tr('ভয়েস প্লে হচ্ছে...', 'Playing...'),
    done: tr('পুনরায় শুনুন (Replay)', 'Replay'),
    novoice: tr('এই ব্রাউজারে বাংলা ভয়েস নেই', 'No Bangla voice in this browser'),
  };
  setText('audioPlayText', labels[audioState]);
  setText('audioPlayIcon', audioState === 'playing' ? '⏸' : '▶');
}

// Audio preview: the browser's Bangla voice when available, otherwise a progress bar only
window.toggleAudioPreview = function() {
  const progress = $('audioProgress');
  const text = $('previewBanglaText')?.textContent?.trim() || '';

  if (audioState === 'playing') {
    clearInterval(audioTimer);
    window.speechSynthesis?.cancel();
    audioState = 'idle';
    progress.style.width = '0%';
    renderAudioButton();
    return;
  }

  const voice = window.speechSynthesis?.getVoices().find(v => v.lang.toLowerCase().startsWith('bn'));
  if (voice && text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.onend = () => {
      audioState = 'done';
      renderAudioButton();
    };
    window.speechSynthesis.speak(utterance);
    audioState = 'playing';
  } else {
    audioState = 'novoice';
  }
  renderAudioButton();

  let current = 0;
  clearInterval(audioTimer);
  audioTimer = setInterval(() => {
    current += 2.5;
    progress.style.width = `${Math.min(current, 100)}%`;
    if (current >= 100) clearInterval(audioTimer);
  }, 100);
};

// Dispatch Advice Call (simulation only, nothing is sent)
window.dispatchAdviceCall = function() {
  const t = () => new Date().toLocaleTimeString(lang === 'en' ? 'en-GB' : 'bn-BD');
  const sim = tr('[সিমুলেশন]', '[simulation]');
  setHtml('liveCallLog', `
    <span class="log-line">[${t()}] ${sim} ${tr('আউটগোয়িং IVR কল শুরু হচ্ছে', 'Outgoing IVR call starting')}: 01712-XXXXXX</span>
    <span class="log-line">[${t()}] ${sim} ${tr('টেলকো গেটওয়ে: কল রিং হচ্ছে...', 'Telco gateway: ringing...')}</span>
    <span class="log-line">[${t()}] ${sim} ${tr('কৃষক কল রিসিভ করেছেন', 'Farmer answered')}</span>
    <span class="log-line">[${t()}] ${sim} ${tr('অনুমোদিত বাংলা ভয়েস বাজানো হচ্ছে...', 'Playing the approved Bangla voice...')}</span>
  `);
};

// Simulate farmer keypad: 1-4 re-rank for that priority; 9 puts a call-back on the officer desk
window.simulateFarmerKeypad = async function(key) {
  const logBox = $('liveCallLog');
  const t = () => new Date().toLocaleTimeString(lang === 'en' ? 'en-GB' : 'bn-BD');
  logBox.innerHTML += `<span class="log-line key-line">[${t()}] ${tr('কৃষকের কিপ্যাড ইনপুট', 'Farmer pressed')}: [ ${num(key)} ]</span>`;
  try {
    const res = await fetch('/api/v1/channel-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keypad: key, phone: '017XX-XXX01', farmerId: 'F01' }),
    });
    const data = await res.json();
    logBox.innerHTML += `<span class="log-line">[${t()}] ${tr('সিস্টেম', 'System')}: ${escapeHtml(tr(data.acknowledgementBangla, data.acknowledgementEnglish))}</span>`;
    if (data.callbackId) {
      logBox.innerHTML += `<span class="log-line">[${t()}] ${tr('কর্মকর্তা ডেস্কের তালিকায় কল-ব্যাক অনুরোধ যোগ হয়েছে।', 'Call-back request added to the officer desk queue.')}</span>`;
      await Promise.all([loadOverview(), loadOfficerDesk()]);
    }
  } catch (err) {
    console.error('Keypad simulation error:', err);
  }
};

// ---------------------------------------------------------------------------
// SCREEN 9: companion phone mock-up
// ---------------------------------------------------------------------------

function renderCompanion(advice) {
  const top = advice.options[0];
  const water = top.dimensionDetails.water?.metrics || {};
  const heat = top.dimensionDetails.heat?.metrics || {};
  const soil = top.dimensionDetails.soil?.metrics || {};
  const english = top.approvedActionEnglish || [];
  setText('compAction', tr(top.approvedActionBangla[1] || '', english[1] || ''));
  setText('compActionText', tr(top.approvedActionBangla[2] || '', english[2] || ''));
  setText('compRotation', `${tr('ফসল চক্র', 'Rotation')}: ${tr(top.nameBangla, top.nameEnglish)}`);
  setText('compWater', `${num(water.rabiNetIrrigationMm)} ${tr('মিমি', 'mm')}`);
  setText('compHeat', `${num(heat.hotDays ?? 0)} ${tr('দিন', 'days')}`);
  setText('compUrea', soil.rotationUreaKgHa === null || soil.rotationUreaKgHa === undefined ? '—' : `${num(Math.round(soil.rotationUreaKgHa))} ${tr('কেজি', 'kg')}`);
  setText('compFooter', `${tr('রিলিজ', 'Release')} ${advice.release.id} • ${tr('ক্যাশড ভার্সন', 'cached version')}`);
}

// ---------------------------------------------------------------------------
// SCREEN 10: data quality table
// ---------------------------------------------------------------------------

const STATUS = {
  operational: ['সক্রিয়', 'Live', 'badge-success'],
  'cross-checked': ['যাচাইসহ সক্রিয়', 'Live, cross-checked', 'badge-info'],
  missing: ['বাকি', 'Pending', 'badge-warning'],
};

async function loadDataQualityTable() {
  try {
    currentDataRelease = await (await fetch('/api/v1/data-release')).json();
    renderQuality(currentDataRelease);
  } catch (err) {
    console.error('Failed to load data quality:', err);
  }
}

// ---------------------------------------------------------------------------
// Manager: site-scoped NASA POWER climate summary
// ---------------------------------------------------------------------------

let climateTrend = { state: 'loading', data: null, error: null, place: null, refreshed: false, busy: false };
let climateRequest = 0;

/**
 * Loads the NASA POWER summary for the area on screen (the manager's own area by default; any other area is public NASA data,
 * labelled as a comparison). { refresh: true } downloads again instead of using today's saved copy.
 */
window.loadClimateTrend = async function(options = {}) {
  const refresh = options.refresh === true;
  if (!officerSession) {
    climateTrend = { state: 'loading', data: null, error: null, place: null, refreshed: false, busy: false };
    renderClimateTrend();
    return;
  }
  if (officerSession.source === 'demo') {
    climateTrend = { state: 'error', data: null, error: 'supabase', place: currentPlace, refreshed: false, busy: false };
    renderClimateTrend();
    return;
  }
  const place = currentPlace;
  const request = ++climateRequest;
  const keep = refresh && climateForThisPlace(); // a refresh keeps the numbers on screen while it works
  climateTrend = keep
    ? { ...climateTrend, busy: true }
    : { state: 'loading', data: null, error: null, place, refreshed: false, busy: false };
  renderClimateTrend();
  let next;
  try {
    const token = await officerToken();
    const res = await fetch(`/api/v1/manager/climate?area=${encodeURIComponent(place)}${refresh ? '&refresh=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      next = { state: 'ok', data: await res.json(), error: null, place, refreshed: refresh, busy: false };
    } else {
      const body = await res.json().catch(() => null);
      const offlineNoData = res.status === 404 && /OFFLINE=1/.test(body?.error?.message ?? '');
      next = { state: 'error', data: null, error: offlineNoData ? 'offline_area' : 'server', place, refreshed: false, busy: false };
    }
  } catch {
    next = { state: 'error', data: null, error: 'server', place, refreshed: false, busy: false };
  }
  if (request !== climateRequest) return; // another area was picked meanwhile
  climateTrend = next;
  renderClimateTrend();
  if (currentOverview) renderRainStat(currentOverview);
  renderFreshness();
};

window.refreshClimate = () => window.loadClimateTrend({ refresh: true });

function climateNumber(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return tr('পর্যাপ্ত তথ্য নেই', 'Not enough data');
  return num(Number(value).toFixed(digits));
}

function climateDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'bn-BD', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function renderClimateTrend() {
  const card = $('climateTrendCard');
  if (!card) return;
  card.hidden = !officerSession;
  if (!officerSession) return;
  const { state, data, error } = climateTrend;
  $('climateLoading').hidden = state !== 'loading';
  $('climateError').hidden = state !== 'error';
  $('climateIndicators').hidden = state !== 'ok';
  $('climateSourceLine').hidden = state !== 'ok';
  $('climateRefreshNote').hidden = state !== 'ok';
  if ($('climateRefresh')) $('climateRefresh').disabled = climateTrend.busy || state === 'loading';
  if (state === 'error') {
    setText('climateErrorText', error === 'offline_area'
      ? tr('এই এলাকার আবহাওয়ার তথ্য অফলাইনে পাওয়া যাচ্ছে না। অনলাইনে একবার দেখলে তথ্য সংরক্ষিত হবে।', 'This area’s weather is not available offline. View it once while online and it will be saved.')
      : error === 'supabase'
      ? tr('এই সাইটের জলবায়ুর তথ্য দেখতে আসল Supabase manager account দিয়ে প্রবেশ করুন।', 'Sign in with a real Supabase manager account to view this site’s climate data.')
      : tr('জলবায়ুর তথ্য আনা যায়নি। সার্ভার ও নেটওয়ার্ক দেখুন; OFFLINE=1 হলে আগে একবার অনলাইনে POWER তথ্য ক্যাশ করুন।', 'Could not load climate data. Check the server and network; with OFFLINE=1, first fetch POWER data once while online to cache it.'));
    return;
  }
  if (state !== 'ok' || !data?.indicators) return;

  const { rainfall, heatStressDays, longestDrySpell, rootZoneWetness } = data.indicators;
  if (rainfall.anomalyMm === null || rainfall.anomalyMm === undefined) {
    setText('climateRainStatus', rainfall.totalMm === null
      ? tr('গত ৩০ দিনের বৃষ্টির পূর্ণ তথ্য নেই; ১০ বছরের স্বাভাবিকের সঙ্গে তুলনা করা যায়নি।', 'The full 30-day rainfall record is unavailable, so it could not be compared with the 10-year normal.')
      : tr(`বৃষ্টি ${climateNumber(rainfall.totalMm)} মিমি; স্বাভাবিকের সঙ্গে তুলনার জন্য যথেষ্ট তথ্য নেই।`, `${climateNumber(rainfall.totalMm)} mm of rain; not enough records to compare with normal.`));
  } else {
    const above = rainfall.anomalyMm >= 0;
    const percent = rainfall.anomalyPercent === null || rainfall.anomalyPercent === undefined
      ? '' : ` (${climateNumber(Math.abs(rainfall.anomalyPercent), 0)}%)`;
    const baseline = climateNumber(rainfall.normalMm);
    if (rainfall.anomalyMm === 0) {
      setText('climateRainStatus', tr(
        `গত ৩০ দিনে ${climateNumber(rainfall.totalMm)} মিমি বৃষ্টি; ১০ বছরের স্বাভাবিক ${baseline} মিমির সমান।`,
        `${climateNumber(rainfall.totalMm)} mm in the last 30 days, matching the 10-year normal of ${baseline} mm.`));
    } else {
      const direction = above ? tr('বেশি', 'above') : tr('কম', 'below');
      setText('climateRainStatus', tr(
        `গত ৩০ দিনে ${climateNumber(rainfall.totalMm)} মিমি বৃষ্টি; ১০ বছরের স্বাভাবিক ${baseline} মিমির চেয়ে ${climateNumber(Math.abs(rainfall.anomalyMm))} মিমি${percent} ${direction}।`,
        `${climateNumber(rainfall.totalMm)} mm in the last 30 days; ${climateNumber(Math.abs(rainfall.anomalyMm))} mm${percent} ${direction} the 10-year normal of ${baseline} mm.`));
    }
  }
  setText('climateHeatStatus', heatStressDays.value === null
    ? tr('তাপমাত্রার যথেষ্ট তথ্য নেই।', 'Not enough temperature records.')
    : tr(`৩৫°C-এর বেশি সর্বোচ্চ তাপমাত্রা ছিল ${climateNumber(heatStressDays.value, 0)} দিন।`, `Maximum temperature exceeded 35°C on ${climateNumber(heatStressDays.value, 0)} days.`));
  setText('climateDryStatus', longestDrySpell.value === null
    ? tr('বৃষ্টির যথেষ্ট তথ্য নেই।', 'Not enough rainfall records.')
    : tr(`দিনে ১ মিমির কম বৃষ্টি টানা সর্বোচ্চ ${climateNumber(longestDrySpell.value, 0)} দিন।`, `Rainfall stayed below 1 mm/day for up to ${climateNumber(longestDrySpell.value, 0)} consecutive days.`));
  setText('climateSoilStatus', rootZoneWetness.value === null
    ? tr('শিকড়ের মাটির যথেষ্ট তথ্য নেই।', 'Not enough root-zone soil records.')
    : tr(`গত ১৪ দিনের গড় ${climateNumber(rootZoneWetness.value, 2)} (০ শুকনো, ১ সম্পৃক্ত)।`, `14-day average: ${climateNumber(rootZoneWetness.value, 2)} (0 dry, 1 saturated).`));
  const range = dateRangeText(data.dataDateRange?.from, data.dataDateRange?.to);
  const downloaded = dateTime(data.fetchedAt);
  if (data.dataSource === 'live') {
    setText('climateSourceLine', tr(
      `তথ্যসূত্র: NASA POWER, ${data.area.nameEnglish}, ${range}, সরাসরি ডাউনলোড`,
      `Data source: NASA POWER, ${data.area.nameEnglish}, ${range}, live download`));
  } else if (data.dataSource === 'cache' && !data.offline && !data.liveFetchFailed) {
    // today's copy, saved when it was downloaded: not sample data
    setText('climateSourceLine', tr(
      `NASA POWER-এর সংরক্ষিত কপি, ${data.area.nameEnglish}, ${range} (ডাউনলোড ${downloaded})`,
      `Saved copy of NASA POWER, ${data.area.nameEnglish}, ${range} (downloaded ${downloaded})`));
  } else {
    // stored data served offline or after a failed download: say plainly that it is not live
    setText('climateSourceLine', tr(`নমুনা তথ্য, NASA POWER, ${range}`, `Sample data from NASA POWER, ${range}`));
  }
  setText('climateRefreshNote', data.offline
    ? tr(`অফলাইন মোড: সংরক্ষিত তথ্য ব্যবহার হচ্ছে, নতুন ডাউনলোড হয়নি (তথ্য ডাউনলোড হয়েছিল ${downloaded})।`, `Offline mode: using saved data, nothing was downloaded (data downloaded ${downloaded}).`)
    : data.liveFetchFailed
      ? tr(`রিফ্রেশ করা যায়নি; সংরক্ষিত তথ্য দেখানো হচ্ছে (ডাউনলোড ${downloaded})।`, `Could not refresh; showing saved data (downloaded ${downloaded}).`)
      : climateTrend.refreshed
        ? tr(`এইমাত্র হালনাগাদ: ${downloaded}`, `Just refreshed: ${downloaded}`)
        : tr(`তথ্য ডাউনলোড: ${downloaded}`, `Data downloaded: ${downloaded}`));
}

// ---------------------------------------------------------------------------
// Manager: which NASA data sources the server can use (read-only; the API returns set/unset flags, never a key)
// ---------------------------------------------------------------------------

let dataSources = { state: 'loading', data: null, error: null }; // state: 'loading' | 'ok' | 'error'

window.loadDataSources = async function() {
  if (!officerSession) return;
  dataSources = { state: 'loading', data: null, error: null };
  renderDataSources();
  try {
    const res = await officerFetch('/api/v1/manager/data-sources');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dataSources = { state: 'ok', data: await res.json(), error: null };
  } catch (err) {
    // officerFetch already ended the session on 401/403: go back to the sign-in picker
    if (err instanceof OfficerAccessError) { window.signOutRole?.(); return; }
    dataSources = { state: 'error', data: null, error: navigator.onLine === false ? 'offline' : 'server' };
  }
  renderDataSources();
};

/** One row: a status badge (icon + text, never colour alone) and, when something is not set up, the help line with the sign-up link. */
function setDataSourceRow(key, cls, icon, bn, en, showHelp) {
  const row = document.querySelector(`.ds-row[data-ds="${key}"]`);
  if (!row) return;
  const badge = row.querySelector('[data-ds-badge]');
  badge.className = `badge ds-badge ${cls}`;
  badge.querySelector('.material-symbols-outlined').textContent = icon;
  badge.querySelector('[data-ds-badge-text]').textContent = tr(bn, en);
  const help = row.querySelector('[data-ds-help]');
  if (help) help.hidden = !showHelp;
}

function renderDataSources() {
  if (!$('dataSourcesCard')) return;
  const { state, data, error } = dataSources;
  $('dsSkeleton').hidden = state !== 'loading';
  $('dsError').hidden = state !== 'error';
  $('dsRows').hidden = state !== 'ok';
  $('dsOfflineBadge').hidden = !(state === 'ok' && data.offline === true);
  if (state === 'error') {
    setText('dsErrorText', error === 'offline'
      ? tr('আপনি অফলাইনে আছেন। সংযোগ দেখে আবার চেষ্টা করুন।', 'You appear to be offline. Check your connection and try again.')
      : tr('ডেটা সোর্সের অবস্থা আনা যায়নি। আবার চেষ্টা করুন।', 'Could not load the data source status. Please try again.'));
  }
  if (state !== 'ok') return;
  setDataSourceRow('power', 'badge-success', 'check_circle', 'চাবি লাগে না, সব সময় পাওয়া যায়', 'No key needed, always available', false);
  const edl = data.earthdataLogin === 'set';
  setDataSourceRow('earthdata', edl ? 'badge-success' : 'badge-warning', edl ? 'check_circle' : 'error', edl ? 'সংযুক্ত' : 'সেট করা নেই', edl ? 'Connected' : 'Not set up', !edl);
  const nasa = data.nasaApiKey === 'set';
  setDataSourceRow('nasaKey', nasa ? 'badge-success' : 'badge-neutral', nasa ? 'check_circle' : 'info', nasa ? 'সংযুক্ত' : 'ডেমো চাবি ব্যবহার হচ্ছে', nasa ? 'Connected' : 'Using demo key', !nasa);
  const ads = data.adsApiToken === 'set';
  setDataSourceRow('ads', ads ? 'badge-success' : 'badge-neutral', ads ? 'check_circle' : 'error', ads ? 'সংযুক্ত' : 'সেট করা নেই', ads ? 'Connected' : 'Not set up', !ads);
  setDataSourceRow('firms', 'badge-neutral', 'info', 'এই চ্যালেঞ্জে লাগে না', 'Not needed for this challenge', false);
}

function renderQuality(data) {
  setHtml('qualityTableBody', data.datasets.map(d => {
    const [bn, en, cls] = STATUS[d.status] || [d.status, d.status, 'badge-neutral'];
    return `
      <tr>
        <td><strong>${escapeHtml(d.name)}</strong><br><span class="muted small">${escapeHtml(d.parameter)}</span></td>
        <td>${escapeHtml(d.timePeriod)}<br><span class="small" style="color: var(--water);">${escapeHtml(d.spatialResolution)}</span></td>
        <td><span class="tag ${d.status === 'missing' ? 'tag-yellow' : 'tag-green'}">${escapeHtml(d.freshness)}</span><br><span class="small">${tr('ল্যাটেন্সি', 'Latency')}: ${escapeHtml(d.latency)}</span></td>
        <td><span class="small" style="color: var(--success);">${escapeHtml(d.groundCorrection)}</span></td>
        <td><span class="badge ${cls}">${tr(bn, en)}</span></td>
      </tr>`;
  }).join(''));
  const missing = data.datasets.filter(d => d.status === 'missing').length;
  setText('qualityBadge', tr(`${num(data.datasets.length - missing)}টি সচল, ${num(missing)}টি বাকি`, `${data.datasets.length - missing} live, ${missing} pending`));
}

// ---------------------------------------------------------------------------
// Initial load: language, overview, advice, data quality, officer list (and desk if signed in)
// ---------------------------------------------------------------------------

// Role picker, web farmer portal, weather and cattle screens (portals.js): set up first, so the picker works at once
let portals = null;
function startPortals() {
  portals = initPortals({
    tr, num, isoDate, escapeHtml, $, setText, setHtml,
    lang: () => lang,
    advice: () => currentAdvice,
    overview: () => currentOverview,
    place: () => currentPlace,
    officers: () => officers,
    loadOfficers,
    officerSignedIn: () => Boolean(officerSession),
    /** Starts an officer session ({ source: 'supabase' } or a demo { source: 'demo', token, officer }) and loads the desk: 'ok' | 'denied' | 'unavailable'. */
    async setOfficerSession(session) {
      officerSession = session;
      if (session.source === 'demo') {
        // only the demo token is kept here; a Supabase session is kept (and refreshed) by Supabase itself
        try {
          sessionStorage.setItem('eden.officer', JSON.stringify(session));
        } catch {
          // storage blocked: the session lasts until this page closes
        }
      }
      const status = await loadOfficerDesk();
      renderProfile();
      return status;
    },
    signOutOfficer: () => window.officerSignOut(),
    // keypad 9 from the farmer portal: the call-back lands on the officer desk (demo; no call is placed)
    async keypad(key) {
      try {
        const res = await fetch('/api/v1/channel-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keypad: key, phone: '017XX-XXX01', farmerId: 'F01' }),
        });
        const data = await res.json();
        if (data.callbackId && officerSession) loadOfficerDesk();
        return res.ok;
      } catch {
        return false;
      }
    },
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const saved = localStorage.getItem('eden.lang');
    if (saved === 'en' || saved === 'bn') lang = saved;
    const session = sessionStorage.getItem('eden.officer');
    if (session) officerSession = { ...JSON.parse(session), source: 'demo' };
  } catch {
    // storage blocked: start in Bangla, signed out
  }
  applyStaticText();
  startPortals();
  await loadOverview();
  await window.runPlannerCalculation({ switchScreenAfter: false });
  await loadDataQualityTable();
  await loadOfficers();
  demoMode = Boolean((await authConfig())?.demoMode);
  // a Supabase session left in this browser (refresh, or a later visit) is checked with the server before it is trusted
  if (!officerSession && await accessToken()) officerSession = { source: 'supabase', officer: null };
  if (officerSession) await loadOfficerDesk();
  renderAll();
  await portals.restoreSession();
  portals.refresh();
});


// Daily NASA conditions for every upazila (research/live/daily_update.py)
let liveRows = null;
const LIVE_WORD = {
  dry: ['স্বাভাবিকের চেয়ে শুকনো', 'drier than usual'],
  normal: ['স্বাভাবিক', 'about usual'],
  wet: ['স্বাভাবিকের চেয়ে ভেজা', 'wetter than usual'],
  unknown: ['তুলনা নেই', 'no comparison'],
};
const liveWord = (k) => tr(...(LIVE_WORD[k] || LIVE_WORD.unknown));

function fillLiveUpazilas() {
  const d = $('liveDistrict').value;
  $('liveUpazila').innerHTML = liveRows.filter(u => u.district === d)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`).join('');
}

async function renderLive() {
  if (!liveRows) return;
  const res = await fetch(`/api/v1/live/upazila?id=${encodeURIComponent($('liveUpazila').value)}`);
  if (!res.ok) return;
  const u = await res.json();
  const p = u.power, i = u.imerg;
  setText('liveAge', tr(`POWER ${isoDate(p.date)} · IMERG ${i ? isoDate(i.date) : '—'}`, `POWER ${isoDate(p.date)} · IMERG ${i ? isoDate(i.date) : '—'}`));
  const rainLine = i
    ? tr(`<li><strong>বৃষ্টি (IMERG, ১০ কিমি):</strong> শেষ ৩ দিনে ${num(i.rain3)} মিমি, ৭ দিনে ${num(i.rain7)} মিমি</li>`,
         `<li><strong>Rain (IMERG, 10 km):</strong> ${i.rain3} mm in the last 3 days, ${i.rain7} mm in 7 days</li>`)
    : tr(`<li><strong>বৃষ্টি (POWER):</strong> ৭ দিনে ${num(p.rain7)} মিমি</li>`, `<li><strong>Rain (POWER):</strong> ${p.rain7} mm in 7 days</li>`);
  setHtml('liveFacts', [
    rainLine,
    tr(`<li><strong>৩০ দিনের বৃষ্টি:</strong> ${num(p.rain30)} মিমি, স্বাভাবিকের ${num(p.rain30PctOfNormal ?? '—')}% (${liveWord(p.rainStatus)})</li>`,
       `<li><strong>30-day rain:</strong> ${p.rain30} mm, ${p.rain30PctOfNormal ?? '—'}% of normal (${liveWord(p.rainStatus)})</li>`),
    tr(`<li><strong>তাপমাত্রা:</strong> সর্বোচ্চ ${num(p.tmax)}°C, সর্বনিম্ন ${num(p.tmin)}°C; শেষ ৭ দিনে ৩৫°C-এর বেশি ${num(p.hotDays7)} দিন</li>`,
       `<li><strong>Temperature:</strong> max ${p.tmax}°C, min ${p.tmin}°C; ${p.hotDays7} days at 35°C or more in the last 7</li>`),
    tr(`<li><strong>মাটির রস (মূল অঞ্চল):</strong> ${num(p.soilRoot)} (০–১), ${liveWord(p.soilStatus)}; ${num(p.soilYears)} বছরের ${num(p.soilRank)}টির চেয়ে বেশি</li>`,
       `<li><strong>Root-zone soil wetness:</strong> ${p.soilRoot} (0 to 1), ${liveWord(p.soilStatus)}; higher than ${p.soilRank} of the past ${p.soilYears} years</li>`),
  ].join(''));
}

async function loadLive() {
  try {
    const res = await fetch('/api/v1/live/upazilas');
    if (!res.ok) { setText('liveAge', tr('এখনো হালনাগাদ হয়নি', 'Not updated yet')); return; }
    liveRows = (await res.json()).upazilas;
    const districts = [...new Set(liveRows.map(u => u.district))].sort();
    $('liveDistrict').innerHTML = districts.map(d => `<option>${escapeHtml(d)}</option>`).join('');
    $('liveDistrict').value = districts.includes('Rajshahi') ? 'Rajshahi' : districts[0];
    fillLiveUpazilas();
    if ([...$('liveUpazila').options].some(o => o.value === 'ADM3_Tanore')) $('liveUpazila').value = 'ADM3_Tanore';
    $('liveDistrict').addEventListener('change', () => { fillLiveUpazilas(); renderLive(); });
    $('liveUpazila').addEventListener('change', renderLive);
    await renderLive();
  } catch {
    setText('liveAge', tr('এখনো হালনাগাদ হয়নি', 'Not updated yet'));
  }
}

const setLanguageBeforeLive = window.setLanguage;
window.setLanguage = function(next) { setLanguageBeforeLive(next); renderLive(); };
document.addEventListener('DOMContentLoaded', loadLive);


// Today's haor reading from the daily NASA update (IMERG upstream rain and the MODIS flood map)
function liveHaorLines(live) {
  if (!live) return tr('<li><strong>আজকের পাঠ:</strong> দৈনিক নাসা হালনাগাদ এখনো চলেনি।</li>', '<li><strong>Today:</strong> the daily NASA update has not run yet.</li>');
  const word = { normal: ['স্বাভাবিক', 'normal'], watch: ['সতর্কতা', 'watch'], warning: ['বিপদ', 'warning'] };
  const s = live.upstream[0];
  const lvl = word[s.level] || ['—', '—'];
  const run = String(live.run || '').startsWith('E') ? 'IMERG Early' : 'IMERG Late';
  const lines = [tr(
    `<li><strong>আজকের পাঠ (${isoDate(live.date)}, ${run}):</strong> সোহরায় ৩ দিনে ${num(s.rain3Adj ?? '—')} মিমি (দ্রুত সংস্করণের ঘাটতি ঠিক করে) — ${lvl[0]}।${live.inSeason ? '' : ' মৌসুমের বাইরে: বোরো কাটা হয়ে গেছে, পাঠটি নজরদারির জন্য।'}</li>`,
    `<li><strong>Today's reading (${isoDate(live.date)}, ${run}):</strong> ${s.rain3Adj ?? '—'} mm in 3 days at Sohra (adjusted for the quick run) — ${lvl[1]}.${live.inSeason ? '' : ' Off season: Boro is harvested, so the reading is kept for watching.'}</li>`)];
  const others = live.upstream.slice(1).filter(u => u.rain3Adj !== null);
  if (others.length) lines.push(tr(
    `<li><strong>অন্য উজান এলাকা (সীমা এখনো যাচাই হয়নি):</strong> ${others.map(u => `${u.place.split(',')[0]} ${num(u.rain3Adj)} মিমি`).join(' · ')}</li>`,
    `<li><strong>Other upstream hills (thresholds not tested yet):</strong> ${others.map(u => `${u.place.split(',')[0]} ${u.rain3Adj} mm`).join(' · ')}</li>`));
  const m = live.modisFlood;
  if (m) lines.push(tr(
    `<li><strong>MODIS বন্যা মানচিত্র (${isoDate(m.date)}):</strong> হাওর অঞ্চলের ${num(m.floodPct)}% অস্বাভাবিক বন্যার পানি, ${num(m.recurringPct)}% মৌসুমি বন্যার পানি, ${num(m.noDataPct)}% মেঘে ঢাকা।</li>`,
    `<li><strong>MODIS flood map (${isoDate(m.date)}):</strong> ${m.floodPct}% of the haor basin under unusual flood water, ${m.recurringPct}% under seasonal flood water, ${m.noDataPct}% under cloud.</li>`));
  return lines.join('');
}


// Any place: the pilot (Talanda union, Tanore) or any upazila, advised from its district's 25-season replay
const PILOT_PLACE = 'talanda_tanore';
let currentPlace = (() => { try { return localStorage.getItem('eden.place') || PILOT_PLACE; } catch { return PILOT_PLACE; } })();
let currentPlaceLive = null;
let placeIndex = null;
let placeTextChanged = false;
let bdMap = null; // the overview's map of Bangladesh (bd-map.js)

function placeName() {
  const s = currentOverview?.scope;
  if (!s || s.place_kind !== 'upazila') return null;
  return { upazila: s.upazila, district: s.district };
}

function applyPlaceText() {
  const p = placeName();
  const kind = $('placeKind');
  if (kind) kind.textContent = p ? tr('জেলার ২৫ মৌসুমের নাসা রিপ্লে', 'District 25-season NASA replay') : tr('পাইলট: সবচেয়ে বিস্তারিত তথ্য', 'Pilot: the most detailed data');
  if (!p) {
    if (placeTextChanged) { applyStaticText(); placeTextChanged = false; }
    return;
  }
  placeTextChanged = true;
  const lead = document.querySelector('[data-i18n="overview.lead"]');
  if (lead) lead.textContent = tr(`${p.district} জেলার নাসা পয়েন্টে ২৫ মৌসুমের (২০০১–২০২৫) রিপ্লে থেকে ${p.upazila} উপজেলার মাঝারি উঁচু জমির জন্য ফসল চক্র বাছাই: পানি, তাপ, মাটি ও কীটনাশক মিলিয়ে।`, `Choosing a rotation for medium-high land in ${p.upazila} upazila from 25 seasons (2001–2025) replayed at ${p.district} district's NASA point: water, heat, soil and pesticide together.`);
  const title = document.querySelector('[data-i18n="overview.title"]');
  if (title) title.textContent = tr(`${p.upazila} উপজেলা: আমন থেকে রবি ফসল চক্র সিদ্ধান্ত`, `${p.upazila} upazila: from Aman to the Rabi rotation`);
  const set = (key, text) => document.querySelectorAll(`[data-i18n="${key}"]`).forEach(el => { el.textContent = text; });
  set('geo.district', p.district);
  set('geo.upazila', p.upazila);
  set('geo.union', tr('সব ইউনিয়ন', 'all unions'));
  set('overview.satTitle', tr(`স্যাটেলাইট নজরদারি (${p.district} জেলার পয়েন্ট)`, `Satellite monitoring (${p.district} district point)`));
  set('planner.unionOption', `${p.upazila}, ${p.district}`);
}

function fillPlaceUpazilas() {
  const d = $('placeDistrict').value;
  $('placeUpazila').innerHTML = placeIndex.filter(u => u.district === d).sort((a, b) => a.name.localeCompare(b.name))
    .map(u => `<option value="${escapeHtml(u.id === 'ADM3_Tanore' ? PILOT_PLACE : u.id)}">${escapeHtml(u.id === 'ADM3_Tanore' ? `${u.name} (Talanda pilot)` : u.name)}</option>`).join('');
}

async function choosePlace(id, options = {}) {
  currentPlace = id;
  try { localStorage.setItem('eden.place', id); } catch { /* the choice lasts for this page only */ }
  try {
    bdMap?.setPlace(id);
  } catch {
    // the map has no size while the role picker or another screen is showing; it centres on the place when it is shown
  }
  await loadOverview();
  await loadCropMenu();
  if (typeof window.runPlannerCalculation === 'function') await window.runPlannerCalculation({ switchScreenAfter: false });
  renderAll();
  applyPlaceText();
  applyAreaScope();
  if (officerSession && !options.skipClimate) window.loadClimateTrend();
  portals?.refresh();
  if (liveRows && $('liveDistrict')) {
    const row = liveRows.find(r => r.id === (id === PILOT_PLACE ? 'ADM3_Tanore' : id));
    if (row) { $('liveDistrict').value = row.district; fillLiveUpazilas(); $('liveUpazila').value = row.id; renderLive(); }
  }
}

async function loadPlaces() {
  try {
    const res = await fetch('/api/v1/places');
    if (!res.ok) return;
    placeIndex = (await res.json()).upazilas;
    const districts = [...new Set(placeIndex.map(u => u.district))].sort();
    $('placeDistrict').innerHTML = districts.map(d => `<option>${escapeHtml(d)}</option>`).join('');
    const current = currentPlace === PILOT_PLACE ? placeIndex.find(u => u.id === 'ADM3_Tanore') : placeIndex.find(u => u.id === currentPlace);
    $('placeDistrict').value = current ? current.district : 'Rajshahi';
    fillPlaceUpazilas();
    $('placeUpazila').value = currentPlace;
    $('placeDistrict').addEventListener('change', () => { fillPlaceUpazilas(); choosePlace($('placeUpazila').value); });
    $('placeUpazila').addEventListener('change', () => choosePlace($('placeUpazila').value));
    applyPlaceText();
  } catch { /* the pilot stays selected */ }
}

const setLanguageBeforePlace = window.setLanguage;
window.setLanguage = function(next) { setLanguageBeforePlace(next); applyPlaceText(); bdMap?.refreshLanguage(); portals?.refresh(); };

// Keeps the two place lists in step with the place chosen elsewhere (the map, "back to my area")
function syncPlaceSelects(placeId) {
  const row = placeIndex?.find(u => u.id === (placeId === PILOT_PLACE ? 'ADM3_Tanore' : placeId));
  if (row && $('placeDistrict')) {
    $('placeDistrict').value = row.district;
    fillPlaceUpazilas();
    $('placeUpazila').value = placeId;
  }
}

// A click on the map picks an upazila the same way the place list does
function chooseFromMap(id) {
  const placeId = id === 'ADM3_Tanore' ? PILOT_PLACE : id;
  syncPlaceSelects(placeId);
  choosePlace(placeId);
}
document.addEventListener('DOMContentLoaded', () => {
  bdMap = initBdMap({ tr, num, isoDate, escapeHtml, choose: chooseFromMap, currentId: () => currentPlace });
});
document.addEventListener('DOMContentLoaded', loadPlaces);


// ---------------------------------------------------------------------------
// The farmer's own crops (planner) and the farmer's own words (delivery screen)
// ---------------------------------------------------------------------------

let cropMenuData = null;
const chosenCrops = new Set();
let voiceAnswerData = null;
const SEASON_LABEL = {
  Rabi: ['শীতের ফসল (রবি, আমনের পরে)', 'Winter crops (Rabi, after Aman)'],
  'Kharif-1': ['গ্রীষ্মের ফসল (খরিফ-১, পরের আমনের আগে)', 'Summer crops (Kharif-1, before the next Aman)'],
};

function selectedCrops() {
  return [...chosenCrops];
}

const cropName = (id) => {
  const c = cropMenuData?.crops.find(x => x.id === id);
  return c ? tr(c.cropBangla, c.cropEnglish) : id;
};

async function loadCropMenu() {
  try {
    const res = await fetch(`/api/v1/crops?place=${encodeURIComponent(currentPlace)}`);
    if (!res.ok) return;
    cropMenuData = await res.json();
    renderCropChips();
  } catch { /* the planner works with the five fixed rotations */ }
}

function renderHeroSelect() {
  const select = $('planHeroCrop');
  if (!select || !cropMenuData) return;
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(tr('কোনোটি নয়: আমন ধান ধরে', 'None: plan around Aman rice'))}</option>` +
    cropMenuData.crops.map(c => `<option value="${c.id}">${escapeHtml(tr(c.cropBangla, c.cropEnglish))}</option>`).join('');
  select.value = current;
}

function renderCropChips() {
  if (!cropMenuData) return;
  renderHeroSelect();
  setHtml('cropChoiceChips', ['Rabi', 'Kharif-1'].map(season => `
    <div class="crop-chip-group">
      <span class="crop-chip-season">${escapeHtml(tr(...SEASON_LABEL[season]))}</span>
      ${cropMenuData.crops.filter(c => c.season === season).map(c => {
        const fits = season !== 'Rabi' || c.afterAman.length > 0;
        const after = c.afterAman.map(a => `${amanName(a.aman)} (${tr('বপন', 'sow')} ${num(a.sowing.split('-').reverse().join('/'))})`).join(', ');
        const title = fits ? (after ? tr(`যে আমনের পরে মেলে: ${after}`, `Fits after: ${after}`) : '') : tr('এখানে কোনো আমনের পরে সময়মতো বোনা যায় না', 'No Aman here leaves time for it');
        const on = chosenCrops.has(c.id);
        return `<label class="crop-chip${on ? ' on' : ''}${fits ? '' : ' off'}" title="${escapeHtml(title)}">
          <input type="checkbox" ${on ? 'checked' : ''} ${fits ? '' : 'disabled'} onchange="toggleCrop('${c.id}', this.checked)">
          <span>${escapeHtml(tr(c.cropBangla, c.cropEnglish))}</span>${c.netIrrigationMm !== null ? `<small>${num(c.netIrrigationMm)} ${tr('মিমি', 'mm')}</small>` : ''}
        </label>`;
      }).join('')}
    </div>`).join(''));
}

window.toggleCrop = function(id, on) {
  if (on) chosenCrops.add(id);
  else chosenCrops.delete(id);
  renderCropChips();
};

function coverageTag(advice, optionId) {
  const cover = advice.crop_choice?.coverage?.find(c => c.optionId === optionId);
  if (!cover?.cropIds.length) return '';
  const names = cover.cropIds.map(id => advice.crop_choice.requested.find(r => r.id === id)).filter(Boolean).map(r => tr(r.cropBangla, r.cropEnglish));
  return `<span class="tag tag-blue">${tr('আপনার পছন্দ', 'Farmer\'s choice')}: ${escapeHtml(names.join(', '))}</span>`;
}

function renderCropChoice(advice) {
  const box = $('cropChoiceNote');
  if (!box) return;
  const c = advice.crop_choice;
  box.hidden = !c;
  if (!c) return;
  const fits = c.fits.map(f => f.fits
    ? tr(`${f.cropBangla}: বপন ~${f.sowingBangla}, কাটা ~${f.harvestBangla}, ${f.netIrrigationMm < 20 ? 'সেচ প্রায় লাগে না' : `সেচ প্রায় ${num(f.netIrrigationMm)} মিমি`}`, `${f.cropEnglish}: sow ~${f.sowingEnglish}, harvest ~${f.harvestEnglish}, ${f.netIrrigationMm < 20 ? 'almost no irrigation' : `about ${f.netIrrigationMm} mm of irrigation`}`)
    : tr(`${f.cropBangla}: মেলে না। ${f.reasonBangla}`, `${f.cropEnglish}: does not fit. ${f.reasonEnglish}`));
  const notes = tr(c.notesBangla, c.notesEnglish);
  box.innerHTML = `<strong>${tr('কৃষকের পছন্দের ফসল', 'The farmer\'s crops')}</strong><ul>${[...fits, ...notes].map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
}

// Speech to text in the browser (Chrome's Web Speech API, Bangla); the server only ever receives text
window.startVoiceInput = function() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    setHtml('voiceCallStatus', `<span class="log-line">${escapeHtml(tr('এই ব্রাউজারে কথা থেকে লেখা হয় না; Google Chrome-এ চেষ্টা করুন, অথবা বাক্যটি লিখে দিন।', 'This browser has no speech-to-text; try Google Chrome, or type the sentence.'))}</span>`);
    return;
  }
  const rec = new Recognition();
  rec.lang = 'bn-BD';
  rec.interimResults = true;
  setText('btnMic', tr('🎙️ শুনছি…', '🎙️ Listening…'));
  rec.onresult = (e) => { $('voiceText').value = [...e.results].map(r => r[0].transcript).join(' '); };
  rec.onerror = (e) => setHtml('voiceCallStatus', `<span class="log-line">${escapeHtml(tr('মাইক্রোফোন', 'Microphone'))}: ${escapeHtml(e.error)}</span>`);
  rec.onend = () => {
    setText('btnMic', tr('🎤 বলুন', '🎤 Speak'));
    if ($('voiceText').value.trim()) window.answerVoice();
  };
  rec.start();
};

window.answerVoice = async function() {
  const text = $('voiceText').value.trim();
  if (!text) return;
  try {
    const res = await fetch('/api/v1/voice/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, unionId: currentPlace, landType: $('planLandType')?.value }),
    });
    voiceAnswerData = await res.json();
    if (!res.ok) throw new Error(voiceAnswerData.error);
    renderVoice();
  } catch (err) {
    setHtml('voiceCallStatus', `<span class="log-line">${escapeHtml(err.message || tr('উত্তর তৈরি করা যায়নি', 'Could not build the answer'))}</span>`);
  }
};

function renderVoice() {
  const v = voiceAnswerData;
  if (!v?.reply) return;
  const u = v.understood;
  const chip = (cls, text) => `<span class="tag ${cls}">${escapeHtml(text)}</span>`;
  const parts = [
    ...u.crops.map(id => {
      const asked = v.advice.crop_choice?.requested.find(r => r.id === id);
      return chip('tag-green', asked ? tr(asked.cropBangla, asked.cropEnglish) : cropName(id));
    }),
    u.hero ? chip('tag-blue', tr(`প্রধান ফসল: ${cropName(u.hero)}`, `Main crop: ${cropName(u.hero)}`)) : '',
    ...u.excluded.map(id => chip('tag-strike', id === 'rice' ? tr('ধান', 'rice') : id === 'aman' ? tr('আমন', 'Aman') : cropName(id))),
    ...(v.advice.crop_choice?.notModelled ?? []).map(n => chip('tag-grey', tr(`${n.bn}: হিসাব নেই`, `${n.en}: not modelled`))),
    u.landType ? chip('tag-yellow', land(u.landType)) : '',
    ...Object.keys(u.priorities ?? {}).map(p => chip('tag-blue', tr(...(DIMENSIONS[p] || [p, p])))),
  ].filter(Boolean);
  setHtml('voiceHeard', parts.length
    ? `<span class="crop-chip-season">${tr('যা বোঝা গেছে', 'Understood')}:</span> ${parts.join(' ')}`
    : `<span class="crop-chip-season">${tr('কোনো ফসলের নাম পাওয়া যায়নি; প্রচলিত চক্র দেখানো হলো', 'No crop named; showing the usual rotations')}</span>`);
  const reply = $('voiceReply');
  reply.hidden = false;
  reply.innerHTML = `<div class="speech-quote-icon">📢</div><p class="speech-text">${escapeHtml(v.reply.speechBangla)}</p>`;
  const sms = $('voiceSms');
  sms.hidden = false;
  sms.textContent = `SMS (${tr(`${num(v.reply.smsSegments)} অংশ`, `${v.reply.smsSegments} part${v.reply.smsSegments > 1 ? 's' : ''}`)}): ${v.reply.smsBangla}`;
  setHtml('voiceCallStatus', `<span class="log-line">${escapeHtml(tr(`শীর্ষ চক্র: ${v.advice.options[0].nameBangla}; কল প্রায় ${num(v.reply.durationSecondsEstimate)} সেকেন্ড`, `Top option: ${v.advice.options[0].nameEnglish}; call about ${v.reply.durationSecondsEstimate} s`))}</span>`);
}

window.speakVoiceReply = function() {
  const text = voiceAnswerData?.reply?.speechBangla;
  if (!text) return window.answerVoice();
  const voice = window.speechSynthesis?.getVoices().find(v => v.lang.toLowerCase().startsWith('bn'));
  if (!voice) {
    setHtml('voiceCallStatus', `<span class="log-line">${escapeHtml(tr('এই কম্পিউটারে বাংলা কণ্ঠ নেই; ফোন কলে Awaj-এর bn-BD কণ্ঠ পড়বে।', 'No Bangla voice on this computer; on a phone call Awaj reads it in its bn-BD voice.'))}</span>`);
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  window.speechSynthesis.speak(utterance);
};

window.callVoiceReply = async function() {
  const phone = $('voicePhone').value.trim();
  const text = $('voiceText').value.trim();
  try {
    const res = await fetch('/api/v1/calls/advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(officerSession?.token ? { Authorization: `Bearer ${officerSession.token}` } : {}) },
      body: JSON.stringify({ phone, text, unionId: currentPlace, landType: $('planLandType')?.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const call = data.call;
    setHtml('voiceCallStatus', `<span class="log-line">${escapeHtml(call.dryRun
      ? tr(`পরীক্ষামূলক (ড্রাই রান): ${call.request.phone_numbers[0]} নম্বরে Awaj-এ এই অনুরোধ যেত; আসল কলের জন্য সার্ভারে AWAJ_API_TOKEN, AWAJ_SENDER ও AWAJ_LIVE=1 দিন।`, `Dry run: this request would go to Awaj for ${call.request.phone_numbers[0]}; set AWAJ_API_TOKEN, AWAJ_SENDER and AWAJ_LIVE=1 on the server for a real call.`)
      : tr(`Awaj কল পাঠানো হয়েছে (HTTP ${call.response.status})।`, `Sent to Awaj (HTTP ${call.response.status}).`))}</span>`);
  } catch (err) {
    setHtml('voiceCallStatus', `<span class="log-line">${escapeHtml(err.message || 'Error')}</span>`);
  }
};

// The keypad call: the farmer hears the recorded crop menu, presses keys, and Awaj calls back with the plan
window.callKeypadMenu = async function() {
  try {
    const res = await fetch('/api/v1/calls/keypad', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(officerSession?.token ? { Authorization: `Bearer ${officerSession.token}` } : {}) },
      body: JSON.stringify({ phone: $('voicePhone').value.trim(), unionId: currentPlace }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const lines = [
      data.call.dryRun
        ? tr(`পরীক্ষামূলক (ড্রাই রান): ${data.call.request.phone_numbers.join(', ')} নম্বরে কিপ্যাড মেনু কল যেত।`, `Dry run: a keypad menu call would go to ${data.call.request.phone_numbers.join(', ')}.`)
        : tr(`কিপ্যাড মেনু কল পাঠানো হয়েছে (HTTP ${data.call.response.status})।`, `Keypad menu call sent (HTTP ${data.call.response.status}).`),
      tr(`কৃষক শুনবেন: ${data.menu}`, `The farmer hears: ${data.menu}`),
      ...(data.needs || []).map(n => tr(`বাকি: ${n}`, `Still needed: ${n}`)),
    ];
    setHtml('voiceCallStatus', lines.map(l => `<span class="log-line">${escapeHtml(l)}</span>`).join(''));
  } catch (err) {
    setHtml('voiceCallStatus', `<span class="log-line">${escapeHtml(err.message || 'Error')}</span>`);
  }
};

const setLanguageBeforeCrops = window.setLanguage;
window.setLanguage = function(next) {
  setLanguageBeforeCrops(next);
  renderCropChips();
  renderVoice();
};
document.addEventListener('DOMContentLoaded', loadCropMenu);
