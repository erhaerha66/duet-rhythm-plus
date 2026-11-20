import { genders, roles, voicePreferences } from './preferences.js';

const date = time => time ? new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '无记录';
const statuses = { friend: '好友', sent: '已发申请', received: '收到申请' };
const outcomes = { completed: '已完成', ended: '提前结束', interrupted: '中途退出', shutdown: '因停站中断' };
const reportStates = { pending: '待审核', dismissed: '已驳回', banned: '已封禁', revoked: '已解封' };

function element(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function textRows(items, label, fields) {
  const section = element('section');
  section.append(element('h4', label));
  if (!items.length) {
    section.append(element('p', '暂无记录。'));
    return section;
  }
  const list = element('ul');
  for (const item of items) list.append(element('li', fields(item).join(' · ')));
  section.append(list);
  return section;
}

async function adminData(url, signal) {
  const response = await fetch(url, { cache: 'no-store', signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '暂时无法读取用户数据。');
  return data;
}

export class AdminUsersView {
  constructor(panel) {
    this.form = panel.querySelector('form');
    this.list = panel.querySelector('.admin-user-list');
    this.status = panel.querySelector('.admin-user-status');
    this.detail = panel.querySelector('.admin-user-detail');
    this.more = panel.querySelector('[data-user-more]');
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.search();
    });
    this.more.addEventListener('click', () => this.loadUsers());
  }

  reset() {
    this.listRequest?.abort();
    this.detailRequest?.abort();
    this.listRequest = this.detailRequest = undefined;
    this.loaded = false;
    this.list.replaceChildren();
    this.detail.replaceChildren();
    this.detail.hidden = this.more.hidden = true;
    this.status.textContent = '';
  }

  search() {
    this.listRequest?.abort();
    this.list.replaceChildren();
    this.term = this.form.elements.q.value.trim();
    this.cursor = undefined;
    this.loadUsers();
  }

  async loadUsers() {
    const controller = new AbortController();
    this.listRequest = controller;
    this.loaded = true;
    this.more.hidden = true;
    this.status.textContent = '正在加载用户…';
    const requested = new URLSearchParams({ q: this.term });
    if (this.cursor) {
      requested.set('after', this.cursor.account);
      requested.set('at', this.cursor.activityAt);
    }
    try {
      const result = await adminData('/api/admin/users?' + requested, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
      if (this.listRequest !== controller) return;
      for (const user of result.items) {
        const row = element('div');
        row.className = 'admin-row';
        const name = element('strong', user.nickname);
        const last = element('span', date(user.activityAt));
        const button = element('button', '查看');
        button.type = 'button';
        button.className = 'button outline';
        button.setAttribute('aria-label', '查看 ' + user.nickname + ' 的数据');
        button.addEventListener('click', () => this.openUser(user.account));
        row.append(name, last, button);
        this.list.append(row);
      }
      this.cursor = result.items.at(-1) ?? this.cursor;
      this.more.hidden = !result.hasMore;
      this.more.textContent = '加载更多用户';
      this.status.textContent = result.indexing ? '部分仅绑定账号的用户正在整理，刷新后可继续查看。'
        : this.list.childElementCount ? '最近记录时间按北京时间显示。' : '没有匹配的用户。';
    } catch (error) {
      if (controller.signal.aborted || this.listRequest !== controller) return;
      this.status.textContent = error.name === 'TimeoutError' ? '查询超时，请重试。' : error.message;
      this.more.hidden = false;
      this.more.textContent = '重试';
    }
  }

  async openUser(account, before) {
    this.detailRequest?.abort();
    const controller = new AbortController();
    this.detailRequest = controller;
    const status = element('p', '正在读取用户数据…');
    status.setAttribute('role', 'status');
    this.detail.hidden = false;
    this.detail.replaceChildren(status);
    this.detail.scrollIntoView({ block: 'nearest' });
    try {
      const path = '/api/admin/users/' + encodeURIComponent(account) + (before ? '?before=' + before : '');
      const data = await adminData(path, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
      if (this.detailRequest !== controller) return;
      this.renderUser(data, before);
    } catch (error) {
      if (controller.signal.aborted || this.detailRequest !== controller) return;
      status.textContent = error.name === 'TimeoutError' ? '查询超时，请重试。' : error.message;
      const retry = element('button', '重试');
      retry.type = 'button';
      retry.className = 'button outline';
      retry.addEventListener('click', () => this.openUser(account, before));
      this.detail.append(retry);
    }
  }

  renderUser({ user, rounds, friends, reports, hasOlder }, before) {
    const heading = element('h3', user.nickname);
    const summary = element('p', `最近记录 ${date(user.activityAt)} · ${user.bound ? '已绑定账号' : '游客身份'} · ${user.voiceSample ? '有语音试听记录' : '无语音试听记录'}`);
    const id = element('code', user.account);
    const counts = element('p', `对局 ${user.rounds} 场 · 私信发送 ${user.messagesSent} 条，收到 ${user.messagesReceived} 条 · 举报发出 ${user.sentReports} 条，收到 ${user.receivedReports} 条`);
    const profile = element('p', user.profile ? ['停站前资料', genders[user.profile.gender], roles[user.profile.role], voicePreferences[user.profile.voice]].filter(Boolean).join(' · ') : '');
    const records = textRows(rounds, before ? '更早的对局记录' : '最近的对局记录', row => [
      row.partnerName, roles[row.role] ?? '未知角色', row.mode === 'match' ? '随机匹配' : '好友房',
      outcomes[row.outcome] ?? '已记录', `${Math.floor(row.elapsed / 1000)} 秒`, `双方记录 ${row.marks} / ${row.partnerMarks} 次`, date(row.endedAt)
    ]);
    if (hasOlder && rounds.length) {
      const more = element('button', '查看更早的对局');
      more.type = 'button';
      more.className = 'button outline';
      more.addEventListener('click', () => this.openUser(user.account, rounds.at(-1).seq));
      records.append(more);
    }
    if (before) {
      const latest = element('button', '回到最近对局');
      latest.type = 'button';
      latest.className = 'button outline';
      latest.addEventListener('click', () => this.openUser(user.account));
      records.append(latest);
    }
    this.detail.replaceChildren(heading, id, summary, counts, profile, records,
      textRows(friends, '好友关系', row => [row.nickname || '匿名玩家', statuses[row.status], date(row.createdAt)]),
      textRows(reports, '最近的举报', row => [
        row.direction === 'sent' ? '发出举报' : '被举报', row.targetName, row.reason, reportStates[row.status] ?? row.status, date(row.createdAt)
      ]));
  }
}
