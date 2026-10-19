(function () {
  var cfg = window.LIBELA_CONFIG;
  var db = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  var root = document.getElementById("app");
  var session = null;
  var cache = { empresas: null, sectores: null };
  var ctx = null; // datos de la ficha abierta

  var ETAPAS = { nueva: "Nueva", contactada: "Contactada", respondio: "Respondió", interesada: "Interesada", reunion: "Reunión", propuesta: "Propuesta", ganada: "Ganada", perdida: "Perdida" };
  var TIPOS = { cliente_directo: "Cliente directo", partner: "Partner", proveedor: "Proveedor" };
  var TIPO_INTER = { email_enviado: "Email enviado", email_recibido: "Email recibido", llamada: "Llamada", linkedin_mensaje: "LinkedIn", linkedin_respuesta: "Respuesta LinkedIn", whatsapp: "WhatsApp", reunion: "Reunión", nota: "Nota" };
  var TIPO_TAREA = { llamada: "Llamada", linkedin: "LinkedIn", email_manual: "Email manual", preparar_propuesta: "Preparar propuesta", reunion: "Reunión", otro: "Otro" };
  var ESTADO_OP = { abierta: "Abierta", ganada: "Ganada", perdida: "Perdida" };
  var CANALES = { "": "—", email: "Email", telefono: "Teléfono", whatsapp: "WhatsApp", linkedin: "LinkedIn" };
  var IDIOMAS = { es: "Español", en: "Inglés" };
  var REPITE = { "": "No se repite", semanal: "Cada semana", mensual: "Cada mes" };

  function esc(s) { return s == null ? "" : String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : null; }
  function fecha(d) { return d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : ""; }
  function dinero(n) { return n == null ? "" : Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function hoy() { return new Date().toLocaleDateString("sv-SE"); }
  function dominioDe(u) {
    if (!u) return null;
    var s = String(u).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/?#]/)[0];
    return s || null;
  }
  function setHtml(html) { root.innerHTML = html; }

  /* ------------------------------------------------------------ avisos y diálogos */
  var toastTimer = null;
  function toast(msg, isErr) {
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.className = isErr ? "err show" : "show";
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = isErr ? "err" : ""; }, 4000);
  }

  function dialog(html) {
    var d = document.createElement("dialog");
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    d.showModal();
    return d;
  }

  function fieldHtml(f, v) {
    var id = "ff_" + f.k, val = v == null ? "" : v, req = f.req ? " required" : "";
    var lab = '<label for="' + id + '">' + esc(f.label) + (f.req ? " *" : "") + '</label>';
    if (f.type === "checkbox") return '<label class="chk"><input type="checkbox" id="' + id + '"' + (v ? " checked" : "") + '> ' + esc(f.label) + '</label>';
    if (f.type === "textarea") return lab + '<textarea id="' + id + '" rows="' + (f.rows || 3) + '"' + req + '>' + esc(val) + '</textarea>';
    if (f.type === "lines") return lab + '<textarea id="' + id + '" rows="3">' + esc((v || []).join("\n")) + '</textarea><span class="hint">Uno por línea</span>';
    if (f.type === "csv") return lab + '<input id="' + id + '" type="text" value="' + esc((v || []).join(", ")) + '"><span class="hint">Separados por comas</span>';
    if (f.type === "select") {
      var o = f.options, keys = Object.keys(o);
      return lab + '<select id="' + id + '"' + req + '>' + keys.map(function (k) { return '<option value="' + esc(k) + '"' + (String(val) === k ? " selected" : "") + '>' + esc(o[k]) + '</option>'; }).join("") + '</select>';
    }
    var t = f.type || "text";
    return lab + '<input id="' + id + '" type="' + t + '"' + (t === "number" ? ' step="any" min="0"' : "") + ' value="' + esc(val) + '"' + req + '>';
  }

  function readField(f) {
    var el = document.getElementById("ff_" + f.k);
    if (f.type === "checkbox") return el.checked;
    var v = el.value.trim();
    if (f.type === "lines") return v ? v.split("\n").map(function (x) { return x.trim(); }).filter(Boolean) : [];
    if (f.type === "csv") return v ? v.split(",").map(function (x) { return x.trim(); }).filter(Boolean) : [];
    if (f.type === "number") return v === "" ? null : Number(v);
    return v === "" ? null : v;
  }

  // Formulario modal. onSave(payload) debe devolver una promesa; si lanza, se muestra el error sin cerrar.
  function openForm(title, fields, values, onSave) {
    var d = dialog('<form method="dialog" class="dform"><h2>' + esc(title) + '</h2>' +
      fields.map(function (f) { return fieldHtml(f, values ? values[f.k] : null); }).join("") +
      '<p class="msg err" id="derr" role="alert"></p>' +
      '<div class="actions"><button type="button" class="ghost" id="dcancel">Cancelar</button><button type="submit" id="dsave">Guardar</button></div></form>');
    d.querySelector("#dcancel").addEventListener("click", function () { d.close(); });
    d.querySelector("form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var btn = d.querySelector("#dsave"); btn.disabled = true;
      var payload = {};
      fields.forEach(function (f) { payload[f.k] = readField(f); });
      try { await onSave(payload); d.close(); }
      catch (err) { d.querySelector("#derr").textContent = friendly(err); btn.disabled = false; }
    });
    var first = d.querySelector("input,select,textarea"); if (first) first.focus();
  }

  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var d = dialog('<form method="dialog" class="dform"><h2>' + esc(o.title) + '</h2><div>' + o.body + '</div>' +
        (o.type ? '<label for="cf">Escribe <strong>' + esc(o.type) + '</strong> para confirmar</label><input id="cf" type="text" autocomplete="off">' : "") +
        '<p class="msg err" id="derr" role="alert"></p>' +
        '<div class="actions"><button type="button" class="ghost" id="dcancel">Cancelar</button><button type="submit" id="dok" class="' + (o.danger ? "danger" : "") + '"' + (o.type ? " disabled" : "") + '>' + esc(o.ok) + '</button></div></form>');
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      d.addEventListener("close", function () { fin(false); });
      d.querySelector("#dcancel").addEventListener("click", function () { d.close(); });
      if (o.type) d.querySelector("#cf").addEventListener("input", function (e) { d.querySelector("#dok").disabled = norm(e.target.value) !== norm(o.type); });
      d.querySelector("form").addEventListener("submit", async function (e) {
        e.preventDefault();
        var btn = d.querySelector("#dok"); btn.disabled = true;
        try { if (o.run) await o.run(); done = true; resolve(true); d.close(); }
        catch (err) { d.querySelector("#derr").textContent = friendly(err); btn.disabled = false; }
      });
    });
  }

  function friendly(err) {
    var m = (err && err.message) || String(err);
    if (/duplicate key|already exists/i.test(m)) return "Ya existe un registro con ese dato (web o email duplicado): " + m;
    if (/motivo_perdida|check constraint/i.test(m)) return "Dato no válido: " + m + " (una oportunidad perdida necesita motivo).";
    return m;
  }
  function must(r) { if (r.error) throw r.error; return r; }

  /* ------------------------------------------------------------ login */
  function showLogin(note, isErr) {
    setHtml('<section class="card login">' +
      '<span class="brand">LIBELAMEDIA</span>' +
      '<h1>Plataforma interna</h1>' +
      '<p class="muted">Acceso privado. Te enviaremos un enlace por email.</p>' +
      '<form id="f"><label for="email">Email</label>' +
      '<input id="email" type="email" autocomplete="email" required>' +
      '<button class="block" type="submit">Enviarme el enlace</button></form>' +
      '<p class="msg' + (isErr ? ' err' : '') + '" id="m">' + esc(note) + '</p></section>');
    document.getElementById("f").addEventListener("submit", async function (e) {
      e.preventDefault();
      var btn = e.target.querySelector("button");
      btn.disabled = true;
      var email = document.getElementById("email").value.trim();
      var r = await db.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false, emailRedirectTo: cfg.siteUrl } });
      var m = document.getElementById("m");
      btn.disabled = false;
      if (r.error && r.error.status === 429) { m.className = "msg err"; m.textContent = "Demasiados intentos. Espera un minuto."; return; }
      m.className = "msg";
      m.textContent = "Si esa dirección tiene acceso, recibirás un enlace en unos segundos.";
    });
  }

  /* ------------------------------------------------------------ marco */
  function shell(inner) {
    var hs = location.hash || "#/";
    var cur = /^#\/tablero/.test(hs) ? "t" : /^#\/resumen/.test(hs) ? "r" : /^#\/prospeccion/.test(hs) ? "p" : /^#\/(campana|plantillas)/.test(hs) ? "c" : /^#\/empresa/.test(hs) ? "l" : "h";
    setHtml('<header class="bar"><a class="brand" href="#/">LIBELAMEDIA</a>' +
      '<nav class="nav" aria-label="Secciones"><a href="#/"' + (cur === "h" ? ' aria-current="page"' : "") + '>Hoy</a>' +
      '<a href="#/empresas"' + (cur === "l" ? ' aria-current="page"' : "") + '>Empresas</a>' +
      '<a href="#/tablero"' + (cur === "t" ? ' aria-current="page"' : "") + '>Tablero</a>' +
      '<a href="#/resumen"' + (cur === "r" ? ' aria-current="page"' : "") + '>Resumen</a>' +
      '<a href="#/prospeccion"' + (cur === "p" ? ' aria-current="page"' : "") + '>Prospección</a>' +
      '<a href="#/campanas"' + (cur === "c" ? ' aria-current="page"' : "") + '>Campañas</a></nav>' +
      '<span class="who"><span id="envio-slot"></span><span class="muted">' + esc(session.user.email) + '</span> ' +
      '<button class="ghost" id="out">Salir</button></span></header>' + inner);
    document.getElementById("out").addEventListener("click", async function () {
      cache.empresas = null; await db.auth.signOut(); showLogin();
    });
    pintarEnvio();
  }

  // Indicador global del envío real (siempre visible) con botón de parada.
  async function pintarEnvio() {
    var r = await db.from("configuracion").select("valor").eq("clave", "envio_activo").maybeSingle();
    var w = document.getElementById("envio-slot");
    if (!w || r.error || !r.data) return;
    var on = r.data.valor === "true";
    w.innerHTML = '<span class="pill ' + (on ? "on" : "off") + '">Envío ' + (on ? "ENCENDIDO" : "apagado") + '</span>' + (on ? ' <button type="button" class="danger sm" id="stop-envio">PARAR</button>' : "");
    var b = document.getElementById("stop-envio");
    if (b) b.addEventListener("click", async function () {
      var u = await db.rpc("apagar_envio");
      if (u.error) toast(friendly(u.error), true); else { toast("Envío apagado"); pintarEnvio(); }
    });
  }
  function fail(msg) { shell('<p class="msg err">' + esc(msg) + '</p><p><a href="#/">Volver</a></p>'); }

  /* ------------------------------------------------------------ lista */
  async function loadEmpresas() {
    if (cache.empresas) return cache.empresas;
    var r = await db.from("empresas")
      .select("id,nombre,tipo,dominio,web_url,etapa,no_contactar,poblacion,region,pais,sector_detalle,sectores(nombre),contactos(id)")
      .order("nombre").limit(2000);
    if (r.error) throw r.error;
    cache.empresas = r.data;
    return r.data;
  }
  async function loadSectores() {
    if (cache.sectores) return cache.sectores;
    var r = must(await db.from("sectores").select("id,nombre").order("nombre"));
    cache.sectores = r.data;
    return r.data;
  }

  var filtros = { q: "", etapa: "", tipo: "", sector: "" };

  async function showList() {
    shell('<p class="muted">Cargando…</p>');
    var rows;
    try { rows = await loadEmpresas(); } catch (e) { return fail("No se pudo leer: " + e.message); }
    var sectores = Array.from(new Set(rows.map(function (r) { return r.sectores ? r.sectores.nombre : "(sin clasificar)"; }))).sort();
    function opts(map, sel) { return '<option value="">Todas</option>' + Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (sel === k ? " selected" : "") + '>' + esc(map[k]) + '</option>'; }).join(""); }
    shell('<h1 class="page">Empresas <span class="count" id="cnt"></span></h1>' +
      '<form class="filters" onsubmit="return false">' +
      '<div><label for="q">Buscar</label><input id="q" type="search" placeholder="Nombre, web, población…" value="' + esc(filtros.q) + '"></div>' +
      '<div><label for="fe">Etapa</label><select id="fe">' + opts(ETAPAS, filtros.etapa) + '</select></div>' +
      '<div><label for="ft">Tipo</label><select id="ft">' + opts(TIPOS, filtros.tipo) + '</select></div>' +
      '<div><label for="fs">Sector</label><select id="fs"><option value="">Todos</option>' +
      sectores.map(function (s) { return '<option' + (filtros.sector === s ? " selected" : "") + '>' + esc(s) + '</option>'; }).join("") + '</select></div>' +
      '</form><div id="list"></div>');
    function paint() {
      var q = norm(filtros.q);
      var out = rows.filter(function (r) {
        var sec = r.sectores ? r.sectores.nombre : "(sin clasificar)";
        if (filtros.etapa && r.etapa !== filtros.etapa) return false;
        if (filtros.tipo && r.tipo !== filtros.tipo) return false;
        if (filtros.sector && sec !== filtros.sector) return false;
        if (q && norm([r.nombre, r.dominio, r.poblacion, r.region, r.pais, sec].join(" ")).indexOf(q) < 0) return false;
        return true;
      });
      document.getElementById("cnt").textContent = out.length + " de " + rows.length;
      document.getElementById("list").innerHTML = out.length ? '<ul class="rows">' + out.map(function (r) {
        var lugar = [r.poblacion, r.region || r.pais].filter(Boolean).join(", ");
        return '<li><a class="row" href="#/empresa/' + r.id + '">' +
          '<span class="r-main"><strong>' + esc(r.nombre) + '</strong>' + (r.no_contactar ? ' <span class="tag bad">No contactar</span>' : '') +
          '<span class="muted">' + esc([r.dominio, lugar].filter(Boolean).join(" · ")) + '</span></span>' +
          '<span class="r-side"><span class="tag stage-' + r.etapa + '">' + esc(ETAPAS[r.etapa]) + '</span>' +
          '<span class="muted small">' + esc(TIPOS[r.tipo] || r.tipo) + ' · ' + (r.contactos ? r.contactos.length : 0) + ' contacto(s)</span></span></a></li>';
      }).join("") + '</ul>' : '<p class="muted">Ninguna empresa coincide.</p>';
    }
    function bind(id, key) { document.getElementById(id).addEventListener("input", function (e) { filtros[key] = e.target.value; paint(); }); }
    bind("q", "q"); bind("fe", "etapa"); bind("ft", "tipo"); bind("fs", "sector");
    paint();
  }

  /* ------------------------------------------------------------ tablero */
  var BOARD_CAP = 25, expanded = {};

  async function showBoard() {
    shell('<p class="muted">Cargando…</p>');
    var rows;
    try { rows = await loadEmpresas(); } catch (e) { return fail("No se pudo leer: " + e.message); }
    var byStage = {};
    Object.keys(ETAPAS).forEach(function (k) { byStage[k] = []; });
    rows.forEach(function (r) { (byStage[r.etapa] || (byStage[r.etapa] = [])).push(r); });

    function card(r) {
      return '<li class="kcard" draggable="true" data-id="' + r.id + '"><a href="#/empresa/' + r.id + '"><strong>' + esc(r.nombre) + '</strong></a>' +
        '<span class="muted small">' + esc(r.dominio || [r.poblacion, r.region].filter(Boolean).join(", ")) + '</span>' +
        (r.no_contactar ? '<span class="tag bad">No contactar</span>' : "") +
        '<label class="sr" for="mv_' + r.id + '">Mover a</label><select class="mv" id="mv_' + r.id + '" data-id="' + r.id + '">' +
        Object.keys(ETAPAS).map(function (k) { return '<option value="' + k + '"' + (r.etapa === k ? " selected" : "") + '>' + (r.etapa === k ? "Etapa: " : "Mover a ") + esc(ETAPAS[k]) + '</option>'; }).join("") +
        '</select></li>';
    }
    function col(k) {
      var list = byStage[k], all = expanded[k], shown = all ? list : list.slice(0, BOARD_CAP);
      return '<section class="kcol" data-stage="' + k + '"><h2><span class="tag stage-' + k + '">' + esc(ETAPAS[k]) + '</span> <span class="count">' + list.length + '</span></h2>' +
        '<ul class="kcards">' + shown.map(card).join("") + '</ul>' +
        (list.length > BOARD_CAP && !all ? '<button type="button" class="ghost sm" data-more="' + k + '">Ver las ' + list.length + '</button>' : "") + '</section>';
    }
    shell('<h1 class="page">Tablero <span class="count">' + rows.length + ' empresas</span></h1>' +
      '<p class="muted small">Arrastra una tarjeta a otra columna, o usa el desplegable de la tarjeta.</p>' +
      '<div class="board">' + Object.keys(ETAPAS).map(col).join("") + '</div>');

    async function mover(id, etapa) {
      var r = rows.filter(function (x) { return x.id === id; })[0];
      if (!r || r.etapa === etapa) return;
      try { must(await db.from("empresas").update({ etapa: etapa }).eq("id", id)); toast(r.nombre + " → " + ETAPAS[etapa]); r.etapa = etapa; }
      catch (err) { toast(friendly(err), true); }
      showBoard();
    }
    var board = root.querySelector(".board");
    board.addEventListener("change", function (e) { if (e.target.classList.contains("mv")) mover(e.target.getAttribute("data-id"), e.target.value); });
    board.addEventListener("click", function (e) { var m = e.target.getAttribute && e.target.getAttribute("data-more"); if (m) { expanded[m] = true; showBoard(); } });
    var dragId = null;
    board.addEventListener("dragstart", function (e) { var c = e.target.closest(".kcard"); if (!c) return; dragId = c.getAttribute("data-id"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); });
    board.addEventListener("dragover", function (e) { var c = e.target.closest(".kcol"); if (c && dragId) { e.preventDefault(); c.classList.add("over"); } });
    board.addEventListener("dragleave", function (e) { var c = e.target.closest(".kcol"); if (c && !c.contains(e.relatedTarget)) c.classList.remove("over"); });
    board.addEventListener("drop", function (e) {
      var c = e.target.closest(".kcol"); if (!c || !dragId) return;
      e.preventDefault(); var id = dragId; dragId = null; mover(id, c.getAttribute("data-stage"));
    });
  }

  /* ------------------------------------------------------------ resumen */
  async function showSummary() {
    shell('<p class="muted">Cargando…</p>');
    var desde = new Date(Date.now() - 30 * 864e5).toISOString();
    var res;
    try {
      res = await Promise.all([
        loadEmpresas(),
        db.from("oportunidades").select("estado,importe"),
        db.from("tareas").select("id,titulo,tipo,vence_el,empresa_id,empresas(nombre)").eq("estado", "pendiente").order("vence_el", { ascending: true, nullsFirst: false }),
        db.from("interacciones").select("tipo,clasificacion_respuesta").gte("ocurrio_en", desde),
        db.from("exclusiones").select("id", { count: "exact", head: true })
      ]);
      for (var i = 1; i < res.length; i++) must(res[i]);
    } catch (e) { return fail("No se pudo leer: " + e.message); }
    var rows = res[0], ops = res[1].data, tar = res[2].data, ints = res[3].data, nExcl = res[4].count;

    var porEtapa = {}; Object.keys(ETAPAS).forEach(function (k) { porEtapa[k] = 0; });
    rows.forEach(function (r) { porEtapa[r.etapa] = (porEtapa[r.etapa] || 0) + 1; });
    var max = Math.max.apply(null, Object.keys(porEtapa).map(function (k) { return porEtapa[k]; })) || 1;
    var abiertas = ops.filter(function (o) { return o.estado === "abierta"; });
    var ganadas = ops.filter(function (o) { return o.estado === "ganada"; });
    function suma(l) { return l.reduce(function (a, o) { return a + (Number(o.importe) || 0); }, 0); }
    var hoyS = hoy(), en7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    var vencidas = tar.filter(function (t) { return t.vence_el && t.vence_el < hoyS; });
    var proximas = tar.filter(function (t) { return t.vence_el && t.vence_el >= hoyS && t.vence_el <= en7; });
    var enviados = ints.filter(function (i) { return i.tipo === "email_enviado"; }).length;
    var respuestas = ints.filter(function (i) { return i.tipo === "email_recibido"; }).length;
    var contactadas = rows.filter(function (r) { return r.etapa !== "nueva"; }).length;
    var sinContacto = rows.filter(function (r) { return !r.contactos || r.contactos.length === 0; }).length;

    function stat(n, label, href) { return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="stat-card"><span class="big">' + esc(n) + '</span><span class="muted small">' + esc(label) + '</span></' + (href ? 'a' : 'div') + '>'; }
    function tlist(l) { return l.length ? '<ul class="plain">' + l.map(function (t) {
      return '<li><div class="li-h"><span><a href="#/empresa/' + t.empresa_id + '"><strong>' + esc(t.empresas ? t.empresas.nombre : "(sin empresa)") + '</strong></a> — ' + esc(t.titulo) + '</span><span class="muted small">' + (t.vence_el ? esc(fecha(t.vence_el)) : "sin fecha") + '</span></div></li>'; }).join("") + '</ul>' : '<p class="muted">Nada.</p>'; }

    shell('<h1 class="page">Resumen</h1>' +
      '<div class="stats">' + stat(rows.length, "Empresas", "#/empresas") + stat(contactadas, "Ya contactadas", "#/tablero") + stat(abiertas.length + " · " + dinero(suma(abiertas)), "Oportunidades abiertas") +
      stat(ganadas.length + " · " + dinero(suma(ganadas)), "Ganadas") + stat(enviados, "Emails enviados (30 días)") + stat(respuestas, "Respuestas recibidas (30 días)") + '</div>' +
      '<section class="card wide"><h2>Empresas por etapa</h2><ul class="bars">' + Object.keys(ETAPAS).map(function (k) {
        return '<li><span class="bl">' + esc(ETAPAS[k]) + '</span><span class="bt"><span class="bf" style="width:' + Math.round(porEtapa[k] / max * 100) + '%"></span></span><span class="bn">' + porEtapa[k] + '</span></li>'; }).join("") + '</ul></section>' +
      '<section class="card wide"><h2>Tareas vencidas <span class="count">' + vencidas.length + '</span></h2>' + tlist(vencidas) + '</section>' +
      '<section class="card wide"><h2>Tareas de los próximos 7 días <span class="count">' + proximas.length + '</span></h2>' + tlist(proximas) + '</section>' +
      '<section class="card wide"><h2>Calidad de los datos</h2><p class="small">' + sinContacto + ' empresa(s) sin ningún contacto · ' + nExcl + ' entrada(s) en la lista de exclusión · ' + tar.length + ' tareas pendientes en total.</p></section>');
  }

  /* ------------------------------------------------------------ hoy */
  function sumaDias(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); }
  function soloNum(s) { return String(s || "").replace(/[^\d+]/g, ""); }
  function telHref(s) { var n = soloNum(s.split("/")[0]); return n ? "tel:" + n : null; }
  function waHref(s) { var n = soloNum(s).replace(/^\+/, ""); if (/^[67]\d{8}$/.test(n)) n = "34" + n; return n ? "https://wa.me/" + n : null; }
  function relativa(d) {
    var dif = Math.round((new Date(d + "T00:00:00") - new Date(hoy() + "T00:00:00")) / 864e5);
    return dif === 0 ? "hoy" : dif === 1 ? "mañana" : dif === -1 ? "ayer" : dif < 0 ? "hace " + (-dif) + " días" : "en " + dif + " días";
  }
  function rellenarGuion(g, e, c) {
    var v = { nombre: c && c.nombre, empresa: e.nombre, gancho: e.gancho, producto_a_citar: e.producto_a_citar };
    return String(g || "").replace(/\{(\w+)\}/g, function (m, k) { return v[k] ? v[k] : "[falta " + k + "]"; });
  }

  async function showHoy() {
    shell('<p class="muted">Cargando…</p>');
    var res = await Promise.all([
      db.from("tareas").select("*,empresas(id,nombre,gancho,producto_a_citar,puntos_debiles,contactos(nombre,cargo,telefono,whatsapp,linkedin_url,email,es_principal))")
        .eq("estado", "pendiente").order("vence_el", { ascending: true, nullsFirst: false }),
      db.from("configuracion").select("valor").eq("clave", "guion_llamada").maybeSingle()
    ]);
    if (res[0].error) return fail("No se pudo leer: " + res[0].error.message);
    var tar = res[0].data, guion = res[1].data ? res[1].data.valor : "";
    var h0 = hoy(), h7 = sumaDias(7);
    var grupos = [
      { t: "Vencidas", cls: "late", l: tar.filter(function (x) { return x.vence_el && x.vence_el < h0; }) },
      { t: "Hoy", l: tar.filter(function (x) { return x.vence_el === h0; }) },
      { t: "Próximos 7 días", l: tar.filter(function (x) { return x.vence_el && x.vence_el > h0 && x.vence_el <= h7; }) },
      { t: "Más adelante", fold: true, l: tar.filter(function (x) { return x.vence_el && x.vence_el > h7; }) },
      { t: "Sin fecha", fold: true, l: tar.filter(function (x) { return !x.vence_el; }) }
    ];

    function card(t) {
      var e = t.empresas, cs = e ? (e.contactos || []).slice().sort(function (a, b) { return (b.es_principal ? 1 : 0) - (a.es_principal ? 1 : 0); }) : [];
      var det = "";
      if (e && t.tipo === "llamada") {
        det = '<details class="prep"><summary>Preparar la llamada</summary>' +
          (cs.length ? '<ul class="plain">' + cs.map(function (c) {
            var th = c.telefono ? telHref(c.telefono) : null, wh = c.whatsapp ? waHref(c.whatsapp) : null;
            return '<li><strong>' + esc(c.nombre || "(sin nombre)") + '</strong>' + (c.cargo ? ' · ' + esc(c.cargo) : "") +
              (th ? ' · <a class="callbtn" href="' + esc(th) + '">Llamar ' + esc(c.telefono) + '</a>' : "") +
              (wh ? ' · <a href="' + esc(wh) + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>' : "") + '</li>';
          }).join("") + '</ul>' : '<p class="muted small">Esta empresa no tiene contactos.</p>') +
          (e.gancho ? '<p class="small"><strong>Gancho:</strong> ' + esc(e.gancho) + '</p>' : "") +
          (e.producto_a_citar ? '<p class="small"><strong>Producto a citar:</strong> ' + esc(e.producto_a_citar) + '</p>' : "") +
          ((e.puntos_debiles || []).length ? '<p class="small"><strong>Puntos débiles:</strong></p><ul class="small">' + e.puntos_debiles.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join("") + '</ul>' : "") +
          '<p class="small"><strong>Guion</strong></p><pre class="guion">' + esc(rellenarGuion(guion, e, cs.filter(function (c) { return c.es_principal; })[0] || cs[0])) + '</pre></details>';
      } else if (e && t.tipo === "linkedin") {
        var li = cs.filter(function (c) { return safeUrl(c.linkedin_url); })[0];
        det = '<p class="small">' + (li ? '<a href="' + esc(li.linkedin_url) + '" target="_blank" rel="noopener noreferrer">Abrir el LinkedIn de ' + esc(li.nombre || "contacto") + '</a>'
          : '<a href="https://www.linkedin.com/search/results/companies/?keywords=' + encodeURIComponent(e.nombre) + '" target="_blank" rel="noopener noreferrer">Buscar ' + esc(e.nombre) + ' en LinkedIn</a>') + '</p>';
      }
      return '<li class="tk" data-id="' + t.id + '"><div class="li-h"><span><span class="tag">' + esc(TIPO_TAREA[t.tipo] || t.tipo) + '</span> <strong>' + esc(t.titulo) + '</strong>' +
        (e ? ' · <a href="#/empresa/' + e.id + '">' + esc(e.nombre) + '</a>' : "") + (t.repite ? ' <span class="tag">se repite</span>' : "") + '</span>' +
        '<span class="muted small">' + (t.vence_el ? esc(fecha(t.vence_el)) + ' · ' + relativa(t.vence_el) : "sin fecha") + '</span></div>' +
        (t.notas ? '<p class="small muted">' + esc(t.notas) + '</p>' : "") + det +
        '<div class="li-a tk-a"><button type="button" class="primary sm" data-tk="hecha">Hecha</button>' +
        '<label class="sr" for="ap_' + t.id + '">Aplazar</label><select class="mv" id="ap_' + t.id + '" data-tk="aplazar"><option value="">Aplazar…</option><option value="1">Mañana</option><option value="3">3 días</option><option value="7">1 semana</option><option value="30">1 mes</option></select>' +
        '<button type="button" class="ghost sm" data-tk="cancelar">Cancelar</button></div></li>';
    }

    shell('<div class="sec-h"><h1 class="page">Hoy <span class="count">' + tar.length + ' pendiente(s)</span></h1><span class="li-a">' +
      '<button type="button" class="ghost sm" id="hg">Editar guion de llamada</button><button type="button" class="sm" id="hn">+ Nueva tarea</button></span></div>' +
      (tar.length ? "" : '<p class="muted">No tienes tareas pendientes. Inicia una cadencia desde la ficha de una empresa o crea una tarea nueva.</p>') +
      grupos.filter(function (g) { return g.l.length; }).map(function (g) {
        var body = '<ul class="plain">' + g.l.map(card).join("") + '</ul>';
        return g.fold ? '<details class="card wide"><summary><h2 class="inl">' + g.t + ' <span class="count">' + g.l.length + '</span></h2></summary>' + body + '</details>'
          : '<section class="card wide ' + (g.cls || "") + '"><h2>' + g.t + ' <span class="count">' + g.l.length + '</span></h2>' + body + '</section>';
      }).join(""));

    document.getElementById("hg").addEventListener("click", function () {
      openForm("Guion de llamada", [{ k: "valor", label: "Texto (variables: {nombre} {empresa} {gancho} {producto_a_citar})", type: "textarea", rows: 18, req: true }], { valor: guion }, async function (v) {
        must(await db.from("configuracion").update({ valor: v.valor, actualizado_en: new Date().toISOString() }).eq("clave", "guion_llamada")); toast("Guion guardado"); showHoy();
      });
    });
    document.getElementById("hn").addEventListener("click", async function () {
      var emp = await loadEmpresas().catch(function () { return []; });
      var o = { "": "(ninguna)" }; emp.forEach(function (x) { o[x.id] = x.nombre; });
      openForm("Nueva tarea", [{ k: "empresa_id", label: "Empresa", type: "select", options: o }].concat(F.tarea), { tipo: "otro" }, async function (v) {
        norm0(v); v.origen = "manual"; must(await db.from("tareas").insert(v)); toast("Tarea añadida"); showHoy();
      });
    });
    async function cambiar(id, cuerpo, msg) {
      var r = await db.from("tareas").update(cuerpo).eq("id", id);
      if (r.error) return toast(friendly(r.error), true);
      toast(msg); showHoy();
    }
    var cont = root;
    cont.querySelectorAll("[data-tk]").forEach(function (el) {
      var id = el.closest(".tk").getAttribute("data-id"), k = el.getAttribute("data-tk");
      if (k === "aplazar") el.addEventListener("change", function () { if (el.value) cambiar(id, { vence_el: sumaDias(Number(el.value)) }, "Tarea aplazada"); });
      else el.addEventListener("click", function () {
        if (k === "hecha") { var t = tar.filter(function (x) { return x.id === id; })[0]; cambiar(id, { estado: "hecha", completada_en: new Date().toISOString() }, t && t.repite ? "Hecha. Creada la siguiente (" + t.repite + ")" : "Tarea hecha"); }
        else cambiar(id, { estado: "cancelada" }, "Tarea cancelada");
      });
    });
  }

  /* ------------------------------------------------------------ campañas */
  var ESTADO_CAMP = { borrador: "Borrador", aprobada: "Aprobada", activa: "Activa", pausada: "Pausada", terminada: "Terminada" };
  var METODOS = { tradicional: "Tradicional", masivo: "Masivo" };
  var VARIABLES_AYUDA = "{saludo} {nombre} {empresa} {gancho} {producto_a_citar} {firma}";

  function diaMad(iso) { return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" }); }
  function horaMad(iso) { return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }); }
  function diaLargo(ymd) { return new Date(ymd + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }

  // Panel del envío real: interruptor general, requisitos y señal del cartero.
  async function panelEnvio() {
    var cont = document.getElementById("envpanel"); if (!cont) return;
    var res = await Promise.all([
      db.from("configuracion").select("clave,valor,actualizado_en").in("clave", ["envio_activo", "requisito_dns", "requisito_prueba", "cartero_ultimo_latido", "email_alertas", "tope_diario_global"]),
      db.from("campanas").select("id,campana_plantillas(plantillas(revisada))").eq("estado", "activa")
    ]);
    if (res[0].error) { cont.innerHTML = '<p class="msg err">' + esc(res[0].error.message) + '</p>'; return; }
    var c = {}; res[0].data.forEach(function (x) { c[x.clave] = x; });
    var sinRev = 0; (res[1].data || []).forEach(function (ca) { (ca.campana_plantillas || []).forEach(function (cp) { if (cp.plantillas && !cp.plantillas.revisada) sinRev++; }); });
    var on = c.envio_activo && c.envio_activo.valor === "true", dns = c.requisito_dns && c.requisito_dns.valor === "true", prueba = c.requisito_prueba && c.requisito_prueba.valor === "true";
    var lat = c.cartero_ultimo_latido && c.cartero_ultimo_latido.valor === "visto" ? c.cartero_ultimo_latido.actualizado_en : null;
    var mins = lat ? Math.round((Date.now() - new Date(lat).getTime()) / 60000) : null;
    function it(ok, txt, nota) { return '<li class="' + (ok ? "ok" : "ko") + '"><span class="chk" aria-hidden="true">' + (ok ? "✓" : "✗") + '</span> ' + esc(txt) + (nota ? ' <span class="muted small">' + esc(nota) + '</span>' : "") + '</li>'; }
    cont.innerHTML = '<div class="sec-h"><h2>Envío real <span class="pill ' + (on ? "on" : "off") + '">' + (on ? "ENCENDIDO" : "apagado") + '</span></h2><span class="li-a">' +
      (on ? '<button type="button" class="danger sm" id="env-off">Apagar envío</button>' : '<button type="button" class="sm" id="env-on">Encender envío</button>') + '</span></div>' +
      '<ul class="checks">' + it(dns, "SPF y DMARC publicados en el DNS", dns ? "" : "lo comprueba Claude y lo marca") + it(prueba, "Prueba real a tu Gmail con SPF y DKIM en pass", prueba ? "" : "pendiente") +
      it(sinRev === 0, "Plantillas de las campañas activas revisadas", sinRev ? sinRev + " sin revisar" : "") +
      it(mins !== null && mins <= 15, "Cartero (Apps Script) funcionando", mins === null ? "aún no ha dado señal" : "última señal hace " + (mins < 60 ? mins + " min" : Math.round(mins / 60) + " h")) + '</ul>' +
      '<p class="small muted">Tope global: ' + esc(c.tope_diario_global ? c.tope_diario_global.valor : "?") + ' al día · avisos a ' + esc(c.email_alertas ? c.email_alertas.valor : "?") + '. Si los rebotes de 24 h pasan del 5 % o hay errores repetidos, el envío se apaga solo.</p>';
    var bon = document.getElementById("env-on"), boff = document.getElementById("env-off");
    if (bon) bon.addEventListener("click", function () {
      confirmDialog({ title: "Encender el envío real", body: "<p>Los emails programados de las campañas <strong>activas</strong> saldrán de info@libelamedia.com según su calendario, tope y horario (lunes a viernes, 9:00-13:00). Puedes pararlo en cualquier momento desde el botón rojo de arriba.</p>", ok: "Encender", danger: true,
        run: async function () { var r = await db.rpc("encender_envio"); if (r.error) throw r.error; } }).then(function (ok) { if (ok) { toast("Envío encendido"); showCampanas(); } });
    });
    if (boff) boff.addEventListener("click", async function () { var r = await db.rpc("apagar_envio"); if (r.error) toast(friendly(r.error), true); else { toast("Envío apagado"); showCampanas(); } });
  }

  async function showCampanas() {
    shell('<p class="muted">Cargando…</p>');
    var r = await db.from("campanas").select("*,campana_contactos(contacto_id,aprobado_en)").order("creado_en", { ascending: false });
    if (r.error) return fail("No se pudo leer: " + r.error.message);
    var cs = r.data;
    shell('<div class="sec-h"><h1 class="page">Campañas <span class="count">' + cs.length + '</span></h1><span class="li-a">' +
      '<a class="ghost sm btnlink" href="#/plantillas">Plantillas</a><button type="button" class="sm" id="cn">+ Nueva campaña</button></span></div>' +
      '<section class="card wide" id="envpanel"><p class="muted small">Cargando el estado del envío…</p></section>' +
      (cs.length ? '<ul class="rows">' + cs.map(function (c) {
        var ap = (c.campana_contactos || []).filter(function (x) { return x.aprobado_en; }).length;
        return '<li><a class="row" href="#/campana/' + c.id + '"><span class="r-main"><strong>' + esc(c.nombre) + '</strong><span class="muted">' + esc(METODOS[c.metodo]) + ' · tope ' + c.tope_diario + ' al día' + (c.segmento ? ' · ' + esc(c.segmento) : "") + '</span></span>' +
          '<span class="r-side"><span class="tag">' + esc(ESTADO_CAMP[c.estado] || c.estado) + '</span><span class="muted small">' + ap + ' contacto(s) aprobado(s)</span></span></a></li>';
      }).join("") + '</ul>' : '<p class="muted">Aún no hay campañas.</p>'));
    panelEnvio();
    document.getElementById("cn").addEventListener("click", function () {
      openForm("Nueva campaña", [
        { k: "nombre", label: "Nombre", req: true },
        { k: "metodo", label: "Método (decide el juego de plantillas)", type: "select", options: METODOS },
        { k: "segmento", label: "Segmento o nota (opcional)" },
        { k: "tope_diario", label: "Tope diario de emails", type: "number", req: true }
      ], { metodo: "tradicional", tope_diario: 10 }, async function (v) {
        norm0(v);
        var ins = must(await db.from("campanas").insert({ nombre: v.nombre, metodo: v.metodo, segmento: v.segmento, tope_diario: v.tope_diario }).select("id").single());
        var pl = must(await db.from("plantillas").select("id,idioma,paso").eq("nombre", METODOS[v.metodo]).eq("activa", true)).data;
        if (pl.length) must(await db.from("campana_plantillas").insert(pl.map(function (x) { return { campana_id: ins.data.id, paso: x.paso, idioma: x.idioma, plantilla_id: x.id }; })));
        location.hash = "#/campana/" + ins.data.id;
      });
    });
  }

  async function showCampana(id) {
    shell('<p class="muted">Cargando…</p>');
    var res = await Promise.all([
      db.from("campanas").select("*").eq("id", id).maybeSingle(),
      db.from("campana_plantillas").select("paso,idioma,plantillas(nombre,asunto,revisada)").eq("campana_id", id).order("paso"),
      db.from("configuracion").select("clave,valor").in("clave", ["envio_activo", "tope_diario_global"]),
      db.rpc("candidatos_campana", { p_campana: id }),
      db.from("envios").select("estado,paso,programado_para,enviado_en,error,contactos(email,empresas(nombre))").eq("campana_id", id).order("programado_para").limit(1000)
    ]);
    var err = res.map(function (x) { return x.error; }).filter(Boolean)[0];
    if (err) return fail("No se pudo leer: " + err.message);
    var camp = res[0].data;
    if (!camp) return fail("Campaña no encontrada.");
    var pls = res[1].data, cfg = {}; res[2].data.forEach(function (x) { cfg[x.clave] = x.valor; });
    var cand = res[3].data, envs = res[4].data || [];
    var global = Number(cfg.tope_diario_global || camp.tope_diario), efectivo = Math.min(camp.tope_diario, global);
    var cuenta = {}; envs.forEach(function (e) { cuenta[e.estado] = (cuenta[e.estado] || 0) + 1; });
    var ESTADO_ENV = { programado: "Programados", enviado: "Enviados", bloqueado: "Bloqueados", cancelado: "Cancelados", error: "Con error", rebotado: "Rebotados" };
    var hechos = envs.filter(function (e) { return e.estado !== "programado"; }).slice(-30).reverse();
    var proximos = envs.filter(function (e) { return e.estado === "programado"; }).slice(0, 8);
    function filaEnv(e) {
      var c = e.contactos || {}, em = c.empresas ? c.empresas.nombre : "";
      return '<li><span class="muted small">' + esc(e.estado === "enviado" && e.enviado_en ? fecha(e.enviado_en) + " " + horaMad(e.enviado_en) : fecha(e.programado_para) + " " + horaMad(e.programado_para)) + '</span> · paso ' + e.paso + ' · <strong>' + esc(em) + '</strong> <span class="muted small">' + esc(c.email || "") + '</span> <span class="tag">' + esc(ESTADO_ENV[e.estado] || e.estado) + '</span>' + (e.error ? ' <span class="motivo">' + esc(e.error) + '</span>' : "") + '</li>';
    }
    var sinRevisar = pls.filter(function (x) { return x.plantillas && !x.plantillas.revisada; }).length;
    var f = { q: "", etapa: "nueva", sector: "", region: "", idioma: "", estado: "" }, sel = {};
    var sectores = Array.from(new Set(cand.map(function (c) { return c.sector || "(sin clasificar)"; }))).sort();
    var regiones = Array.from(new Set(cand.map(function (c) { return c.region; }).filter(Boolean))).sort();
    function opt(list, cur, todos) { return '<option value="">' + todos + '</option>' + list.map(function (s) { return '<option' + (cur === s ? " selected" : "") + '>' + esc(s) + '</option>'; }).join(""); }
    function mapOpt(map, cur, todos) { return '<option value="">' + todos + '</option>' + Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (cur === k ? " selected" : "") + '>' + esc(map[k]) + '</option>'; }).join(""); }

    shell('<p><a href="#/campanas">← Campañas</a></p>' +
      '<div class="head"><h1 class="page">' + esc(camp.nombre) + '</h1><span class="tag">' + esc(METODOS[camp.metodo]) + '</span> <span class="tag">' + esc(ESTADO_CAMP[camp.estado] || camp.estado) + '</span></div>' +
      '<section class="card wide"><div class="sec-h"><h2>Datos</h2><span class="li-a"><button type="button" class="ghost sm" id="ce">Editar</button><button type="button" class="ghost danger sm" id="cd">Borrar campaña</button></span></div>' +
      '<p class="small">Tope diario de la campaña: <strong>' + camp.tope_diario + '</strong> · tope global: <strong>' + global + '</strong> · el plan usa <strong>' + efectivo + '</strong> emails al día.' + (camp.segmento ? ' · ' + esc(camp.segmento) : "") + '</p>' +
      '<p class="small muted">Envío real: <strong>' + (cfg.envio_activo === "true" ? "ENCENDIDO" : "apagado") + '</strong>. En esta pieza nada se envía; solo se prepara y se simula.</p></section>' +
      '<section class="card wide"><div class="sec-h"><h2>Plantillas de esta campaña</h2><a class="ghost sm btnlink" href="#/plantillas">Editar plantillas</a></div>' +
      (pls.length ? '<ul class="plain">' + pls.map(function (x) { return '<li><span class="tag">Paso ' + x.paso + ' · ' + esc((x.idioma || "").toUpperCase()) + '</span> ' + esc(x.plantillas ? x.plantillas.asunto : "") + (x.plantillas && !x.plantillas.revisada ? ' <span class="tag warn">Sin revisar</span>' : "") + '</li>'; }).join("") + '</ul>'
        : '<p class="muted">Esta campaña no tiene plantillas enlazadas.</p>') +
      (sinRevisar ? '<p class="small muted">Hay ' + sinRevisar + ' plantilla(s) sin revisar. Léelas y márcalas como revisadas antes de activar la campaña (pieza 6).</p>' : "") + '</section>' +
      '<section class="card wide"><div class="sec-h"><h2>Destinatarios <span class="count" id="dcount"></span></h2><span class="li-a"><button type="button" class="primary sm" id="dap">Aprobar seleccionados</button><button type="button" class="ghost sm" id="dqu">Quitar seleccionados</button></span></div>' +
      '<form class="filters f5" onsubmit="return false">' +
      '<div><label for="fq">Buscar</label><input id="fq" type="search" placeholder="Empresa, contacto, email…"></div>' +
      '<div><label for="fe">Etapa</label><select id="fe">' + mapOpt(ETAPAS, "nueva", "Todas") + '</select></div>' +
      '<div><label for="fs">Sector</label><select id="fs">' + opt(sectores, "", "Todos") + '</select></div>' +
      '<div><label for="fr">Región</label><select id="fr">' + opt(regiones, "", "Todas") + '</select></div>' +
      '<div><label for="fi">Idioma</label><select id="fi">' + mapOpt(IDIOMAS, "", "Todos") + '</select></div>' +
      '<div><label for="fx">Estado</label><select id="fx"><option value="">Todos</option><option value="disp">Disponibles</option><option value="apro">Aprobados</option><option value="bloq">Bloqueados</option></select></div></form>' +
      '<p class="small"><button type="button" class="ghost sm" id="dall">Marcar todos los disponibles de la lista</button> <span class="muted" id="dsel"></span></p><div id="dlist"></div></section>' +
      '<section class="card wide"><div class="sec-h"><h2>Envío de esta campaña</h2><span class="li-a">' +
      (camp.estado === "borrador" ? '<button type="button" class="primary sm" id="cact">Activar campaña</button>' : "") +
      (camp.estado === "pausada" ? '<button type="button" class="primary sm" id="cact">Reanudar</button>' : "") +
      (camp.estado === "activa" ? '<button type="button" class="ghost sm" id="cpau">Pausar</button>' : "") +
      (camp.estado === "activa" || camp.estado === "pausada" ? '<button type="button" class="ghost danger sm" id="cter">Terminar</button>' : "") + '</span></div>' +
      (camp.estado === "borrador" ? '<p class="small muted">«Activar» convierte el simulacro en emails programados (con el primer día que pongas en el simulacro). No sale nada hasta que el envío real esté encendido (panel de Campañas) y llegue su hora.</p>' : "") +
      (envs.length ? '<p class="small">' + Object.keys(ESTADO_ENV).filter(function (k) { return cuenta[k]; }).map(function (k) { return '<strong>' + cuenta[k] + '</strong> ' + ESTADO_ENV[k].toLowerCase(); }).join(" · ") + '</p>' : '<p class="small muted">Aún no hay emails programados.</p>') +
      (proximos.length ? '<h3 class="h3">Próximos</h3><ul class="plain">' + proximos.map(filaEnv).join("") + '</ul>' : "") +
      (hechos.length ? '<details class="prep"><summary>Últimos enviados, cancelados y errores (' + hechos.length + ')</summary><ul class="plain">' + hechos.map(filaEnv).join("") + '</ul></details>' : "") + '</section>' +
      '<section class="card wide"><h2>Simulacro</h2><p class="small muted">Calcula qué saldría cada día, sin enviar nada: reparte entre las 9:00 y las 13:00, de lunes a viernes, salta festivos nacionales y respeta el tope.</p>' +
      '<div class="simbar"><div><label for="sim_ini">Primer día (vacío = el siguiente día hábil)</label><input type="date" id="sim_ini"></div><button type="button" id="sim_go">Generar simulacro</button></div><div id="sim_out"></div></section>');

    // ---- destinatarios
    function visibles() {
      var q = norm(f.q);
      return cand.filter(function (c) {
        if (f.etapa && c.etapa !== f.etapa) return false;
        if (f.sector && (c.sector || "(sin clasificar)") !== f.sector) return false;
        if (f.region && c.region !== f.region) return false;
        if (f.idioma && c.idioma !== f.idioma) return false;
        if (f.estado === "disp" && (c.motivo || c.aprobado)) return false;
        if (f.estado === "apro" && !c.aprobado) return false;
        if (f.estado === "bloq" && !c.motivo) return false;
        if (q && norm([c.empresa, c.contacto, c.email].join(" ")).indexOf(q) < 0) return false;
        return true;
      });
    }
    function selCount() { return Object.keys(sel).filter(function (k) { return sel[k]; }).length; }
    function paint() {
      var v = visibles(), aprob = cand.filter(function (c) { return c.aprobado; }).length;
      document.getElementById("dcount").textContent = v.length + " de " + cand.length + " · " + aprob + " aprobado(s)";
      document.getElementById("dsel").textContent = selCount() ? selCount() + " seleccionado(s)" : "";
      document.getElementById("dlist").innerHTML = v.length ? '<ul class="rows">' + v.map(function (c) {
        var bloq = !!c.motivo, dis = bloq && !c.aprobado;
        return '<li><label class="crow' + (dis ? " off" : "") + '"><input type="checkbox" data-cid="' + c.contacto_id + '"' + (sel[c.contacto_id] ? " checked" : "") + (dis ? " disabled" : "") + '>' +
          '<span class="r-main"><strong><a href="#/empresa/' + c.empresa_id + '">' + esc(c.empresa) + '</a></strong><span class="muted small">' + esc([c.contacto, c.email, (c.idioma || "").toUpperCase(), ETAPAS[c.etapa]].filter(Boolean).join(" · ")) + '</span></span>' +
          '<span class="r-side">' + (c.aprobado ? '<span class="tag stage-ganada">Aprobado</span>' : "") + (bloq ? '<span class="motivo">' + esc(c.motivo) + '</span>' : (c.aprobado ? "" : '<span class="tag">Disponible</span>')) + '</span></label></li>';
      }).join("") + '</ul>' : '<p class="muted">Ningún contacto coincide con los filtros.</p>';
    }
    paint();
    [["fq", "q"], ["fe", "etapa"], ["fs", "sector"], ["fr", "region"], ["fi", "idioma"], ["fx", "estado"]].forEach(function (p) {
      document.getElementById(p[0]).addEventListener("input", function (e) { f[p[1]] = e.target.value; paint(); });
    });
    document.getElementById("dlist").addEventListener("change", function (e) {
      var cid = e.target.getAttribute && e.target.getAttribute("data-cid");
      if (cid) { sel[cid] = e.target.checked; document.getElementById("dsel").textContent = selCount() ? selCount() + " seleccionado(s)" : ""; }
    });
    document.getElementById("dall").addEventListener("click", function () {
      visibles().forEach(function (c) { if (!c.motivo && !c.aprobado) sel[c.contacto_id] = true; }); paint();
    });
    async function aplicar(aprobar) {
      var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
      var byId = {}; cand.forEach(function (c) { byId[c.contacto_id] = c; });
      ids = ids.filter(function (k) { return aprobar ? (!byId[k].aprobado && !byId[k].motivo) : byId[k].aprobado; });
      if (!ids.length) return toast(aprobar ? "Marca contactos disponibles (sin bloqueo) para aprobarlos" : "Marca contactos aprobados para quitarlos", true);
      try {
        if (aprobar) must(await db.from("campana_contactos").upsert(ids.map(function (k) { return { campana_id: id, contacto_id: k, aprobado_en: new Date().toISOString(), estado: "pendiente" }; }), { onConflict: "campana_id,contacto_id" }));
        else must(await db.from("campana_contactos").delete().eq("campana_id", id).in("contacto_id", ids));
        toast(aprobar ? ids.length + " contacto(s) aprobado(s)" : ids.length + " contacto(s) quitado(s)"); showCampana(id);
      } catch (e) { toast(friendly(e), true); }
    }
    document.getElementById("dap").addEventListener("click", function () { aplicar(true); });
    document.getElementById("dqu").addEventListener("click", function () { aplicar(false); });

    // ---- editar / borrar
    document.getElementById("ce").addEventListener("click", function () {
      openForm("Editar campaña", [
        { k: "nombre", label: "Nombre", req: true }, { k: "segmento", label: "Segmento o nota" },
        { k: "tope_diario", label: "Tope diario de emails (1-60)", type: "number", req: true }
      ], camp, async function (v) { norm0(v); must(await db.from("campanas").update(v).eq("id", id)); toast("Campaña guardada"); showCampana(id); });
    });
    document.getElementById("cd").addEventListener("click", function () {
      confirmDialog({ title: "Borrar campaña", body: "<p>¿Borrar <strong>" + esc(camp.nombre) + "</strong> con sus destinatarios aprobados? Las empresas y contactos no se tocan.</p>", ok: "Borrar", danger: true,
        run: async function () { must(await db.from("campanas").delete().eq("id", id)); } }).then(function (ok) { if (ok) { toast("Campaña borrada"); location.hash = "#/campanas"; } });
    });

    // ---- activar / pausar / terminar
    var bAct = document.getElementById("cact"), bPau = document.getElementById("cpau"), bTer = document.getElementById("cter");
    if (bAct) bAct.addEventListener("click", function () {
      var ini = document.getElementById("sim_ini").value || null;
      confirmDialog({ title: (camp.estado === "pausada" ? "Reanudar " : "Activar ") + camp.nombre,
        body: camp.estado === "pausada" ? "<p>La campaña vuelve a estar activa; los emails vencidos saldrán respetando tope y horario.</p>" :
          "<p>Se programarán los emails del simulacro" + (ini ? " empezando el " + esc(ini) : " empezando el siguiente día hábil") + ". <strong>No saldrá ninguno</strong> hasta que el envío real esté encendido. Los textos quedan fijados tal como los viste en el simulacro.</p>",
        ok: camp.estado === "pausada" ? "Reanudar" : "Activar campaña",
        run: async function () { var r = await db.rpc("activar_campana", { p_campana: id, p_inicio: ini }); if (r.error) throw r.error; } })
        .then(function (ok) { if (ok) { toast("Campaña activa"); showCampana(id); } });
    });
    if (bPau) bPau.addEventListener("click", async function () { var r = await db.rpc("pausar_campana", { p_campana: id }); if (r.error) toast(friendly(r.error), true); else { toast("Campaña pausada"); showCampana(id); } });
    if (bTer) bTer.addEventListener("click", function () {
      confirmDialog({ title: "Terminar campaña", body: "<p>Se cancelan los emails que aún no han salido. Los ya enviados y las respuestas se conservan.</p>", ok: "Terminar", danger: true,
        run: async function () { var r = await db.rpc("terminar_campana", { p_campana: id }); if (r.error) throw r.error; } }).then(function (ok) { if (ok) { toast("Campaña terminada"); showCampana(id); } });
    });

    // ---- simulacro
    document.getElementById("sim_go").addEventListener("click", async function () {
      var b = this; b.disabled = true; var out = document.getElementById("sim_out"); out.innerHTML = '<p class="muted">Calculando…</p>';
      var ini = document.getElementById("sim_ini").value || null;
      var r = await db.rpc("simular_campana", { p_campana: id, p_inicio: ini });
      b.disabled = false;
      if (r.error) { out.innerHTML = '<p class="msg err">' + esc(friendly(r.error)) + '</p>'; return; }
      var rows = r.data, prog = rows.filter(function (x) { return x.programado_para; }), bloq = rows.filter(function (x) { return !x.programado_para; });
      if (!rows.length) { out.innerHTML = '<p class="muted">No hay contactos aprobados. Aprueba algunos arriba y vuelve a generar el simulacro.</p>'; return; }
      var dias = {}, orden = [];
      prog.forEach(function (x) { var d = diaMad(x.programado_para); if (!dias[d]) { dias[d] = []; orden.push(d); } dias[d].push(x); });
      var nContactos = new Set(prog.map(function (x) { return x.contacto_id; })).size;
      var html = '<p class="small"><strong>' + nContactos + ' contacto(s) programado(s) · ' + prog.length + ' emails</strong>' + (orden.length ? ' · del ' + esc(diaLargo(orden[0])) + ' al ' + esc(diaLargo(orden[orden.length - 1])) : "") + ' · tope efectivo ' + efectivo + ' al día.</p>';
      html += orden.map(function (d) {
        var l = dias[d], cnt = [1, 2, 3].map(function (p) { var n = l.filter(function (x) { return x.paso === p; }).length; return n ? n + " del paso " + p : ""; }).filter(Boolean).join(", ");
        return '<details class="day"><summary><strong>' + esc(diaLargo(d)) + '</strong> · ' + l.length + ' email(s) <span class="muted small">(' + cnt + ')</span></summary><ul class="plain">' + l.map(function (x) {
          return '<li><details><summary>' + esc(horaMad(x.programado_para)) + ' · paso ' + x.paso + ' · ' + esc(x.empresa) + ' <span class="muted small">' + esc(x.email) + '</span></summary>' +
            '<p class="small"><strong>Asunto:</strong> ' + esc(x.asunto) + '</p><pre class="guion">' + esc(x.cuerpo) + '</pre></details></li>';
        }).join("") + '</ul></details>';
      }).join("");
      if (bloq.length) html += '<h3 class="h3">Bloqueados (no saldrían) <span class="count">' + bloq.length + '</span></h3><ul class="plain">' + bloq.map(function (x) {
        return '<li><strong>' + esc(x.empresa) + '</strong> <span class="muted small">' + esc(x.email || "sin email") + '</span> <span class="motivo">' + esc(x.motivo) + '</span></li>'; }).join("") + '</ul>';
      out.innerHTML = html;
    });
  }

  /* ------------------------------------------------------------ plantillas */
  async function showPlantillas() {
    shell('<p class="muted">Cargando…</p>');
    var res = await Promise.all([
      db.from("plantillas").select("*").order("nombre").order("idioma").order("paso"),
      db.from("configuracion").select("valor").eq("clave", "firma").maybeSingle()
    ]);
    if (res[0].error) return fail("No se pudo leer: " + res[0].error.message);
    var pls = res[0].data, firma = res[1].data ? res[1].data.valor : "";
    var grupos = {}; pls.forEach(function (p) { (grupos[p.nombre] = grupos[p.nombre] || []).push(p); });
    shell('<p><a href="#/campanas">← Campañas</a></p><div class="sec-h"><h1 class="page">Plantillas</h1><button type="button" class="ghost sm" id="pf">Editar firma</button></div>' +
      '<p class="small muted">Variables disponibles: <code>' + esc(VARIABLES_AYUDA) + '</code>. Si una plantilla exige una variable y el contacto no la tiene, ese contacto queda bloqueado. Sin línea de baja, por decisión tuya.</p>' +
      '<section class="card wide"><h2>Firma <span class="count">({firma})</span></h2><pre class="guion">' + esc(firma) + '</pre></section>' +
      Object.keys(grupos).map(function (n) {
        return '<section class="card wide"><h2>' + esc(n) + '</h2><ul class="plain">' + grupos[n].map(function (p) {
          return '<li><div class="li-h"><span><span class="tag">' + esc(p.idioma.toUpperCase()) + ' · paso ' + p.paso + '</span> <strong>' + esc(p.asunto) + '</strong>' +
            (p.revisada ? "" : ' <span class="tag warn">Sin revisar</span>') + (p.activa ? "" : ' <span class="tag">Inactiva</span>') + '</span>' +
            '<span class="li-a"><button type="button" class="ghost sm" data-pe="' + p.id + '">Editar</button>' + (p.revisada ? "" : '<button type="button" class="primary sm" data-pr="' + p.id + '">Marcar revisada</button>') + '</span></div>' +
            '<details class="prep"><summary>Ver texto</summary><pre class="guion">' + esc(p.cuerpo) + '</pre><p class="small muted">Exige: ' + esc((p.variables_requeridas || []).join(", ") || "nada") + '</p></details></li>';
        }).join("") + '</ul></section>';
      }).join(""));
    document.getElementById("pf").addEventListener("click", function () {
      openForm("Firma de los emails", [{ k: "valor", label: "Texto ({firma})", type: "textarea", rows: 5, req: true }], { valor: firma }, async function (v) {
        must(await db.from("configuracion").update({ valor: v.valor, actualizado_en: new Date().toISOString() }).eq("clave", "firma")); toast("Firma guardada"); showPlantillas();
      });
    });
    root.querySelectorAll("[data-pe]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = pls.filter(function (x) { return x.id === b.getAttribute("data-pe"); })[0];
        openForm("Editar plantilla " + p.nombre + " · " + p.idioma.toUpperCase() + " · paso " + p.paso, [
          { k: "asunto", label: "Asunto", req: true },
          { k: "cuerpo", label: "Cuerpo (variables: " + VARIABLES_AYUDA + ")", type: "textarea", rows: 14, req: true },
          { k: "variables_requeridas", label: "Variables obligatorias", type: "csv" },
          { k: "activa", label: "Activa", type: "checkbox" }
        ], p, async function (v) {
          v.revisada = true; // al guardarla tú, cuenta como revisada
          must(await db.from("plantillas").update(v).eq("id", p.id)); toast("Plantilla guardada y marcada como revisada"); showPlantillas();
        });
      });
    });
    root.querySelectorAll("[data-pr]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var u = await db.from("plantillas").update({ revisada: true }).eq("id", b.getAttribute("data-pr"));
        if (u.error) toast(friendly(u.error), true); else { toast("Marcada como revisada"); showPlantillas(); }
      });
    });
  }

  /* ------------------------------------------------------------ prospección */
  var ESTADO_SOL = { pendiente: "Pendiente", en_curso: "En curso", hecha: "Hecha", error: "Con error", cancelada: "Cancelada" };

  async function showProspeccion() {
    shell('<p class="muted">Cargando…</p>');
    var r = await db.from("solicitudes_prospeccion").select("*").order("creada_en", { ascending: false }).limit(50);
    if (r.error) return fail("No se pudo leer: " + r.error.message);
    var sols = r.data;
    shell('<h1 class="page">Prospección</h1>' +
      '<p class="muted">Pide que se busquen empresas nuevas. Una tarea programada atiende las peticiones <strong>una vez al día por la mañana</strong> (máximo 30 empresas al día) y las carga como etapa «Nueva». <strong>No envía nada.</strong> Solo se cargan empresas con web propia comprobada y email verificado, con su análisis de web.</p>' +
      '<section class="card wide"><h2>Nueva petición</h2><form id="sf">' +
      '<label for="s_sector">Qué empresas buscar *</label><input id="s_sector" type="text" required placeholder="p. ej. fabricantes de muebles y lámparas">' +
      '<label for="s_zona">Zona</label><input id="s_zona" type="text" placeholder="p. ej. Extremadura, toda España, Alemania">' +
      '<label for="s_cant">Cuántas (1–30)</label><input id="s_cant" type="number" min="1" max="30" value="10" required>' +
      '<label for="s_notas">Criterios o notas</label><textarea id="s_notas" rows="3" placeholder="p. ej. con tienda online propia, más de 5 empleados…"></textarea>' +
      '<p class="msg err" id="serr" role="alert"></p><div class="actions left"><button type="submit">Pedir prospección</button></div></form></section>' +
      '<section class="card wide"><h2>Peticiones <span class="count">' + sols.length + '</span></h2>' +
      (sols.length ? '<ul class="plain">' + sols.map(function (s) {
        return '<li><div class="li-h"><span><strong>' + esc(s.sector) + '</strong>' + (s.zona ? ' · ' + esc(s.zona) : "") + ' · ' + s.cantidad + ' <span class="tag">' + esc(ESTADO_SOL[s.estado] || s.estado) + '</span></span>' +
          '<span class="li-a">' + (s.estado === "pendiente" ? '<button type="button" class="ghost sm" data-cancel="' + s.id + '">Cancelar</button>' : "") + '</span></div>' +
          '<span class="muted small">' + esc(fecha(s.creada_en)) + (s.procesada_en ? ' · atendida ' + esc(fecha(s.procesada_en)) + ' · ' + s.empresas_cargadas + ' cargada(s)' : "") + '</span>' +
          (s.notas ? '<br><span class="small">' + esc(s.notas) + '</span>' : "") +
          (s.resultado ? '<br><span class="small pre">' + esc(s.resultado) + '</span>' : "") + '</li>';
      }).join("") + '</ul>' : '<p class="muted">Aún no hay peticiones.</p>') + '</section>');
    document.getElementById("sf").addEventListener("submit", async function (e) {
      e.preventDefault();
      var b = e.target.querySelector("button"); b.disabled = true;
      var v = function (id) { return document.getElementById(id).value.trim() || null; };
      var n = Number(document.getElementById("s_cant").value);
      var ins = await db.from("solicitudes_prospeccion").insert({ sector: v("s_sector"), zona: v("s_zona"), cantidad: n, notas: v("s_notas") });
      if (ins.error) { document.getElementById("serr").textContent = friendly(ins.error); b.disabled = false; return; }
      toast("Petición guardada: se atenderá en la próxima ejecución diaria"); showProspeccion();
    });
    root.querySelectorAll("[data-cancel]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var u = await db.from("solicitudes_prospeccion").update({ estado: "cancelada" }).eq("id", b.getAttribute("data-cancel")).eq("estado", "pendiente");
        if (u.error) toast(friendly(u.error), true); else { toast("Petición cancelada"); showProspeccion(); }
      });
    });
  }

  /* ------------------------------------------------------------ ficha */
  function field(label, val) { return val ? '<div class="f"><dt>' + esc(label) + '</dt><dd>' + val + '</dd></div>' : ""; }
  function btn(act, label, cls) { return '<button type="button" class="' + (cls || "ghost") + ' sm" data-act="' + act + '">' + esc(label) + '</button>'; }

  async function showEmpresa(id) {
    shell('<p class="muted">Cargando…</p>');
    var res = await Promise.all([
      db.from("empresas").select("*,sectores(nombre)").eq("id", id).maybeSingle(),
      db.from("contactos").select("*").eq("empresa_id", id).order("es_principal", { ascending: false }),
      db.from("oportunidades").select("*").eq("empresa_id", id).order("creado_en", { ascending: false }),
      db.from("tareas").select("*").eq("empresa_id", id).order("vence_el", { ascending: true, nullsFirst: false }),
      db.from("interacciones").select("*").eq("empresa_id", id).order("ocurrio_en", { ascending: false })
    ]);
    var err = res.map(function (x) { return x.error; }).filter(Boolean)[0];
    if (err) return fail("No se pudo leer: " + err.message);
    var e = res[0].data;
    if (!e) return fail("Empresa no encontrada.");
    var cont = res[1].data, ops = res[2].data, tar = res[3].data, ints = res[4].data;
    ctx = { e: e, cont: cont, ops: ops, tar: tar, ints: ints };
    var web = safeUrl(e.web_url) || (e.dominio ? "https://" + e.dominio : null);
    var lugar = [e.poblacion, e.region, e.pais].filter(Boolean).join(", ");

    var h = '<p><a href="#/empresas">← Empresas</a></p>' +
      '<div class="head"><h1 class="page">' + esc(e.nombre) + '</h1>' +
      '<span class="tag">' + esc(TIPOS[e.tipo] || e.tipo) + '</span>' +
      (e.no_contactar ? ' <span class="tag bad">No contactar</span>' : '') + '</div>' +
      '<div class="etapa-row"><label for="etapa">Etapa</label><select id="etapa" class="stage-' + e.etapa + '">' +
      Object.keys(ETAPAS).map(function (k) { return '<option value="' + k + '"' + (e.etapa === k ? " selected" : "") + '>' + esc(ETAPAS[k]) + '</option>'; }).join("") + '</select></div>' +
      '<section class="card wide"><div class="sec-h"><h2>Datos</h2>' + btn("edit-empresa", "Editar") + '</div><dl class="grid">' +
      field("Web", web ? '<a href="' + esc(web) + '" target="_blank" rel="noopener noreferrer">' + esc(e.dominio || web) + '</a>' : "") +
      field("Lugar", esc(lugar)) +
      field("Sector", esc(e.sectores ? e.sectores.nombre : "") + (e.sector_detalle ? '<br><span class="muted small">' + esc(e.sector_detalle) + '</span>' : "")) +
      field("Idioma", esc((e.idioma || "").toUpperCase())) +
      field("Empleados (aprox.)", esc(e.empleados_aprox)) +
      field("Productos (aprox.)", esc(e.num_productos_aprox)) +
      field("Canales de venta", esc((e.canales_venta || []).join(", "))) +
      field("Origen", esc(e.origen) + (e.origen_detalle ? ' · ' + esc(e.origen_detalle) : "") + ' · ' + esc(fecha(e.origen_fecha))) +
      field("Gancho", esc(e.gancho)) +
      field("Producto a citar", esc(e.producto_a_citar)) +
      field("Análisis de la web", esc(e.analisis_web)) +
      field("Puntos débiles", (e.puntos_debiles || []).length ? '<ul>' + e.puntos_debiles.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join("") + '</ul>' : "") +
      field("Notas", esc(e.notas)) +
      '</dl></section>';

    h += '<section class="card wide"><div class="sec-h"><h2>Contactos <span class="count">' + cont.length + '</span></h2>' + btn("add-contacto", "+ Añadir") + '</div>' +
      (cont.length ? '<ul class="plain">' + cont.map(function (c) {
        return '<li><div class="li-h"><span><strong>' + esc(c.nombre || "(sin nombre)") + '</strong>' + (c.cargo ? ' · ' + esc(c.cargo) : "") +
          (c.es_principal ? ' <span class="tag">Principal</span>' : "") + (c.no_contactar ? ' <span class="tag bad">No contactar</span>' : "") + '</span>' +
          '<span class="li-a">' + btn("edit-contacto:" + c.id, "Editar") + btn("del-contacto:" + c.id, "Borrar") + '</span></div>' +
          '<span class="muted">' + [c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : "", esc(c.telefono), c.whatsapp ? "WhatsApp " + esc(c.whatsapp) : "",
            safeUrl(c.linkedin_url) ? '<a href="' + esc(c.linkedin_url) + '" target="_blank" rel="noopener noreferrer">LinkedIn</a>' : ""].filter(Boolean).join(" · ") + '</span>' +
          (c.notas ? '<br><span class="small">' + esc(c.notas) + '</span>' : "") + '</li>';
      }).join("") + '</ul>' : '<p class="muted">Sin contactos.</p>') + '</section>';

    h += '<section class="card wide"><div class="sec-h"><h2>Oportunidades <span class="count">' + ops.length + '</span></h2>' + btn("add-op", "+ Añadir") + '</div>' +
      (ops.length ? '<ul class="plain">' + ops.map(function (o) {
        return '<li><div class="li-h"><span><strong>' + esc(o.titulo) + '</strong> <span class="tag">' + esc(ESTADO_OP[o.estado] || o.estado) + '</span> ' + esc(dinero(o.importe)) + '</span>' +
          '<span class="li-a">' + btn("edit-op:" + o.id, "Editar") + btn("del-op:" + o.id, "Borrar") + '</span></div>' +
          (o.motivo_perdida ? '<span class="muted small">Motivo: ' + esc(o.motivo_perdida) + '</span>' : "") +
          (o.notas ? '<br><span class="small">' + esc(o.notas) + '</span>' : "") + '</li>';
      }).join("") + '</ul>' : '<p class="muted">Sin oportunidades.</p>') + '</section>';

    h += '<section class="card wide"><div class="sec-h"><h2>Tareas <span class="count">' + tar.length + '</span></h2><span class="li-a">' + btn("cadencia", "Iniciar cadencia") + btn("add-tarea", "+ Añadir") + '</span></div>' +
      (tar.length ? '<ul class="plain">' + tar.map(function (t) {
        var pend = t.estado === "pendiente";
        return '<li class="' + (pend ? "" : "done") + '"><div class="li-h"><span><strong>' + esc(t.titulo) + '</strong> <span class="tag">' + esc(t.estado) + '</span>' + (t.repite ? ' <span class="tag">se repite: ' + esc(t.repite) + '</span>' : "") + (t.vence_el ? ' · vence ' + esc(fecha(t.vence_el)) : "") + '</span>' +
          '<span class="li-a">' + (pend ? btn("tarea:" + t.id + ":hecha", "Hecha", "primary") + btn("tarea:" + t.id + ":cancelada", "Cancelar") : btn("tarea:" + t.id + ":pendiente", "Reabrir")) + btn("edit-tarea:" + t.id, "Editar") + btn("del-tarea:" + t.id, "Borrar") + '</span></div>' +
          (t.notas ? '<span class="muted small">' + esc(t.notas) + '</span>' : "") + '</li>';
      }).join("") + '</ul>' : '<p class="muted">Sin tareas.</p>') + '</section>';

    h += '<section class="card wide"><div class="sec-h"><h2>Historial <span class="count">' + ints.length + '</span></h2>' + btn("add-inter", "+ Añadir nota o contacto") + '</div>' +
      (ints.length ? '<ul class="plain">' + ints.map(function (i) {
        return '<li><div class="li-h"><span><span class="muted small">' + esc(fecha(i.ocurrio_en)) + '</span> · <strong>' + esc(TIPO_INTER[i.tipo] || i.tipo) + '</strong>' +
          (i.asunto ? ' — ' + esc(i.asunto) : "") + (i.resultado ? ' <span class="tag">' + esc(i.resultado) + '</span>' : "") + '</span>' +
          '<span class="li-a">' + btn("del-inter:" + i.id, "Borrar") + '</span></div>' +
          (i.contenido ? '<span class="small pre">' + esc(i.contenido) + '</span>' : "") + '</li>';
      }).join("") + '</ul>' : '<p class="muted">Sin historial.</p>') + '</section>';

    h += '<section class="card wide danger-zone"><h2>Bajas y borrado</h2>' +
      '<p class="small muted">«Dar de baja» bloquea todo envío futuro a esta empresa y guarda sus emails (y su web) en la lista de exclusión. «Borrar datos» elimina la empresa y todo lo asociado a petición del interesado; solo queda la lista de exclusión.</p>' +
      '<div class="actions left">' + (e.no_contactar ? '<span class="tag bad">Ya está de baja</span>' : btn("baja", "Dar de baja", "danger")) + btn("borrar", "Borrar datos de esta empresa", "danger") + '</div></section>';

    shell(h);
  }

  /* ------------------------------------------------------------ acciones de la ficha */
  var F = {};
  F.empresa = function () {
    return [
      { k: "nombre", label: "Nombre", req: true },
      { k: "tipo", label: "Tipo", type: "select", options: TIPOS },
      { k: "web_url", label: "Web (URL completa)" },
      { k: "dominio", label: "Dominio (se rellena solo desde la web si lo dejas vacío)" },
      { k: "pais", label: "País" }, { k: "region", label: "Región" }, { k: "poblacion", label: "Población" },
      { k: "sector_id", label: "Sector", type: "select", options: sectorOptions() },
      { k: "idioma", label: "Idioma", type: "select", options: IDIOMAS },
      { k: "empleados_aprox", label: "Empleados (aprox.)", type: "number" },
      { k: "num_productos_aprox", label: "Productos (aprox.)", type: "number" },
      { k: "canales_venta", label: "Canales de venta", type: "csv" },
      { k: "gancho", label: "Gancho", type: "textarea" },
      { k: "producto_a_citar", label: "Producto a citar" },
      { k: "analisis_web", label: "Análisis de la web", type: "textarea", rows: 4 },
      { k: "puntos_debiles", label: "Puntos débiles", type: "lines" },
      { k: "notas", label: "Notas", type: "textarea" }
    ];
  };
  function sectorOptions() {
    var o = { "": "(sin clasificar)" };
    (cache.sectores || []).forEach(function (s) { o[s.id] = s.nombre; });
    return o;
  }
  F.contacto = [
    { k: "nombre", label: "Nombre" }, { k: "cargo", label: "Cargo" },
    { k: "email", label: "Email", type: "email" }, { k: "telefono", label: "Teléfono" }, { k: "whatsapp", label: "WhatsApp" },
    { k: "linkedin_url", label: "LinkedIn (URL)" },
    { k: "idioma", label: "Idioma", type: "select", options: IDIOMAS },
    { k: "canal_preferido", label: "Canal preferido", type: "select", options: CANALES },
    { k: "es_principal", label: "Contacto principal", type: "checkbox" },
    { k: "no_contactar", label: "No contactar", type: "checkbox" },
    { k: "notas", label: "Notas", type: "textarea" }
  ];
  F.op = [
    { k: "titulo", label: "Título", req: true },
    { k: "importe", label: "Importe (€)", type: "number" },
    { k: "estado", label: "Estado", type: "select", options: ESTADO_OP },
    { k: "motivo_perdida", label: "Motivo de pérdida (obligatorio si está perdida)" },
    { k: "fecha_propuesta", label: "Fecha de propuesta", type: "date" },
    { k: "fecha_cierre", label: "Fecha de cierre", type: "date" },
    { k: "notas", label: "Notas", type: "textarea" }
  ];
  F.tarea = [
    { k: "titulo", label: "Título", req: true },
    { k: "tipo", label: "Tipo", type: "select", options: TIPO_TAREA },
    { k: "vence_el", label: "Vence el", type: "date" },
    { k: "repite", label: "Se repite", type: "select", options: REPITE },
    { k: "notas", label: "Notas", type: "textarea" }
  ];
  F.inter = [
    { k: "tipo", label: "Tipo", type: "select", options: TIPO_INTER },
    { k: "ocurrio_en", label: "Fecha", type: "date", req: true },
    { k: "asunto", label: "Asunto" },
    { k: "resultado", label: "Resultado" },
    { k: "contenido", label: "Detalle", type: "textarea", rows: 4 }
  ];

  function pick(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }
  function refresh() { cache.empresas = null; return showEmpresa(ctx.e.id); }
  function norm0(o) { // empty strings → null en selects
    Object.keys(o).forEach(function (k) { if (o[k] === "") o[k] = null; });
    return o;
  }

  async function guardarEmpresa(p) {
    norm0(p);
    p.dominio = p.dominio ? dominioDe(p.dominio) : dominioDe(p.web_url);
    p.sector_id = p.sector_id || null;
    must(await db.from("empresas").update(p).eq("id", ctx.e.id));
  }

  async function quitarPrincipalDeOtros(id) {
    must(await db.from("contactos").update({ es_principal: false }).eq("empresa_id", ctx.e.id).neq("id", id || "00000000-0000-0000-0000-000000000000"));
  }

  async function darDeBaja() {
    var e = ctx.e, emails = ctx.cont.map(function (c) { return c.email; }).filter(Boolean);
    if (emails.length) must(await db.from("exclusiones").upsert(emails.map(function (m) { return { email: m, motivo: "baja", notas: "Baja desde la ficha de " + e.nombre }; }), { onConflict: "email", ignoreDuplicates: true }));
    if (e.dominio) must(await db.from("exclusiones").upsert([{ dominio: e.dominio, motivo: "baja", notas: "Baja desde la ficha de " + e.nombre }], { onConflict: "dominio", ignoreDuplicates: true }));
    must(await db.from("contactos").update({ no_contactar: true }).eq("empresa_id", e.id));
    must(await db.from("empresas").update({ no_contactar: true }).eq("id", e.id));
    must(await db.from("interacciones").insert({ empresa_id: e.id, tipo: "nota", ocurrio_en: new Date().toISOString(), asunto: "Baja registrada", contenido: "Marcada «No contactar» y añadida a la lista de exclusión." }));
  }

  async function borrarDatos() {
    var e = ctx.e, emails = ctx.cont.map(function (c) { return c.email; }).filter(Boolean);
    if (emails.length) must(await db.from("exclusiones").upsert(emails.map(function (m) { return { email: m, motivo: "borrado_solicitado" }; }), { onConflict: "email", ignoreDuplicates: true }));
    if (e.dominio) must(await db.from("exclusiones").upsert([{ dominio: e.dominio, motivo: "borrado_solicitado" }], { onConflict: "dominio", ignoreDuplicates: true }));
    must(await db.from("empresas").delete().eq("id", e.id));
  }

  async function onAction(act) {
    var p = act.split(":"), a = p[0], id = p[1];
    var e = ctx.e;
    if (a === "edit-empresa") {
      await loadSectores().catch(function () {});
      return openForm("Editar empresa", F.empresa(), Object.assign({}, e, { sector_id: e.sector_id || "" }), async function (v) { await guardarEmpresa(v); toast("Empresa guardada"); await refresh(); });
    }
    if (a === "add-contacto") return openForm("Nuevo contacto", F.contacto, { idioma: e.idioma, canal_preferido: "", es_principal: ctx.cont.length === 0 }, async function (v) {
      norm0(v); if (v.es_principal) await quitarPrincipalDeOtros();
      must(await db.from("contactos").insert(Object.assign({ empresa_id: e.id }, v))); toast("Contacto añadido"); await refresh();
    });
    if (a === "edit-contacto") { var c = pick(ctx.cont, id); return openForm("Editar contacto", F.contacto, Object.assign({}, c, { canal_preferido: c.canal_preferido || "" }), async function (v) {
      norm0(v); if (v.es_principal) await quitarPrincipalDeOtros(id);
      must(await db.from("contactos").update(v).eq("id", id)); toast("Contacto guardado"); await refresh();
    }); }
    if (a === "del-contacto") { var c2 = pick(ctx.cont, id); return confirmDialog({ title: "Borrar contacto", body: "<p>¿Borrar a <strong>" + esc(c2.nombre || c2.email || "este contacto") + "</strong>? Esto no lo añade a la lista de exclusión.</p>", ok: "Borrar", danger: true,
      run: async function () { must(await db.from("contactos").delete().eq("id", id)); } }).then(function (ok) { if (ok) { toast("Contacto borrado"); refresh(); } }); }
    if (a === "add-op") return openForm("Nueva oportunidad", F.op, { estado: "abierta" }, async function (v) {
      must(await db.from("oportunidades").insert(Object.assign({ empresa_id: e.id }, norm0(v)))); toast("Oportunidad añadida"); await refresh();
    });
    if (a === "edit-op") return openForm("Editar oportunidad", F.op, pick(ctx.ops, id), async function (v) {
      norm0(v); must(await db.from("oportunidades").update(v).eq("id", id)); toast("Oportunidad guardada"); await refresh();
    });
    if (a === "del-op") return confirmDialog({ title: "Borrar oportunidad", body: "<p>¿Borrar <strong>" + esc(pick(ctx.ops, id).titulo) + "</strong>?</p>", ok: "Borrar", danger: true,
      run: async function () { must(await db.from("oportunidades").delete().eq("id", id)); } }).then(function (ok) { if (ok) { toast("Oportunidad borrada"); refresh(); } });
    if (a === "cadencia") return openForm("Iniciar cadencia de " + e.nombre, [{ k: "fecha", label: "Fecha del email 1 (día 1)", type: "date", req: true }], { fecha: hoy() }, async function (v) {
      must(await db.rpc("iniciar_cadencia", { p_empresa: e.id, p_fecha: v.fecha })); cache.empresas = null;
      toast("Cadencia iniciada: LinkedIn el día 2 y llamada el día 8"); await refresh();
    });
    if (a === "add-tarea") return openForm("Nueva tarea", F.tarea, { tipo: "otro" }, async function (v) {
      norm0(v); must(await db.from("tareas").insert(Object.assign({ empresa_id: e.id, origen: "manual" }, v))); toast("Tarea añadida"); await refresh();
    });
    if (a === "edit-tarea") return openForm("Editar tarea", F.tarea, pick(ctx.tar, id), async function (v) {
      norm0(v); must(await db.from("tareas").update(v).eq("id", id)); toast("Tarea guardada"); await refresh();
    });
    if (a === "tarea") { var est = p[2]; must(await db.from("tareas").update({ estado: est, completada_en: est === "hecha" ? new Date().toISOString() : null }).eq("id", id)); toast("Tarea " + est); return refresh(); }
    if (a === "del-tarea") return confirmDialog({ title: "Borrar tarea", body: "<p>¿Borrar <strong>" + esc(pick(ctx.tar, id).titulo) + "</strong>?</p>", ok: "Borrar", danger: true,
      run: async function () { must(await db.from("tareas").delete().eq("id", id)); } }).then(function (ok) { if (ok) { toast("Tarea borrada"); refresh(); } });
    if (a === "add-inter") return openForm("Añadir al historial", F.inter, { tipo: "nota", ocurrio_en: hoy() }, async function (v) {
      var dir = { email_enviado: "saliente", linkedin_mensaje: "saliente", email_recibido: "entrante", linkedin_respuesta: "entrante" }[v.tipo] || null;
      v.ocurrio_en = new Date(v.ocurrio_en + "T12:00:00").toISOString(); v.direccion = dir;
      must(await db.from("interacciones").insert(Object.assign({ empresa_id: e.id }, v))); toast("Añadido al historial"); await refresh();
    });
    if (a === "del-inter") return confirmDialog({ title: "Borrar del historial", body: "<p>¿Borrar esta entrada del historial?</p>", ok: "Borrar", danger: true,
      run: async function () { must(await db.from("interacciones").delete().eq("id", id)); } }).then(function (ok) { if (ok) { toast("Entrada borrada"); refresh(); } });
    if (a === "baja") return confirmDialog({ title: "Dar de baja a " + e.nombre,
      body: "<p>Se marcará <strong>No contactar</strong> en la empresa y en todos sus contactos, y se añadirán a la lista de exclusión sus emails" + (e.dominio ? " y el dominio <strong>" + esc(e.dominio) + "</strong>" : "") + ". Esto bloquea todo envío futuro.</p>",
      ok: "Dar de baja", danger: true, run: darDeBaja }).then(function (ok) { if (ok) { toast("Baja registrada"); refresh(); } });
    if (a === "borrar") return confirmDialog({ title: "Borrar todos los datos de " + e.nombre,
      body: "<p>Se eliminarán la empresa, sus " + ctx.cont.length + " contacto(s), oportunidades, tareas e historial. <strong>No se puede deshacer.</strong> Solo permanecerá la lista de exclusión (emails" + (e.dominio ? " y dominio" : "") + ") para no volver a escribirle.</p>",
      ok: "Borrar definitivamente", danger: true, type: e.nombre, run: borrarDatos }).then(function (ok) { if (ok) { cache.empresas = null; toast("Datos borrados"); location.hash = "#/empresas"; } });
  }

  root.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]");
    if (b && ctx) { onAction(b.getAttribute("data-act")).catch(function (err) { toast(friendly(err), true); }); }
  });
  root.addEventListener("change", async function (ev) {
    if (ev.target.id !== "etapa" || !ctx) return;
    var sel = ev.target, nueva = sel.value, vieja = ctx.e.etapa;
    try {
      must(await db.from("empresas").update({ etapa: nueva }).eq("id", ctx.e.id));
      ctx.e.etapa = nueva; sel.className = "stage-" + nueva; cache.empresas = null;
      toast("Etapa: " + ETAPAS[nueva]);
      showEmpresa(ctx.e.id); // las tareas automáticas las crea la base de datos
    } catch (err) { sel.value = vieja; toast(friendly(err), true); }
  });

  /* ------------------------------------------------------------ rutas */
  async function route() {
    var s = (await db.auth.getSession()).data.session;
    session = s;
    if (!s) return showLogin();
    loadSectores().catch(function () {});
    var m = (location.hash || "").match(/^#\/empresa\/([0-9a-f-]{36})$/i);
    if (m) showEmpresa(m[1]);
    else if (/^#\/tablero/.test(location.hash)) showBoard();
    else if (/^#\/resumen/.test(location.hash)) showSummary();
    else if (/^#\/prospeccion/.test(location.hash)) showProspeccion();
    else if (/^#\/campanas/.test(location.hash)) showCampanas();
    else if (/^#\/campana\/[0-9a-f-]{36}$/i.test(location.hash)) showCampana(location.hash.slice(10));
    else if (/^#\/plantillas/.test(location.hash)) showPlantillas();
    else if (/^#\/empresas/.test(location.hash)) showList();
    else showHoy();
  }

  var hash = location.hash || "";
  if (/error_description=/.test(hash)) {
    var d = decodeURIComponent((hash.match(/error_description=([^&]+)/) || [])[1] || "").replace(/\+/g, " ");
    history.replaceState(null, "", location.pathname);
    showLogin("El enlace no es válido o ha caducado. Pide uno nuevo. (" + d + ")", true);
  } else {
    db.auth.onAuthStateChange(function (ev, s) {
      if (ev === "SIGNED_IN" && s) {
        if (/access_token=/.test(location.hash)) history.replaceState(null, "", location.pathname);
        if (!session || session.user.id !== s.user.id) { session = s; route(); }
      }
      if (ev === "SIGNED_OUT") { session = null; ctx = null; showLogin(); }
    });
    route();
  }
  window.addEventListener("hashchange", function () { if (session) route(); });
})();
