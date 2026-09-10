"use strict";

(() => {
  const viewer = document.getElementById("capture-viewer");
  if (!viewer || typeof viewer.showModal !== "function") return;

  const image = document.getElementById("viewer-image");
  const frame = document.getElementById("viewer-frame");
  const caption = document.getElementById("viewer-caption");
  const original = document.getElementById("viewer-original");
  const close = document.getElementById("viewer-close");
  let trigger;
  image.addEventListener("load", () => frame.classList.remove("is-loading"));
  image.addEventListener("error", () => {
    frame.classList.remove("is-loading");
    caption.textContent = "The capture could not load. Open the image to try again.";
  });

  document.querySelectorAll("a[data-viewer]").forEach(link => {
    link.addEventListener("click", event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      trigger = link;
      frame.className = "viewer-image " + link.dataset.frame + " is-loading";
      image.src = link.dataset.image;
      image.alt = link.querySelector("img").alt;
      caption.textContent = link.dataset.caption;
      original.href = link.href;
      viewer.showModal();
      document.body.classList.add("viewer-open");
      close.focus();
    });
  });

  close.addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", event => {
    if (event.target !== viewer) return;
    const bounds = viewer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) viewer.close();
  });
  viewer.addEventListener("close", () => {
    document.body.classList.remove("viewer-open");
    image.removeAttribute("src");
    if (trigger) trigger.focus({ preventScroll: true });
  });
})();
