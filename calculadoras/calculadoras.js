/* PETO — calculadoras públicas de petofinanzas. Sin servidor: todo se calcula en el navegador. */
(function () {
  'use strict';

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
      error(R, 'Revisa los números: monto, interés (puede ser 0) y pago mensual deben ser válidos.');
      return;
    }
    var r = anual / 100 / 12;
    if (r > 0 && pago <= monto * r) {
      error(R, 'Con ese pago mensual no cubres ni los intereses del primer mes (' +
        fmt.format(monto * r) + '): la deuda crecería en vez de bajar. Sube el pago o negocia la deuda.');
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
      error(R, 'Con ese pago tardarías más de 100 años. Sube el pago mensual.');
      return;
    }
    var totalPagado = pago * (meses - 1) + ultimoPago;
    mostrar(R,
      '<p>Saldarías esta deuda en <span class="cifra">' + meses + (meses === 1 ? ' mes' : ' meses') + '</span></p>' +
      '<p>Total de intereses: <strong>' + fmt.format(intereses) + '</strong><br>' +
      'Total pagado al final: <strong>' + fmt.format(totalPagado) + '</strong></p>' +
      '<p class="muted">En PETO anotas la deuda una vez y la app sigue tu avance pago a pago.</p>');
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
      error(R, 'Revisa los números: el aporte debe ser mayor que 0 y los participantes al menos 2.');
      return;
    }
    var fondo = aporte * n;
    var filas = '';
    var fecha = inicioVal ? new Date(inicioVal + 'T12:00:00') : null;
    for (var i = 1; i <= n; i++) {
      var cuando = '—';
      if (fecha) {
        cuando = fecha.toLocaleDateString('es-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        fecha = sumarFrecuencia(fecha, freq);
      }
      filas += '<tr><td>Turno ' + i + '</td><td>' + cuando + '</td><td>' + fmt.format(fondo) + '</td></tr>';
    }
    mostrar(R,
      '<p>Cada turno entrega <span class="cifra">' + fmt.format(fondo) + '</span></p>' +
      '<p>Cada participante aporta en total <strong>' + fmt.format(fondo) + '</strong> durante el ciclo ' +
      '(' + fmt.format(aporte) + ' × ' + n + ' rondas) y recibe ese mismo fondo en su turno.</p>' +
      '<table class="turnos"><tr><th>Turno</th><th>Fecha</th><th>Recibe</th></tr>' + filas + '</table>' +
      '<p class="muted">En PETO llevas quién ya pagó cada ronda y te avisa cuando te toca.</p>');
  }

  /* ---------- Gasto diario: misma fórmula que la app (Fase 1) ---------- */
  function calcularDiario(ev) {
    ev.preventDefault();
    var presupuesto = num('g-presupuesto'), gastado = num('g-gastado');
    var diaHoy = num('g-dia'), diasMes = num('g-dias-mes');
    var R = 'g-resultado';
    if (!(presupuesto > 0) || !(gastado >= 0) || !(diaHoy >= 1) || !(diasMes >= 28 && diasMes <= 31) || diaHoy > diasMes) {
      error(R, 'Revisa los números: presupuesto mayor que 0, gasto de 0 en adelante, y un día válido dentro del mes.');
      return;
    }
    var restantes = diasMes - diaHoy + 1; /* incluye hoy, como en la app */
    var queda = presupuesto - gastado;
    if (queda <= 0) {
      mostrar(R,
        '<p>Ya alcanzaste tu presupuesto del mes: <span class="cifra">$0 por día</span></p>' +
        '<p class="muted">Te pasaste por <strong>' + fmt.format(-queda) + '</strong>. En PETO este número se actualiza solo con cada gasto que anotas.</p>');
      return;
    }
    var porDia = queda / restantes;
    mostrar(R,
      '<p>Puedes gastar <span class="cifra">' + fmt.format(porDia) + ' por día</span></p>' +
      '<p>Te quedan <strong>' + fmt.format(queda) + '</strong> para los <strong>' + restantes +
      (restantes === 1 ? ' día' : ' días') + '</strong> que faltan del mes (contando hoy).</p>' +
      '<p class="muted">En PETO este número vive en tu pantalla principal y se mueve con cada gasto.</p>');
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
