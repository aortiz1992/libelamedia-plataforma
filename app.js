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

  function esc(s) { return s == null ? "" : String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : null; }
  function fecha(d) { return d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : ""; }
  function dinero(n) { return n == null ? "" : Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function hoy() { return new Date().toISOString().slice(0, 10); }
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
    setHtml('<header class="bar"><a class="brand" href="#/">LIBELAMEDIA</a>' +
      '<span class="who"><span class="muted">' + esc(session.user.email) + '</span> ' +
      '<button class="ghost" id="out">Salir</button></span></header>' + inner);
    document.getElementById("out").addEventListener("click", async function () {
      cache.empresas = null; await db.auth.signOut(); showLogin();
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

    var h = '<p><a href="#/">← Empresas</a></p>' +
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

    h += '<section class="card wide"><div class="sec-h"><h2>Tareas <span class="count">' + tar.length + '</span></h2>' + btn("add-tarea", "+ Añadir") + '</div>' +
      (tar.length ? '<ul class="plain">' + tar.map(function (t) {
        var pend = t.estado === "pendiente";
        return '<li class="' + (pend ? "" : "done") + '"><div class="li-h"><span><strong>' + esc(t.titulo) + '</strong> <span class="tag">' + esc(t.estado) + '</span>' + (t.vence_el ? ' · vence ' + esc(fecha(t.vence_el)) : "") + '</span>' +
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
      ok: "Borrar definitivamente", danger: true, type: e.nombre, run: borrarDatos }).then(function (ok) { if (ok) { cache.empresas = null; toast("Datos borrados"); location.hash = "#/"; } });
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
    } catch (err) { sel.value = vieja; toast(friendly(err), true); }
  });

  /* ------------------------------------------------------------ rutas */
  async function route() {
    var s = (await db.auth.getSession()).data.session;
    session = s;
    if (!s) return showLogin();
    loadSectores().catch(function () {});
    var m = (location.hash || "").match(/^#\/empresa\/([0-9a-f-]{36})$/i);
    if (m) showEmpresa(m[1]); else showList();
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
