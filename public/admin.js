import { AdminUsersView } from './admin-users.js';
import { watchStatuses } from './watch.js';
import { roles } from './preferences.js';

const byId = id => document.getElementById(id);
const adminUsers = new AdminUsersView(byId('admin-users'));
const roomKinds = { friend: '好友房', match: '随机匹配' };
const voiceStatuses = { off: '未开启', pending: '等待玩家同意', declined: '已拒绝', approved: '已开启' };
const maxBanMinutes = 525_600;
const reportPanel = byId('report-panel');
const reportToggle = byId('report-toggle');
const reportPrev = byId('report-prev');
const reportNext = byId('report-next');
const reportPager = byId('report-page').parentElement;
const sitesAuth = document.body.dataset.adminAuth === 'sites';
let selected;
let adminLoading = false;
let trafficLoaded = false;
let reportsLoading = false;
let reportPage = 1;
let reportPages = 1;
let trafficRequest;
let rooms = [];

function status(message) {
  byId('admin-status').textContent = message;
  byId('admin-status').hidden = !message;
}

function reportStatus(message) {
  byId('admin-report-status').textContent = message;
  byId('admin-report-status').hidden = !message;
}

function reportAttachments(report) {
  const group = document.createElement('div');
  group.className = 'report-attachments';
  for (const [index, attachment] of (report.attachments ?? []).entries()) {
    const path = `/api/admin/report-files/${encodeURIComponent(report.id)}/${index}`;
    const details = document.createElement('details');
    const label = document.createElement('summary');
    const size = attachment.size < 1024 ? `${attachment.size} B` : attachment.size < 1024 ** 2
      ? `${(attachment.size / 1024).toFixed(1)} KB` : `${(attachment.size / 1024 ** 2).toFixed(1)} MB`;
    label.textContent = `${attachment.name} · ${size}`;
    const download = document.createElement('a');
    download.className = 'button outline';
    download.href = path + '?download=1';
    download.textContent = '下载附件';
    details.append(label, download);
    if (attachment.type !== 'image/heic') {
      let requested = false;
      details.addEventListener('toggle', () => {
        if (!details.open || requested) return;
        requested = true;
        const isVideo = attachment.type.startsWith('video/');
        const media = document.createElement(isVideo ? 'video' : 'img');
        if (isVideo) {
          media.controls = true;
          media.preload = 'metadata';
          media.playsInline = true;
        } else media.alt = attachment.name;
        media.addEventListener('error', async () => {
          const message = document.createElement('p');
          message.textContent = '正在检查附件是否可读取…';
          media.replaceWith(message);
          const response = await fetch(path, { method: 'HEAD', signal: AbortSignal.timeout(6000) }).catch(() => null);
          if (response?.ok) message.textContent = '文件已上传，但内容不完整或当前浏览器无法解码。';
          else if (response?.status === 404) message.textContent = '找不到附件文件。';
          else if (response?.status === 403) message.textContent = '请重新登录管理员账号后加载附件。';
          else message.textContent = '附件暂时无法读取，关闭后重新展开可重试。';
          requested = Boolean(response?.ok);
          if (!requested) details.addEventListener('toggle', () => { if (!details.open) message.remove(); }, { once: true });
        }, { once: true });
        details.insertBefore(media, download);
        media.src = path;
      });
    }
    group.append(details);
  }
  return group;
}

