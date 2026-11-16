const app = document.getElementById("app");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
let token = localStorage.getItem("st_token");
let me = JSON.parse(localStorage.getItem("st_me") || "null");
let hotelsCache = [],
  filter = "all",
  query = "";

/* ---- Built-in "backend": same routes as a Node server, but the data lives in the browser (localStorage) ---- */
const sha = async (s) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("stayly:" + s)
      )
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
function seed() {
  return {
    users: [
      {
        id: 1,
        name: "Admin",
        email: "admin@stayly.com",
        hash: "5c37f7d663141959afccbbd26f3f5eb055d2aeb5f13efed8ab6fb22b0d915313",
        admin: true,
      },
    ],
    sessions: {},
    hotels: [
      {
        id: 1,
        name: "Palm Crest Resort",
        city: "Coastal Road",
        price: 120,
        scene: "beach",
        desc: "Beachfront rooms, two pools and a sunset terrace.",
      },
      {
        id: 2,
        name: "The Grand Meridian",
        city: "City Centre",
        price: 180,
        scene: "city",
        desc: "A landmark business hotel with a rooftop restaurant.",
      },
      {
        id: 3,
        name: "Hilltop Lodge",
        city: "Highlands",
        price: 90,
        scene: "mountain",
        desc: "Quiet cabins with mountain views and a log fire.",
      },
      {
        id: 4,
        name: "Blue Harbour Suites",
        city: "Marina",
        price: 150,
        scene: "harbour",
        desc: "Spacious suites overlooking the marina.",
      },
    ],
    reviews: [
      {
        id: 1,
        hotelId: 1,
        userId: 0,
        user: "Amaka",
        rating: 5,
        text: "Spotless rooms and the pool area is lovely. Breakfast was excellent.",
        date: "2026-10-02",
      },
      {
        id: 2,
        hotelId: 2,
        userId: 0,
        user: "Tunde",
        rating: 4,
        text: "Great location and quick check-in. The lift was a bit slow.",
        date: "2026-10-09",
      },
      {
        id: 3,
        hotelId: 1,
        userId: 0,
        user: "Sam",
        rating: 3,
        text: "Nice view but the air conditioning was noisy at night.",
        date: "2026-10-15",
      },
    ],
  };
}
let db;
try {
  db = JSON.parse(localStorage.getItem("stayly_db")) || seed();
} catch (e) {
  db = seed();
}
const persist = () => {
  try {
    localStorage.setItem("stayly_db", JSON.stringify(db));
  } catch (e) {}
};
const nextId = (l) => l.reduce((m, x) => Math.max(m, x.id), 0) + 1;
const stats = (h) => {
  const r = db.reviews.filter((x) => x.hotelId === h.id);
  return {
    ...h,
    count: r.length,
    avg: r.length ? r.reduce((a, b) => a + b.rating, 0) / r.length : 0,
  };
};
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  admin: !!u.admin,
});
function startSession(u) {
  const t = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  db.sessions[t] = u.id;
  persist();
  return { token: t, user: publicUser(u) };
}

