/* PETO — idioma del sitio público petofinanzas: español por defecto, italiano opcional.
   Patrón: cada página define window.PETO_TEXTOS = { es: {...}, it: {...} } en un
   script en línea ANTES de cargar este archivo, y marca sus textos con
   data-i18n="clave" (contenido) y data-i18n-attr="placeholder:clave;alt:clave2"
   (atributos). Las claves especiales __title y __desc traducen el <title> y la
   meta description. La elección se guarda en localStorage ('peto-lang') y se
   comparte entre la portada y las calculadoras. */
(function () {
  'use strict';

  var CLAVE = 'peto-lang';
  var TEXTOS = window.PETO_TEXTOS || {};

  function idiomaGuardado() {
    try {
      return localStorage.getItem(CLAVE) === 'it' ? 'it' : 'es';
    } catch (e) {
      return 'es';
    }
  }

  function aplicar(lang) {
    var d = TEXTOS[lang];
    if (!d) return;
    window.PETO_LANG = lang;
    document.documentElement.lang = lang;
    if (d.__title) document.title = d.__title;
    if (d.__desc) {
      var m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', d.__desc);
    }
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var k = els[i].getAttribute('data-i18n');
      if (d[k] != null) els[i].innerHTML = d[k];
    }
    var conAttr = document.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < conAttr.length; j++) {
      var pares = conAttr[j].getAttribute('data-i18n-attr').split(';');
      for (var p = 0; p < pares.length; p++) {
        var partes = pares[p].split(':');
        if (partes.length === 2 && d[partes[1]] != null) {
          conAttr[j].setAttribute(partes[0], d[partes[1]]);
        }
      }
    }
    var botones = document.querySelectorAll('[data-lang-btn]');
    for (var b = 0; b < botones.length; b++) {
      var activo = botones[b].getAttribute('data-lang-btn') === lang;
      if (activo) botones[b].classList.add('activo'); else botones[b].classList.remove('activo');
      botones[b].setAttribute('aria-pressed', activo ? 'true' : 'false');
    }
  }

  function cambiar(lang) {
    var l = lang === 'it' ? 'it' : 'es';
    try { localStorage.setItem(CLAVE, l); } catch (e) { /* sin almacenamiento: se aplica igual */ }
    aplicar(l);
  }

  window.PETO_idioma = function () { return window.PETO_LANG || idiomaGuardado(); };
  window.PETO_cambiarIdioma = cambiar;

  function iniciar() {
    var botones = document.querySelectorAll('[data-lang-btn]');
    for (var b = 0; b < botones.length; b++) {
      botones[b].addEventListener('click', function () {
        cambiar(this.getAttribute('data-lang-btn'));
      });
    }
    aplicar(idiomaGuardado());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
