// ════════════════════════════════════════
// HALEON PARTNERS CLUB — app.js
// Firebase Realtime DB + Google Sheets sync
// ════════════════════════════════════════

const SHEETS_WEBHOOK = "https://script.google.com/macros/s/AKfycbzXv_YPKLL1UUW00yZ07DvlCDgTB_bdf3Cqlb48QPVoG1e4BEeE5mPACs-9tnw7cYkw/exec";

const state = {
  uid: null, user: null, score: 0, quizzesCompleted: 0,
  claimedBadges: [], answeredQuestions: [], gamesCompleted: {}
};

const answeredSet = new Set();
const tabOrder = ["home", "rewards", "scanner", "profile"];
const TOTAL_GAMES = 9; // Updated to 9 games

function makeQRUrl(data, size = 200) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}

// Renamed from 'badges' to 'badgeDefs' and uses 'image' property
const badgeDefs = [
  { id: 0, name: 'Health Advocate', image: 'assets/Health Advocate.png', pts: 200 },
  { id: 1, name: 'Daily Mover', image: 'assets/Daily Mover.png', pts: 400 },
  { id: 2, name: 'Wellness Leader', image: 'assets/Wellness Leader.png', pts: 600 }
];

const rewardsData = [
  { key: "pen", title: "Haleon Branded Pen", pts: 100, icon: "🖊️" },
  { key: "notebook", title: "Haleon Notebook", pts: 200, icon: "📓" },
  { key: "flask", title: "Haleon Flask", pts: 300, icon: "🧪" },
  { key: "mug", title: "Ceramic Mug", pts: 400, icon: "☕" },
];

window.bootApp = function (uid, data, showWelcome) {
  state.uid = uid; state.user = data.profile; state.score = data.score || 0;
  state.quizzesCompleted = data.quizzesCompleted || 0; state.claimedBadges = data.claimedBadges || [];
  state.answeredQuestions = data.answeredQuestions || []; state.gamesCompleted = data.gamesCompleted || {};

  answeredSet.clear();
  state.answeredQuestions.forEach((i) => answeredSet.add(i));

  document.getElementById("nav-username").textContent = state.user.name;
  document.getElementById("bottom-nav").classList.add("visible");
  
  const urlParams = new URLSearchParams(window.location.search);
  const rGame = urlParams.get('rewardGame');
  const rPts = parseInt(urlParams.get('rewardPts'), 10);

  if (rGame && !isNaN(rPts)) {
    window.history.replaceState({}, document.title, window.location.pathname); 
    if (!state.gamesCompleted[rGame]) {
      state.score += rPts;
      state.gamesCompleted[rGame] = true;
      saveToFirebase(); 
      setTimeout(() => showToast(`Success! +${rPts} points added.`), 500);
      setTimeout(() => checkBadgeUnlocks(), 1200);
    } else {
      setTimeout(() => showToast("Points already claimed for this game."), 500);
    }
  }
  
  updateHomeUI(); updateGamesUI(); renderRewardsPage(); updateProfilePage();
  showView("view-home"); currentTab = 0;
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
  document.getElementById("tab-home").classList.add("active");
  startCarousel();

  if (showWelcome === true && state.user) {
    document.getElementById("welcome-name").textContent = "👋 Hi, " + state.user.name + "!";
    document.getElementById("welcome-email").textContent = state.user.email;
    setTimeout(() => { document.getElementById("welcome-dialog").classList.add("open"); launchConfetti(4000); }, 400);
  }
};

window.showView = function showView(id) { document.querySelectorAll(".view").forEach((v) => v.classList.remove("active")); const el = document.getElementById(id); if (el) el.classList.add("active"); };

window.switchTab = function switchTab(tab) {
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  currentTab = tabOrder.indexOf(tab);
  
  if (tab === "home") { showView("view-home"); updateHomeUI(); } 
  else if (tab === "rewards") { showView("view-rewards"); renderRewardsPage(); } 
  else if (tab === "scanner") { showView("view-scanner"); } 
  else if (tab === "profile") { showView("view-profile"); updateProfilePage(); }

  if (tab !== "scanner") stopPointScanner();
};

