let client = null;
let profile = null;

const loginPanel = document.getElementById('adminLogin');
const notAdmin = document.getElementById('notAdmin');
const studio = document.getElementById('adminStudio');
const logoutButton = document.getElementById('adminLogout');

function codeDocument(){
  const html = document.getElementById('htmlEditor').value;
  const css = document.getElementById('cssEditor').value;
  const js = document.getElementById('jsEditor').value.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; media-src https: blob:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline'; connect-src https:; font-src https: data:; frame-src https:;">
  <style>html,body{margin:0;min-height:100%;font-family:system-ui}${css}</style>
  </head><body>${html}<script>${js}<\/script></body></html>`;
}
function preview(){
  document.getElementById('previewFrame').srcdoc = codeDocument();
}
function message(text, error=false){
  const box = document.getElementById('editorMessage');
  box.textContent = text;
  box.style.color = error ? '#fda4af' : '#7dd3fc';
}
async function login(){
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  const {error} = await client.auth.signInWithPassword({email, password});
  document.getElementById('adminLoginMessage').textContent = error ? error.message : 'Logged in.';
  await checkAccess();
}
async function logout(){
  await client.auth.signOut();
  location.reload();
}
async function checkAccess(){
  const {data:{session}} = await client.auth.getSession();
  loginPanel.classList.toggle('hidden', !!session);
  logoutButton.classList.toggle('hidden', !session);
  if (!session) return;

  await client.rpc('ab_ensure_profile', {
    requested_username: session.user.user_metadata?.username || null
  });

  const {data, error} = await client
    .from('ab_profiles')
    .select('id,username,role')
    .eq('id', session.user.id)
    .single();
  if (error) {
    document.getElementById('adminLoginMessage').textContent = error.message;
    return;
  }
  profile = data;
  const allowed = data.role === 'admin';
  notAdmin.classList.toggle('hidden', allowed);
  studio.classList.toggle('hidden', !allowed);
  if (allowed) {
    document.getElementById('adminName').textContent = data.username;
    preview();
    await loadVersions();
    await loadBillingConfig();
    await loadMembers();
    await loadAdminAds();
  }
}
async function saveUpdate(published){
  if (!profile) return;
  const payload = {
    title: document.getElementById('updateTitle').value.trim() || 'Website update',
    html: document.getElementById('htmlEditor').value,
    css: document.getElementById('cssEditor').value,
    js: document.getElementById('jsEditor').value,
    published,
    created_by: profile.id
  };
  const {error} = await client.from('ab_site_updates').insert(payload);
  if (error) return message(error.message, true);
  message(published ? 'Published live!' : 'Draft saved.');
  await loadVersions();
}
async function loadVersions(){
  const list = document.getElementById('versionsList');
  list.innerHTML = '<div>Loading…</div>';
  const {data, error} = await client
    .from('ab_site_updates')
    .select('*')
    .order('created_at', {ascending:false})
    .limit(30);
  if (error) {
    list.innerHTML = `<div>${error.message}</div>`;
    return;
  }
  if (!data.length) {
    list.innerHTML = '<div>No saved versions yet.</div>';
    return;
  }
  list.innerHTML = data.map(item => `
    <article class="version-row">
      <div>
        <strong>${escapeHtml(item.title)} ${item.published ? '<span class="published">● Live</span>' : ''}</strong>
        <small>${new Date(item.created_at).toLocaleString()}</small>
      </div>
      <div class="version-actions">
        <button data-load="${item.id}">Load</button>
        <button data-publish="${item.id}">Publish</button>
        <button data-delete="${item.id}">Delete</button>
      </div>
    </article>
  `).join('');

  list.querySelectorAll('[data-load]').forEach(button => button.onclick = () => loadVersion(data.find(item => String(item.id) === button.dataset.load)));
  list.querySelectorAll('[data-publish]').forEach(button => button.onclick = () => publishExisting(button.dataset.publish));
  list.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => deleteVersion(button.dataset.delete));
}
function loadVersion(item){
  document.getElementById('updateTitle').value = item.title;
  document.getElementById('htmlEditor').value = item.html;
  document.getElementById('cssEditor').value = item.css;
  document.getElementById('jsEditor').value = item.js;
  preview();
  scrollTo({top:0, behavior:'smooth'});
}
async function publishExisting(id){
  const {error} = await client.from('ab_site_updates').update({published:true}).eq('id', id);
  if (error) return message(error.message, true);
  message('Version published live.');
  await loadVersions();
}
async function deleteVersion(id){
  if (!confirm('Delete this saved version?')) return;
  const {error} = await client.from('ab_site_updates').delete().eq('id', id);
  if (error) return message(error.message, true);
  await loadVersions();
}
const defaultPackages = [
  {id:'quick',name:'Quick Banner',price_id:'',placement:'banner',duration_days:3,close_delay_seconds:0,description:'Can be closed immediately.'},
  {id:'standard',name:'Standard Sponsor',price_id:'',placement:'sidebar',duration_days:7,close_delay_seconds:5,description:'5-second close countdown.'},
  {id:'spotlight',name:'Spotlight',price_id:'',placement:'featured',duration_days:14,close_delay_seconds:10,description:'10-second close countdown.'},
  {id:'takeover',name:'Takeover',price_id:'',placement:'featured',duration_days:30,close_delay_seconds:15,description:'15-second close countdown.'}
];

function renderPackageEditor(packages){
  const editor = document.getElementById('packageEditor');
  const rows = (packages?.length ? packages : defaultPackages).slice(0, 8);
  editor.innerHTML = rows.map((item,index)=>`
    <article class="package-row" data-package-index="${index}" data-package-id="${escapeHtml(item.id || `package-${index+1}`)}">
      <label>Name<input data-field="name" value="${escapeHtml(item.name || '')}"></label>
      <label>Stripe Price ID<input data-field="price_id" value="${escapeHtml(item.price_id || '')}" placeholder="price_..."></label>
      <label>Placement
        <select data-field="placement">
          <option value="banner" ${item.placement==='banner'?'selected':''}>Banner</option>
          <option value="sidebar" ${item.placement==='sidebar'?'selected':''}>Sidebar</option>
          <option value="featured" ${item.placement==='featured'?'selected':''}>Featured</option>
        </select>
      </label>
      <label>Days<input data-field="duration_days" type="number" min="1" max="365" value="${Number(item.duration_days || 7)}"></label>
      <label>X delay<input data-field="close_delay_seconds" type="number" min="0" max="30" value="${Number(item.close_delay_seconds || 0)}"></label>
    </article>
  `).join('');
}

function collectPackages(){
  return [...document.querySelectorAll('.package-row')].map((row,index)=>{
    const get = field => row.querySelector(`[data-field="${field}"]`).value;
    const delay = Math.max(0,Math.min(30,Number(get('close_delay_seconds'))||0));
    return {
      id: row.dataset.packageId || `package-${index+1}`,
      name: get('name').trim() || `Package ${index+1}`,
      price_id: get('price_id').trim(),
      placement: get('placement'),
      duration_days: Math.max(1,Math.min(365,Number(get('duration_days'))||7)),
      close_delay_seconds: delay,
      description: delay
        ? `${delay}-second close countdown.`
        : 'Can be closed immediately.'
    };
  });
}

async function loadBillingConfig(){
  const {data, error} = await client
    .from('ab_billing_config')
    .select('*')
    .eq('id', true)
    .single();

  if (error) {
    document.getElementById('billingMessage').textContent = error.message;
    return;
  }

  document.getElementById('membershipPriceId').value = data.membership_price_id || '';
  document.getElementById('adsEnabled').checked = data.ads_enabled;
  document.getElementById('membershipEnabled').checked = data.membership_enabled;
  renderPackageEditor(data.ad_packages);
}

function validPriceId(value){
  return !value || value.startsWith('price_');
}

async function saveBillingConfig(){
  const packages = collectPackages();
  const ids = [
    document.getElementById('membershipPriceId').value.trim(),
    ...packages.map(item=>item.price_id)
  ];

  if (!ids.every(validPriceId)) {
    document.getElementById('billingMessage').textContent =
      'Every Price ID must be empty or begin with price_.';
    return;
  }

  const {error} = await client
    .from('ab_billing_config')
    .update({
      membership_price_id: document.getElementById('membershipPriceId').value.trim(),
      ad_packages: packages,
      ads_enabled: document.getElementById('adsEnabled').checked,
      membership_enabled: document.getElementById('membershipEnabled').checked,
      updated_by: profile.id
    })
    .eq('id', true);

  document.getElementById('billingMessage').textContent =
    error ? error.message : 'Packages saved.';
}

async function grantPlus(){
  const username = document.getElementById('grantUsername').value.trim();
  const duration = Number(document.getElementById('grantDays').value);
  const note = document.getElementById('grantNote').value.trim();

  const {error} = await client.rpc('ab_admin_grant_plus', {
    target_username: username,
    duration_days: duration,
    note
  });

  document.getElementById('grantMessage').textContent =
    error ? error.message : `Free Arcade Plus granted to ${username}.`;
  if (!error) await loadMembers();
}

async function revokePlus(){
  const username = document.getElementById('grantUsername').value.trim();
  const {error} = await client.rpc('ab_admin_revoke_plus', {
    target_username: username
  });

  document.getElementById('grantMessage').textContent =
    error ? error.message : `Arcade Plus revoked for ${username}.`;
  if (!error) await loadMembers();
}

async function loadMembers(){
  const list = document.getElementById('membersList');
  const {data: memberships, error} = await client
    .from('ab_memberships')
    .select('user_id,status,current_period_end,source,grant_note,updated_at')
    .order('updated_at',{ascending:false})
    .limit(50);

  if (error) {
    list.innerHTML = `<div>${escapeHtml(error.message)}</div>`;
    return;
  }

  const ids = memberships.map(item=>item.user_id);
  const {data: profiles} = ids.length
    ? await client.from('ab_profiles').select('id,username').in('id',ids)
    : {data:[]};
  const names = new Map((profiles||[]).map(item=>[item.id,item.username]));

  list.innerHTML = memberships.length
    ? memberships.map(item=>{
      const end = item.current_period_end
        ? new Date(item.current_period_end).toLocaleDateString()
        : 'Lifetime';
      return `<article class="member-row">
        <div>
          <strong>${escapeHtml(names.get(item.user_id) || item.user_id)}</strong>
          <small>${escapeHtml(item.status)} • ${escapeHtml(item.source)} • ends ${escapeHtml(end)}</small>
          ${item.grant_note?`<small>${escapeHtml(item.grant_note)}</small>`:''}
        </div>
        <span>${item.status==='active'?'⭐':'—'}</span>
      </article>`;
    }).join('')
    : '<div>No memberships yet.</div>';
}

async function loadAdminAds(){
  const list = document.getElementById('adminAdsList');
  list.innerHTML = '<div>Loading…</div>';

  const {data, error} = await client
    .from('ab_ad_campaigns')
    .select('*')
    .order('created_at', {ascending:false})
    .limit(50);

  if (error) {
    list.innerHTML = `<div>${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    list.innerHTML = '<div>No advertising campaigns yet.</div>';
    return;
  }

  list.innerHTML = data.map(ad => `
    <article class="ad-admin-row">
      ${ad.image_url ? `<img src="${escapeHtml(ad.image_url)}" alt="">` : '<div></div>'}
      <div>
        <h3>${escapeHtml(ad.title)}</h3>
        <p>${escapeHtml(ad.description)}</p>
        <small>${escapeHtml(ad.placement)} • ${escapeHtml(ad.status)} • ${new Date(ad.created_at).toLocaleString()}</small>
        <small><a href="${escapeHtml(ad.destination_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ad.destination_url)}</a></small>
      </div>
      <div class="ad-admin-actions">
        <button class="approve" data-approve-ad="${ad.id}">Approve</button>
        <button class="reject" data-reject-ad="${ad.id}">Reject</button>
      </div>
    </article>
  `).join('');

  list.querySelectorAll('[data-approve-ad]').forEach(button => {
    button.onclick = () => reviewAd(button.dataset.approveAd, 'approved');
  });
  list.querySelectorAll('[data-reject-ad]').forEach(button => {
    button.onclick = () => reviewAd(button.dataset.rejectAd, 'rejected');
  });
}