async function api(url, method = "GET", body) {
  body = body || {};
  await new Promise((r) => setTimeout(r, 250)); // small delay so the loading shimmer is visible, like a real server
  const user = db.users.find((u) => u.id === db.sessions[token]);
  const needUser = () => {
    if (!user) throw new Error("Please log in first");
  };
  const needAdmin = () => {
    needUser();
    if (!user.admin) throw new Error("Admins only");
  };
  let m;
  if (url === "/signup" && method === "POST") {
    const name = String(body.name || "").trim(),
      email = String(body.email || "")
        .trim()
        .toLowerCase(),
      pw = String(body.password || "");
    if (!name || !email.includes("@") || pw.length < 6)
      throw new Error("Enter a name, valid email and 6+ character password");
    if (db.users.some((u) => u.email === email))
      throw new Error("That email already has an account");
    const u = {
      id: nextId(db.users),
      name,
      email,
      hash: await sha(pw),
      admin: false,
    };
    db.users.push(u);
    return startSession(u);
  }
  if (url === "/login" && method === "POST") {
    const email = String(body.email || "")
        .trim()
        .toLowerCase(),
      u = db.users.find((x) => x.email === email);
    if (!u || u.hash !== (await sha(String(body.password || ""))))
      throw new Error("Wrong email or password");
    return startSession(u);
  }
  if (url === "/hotels" && method === "GET") return db.hotels.map(stats);
  if (url === "/hotels" && method === "POST") {
    needAdmin();
    if (!body.name || !body.city) throw new Error("Enter a name and area");
    const h = {
      id: nextId(db.hotels),
      name: String(body.name).trim(),
      city: String(body.city).trim(),
      price: +body.price || 100,
      scene: ["beach", "city", "mountain", "harbour"].includes(body.scene)
        ? body.scene
        : "city",
      desc: String(body.desc || "").trim(),
    };
    db.hotels.push(h);
    persist();
    return h;
  }
  if ((m = url.match(/^\/hotels\/(\d+)\/reviews$/)) && method === "POST") {
    needUser();
    const h = db.hotels.find((x) => x.id === +m[1]);
    if (!h) throw new Error("Hotel not found");
    const rating = +body.rating,
      text = String(body.text || "").trim();
    if (!(rating >= 1 && rating <= 5)) throw new Error("Pick a star rating");
    if (text.length < 10 || text.length > 400)
      throw new Error("Review must be 10 to 400 characters");
    if (db.reviews.some((r) => r.hotelId === h.id && r.userId === user.id))
      throw new Error("You already reviewed this hotel");
    const r = {
      id: nextId(db.reviews),
      hotelId: h.id,
      userId: user.id,
      user: user.name,
      rating,
      text,
      date: new Date().toISOString().slice(0, 10),
    };
    db.reviews.push(r);
    persist();
    return r;
  }
  if ((m = url.match(/^\/hotels\/(\d+)$/)) && method === "GET") {
    const h = db.hotels.find((x) => x.id === +m[1]);
    if (!h) throw new Error("Hotel not found");
    return {
      hotel: stats(h),
      reviews: db.reviews.filter((r) => r.hotelId === h.id).reverse(),
    };
  }
  if ((m = url.match(/^\/hotels\/(\d+)$/)) && method === "DELETE") {
    needAdmin();
    db.hotels = db.hotels.filter((h) => h.id !== +m[1]);
    db.reviews = db.reviews.filter((r) => r.hotelId !== +m[1]);
    persist();
    return { ok: true };
  }
  if ((m = url.match(/^\/reviews\/(\d+)$/)) && method === "DELETE") {
    needUser();
    const r = db.reviews.find((x) => x.id === +m[1]);
    if (!r) throw new Error("Review not found");
    if (!user.admin && r.userId !== user.id) throw new Error("Not allowed");
    db.reviews = db.reviews.filter((x) => x.id !== r.id);
    persist();
    return { ok: true };
  }
  if (url === "/admin/overview") {
    needAdmin();
    return {
      users: db.users.length,
      hotels: db.hotels.map(stats),
      reviews: db.reviews,
    };
  }
  throw new Error("Not found");
}

const toast = (m) => {
  const t = document.getElementById("toast");
  t.textContent = m;
  t.classList.add("show");
  clearTimeout(t.h);
  t.h = setTimeout(() => t.classList.remove("show"), 2400);
};
const fail = (e) => toast(e.message);
function setSession(d) {
  token = d.token;
  me = d.user;
  localStorage.setItem("st_token", token);
  localStorage.setItem("st_me", JSON.stringify(me));
}
function logout() {
  token = null;
  me = null;
  localStorage.removeItem("st_token");
  localStorage.removeItem("st_me");
  toast("Logged out");
  location.hash = "#/";
  nav();
}