async function loadReports(page = reportPage) {
  if (reportsLoading || reportPanel.hidden) return;
  reportsLoading = true;
  reportPrev.disabled = reportNext.disabled = true;
  reportStatus('正在加载举报…');
  try {
    const response = await fetch(`/api/admin/reports?page=${page}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('暂时无法加载举报列表。');
    const data = await response.json();
    const { reports } = data;
    const rows = document.createDocumentFragment();
    const labels = { online: '在线列表', 'room-list': '房间列表', room: '对局中', result: '对局后' };
    const states = { pending: '待审核', dismissed: '已驳回', banned: '已封禁', revoked: '已解除' };
    for (const report of reports) {
      const row = document.createElement('article');
      row.className = 'admin-report';
      const heading = document.createElement('h3');
      heading.textContent = `${report.nickname || '匿名玩家'} · ${report.reason}`;
      const activeBan = report.banUntil > Date.now();
      const info = document.createElement('p');
      info.textContent = [labels[report.source], report.room && `房间 ${report.room}`,
        new Date(report.createdAt).toLocaleString('zh-CN'), report.status === 'banned' && !activeBan ? '封禁已到期' : states[report.status]].filter(Boolean).join(' · ');
      const detail = document.createElement('p');
      detail.className = 'report-detail';
      detail.textContent = report.detail;
      row.append(heading, info, detail);
      if (report.attachments?.length) row.append(reportAttachments(report));
      if (report.status === 'pending' || activeBan) {
        const controls = document.createElement('form');
        controls.className = 'report-controls';
        if (report.status === 'pending') {
          controls.innerHTML = `<label class="field">封禁时长<select name="minutes" aria-label="封禁时长">
            <option value="60">1 小时</option><option value="1440" selected>1 天</option><option value="4320">3 天</option>
            <option value="10080">7 天</option><option value="43200">30 天</option><option value="${maxBanMinutes}">1 年</option>
            <option value="custom">自定义</option>
          </select></label>
          <div class="report-custom-duration" hidden>
            <label class="field">自定义时长<input name="amount" type="number" inputmode="numeric" min="1" step="1" required disabled></label>
            <label class="field">单位<select name="unit" disabled><option value="1">分钟</option><option value="60" selected>小时</option><option value="1440">天</option></select></label>
            <p>最短 1 分钟，最长 365 天。</p>
          </div>
          <button type="submit" class="button danger" name="decision" value="ban">封禁</button>
          <button type="submit" class="button outline" name="decision" value="dismiss" formnovalidate>驳回</button>`;
          const customDuration = controls.querySelector('.report-custom-duration');
          const { minutes, amount, unit } = controls.elements;
          minutes.addEventListener('change', () => {
            const custom = minutes.value === 'custom';
            customDuration.hidden = amount.disabled = unit.disabled = !custom;
            if (custom) amount.focus();
          });
          const updateMaximum = () => { amount.max = Math.floor(maxBanMinutes / Number(unit.value)); };
          unit.addEventListener('change', updateMaximum);
          updateMaximum();
          controls.querySelector('[value="ban"]').textContent = report.hasNetwork ? '封禁账号和 IP' : '封禁账号';
        } else {
          const until = document.createElement('p');
          until.textContent = `解封时间 ${new Date(report.banUntil).toLocaleString('zh-CN')}`;
          row.append(until);
          controls.innerHTML = '<button type="submit" class="button outline" name="decision" value="unban">解除封禁</button>';
        }
        controls.addEventListener('submit', event => {
          event.preventDefault();
          const action = event.submitter?.value;
          if (action) decideReport(report.id, action, controls);
        });
        row.append(controls);
      }
      rows.append(row);
    }
    byId('admin-reports').replaceChildren(rows);
    reportStatus(reports.length ? '' : '暂无举报。');
    reportPage = data.page;
    reportPages = data.pages;
    reportPager.hidden = data.total === 0;
    byId('report-page').textContent = `第 ${reportPage} / ${reportPages} 页 · 共 ${data.total} 条`;
  } catch (error) {
    reportStatus(error.message);
  } finally {
    reportsLoading = false;
    reportPrev.disabled = reportPage <= 1;
    reportNext.disabled = reportPage >= reportPages;
  }
}

async function decideReport(id, action, controls) {
  const { minutes: preset, amount, unit } = controls.elements;
  const minutes = action === 'ban'
    ? preset.value === 'custom' ? amount.valueAsNumber * Number(unit.value) : Number(preset.value)
    : undefined;
  const buttons = [...controls.querySelectorAll('button')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    const response = await fetch('/api/admin/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ id, action, minutes })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    await loadReports();
  } catch (error) {
    reportStatus(error.message);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

const trafficNumber = new Intl.NumberFormat('zh-CN');

function renderTraffic(data, days) {
  const format = value => value == null ? '—' : trafficNumber.format(value);
  byId('traffic-total-label').textContent = `近 ${days} 天浏览量`;
  byId('traffic-visitors-label').textContent = `近 ${days} 天独立访客`;
  byId('traffic-today-views').textContent = format(data.firstDate ? data.today.views : null);
  byId('traffic-today-visitors').textContent = format(data.firstDate ? data.today.visitors : null);
  byId('traffic-total-views').textContent = format(data.firstDate ? data.totals.views : null);
  byId('traffic-total-visitors').textContent = format(data.firstDate ? data.totals.visitors : null);
  byId('traffic-coverage').textContent = data.firstDate
    ? `北京时间 · 从 ${data.firstDate} 开始有记录 · 独立访客按浏览器去重。`
    : '等待首次访问记录。独立访客按浏览器去重，日期使用北京时间。';
  byId('traffic-chart-area').hidden = !data.firstDate;
  if (!data.firstDate) return;

  const peak = Math.max(0, ...data.daily.map(day => day.views ?? 0));
  byId('traffic-peak').textContent = `单日最高 ${format(peak)} 次`;
  byId('traffic-start').textContent = data.daily[0].date.slice(5);
  byId('traffic-end').textContent = data.daily.at(-1).date.slice(5);
  const chart = document.createDocumentFragment();
  const rows = document.createDocumentFragment();
  for (const day of data.daily) {
    const column = document.createElement('div');
    column.className = 'traffic-column';
    column.title = day.counted ? `${day.date} · ${format(day.views)} 次浏览` : `${day.date} · 暂无统计`;
    const bar = document.createElement('span');
    bar.className = 'traffic-bar';
    if (!day.counted) bar.classList.add('unmeasured');
    bar.style.height = day.views > 0 ? `${day.views / peak * 100}%` : '2px';
    column.append(bar);
    chart.append(column);
    const row = document.createElement('tr');
    for (const value of [day.date, format(day.views), format(day.visitors)]) {
      const cell = row.insertCell();
      cell.textContent = value;
    }
    rows.append(row);
  }
  byId('traffic-chart').replaceChildren(chart);
  byId('traffic-days').replaceChildren(rows);
}

async function loadTraffic() {
  trafficRequest?.abort();
  const controller = new AbortController();
  trafficRequest = controller;
  const days = byId('traffic-range').value;
  const message = byId('traffic-status');
  message.hidden = false;
  message.textContent = '正在加载流量…';
  byId('traffic-content').hidden = true;
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/api/admin/traffic?days=${days}`, { signal: controller.signal });
    if (!response.ok) throw new Error('暂时无法加载网站流量。');
    const data = await response.json();
    if (trafficRequest !== controller) return;
    renderTraffic(data, days);
    trafficLoaded = true;
    message.hidden = true;
    byId('traffic-content').hidden = false;
  } catch {
    if (trafficRequest === controller) message.textContent = '暂时无法加载网站流量，请刷新后重试。';
  } finally {
    clearTimeout(timeout);
    if (trafficRequest === controller) trafficRequest = undefined;
  }
}

