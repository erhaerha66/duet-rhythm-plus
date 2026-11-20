const visitorKey = 'jianke-traffic-id';
const newTrafficId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

function trafficBrowser() {
  try {
    let id = localStorage.getItem(visitorKey);
    if (!/^[0-9a-f]{32}$/.test(id)) {
      id = newTrafficId();
      localStorage.setItem(visitorKey, id);
    }
    return id;
  } catch {
    return newTrafficId();
  }
}

function registerPageView() {
  const event = newTrafficId();
  function record() {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', record);
    fetch('/api/traffic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ browser: trafficBrowser(), event })
    }).catch(() => {});
  }
  document.addEventListener('visibilitychange', record);
  record();
}

if (navigator.globalPrivacyControl !== true && navigator.doNotTrack !== '1') registerPageView();
