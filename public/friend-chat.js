import { addQuickPhrases } from './quick-phrases.js';

export class FriendChat {
  constructor(element, request, newMessageId, onRead) {
    this.element = element;
    this.request = request;
    this.newMessageId = newMessageId;
    this.onRead = onRead;
    this.log = element.querySelector('.chat-log');
    this.status = element.querySelector('.friend-chat-status');
    this.older = element.querySelector('.friend-chat-older');
    this.form = element.querySelector('form');
    this.field = this.form.querySelector('input');
    this.button = this.form.querySelector('button');
    addQuickPhrases(this.form, this.field);
    this.older.addEventListener('click', () => this.refresh(true));
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      this.send();
    });
    this.refresh();
  }

  paint(messages, older = false) {
    const follow = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 32;
    const previousHeight = this.log.scrollHeight;
    const existing = new Set([...this.log.children].map(row => Number(row.dataset.seq)));
    for (const message of messages) {
      if (existing.has(message.seq)) continue;
      const row = document.createElement('li');
      row.dataset.seq = message.seq;
      row.classList.toggle('mine', message.mine);
      const author = document.createElement('strong');
      author.textContent = message.mine ? '我' : '好友';
      const time = document.createElement('time');
      time.dateTime = new Date(message.at).toISOString();
      time.textContent = new Date(message.at).toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const text = document.createElement('p');
      text.textContent = message.text;
      row.append(author, time, text);
      const following = [...this.log.children].find(child => Number(child.dataset.seq) > message.seq);
      this.log.insertBefore(row, following ?? null);
    }
    this.log.hidden = !this.log.childElementCount;
    if (older) this.log.scrollTop += this.log.scrollHeight - previousHeight;
    else if (follow) this.log.scrollTop = this.log.scrollHeight;
  }

  showError(error) {
    if (error.status === 403) {
      this.closed = true;
      this.log.replaceChildren();
      this.log.hidden = true;
      this.form.hidden = true;
      this.older.hidden = true;
    }
    this.status.textContent = ['TimeoutError', 'AbortError'].includes(error.name) ? '连接超时，请重试。' : error.message;
  }

  async refresh(older = false) {
    if (this.loading || this.closed || !this.element.isConnected || document.hidden) return;
    let first = Number(this.log.firstElementChild?.dataset.seq);
    if (older && !first) return;
    this.loading = true;
    this.older.disabled = true;
    try {
      const { messages, hasOlder } = await this.request('friend-chat', older ? { before: first } : {});
      if (this.closed || !this.element.isConnected) return;
      if (!older && hasOlder && messages[0]?.seq > Number(this.log.lastElementChild?.dataset.seq)) {
        this.log.replaceChildren();
        first = 0;
      }
      this.paint(messages, older);
      if (older || !first) this.older.hidden = !hasOlder;
      if (!this.ready) {
        this.ready = true;
        this.button.disabled = false;
        this.field.disabled = false;
      }
      if (!this.pending) this.status.textContent = this.log.hidden ? '还没有私信。' : '';
      if (!older) this.onRead();
    } catch (error) {
      if (!this.closed && this.element.isConnected) this.showError(error);
    } finally {
      this.loading = false;
      this.older.disabled = false;
    }
  }

  async send() {
    const message = this.field.value.trim();
    if (!message || this.button.disabled || this.closed) return;
    const pending = this.pending?.message === message ? this.pending : { message, messageId: this.newMessageId() };
    this.pending = pending;
    this.button.disabled = true;
    this.status.textContent = '';
    try {
      const sent = await this.request('friend-message', pending);
      this.pending = undefined;
      if (this.closed || !this.element.isConnected) return;
      this.paint([sent.message]);
      this.log.scrollTop = this.log.scrollHeight;
      if (this.field.value.trim() === message) this.field.value = '';
    } catch (error) {
      if (!this.closed && this.element.isConnected) this.showError(error);
    } finally {
      this.button.disabled = false;
    }
  }
}
