(() => {
  const CACHE_PREFIX = "field-maps-app-";
  const updateNotice = document.getElementById("app-update-notice");
  const updateNowButton = document.getElementById("app-update-now");
  const updateLabel = updateNotice?.querySelector("span");
  const recoveryNotice = document.getElementById("connection-restored-notice");
  const recoveryReload = document.getElementById("connection-restored-reload");
  const installNotice = document.getElementById("app-install-notice");
  const installButton = document.getElementById("app-install-now");
  const installDismiss = document.getElementById("app-install-dismiss");
  const bootedWithoutRuntimeConfig = !(CONFIG.apiKey && CONFIG.orsApiKey);
  let connectionRestored = false;
  let registrationPromise = null;
  let updateState = "idle";
  let waitingWasShown = false;
  let updateTarget = null;
  let controllerBeforeUpdate = null;
  let installEvent = null;
  let installDismissed = false;
  let installReady = false;
  let installed = false;

  function supported() {
    return "serviceWorker" in navigator;
  }

  function showWaitingWorker(registration) {
    if (!updateNotice) return;
    const waiting = Boolean(registration.waiting);
    if (waiting) waitingWasShown = true;
    if (updateState === "idle") updateNotice.hidden = !waiting;
    showNotices();
  }

  function shouldOfferConfigReload(missingAtBoot, onlineEvent) {
    return Boolean(missingAtBoot && onlineEvent);
  }

  function showNotices() {
    if (recoveryNotice) recoveryNotice.hidden = !connectionRestored || !updateNotice?.hidden;
    if (installNotice) installNotice.hidden = !installReady || installDismissed || !canInstall() || !updateNotice?.hidden || !recoveryNotice?.hidden;
  }

  function standalone() {
    return window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function canInstall() {
    return Boolean(installEvent && !installed && !standalone() && !window.FieldMapsHasLiveSession?.());
  }

  function notifyInstallAvailability() {
    showNotices();
    window.dispatchEvent(new Event("fieldmapsinstallchange"));
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
    if (updateState !== "idle") return;
    if (!registration?.waiting) {
      showWaitingWorker(registration || { waiting: null });
      return;
    }
    if (window.FieldMapsHasLiveSession?.() && !window.confirm("Updating will end your live recording or navigation session. Update now?")) return;
    updateTarget = registration.waiting;
    controllerBeforeUpdate = navigator.serviceWorker.controller;
    updateState = "updating";
    updateLabel.textContent = "Updating…";
    updateNowButton.textContent = "Updating…";
    updateNowButton.disabled = true;
    showNotices();
    // The listener is installed at startup, before any SKIP_WAITING message.
    if (registration.waiting === updateTarget) updateTarget.postMessage({ type: "SKIP_WAITING" });
    // A timer is only a fallback for browsers that activate but miss controllerchange.
    window.setTimeout(() => {
      if (updateState !== "updating") return;
      if (navigator.serviceWorker.controller !== controllerBeforeUpdate ||
          (registration.active === updateTarget && updateTarget.state === "activated")) {
        reloadForNewController();
      } else if (registration.waiting === updateTarget) {
        updateTarget.postMessage({ type: "SKIP_WAITING" });
        window.setTimeout(() => {
          if (updateState === "updating" && registration.active === updateTarget) reloadForNewController();
          else if (updateState === "updating") resetUpdate(registration);
        }, 2500);
      } else {
        resetUpdate(registration);
      }
    }, 2500);
  }

  function reloadForNewController() {
    if (updateState === "reloading") return;
    updateState = "reloading";
    window.location.reload();
  }

  function resetUpdate(registration) {
    updateState = "idle";
    updateTarget = null;
    updateLabel.textContent = "Update available";
    updateNowButton.textContent = "Update now";
    updateNowButton.disabled = false;
    showWaitingWorker(registration);
  }

  function requestPersistentStorage() {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  }

  updateNowButton?.addEventListener("click", activateWaitingUpdate);
  if (supported()) navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateState === "updating" && navigator.serviceWorker.controller !== controllerBeforeUpdate) {
      reloadForNewController();
    } else if (updateState === "idle" && waitingWasShown) {
      // Another tab may have activated the update while this page was open.
      reloadForNewController();
    }
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event;
    notifyInstallAvailability();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    installEvent = null;
    notifyInstallAvailability();
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", notifyInstallAvailability);
  installButton?.addEventListener("click", promptInstall);
  installDismiss?.addEventListener("click", () => {
    installDismissed = true;
    showNotices();
  });
  async function promptInstall() {
    if (!canInstall()) return;
    const event = installEvent;
    installEvent = null; // A beforeinstallprompt event can only be used once.
    installDismissed = true;
    notifyInstallAvailability();
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice?.outcome === "accepted") installed = true;
      notifyInstallAvailability();
    } catch (error) {
      // The browser owns the install prompt; cancellation leaves the app usable.
    }
  }
  window.addEventListener("online", () => {
    if (!shouldOfferConfigReload(bootedWithoutRuntimeConfig, true)) return;
    connectionRestored = true;
    showNotices();
  });
  recoveryReload?.addEventListener("click", () => {
    if (window.FieldMapsHasLiveSession?.() && !window.confirm("Reloading will end your live recording or navigation session. Reload now?")) return;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    requestPersistentStorage();
    registerWorker();
    window.setTimeout(() => {
      installReady = true;
      showNotices();
    }, 4000);
  });
  window.setInterval?.(() => {
    if (installReady && (canInstall() || !installNotice?.hidden)) showNotices();
  }, 3000);

  window.FieldMapsPwa = {
    supported,
    getBuildInfo,
    checkForUpdates,
    refreshAppFiles,
    shouldOfferConfigReload,
    canInstall,
    promptInstall,
  };
})();
