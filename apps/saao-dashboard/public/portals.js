/**
 * Role portals for the dashboard, rebuilt from muhammadTasin's Edith web app (Edith_Web_App_Connectivity, c922eec) in
 * the story site's look:
 *
 *  - a role picker before the dashboard: visitor (no sign-in), farmer (demo sign-in as F01), manager (Supabase sign-in with
 *    a user ID and password; the old demo login only when the server runs with DEMO_MODE=true);
 *    each role sees only its own tabs (this is presentation, not security: the API checks its own tokens);
 *  - the web farmer portal with the Android app's five tabs: today (the engine's plan for the farmer's place, the next
 *    48 hours of rain, the soil-and-water tips), weather, river erosion, the assistant (crop sentences get a plan,
 *    other questions the grounded assistant) and my farm;
 *  - the weather screen: Open-Meteo forecast and NASA POWER for any of 500 upazilas or the device's location, with the
 *    hourly cattle heat-stress index (THI);
 *  - the cattle screen: farm outlines drawn on a map or uploaded as GeoJSON, background jobs, the THI advisory, and
 *    what the satellite side can and cannot say yet.
 *
 * One server serves the website and the Android app (docs/api-contract.md).
 */

import { authConfig, normalizeUserId, supabaseClient, toAuthEmail } from './auth-client.js';

const ROLES = {
  visitor: { home: 'screen-overview', screens: ['screen-overview', 'screen-weather'] },
  farmer: { home: 'screen-farmer', screens: ['screen-farmer', 'screen-planner', 'screen-companion'] },
  officer: {
    home: 'screen-overview',
    screens: ['screen-overview', 'screen-weather', 'screen-planner', 'screen-comparison', 'screen-evidence', 'screen-ipm',
      'screen-officer', 'screen-delivery', 'screen-quality', 'screen-cattle'],
  },
};
const ROLE_NAME = { visitor: ['দর্শনার্থী', 'Visitor'], farmer: ['কৃষক', 'Farmer'], officer: ['ম্যানেজার', 'Manager'] };
const ROLE_KEY = 'eden.role';
const FARMER_KEY = 'eden.farmer';
const WEATHER_KEY = 'eden.weather.location';

/** A failed API call with a machine-readable kind (the server's error envelope code, or offline / network). */
class ApiFailure extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

async function apiJson(path, init) {
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiFailure(navigator.onLine === false ? 'offline' : 'network', 'Network request failed');
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message || `HTTP ${res.status}`;
    throw new ApiFailure(body?.error?.code || (res.status === 404 ? 'not_found' : 'internal'), message, res.status);
  }
  return body;
}

const store = {
  get(area, key) { try { return window[area].getItem(key); } catch { return null; } },
  set(area, key, value) { try { value == null ? window[area].removeItem(key) : window[area].setItem(key, value); } catch { /* storage blocked */ } },
};

