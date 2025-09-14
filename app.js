// Préchargeur
window.addEventListener('load', () => {
  setTimeout(() => {
    const p = document.getElementById('preloader');
    p.style.opacity = '0';
    setTimeout(() => p.style.display = 'none', 420);
  }, 600);
});

// Fond cosmique — particules néon (identique à la version précédente)
(() => {
  const canvas = document.getElementById('cosmic-canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let w, h, particles;

  const resize = () => {
    w = canvas.width = Math.floor(innerWidth * DPR);
    h = canvas.height = Math.floor(innerHeight * DPR);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    spawn();
  };

  const rand = (a,b) => a + Math.random()*(b-a);

  function spawn(){
    const count = Math.floor((innerWidth * innerHeight) / 18000);
    particles = Array.from({length: count}, () => ({
      x: rand(0, w),
      y: rand(0, h),
      r: rand(0.6, 2.2) * DPR,
      vx: rand(-0.15, 0.15) * DPR,
      vy: rand(-0.15, 0.15) * DPR,
      hue: rand(185, 285)
    }));
  }

  function step(){
    ctx.clearRect(0,0,w,h);
    for(const p of particles){
      p.x += p.vx; p.y += p.vy;
      if(p.x < 0 || p.x > w) p.vx *= -1;
      if(p.y < 0 || p.y > h) p.vy *= -1;

      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r*6);
      grad.addColorStop(0, `hsla(${p.hue}, 95%, 70%, 0.9)`);
      grad.addColorStop(1, `hsla(${p.hue}, 95%, 50%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r*3, 0, Math.PI*2);
      ctx.fill();
    }
    requestAnimationFrame(step);
  }

  window.addEventListener('resize', resize);
  resize(); step();
})();

// Terminal démo (identique, sans uptime)
(() => {
  const out = document.getElementById('term-output');
  const input = document.getElementById('term-input');
  const print = (txt, cls='') => {
    const line = document.createElement('div');
    line.textContent = txt;
    if(cls) line.className = cls;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  };

  const help = [
    "Commandes disponibles:",
    "  help      — affiche l'aide",
    "  build     — étapes de compilation",
    "  sysinfo   — infos système",
    "  neon      — pulse néon",
    "  clear     — efface l'écran"
  ];

  const sysinfo = () => ([
    "Atherion OS — Diagnostic",
    "Kernel: ATHERION-CORE v0.1",
    "Graphics: NeonCanvas Engine",
    "Status: Prototype OK"
  ]);

  const buildSteps = [
    "[1/4] Vérification toolchain (x86_64-elf-gcc, nasm, qemu)... OK",
    "[2/4] Compilation du kernel C/ASM... OK",
    "[3/4] Assemblage bootloader... OK",
    "[4/4] Lien & ISO... OK -> build/atherion-os.iso"
  ];

  const neon = () => {
    document.body.animate([
      { filter: 'saturate(100%) brightness(100%)' },
      { filter: 'saturate(160%) brightness(110%)' },
      { filter: 'saturate(100%) brightness(100%)' }
    ], { duration: 900, easing: 'ease-in-out' });
    return ["Mode néon impulsé ⚡"];
  };

  const run = (cmd) => {
    const c = cmd.trim().toLowerCase();
    if(!c) return;
    print(`λ ${c}`, 'cmd');
    switch(c){
      case 'help': help.forEach(print); break;
      case 'build': buildSteps.forEach(print); break;
      case 'sysinfo': sysinfo().forEach(print); break;
      case 'neon': neon().forEach(print); break;
      case 'clear': out.innerHTML=''; break;
      default: print(`Commande inconnue: ${c}`);
    }
  };

  ["Boot sequence… OK","Chargement modules… OK","Réseau… OK","Bienvenue sur Atherion OS"].forEach(print);

  input.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ run(input.value); input.value=''; }
  });
})();

// Vrai nombre de téléchargements (GitHub API)
(async () => {
  const el = document.getElementById('dl-count');
  if(!el) return;
  try {
    const res = await fetch('https://api.github.com/repos/yasscode1234/AETHERION_OS/releases');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const releases = await res.json();
    const total = releases.reduce((sum, r) => {
      const assets = Array.isArray(r.assets) ? r.assets : [];
      return sum + assets.reduce((s, a) => s + (a.download_count || 0), 0);
    }, 0);
    el.textContent = total.toLocaleString('fr-FR');
  } catch (e) {
    el.textContent = 'Indisp.';
  }
})();

// Utilitaires
(() => {
  const year = document.getElementById('year');
  if(year) year.textContent = new Date().getFullYear();
})();
