/* ============================================================
   PETO Web — adaptaciones de navegador (se carga ANTES de app.js)

   La app original habla con lo nativo solo a través de
   capPlugin('Nombre'), que devuelve null si el plugin no existe,
   y cada función ya degrada sin romper (la huella se oculta, las
   notificaciones locales no se programan, el OCR no se intenta y
   compartir cae a navigator.share / portapapeles). Este archivo:

   1. Da voz en el navegador con la Web Speech API, exponiéndola
      con la MISMA interfaz que el plugin de Capacitor que app.js
      espera (available / checkPermissions / requestPermissions /
      start), así el dictado funciona en Chrome/Edge sin tocar
      app.js. Sin soporte, la app muestra «voz no disponible».
   2. Oculta en Ajustes lo que en web no aplica: notificaciones
      «con la app cerrada» y desbloqueo con huella (no hay plugin;
      el botón de huella de la pantalla de bloqueo ya se oculta
      solo porque BiometricAuth no existe).
   3. Pone una pastilla «🌐 Web» en la cabecera.
   4. Vigila las actualizaciones del service worker: si hay una
      versión nueva esperando, muestra una barra para actualizar
      con un toque (el SW de web NO es cache-first ciego como el
      de la app; ver sw.js). También busca actualizaciones al
      volver a la pestaña y cada 30 minutos.
   ============================================================ */
'use strict';

window.PETO_WEB = true;

/* ---------- 1. Voz con Web Speech API ---------- */
(function () {
  var NativeSR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  /* Si ya hubiera un Capacitor real con el plugin, no se pisa. */
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition) return;

  var speechPlugin = {
    available: function () {
      return Promise.resolve({ available: !!NativeSR });
    },
    checkPermissions: function () {
      return Promise.resolve({ speechRecognition: NativeSR ? 'granted' : 'denied' });
    },
    requestPermissions: function () {
      return Promise.resolve({ speechRecognition: NativeSR ? 'granted' : 'denied' });
    },
    start: function (opts) {
      return new Promise(function (resolve, reject) {
        if (!NativeSR) { reject(new Error('unavailable')); return; }
        var rec;
        try { rec = new NativeSR(); } catch (e) { reject(e); return; }
        rec.lang = (opts && opts.language) || 'es-US';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = function (ev) {
          var text = '';
          try { text = ev.results[0][0].transcript || ''; } catch (e) { /* sin texto */ }
          resolve({ matches: text ? [text] : [] });
        };
        rec.onerror = function (ev) { reject(new Error((ev && ev.error) || 'speech-error')); };
        rec.onend = function () { /* el resultado ya resolvió o rechazó */ };
        try { rec.start(); } catch (e) { reject(e); }
      });
    },
    stop: function () { return Promise.resolve(); }
  };

  window.Capacitor = window.Capacitor || {};
  window.Capacitor.Plugins = window.Capacitor.Plugins || {};
  window.Capacitor.Plugins.SpeechRecognition = speechPlugin;
})();

/* ---------- 2 y 3. Ajustes sin lo nativo + pastilla Web ---------- */
document.addEventListener('DOMContentLoaded', function () {
  ['set-notifications', 'set-biometric'].forEach(function (id) {
    var input = document.getElementById(id);
    if (!input) return;
    var label = input.closest ? input.closest('label') : null;
    if (label) {
      label.style.display = 'none';
      var next = label.nextElementSibling;
      if (next && next.tagName === 'P') next.style.display = 'none';
    }
  });

  var headerText = document.querySelector('.header-text');
  if (headerText && !document.getElementById('web-pill')) {
    var pill = document.createElement('span');
    pill.id = 'web-pill';
    pill.className = 'web-pill';
    pill.textContent = '🌐 Web';
    headerText.appendChild(pill);
  }
});

/* ---------- 4. Actualizaciones del service worker ---------- */
(function () {
  if (!('serviceWorker' in navigator)) return;
  var refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  function showUpdateBar(worker) {
    if (document.getElementById('sw-update-bar')) return;
    var es = ((document.documentElement.lang || 'es').indexOf('en') !== 0);
    var bar = document.createElement('div');
    bar.id = 'sw-update-bar';
    bar.className = 'sw-update-bar';
    var text = document.createElement('span');
    text.textContent = es ? 'Hay una versión nueva de PETO Web.' : 'A new version of PETO Web is available.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-small';
    btn.textContent = es ? 'Actualizar' : 'Update';
    btn.addEventListener('click', function () {
      try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { window.location.reload(); }
    });
    bar.appendChild(text);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  function watch(reg) {
    if (!reg) return;
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
    reg.addEventListener('updatefound', function () {
      var installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', function () {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBar(installing);
        }
      });
    });
  }

  navigator.serviceWorker.getRegistration().then(watch).catch(function () { /* sin SW */ });

  setInterval(function () {
    navigator.serviceWorker.getRegistration()
      .then(function (reg) { if (reg) return reg.update(); })
      .catch(function () { /* sin conexión: se ignora */ });
  }, 30 * 60 * 1000);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    navigator.serviceWorker.getRegistration()
      .then(function (reg) { if (reg) return reg.update(); })
      .catch(function () { /* sin conexión: se ignora */ });
  });
})();