let swipeX = 0, swipeY = 0;
document.addEventListener("touchstart", (e) => { const a = document.querySelector(".view.active"); if (!a || !["view-home", "view-rewards", "view-scanner", "view-profile"].includes(a.id)) return; swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY; }, { passive: true });
document.addEventListener("touchend", (e) => { const a = document.querySelector(".view.active"); if (!a || !["view-home", "view-rewards", "view-scanner", "view-profile"].includes(a.id)) return; const dx = e.changedTouches[0].clientX - swipeX; const dy = e.changedTouches[0].clientY - swipeY; if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return; if (dx < 0 && currentTab < tabOrder.length - 1) switchTab(tabOrder[currentTab + 1]); else if (dx > 0 && currentTab > 0) switchTab(tabOrder[currentTab - 1]); }, { passive: true });

window.doLogin = async function() {
  const email = document.getElementById("login-email").value.trim(); const pass = document.getElementById("login-pass").value; const errEl = document.getElementById("login-error"); const btn = document.getElementById("btn-login");
  errEl.textContent = ""; if (!email || !pass) { errEl.textContent = "Please fill in all fields."; return; }
  btn.textContent = "Logging in…"; btn.disabled = true;
  try {
    const cred = await window._fb.signInWithEmailAndPassword(window._fb.auth, email, pass);
    const snap = await window._fb.getDoc(window._fb.doc(window._fb.db, "users", cred.user.uid));
    if (snap.exists()) window.bootApp(cred.user.uid, snap.data(), false); else errEl.textContent = "Account data not found.";
  } catch (e) { errEl.textContent = friendlyError(e.code); } finally { btn.textContent = "LOGIN"; btn.disabled = false; }
};

window.doRegister = async function() {
  const name = document.getElementById("reg-name").value.trim(); const email = document.getElementById("reg-email").value.trim(); const phone = document.getElementById("reg-phone").value.trim(); const pharmacy = document.getElementById("reg-pharmacy").value.trim(); const pass = document.getElementById("reg-pass").value; const errEl = document.getElementById("reg-error"); const btn = document.getElementById("btn-register");
  errEl.textContent = ""; if (!name || !email || !phone || !pharmacy || !pass) { errEl.textContent = "Please fill in all fields."; return; }
  if (pass.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }
  btn.textContent = "Creating account…"; btn.disabled = true;
  try {
    const cred = await window._fb.createUserWithEmailAndPassword(window._fb.auth, email, pass);
    const uid = cred.user.uid; const memberId = uid.slice(0, 8).toUpperCase();
    const profile = { name, email, phone, pharmacy, memberId };
    const userData = { profile, score: 0, quizzesCompleted: 0, claimedBadges: [], answeredQuestions: [], gamesCompleted: {}, tier: "Student", createdAt: new Date().toISOString() };
    await window._fb.setDoc(window._fb.doc(window._fb.db, "users", uid), userData);
    syncToSheets(uid, userData); window.bootApp(uid, userData, true);
  } catch (e) { errEl.textContent = friendlyError(e.code); } finally { btn.textContent = "CREATE ACCOUNT"; btn.disabled = false; }
};

window.doResetPassword = async function() {
  const email = document.getElementById("forgot-email").value.trim(); const errEl = document.getElementById("forgot-error"); const btn = document.getElementById("btn-forgot");
  errEl.textContent = ""; if (!email) { errEl.textContent = "Please enter your email address."; return; }
  btn.textContent = "Sending link..."; btn.disabled = true;
  try { await window._fb.sendPasswordResetEmail(window._fb.auth, email); showToast("Password reset email sent! Please check your inbox."); showView("view-login"); } catch (e) { errEl.textContent = friendlyError(e.code); } finally { btn.textContent = "RESET PASSWORD"; btn.disabled = false; }
};

