// macOS Window Dragging & Maximizing logic
let isDragging = false;
let currentWindow = null;
let offset = { x: 0, y: 0 };

function initDraggableWindows() {
  document.querySelectorAll('.mac-titlebar').forEach(bar => {
    bar.addEventListener('mousedown', (e) => {
      const win = bar.closest('.app-window');
      if (win.classList.contains('maximized')) return;
      isDragging = true;
      currentWindow = win;
      offset.x = e.clientX - win.offsetLeft;
      offset.y = e.clientY - win.offsetTop;
      bringToFront(win);
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !currentWindow) return;
    currentWindow.style.left = `${e.clientX - offset.x}px`;
    currentWindow.style.top = `${e.clientY - offset.y}px`;
    currentWindow.style.transform = 'none';
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    currentWindow = null;
  });
}

function bringToFront(win) {
  document.querySelectorAll('.app-window').forEach(w => w.style.zIndex = '100');
  win.style.zIndex = '150';
}

function toggleMaximize(id) {
  const win = document.getElementById(id);
  if (!win) return;
  win.classList.toggle('maximized');
  if (win.classList.contains('maximized')) {
    win.style.top = '36px';
    win.style.left = '0';
    win.style.width = '100%';
    win.style.height = 'calc(100% - 36px)';
  } else {
    win.style.top = '';
    win.style.left = '';
    win.style.width = '';
    win.style.height = '';
  }
}
