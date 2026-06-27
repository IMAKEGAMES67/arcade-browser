const pages = document.querySelectorAll('.page');
const navButtons = document.querySelectorAll('.bottom-nav button');

function openPage(name){
  pages.forEach(page => page.classList.remove('active'));
  navButtons.forEach(button => button.classList.toggle('active', button.dataset.page === name));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  if (name === 'profile') {
    renderFavorites();
    renderAchievements();
  }
  if (name === 'business') {
    loadBillingConfig();
    loadMembership();
    loadMyCampaigns();
  }
  window.scrollTo(0, 0);
}
navButtons.forEach(button => button.addEventListener('click', () => openPage(button.dataset.page)));
document.querySelectorAll('[data-page-open]').forEach(button => {
  button.addEventListener('click', () => openPage(button.dataset.pageOpen));
});

const storage = {
  get(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  },
  set(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
};

let favoriteSites = storage.get('abu-site-favorites', []);
let recentSites = storage.get('abu-recent-sites', []);
let tabs = storage.get('abu-tabs', [{id: crypto.randomUUID(), title:'New tab', url:''}]);
let activeTabId = localStorage.getItem('abu-active-tab') || tabs[0].id;
let metrics = storage.get('abu-metrics', {
  gamesPlayed:0, siteVisits:0, bestScore:0, uniqueGames:[], activeDays:[], dailyWins:0
});
let lastGameId = localStorage.getItem('abu-last-game') || '';
let currentURL = '';
let viewerTimer = null;
let currentProfile = null;
let sbClient = null;
let billingConfig = null;
let isMember = false;
let activeAds = [];
let detectedAppMode = 'website';

const address = document.getElementById('address');
const engine = document.getElementById('engine');
const viewer = document.getElementById('viewer');
const viewerWrap = document.getElementById('viewerWrap');
const viewerStatus = document.getElementById('viewerStatus');
const viewerError = document.getElementById('viewerError');

function normalize(text){
  const raw = text.trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return 'https://' + raw;
  return engine.value + encodeURIComponent(raw);
}
function hostname(url){
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}
function saveBrowserData(){
  storage.set('abu-site-favorites', favoriteSites);
  storage.set('abu-recent-sites', recentSites);
  storage.set('abu-tabs', tabs);
  localStorage.setItem('abu-active-tab', activeTabId);
}
function activeTab(){
  return tabs.find(tab => tab.id === activeTabId) || tabs[0];
}
function updateTab(url){
  const tab = activeTab();
  if (!tab) return;
  tab.url = url;
  tab.title = url ? hostname(url) : 'New tab';
  saveBrowserData();
  renderTabs();
}
function recordSite(url){
  const item = {url, title: hostname(url), visitedAt: Date.now()};
  recentSites = [item, ...recentSites.filter(site => site.url !== url)].slice(0, 12);
  metrics.siteVisits = Number(metrics.siteVisits || 0) + 1;
  saveMetrics();
  saveBrowserData();
  renderSiteLists();
}
function openExternal(url = normalize(address.value)){
  if (!url) return;
  currentURL = url;
  address.value = url;
  updateTab(url);
  recordSite(url);
  window.open(url, '_blank', 'noopener,noreferrer');
}
async function tryInside(url = normalize(address.value)){
  if (!url) return;
  currentURL = url;
  address.value = url;
  updateTab(url);
  recordSite(url);

  if (window.arcadeDesktop?.openInApp) {
    await window.arcadeDesktop.openInApp(url);
    viewerStatus.textContent = 'Opened in an Arcade Browser window';
    viewerWrap.classList.add('hidden');
    return;
  }

  viewerWrap.classList.remove('hidden');
  viewerError.classList.add('hidden');
  viewerStatus.textContent = 'Trying to load…';
  viewer.src = url;
  clearTimeout(viewerTimer);
  viewerTimer = setTimeout(() => {
    viewerStatus.textContent = 'This website may block embedded viewing';
    viewerError.classList.remove('hidden');
  }, 4500);
}
function clearViewer(){
  clearTimeout(viewerTimer);
  viewer.src = 'about:blank';
  currentURL = '';
  viewerWrap.classList.add('hidden');
  viewerError.classList.add('hidden');
}
function createTab(){
  const tab = {id: crypto.randomUUID(), title:'New tab', url:''};
  tabs.push(tab);
  activeTabId = tab.id;
  saveBrowserData();
  renderTabs();
  address.value = '';
  clearViewer();
}
function closeTab(id){
  if (tabs.length === 1) {
    tabs[0] = {id: tabs[0].id, title:'New tab', url:''};
    activeTabId = tabs[0].id;
  } else {
    const index = tabs.findIndex(tab => tab.id === id);
    tabs = tabs.filter(tab => tab.id !== id);
    if (activeTabId === id) activeTabId = tabs[Math.max(0, index - 1)].id;
  }
  saveBrowserData();
  switchTab(activeTabId);
}
function switchTab(id){
  activeTabId = id;
  const tab = activeTab();
  address.value = tab?.url || '';
  currentURL = tab?.url || '';
  saveBrowserData();
  renderTabs();
  if (currentURL) tryInside(currentURL);
  else clearViewer();
}
function renderTabs(){
  const strip = document.getElementById('tabStrip');
  strip.innerHTML = tabs.map(tab => `
    <div class="browser-tab ${tab.id === activeTabId ? 'active' : ''}">
      <button class="tab-main" data-tab="${tab.id}">${escapeHtml(tab.title)}</button>
      <button class="tab-close" data-close-tab="${tab.id}">×</button>
    </div>
  `).join('');
  strip.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => switchTab(button.dataset.tab));
  strip.querySelectorAll('[data-close-tab]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    closeTab(button.dataset.closeTab);
  });
}
function toggleFavoriteSite(){
  const url = currentURL || normalize(address.value);
  if (!url) return;
  const exists = favoriteSites.some(site => site.url === url);
  favoriteSites = exists
    ? favoriteSites.filter(site => site.url !== url)
    : [{url, title: hostname(url)}, ...favoriteSites].slice(0, 12);
  saveBrowserData();
  renderSiteLists();
  updateFavoriteSiteButton();
}
function updateFavoriteSiteButton(){
  const url = currentURL || normalize(address.value);
  const saved = favoriteSites.some(site => site.url === url);
  document.getElementById('favoriteSite').textContent = saved ? '★ Favorited' : '☆ Favorite';
}
function siteItem(site, favorite = false){
  return `<button class="site-item" data-open-site="${encodeURIComponent(site.url)}">
    <span>${favorite ? '⭐' : '🌐'}</span>
    <div><strong>${escapeHtml(site.title || hostname(site.url))}</strong><small>${escapeHtml(site.url)}</small></div>
  </button>`;
}
function renderSiteLists(){
  const favHTML = favoriteSites.length
    ? favoriteSites.map(site => siteItem(site, true)).join('')
    : '<div class="empty-state">No favorite websites yet.</div>';
  const recentHTML = recentSites.length
    ? recentSites.map(site => siteItem(site)).join('')
    : '<div class="empty-state">No recent websites yet.</div>';

  document.getElementById('favoriteSitesHome').innerHTML = favHTML;
  document.getElementById('favoriteSitesBrowser').innerHTML = favHTML;
  document.getElementById('recentSitesHome').innerHTML = recentHTML;

  document.querySelectorAll('[data-open-site]').forEach(button => {
    button.onclick = () => {
      const url = decodeURIComponent(button.dataset.openSite);
      openPage('browser');
      address.value = url;
      tryInside(url);
    };
  });
}
function escapeHtml(value=''){
  return String(value).replace(/[&<>"']/g, character => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  })[character]);
}

document.getElementById('tryInside').onclick = () => tryInside();
document.getElementById('openBrowser').onclick = () => openExternal();
document.getElementById('viewerExternal').onclick = () => openExternal(currentURL);
document.getElementById('clearViewer').onclick = clearViewer;
document.getElementById('favoriteSite').onclick = toggleFavoriteSite;
document.getElementById('newTab').onclick = createTab;
document.getElementById('retryViewer').onclick = () => tryInside(currentURL);
document.getElementById('errorExternal').onclick = () => openExternal(currentURL);
document.getElementById('errorBack').onclick = clearViewer;
document.getElementById('clearRecent').onclick = () => {
  recentSites = [];
  saveBrowserData();
  renderSiteLists();
};
address.addEventListener('keydown', event => {
  if (event.key === 'Enter') tryInside();
});
address.addEventListener('input', updateFavoriteSiteButton);
viewer.addEventListener('load', () => {
  if (!currentURL) return;
  clearTimeout(viewerTimer);
  viewerStatus.textContent = 'Loaded — use Open in browser if the page is blank';
});
document.querySelectorAll('[data-url]').forEach(button => {
  button.onclick = () => {
    address.value = button.dataset.url;
    tryInside(button.dataset.url);
  };
});

function saveMetrics(){
  const day = new Date().toISOString().slice(0,10);
  metrics.activeDays = Array.from(new Set([...(metrics.activeDays || []), day])).slice(-60);
  storage.set('abu-metrics', metrics);
}
function trackGameStart(game){
  metrics.gamesPlayed = Number(metrics.gamesPlayed || 0) + 1;
  metrics.uniqueGames = Array.from(new Set([...(metrics.uniqueGames || []), game.id]));
  lastGameId = game.id;
  localStorage.setItem('abu-last-game', game.id);
  saveMetrics();
  renderDashboard();
  renderAchievements();
}
function trackGameEnd(game, gameScore, gameBest){
  metrics.bestScore = Math.max(Number(metrics.bestScore || 0), Number(gameScore || 0), Number(gameBest || 0));
  const daily = getDailyGame();
  if (daily && game.id === daily.id && gameScore > 0) {
    const key = 'abu-daily-complete-' + new Date().toISOString().slice(0,10);
    if (!localStorage.getItem(key)) {
      metrics.dailyWins = Number(metrics.dailyWins || 0) + 1;
      localStorage.setItem(key, '1');
    }
  }
  saveMetrics();
  renderDashboard();
  renderAchievements();
}
const achievementDefinitions = [
  {id:'first-game', icon:'🎮', name:'First Game', test:() => metrics.gamesPlayed >= 1},
  {id:'ten-games', icon:'🕹️', name:'Arcade Regular', test:() => metrics.gamesPlayed >= 10},
  {id:'explorer', icon:'🌐', name:'Web Explorer', test:() => metrics.siteVisits >= 5},
  {id:'collector', icon:'⭐', name:'Collector', test:() => favorites.length >= 5},
  {id:'high-score', icon:'🏆', name:'Score Hunter', test:() => metrics.bestScore >= 50},
  {id:'variety', icon:'🎲', name:'Game Sampler', test:() => (metrics.uniqueGames || []).length >= 10},
  {id:'daily', icon:'📅', name:'Daily Winner', test:() => metrics.dailyWins >= 1},
  {id:'returning', icon:'🔥', name:'Returning Player', test:() => (metrics.activeDays || []).length >= 3}
];
function unlockedAchievements(){
  return achievementDefinitions.filter(item => item.test());
}
function renderAchievements(){
  const unlocked = new Set(unlockedAchievements().map(item => item.id));
  const grid = document.getElementById('achievementGrid');
  grid.innerHTML = achievementDefinitions.map(item => `
    <article class="achievement ${unlocked.has(item.id) ? 'unlocked' : ''}">
      <span>${item.icon}</span><div><strong>${item.name}</strong><small>${unlocked.has(item.id) ? 'Unlocked' : 'Locked'}</small></div>
    </article>
  `).join('');
  document.getElementById('achievementCount').textContent = unlocked.size;
  document.getElementById('achievementHint').textContent =
    unlocked.size === achievementDefinitions.length ? 'You unlocked everything!' : 'Keep playing to unlock more.';
}
function getDailyGame(){
  if (typeof games === 'undefined' || !games.length) return null;
  const date = new Date();
  const key = Number(`${date.getUTCFullYear()}${String(date.getUTCMonth()+1).padStart(2,'0')}${String(date.getUTCDate()).padStart(2,'0')}`);
  return games[key % games.length];
}
function renderDashboard(){
  if (typeof games === 'undefined') return;
  const daily = getDailyGame();
  if (daily) {
    document.getElementById('dailyName').textContent = daily.name;
    document.getElementById('dailyDesc').textContent = daily.desc;
    document.getElementById('playDaily').onclick = () => openGame(daily);
  }
  const last = games.find(game => game.id === lastGameId);
  document.getElementById('continueName').textContent = last ? last.name : 'Choose a game';
  document.getElementById('continueDesc').textContent = last ? last.desc : 'Your last game appears here.';
  document.getElementById('continuePlay').onclick = () => last ? openGame(last) : openPage('games');
  renderSiteLists();
  renderAchievements();
}
function clearAllData(){
  if (!confirm('Clear favorites, history, achievements, and scores on this device?')) return;
  Object.keys(localStorage).filter(key => key.startsWith('abu-')).forEach(key => localStorage.removeItem(key));
  location.reload();
}

const themeSelect = document.getElementById('themeSelect');
function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  themeSelect.value = theme;
  localStorage.setItem('abu-theme', theme);
}
themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
applyTheme(localStorage.getItem('abu-theme') || 'midnight');

const setupModal = document.getElementById('setupModal');
function showSetup(){
  const ua = navigator.userAgent;
  let device = 'Your device is ready for the web app.';
  if (/CrOS/i.test(ua)) device = 'Chromebook detected. You can install this as an app from Chrome.';
  else if (/iPhone|iPad|iPod/i.test(ua)) device = 'iPhone/iPad detected. Use Share → Add to Home Screen in Chrome or Safari.';
  else if (/Macintosh|Mac OS X/i.test(ua)) device = 'Mac detected. Use the web app or download the desktop edition.';
  document.getElementById('setupDeviceText').textContent = device;
  setupModal.classList.remove('hidden');
}
document.getElementById('showSetup').onclick = showSetup;
document.getElementById('closeSetup').onclick = () => setupModal.classList.add('hidden');
document.getElementById('finishSetup').onclick = () => {
  localStorage.setItem('abu-setup-complete', '1');
  setupModal.classList.add('hidden');
};
document.querySelectorAll('[data-setup-theme]').forEach(button => {
  button.onclick = () => applyTheme(button.dataset.setupTheme);
});

const installModal = document.getElementById('installModal');
let deferredInstallPrompt = null;
const isChromeOS = /CrOS/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
});
if (isChromeOS) {
  document.getElementById('chromeInstallText').classList.remove('hidden');
  document.getElementById('iosInstallText').classList.add('hidden');
}
async function promptInstall(){
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installModal.classList.add('hidden');
  }
}
document.getElementById('promptInstall').onclick = promptInstall;
function showInstall(){ installModal.classList.remove('hidden'); }
document.getElementById('installHelp').onclick = showInstall;
document.getElementById('showInstall').onclick = showInstall;
document.getElementById('closeInstall').onclick = () => installModal.classList.add('hidden');

