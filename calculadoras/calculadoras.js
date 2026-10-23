/* PETO — calculadoras públicas de petofinanzas. Sin servidor: todo se calcula en el navegador.
   Los textos de resultados y errores salen del diccionario CT según el idioma del
   sitio (localStorage 'peto-lang', el mismo que usa i18n.js; español por defecto).
   El formato de moneda es idéntico en ambos idiomas para que los números no cambien. */
(function () {
  'use strict';

  var CT = {
    es: {
      mes: 'mes', meses: 'meses', dia: 'día', dias: 'días',
      turno: 'Turno', th_fecha: 'Fecha', th_recibe: 'Recibe',
      err_deuda_num: 'Revisa los números: monto, interés (puede ser 0) y pago mensual deben ser válidos.',
      err_deuda_int_a: 'Con ese pago mensual no cubres ni los intereses del primer mes (',
      err_deuda_int_b: '): la deuda crecería en vez de bajar. Sube el pago o negocia la deuda.',
      err_deuda_100: 'Con ese pago tardarías más de 100 años. Sube el pago mensual.',
      res_deuda_a: 'Saldarías esta deuda en ',
      res_deuda_int: 'Total de intereses: ',
      res_deuda_total: 'Total pagado al final: ',
      res_deuda_nota: 'En PETO anotas la deuda una vez y la app sigue tu avance pago a pago.',
      err_san_num: 'Revisa los números: el aporte debe ser mayor que 0 y los participantes al menos 2.',
      res_san_a: 'Cada turno entrega ',
      res_san_total_a: 'Cada participante aporta en total ',
      res_san_total_b: ' durante el ciclo (',
      res_san_total_c: ' rondas) y recibe ese mismo fondo en su turno.',
      res_san_nota: 'En PETO llevas quién ya pagó cada ronda y te avisa cuando te toca.',
      err_dia_num: 'Revisa los números: presupuesto mayor que 0, gasto de 0 en adelante, y un día válido dentro del mes.',
      res_dia_cero_a: 'Ya alcanzaste tu presupuesto del mes: ',
      res_dia_cero_dia: '$0 por día',
      res_dia_cero_b: 'Te pasaste por ',
      res_dia_cero_c: '. En PETO este número se actualiza solo con cada gasto que anotas.',
      res_dia_a: 'Puedes gastar ',
      res_dia_b: ' por día',
      res_dia_quedan: 'Te quedan ',
      res_dia_para: ' para los ',
      res_dia_faltan: ' que faltan del mes (contando hoy).',
      res_dia_nota: 'En PETO este número vive en tu pantalla principal y se mueve con cada gasto.'
    },
    it: {
      mes: 'mese', meses: 'mesi', dia: 'giorno', dias: 'giorni',
      turno: 'Turno', th_fecha: 'Data', th_recibe: 'Riceve',
      err_deuda_num: 'Controlla i numeri: importo, interesse (può essere 0) e pagamento mensile devono essere validi.',
      err_deuda_int_a: 'Con quel pagamento mensile non copri nemmeno gli interessi del primo mese (',
      err_deuda_int_b: '): il debito crescerebbe invece di diminuire. Aumenta il pagamento o rinegozia il debito.',
      err_deuda_100: 'Con quel pagamento ci metteresti più di 100 anni. Aumenta il pagamento mensile.',
      res_deuda_a: 'Estingueresti questo debito in ',
      res_deuda_int: 'Totale interessi: ',
      res_deuda_total: 'Totale pagato alla fine: ',
      res_deuda_nota: 'In PETO annoti il debito una volta sola e l\'app segue i tuoi progressi pagamento dopo pagamento.',
      err_san_num: 'Controlla i numeri: il contributo deve essere maggiore di 0 e i partecipanti almeno 2.',
      res_san_a: 'Ogni turno consegna ',
      res_san_total_a: 'Ogni partecipante versa in totale ',
      res_san_total_b: ' durante il ciclo (',
      res_san_total_c: ' turni) e riceve lo stesso fondo al suo turno.',
      res_san_nota: 'In PETO tieni traccia di chi ha già pagato ogni turno e ti avvisa quando tocca a te.',
      err_dia_num: 'Controlla i numeri: budget maggiore di 0, spesa da 0 in su e un giorno valido dentro il mese.',
      res_dia_cero_a: 'Hai già raggiunto il tuo budget del mese: ',
      res_dia_cero_dia: '$0 al giorno',
      res_dia_cero_b: 'Hai sforato di ',
      res_dia_cero_c: '. In PETO questo numero si aggiorna da solo con ogni spesa che annoti.',
      res_dia_a: 'Puoi spendere ',
      res_dia_b: ' al giorno',
      res_dia_quedan: 'Ti restano ',
      res_dia_para: ' per i ',
      res_dia_faltan: ' che mancano alla fine del mese (contando oggi).',
      res_dia_nota: 'In PETO questo numero vive nella tua schermata principale e si muove con ogni spesa.'
    }
  };

  function idioma() {
    try {
      return localStorage.getItem('peto-lang') === 'it' ? 'it' : 'es';
    } catch (e) {
      return 'es';
    }
  }
  function t(k) { return CT[idioma()][k]; }

  var fmt = new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' });

  function num(id) {
    var v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? NaN : v;
  }
  function mostrar(id, html) {
    var r = document.getElementById(id);
    r.innerHTML = html;
    r.classList.add('visible');
  }
  function error(id, msg) {
    mostrar(id, '<span class="error">' + msg + '</span>');
  }

  /* ---------- Deudas: amortización mes a mes ---------- */
  function calcularDeuda(ev) {
    ev.preventDefault();
    var monto = num('d-monto'), anual = num('d-interes'), pago = num('d-pago');
    var R = 'd-resultado';
    if (!(monto > 0) || !(anual >= 0) || !(pago > 0)) {
      error(R, t('err_deuda_num'));
      return;
    }
    var r = anual / 100 / 12;
    if (r > 0 && pago <= monto * r) {
      error(R, t('err_deuda_int_a') + fmt.format(monto * r) + t('err_deuda_int_b'));
      return;
    }
    var saldo = monto, meses = 0, intereses = 0, ultimoPago = 0;
    while (saldo > 0 && meses < 1200) {
      var interesMes = saldo * r;
      intereses += interesMes;
      saldo += interesMes;
      var abono = Math.min(pago, saldo);
      ultimoPago = abono;
      saldo -= abono;
      meses++;
    }
    if (meses >= 1200) {
      error(R, t('err_deuda_100'));
      return;
    }
    var totalPagado = pago * (meses - 1) + ultimoPago;
    mostrar(R,
      '<p>' + t('res_deuda_a') + '<span class="cifra">' + meses + (meses === 1 ? ' ' + t('mes') : ' ' + t('meses')) + '</span></p>' +
      '<p>' + t('res_deuda_int') + '<strong>' + fmt.format(intereses) + '</strong><br>' +
      t('res_deuda_total') + '<strong>' + fmt.format(totalPagado) + '</strong></p>' +
      '<p class="muted">' + t('res_deuda_nota') + '</p>');
  }

  /* ---------- San / tanda ---------- */
  function sumarFrecuencia(fecha, freq) {
    var f = new Date(fecha.getTime());
    if (freq === 'semanal') f.setDate(f.getDate() + 7);
    else if (freq === 'quincenal') f.setDate(f.getDate() + 14);
    else f.setMonth(f.getMonth() + 1); /* mensual */
    return f;
  }
  function calcularSan(ev) {
    ev.preventDefault();
    var aporte = num('s-aporte'), n = num('s-participantes');
    var freq = document.getElementById('s-frecuencia').value;
    var inicioVal = document.getElementById('s-inicio').value;
    var R = 's-resultado';
    if (!(aporte > 0) || !(n >= 2) || n % 1 !== 0) {
      error(R, t('err_san_num'));
      return;
    }
    var loc = idioma() === 'it' ? 'it-IT' : 'es-US';
    var fondo = aporte * n;
    var filas = '';
    var fecha = inicioVal ? new Date(inicioVal + 'T12:00:00') : null;
    for (var i = 1; i <= n; i++) {
      var cuando = '—';
      if (fecha) {
        cuando = fecha.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        fecha = sumarFrecuencia(fecha, freq);
      }
      filas += '<tr><td>' + t('turno') + ' ' + i + '</td><td>' + cuando + '</td><td>' + fmt.format(fondo) + '</td></tr>';
    }
    mostrar(R,
      '<p>' + t('res_san_a') + '<span class="cifra">' + fmt.format(fondo) + '</span></p>' +
      '<p>' + t('res_san_total_a') + '<strong>' + fmt.format(fondo) + '</strong>' + t('res_san_total_b') +
      fmt.format(aporte) + ' × ' + n + t('res_san_total_c') + '</p>' +
      '<table class="turnos"><tr><th>' + t('turno') + '</th><th>' + t('th_fecha') + '</th><th>' + t('th_recibe') + '</th></tr>' + filas + '</table>' +
      '<p class="muted">' + t('res_san_nota') + '</p>');
  }

  /* ---------- Gasto diario: misma fórmula que la app (Fase 1) ---------- */
  function calcularDiario(ev) {
    ev.preventDefault();
    var presupuesto = num('g-presupuesto'), gastado = num('g-gastado');
    var diaHoy = num('g-dia'), diasMes = num('g-dias-mes');
    var R = 'g-resultado';
    if (!(presupuesto > 0) || !(gastado >= 0) || !(diaHoy >= 1) || !(diasMes >= 28 && diasMes <= 31) || diaHoy > diasMes) {
      error(R, t('err_dia_num'));
      return;
    }
    var restantes = diasMes - diaHoy + 1; /* incluye hoy, como en la app */
    var queda = presupuesto - gastado;
    if (queda <= 0) {
      mostrar(R,
        '<p>' + t('res_dia_cero_a') + '<span class="cifra">' + t('res_dia_cero_dia') + '</span></p>' +
        '<p class="muted">' + t('res_dia_cero_b') + '<strong>' + fmt.format(-queda) + '</strong>' + t('res_dia_cero_c') + '</p>');
      return;
    }
    var porDia = queda / restantes;
    mostrar(R,
      '<p>' + t('res_dia_a') + '<span class="cifra">' + fmt.format(porDia) + t('res_dia_b') + '</span></p>' +
      '<p>' + t('res_dia_quedan') + '<strong>' + fmt.format(queda) + '</strong>' + t('res_dia_para') + '<strong>' + restantes +
      (restantes === 1 ? ' ' + t('dia') : ' ' + t('dias')) + '</strong>' + t('res_dia_faltan') + '</p>' +
      '<p class="muted">' + t('res_dia_nota') + '</p>');
  }

  var fns = { 'form-deuda': calcularDeuda, 'form-san': calcularSan, 'form-diario': calcularDiario };
  Object.keys(fns).forEach(function (id) {
    var f = document.getElementById(id);
    if (f) f.addEventListener('submit', fns[id]);
  });

  /* Gasto diario: precargar el día de hoy y los días del mes actual. */
  var dia = document.getElementById('g-dia'), diasMes = document.getElementById('g-dias-mes');
  if (dia && diasMes) {
    var hoy = new Date();
    dia.value = hoy.getDate();
    diasMes.value = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  }
})();
