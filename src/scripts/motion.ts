import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);
const media = gsap.matchMedia();
media.add('(prefers-reduced-motion: no-preference)', () => {
  gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((element) => {
    gsap.from(element, {
      y: 24,
      autoAlpha: 0,
      duration: 0.75,
      ease: 'power2.out',
      scrollTrigger: { trigger: element, start: 'top 94%', once: true },
      clearProps: 'all',
    });
  });
  gsap.to('[data-parallax]', {
    y: 35,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 1 },
  });
});
window.addEventListener('pagehide', () => media.revert(), { once: true });
