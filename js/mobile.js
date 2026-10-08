/**
 * Controles móviles (iPhone 14) + Gamepad Bluetooth
 * Joystick virtual, mirada por arrastre, botones on-screen, Gamepad API.
 */

/** Dimensiones lógicas iPhone 14 (CSS px, portrait) */
export const IPHONE14 = {
  w: 390,
  h: 844,
  dpr: 3,
  // safe-area aproximada notch + home indicator
  safeTop: 47,
  safeBottom: 34,
};

export class MobileControls {
  constructor(game) {
    this.game = game;
    this.iphoneMode = false;
    this.bluetoothEnabled = false;
    this.gamepadConnected = false;
    this.gamepadIndex = null;
    this.gamepadSupport = typeof navigator !== 'undefined' && 'getGamepads' in navigator;

    // Virtual stick state (normalized -1..1)
    this.moveX = 0;
    this.moveY = 0;
    this.aimDX = 0; // look delta this frame (screen px)
    this.aimDY = 0;
    this.lookActive = false;

    // Button latches
    this.handbrake = false;
    this._enterPressed = false;
    this._pausePressed = false;
    this._powerFire = false; // TK hold / trigger
    this._powerFireEdge = false;
    this._powerReleaseEdge = false;

    this._joyActive = false;
    this._joyId = null;
    this._lookId = null;
    this._joyOrigin = { x: 0, y: 0 };
    this._lookLast = { x: 0, y: 0 };
    this._aimWorldSet = false;
    this._prevButtons = [];
    this._gpAimX = null;
    this._gpAimY = null;
    this._deadzone = 0.18;
    this._lookSens = 4.2;
    this._gpLookSens = 280; // world units / sec at full stick

    this._els = {};
    this._bound = false;

    // Nuevos: cámara táctil, atrapar/redirigir, fuerza, gatillos
    this.lookDX = 0;         // px de arrastre acumulados (cámara)
    this.lookDY = 0;
    this._lookStart = { x: 0, y: 0, t: 0, moved: 0 };
    this._catchHold = false;
    this._redirectHold = false;
    this._resetPressed = false;
    this._gpAimX = 0;        // stick derecho (analógico, -1..1)
    this._gpAimY = 0;
  }

  /** Call after DOM ready */
  init() {
    if (this._bound) return;
    this._bound = true;
    this._els = {
      touchHud: document.getElementById('touchHud'),
      joyBase: document.getElementById('joyBase'),
      joyKnob: document.getElementById('joyKnob'),
      lookZone: document.getElementById('lookZone'),
      btnEnter: document.getElementById('touchEnter'),
      btnBrake: document.getElementById('touchBrake'),
      btnPause: document.getElementById('touchPause'),
      btnFire: document.getElementById('touchFire'),
      btnCatch: document.getElementById('touchCatch'),
      btnRedirect: document.getElementById('touchRedirect'),
      btnReset: document.getElementById('touchReset'),
      forceTouch: document.getElementById('touchForce'),
      gpStatus: document.getElementById('gpStatus'),
      frame: document.getElementById('iphoneFrame'),
      app: document.getElementById('app'),
      optIphone: document.getElementById('optIphone'),
      optBluetooth: document.getElementById('optBluetooth'),
    };

    this._bindTouch();
    this._bindGamepadEvents();
    this._bindMenuToggles();
    this._bindTouchButtons();

    // Auto-sugerir UI móvil en pantallas angostas
    this._autoSuggest = window.matchMedia('(max-width: 430px)');
    const applyAuto = () => {
      if (this._autoSuggest.matches && !this._userForcedDesktop) {
        if (!this.iphoneMode) this.setIphoneMode(true, { silent: true, fromAuto: true });
      }
    };
    this._autoSuggest.addEventListener?.('change', applyAuto);
    applyAuto();

    this._updateStatusUi();
  }

