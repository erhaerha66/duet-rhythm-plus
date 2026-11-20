const defaultPhrases = ['你好，准备好了吗？', '请慢一点', '暂停一下', '可以继续了'];
const phraseKey = 'jianke-quick-phrases';

export function addQuickPhrases(form, field) {
  let phrases = defaultPhrases;
  try {
    const saved = JSON.parse(localStorage.getItem(phraseKey));
    if (Array.isArray(saved)) phrases = saved.filter(phrase => typeof phrase === 'string' && phrase.length <= 40).slice(0, 6);
  } catch {}
  const panel = document.createElement('details');
  panel.className = 'quick-phrases';
  panel.innerHTML = `<summary>快捷语</summary><div class="quick-phrase-buttons"></div>
    <details><summary>编辑快捷语</summary>
      <label class="field">每行一句，最多 6 句，每句最多 40 字
        <textarea rows="4" maxlength="245"></textarea>
      </label>
      <button class="button outline" type="button">保存快捷语</button>
      <p role="status" class="quick-phrase-status"></p>
    </details>`;
  const buttons = panel.querySelector('.quick-phrase-buttons');
  const editor = panel.querySelector('textarea');
  const status = panel.querySelector('[role="status"]');
  function paint() {
    buttons.replaceChildren(...phrases.map(phrase => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'button outline';
      choice.textContent = phrase;
      choice.addEventListener('click', () => {
        if (field.disabled) return;
        field.value = phrase;
        field.focus();
      });
      return choice;
    }));
    editor.value = phrases.join('\n');
  }
  panel.querySelector('button').addEventListener('click', () => {
    const next = editor.value.split('\n').map(line => line.trim()).filter(Boolean);
    if (next.length > 6 || next.some(phrase => phrase.length > 40)) {
      status.textContent = '请保留最多 6 句，每句最多 40 字。';
      return;
    }
    phrases = [...new Set(next)];
    try {
      localStorage.setItem(phraseKey, JSON.stringify(phrases));
      status.textContent = '已保存。';
    } catch {
      status.textContent = '快捷语已应用到当前窗口。';
    }
    paint();
  });
  paint();
  form.querySelector('.chat-compose').before(panel);
}
