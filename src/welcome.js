document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('closeTab').addEventListener('click', () => {
  window.close();
});
