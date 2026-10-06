// Utangulizi wa NAYA (mara ya kwanza tu): slaidi 3 za kuteleza kwa kidole (scroll-snap ya browser — laini kwenye simu zote).
const $ = (id) => document.getElementById(id);
const KEY = 'naya_intro_done';

export function introSeen() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // storage imezuiwa → usimwonyeshe kila mara
  }
}

export function setupIntro(onDone) {
  const track = $('intro-track');
  const slides = [...track.children];
  const dots = [...$('intro-dots').children];
  let index = 0;

  const finish = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // storage imezuiwa
    }
    onDone();
  };

  const setIndex = (i) => {
    index = i;
    dots.forEach((d, n) => d.classList.toggle('on', n === i));
    slides.forEach((s, n) => s.classList.toggle('is-active', n === i));
    $('view-intro').classList.toggle('is-last', i === slides.length - 1);
    $('intro-next').setAttribute('aria-label', i === slides.length - 1 ? 'Anza sasa' : 'Endelea');
  };

  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if (i !== index) setIndex(Math.max(0, Math.min(slides.length - 1, i)));
    });
  });
  $('intro-next').addEventListener('click', () => {
    if (index >= slides.length - 1) return finish();
    track.scrollTo({ left: (index + 1) * track.clientWidth, behavior: 'smooth' });
  });
  $('intro-skip').addEventListener('click', finish);
  setIndex(0);
}