function nav() {
  document.getElementById("nav").innerHTML = me
    ? (me.admin
        ? "<button onclick=\"location.hash='#/admin'\">Admin</button>"
        : "") + '<button onclick="logout()">Log out</button>'
    : "<button onclick=\"location.hash='#/login'\">Log in</button>";
}
/* ---- Illustrations (inline SVG, no image files needed) ---- */
const wins = (x, y, cols, rows, gap = 14) => {
  let o = "";
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      o += `<rect class="tw" x="${x + c * gap}" y="${
        y + r * gap
      }" width="7" height="8" rx="1" fill="#D9A441"/>`;
  return o;
};
const ART = {
  beach: `<rect width="400" height="200" fill="#F6E7C8"/><circle class="sun" cx="310" cy="66" r="34" fill="#D9A441"/><path class="cl" d="M40 52h60a14 14 0 0 0-8-22 20 20 0 0 0-38 4 12 12 0 0 0-14 18z" fill="#fff" opacity=".85"/><rect y="118" width="400" height="82" fill="#0F3D3E"/><rect x="130" y="80" width="120" height="50" rx="4" fill="#fff"/><rect x="120" y="74" width="140" height="10" rx="3" fill="#B3402F"/>${wins(
    142,
    92,
    6,
    2,
    18
  )}<path class="wv" d="M0 138q25-12 50 0t50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0v10H0z" fill="#2E7C7E"/><path class="wv w2" d="M0 166q25-12 50 0t50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0v40H0z" fill="#1B5C5E"/><path d="M62 132q10-34 4-70" stroke="#6B4A2B" stroke-width="7" fill="none" stroke-linecap="round"/><g class="sway"><ellipse cx="46" cy="62" rx="26" ry="8" fill="#2E7C7E" transform="rotate(-25 46 62)"/><ellipse cx="86" cy="60" rx="26" ry="8" fill="#2E7C7E" transform="rotate(25 86 60)"/><ellipse cx="66" cy="50" rx="8" ry="24" fill="#1B5C5E"/></g>`,
  city: `<rect width="400" height="200" fill="#CFE3E4"/><circle class="sun" cx="330" cy="46" r="22" fill="#fff" opacity=".9"/><path class="cl" d="M30 40h50a12 12 0 0 0-6-18 16 16 0 0 0-32 4 10 10 0 0 0-12 14z" fill="#fff" opacity=".8"/><rect x="40" y="90" width="60" height="110" fill="#2E7C7E"/><rect x="110" y="40" width="80" height="160" fill="#0F3D3E"/><rect x="200" y="70" width="70" height="130" fill="#1B5C5E"/><rect x="280" y="100" width="80" height="100" fill="#2E7C7E"/><rect x="148" y="26" width="4" height="16" fill="#0F3D3E"/><circle class="tw" cx="150" cy="24" r="4" fill="#B3402F"/>${wins(
    52,
    102,
    3,
    6
  )}${wins(122, 54, 5, 9)}${wins(212, 82, 4, 7)}${wins(
    292,
    112,
    5,
    5
  )}<rect y="186" width="400" height="14" fill="#10292B"/>`,
  mountain: `<rect width="400" height="200" fill="#DCE9EA"/><circle class="sun" cx="90" cy="54" r="26" fill="#D9A441"/><path class="cl" d="M220 50h60a14 14 0 0 0-8-22 20 20 0 0 0-38 4 12 12 0 0 0-14 18z" fill="#fff" opacity=".9"/><path d="M0 150L90 62l62 70 52-52 96 84 100-66v122H0z" fill="#9CC3C5"/><path d="M0 178L70 118l50 40 70-60 80 70 130-50v82H0z" fill="#2E7C7E"/><rect y="170" width="400" height="30" fill="#1B5C5E"/><rect x="170" y="126" width="80" height="48" fill="#6B4A2B"/><path d="M160 128l50-36 50 36z" fill="#B3402F"/><rect x="198" y="144" width="14" height="30" fill="#F6E7C8"/><rect class="tw" x="180" y="138" width="10" height="10" fill="#D9A441"/><rect class="tw" x="224" y="138" width="10" height="10" fill="#D9A441"/><g fill="#0F3D3E"><path d="M60 174l16-48 16 48z"/><path d="M286 174l14-42 14 42z"/><path d="M318 174l12-36 12 36z"/></g>`,
  harbour: `<rect width="400" height="200" fill="#E8EEF0"/><circle class="sun" cx="60" cy="56" r="26" fill="#D9A441"/><path class="cl" d="M250 44h60a14 14 0 0 0-8-22 20 20 0 0 0-38 4 12 12 0 0 0-14 18z" fill="#fff"/><rect x="230" y="70" width="110" height="70" fill="#0F3D3E"/><rect x="224" y="64" width="122" height="9" fill="#D9A441"/><rect x="350" y="96" width="40" height="44" fill="#1B5C5E"/>${wins(
    242,
    84,
    5,
    4
  )}<rect y="136" width="400" height="64" fill="#2E7C7E"/><path class="wv" d="M0 152q25-12 50 0t50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0v10H0z" fill="#1B5C5E"/><path class="wv w2" d="M0 178q25-12 50 0t50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0 50 0v30H0z" fill="#0F3D3E"/><g class="bob"><path d="M80 150h90l-14 18H94z" fill="#B3402F"/><rect x="123" y="94" width="3" height="56" fill="#10292B"/><path d="M128 98l36 46h-36z" fill="#fff"/><path d="M120 106l-30 38h30z" fill="#F6E7C8"/></g>`,
};
const SCENES = ["city", "beach", "mountain", "harbour"];
const photo = (h) =>
  `<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(
    h.name
  )} illustration">${ART[h.scene] || ART[SCENES[h.id % 4]]}</svg>`;
