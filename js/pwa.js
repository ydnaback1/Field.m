(() => {
  const CACHE_PREFIX = "field-maps-app-";
  const updateNotice = document.getElementById("app-update-notice");
  const updateNowButton = document.getElementById("app-update-now");
  const recoveryNotice = document.getElementById("connection-restored-notice");
  const recoveryReload = document.getElementById("connection-restored-reload");
  const bootedWithoutRuntimeConfig = !(CONFIG.apiKey && CONFIG.orsApiKey);
  let connectionRestored = false;
  let registrationPromise = null;
  let reloadForUpdate = false;

  function supported() {
    return "serviceWorker" in navigator;
  }

  function showWaitingWorker(registration) {
    if (!updateNotice) return;
    updateNotice.hidden = !registration.waiting;
    showConnectionRecovery();
  }

  function shouldOfferConfigReload(missingAtBoot, onlineEvent) {
    return Boolean(missingAtBoot && onlineEvent);
  }

  function showConnectionRecovery() {
    if (recoveryNotice) recoveryNotice.hidden = !connectionRestored || !updateNotice?.hidden;
  }

  function watchRegistration(registration) {
    showWaitingWorker(registration);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") showWaitingWorker(registration);
      });
    });
  }

  function registerWorker() {
    if (!supported()) return Promise.resolve(null);
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker
        .register("./sw.js")
        .then((registration) => {
          watchRegistration(registration);
          return registration;
        })
        .catch((error) => {
          console.warn("Field Maps service worker registration failed.", error);
          return null;
        });
    }
    return registrationPromise;
  }

  function requestBuildId(worker) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => resolve(null), 1200);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        resolve(
          event.data?.type === "FIELD_MAPS_BUILD_ID"
            ? event.data.buildId
            : null,
        );
      };
      worker.postMessage({ type: "GET_BUILD_ID" }, [channel.port2]);
    });
  }

  async function getBuildInfo() {
    const registration = await registerWorker();
    if (!registration)
      return { label: "Service worker unavailable", buildId: null };
    const worker =
      registration.active || registration.waiting || registration.installing;
    if (!worker) return { label: "Preparing app files…", buildId: null };
    const buildId = await requestBuildId(worker);
    return buildId
      ? { label: buildId, buildId }
      : { label: "Preparing app files…", buildId: null };
  }

  async function checkForUpdates() {
    const registration = await registerWorker();
    if (!registration)
      return "Service workers are unavailable in this browser.";
    await registration.update();
    showWaitingWorker(registration);
    return registration.waiting
      ? "Update available."
      : "App files are up to date.";
  }

  async function refreshAppFiles() {
    if (!("caches" in window))
      return "App file storage is unavailable in this browser.";
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
        .map((cacheName) => caches.delete(cacheName)),
    );
    const registration = await registerWorker();
    if (registration) await registration.update();
    window.location.reload();
    return "Refreshing app files…";
  }

  async function activateWaitingUpdate() {
    const registration = await registerWorker();
    if (!registration?.waiting || reloadForUpdate) return;

    reloadForUpdate = true;
    let reloaded = false;

    const reloadOnce = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", reloadOnce, {
      once: true,
    });

    registration.waiting.postMessage({ type: "SKIP_WAITING" });

    window.setTimeout(reloadOnce, 1500);
  }

  function requestPersistentStorage() {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  }

  updateNowButton?.addEventListener("click", activateWaitingUpdate);
  window.addEventListener("online", () => {
    if (!shouldOfferConfigReload(bootedWithoutRuntimeConfig, true)) return;
    connectionRestored = true;
    showConnectionRecovery();
  });
  recoveryReload?.addEventListener("click", () => {
    if (window.FieldMapsHasLiveSession?.() && !window.confirm("Reloading will end your live recording or navigation session. Reload now?")) return;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    requestPersistentStorage();
    registerWorker();
  });

  window.FieldMapsPwa = {
    supported,
    getBuildInfo,
    checkForUpdates,
    refreshAppFiles,
    shouldOfferConfigReload,
  };
})();
