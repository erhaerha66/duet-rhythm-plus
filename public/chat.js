import { addQuickPhrases } from './quick-phrases.js';

export class RoomChat {
  constructor(element, send) {
    this.element = element;
    this.send = send;
    element.innerHTML = `<h3>房间公屏</h3>
      <ol class="chat-log" role="log" aria-label="公屏消息" tabindex="0"></ol>
      <p class="chat-empty">暂无消息。</p>
      ${send ? `<form class="chat-form">
        <p class="chat-visibility" aria-live="polite"></p>
        <div class="chat-compose"><input type="text" maxlength="200" aria-label="输入文字消息" placeholder="输入文字消息" required autocomplete="off" enterkeyhint="send">
        <button type="submit" class="button primary">发送</button></div>
        <p class="chat-error" role="status" hidden></p>
      </form>` : ''}`;
    this.log = element.querySelector('.chat-log');
    this.empty = element.querySelector('.chat-empty');
    this.form = element.querySelector('form');
    if (this.form) {
      this.field = this.form.querySelector('input');
      this.button = this.form.querySelector('button');
      addQuickPhrases(this.form, this.field);
      this.error = this.form.querySelector('.chat-error');
      this.visibility = this.form.querySelector('.chat-visibility');
      this.form.addEventListener('submit', event => {
        event.preventDefault();
        event.stopPropagation();
        this.submit();
      });
    }
  }

  async submit() {
    const message = this.field.value.trim();
    if (!message || this.button.disabled || this.element.hidden) return;
    const pending = this.pending?.message === message ? this.pending
      : { message, messageId: crypto.randomUUID(), public: this.public };
    this.pending = pending;
    this.error.hidden = true;
    this.button.disabled = true;
    try {
      await this.send({ ...pending, public: pending.public && this.public });
      if (this.pending === pending) {
        this.pending = undefined;
        if (this.field.value.trim() === message) this.field.value = '';
      }
    } catch (error) {
      if (this.pending === pending) {
        this.error.textContent = error.name === 'TimeoutError' ? '发送超时，请重试。' : error.message;
        this.error.hidden = false;
      }
    } finally {
      this.button.disabled = false;
    }
  }

  accept(messages = [], controller = 0, { visible = true, public: shared = false, partnership } = {}) {
    this.element.hidden = !visible;
    if (this.form && this.partnership !== partnership) {
      this.partnership = partnership;
      this.pending = undefined;
      this.field.value = '';
      this.error.hidden = true;
    }
    if (this.form && this.public !== shared) {
      this.public = shared;
      this.visibility.textContent = shared ? '发到公屏，房内双方和观众可见。' : '当前仅房内双方可见。';
    }
    const follow = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
    const ids = new Set(messages.map(entry => entry.id));
    for (const row of [...this.log.children]) {
      if (ids.has(row.dataset.messageId)) ids.delete(row.dataset.messageId);
      else row.remove();
    }
    for (const entry of messages) {
      if (!ids.has(entry.id)) continue;
      const row = document.createElement('li');
      row.dataset.messageId = entry.id;
      const author = document.createElement('strong');
      author.textContent = entry.seat === controller ? '领拍者' : '跟拍者';
      if (this.form && !entry.public) author.textContent += ' · 仅双方';
      const content = document.createElement('p');
      content.textContent = entry.message;
      row.append(author, content);
      this.log.append(row);
    }
    this.log.hidden = messages.length === 0;
    this.empty.hidden = messages.length > 0;
    if (follow && this.log.lastElementChild) this.log.scrollTop = this.log.scrollHeight;
  }
}
