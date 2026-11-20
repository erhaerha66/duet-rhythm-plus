import { roles } from './preferences.js';

const practiceKey = 'jianke-practice-history';
const outcomes = { completed: '已完成', ended: '提前结束', interrupted: '中途退出', shutdown: '因停站中断' };
const kinds = { friend: '好友房', match: '随机匹配', practice: '单人练习' };
const historyDate = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
});
let practiceRecords = [];
try {
  const saved = JSON.parse(localStorage.getItem(practiceKey));
  if (Array.isArray(saved)) practiceRecords = saved;
} catch {}

export function recordPractice(game, progress, now) {
  if (game.historySaved || progress.elapsed <= 0) return;
  game.historySaved = true;
  practiceRecords = [{
    elapsed: progress.elapsed, marks: game.marks[0].length, endedAt: now,
    mode: 'practice', outcome: progress.done ? 'completed' : 'interrupted'
  }, ...practiceRecords].slice(0, 300);
  try { localStorage.setItem(practiceKey, JSON.stringify(practiceRecords)); } catch {}
}

function historyDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} 分 ${seconds % 60} 秒` : seconds ? `${seconds} 秒` : '不足 1 秒';
}

export class HistoryView {
  constructor(element, request, addFriend) {
    this.element = element;
    this.request = request;
    this.addFriend = addFriend;
    this.list = element.querySelector('.history-list');
    this.status = element.querySelector('.history-status');
    this.searchForm = element.querySelector('form');
    this.search = this.searchForm.querySelector('input');
    this.more = element.querySelector('.history-more');
    this.tabs = [...element.querySelectorAll('[data-history]')];
    this.view = 'rounds';
    this.version = 0;
    for (const tab of this.tabs) tab.addEventListener('click', () => this.open(tab.dataset.history));
    this.searchForm.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      this.open(this.view);
    });
    this.more.addEventListener('click', () => this.load());
    element.querySelector('.history-retry').addEventListener('click', () => this.load());
  }

  open(view = this.view) {
    this.version += 1;
    this.loading = false;
    this.view = view;
    this.cursor = {};
    this.term = this.search.value.trim();
    this.list.replaceChildren();
    this.searchForm.hidden = view === 'practice';
    for (const tab of this.tabs) tab.setAttribute('aria-pressed', String(tab.dataset.history === view));
    return this.load();
  }

  async load() {
    if (this.loading) return;
    this.loading = true;
    const version = this.version;
    this.more.hidden = true;
    this.element.querySelector('.history-retry').hidden = true;
    this.status.textContent = '正在加载记录…';
    try {
      const { items, hasMore } = this.view === 'practice' ? { items: practiceRecords, hasMore: false }
        : await this.request({ view: this.view, search: this.term, ...this.cursor });
      if (this.version !== version) return;
      for (const item of items) this.list.append(this.row(item));
      const last = items[items.length - 1];
      if (last?.seq) this.cursor = { beforeAt: last.endedAt, beforeSeq: last.seq };
      this.more.hidden = !hasMore;
      this.status.textContent = this.list.childElementCount
        ? this.view === 'practice' ? '单人记录保存在当前浏览器。' : ''
        : this.term && this.view !== 'practice' ? '没有找到符合昵称的记录。' : '还没有记录。';
    } catch (error) {
      if (this.version !== version) return;
      this.status.textContent = error.message || '暂时无法加载记录。';
      this.element.querySelector('.history-retry').hidden = false;
    } finally {
      if (this.version === version) this.loading = false;
    }
  }

  friendButton(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button outline history-friend';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const labels = { friend: '已是好友', sent: '已发送好友申请', received: '对方已申请 · 去「我的好友」处理' };
    const paint = friendship => {
      button.textContent = labels[friendship] ?? '加好友';
      button.disabled = Object.hasOwn(labels, friendship);
    };
    paint(item.friendship);
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        const { friendship } = await this.addFriend(item.seq);
        paint(friendship);
      } catch (error) {
        button.disabled = false;
        status.textContent = ['TimeoutError', 'AbortError'].includes(error.name) ? '连接超时，请重试。' : error.message;
      }
    });
    const group = document.createElement('div');
    group.append(button, status);
    return group;
  }

  row(item) {
    const row = document.createElement('li');
    const title = document.createElement('strong');
    const details = document.createElement('p');
    title.textContent = item.partnerName ?? '单人练习';
    const timestamp = historyDate.format(item.endedAt);
    row.append(title);
    if (this.view === 'partners') details.textContent = `一起玩过 ${item.rounds} 局 · 最近 ${timestamp}`;
    else {
      const subtitle = document.createElement('p');
      subtitle.textContent = [timestamp, kinds[item.mode], roles[item.role], historyDuration(item.elapsed), outcomes[item.outcome]].filter(Boolean).join(' · ');
      row.append(subtitle);
      details.textContent = `我的停拍 ${item.marks} 次${item.partnerMarks == null ? '' : ` · 搭档停拍 ${item.partnerMarks} 次`}`;
    }
    row.append(details);
    if (item.friendship) row.append(this.friendButton(item));
    return row;
  }
}
