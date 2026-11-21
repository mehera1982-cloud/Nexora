"use strict";

/* ============================================
   NEXORA 4.0 SERVICE WORKER
============================================ */

const CACHE_NAME = "nexora-v4-build-2";

const STATIC_FILES = [

  "./",

  "./index.html",

  "./style.css",

  "./app.js",

  "./manifest.json",

  "./icon-192.png",

  "./icon-512.png"

];


/* INSTALL */

self.addEventListener(

  "install",

  event => {

    event.waitUntil(

      caches.open(CACHE_NAME)

        .then(cache => {

          return cache.addAll(
            STATIC_FILES
          );

        })

    );

    self.skipWaiting();

  }

);


/* ACTIVATE */

self.addEventListener(

  "activate",

  event => {

    event.waitUntil(

      caches.keys()

        .then(keys => {

          return Promise.all(

            keys

              .filter(key => {

                return key !== CACHE_NAME;

              })

              .map(key => {

                return caches.delete(key);

              })

          );

        })

    );

    self.clients.claim();

  }

);


/* FETCH */

self.addEventListener(

  "fetch",

  event => {

    const request =
      event.request;

    const url =
      new URL(request.url);

    if (
      request.method !== "GET"
    ) {

      return;

    }

    /*
      Never cache API requests.
    */

    if (
      url.origin !==
      self.location.origin
    ) {

      return;

    }

    event.respondWith(

      fetch(request)

        .then(response => {

          if (response.ok) {

            const copy =
              response.clone();

            caches.open(CACHE_NAME)

              .then(cache => {

                cache.put(
                  request,
                  copy
                );

              });

          }

          return response;

        })

        .catch(() => {

          return caches.match(
            request
          );

        })

    );

  }

);