function view(html) {
  app.innerHTML = `<div class="view">${html}</div>`;
  window.scrollTo(0, 0);
  reveal();
}

/* animations */
function reveal() {
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.12 }
  );
  document.querySelectorAll(".rv").forEach((el, i) => {
    el.style.setProperty("--d", (i % 6) * 0.08 + "s");
    io.observe(el);
  });
  document
    .querySelectorAll("[data-w]")
    .forEach((el) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => (el.style.width = el.dataset.w + "%"))
      )
    );
  document.querySelectorAll("[data-count]").forEach((el) => {
    const end = +el.dataset.count,
      t0 = performance.now();
    (function step(t) {
      const p = Math.min((t - t0) / 900, 1);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const r = document.createElement("span"),
    s = Math.max(b.offsetWidth, b.offsetHeight),
    box = b.getBoundingClientRect();
  r.className = "ripple";
  r.style.cssText = `width:${s}px;height:${s}px;left:${
    e.clientX - box.left - s / 2
  }px;top:${e.clientY - box.top - s / 2}px`;
  b.appendChild(r);
  setTimeout(() => r.remove(), 600);
});
window.addEventListener("scroll", () =>
  document.getElementById("top").classList.toggle("sc", scrollY > 10)
);
function burst(x, y) {
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    s.className = "fly";
    s.textContent = "★";
    s.style.cssText = `left:${x}px;top:${y}px;--x:${
      (Math.random() - 0.5) * 320
    }px;--y:${(Math.random() - 0.8) * 300}px`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }
}

/* pages */
async function home() {
  view(`<div class="pad"><div class="sk"></div><div class="sk"></div></div>`);
  try {
    hotelsCache = await api("/hotels");
  } catch (e) {
    return fail(e);
  }
  const top = [...hotelsCache].sort((a, b) => b.avg - a.avg)[0];
  view(`<div class="hero">${
    top ? photo(top) : ""
  }<div><h1>Where did you stay?</h1><p>Honest reviews from real guests.</p></div></div>
  <div class="pad"><input id="q" placeholder="Search hotels" value="${esc(
    query
  )}">
  <div class="chips">${[
    ["all", "All"],
    ["top", "4★ and up"],
    ["most", "Most reviewed"],
  ]
    .map(
      ([k, l]) =>
        `<button class="chip ${
          filter === k ? "on" : ""
        }" data-f="${k}">${l}</button>`
    )
    .join("")}</div>
  <div id="list"></div></div>`);
  const draw = () => {
    let l = hotelsCache.filter((h) =>
      (h.name + h.city).toLowerCase().includes(query.toLowerCase())
    );
    if (filter === "top") l = l.filter((h) => h.avg >= 4);
    if (filter === "most") l.sort((a, b) => b.count - a.count);
    document.getElementById("list").innerHTML =
      l
        .map(
          (h) =>
            `<div class="card rv" onclick="location.hash='#/hotel/${
              h.id
            }'"><div class="pic">${photo(h)}<div class="tag">${
              h.count ? h.avg.toFixed(1) : "–"
            }<small>${h.count} review${
              h.count === 1 ? "" : "s"
            }</small></div></div><div class="body"><h3>${esc(
              h.name
            )}</h3><p class="muted">${esc(h.city)} · from $${
              h.price
            } a night</p></div></div>`
        )
        .join("") ||
      '<p class="muted">No hotels match. Try a different name or filter.</p>';
    reveal();
  };
  document.getElementById("q").oninput = (e) => {
    query = e.target.value;
    draw();
  };
  document.querySelectorAll(".chip").forEach(
    (c) =>
      (c.onclick = () => {
        filter = c.dataset.f;
        document
          .querySelectorAll(".chip")
          .forEach((x) => x.classList.toggle("on", x === c));
        draw();
      })
  );
  draw();
}

async function hotelPage(id) {
  let d;
  try {
    d = await api("/hotels/" + id);
  } catch (e) {
    fail(e);
    return home();
  }
  const h = d.hotel,
    rs = d.reviews;
  const bars = [5, 4, 3, 2, 1]
    .map((n) => {
      const c = rs.filter((r) => r.rating === n).length;
      return `<div class="dist"><span>${n}★</span><i><b data-w="${
        rs.length ? (c / rs.length) * 100 : 0
      }"></b></i><span>${c}</span></div>`;
    })
    .join("");
  view(`<div class="hero">${photo(h)}<div><h1>${esc(h.name)}</h1><p>${esc(
    h.city
  )} · from $${h.price} a night</p></div></div>
  <div class="pad"><a class="link" href="#/">← All hotels</a>
  <p style="margin:12px 0 4px">${esc(h.desc)}</p>
  <p><span class="stars">${stars(Math.round(h.avg))}</span> ${
    h.count
      ? h.avg.toFixed(1) +
        " from " +
        h.count +
        " review" +
        (h.count === 1 ? "" : "s")
      : "No reviews yet"
  }</p>
  <div style="margin-top:10px">${bars}</div>
  <button class="gold big" onclick="location.hash='#/write/${
    h.id
  }'">Write a review</button>
  ${
    rs
      .map(
        (r) =>
          `<div class="rev rv"><div class="top"><b>${esc(
            r.user
          )}</b><span class="stars">${stars(r.rating)}</span></div><p>${esc(
            r.text
          )}</p><p class="muted">${esc(r.date)}${
            me && (me.admin || me.id === r.userId)
              ? ` · <button class="link" onclick="removeReview(${r.id},${h.id})">Delete</button>`
              : ""
          }</p></div>`
      )
      .join("") || '<p class="muted">Be the first to review this hotel.</p>'
  }</div>`);
}
async function removeReview(id, hid) {
  try {
    await api("/reviews/" + id, "DELETE");
    toast("Review deleted");
    hotelPage(hid);
  } catch (e) {
    fail(e);
  }
}