window.doLogout = async function() {
  await window._fb.signOut(window._fb.auth); state.uid = null; state.user = null; state.score = 0; state.quizzesCompleted = 0; state.claimedBadges = []; state.answeredQuestions = []; state.gamesCompleted = {};
  answeredSet.clear(); document.getElementById("bottom-nav").classList.remove("visible"); showView("view-login");
};

function friendlyError(code) { const map = { "auth/user-not-found": "No account found.", "auth/wrong-password": "Incorrect password.", "auth/email-already-in-use": "Email already exists.", "auth/invalid-email": "Invalid email.", "auth/weak-password": "Min 6 characters.", "auth/invalid-credential": "Incorrect email or password." }; return map[code] || "Something went wrong. Please try again."; }

async function saveToFirebase() {
  if (!state.uid) return;
  const tier = getTier().name;
  const data = { score: state.score, quizzesCompleted: state.quizzesCompleted, claimedBadges: state.claimedBadges, answeredQuestions: [...answeredSet], gamesCompleted: state.gamesCompleted, tier, lastUpdated: window._fb.serverTimestamp() };
  try {
    await window._fb.updateDoc(window._fb.doc(window._fb.db, "users", state.uid), data);
    syncToSheets(state.uid, { profile: state.user, ...data, lastUpdated: new Date().toISOString() });
    showSyncStatus("✓ Synced");
  } catch (e) { showSyncStatus("⚠ Sync failed"); }
}

function showSyncStatus(msg) { const el = document.getElementById("sync-status"); if (!el) return; el.textContent = msg; el.style.opacity = "1"; setTimeout(() => { el.style.opacity = "0"; }, 2500); }

