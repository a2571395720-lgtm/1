const result = document.getElementById('result');
window.applicationBrowser.onState((state) => {
  document.getElementById('address').textContent = state.url || '正在打开招聘页面…';
  if (state.message) result.textContent = state.message;
});
for (const button of document.querySelectorAll('button')) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const response = await window.applicationBrowser.action(button.id);
      if (response?.message) result.textContent = response.message;
    } catch (error) { result.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
    finally { button.disabled = false; }
  });
}
