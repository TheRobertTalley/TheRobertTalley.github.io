(function () {
  const canvas = document.getElementById("ops-map");
  const feed = document.getElementById("event-feed");
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const state = {
    pan: { x: 0, y: 0 },
    events: [
      { type: "headset", label: "ALPHA", x: 0.50, y: 0.54, color: "#41f19b" },
      { type: "headset", label: "BRAVO", x: 0.36, y: 0.45, color: "#4ddfea" },
      { type: "headset", label: "CHARLIE", x: 0.63, y: 0.42, color: "#4ddfea" },
      { type: "target", label: "RIDGE", x: 0.73, y: 0.29, color: "#ff4c4c" },
      { type: "marker", label: "LZ", x: 0.23, y: 0.72, color: "#ffd447" }
    ],
    trail: [
      [0.30, 0.68],
      [0.34, 0.64],
      [0.39, 0.60],
      [0.45, 0.57],
      [0.50, 0.54]
    ]
  };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(640, Math.floor(rect.width * scale));
    canvas.height = Math.max(390, Math.floor(rect.height * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw();
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    drawTerrain(width, height);
    drawTrail(width, height);
    state.events.forEach((event) => drawEvent(event, width, height));
    drawCompass(width, height);
  }

  function drawTerrain(width, height) {
    ctx.save();
    ctx.strokeStyle = "rgba(65, 241, 155, 0.16)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 9; index += 1) {
      ctx.beginPath();
      const y = height * (0.18 + index * 0.075);
      for (let x = 0; x <= width; x += 18) {
        const wave = Math.sin(x * 0.015 + index) * 18;
        ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(77, 223, 234, 0.14)";
    for (let index = 0; index < 6; index += 1) {
      ctx.beginPath();
      const x = width * (0.12 + index * 0.14);
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 40, height * 0.3, x - 30, height * 0.7, x + 25, height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTrail(width, height) {
    ctx.save();
    ctx.strokeStyle = "#4ddfea";
    ctx.lineWidth = 2;
    ctx.beginPath();
    state.trail.forEach((point, index) => {
      const x = point[0] * width;
      const y = point[1] * height;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    state.trail.forEach((point) => {
      ctx.fillStyle = "#4ddfea";
      ctx.beginPath();
      ctx.arc(point[0] * width, point[1] * height, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawEvent(event, width, height) {
    const x = event.x * width;
    const y = event.y * height;
    ctx.save();
    ctx.strokeStyle = event.color;
    ctx.fillStyle = event.color;
    ctx.lineWidth = 2;
    if (event.type === "target") {
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.moveTo(x - 22, y);
      ctx.lineTo(x + 22, y);
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x, y + 22);
      ctx.stroke();
    } else if (event.type === "marker") {
      ctx.beginPath();
      ctx.moveTo(x, y - 16);
      ctx.lineTo(x + 16, y + 14);
      ctx.lineTo(x - 16, y + 14);
      ctx.closePath();
      ctx.stroke();
    } else if (event.type === "route") {
      ctx.strokeRect(x - 10, y - 10, 20, 20);
    } else if (event.type === "medical") {
      ctx.fillRect(x - 3, y - 14, 6, 28);
      ctx.fillRect(x - 14, y - 3, 28, 6);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(228, 255, 243, 0.55)";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 34, y - 26);
      ctx.stroke();
    }
    ctx.font = "12px Cascadia Mono, Consolas, monospace";
    ctx.fillStyle = "#e4fff3";
    ctx.fillText(event.label, x + 18, y - 12);
    ctx.restore();
  }

  function drawCompass(width) {
    ctx.save();
    ctx.strokeStyle = "rgba(228, 255, 243, 0.42)";
    ctx.fillStyle = "rgba(228, 255, 243, 0.82)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(width - 74, 74, 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "12px Cascadia Mono, Consolas, monospace";
    ctx.fillText("042", width - 85, 80);
    ctx.restore();
  }

  function addFeed(kind, message) {
    if (!feed) {
      return;
    }
    const item = document.createElement("li");
    const title = document.createElement("b");
    const detail = document.createElement("span");
    title.textContent = kind;
    detail.textContent = message;
    item.append(title, detail);
    feed.prepend(item);
    while (feed.children.length > 6) {
      feed.lastElementChild.remove();
    }
  }

  function addMapEvent(kind) {
    const type =
      kind === "target" ? "target" :
      kind === "route" ? "route" :
      kind === "medical" ? "medical" :
      "marker";
    const color =
      kind === "target" ? "#ff4c4c" :
      kind === "threat" || kind === "lz" ? "#ffd447" :
      kind === "hold" ? "#ff4c4c" :
      kind === "medical" ? "#e4fff3" :
      "#4ddfea";
    state.events.push({
      type,
      label: kind.toUpperCase(),
      x: 0.25 + Math.random() * 0.55,
      y: 0.22 + Math.random() * 0.5,
      color
    });
    if (kind === "route") {
      state.trail.push([0.42 + Math.random() * 0.22, 0.43 + Math.random() * 0.18]);
    }
    draw();
    addFeed(kind.toUpperCase(), "Test event added to the local operations map");
  }

  document.querySelectorAll("[data-map-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-map-action");
      if (action === "center") {
        addFeed("CENTER", "Map centered on ALPHA headset");
        draw();
      } else {
        addMapEvent(action);
      }
    });
  });

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
})();