function updateNetworkStatus(){
  const online = navigator.onLine;
  document.getElementById('networkStatus').textContent = online ? 'Online' : 'Offline';
  document.getElementById('networkStatus').classList.toggle('offline', !online);
  document.getElementById('offlineTitle').textContent = online ? 'Ready after first load' : 'Offline mode active';
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
document.getElementById('refreshOffline').onclick = () => location.reload();

function createSafeDocument(update){
  const safeScript = String(update.js || '').replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; media-src https: blob:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline'; connect-src https:; font-src https: data:; frame-src https:;">
  <style>html,body{margin:0;min-height:100%;font-family:system-ui;background:#fff;color:#111}${update.css || ''}</style>
  </head><body>${update.html || ''}<script>${safeScript}<\/script></body></html>`;
}
async function loadLatestUpdate(){
  if (!sbClient) return;
  const {data, error} = await sbClient
    .from('ab_site_updates')
    .select('id,title,html,css,js,created_at')
    .eq('published', true)
    .order('created_at', {ascending:false})
    .limit(1)
    .maybeSingle();
  if (error || !data) return;
  document.getElementById('liveUpdateTitle').textContent = data.title;
  document.getElementById('liveUpdateFrame').srcdoc = createSafeDocument(data);
  document.getElementById('liveUpdateCard').classList.remove('hidden');
}

function localSyncPayload(){
  return {
    favorites,
    favorite_sites: favoriteSites,
    recent_sites: recentSites,
    achievements: unlockedAchievements().map(item => item.id),
    metrics,
    theme: localStorage.getItem('abu-theme') || 'midnight',
    updated_at: new Date().toISOString()
  };
}
async function saveAccountData(){
  if (!sbClient || !currentProfile) return;
  const payload = {user_id: currentProfile.id, ...localSyncPayload()};
  const {error} = await sbClient.from('ab_user_data').upsert(payload);
  document.getElementById('syncMessage').textContent = error ? error.message : 'Saved to your account.';
}
async function loadAccountData(){
  if (!sbClient || !currentProfile) return;
  const {data, error} = await sbClient.from('ab_user_data').select('*').eq('user_id', currentProfile.id).maybeSingle();
  if (error) {
    document.getElementById('syncMessage').textContent = error.message;
    return;
  }
  if (!data) return;
  favorites = Array.isArray(data.favorites) ? data.favorites : favorites;
  favoriteSites = Array.isArray(data.favorite_sites) ? data.favorite_sites : favoriteSites;
  recentSites = Array.isArray(data.recent_sites) ? data.recent_sites : recentSites;
  metrics = data.metrics && typeof data.metrics === 'object' ? data.metrics : metrics;
  applyTheme(data.theme || 'midnight');
  saveFavs();
  saveBrowserData();
  saveMetrics();
  renderGames();
  renderFavorites();
  renderDashboard();
  document.getElementById('syncMessage').textContent = 'Loaded from your account.';
}
async function refreshProfile(){
  if (!sbClient) return;
  const {data:{session}} = await sbClient.auth.getSession();
  if (!session) {
    currentProfile = null;
    isMember = false;
    document.getElementById('authSignedOut').classList.remove('hidden');
    document.getElementById('authSignedIn').classList.add('hidden');
    document.getElementById('accountButton').textContent = 'Guest';
    document.getElementById('welcomeTitle').textContent = 'Welcome!';
    document.getElementById('adminLink').classList.add('hidden');
    document.getElementById('adminQuickButton').classList.add('hidden');
    renderMembership();
    return;
  }

  const requestedUsername =
    document.getElementById('authUsername')?.value.trim() ||
    session.user.user_metadata?.username ||
    null;

  // This repairs old accounts and promotes the configured owner email to adam/admin.
  const {error: ensureError} = await sbClient.rpc('ab_ensure_profile', {
    requested_username: requestedUsername
  });

  if (ensureError) {
    document.getElementById('syncMessage').textContent =
      'Profile repair failed: ' + ensureError.message;
  }

  const {data, error} = await sbClient
    .from('ab_profiles')
    .select('id,username,role')
    .eq('id', session.user.id)
    .single();

  if (error) {
    document.getElementById('authMessage').textContent =
      'Profile not found. Run SUPABASE_UPGRADE_ADMIN_STRIPE.sql, then log in again.';
    return;
  }

  currentProfile = data;
  document.getElementById('authSignedOut').classList.add('hidden');
  document.getElementById('authSignedIn').classList.remove('hidden');
  document.getElementById('profileName').textContent = data.username;
  document.getElementById('profileRole').textContent =
    data.role === 'admin' ? 'Administrator' : 'User';
  document.getElementById('profileAvatar').textContent =
    data.username.slice(0,1).toUpperCase();
  document.getElementById('accountButton').textContent = data.username;
  document.getElementById('welcomeTitle').textContent =
    `Welcome, ${data.username}!`;

  const admin = data.role === 'admin';
  document.getElementById('adminLink').classList.toggle('hidden', !admin);
  document.getElementById('adminQuickButton').classList.toggle('hidden', !admin);

  await loadMembership();
  await loadMyCampaigns();
}
async function signUp(){
  const username = document.getElementById('authUsername').value.trim();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const message = document.getElementById('authMessage');
  if (!username || !email || password.length < 6) {
    message.textContent = 'Enter a username, email, and a password with at least 6 characters.';
    return;
  }
  const {data, error} = await sbClient.auth.signUp({
    email, password, options:{data:{username}}
  });
  message.textContent = error
    ? error.message
    : (data.session ? 'Account created and logged in.' : 'Account created. Check your email to confirm it, then log in.');
  await refreshProfile();
}
async function login(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const {error} = await sbClient.auth.signInWithPassword({email, password});
  document.getElementById('authMessage').textContent = error ? error.message : 'Logged in.';
  await refreshProfile();
}
async function logout(){
  await sbClient.auth.signOut();
  await refreshProfile();
}
document.getElementById('signUpButton').onclick = signUp;
document.getElementById('loginButton').onclick = login;
document.getElementById('logoutButton').onclick = logout;
document.getElementById('syncUp').onclick = saveAccountData;
document.getElementById('syncDown').onclick = loadAccountData;
document.getElementById('accountButton').onclick = () => openPage('profile');

function detectAppMode(){
  const params = new URLSearchParams(location.search);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const desktop =
    window.arcadeDesktop?.isDesktop === true ||
    params.get('source') === 'desktop' ||
    /ArcadeBrowserDesktop/i.test(navigator.userAgent);

  detectedAppMode = desktop ? 'desktop' : standalone ? 'installed' : 'website';
  const label = desktop
    ? 'Desktop App'
    : standalone
      ? 'Installed App'
      : 'Website';

  document.getElementById('appModeBadge').textContent = label;
  document.getElementById('businessAppBadge').textContent = label;
  document.body.dataset.appMode = detectedAppMode;
}

function renderMembership(){
  const status = document.getElementById('membershipStatus');
  const homeTitle = document.getElementById('membershipHomeTitle');
  const homeText = document.getElementById('membershipHomeText');
  const buy = document.getElementById('buyMembership');

  if (!currentProfile) {
    status.textContent = 'Log in to buy or check Arcade Plus.';
    status.classList.remove('active');
    buy.disabled = false;
    homeTitle.textContent = 'Remove all ads';
    homeText.textContent = 'Log in, then join Arcade Plus.';
  } else if (isMember) {
    status.textContent = 'Arcade Plus is active — advertisements are hidden.';
    status.classList.add('active');
    buy.textContent = 'Membership active';
    buy.disabled = true;
    homeTitle.textContent = 'Arcade Plus active';
    homeText.textContent = 'Advertisements are hidden on this account.';
  } else {
    status.textContent = 'No active membership on this account.';
    status.classList.remove('active');
    buy.textContent = 'Join Arcade Plus';
    buy.disabled = false;
    homeTitle.textContent = 'Remove all ads';
    homeText.textContent = 'Membership follows your account across devices.';
  }

  document.getElementById('sponsoredSection').classList.toggle(
    'hidden',
    isMember || !activeAds.length
  );
}

async function loadBillingConfig(){
  if (!sbClient) return;
  const {data, error} = await sbClient
    .from('ab_billing_config')
    .select('*')
    .eq('id', true)
    .maybeSingle();

  if (!error && data) billingConfig = data;
  renderAdPackages();
}

async function loadMembership(){
  if (!sbClient || !currentProfile) {
    isMember = false;
    renderMembership();
    return;
  }

  const {data} = await sbClient
    .from('ab_memberships')
    .select('status,current_period_end,cancel_at_period_end')
    .eq('user_id', currentProfile.id)
    .maybeSingle();

  const activeStatus = ['active', 'trialing'].includes(data?.status);
  const notExpired =
    !data?.current_period_end ||
    new Date(data.current_period_end).getTime() > Date.now();

  isMember = Boolean(activeStatus && notExpired);
  renderMembership();
  renderActiveAds();
}

function getAdPackages(){
  return Array.isArray(billingConfig?.ad_packages) ? billingConfig.ad_packages : [];
}

function renderAdPackages(){
  const select = document.getElementById('adPackage');
  const packages = getAdPackages().filter(item => item && item.id);
  select.innerHTML = packages.length
    ? packages.map(item => `
      <option value="${escapeHtml(item.id)}">
        ${escapeHtml(item.name || item.id)}
      </option>
    `).join('')
    : '<option value="">No packages configured</option>';
  updateAdOptionInfo();
}

function updateAdOptionInfo(){
  const packageId = document.getElementById('adPackage').value;
  const info = document.getElementById('adOptionInfo');
  const selected = getAdPackages().find(item => item.id === packageId);

  if (!selected) {
    info.textContent = 'The admin has not configured advertising packages yet.';
    return;
  }

  const delay = Number(selected.close_delay_seconds || 0);
  const delayText = delay > 0
    ? `Close button unlocks after ${delay} second${delay === 1 ? '' : 's'}`
    : 'Can be closed immediately';

  info.textContent =
    `${selected.name} • ${selected.duration_days} day${Number(selected.duration_days) === 1 ? '' : 's'} • ` +
    `${delayText} • Price shown in Stripe Checkout`;
}

async function createCheckout(payload){
  if (!sbClient || !currentProfile) {
    openPage('profile');
    throw new Error('Log in before checkout.');
  }

  const {data:{session}} = await sbClient.auth.getSession();
  if (!session) throw new Error('Your login expired. Log in again.');

  const functionBase =
    (window.arcadeDesktop?.isDesktop || location.hostname === '127.0.0.1' || location.hostname === 'localhost')
      ? 'https://arcade-browser.netlify.app'
      : '';

  const response = await fetch(functionBase + '/.netlify/functions/create-checkout-session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Checkout failed');
  location.href = result.url;
}

async function buyMembership(){
  const message = document.getElementById('businessMessage');
  try {
    message.textContent = 'Opening Stripe Checkout…';
    await createCheckout({kind:'membership'});
  } catch (error) {
    message.textContent = error.message;
  }
}

async function buyAdvertising(){
  const message = document.getElementById('businessMessage');
  try {
    const payload = {
      kind: 'ad',
      package_id: document.getElementById('adPackage').value,
      title: document.getElementById('adTitle').value.trim(),
      description: document.getElementById('adDescription').value.trim(),
      destination_url: document.getElementById('adDestination').value.trim(),
      image_url: document.getElementById('adImage').value.trim()
    };
    message.textContent = 'Opening Stripe Checkout…';
    await createCheckout(payload);
  } catch (error) {
    message.textContent = error.message;
  }
}

function campaignStatusLabel(status){
  return ({
    checkout_pending:'Checkout not finished',
    paid_pending_review:'Paid — awaiting Adam’s approval',
    approved:'Approved and live',
    rejected:'Rejected',
    expired:'Expired',
    canceled:'Canceled'
  })[status] || status;
}

async function loadMyCampaigns(){
  const list = document.getElementById('myCampaigns');
  if (!sbClient || !currentProfile) {
    list.innerHTML = '<div class="empty-state">Log in to view campaigns.</div>';
    return;
  }

  const {data, error} = await sbClient
    .from('ab_ad_campaigns')
    .select('id,title,placement,status,created_at,starts_at,ends_at,rejection_reason')
    .eq('user_id', currentProfile.id)
    .order('created_at', {ascending:false});

  if (error) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    return;
  }

  list.innerHTML = data?.length
    ? data.map(item => `
      <article class="campaign-row">
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.placement)} • ${new Date(item.created_at).toLocaleDateString()}</small>
          ${item.rejection_reason ? `<small>${escapeHtml(item.rejection_reason)}</small>` : ''}
        </div>
        <span class="campaign-status">${escapeHtml(campaignStatusLabel(item.status))}</span>
      </article>
    `).join('')
    : '<div class="empty-state">No advertising campaigns yet.</div>';
}

async function loadActiveAds(){
  if (!sbClient) return;
  const now = new Date().toISOString();
  const {data, error} = await sbClient
    .from('ab_ad_campaigns')
    .select('id,package_id,placement,title,description,destination_url,image_url,close_delay_seconds,duration_days,ends_at')
    .eq('status', 'approved')
    .lte('starts_at', now)
    .gte('ends_at', now)
    .order('created_at', {ascending:false})
    .limit(12);

  activeAds = error ? [] : (data || []);
  renderActiveAds();
  setTimeout(showSponsoredInterstitial, 1800);
}

let sponsorTimer = null;

function showSponsoredInterstitial(){
  if (isMember || !activeAds.length) return;

  const available = activeAds.filter(ad => {
    const hiddenUntil = Number(localStorage.getItem('abu-ad-hidden-' + ad.id) || 0);
    return hiddenUntil < Date.now();
  });
  if (!available.length) return;

  const ad = [...available].sort(
    (a,b) => Number(b.close_delay_seconds || 0) - Number(a.close_delay_seconds || 0)
  )[0];

  const modal = document.getElementById('sponsorModal');
  const close = document.getElementById('closeSponsor');
  const countdown = document.getElementById('sponsorCountdown');
  const image = document.getElementById('sponsorImage');

  document.getElementById('sponsorTitle').textContent = ad.title;
  document.getElementById('sponsorDescription').textContent = ad.description || '';
  document.getElementById('sponsorVisit').href = ad.destination_url;

  if (ad.image_url) {
    image.src = ad.image_url;
    image.classList.remove('hidden');
  } else {
    image.removeAttribute('src');
    image.classList.add('hidden');
  }

  let remaining = Math.max(0, Number(ad.close_delay_seconds || 0));
  close.disabled = remaining > 0;
  countdown.textContent = remaining > 0
    ? `Close unlocks in ${remaining} second${remaining === 1 ? '' : 's'}`
    : 'You can close this advertisement now.';

  clearInterval(sponsorTimer);
  if (remaining > 0) {
    sponsorTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(sponsorTimer);
        close.disabled = false;
        countdown.textContent = 'You can close this advertisement now.';
      } else {
        countdown.textContent =
          `Close unlocks in ${remaining} second${remaining === 1 ? '' : 's'}`;
      }
    }, 1000);
  }

  close.onclick = () => {
    if (close.disabled) return;
    clearInterval(sponsorTimer);
    localStorage.setItem('abu-ad-hidden-' + ad.id, String(Date.now() + 24 * 60 * 60 * 1000));
    modal.classList.add('hidden');
  };

  modal.classList.remove('hidden');
}

function renderActiveAds(){
  const section = document.getElementById('sponsoredSection');
  const grid = document.getElementById('activeAds');

  if (isMember || !activeAds.length) {
    section.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = activeAds.map(ad => `
    <a class="sponsored-ad placement-${escapeHtml(ad.placement)}"
       href="${escapeHtml(ad.destination_url)}"
       target="_blank"
       rel="noopener noreferrer sponsored">
      ${ad.image_url ? `<img src="${escapeHtml(ad.image_url)}" alt="">` : ''}
      <div class="sponsored-ad-body">
        <span class="sponsored-label">SPONSORED • ${escapeHtml(ad.placement.toUpperCase())}</span>
        <h3>${escapeHtml(ad.title)}</h3>
        <p>${escapeHtml(ad.description)}</p>
      </div>
    </a>
  `).join('');
  section.classList.remove('hidden');
}

function showCheckoutResult(){
  const params = new URLSearchParams(location.search);
  const checkout = params.get('checkout');
  if (!checkout) return;

  const notice = document.createElement('div');
  notice.className = 'checkout-notice';
  notice.textContent = checkout === 'success'
    ? (params.get('type') === 'ad'
      ? 'Payment received. Your ad is waiting for Adam’s approval.'
      : 'Membership checkout completed. Stripe may take a moment to update your account.')
    : 'Checkout was canceled. You were not charged by this checkout attempt.';

  const page = document.getElementById('page-business');
  page.insertBefore(notice, page.children[1] || null);
  openPage('business');

  history.replaceState({}, '', location.pathname + location.hash);
  setTimeout(async () => {
    await loadMembership();
    await loadMyCampaigns();
  }, 1800);
}

document.getElementById('adPackage').addEventListener('change', updateAdOptionInfo);
document.getElementById('buyMembership').addEventListener('click', buyMembership);
document.getElementById('buyAd').addEventListener('click', buyAdvertising);
document.getElementById('refreshCampaigns').addEventListener('click', loadMyCampaigns);

async function initializeSupabase(){
  if (!window.supabase || !window.ARCADE_SUPABASE_URL || !window.ARCADE_SUPABASE_ANON_KEY) return;
  sbClient = window.supabase.createClient(window.ARCADE_SUPABASE_URL, window.ARCADE_SUPABASE_ANON_KEY);
  sbClient.auth.onAuthStateChange(() => setTimeout(refreshProfile, 0));
  await refreshProfile();
  await loadBillingConfig();
  await loadActiveAds();
  await loadLatestUpdate();
}

function initializeEnhancedApp(){
  detectAppMode();
  renderTabs();
  renderSiteLists();
  renderDashboard();
  renderAchievements();
  updateNetworkStatus();
  initializeSupabase();
  showCheckoutResult();
  if (!localStorage.getItem('abu-setup-complete')) showSetup();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

const games = [
  {id:'orbit-courier',type:'orbit',category:'Skill',name:'Orbit Courier',icon:'🛰️',accent:'#38bdf8',desc:'Reverse orbit to collect signals and avoid mines.',controls:'Tap to reverse direction',difficulty:3,duration:40},
  {id:'tower-foundry',type:'stack',category:'Timing',name:'Tower Foundry',icon:'🏗️',accent:'#f59e0b',desc:'Drop moving floors and build the tallest tower.',controls:'Tap to drop each floor',difficulty:3,duration:45},
  {id:'constellation-trace',type:'connect',category:'Puzzle',name:'Constellation Trace',icon:'✨',accent:'#a78bfa',desc:'Memorize and tap stars in the correct order.',controls:'Tap the stars in sequence',difficulty:3,duration:40},
  {id:'canyon-glider',type:'glide',category:'Action',name:'Canyon Glider',icon:'🪂',accent:'#34d399',desc:'Guide a glider through shifting canyon gaps.',controls:'Drag up and down',difficulty:4,duration:45},
  {id:'rooftop-relay',type:'runner',category:'Action',name:'Rooftop Relay',icon:'🏃',accent:'#fb7185',desc:'Jump vents and rooftop barriers.',controls:'Tap to jump',difficulty:3,duration:35},
  {id:'vault-breaker',type:'bounce',category:'Classic',name:'Vault Breaker',icon:'🔐',accent:'#60a5fa',desc:'Break security panels without losing the pulse.',controls:'Drag the paddle',difficulty:3,duration:45},
  {id:'echo-tiles',type:'memory',category:'Puzzle',name:'Echo Tiles',icon:'🎵',accent:'#c084fc',desc:'Repeat a growing pattern of musical tiles.',controls:'Tap the remembered pattern',difficulty:3,duration:45},
  {id:'orchard-trail',type:'snake',category:'Classic',name:'Orchard Trail',icon:'🍎',accent:'#4ade80',desc:'Collect fruit while the trail grows longer.',controls:'Swipe to turn',difficulty:3,duration:45},
  {id:'harbor-traffic',type:'lane',category:'Action',name:'Harbor Traffic',icon:'🚤',accent:'#22d3ee',desc:'Switch water lanes between incoming boats.',controls:'Tap left or right',difficulty:4,duration:35},
  {id:'signal-snap',type:'reaction',category:'Reflex',name:'Signal Snap',icon:'🚦',accent:'#f97316',desc:'Wait for the exact signal, then react fast.',controls:'Tap only when the light changes',difficulty:2,duration:5},
  {id:'market-catch',type:'catch',category:'Skill',name:'Market Catch',icon:'🧺',accent:'#fbbf24',desc:'Catch fresh fruit and avoid falling crates.',controls:'Drag the basket',difficulty:3,duration:35},
  {id:'comet-courier',type:'dodge',category:'Reflex',name:'Comet Courier',icon:'☄️',accent:'#818cf8',desc:'Deliver cargo through a moving comet storm.',controls:'Drag the ship left and right',difficulty:4,duration:35}
];

let favorites=JSON.parse(localStorage.getItem('abu-favs')||'[]');
let activeCategory='All';
const grid=document.getElementById('gameGrid'),favGrid=document.getElementById('favoriteGrid');

function saveFavs(){localStorage.setItem('abu-favs',JSON.stringify(favorites))}
function toggleFav(id){
  favorites=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];
  saveFavs();renderGames();renderFavorites();renderDashboard();
}
function card(g){
  return `<article class="card">
    <div class="art" style="background:linear-gradient(145deg,${g.accent}33,${g.accent}12)">${g.icon}</div>
    <span class="game-category">${g.category}</span>
    <h3>${g.name}</h3><p>${g.desc}</p>
    <button class="star" data-star="${g.id}">${favorites.includes(g.id)?'★':'☆'}</button>
    <button class="play" data-play="${g.id}">Play</button>
  </article>`;
}
function wire(root){
  root.querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>openGame(games.find(g=>g.id===b.dataset.play)));
  root.querySelectorAll('[data-star]').forEach(b=>b.onclick=()=>toggleFav(b.dataset.star));
}
function renderCategories(){
  const categories=['All',...new Set(games.map(game=>game.category))];
  const c=document.getElementById('categories');
  c.innerHTML=categories.map(x=>`<button class="chip ${x===activeCategory?'active':''}" data-cat="${x}">${x}</button>`).join('');
  c.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{
    activeCategory=b.dataset.cat;renderCategories();renderGames();
  });
}
function renderGames(){
  const q=document.getElementById('gameSearch').value.toLowerCase();
  const list=games.filter(g=>
    (activeCategory==='All'||g.category===activeCategory) &&
    `${g.name} ${g.desc} ${g.category}`.toLowerCase().includes(q)
  );
  grid.innerHTML=list.length?list.map(card).join(''):'<div class="empty-state">No games found.</div>';
  wire(grid);
}
function renderFavorites(){
  const list=games.filter(g=>favorites.includes(g.id));
  favGrid.innerHTML=list.length
    ?list.map(card).join('')
    :'<article class="card"><div class="art">⭐</div><h3>No favorites</h3><p>Tap a star to save a game.</p></article>';
  wire(favGrid);
}
document.getElementById('gameSearch').oninput=renderGames;
document.getElementById('clearData').onclick=clearAllData;

const gameModal=document.getElementById('gameModal'),
canvas=document.getElementById('canvas'),
ctx=canvas.getContext('2d'),
overlay=document.getElementById('overlay');

let current=null,running=false,score=0,best=0,timeLeft=30,last=0,raf=0,state={},touchStart=null;

function openGame(g){
  trackGameStart(g);
  current=g;
  document.getElementById('gameTitle').textContent=g.name;
  document.getElementById('controls').textContent=g.controls;
  document.getElementById('favBtn').textContent=favorites.includes(g.id)?'★':'☆';
  best=Number(localStorage.getItem('abu-best-'+g.id)||0);
  document.getElementById('best').textContent=best;
  gameModal.classList.remove('hidden');
  resetGame();
}
function closeGame(){running=false;cancelAnimationFrame(raf);gameModal.classList.add('hidden')}
function resetGame(){
  running=false;cancelAnimationFrame(raf);score=0;
  timeLeft=current?.duration||35;state={};
  document.getElementById('score').textContent='0';
  document.getElementById('time').textContent=timeLeft.toFixed(1);
  overlay.classList.remove('hidden');
  overlay.innerHTML='<div><h2>Ready?</h2><p>Tap to start</p></div>';
  drawBackground();
}
function target(){const r=30+Math.random()*18;return{x:80+Math.random()*800,y:70+Math.random()*370,r}}
function bricks(){const a=[];for(let r=0;r<5;r++)for(let c=0;c<10;c++)a.push({x:40+c*88,y:50+r*34,w:78,h:24,on:true});return a}
function randomNodes(count){
  const nodes=[];
  while(nodes.length<count){
    const node={x:100+Math.random()*760,y:90+Math.random()*340,r:28};
    if(nodes.every(other=>Math.hypot(node.x-other.x,node.y-other.y)>85))nodes.push(node);
  }
  return nodes;
}
function newGlideWall(x){
  const gap=180-Math.min(60,score*2);
  const center=140+Math.random()*260;
  return{x,w:80,gapTop:center-gap/2,gapBottom:center+gap/2,passed:false};
}
function setup(){
  const d=current.difficulty;
  if(['dodge','catch'].includes(current.type))state={player:{x:420,y:475,w:110,h:25},falls:[],spawn:0};
  if(current.type==='reaction')state={phase:'wait',elapsed:0,wait:1.2+Math.random()*2.5,start:0};
  if(current.type==='runner')state={player:{x:120,y:430,w:46,h:62,vy:0},obs:[],spawn:0};
  if(current.type==='bounce')state={paddle:{x:390,y:500,w:180,h:18},ball:{x:480,y:420,vx:300,vy:-310,r:10},bricks:bricks()};
  if(current.type==='memory')state={pads:[{x:250,y:150,c:'#ef4444'},{x:500,y:150,c:'#3b82f6'},{x:250,y:310,c:'#22c55e'},{x:500,y:310,c:'#eab308'}],seq:[Math.floor(Math.random()*4)],input:0,show:0,timer:0,locked:true};
  if(current.type==='snake')state={snake:[{x:12,y:8},{x:11,y:8},{x:10,y:8}],dir:{x:1,y:0},next:{x:1,y:0},food:{x:22,y:12},step:0};
  if(current.type==='lane')state={lane:1,obs:[],spawn:0};
  if(current.type==='orbit')state={angle:0,dir:1,speed:1.8,star:Math.random()*Math.PI*2,mines:[Math.PI],addMine:5};
  if(current.type==='stack')state={floors:[{x:280,y:500,w:400,h:24}],moving:{x:0,y:476,w:400,h:24,vx:280},level:0};
  if(current.type==='connect')state={nodes:randomNodes(4),next:0,preview:1.5,round:1};
  if(current.type==='glide')state={player:{x:170,y:270,r:20},walls:[newGlideWall(780),newGlideWall(1180)],speed:230};
}
function startGame(){if(running)return;running=true;overlay.classList.add('hidden');setup();last=performance.now();raf=requestAnimationFrame(loop)}
function endGame(msg){
  running=false;cancelAnimationFrame(raf);
  if(score>best){best=score;localStorage.setItem('abu-best-'+current.id,best)}
  document.getElementById('best').textContent=best;
  trackGameEnd(current,score,best);
  overlay.classList.remove('hidden');
  overlay.innerHTML=`<div><h2>${msg}</h2><p>Score: ${score}</p></div>`;
}
function hit(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y}
function angularDistance(a,b){
  const diff=Math.abs(((a-b+Math.PI)%(Math.PI*2))-Math.PI);
  return diff;
}
function update(dt){
  const d=current.difficulty;
  if(current.type!=='reaction'){
    timeLeft-=dt;
    if(timeLeft<=0){timeLeft=0;endGame('Time!');return}
  }

  if(['dodge','catch'].includes(current.type)){
    state.spawn-=dt;
    if(state.spawn<=0){
      state.spawn=current.type==='dodge'?.42:.55;
      state.falls.push({
        x:25+Math.random()*900,y:-30,r:14+Math.random()*15,
        vy:220+d*30+Math.random()*100,
        bomb:current.type==='catch'&&Math.random()<.25
      });
    }
    state.falls.forEach(o=>o.y+=o.vy*dt);
    for(const o of state.falls){
      if(o.y+o.r>state.player.y&&o.y-o.r<state.player.y+state.player.h&&o.x>state.player.x&&o.x<state.player.x+state.player.w){
        if(current.type==='dodge'){endGame('Cargo damaged!');return}
        score+=o.bomb?-6:4;o.dead=true;
      }else if(o.y>560){if(current.type==='dodge')score++;o.dead=true}
    }
    state.falls=state.falls.filter(o=>!o.dead);
  }

  if(current.type==='reaction'){
    state.elapsed+=dt;timeLeft=Math.max(0,5-state.elapsed);
    if(state.phase==='wait'&&state.elapsed>=state.wait){state.phase='go';state.start=performance.now()}
    if(state.elapsed>5)endGame('Signal missed!');
  }

  if(current.type==='runner'){
    state.player.vy+=1100*dt;state.player.y+=state.player.vy*dt;
    if(state.player.y>430){state.player.y=430;state.player.vy=0}
    state.spawn-=dt;
    if(state.spawn<=0){
      state.spawn=.9+Math.random()*.45;
      state.obs.push({x:990,y:445,w:35+Math.random()*25,h:48+Math.random()*42,vx:310});
    }
    state.obs.forEach(o=>o.x-=o.vx*dt);
    for(const o of state.obs){
      if(hit(state.player,o)){endGame('Relay ended!');return}
      if(!o.passed&&o.x+o.w<state.player.x){o.passed=true;score+=3}
    }
    state.obs=state.obs.filter(o=>o.x>-80);
  }

  if(current.type==='bounce'){
    const b=state.ball,p=state.paddle;b.x+=b.vx*dt;b.y+=b.vy*dt;
    if(b.x<b.r||b.x>960-b.r)b.vx*=-1;if(b.y<b.r)b.vy=Math.abs(b.vy);
    if(b.y+b.r>p.y&&b.y<p.y+p.h&&b.x>p.x&&b.x<p.x+p.w&&b.vy>0){
      b.vy=-Math.abs(b.vy);b.vx+=(b.x-(p.x+p.w/2))*2;
    }
    for(const br of state.bricks){
      if(br.on&&b.x+b.r>br.x&&b.x-b.r<br.x+br.w&&b.y+b.r>br.y&&b.y-b.r<br.y+br.h){
        br.on=false;b.vy*=-1;score+=5;break;
      }
    }
    if(b.y>570){endGame('Pulse lost!');return}
    if(state.bricks.every(x=>!x.on)){score+=100;endGame('Vault opened!')}
  }

  if(current.type==='memory'){
    state.timer+=dt;
    if(state.locked&&state.timer>.65){
      state.timer=0;state.show++;
      if(state.show>state.seq.length){state.locked=false;state.show=0}
    }
  }

  if(current.type==='snake'){
    state.step+=dt;
    if(state.step>.12){
      state.step=0;state.dir=state.next;
      const h=state.snake[0],n={x:h.x+state.dir.x,y:h.y+state.dir.y};
      if(n.x<0||n.x>=32||n.y<0||n.y>=18||state.snake.some(s=>s.x===n.x&&s.y===n.y)){
        endGame('Trail tangled!');return;
      }
      state.snake.unshift(n);
      if(n.x===state.food.x&&n.y===state.food.y){
        score+=4;state.food={x:Math.floor(Math.random()*32),y:Math.floor(Math.random()*18)};
      }else state.snake.pop();
    }
  }

  if(current.type==='lane'){
    state.spawn-=dt;
    if(state.spawn<=0){
      state.spawn=.72+Math.random()*.3;
      state.obs.push({lane:Math.floor(Math.random()*3),y:-100,h:85,vy:330});
    }
    state.obs.forEach(o=>o.y+=o.vy*dt);
    for(const o of state.obs){
      if(o.lane===state.lane&&o.y+o.h>410&&o.y<505){endGame('Harbor collision!');return}
      if(!o.passed&&o.y>520){o.passed=true;score+=2}
    }
    state.obs=state.obs.filter(o=>o.y<620);
  }

  if(current.type==='orbit'){
    state.angle+=state.dir*state.speed*dt;
    state.addMine-=dt;
    if(state.addMine<=0&&state.mines.length<6){
      state.addMine=5;
      state.mines.push(Math.random()*Math.PI*2);
    }
    if(angularDistance(state.angle,state.star)<.12){
      score+=5;state.star=Math.random()*Math.PI*2;state.speed+=.06;
    }
    if(state.mines.some(m=>angularDistance(state.angle,m)<.105)){
      endGame('Mine collision!');return;
    }
  }

  if(current.type==='stack'){
    const m=state.moving;
    m.x+=m.vx*dt;
    if(m.x<0){m.x=0;m.vx=Math.abs(m.vx)}
    if(m.x+m.w>960){m.x=960-m.w;m.vx=-Math.abs(m.vx)}
  }

  if(current.type==='connect'){
    state.preview=Math.max(0,state.preview-dt);
  }

  if(current.type==='glide'){
    state.walls.forEach(w=>w.x-=state.speed*dt);
    for(const w of state.walls){
      if(!w.passed&&w.x+w.w<state.player.x){w.passed=true;score+=4;state.speed+=4}
      const inX=state.player.x+state.player.r>w.x&&state.player.x-state.player.r<w.x+w.w;
      const hitsWall=state.player.y-state.player.r<w.gapTop||state.player.y+state.player.r>w.gapBottom;
      if(inX&&hitsWall){endGame('Glider clipped the canyon!');return}
    }
    state.walls=state.walls.filter(w=>w.x>-120);
    while(state.walls.length<2){
      const lastX=state.walls.length?Math.max(...state.walls.map(w=>w.x)):700;
      state.walls.push(newGlideWall(lastX+400));
    }
  }
}
function gradient(){
  const g=ctx.createLinearGradient(0,0,0,540);
  g.addColorStop(0,'#123252');g.addColorStop(1,'#07101d');return g;
}
function drawBackground(){
  ctx.fillStyle=gradient();ctx.fillRect(0,0,960,540);
  ctx.fillStyle='rgba(255,255,255,.035)';
  for(let x=0;x<960;x+=48)ctx.fillRect(x,0,1,540);
  for(let y=0;y<540;y+=48)ctx.fillRect(0,y,960,1);
}
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function draw(){
  drawBackground();ctx.textAlign='center';ctx.textBaseline='middle';

  if(['dodge','catch'].includes(current.type)){
    ctx.fillStyle=current.type==='dodge'?'#60a5fa':'#fbbf24';
    rr(state.player.x,state.player.y,state.player.w,state.player.h,8);ctx.fill();
    state.falls.forEach(o=>{
      ctx.font=`${o.r*2}px serif`;
      ctx.fillText(o.bomb?'📦':current.type==='dodge'?'☄️':'🍎',o.x,o.y);
    });
  }
  if(current.type==='reaction'){
    ctx.fillStyle=state.phase==='go'?'#22c55e':'#ef4444';ctx.fillRect(0,0,960,540);
    ctx.fillStyle='#fff';ctx.font='900 55px system-ui';
    ctx.fillText(state.phase==='go'?'TAP!':'WAIT…',480,270);
  }
  if(current.type==='runner'){
    ctx.fillStyle='#263244';ctx.fillRect(0,492,960,48);
    ctx.fillStyle='#38bdf8';rr(state.player.x,state.player.y,state.player.w,state.player.h,10);ctx.fill();
    ctx.fillStyle='#fb7185';state.obs.forEach(o=>{rr(o.x,o.y,o.w,o.h,8);ctx.fill()});
  }
  if(current.type==='bounce'){
    ctx.fillStyle='#38bdf8';rr(state.paddle.x,state.paddle.y,state.paddle.w,state.paddle.h,9);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(state.ball.x,state.ball.y,state.ball.r,0,Math.PI*2);ctx.fill();
    state.bricks.forEach((b,i)=>{
      if(!b.on)return;ctx.fillStyle=`hsl(${190+(i%10)*9} 75% 58%)`;rr(b.x,b.y,b.w,b.h,6);ctx.fill();
    });
  }
  if(current.type==='memory'){
    state.pads.forEach((p,i)=>{
      ctx.fillStyle=p.c;
      ctx.globalAlpha=(state.locked&&state.show<state.seq.length&&state.seq[state.show]===i)?1:.38;
      rr(p.x,p.y,210,120,20);ctx.fill();ctx.globalAlpha=1;
    });
  }
  if(current.type==='snake'){
    ctx.fillStyle='#4ade80';
    state.snake.forEach((s,i)=>{ctx.globalAlpha=i===0?1:.72;rr(s.x*30+2,s.y*30+2,26,26,7);ctx.fill()});
    ctx.globalAlpha=1;ctx.fillStyle='#fb7185';ctx.beginPath();ctx.arc(state.food.x*30+15,state.food.y*30+15,11,0,Math.PI*2);ctx.fill();
  }
  if(current.type==='lane'){
    ctx.fillStyle='#23465b';ctx.fillRect(220,0,520,540);
    ctx.strokeStyle='rgba(255,255,255,.35)';ctx.setLineDash([26,22]);ctx.lineWidth=4;
    [393,566].forEach(x=>{ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,540);ctx.stroke()});ctx.setLineDash([]);
    const xs=[278,451,624];ctx.fillStyle='#22d3ee';rr(xs[state.lane],410,115,80,18);ctx.fill();
    ctx.fillStyle='#fb7185';state.obs.forEach(o=>{rr(xs[o.lane],o.y,115,o.h,18);ctx.fill()});
  }
  if(current.type==='orbit'){
    ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=4;ctx.beginPath();ctx.arc(480,270,150,0,Math.PI*2);ctx.stroke();
    const px=480+Math.cos(state.angle)*150,py=270+Math.sin(state.angle)*150;
    const sx=480+Math.cos(state.star)*150,sy=270+Math.sin(state.star)*150;
    ctx.fillStyle='#fbbf24';ctx.beginPath();ctx.arc(sx,sy,13,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#38bdf8';ctx.beginPath();ctx.arc(px,py,18,0,Math.PI*2);ctx.fill();
    state.mines.forEach(m=>{
      const x=480+Math.cos(m)*150,y=270+Math.sin(m)*150;
      ctx.fillStyle='#fb7185';ctx.beginPath();ctx.arc(x,y,16,0,Math.PI*2);ctx.fill();
    });
    ctx.fillStyle='#fff';ctx.font='700 18px system-ui';ctx.fillText(state.dir>0?'CLOCKWISE':'REVERSED',480,270);
  }
  if(current.type==='stack'){
    state.floors.forEach((f,i)=>{
      ctx.fillStyle=`hsl(${38+i*10} 85% 60%)`;rr(f.x,f.y,f.w,f.h,5);ctx.fill();
    });
    ctx.fillStyle='#38bdf8';rr(state.moving.x,state.moving.y,state.moving.w,state.moving.h,5);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='700 20px system-ui';ctx.fillText(`Floor ${state.floors.length}`,480,55);
  }
  if(current.type==='connect'){
    state.nodes.forEach((n,i)=>{
      ctx.fillStyle=i<state.next?'#4ade80':'#a78bfa';
      ctx.globalAlpha=state.preview>0||i<state.next?1:.75;
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
      if(state.preview>0||i<state.next){
        ctx.fillStyle='#fff';ctx.font='800 18px system-ui';ctx.fillText(String(i+1),n.x,n.y);
      }
    });
    ctx.fillStyle='#fff';ctx.font='700 18px system-ui';
    ctx.fillText(state.preview>0?'Memorize the order':'Tap the hidden order',480,45);
  }
  if(current.type==='glide'){
    ctx.fillStyle='#8b6f47';
    state.walls.forEach(w=>{
      ctx.fillRect(w.x,0,w.w,w.gapTop);
      ctx.fillRect(w.x,w.gapBottom,w.w,540-w.gapBottom);
    });
    ctx.fillStyle='#34d399';ctx.beginPath();ctx.arc(state.player.x,state.player.y,state.player.r,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='28px serif';ctx.fillText('🪂',state.player.x,state.player.y);
  }
}
function loop(now){
  if(!running)return;
  const dt=Math.min(.035,(now-last)/1000);last=now;update(dt);
  if(!running)return;
  draw();
  document.getElementById('score').textContent=score;
  document.getElementById('time').textContent=timeLeft.toFixed(1);
  raf=requestAnimationFrame(loop);
}
function point(e){
  const r=canvas.getBoundingClientRect();
  return{x:(e.clientX-r.left)*960/r.width,y:(e.clientY-r.top)*540/r.height};
}
function dropStackFloor(){
  const m=state.moving,base=state.floors[state.floors.length-1];
  const left=Math.max(m.x,base.x),right=Math.min(m.x+m.w,base.x+base.w);
  const overlap=right-left;
  if(overlap<=0){endGame('Tower missed!');return}
  const placed={x:left,y:m.y,w:overlap,h:m.h};
  state.floors.push(placed);score+=Math.round(overlap/12);
  if(state.floors.length>15){
    state.floors.forEach(f=>f.y+=24);
  }
  state.moving={x:m.vx>0?0:960-overlap,y:Math.max(80,placed.y-24),w:overlap,h:24,vx:-m.vx*1.04};
}
canvas.addEventListener('pointerdown',e=>{
  touchStart=point(e);
  if(!running){startGame();return}
  const p=touchStart;

  if(current.type==='reaction'){
    if(state.phase==='go'){
      score=Math.max(1,1000-Math.round(performance.now()-state.start));endGame('Great reaction!');
    }else endGame('Too early!');
  }
  if(current.type==='runner'&&state.player.y>=429)state.player.vy=-520;
  if(current.type==='lane')state.lane=p.x<480?Math.max(0,state.lane-1):Math.min(2,state.lane+1);

  if(current.type==='memory'&&!state.locked){
    state.pads.forEach((pad,i)=>{
      if(p.x>pad.x&&p.x<pad.x+210&&p.y>pad.y&&p.y<pad.y+120){
        if(i===state.seq[state.input]){
          state.input++;
          if(state.input===state.seq.length){
            score+=state.seq.length*3;state.seq.push(Math.floor(Math.random()*4));
            state.input=0;state.locked=true;state.show=0;state.timer=0;
          }
        }else endGame('Wrong tile!');
      }
    });
  }
  if(current.type==='orbit')state.dir*=-1;
  if(current.type==='stack')dropStackFloor();
  if(current.type==='connect'&&state.preview<=0){
    const expected=state.nodes[state.next];
    if(Math.hypot(p.x-expected.x,p.y-expected.y)<=expected.r+12){
      state.next++;score+=3;
      if(state.next===state.nodes.length){
        state.round++;state.nodes=randomNodes(Math.min(8,3+state.round));
        state.next=0;state.preview=1.2;score+=5;
      }
    }else endGame('Wrong star!');
  }
});
canvas.addEventListener('pointermove',e=>{
  if(!running)return;const p=point(e);
  if(['dodge','catch'].includes(current.type)){
    state.player.x=Math.max(0,Math.min(960-state.player.w,p.x-state.player.w/2));
  }
  if(current.type==='bounce'){
    state.paddle.x=Math.max(0,Math.min(960-state.paddle.w,p.x-state.paddle.w/2));
  }
  if(current.type==='glide'){
    state.player.y=Math.max(state.player.r,Math.min(540-state.player.r,p.y));
  }
});
canvas.addEventListener('pointerup',e=>{
  if(!running||current.type!=='snake'||!touchStart)return;
  const p=point(e),dx=p.x-touchStart.x,dy=p.y-touchStart.y;
  if(Math.abs(dx)>Math.abs(dy)){
    if(dx>0&&state.dir.x!==-1)state.next={x:1,y:0};
    if(dx<0&&state.dir.x!==1)state.next={x:-1,y:0};
  }else{
    if(dy>0&&state.dir.y!==-1)state.next={x:0,y:1};
    if(dy<0&&state.dir.y!==1)state.next={x:0,y:-1};
  }
  touchStart=null;
});
overlay.onclick=startGame;
document.getElementById('closeGame').onclick=closeGame;
document.getElementById('restartBtn').onclick=resetGame;
document.getElementById('favBtn').onclick=()=>{
  toggleFav(current.id);
  document.getElementById('favBtn').textContent=favorites.includes(current.id)?'★':'☆';
};
gameModal.addEventListener('click',e=>{if(e.target===gameModal)closeGame()});

renderCategories();renderGames();renderFavorites();drawBackground();initializeEnhancedApp();


if('serviceWorker' in navigator){
 window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