  _bindMenuToggles() {
    const iphoneBtn = document.getElementById('btnIphoneMode');
    const btBtn = document.getElementById('btnBluetooth');
    if (iphoneBtn) {
      iphoneBtn.addEventListener('click', () => {
        this._userForcedDesktop = this.iphoneMode; // if turning off, remember
        this.setIphoneMode(!this.iphoneMode);
        if (window.sfx?.ui) {/* optional */}
      });
    }
    if (btBtn) {
      btBtn.addEventListener('click', () => {
        this.setBluetoothEnabled(!this.bluetoothEnabled);
      });
    }
    // Settings checkboxes if present
    if (this._els.optIphone) {
      this._els.optIphone.addEventListener('change', () => {
        this._userForcedDesktop = !this._els.optIphone.checked;
        this.setIphoneMode(this._els.optIphone.checked);
      });
    }
    if (this._els.optBluetooth) {
      this._els.optBluetooth.addEventListener('change', () => {
        this.setBluetoothEnabled(this._els.optBluetooth.checked);
      });
    }
  }

  setIphoneMode(on, { silent = false, fromAuto = false } = {}) {
    this.iphoneMode = !!on;
    document.body.classList.toggle('iphone-mode', this.iphoneMode);
    document.getElementById('btnIphoneMode')?.classList.toggle('active', this.iphoneMode);
    if (this._els.optIphone) this._els.optIphone.checked = this.iphoneMode;
    if (this._els.touchHud) {
      this._els.touchHud.classList.toggle('hidden', !this.iphoneMode);
    }
    // Resize canvas to logical iPhone viewport when framed on desktop
    this.game?._resize?.();
    const inGame = !document.getElementById('gameScreen')?.classList.contains('hidden');
    document.getElementById('iphoneFrame')?.classList.toggle('hidden', !(this.iphoneMode && inGame));
    this._syncTouchVisibility();
    this._updateStatusUi();
    if (!silent && !fromAuto) {
      const hint = document.getElementById('hintMenu');
      if (hint) {
        hint.textContent = this.iphoneMode
          ? 'Modo iPhone 14 · joystick + mirada táctil · 1–5 poderes'
          : 'WASD mover · Mouse apuntar · 1–5 poderes · Espacio pausa';
      }
    }
  }

  setBluetoothEnabled(on) {
    this.bluetoothEnabled = !!on;
    document.body.classList.toggle('bluetooth-on', this.bluetoothEnabled);
    document.getElementById('btnBluetooth')?.classList.toggle('active', this.bluetoothEnabled);
    if (this._els.optBluetooth) this._els.optBluetooth.checked = this.bluetoothEnabled;
    if (this.bluetoothEnabled && this.gamepadSupport) {
      this._scanGamepads();
    } else if (!this.bluetoothEnabled) {
      this.gamepadConnected = false;
      this.gamepadIndex = null;
    }
    this._syncTouchVisibility();
    this._updateStatusUi();
  }

  _syncTouchVisibility() {
    const hud = this._els.touchHud;
    if (!hud) return;
    // Show touch HUD only in iPhone mode; dim sticks when gamepad connected + bluetooth on
    const show = this.iphoneMode;
    hud.classList.toggle('hidden', !show);
    const dim = this.bluetoothEnabled && this.gamepadConnected;
    hud.classList.toggle('dimmed', dim);
  }

  _updateStatusUi() {
    const el = this._els.gpStatus;
    if (!el) return;
    if (!this.bluetoothEnabled) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    if (!this.gamepadSupport) {
      el.textContent = 'Gamepad no disponible';
      el.classList.add('warn');
      el.classList.remove('ok');
      return;
    }
    if (this.gamepadConnected) {
      el.textContent = 'Control conectado';
      el.classList.add('ok');
      el.classList.remove('warn');
    } else {
      el.textContent = 'Sin control';
      el.classList.add('warn');
      el.classList.remove('ok');
    }
  }

  _bindTouchButtons() {
    const press = (el, onDown, onUp) => {
      if (!el) return;
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('pressed');
        onDown?.();
      };
      const up = (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('pressed');
        onUp?.();
      };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
      el.addEventListener('mousedown', down);
      el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', up);
    };