export function initPortals(ctx) {
  const { tr, num, isoDate, escapeHtml, $, setText, setHtml } = ctx;
  const lang = () => ctx.lang();

  let role = null;
  let farmerToken = null;
  let farmerUser = null;
  let farmerTab = 'today';

  const failureText = (failure) => {
    switch (failure?.kind) {
      case 'offline': return tr('আপনি অফলাইনে আছেন। সংযোগ দেখুন।', 'You appear to be offline. Check your connection.');
      case 'network': return tr('সার্ভারের সাথে সংযোগ করা যায়নি।', 'Could not reach the server.');
      case 'invalid_input': return tr('তথ্য সঠিক নয়: ', 'Invalid input: ') + (failure.message || '');
      case 'provider_unavailable': return tr('তথ্যদাতা সেবা (আবহাওয়া বা নাসা) এখন পাওয়া যাচ্ছে না। পরে আবার চেষ্টা করুন।', 'The data provider is unavailable right now. Try again later.');
      case 'no_data': return tr('এখানে দেখানোর মতো তথ্য এখনো নেই।', 'There is no data to show here yet.');
      case 'configuration_required': return tr('সার্ভারে এই সুবিধা এখনো চালু করা হয়নি।', 'This capability is not configured on the server.');
      case 'unauthorized': return tr('অনুমতি নেই।', 'Not authorised.');
      default: return tr('একটি সমস্যা হয়েছে: ', 'Something went wrong: ') + (failure?.message || '');
    }
  };

  // ------------------------------------------------------------------------------------------------------------------
  // Roles: the picker, sign-in, what each role sees
  // ------------------------------------------------------------------------------------------------------------------

  function applyRole(next) {
    role = next;
    document.body.classList.toggle('state-entry', !role);
    document.body.dataset.role = role || '';
    document.querySelectorAll('[data-roles]').forEach(el => {
      el.hidden = !role || !el.dataset.roles.split(' ').includes(role);
    });
    numberTabs();
    renderRoleChip();
    renderFarm();
  }

  /** Number the tabs this role sees 1, 2, 3… (data-num lets a language switch redraw the digits). */
  function numberTabs() {
    let n = 0;
    document.querySelectorAll('.screen-nav .nav-tab').forEach(tab => {
      const el = tab.querySelector('.tab-num');
      if (!el || tab.hidden) return;
      n += 1;
      el.dataset.num = String(n);
      el.textContent = num(n);
    });
  }

  function enterPortal(next) {
    applyRole(next);
    store.set('sessionStorage', ROLE_KEY, next);
    window.switchScreen(ROLES[next].home);
    if (next === 'farmer') showFarmerTab(farmerTab);
  }

  function renderRoleChip() {
    const name = $('roleChipName');
    if (!name) return;
    if (!role) { name.textContent = ''; return; }
    const who = role === 'farmer' && farmerUser ? ` · ${tr(farmerUser.nameBangla, farmerUser.nameEnglish || farmerUser.nameBangla)}` : '';
    name.textContent = `${tr(...ROLE_NAME[role])}${who}`;
  }

  window.showEntryStep = function(step) {
    for (const [id, name] of [['entryChoose', 'choose'], ['entryFarmer', 'farmer'], ['entryOfficer', 'officer']]) {
      if ($(id)) $(id).hidden = name !== step;
    }
    setEntryError('entryFarmerError', '');
    setEntryError('entryOfficerError', '');
    setEntryError('entryDemoError', '');
    if (step === 'officer') authConfig().then(cfg => { if ($('entryOfficerDemo')) $('entryOfficerDemo').hidden = !cfg?.demoMode; });
    if (step === 'farmer') $('entryFarmerBtn')?.focus();
    if (step === 'officer') $('entryOfficerUserId')?.focus();
  };

  function setEntryError(id, message) {
    const box = $(id);
    if (!box) return;
    box.textContent = message || '';
    box.hidden = !message;
  }

  window.chooseRole = function(next) {
    if (next === 'visitor') enterPortal('visitor');
    else window.showEntryStep(next);
  };

  // Demo only: no SMS is sent and no phone number is checked; the server's sample farmer (F01) is used.
  window.farmerDemoSignIn = async function() {
    setEntryError('entryFarmerError', '');
    const btn = $('entryFarmerBtn');
    if (btn) btn.disabled = true;
    try {
      const data = await apiJson('/api/v1/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'farmer', farmerId: 'F01', pin: '1234' }),
      });
      farmerToken = data.token;
      farmerUser = data.user;
      store.set('sessionStorage', FARMER_KEY, JSON.stringify({ token: data.token, user: data.user }));
      enterPortal('farmer');
    } catch (err) {
      setEntryError('entryFarmerError', `${tr('ডেমো প্রবেশ করা যায়নি।', 'Could not start the demo sign-in.')} ${failureText(err)}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /** Manager sign-in with Supabase Auth: the account's email is the user ID plus the server's AUTH_EMAIL_DOMAIN (toAuthEmail). */
  window.entryOfficerSignIn = async function(event) {
    event?.preventDefault();
    setEntryError('entryOfficerError', '');
    const userId = normalizeUserId($('entryOfficerUserId')?.value);
    const password = $('entryOfficerPassword')?.value || '';
    if (!userId || !password) {
      setEntryError('entryOfficerError', tr('ইউজার আইডি ও পাসওয়ার্ড দুটোই দিন।', 'Enter both your user ID and password.'));
      return;
    }
    const wrong = tr('ইউজার আইডি বা পাসওয়ার্ড সঠিক নয়।', 'The user ID or password is incorrect.');
    // one generic message for every credential problem: never say which of the two was wrong
    if (/[@\s]/.test(userId)) {
      setEntryError('entryOfficerError', wrong);
      return;
    }
    const btn = $('entryOfficerBtn');
    if (btn) btn.disabled = true;
    try {
      const supabase = await supabaseClient();
      if (!supabase) {
        const cfg = await authConfig();
        setEntryError('entryOfficerError', cfg
          ? tr('এই সার্ভারে কর্মকর্তা লগইন এখনো চালু করা হয়নি।', 'Officer sign-in is not set up on this server yet.')
          : tr('সার্ভারে পৌঁছানো যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।', 'Could not reach the server. Check your connection and try again.'));
        return;
      }
      const email = await toAuthEmail(userId);
      if (!email) {
        setEntryError('entryOfficerError', tr('এই সার্ভারে কর্মকর্তা লগইন এখনো চালু করা হয়নি।', 'Officer sign-in is not set up on this server yet.'));
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.name === 'AuthRetryableFetchError' || error.status === 0 || error.status >= 500) {
          setEntryError('entryOfficerError', tr('সার্ভারে পৌঁছানো যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।', 'Could not reach the server. Check your connection and try again.'));
        } else if (error.status === 429) {
          setEntryError('entryOfficerError', tr('অনেকবার চেষ্টা হয়েছে। একটু পরে আবার চেষ্টা করুন।', 'Too many attempts. Please wait a moment and try again.'));
        } else {
          setEntryError('entryOfficerError', wrong);
        }
        return;
      }
      // the server decides whether this account is an officer (app_metadata.role); a refused account is signed out again
      const status = await ctx.setOfficerSession({ source: 'supabase', officer: null });
      if (status === 'denied') {
        setEntryError('entryOfficerError', wrong);
        return;
      }
      if (status === 'unavailable') {
        await ctx.signOutOfficer();
        setEntryError('entryOfficerError', tr('সার্ভারে পৌঁছানো যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।', 'Could not reach the server. Check your connection and try again.'));
        return;
      }
      $('entryOfficerUserId').value = '';
      $('entryOfficerPassword').value = '';
      enterPortal('officer');
    } catch {
      setEntryError('entryOfficerError', tr('সার্ভারে পৌঁছানো যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।', 'Could not reach the server. Check your connection and try again.'));
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /** The old shared-code demo login. The server refuses it unless it runs with DEMO_MODE=true. */
  window.entryOfficerDemoSignIn = async function(event) {
    event?.preventDefault();
    setEntryError('entryDemoError', '');
    const officerId = $('entryDemoUserId')?.value.trim() || '';
    const password = $('entryDemoPassword')?.value || '';
    const btn = $('entryDemoBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/v1/officer/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officerId, accessCode: password }),
      });
      if (!res.ok) {
        setEntryError('entryDemoError', tr('ইউজার আইডি বা পাসওয়ার্ড সঠিক নয়।', 'The user ID or password is incorrect.'));
        return;
      }
      await ctx.setOfficerSession({ ...(await res.json()), source: 'demo' });
      $('entryDemoUserId').value = '';
      $('entryDemoPassword').value = '';
      enterPortal('officer');
    } catch {
      setEntryError('entryDemoError', tr('সার্ভারে পৌঁছানো যায়নি। আবার চেষ্টা করুন।', 'Could not reach the server. Please try again.'));
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /** End the role (and its demo session) and go back to the picker. */
  window.signOutRole = function() {
    if (farmerToken) fetch('/api/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${farmerToken}` } }).catch(() => {});
    farmerToken = null;
    farmerUser = null;
    store.set('sessionStorage', FARMER_KEY, null);
    store.set('sessionStorage', ROLE_KEY, null);
    ctx.signOutOfficer(); // ends the Supabase session (or the demo one) whatever role was open
    applyRole(null);
    window.showEntryStep('choose');
    window.scrollTo({ top: 0 });
  };

  /** On load: re-enter a role only for a visitor choice or a demo session the server still accepts. */
  async function restoreSession() {
    const saved = store.get('sessionStorage', ROLE_KEY);
    // a Supabase session that survived closing the browser (and that the server accepted at start-up) goes straight back in
    if (!saved) { if (ctx.officerSignedIn()) enterPortal('officer'); return; }
    if (saved === 'visitor') { enterPortal('visitor'); return; }
    if ($('entryChecking')) $('entryChecking').hidden = false;
    try {
      if (saved === 'farmer') {
        const stored = JSON.parse(store.get('sessionStorage', FARMER_KEY) || 'null');
        if (!stored?.token) throw new Error('no session');
        const data = await apiJson('/api/v1/auth/session', { headers: { Authorization: `Bearer ${stored.token}` } });
        farmerToken = stored.token;
        farmerUser = data.user || stored.user;
        enterPortal('farmer');
      } else if (saved === 'officer') {
        if (!ctx.officerSignedIn()) throw new Error('no session');
        enterPortal('officer');
      }
    } catch {
      store.set('sessionStorage', ROLE_KEY, null);
      store.set('sessionStorage', FARMER_KEY, null);
    } finally {
      if ($('entryChecking')) $('entryChecking').hidden = true;
    }
  }

  // Screens: each role opens only its own; the weather screen is the farmer screen's weather tab on its own
  const baseSwitch = window.switchScreen;
  window.switchScreen = function(requested) {
    if (!role) return;
    // a screen this role does not see (e.g. the planner's jump to the officers' comparison) is ignored
    if (!ROLES[role].screens.includes(requested)) return;
    const id = requested;
    const weatherOnly = id === 'screen-weather';
    document.body.classList.toggle('weather-only', weatherOnly);
    baseSwitch(weatherOnly ? 'screen-farmer' : id);
    document.querySelectorAll('.nav-tab[data-screen]').forEach(t => t.classList.toggle('active', t.dataset.screen === id));
    if (weatherOnly) showFarmerTab('weather');
    else if (id === 'screen-farmer') showFarmerTab(farmerTab);
    if (id === 'screen-cattle') initCattleScreen();
  };

  // ------------------------------------------------------------------------------------------------------------------
  // Farmer portal: the Android app's five tabs
  // ------------------------------------------------------------------------------------------------------------------

  function showFarmerTab(tab) {
    if (!document.body.classList.contains('weather-only')) farmerTab = tab;
    document.querySelectorAll('.portal-tab').forEach(b => {
      const on = b.dataset.ftab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.portal-panel').forEach(p => p.classList.toggle('active', p.id === `fpanel-${tab}`));
    if (tab === 'today') renderToday();
    if (tab === 'weather') loadWeatherForecast();
    if (tab === 'erosion') window.fetchRiverErosion($('erosionRiverSelect')?.value || 'jamuna');
    if (tab === 'farm') renderFarm();
  }
  window.switchFarmerTab = showFarmerTab;

  // Today: the same plan the phone call and the Android app give, for the farmer's place
  let todayRain = { key: null, text: '' };
  function renderToday() {
    const advice = ctx.advice();
    const top = advice?.options?.[0];
    const card = advice?.farmer_card;
    if (!top) {
      setText('todayTitle', tr('পরামর্শ লোড হচ্ছে…', 'Loading the advice…'));
      return;
    }
    setText('todayTitle', lang() === 'en' ? top.nameEnglish : (card?.rotationTitleBangla || top.nameBangla));
    setText('todaySubtitle', lang() === 'en' ? top.fieldFreeDateEnglish && `Field free by ${top.fieldFreeDateEnglish}` : (card?.rotationSubtitleBangla || ''));
    const seq = top.cropSequence || [];
    setHtml('todaySeasons', seq.map((c, i) => `
      <div class="today-season${i === 0 ? ' is-now' : ''}">
        <span class="today-season-label">${escapeHtml(tr(['মৌসুম ১', 'মৌসুম ২', 'মৌসুম ৩'][i] || `মৌসুম ${num(i + 1)}`, `Season ${i + 1}`))}${i === 0 ? ` · ${escapeHtml(tr('চলতি', 'now'))}` : ''}</span>
        <strong>${escapeHtml(tr(c.cropBangla || c.crop, c.crop))}</strong>
        <span>${escapeHtml(tr(c.varietyBangla || c.variety, c.variety))}</span>
        <small>${escapeHtml(tr([c.sowingBangla && `বপন/রোপণ ~${c.sowingBangla}`, c.harvestBangla && `কাটা ~${c.harvestBangla}`].filter(Boolean).join(' · '), c.harvestWindow ? `harvest ${c.harvestWindow}` : ''))}</small>
      </div>`).join(''));
    setText('todayNarrative', lang() === 'en'
      ? (top.approvedActionEnglish || []).join(' ')
      : (card?.narrativeBangla || (top.approvedActionBangla || []).join(' ')));
    const tips = (top.stewardship || []).slice(0, 3);
    setHtml('todayTips', tips.length ? `
      <h4>${escapeHtml(tr('মাটি ও পানি রক্ষা', 'Soil and water'))}</h4>
      <ul>${tips.map(t => `<li>${escapeHtml(tr(t.bn, t.en))}</li>`).join('')}</ul>` : '');
    loadTodayRain();
  }

  async function loadTodayRain() {
    const scope = ctx.overview()?.scope;
    if (!scope || !Number.isFinite(scope.lat) || !Number.isFinite(scope.lon)) { setText('todayRain', ''); return; }
    const key = `${scope.lat},${scope.lon},${lang()}`;
    if (todayRain.key === key) { setText('todayRain', todayRain.text); return; }
    setText('todayRain', tr('আগামী ৪৮ ঘণ্টার বৃষ্টির পূর্বাভাস আনা হচ্ছে…', 'Getting the 48-hour rain forecast…'));
    try {
      const data = await apiJson(`/api/v1/weather/forecast?lat=${scope.lat}&lon=${scope.lon}`);
      const f = data.forecast;
      const hours = (f.hourly || []).filter(h => h.time >= f.current.time.slice(0, 13)).slice(0, 48);
      const mm = hours.reduce((s, h) => s + (Number(h.precipitationMm) || 0), 0);
      const text = mm < 1
        ? tr('আগামী ৪৮ ঘণ্টায় উল্লেখযোগ্য বৃষ্টির সম্ভাবনা কম (Open-Meteo মডেল অনুমান)।', 'Little rain expected in the next 48 hours (Open-Meteo model estimate).')
        : tr(`আগামী ৪৮ ঘণ্টায় প্রায় ${num(mm.toFixed(0))} মিমি বৃষ্টির সম্ভাবনা (Open-Meteo মডেল অনুমান)।`, `About ${mm.toFixed(0)} mm of rain expected in the next 48 hours (Open-Meteo model estimate).`);
      todayRain = { key, text };
      setText('todayRain', text);
    } catch (err) {
      setText('todayRain', `${tr('বৃষ্টির পূর্বাভাস পাওয়া যায়নি।', 'The rain forecast is unavailable.')} ${failureText(err)}`);
    }
  }

  // Listen: the server's text-to-speech when it is configured, otherwise the device's Bangla voice
  let audioEl = null;
  let speaking = false;
  window.toggleTodayAudio = async function() {
    const stop = () => {
      if (audioEl) { audioEl.pause(); audioEl = null; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      speaking = false;
      setText('todayAudioIcon', 'play_arrow');
    };
    if (speaking) { stop(); return; }
    const script = ctx.advice()?.farmer_card?.audioScriptBangla;
    if (!script) { setText('todayAudioStatus', tr('শোনানোর মতো পরামর্শ এখনো লোড হয়নি।', 'There is no advice to read yet.')); return; }
    speaking = true;
    setText('todayAudioIcon', 'stop');
    try {
      const res = await fetch('/api/v1/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: script, language: 'bn' }) });
      if (res.ok && (res.headers.get('content-type') || '').startsWith('audio/')) {
        audioEl = new Audio(URL.createObjectURL(await res.blob()));
        audioEl.onended = stop;
        setText('todayAudioStatus', tr('সার্ভারের ভয়েসে শোনানো হচ্ছে।', 'Playing the server voice.'));
        await audioEl.play();
        return;
      }
    } catch { /* the device voice below */ }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(script);
      u.lang = 'bn-BD';
      u.rate = 0.95;
      u.onend = stop;
      u.onerror = stop;
      setText('todayAudioStatus', tr('ডিভাইসের বাংলা ভয়েসে শোনানো হচ্ছে (সার্ভারে ভয়েস চালু নেই)।', 'Using this device\'s voice (no server voice configured).'));
      window.speechSynthesis.speak(u);
      return;
    }
    setText('todayAudioStatus', tr('এই ব্রাউজারে শোনানো সম্ভব নয়; লেখা পরামর্শ পড়ুন।', 'Audio is unavailable in this browser; please read the advice.'));
    stop();
  };

  window.requestTodayCallback = async function() {
    const ok = await ctx.keypad('9');
    setText('todayNotice', ok
      ? tr('কল-ব্যাক অনুরোধ কর্মকর্তা ডেস্কে উঠেছে (ডেমো)। কোনো ফোন কল বা এসএমএস হয়নি।', 'The call-back request is on the officer desk (demo). No call or SMS was made.')
      : tr('কল-ব্যাক অনুরোধ নথিভুক্ত করা যায়নি। আবার চেষ্টা করুন।', 'Could not record the call-back request. Please try again.'));
  };

  // My farm: the signed-in farmer's record from the server, else the sample profile
  const LAND = { high: ['উঁচু জমি', 'High land'], medium_high: ['মাঝারি উঁচু জমি', 'Medium-high land'], medium_low: ['মাঝারি নিচু জমি', 'Medium-low land'], low: ['নিচু জমি', 'Low land'] };
  function renderFarm() {
    const u = farmerUser;
    const name = $('mfName');
    if (!name) return;
    if (!u) {
      setText('mfName', tr('নমুনা কৃষক ০১', 'Sample farmer 01'));
      setText('mfPhone', tr('017XX-XXX01 (গোপনীয়)', '017XX-XXX01 (private)'));
      setText('mfVillage', tr('নমুনা গ্রাম ০১, তালন্দ, তানোর, রাজশাহী', 'Sample village 01, Talanda, Tanore, Rajshahi'));
      setText('mfLand', tr('২.৫ বিঘা, মাঝারি উঁচু, খিয়ার মাটি', '2.5 bigha, medium-high, khiyar soil'));
      setText('mfAman', tr('ব্রি ধান৭১', 'BRRI dhan71'));
      return;
    }
    setText('mfName', tr(u.nameBangla, u.nameEnglish || u.nameBangla));
    setText('mfPhone', u.phoneMasked || '—');
    setText('mfVillage', u.blockOrVillageBangla || '—');
    setText('mfLand', tr(...(LAND[u.landType] || [u.landType || '—', u.landType || '—'])));
    setText('mfAman', u.currentAmanCrop || '—');
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Assistant: crop sentences get a plan (the Android app's flow), other questions the grounded assistant
  // ------------------------------------------------------------------------------------------------------------------

  function addBubble(who, html, extraClass = '') {
    const chat = $('farmerAiMessages');
    if (!chat) return null;
    const div = document.createElement('div');
    div.className = `chat-bubble ${who} ${extraClass}`.trim();
    div.innerHTML = html;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  window.sendAiPrompt = function(text) {
    const input = $('farmerAiInput');
    if (!input) return;
    input.value = text;
    window.handleAiChatSubmit();
  };

  window.handleAiChatSubmit = async function(event) {
    event?.preventDefault();
    const input = $('farmerAiInput');
    const query = input?.value?.trim();
    if (!query) return;
    input.value = '';
    addBubble('farmer', escapeHtml(query));
    const waiting = addBubble('assistant', '…', 'is-waiting');
    try {
      const plan = await apiJson('/api/v1/voice/answer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query, unionId: ctx.place() }),
      });
      const u = plan.understood || {};
      if ((u.crops && u.crops.length) || u.hero || (u.excluded && u.excluded.length)) {
        const tips = (plan.advice?.options?.[0]?.stewardship || []).slice(0, 3);
        waiting.classList.remove('is-waiting');
        waiting.innerHTML = `${escapeHtml(plan.reply.speechBangla)}${tips.length ? `<ul class="chat-tips">${tips.map(t => `<li>${escapeHtml(tr(t.bn, t.en))}</li>`).join('')}</ul>` : ''}
          <span class="chat-source">${escapeHtml(tr('উৎস: নাসা POWER ও GPM IMERG-এর ২৫ মৌসুম, SRDI, BRRI/BARI', 'Source: 25 seasons of NASA POWER and GPM IMERG, SRDI, BRRI/BARI'))}</span>`;
        return;
      }
    } catch { /* fall back to the assistant */ }
    try {
      const data = await apiJson('/api/v1/ai/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, ...(ctx.overview()?.scope?.lat ? { lat: ctx.overview().scope.lat, lon: ctx.overview().scope.lon } : {}) }),
      });
      waiting.classList.remove('is-waiting');
      waiting.innerHTML = `${escapeHtml(data.answer)}${data.sources?.length ? `<span class="chat-source">${escapeHtml(tr('উৎস', 'Sources'))}: ${escapeHtml(data.sources.join(', '))}</span>` : ''}`;
    } catch (err) {
      waiting.classList.remove('is-waiting');
      waiting.textContent = `${tr('উত্তর তৈরি করা যায়নি।', 'Could not answer.')} ${failureText(err)}`;
    }
  };

  // Ask by voice (Chrome's speech recognition in Bangla)
  window.listenAiQuestion = function() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      addBubble('assistant', escapeHtml(tr('এই ব্রাউজারে কথা থেকে লেখা হয় না (Chrome ব্যবহার করুন); লিখে প্রশ্ন করুন।', 'This browser cannot turn speech into text (use Chrome); please type.')));
      return;
    }
    const rec = new Rec();
    rec.lang = 'bn-BD';
    rec.interimResults = false;
    const mic = $('farmerAiMic');
    mic?.classList.add('is-listening');
    rec.onresult = (e) => { $('farmerAiInput').value = e.results[0][0].transcript; window.handleAiChatSubmit(); };
    rec.onend = () => mic?.classList.remove('is-listening');
    rec.onerror = () => mic?.classList.remove('is-listening');
    rec.start();
  };

  // ------------------------------------------------------------------------------------------------------------------
  // River erosion
  // ------------------------------------------------------------------------------------------------------------------

  window.fetchRiverErosion = async function(river) {
    const box = $('erosionStationList');
    if (!box) return;
    try {
      const data = await apiJson(`/api/v1/erosion?river=${encodeURIComponent(river)}`);
      const stations = data.corridor?.stations || [];
      box.innerHTML = stations.map(s => {
        const level = s.recentPeakM ?? s.waterLevelM ?? null;
        const danger = s.dangerLevelM ?? null;
        const over = level != null && danger != null && level >= danger;
        return `<div class="erosion-row ${over ? 'is-danger' : ''}">
          <div><strong>${escapeHtml(tr(s.stationNameBangla || s.stationId, s.stationNameEnglish || s.stationId))}</strong>
            <small>${escapeHtml(s.districtBangla || '')} · ${escapeHtml(tr('বিপদসীমা', 'danger level'))} ${danger != null ? num(danger.toFixed(2)) : '—'} ${tr('মি', 'm')} · ${escapeHtml(tr('সাম্প্রতিক সর্বোচ্চ', 'recent peak'))} ${level != null ? num(level.toFixed(2)) : '—'} ${tr('মি', 'm')}${s.annualBankShiftEstimateBangla && lang() !== 'en' ? ` · তীর সরে ${escapeHtml(s.annualBankShiftEstimateBangla)}` : ''}</small></div>
          <span class="badge ${/High/.test(s.riskLevelEnglish || '') || over ? 'badge-danger' : /Moderate/.test(s.riskLevelEnglish || '') ? 'badge-warning' : 'badge-success'}">${escapeHtml(tr(s.riskLevelBangla || (over ? 'বিপদসীমার ওপরে' : 'স্বাভাবিক'), s.riskLevelEnglish ? `${s.riskLevelEnglish} risk` : (over ? 'Above danger level' : 'Normal')))}</span>
        </div>`;
      }).join('') + (data.corridor?.sourceBangla || data.source ? `<p class="weather-source-note">${escapeHtml(tr(data.corridor?.sourceBangla || data.source || '', data.corridor?.source || data.source || ''))}</p>` : '');
    } catch (err) {
      box.innerHTML = `<p class="weather-source-note">${escapeHtml(failureText(err))}</p>`;
    }
  };

  // ------------------------------------------------------------------------------------------------------------------
  // Weather: any of 500 upazilas or the device's location; Open-Meteo forecast, NASA POWER, hourly THI
  // ------------------------------------------------------------------------------------------------------------------

  let weatherLocations = [];
  let selectedWeather = null;
  let weatherSeq = 0;
  let weatherForecast = null;
  let weatherNasa = null;

  const weatherName = (loc) => loc.source === 'gps'
    ? tr(`আপনার বর্তমান অবস্থান (${num(loc.lat.toFixed(2))}, ${num(loc.lon.toFixed(2))})`, `Your current location (${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)})`)
    : tr(`${loc.upazilaBn}, ${loc.districtBn}`, `${loc.upazilaEn}, ${loc.districtEn}`);

  function weatherStatus(kind, bn, en, retry = false) {
    const box = $('weatherStatusBox');
    if (!box) return;
    box.hidden = !bn;
    box.className = `weather-status weather-status-${kind}`;
    setText('weatherStatusText', bn ? tr(bn, en) : '');
    const btn = $('weatherRetryBtn');
    if (btn) btn.hidden = !retry;
  }

  function clearWeather() {
    weatherForecast = null;
    weatherNasa = null;
    ['fwTemp', 'fwHumidity', 'fwRain'].forEach(id => setText(id, '—'));
    ['weatherForecastList', 'weatherHourlyThi', 'weatherNasaBox'].forEach(id => setHtml(id, ''));
    setText('weatherSourceNote', '');
  }

  function renderWeatherSelectors() {
    const dSel = $('weatherDistrictSelect');
    const uSel = $('weatherUpazilaSelect');
    if (!dSel || !uSel || !weatherLocations.length) return;
    const prevD = dSel.value;
    const prevU = uSel.value;
    const districts = [...new Map(weatherLocations.map(l => [l.districtId, { id: l.districtId, bn: l.districtBn, en: l.districtEn }])).values()]
      .sort((a, b) => (lang() === 'en' ? a.en.localeCompare(b.en) : a.bn.localeCompare(b.bn, 'bn')));
    const district = districts.some(d => d.id === prevD) ? prevD : (selectedWeather?.districtId || districts[0]?.id);
    dSel.innerHTML = districts.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(tr(d.bn, d.en))}</option>`).join('');
    dSel.value = district;
    dSel.disabled = false;
    const inDistrict = weatherLocations.filter(l => l.districtId === district)
      .sort((a, b) => (lang() === 'en' ? a.upazilaEn.localeCompare(b.upazilaEn) : a.upazilaBn.localeCompare(b.upazilaBn, 'bn')));
    const upazila = inDistrict.some(l => l.id === prevU) ? prevU : (selectedWeather?.districtId === district ? selectedWeather.id : '');
    uSel.innerHTML = `<option value="">${escapeHtml(tr('উপজেলা বেছে নিন', 'Choose an upazila'))}</option>${inDistrict.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(tr(l.upazilaBn, l.upazilaEn))}</option>`).join('')}`;
    uSel.value = upazila;
    uSel.disabled = false;
  }

  async function initWeatherLocations() {
    const dSel = $('weatherDistrictSelect');
    const uSel = $('weatherUpazilaSelect');
    if (!dSel || !uSel) return;
    try {
      const payload = await apiJson('/api/v1/locations');
      weatherLocations = (payload?.districts || []).flatMap(d => d.upazilas.map(u => ({
        id: u.id, districtId: d.id, districtBn: d.nameBn, districtEn: d.nameEn, upazilaBn: u.nameBn, upazilaEn: u.nameEn, lat: u.lat, lon: u.lon,
      })));
      if (!weatherLocations.length) throw new ApiFailure('no_data', 'empty location list');
      const saved = (() => { try { return JSON.parse(store.get('localStorage', WEATHER_KEY) || 'null'); } catch { return null; } })();
      if (saved?.type === 'gps' && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) selectedWeather = { id: `gps:${saved.lat},${saved.lon}`, source: 'gps', lat: saved.lat, lon: saved.lon };
      else if (saved?.id) selectedWeather = weatherLocations.find(l => l.id === saved.id) || null;
      renderWeatherSelectors();
      setText('weatherDataNotice', selectedWeather
        ? tr(`${weatherName(selectedWeather)}-এর পূর্বাভাস।`, `Forecast for ${weatherName(selectedWeather)}.`)
        : tr('আবহাওয়া দেখতে জেলা ও উপজেলা বেছে নিন, অথবা বর্তমান অবস্থান ব্যবহার করুন।', 'Choose a district and upazila, or use your current location.'));
      dSel.addEventListener('change', () => {
        selectedWeather = null;
        clearWeather();
        renderWeatherSelectors();
        weatherStatus('', '', '');
        store.set('localStorage', WEATHER_KEY, null);
        setText('weatherDataNotice', tr('এবার উপজেলা বেছে নিন।', 'Now choose an upazila.'));
      });
      uSel.addEventListener('change', () => {
        selectedWeather = weatherLocations.find(l => l.id === uSel.value) || null;
        clearWeather();
        if (!selectedWeather) return;
        store.set('localStorage', WEATHER_KEY, JSON.stringify({ type: 'upazila', id: selectedWeather.id }));
        loadWeatherForecast();
      });
    } catch (err) {
      dSel.disabled = true;
      uSel.disabled = true;
      weatherStatus('error', `জেলা-উপজেলার তালিকা লোড করা যায়নি। ${failureText(err)}`, `Could not load the district and upazila list. ${failureText(err)}`, true);
      $('weatherRetryBtn')?.setAttribute('data-retry', 'locations');
    }
  }

  window.useCurrentWeatherLocation = function() {
    if (!('geolocation' in navigator)) {
      weatherStatus('error', 'এই ব্রাউজার অবস্থান জানাতে পারে না। জেলা ও উপজেলা বেছে নিন।', 'This browser cannot share its location. Please choose a district and upazila.');
      return;
    }
    weatherStatus('info', 'আপনার অবস্থান খোঁজা হচ্ছে…', 'Finding your location…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = Math.round(pos.coords.latitude * 100) / 100; // ~1 km, coarse on purpose: it is kept on the device
      const lon = Math.round(pos.coords.longitude * 100) / 100;
      if (lat < 20.4 || lat > 26.8 || lon < 88.0 || lon > 92.8) {
        weatherStatus('error', 'আপনার অবস্থান বাংলাদেশের বাইরে। জেলা ও উপজেলা বেছে নিন।', 'Your location is outside Bangladesh. Please choose a district and upazila.');
        return;
      }
      selectedWeather = { id: `gps:${lat},${lon}`, source: 'gps', lat, lon };
      clearWeather();
      store.set('localStorage', WEATHER_KEY, JSON.stringify({ type: 'gps', lat, lon }));
      loadWeatherForecast();
    }, (err) => {
      if (err.code === err.PERMISSION_DENIED) weatherStatus('error', 'অবস্থানের অনুমতি দেওয়া হয়নি। জেলা ও উপজেলা বেছে নিন।', 'Location permission was denied. Please choose a district and upazila.');
      else if (err.code === err.TIMEOUT) weatherStatus('error', 'অবস্থান খুঁজতে বেশি সময় লাগছে। আবার চেষ্টা করুন বা হাতে বেছে নিন।', 'Finding your location timed out. Try again or choose by hand.');
      else weatherStatus('error', 'অবস্থান পাওয়া যায়নি (জিপিএস বন্ধ থাকতে পারে)। হাতে বেছে নিন।', 'Your position is unavailable (GPS may be off). Please choose by hand.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  };

  window.retryWeather = function() {
    if ($('weatherRetryBtn')?.getAttribute('data-retry') === 'locations') initWeatherLocations();
    else loadWeatherForecast();
  };

  const weatherIcon = (code) => {
    if (code === 0 || code === 1) return 'wb_sunny';
    if (code === 2 || code === 3) return 'partly_cloudy_day';
    if (code === 45 || code === 48) return 'foggy';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rainy';
    if (code >= 95) return 'thunderstorm';
    return 'cloud';
  };
  // NRC (1971) THI, the formula the API uses, only for hours with both temperature and humidity
  const thiOf = (t, rh) => (1.8 * t + 32) - (0.55 - 0.0055 * Math.min(100, Math.max(0, rh))) * (1.8 * t - 26);
  const thiClass = (thi) => (thi < 72 ? 'normal' : thi < 79 ? 'alert' : thi < 84 ? 'danger' : 'emergency');

  function renderHourlyThi(forecast) {
    const hours = (forecast.hourly || []).filter(h => h.time >= forecast.current.time.slice(0, 13)).slice(0, 24);
    const usable = hours.filter(h => h.temperatureC != null && h.relativeHumidityPct != null);
    if (!usable.length) { setHtml('weatherHourlyThi', ''); return; }
    const missing = hours.length - usable.length;
    setHtml('weatherHourlyThi', `<h4>${escapeHtml(tr('গরুর তাপ চাপ সূচক (THI), প্রতি ঘণ্টা', 'Cattle heat-stress index (THI), hour by hour'))}</h4>
      <p class="weather-source-note">${escapeHtml(tr('আবহাওয়া মডেলের ঘণ্টাভিত্তিক তাপমাত্রা ও আর্দ্রতা থেকে হিসাব (NRC 1971 সূত্র); দুধেল গরুর সাধারণ শ্রেণি, দেশি জাতের জন্য যাচাই করা নয়।', 'Calculated from the model\'s hourly temperature and humidity (NRC 1971); generic dairy-cattle classes, not validated for local breeds.'))}</p>
      <div class="hourly-thi-strip">${usable.map(h => {
        const thi = thiOf(Number(h.temperatureC), Number(h.relativeHumidityPct));
        return `<div class="hourly-thi-pill thi-${thiClass(thi)}"><span>${num(h.time.slice(11, 16))}</span><strong>${num(thi.toFixed(0))}</strong><small>${num(Number(h.temperatureC).toFixed(0))}°C · ${num(Math.round(Number(h.relativeHumidityPct)))}%</small></div>`;
      }).join('')}</div>
      ${missing ? `<p class="weather-source-note">${escapeHtml(tr(`${num(missing)} ঘণ্টার তথ্য অসম্পূর্ণ, বাদ দেওয়া হয়েছে।`, `${missing} hour(s) lack temperature or humidity and are left out.`))}</p>` : ''}`);
  }

  function renderNasaBox(nasa, failure) {
    if (failure) {
      setHtml('weatherNasaBox', `<h4>${escapeHtml(tr('নাসা পর্যবেক্ষণ (দেরিতে আসা তথ্য)', 'NASA observations (delayed data)'))}</h4><p class="weather-source-note">${escapeHtml(failureText(failure))}</p>`);
      return;
    }
    const mm = (v) => (v == null ? '—' : `${num(Number(v).toFixed(1))} ${tr('মিমি', 'mm')}`);
    const deg = (v) => (v == null ? '—' : `${num(Number(v).toFixed(1))}°C`);
    setHtml('weatherNasaBox', `<h4>${escapeHtml(tr('নাসা পর্যবেক্ষণ: দেরিতে আসা, সরাসরি নয়', 'NASA observations: delayed, not live'))}</h4>
      <p class="weather-source-note">${escapeHtml(tr(`নাসা POWER; সর্বশেষ পর্যবেক্ষণ ${isoDate(nasa.latestObservationDate)}। এটি পূর্বাভাস নয়।`, `NASA POWER; latest observation ${isoDate(nasa.latestObservationDate)}. Not a forecast.`))}</p>
      <ul class="weather-facts">
        <li>${escapeHtml(tr('সর্বশেষ দিনের গড় তাপমাত্রা', 'Latest-day mean temperature'))}: <strong>${deg(nasa.latest?.t2m)}</strong></li>
        <li>${escapeHtml(tr('৩০ দিনের গড় তাপমাত্রা', '30-day mean temperature'))}: <strong>${deg(nasa.meanT2mWindow)}</strong></li>
        <li>${escapeHtml(tr('৩০ দিনের মোট বৃষ্টি', '30-day rain'))}: <strong>${mm(nasa.rainWindowMm)}</strong> (${num(nasa.rainDaysWithData ?? '—')}/${num(30)} ${escapeHtml(tr('দিনের তথ্য', 'days with data'))})</li>
      </ul>`);
  }

  function renderWeatherForecast(data, loc) {
    const f = data?.forecast;
    if (!f?.current || !Array.isArray(f.daily)) return;
    const cur = f.current;
    const locale = lang() === 'en' ? 'en-GB' : 'bn-BD';
    const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: f.timezone || 'Asia/Dhaka' });
    const next24 = (f.hourly || []).filter(h => h.time >= cur.time.slice(0, 13)).slice(0, 24);
    const rain24 = next24.length === 24 && next24.every(h => h.precipitationMm != null) ? next24.reduce((s, h) => s + Number(h.precipitationMm), 0) : NaN;
    setText('fwTemp', cur.temperatureC == null ? '—' : `${num(Number(cur.temperatureC).toFixed(1))}°C`);
    setText('fwHumidity', cur.relativeHumidityPct == null ? '—' : `${num(Math.round(Number(cur.relativeHumidityPct)))}%`);
    setText('fwRain', Number.isFinite(rain24) ? `${num(rain24.toFixed(1))} ${tr('মিমি', 'mm')}` : '—');
    const updated = f.fetchedAt ? new Date(f.fetchedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '';
    setText('weatherDataNotice', `${weatherName(loc)} · ${tr('হালনাগাদ', 'updated')} ${updated}`);
    setText('weatherSourceNote', tr('সূত্র: Open-Meteo, সংখ্যাভিত্তিক আবহাওয়া মডেলের অনুমান (পূর্বাভাস), স্থানীয় স্টেশনের মাপ নয়।', 'Source: Open-Meteo, a numerical weather-model estimate (forecast), not a local station measurement.'));
    setHtml('weatherForecastList', f.daily.map(day => `<div class="weather-day-card">
        <span class="weather-day-date">${escapeHtml(day.date ? dateFmt.format(new Date(`${day.date}T12:00:00`)) : '')}</span>
        <span class="material-symbols-outlined weather-day-icon" aria-hidden="true">${weatherIcon(Number(day.weatherCode))}</span>
        <span class="weather-day-temperature">${num(day.temperatureMaxC == null ? '—' : Number(day.temperatureMaxC).toFixed(0))}° / ${num(day.temperatureMinC == null ? '—' : Number(day.temperatureMinC).toFixed(0))}°</span>
        <span class="weather-day-rain">${day.precipitationMm == null ? '—' : `${num(Number(day.precipitationMm).toFixed(1))} ${tr('মিমি', 'mm')}`}</span>
      </div>`).join(''));
    renderHourlyThi(f);
  }

  async function loadWeatherForecast() {
    const loc = selectedWeather;
    if (!loc) return;
    const seq = ++weatherSeq;
    clearWeather();
    weatherStatus('info', `${weatherName(loc)}-এর আবহাওয়া আনা হচ্ছে…`, `Loading the weather for ${weatherName(loc)}…`);
    const q = new URLSearchParams({ lat: String(loc.lat), lon: String(loc.lon) });
    // the two sources are independent: a NASA outage must not hide the forecast, nor the other way round
    const [fc, nasa] = await Promise.allSettled([apiJson(`/api/v1/weather/forecast?${q}`), apiJson(`/api/v1/weather?${q}`)]);
    if (seq !== weatherSeq) return;
    if (fc.status === 'fulfilled') {
      weatherForecast = fc.value;
      weatherStatus('', '', '');
      renderWeatherForecast(weatherForecast, loc);
    } else {
      weatherStatus('error', `${weatherName(loc)}-এর পূর্বাভাস আনা যায়নি। ${failureText(fc.reason)}`, `Could not load the forecast for ${weatherName(loc)}. ${failureText(fc.reason)}`, true);
      $('weatherRetryBtn')?.setAttribute('data-retry', 'forecast');
    }
    if (nasa.status === 'fulfilled') { weatherNasa = nasa.value; renderNasaBox(weatherNasa, null); } else renderNasaBox(null, nasa.reason);
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Cattle: farm outlines, background jobs, the THI advisory
  // ------------------------------------------------------------------------------------------------------------------

  let cattleAois = [];
  let selectedAoi = null;
  let cattleMap = null;
  let aoiLayer = null;
  let aoiMarker = null;
  let drawing = false;
  let drawPoints = [];
  let drawMarkers = [];
  let drawLine = null;
  let cattleAdvisory = null;
  let pollTimer = null;

  function cattleNotice(kind, bn, en) {
    const box = $('cattleNotice');
    if (!box) return;
    box.hidden = !bn;
    box.className = `cattle-notice is-${kind || 'info'}`;
    box.textContent = bn ? tr(bn, en) : '';
  }

  const writeHeaders = () => {
    const token = store.get('sessionStorage', 'eden.writeToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  async function initCattleScreen() {
    await window.refreshCattleReadiness();
    initCattleMap();
    await window.loadCattleAois();
  }

  function initCattleMap() {
    const el = $('cattleMap');
    if (!el || !window.L) return;
    if (!cattleMap) {
      cattleMap = window.L.map(el).setView([23.7, 90.4], 7);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(cattleMap);
      cattleMap.on('click', (e) => { if (drawing) addDrawPoint(e.latlng); });
    }
    setTimeout(() => cattleMap.invalidateSize(), 200);
  }

  window.refreshCattleReadiness = async function() {
    try {
      const ready = await apiJson('/api/v1/cattle/readiness');
      const ee = ready.earthEngine;
      const badge = $('cattleEeBadge');
      const banner = $('cattleEeBanner');
      if (ee.status === 'ready') {
        if (badge) { badge.className = 'badge badge-success'; badge.textContent = tr('আর্থ ইঞ্জিন প্রস্তুত', 'Earth Engine ready'); }
        if (banner) banner.hidden = true;
      } else {
        if (badge) { badge.className = 'badge badge-warning'; badge.textContent = ee.status === 'error' ? tr('আর্থ ইঞ্জিনে সমস্যা', 'Earth Engine error') : tr('আর্থ ইঞ্জিন চালু নেই', 'Earth Engine not set up'); }
        if (banner) banner.hidden = false;
        setText('cattleEeBannerText', tr(
          `উপগ্রহের তথ্য (NDVI, মাটির রস, বৃষ্টি) এখন পাওয়া যাচ্ছে না: ${ee.details || ''} আবহাওয়া ও THI আলাদাভাবে কাজ করছে।`,
          `Satellite data (NDVI, soil moisture, rain) is unavailable: ${ee.details || ''} Weather and THI work on their own.`));
        setText('cattleEeSetup', ee.setupInstructions || '');
      }
      setText('cattleDurabilityNote', ready.jobs?.productionDurable === false
        ? tr('কাজের তালিকা সার্ভারের একটি ফাইলে থাকে; সার্ভার আবার চালু হলে চলমান কাজ থেমে যায় (প্রোডাকশনের উপযোগী নয়)।', 'Jobs live in a local server file and running jobs stop if the server restarts (not production-durable).')
        : '');
    } catch (err) {
      cattleNotice('error', `অবস্থা দেখা যায়নি। ${failureText(err)}`, `Could not check the status. ${failureText(err)}`);
    }
  };

  window.loadCattleAois = async function() {
    try {
      const data = await apiJson('/api/v1/cattle/aois');
      cattleAois = data.aois || [];
      const select = $('cattleAoiSelect');
      if (select) {
        select.innerHTML = cattleAois.length
          ? cattleAois.map(a => `<option value="${escapeHtml(a.aoiId)}">${a.demo ? escapeHtml(tr('[ডেমো] ', '[demo] ')) : ''}${escapeHtml(a.farmLabel)} (${escapeHtml(tr(`${num(a.areaHectares)} হেক্টর`, `${a.areaHectares} ha`))})</option>`).join('')
          : `<option value="">${escapeHtml(tr('কোনো খামার নেই: মানচিত্রে আঁকুন', 'No farm yet: draw one on the map'))}</option>`;
      }
      if (cattleAois.length) window.selectCattleAoi(selectedAoi && cattleAois.some(a => a.aoiId === selectedAoi.aoiId) ? selectedAoi.aoiId : cattleAois[0].aoiId);
      else renderCattleAdvisory(null);
    } catch (err) {
      cattleNotice('error', `খামারের তালিকা আনা যায়নি। ${failureText(err)}`, `Could not load the farm list. ${failureText(err)}`);
    }
  };

  window.selectCattleAoi = async function(aoiId) {
    if (!aoiId) return;
    if ($('cattleAoiSelect')) $('cattleAoiSelect').value = aoiId;
    selectedAoi = cattleAois.find(a => a.aoiId === aoiId) || null;
    if (!selectedAoi) return;
    setText('selectedAoiArea', tr(`${num(selectedAoi.areaHectares)} হেক্টর (${num(selectedAoi.areaAcres)} একর)`, `${selectedAoi.areaHectares} ha (${selectedAoi.areaAcres} ac)`));
    drawAoi(selectedAoi);
    cattleNotice('', '', '');
    cattleAdvisory = null;
    renderCattleAdvisory(null);
    try {
      const data = await apiJson(`/api/v1/cattle/aois/${encodeURIComponent(aoiId)}/advisory`);
      cattleAdvisory = data.advisory;
      renderCattleAdvisory(cattleAdvisory);
    } catch (err) {
      if (err.kind === 'no_data') cattleNotice('info', 'এই খামারের পরামর্শ এখনো তৈরি হয়নি। "বিশ্লেষণ চালান" চাপুন।', 'No advice for this farm yet. Press "Run the analysis".');
      else cattleNotice('error', `পরামর্শ আনা যায়নি। ${failureText(err)}`, `Could not load the advice. ${failureText(err)}`);
    }
  };

  function drawAoi(aoi) {
    if (!cattleMap || !window.L) return;
    if (aoiLayer) cattleMap.removeLayer(aoiLayer);
    if (aoiMarker) cattleMap.removeLayer(aoiMarker);
    try {
      aoiLayer = window.L.geoJSON(aoi.geometry, { style: { color: '#1D4A31', weight: 3, opacity: 0.95, fillColor: '#78AB7A', fillOpacity: 0.35 } }).addTo(cattleMap);
      const [lon, lat] = aoi.centroid;
      aoiMarker = window.L.circleMarker([lat, lon], { radius: 6, fillColor: '#C77B26', color: '#FAF8F5', weight: 2, fillOpacity: 1 })
        .addTo(cattleMap).bindTooltip(`${escapeHtml(aoi.farmLabel)}${aoi.nearestUpazila ? `, ${escapeHtml(aoi.nearestUpazila)}` : ''}`);
      cattleMap.fitBounds(aoiLayer.getBounds(), { padding: [30, 30], maxZoom: 16 });
    } catch { /* a malformed outline stays off the map */ }
  }

  window.toggleAoiDraw = function() {
    drawing = !drawing;
    $('drawBar').hidden = !drawing;
    $('drawAoiBtn')?.classList.toggle('active', drawing);
    $('cattleMap')?.classList.toggle('is-drawing', drawing);
    clearDrawing();
    if (drawing) $('drawFarmName')?.focus();
  };

  function addDrawPoint(latlng) {
    drawPoints.push([latlng.lat, latlng.lng]);
    drawMarkers.push(window.L.circleMarker(latlng, { radius: 5, color: '#1F4F86', fillColor: '#6497CF', fillOpacity: 0.9 }).addTo(cattleMap));
    if (drawLine) cattleMap.removeLayer(drawLine);
    drawLine = window.L.polyline(drawPoints, { color: '#1F4F86', dashArray: '4 4' }).addTo(cattleMap);
  }

  function clearDrawing() {
    drawPoints = [];
    drawMarkers.forEach(m => cattleMap?.removeLayer(m));
    drawMarkers = [];
    if (drawLine) { cattleMap?.removeLayer(drawLine); drawLine = null; }
  }

  window.cancelAoiDraw = function() {
    drawing = false;
    $('drawBar').hidden = true;
    $('drawAoiBtn')?.classList.remove('active');
    $('cattleMap')?.classList.remove('is-drawing');
    clearDrawing();
  };

  async function saveAoi(payload) {
    const data = await apiJson('/api/v1/cattle/aois', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...writeHeaders() }, body: JSON.stringify(payload),
    });
    await window.loadCattleAois();
    window.selectCattleAoi(data.aoi.aoiId);
    if (data.job?.jobId) startJobPolling(data.job.jobId);
  }

  window.finishAoiDraw = async function() {
    if (drawPoints.length < 3) { cattleNotice('error', 'অন্তত ৩টি বিন্দু লাগবে।', 'At least 3 points are needed.'); return; }
    const label = $('drawFarmName')?.value?.trim();
    if (!label) { cattleNotice('error', 'খামারের নাম লিখুন।', 'Enter a farm name.'); $('drawFarmName')?.focus(); return; }
    const ring = drawPoints.map(p => [Number(p[1].toFixed(6)), Number(p[0].toFixed(6))]);
    ring.push([...ring[0]]);
    try {
      await saveAoi({ farmLabel: label, source: 'map_draw', geometry: { type: 'Polygon', coordinates: [ring] } });
      window.cancelAoiDraw();
      $('drawFarmName').value = '';
    } catch (err) {
      cattleNotice('error', `খামার রাখা যায়নি: ${failureText(err)}`, `Could not save the farm: ${failureText(err)}`);
    }
  };

  window.readGeoJsonFile = function(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target?.result || ''));
        const geom = parsed.type === 'FeatureCollection' ? parsed.features?.[0]?.geometry : parsed.type === 'Feature' ? parsed.geometry : parsed;
        $('rawGeoJsonInput').value = JSON.stringify(geom, null, 2);
        if (!$('customFarmLabel').value) $('customFarmLabel').value = file.name.replace(/\.[^/.]+$/, '');
      } catch {
        cattleNotice('error', 'GeoJSON ফাইলটি ঠিক নয়।', 'The GeoJSON file is not valid.');
      }
    };
    reader.readAsText(file);
  };

  window.saveGeoJsonAoi = async function() {
    const err = $('aoiError');
    const fail = (bn, en) => { if (err) { err.hidden = false; err.textContent = tr(bn, en); } };
    if (err) err.hidden = true;
    const label = $('customFarmLabel')?.value?.trim();
    const raw = $('rawGeoJsonInput')?.value?.trim();
    if (!label) return fail('খামারের নাম লিখুন।', 'Enter a farm name.');
    if (!raw) return fail('GeoJSON দিন।', 'Paste or upload the GeoJSON.');
    let geometry;
    try { geometry = JSON.parse(raw); } catch { return fail('JSON-এ ভুল আছে।', 'The JSON is not valid.'); }
    try {
      await saveAoi({ farmLabel: label, geometry, source: 'geojson_upload' });
      $('rawGeoJsonInput').value = '';
      $('customFarmLabel').value = '';
    } catch (e) {
      fail(failureText(e), failureText(e));
    }
  };

  window.deleteCattleAoi = async function() {
    if (!selectedAoi) return;
    if (!window.confirm(tr(`"${selectedAoi.farmLabel}" খামারটি মুছে ফেলবেন?`, `Delete the farm "${selectedAoi.farmLabel}"?`))) return;
    try {
      await apiJson(`/api/v1/cattle/aois/${encodeURIComponent(selectedAoi.aoiId)}`, { method: 'DELETE', headers: writeHeaders() });
      selectedAoi = null;
      if (aoiLayer) { cattleMap.removeLayer(aoiLayer); aoiLayer = null; }
      if (aoiMarker) { cattleMap.removeLayer(aoiMarker); aoiMarker = null; }
      await window.loadCattleAois();
    } catch (err) {
      cattleNotice('error', `মুছে ফেলা যায়নি: ${failureText(err)}`, `Could not delete the farm: ${failureText(err)}`);
    }
  };

  window.runCattleJob = async function() {
    if (!selectedAoi) { cattleNotice('error', 'আগে একটি খামার বেছে নিন।', 'Choose a farm first.'); return; }
    const btn = $('runPipelineBtn');
    if (btn) btn.disabled = true;
    try {
      const data = await apiJson('/api/v1/cattle/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...writeHeaders() },
        body: JSON.stringify({ aoiId: selectedAoi.aoiId, jobType: 'pipeline_refresh' }),
      });
      cattleNotice('', '', '');
      startJobPolling(data.job.jobId);
    } catch (err) {
      cattleNotice('error', `কাজ শুরু করা যায়নি: ${failureText(err)}`, `Could not start the job: ${failureText(err)}`);
      if (btn) btn.disabled = false;
    }
  };

  window.retryCattleJob = async function(jobId) {
    try {
      const data = await apiJson(`/api/v1/cattle/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST', headers: writeHeaders() });
      startJobPolling(data.job.jobId);
    } catch (err) {
      cattleNotice('error', `আবার চালানো যায়নি: ${failureText(err)}`, `Could not retry: ${failureText(err)}`);
    }
  };

  const JOB_STATUS = {
    queued: ['অপেক্ষায়', 'Queued', 'badge-info'],
    running: ['চলছে…', 'Running…', 'badge-info'],
    succeeded: ['শেষ: সব তথ্য পাওয়া গেছে', 'Done: every input obtained', 'badge-success'],
    partial: ['আংশিক: কিছু তথ্য নেই', 'Partial: some inputs missing', 'badge-warning'],
    failed: ['ব্যর্থ', 'Failed', 'badge-danger'],
    blocked: ['আটকে আছে: সেটআপ বা তথ্য লাগবে', 'Blocked: needs setup or data', 'badge-warning'],
  };

  function startJobPolling(jobId) {
    if (pollTimer) clearInterval(pollTimer);
    let failures = 0;
    const started = Date.now();
    const stop = () => { clearInterval(pollTimer); pollTimer = null; $('runPipelineBtn')?.removeAttribute('disabled'); };
    const poll = async () => {
      if (Date.now() - started > 5 * 60 * 1000) { stop(); cattleNotice('error', 'কাজের অবস্থা জানতে অনেক সময় লাগছে; পরে আবার দেখুন।', 'Stopped waiting for the job; check again later.'); return; }
      let job;
      try {
        job = (await apiJson(`/api/v1/cattle/jobs/${encodeURIComponent(jobId)}`)).job;
        failures = 0;
      } catch (err) {
        if (err.kind === 'not_found' || ++failures >= 3) { stop(); cattleNotice('error', `কাজের অবস্থা আনা যাচ্ছে না। ${failureText(err)}`, `Cannot read the job status. ${failureText(err)}`); }
        return;
      }
      const label = JOB_STATUS[job.status] || [job.status, job.status, 'badge-info'];
      const bar = $('jobProgressBar');
      if (bar) bar.style.width = `${job.progressPct}%`;
      setText('jobPercentText', `${num(job.progressPct)}%`);
      setText('jobStageText', lang() === 'en' ? job.stageMessage : job.stageMessageBangla);
      if ($('jobStageText')) $('jobStageText').dataset.ran = '1';
      const badge = $('jobStatusBadge');
      if (badge) { badge.className = `badge ${label[2]}`; badge.textContent = tr(label[0], label[1]); }
      const details = [...(job.missing || []).map(m => `${m.input}: ${m.reason}`), ...(job.errors || [])];
      setHtml('jobDetails', details.length
        ? `<ul class="weather-facts">${details.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>${(job.status === 'failed' || job.status === 'blocked') && job.attempts < job.maxAttempts ? `<button class="btn btn-sm btn-secondary" type="button" onclick="retryCattleJob('${escapeHtml(job.jobId)}')">${escapeHtml(tr('আবার চেষ্টা করুন', 'Retry'))}</button>` : ''}`
        : '');
      if (!['queued', 'running'].includes(job.status)) {
        stop();
        if (selectedAoi) {
          try {
            cattleAdvisory = (await apiJson(`/api/v1/cattle/aois/${encodeURIComponent(selectedAoi.aoiId)}/advisory`)).advisory;
            renderCattleAdvisory(cattleAdvisory);
            cattleNotice('', '', ''); // the "no advice yet" note is out of date now
          } catch (err) {
            if (err.kind !== 'no_data') cattleNotice('error', `পরামর্শ আনা যায়নি। ${failureText(err)}`, `Could not load the advice. ${failureText(err)}`);
          }
        }
      }
    };
    poll();
    pollTimer = setInterval(poll, 1500);
  }

  const THI_BADGE = { normal: ['badge-success', 'স্বাভাবিক', 'Normal'], alert: ['badge-warning', 'সতর্কতা', 'Alert'], danger: ['badge-danger', 'বিপজ্জনক', 'Danger'], emergency: ['badge-danger', 'জরুরি', 'Emergency'] };

  function renderCattleAdvisory(adv) {
    const content = $('cattleAdvisoryContent');
    if (!adv) {
      ['cThiVal', 'cWaterVal', 'cNdviVal', 'cGrazingVal', 'coolHoursList'].forEach(id => setText(id, '—'));
      ['cThiBadge', 'cWaterBadge', 'cGrazingBadge'].forEach(id => { const el = $(id); if (el) { el.className = 'badge'; el.textContent = '—'; } });
      ['cThiSummary'].forEach(id => setText(id, ''));
      ['cHourlyStrip', 'cattleAdvisoryBullets', 'cattleEvidenceNote'].forEach(id => setHtml(id, ''));
      if (content) content.dataset.empty = 'true';
      return;
    }
    if (content) content.dataset.empty = 'false';
    const thi = adv.derived.thi;
    const heur = adv.heuristic;
    setText('cThiVal', num(thi.current));
    setText('cThiSummary', lang() === 'en' ? heur.summaryEnglish : heur.summaryBangla);
    const tb = $('cThiBadge');
    if (tb) { const [cls, bn, en] = THI_BADGE[thi.category] || THI_BADGE.normal; tb.className = `badge ${cls}`; tb.textContent = tr(bn, en); }
    setText('cWaterVal', lang() === 'en' ? heur.waterDemand.labelEnglish : heur.waterDemand.labelBangla);
    const wb = $('cWaterBadge');
    if (wb) { wb.className = `badge ${heur.waterDemand.category === 'normal' ? 'badge-success' : heur.waterDemand.category === 'elevated' ? 'badge-warning' : 'badge-danger'}`; wb.textContent = tr('অনুমান', 'Heuristic'); }
    setText('cNdviVal', adv.forageStatus.ndviProxy !== null ? num(adv.forageStatus.ndviProxy.toFixed(2)) : tr('পাওয়া যায়নি', 'Unavailable'));
    const g = heur.grazing;
    setText('cGrazingVal', lang() === 'en' ? g.rationaleEnglish : g.rationaleBangla);
    const gb = $('cGrazingBadge');
    if (gb) { gb.className = `badge ${g.suitableNow ? 'badge-success' : 'badge-danger'}`; gb.textContent = g.suitableNow ? tr('তুলনামূলক কম ঝুঁকি', 'Lower risk') : tr('ঝুঁকি হতে পারে', 'May be risky'); }
    setText('coolHoursList', thi.lowestThiHours?.length ? thi.lowestThiHours.map(h => num(h)).join(', ') : tr('তথ্য নেই', 'No data'));
    setHtml('cHourlyStrip', (thi.hourly || []).map(h => {
      const time = h.time.slice(11, 16);
      const cool = (thi.lowestThiHours || []).includes(time);
      return `<div class="hourly-thi-pill thi-${h.category}${cool ? ' is-cool' : ''}"><span>${num(time)}</span><strong>${num(h.thi)}</strong><small>${num(h.temperatureC)}°C · ${num(h.relativeHumidityPct)}%</small></div>`;
    }).join('') + (thi.hoursMissingInputs ? `<small>${escapeHtml(tr(`${num(thi.hoursMissingInputs)} ঘণ্টার তথ্য অসম্পূর্ণ।`, `${thi.hoursMissingInputs} hour(s) incomplete.`))}</small>` : ''));
    setHtml('cattleAdvisoryBullets', (lang() === 'en' ? heur.bulletsEnglish : heur.bulletsBangla).map(b => `<li>${escapeHtml(b)}</li>`).join(''));
    const m = adv.measured;
    const nasa = 'status' in m.nasaPower
      ? tr(`নাসা POWER: পাওয়া যায়নি (${m.nasaPower.reason})`, `NASA POWER: unavailable (${m.nasaPower.reason})`)
      : tr(`নাসা POWER (দেরিতে আসা): সর্বশেষ ${isoDate(m.nasaPower.latestObservationDate)}`, `NASA POWER (delayed): latest ${isoDate(m.nasaPower.latestObservationDate)}`);
    const sat = m.satellite.status === 'unavailable'
      ? tr(`উপগ্রহ (আর্থ ইঞ্জিন): পাওয়া যায়নি, ${m.satellite.reason || ''}`, `Satellite (Earth Engine): unavailable, ${m.satellite.reason || ''}`)
      : tr(`উপগ্রহ (আর্থ ইঞ্জিন): ${num(m.satellite.features.length)}টি ডেটাসেট`, `Satellite (Earth Engine): ${m.satellite.features.length} dataset(s)`);
    setHtml('cattleEvidenceNote', `<ul class="weather-facts">
      <li><strong>${escapeHtml(tr('মাপা বা পাওয়া তথ্য', 'Measured or provider data'))}:</strong> ${escapeHtml(tr('আবহাওয়া মডেলের অনুমান (Open-Meteo)', 'weather-model estimate (Open-Meteo)'))}; ${escapeHtml(nasa)}; ${escapeHtml(sat)}</li>
      <li><strong>${escapeHtml(tr('হিসাব করা', 'Derived'))}:</strong> THI, ${escapeHtml(thi.formula)}. ${escapeHtml(thi.thresholdNote || '')}</li>
      <li><strong>${escapeHtml(tr('সাধারণ নির্দেশনা (অনুমানভিত্তিক)', 'Generic guidance (heuristic)'))}:</strong> ${escapeHtml(heur.basis || '')}</li>
    </ul>`);
  }

  window.checkCattleTraining = async function() {
    try {
      const data = await apiJson('/api/v1/cattle/models/train', { method: 'POST', headers: { 'Content-Type': 'application/json', ...writeHeaders() }, body: JSON.stringify({ target: 'heat_stress_panting' }) });
      cattleNotice(data.success ? 'info' : 'warning', `মডেল প্রশিক্ষণ: ${data.status} (নমুনা ${num(data.sampleCount)})। ${data.success ? '' : 'কোনো মডেল তৈরি হয়নি।'}`,
        `Model training: ${data.status} (samples: ${data.sampleCount}). ${data.success ? '' : 'No model was produced.'} ${data.message || ''}`);
    } catch (err) {
      cattleNotice('error', `প্রশিক্ষণ যাচাই করা যায়নি: ${failureText(err)}`, `Training check failed: ${failureText(err)}`);
    }
  };

  // ------------------------------------------------------------------------------------------------------------------

  function idleTexts() {
    if ($('jobStatusBadge') && !pollTimer) { $('jobStatusBadge').className = 'badge'; setText('jobStatusBadge', tr('প্রস্তুত', 'Ready')); }
    if ($('jobStageText') && !pollTimer && !$('jobStageText').dataset.ran) setText('jobStageText', tr('কোনো কাজ চলছে না', 'No job running'));
    if ($('cattleEeBadge') && !$('cattleEeBadge').textContent) setText('cattleEeBadge', tr('আর্থ ইঞ্জিন দেখা হচ্ছে…', 'Checking Earth Engine…'));
  }

  applyRole(null); // the picker first: nothing role-bound shows until a role is chosen
  initWeatherLocations();
  idleTexts();
  document.querySelectorAll('.portal-tab').forEach(b => b.addEventListener('click', () => showFarmerTab(b.dataset.ftab)));

  return {
    restoreSession,
    role: () => role,
    /** Re-render what the language or a new plan changes. */
    refresh() {
      numberTabs();
      idleTexts();
      renderRoleChip();
      renderWeatherSelectors();
      if (weatherForecast && selectedWeather) renderWeatherForecast(weatherForecast, selectedWeather);
      if (weatherNasa) renderNasaBox(weatherNasa, null);
      if (cattleAdvisory) renderCattleAdvisory(cattleAdvisory);
      todayRain.key = null;
      if (farmerTab === 'today') renderToday();
      renderFarm();
    },
  };
}
