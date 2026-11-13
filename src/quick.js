'use strict';
// Quick Add: type a row and press Enter; it goes to the outline chosen below.
const host = window.api;
const text = document.getElementById('text'), target = document.getElementById('target'), msg = document.getElementById('msg');
const HINT = 'Enter adds the row. Shift+Enter adds it and keeps this open. Esc closes.';

async function load() {
  const info = await host.quickInfo();
  target.replaceChildren(...info.targets.map(t => new Option(t.label, t.key)));
  if (!info.targets.length) target.append(new Option('A new outline', ''));
  if (info.targets.some(t => t.key === info.last)) target.value = info.last;
  msg.textContent = info.error || HINT;
  msg.classList.toggle('warn', !!info.error);
  text.focus();
}
document.addEventListener('keydown', async e => {
  if (e.key === 'Escape') { e.preventDefault(); host.quickClose(); return; }
  if (e.key !== 'Enter' || e.target !== text) return;
  e.preventDefault();
  const t = text.value.trim(); if (!t) return;
  const r = await host.quickSubmit(t, target.value);
  if (!r.ok) { msg.textContent = 'Could not add the row: ' + r.error; msg.classList.add('warn'); return; }
  if (e.shiftKey) { text.value = ''; msg.textContent = `Added to ${r.label}. ${HINT}`; msg.classList.remove('warn'); }
  else host.quickClose();
});
load();
