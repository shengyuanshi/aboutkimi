const nav = document.querySelector(".site-nav");
const canvas = document.getElementById("hero-canvas");
const gl = canvas.getContext("webgl", {
  antialias: true,
  alpha: true,
  premultipliedAlpha: false,
});
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let width = 0;
let height = 0;
let ratio = 1;
const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const smoothMouse = { x: 0.5, y: 0.5 };
let shaderProgram = null;
let lineBuffer = null;
let baseLineBuffer = null;
let vertexCount = 0;
let uniformLocations = {};
let attributeLocations = {};
let startTime = performance.now();

const vertexShaderSource = `
  precision mediump float;

  uniform float time;
  uniform vec2 mouse;
  uniform mat4 projectionMatrix;
  uniform mat4 modelViewMatrix;

  attribute vec3 position;
  attribute vec3 basePosition;

  varying float vDist;

  void main() {
    vec3 pos = basePosition;
    float dist = distance(basePosition.xy, (mouse - 0.5) * 40.0);
    float wave = sin(basePosition.x * 0.1 + time) * cos(basePosition.y * 0.1 + time);
    pos.z += wave * 2.0;
    float influence = smoothstep(15.0, 0.0, dist);
    pos.z += influence * 4.0;
    vDist = dist;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  uniform vec3 color;
  uniform float time;

  varying float vDist;

  void main() {
    float alpha = smoothstep(20.0, 0.0, vDist) * 0.8;
    float glow = sin(gl_FragCoord.x * 0.05 + time) * 0.5 + 0.5;
    vec3 finalColor = mix(color, vec3(0.0, 0.8, 1.0), glow * 0.3);
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

function resizeCanvas() {
  ratio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (gl) {
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Unable to compile hero shader.");
  }
  return shader;
}

function createProgram() {
  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Unable to link hero shader.");
  }

  return program;
}

function createGridVertices() {
  const gridSize = 60;
  const divisions = 30;
  const spacing = gridSize / divisions;
  const step = 0.1;
  const vertices = [];

  function pushLine(startX, startY, endX, endY) {
    const distance = Math.hypot(endX - startX, endY - startY);
    const points = Math.ceil(distance / step) + 1;
    let previous = null;

    for (let index = 0; index < points; index += 1) {
      const t = index / (points - 1);
      const point = [
        startX + (endX - startX) * t,
        startY + (endY - startY) * t,
        0,
      ];

      if (previous) {
        vertices.push(...previous, ...point);
      }

      previous = point;
    }
  }

  for (let index = 0; index <= divisions; index += 1) {
    const offset = -gridSize / 2 + index * spacing;
    pushLine(offset, -gridSize / 2, offset, gridSize / 2);
    pushLine(-gridSize / 2, offset, gridSize / 2, offset);
  }

  return new Float32Array(vertices);
}

function perspectiveMatrix(fovDegrees, aspect, near, far) {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const rangeInverse = 1 / (near - far);

  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * rangeInverse, -1,
    0, 0, near * far * rangeInverse * 2, 0,
  ]);
}

function modelViewMatrix() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, -30, 1,
  ]);
}

function initHeroShader() {
  if (!gl) {
    canvas.classList.add("shader-unavailable");
    return;
  }

  shaderProgram = createProgram();
  const vertices = createGridVertices();
  vertexCount = vertices.length / 3;

  lineBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  baseLineBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, baseLineBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  attributeLocations = {
    position: gl.getAttribLocation(shaderProgram, "position"),
    basePosition: gl.getAttribLocation(shaderProgram, "basePosition"),
  };

  uniformLocations = {
    time: gl.getUniformLocation(shaderProgram, "time"),
    color: gl.getUniformLocation(shaderProgram, "color"),
    mouse: gl.getUniformLocation(shaderProgram, "mouse"),
    projectionMatrix: gl.getUniformLocation(shaderProgram, "projectionMatrix"),
    modelViewMatrix: gl.getUniformLocation(shaderProgram, "modelViewMatrix"),
  };

  gl.useProgram(shaderProgram);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0.047, 0.047, 0.102, 1);
  gl.lineWidth(1);
  startTime = performance.now();
}

function handleScroll() {
  nav.classList.toggle("scrolled", window.scrollY > 100);
}

function drawHero(now = performance.now()) {
  if (!gl || !shaderProgram) {
    return;
  }

  smoothMouse.x += (pointer.x / Math.max(1, width) - smoothMouse.x) * 0.05;
  smoothMouse.y += (1 - pointer.y / Math.max(1, height) - smoothMouse.y) * 0.05;

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(shaderProgram);

  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.enableVertexAttribArray(attributeLocations.position);
  gl.vertexAttribPointer(attributeLocations.position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, baseLineBuffer);
  gl.enableVertexAttribArray(attributeLocations.basePosition);
  gl.vertexAttribPointer(attributeLocations.basePosition, 3, gl.FLOAT, false, 0, 0);

  gl.uniform1f(uniformLocations.time, (now - startTime) / 1000);
  gl.uniform3f(uniformLocations.color, 1, 1, 1);
  gl.uniform2f(uniformLocations.mouse, smoothMouse.x, smoothMouse.y);
  gl.uniformMatrix4fv(uniformLocations.projectionMatrix, false, perspectiveMatrix(75, width / Math.max(1, height), 0.1, 1000));
  gl.uniformMatrix4fv(uniformLocations.modelViewMatrix, false, modelViewMatrix());
  gl.drawArrays(gl.LINES, 0, vertexCount);

  if (!prefersReducedMotion) {
    requestAnimationFrame(drawHero);
  }
}

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08, rootMargin: "0px 0px -12% 0px" },
);

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

document.querySelectorAll(".video-cover img[data-fallback-src]").forEach((image) => {
  const useFallback = () => {
    if (!image.dataset.fallbackSrc) {
      return;
    }

    image.src = image.dataset.fallbackSrc;
    image.removeAttribute("data-fallback-src");
  };

  image.addEventListener("error", useFallback, { once: true });
  image.addEventListener(
    "load",
    () => {
      if (image.naturalWidth <= 160 || image.naturalHeight <= 120) {
        useFallback();
      }
    },
    { once: true },
  );
});

document.querySelectorAll(".video-cover").forEach((button) => {
  button.addEventListener("click", () => {
    const videoId = button.dataset.videoId;
    const title = button.dataset.videoTitle || "YouTube video";
    const iframe = document.createElement("iframe");
    const params = new URLSearchParams({
      autoplay: "1",
      enablejsapi: "1",
      rel: "0",
      modestbranding: "1",
      playsinline: "1",
    });

    if (window.location.origin.startsWith("http")) {
      params.set("origin", window.location.origin);
      params.set("widget_referrer", window.location.href);
    }

    iframe.src = `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
    iframe.title = title;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";

    button.replaceWith(iframe);
  });
});