function renderRows(container, rows) {
  const fragment = document.createDocumentFragment();
  for (const { first, second, code } of rows) {
    const row = document.createElement('div');
    row.className = 'admin-row';
    const name = document.createElement('strong');
    const note = document.createElement('span');
    name.textContent = first;
    note.textContent = second;
    row.append(name, note);
    if (code) {
      const button = document.createElement('button');
      button.className = 'button outline';
      button.textContent = '查看详情';
      button.addEventListener('click', () => inspect(code, true));
      row.append(button);
    }
    fragment.append(row);
  }
  container.replaceChildren(fragment);
  if (!rows.length) container.textContent = '暂无记录。';
}

function inspectionTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} 分${remainder ? ` ${remainder} 秒` : ''}`;
}

function inspect(code, focus = false) {
  selected = code;
  const room = rooms.find(item => item.code === code);
  if (!room) {
    byId('room-inspection').hidden = true;
    return;
  }
  byId('room-detail').textContent = `${room.code} · ${roomKinds[room.kind] ?? '双人房'} · ${watchStatuses[room.status]}`;
  byId('inspection-players').textContent = room.players.map(player => `${player.nickname || '游客'}（${roles[player.role]}）`).join('、');
  const remaining = Math.min(room.seconds, Math.ceil(room.remaining / 1000));
  const duration = room.remaining == null ? '' : ` · 剩余约 ${inspectionTime(remaining)}`;
  byId('inspection-time').textContent = `本局 ${inspectionTime(room.seconds)}${duration}`;
  byId('inspection-audience').textContent = `${room.viewers} 人旁观 · ${room.standby} 人候补`;
  const voiceOpen = room.voiceStatus === 'approved';
  const microphones = voiceOpen ? ` · ${room.microphones} 个麦克风已开启` : '';
  const relay = room.relayEnabled ? ' · 已启用兼容线路' : '';
  const sharing = room.publicAudio ? ' · 已公开旁听' : '';
  byId('inspection-voice').textContent = `${voiceStatuses[room.voiceStatus]}${microphones}${relay}${sharing}`;
  byId('room-inspection').hidden = false;
  if (focus) byId('room-inspection').scrollIntoView({ block: 'nearest' });
}

async function loadAdmin() {
  if (adminLoading) return;
  adminLoading = true;
  try {
    const response = await fetch('/api/admin', { signal: AbortSignal.timeout(8000) });
    if (response.status === 403) {
      byId('admin-content').hidden = true;
      adminUsers.reset();
      byId('admin-signin').hidden = sitesAuth;
      byId('admin-sites-signin').hidden = !sitesAuth;
      status(sitesAuth ? '请使用获授权的 ChatGPT 账号登录。' : '请登录管理后台。');
      return;
    }
    if (!response.ok) throw new Error('管理数据暂时无法加载。');
    const data = await response.json();
    byId('admin-content').hidden = false;
    byId('admin-signin').hidden = true;
    byId('admin-sites-signin').hidden = true;
    byId('admin-logout').hidden = sitesAuth;
    status(data.servicePaused ? '公开服务已暂停，管理后台可用。' : '');
    if (!adminUsers.loaded) adminUsers.search();
    if (!trafficLoaded && !trafficRequest) loadTraffic();
    rooms = data.rooms;
    byId('people-count').textContent = `${data.people.length} 位在线玩家`;
    byId('room-count').textContent = `${rooms.length} 间在线房间`;
    renderRows(byId('admin-people'), data.people.map(person => ({ first: person.nickname, second: person.status })));
    renderRows(byId('admin-rooms'), rooms.map(room => ({ code: room.code, first: `${room.code} · ${room.players.map(player => player.nickname || '游客').join(' / ')}`,
      second: watchStatuses[room.status] })));
    if (selected) inspect(selected);
  } catch (error) {
    status(error.message || '管理数据暂时无法加载。');
  } finally {
    adminLoading = false;
  }
}

reportToggle.addEventListener('click', () => {
  reportPanel.hidden = !reportPanel.hidden;
  reportToggle.setAttribute('aria-expanded', String(!reportPanel.hidden));
  reportToggle.textContent = reportPanel.hidden ? '查看举报' : '收起举报';
  if (!reportPanel.hidden) loadReports();
});
reportPrev.addEventListener('click', () => loadReports(reportPage - 1));
reportNext.addEventListener('click', () => loadReports(reportPage + 1));

byId('admin-refresh').addEventListener('click', () => {
  loadAdmin();
  if (!byId('admin-content').hidden) adminUsers.search();
  if (!byId('admin-content').hidden) loadReports();
  if (!byId('admin-content').hidden) loadTraffic();
});
byId('traffic-range').addEventListener('change', loadTraffic);
byId('admin-signin').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  submit.disabled = true;
  try {
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: form.elements.password.value }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error((await response.json()).error);
    form.reset();
    await loadAdmin();
  } catch (error) {
    status(error.message);
  } finally {
    submit.disabled = false;
  }
});
byId('admin-logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/admin/logout', { method: 'POST', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('无法退出登录。');
    location.reload();
  } catch (error) {
    status(error.message);
  }
});
setInterval(() => { if (!byId('admin-content').hidden) loadAdmin(); }, 8000);
loadAdmin();