async function reviewAd(id, decision){
  let reason = '';
  if (decision === 'rejected') {
    reason = prompt('Reason for rejection (optional):') || '';
  }

  const {error} = await client.rpc('ab_admin_review_campaign', {
    campaign_id: id,
    decision,
    reason
  });

  if (error) {
    message(error.message, true);
    return;
  }
  message(decision === 'approved' ? 'Advertisement approved.' : 'Advertisement rejected.');
  await loadAdminAds();
}

function escapeHtml(value=''){
  return String(value).replace(/[&<>"']/g, character => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  })[character]);
}
document.querySelectorAll('[data-editor-tab]').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll('[data-editor-tab]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('.code-editor').forEach(editor => editor.classList.toggle('active', editor.id === button.dataset.editorTab + 'Editor'));
  };
});
document.getElementById('previewUpdate').onclick = preview;
document.getElementById('saveDraft').onclick = () => saveUpdate(false);
document.getElementById('publishUpdate').onclick = () => saveUpdate(true);
document.getElementById('refreshVersions').onclick = loadVersions;
document.getElementById('refreshBilling').onclick = loadBillingConfig;
document.getElementById('refreshMembers').onclick = loadMembers;
document.getElementById('grantPlus').onclick = grantPlus;
document.getElementById('revokePlus').onclick = revokePlus;
document.getElementById('saveBilling').onclick = saveBillingConfig;
document.getElementById('refreshAds').onclick = loadAdminAds;
document.getElementById('adminLoginButton').onclick = login;
logoutButton.onclick = logout;

if (window.supabase && window.ARCADE_SUPABASE_URL && window.ARCADE_SUPABASE_ANON_KEY) {
  client = window.supabase.createClient(window.ARCADE_SUPABASE_URL, window.ARCADE_SUPABASE_ANON_KEY);
  client.auth.onAuthStateChange(() => setTimeout(checkAccess, 0));
  checkAccess();
}
