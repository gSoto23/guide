/* Guidesk interactive presentation: navigation, language, theme, and the interactive pieces.
   Every text the script writes carries both languages (L(es, en)); CSS shows the active one. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var timers = [];

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function L(es, en) { return '<span class="es">' + es + '</span><span class="en">' + en + '</span>'; }
  /* Text read from the page (attributes, element text) is escaped before it goes back in as HTML */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; } return null; }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function money(n) { return 'USD ' + n.toFixed(2); }

  /* ---------------- Language and theme ---------------- */
  function setLang(lang) {
    root.setAttribute('data-lang', lang);
    root.lang = lang;
    store('guidesk-deck-lang', lang);
  }
  setLang(store('guidesk-deck-lang') === 'en' ? 'en' : 'es');
  $('#langBtn').addEventListener('click', function () { setLang(root.getAttribute('data-lang') === 'en' ? 'es' : 'en'); updateChrome(); });

  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark() { var t = root.getAttribute('data-theme'); return t ? t === 'dark' : darkQuery.matches; }
  function paintThemeIcon() { $('#themeBtn use').setAttribute('href', isDark() ? '#i-sun' : '#i-moon'); }
  var savedTheme = store('guidesk-deck-theme');
  if (savedTheme === 'dark' || savedTheme === 'light') root.setAttribute('data-theme', savedTheme);
  paintThemeIcon();
  $('#themeBtn').addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    store('guidesk-deck-theme', next);
    paintThemeIcon();
  });
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', paintThemeIcon);

  /* ---------------- Slides ---------------- */
  var CHAPTERS = {
    inicio: ['Inicio', 'Start'],
    vision: ['Problema y visión', 'Problem and vision'],
    producto: ['El producto', 'The product'],
    demo: ['Demos guiadas', 'Guided demos'],
    tecnica: ['Cómo funciona', 'How it works'],
    negocio: ['Negocio', 'Business'],
    estado: ['Estado', 'Status']
  };
  var slides = $$('.slide');
  var current = -1;
  var onEnter = {};
  var onLeave = {};

  slides.forEach(function (s) {
    $$('[data-build]', s).forEach(function (el, i) { el.style.setProperty('--i', Math.min(i, 14)); });
    $$('#checks li', s).forEach(function (el, i) { el.style.setProperty('--i', i); });
  });

  function indexOfId(id) {
    for (var i = 0; i < slides.length; i++) if (slides[i].id === id) return i;
    return -1;
  }

  function updateChrome() {
    var s = slides[current];
    if (!s) return;
    var ch = CHAPTERS[s.dataset.chapter] || ['', ''];
    $('#chapterLabel').innerHTML = L(ch[0], ch[1]);
    $('#slideTitle').innerHTML = L(esc(s.dataset.es), esc(s.dataset.en));
    $('#slideCount').textContent = (current + 1) + ' / ' + slides.length;
    $('#progressFill').style.width = ((current + 1) / slides.length * 100) + '%';
    $('#prevBtn').disabled = current === 0;
    $('#nextBtn').disabled = current === slides.length - 1;
    $$('#indexChapters a').forEach(function (a) {
      if (a.getAttribute('href') === '#' + s.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function go(i, opts) {
    opts = opts || {};
    if (i < 0 || i >= slides.length || i === current) return;
    var prev = slides[current];
    var dir = i > current ? 'enter-next' : 'enter-prev';
    if (prev) {
      prev.classList.remove('is-active', 'enter-next', 'enter-prev');
      if (onLeave[prev.id]) onLeave[prev.id]();
    }
    clearTimers();
    current = i;
    var s = slides[i];
    s.classList.remove('enter-next', 'enter-prev');
    s.scrollTop = 0;
    if (prev && !reduceMotion.matches) { void s.offsetWidth; s.classList.add(dir); }
    s.classList.add('is-active');
    var stage = $('#stage'); stage.scrollTop = 0; stage.scrollLeft = 0;
    if (!opts.fromHash) {
      try { history.replaceState(null, '', '#' + s.id); } catch (e) { /* the hash is a convenience */ }
    }
    updateChrome();
    if (onEnter[s.id]) onEnter[s.id]();
  }
  function next() { go(current + 1); }
  function prevSlide() { go(current - 1); }

  $('#nextBtn').addEventListener('click', next);
  $('#prevBtn').addEventListener('click', prevSlide);
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]');
    if (b) { var g = b.getAttribute('data-go'); if (g === 'next') next(); else if (g === 'first') go(0); return; }
    if (e.target.closest('[data-open-index]')) { openIndex(); return; }
    var a = e.target.closest('a[href^="#"]');
    if (a) {
      var idx = indexOfId(a.getAttribute('href').slice(1));
      if (idx >= 0) { e.preventDefault(); closeIndex(); go(idx); }
    }
  });
  window.addEventListener('hashchange', function () {
    var idx = indexOfId(location.hash.slice(1));
    if (idx >= 0) go(idx, { fromHash: true });
    $('#stage').scrollTop = 0;
  });

  /* Keyboard */
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    var indexOpen = !$('#index').hidden;
    var sheet = $('#featureSheet');
    if (e.key === 'Escape') { if (indexOpen) { closeIndex(); e.preventDefault(); } return; }
    if (typing || (sheet && sheet.open)) return;
    if (indexOpen) { if (e.key === 'm' || e.key === 'M') closeIndex(); return; }
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': next(); e.preventDefault(); break;
      case 'ArrowLeft': case 'PageUp': prevSlide(); e.preventDefault(); break;
      case 'Home': go(0); e.preventDefault(); break;
      case 'End': go(slides.length - 1); e.preventDefault(); break;
      case 'm': case 'M': openIndex(); e.preventDefault(); break;
      case 'l': case 'L': $('#langBtn').click(); e.preventDefault(); break;
    }
  });

  /* Swipe */
  var touch = null;
  $('#stage').addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || e.target.closest('.table-wrap, input, select, .split-bar, [data-noswipe]')) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  $('#stage').addEventListener('touchend', function (e) {
    if (!touch) return;
    var dx = e.changedTouches[0].clientX - touch.x;
    var dy = e.changedTouches[0].clientY - touch.y;
    var fast = Date.now() - touch.t < 800;
    touch = null;
    if (fast && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) { if (dx < 0) next(); else prevSlide(); }
  }, { passive: true });

  /* Index */
  (function buildIndex() {
    var html = '';
    var n = 0;
    Object.keys(CHAPTERS).forEach(function (key) {
      var items = slides.filter(function (s) { return s.dataset.chapter === key; });
      if (!items.length) return;
      html += '<div><h3>' + L(CHAPTERS[key][0], CHAPTERS[key][1]) + '</h3><ol>';
      items.forEach(function (s) {
        n += 1;
        html += '<li><a href="#' + esc(s.id) + '"><span class="n">' + (n < 10 ? '0' + n : n) + '</span><span>' + L(esc(s.dataset.es), esc(s.dataset.en)) + '</span></a></li>';
      });
      html += '</ol></div>';
    });
    $('#indexChapters').innerHTML = html;
  })();
  var lastFocus = null;
  function openIndex() {
    var ix = $('#index');
    lastFocus = document.activeElement;
    ix.hidden = false; ix.classList.add('open');
    $('#deck').inert = true;
    var cur = $('#indexChapters a[aria-current="page"]');
    (cur || $('#indexClose')).focus();
  }
  function closeIndex() {
    var ix = $('#index');
    if (ix.hidden) return;
    ix.hidden = true; ix.classList.remove('open');
    $('#deck').inert = false;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('#indexBtn').addEventListener('click', openIndex);
  $('#indexClose').addEventListener('click', closeIndex);

  /* ---------------- Generic tabs ([data-tabs]) ---------------- */
  var tabHooks = {};
  $$('[data-tabs]').forEach(function (box) {
    var tabs = $$('[data-tab]', box);
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var key = tab.getAttribute('data-tab');
        tabs.forEach(function (t) { t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
        $$('[data-panel]', box).forEach(function (p) {
          var on = p.getAttribute('data-panel') === key;
          p.hidden = !on;
          if (on) { p.removeAttribute('data-anim'); void p.offsetWidth; p.setAttribute('data-anim', ''); }
        });
        if (tabHooks[key]) tabHooks[key]();
      });
    });
  });

  /* Count-up for the completeness ring */
  function countRing(el, from, to) {
    if (!el) return;
    if (reduceMotion.matches) { el.style.setProperty('--v', to); el.setAttribute('data-label', to + '%'); return; }
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var k = Math.min(1, (ts - start) / 700);
      var v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      el.style.setProperty('--v', v); el.setAttribute('data-label', v + '%');
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  tabHooks.o4 = function () { countRing($('#ring'), 0, 68); };

  /* ---------------- Personas and vision layers ---------------- */
  $$('.persona-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.parentNode.classList.toggle('open', open);
      $('.persona-detail', btn.parentNode).hidden = !open;
    });
  });
  $$('#layers .layer').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.nextElementSibling.hidden = !open;
    });
  });

  /* ---------------- Feature map and detail sheet ---------------- */
  var FEATURES = {
    '001': { t: ['Cuentas, workspaces y roles', 'Accounts, workspaces, and roles'],
      lead: ['Todo empieza con una cuenta segura y un espacio de trabajo para el equipo.', 'Everything starts with a secure account and a workspace for the team.'],
      items: [
        ['Registro sin contraseñas: Google, passkey (rostro o huella) o código por correo.', 'Passwordless sign-up: Google, a passkey (face or fingerprint), or an email code.'],
        ['Hasta tres preguntas de bienvenida y el workspace queda listo para la primera propiedad.', 'Up to three welcome questions, then the workspace is ready for the first property.'],
        ['Roles Dueño, Administrador y Agente. Los agentes atienden conversaciones y no ven códigos de acceso.', 'Owner, Admin, and Agent roles. Agents handle conversations and never see access codes.'],
        ['Invitaciones por correo; una persona puede estar en varios workspaces y cambiar con el selector.', 'Email invitations; one person can join several workspaces and switch between them.'],
        ['Segundo factor obligatorio para dueños y administradores con más de 2 propiedades; reautenticación antes de acciones sensibles; sesiones revocables y avisos de nuevo dispositivo.', 'A required second factor for owners and admins with more than 2 properties; re-authentication before sensitive actions; revocable sessions and new-device alerts.'],
        ['Exportar los datos propios, borrar la cuenta y transferir el workspace; registro de seguridad visible para el dueño.', 'Export your data, delete the account, and transfer the workspace; a security log the owner can see.']
      ], screens: 'H-30 · H-31 · H-35 · H-36 · H-37', adr: 'ADR-0008' },
    '002': { t: ['Alta de propiedades', 'Property onboarding'],
      lead: ['Seis formas de crear una propiedad, todas terminan con el anfitrión confirmando los datos clave.', 'Six ways to create a property; all end with the host confirming the core facts.'],
      items: [
        ['A mano, en blanco o duplicando una propiedad existente.', 'Manual entry, a blank start, or duplicating an existing property.'],
        ['Pegando el texto o las capturas del anuncio: la IA extrae los datos y los deja como borrador.', 'Pasting the listing text or screenshots: AI extracts the facts and leaves them as a draft.'],
        ['CSV para muchas propiedades, con validación por fila y archivo de errores.', 'A CSV for many properties, validated row by row with an error file.'],
        ['Importación de solo lectura desde Beds24 o Hostex con el token del cliente, guardado cifrado y tras reautenticarse; refresca reservas cada 3 horas.', 'Read-only import from Beds24 or Hostex with the customer\'s token, stored encrypted after re-authentication; reservations refresh every 3 hours.'],
        ['Calendario iCal del OTA para las fechas de cada estadía, leído por una función aislada sin acceso a la red interna.', 'The OTA iCal calendar for each stay\'s dates, read by an isolated function with no route to internal services.'],
        ['Los códigos que aparecen en el anuncio pasan a campos cifrados y nunca llegan a la IA. Nada se publica solo.', 'Codes found in the listing move to encrypted fields and never reach the AI. Nothing is published automatically.']
      ], screens: 'H-10 · H-11 · H-17 · H-24 · H-25', adr: 'ADR-0003' },
    '003': { t: ['Constructor de guías', 'Guide builder'],
      lead: ['Cada propiedad empieza con un borrador de nueve secciones hecho con sus propios datos.', 'Every property starts with a nine-section draft built from its own data.'],
      items: [
        ['Secciones: Llegada y acceso, Wi-Fi, Normas de la casa, Electrodomésticos, Comodidades, Parqueo y transporte, Recomendaciones locales, Emergencias y contactos, Salida; más secciones propias.', 'Sections: Arrival and access, Wi-Fi, House rules, Appliances, Amenities, Parking and transport, Local recommendations, Emergencies and contacts, Checkout; plus custom ones.'],
        ['Editor con texto, fotos y videos cortos; etiquetas de origen como «De tu anuncio».', 'An editor with text, photos, and short videos; source labels such as "From your listing".'],
        ['Entrevista con IA por texto o nota de voz, y extracción desde manuales y fotos subidos.', 'An AI interview by text or voice note, and extraction from uploaded manuals and photos.'],
        ['Campos bloqueados para códigos y contraseñas: cifrados, enmascarados, nunca enviados a la IA; revelarlos pide reautenticación y queda registrado.', 'Locked fields for codes and passwords: encrypted, masked, never sent to the AI; revealing one needs re-authentication and is logged.'],
        ['Español e inglés con traducción automática y revisión por sección; puntaje de completitud con lo que más preguntan los huéspedes.', 'Spanish and English with machine translation and per-section review; a completeness score based on what guests ask most.'],
        ['Contenido compartido del workspace que se hereda o se sobrescribe; publicar es explícito y versionado.', 'Shared workspace content that is inherited or overridden; publishing is explicit and versioned.']
      ], screens: 'H-12 · H-13 · H-14 · H-15 · H-18 · H-19 · H-29', adr: 'SEC-06 · SEC-10' },
    '004': { t: ['Guía del huésped', 'Guest guide'],
      lead: ['Una web app móvil que se abre desde un enlace o un QR, sin app ni cuenta.', 'A mobile web app opened from a link or a QR code, with no app and no account.'],
      items: [
        ['Idioma detectado del navegador, con cambio entre español e inglés.', 'Language detected from the browser, switchable between Spanish and English.'],
        ['Enlace de la propiedad y QR: solo contenido público. Enlace de estadía: desbloquea los códigos desde las 00:00 del día de llegada hasta 2 horas después de la salida.', 'Property link and QR: public content only. Stay link: unlocks codes from 00:00 on arrival day until 2 hours after checkout.'],
        ['Código de confirmación opcional de 6 caracteres, con pausas crecientes tras 5 intentos fallidos.', 'An optional 6-character confirmation code, with growing pauses after 5 failed tries.'],
        ['Pantalla Compartir: mensaje para el OTA en ES y EN, QR imprimible, enlaces por estadía, revocar y regenerar.', 'A Share screen: the OTA message in ES and EN, a printable QR code, stay links, revoke and regenerate.'],
        ['Se lee con mala señal: lo ya visto queda guardado, nunca los códigos. Script de 2.7 KB, sin hidratar.', 'Readable on a weak signal: what was viewed stays saved, never the codes. A 2.7 KB script, never hydrated.'],
        ['Solo cuenta aperturas, sin datos personales del huésped.', 'It counts opens only, with no guest personal data.']
      ], screens: 'G-01 … G-05 · G-11 … G-13 · H-16', adr: 'SEC-01 … SEC-04 · ADR-0010' },
    '005': { t: ['Chat con IA en la guía', 'In-guide AI chat'],
      lead: ['El huésped pregunta desde cualquier página; el asistente responde solo con la guía publicada.', 'Guests ask from any page; the assistant answers only from the published guide.'],
      items: [
        ['Cita la sección que usó y responde en el idioma del huésped.', 'It cites the section it used and replies in the guest\'s language.'],
        ['Nunca dice un código: indica la sección donde el huésped verificado lo ve.', 'It never states a code; it points to the section where a verified guest sees it.'],
        ['Escalamiento obligatorio con respuesta de espera; en emergencias, primero la tarjeta con el 911 y los contactos del anfitrión.', 'Mandatory escalation with a holding reply; in emergencies, the card with 911 and the host\'s contacts comes first.'],
        ['Por defecto el anfitrión aprueba cada respuesta (borrador).', 'By default the host approves each reply (draft).'],
        ['Límites: 20 mensajes cada 10 minutos por huésped, 2,000 caracteres por mensaje, 200 respuestas al día por propiedad.', 'Limits: 20 messages per 10 minutes per guest, 2,000 characters per message, 200 replies a day per property.'],
        ['Cada respuesta guarda su traza: secciones, tema, revisiones, modelo, tokens y costo. Las respuestas se muestran solo después de pasar las revisiones.', 'Each reply keeps its trace: sections, topic, checks, model, tokens, and cost. Replies show only after they pass the checks.']
      ], screens: 'G-06 · H-21', adr: 'SEC-07 · SEC-08 · ADR-0005' },
    '006': { t: ['Bandeja y copiloto', 'Inbox and copilot'],
      lead: ['El equipo atiende todas las conversaciones en un lugar, y el copiloto redacta para los chats de las plataformas.', 'The team handles every conversation in one place, and the copilot drafts for platform chats.'],
      items: [
        ['Pestañas Te necesitan, Todas y Listas; emergencias primero; filtro por propiedad.', 'Tabs Needs you, All, and Done; emergencies first; filter by property.'],
        ['Enviar, editar o descartar borradores; «Yo respondo» para tomar la conversación; marcar como lista.', 'Send, edit, or discard drafts; "I\'ll reply myself" to take over; mark as done.'],
        ['Indicador de quién está respondiendo, para no duplicar respuestas.', 'An indicator of who is replying, so answers aren\'t duplicated.'],
        ['Copiloto: pega un mensaje de Airbnb, Booking.com o Vrbo y recibe una respuesta desde la guía que pasó las revisiones; antes de reservar quita enlaces y contactos.', 'Copilot: paste an Airbnb, Booking.com, or Vrbo message and get a reply from the guide that passed the checks; before booking it removes links and contacts.'],
        ['Alertas web push además del correo, con el nombre de la propiedad y el motivo, nunca el texto del huésped.', 'Web push alerts besides email, with the property name and the reason, never the guest\'s text.'],
        ['Sugerencia de confianza tras 5 borradores de un tema enviados sin cambios en 30 días.', 'A trust suggestion after 5 drafts on a topic are sent unchanged within 30 days.']
      ], screens: 'H-02 · H-20 · H-21 · H-22', adr: 'ADR-0006' },
    '007': { t: ['Ajustes del asistente', 'Assistant settings'],
      lead: ['El anfitrión decide cuánto hace el asistente solo, tema por tema.', 'The host decides how much the assistant does alone, topic by topic.'],
      items: [
        ['Autonomía por tema: «Reviso cada respuesta», «Responde si está en la guía» o «Responde y pregunta solo».', 'Autonomy per topic: "I review every reply", "Answers if it\'s in the guide", or "Answers and asks on its own".'],
        ['Las 8 categorías obligatorias se ven bloqueadas y nunca se responden solas.', 'The 8 mandatory categories show as locked and are never answered automatically.'],
        ['Tono cercano o formal e instrucciones propias, que se rechazan si traen códigos, enlaces, correos, teléfonos o pedidos fuera de la plataforma.', 'A casual or formal tone and custom instructions, refused if they contain codes, links, emails, phone numbers, or off-platform requests.'],
        ['Horas de silencio en la zona horaria de la propiedad: lo no urgente llega en un resumen; las emergencias alertan siempre.', 'Quiet hours in the property\'s time zone: non-urgent alerts arrive in a summary; emergencies always alert.'],
        ['Contactos de escalamiento; valores del workspace con ajustes por propiedad.', 'Escalation contacts; workspace defaults with per-property overrides.'],
        ['«Probar el asistente» corre el mismo proceso en modo de prueba, sin que lo vea un huésped.', '"Test the assistant" runs the same pipeline in dry-run mode, unseen by guests.']
      ], screens: 'H-26', adr: 'PRD §6' },
    '008': { t: ['Extras y solicitudes', 'Extras and requests'],
      lead: ['Los servicios propios del anfitrión, pedidos desde la guía y confirmados por el equipo.', 'The host\'s own services, requested from the guide and confirmed by the team.'],
      items: [
        ['Catálogo por propiedad con precio, moneda, anticipación, días, cuántos por estadía y preaprobación; sugerencias como traslado al aeropuerto, limpieza extra, compras antes de llegar y salida tarde.', 'A catalog per property with price, currency, notice, days, how many per stay, and pre-approval; suggestions such as airport pickup, extra cleaning, groceries before arrival, and late checkout.'],
        ['El huésped con enlace de estadía elige fecha y hora, deja una nota opcional y lo pide.', 'A guest with a stay link picks the date and time, adds an optional note, and requests it.'],
        ['La API toma el nombre, el precio y la estadía del catálogo y la sesión, nunca del navegador.', 'The API takes the name, price, and stay from the catalog and the session, never from the browser.'],
        ['El equipo confirma o declina con motivo desde Solicitudes; los preaprobados se confirman al instante; lo que nadie responde vence solo.', 'The team confirms or declines with a reason from Requests; pre-approved extras confirm at once; unanswered ones expire.'],
        ['Siempre opcionales: nada cambia la reserva ni es un cargo obligatorio de la estadía.', 'Always optional: nothing changes the booking or is a mandatory fee for the stay.']
      ], screens: 'G-08 · G-09 · H-23 · H-27', adr: 'PC-06 · PC-07 · PC-08' },
    '009': { t: ['Explorar: tours y experiencias', 'Explore: tours and experiences'],
      lead: ['Recomendaciones del anfitrión y experiencias cercanas de socios, con aviso de comisión.', 'The host\'s tips and nearby partner experiences, with a commission disclosure.'],
      items: [
        ['Primero las recomendaciones del anfitrión; luego hasta 12 experiencias por categoría.', 'The host\'s tips first, then up to 12 experiences by category.'],
        ['Viator por API de afiliados, refrescado por un trabajo cada 30 minutos y guardado una hora como máximo; Civitatis desde una lista curada.', 'Viator through its affiliate API, refreshed by a job every 30 minutes and kept an hour at most; Civitatis from a curated list.'],
        ['«Guidesk podría recibir una comisión si reservas, sin costo extra para ti», arriba y en cada tarjeta.', '"Guidesk may earn a commission if you book, at no extra cost to you", at the top and on every card.'],
        ['El clic pasa por un redireccionamiento en el origen de la guía que solo lleva a la página guardada del socio y cuenta clics sin datos personales.', 'Clicks go through a redirect on the guide origin that only leads to the stored partner page and counts clicks with no personal data.'],
        ['El anfitrión elige categorías y oculta experiencias; el chat puede señalar Explorar, el copiloto nunca.', 'Hosts choose categories and hide experiences; the chat may point to Explore, the copilot never does.']
      ], screens: 'G-07 · G-14 · H-28', adr: 'SEC-13 · PC-10' },
    '010': { t: ['Estadísticas', 'Analytics'],
      lead: ['Cómo se usa cada guía y qué resuelve el asistente, sin rastrear huéspedes.', 'How each guide is used and what the assistant resolves, without tracking guests.'],
      items: [
        ['Por propiedad o workspace, 7, 30 o 90 días por día local, contra el período anterior.', 'Per property or workspace, 7, 30, or 90 days by local day, against the previous period.'],
        ['Vistas por tipo de enlace, estadías que abrieron la guía, preguntas por resultado y tasa de resolución automática.', 'Views by link type, stays that opened the guide, questions by outcome, and the automated resolution rate.'],
        ['Temas, motivos de escalamiento y preguntas sin respuesta con enlace a la conversación.', 'Topics, escalation reasons, and unanswered questions linking to their conversation.'],
        ['Aperturas de Explorar, clics a socios, solicitudes de extras y tasa de adopción.', 'Explore opens, partner clicks, extra requests, and attach rate.'],
        ['Lee los registros existentes; las métricas del piloto salen de un reporte de línea de comandos, solo con agregados.', 'It reads existing records; pilot metrics come from a command-line report, aggregates only.']
      ], screens: 'H-34', adr: 'PRD §8' },
    '011': { t: ['Planes y límites', 'Plan limits'],
      lead: ['Cada workspace tiene un plan que limita propiedades activas, respuestas de IA al mes y puestos.', 'Every workspace has a plan that limits active properties, AI replies a month, and seats.'],
      items: [
        ['Free: 2 propiedades, 100 respuestas de IA al mes, 1 puesto. Pro: sin límite de propiedades, 300 respuestas por propiedad activa (compartidas), 3 puestos. Business: igual que Pro con puestos sin límite.', 'Free: 2 properties, 100 AI replies a month, 1 seat. Pro: unlimited properties, 300 replies per active property (pooled), 3 seats. Business: like Pro with unlimited seats.'],
        ['En el límite mensual no se llama al modelo: el huésped recibe la respuesta de espera y la conversación espera al anfitrión.', 'At the monthly limit no model call is made: the guest gets the holding reply and the conversation waits for the host.'],
        ['Correos al 80% y al 100%, y un aviso en el portal.', 'Emails at 80% and 100%, and a banner in the portal.'],
        ['Un workspace por encima de un límite conserva todo lo que tiene.', 'A workspace above a limit keeps everything it has.'],
        ['Sin cobro todavía: el fundador asigna planes y límites propios con una herramienta interna, registrada en el log de seguridad.', 'No billing yet: the founder assigns plans and custom limits with an internal tool, recorded in the security log.']
      ], screens: 'H-32', adr: 'SEC-07' },
    '013': { t: ['Pagos de extras', 'Add-on payments'],
      lead: ['El huésped paga un extra confirmado sin que los datos de tarjeta pasen por Guidesk.', 'Guests pay for a confirmed extra without card data passing through Guidesk.'],
      items: [
        ['Checkout alojado del proveedor detrás de PaymentPort: alcance PCI DSS mínimo (SAQ A).', 'The provider\'s hosted checkout behind PaymentPort: the smallest PCI DSS scope (SAQ A).'],
        ['El pedido queda pagado solo con un evento firmado del proveedor, registrado una vez.', 'An order is paid only through a signed provider event, recorded once.'],
        ['Cada pedido guarda precio, comisión de plataforma (Free 10%, Pro 7%, Business 5% o acordada), comisión del proveedor y parte del anfitrión.', 'Each order stores the price, the platform fee (Free 10%, Pro 7%, Business 5%, or agreed), the provider fee, and the host\'s share.'],
        ['El dueño configura los pagos en la página del proveedor; la parte del anfitrión se liquida directo a su cuenta.', 'The owner sets up payouts on the provider\'s page; the host\'s share settles straight to their account.'],
        ['Reembolsos totales o parciales con reautenticación; disputas marcadas y avisadas por correo.', 'Full or partial refunds with re-authentication; disputes flagged and emailed.'],
        ['Hoy corre con un proveedor simulado; en producción los pagos están apagados hasta el adaptador de Tilopay.', 'Today it runs on a simulated provider; in production payments are off until the Tilopay adapter exists.']
      ], screens: 'G-09 · G-10 · H-23 · H-33', adr: 'SEC-21 · ADR-0007' },
    '014': { t: ['Páginas públicas y demo', 'Public pages and demo'],
      lead: ['Una cara pública para Guidesk y un workspace de demo listo en un comando.', 'A public face for Guidesk and a demo workspace ready in one command.'],
      items: [
        ['Página de inicio, política de privacidad y términos en español e inglés, enlazados desde el inicio de sesión y la guía. Son borradores para la revisión legal (OQ-35).', 'Home page, privacy policy, and terms in Spanish and English, linked from sign-in and the guide. They are drafts for the legal review (OQ-35).'],
        ['Búsqueda: títulos, idiomas alternos, robots y sitemap solo con las páginas públicas; la guía del huésped no se indexa.', 'Search: titles, language alternates, robots, and a sitemap with only the public pages; the guest guide is not indexed.'],
        ['El comando demo:seed crea dos propiedades en Costa Rica con guías publicadas, estadías, extras, una escalación abierta y 60 días de estadísticas, sin llamar a la IA.', 'The demo:seed command creates two Costa Rican properties with published guides, stays, extras, an open escalation, and 60 days of analytics, without calling the AI.'],
        ['Se niega a correr en producción y el workspace de demo queda fuera del reporte del piloto.', 'It refuses to run in production, and the demo workspace stays out of the pilot report.']
      ], screens: 'P-01 · P-02 · P-03', adr: 'OQ-35' },
    '015': { t: ['La marca en el producto', 'The brand in the product'],
      lead: ['La identidad «Bienvenida» en cada pantalla, en el teléfono y en la computadora.', 'The "Bienvenida" identity on every screen, on the phone and the computer.'],
      items: [
        ['Portal responsive: barra inferior en el teléfono (Bandeja, Solicitudes, Propiedades y Más) y menú lateral en la computadora, con la página actual marcada.', 'A responsive portal: a bottom bar on the phone (Inbox, Requests, Properties, and More) and a sidebar on the computer, with the current page marked.'],
        ['Sin textos cortados: ninguna palabra se parte ni termina en «…», ni siquiera a 320 px.', 'No cut-off text: no word splits or ends in "…", even at 320 px.'],
        ['45 íconos y 9 ilustraciones propios, con las formas del logo, sin librerías ni imágenes de terceros.', '45 icons and 9 illustrations of our own, with the logo\'s shapes, no libraries or third-party images.'],
        ['Pantalla de entrar con el logo y el lema, pantallas vacías ilustradas y «Hecho con Guidesk» en las guías del plan Free.', 'A sign-in screen with the logo and the tagline, illustrated empty screens, and "Made with Guidesk" on Free-plan guides.'],
        ['Vista previa de marca al compartir el enlace de la guía, sin datos del huésped.', 'A branded preview when the guide link is shared, with no guest data.']
      ], screens: 'Portal · G-01 · G-13', adr: 'Brand guide' },
    '016': { t: ['Fotos de la propiedad', 'Property photos'],
      lead: ['Fotos que hacen la guía más visual, subidas por el anfitrión.', 'Photos that make the guide more visual, uploaded by the host.'],
      items: [
        ['Una foto de portada por propiedad: arriba en la guía, en la vista previa de WhatsApp, en las tarjetas del portal y en el póster QR.', 'One cover photo per property: at the top of the guide, in the WhatsApp preview, on the portal cards, and on the QR poster.'],
        ['Una foto opcional por extra, para que el traslado o la tabla de surf se vean antes de pedirlos.', 'An optional photo per extra, so the pickup or the surfboard shows before guests request it.'],
        ['Sugerencias para agregar fotos donde más ayudan: la puerta, el parqueo, el router.', 'Prompts to add photos where they help most: the door, the parking, the router.'],
        ['Avatares con iniciales en el portal. El nombre del huésped no se muestra en la guía, por privacidad: un enlace reenviado no revela quién se hospeda.', 'Initials avatars in the portal. The guest\'s name is not shown in the guide, for privacy: a forwarded link does not reveal who is staying.']
      ], screens: 'G-01 · G-08 · H-04', adr: 'Brand guide §6' },
    '017': { t: ['Diseño para computadora', 'Desktop design'],
      lead: ['El portal se ve como una aplicación de escritorio en la computadora, sin cambiar el diseño del teléfono.', 'On a computer the portal looks like a desktop app, without changing the phone design.'],
      items: [
        ['Una revisión de UI y UX de todo el sitio: 21 hallazgos de impacto alto y medio, todos atendidos.', 'A UI and UX review of the whole site: 21 high- and medium-impact findings, all addressed.'],
        ['Desde 600 px y 1024 px cambia la forma de los mismos componentes: botones a la medida de su texto, filtros en una barra, pestañas segmentadas, tarjetas con borde.', 'From 600 px and 1024 px the same components change shape: buttons sized to their label, filters in one toolbar, segmented tabs, edged cards.'],
        ['Resumen de la propiedad en dos columnas, solicitudes en cuadrícula y bandeja con íconos.', 'A two-column property overview, requests in a grid, and an inbox with icons.'],
        ['Nombres del workspace y de la cuenta en una sola línea, con una barra lateral más ancha.', 'Workspace and account names on one line, with a wider sidebar.']
      ], screens: 'H-01 a/to H-37', adr: 'UI/UX audit 2026-11' },
    '018': { t: ['Calendario de estadías', 'Stay calendar'],
      lead: ['Todas las reservas que Guidesk conoce en un calendario, y en cada una lo que compró el huésped.', 'Every booking Guidesk knows in one calendar, and on each one what the guest bought.'],
      items: [
        ['Vista de todas las propiedades y de una propiedad; agenda por día en el teléfono. Solo lectura: nunca cambia disponibilidad ni precios en las plataformas.', 'An all-properties view and a one-property view; a daily agenda on the phone. Read-only: it never changes availability or prices on the platforms.'],
        ['Cada estadía muestra fechas, huésped, enlace de estadía, conversaciones y cada extra con su estado y su pago, con el total.', 'Each stay shows dates, guest, stay link, conversations, and every extra with its state and payment, plus the total.'],
        ['El anfitrión escribe el nombre del huésped en cualquier estadía; de Airbnb se guarda solo el código de la reserva para encontrar la conversación.', 'The host types the guest\'s name on any stay; from Airbnb only the reservation code is kept, to find the thread.'],
        ['El nombre se usa del lado del anfitrión (bandeja, solicitudes, copiloto, mensaje de estadía); la guía sigue sin mostrarlo.', 'The name is used on the host side (inbox, requests, copilot, stay message); the guide still never shows it.'],
        ['Un espacio de «Servicios» listo para los tours de un socio como Localbird, cuando reporte cada reserva por estadía.', 'A "Services" area ready for a partner\'s tours, such as Localbird, once it reports each booking per stay.']
      ], screens: 'H-new · calendario/calendar', adr: 'PRD F22' },
    '019': { t: ['Respuestas de IA y recargas', 'AI replies and top-ups'],
      lead: ['Límites más generosos y una forma de seguir respondiendo cuando se acaba el mes.', 'More generous limits and a way to keep answering when the month runs out.'],
      items: [
        ['Pro: 300 respuestas por propiedad, compartidas, mínimo 500. Business: igual, mínimo 1.000. Free: 500 durante el piloto.', 'Pro: 300 replies per property, pooled, at least 500. Business: the same, at least 1,000. Free: 500 during the pilot.'],
        ['Hasta 25 mensajes por dispositivo cada 10 minutos; los presupuestos diarios siguen como protección.', 'Up to 25 messages per device every 10 minutes; the daily budgets stay as protection.'],
        ['Recargas de respuestas (no de tokens), válidas 12 meses, usadas después de las del mes. Sin recarga, la IA se pausa hasta el día 1; el servicio nunca se suspende.', 'Reply top-ups (not tokens), valid 12 months, used after the month\'s replies. Without one, the AI pauses until the 1st; the service is never suspended.'],
        ['En el piloto el fundador da las recargas sin costo, con su herramienta (también en AWS); la compra en el portal llega con el cobro a anfitriones.', 'In the pilot the founder grants top-ups at no charge with the founder tool (also on AWS); buying them in the portal comes with host billing.'],
        ['El reporte del piloto separa las respuestas del mes y de recargas, con el costo de IA por respuesta, para fijar el precio de las recargas.', 'The pilot report splits replies from the month and from top-ups, with the AI cost per reply, to set the top-up price.']
      ], screens: 'H-32', adr: 'Spec 011' },
    '020': { t: ['Entrevista y fotos sin trabas', 'Interview and photos without snags'],
      lead: ['La primera ronda de feedback de socios en staging, fase 1: lo que bloqueaba armar la guía.', 'The first round of partner feedback on staging, phase 1: what blocked building the guide.'],
      items: [
        ['La causa de las fotos que no subían: la política de seguridad del portal bloqueaba el envío directo al almacenamiento. Corregida y verificada en staging.', 'Why photos did not upload: the portal security policy blocked the direct send to storage. Fixed and checked on staging.'],
        ['Las preguntas de claves (puerta, portón, caja, alarma, Wi-Fi) guardan la clave cifrada ahí mismo, con la verificación de identidad.', 'Code questions (door, gate, lockbox, alarm, Wi-Fi) save the code encrypted right there, with the identity check.'],
        ['Las preguntas de fotos y videos tienen botón para adjuntar; un texto ya no las da por respondidas.', 'Photo and video questions have an attach button; text no longer counts as their answer.'],
        ['Sin ciclos ni bloqueos: una respuesta fallida avanza, los controles se liberan a los 60 segundos y la entrevista sigue la sección pedida.', 'No loops or freezes: a failed answer moves on, the controls free up after 60 seconds, and the interview follows the requested section.']
      ], screens: 'H-07 · entrevista/interview', adr: 'Spec 020' },
    '021': { t: ['Pulido con el feedback', 'Feedback polish'],
      lead: ['Fase 2 del feedback: detalles que confundían al empezar, en el editor y en el asistente.', 'Phase 2 of the feedback: details that confused people when starting, in the editor, and in the assistant.'],
      items: [
        ['«Pega tu anuncio» pide todo lo que tiene el anuncio y muestra un ejemplo; la propiedad nueva empieza con el país del registro; «Amenidades».', '"Paste your listing" asks for everything the listing has and shows an example; a new property starts with the sign-up country; "Amenities".'],
        ['Pasos para copiar el enlace del calendario en Airbnb, Booking.com y Vrbo; las estadías dicen «Sincronizado desde Airbnb»; botón «Armar mi guía».', 'Steps to copy the calendar link on Airbnb, Booking.com, and Vrbo; stays say "Synced from Airbnb"; a "Build my guide" button.'],
        ['Lo que la IA redacta sobre un mismo tema queda en un solo bloque, sin párrafos repetidos.', 'What the AI drafts on one topic stays in a single item, with no repeated paragraphs.'],
        ['Botones ordenados (aprobar, mover, y eliminar aparte), «Clave» con mostrar u ocultar al escribir y contenido compartido con nombre editable.', 'Ordered buttons (approve, move, and delete apart), "Code" with show or hide while typing, and shared content with an editable name.'],
        ['Búsqueda de propiedades al teclear y niveles del asistente con nombres claros y un ejemplo cada uno.', 'Property search as you type and assistant levels with clear names and one example each.']
      ], screens: 'H-04 · H-06 · H-08 · H-30', adr: 'Spec 021' }
  };

  $$('#featureFilter .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var f = chip.getAttribute('data-filter');
      $$('#featureFilter .chip').forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
      $$('#featureGrid .feature').forEach(function (card) {
        card.hidden = !(f === 'all' || card.getAttribute('data-who').split(' ').indexOf(f) >= 0);
      });
    });
  });
  var sheet = $('#featureSheet');
  var sheetOpener = null;
  $$('#featureGrid .feature').forEach(function (card) {
    card.addEventListener('click', function () {
      var key = card.getAttribute('data-feature');
      var f = FEATURES[key];
      if (!f) return;
      var status = f.planned
        ? '<span class="tag">' + L('especificada', 'specified') + '</span>'
        : f.inProgress
          ? '<span class="tag warn">' + L('en curso', 'in progress') + '</span>'
          : '<span class="tag ok">main ✓</span>';
      $('#sheetTags').innerHTML = '<span class="tag">spec ' + esc(key) + '</span>' + status + '<span class="tag">' + f.adr + '</span>';
      $('#sheetTitle').innerHTML = L(f.t[0], f.t[1]);
      $('#sheetLead').innerHTML = L(f.lead[0], f.lead[1]);
      $('#sheetList').innerHTML = f.items.map(function (it) { return '<li>' + L(it[0], it[1]) + '</li>'; }).join('');
      $('#sheetScreens').innerHTML = L('Pantallas: ', 'Screens: ') + '<span class="mono">' + f.screens + '</span>';
      sheetOpener = card;
      if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', '');
    });
  });
  function closeSheet() { if (sheet.close) sheet.close(); else sheet.removeAttribute('open'); }
  $('#sheetClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  sheet.addEventListener('close', function () { if (sheetOpener) sheetOpener.focus(); });

  /* ---------------- Access demo (spec 004) ---------------- */
  var acc = { link: 'stay', when: 'arrival', verify: 'no', verified: false, shown: false };
  function pressGroup(groupSel, key) {
    $$(groupSel + ' .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        $$(groupSel + ' .chip').forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
        acc[key] = c.getAttribute('data-v');
        acc.verified = false; acc.shown = false;
        renderAccess();
      });
    });
  }
  pressGroup('#accessLink', 'link');
  pressGroup('#accessWhen', 'when');
  pressGroup('#accessVerify', 'verify');
  var lockIcon = '<svg aria-hidden="true"><use href="#i-lock"/></svg>';
  function renderAccess() {
    var clock = { before: '10:00', arrival: '21:40', after: '13:05' }[acc.when];
    var day = { before: L('miércoles 19 nov', 'Wed, Nov 19'), arrival: L('viernes 21 nov', 'Fri, Nov 21'), after: L('viernes 28 nov', 'Fri, Nov 28') }[acc.when];
    $('#accClock').textContent = clock;
    var html = '';
    if (acc.link === 'stay') {
      html += '<div class="stay-card"><span class="small">' + L('Tu estadía', 'Your stay') + ' · ' + day + '</span><b>' + L('21 nov → 28 nov', 'Nov 21 → Nov 28') + '</b><span class="small">' + L('Entrada desde las 3:00 pm · salida a las 10:00 am', 'Check-in from 3:00 pm · checkout at 10:00 am') + '</span></div>';
    } else {
      html += '<div class="stay-card"><span class="small">' + day + '</span><b>Casa Colibrí</b><span class="small">' + L('Guía pública de la propiedad', 'The property\'s public guide') + '</span></div>';
    }
    html += '<p>' + L('1. Portón negro a la izquierda del palo de mango.<br>2. La caja de llaves está junto a la puerta.', '1. Black gate to the left of the mango tree.<br>2. The key box is next to the door.') + '</p>';
    var box = '';
    if (acc.link === 'property') {
      box = '<div class="code-box"><span class="locked lock">' + lockIcon + L('Código de la caja de llaves', 'Key box code') + '</span><span class="code" aria-label="oculto / hidden">• • • •</span><span class="small">' + L('Se muestra en el enlace de tu estadía, durante tu estadía.', 'Shown on your stay link, during your stay.') + '</span></div>';
    } else if (acc.when === 'before') {
      box = '<div class="code-box"><span class="locked lock">' + lockIcon + L('Código de la caja de llaves', 'Key box code') + '</span><span class="code" aria-label="oculto / hidden">• • • •</span><span class="small">' + L('Disponible desde el viernes 21 nov a las 00:00.', 'Available from Friday, Nov 21 at 00:00.') + '</span></div>';
    } else if (acc.when === 'after') {
      box = '<div class="code-box"><span class="locked lock">' + lockIcon + L('Tu estadía terminó', 'Your stay has ended') + '</span><span class="code" aria-label="oculto / hidden">• • • •</span><span class="small">' + L('Los códigos se ocultan 2 horas después de la salida.', 'Codes are hidden 2 hours after checkout.') + '</span></div>';
    } else if (acc.verify === 'yes' && !acc.verified) {
      box = '<div class="code-box"><b>' + L('Confirma tu reserva', 'Confirm your booking') + '</b><span class="small">' + L('El código de 6 caracteres está en los mensajes de tu reserva.', 'The 6-character code is in your booking messages.') + '</span><span class="field mono" style="letter-spacing:.2em">K7P · Q2M</span><button class="btn" type="button" data-acc="verify" style="min-height:38px">' + L('Confirmar', 'Confirm') + '</button><span class="small">' + L('5 intentos; luego una pausa de 15 minutos.', '5 tries, then a 15-minute pause.') + '</span></div>';
    } else if (!acc.shown) {
      box = '<div class="code-box"><span class="locked lock">' + lockIcon + L('Código de la caja de llaves', 'Key box code') + '</span><button class="btn" type="button" data-acc="show" style="min-height:38px">' + L('Mostrar código', 'Show code') + '</button></div>';
    } else {
      box = '<div class="code-box"><span class="small">' + L('Código de la caja de llaves', 'Key box code') + '</span><span class="code num">4815</span><span class="small">' + L('Tu anfitrión puede ver cuándo se mostró el código.', 'Your host can see when the code was viewed.') + '</span></div>';
    }
    html += box;
    var el = $('#accessScreen');
    el.innerHTML = html;
    el.classList.remove('anim'); void el.offsetWidth; el.classList.add('anim');
  }
  $('#accessScreen').addEventListener('click', function (e) {
    var b = e.target.closest('[data-acc]');
    if (!b) return;
    if (b.getAttribute('data-acc') === 'verify') acc.verified = true;
    if (b.getAttribute('data-acc') === 'show') acc.shown = true;
    renderAccess();
  });
  renderAccess();

  /* ---------------- Message pipeline (specs 005, 007, 011) ---------------- */
  var PASS_LIMITS = ['Guardado. Dentro del límite: 20 mensajes cada 10 minutos y 2.000 caracteres.', 'Stored. Within limits: 20 messages per 10 minutes and 2,000 characters.'];
  var PASS_BUDGET = ['Quedan respuestas en el plan del mes y en el presupuesto diario de la propiedad.', 'Replies remain in the month\'s plan and the property\'s daily budget.'];
  var SKIP_MODEL = ['No se llama al modelo para responder.', 'No model call is made to answer.'];
  var SKIP = ['—', '—'];
  var SCENARIOS = [
    { id: 'ac', label: ['¿Cómo se enciende el aire?', 'How do I turn on the AC?'],
      q: ['¿Cómo se enciende el aire del cuarto?', 'How do I turn on the bedroom AC?'],
      steps: [['pass', PASS_LIMITS], ['pass', PASS_BUDGET],
        ['pass', ['Tema: electrodomésticos · intención: cómo usar · idioma: español · riesgo: bajo.', 'Topic: appliances · intent: how to use · language: English · risk: low.']],
        ['pass', ['No hay que escalar. Electrodomésticos está en «Responde si está en la guía».', 'No escalation needed. Appliances is set to "Answers if it\'s in the guide".']],
        ['pass', ['Respuesta con la sección Electrodomésticos, desde el contexto en caché.', 'Answer from the Appliances section, using the cached context.']],
        ['pass', ['Cita una sección publicada · sin códigos ni enlaces nuevos · sin promesas · sin pedir salir de la plataforma.', 'Cites a published section · no new codes or links · no promises · no off-platform requests.']],
        ['pass', ['Se muestra al huésped. Traza: secciones, tema, revisiones, modelo, tokens y costo.', 'Shown to the guest. Trace: sections, topic, checks, model, tokens, and cost.']]],
      outcome: ['ok', ['Respondida sola, en segundos', 'Answered on its own, in seconds'], ['Emily tiene la respuesta y la sección de donde salió.', 'Emily has the answer and the section it came from.']],
      reply: ['a', ['El control está en la mesa de noche. Presiona el botón de encendido y elige 22 °C con las flechas; enfría en un par de minutos.', 'The remote is on the nightstand. Press the power button and set 22 °C with the arrows; it cools in a couple of minutes.'], ['De: Electrodomésticos', 'From: Appliances']] },
    { id: 'code', label: ['¿Cuál es el código?', 'What\'s the door code?'],
      q: ['¿Cuál es el código de la puerta?', 'What\'s the door code?'],
      steps: [['pass', PASS_LIMITS], ['pass', PASS_BUDGET],
        ['pass', ['Tema: llegada y acceso · intención: pedir un código · riesgo: dato sensible.', 'Topic: arrival and access · intent: asks for a code · risk: sensitive data.']],
        ['stop', ['Pedido de código: nunca lo responde el modelo. El modelo ni siquiera conoce el valor.', 'Code request: never answered by the model. The model doesn\'t even know the value.']],
        ['skip', SKIP_MODEL], ['skip', SKIP],
        ['pass', ['Respuesta fija que indica la sección, y la conversación queda marcada para el anfitrión.', 'A fixed reply that points to the section, and the conversation is flagged for the host.']]],
      outcome: ['esc', ['Nunca dice el código', 'Never states the code'], ['El código solo aparece en Llegada y acceso, para el huésped verificado y dentro de su estadía.', 'The code only appears in Arrival and access, for the verified guest, inside the stay.']],
      reply: ['a', ['Por seguridad no comparto códigos en el chat. Los ves en Llegada y acceso con «Mostrar código», durante tu estadía.', 'For safety I don\'t share codes in the chat. You\'ll find them in Arrival and access with "Show code", during your stay.'], ['Ir a: Llegada y acceso', 'Go to: Arrival and access']] },
    { id: 'gas', label: ['Huele a gas', 'I smell gas'],
      q: ['Huele a gas en la cocina.', 'I smell gas in the kitchen.'],
      steps: [['pass', PASS_LIMITS], ['pass', PASS_BUDGET],
        ['pass', ['Tema: emergencia · riesgo: alto.', 'Topic: emergency · risk: high.']],
        ['stop', ['Escalamiento obligatorio: emergencia y seguridad, con cualquier autonomía.', 'Mandatory escalation: emergency and safety, at any autonomy.']],
        ['skip', SKIP_MODEL], ['skip', SKIP],
        ['pass', ['Tarjeta de emergencia primero, luego la respuesta de espera. Correo y push a todo el equipo, aunque sean horas de silencio.', 'Emergency card first, then the holding reply. Email and push to the whole team, even during quiet hours.']]],
      outcome: ['emerg', ['Emergencia: primero los números', 'Emergency: numbers first'], ['El 911 y el contacto de emergencia de Ana aparecen antes que cualquier texto.', '911 and Ana\'s emergency contact appear before any text.']],
      reply: ['emerg'] },
    { id: 'refund', label: ['¿Nos devuelven una noche?', 'Refund one night?'],
      q: ['¿Nos pueden devolver una noche?', 'Can you refund us one night?'],
      steps: [['pass', PASS_LIMITS], ['pass', PASS_BUDGET],
        ['pass', ['Tema: reembolso · intención: dinero · sentimiento: neutro.', 'Topic: refund · intent: money · sentiment: neutral.']],
        ['stop', ['Escalamiento obligatorio: reembolsos y pagos. El asistente nunca promete nada.', 'Mandatory escalation: refunds and payments. The assistant never promises anything.']],
        ['skip', SKIP_MODEL], ['skip', SKIP],
        ['pass', ['Respuesta de espera al huésped; correo y push a los contactos de escalamiento.', 'A holding reply to the guest; email and push to the escalation contacts.']]],
      outcome: ['esc', ['Pasa al anfitrión', 'Goes to the host'], ['Cambios de reserva y dinero se resuelven en la plataforma, con una persona.', 'Booking changes and money are handled on the platform, by a person.']],
      reply: ['hold'] },
    { id: 'beach', label: ['¿Qué playa nos recomiendas?', 'Which beach do you recommend?'],
      q: ['¿Qué playa nos recomiendas para ir con niños?', 'Which beach do you recommend with kids?'],
      steps: [['pass', PASS_LIMITS], ['pass', PASS_BUDGET],
        ['pass', ['Tema: recomendaciones locales · riesgo: bajo.', 'Topic: local recommendations · risk: low.']],
        ['pass', ['No hay que escalar. El tema está en «Reviso cada respuesta» (borrador).', 'No escalation needed. The topic is set to "I review every reply" (draft).']],
        ['pass', ['Borrador con la sección Recomendaciones locales.', 'A draft from the Local recommendations section.']],
        ['pass', ['Pasa las revisiones y queda como borrador para el equipo.', 'It passes the checks and waits as a draft for the team.']],
        ['pass', ['Respuesta de espera al huésped; el borrador espera en la bandeja para enviar, editar o descartar.', 'A holding reply to the guest; the draft waits in the inbox to send, edit, or discard.']]],
      outcome: ['draft', ['Borrador para aprobar', 'Draft to approve'], ['Ana lo envía con un toque. Tras 5 envíos sin cambios, la bandeja sugiere subir de escalón.', 'Ana sends it with one tap. After 5 unchanged sends, the inbox suggests moving up a rung.']],
      reply: ['hold'] },
    { id: 'limit', label: ['Plan sin respuestas este mes', 'Plan out of replies'],
      q: ['¿A qué hora es la salida?', 'What time is checkout?'],
      steps: [['pass', PASS_LIMITS],
        ['stop', ['Se alcanzó el límite mensual del plan: no se llama al modelo.', 'The plan\'s monthly limit is reached: no model call is made.']],
        ['skip', SKIP], ['skip', SKIP], ['skip', SKIP_MODEL], ['skip', SKIP],
        ['pass', ['Respuesta de espera; la conversación espera al anfitrión con el motivo «límite mensual».', 'A holding reply; the conversation waits for the host with the reason "monthly limit".']]],
      outcome: ['esc', ['Límite del plan', 'Plan limit'], ['Los dueños reciben un correo al 80% y otro al 100% del mes.', 'Owners get one email at 80% and one at 100% of the month.']],
      reply: ['hold'] }
  ];
  var scenario = SCENARIOS[0];
  $('#scenarioChips').innerHTML = SCENARIOS.map(function (s, i) {
    return '<button class="chip" type="button" aria-pressed="' + (i === 0 ? 'true' : 'false') + '" data-sc="' + s.id + '">' + L(s.label[0], s.label[1]) + '</button>';
  }).join('');
  $$('#scenarioChips .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      $$('#scenarioChips .chip').forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
      scenario = SCENARIOS.filter(function (s) { return s.id === c.getAttribute('data-sc'); })[0];
      runPipeline();
    });
  });
  $('#pipeReplay').addEventListener('click', function () { runPipeline(); });

  var HOLD = ['Ya le avisé a Ana. Te responderá aquí lo antes posible.', 'I\'ve let Ana know. She\'ll reply here as soon as she can.'];
  function replyHtml(s) {
    var r = s.reply;
    if (r[0] === 'a') return '<span class="bubble-a">' + L(r[1][0], r[1][1]) + '<span class="from">' + L(r[2][0], r[2][1]) + '</span></span>';
    if (r[0] === 'emerg') return '<div class="emerg-card"><span>' + L('Emergencia', 'Emergency') + '</span><span class="big">' + L('Llamar al 911', 'Call 911') + '</span><span>' + L('Contacto de emergencia de Ana', 'Ana\'s emergency contact') + '</span></div><span class="bubble-a">' + L(HOLD[0], HOLD[1]) + '</span>';
    return '<span class="bubble-a">' + L(HOLD[0], HOLD[1]) + '</span>';
  }
  function runPipeline() {
    clearTimers();
    var s = scenario;
    var items = $$('#pipeline li');
    items.forEach(function (li) { li.className = ''; $('.res', li).innerHTML = ''; });
    $('#pipeChat').innerHTML = '<span class="bubble-g">' + L(s.q[0], s.q[1]) + '</span>';
    var out = $('#pipeOutcome');
    out.className = 'outcome'; out.innerHTML = '<span class="small">' + L('Procesando…', 'Processing…') + '</span>';
    function finish() {
      $('#pipeChat').innerHTML += replyHtml(s);
      out.className = 'outcome ' + s.outcome[0];
      out.innerHTML = '<b>' + L(s.outcome[1][0], s.outcome[1][1]) + '</b><span>' + L(s.outcome[2][0], s.outcome[2][1]) + '</span>';
    }
    function apply(i) {
      var st = s.steps[i];
      items[i].className = st[0];
      $('.res', items[i]).innerHTML = L(st[1][0], st[1][1]);
    }
    if (reduceMotion.matches) { s.steps.forEach(function (_, i) { apply(i); }); finish(); return; }
    s.steps.forEach(function (st, i) {
      later(function () {
        items[i].className = 'on';
        $('.res', items[i]).innerHTML = L(st[1][0], st[1][1]);
        later(function () { apply(i); }, 340);
      }, 220 + i * 520);
    });
    later(finish, 220 + s.steps.length * 520 + 200);
  }
  onEnter['flujo-mensaje'] = runPipeline;

  /* ---------------- Autonomy ladder (spec 007) ---------------- */
  var TOPICS = [
    ['arrival', 'Llegada y acceso', 'Arrival and access'], ['wifi', 'Wi-Fi', 'Wi-Fi'], ['house_rules', 'Normas de la casa', 'House rules'],
    ['appliances', 'Electrodomésticos', 'Appliances'], ['amenities', 'Comodidades', 'Amenities'], ['parking', 'Parqueo', 'Parking'],
    ['local_recommendations', 'Recomendaciones locales', 'Local recommendations'], ['emergency', 'Información de seguridad', 'Safety information'],
    ['checkout', 'Salida', 'Checkout'], ['other', 'Otras preguntas', 'Other questions']
  ];
  var LEVELS = [['draft', 'Reviso cada respuesta', 'I review every reply'], ['auto', 'Responde si está en la guía', 'Answers if it\'s in the guide'], ['full_auto', 'Responde y pregunta solo', 'Answers and asks on its own']];
  var autonomy = {};
  TOPICS.forEach(function (t) { autonomy[t[0]] = 'draft'; });
  autonomy.wifi = 'auto'; autonomy.appliances = 'auto';
  function buildTopicRows() {
    $('#topicRows').innerHTML = TOPICS.map(function (t) {
      var opts = LEVELS.map(function (l) {
        return '<option value="' + l[0] + '"' + (autonomy[t[0]] === l[0] ? ' selected' : '') + '>' + (root.getAttribute('data-lang') === 'en' ? l[2] : l[1]) + '</option>';
      }).join('');
      return '<tr><td><label for="aut-' + t[0] + '">' + L(t[1], t[2]) + '</label></td><td><select id="aut-' + t[0] + '" data-topic="' + t[0] + '">' + opts + '</select></td></tr>';
    }).join('');
    paintLadder();
  }
  function paintLadder() {
    $$('#ladder .rung').forEach(function (r) {
      var lvl = r.getAttribute('data-level');
      var n = TOPICS.filter(function (t) { return autonomy[t[0]] === lvl; }).length;
      r.classList.toggle('sel', n > 0);
      var c = $('.cnt', r);
      if (!c) { c = document.createElement('span'); c.className = 'tag cnt'; r.appendChild(c); }
      c.innerHTML = n + ' ' + L(n === 1 ? 'tema' : 'temas', n === 1 ? 'topic' : 'topics');
    });
  }
  $('#topicRows').addEventListener('change', function (e) {
    var sel = e.target.closest('select[data-topic]');
    if (!sel) return;
    autonomy[sel.getAttribute('data-topic')] = sel.value;
    paintLadder();
  });
  buildTopicRows();
  $('#langBtn').addEventListener('click', buildTopicRows);

  /* ---------------- Inbox and copilot (spec 006) ---------------- */
  var INBOX = {
    needs: [
      ['danger', ['Posible emergencia', 'Possible emergency'], 'Casa Colibrí · Emily', '7:15 pm'],
      ['info', ['Borrador listo', 'Draft ready'], 'Casa Colibrí · Emily', '7:32 am'],
      ['warn', ['Necesita al anfitrión', 'Needs the host'], 'Loft Tamarindo · Tom', '9:02 am']
    ],
    all: [
      ['danger', ['Posible emergencia', 'Possible emergency'], 'Casa Colibrí · Emily', '7:15 pm'],
      ['info', ['Borrador listo', 'Draft ready'], 'Casa Colibrí · Emily', '7:32 am'],
      ['warn', ['Necesita al anfitrión', 'Needs the host'], 'Loft Tamarindo · Tom', '9:02 am'],
      ['ok', ['Respondida sola', 'Answered alone'], 'Casa Colibrí · Emily', '11:05 pm'],
      ['', ['Marta está respondiendo', 'Marta is replying'], 'Loft Tamarindo · Lucía', '8:40 am']
    ],
    done: [['ok', ['Lista', 'Done'], 'Loft Tamarindo · Lucía', '8:51 am']]
  };
  function renderInbox(key) {
    $('#inboxList').innerHTML = INBOX[key].map(function (r) {
      return '<div class="mini-row"><span class="l"><b>' + r[2] + '</b><br><span class="small">' + r[3] + '</span></span><span class="tag ' + r[0] + '">' + L(r[1][0], r[1][1]) + '</span></div>';
    }).join('');
  }
  $$('#inboxTabs .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      $$('#inboxTabs .chip').forEach(function (o) { o.setAttribute('aria-selected', o === c ? 'true' : 'false'); });
      renderInbox(c.getAttribute('data-v'));
    });
  });
  renderInbox('needs');
  $('#copilotBtn').addEventListener('click', function () {
    var out = $('#copilotOut');
    out.innerHTML = '<span class="small">' + L('Redactando con la guía…', 'Drafting from the guide…') + '</span>';
    later(function () {
      out.innerHTML =
        '<span class="bubble-a" style="max-width:100%">Hi! Yes, both bedrooms have air conditioning, and the guide explains how to use it once you book. Happy to answer anything else here in the chat.</span>' +
        '<div class="row" style="gap:6px"><span class="tag ok">' + L('Pasó las revisiones', 'Passed checks') + '</span><span class="tag">' + L('Sección: Comodidades', 'Section: Amenities') + '</span></div>' +
        '<span class="note" style="max-width:none">' + L('Quitamos los datos de contacto: antes de reservar, todo queda en el chat de la plataforma.', 'We removed the contact details: before booking, everything stays in the platform chat.') + '</span>' +
        '<span class="mini-btn" style="width:fit-content">' + L('Copiar respuesta', 'Copy reply') + '</span>';
    }, reduceMotion.matches ? 0 : 900);
  });

  /* ---------------- Payment split (spec 013) ---------------- */
  var feePct = 10;
  function paintFee() {
    var price = Number($('#feePrice').value);
    var fee = Math.round(price * feePct) / 100;
    // Tilopay's card fee as the founder reported it (OQ-37): 4.2% plus USD 0.30, in cents.
    var prov = Math.round(price * 4.2 + 30) / 100;
    var host = price - fee - prov;
    $('#feePriceOut').textContent = 'USD ' + price;
    $('#lgPrice').textContent = money(price);
    $('#lgFee').textContent = '− ' + money(fee);
    $('#lgProv').textContent = '− ' + money(prov);
    $('#lgHost').textContent = money(host);
    var provPct = prov / price * 100, hostPct = 100 - feePct - provPct;
    var bh = $('#barHost'), bf = $('#barFee'), bp = $('#barProv');
    bh.style.flexGrow = hostPct; bh.textContent = hostPct.toFixed(1) + '%';
    bf.style.flexGrow = feePct; bf.textContent = feePct + '%';
    bp.style.flexGrow = provPct; bp.textContent = provPct.toFixed(1) + '%';
  }
  $('#feePrice').addEventListener('input', paintFee);
  $$('#feePlan .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      $$('#feePlan .chip').forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
      feePct = Number(c.getAttribute('data-v'));
      paintFee();
    });
  });
  paintFee();

  /* ---------------- Unit economics (business model §4) ---------------- */
  var withPro = false;
  function paintUE() {
    var stays = Number($('#ueStays').value), replies = Number($('#ueReplies').value);
    var tour = Number($('#ueTour').value) / 100, addon = Number($('#ueAddon').value) / 100;
    $('#ueStaysOut').textContent = stays; $('#ueRepliesOut').textContent = replies;
    $('#ueTourOut').textContent = Math.round(tour * 100) + '%'; $('#ueAddonOut').textContent = Math.round(addon * 100) + '%';
    var tourRev = stays * tour * 120 * 0.08;
    // Fee on extras by plan, confirmed 2026-11-19: Free 10%, Pro 7%.
    var addonFee = withPro ? 0.07 : 0.10;
    var addonRev = stays * addon * 35 * addonFee;
    var aiLo = stays * replies * 0.03, aiHi = stays * replies * 0.11;
    var subLo = withPro ? 9 : 0, subHi = withPro ? 12 : 0;
    var revLo = tourRev + addonRev + subLo, revHi = tourRev + addonRev + subHi;
    var netLo = revLo - aiHi, netHi = revHi - aiLo;
    $('#ueTourV').textContent = money(tourRev);
    $('#ueAddonV').textContent = money(addonRev);
    $('#ueAddonRate').textContent = Math.round(addonFee * 100) + '%';
    $('#ueSubRow').hidden = !withPro;
    $('#ueAiV').textContent = '− ' + money(aiLo) + '–' + aiHi.toFixed(2);
    function signed(n) { return (n < 0 ? '− ' : '') + 'USD ' + Math.abs(n).toFixed(2); }
    $('#ueNetV').textContent = signed(netLo) + ' … ' + signed(netHi);
    $('#ueNetV').style.color = netLo < 0 ? 'var(--danger)' : '';
  }
  ['#ueStays', '#ueReplies', '#ueTour', '#ueAddon'].forEach(function (id) { $(id).addEventListener('input', paintUE); });
  $$('#uePlan .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      $$('#uePlan .chip').forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
      withPro = c.getAttribute('data-v') === 'pro';
      paintUE();
    });
  });
  paintUE();

  /* ---------------- Architecture (clickable) ---------------- */
  var NODES = {
    portal: [['Portal del anfitrión', 'Host portal'], ['Next.js con App Router y Tailwind. Web app instalable con alertas push (ADR-0006): alta de propiedades, guías, bandeja, ajustes, extras, estadísticas y pagos. Presupuesto de 175 KB de JavaScript por ruta.', 'Next.js with the App Router and Tailwind. An installable web app with push alerts (ADR-0006): onboarding, guides, inbox, settings, extras, analytics, and payouts. A 175 KB JavaScript budget per route.']],
    guide: [['Guía del huésped', 'Guest guide'], ['React renderizado en el servidor y sin hidratar, en Lambda detrás de su propia distribución de CloudFront (ADR-0010). Un script de 2.7 KB y un service worker para leer sin conexión. Origen propio, así las cookies del huésped no se comparten.', 'React rendered on the server and never hydrated, on Lambda behind its own CloudFront distribution (ADR-0010). A 2.7 KB script and a service worker for offline reading. Its own origin, so guest cookies are never shared.']],
    api: [['API', 'API'], ['NestJS sobre Fastify con contratos Zod y OpenAPI. Autenticación con Better Auth, inquilinos, guías, chat, extras, pagos y redirecciones de afiliados. Fija el workspace en cada transacción para que actúe la RLS.', 'NestJS on Fastify with Zod and OpenAPI contracts. Better Auth sign-in, tenancy, guides, chat, extras, payments, and affiliate redirects. It sets the workspace in every transaction so RLS applies.']],
    worker: [['Worker', 'Worker'], ['Node.js con pg-boss: respuestas del asistente, traducciones, extracción de documentos, calendarios iCal, importaciones del PMS, refresco de Explorar, avisos y resúmenes de horas de silencio.', 'Node.js with pg-boss: assistant replies, translations, document extraction, iCal calendars, PMS imports, Explore refreshes, alerts, and quiet-hours digests.']],
    sandbox: [['Sandbox', 'Sandbox'], ['Dos funciones Lambda fuera de la VPC (feed-reader y file-processor): las únicas que descargan enlaces del anfitrión o leen archivos subidos. Solo HTTPS, sin rutas a redes internas, con límites de tamaño y tiempo (SEC-09, SEC-10).', 'Two Lambda functions outside the VPC (feed-reader and file-processor): the only code that fetches host links or parses uploaded files. HTTPS only, no route to internal networks, with size and time limits (SEC-09, SEC-10).']],
    db: [['PostgreSQL 16', 'PostgreSQL 16'], ['Amazon RDS. Sistema de registro con RLS en cada tabla de inquilino, cola de trabajos (pg-boss) y pgvector más adelante. Recuperación a un punto en el tiempo: RPO de 15 minutos y RTO de 4 horas.', 'Amazon RDS. The system of record with RLS on every tenant table, the job queue (pg-boss), and pgvector later. Point-in-time recovery: RPO 15 minutes, RTO 4 hours.']],
    s3: [['S3', 'S3'], ['Buckets privados. Las subidas llegan con formularios prefirmados y pasan un escaneo de malware; los medios limpios se sirven con URLs firmadas de 15 minutos.', 'Private buckets. Uploads arrive through presigned forms and pass a malware scan; clean media is served through 15-minute signed URLs.']],
    kms: [['KMS y Secrets Manager', 'KMS and Secrets Manager'], ['Cifrado por campo: claves de datos por workspace envueltas por una clave maestra fuera de la base. Códigos, enlaces de calendario y credenciales del PMS solo existen cifrados; la base y los respaldos guardan texto cifrado.', 'Field-level encryption: per-workspace data keys wrapped by a master key outside the database. Codes, calendar links, and PMS credentials exist only encrypted; the database and backups hold ciphertext.']],
    claude: [['Claude API', 'Claude API'], ['Detrás de LlmPort, así el proveedor se puede cambiar. claude-opus-5-5 con esfuerzo por ruta, caché del contexto de la propiedad y traza de costo por mensaje.', 'Behind LlmPort, so the provider can change. claude-opus-5-5 with effort per route, a cached property context, and a cost trace per message.']],
    pay: [['Proveedor de pagos', 'Payment provider'], ['Detrás de PaymentPort. Hoy, un proveedor simulado para desarrollo y pruebas, rechazado en producción. Tilopay cuando existan la entidad legal y la cuenta (ADR-0007).', 'Behind PaymentPort. Today a simulated provider for development and tests, refused in production. Tilopay once the legal entity and account exist (ADR-0007).']],
    notify: [['Correo y push', 'Email and push'], ['Amazon SES con plantillas React Email en español e inglés, y web push (VAPID) a los dispositivos del equipo. Los trabajos llevan solo IDs; los avisos nunca incluyen texto del huésped.', 'Amazon SES with React Email templates in Spanish and English, and web push (VAPID) to the team\'s devices. Jobs carry IDs only; alerts never include guest text.']],
    tours: [['Socios de tours', 'Tour partners'], ['Viator por su API de afiliados, llamada solo por el worker y guardada una hora como máximo, y una lista curada de Civitatis. Las páginas del huésped nunca llaman a un socio.', 'Viator through its affiliate API, called only by the worker and kept an hour at most, plus a curated Civitatis list. Guest pages never call a partner.']],
    pms: [['PMS', 'PMS'], ['Importación de solo lectura con el token del cliente: Beds24 y Hostex en el MVP. Responder dentro de las plataformas a través del PMS llega en la fase 2 (Hospitable y Hostaway primero).', 'Read-only import with the customer\'s token: Beds24 and Hostex in the MVP. Answering inside the platforms through the PMS comes in Phase 2 (Hospitable and Hostaway first).']],
    ota: [['OTA (Airbnb, Booking.com, Vrbo)', 'OTA (Airbnb, Booking.com, Vrbo)'], ['En el MVP no hay conexión por API con las plataformas. El anfitrión envía el enlace con sus mensajes programados y comparte la URL iCal para las fechas. Nada de scraping ni contraseñas compartidas.', 'In the MVP there is no API connection to the platforms. The host sends the link through scheduled messages and shares the iCal URL for dates. No scraping, no shared passwords.']]
  };
  var TRACES = {
    question: [['guide', 'El huésped envía la pregunta desde el chat de la guía.', 'The guest sends the question from the guide chat.'],
      ['api', 'La API revisa los límites y guarda el mensaje.', 'The API checks the limits and stores the message.'],
      ['db', 'Se encola el trabajo chat.reply en PostgreSQL.', 'The chat.reply job is queued in PostgreSQL.'],
      ['worker', 'El worker revisa el presupuesto, pide la clasificación y aplica la política.', 'The worker checks the budget, asks for the classification, and applies the policy.'],
      ['claude', 'Claude clasifica y, si se permite, responde con la guía en caché.', 'Claude classifies and, when allowed, answers from the cached guide.'],
      ['db', 'Se guarda la respuesta o el borrador, con su traza y su costo.', 'The reply or draft is stored with its trace and cost.'],
      ['guide', 'La guía consulta cada 1,5 segundos y muestra la respuesta revisada.', 'The guide polls every 1.5 seconds and shows the checked reply.'],
      ['notify', 'Si hace falta el anfitrión: correo y push, sin texto del huésped.', 'If the host is needed: email and push, with no guest text.']],
    guide: [['guide', 'CloudFront entrega la página publicada desde su caché; casi nunca llega a la API.', 'CloudFront serves the published page from its cache; it rarely reaches the API.'],
      ['api', 'Para ver un código, la guía llama a la API con la cookie de la estadía.', 'To show a code, the guide calls the API with the stay cookie.'],
      ['db', 'La API comprueba la estadía y la ventana de fechas.', 'The API checks the stay and its date window.'],
      ['kms', 'El servicio de revelado descifra el valor con la clave del workspace.', 'The reveal service decrypts the value with the workspace key.'],
      ['db', 'Registra quién vio el código y cuándo, en un registro que no se puede editar.', 'It records who viewed the code and when, in an append-only log.'],
      ['guide', 'Muestra el código con Cache-Control: no-store.', 'It shows the code with Cache-Control: no-store.']],
    payment: [['guide', 'El huésped toca «Pagar» en un extra confirmado.', 'The guest taps "Pay" on a confirmed extra.'],
      ['api', 'La API crea el checkout con el monto guardado en la solicitud.', 'The API starts the checkout with the amount stored on the request.'],
      ['pay', 'El huésped paga en la página alojada del proveedor.', 'The guest pays on the provider\'s hosted page.'],
      ['api', 'Llega un evento firmado: se verifica y se registra una sola vez.', 'A signed event arrives: verified and recorded once.'],
      ['db', 'El pedido pasa a pagado, con la comisión y la parte del anfitrión.', 'The order becomes paid, with the fee and the host\'s share.'],
      ['notify', 'El equipo recibe el aviso por correo.', 'The team gets the email notice.']],
    import: [['portal', 'El dueño pega el token de su PMS, después de reautenticarse.', 'The owner pastes their PMS token, after re-authenticating.'],
      ['api', 'La API verifica el token en modo solo lectura.', 'The API checks the token in read-only mode.'],
      ['kms', 'La credencial se cifra antes de guardarse.', 'The credential is encrypted before it is stored.'],
      ['worker', 'Un trabajo importa propiedades, anuncios y reservas próximas.', 'A job imports properties, listings, and upcoming reservations.'],
      ['pms', 'Lee del PMS sin escribir nada.', 'It reads from the PMS without writing anything.'],
      ['db', 'Crea propiedades y estadías; los códigos pasan directo a campos cifrados.', 'It creates properties and stays; codes go straight to encrypted fields.'],
      ['notify', 'Avisa «importación terminada» en el portal y por correo.', 'It announces "import finished" in the portal and by email.']]
  };
  function showNode(key) {
    var n = NODES[key];
    $$('#arch .arch-node').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-node') === key ? 'true' : 'false'); });
    $('#archDetail').innerHTML = '<p class="h3">' + L(n[0][0], n[0][1]) + '</p><p>' + L(n[1][0], n[1][1]) + '</p>';
  }
  function resetTrace() {
    $$('#arch .arch-node').forEach(function (b) { b.classList.remove('lit', 'was'); $('.hop', b).textContent = ''; });
  }
  $$('#arch .arch-node').forEach(function (b) {
    b.addEventListener('click', function () { clearTimers(); resetTrace(); $$('#traceChips .chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); }); showNode(b.getAttribute('data-node')); });
  });
  function runTrace(key) {
    clearTimers(); resetTrace();
    $$('#arch .arch-node').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    var steps = TRACES[key];
    var list = '<ol class="small" style="color:var(--text)" id="traceList">' + steps.map(function (s, i) {
      return '<li data-i="' + i + '">' + L(s[1], s[2]) + '</li>';
    }).join('') + '</ol>';
    var chip = $('#traceChips [data-trace="' + key + '"]');
    var title = L(esc($('.es', chip).textContent), esc($('.en', chip).textContent));
    $('#archDetail').innerHTML = '<p class="h3">' + title + '</p>' + list;
    var lis = $$('#traceList li');
    function mark(i) {
      var node = $('#arch [data-node="' + steps[i][0] + '"]');
      $$('#arch .arch-node.lit').forEach(function (b) { b.classList.remove('lit'); b.classList.add('was'); });
      var hop = $('.hop', node);
      hop.textContent = hop.textContent ? hop.textContent + '·' + (i + 1) : String(i + 1);
      node.classList.add('lit');
      lis.forEach(function (li, j) { li.style.opacity = j <= i ? '1' : '0.4'; li.style.fontWeight = j === i ? '700' : '400'; });
    }
    if (reduceMotion.matches) {
      steps.forEach(function (_, i) { mark(i); });
      $$('#arch .arch-node.lit').forEach(function (b) { b.classList.remove('lit'); b.classList.add('was'); });
      lis.forEach(function (li) { li.style.opacity = '1'; li.style.fontWeight = '400'; });
      return;
    }
    steps.forEach(function (_, i) { later(function () { mark(i); }, 150 + i * 900); });
    later(function () {
      $$('#arch .arch-node.lit').forEach(function (b) { b.classList.remove('lit'); b.classList.add('was'); });
      lis.forEach(function (li) { li.style.fontWeight = '400'; });
    }, 150 + steps.length * 900);
  }
  $$('#traceChips .chip').forEach(function (c) {
    c.setAttribute('aria-pressed', 'false');
    c.addEventListener('click', function () {
      $$('#traceChips .chip').forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
      runTrace(c.getAttribute('data-trace'));
    });
  });
  showNode('api');
  onEnter.arquitectura = function () {
    var c = $('#traceChips [data-trace="question"]');
    $$('#traceChips .chip').forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
    runTrace('question');
  };

  /* ---------------- Security controls ---------------- */
  var SEC = [
    [['Acceso del huésped', 'Guest access'], [
      ['SEC-01', 'Dos tipos de enlace', 'Two link types', 'El de la propiedad y el QR muestran solo lo público. El de la estadía usa un token aleatorio de 256 bits que vence 2 horas después de la salida y se puede revocar.', 'The property link and QR show only public content. The stay link uses a random 256-bit token that ends 2 hours after checkout and can be revoked.'],
      ['SEC-02', 'Higiene del token', 'Token hygiene', 'El token se cambia por una cookie HttpOnly del origen de la guía y la dirección queda limpia, con no-referrer y noindex.', 'The token is swapped for an HttpOnly cookie on the guide origin and the address is cleaned, with no-referrer and noindex.'],
      ['SEC-03', 'Contra la fuerza bruta', 'Brute-force protection', 'Código de 6 caracteres sin letras parecidas; 5 fallos pausan 15 minutos, la pausa se duplica hasta 24 horas y se avisa a los dueños.', 'A 6-character code without look-alike letters; 5 failures pause 15 minutes, doubling up to 24 hours, and owners are emailed.'],
      ['SEC-04', 'Nada restringido en caché', 'No caching of restricted data', 'Las respuestas sensibles usan no-store; sin códigos sin conexión en el MVP.', 'Sensitive responses use no-store; no offline codes in the MVP.']]],
    [['Cuentas, datos e inquilinos', 'Accounts, data, and tenants'], [
      ['SEC-05', 'Cuentas protegidas', 'Account protection', 'Sin contraseñas, passkeys, segundo factor obligatorio por encima de 2 propiedades, reautenticación en acciones sensibles, sesiones revocables.', 'Passwordless, passkeys, a required second factor above 2 properties, re-authentication for sensitive actions, revocable sessions.'],
      ['SEC-06', 'Cifrado por campo', 'Field-level encryption', 'Claves por workspace envueltas en KMS; solo tres servicios descifran; los valores nunca llegan a logs ni trazas.', 'Per-workspace keys wrapped in KMS; only three services decrypt; values never reach logs or traces.'],
      ['SEC-14', 'Aislamiento por inquilino', 'Tenant isolation', 'RLS en cada tabla de inquilino; CI falla si una tabla nueva no la tiene; pruebas entre inquilinos.', 'RLS on every tenant table; CI fails if a new one lacks it; cross-tenant tests.'],
      ['SEC-16', 'Registro de auditoría', 'Audit log', 'Tabla de solo agregar: inicios de sesión, roles, conexiones y cada código revelado. El dueño ve quién y cuándo.', 'An append-only table: sign-ins, roles, connections, and every code reveal. Owners see who and when.'],
      ['SEC-17', 'Respaldos', 'Backups', 'Recuperación a un punto en el tiempo, respaldos cifrados y una prueba de restauración cada trimestre.', 'Point-in-time recovery, encrypted backups, and a quarterly restore test.'],
      ['SEC-20', 'Privacidad por defecto', 'Privacy by default', 'Sin datos de contacto de huéspedes de Airbnb; retención por tipo de dato; exportar o borrar en 30 días.', 'No contact data from Airbnb guests; retention per data class; export or delete within 30 days.']]],
    [['IA y abuso', 'AI and abuse'], [
      ['SEC-07', 'Abuso y costo', 'Abuse and cost', 'Límites por huésped, por propiedad al día y por plan al mes; al llegar, respuesta de espera y aviso al anfitrión.', 'Limits per guest, per property per day, and per plan per month; at a limit, a holding reply and a host alert.'],
      ['SEC-08', 'Seguridad del agente', 'Agent safety', 'La clasificación va primero y sin la guía; el texto del huésped se trata como datos; las respuestas automáticas pasan revisiones fijas o quedan como borrador. Evals en CI.', 'Classification runs first without the guide; guest text is framed as data; automatic replies pass fixed checks or become drafts. Evals in CI.']]],
    [['Plataforma, integraciones y pagos', 'Platform, integrations, and payments'], [
      ['SEC-09', 'Descargas aisladas', 'Isolated fetches', 'Los enlaces del anfitrión los descarga una función sin acceso a la red interna, que bloquea rangos privados en cada redirección.', 'Host links are fetched by a function with no internal route that blocks private ranges on every redirect.'],
      ['SEC-10', 'Subidas seguras', 'Safe uploads', 'Tipos verificados por contenido, escaneo de malware, análisis aislado y sin metadatos GPS.', 'Types checked by content, malware scanning, isolated parsing, and GPS metadata stripped.'],
      ['SEC-11', 'Endurecimiento web', 'Web hardening', 'HSTS, CSP con nonce, frame-ancestors none y orígenes separados para portal, guía, contenido y API.', 'HSTS, nonce-based CSP, frame-ancestors none, and separate origins for portal, guide, content, and API.'],
      ['SEC-12', 'Cadena de suministro', 'Supply chain', 'Lockfile, scripts de instalación bloqueados, espera mínima de versiones nuevas, CodeQL, escaneo de secretos y acciones fijadas por SHA.', 'Lockfile, blocked install scripts, a minimum release age, CodeQL, secret scanning, and SHA-pinned actions.'],
      ['SEC-13', 'Integraciones', 'Integrations', 'Credenciales del PMS cifradas con alcance mínimo; contenido de socios tratado como no confiable; redirección sin open redirect.', 'PMS credentials encrypted with minimum scope; partner content treated as untrusted; redirects without open redirects.'],
      ['SEC-21', 'Pagos', 'Payments', 'Solo checkout alojado (SAQ A), pedido pagado solo con evento verificado, reembolsos con reautenticación y auditados.', 'Hosted checkout only (SAQ A), orders paid only on a verified event, refunds re-authenticated and audited.']]],
    [['Antes del lanzamiento público', 'Before public launch'], [
      ['SEC-15', 'Acceso interno', 'Internal access', 'Soporte solo con consentimiento del anfitrión, por tiempo limitado y auditado; sin acceso permanente a producción.', 'Support only with host consent, time-boxed and audited; no standing production access.'],
      ['SEC-18', 'Respuesta a incidentes', 'Incident response', 'Manual de incidentes, plazos de notificación y política de divulgación.', 'An incident runbook, notification deadlines, and a disclosure policy.'],
      ['SEC-19', 'Verificación externa', 'Assurance', 'Lista OWASP ASVS L2 por spec y una prueba de penetración externa antes del lanzamiento.', 'An OWASP ASVS L2 checklist per spec and an external penetration test before launch.']]]
  ];
  $('#secGroups').innerHTML = SEC.map(function (g) {
    return '<div class="sec-group" data-build><p class="h3">' + L(g[0][0], g[0][1]) + '</p>' + g[1].map(function (c) {
      return '<button class="sec-item" type="button" aria-expanded="false"><span class="tag">' + c[0] + '</span><span><span class="t">' + L(c[1], c[2]) + '</span><span class="d">' + L(c[3], c[4]) + '</span></span></button>';
    }).join('') + '</div>';
  }).join('');
  $$('#secGroups [data-build]').forEach(function (el, i) { el.style.setProperty('--i', i + 2); });
  $('#secGroups').addEventListener('click', function (e) {
    var b = e.target.closest('.sec-item');
    if (b) b.setAttribute('aria-expanded', b.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  });

  /* ---------------- Performance bar and counters ---------------- */
  onEnter.rendimiento = function () {
    var used = $('#jsBar .used');
    used.style.width = '0';
    later(function () { used.style.width = used.getAttribute('data-w') + '%'; }, reduceMotion.matches ? 0 : 200);
  };
  function countUp(el) {
    var to = Number(el.getAttribute('data-count'));
    if (reduceMotion.matches) { el.textContent = to; return; }
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var k = Math.min(1, (ts - start) / 800);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  onEnter.estadisticas = function () { $$('#estadisticas [data-count]').forEach(countUp); };

  /* ---------------- Guided demos ---------------- */
  function tiles(hl) {
    var t = [['Llegada y acceso', 'Arrival and access'], ['Wi-Fi', 'Wi-Fi'], ['Normas de la casa', 'House rules'], ['Electrodomésticos', 'Appliances'], ['Recomendaciones', 'Recommendations'], ['Salida', 'Checkout'], ['Explorar la zona', 'Explore the area'], ['Servicios extra', 'Extras']];
    return '<div class="tiles">' + t.map(function (x, i) { return '<span class="tile' + (i === hl ? ' hl' : '') + '"><span class="ic"></span>' + L(x[0], x[1]) + '</span>'; }).join('') + '</div>';
  }
  var GUEST = [
    { clock: '6:12', title: 'Casa Colibrí', nav: 0, html: function () {
      return '<div class="stay-card"><span class="small">' + L('Tu estadía', 'Your stay') + '</span><b>' + L('21 nov → 28 nov', 'Nov 21 → Nov 28') + '</b><span class="small">' + L('Entrada desde las 3:00 pm', 'Check-in from 3:00 pm') + '</span></div><p class="small">' + L('Todo lo que necesitas para tu estadía.', 'Everything you need for your stay.') + '</p>' + tiles(-1) + '<p class="small">' + L('Sin app ni cuenta · ES / EN', 'No app, no account · ES / EN') + '</p>'; } },
    { clock: '21:40', title: L('Llegada y acceso', 'Arrival and access'), nav: 0, html: function () {
      return '<p>' + L('1. Portón negro a la izquierda del palo de mango.<br>2. La caja de llaves está junto a la puerta.', '1. Black gate to the left of the mango tree.<br>2. The key box is next to the door.') + '</p><div class="code-box"><span class="small">' + L('Código de la caja de llaves', 'Key box code') + '</span><span class="code num">4815</span><span class="small">' + L('Tu anfitrión puede ver cuándo se mostró el código.', 'Your host can see when the code was viewed.') + '</span></div><span class="mini-btn ghost" style="width:fit-content">' + L('Abrir en Maps o Waze', 'Open in Maps or Waze') + '</span>'; } },
    { clock: '23:05', title: L('Pregunta sobre Casa Colibrí', 'Ask about Casa Colibrí'), nav: 3, html: function () {
      return '<p class="small">' + L('Soy el asistente virtual de Casa Colibrí. Respondo con la guía de Ana.', 'I\'m the virtual assistant for Casa Colibrí. I answer from Ana\'s guide.') + '</p><span class="bubble-g">' + L('¿Cómo se enciende el aire del cuarto?', 'How do I turn on the bedroom AC?') + '</span><span class="bubble-a">' + L('El control está en la mesa de noche. Presiona el botón de encendido y elige 22 °C con las flechas.', 'The remote is on the nightstand. Press the power button and set 22 °C with the arrows.') + '<span class="from">' + L('De: Electrodomésticos', 'From: Appliances') + '</span></span>'; } },
    { clock: '23:00', title: L('Pregunta sobre Casa Colibrí', 'Ask about Casa Colibrí'), nav: 3, html: function () {
      return '<span class="bubble-g">' + L('El aire del cuarto está goteando agua.', 'The bedroom AC is leaking water.') + '</span><span class="bubble-a">' + L('Ya le avisé a Ana. Te responderá aquí lo antes posible. Mientras tanto, la guía indica apagar el aire con el control.', 'I\'ve let Ana know. She\'ll reply here as soon as she can. Meanwhile, the guide says to switch the AC off with the remote.') + '</span><span class="bubble-h"><span class="from">Ana · 11:09 pm</span>' + L('Gracias por avisar. Mañana a las 8 llega el técnico.', 'Thanks for letting me know. The technician comes tomorrow at 8.') + '</span>'; } },
    { clock: '8:30', title: L('Explorar', 'Explore'), nav: 1, html: function () {
      return '<div class="disc">' + L('Guidesk podría recibir una comisión si reservas, sin costo extra para ti.', 'Guidesk may earn a commission if you book, at no extra cost to you.') + '</div><b class="small">' + L('Recomendaciones de tu anfitrión', 'Your host\'s tips') + '</b><div class="mini-row"><span class="l">Playa Conchal · ' + L('8 min en carro', '8 min by car') + '</span></div><b class="small">' + L('Experiencias cerca', 'Experiences nearby') + '</b><div class="xp"><span class="ph"></span><span class="m"><b>' + L('Tour de catarata y cacao', 'Waterfall and cacao tour') + '</b><span>' + L('Con Viator · Desde USD 89', 'With Viator · From USD 89') + '</span></span></div><div class="xp"><span class="ph b"></span><span class="m"><b>' + L('Snorkel en la bahía', 'Snorkeling in the bay') + '</b><span>' + L('Con Civitatis · Desde USD 55', 'With Civitatis · From USD 55') + '</span></span></div>'; } },
    { clock: '10:00', title: L('Servicios extra', 'Extras'), nav: 2, html: function () {
      return '<div class="mini-row"><span class="l"><b>' + L('Traslado al aeropuerto', 'Airport pickup') + '</b><br><span class="small">' + L('Ofrecido por tu anfitrión', 'Offered by your host') + '</span></span><b class="num">USD 85</b></div><span class="field">' + L('Fecha: 28 nov · Hora: 6:00 am', 'Date: Nov 28 · Time: 6:00 am') + '</span><span class="status-chip ok">' + L('Confirmada', 'Confirmed') + '</span><span class="small">' + L('Total: USD 85. Incluye los impuestos que cobre tu anfitrión; no hay cargos extra.', 'Total: USD 85. Includes any taxes your host charges; no extra fees.') + '</span><span class="mini-btn">' + L('Pagar USD 85', 'Pay USD 85') + '</span>'; } },
    { clock: '10:20', title: L('Servicios extra', 'Extras'), nav: 2, html: function () {
      return '<span class="small">' + L('Estamos confirmando tu pago con el proveedor…', 'Confirming your payment with the provider…') + '</span><span class="status-chip ok">' + L('Pagado USD 85', 'Paid USD 85') + '</span><span class="small">' + L('Referencia del pago: SIM-4F2A', 'Payment reference: SIM-4F2A') + '</span><div class="disc">' + L('Demo con el proveedor simulado; en producción, Tilopay.', 'Demo on the simulated provider; Tilopay in production.') + '</div>'; } },
    { clock: '19:15', title: L('Pregunta sobre Casa Colibrí', 'Ask about Casa Colibrí'), nav: 3, html: function () {
      return '<span class="bubble-g">' + L('Huele a gas en la cocina.', 'I smell gas in the kitchen.') + '</span><div class="emerg-card"><span>' + L('Emergencia', 'Emergency') + '</span><span class="big">' + L('Llamar al 911', 'Call 911') + '</span><span>' + L('Contacto de emergencia de Ana', 'Ana\'s emergency contact') + '</span></div><span class="bubble-a">' + L('Ya le avisé a Ana. Te responderá aquí lo antes posible.', 'I\'ve let Ana know. She\'ll reply here as soon as she can.') + '</span>'; } },
    { clock: '10:00', title: L('Salida', 'Checkout'), nav: 0, html: function () {
      return '<p>' + L('1. Deja las llaves en la caja.<br>2. Saca la basura al contenedor verde.<br>3. Apaga el aire y cierra las ventanas.', '1. Leave the keys in the box.<br>2. Take the trash to the green bin.<br>3. Switch off the AC and close the windows.') + '</p><div class="code-box"><span class="locked lock">' + lockIcon + L('Código de la caja de llaves', 'Key box code') + '</span><span class="small">' + L('Se oculta 2 horas después de la salida.', 'Hidden 2 hours after checkout.') + '</span></div><p class="small">' + L('Gracias por quedarte en Casa Colibrí.', 'Thank you for staying at Casa Colibrí.') + '</p>'; } }
  ];
  var HOST = [
    { clock: '7:30', title: 'guidesk', nav: 0, html: function () {
      return '<p class="small">' + L('Jueves 27 de noviembre', 'Thursday, November 27') + '</p><div class="push"><span class="who"><i></i>guidesk · ' + L('ahora', 'now') + '</span><b>Casa Colibrí</b><span>' + L('Borrador listo', 'Draft ready') + '</span></div><div class="push"><span class="who"><i></i>guidesk · ' + L('hace 20 min', '20 min ago') + '</span><b>Loft Tamarindo</b><span>' + L('Necesita al anfitrión', 'Needs the host') + '</span></div><p class="small">' + L('Las alertas no incluyen el texto del huésped.', 'Alerts never include the guest\'s text.') + '</p>'; } },
    { clock: '7:32', title: 'Casa Colibrí · Emily', nav: 0, html: function () {
      return '<span class="bubble-g" style="justify-self:start;background:var(--surface);color:var(--text);border:1px solid var(--line)">' + L('¿Qué playa nos recomiendas para ir con niños?', 'Which beach do you recommend with kids?') + '</span><div class="code-box" style="text-align:left"><b class="small">' + L('Borrador', 'Draft') + '</b><span>' + L('Playa Conchal, a 8 minutos en carro: agua tranquila y sombra en la mañana.', 'Playa Conchal, 8 minutes by car: calm water and morning shade.') + '</span><span class="small">' + L('Por qué: Recomendaciones locales · reviso cada respuesta · pasó las revisiones', 'Why: Local recommendations · I review every reply · passed checks') + '</span><div class="row" style="gap:6px"><span class="mini-btn">' + L('Enviar', 'Send') + '</span><span class="mini-btn ghost">' + L('Editar', 'Edit') + '</span><span class="mini-btn ghost">' + L('Descartar', 'Discard') + '</span></div></div>'; } },
    { clock: '9:10', title: L('Copiloto', 'Copilot'), nav: 0, html: function () {
      return '<span class="field" style="color:var(--text)">Hi Ana! Before we book: is there air conditioning in both bedrooms? You can also reach me at my email.</span><div class="row" style="gap:6px"><span class="tag">Casa Colibrí</span><span class="tag info">' + L('Consulta', 'Inquiry') + '</span></div><span class="bubble-a" style="max-width:100%">Hi! Yes, both bedrooms have air conditioning, and the guide explains how to use it once you book.</span><div class="row" style="gap:6px"><span class="tag ok">' + L('Pasó las revisiones', 'Passed checks') + '</span><span class="tag">' + L('Sin datos de contacto', 'No contact details') + '</span></div><span class="mini-btn" style="width:fit-content">' + L('Copiar respuesta', 'Copy reply') + '</span>'; } },
    { clock: '12:00', title: L('Solicitudes', 'Requests'), nav: 1, html: function () {
      return '<div class="mini-row" style="display:grid;gap:6px"><span class="l"><b>' + L('Traslado al aeropuerto', 'Airport pickup') + '</b> · USD 85</span><span class="small">Casa Colibrí · Emily · ' + L('28 nov, 6:00 am', 'Nov 28, 6:00 am') + '</span><span class="small">' + L('Nota: «Somos 4 con 3 maletas.»', 'Note: "We are 4 with 3 suitcases."') + '</span><span class="status-chip wait">' + L('Esperando', 'Waiting') + '</span><div class="row" style="gap:6px"><span class="mini-btn">' + L('Confirmar', 'Confirm') + '</span><span class="mini-btn ghost">' + L('Declinar con motivo', 'Decline with a reason') + '</span></div></div><p class="small">' + L('El primer miembro que responde, decide.', 'The first member to answer decides.') + '</p>'; } },
    { clock: '15:00', title: L('Bandeja', 'Inbox'), nav: 0, html: function () {
      return '<div class="note" style="max-width:none">' + L('Enviaste 5 borradores de Wi-Fi sin cambios en 30 días. ¿Dejas que el asistente responda Wi-Fi solo?', 'You sent 5 Wi-Fi drafts unchanged in 30 days. Let the assistant answer Wi-Fi on its own?') + '</div><div class="row" style="gap:6px"><span class="mini-btn">' + L('Activar', 'Turn on') + '</span><span class="mini-btn ghost">' + L('Ahora no', 'Not now') + '</span></div><div class="mini-row"><span class="l">Wi-Fi</span><span class="status-chip ok">' + L('Responde si está en la guía', 'Answers if in the guide') + '</span></div><p class="small">' + L('Las emergencias, el dinero y los códigos siguen pasando al equipo.', 'Emergencies, money, and codes still go to the team.') + '</p>'; } },
    { clock: '18:00', title: L('Estadísticas', 'Analytics'), nav: 3, html: function () {
      return '<span class="tag warn" style="width:fit-content">' + L('Datos de ejemplo', 'Sample data') + '</span><div class="kpis" style="grid-template-columns:1fr 1fr;gap:6px"><div class="kpi"><span class="v">64%</span><span class="k">' + L('Resueltas solas', 'Resolved alone') + '</span></div><div class="kpi"><span class="v">21</span><span class="k">' + L('Escalamientos', 'Escalations') + '</span></div></div><div class="mini-row"><span class="l">' + L('Sin respuesta: «¿Hay secadora de pelo?»', 'Unanswered: "Is there a hair dryer?"') + '</span></div><span class="status-chip ok">' + L('Agregado a Comodidades · versión 4 publicada', 'Added to Amenities · version 4 published') + '</span>'; } },
    { clock: '22:00', title: L('Asistente del chat', 'Chat assistant'), nav: 2, html: function () {
      return '<div class="mini-row"><span class="l">' + L('Horas de silencio', 'Quiet hours') + '</span><b class="num">10:00 pm – 7:00 am</b></div><p class="small">' + L('Lo no urgente llega en un resumen a las 7:00 am. Las emergencias alertan al instante.', 'Non-urgent alerts arrive in a summary at 7:00 am. Emergencies alert at once.') + '</p><div class="mini-row" style="display:grid;gap:4px"><b>' + L('Pagos · este mes', 'Payouts · this month') + '</b><span class="small">' + L('Pagado USD 85 · comisión de plataforma USD 8.50 (Free)', 'Paid USD 85 · platform fee USD 8.50 (Free)') + '</span></div>'; } }
  ];

  $$('[data-demo]').forEach(function (box) {
    var scenes = box.getAttribute('data-demo') === 'guest' ? GUEST : HOST;
    var stepsBtns = $$('.demo-steps button', box);
    var screen = $('[data-demo-screen]', box);
    var playBtn = $('[data-demo-play]', box);
    var i = 0, playing = null;
    function show(k) {
      i = Math.max(0, Math.min(scenes.length - 1, k));
      var sc = scenes[i];
      $('[data-demo-clock]', box).textContent = sc.clock;
      $('[data-demo-title]', box).innerHTML = sc.title;
      $$('[data-demo-nav] span', box).forEach(function (s, j) { s.classList.toggle('on', j === sc.nav); });
      screen.innerHTML = sc.html();
      screen.classList.remove('anim'); void screen.offsetWidth; screen.classList.add('anim');
      stepsBtns.forEach(function (b, j) { if (j === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    }
    function stop() {
      if (playing) { clearInterval(playing); playing = null; }
      $('use', playBtn).setAttribute('href', '#i-play');
      $$('.es, .en', playBtn).forEach(function (s) { s.textContent = s.classList.contains('es') ? 'Reproducir' : 'Play'; });
    }
    function play() {
      if (i >= scenes.length - 1) show(0);
      $('use', playBtn).setAttribute('href', '#i-pause');
      $$('.es, .en', playBtn).forEach(function (s) { s.textContent = s.classList.contains('es') ? 'Pausar' : 'Pause'; });
      playing = setInterval(function () { if (i >= scenes.length - 1) { stop(); return; } show(i + 1); }, 3600);
    }
    playBtn.addEventListener('click', function () { if (playing) stop(); else play(); });
    $('[data-demo-prev]', box).addEventListener('click', function () { stop(); show(i - 1); });
    $('[data-demo-next]', box).addEventListener('click', function () { stop(); show(i + 1); });
    stepsBtns.forEach(function (b, j) { b.addEventListener('click', function () { stop(); show(j); }); });
    show(0);
    var id = box.closest('.slide').id;
    onLeave[id] = stop;
    onEnter[id] = function () { show(i); };
  });

  /* ---------------- Start ---------------- */
  var startIdx = indexOfId(location.hash.slice(1));
  go(startIdx >= 0 ? startIdx : 0, { fromHash: true });
  if (startIdx < 0) { try { history.replaceState(null, '', '#' + slides[0].id); } catch (e) { /* ignore */ } }
})();
