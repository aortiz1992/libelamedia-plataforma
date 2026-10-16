(function () {
  var cfg = window.LIBELA_CONFIG;
  var db = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  var root = document.getElementById("app");

  function el(html) { root.innerHTML = html; return root; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function showLogin(note, isErr) {
    el('<section class="card">' +
      '<span class="brand">LIBELAMEDIA</span>' +
      '<h1>Plataforma interna</h1>' +
      '<p class="muted">Acceso privado. Te enviaremos un enlace por email.</p>' +
      '<form id="f"><label for="email">Email</label>' +
      '<input id="email" type="email" autocomplete="email" required>' +
      '<button class="block" type="submit">Enviarme el enlace</button></form>' +
      '<p class="msg' + (isErr ? ' err' : '') + '" id="m">' + (note ? esc(note) : '') + '</p></section>');
    document.getElementById("f").addEventListener("submit", async function (e) {
      e.preventDefault();
      var btn = e.target.querySelector("button");
      btn.disabled = true;
      var email = document.getElementById("email").value.trim();
      var r = await db.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false, emailRedirectTo: cfg.siteUrl } });
      var m = document.getElementById("m");
      btn.disabled = false;
      // Mensaje igual exista o no la dirección, para no revelar quién tiene acceso.
      if (r.error && r.error.status === 429) { m.className = "msg err"; m.textContent = "Demasiados intentos. Espera un minuto."; return; }
      m.className = "msg";
      m.textContent = "Si esa dirección tiene acceso, recibirás un enlace en unos segundos.";
    });
  }

  async function showHome(session) {
    var r = await db.from("empresas").select("id", { count: "exact", head: true });
    var n = r.error ? null : r.count;
    el('<header class="bar"><span class="brand">LIBELAMEDIA</span>' +
      '<span><span class="muted">' + esc(session.user.email) + '</span> ' +
      '<button class="ghost" id="out">Salir</button></span></header>' +
      '<section class="card" style="margin-top:0;max-width:none"><p class="muted">Empresas en la base de datos</p>' +
      '<p class="stat">' + (n === null ? "—" : n) + '</p>' +
      (r.error ? '<p class="msg err">No se pudo leer: ' + esc(r.error.message) + '</p>' : '') + '</section>');
    document.getElementById("out").addEventListener("click", async function () {
      await db.auth.signOut(); showLogin();
    });
  }

  async function route() {
    var s = (await db.auth.getSession()).data.session;
    if (s) { showHome(s); } else { showLogin(); }
  }

  var hash = location.hash || "";
  if (/error_description=/.test(hash)) {
    var d = decodeURIComponent((hash.match(/error_description=([^&]+)/) || [])[1] || "").replace(/\+/g, " ");
    history.replaceState(null, "", location.pathname);
    showLogin("El enlace no es válido o ha caducado. Pide uno nuevo. (" + d + ")", true);
  } else {
    db.auth.onAuthStateChange(function (ev, session) {
      if (ev === "SIGNED_IN" && session) { history.replaceState(null, "", location.pathname); showHome(session); }
      if (ev === "SIGNED_OUT") showLogin();
    });
    route();
  }
})();
