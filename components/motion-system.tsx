"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Site-wide animation direction: soft lifts, short staggered reveals, subtle
 * parallax and tactile feedback. Animations only change presentation; content
 * remains visible without JavaScript and reduced-motion is always respected.
 */
export function MotionSystem() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.body.classList.add("motion-ready");
    const animated = new WeakSet<Element>();
    const contexts: gsap.Context[] = [];
    let frame = 0;

    function reveal() {
      const context = gsap.context(() => {
        const hero = document.querySelectorAll<HTMLElement>("[data-motion-hero]");
        const headings = document.querySelectorAll<HTMLElement>("main h1, [data-motion-title]");
        const groups = document.querySelectorAll<HTMLElement>("[data-motion-stagger]");
        const surfaces = document.querySelectorAll<HTMLElement>("[data-motion-card], .ord-rise, [role='dialog']");
        const eligible = [...hero, ...headings, ...groups, ...surfaces].filter((node) => {
          if (animated.has(node)) return false;
          animated.add(node);
          return true;
        });
        if (!eligible.length) return;
        gsap.fromTo(eligible, { autoAlpha: 0, y: 18, filter: "blur(5px)" }, {
          autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.65,
          ease: "power3.out", stagger: 0.055, clearProps: "opacity,visibility,transform,filter",
          scrollTrigger: eligible.length > 2 ? undefined : undefined,
        });
        // Secondary content enters naturally as it scrolls into view.
        document.querySelectorAll<HTMLElement>("[data-motion-reveal]").forEach((node) => {
          if (animated.has(node)) return;
          animated.add(node);
          gsap.fromTo(node, { autoAlpha: 0, y: 24 }, {
            autoAlpha: 1, y: 0, duration: 0.78, ease: "power3.out",
            clearProps: "opacity,visibility,transform",
            scrollTrigger: { trigger: node, start: "top 94%", once: true },
          });
        });
      });
      contexts.push(context);
      ScrollTrigger.refresh();
    }

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };
    schedule();

    // The POS is one long-lived React page. Animate newly mounted views, sheets,
    // dropdowns and dialogs even when the URL itself does not change.
    const observer = new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes].some((node) =>
        node.nodeType === Node.ELEMENT_NODE && (
          (node as Element).matches?.("[data-motion-hero], [data-motion-reveal], [data-motion-card], .ord-rise, [role='dialog']") ||
          (node as Element).querySelector?.("[data-motion-hero], [data-motion-reveal], [data-motion-card], .ord-rise, [role='dialog']")
        )))) schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true });

    const down = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest?.("button:not(:disabled), a[href]");
      if (!element) return;
      gsap.to(element, { scale: 0.978, duration: 0.13, ease: "power2.out", overwrite: true });
    };
    const up = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest?.("button, a[href]");
      if (!element) return;
      gsap.to(element, { scale: 1, duration: 0.34, ease: "back.out(2.1)", overwrite: true, clearProps: "transform" });
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      contexts.forEach((context) => context.revert());
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.body.classList.remove("motion-ready");
    };
  }, [pathname]);

  return null;
}