function writePage(id) {
  if (!me) {
    toast("Log in to write a review");
    sessionStorage.setItem("st_next", "#/write/" + id);
    location.hash = "#/login";
    return;
  }
  let rating = 0;
  view(`<div class="pad"><a class="link" href="#/hotel/${id}">← Back</a><h2 style="margin:12px 0 6px">Your review</h2>
  <label>Rating</label><div class="picker" id="pk">${[1, 2, 3, 4, 5]
    .map((n) => `<button data-n="${n}" aria-label="${n} stars">★</button>`)
    .join("")}</div>
  <label for="t">What was your stay like?</label><textarea id="t" rows="5" maxlength="400" placeholder="Rooms, service, food, value…"></textarea>
  <button class="gold big" id="go">Post review</button></div>`);
  const btns = [...document.querySelectorAll("#pk button")];
  btns.forEach(
    (b) =>
      (b.onclick = () => {
        rating = +b.dataset.n;
        btns.forEach((x) => x.classList.toggle("on", +x.dataset.n <= rating));
      })
  );
  document.getElementById("go").onclick = async (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    try {
      await api(`/hotels/${id}/reviews`, "POST", {
        rating,
        text: document.getElementById("t").value,
      });
      burst(box.left + box.width / 2, box.top);
      toast("Review posted");
      setTimeout(() => (location.hash = "#/hotel/" + id), 700);
    } catch (err) {
      fail(err);
    }
  };
}