    press(this._els.btnEnter, () => { this._enterPressed = true; });
    press(this._els.btnBrake, () => { this.handbrake = true; }, () => { this.handbrake = false; });
    press(this._els.btnPause, () => { this._pausePressed = true; });
    press(this._els.btnFire, () => {
      this._powerFire = true;
      this._powerFireEdge = true;
    }, () => {
      this._powerFire = false;
      this._powerReleaseEdge = true;
    });

    press(this._els.btnCatch, () => { this._catchHold = true; }, () => { this._catchHold = false; });
    press(this._els.btnRedirect, () => { this._redirectHold = true; }, () => { this._redirectHold = false; });
    press(this._els.btnReset, () => { this._resetPressed = true; });
    if (this._els.forceTouch) {
      const f = this._els.forceTouch;
      const stop = (e) => e.stopPropagation();
      f.addEventListener('touchstart', stop, { passive: true });
      f.addEventListener('touchmove', stop, { passive: true });
      f.addEventListener('input', () => this.game?.setForce?.(+f.value / 100));
    }

    // Power buttons in touch bar (reuse #powerBar but also dedicated touchPower if present)
    document.querySelectorAll('[data-touch-power]').forEach(btn => {
      press(btn, () => {
        const i = +btn.dataset.touchPower;
        this.game?.ui?.onSelectPower?.(i);
      });
    });
  }

  _bindTouch() {
    const joy = this._els.joyBase;
    const look = this._els.lookZone;
    if (!joy || !look) return;

    const joyR = () => joy.getBoundingClientRect().width * 0.42;

    joy.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.changedTouches[0];
      this._joyActive = true;
      this._joyId = t.identifier;
      const r = joy.getBoundingClientRect();
      this._joyOrigin.x = r.left + r.width / 2;
      this._joyOrigin.y = r.top + r.height / 2;
      this._updateJoy(t.clientX, t.clientY, joyR());
    }, { passive: false });

    look.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.changedTouches[0];
      this.lookActive = true;
      this._lookId = t.identifier;
      this._lookLast.x = t.clientX;
      this._lookLast.y = t.clientY;
      this._lookStart = { x: t.clientX, y: t.clientY, t: performance.now(), moved: 0 };
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (!this.iphoneMode) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyId) {
          e.preventDefault();
          this._updateJoy(t.clientX, t.clientY, joyR());
        } else if (t.identifier === this._lookId) {
          e.preventDefault();
          const dx = t.clientX - this._lookLast.x;
          const dy = t.clientY - this._lookLast.y;
          this._lookLast.x = t.clientX;
          this._lookLast.y = t.clientY;
          // Arrastre = cámara (X gira, Y acerca/aleja la mira)
          this.lookDX += dx;
          this.lookDY += dy;
          this._lookStart.moved += Math.abs(dx) + Math.abs(dy);
        }
      }
    }, { passive: false });

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyId) {
          this._joyActive = false;
          this._joyId = null;
          this.moveX = 0;
          this.moveY = 0;
          this._els.joyKnob && (this._els.joyKnob.style.transform = 'translate(-50%, -50%)');
        }
        if (t.identifier === this._lookId) {
          // Toque corto sin arrastre = apuntar ahí
          const ls = this._lookStart;
          if (ls.moved < 10 && performance.now() - ls.t < 280) this._aimFromScreen(t.clientX, t.clientY);
          this.lookActive = false;
          this._lookId = null;
        }
      }
    };
    window.addEventListener('touchend', endTouch, { passive: false });
    window.addEventListener('touchcancel', endTouch, { passive: false });

    // Prevent document overscroll bounce
    document.addEventListener('touchmove', (e) => {
      if (this.iphoneMode && e.target.closest?.('#gameScreen')) e.preventDefault();
    }, { passive: false });
  }

  _updateJoy(cx, cy, maxR) {
    let dx = cx - this._joyOrigin.x;
    let dy = cy - this._joyOrigin.y;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, maxR);
    dx = (dx / len) * clamped;
    dy = (dy / len) * clamped;
    this.moveX = dx / maxR;
    this.moveY = dy / maxR;
    if (this._els.joyKnob) {
      this._els.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
  }

  _aimFromScreen(clientX, clientY) {
    this.game?.aimFromScreen?.(clientX, clientY, true);
    this._aimWorldSet = true;
  }

  _bindGamepadEvents() {
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      this.gamepadConnected = true;
      this._syncTouchVisibility();
      this._updateStatusUi();
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
        this.gamepadConnected = false;
        this._scanGamepads();
      }
      this._syncTouchVisibility();
      this._updateStatusUi();
    });
  }

  _scanGamepads() {
    if (!this.gamepadSupport) return;
    const pads = navigator.getGamepads?.() || [];
    let found = null;
    for (const p of pads) {
      if (p) { found = p; break; }
    }
    this.gamepadConnected = !!found;
    this.gamepadIndex = found ? found.index : null;
  }

  /**
   * Called every frame from Game.update.
   * Merges touch + gamepad into game.keys / mouse / edges.
   * Returns consumed edges for enter/pause/fire.
   */
  poll(dt) {
    const out = {
      enter: false,
      pause: false,
      fireStart: false,
      fireRelease: false,
      handbrake: false,
      moveX: 0,
      moveY: 0,
      lookDX: 0,
      lookDY: 0,
      aimStickX: 0,
      aimStickY: 0,
      rt: 0,
      gpLT: 0,
      gpB: false,
      catchHold: false,
      redirectHold: false,
      reset: false,
      gamepadActive: false,
    };

    // Touch edges
    if (this._enterPressed) { out.enter = true; this._enterPressed = false; }
    if (this._pausePressed) { out.pause = true; this._pausePressed = false; }
    if (this._powerFireEdge) { out.fireStart = true; this._powerFireEdge = false; }
    if (this._powerReleaseEdge) { out.fireRelease = true; this._powerReleaseEdge = false; }
    if (this.handbrake) out.handbrake = true;

    if (this.iphoneMode) {
      out.moveX += this.moveX;
      out.moveY += this.moveY;
    }

    // Arrastre de cámara (táctil)
    if (this.iphoneMode) {
      out.lookDX = this.lookDX; out.lookDY = this.lookDY;
    }
    this.lookDX = 0; this.lookDY = 0;
    out.catchHold = this._catchHold;
    out.redirectHold = this._redirectHold;
    if (this._resetPressed) { out.reset = true; this._resetPressed = false; }

    out.fireHold = !!this._powerFire;

    // Gamepad
    if (this.bluetoothEnabled && this.gamepadSupport) {
      this._pollGamepad(dt, out);
    }

    // Clamp move
    const ml = Math.hypot(out.moveX, out.moveY);
    if (ml > 1) { out.moveX /= ml; out.moveY /= ml; }

    return out;
  }

  _pollGamepad(dt, out) {
    const pads = navigator.getGamepads?.() || [];
    let gp = null;
    if (this.gamepadIndex != null) gp = pads[this.gamepadIndex];
    if (!gp) {
      for (const p of pads) if (p) { gp = p; break; }
    }
    const was = this.gamepadConnected;
    this.gamepadConnected = !!gp;
    if (gp) this.gamepadIndex = gp.index;
    if (was !== this.gamepadConnected) {
      this._syncTouchVisibility();
      this._updateStatusUi();
    }
    if (!gp) return;

    const dz = this._deadzone;
    const axis = (i) => {
      const v = gp.axes[i] || 0;
      return Math.abs(v) < dz ? 0 : v;
    };

    // Left stick: move / drive
    const lx = axis(0);
    const ly = axis(1);
    out.moveX += lx;
    out.moveY += ly;

    // Right stick: mover la mira relativo a la cámara (lo integra el juego)
    out.aimStickX = axis(2);
    out.aimStickY = axis(3);
    out.gamepadActive = true;

    const btn = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    const prev = this._prevButtons;
    const edge = (i) => btn(i) && !prev[i];

    // Standard mapping (Xbox / many Bluetooth pads on iOS):
    // 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Select, 9 Start, 10 L3, 11 R3
    // Face: A=interact/enter, B=handbrake, X/Y=cycle powers or fire
    if (edge(0)) out.enter = true;           // A — entrar/salir auto
    if (btn(1)) out.gpB = true;              // B — freno de mano (auto) / redirigir (a pie)
    if (edge(2)) this._selectPowerDelta(-1); // X — poder anterior
    if (edge(3)) this._selectPowerDelta(1);  // Y — poder siguiente
    if (edge(9) || edge(8)) out.pause = true; // Start / Select — pausa

    // Shoulders / triggers: TK grab (RT) + brake feel (LT)
    const rt = gp.buttons[7]?.value || (btn(7) ? 1 : 0);
    const lt = gp.buttons[6]?.value || (btn(6) ? 1 : 0);
    if (rt > 0.4) {
      if (!(prev[7] > 0.4)) out.fireStart = true;
      out.fireHold = true;
      this._powerFire = true;
    } else if (this._powerFire && (prev[7] > 0.4 || prev._rt)) {
      out.fireRelease = true;
      out.fireHold = false;
      this._powerFire = false;
    }
    out.rt = rt;
    out.gpLT = lt;                           // LT — freno de mano (auto) / atrapar (a pie)

    // D-pad: poderes 1-4; mientras cargas/sostienes, ↑/↓ ajustan la fuerza
    const charging = !!(this.game?.powers?.charging || this.game?.powers?.grabbed);
    if (charging) {
      if (edge(12)) this.game?.setForce?.((this.game.powers.force || 0.6) + 0.1);
      if (edge(13)) this.game?.setForce?.((this.game.powers.force || 0.6) - 0.1);
    } else {
      if (edge(12)) this.game?.selectPower?.(0); // up
      if (edge(13)) this.game?.selectPower?.(1); // down
    }
    if (edge(14)) this.game?.selectPower?.(2); // left
    if (edge(15)) this.game?.selectPower?.(3); // right
    if (edge(10)) this.game?.cycleForcePreset?.(); // L3 — preset de fuerza
    if (edge(11)) out.reset = true;              // R3 — restablecer cámara / auto
    if (edge(5)) this.game?.selectPower?.(4);  // RB — escudo

    // LB quick fire pulse for non-TK
    if (edge(4)) out.fireStart = true;

    this._prevButtons = gp.buttons.map(b => (b.value != null ? b.value : (b.pressed ? 1 : 0)));
    this._prevButtons._rt = rt;
  }

  _selectPowerDelta(d) {
    const g = this.game;
    if (!g?.powers) return;
    const n = (g.powers.selected + d + 5) % 5;
    g.selectPower ? g.selectPower(n) : g.powers.select(n);
  }

  /** Inject movement into keys-like object for Player / vehicle */
  applyToKeys(keys, mobileOut) {
    // Clear synthetic keys we manage
    const synth = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
    // Don't wipe real keyboard — OR with mobile
    const mx = mobileOut.moveX;
    const my = mobileOut.moveY;
    const thr = 0.25;
    if (my < -thr) keys['w'] = true;
    if (my > thr) keys['s'] = true;
    if (mx < -thr) keys['a'] = true;
    if (mx > thr) keys['d'] = true;
    if (mobileOut.handbrake) keys['shift'] = true;
  }

  /** Get canvas size for iPhone mode framing */
  getCanvasSize() {
    if (!this.iphoneMode) {
      return { w: window.innerWidth, h: window.innerHeight };
    }
    // On a real narrow phone, use full visual viewport; on desktop preview, lock 390×844
    const vw = window.visualViewport?.width || window.innerWidth;
    const vh = window.visualViewport?.height || window.innerHeight;
    if (vw <= 430 && vh >= vw) {
      return { w: Math.floor(vw), h: Math.floor(vh) };
    }
    // Desktop preview: fixed iPhone 14 logical size
    return { w: IPHONE14.w, h: IPHONE14.h };
  }
}
