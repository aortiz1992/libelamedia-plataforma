(function () {
  var cfg = window.LIBELA_CONFIG;
  var db = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  var root = document.getElementById("app");
  var session = null;
  var cache = { empresas: null };

  var ETAPAS = { nueva: "Nueva", contactada: "Contactada", respondio: "Respondió", interesada: "Interesada", reunion: "Reunión", propuesta: "Propuesta", ganada: "Ganada", perdida: "Perdida" };
  var TIPOS = { cliente_directo: "Cliente directo", partner: "Partner", proveedor: "Proveedor" };
  var TIPO_INTER = { email_enviado: "Email enviado", email_recibido: "Email recibido", llamada: "Llamada", linkedin_mensaje: "LinkedIn", linkedin_respuesta: "Respuesta LinkedIn", whatsapp: "WhatsApp", reunion: "Reunión", nota: "Nota" };

  function esc(s) { return s == null ? "" : String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : null; }
  function fecha(d) { return d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : ""; }
  function dinero(n) { return n == null ? "" : Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function setHtml(html) { root.innerHTML = html; }

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
    var web = safeUrl(e.web_url) || (e.dominio ? "https://" + e.dominio : null);
    var lugar = [e.poblacion, e.region, e.pais].filter(Boolean).join(", ");

    var h = '<p><a href="#/">← Empresas</a></p>' +
      '<div class="head"><h1 class="page">' + esc(e.nombre) + '</h1>' +
      '<span class="tag stage-' + e.etapa + '">' + esc(ETAPAS[e.etapa]) + '</span> ' +
      '<span class="tag">' + esc(TIPOS[e.tipo] || e.tipo) + '</span>' +
      (e.no_contactar ? ' <span class="tag bad">No contactar</span>' : '') + '</div>' +
      '<section class="card wide"><h2>Datos</h2><dl class="grid">' +
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

    h += '<section class="card wide"><h2>Contactos <span class="count">' + cont.length + '</span></h2>' +
      (cont.length ? '<ul class="plain">' + cont.map(function (c) {
        return '<li><strong>' + esc(c.nombre || "(sin nombre)") + '</strong>' + (c.cargo ? ' · ' + esc(c.cargo) : "") +
          (c.es_principal ? ' <span class="tag">Principal</span>' : "") + (c.no_contactar ? ' <span class="tag bad">No contactar</span>' : "") +
          '<br><span class="muted">' + [c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : "", esc(c.telefono), c.whatsapp ? "WhatsApp " + esc(c.whatsapp) : "",
            safeUrl(c.linkedin_url) ? '<a href="' + esc(c.linkedin_url) + '" target="_blank" rel="noopener noreferrer">LinkedIn</a>' : ""].filter(Boolean).join(" · ") + '</span>' +
          (c.notas ? '<br><span class="small">' + esc(c.notas) + '</span>' : "") + '</li>';
      }).join("") + '</ul>' : '<p class="muted">Sin contactos.</p>') + '</section>';

    h += '<section class="card wide"><h2>Oportunidades <span class="count">' + ops.length + '</span></h2>' +
      (ops.length ? '<ul class="plain">' + ops.map(function (o) {
        return '<li><strong>' + esc(o.titulo) + '</strong> <span class="tag">' + esc(o.estado) + '</span> ' + esc(dinero(o.importe)) +
          (o.motivo_perdida ? '<br><span class="muted small">Motivo: ' + esc(o.motivo_perdida) + '</span>' : "") + '</li>';
      }).join("") + '</ul>' : '<p class="muted">Sin oportunidades.</p>') + '</section>';

    h += '<section class="card wide"><h2>Tareas <span class="count">' + tar.length + '</span></h2>' +
      (tar.length ? '<ul class="plain">' + tar.map(function (t) {
        return '<li><strong>' + esc(t.titulo) + '</strong> <span class="tag">' + esc(t.estado) + '</span>' + (t.vence_el ? ' · vence ' + esc(fecha(t.vence_el)) : "") +
          (t.notas ? '<br><span class="muted small">' + esc(t.notas) + '</span>' : "") + '</li>';
      }).join("") + '</ul>' : '<p class="muted">Sin tareas.</p>') + '</section>';

    h += '<section class="card wide"><h2>Historial <span class="count">' + ints.length + '</span></h2>' +
      (ints.length ? '<ul class="plain">' + ints.map(function (i) {
        return '<li><span class="muted small">' + esc(fecha(i.ocurrio_en)) + '</span> · <strong>' + esc(TIPO_INTER[i.tipo] || i.tipo) + '</strong>' +
          (i.asunto ? ' — ' + esc(i.asunto) : "") + (i.resultado ? ' <span class="tag">' + esc(i.resultado) + '</span>' : "") +
          (i.contenido ? '<br><span class="small pre">' + esc(i.contenido) + '</span>' : "") + '</li>';
      }).join("") + '</ul>' : '<p class="muted">Sin historial.</p>') + '</section>';

    shell(h);
  }

  /* ------------------------------------------------------------ rutas */
  async function route() {
    var s = (await db.auth.getSession()).data.session;
    session = s;
    if (!s) return showLogin();
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
      if (ev === "SIGNED_OUT") { session = null; showLogin(); }
    });
    route();
  }
  window.addEventListener("hashchange", function () { if (session) route(); });
})();