function authPage(mode) {
  const su = mode === "signup";
  view(`<div class="pad"><h2 style="margin-top:8px">${
    su ? "Create your account" : "Welcome back"
  }</h2><p class="muted" style="margin-bottom:14px">${
    su ? "You need an account to post reviews." : "Log in to post a review."
  }</p>
  ${
    su
      ? '<label for="n">Full name</label><input id="n" autocomplete="name">'
      : ""
  }
  <label for="e">Email</label><input id="e" type="email" autocomplete="email"><label for="p">Password</label><input id="p" type="password" autocomplete="${
    su ? "new-password" : "current-password"
  }">
  <button class="gold big" id="go">${su ? "Sign up" : "Log in"}</button>
  <p class="muted" style="text-align:center">${
    su ? "Have an account?" : "New here?"
  } <a class="link" href="#/${su ? "login" : "signup"}">${
    su ? "Log in" : "Sign up"
  }</a></p></div>`);
  document.getElementById("go").onclick = async () => {
    try {
      const d = await api(su ? "/signup" : "/login", "POST", {
        name: su ? document.getElementById("n").value : undefined,
        email: document.getElementById("e").value,
        password: document.getElementById("p").value,
      });
      setSession(d);
      nav();
      toast("Welcome, " + me.name);
      const next = sessionStorage.getItem("st_next");
      sessionStorage.removeItem("st_next");
      location.hash = next || "#/";
    } catch (e) {
      fail(e);
    }
  };
}

async function adminPage() {
  if (!me || !me.admin) {
    location.hash = "#/";
    return;
  }
  let d;
  try {
    d = await api("/admin/overview");
  } catch (e) {
    return fail(e);
  }
  view(`<div class="pad"><a class="link" href="#/">← Back</a><h2 style="margin-top:12px">Admin</h2>
  <div class="stats"><div><b data-count="${
    d.hotels.length
  }">0</b>Hotels</div><div><b data-count="${
    d.reviews.length
  }">0</b>Reviews</div><div><b data-count="${d.users}">0</b>Users</div></div>
  <h3>Add a hotel</h3><input id="hn" placeholder="Hotel name"><input id="hc" placeholder="Area or city"><input id="hp" type="number" placeholder="Price per night"><input id="hd" placeholder="Short description"><label for="hs">Illustration</label><select id="hs"><option value="beach">Beach resort</option><option value="city">City hotel</option><option value="mountain">Mountain lodge</option><option value="harbour">Harbour suites</option></select>
  <button class="gold" id="add" style="width:100%">Add hotel</button>
  <h3 style="margin:22px 0 8px">Hotels</h3>${d.hotels
    .map(
      (h) =>
        `<div class="row"><span>${esc(
          h.name
        )}</span><button class="danger" onclick="delHotel(${
          h.id
        })">Remove</button></div>`
    )
    .join("")}
  <h3 style="margin:22px 0 8px">Reviews</h3>${
    d.reviews
      .map(
        (r) =>
          `<div class="row"><span><b>${esc(
            r.user
          )}</b> <span class="stars">${stars(
            r.rating
          )}</span><br><span class="muted">${esc(
            r.text.slice(0, 50)
          )}…</span></span><button class="danger" onclick="adminDelReview(${
            r.id
          })">Delete</button></div>`
      )
      .join("") || '<p class="muted">No reviews yet.</p>'
  }</div>`);
  document.getElementById("add").onclick = async () => {
    try {
      await api("/hotels", "POST", {
        name: hn.value,
        city: hc.value,
        price: hp.value,
        desc: hd.value,
        scene: hs.value,
      });
      toast("Hotel added");
      adminPage();
    } catch (e) {
      fail(e);
    }
  };
}
async function delHotel(id) {
  if (!confirm("Remove this hotel and its reviews?")) return;
  try {
    await api("/hotels/" + id, "DELETE");
    toast("Hotel removed");
    adminPage();
  } catch (e) {
    fail(e);
  }
}
async function adminDelReview(id) {
  try {
    await api("/reviews/" + id, "DELETE");
    toast("Review deleted");
    adminPage();
  } catch (e) {
    fail(e);
  }
}

function route() {
  const [, p, a] = location.hash.slice(1).split("/");
  nav();
  if (p === "hotel") return hotelPage(+a);
  if (p === "write") return writePage(+a);
  if (p === "login" || p === "signup") return authPage(p);
  if (p === "admin") return adminPage();
  home();
}
window.addEventListener("hashchange", route);
route();