function syncToSheets(uid, data) {
  if (!SHEETS_WEBHOOK || SHEETS_WEBHOOK === "YOUR_APPS_SCRIPT_WEB_APP_URL") return;
  const badgeNames = (data.claimedBadges || []).map((id) => { const def = badgeDefs.find((b) => b.id === id); return def ? def.name : id; }).join(", ");
  const payload = { uid, name: data.profile?.name || "", email: data.profile?.email || "", phone: data.profile?.phone || "", pharmacy: data.profile?.pharmacy || "", memberId: data.profile?.memberId || "", score: data.score || 0, quizzesCompleted: data.quizzesCompleted || 0, tier: data.tier || "Student", badges: badgeNames, badgesCount: (data.claimedBadges || []).length, lastUpdated: data.lastUpdated || new Date().toISOString() };
  fetch(SHEETS_WEBHOOK, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
}

function getTier() { const points = state.score || 0; if (points >= 400) return { name: "Pharmacy Owner", cls: "card-owner", front: "assets/card3_front.png", back: "assets/card3_back.png" }; if (points >= 200) return { name: "Community Pharmacists", cls: "card-community", front: "assets/card2_front.png", back: "assets/card2_back.png" }; return { name: "Student", cls: "card-student", front: "assets/card1_front.png", back: "assets/card1_back.png" }; }

function updateHomeUI() {
  const tier = getTier();
  const completedCount = Object.keys(state.gamesCompleted || {}).length;
  const pct = Math.round((completedCount / TOTAL_GAMES) * 100);
  const circumference = 2 * Math.PI * 60;
  document.getElementById("progress-ring").style.strokeDashoffset = circumference - (pct / 100) * circumference;
  document.getElementById("progress-pct").textContent = pct + "%";
  document.getElementById("pts-display").textContent = state.score.toLocaleString() + " Points";
  document.getElementById("tier-badge-home").textContent = tier.name;
  if (state.user) document.getElementById("nav-username").textContent = state.user.name;
  updateBadgeStates(); updateHomeRedeemBtns();
}

function updateHomeRedeemBtns() { const flask = document.getElementById("home-redeem-flask"); const pen = document.getElementById("home-redeem-pen"); if (flask) flask.disabled = state.score < 300; if (pen) pen.disabled = state.score < 100; }

function updateGamesUI() {
  const games = ['basket', 'myth', 'buzzer', 'memory', 'catch', 'prescription', 'placement', 'mitohype', 'spin'];
  games.forEach(g => { 
    const statusEl = document.getElementById('gstatus-' + g); 
    if (statusEl) { 
      if (state.gamesCompleted[g]) { 
        statusEl.textContent = "✓ Completed"; 
        statusEl.style.color = "var(--green)"; 
      } else { 
        statusEl.textContent = "Play"; 
        statusEl.style.color = "var(--muted)"; 
      } 
    } 
  });
}

window.openGame = function(url, gameId) { if (state.gamesCompleted[gameId]) { showToast("You've already collected points for this game!"); window.location.href = url + `?uid=${state.uid}&exhausted=true`; } else { window.location.href = url + `?uid=${state.uid}`; } };

let scanStream = null; let scanTicker = null;
window.startPointScanner = async function() { document.getElementById("scan-status-text").textContent = "Scanning..."; document.getElementById("scan-video-wrap").style.display = "block"; document.getElementById("btn-start-scan").style.display = "none"; document.getElementById("btn-stop-scan").style.display = "block"; try { scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const vid = document.getElementById("scan-video"); vid.srcObject = scanStream; await vid.play(); scanTicker = setInterval(tickScan, 200); } catch (e) { stopPointScanner(); showToast("Camera access denied."); } };
window.stopPointScanner = function() { if (scanTicker) clearInterval(scanTicker); if (scanStream) scanStream.getTracks().forEach(t => t.stop()); document.getElementById("scan-video-wrap").style.display = "none"; document.getElementById("btn-start-scan").style.display = "block"; document.getElementById("btn-stop-scan").style.display = "none"; document.getElementById("scan-status-text").textContent = "Camera stopped"; };

function tickScan() { const vid = document.getElementById("scan-video"); if (!vid || vid.readyState < 2) return; const cvs = document.createElement("canvas"); cvs.width = vid.videoWidth; cvs.height = vid.videoHeight; const ctx = cvs.getContext("2d"); ctx.drawImage(vid, 0, 0); const px = ctx.getImageData(0, 0, cvs.width, cvs.height); const result = jsQR(px.data, px.width, px.height, { inversionAttempts: "dontInvert" }); if (result && result.data) { stopPointScanner(); processGameQR(result.data); } }

async function processGameQR(raw) {
  try { const data = JSON.parse(raw); if (data.type !== "game_reward" || !data.gameId || !data.points) throw new Error(); if (state.gamesCompleted[data.gameId]) { showToast("You've already claimed points for this game."); return; } state.score += data.points; state.gamesCompleted[data.gameId] = true; await saveToFirebase(); showToast(`Success! +${data.points} points added.`); updateHomeUI(); updateGamesUI(); updateProfilePage(); switchTab("home"); } catch (e) { showToast("Invalid QR code."); }
}

function updateBadgeStates() { badgeDefs.forEach((b) => { const chip = document.getElementById("badge-" + b.id); if (!chip) return; if (state.claimedBadges.includes(b.id)) chip.className = "badge-chip claimed"; else if (state.score >= b.pts) chip.className = "badge-chip claimable"; else chip.className = "badge-chip locked"; }); }

function checkBadgeUnlocks() { 
  const newlyUnlocked = badgeDefs.filter((b) => !state.claimedBadges.includes(b.id) && state.score >= b.pts); 
  if (newlyUnlocked.length === 0) return; 
  newlyUnlocked.forEach((b) => state.claimedBadges.push(b.id)); 
  updateBadgeStates(); 
  const b = newlyUnlocked[0]; 
  setTimeout(() => { 
    document.getElementById("badge-dialog-icon").innerHTML = `<img src="${b.image}" alt="Badge" style="width: 60px; height: 60px; object-fit: contain;">`;
    document.getElementById("badge-dialog-name").textContent = b.name; 
    document.getElementById("badge-dialog").classList.add("open"); 
    launchConfetti(4000); 
  }, 2200); 
  saveToFirebase(); 
}

window.tryClaimBadge = async function(id) { 
  const b = badgeDefs[id]; 
  if (state.claimedBadges.includes(id) || state.score < b.pts) return; 
  state.claimedBadges.push(id); 
  updateBadgeStates(); 
  document.getElementById("badge-dialog-icon").innerHTML = `<img src="${b.image}" alt="Badge" style="width: 60px; height: 60px; object-fit: contain;">`;
  document.getElementById("badge-dialog-name").textContent = b.name; 
  document.getElementById("badge-dialog").classList.add("open"); 
  launchConfetti(3000); 
  await saveToFirebase(); 
};

window.closeWelcomeDialog = function() { document.getElementById("welcome-dialog").classList.remove("open"); };
window.closeBadgeDialog = function() { document.getElementById("badge-dialog").classList.remove("open"); updateHomeUI(); if (document.getElementById("view-profile").classList.contains("active")) updateProfilePage(); };

let carouselIdx = 0; let carouselTimer = null;
window.goToSlide = function(idx) { carouselIdx = idx; const track = document.getElementById("carousel-track"); if (!track) return; track.style.transform = `translateX(-${idx * 100}%)`; document.querySelectorAll(".dot").forEach((d, i) => d.classList.toggle("active", i === idx)); };
function startCarousel() { if (carouselTimer) clearInterval(carouselTimer); carouselTimer = setInterval(() => { const total = document.querySelectorAll(".carousel-slide").length; goToSlide((carouselIdx + 1) % total); }, 3500); }

function renderRewardsPage() { const grid = document.getElementById("rewards-full-grid"); const ptsEl = document.getElementById("rewards-pts-display"); if (!grid) return; if (ptsEl) ptsEl.textContent = state.score.toLocaleString() + " pts"; grid.innerHTML = ""; rewardsData.forEach((r) => { const canRedeem = state.score >= r.pts; grid.innerHTML += `<div class="reward-card"><div class="reward-img">${r.icon}</div><div class="reward-info"><div class="reward-title">${r.title}</div><button class="redeem-btn" ${canRedeem ? "" : "disabled"} onclick="openRedeemQR('${r.key}','${r.title}',${r.pts})">${r.pts} Pts — Redeem</button></div></div>`; }); }

let qrTimerInterval = null; let redeemUnsubscribe = null; let redeemOpenedAt = 0;
window.openRedeemQR = function(key, title, pts) { redeemOpenedAt = Date.now(); document.getElementById('qr-dialog-title').textContent = 'Redeem: ' + title; const payload = JSON.stringify({ uid: state.uid, memberId: state.user?.memberId || '', name: state.user?.name || '', email: state.user?.email || '', phone: state.user?.phone || '', pharmacy: state.user?.pharmacy || '', reward: title, pts, key, ts: Date.now() }); const imgEl = document.getElementById('qr-dialog-img'); imgEl.style.opacity = '0.2'; imgEl.src = ''; setTimeout(() => { imgEl.onload = () => { imgEl.style.opacity = '1'; }; imgEl.onerror = () => { imgEl.style.opacity = '1'; }; imgEl.src = makeQRUrl(payload, 200) + '&t=' + Date.now(); }, 80); let secs = 60; document.getElementById('qr-timer').textContent = secs; if (qrTimerInterval) clearInterval(qrTimerInterval); qrTimerInterval = setInterval(() => { secs--; const el = document.getElementById('qr-timer'); if (el) el.textContent = secs; if (secs <= 0) { clearInterval(qrTimerInterval); closeQRDialog(); } }, 1000); document.getElementById('qr-dialog').classList.add('open'); stopRedeemListener(); if (window._fb?.onSnapshot && state.uid) { redeemUnsubscribe = window._fb.onSnapshot(window._fb.doc(window._fb.db, 'users', state.uid), snap => { if (!snap.exists()) return; const d = snap.data(); if (d.lastRedemptionAt && d.lastRedemptionAt > redeemOpenedAt) { stopRedeemListener(); showRedeemSuccess(d.lastRedemptionReward || title, d.lastRedemptionPts || pts, d.score ?? state.score); } }); } };
function stopRedeemListener() { if (redeemUnsubscribe) { redeemUnsubscribe(); redeemUnsubscribe = null; } }
window.closeQRDialog = function() { stopRedeemListener(); if (qrTimerInterval) clearInterval(qrTimerInterval); document.getElementById('qr-dialog').classList.remove('open'); };
function showRedeemSuccess(reward, pts, newScore) { closeQRDialog(); state.score = newScore; updateHomeUI(); renderRewardsPage(); if (document.getElementById('view-profile')?.classList.contains('active')) updateProfilePage(); document.getElementById('redeem-success-reward').textContent = reward; document.getElementById('redeem-success-pts').textContent = '−' + pts + ' pts deducted · New balance: ' + newScore.toLocaleString() + ' pts'; document.getElementById('redeem-success-dialog').classList.add('open'); launchConfetti(3000); }
window.closeRedeemSuccessDialog = function() { document.getElementById('redeem-success-dialog').classList.remove('open'); };

function updateProfilePage() { 
  if (!state.user) return; 
  const tier = getTier(); 
  const frontBg = document.getElementById('card-front-bg'); if (frontBg) frontBg.src = tier.front; 
  const backBg = document.getElementById('card-back-bg'); if (backBg) backBg.src = tier.back; 
  document.getElementById('card-name-back').textContent = state.user.name; 
  document.getElementById('card-num-back').textContent = state.user.memberId || '——'; 
  const memberPayload = JSON.stringify({ uid: state.uid, memberId: state.user.memberId, name: state.user.name, email: state.user.email, phone: state.user.phone, pharmacy: state.user.pharmacy }); 
  const cardImg = document.getElementById('card-qr-img'); if (cardImg) cardImg.src = makeQRUrl(memberPayload, 160) + '&t=' + Date.now(); 
  document.getElementById('stat-pts').textContent = state.score.toLocaleString(); 
  document.getElementById('stat-quizzes').textContent = Object.keys(state.gamesCompleted || {}).length; 
  document.getElementById('stat-tier').textContent = tier.name; 
  document.getElementById('info-name').textContent = state.user.name; 
  document.getElementById('info-email').textContent = state.user.email; 
  document.getElementById('info-phone').textContent = state.user.phone || '—'; 
  document.getElementById('info-pharmacy').textContent = state.user.pharmacy || '—'; 
  
  const badgesEl = document.getElementById('profile-badges'); 
  if (state.claimedBadges.length === 0) {
    badgesEl.innerHTML = '<div class="profile-badge-empty">No badges claimed yet. Earn points to unlock!</div>'; 
  } else {
    badgesEl.innerHTML = state.claimedBadges.map(id => { 
      const b = badgeDefs.find(d => d.id === id); 
      return b ? `<div class="profile-badge-item" style="display: flex; align-items: center; gap: 8px;"><img src="${b.image}" alt="${b.name}" style="width: 20px; height: 20px; object-fit: contain;"> ${b.name}</div>` : ''; 
    }).join(''); 
  }
}

window.flipCard = function() { document.getElementById("card-inner").classList.toggle("flipped"); };

function launchConfetti(duration) {
  const canvas = document.getElementById("confetti-canvas");
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.style.display = "block";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const pieces = [];
  const colors = ["#4ade80", "#22c55e", "#f0f4f8", "#facc15", "#60a5fa", "#f472b6"];
  for (let i = 0; i < 100; i++) pieces.push({ x: Math.random() * canvas.width, y: -10 - Math.random() * 200, r: 4 + Math.random() * 6, color: colors[Math.floor(Math.random() * colors.length)], vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, rot: Math.random() * 360, rs: (Math.random() - 0.5) * 6 });
  const end = Date.now() + duration;
  (function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((p) => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((p.rot * Math.PI) / 180); ctx.fillStyle = p.color;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); ctx.restore();
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.rs;
    });
    if (Date.now() < end) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.style.display = "none"; }
  })();
}
window.showToast = function(msg) { const toast = document.getElementById("toast"); toast.textContent = msg; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2400); };
window.addEventListener("DOMContentLoaded", () => { startCarousel(); const lbl = document.querySelector('.progress-label'); if(lbl) lbl.textContent = "Games Completed"; });