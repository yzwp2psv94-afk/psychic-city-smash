/** UI: menú, HUD, overlays */

import { POWERS } from './powers.js';
import { sfx, setSoundEnabled } from './audio.js';
import { touchText } from './mobile.js';

const isTouchUi = () => document.body.classList.contains('iphone-mode');

const MODE_LABELS = {
  sandbox: 'Sandbox libre',
  timed: 'Tiempo límite',
  duel: 'Pelea psíquica',
  survival: 'Supervivencia',
};

export class UI {
  constructor() {
    this.mode = 'sandbox';
    this.sound = true;
    this.shake = true;
    this._bind();
  }

  _bind() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.mode = btn.dataset.mode;
        sfx.ui();
      });
    });

    document.getElementById('btnSettings').onclick = () => {
      document.getElementById('menu').classList.add('hidden');
      document.getElementById('settings').classList.remove('hidden');
    };
    document.getElementById('btnSettingsBack').onclick = () => {
      document.getElementById('settings').classList.add('hidden');
      document.getElementById('menu').classList.remove('hidden');
      this.sound = document.getElementById('optSound').checked;
      this.shake = document.getElementById('optShake').checked;
      setSoundEnabled(this.sound);
    };

    document.querySelectorAll('.power-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.power;
        this.onSelectPower?.(i);
      });
    });

    // Device toggles play click sfx (state owned by MobileControls)
    document.getElementById('btnIphoneMode')?.addEventListener('click', () => sfx.ui());
    document.getElementById('btnBluetooth')?.addEventListener('click', () => sfx.ui());
  }

  showMenu() {
    document.getElementById('menu').classList.remove('hidden');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('settings').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('iphoneFrame')?.classList.add('hidden');
  }

  showGame() {
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('settings').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('hudMode').textContent = MODE_LABELS[this.mode] || this.mode;
    const timed = this.mode === 'timed';
    document.getElementById('hudTimerBox').classList.toggle('hidden', !timed);
    const frame = document.getElementById('iphoneFrame');
    if (frame) {
      const iphone = document.body.classList.contains('iphone-mode');
      frame.classList.toggle('hidden', !iphone);
    }
  }

  updateHud({ score, destroy, energy, maxEnergy, tip, timer, power }) {
    document.getElementById('hudScore').textContent = Math.floor(score);
    document.getElementById('hudDestroy').textContent = destroy + '%';
    document.getElementById('energyFill').style.width = `${(energy / maxEnergy) * 100}%`;
    if (tip != null) {
      const el = document.getElementById('hudTip');
      const touch = isTouchUi();
      const txt = touch ? touchText(tip) : tip;
      if (el.textContent !== txt) {
        el.textContent = txt;
        // En táctil el aviso aparece una vez y se desvanece
        if (touch && txt) { el.classList.remove('fade'); void el.offsetWidth; el.classList.add('fade'); }
      }
    }
    if (timer != null) {
      const m = Math.floor(timer / 60);
      const s = Math.floor(timer % 60);
      document.getElementById('hudTimer').textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }
    if (power != null) {
      document.querySelectorAll('.power-btn').forEach((b, i) => {
        b.classList.toggle('active', i === power);
      });
      document.querySelectorAll('[data-touch-power]').forEach((b) => {
        b.classList.toggle('active', +b.dataset.touchPower === power);
        if (+b.dataset.touchPower === power) b.style.borderColor = '#6c5ce7';
        else b.style.borderColor = '';
      });
      const p = POWERS[power];
      if (p && tip == null && !isTouchUi()) document.getElementById('hudTip').textContent = p.tip;
    }
  }

  /** Medidor de carga + nivel de fuerza */
  updateCharge({ charging, charge, force, kind, frozen, kmh }) {
    const el = this._chargeEl || (this._chargeEl = document.getElementById('chargeMeter'));
    if (!el) return;
    const fill = this._chargeFill || (this._chargeFill = document.getElementById('chargeFill'));
    const label = this._chargeLabel || (this._chargeLabel = document.getElementById('chargeLabel'));
    el.classList.toggle('active', !!charging);
    el.classList.toggle('full', !!charging && charge >= 1);
    fill.style.width = `${Math.round((charging ? charge : 0) * 100)}%`;
    const names = { tk: 'Lanzar', shock: 'Onda', crush: 'Aplastar', slam: 'Slam', redirect: 'Redirigir' };
    const txt = charging
      ? `${names[kind] || 'Carga'} ${Math.round(charge * 100)}% · Fuerza ${Math.round(force * 100)}%${kmh ? ` · ~${kmh} km/h` : ''}`
      : `Fuerza ${Math.round(force * 100)}%${frozen ? ` · 🧊 ${frozen} congelado(s)` : ''}`;
    if (label.textContent !== txt) label.textContent = txt;
    const pct = Math.round(force * 100);
    for (const id of ['forceSlider', 'touchForce']) {
      const s = document.getElementById(id);
      if (s && document.activeElement !== s && +s.value !== pct) s.value = pct;
    }
    const fv = document.getElementById('forceValue');
    if (fv && fv.textContent !== pct + '%') fv.textContent = pct + '%';
  }

  showPrompt(text, x, y) {
    const el = this._promptEl || (this._promptEl = document.getElementById('enterPrompt'));
    if (!el) return;
    if (text == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (el.textContent !== text) el.textContent = text;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  }

  showOverlay(title, msg, statsHtml, { showResume = true } = {}) {
    const ov = document.getElementById('overlay');
    ov.classList.remove('hidden');
    document.getElementById('overlayTitle').textContent = title;
    document.getElementById('overlayMsg').textContent = msg;
    document.getElementById('overlayStats').innerHTML = statsHtml;
    document.getElementById('btnResume').style.display = showResume ? '' : 'none';
    const endOv = document.getElementById('btnEndOv');
    if (endOv) endOv.style.display = showResume ? '' : 'none';
  }

  hideOverlay() {
    document.getElementById('overlay').classList.add('hidden');
  }
}

export { MODE_LABELS };
