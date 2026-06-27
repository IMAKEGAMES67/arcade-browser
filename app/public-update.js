(async () => {
  if (!window.supabase || !window.ARCADE_SUPABASE_URL || !window.ARCADE_SUPABASE_ANON_KEY) return;
  const client = window.supabase.createClient(window.ARCADE_SUPABASE_URL, window.ARCADE_SUPABASE_ANON_KEY);
  const {data, error} = await client
    .from('ab_site_updates')
    .select('title,html,css,js,created_at')
    .eq('published', true)
    .order('created_at', {ascending:false})
    .limit(1)
    .maybeSingle();
  if (error || !data) return;

  const safeScript = String(data.js || '').replace(/<\/script/gi, '<\\/script');
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; media-src https: blob:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline'; connect-src https:; font-src https: data:; frame-src https:;">
  <style>html,body{margin:0;min-height:100%;font-family:system-ui;background:#fff;color:#111}${data.css || ''}</style>
  </head><body>${data.html || ''}<script>${safeScript}<\/script></body></html>`;

  const section = document.getElementById('publicUpdateSection');
  const title = document.getElementById('publicUpdateTitle');
  const frame = document.getElementById('publicUpdateFrame');
  if (section && title && frame) {
    title.textContent = data.title;
    frame.srcdoc = srcdoc;
    section.classList.remove('hidden');
  }
})();
