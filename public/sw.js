const CACHE = 'arcade-v1'
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']
const NAV_TIMEOUT_MS = 4000

const putOk = async (request, response) => {
  if (!response || !response.ok || response.type !== 'basic') return
  const copy = response.clone()
  try {
    const cache = await caches.open(CACHE)
    await cache.put(request, copy)
  } catch {
    return
  }
}

const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms))

const fresh = (request) =>
  fetch(request).then(
    (response) => {
      putOk(request, response)
      return response
    },
    () => null,
  )

const handleNavigate = (request) => {
  const network = fresh(request)
  return Promise.race([network, timeout(NAV_TIMEOUT_MS)]).then(async (response) => {
    if (response) return response
    const cached = (await caches.match('/index.html')) || (await caches.match(request))
    return cached || Response.error()
  })
}

const handleAsset = (request) => {
  const refresh = fresh(request)
  return caches.match(request).then((cached) => {
    if (cached) return cached
    return refresh.then((response) => response || Response.error())
  })
}

const handleNetworkFirst = (request) =>
  fresh(request).then(async (response) => {
    if (response) return response
    const cached = await caches.match(request)
    return cached || Response.error()
  })

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.allSettled(PRECACHE.map((url) => cache.addAll([url])))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(handleAsset(request))
  } else {
    event.respondWith(handleNetworkFirst(request))
  }
})
