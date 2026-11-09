(() => {
  'use strict';

  const checkedAssets = new Set(['app.js', 'push-notifications.js', 'firebase-client.js', 'first-event-onboarding.js']);
  let notice;
  let checking = false;
  let latestSignature = '';

  function assetVersions(doc) {
    const urls = [
      ...Array.from(doc.querySelectorAll('script[src]'), element => element.getAttribute('src')),
      ...Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'), element => element.getAttribute('href')),
    ];
    return urls
      .map(value => new URL(value, location.origin))
      .filter(url => url.origin === location.origin && (checkedAssets.has(url.pathname.split('/').pop()) || url.pathname.endsWith('.css')))
      .map(url => `${url.pathname}?${url.searchParams.get('v') || ''}`)
      .sort()
      .join('|');
  }

  function showUpdateNotice() {
    if (notice?.isConnected) return;
    notice = document.createElement('section');
    notice.className = 'app-update-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.innerHTML = '<div class="app-update-copy"><strong>Ny version finns</strong><span>Ladda om Fordonsmappen för att använda den senaste versionen.</span></div><div class="app-update-actions"><button type="button" class="app-update-later">Senare</button><button type="button" class="app-update-reload">Ladda om</button></div>';
    notice.querySelector('.app-update-later').addEventListener('click', () => {
      try { sessionStorage.setItem('fordonsmappen.update-dismissed', latestSignature); } catch {}
      notice.remove();
    });
    notice.querySelector('.app-update-reload').addEventListener('click', () => location.reload());
    document.body.append(notice);
  }

  async function checkForUpdate() {
    if (checking || !navigator.onLine || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const url = new URL('/', location.origin);
      url.searchParams.set('version-check', String(Date.now()));
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const markup = await response.text();
      const latest = new DOMParser().parseFromString(markup, 'text/html');
      const currentSignature = assetVersions(document);
      const remoteSignature = assetVersions(latest);
      if (remoteSignature && remoteSignature !== currentSignature) {
        latestSignature = remoteSignature;
        let dismissedSignature = '';
        try { dismissedSignature = sessionStorage.getItem('fordonsmappen.update-dismissed') || ''; } catch {}
        if (dismissedSignature !== remoteSignature) showUpdateNotice();
      }
    } catch {
      // Update checks are best-effort; offline or transient failures are silent.
    } finally {
      checking = false;
    }
  }

  window.addEventListener('online', checkForUpdate);
  window.addEventListener('focus', checkForUpdate);
  document.addEventListener('visibilitychange', checkForUpdate);
  checkForUpdate();
  window.setInterval(checkForUpdate, 60_000);
})();