const imageLightbox = document.getElementById("image-lightbox");
const imageLightboxImage = imageLightbox?.querySelector("img");
const imageLightboxClose = imageLightbox?.querySelector(".lightbox-close");

function closeImageLightbox() {
  if (!imageLightbox || !imageLightboxImage) {
    return;
  }

  imageLightbox.classList.remove("is-open");
  imageLightbox.hidden = true;
  imageLightboxImage.src = "";
  imageLightboxImage.alt = "";
}

document.querySelectorAll(".image-preview-trigger").forEach((button) => {
  button.addEventListener("click", () => {
    if (!imageLightbox || !imageLightboxImage) {
      return;
    }

    imageLightboxImage.src = button.dataset.fullImage || "";
    imageLightboxImage.alt = button.dataset.fullAlt || "Image preview";
    imageLightbox.hidden = false;
    imageLightbox.classList.add("is-open");
  });
});

imageLightboxClose?.addEventListener("click", closeImageLightbox);
imageLightbox?.addEventListener("click", (event) => {
  if (event.target === imageLightbox) {
    closeImageLightbox();
  }
});

document.querySelectorAll(".leader-carousel").forEach((carousel) => {
  const track = carousel.querySelector(".leader-track");
  const buttons = carousel.querySelectorAll(".carousel-button");
  const cards = Array.from(carousel.querySelectorAll(".leader-card"));
  let autoplayId = null;
  let resumeId = null;
  let currentIndex = 0;

  if (!track || cards.length <= 1) {
    return;
  }

  const getCardOffsets = () => cards.map((card) => card.offsetLeft - track.offsetLeft);

  const getMaxStartIndex = () => {
    const offsets = getCardOffsets();
    const maxScroll = track.scrollWidth - track.clientWidth;
    return offsets.reduce((maxIndex, offset, index) => {
      return offset <= maxScroll + 1 ? index : maxIndex;
    }, 0);
  };

  const goToIndex = (index, behavior = "smooth") => {
    const offsets = getCardOffsets();
    const maxStartIndex = getMaxStartIndex();
    const targetIndex = Math.max(0, Math.min(index, maxStartIndex));
    const maxScroll = track.scrollWidth - track.clientWidth;
    const targetLeft = targetIndex === maxStartIndex ? maxScroll : offsets[targetIndex];
    currentIndex = targetIndex;
    track.scrollTo({
      left: targetLeft,
      behavior,
    });
  };

  const goByDirection = (direction) => {
    const maxStartIndex = getMaxStartIndex();
    if (direction > 0 && currentIndex >= maxStartIndex) {
      goToIndex(0);
      return;
    }

    if (direction < 0 && currentIndex <= 0) {
      goToIndex(maxStartIndex);
      return;
    }

    goToIndex(currentIndex + direction);
  };

  const stopAutoplay = () => {
    window.clearInterval(autoplayId);
    window.clearTimeout(resumeId);
    autoplayId = null;
    resumeId = null;
  };

  const startAutoplay = () => {
    if (prefersReducedMotion || autoplayId) {
      return;
    }

    autoplayId = window.setInterval(() => goByDirection(1), 4200);
  };

  const pauseThenResume = () => {
    stopAutoplay();
    if (!prefersReducedMotion) {
      resumeId = window.setTimeout(startAutoplay, 7000);
    }
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const direction = Number(button.dataset.carouselDirection || 1);
      goByDirection(direction);
      pauseThenResume();
    });
  });

  carousel.addEventListener("mouseenter", stopAutoplay);
  carousel.addEventListener("mouseleave", startAutoplay);
  carousel.addEventListener("focusin", stopAutoplay);
  carousel.addEventListener("focusout", startAutoplay);

  startAutoplay();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeImageLightbox();
  }
});

window.addEventListener("scroll", handleScroll, { passive: true });
window.addEventListener("resize", resizeCanvas);
window.addEventListener("pointermove", (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});

resizeCanvas();
handleScroll();
initHeroShader();
drawHero();
