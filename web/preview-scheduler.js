// Debounce valid fitting edits. Never fills patient fields or triggers exports.
export function createPreviewScheduler({ snapshot, render, shouldRender = () => true, delay = 600,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null, version = 0;
  function cancel() { version++; clearTimer(timer); timer = null; }
  function schedule() {
    cancel();
    let key;
    try { key = snapshot(); } catch { return; }
    const token = version;
    timer = setTimer(() => {
      timer = null;
      if (token !== version) return;
      try { if (snapshot() !== key || !shouldRender()) return; } catch { return; }
      void render();
    }, delay);
  }
  return { schedule, cancel };
}
