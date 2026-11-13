(() => {
  const messages = {
    start: ['首页主操作', '这里仅预览按钮与弹层样式，不会创建人生或跳过身份、家当选择。正式流程仍由 Canvas 客户端处理。'],
    sound: ['声音入口', '这是无声的视觉预览，没有新增或播放任何音乐、音效，也不会修改你已有的音量设置。'],
    achievements: ['成就入口', '这里只预览成就入口与弹层，不读取本机记录，也不制造解锁成就。'],
    stats: ['统计入口', '这里只预览统计入口与弹层，不读取本机人生记录，也不显示虚构统计数据。'],
  };
  const dialog = document.createElement('dialog');
  dialog.className = 'preview-dialog';
  dialog.setAttribute('aria-labelledby', 'preview-dialog-title');
  const title = document.createElement('h2');
  title.id = 'preview-dialog-title';
  const description = document.createElement('p');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '返回预览';
  dialog.append(title, description, close);
  document.body.append(dialog);
  let opener = null;
  for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => {
      const message = messages[button.dataset.action];
      if (!message) return;
      opener = button;
      title.textContent = message[0];
      description.textContent = message[1];
      dialog.showModal();
      close.focus({ preventScroll: true });
    });
  }
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener?.focus({ preventScroll: true }));
})();
